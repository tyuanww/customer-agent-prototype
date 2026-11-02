import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { reviewSopStory } from './check-sop-story.mjs';

const node = (id, kind = 'action', support = 'source') => ({ id, kind, support, title: id, sourceRows: [2] });
const edge = (id, from, to, kind = 'explicit', conditionKey = 'continue') => ({ id, from, to, kind, conditionKey, sourceRows: [2] });
const story = () => ({
  schema: 'sop-story-review-v1', source: { sha256: 'a'.repeat(64), sheet: 'Synthetic', rowCount: 12 },
  publishable: false, runtimeEnabled: false,
  flows: [{ id: 'flow', startNodeId: 'start', nodes: [node('start'), node('done', 'terminal'), node('help', 'reference')],
    edges: [edge('finish', 'start', 'done')], scenarios: [{ id: 'complete', edgeIds: ['finish'], expectedOutcome: 'terminal' }] }],
});
const resultFor = mutate => { const value = story(); mutate(value); return reviewSopStory(value); };
const has = (result, code) => result.issues.some(issue => issue.code === code);
const selectionStory = () => {
  const value = story(); value.schema = 'sop-story-review-v2';
  value.flows[0] = {
    id: 'flow', startNodeId: 'start',
    nodes: [node('start', 'decision'), node('review', 'decision'), node('done', 'terminal'), node('help', 'reference')],
    edges: [edge('select-a', 'start', 'start', 'explicit', 'choose-a'), edge('select-b', 'start', 'start', 'explicit', 'choose-b'),
      edge('finish', 'start', 'review', 'explicit', 'finish'), edge('reset', 'start', 'start', 'explicit', 'reset'),
      edge('confirm', 'review', 'done', 'explicit', 'confirm'), edge('revise', 'review', 'start', 'explicit', 'revise'),
      edge('reset-review', 'review', 'review', 'explicit', 'reset-review')],
    scenarios: [{ id: 'complete', edgeIds: ['select-a', 'finish', 'confirm'], expectedOutcome: 'terminal' }],
    selections: [{ id: 'choices', selectEdgeIds: ['select-a', 'select-b'], finishEdgeId: 'finish', confirmEdgeId: 'confirm',
      resetEdgeIds: ['reset', 'revise', 'reset-review'], minSelected: 1 }],
  };
  return value;
};
const selectionResultFor = mutate => { const value = selectionStory(); mutate(value.flows[0]); return reviewSopStory(value); };
const addSelection = flow => {
  flow.nodes.push(node('other-review', 'decision'));
  flow.edges.push(edge('other-select', 'start', 'start', 'explicit', 'other-select'),
    edge('other-finish', 'start', 'other-review', 'explicit', 'other-finish'),
    edge('other-confirm', 'other-review', 'done', 'explicit', 'other-confirm'),
    edge('other-revise', 'other-review', 'start', 'explicit', 'other-revise'));
  flow.selections.push({ id: 'other', selectEdgeIds: ['other-select'], finishEdgeId: 'other-finish', confirmEdgeId: 'other-confirm',
    resetEdgeIds: ['reset', 'other-revise'], minSelected: 1 });
};

test('complete explicit story reports bounded structural readiness without publication', () => {
  const result = reviewSopStory(story());
  assert.equal(result.status, 'review-structure-complete');
  assert.equal(result.publishable, false);
  assert.equal(result.runtimeEnabled, false);
  assert.equal(result.selectionChecksApplied, false);
  assert.equal(result.counts.selectionGroups, 0);
  assert.equal(result.sourceSha256, 'a'.repeat(64));
  assert.equal(result.counts.executableNodes, 2);
  assert.equal(result.counts.explicitReachableNodes, 2);
  assert.equal(result.counts.candidateReachableNodes, 2);
  assert.deepEqual(result.scenarioResults, [{ flowId: 'flow', scenarioId: 'complete', status: 'matched', outcome: 'terminal' }]);
});

