import { constants } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 4 * 1024 * 1024;
const semanticId = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');
const id = value => text(value, 128) && semanticId.test(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const list = (value, max) => Array.isArray(value) && value.length <= max;
const idList = (value, max) => list(value, max) && value.every(id) && new Set(value).size === value.length;
const rowSet = (value, count) => list(value, 512) && value.every(row => Number.isSafeInteger(row) && row > 0 && row <= count) && new Set(value).size === value.length;
const emptyCounts = () => ({ flows: 0, nodes: 0, executableNodes: 0, edges: 0, scenarios: 0, selectionGroups: 0, pendingEdges: 0,
  proposedNodes: 0, proposedEdges: 0, terminalNodes: 0, waitNodes: 0, explicitReachableNodes: 0, candidateReachableNodes: 0 });
const invalid = code => ({ status: 'invalid', publishable: false, runtimeEnabled: false, selectionChecksApplied: false,
  issues: [{ code, at: '$' }], counts: emptyCounts(), scenarioResults: [] });

function shapeIssues(input) {
  const issues = [];
  const add = (code, at) => issues.push({ code, at });
  if (!exact(input, ['schema', 'source', 'publishable', 'runtimeEnabled', 'flows'])) return [{ code: 'INVALID_FIELDS', at: '$' }];
  if (!['sop-story-review-v1', 'sop-story-review-v2'].includes(input.schema) || input.publishable !== false || input.runtimeEnabled !== false) add('INVALID_REVIEW_BOUNDARY', '$');
  if (!exact(input.source, ['sha256', 'sheet', 'rowCount'])) return [...issues, { code: 'INVALID_FIELDS', at: '$.source' }];
  if (typeof input.source.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(input.source.sha256)) add('INVALID_SHA256', '$.source.sha256');
  if (!text(input.source.sheet, 128) || !Number.isSafeInteger(input.source.rowCount) || input.source.rowCount < 1 || input.source.rowCount > 1_000_000) add('INVALID_SOURCE', '$.source');
  if (!list(input.flows, 64) || input.flows.length === 0) return [...issues, { code: 'INVALID_FLOWS', at: '$.flows' }];
  input.flows.forEach((flow, f) => {
    const at = `$.flows[${f}]`;
    const keys = ['id', 'startNodeId', 'nodes', 'edges', 'scenarios'];
    if (input.schema === 'sop-story-review-v2') keys.push('selections');
    if (!exact(flow, keys)) { add('INVALID_FIELDS', at); return; }
    if (!id(flow.id) || !id(flow.startNodeId)) add('INVALID_ID', at);
    if (!list(flow.nodes, 128) || flow.nodes.length === 0 || !list(flow.edges, 512) || !list(flow.scenarios, 64)) { add('INVALID_COLLECTION', at); return; }
    if (input.schema === 'sop-story-review-v2') {
      if (!list(flow.selections, 32)) { add('INVALID_COLLECTION', `${at}.selections`); return; }
      flow.selections.forEach((selection, s) => {
        const location = `${at}.selections[${s}]`;
        if (!exact(selection, ['id', 'selectEdgeIds', 'finishEdgeId', 'confirmEdgeId', 'resetEdgeIds', 'minSelected'])) { add('INVALID_FIELDS', location); return; }
        if (!id(selection.id) || !id(selection.finishEdgeId) || !id(selection.confirmEdgeId)
          || !idList(selection.selectEdgeIds, 32) || selection.selectEdgeIds.length === 0 || !idList(selection.resetEdgeIds, 512)
          || !Number.isSafeInteger(selection.minSelected) || selection.minSelected < 1 || selection.minSelected > selection.selectEdgeIds.length) add('INVALID_SELECTION', location);
      });
    }
    flow.nodes.forEach((node, n) => {
      const location = `${at}.nodes[${n}]`;
      if (!exact(node, ['id', 'title', 'kind', 'support', 'sourceRows'])) { add('INVALID_FIELDS', location); return; }
      if (!id(node.id) || !text(node.title, 256) || !['action', 'decision', 'wait', 'terminal', 'reference'].includes(node.kind)
        || !['source', 'proposal'].includes(node.support)) add('INVALID_NODE', location);
      if (!rowSet(node.sourceRows, input.source.rowCount) || (node.support === 'source' && node.sourceRows.length === 0)) add('INVALID_ROWS', location);
    });
    flow.edges.forEach((edge, e) => {
      const location = `${at}.edges[${e}]`;
      if (!record(edge) || !exact(edge, edge.kind === 'pending' ? ['id', 'from', 'kind', 'conditionKey', 'sourceRows']
        : ['id', 'from', 'kind', 'to', 'conditionKey', 'sourceRows'])) { add('INVALID_FIELDS', location); return; }
      if (!id(edge.id) || !id(edge.from) || !id(edge.conditionKey) || !['explicit', 'proposed', 'pending'].includes(edge.kind)
        || (edge.kind !== 'pending' && !id(edge.to))) add('INVALID_EDGE', location);
      if (!rowSet(edge.sourceRows, input.source.rowCount) || (edge.kind === 'explicit' && edge.sourceRows.length === 0)) add('INVALID_ROWS', location);
    });
    flow.scenarios.forEach((scenario, s) => {
      const location = `${at}.scenarios[${s}]`;
      if (!exact(scenario, ['id', 'edgeIds', 'expectedOutcome'])) { add('INVALID_FIELDS', location); return; }
      if (!id(scenario.id) || !list(scenario.edgeIds, 512) || !scenario.edgeIds.every(id)
        || !['terminal', 'waiting', 'pending'].includes(scenario.expectedOutcome)) add('INVALID_SCENARIO', location);
    });
  });
  return issues;
}

function reachable(start, adjacency) {
  const seen = new Set([start]), queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    for (const next of adjacency.get(queue[index]) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return seen;
}

/** Checks structure and declared selection state; source authenticity and business applicability remain outside this tool. */
export function reviewSopStory(input) {
  const issues = shapeIssues(input);
  if (issues.length) return { ...invalid('INVALID_SHAPE'), issues };
  const counts = emptyCounts(), scenarioResults = [], flowIds = new Set();
  const selectionChecksApplied = input.schema === 'sop-story-review-v2';
  let businessPending = false;
  const add = (code, flowId, subjectId) => issues.push({ code, flowId, subjectId });
  for (const flow of input.flows) {
    counts.flows += 1;
    if (flowIds.has(flow.id)) add('DUPLICATE_FLOW', flow.id, flow.id);
    flowIds.add(flow.id);
    const nodes = new Map(), edges = new Map(), outgoing = new Map(), adjacency = new Map(), explicit = new Map(), reverse = new Map();
    for (const node of flow.nodes) {
      counts.nodes += 1;
      if (nodes.has(node.id)) add('DUPLICATE_NODE', flow.id, node.id);
      nodes.set(node.id, node);
      if (node.kind !== 'reference') counts.executableNodes += 1;
      if (node.kind === 'terminal') counts.terminalNodes += 1;
      if (node.kind === 'wait') counts.waitNodes += 1;
      if (node.support === 'proposal') { counts.proposedNodes += 1; businessPending = true; add('PROPOSED_NODE', flow.id, node.id); }
    }
    for (const edge of flow.edges) {
      counts.edges += 1;
      if (edges.has(edge.id)) add('DUPLICATE_EDGE', flow.id, edge.id);
      edges.set(edge.id, edge);
      if (edge.kind === 'pending') { counts.pendingEdges += 1; businessPending = true; add('PENDING_EDGE', flow.id, edge.id); }
      if (edge.kind === 'proposed') { counts.proposedEdges += 1; businessPending = true; add('PROPOSED_EDGE', flow.id, edge.id); }
      const from = nodes.get(edge.from), to = edge.kind === 'pending' ? null : nodes.get(edge.to);
      if (!from) add('MISSING_FROM', flow.id, edge.id);
      if (edge.kind !== 'pending' && !to) add('MISSING_TARGET', flow.id, edge.id);
      if (from?.kind === 'reference' || to?.kind === 'reference') add('REFERENCE_EDGE', flow.id, edge.id);
      if (!from || from.kind === 'reference' || (edge.kind !== 'pending' && (!to || to.kind === 'reference'))) continue;
      const exits = outgoing.get(edge.from) ?? [];
      exits.push(edge); outgoing.set(edge.from, exits);
      if (to) {
        for (const [map, key, value] of [[adjacency, edge.from, edge.to], [reverse, edge.to, edge.from]]) {
          const entries = map.get(key) ?? []; entries.push(value); map.set(key, entries);
        }
        if (edge.kind === 'explicit') {
          const entries = explicit.get(edge.from) ?? []; entries.push(edge.to); explicit.set(edge.from, entries);
        }
      }
    }
    const selections = (selectionChecksApplied ? flow.selections : []).map(selection => ({ ...selection,
      selectEdgeIds: new Set(selection.selectEdgeIds), resetEdgeIds: new Set(selection.resetEdgeIds) }));
    const selectionIssueStart = issues.length;
    const selectionIds = new Set(), selectionRoles = new Map();
    counts.selectionGroups += selections.length;
    for (const selection of selections) {
      if (selectionIds.has(selection.id)) add('DUPLICATE_SELECTION', flow.id, selection.id);
      selectionIds.add(selection.id);
      for (const [role, edgeIds] of [['exclusive', [...selection.selectEdgeIds, selection.finishEdgeId, selection.confirmEdgeId]], ['reset', selection.resetEdgeIds]]) {
        for (const edgeId of edgeIds) {
          if (!edges.has(edgeId)) add('MISSING_SELECTION_EDGE', flow.id, edgeId);
          const previousRole = selectionRoles.get(edgeId);
          if (previousRole && (role !== 'reset' || previousRole !== 'reset')) add('SELECTION_EDGE_OVERLAP', flow.id, edgeId);
          selectionRoles.set(edgeId, role);
        }
      }
    }
    const selectionRulesValid = issues.length === selectionIssueStart;
    const start = nodes.get(flow.startNodeId);
    if (!start || start.kind === 'reference') add('INVALID_START', flow.id, flow.startNodeId);
    const allReachable = start && start.kind !== 'reference' ? reachable(start.id, adjacency) : new Set();
    const explicitReachable = start && start.kind !== 'reference' ? reachable(start.id, explicit) : new Set();
    counts.candidateReachableNodes += allReachable.size;
    counts.explicitReachableNodes += explicitReachable.size;
    const canExit = new Set(), queue = [];
    for (const node of nodes.values()) {
      const exits = outgoing.get(node.id) ?? [];
      if (node.kind === 'reference') continue;
      if (!allReachable.has(node.id)) add('UNREACHABLE_NODE', flow.id, node.id);
      if (node.kind === 'terminal' && exits.length) add('TERMINAL_OUTGOING', flow.id, node.id);
      if (node.kind !== 'terminal' && !exits.length) add('NO_OUTGOING', flow.id, node.id);
      if (node.kind === 'decision' && exits.length < 2) add('DECISION_BRANCHES', flow.id, node.id);
      if (new Set(exits.map(edge => edge.conditionKey)).size !== exits.length) add('DUPLICATE_CONDITION', flow.id, node.id);
      if (node.kind === 'action' && exits.filter(edge => edge.kind !== 'pending').length > 1) add('ACTION_BRANCHES', flow.id, node.id);
      if (node.kind === 'terminal' || node.kind === 'wait' || exits.some(edge => edge.kind === 'pending')) { canExit.add(node.id); queue.push(node.id); }
    }
    for (let index = 0; index < queue.length; index += 1) for (const previous of reverse.get(queue[index]) ?? []) {
      if (!canExit.has(previous)) { canExit.add(previous); queue.push(previous); }
    }
    for (const nodeId of allReachable) if (!canExit.has(nodeId)) add('NO_EXIT_PATH', flow.id, nodeId);
    const scenarioIds = new Set();
    for (const scenario of flow.scenarios) {
      counts.scenarios += 1;
      if (scenarioIds.has(scenario.id)) add('DUPLICATE_SCENARIO', flow.id, scenario.id);
      scenarioIds.add(scenario.id);
      if (!selectionRulesValid) {
        scenarioResults.push({ flowId: flow.id, scenarioId: scenario.id, status: 'invalid', outcome: 'unchecked' });
        continue;
      }
      let current = flow.startNodeId, pending = false, matched = true;
      const selectionStates = selections.map(selection => ({ selection, selected: new Set() }));
      for (let index = 0; index < scenario.edgeIds.length; index += 1) {
        const edge = edges.get(scenario.edgeIds[index]);
        if (!edge) { add('SCENARIO_EDGE', flow.id, scenario.id); matched = false; break; }
        if (edge.from !== current) { add('SCENARIO_FROM', flow.id, scenario.id); matched = false; break; }
        for (const { selection, selected } of selectionStates) {
          if (selection.resetEdgeIds.has(edge.id)) selected.clear();
          if (selection.selectEdgeIds.has(edge.id)) selected.add(edge.id);
          if ((edge.id === selection.finishEdgeId || edge.id === selection.confirmEdgeId) && selected.size < selection.minSelected) {
            add('SCENARIO_SELECTION_EMPTY', flow.id, scenario.id); matched = false;
          }
        }
        if (!matched) break;
        if (edge.kind === 'pending') {
          pending = true;
          if (index !== scenario.edgeIds.length - 1) { add('SCENARIO_PENDING_CONTINUES', flow.id, scenario.id); matched = false; }
          break;
        }
        current = edge.to;
      }
      const kind = nodes.get(current)?.kind;
      const outcome = pending ? 'pending' : kind === 'terminal' ? 'terminal' : kind === 'wait' ? 'waiting' : 'active';
      if (matched && outcome !== scenario.expectedOutcome) { add('SCENARIO_OUTCOME', flow.id, scenario.id); matched = false; }
      scenarioResults.push({ flowId: flow.id, scenarioId: scenario.id, status: matched ? 'matched' : 'invalid', outcome });
    }
  }
  const structurallyInvalid = issues.some(issue => !['PENDING_EDGE', 'PROPOSED_EDGE', 'PROPOSED_NODE'].includes(issue.code));
  return { status: structurallyInvalid ? 'invalid' : businessPending ? 'needs-business-confirmation' : 'review-structure-complete',
    publishable: false, runtimeEnabled: false, selectionChecksApplied, sourceSha256: input.source.sha256, issues, counts, scenarioResults };
}

async function readInput(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_BYTES) throw new Error('INPUT_READ');
    const buffer = Buffer.alloc(Math.min(MAX_BYTES + 1, before.size + 1));
    let bytes = 0;
    while (bytes < buffer.length) {
      const part = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!part.bytesRead) break;
      bytes += part.bytesRead;
    }
    const after = await handle.stat();
    if (bytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('INPUT_READ');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes))); }
    catch { throw new Error('INPUT_JSON'); }
  } finally { await handle.close(); }
}

async function main(args) {
  if (args.length < 1 || args.length > 2) { console.log(JSON.stringify(invalid('USAGE'))); return 2; }
  let result;
  try { result = reviewSopStory(await readInput(args[0])); }
  catch (error) { result = invalid(error instanceof Error && error.message === 'INPUT_JSON' ? 'INPUT_JSON' : 'INPUT_READ'); }
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (args[1]) {
    try { await writeFile(args[1], json, { flag: 'wx', mode: 0o600 }); }
    catch { console.log(JSON.stringify(invalid('OUTPUT_WRITE'))); return 2; }
  } else console.log(json);
  return result.status === 'invalid' ? 2 : result.status === 'needs-business-confirmation' ? 3 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
