import type {
  SopGroupId,
  SopReleaseProjection,
} from '@customer-agent/content-intake';

type Brand<T, Name extends string> = T & { readonly __brand: Name };
type QueryId = Brand<string, 'QueryId'>;
type ReleaseId = Brand<string, 'ReleaseId'>;

type SopStep = {
  stepId: string;
  kind: 'instruction' | 'decision' | 'terminal';
  sequence: number;
  text: string;
  media: string[];
};
type SopFlow = {
  sopId: string;
  title: string;
  entryStepId: string;
  steps: SopStep[];
  branches: Array<{
    branchId: string;
    sourceStepId: string;
    label: string;
    targetStepId: string;
  }>;
};
export type SopPipelineOutcome =
  | { kind: 'sop'; queryId: QueryId; releaseId: ReleaseId; flow: SopFlow }
  | { kind: 'no-hit'; queryId: QueryId; reason: string }
  | { kind: 'failure'; queryId: QueryId; failureCode: string; retryable: boolean; message: string };

export type SopPipelineProjection = SopReleaseProjection;

export type SopPipelineQueryLease = Readonly<{
  releaseId: string;
  sessionEpoch: number;
  revoked: boolean;
  expiresAt: string;
}>;

export type SopPipelineQuery = Readonly<{
  queryId: string;
  text: string;
  lease: SopPipelineQueryLease;
}>;

const GROUP_IDS: readonly SopGroupId[] = [
  'allergy',
  'acne',
  'quality-after-sale',
  'minor-error-broken',
  'tax',
];

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function validSeverityOrder(order: readonly SopGroupId[] | null): order is readonly SopGroupId[] {
  return order !== null
    && order.length === GROUP_IDS.length
    && new Set(order).size === GROUP_IDS.length
    && GROUP_IDS.every((groupId) => order.includes(groupId));
}

function failure(
  queryId: string,
  failureCode: string,
  message: string,
  retryable = false,
): SopPipelineOutcome {
  return {
    kind: 'failure',
    queryId: queryId as QueryId,
    failureCode,
    retryable,
    message,
  };
}

/** A release-scoped SOP index. The pipeline owns only SOP classification and
 * conflict resolution. Ordinary content retrieval is a separate pipeline and
 * cannot appear in this return type. */
export class SopPipeline {
  readonly #projection: SopPipelineProjection;
  readonly #severityRank: ReadonlyMap<SopGroupId, number>;
  readonly #flows: ReadonlyMap<string, Readonly<{
    definition: SopPipelineProjection['definitions'][number];
    flow: SopFlow;
  }>>;
  readonly #classifyEntries: readonly Readonly<{
    sceneId: string;
    text: string;
  }>[];

  constructor(projection: SopPipelineProjection) {
    if (projection.schemaVersion !== 'sop-release-v1'
      || projection.releaseId.length === 0
      || !/^[a-f0-9]{64}$/u.test(projection.indexHash)
      || !Number.isSafeInteger(projection.itemCount)
      || projection.itemCount < 0) {
      throw new Error('SOP_PROJECTION_INVALID');
    }
    if (projection.severityOrder !== null && !validSeverityOrder(projection.severityOrder)) {
      throw new Error('SOP_SEVERITY_ORDER_INVALID');
    }
    this.#projection = projection;
    this.#severityRank = new Map(
      (projection.severityOrder ?? []).map((groupId, index) => [groupId, index]),
    );
    this.#flows = new Map(projection.definitions.map((definition) => {
      const steps: SopStep[] = definition.steps.map((step) => ({
        stepId: step.stepId,
        kind: step.kind,
        sequence: step.sequence,
        text: step.text,
        media: [...step.media],
      }));
      const branches: SopFlow['branches'] = definition.branches.map((branch) => ({ ...branch }));
      steps.forEach((step) => {
        Object.freeze(step.media);
        Object.freeze(step);
      });
      branches.forEach((branch) => Object.freeze(branch));
      const flow: SopFlow = {
        sopId: definition.sopId,
        title: definition.title,
        entryStepId: definition.entryStepId,
        steps,
        branches,
      };
      Object.freeze(steps);
      Object.freeze(branches);
      Object.freeze(flow);
      return [definition.sceneId, { definition, flow }] as const;
    }));
    this.#classifyEntries = projection.searchEntries
      .filter((entry) => entry.purpose === 'classify')
      .map((entry) => Object.freeze({
        sceneId: entry.sceneId,
        text: normalized(entry.text),
      }))
      .filter((entry) => entry.text.length > 0);
  }

  query(input: SopPipelineQuery): SopPipelineOutcome {
    if (input.lease.releaseId !== this.#projection.releaseId) {
      return failure(input.queryId, 'SOP_RELEASE_CHANGED', '当前流程版本已经变化，请重新查询');
    }
    if (input.lease.revoked) {
      return failure(input.queryId, 'SOP_REVOKED', '当前流程权限已经撤销');
    }
    const expiresAt = Date.parse(input.lease.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return failure(input.queryId, 'SOP_EXPIRED', '当前流程使用期限已经结束');
    }
    const text = normalized(input.text);
    if (!text) {
      return { kind: 'no-hit', queryId: input.queryId as QueryId, reason: 'SOP_EMPTY_QUERY' };
    }
    const matchedSceneIds = new Set(
      this.#classifyEntries
        .filter((entry) => text.includes(entry.text))
        .map((entry) => entry.sceneId),
    );
    if (matchedSceneIds.size === 0) {
      return { kind: 'no-hit', queryId: input.queryId as QueryId, reason: 'SOP_NOT_MATCHED' };
    }
    if (!validSeverityOrder(this.#projection.severityOrder)) {
      return failure(
        input.queryId,
        'SOP_SEVERITY_ORDER_REQUIRED',
        'SOP 严重性顺序尚未由业务确认，不能自动选择流程',
      );
    }
    const matches = [...matchedSceneIds]
      .map((sceneId) => this.#flows.get(sceneId))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
      .map((definition) => ({
        ...definition,
        rank: this.#severityRank.get(definition.definition.groupId),
      }));
    if (matches.some((match) => match.rank === undefined)) {
      return failure(input.queryId, 'SOP_SEVERITY_ORDER_REQUIRED', 'SOP 严重性顺序不完整');
    }
    const topRank = Math.min(...matches.map((match) => match.rank!));
    const selected = matches.filter((match) => match.rank === topRank);
    if (selected.length !== 1) {
      return failure(
        input.queryId,
        'SOP_AMBIGUOUS_ROUTE',
        '同一严重性下命中多个流程，需要业务配置后重试',
      );
    }
    const selectedFlow = selected[0]!.flow;
    return {
      kind: 'sop',
      queryId: input.queryId as QueryId,
      releaseId: this.#projection.releaseId as ReleaseId,
      flow: selectedFlow,
    };
  }
}
