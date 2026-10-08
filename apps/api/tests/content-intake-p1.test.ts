import { describe, expect, it } from 'vitest';
import { authorize, canAssign, revokeDelegation, roleOf, selectShop, BUSINESS_ACTIONS, FACTS_MAX_AGE_MS,
  type Authority, type Grant, type Principal, type Scope } from '../experiments/content-intake-p1/permissions.js';
import { assessRisk, attachEvidence, canCommit, freezeCandidate, issueTicket, materialDigest, mergeEntries, usageDeadline,
  verifyApproval, type CandidateInput, type ReviewBinding, type SourceConfirmation, type PublicationFacts } from '../experiments/content-intake-p1/approval.js';

const now = Date.parse('2026-10-04T03:00:00Z');
const scope: Scope = { tenant: 'synthetic-tenant', app: 'synthetic-app', brand: 'synthetic-brand', shop: 'shop-a', domain: 'product', source: 'source-a' };
const principal = (id: string, job = '服务赋能师'): Principal => ({ id, personKey: `person-${id}`, tenant: scope.tenant, app: scope.app, departments: ['support'], job, enabled: true, checkedAt: now - 1000, version: 1, generation: 0 });
const writer = principal('writer', '客服组长'), peer = principal('peer', '客服组长'), agent = principal('agent', '坐席'), manager = principal('manager', '经理');
const grant = (recipient: string, overrides: Partial<Grant> = {}): Grant => ({ id: `grant-${recipient}`, issuer: 'operations', recipient, action: 'publish', scope, startsAt: now - 10_000, expiresAt: now + 600_000, revoked: false, version: 1, reason: 'synthetic scope', steward: 'manager', ...overrides });
const authority: Authority = {
  rules: [ { department: 'support', job: '服务赋能师', role: 'enabler' }, { department: 'support', job: '话术师', role: 'enabler' },
    { department: 'support', job: '客服组长', role: 'lead' },
    { department: 'support', job: '坐席', role: 'agent' }, { department: 'support', job: '经理', role: 'manager' },
    { department: 'support', job: '主管', role: 'supervisor' }, { department: 'support', job: '总监', role: 'director' } ],
  grants: ['writer', 'peer', 'agent', 'manager'].flatMap((id) => BUSINESS_ACTIONS.map((action) => grant(id, { id: `${id}-${action}`, action }))),
  allocations: BUSINESS_ACTIONS.map((action) => grant('manager', { id: `allocation-${action}`, action })), delegations: [],
};

