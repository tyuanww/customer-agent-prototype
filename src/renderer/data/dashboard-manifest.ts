import { deepFreeze } from '@shared/deep-freeze';
import {
  DASHBOARD_ARCHITECTURE_MARK,
  DASHBOARD_ENV_BADGES,
  DASHBOARD_METRIC_SCOPE,
  DASHBOARD_REFRESH_LABEL,
  DASHBOARD_REFRESHED_AT,
  DASHBOARD_STRUCTURE_DISCLAIMER,
} from '@shared/dashboard-window';

export const DASHBOARD_MODULE_IDS = [
  'overview',
  'workorders',
  'ledger',
  'review',
  'wording',
  'iteration',
  'content',
  'announce',
  'architecture',
] as const;

export type DashboardModuleId = (typeof DASHBOARD_MODULE_IDS)[number];

export type ArchitectureDesignStatus = 'mapped' | 'pending';
export type ArchitecturePrototypeStatus =
  | 'runtime-interactive'
  | 'static-interactive'
  | 'visual-only'
  | 'absent';
export type ArchitectureFormalRuntimeStatus = 'not-started' | 'in-progress' | 'verified';
export type LedgerTerminal = 'copied' | 'no_hit' | 'abandoned' | 'risk_escalated';
export type IterationStatus = 'open' | 'in_progress' | 'resolved' | 'wont_fix';
export type IterationKind = 'no_hit' | 'top1_skipped' | 'risk_escalated';
export type IterationCause = 'content_gap' | 'ranking' | 'policy';
export type DomainId = 'presale' | 'campaign' | 'aftersale' | 'product';
export type SyncFacet = 'published' | 'announced' | 'client_ack' | 'offline_lease';
export type VocTimeGrain = 'year' | 'month' | 'day';

export type DashboardNavItem = {
  id: DashboardModuleId;
  label: string;
  blurb: string;
  group: '经营总览' | '服务洞察' | '话术运营' | '治理与架构';
};

export type DashboardDeferredNavItem = {
  id: 'workorder-trash';
  label: string;
  statusLabel: string;
  group: '服务洞察';
};

export type WordingLifecycle = 'demo_effective' | 'demo_expiring' | 'structure_sample';
export type SourceReadiness = 'structure_confirmed' | 'upstream_authoring';

export type WordingEntry = {
  scriptId: string;
  domain: DomainId;
  title: string;
  scene: string;
  answerPreview: string;
  platform: string;
  version: string;
  effectiveWindow: string;
  risk: 'low' | 'medium' | 'high';
  lifecycle: WordingLifecycle;
  lifecycleLabel: string;
  ownerRole: string;
  dataClass: 'synthetic';
};

export type ManagerDecision = {
  id: string;
  priority: 'P0' | 'P1' | 'P2';
  title: string;
  evidence: string;
  impact: string;
  owner: string;
  nextStep: string;
  statusLabel: string;
  reviewWindow: string;
  target: DashboardModuleId;
};

export type OverviewHealthMetric = {
  id: string;
  label: string;
  value: string;
  note: string;
  period: string;
  definition: string;
  target: DashboardModuleId;
};

export type OverviewTrendMetricId = 'questions' | 'noHitRate' | 'copyRate';

export type OverviewTrendPoint = {
  label: string;
  range: string;
  questions: number;
  noHitRate: number;
  copyRate: number;
};

export type OverviewStructureItem = {
  id: LedgerTerminal;
  label: string;
  count: number;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  explanation: string;
};

export type VocInsight = {
  id: string;
  label: string;
  count: number;
  pct: number;
  severity: 'watch' | 'warn' | 'risk';
  productScope: readonly string[];
  productBreakdown: readonly { product: string; count: number }[];
  wordingGap: string;
  owner: string;
  nextStep: string;
};

export type VocTimeSlice = {
  id: string;
  grain: VocTimeGrain;
  label: string;
  rangeLabel: string;
  ticketCount: number;
  uniqueOrders: number;
  issueCounts: readonly {
    insightId: string;
    productBreakdown: readonly { product: string; count: number }[];
  }[];
};

export type OfflineReviewDimensionId = 'modified' | 'sent' | 'applicable';
export type OfflineReviewOutcomeTone = 'positive' | 'neutral' | 'warning' | 'unknown';

export type OfflineReviewOutcome = {
  id: string;
  label: string;
  count: number;
  definition: string;
  tone: OfflineReviewOutcomeTone;
};

export type OfflineReviewDimension = {
  id: OfflineReviewDimensionId;
  label: string;
  question: string;
  reviewed: number;
  verifiable: number;
  unverifiable: number;
  denominatorLabel: string;
  evidenceGrade: string;
  outcomes: readonly OfflineReviewOutcome[];
};

export type OverviewMetric = {
  id: string;
  label: string;
  value: string;
  unit?: string;
  sampleNote: string;
  explanation?: string;
};

export type LedgerTop3Binding = {
  rank: 1 | 2 | 3;
  releaseId: string;
  scriptId: string;
  version: string;
  contentHash: string;
};

export type LedgerRow = {
  operationId: string;
  rootQuestionId: string;
  askedAt: string;
  scene: string;
  rootQuestion: string;
  operationNote: string;
  top3: readonly LedgerTop3Binding[];
  chosenRank: 1 | 2 | 3 | null;
  terminal: LedgerTerminal;
  terminalLabel: string;
};

export type WorkorderStage = 'precheck' | 'map' | 'aggregate' | 'drill' | 'redacted_export';

export type WorkorderBatch = {
  batchId: string;
  title: string;
  currentStage: WorkorderStage;
  ticketCount: number;
  uniqueOrders: number;
  rejectedFields: readonly string[];
  distribution: readonly { label: string; count: number; pct: number }[];
};

export type IterationTask = {
  taskId: string;
  kind: IterationKind;
  kindLabel: string;
  status: IterationStatus;
  statusLabel: string;
  cause: IterationCause;
  causeLabel: string;
  priority: 'P0' | 'P1' | 'P2';
  owner: string;
  evidenceCount: number;
  title: string;
  detail: string;
  nextStep: string;
};

export type ContentRelease = {
  releaseId: string;
  title: string;
  bindings: readonly { domain: DomainId; label: string; sourceId: string; bound: boolean }[];
  review: string;
  quality: string;
  validity: string;
  risk: string;
  blocked: boolean;
  blockReason?: string;
};

export type AnnounceRow = {
  itemId: string;
  title: string;
  published: boolean;
  announced: boolean;
  clientAck: boolean;
  offlineLease: boolean;
};

export type ArchitectureEvidence = {
  designStatus: ArchitectureDesignStatus;
  designStatusLabel: string;
  prototypeStatus: ArchitecturePrototypeStatus;
  prototypeStatusLabel: string;
  formalRuntimeStatus: ArchitectureFormalRuntimeStatus;
  formalRuntimeStatusLabel: string;
};

export type ArchitectureNode = ArchitectureEvidence & {
  id: string;
  title: string;
  detail: string;
  redline?: boolean;
};

export type ArchitectureFlowStep = ArchitectureEvidence & {
  code: string;
  title: string;
  detail: string;
};