test('rejects malformed input, unknown fields, publication flags and bad source hash', () => {
  for (const value of [null, [], 'raw secret']) assert.equal(reviewSopStory(value).status, 'invalid');
  for (const mutate of [v => { v.source.sha256 = 'bad'; }, v => { v.source.extra = 1; }, v => { v.publishable = true; },
    v => { v.runtimeEnabled = true; }, v => { v.extra = 'secret'; }, v => { v.flows[0].nodes[0].extra = 'secret'; }]) {
    assert.equal(resultFor(mutate).status, 'invalid');
  }
});

test('validates row bounds, unique rows, semantic IDs, and collection limits', () => {
  for (const mutate of [v => { v.flows[0].nodes[0].sourceRows = [13]; }, v => { v.flows[0].nodes[0].sourceRows = [2, 2]; },
    v => { v.flows[0].nodes[0].id = '../private'; }, v => { v.flows[0].nodes = Array.from({ length: 129 }, (_, i) => node(`node-${i}`)); },
    v => { v.flows[0].scenarios[0].edgeIds = Array(513).fill('finish'); }]) assert.equal(resultFor(mutate).status, 'invalid');
});

test('source-backed nodes and explicit edges require source rows', () => {
  assert.equal(resultFor(v => { v.flows[0].nodes[0].sourceRows = []; }).status, 'invalid');
  assert.equal(resultFor(v => { v.flows[0].edges[0].sourceRows = []; }).status, 'invalid');
  const proposal = resultFor(v => {
    v.flows[0].nodes[0].support = 'proposal'; v.flows[0].nodes[0].sourceRows = [];
    v.flows[0].edges[0].kind = 'proposed'; v.flows[0].edges[0].sourceRows = [];
  });
  assert.equal(proposal.status, 'needs-business-confirmation');
});

test('dangling targets, cross-flow targets, duplicate identities and orphan nodes are invalid', () => {
  assert(has(resultFor(v => { v.flows[0].edges[0].to = 'missing'; }), 'MISSING_TARGET'));
  assert(has(resultFor(v => { v.flows.push({ id: 'other', startNodeId: 'elsewhere', nodes: [node('elsewhere', 'terminal')], edges: [], scenarios: [] }); v.flows[0].edges[0].to = 'elsewhere'; }), 'MISSING_TARGET'));
  assert(has(resultFor(v => { v.flows[0].nodes.push(node('start')); }), 'DUPLICATE_NODE'));
  assert(has(resultFor(v => { v.flows[0].nodes.push(node('orphan', 'terminal')); }), 'UNREACHABLE_NODE'));
});

test('reference nodes cannot start, receive, or send execution edges', () => {
  assert(has(resultFor(v => { v.flows[0].startNodeId = 'help'; }), 'INVALID_START'));
  assert(has(resultFor(v => { v.flows[0].edges[0].to = 'help'; }), 'REFERENCE_EDGE'));
  assert(has(resultFor(v => { v.flows[0].edges[0].from = 'help'; }), 'REFERENCE_EDGE'));
});

test('decision needs distinct conditional choices and terminal cannot continue', () => {
  assert(has(resultFor(v => { v.flows[0].nodes[0].kind = 'decision'; }), 'DECISION_BRANCHES'));
  assert(has(resultFor(v => { v.flows[0].nodes[0].kind = 'decision'; v.flows[0].edges.push(edge('again', 'start', 'done')); }), 'DUPLICATE_CONDITION'));
  assert(has(resultFor(v => { v.flows[0].edges.push(edge('again', 'done', 'start')); }), 'TERMINAL_OUTGOING'));
});

test('dead cycles fail but a cycle with a reachable wait remains inspectable', () => {
  const dead = resultFor(v => { const f = v.flows[0]; f.nodes = [node('start'), node('cycle')]; f.edges = [edge('go', 'start', 'cycle'), edge('back', 'cycle', 'start')]; f.scenarios = []; });
  assert(has(dead, 'NO_EXIT_PATH'));
  const waiting = resultFor(v => { const f = v.flows[0]; f.nodes = [node('start'), node('wait', 'wait')]; f.edges = [edge('go', 'start', 'wait'), edge('back', 'wait', 'start')]; f.scenarios = [{ id: 'wait-now', edgeIds: ['go'], expectedOutcome: 'waiting' }]; });
  assert.equal(waiting.status, 'review-structure-complete');
  assert.equal(waiting.counts.waitNodes, 1);
  assert.equal(waiting.counts.terminalNodes, 0);
});