describe('P1 permissions — proposed rules, no production API grants', () => {
  it('intersects identity, exact department/job ceiling and manually granted store scope', () => {
    expect(authorize(writer, 'publish', scope, authority, now).ok).toBe(true);
    const enabler = principal('enabler');
    const withEnabler = { ...authority, grants: [...authority.grants, ...BUSINESS_ACTIONS.map((action) => grant(enabler.id, { id: `enabler-${action}`, action }))] };
    expect(authorize(enabler, 'publish', scope, withEnabler, now)).toEqual({ ok: false, reason: 'ROLE_CEILING' });
    expect(authorize(enabler, 'import', scope, withEnabler, now)).toEqual({ ok: false, reason: 'ROLE_CEILING' });
    expect(authorize(enabler, 'query', scope, withEnabler, now).ok).toBe(true);
    const supervisor = principal('supervisor', '主管');
    expect(authorize(supervisor, 'publish', scope, { ...authority, grants: [...authority.grants, grant(supervisor.id, { id: 'supervisor-publish' })] }, now).ok).toBe(true);
    expect(authorize(agent, 'publish', scope, authority, now)).toEqual({ ok: false, reason: 'ROLE_CEILING' });
    expect(authorize(agent, 'query', scope, authority, now).ok).toBe(true);
    expect(authorize(writer, 'publish', { ...scope, shop: 'shop-b' }, authority, now).ok).toBe(false);
    expect(authorize(writer, 'publish', { ...scope, shop: null }, authority, now).ok).toBe(false);
    expect(authorize(writer, 'publish', { ...scope, tenant: 'other' }, authority, now).ok).toBe(false);
    expect(authorize(writer, 'publish', scope, { ...authority, grants: [] }, now).ok).toBe(false);
  });
  it('never infers managerial rights from a title substring or missing fields', () => {
    expect(roleOf(principal('p', '助理主管候选'), authority.rules)).toBeNull();
    expect(roleOf({ ...writer, departments: [] }, authority.rules)).toBeNull();
    expect(roleOf(principal('p', '话术师'), authority.rules)).toBe('enabler');
    expect(roleOf(writer, [...authority.rules, { department: 'support', job: writer.job, role: 'director' }])).toBeNull();
  });
  it.each([['disabled', { enabled: false }], ['stale', { checkedAt: now - FACTS_MAX_AGE_MS }], ['future', { checkedAt: now + 1 }]] as const)('fails closed on %s organization facts', (_name, change) => {
    expect(authorize({ ...writer, ...change }, 'publish', scope, authority, now)).toEqual({ ok: false, reason: 'ORG_FACTS_UNAVAILABLE' });
  });
  it('requires selection for multiple stores, rejects zero or an ungranted store', () => {
    expect(selectShop(['a'])).toEqual({ ok: true, shop: 'a' });
    expect(selectShop(['a', 'b'])).toEqual({ ok: false, reason: 'CHOOSE_SHOP' });
    expect(selectShop([])).toEqual({ ok: false, reason: 'NO_SHOP' });
    expect(selectShop(['a', 'b'], 'c').ok).toBe(false);
  });
  it('separates grant qualification from business capabilities and denies redelegation', () => {
    const director = principal('director', '总监');
    const toAgent = { ...grant('agent', { issuer: manager.id, action: 'publish' }), mayRedelegate: false as const };
    const delegated = { ...grant(director.id, { issuer: manager.id, action: 'publish' }), mayRedelegate: false as const };
    expect(canAssign(manager, agent, toAgent, 'delegation', authority, now)).toEqual({ ok: false, reason: 'ROLE_CEILING' });
    expect(canAssign(manager, director, delegated, 'delegation', authority, now).ok).toBe(true);
    const state = { ...authority, delegations: [delegated] };
    expect(authorize(agent, 'publish', scope, state, now).ok).toBe(false);
    expect(canAssign(director, peer, grant(peer.id, { issuer: director.id, action: 'publish' }), 'business', state, now).ok).toBe(true);
    expect(canAssign(agent, peer, grant(peer.id, { issuer: agent.id, action: 'publish' }), 'business', state, now)).toEqual({ ok: false, reason: 'REDELEGATION_DENIED' });
    expect(canAssign(director, agent, grant('agent', { issuer: director.id }), 'delegation', state, now).ok).toBe(false);
    expect(canAssign(manager, agent, grant('agent', { issuer: manager.id }), 'business', authority, now).ok).toBe(false);
    const supervisor = principal('supervisor', '主管');
    const supervisorAuthority = { ...authority, allocations: authority.allocations.map((item) => ({ ...item, recipient: supervisor.id })) };
    expect(canAssign(supervisor, peer, grant(peer.id, { issuer: supervisor.id }), 'business', supervisorAuthority, now)).toEqual({ ok: false, reason: 'REDELEGATION_DENIED' });
  });
  it('denies self elevation (including same-person alias), extra scope and extended lifetime', () => {
    expect(canAssign(manager, manager, grant(manager.id, { issuer: manager.id }), 'business', authority, now).ok).toBe(false);
    expect(canAssign(manager, { ...peer, personKey: manager.personKey }, grant(peer.id, { issuer: manager.id }), 'business', authority, now).ok).toBe(false);
    expect(canAssign(manager, peer, grant(peer.id, { issuer: manager.id, scope: { ...scope, shop: 'shop-b' } }), 'business', authority, now).ok).toBe(false);
    expect(canAssign(manager, peer, grant(peer.id, { issuer: manager.id, expiresAt: now + 600_001 }), 'business', authority, now).ok).toBe(false);
    expect(canAssign(manager, peer, grant(peer.id, { issuer: manager.id, startsAt: now - 10_001 }), 'business', authority, now).ok).toBe(false);
  });
  it('revokes distribution qualification while keeping downstream rights and original issuer', () => {
    const delegated = { ...grant('writer', { issuer: manager.id }), mayRedelegate: false as const };
    const state: Authority = { ...authority, delegations: [delegated], grants: [grant('peer', { issuer: writer.id })] };
    const revoked = revokeDelegation(state, delegated.id, null);
    expect(authorize(peer, 'publish', scope, revoked, now).ok).toBe(true);
    expect(revoked.grants[0]).toMatchObject({ issuer: writer.id, steward: null });
    expect(canAssign(writer, peer, grant(peer.id, { issuer: writer.id }), 'business', revoked, now).ok).toBe(false);
    expect(authorize(peer, 'publish', scope, { ...revoked, grants: [{ ...revoked.grants[0]!, revoked: true }] }, now).ok).toBe(false);
  });
  it('keeps action and store stewardship independent and repeated revocation inert', () => {
    const scopeB = { ...scope, shop: 'shop-b' };
    const allocator = principal('allocator', '经理');
    const delegated = { ...grant(allocator.id, { id: 'delegate-a', issuer: manager.id }), mayRedelegate: false as const };
    const other = { ...delegated, id: 'delegate-b', scope: scopeB };
    const a = grant(peer.id, { id: 'a-publish', issuer: allocator.id });
    const b = grant(peer.id, { id: 'b-publish', issuer: allocator.id, scope: scopeB });
    const query = grant(peer.id, { id: 'a-query', issuer: allocator.id, action: 'query' });
    const state = { ...authority, delegations: [delegated, other], grants: [a, b, query] };
    expect(canAssign(allocator, peer, a, 'business', state, now).ok).toBe(true);
    expect(canAssign(allocator, peer, b, 'business', state, now).ok).toBe(true);
    const revoked = revokeDelegation(state, delegated.id, 'shop-a-manager');
    expect(revoked.grants[0]).toMatchObject({ steward: 'shop-a-manager', version: 2, issuer: allocator.id });
    expect(revoked.grants[1]).toBe(b); expect(revoked.grants[2]).toBe(query);
    expect(revokeDelegation(revoked, delegated.id, null)).toBe(revoked);
    expect(authorize(peer, 'publish', scopeB, revoked, now).ok).toBe(true);
  });
  it('treats null source as explicit all-sources within one fixed shop/domain only', () => {
    const allSources = { ...authority, grants: [grant('writer', { scope: { ...scope, source: null } })] };
    expect(authorize(writer, 'publish', { ...scope, source: 'source-b' }, allSources, now).ok).toBe(true);
    expect(authorize(writer, 'publish', { ...scope, shop: 'shop-b' }, allSources, now).ok).toBe(false);
    expect(authorize(writer, 'publish', { ...scope, domain: 'aftersale' }, allSources, now).ok).toBe(false);
  });
});