export type ArchitectureFlow = {
  id: 'float' | 'dashboard';
  title: string;
  detail: string;
  steps: readonly ArchitectureFlowStep[];
};

export type ArchitectureGuardrail = {
  id: string;
  title: string;
  detail: string;
};

const ARCHITECTURE_EVIDENCE_LABELS = {
  design: {
    mapped: '设计已映射',
    pending: '设计待映射',
  },
  prototype: {
    'runtime-interactive': '本地合成运行',
    'static-interactive': '静态合成交互',
    'visual-only': '交互形状模拟',
    absent: '原型未实现',
  },
  formalRuntime: {
    'not-started': '正式未接入',
    'in-progress': '正式实现中',
    verified: '正式已验证',
  },
} as const;

function architectureEvidence(
  prototypeStatus: ArchitecturePrototypeStatus,
  formalRuntimeStatus: ArchitectureFormalRuntimeStatus = 'not-started',
  designStatus: ArchitectureDesignStatus = 'mapped',
): ArchitectureEvidence {
  return {
    designStatus,
    designStatusLabel: ARCHITECTURE_EVIDENCE_LABELS.design[designStatus],
    prototypeStatus,
    prototypeStatusLabel: ARCHITECTURE_EVIDENCE_LABELS.prototype[prototypeStatus],
    formalRuntimeStatus,
    formalRuntimeStatusLabel: ARCHITECTURE_EVIDENCE_LABELS.formalRuntime[formalRuntimeStatus],
  };
}

export const DASHBOARD_NAV: readonly DashboardNavItem[] = deepFreeze([
  { id: 'overview', label: '管理概览', blurb: '风险、责任与处理进度', group: '经营总览' },
  { id: 'workorders', label: 'VOC / 工单洞察', blurb: '去标识聚合、筛选与下钻', group: '服务洞察' },
  { id: 'ledger', label: '检索效果', blurb: '根问题 / 检索操作双账', group: '服务洞察' },
  { id: 'review', label: '离线抽样复核', blurb: '修改 / 发送 / 适用性分账', group: '服务洞察' },
  { id: 'wording', label: '话术库', blurb: '四域资产浏览与来源就绪度', group: '话术运营' },
  { id: 'iteration', label: '话术优化待办', blurb: '缺库 / 排序 / 风险分域', group: '话术运营' },
  { id: 'content', label: '内容与发布', blurb: '四域绑定与缺域阻断', group: '治理与架构' },
  { id: 'announce', label: '公告与同步', blurb: 'published / ACK / lease 分面', group: '治理与架构' },
  { id: 'architecture', label: '架构能力图', blurb: '双表面与九端口故事', group: '治理与架构' },
]);

export const DASHBOARD_DEFERRED_NAV: readonly DashboardDeferredNavItem[] = deepFreeze([
  {
    id: 'workorder-trash',
    label: '工单垃圾桶',
    statusLabel: '二期待实施',
    group: '服务洞察',
  },
]);