test('pending exits require business confirmation and cannot masquerade as terminal', () => {
  const pending = v => { const f = v.flows[0]; f.nodes = [node('start')]; f.edges = [{ id: 'unknown', from: 'start', kind: 'pending', conditionKey: 'unknown-result', sourceRows: [3] }]; f.scenarios = [{ id: 'pending-now', edgeIds: ['unknown'], expectedOutcome: 'pending' }]; };
  const result = resultFor(pending);
  assert.equal(result.status, 'needs-business-confirmation');
  assert.equal(result.counts.pendingEdges, 1);
  assert.equal(result.counts.terminalNodes, 0);
  assert(has(result, 'PENDING_EDGE'));
  assert(has(resultFor(v => { pending(v); v.flows[0].scenarios[0].expectedOutcome = 'terminal'; }), 'SCENARIO_OUTCOME'));
  assert.equal(resultFor(v => { pending(v); v.flows[0].edges[0].to = 'start'; }).status, 'invalid');
});

test('proposed paths report separate explicit and candidate reachability', () => {
  const result = resultFor(v => { v.flows[0].edges[0].kind = 'proposed'; v.flows[0].nodes[1].support = 'proposal'; });
  assert.equal(result.status, 'needs-business-confirmation');
  assert.equal(result.counts.explicitReachableNodes, 1);
  assert.equal(result.counts.candidateReachableNodes, 2);
  assert.equal(result.counts.proposedEdges, 1);
  assert.equal(result.counts.proposedNodes, 1);
});

test('scenarios must follow the named edges from the current node and end as claimed', () => {
  assert(has(resultFor(v => { v.flows[0].scenarios[0].edgeIds = ['missing']; }), 'SCENARIO_EDGE'));
  assert(has(resultFor(v => { v.flows[0].scenarios[0].edgeIds = ['finish', 'finish']; }), 'SCENARIO_FROM'));
  assert(has(resultFor(v => { v.flows[0].scenarios[0].expectedOutcome = 'waiting'; }), 'SCENARIO_OUTCOME'));
  assert(has(resultFor(v => { v.flows[0].scenarios[0].edgeIds = []; }), 'SCENARIO_OUTCOME'));
});

test('an action cannot hide multiple resolved branches and identities stay unique per flow', () => {
  assert(has(resultFor(v => { v.flows[0].edges.push(edge('second', 'start', 'done', 'explicit', 'other')); }), 'ACTION_BRANCHES'));
  assert(has(resultFor(v => { v.flows.push(structuredClone(v.flows[0])); }), 'DUPLICATE_FLOW'));
  assert(has(resultFor(v => { v.flows[0].edges.push(structuredClone(v.flows[0].edges[0])); }), 'DUPLICATE_EDGE'));
  assert(has(resultFor(v => { v.flows[0].scenarios.push(structuredClone(v.flows[0].scenarios[0])); }), 'DUPLICATE_SCENARIO'));
});

test('a pending edge stops a scenario even when later edge IDs are otherwise known', () => {
  const result = resultFor(v => {
    v.flows[0].nodes[0].kind = 'decision';
    v.flows[0].edges.push({ id: 'unknown', from: 'start', kind: 'pending', conditionKey: 'unknown', sourceRows: [] });
    v.flows[0].scenarios = [{ id: 'bad-continuation', edgeIds: ['unknown', 'finish'], expectedOutcome: 'pending' }];
  });
  assert.equal(result.status, 'invalid');
  assert(has(result, 'SCENARIO_PENDING_CONTINUES'));
});

test('a reachable closed cycle fails even when a different branch can finish', () => {
  const result = resultFor(v => {
    const f = v.flows[0]; f.nodes[0].kind = 'decision'; f.nodes.push(node('stuck'));
    f.edges.push(edge('enter-loop', 'start', 'stuck', 'explicit', 'loop'), edge('repeat', 'stuck', 'stuck'));
  });
  assert(has(result, 'NO_EXIT_PATH'));
});