const entry = { id: 'faq-1', title: '合成问题', body: '第一行\n第二行', disabled: false, critical: false, version: 1 };
const materials: CandidateInput = {
  entries: [entry], questions: [{ id: 'faq-1:main', text: entry.title, version: 1 }],
  selectedSheets: ['FAQ', '相似问法'], templateVersion: 'faq-p1.1', ruleVersion: 'p1-synthetic-1', mappingProfile: 'fixed-faq-1',
  source: { id: 'source-a', claimedRevision: null, fileSha256: 'a'.repeat(64) }, scope, vocabulary: [], media: [], contributors: [writer.personKey], baseReleaseId: 'release-1',
};
const candidate = freezeCandidate('candidate-1', 1, materials, { publishedEntries: [], recentDisables: [], now });
const confirmation: SourceConfirmation = { candidateId: candidate.id, version: candidate.version, digest: candidate.digest, sourceId: materials.source.id, evidenceVersion: 1, generation: 0, confirmed: true };
const binding: ReviewBinding = { tenant: scope.tenant, app: scope.app, instanceCode: 'instance-1', uuid: 'synthetic-uuid', definitionCode: 'definition-1', nodeId: 'review-node', candidateId: candidate.id, version: 1, digest: candidate.digest, reviewRequestId: 'review-request-1', materialObjectSha256: 'b'.repeat(64), fileCode: 'uploaded-file-1', createdAt: now - 10_000 };
const response = () => ({ code: 0, data: {
  instance_code: binding.instanceCode, uuid: binding.uuid, approval_code: binding.definitionCode, status: 'APPROVED',
  form: JSON.stringify([
    ...Object.entries({ candidateDigest: candidate.digest, reviewRequestId: binding.reviewRequestId, candidateId: candidate.id, candidateVersion: '1' }).map(([id, value]) => ({ id, type: 'input', value })),
    { id: 'materials', type: 'attachmentV2', value: ['https://approval.synthetic.example/material'] },
  ]),
  task_list: [{ id: 'task-1', open_id: 'open-writer', status: 'APPROVED', type: 'AND', node_id: binding.nodeId, end_time: String(now - 500) }],
  timeline: [{ type: 'PASS', task_id: 'task-1', open_id: 'open-writer', create_time: String(now - 500) }],
} });
const facts = () => ({ tenant: scope.tenant, app: scope.app, attachments: [{ instanceCode: binding.instanceCode, reference: 'https://approval.synthetic.example/material', sha256: binding.materialObjectSha256, checkedAt: now }], reviewers: [{ openId: 'open-writer', atReview: writer, current: writer, notContributor: false }], historicalAuthority: authority, currentAuthority: authority, now, evidenceVersion: 1, generation: 0 });