export const DASHBOARD_MANIFEST = deepFreeze({
  banners: {
    env: DASHBOARD_ENV_BADGES,
    disclaimer: DASHBOARD_STRUCTURE_DISCLAIMER,
    architectureMark: DASHBOARD_ARCHITECTURE_MARK,
    refreshedAt: DASHBOARD_REFRESHED_AT,
    refreshLabel: DASHBOARD_REFRESH_LABEL,
    metricScope: DASHBOARD_METRIC_SCOPE,
    syntheticMark: 'DEMO · 合成数据',
  },
  overview: {
    decisions: [
      {
        id: 'decision-source-gap',
        priority: 'P0',
        title: '售前 / 售后正式话术源尚未创建',
        evidence: '正式来源状态为 NOT_CREATED / UPSTREAM_AUTHORING；Demo 只展示合成结构样例。',
        impact: '2 个正式来源域阻断发布链路',
        owner: 'Content Lead + 客服业务 Owner',
        nextStep: '先完成上游文档与唯一主源指定，再进入导入与发布。',
        statusLabel: '发布阻断',
        reviewWindow: 'G0 前关闭',
        target: 'wording',
      },
      {
        id: 'decision-voc-risk',
        priority: 'P0',
        title: 'VOC 风险项需要归因，不看一条总均值',
        evidence: '面膜 / 棉片分表且字段不同；竞品表必须隔离，原始客户文本不得进 Dashboard。',
        impact: '148 条高风险合成聚合待复核',
        owner: '客服经理 + 产品 Owner',
        nextStep: '按产品线、问题类型和风险等级下钻，再决定补库或产品改进。',
        statusLabel: '待归因',
        reviewWindow: '下次 VOC 复核',
        target: 'workorders',
      },
      {
        id: 'decision-no-hit',
        priority: 'P1',
        title: '无命中与风险升级需要分开处理',
        evidence: '无命中可能是话术缺口或检索排序；风险升级属于 policy 边界，不能自动改 Answer。',
        impact: '58 次合成操作需分流处理',
        owner: '话术 Owner + Coach',
        nextStep: '查看检索效果并进入对应优化待办。',
        statusLabel: '待分流',
        reviewWindow: '本周内容复核',
        target: 'iteration',
      },
    ] satisfies ManagerDecision[],
    health: [
      {
        id: 'pending-decisions',
        label: '待处理事项',
        value: '3',
        note: '2 项 P0 · 1 项 P1',
        period: '当前固定快照',
        definition: '只统计本页有明确证据、Owner 和下一步的经理决策项。',
        target: 'overview',
      },
      {
        id: 'high-risk-voc',
        label: '高风险 VOC',
        value: '148',
        note: '去标识合成聚合',
        period: '工作簿结构镜像',
        definition: '风险等级为 risk 的聚合问题数；不含客户原文，也不等于投诉率。',
        target: 'workorders',
      },
      {
        id: 'no-hit-rate',
        label: '无命中率',
        value: '8.4%',
        note: '29 / 346 次合成操作',
        period: '最近 8 个固定周期',
        definition: '有效期过滤后无可用候选的操作占比；不等于坐席没有回答客户。',
        target: 'ledger',
      },
      {
        id: 'source-gaps',
        label: '待建正式来源',
        value: '2 域',
        note: '售前 / 售后',
        period: '当前治理状态',
        definition: '正式来源仍为 NOT_CREATED / UPSTREAM_AUTHORING，不能进入正式发布。',
        target: 'wording',
      },
    ] satisfies OverviewHealthMetric[],
    trendMetrics: [
      {
        id: 'questions',
        label: '根问题量',
        unit: '个',
        decimals: 0,
        explanation: '同一客户问题的合成去重根问题量，不等于消息条数或真实接待量。',
      },
      {
        id: 'noHitRate',
        label: '无命中率',
        unit: '%',
        decimals: 1,
        explanation: '本地合成检索无可用有效稿的占比，只用于演示趋势判读。',
      },
      {
        id: 'copyRate',
        label: '复制完成率',
        unit: '%',
        decimals: 1,
        explanation: '只表示写入剪贴板成功，不等于发送、采纳、正确或问题解决。',
      },
    ] as const,
    trend: [
      { label: 'W1', range: '06/22–06/28', questions: 94, noHitRate: 12.8, copyRate: 50.4 },
      { label: 'W2', range: '06/29–07/05', questions: 101, noHitRate: 11.9, copyRate: 52.8 },
      { label: 'W3', range: '07/06–07/12', questions: 108, noHitRate: 11.2, copyRate: 54.1 },
      { label: 'W4', range: '07/13–07/19', questions: 105, noHitRate: 10.7, copyRate: 55.6 },
      { label: 'W5', range: '07/20–07/26', questions: 116, noHitRate: 9.8, copyRate: 57.4 },
      { label: 'W6', range: '07/27–08/02', questions: 121, noHitRate: 9.1, copyRate: 59.2 },
      { label: 'W7', range: '08/03–08/09', questions: 124, noHitRate: 8.7, copyRate: 60.1 },
      { label: 'W8', range: '08/10–08/13', questions: 128, noHitRate: 8.4, copyRate: 61.3 },
    ] satisfies OverviewTrendPoint[],
    operationStructure: [
      {
        id: 'copied',
        label: '已复制',
        count: 212,
        tone: 'success',
        explanation: '仅确认剪贴板写入成功，不能推断最终发送或业务正确。',
      },
      {
        id: 'abandoned',
        label: '展开未选择',
        count: 76,
        tone: 'neutral',
        explanation: '用户看过候选但没有复制；原因需抽样复核，不能直接归为话术差。',
      },
      {
        id: 'no_hit',
        label: '无命中',
        count: 29,
        tone: 'warning',
        explanation: '有效期过滤后无可用候选，需拆分内容缺口与检索召回问题。',
      },
      {
        id: 'risk_escalated',
        label: '风险升级',
        count: 29,
        tone: 'danger',
        explanation: '命中承诺或合规边界，必须人工处理，不能让模型自动作答。',
      },
    ] satisfies OverviewStructureItem[],
    metrics: [
      {
        id: 'root-questions',
        label: '根问题数',
        value: '128',
        sampleNote: '合成演示样本',
      },
      {
        id: 'operations',
        label: '检索操作数',
        value: '346',
        sampleNote: '合成演示样本',
      },
      {
        id: 'copy-rate',
        label: '复制率',
        value: '61.3%',
        sampleNote: '合成演示样本',
        explanation: 'adopted 只等于复制成功，不等于已发送、已采纳或回答正确。',
      },
      {
        id: 'no-hit-rate',
        label: '无命中率',
        value: '8.4%',
        sampleNote: '合成演示样本',
      },
      {
        id: 'p95',
        label: '检索 P95',
        value: '42',
        unit: 'ms',
        sampleNote: '本地 fixture 合成时延，非正式 SLA',
      },
      {
        id: 'copied-ops',
        label: '复制成功操作',
        value: '212',
        sampleNote: '合成演示样本 · 仅剪贴板写入',
      },
    ] satisfies OverviewMetric[],
    notes: [
      '本页数字全部写死在编译期 manifest，不会读取 Float 输入或剪贴板。',
      '正式一期的 Dashboard 中心能力当前为架构模拟，G0/Ddev 未授权接入。',
      '正式角色矩阵：agent 使用 Float；coach 查看团队复核与待办；owner 才可发布/回滚。本 Demo 使用 MOCK AUTH，不执行 RBAC。',
      '正式系统还必须显式处理加载、无权限、部分失败、内容过期和服务不可用；本页不伪造这些运行态。',
      '登录、授权下钻、导入导出、待办变更、发布回滚、公告与租约应写 append-only 审计；本 Demo 不落审计数据。',
    ],
  },
  ledger: {
    title: '检索流水',
    kicker: 'root question 与 search operation 双账',
    emptyHint: '本 Demo 不采集真实检索。下表为预置合成流水。',
    rows: [
      {
        operationId: 'op-20260813-001',
        rootQuestionId: 'rq-cleanser-usage',
        askedAt: '2026-08-13 10:12:04',
        scene: '私域企微 · 产品用法',
        rootQuestion: '澄芽氨基酸洁面泡沫很少，是不是少了活剂？',
        operationNote: '同根问题第 2 次检索，坐席改写了口语。',
        top3: [
          {
            rank: 1,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-prod-001',
            version: 'q-14',
            contentHash: 'sha256:7c1a…b29e',
          },
          {
            rank: 2,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-prod-001-care',
            version: 'q-09',
            contentHash: 'sha256:11d4…90aa',
          },
          {
            rank: 3,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-prod-001-quick',
            version: 'q-06',
            contentHash: 'sha256:88e0…c4f1',
          },
        ],
        chosenRank: 2,
        terminal: 'copied',
        terminalLabel: '已复制 · 未发生发送',
      },
      {
        operationId: 'op-20260813-014',
        rootQuestionId: 'rq-serum-acid',
        askedAt: '2026-08-13 11:03:41',
        scene: '天猫咨询 · 成分叠加',
        rootQuestion: '雾屿精华今晚能和刷酸一起用吗？',
        operationNote: '根问题首次检索。',
        top3: [
          {
            rank: 1,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-prod-002',
            version: 'q-11',
            contentHash: 'sha256:4ab2…d017',
          },
          {
            rank: 2,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-after-004',
            version: 'q-03',
            contentHash: 'sha256:90c8…ee12',
          },
          {
            rank: 3,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-pre-007',
            version: 'q-02',
            contentHash: 'sha256:c31f…77ab',
          },
        ],
        chosenRank: 1,
        terminal: 'copied',
        terminalLabel: '已复制 · 未发生发送',
      },
      {
        operationId: 'op-20260813-028',
        rootQuestionId: 'rq-points-expire',
        askedAt: '2026-08-13 13:22:18',
        scene: '售后工单 · 会员积分',
        rootQuestion: '青禾会员日积分昨天到期了，还能补发吗？',
        operationNote: '命中过期活动域，检索按有效期过滤后无可用稿。',
        top3: [],
        chosenRank: null,
        terminal: 'no_hit',
        terminalLabel: '无命中',
      },
      {
        operationId: 'op-20260813-041',
        rootQuestionId: 'rq-sunscreen-acne',
        askedAt: '2026-08-13 14:08:55',
        scene: '抖音私信 · 使用反馈',
        rootQuestion: '月白防晒涂完出油还闷痘，要停用吗？',
        operationNote: '坐席展开 Top3 后未选择，会话被下一条消息打断。',
        top3: [
          {
            rank: 1,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-prod-003',
            version: 'q-08',
            contentHash: 'sha256:2e44…a91c',
          },
          {
            rank: 2,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-after-009',
            version: 'q-05',
            contentHash: 'sha256:bb70…14d6',
          },
          {
            rank: 3,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-pre-012',
            version: 'q-04',
            contentHash: 'sha256:0d9a…6cf3',
          },
        ],
        chosenRank: null,
        terminal: 'abandoned',
        terminalLabel: '已展开未选择',
      },
      {
        operationId: 'op-20260813-057',
        rootQuestionId: 'rq-refund-report',
        askedAt: '2026-08-13 16:41:09',
        scene: '售后升级 · 退货检测',
        rootQuestion: '退货一定要第三方检测报告吗？没有报告能退吗？',
        operationNote: '风险策略命中售后承诺边界，建议升级人工复核。',
        top3: [
          {
            rank: 1,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-after-021',
            version: 'q-07',
            contentHash: 'sha256:65f1…cc08',
          },
        ],
        chosenRank: null,
        terminal: 'risk_escalated',
        terminalLabel: '风险升级 · 未复制',
      },
    ] satisfies LedgerRow[],
  },
  review: {
    title: '离线三维抽样复核',
    kicker: '是否修改 / 是否发送 / 是否适用 · 三维分账',
    scope:
      '本页是 48 个去重根问题的全合成冻结样本池，只演示获批 Pilot 后的复核口径；当前没有真实复核 EVD，也不读取最终发送正文。',
    inferenceBoundary:
      '复制只证明剪贴板写入成功，不能推断已发送、已采纳、未修改或回答正确；三个维度必须分别由授权人工复核，无法证明时记为 unverifiable。',
    pool: {
      frozen: 48,
      reviewed: 36,
      coverage: '75.0%',
      evidenceGrade: 'DEMO · 方法结构演示',
    },
    dimensions: [
      {
        id: 'modified',
        label: '是否修改',
        question: '坐席最终使用内容相对所选话术发生了什么程度的修改？',
        reviewed: 36,
        verifiable: 31,
        unverifiable: 5,
        denominatorLabel: '修改分布以 31 个可核验根问题为有效分母；不可核验另列，不从复制倒推。',
        evidenceGrade: '合成离线复核 · 不含最终发送正文',
        outcomes: [
          { id: 'unchanged', label: '未修改', count: 16, definition: '授权复核证据确认与所选版本一致。', tone: 'positive' },
          { id: 'minor', label: '轻微修改', count: 9, definition: '不改变承诺、范围与风险边界的轻量调整。', tone: 'neutral' },
          { id: 'material', label: '实质修改', count: 4, definition: '关键信息、范围或表达发生实质变化，需回看话术缺口。', tone: 'warning' },
          { id: 'rewrite', label: '重写', count: 2, definition: '最终表达不再能视为所选话术的直接使用。', tone: 'warning' },
          { id: 'unverifiable', label: '不可核验', count: 5, definition: '缺少足够的授权离线证据，不能依据复制行为补值。', tone: 'unknown' },
        ],
      },
      {
        id: 'sent',
        label: '是否发送',
        question: '所选或调整后的话术是否实际发送给客户？',
        reviewed: 36,
        verifiable: 27,
        unverifiable: 9,
        denominatorLabel: '发送确认率只以 27 个可核验根问题为有效分母；不可核验不计为未发送。',
        evidenceGrade: '合成离线复核 · 与复制操作账分离',
        outcomes: [
          { id: 'confirmed-sent', label: '确认已发送', count: 18, definition: '仅表示授权抽样证据确认发生发送，不表示内容正确或客户采纳。', tone: 'positive' },
          { id: 'confirmed-not-sent', label: '确认未发送', count: 9, definition: '授权抽样证据确认未发生发送，与是否复制分开记录。', tone: 'neutral' },
          { id: 'unverifiable', label: '不可核验', count: 9, definition: '没有足够证据确认发送状态，禁止用复制成功代填。', tone: 'unknown' },
        ],
      },
      {
        id: 'applicable',
        label: '是否适用',
        question: '所选话术的平台、商品、活动窗口、版本与风险边界是否适用于该问题？',
        reviewed: 36,
        verifiable: 28,
        unverifiable: 8,
        denominatorLabel: '适用率只以 28 个已完成业务复核的根问题为有效分母；它不是自动“正确率”。',
        evidenceGrade: '合成业务复核 · 不由检索排名或复制推断',
        outcomes: [
          { id: 'applicable', label: '确认适用', count: 26, definition: '授权业务复核确认平台、范围、版本、有效期与风险均适用。', tone: 'positive' },
          { id: 'not-applicable', label: '确认不适用', count: 2, definition: '至少一个适用条件不成立，需要进入话术或检索优化。', tone: 'warning' },
          { id: 'unverifiable', label: '不可核验', count: 8, definition: '证据不足，不能从 Top1、复制或发送状态推断适用性。', tone: 'unknown' },
        ],
      },
    ] satisfies OfflineReviewDimension[],
    strata: [
      { id: 'high-risk', label: '高风险问题', rule: '全审', planned: 8, reviewed: 8 },
      { id: 'exception', label: '无命中 / 放弃 / 升级 / 重选', rule: '全审', planned: 12, reviewed: 12 },
      { id: 'copied', label: '成功复制', rule: '合成分层抽样', planned: 28, reviewed: 16 },
    ],
    methodNotes: [
      '分层键应为坐席层 × 业务场景 × 自动事实结果；本 Demo 只展示合成分层，不做个人排名。',
      '三项结论分别报告样本量、有效分母、不可核验与证据等级，不共用一个“采纳率”。',
      '真实复核只能在获批 G1b / Pilot 协议与受控 EVD 中执行；Dashboard 不采最终发送正文。',
    ],
  },
  wording: {
    title: '话术库',
    kicker: '资产浏览与正式来源就绪度 · Dashboard 一期零写正文',
    disclaimer:
      '以下正文均为虚构合成结构样例，不是真实品牌或正式话术源。产品 / 活动只展示正式来源规模与治理状态，不导入真实正文；售前 / 售后正式源尚未创建。',
    domains: [
      {
        id: 'product',
        label: '产品话术',
        readiness: 'structure_confirmed',
        readinessLabel: '正式源结构已确认 · Demo 未导入',
        sourceSummary: '正式源结构已确认；Demo 仅展示 2 条合成结构样例，四域整体签发仍未完成。',
      },
      {
        id: 'campaign',
        label: '活动话术',
        readiness: 'structure_confirmed',
        readinessLabel: '正式源结构已确认 · Demo 未导入',
        sourceSummary: '正式源结构已确认；Demo 仅展示 1 条合成结构样例，活动有效期必须硬过滤。',
      },
      {
        id: 'presale',
        label: '售前流程',
        readiness: 'upstream_authoring',
        readinessLabel: 'NOT_CREATED · UPSTREAM_AUTHORING',
        sourceSummary: '上游文档尚未创建，不存在 canonical / current。',
      },
      {
        id: 'aftersale',
        label: '售后流程',
        readiness: 'upstream_authoring',
        readinessLabel: 'NOT_CREATED · UPSTREAM_AUTHORING',
        sourceSummary: '上游文档尚未创建，不存在 canonical / current。',
      },
    ] as const,
    entries: [
      {
        scriptId: 'syn-prod-library-001',
        domain: 'product',
        title: '洁面产品使用方法 · 合成结构样例',
        scene: '产品用法 / 预期管理',
        answerPreview: '先确认产品版本，再说明用量、使用步骤和不可承诺边界；本条不对应任何真实商品。',
        platform: '千牛 / 抖音（演示）',
        version: 'demo-v3.1',
        effectiveWindow: '2026-01-01 → 2099-12-31（合成）',
        risk: 'low',
        lifecycle: 'demo_effective',
        lifecycleLabel: '合成有效',
        ownerRole: 'ROLE-CONTENT-LEAD（结构演示）',
        dataClass: 'synthetic',
      },
      {
        scriptId: 'syn-prod-library-002',
        domain: 'product',
        title: '产品搭配与风险升级 · 合成结构样例',
        scene: '搭配咨询 / 合规边界',
        answerPreview: '只回答库内已批准原文；持续不适时停止使用并升级人工，不生成医学判断。',
        platform: '千牛（演示）',
        version: 'demo-v3.2',
        effectiveWindow: '2026-01-01 → 2099-12-31（合成）',
        risk: 'high',
        lifecycle: 'demo_effective',
        lifecycleLabel: '合成有效',
        ownerRole: 'ROLE-CS-MANAGER + ROLE-CONTENT-LEAD',
        dataClass: 'synthetic',
      },
      {
        scriptId: 'syn-campaign-library-001',
        domain: 'campaign',
        title: '满赠规则与库存边界 · 合成结构样例',
        scene: '活动规则 / 有效期',
        answerPreview: '展示门槛、限制与结算条件；不核验订单、不承诺库存，过期后停止推荐。',
        platform: '抖音（演示）',
        version: 'demo-c3.1',
        effectiveWindow: '2026-08-01 → 2026-08-31（合成）',
        risk: 'medium',
        lifecycle: 'demo_expiring',
        lifecycleLabel: '合成临期',
        ownerRole: 'ROLE-CONTENT-LEAD（结构演示）',
        dataClass: 'synthetic',
      },
      {
        scriptId: 'syn-presale-structure-001',
        domain: 'presale',
        title: '售前适用性判断 · 结构样例',
        scene: '适用性 / 预期管理',
        answerPreview: '仅示意未来字段：问题识别、边界提醒、人工升级；正式正文由上游编写。',
        platform: '结构样例',
        version: 'structure-only',
        effectiveWindow: '未发布',
        risk: 'high',
        lifecycle: 'structure_sample',
        lifecycleLabel: '结构样例 · 未发布',
        ownerRole: '待上游指定',
        dataClass: 'synthetic',
      },
      {
        scriptId: 'syn-aftersale-structure-001',
        domain: 'aftersale',
        title: '异物 / 少液证据采集与升级 · 结构样例',
        scene: '售后质量升级',
        answerPreview: '仅示意未来流程：记录必要证据、禁止原因承诺、转品质人工复核。',
        platform: '结构样例',
        version: 'structure-only',
        effectiveWindow: '未发布',
        risk: 'high',
        lifecycle: 'structure_sample',
        lifecycleLabel: '结构样例 · 未发布',
        ownerRole: '待上游指定',
        dataClass: 'synthetic',
      },
    ] satisfies WordingEntry[],
  },
  workorders: {
    title: 'VOC / 工单洞察',
    kicker: '基于用户提供工作簿结构设计的去标识合成镜像',
    story:
      '源工作簿包含面膜、棉片、精华液等分表与隐藏表。Demo 只保留聚合维度，不打包客户原文、订单号、评论或明细；竞品数据与自有产品严格分域。',
    noWriteback: '明确不写回班牛。导出仅演示脱敏字段清单。',
    noUpload: '本页没有可用的上传控件。',
    stages: [
      { id: 'precheck', label: '预检' },
      { id: 'map', label: '映射' },
      { id: 'aggregate', label: '聚合' },
      { id: 'drill', label: '下钻' },
      { id: 'redacted_export', label: '脱敏导出' },
    ],
    batch: {
      batchId: 'voc-structure-demo-082',
      title: 'VOC 结构镜像 · 合成聚合',
      currentStage: 'aggregate',
      ticketCount: 2400,
      uniqueOrders: 2325,
      rejectedFields: ['mobile', 'order_id_raw', 'receiver_address', 'id_number'],
      distribution: [
        { label: '棉片内部叠放混乱', count: 1450, pct: 60.4 },
        { label: '纤维类问题', count: 290, pct: 12.1 },
        { label: '精华料体含量不足', count: 203, pct: 8.5 },
        { label: '黑点类问题', count: 107, pct: 4.5 },
        { label: '精华液稀薄', count: 42, pct: 1.8 },
        { label: '头发丝 / 异物', count: 41, pct: 1.7 },
        { label: '其他已归类', count: 267, pct: 11.1 },
      ],
    } satisfies WorkorderBatch,
    productFilters: ['全部产品线', '面膜', '棉片', '精华水 / 液'],
    timeSlices: [
      {
        id: 'year-2026',
        grain: 'year',
        label: '2026 年（截至 08/13）',
        rangeLabel: '2026-01-01–2026-08-13',
        ticketCount: 2400,
        uniqueOrders: 2325,
        issueCounts: [
          { insightId: 'stacking', productBreakdown: [{ product: '棉片', count: 1450 }] },
          { insightId: 'fiber', productBreakdown: [{ product: '面膜', count: 120 }, { product: '棉片', count: 170 }] },
          { insightId: 'essence-shortage', productBreakdown: [{ product: '面膜', count: 120 }, { product: '棉片', count: 83 }] },
          { insightId: 'foreign-matter', productBreakdown: [{ product: '面膜', count: 93 }, { product: '棉片', count: 55 }] },
          { insightId: 'thin-essence', productBreakdown: [{ product: '精华水 / 液', count: 42 }] },
          { insightId: 'other-classified', productBreakdown: [{ product: '面膜', count: 90 }, { product: '棉片', count: 95 }, { product: '精华水 / 液', count: 82 }] },
        ],
      },
      {
        id: 'year-2025',
        grain: 'year',
        label: '2025 年',
        rangeLabel: '2025-01-01–2025-12-31',
        ticketCount: 1870,
        uniqueOrders: 1812,
        issueCounts: [
          { insightId: 'stacking', productBreakdown: [{ product: '棉片', count: 1070 }] },
          { insightId: 'fiber', productBreakdown: [{ product: '面膜', count: 105 }, { product: '棉片', count: 150 }] },
          { insightId: 'essence-shortage', productBreakdown: [{ product: '面膜', count: 103 }, { product: '棉片', count: 72 }] },
          { insightId: 'foreign-matter', productBreakdown: [{ product: '面膜', count: 78 }, { product: '棉片', count: 48 }] },
          { insightId: 'thin-essence', productBreakdown: [{ product: '精华水 / 液', count: 39 }] },
          { insightId: 'other-classified', productBreakdown: [{ product: '面膜', count: 70 }, { product: '棉片', count: 70 }, { product: '精华水 / 液', count: 65 }] },
        ],
      },
      {
        id: 'month-2026-08',
        grain: 'month',
        label: '2026 年 8 月（截至 13 日）',
        rangeLabel: '2026-08-01–2026-08-13',
        ticketCount: 820,
        uniqueOrders: 795,
        issueCounts: [
          { insightId: 'stacking', productBreakdown: [{ product: '棉片', count: 480 }] },
          { insightId: 'fiber', productBreakdown: [{ product: '面膜', count: 43 }, { product: '棉片', count: 62 }] },
          { insightId: 'essence-shortage', productBreakdown: [{ product: '面膜', count: 44 }, { product: '棉片', count: 30 }] },
          { insightId: 'foreign-matter', productBreakdown: [{ product: '面膜', count: 39 }, { product: '棉片', count: 22 }] },
          { insightId: 'thin-essence', productBreakdown: [{ product: '精华水 / 液', count: 17 }] },
          { insightId: 'other-classified', productBreakdown: [{ product: '面膜', count: 27 }, { product: '棉片', count: 30 }, { product: '精华水 / 液', count: 26 }] },
        ],
      },
      {
        id: 'month-2026-07',
        grain: 'month',
        label: '2026 年 7 月',
        rangeLabel: '2026-07-01–2026-07-31',
        ticketCount: 760,
        uniqueOrders: 738,
        issueCounts: [
          { insightId: 'stacking', productBreakdown: [{ product: '棉片', count: 466 }] },
          { insightId: 'fiber', productBreakdown: [{ product: '面膜', count: 39 }, { product: '棉片', count: 53 }] },
          { insightId: 'essence-shortage', productBreakdown: [{ product: '面膜', count: 38 }, { product: '棉片', count: 25 }] },
          { insightId: 'foreign-matter', productBreakdown: [{ product: '面膜', count: 27 }, { product: '棉片', count: 18 }] },
          { insightId: 'thin-essence', productBreakdown: [{ product: '精华水 / 液', count: 13 }] },
          { insightId: 'other-classified', productBreakdown: [{ product: '面膜', count: 26 }, { product: '棉片', count: 29 }, { product: '精华水 / 液', count: 26 }] },
        ],
      },
      {
        id: 'day-2026-08-13',
        grain: 'day',
        label: '2026 年 8 月 13 日',
        rangeLabel: '2026-08-13',
        ticketCount: 122,
        uniqueOrders: 119,
        issueCounts: [
          { insightId: 'stacking', productBreakdown: [{ product: '棉片', count: 68 }] },
          { insightId: 'fiber', productBreakdown: [{ product: '面膜', count: 7 }, { product: '棉片', count: 10 }] },
          { insightId: 'essence-shortage', productBreakdown: [{ product: '面膜', count: 7 }, { product: '棉片', count: 5 }] },
          { insightId: 'foreign-matter', productBreakdown: [{ product: '面膜', count: 6 }, { product: '棉片', count: 4 }] },
          { insightId: 'thin-essence', productBreakdown: [{ product: '精华水 / 液', count: 3 }] },
          { insightId: 'other-classified', productBreakdown: [{ product: '面膜', count: 4 }, { product: '棉片', count: 4 }, { product: '精华水 / 液', count: 4 }] },
        ],
      },
      {
        id: 'day-2026-08-12',
        grain: 'day',
        label: '2026 年 8 月 12 日',
        rangeLabel: '2026-08-12',
        ticketCount: 108,
        uniqueOrders: 105,
        issueCounts: [
          { insightId: 'stacking', productBreakdown: [{ product: '棉片', count: 64 }] },
          { insightId: 'fiber', productBreakdown: [{ product: '面膜', count: 5 }, { product: '棉片', count: 8 }] },
          { insightId: 'essence-shortage', productBreakdown: [{ product: '面膜', count: 6 }, { product: '棉片', count: 4 }] },
          { insightId: 'foreign-matter', productBreakdown: [{ product: '面膜', count: 4 }, { product: '棉片', count: 3 }] },
          { insightId: 'thin-essence', productBreakdown: [{ product: '精华水 / 液', count: 2 }] },
          { insightId: 'other-classified', productBreakdown: [{ product: '面膜', count: 4 }, { product: '棉片', count: 4 }, { product: '精华水 / 液', count: 4 }] },
        ],
      },
    ] satisfies VocTimeSlice[],
    insights: [
      {
        id: 'stacking',
        label: '棉片内部叠放混乱',
        count: 1450,
        pct: 60.4,
        severity: 'warn',
        productScope: ['棉片'],
        productBreakdown: [{ product: '棉片', count: 1450 }],
        wordingGap: '需要把取用方法、外观预期与疑似异常分开回答。',
        owner: '产品 Owner + 话术 Owner',
        nextStep: '先归一产品版本，再补“正常形态 / 处理建议 / 升级条件”三段式话术。',
      },
      {
        id: 'fiber',
        label: '纤维类问题',
        count: 290,
        pct: 12.1,
        severity: 'watch',
        productScope: ['面膜', '棉片'],
        productBreakdown: [
          { product: '面膜', count: 120 },
          { product: '棉片', count: 170 },
        ],
        wordingGap: '源分类存在“纤维状 / B5 纤维丝”近义拆分，不能直接当两类问题。',
        owner: '数据 Owner + 品质 Owner',
        nextStep: '先合并 issue_cluster，再由人工给出可承诺边界。',
      },
      {
        id: 'essence-shortage',
        label: '精华料体含量不足',
        count: 203,
        pct: 8.5,
        severity: 'warn',
        productScope: ['面膜', '棉片'],
        productBreakdown: [
          { product: '面膜', count: 120 },
          { product: '棉片', count: 83 },
        ],
        wordingGap: '“精华含量缺少 / 料体含量缺少”需统一口径并绑定批次核验流程。',
        owner: '品质 Owner + 售后流程 Owner',
        nextStep: '补证据采集清单；客服不得直接判定少液原因。',
      },
      {
        id: 'foreign-matter',
        label: '黑点 / 头发丝等异物风险',
        count: 148,
        pct: 6.2,
        severity: 'risk',
        productScope: ['面膜', '棉片'],
        productBreakdown: [
          { product: '面膜', count: 93 },
          { product: '棉片', count: 55 },
        ],
        wordingGap: '风险项不能由模型生成结论，也不能自动发送。',
        owner: '质量 Owner + 客服经理',
        nextStep: '进入人工升级，收集受控证据并关联售后流程；禁止原因承诺。',
      },
      {
        id: 'thin-essence',
        label: '精华液稀薄',
        count: 42,
        pct: 1.8,
        severity: 'watch',
        productScope: ['精华水 / 液'],
        productBreakdown: [{ product: '精华水 / 液', count: 42 }],
        wordingGap: '需区分质地预期、版本差异与异常升级，不能只用一个“正常”结论覆盖。',
        owner: '产品 Owner + 品质 Owner',
        nextStep: '先确认版本与批次口径，再补“正常预期 / 异常信号 / 人工升级”结构。',
      },
      {
        id: 'other-classified',
        label: '其他已归类',
        count: 267,
        pct: 11.1,
        severity: 'watch',
        productScope: ['面膜', '棉片', '精华水 / 液'],
        productBreakdown: [
          { product: '面膜', count: 90 },
          { product: '棉片', count: 95 },
          { product: '精华水 / 液', count: 82 },
        ],
        wordingGap: '长尾问题已经归类，但尚不足以直接判断应补话术还是改产品。',
        owner: '数据 Owner + 客服经理',
        nextStep: '按二级问题簇继续拆分，达到阈值后再进入对应 Owner 队列。',
      },
    ] satisfies VocInsight[],
  },
  iteration: {
    title: '话术优化待办',
    kicker: 'iteration_task · 与工单分析分域',
    domainNote:
      '工单分析看业务咨询分布；本页只收录话术库迭代任务。不自动改写 Answer，不回写 fixture。',
    tasks: [
      {
        taskId: 'it-2041',
        kind: 'no_hit',
        kindLabel: '无命中',
        status: 'open',
        statusLabel: 'open',
        cause: 'content_gap',
        causeLabel: '内容缺口',
        priority: 'P0',
        owner: '售后流程 Owner',
        evidenceCount: 18,
        title: '会员积分过期补发缺少有效稿',
        detail: '根问题 rq-points-expire 连续无命中。需内容同学补「过期积分不补发」的售后边界稿。',
        nextStep: '确认规则唯一主源与有效期后，由内容 Owner 起草并进入受控复核。',
      },
      {
        taskId: 'it-2048',
        kind: 'top1_skipped',
        kindLabel: 'Top1 跳过',
        status: 'in_progress',
        statusLabel: 'in_progress',
        cause: 'ranking',
        causeLabel: '排序问题',
        priority: 'P1',
        owner: 'Search Owner + Coach',
        evidenceCount: 12,
        title: '洁面泡沫少的首条场景过宽',
        detail: '坐席两次选了 rank 2 温和提醒稿。首条偏说明书，待拆「疑似假货」与「用量」两条。',
        nextStep: '复核查询表达与候选绑定，先调召回/排序，不改写已发布 Answer。',
      },
      {
        taskId: 'it-2055',
        kind: 'risk_escalated',
        kindLabel: '风险升级',
        status: 'open',
        statusLabel: 'open',
        cause: 'policy',
        causeLabel: '策略边界',
        priority: 'P0',
        owner: '客服经理 + 法务口径 Owner',
        evidenceCount: 7,
        title: '退货检测承诺越权',
        detail: '售后稿触及检测报告是否必须，策略要求升级。待法务口径确认后再入库。',
        nextStep: '保持人工升级，确认承诺边界后再决定是否新增正式话术。',
      },
      {
        taskId: 'it-2017',
        kind: 'no_hit',
        kindLabel: '无命中',
        status: 'resolved',
        statusLabel: 'resolved',
        cause: 'content_gap',
        causeLabel: '内容缺口',
        priority: 'P2',
        owner: '产品话术 Owner',
        evidenceCount: 9,
        title: '月白防晒补涂话术已补',
        detail: '上一发布已纳入 syn-prod-003。本条只作历史闭环示例。',
        nextStep: '保留合成闭环记录，不自动学习，不影响正式内容。',
      },
      {
        taskId: 'it-1992',
        kind: 'top1_skipped',
        kindLabel: 'Top1 跳过',
        status: 'wont_fix',
        statusLabel: 'wont_fix',
        cause: 'ranking',
        causeLabel: '排序问题',
        priority: 'P2',
        owner: 'Search Owner',
        evidenceCount: 3,
        title: '直播口语过短不单独立项',
        detail: '样本过少且与现有简洁稿重复。记录为 wont_fix，不改写现网稿。',
        nextStep: '维持观察，证据量达到合成阈值后重新评估。',
      },
    ] satisfies IterationTask[],
  },
  content: {
    title: '内容与发布',
    kicker: 'Import → Validate → Staged → Publish → Announce → ACK/Lease',
    pipeline: ['Import', 'Validate', 'Staged', 'Publish', 'Announce', 'ACK/Lease'],
    publishDisabledReason: '演示禁用 · 正式需 owner + G0/Ddev',
    domains: [
      { id: 'presale', label: '售前' },
      { id: 'campaign', label: '活动' },
      { id: 'aftersale', label: '售后' },
      { id: 'product', label: '产品' },
    ],
    releases: [
      {
        releaseId: 'rel-demo-2026-08-a',
        title: '合成发布结构演练 · 四域样例齐全（非正式现状）',
        bindings: [
          { domain: 'presale', label: '售前', sourceId: 'structure-pre-demo', bound: true },
          { domain: 'campaign', label: '活动', sourceId: 'src-camp-demo-08', bound: true },
          { domain: 'aftersale', label: '售后', sourceId: 'structure-after-demo', bound: true },
          { domain: 'product', label: '产品', sourceId: 'src-prod-demo-08', bound: true },
        ],
        review: '已复核',
        quality: '抽样通过',
        validity: '2026-08-01 → 2026-09-30',
        risk: '含 1 条 medium',
        blocked: false,
      },
      {
        releaseId: 'rel-demo-2026-08-blocked',
        title: '合成发布 B · 缺产品域',
        bindings: [
          { domain: 'presale', label: '售前', sourceId: 'src-pre-demo-08b', bound: true },
          { domain: 'campaign', label: '活动', sourceId: 'src-camp-demo-08b', bound: true },
          { domain: 'aftersale', label: '售后', sourceId: 'src-after-demo-08b', bound: true },
          { domain: 'product', label: '产品', sourceId: '—', bound: false },
        ],
        review: '未进入审核',
        quality: '未评估',
        validity: '未生效',
        risk: '未知',
        blocked: true,
        blockReason: '缺域即阻断：产品域来源未绑定，发布不可继续。',
      },
    ] satisfies ContentRelease[],
  },
  announce: {
    title: '公告与同步',
    kicker: 'published / announced / client ACK / offline lease 必须分面',
    story:
      '正式链路里“库里有稿”“已经公告”“客户端确认”“离线租约有效”是四件事。本 Demo 禁止把它们合成一个「已同步」。',
    simulation: {
      delayMs: 480,
      disclaimer: '仅在当前页面演练 loading / success / error，不联网、不发送、不保存，也不改变下方四分面。',
      loadingMessage: '正在本地生成合成推送回执；未连接任何公告服务。',
      successMessage: '本地演练完成（未发送）：已生成合成回执预览，四分面状态未改变。',
      errorMessage: '本地演练失败并已安全停止；没有联网、发送或保存，可调整演练结果后重试。',
      unpublishedMessage: '该对象尚未发布，本地演练按发布门禁禁用。',
    },
    facets: [
      { id: 'published', label: 'published', meaning: '发布记录已写入内容库' },
      { id: 'announced', label: 'announced', meaning: '公告通道已发出' },
      { id: 'client_ack', label: 'client ACK', meaning: '客户端确认收到该版本' },
      { id: 'offline_lease', label: 'offline lease', meaning: '离线租约仍在有效窗口' },
    ],
    rows: [
      {
        itemId: 'ann-rel-a',
        title: 'rel-demo-2026-08-a',
        published: true,
        announced: true,
        clientAck: true,
        offlineLease: true,
      },
      {
        itemId: 'ann-rel-a-nightly',
        title: '夜间增量公告（合成）',
        published: true,
        announced: true,
        clientAck: false,
        offlineLease: true,
      },
      {
        itemId: 'ann-rel-blocked',
        title: 'rel-demo-2026-08-blocked',
        published: false,
        announced: false,
        clientAck: false,
        offlineLease: false,
      },
      {
        itemId: 'ann-lease-expired',
        title: '旧租约示例（合成）',
        published: true,
        announced: true,
        clientAck: true,
        offlineLease: false,
      },
    ] satisfies AnnounceRow[],
  },
  architecture: {
    title: '架构能力图',
    kicker: '双表面 + 九端口 · 设计 / 原型 / 正式三轴分账',
    implementationDesign: {
      title: '一期实现设计映射',
      detail: '把一期开发框架图的两条闭环映射到产品表面；设计已映射、原型可见与正式运行必须分开取证。',
      flows: [
        {
          id: 'float',
          title: 'Float agent · 话术推荐闭环',
          detail: 'A1–A6 · 问法进入、候选展示、复制与人工确认。',
          steps: [
            {
              code: 'A1',
              title: '问法输入',
              detail: '粘贴或热键进入 Query；Demo 只接本地合成输入。',
              ...architectureEvidence('runtime-interactive'),
            },
            {
              code: 'A2',
              title: 'Top 3 原文候选',
              detail: '返回合成 fixture 原文；不映射正式已发布内容源。',
              ...architectureEvidence('runtime-interactive'),
            },
            {
              code: 'A3',
              title: '复制剪贴板',
              detail: '主 CTA 写入系统剪贴板，只反馈“已复制”。',
              ...architectureEvidence('runtime-interactive'),
            },
            {
              code: 'A4',
              title: '占位符二次确认',
              detail: '仅允许内存填值并二次确认；当前 Demo 未实现。',
              ...architectureEvidence('absent'),
            },
            {
              code: 'A5',
              title: '澄清 / 拒答 / 升级',
              detail: '由策略与人工承接；当前只展示风险与升级边界。',
              ...architectureEvidence('visual-only'),
            },
            {
              code: 'A6',
              title: '平台人工确认',
              detail: '平台适用性必须人工确认，系统不替坐席发送。',
              ...architectureEvidence('absent'),
            },
          ],
        },
        {
          id: 'dashboard',
          title: 'Dashboard · coach / owner 闭环',
          detail: 'B1–B7 · 经营判断、双账复核、治理和同步演练。',
          steps: [
            {
              code: 'B1',
              title: '概览与工具指标',
              detail: '固定合成快照展示风险、Owner、下一步和处理窗口。',
              ...architectureEvidence('static-interactive'),
            },
            {
              code: 'B2',
              title: '检索复制双账',
              detail: '根问题账与检索操作账分开，复制不推断发送。',
              ...architectureEvidence('static-interactive'),
            },
            {
              code: 'B3',
              title: '离线三维抽样复核',
              detail: '修改、发送、适用性分别统计有效分母与不可核验。',
              ...architectureEvidence('static-interactive'),
            },
            {
              code: 'B4',
              title: '工单分析',
              detail: '只读展示去标识合成聚合、下钻与脱敏导出的交互形状；未读取批准文件。',
              ...architectureEvidence('visual-only'),
            },
            {
              code: 'B5',
              title: '话术优化待办',
              detail: '按内容缺口、排序和策略分域跟进，不自动改写 Answer。',
              ...architectureEvidence('static-interactive'),
            },
            {
              code: 'B6',
              title: '内容导入 / 发布 / 回滚',
              detail: '展示四域治理流水线；正式 Publish 保持禁用。',
              ...architectureEvidence('visual-only'),
            },
            {
              code: 'B7',
              title: '公告与离线租约',
              detail: '本地演练四个同步分面，不联网、不发送、不保存。',
              ...architectureEvidence('visual-only'),
            },
          ],
        },
      ] satisfies ArchitectureFlow[],
      guardrails: [
        {
          id: 'human-in-loop',
          title: '人在环',
          detail: '系统只给候选；坐席自己选择、人工粘贴发送。',
        },
        {
          id: 'no-auto-send',
          title: '禁代发',
          detail: '复制或演练回执不能推断已发送、已采纳、回答正确或问题已解决。',
        },
        {
          id: 'no-new-port',
          title: '不新增第十端口',
          detail: 'Demo 不直连正式九端口，也不建立平行搜索平台。',
        },
        {
          id: 'synthetic-only',
          title: '合成数据边界',
          detail: '编译期静态 manifest；不读聊天正文、不写盘、不接真实 API。',
        },
      ] satisfies ArchitectureGuardrail[],
    },
    surfaces: [
      {
        id: 'float',
        title: 'Float',
        detail: '狐狸头 → 搜索 → Top3 → 人工选择 → 安全复制',
        ...architectureEvidence('runtime-interactive'),
      },
      {
        id: 'dashboard',
        title: 'Dashboard',
        detail: '静态合成工作台，浏览架构故事，不接 SoR',
        ...architectureEvidence('static-interactive'),
      },
      {
        id: 'preload',
        title: 'Preload',
        detail: '白名单 IPC：复制 / 窗口 / dashboard:open',
        ...architectureEvidence('runtime-interactive'),
      },
    ] satisfies ArchitectureNode[],
    ports: [
      {
        id: 'auth',
        title: 'auth',
        detail: '正式身份与会话',
        ...architectureEvidence('absent'),
      },
      {
        id: 'search',
        title: 'search',
        detail: '正式检索与 Top3 合同',
        ...architectureEvidence('absent'),
        redline: true,
      },
      {
        id: 'events',
        title: 'events',
        detail: '检索/复制自动事实流水',
        ...architectureEvidence('absent'),
        redline: true,
      },
      {
        id: 'metrics',
        title: 'metrics',
        detail: '双账指标与复核',
        ...architectureEvidence('absent'),
      },
      {
        id: 'workorders',
        title: 'workorders',
        detail: '工单导入与分析',
        ...architectureEvidence('absent'),
        redline: true,
      },
      {
        id: 'content',
        title: 'content',
        detail: '四域绑定与发布',
        ...architectureEvidence('absent'),
        redline: true,
      },
      {
        id: 'announce',
        title: 'announce',
        detail: '公告与客户端确认',
        ...architectureEvidence('absent'),
      },
      {
        id: 'policy',
        title: 'policy',
        detail: '风险与升级策略',
        ...architectureEvidence('absent'),
      },
      {
        id: 'redaction',
        title: 'redaction',
        detail: '脱敏与导出裁剪',
        ...architectureEvidence('absent'),
      },
    ] satisfies ArchitectureNode[],
    dataPlane: [
      {
        id: 'postgres',
        title: 'PostgreSQL SoR',
        detail: '正式系统的记录系统',
        ...architectureEvidence('absent'),
      },
      {
        id: 'object-store',
        title: '共享导入存储',
        detail: '工单与内容包对象',
        ...architectureEvidence('absent'),
      },
      {
        id: 'outbox-worker',
        title: 'outbox + Import Worker',
        detail: 'TypeScript 异步导入',
        ...architectureEvidence('absent'),
      },
    ] satisfies ArchitectureNode[],
    llm: {
      id: 'llm',
      title: '可选 LLM',
      detail: '只能可选重排且默认关闭，绝不改写 Answer。',
      ...architectureEvidence('absent'),
    } satisfies ArchitectureNode,
  },
});

export function nextDashboardNavId(
  active: DashboardModuleId,
  delta: number,
): DashboardModuleId {
  const index = DASHBOARD_NAV.findIndex((item) => item.id === active);
  return DASHBOARD_NAV[(index + delta + DASHBOARD_NAV.length) % DASHBOARD_NAV.length].id;
}

export function findLedgerRow(operationId: string): LedgerRow | undefined {
  return DASHBOARD_MANIFEST.ledger.rows.find((row) => row.operationId === operationId);
}