test('reports do not echo raw titles or invalid secret identifiers', () => {
  const value = story(); value.flows[0].nodes[0].title = 'PRIVATE BODY';
  assert(!JSON.stringify(reviewSopStory(value)).includes('PRIVATE BODY'));
  value.flows[0].nodes[0].id = 'PRIVATE SECRET';
  assert(!JSON.stringify(reviewSopStory(value)).includes('PRIVATE SECRET'));
});

test('v1 rejects selection metadata while v2 explicitly supports flows without selection groups', () => {
  const legacy = resultFor(v => { v.flows[0].selections = []; });
  assert.equal(legacy.status, 'invalid');
  assert(has(legacy, 'INVALID_FIELDS'));
  assert.equal(legacy.selectionChecksApplied, false);
  const value = story(); value.schema = 'sop-story-review-v2'; value.flows[0].selections = [];
  const result = reviewSopStory(value);
  assert.equal(result.status, 'review-structure-complete');
  assert.equal(result.selectionChecksApplied, true);
  assert.equal(result.counts.selectionGroups, 0);
});

test('v2 accepts both single and multiple selections and preserves review-only boundaries', () => {
  const result = selectionResultFor(flow => {
    flow.scenarios.push({ id: 'multiple', edgeIds: ['select-a', 'select-b', 'finish', 'confirm'], expectedOutcome: 'terminal' });
    flow.nodes[0].title = 'PRIVATE TITLE';
  });
  assert.equal(result.status, 'review-structure-complete');
  assert.equal(result.selectionChecksApplied, true);
  assert.equal(result.counts.selectionGroups, 1);
  assert.equal(result.publishable, false);
  assert.equal(result.runtimeEnabled, false);
  assert.deepEqual(result.scenarioResults.map(result => result.status), ['matched', 'matched']);
  assert(!JSON.stringify(result).includes('PRIVATE TITLE'));
});

test('each v2 scenario starts empty and cannot finish or confirm without enough selections', () => {
  const result = selectionResultFor(flow => {
    flow.scenarios.push({ id: 'zero-selection', edgeIds: ['finish', 'confirm'], expectedOutcome: 'terminal' },
      { id: 'confirm-after-reset', edgeIds: ['select-a', 'finish', 'reset-review', 'confirm'], expectedOutcome: 'terminal' });
  });
  assert.equal(result.status, 'invalid');
  assert.equal(result.selectionChecksApplied, true);
  for (const scenarioId of ['zero-selection', 'confirm-after-reset']) {
    assert(result.issues.some(issue => issue.code === 'SCENARIO_SELECTION_EMPTY' && issue.flowId === 'flow' && issue.subjectId === scenarioId));
  }
  assert.deepEqual(result.scenarioResults.map(result => result.status), ['matched', 'invalid', 'invalid']);
});

test('repeating a selected edge does not satisfy a higher minimum but distinct selections do', () => {
  const result = selectionResultFor(flow => {
    flow.selections[0].minSelected = 2;
    flow.scenarios = [
      { id: 'repeat', edgeIds: ['select-a', 'select-a', 'finish', 'confirm'], expectedOutcome: 'terminal' },
      { id: 'distinct', edgeIds: ['select-a', 'select-b', 'finish', 'confirm'], expectedOutcome: 'terminal' },
    ];
  });
  assert.equal(result.status, 'invalid');
  assert(has(result, 'SCENARIO_SELECTION_EMPTY'));
  assert.deepEqual(result.scenarioResults.map(result => result.status), ['invalid', 'matched']);
});

test('reset clears selection state and a new choice restores it', () => {
  const result = selectionResultFor(flow => {
    flow.scenarios = [
      { id: 'cleared', edgeIds: ['select-a', 'reset', 'finish', 'confirm'], expectedOutcome: 'terminal' },
      { id: 'selected-again', edgeIds: ['select-a', 'finish', 'revise', 'select-b', 'finish', 'confirm'], expectedOutcome: 'terminal' },
    ];
  });
  assert.equal(result.status, 'invalid');
  assert(has(result, 'SCENARIO_SELECTION_EMPTY'));
  assert.deepEqual(result.scenarioResults.map(result => result.status), ['invalid', 'matched']);
});

