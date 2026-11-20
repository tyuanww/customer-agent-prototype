import { randomUUID } from 'node:crypto';
import { SOP_CANDIDATE_CONTRACT_SET_ID, parseContractSchema, type SopCandidateDiscoverRequest, type SopCandidateSelectRequest } from '@customer-agent/contracts/sop-candidates';
import { parseContractSchema as parseSopSchema } from '@customer-agent/contracts/sop-resource-disable';
import { intakeQueryFailure, type IntakeQueryResult, type IntakeSopCandidatesEvent } from '../shared/content-intake-query';
import type { IntakeQualification, IntakeUsageSession } from './content-intake-usage';
import { ProductHttpError } from './product-http';
import type { SopCandidateOpening } from './sop-unified-runtime';

type OpenResult = IntakeQueryResult<{ opened: true }>;
type SopQualification = IntakeQualification & { menuDeadline: number; menuValidUntil: number };
type Candidate = {
  ref: string;
  requestId: string;
  opening?: Promise<OpenResult>;
};
type SearchRound = {
  contextId: string;
  epoch: number;
  controller: AbortController;
  candidates: Map<string, Candidate>;
  lease?: { qualification: IntakeQualification; queryId: string; live(): boolean };
  expiry?: ReturnType<typeof setTimeout>;
};
export type OpenSopCandidate = (candidate: SopCandidateOpening) => Promise<boolean>;

export class SopCandidateSearch {
  private current: SearchRound | null = null;
  constructor(private readonly session: IntakeUsageSession,
    private readonly qualify: (signal: AbortSignal) => Promise<SopQualification>,
    private readonly publish: (event: IntakeSopCandidatesEvent) => void,
    private readonly openCommittedCandidate: OpenSopCandidate) {}

  cancel(status?: 'stale') {
    const current = this.current;
    this.current = null;
    if (!current) return;
    current.controller.abort();
    clearTimeout(current.expiry);
    this.publish(status ? { contextId: current.contextId, status } : { contextId: current.contextId, candidates: [] });
  }

  async discover(queryText: string, contextId: string) {
    this.cancel();
    const round: SearchRound = { contextId, epoch: this.session.view().sessionEpoch, controller: new AbortController(), candidates: new Map() };
    this.current = round;
    this.publish({ contextId, status: 'searching' });
    const { signal } = round.controller;
    try {
      const qualification = await this.qualify(signal);
      if (this.current !== round) return;
      if (!qualification.isCurrent()) { this.expire(round); return; }
      const request: SopCandidateDiscoverRequest = {
        request_id: randomUUID(), query_text: queryText, context_generation: randomUUID(),
        entitlement_id: qualification.entitlement.entitlementId,
      };
      const response = await this.session.request(round.epoch, '/v1/sop/candidate-queries', {
        body: parseContractSchema('W5SopCandidateDiscoverRequest', request), signal,
        headers: { 'x-intake-contract-set': SOP_CANDIDATE_CONTRACT_SET_ID },
      });
      if (this.current !== round) return;
      const result = parseContractSchema('W5SopCandidateDiscoverResponse', response.value);
      if (result.request_id !== request.request_id) throw new Error('SOP_CANDIDATE_RESPONSE_BINDING');
      if (!qualification.isCurrent() || result.status === 'stale') {
        this.expire(round);
        return;
      }
      if (result.status !== 'candidates') {
        this.publish(result.status === 'unavailable' ? { contextId, status: 'unavailable' } : { contextId, candidates: [] });
        return;
      }
      if (result.release_id !== qualification.entitlement.releaseId
        || new Set(result.candidates.map(candidate => candidate.candidate_ref)).size !== result.candidates.length) {
        throw new Error('SOP_CANDIDATE_RESPONSE_BINDING');
      }
      const expires = Math.min(Date.parse(result.expires_at), Date.parse(qualification.entitlement.validUntil), qualification.menuValidUntil);
      const remaining = Math.min(expires - Date.now(), qualification.menuDeadline - performance.now());
      const deadline = performance.now() + remaining;
      if (remaining <= 0) { this.expire(round); return; }
      round.lease = { qualification, queryId: request.request_id,
        live: () => this.current === round && qualification.isCurrent() && Date.now() < expires && performance.now() < deadline };
      const candidates = result.candidates.map(({ label, candidate_ref }) => {
        const key = randomUUID();
        round.candidates.set(key, { ref: candidate_ref, requestId: randomUUID() });
        return { key, label };
      });
      round.expiry = setTimeout(() => this.expire(round), remaining);
      round.expiry.unref?.();
      this.publish({ contextId, candidates });
    } catch {
      if (this.current === round) this.publish({ contextId, status: 'unavailable' });
    }
  }

  select(key: string): Promise<OpenResult> {
    const round = this.current;
    const lease = round?.lease;
    const candidate = round?.candidates.get(key);
    if (!round || !lease || !candidate) return Promise.resolve(intakeQueryFailure('STALE'));
    if (!lease.live()) {
      this.expire(round);
      return Promise.resolve(intakeQueryFailure('STALE'));
    }
    candidate.opening ??= this.selectAndOpen(round, lease, candidate).then(result => {
      if (!result.ok) candidate.opening = undefined;
      return result;
    });
    return candidate.opening;
  }

  private async selectAndOpen(round: SearchRound, lease: NonNullable<SearchRound['lease']>, candidate: Candidate): Promise<OpenResult> {
    const { qualification } = lease;
    const request: SopCandidateSelectRequest = {
      request_id: candidate.requestId, candidate_query_id: lease.queryId, candidate_ref: candidate.ref,
      entitlement_id: qualification.entitlement.entitlementId,
    };
    try {
      const response = await this.session.request(round.epoch, '/v1/sop/candidate-selections', {
        body: parseContractSchema('W5SopCandidateSelectRequest', request), signal: round.controller.signal,
        headers: { 'x-intake-contract-set': SOP_CANDIDATE_CONTRACT_SET_ID },
      });
      if (!lease.live()) {
        this.expire(round);
        return intakeQueryFailure('STALE');
      }
      const ready = parseSopSchema('MenokinSopQuerySopReadyResponse', response.value);
      if (ready.request_id !== request.request_id || ready.release_id !== qualification.entitlement.releaseId) {
        throw new Error('SOP_CANDIDATE_RESPONSE_BINDING');
      }
      const { selection, entitlement } = qualification;
      return await this.openCommittedCandidate({ ready, selection, entitlement, sessionEpoch: round.epoch })
        ? { ok: true, opened: true } : intakeQueryFailure('UNAVAILABLE');
    } catch (error) {
      if (!lease.live() || (error instanceof ProductHttpError
        && (['FORBIDDEN', 'UNAUTHORIZED', 'STALE', 'GONE', 'CONFLICT'].includes(error.code) || error.reason === 'SOP_BLOCKED'))) {
        this.expire(round);
        return intakeQueryFailure('STALE');
      }
      // A missing C receipt is ambiguous. Retry the exact request ID and E.
      return intakeQueryFailure('UNAVAILABLE');
    }
  }

  private expire(round: SearchRound) {
    if (this.current !== round) return;
    this.cancel('stale');
  }
}