describe('P1 candidate and official-shaped synthetic approval evidence', () => {
  it('allows routine human self review and first evidence advances readiness without changing digest/version', () => {
    const verified = verifyApproval(candidate, binding, response(), facts());
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error(verified.reason);
    expect(attachEvidence(candidate, verified.evidence, null, now).status).toBe('awaiting-evidence');
    expect(attachEvidence(candidate, verified.evidence, confirmation, now)).toMatchObject({ status: 'ready', digest: candidate.digest, version: 1 });
    expect(materialDigest(candidate.materials)).toBe(candidate.digest);
  });
  it.each(['AUTO_PASS', 'AUTO_REJECT', 'UNKNOWN'])('rejects an APPROVED instance with task type %s', (type) => {
    const raw = response(); raw.data.task_list[0]!.type = type;
    expect(verifyApproval(candidate, binding, raw, facts())).toEqual({ ok: false, reason: 'HUMAN_REVIEW_REQUIRED' });
  });
  it.each(['task-type', 'form'])('rejects non-string approval %s without coercion', (field) => {
    const raw = response();
    const malformed = field === 'form' ? { ...raw, data: { ...raw.data, form: [raw.data.form] } }
      : { ...raw, data: { ...raw.data, task_list: raw.data.task_list.map((task) => ({ ...task, type: [task.type] })) } };
    expect(verifyApproval(candidate, binding, malformed, facts()).ok).toBe(false);
  });
  it.each(['REJECTED', 'CANCELED', 'DELETED', 'PENDING'])('rejects instance status %s without changing a candidate', (status) => {
    const raw = response(); raw.data.status = status;
    expect(verifyApproval(candidate, binding, raw, facts()).ok).toBe(false);
    expect(candidate.status).toBe('awaiting-evidence');
  });
  it('binds exact instance, tenant, material form and re-read attachment bytes', () => {
    const raw = response(); raw.data.uuid = 'different';
    expect(verifyApproval(candidate, binding, raw, facts()).ok).toBe(false);
    expect(verifyApproval(candidate, binding, response(), { ...facts(), tenant: 'other' }).ok).toBe(false);
    raw.data.uuid = binding.uuid; raw.data.form = '[]';
    expect(verifyApproval(candidate, binding, raw, facts()).ok).toBe(false);
    expect(verifyApproval(candidate, binding, response(), { ...facts(), attachments: [{ ...facts().attachments[0]!, sha256: 'c'.repeat(64) }] }).ok).toBe(false);
  });
  it('requires matching human task timeline, identity mapping and historical/current authorization', () => {
    const raw = response(); raw.data.timeline[0]!.task_id = 'other-task';
    expect(verifyApproval(candidate, binding, raw, facts()).ok).toBe(false);
    expect(verifyApproval(candidate, binding, response(), { ...facts(), reviewers: [] }).ok).toBe(false);
    expect(verifyApproval(candidate, binding, response(), { ...facts(), reviewers: [...facts().reviewers, ...facts().reviewers] }).ok).toBe(false);
    expect(verifyApproval(candidate, binding, response(), { ...facts(), historicalAuthority: { ...authority, grants: [] } }).ok).toBe(false);
    expect(verifyApproval(candidate, binding, response(), { ...facts(), currentAuthority: { ...authority, grants: [] } }).ok).toBe(false);
  });
  it('critical changes require a qualified non-contributor, even when an alias uploads', () => {
    const criticalEntry = { ...entry, critical: true };
    const critical = freezeCandidate('candidate-1', 2, { ...materials, entries: [criticalEntry] }, { publishedEntries: [], recentDisables: [], now });
    const revisedBinding = { ...binding, version: 2, digest: critical.digest };
    const raw = response(); raw.data.form = raw.data.form.replace(candidate.digest, critical.digest).replace('"value":"1"', '"value":"2"');
    expect(verifyApproval(critical, revisedBinding, raw, facts()).ok).toBe(false);
    const peerFacts = { ...facts(), reviewers: [{ openId: 'open-writer', atReview: peer, current: peer, notContributor: true }] };
    expect(verifyApproval(critical, revisedBinding, raw, peerFacts).ok).toBe(true);
    expect(verifyApproval(critical, revisedBinding, raw, { ...peerFacts, reviewers: [{ ...peerFacts.reviewers[0]!, atReview: { ...peer, personKey: writer.personKey }, current: { ...peer, personKey: writer.personKey } }] }).ok).toBe(false);
  });
  it('freezes material references; any content/base/contributor change breaks the old approval binding', () => {
    const revised = freezeCandidate(candidate.id, 2, { ...materials, contributors: [peer.personKey], baseReleaseId: 'release-2' }, { publishedEntries: [], recentDisables: [], now });
    expect(revised.digest).not.toBe(candidate.digest);
    expect(verifyApproval(revised, binding, response(), facts())).toEqual({ ok: false, reason: 'MATERIAL_CHANGED' });
    expect(Object.isFrozen(candidate.materials.entries[0])).toBe(true);
  });
  it('derives differences and risk from complete snapshots instead of trusting an omitted critical diff', () => {
    const changed = { ...entry, body: '合成赔付说明', version: 2 };
    const next = freezeCandidate('candidate-2', 2, { ...materials, entries: [changed] }, { publishedEntries: [entry], recentDisables: [], now });
    expect(next.materials.risk).toBe('critical');
    expect(next.materials.differences).toEqual([{ id: entry.id, before: entry, after: changed }]);
    expect(() => freezeCandidate('candidate-2', 2, { ...materials, entries: [] }, { publishedEntries: [entry], recentDisables: [], now })).toThrow('INVALID_MATERIAL');
    const formerlyCritical = { ...entry, critical: true };
    expect(freezeCandidate('candidate-2', 2, materials, { publishedEntries: [formerlyCritical], recentDisables: [], now }).materials.risk).toBe('critical');
  });
  it.each(['source-b', null, ''])('rejects a candidate whose authorization scope source is %s instead of its registered source', (source) => {
    expect(() => freezeCandidate('candidate-2', 1, { ...materials, scope: { ...scope, source } },
      { publishedEntries: [], recentDisables: [], now })).toThrow('INVALID_MATERIAL');
  });
  it('never extends reviewer grant, organization facts, or attachment proof deadlines', () => {
    for (const change of ['grant', 'organization', 'attachment'] as const) {
      const reviewer = change === 'organization' ? { ...writer, checkedAt: now - FACTS_MAX_AGE_MS + 10 } : writer;
      const currentAuthority = change === 'grant' ? { ...authority, grants: authority.grants.map((g) =>
        g.recipient === writer.id && g.action === 'review' ? { ...g, expiresAt: now + 10 } : g) } : authority;
      const input = { ...facts(), currentAuthority, reviewers: [{ ...facts().reviewers[0]!, current: reviewer }],
        attachments: facts().attachments.map((proof) => ({ ...proof, checkedAt: change === 'attachment' ? now - 300_000 + 10 : now })) };
      const verified = verifyApproval(candidate, binding, response(), input);
      if (!verified.ok) throw new Error(verified.reason);
      expect(verified.evidence.validUntil).toBe(now + 10);
      const ready = attachEvidence(candidate, verified.evidence, confirmation, now);
      const current: PublicationFacts = { publisher: peer, reviewer, evidence: verified.evidence, confirmation, authority: currentAuthority, now };
      const ticket = issueTicket(ready, current)!;
      expect(ticket.expiresAt).toBe(now + 10);
      expect(canCommit(ready, ticket, { ...current, now: now + 11, currentReleaseId: 'release-1', consumed: false }).ok).toBe(false);
      expect(canCommit(ready, ticket, { ...current, authority: { ...currentAuthority, grants: currentAuthority.grants.filter((g) => g.action !== 'review') }, currentReleaseId: 'release-1', consumed: false }).ok).toBe(false);
    }
  });
  it('retains missing entries and detects explicit/batched/split 24h deactivation risk', () => {
    expect(mergeEntries([entry, { ...entry, id: 'retained' }], [{ ...entry, body: '更新' }])).toHaveLength(2);
    expect(() => mergeEntries([entry], [])).toThrow('INVALID_BATCH');
    const changes = [{ id: entry.id, before: entry, after: { ...entry, disabled: true } }];
    expect(assessRisk(changes, [], 'source-a', now)).toBe('routine');
    expect(assessRisk(changes, [{ sourceId: 'source-a', at: now - 1, count: 1 }], 'source-a', now)).toBe('critical');
    expect(assessRisk(changes, [{ sourceId: 'source-b', at: now - 1, count: 1 }], 'source-a', now)).toBe('routine');
    expect(assessRisk(changes, [{ sourceId: 'source-a', at: now - 86_400_000, count: 1 }], 'source-a', now)).toBe('routine');
    expect(assessRisk([{ id: entry.id, before: { ...entry, critical: true }, after: entry }], [], 'source-a', now)).toBe('critical');
  });
  it('counts real deactivations and matches risk terms within each field, without joining different revisions', () => {
    const inactive = [1, 2].map((id) => ({ id: String(id), before: null, after: { ...entry, id: String(id), disabled: true } }));
    expect(assessRisk(inactive, [], 'source-a', now)).toBe('routine');
    expect(assessRisk([{ id: entry.id, before: { ...entry, body: '略过' }, after: { ...entry, title: '敏感咨询' } }], [], 'source-a', now)).toBe('routine');
    expect(assessRisk([{ id: entry.id, before: entry, after: { ...entry, title: '赔付说明' } }], [], 'source-a', now)).toBe('critical');
  });
  it('checks revocation, scope, baseline, one-use and expiry again at simulated commit', () => {
    const verified = verifyApproval(candidate, binding, response(), facts());
    if (!verified.ok) throw new Error(verified.reason);
    const ready = attachEvidence(candidate, verified.evidence, confirmation, now);
    const current = { publisher: writer, reviewer: writer, evidence: verified.evidence, confirmation, authority, now,
      currentReleaseId: 'release-1', consumed: false };
    const ticket = issueTicket(ready, current)!;
    expect(ticket).not.toBeNull();
    expect(canCommit(ready, ticket, current).ok).toBe(true);
    expect(canCommit(ready, { ...ticket, expiresAt: now + 60_001 }, current)).toEqual({ ok: false, reason: 'TICKET_EXPIRED' });
    for (const change of [
      { publisher: { ...writer, generation: 1 } }, { reviewer: { ...writer, generation: 1 } },
      { evidence: { ...verified.evidence, generation: 1 } }, { currentReleaseId: 'release-2' },
      { consumed: true }, { now: ticket.expiresAt }, { authority: { ...authority, grants: [] } },
      { confirmation: { ...confirmation, generation: 1 } }, { confirmation: { ...confirmation, confirmed: false } },
    ]) expect(canCommit(ready, ticket, { ...current, ...change }).ok).toBe(false);
    expect(issueTicket(ready, { ...current, confirmation: { ...confirmation, confirmed: false } })).toBeNull();
  });
  it('bounds existing usage after a commit wins the remote-revocation race; failed refresh never extends it', () => {
    expect(usageDeadline(now + 300_000, [now + 299_000, now + 1000], now + 100_000, now + 20_000)).toBe(now + 1000);
    expect(usageDeadline(now + 300_000, [], now + 100_000, now + 20_000)).toBeNull();
  });
});