test('selection groups maintain independent state and may share reset edges', () => {
  const result = selectionResultFor(flow => {
    addSelection(flow);
    flow.scenarios = [
      { id: 'both-selected', edgeIds: ['select-a', 'other-select', 'finish', 'confirm'], expectedOutcome: 'terminal' },
      { id: 'other-is-empty', edgeIds: ['select-a', 'other-finish', 'other-confirm'], expectedOutcome: 'terminal' },
      { id: 'shared-reset', edgeIds: ['select-a', 'other-select', 'reset', 'other-finish', 'other-confirm'], expectedOutcome: 'terminal' },
    ];
  });
  assert.equal(result.status, 'invalid');
  assert.equal(result.counts.selectionGroups, 2);
  assert(!has(result, 'SELECTION_EDGE_OVERLAP'));
  assert.deepEqual(result.scenarioResults.map(result => result.status), ['matched', 'invalid', 'invalid']);
});

test('v2 requires exact complete selection metadata and rejects malformed values', () => {
  const mutations = [flow => { delete flow.selections; }, flow => { flow.selections = null; },
    flow => { flow.selections = Array.from({ length: 33 }, () => structuredClone(flow.selections[0])); },
    flow => { flow.selections[0].extra = 'PRIVATE EXTRA'; }, flow => { flow.selections[0].id = 'PRIVATE ID'; },
    flow => { flow.selections[0].selectEdgeIds = []; }, flow => { flow.selections[0].selectEdgeIds = ['select-a', 'select-a']; },
    flow => { flow.selections[0].selectEdgeIds = ['PRIVATE ID']; },
    flow => { flow.selections[0].selectEdgeIds = Array.from({ length: 33 }, (_, i) => `select-${i}`); },
    flow => { flow.selections[0].resetEdgeIds = ['reset', 'reset']; }, flow => { flow.selections[0].resetEdgeIds = ['PRIVATE ID']; },
    flow => { flow.selections[0].resetEdgeIds = null; }, flow => { flow.selections[0].finishEdgeId = 'PRIVATE ID'; },
    flow => { flow.selections[0].confirmEdgeId = 'PRIVATE ID'; }];
  for (const field of Object.keys(selectionStory().flows[0].selections[0])) mutations.push(flow => { delete flow.selections[0][field]; });
  for (const minimum of [0, -1, 1.5, 3, Number.MAX_SAFE_INTEGER + 1, Infinity]) mutations.push(flow => { flow.selections[0].minSelected = minimum; });
  for (const mutate of mutations) {
    const result = selectionResultFor(mutate);
    assert.equal(result.status, 'invalid');
    assert.equal(result.selectionChecksApplied, false);
    assert(!JSON.stringify(result).includes('PRIVATE'));
  }
  const missing = story(); missing.schema = 'sop-story-review-v2';
  assert.equal(reviewSopStory(missing).status, 'invalid');
});

test('v2 requires every selection edge reference to exist in its flow', () => {
  for (const field of ['selectEdgeIds', 'finishEdgeId', 'confirmEdgeId', 'resetEdgeIds']) {
    const result = selectionResultFor(flow => { flow.selections[0][field] = field.endsWith('Ids') ? ['missing'] : 'missing'; });
    assert.equal(result.status, 'invalid');
    assert(has(result, 'MISSING_SELECTION_EDGE'));
  }
});

test('selection IDs are unique and edge roles cannot overlap within or between groups', () => {
  const duplicate = selectionResultFor(flow => { addSelection(flow); flow.selections[1].id = flow.selections[0].id; });
  assert.equal(duplicate.status, 'invalid');
  assert(has(duplicate, 'DUPLICATE_SELECTION'));
  const roles = ['selectEdgeIds', 'finishEdgeId', 'confirmEdgeId', 'resetEdgeIds'];
  for (const left of roles) for (const right of roles) {
    if (left === right) continue;
    const result = selectionResultFor(flow => {
      const selection = flow.selections[0], source = selection[left], edgeId = Array.isArray(source) ? source[0] : source;
      selection[right] = right.endsWith('Ids') ? [edgeId] : edgeId;
    });
    assert.equal(result.status, 'invalid');
    assert(has(result, 'SELECTION_EDGE_OVERLAP'));
  }
  for (const left of roles) for (const right of roles) {
    if (left === 'resetEdgeIds' && right === 'resetEdgeIds') continue;
    const result = selectionResultFor(flow => {
      addSelection(flow);
      const source = flow.selections[0][left], edgeId = Array.isArray(source) ? source[0] : source;
      flow.selections[1][right] = right.endsWith('Ids') ? [edgeId] : edgeId;
    });
    assert.equal(result.status, 'invalid');
    assert(has(result, 'SELECTION_EDGE_OVERLAP'));
  }
});

test('selection limits allow 32 groups, 32 choices, and no reset edges', () => {
  const value = selectionStory(), flow = value.flows[0];
  flow.nodes = [node('start', 'decision'), node('done', 'terminal')]; flow.edges = []; flow.scenarios = []; flow.selections = [];
  for (let group = 0; group < 32; group += 1) {
    const selectEdgeIds = [];
    for (let choice = 0; choice < (group === 0 ? 32 : 1); choice += 1) {
      const id = `select-${group}-${choice}`; selectEdgeIds.push(id); flow.edges.push(edge(id, 'start', 'start', 'explicit', id));
    }
    const finishEdgeId = `finish-${group}`, confirmEdgeId = `confirm-${group}`;
    flow.edges.push(edge(finishEdgeId, 'start', 'start', 'explicit', finishEdgeId), edge(confirmEdgeId, 'start', 'done', 'explicit', confirmEdgeId));
    flow.selections.push({ id: `group-${group}`, selectEdgeIds, finishEdgeId, confirmEdgeId, resetEdgeIds: [], minSelected: selectEdgeIds.length });
  }
  const result = reviewSopStory(value);
  assert.equal(result.status, 'review-structure-complete');
  assert.equal(result.selectionChecksApplied, true);
  assert.equal(result.counts.selectionGroups, 32);
});

test('v2 retains source, reference, graph and pending-path checks', () => {
  assert(has(selectionResultFor(flow => { flow.nodes[0].sourceRows = []; }), 'INVALID_ROWS'));
  assert(has(selectionResultFor(flow => { flow.edges[0].to = 'help'; }), 'REFERENCE_EDGE'));
  assert(has(selectionResultFor(flow => { flow.scenarios[0].edgeIds = ['confirm']; }), 'SCENARIO_FROM'));
  const result = selectionResultFor(flow => {
    const confirm = flow.edges.find(edge => edge.id === 'confirm'); confirm.kind = 'pending'; delete confirm.to;
    flow.nodes = flow.nodes.filter(node => node.id !== 'done'); flow.scenarios[0].expectedOutcome = 'pending';
  });
  assert.equal(result.status, 'needs-business-confirmation');
  assert.equal(result.selectionChecksApplied, true);
  assert(has(result, 'PENDING_EDGE'));
  assert.equal(result.scenarioResults[0].outcome, 'pending');
});

test('CLI consumes v2 metadata and reports both selection success and failure', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'story-selection-test-'));
  const executable = fileURLToPath(new URL('./check-sop-story.mjs', import.meta.url));
  const input = path.join(directory, 'input.json'), output = path.join(directory, 'report.json');
  const run = (...args) => spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8' });
  try {
    const value = selectionStory(); writeFileSync(input, JSON.stringify(value));
    assert.equal(run(input, output).status, 0);
    const success = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(success.status, 'review-structure-complete');
    assert.equal(success.selectionChecksApplied, true);
    assert.equal(success.counts.selectionGroups, 1);
    assert.equal(success.scenarioResults[0].status, 'matched');
    value.flows[0].scenarios[0].edgeIds = ['finish', 'confirm']; writeFileSync(input, JSON.stringify(value));
    const failure = run(input); assert.equal(failure.status, 2);
    const report = JSON.parse(failure.stdout);
    assert.equal(report.status, 'invalid');
    assert.equal(report.selectionChecksApplied, true);
    assert(has(report, 'SCENARIO_SELECTION_EMPTY'));
    assert.equal(report.scenarioResults[0].status, 'invalid');
    delete value.flows[0].selections; writeFileSync(input, JSON.stringify(value));
    const malformed = run(input); assert.equal(malformed.status, 2);
    assert.equal(JSON.parse(malformed.stdout).selectionChecksApplied, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('CLI writes consumable JSON, uses meaningful exits, and never overwrites output or input', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'story-check-test-'));
  const executable = fileURLToPath(new URL('./check-sop-story.mjs', import.meta.url));
  const input = path.join(directory, 'input.json'), output = path.join(directory, 'report.json');
  const run = (...args) => spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8' });
  try {
    const bytes = JSON.stringify(story()); writeFileSync(input, bytes);
    assert.equal(run(input, output).status, 0);
    assert.equal(JSON.parse(readFileSync(output)).status, 'review-structure-complete');
    assert.equal(JSON.parse(readFileSync(output)).selectionChecksApplied, false);
    assert.equal(run(input, output).status, 2);
    assert.equal(run(input, input).status, 2);
    assert.equal(readFileSync(input, 'utf8'), bytes);
    const proposed = story(); proposed.flows[0].edges[0].kind = 'proposed'; writeFileSync(input, JSON.stringify(proposed));
    const pending = run(input); assert.equal(pending.status, 3); assert.equal(JSON.parse(pending.stdout).status, 'needs-business-confirmation');
    writeFileSync(input, '{private invalid input'); const invalid = run(input); assert.equal(invalid.status, 2);
    assert(!invalid.stdout.includes('private')); assert.equal(JSON.parse(invalid.stdout).issues[0].code, 'INPUT_JSON');
    writeFileSync(input, 'x'.repeat(4 * 1024 * 1024 + 1)); assert.equal(run(input).status, 2);
    const link = path.join(directory, 'link.json'); symlinkSync(input, link); assert.equal(run(link).status, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('invalid selection roles stop scenario simulation instead of amplifying diagnostics', () => {
  const value = selectionStory(), flow = value.flows[0];
  flow.nodes = [node('start', 'decision'), node('done', 'terminal')];
  flow.edges = [edge('select-a', 'start', 'start', 'explicit', 'select-a'),
    edge('finish', 'start', 'start', 'explicit', 'finish'), edge('confirm', 'start', 'done', 'explicit', 'confirm')];
  flow.selections = Array.from({ length: 32 }, (_, index) => ({ id: `group-${index}`,
    selectEdgeIds: ['select-a'], finishEdgeId: 'finish', confirmEdgeId: 'confirm', resetEdgeIds: [], minSelected: 1 }));
  flow.scenarios = Array.from({ length: 64 }, (_, index) => ({ id: `story-${index}`,
    edgeIds: Array(512).fill('finish'), expectedOutcome: 'terminal' }));
  const result = reviewSopStory(value);
  assert.equal(result.status, 'invalid');
  assert(has(result, 'SELECTION_EDGE_OVERLAP'));
  assert.equal(result.issues.filter(issue => issue.code === 'SCENARIO_SELECTION_EMPTY').length, 0);
  assert(result.issues.length < 100);
  assert.equal(result.scenarioResults.length, 64);
  assert(result.scenarioResults.every(scenario => scenario.status === 'invalid'));
});

test('a scenario stops at its first empty-selection failure', () => {
  const value = selectionStory(), flow = value.flows[0];
  flow.nodes = [node('start', 'decision'), node('done', 'terminal')];
  flow.edges = [edge('select-a', 'start', 'start', 'explicit', 'select-a'),
    edge('finish', 'start', 'start', 'explicit', 'finish'), edge('confirm', 'start', 'done', 'explicit', 'confirm')];
  flow.selections = [{ id: 'choices', selectEdgeIds: ['select-a'], finishEdgeId: 'finish',
    confirmEdgeId: 'confirm', resetEdgeIds: [], minSelected: 1 }];
  flow.scenarios = [{ id: 'repeated-invalid-finish', edgeIds: Array(512).fill('finish'), expectedOutcome: 'terminal' }];
  const result = reviewSopStory(value);
  assert.equal(result.status, 'invalid');
  assert.equal(result.issues.filter(issue => issue.code === 'SCENARIO_SELECTION_EMPTY').length, 1);
});
