import { describe, expect, it } from 'vitest';
import { findSopEntries, relatedSyntheticSopEntries } from '../../src/shared/sop-entry';
import { advanceSopNext, chooseSopEdge, projectSop, projectSopManualImages, sopScriptCopyable, startSopProgress, validateSopTree, type SopNode, type SopTree } from '../../src/shared/sop-model';
import { ALLERGY_SOP_TREE, MISSING_ITEM_SOP_TREE, SYNTHETIC_SOP_TREES } from '../../src/shared/synthetic-sops';
import { isSyntheticSopImage, isSopManualImageProjections, isSopProjection, isSopWindowResult, isQuerySopCommand, isQuerySopCopyRequest, matchSopChoices } from '../../src/shared/sop-window';

const content = { title: '任务', instruction: '核实信息', stageLabel: '核实', scripts: [], requirements: [], knowledge: [] };
function tree(nodes: readonly SopNode[]): SopTree {
  return { sceneId: 'test', sceneTitle: '测试', stageLabel: '阶段', version: 'synthetic-1', startNodeId: 'a', nodes };
}
describe('SOP scenarios and graph', () => {
  it('recognizes multiple candidates without choosing one for the user', () => {
    expect(findSopEntries('过敏了怎么办还有少件')).toHaveLength(2);
    expect(findSopEntries('怎么用过敏')).toEqual([]);
    expect(findSopEntries('这次包裹漏发')).toEqual([{ sceneId: MISSING_ITEM_SOP_TREE.sceneId, title: '少件处理' }]);
  });
  it('links stable synthetic IDs only within the matched query entries', () => {
    const entries = findSopEntries('过敏了怎么办还有少件');
    expect(relatedSyntheticSopEntries({ scriptId: 'syn-after-002', entries })).toEqual([
      { sceneId: ALLERGY_SOP_TREE.sceneId, title: '过敏流程' },
    ]);
    expect(relatedSyntheticSopEntries({ scriptId: 'syn-after-002', entries: findSopEntries('少件') })).toEqual([]);
    for (const scriptId of ['syn-pre-001', 'unknown', '__proto__']) {
      expect(relatedSyntheticSopEntries({ scriptId, entries })).toEqual([]);
    }
  });
  it('validates both synthetic scenarios', () => {
    SYNTHETIC_SOP_TREES.forEach(item => expect(() => validateSopTree(item)).not.toThrow());
  });
  it('rejects cycles, unreachable tasks, duplicate scripts and missing destinations', () => {
    expect(() => validateSopTree(tree([{ ...content, id: 'a', kind: 'action', nextId: 'a' }]))).toThrow(/cycle/);
    expect(() => validateSopTree(tree([{ ...content, id: 'a', kind: 'terminal' }, { ...content, id: 'b', kind: 'terminal' }]))).toThrow(/unreachable/);
    expect(() => validateSopTree(tree([{ ...content, id: 'a', kind: 'action', nextId: 'missing' }]))).toThrow(/target/);
    const script = { id: 'reply', title: '回复', answerText: '您好', condition: '核实信息时' };
    expect(() => validateSopTree(tree([{ ...content, id: 'a', kind: 'terminal', scripts: [script, script] }]))).toThrow(/duplicated/);
  });
  it('allows the same published wording in different tasks without conflicting bodies', () => {
    const script = { id: 'reply', title: '回复', answerText: '您好', condition: '初次核实' };
    const first: SopNode = { ...content, id: 'a', kind: 'action', nextId: 'b', scripts: [script] };
    const later: SopNode = { ...content, id: 'b', kind: 'terminal', scripts: [{ ...script, condition: '再次确认' }] };
    expect(() => validateSopTree(tree([first, later]))).not.toThrow();
    expect(() => validateSopTree(tree([first, { ...later, scripts: [{ ...script, answerText: '不同正文' }] }]))).toThrow(/conflicting content/);
  });
  it('rejects a branch with an implicit next path and refuses navigation even before validation', () => {
    const malformed = tree([{ ...content, id: 'a', kind: 'decision', edges: [{ id: 'yes', label: '是', criterion: '已核实', targetId: 'b', unableToDetermine: false, matchTerms: [] }] }, { ...content, id: 'b', kind: 'terminal' }]);
    const bad = { ...malformed, nodes: malformed.nodes.map(node => node.id === 'a' ? { ...node, nextId: 'b' } : node) };
    expect(() => validateSopTree(bad)).toThrow(/cannot have nextId/);
    expect(advanceSopNext(bad, startSopProgress(bad))).toBeNull();
    expect(chooseSopEdge(bad, startSopProgress(bad), 'yes')).toBeNull();
  });
  it('rejects excessive or empty decision edges', () => {
    expect(() => validateSopTree(tree([{ ...content, id: 'a', kind: 'decision', edges: [] }]))).toThrow(/2 to 4/);
  });
  it('requires one explicit unknown path for each decision', () => {
    const makeTree = (unknown: readonly boolean[]) => tree([
      { ...content, id: 'a', kind: 'decision', edges: unknown.map((value, index) => ({ id: `edge-${index}`, label: `选项${index}`, criterion: '核对情况', targetId: 'b', unableToDetermine: value, matchTerms: [] })) },
      { ...content, id: 'b', kind: 'terminal' },
    ]);
    expect(() => validateSopTree(makeTree([false, false]))).toThrow(/exactly one unknown/);
    expect(() => validateSopTree(makeTree([true, true]))).toThrow(/exactly one unknown/);
    expect(() => validateSopTree(makeTree([false, true]))).not.toThrow();
  });
});
describe('SOP task projection', () => {
  it('requires material checks and explicit selection among multiple scripts', () => {
    const value = projectSop({ tree: MISSING_ITEM_SOP_TREE, progress: startSopProgress(MISSING_ITEM_SOP_TREE), role: 'agent', taskId: 'test-task', revision: 1 });
    expect(isSopProjection(value)).toBe(true);
    expect(value.scripts).toHaveLength(2);
    expect(value.selectedScriptId).toBeNull();
    expect(value.canNext).toBe(false);
    expect(value.requirements.every(item => !item.checked)).toBe(true);
    expect(value.knowledge[0]?.body).toContain('分包');
    const checked = projectSop({ tree: MISSING_ITEM_SOP_TREE, progress: startSopProgress(MISSING_ITEM_SOP_TREE), role: 'agent', taskId: 'test-task', revision: 2, checked: new Set(['ordered', 'received']) });
    expect(checked.canNext).toBe(true);
  });
  it('projects task, knowledge and published wording images from their owning content', () => {
    const value = projectSop({ tree: MISSING_ITEM_SOP_TREE, progress: startSopProgress(MISSING_ITEM_SOP_TREE), role: 'agent', taskId: 'test-task', revision: 1 });
    const node = MISSING_ITEM_SOP_TREE.nodes.find(item => item.id === 'collect')!;
    expect(value.images).toEqual(node.images);
    expect(value.knowledge[0]?.images).toEqual(node.knowledge[0]?.images);
    expect(value.scripts[0]?.images).toEqual(node.scripts[0]?.images);
    const manual = projectSopManualImages([MISSING_ITEM_SOP_TREE]);
    expect(isSopManualImageProjections(manual)).toBe(true);
    expect(manual[0]).toMatchObject({ sceneId: value.sceneId, nodeId: value.nodeId, images: value.images });
    expect(manual[0]?.scripts[0]).toEqual({ scriptId: value.scripts[0]?.scriptId, images: value.scripts[0]?.images });
    expect(manual[0]?.knowledge[0]).toEqual({ id: value.knowledge[0]?.id, images: value.knowledge[0]?.images });
    const unavailable = projectSop({ tree: MISSING_ITEM_SOP_TREE, progress: startSopProgress(MISSING_ITEM_SOP_TREE), role: 'agent', taskId: 'test-task', revision: 1, published: new Set() });
    expect(unavailable.scripts[0]?.images).toEqual([]);
    expect(isSopProjection({ ...unavailable, scripts: [{ ...unavailable.scripts[0], images: value.scripts[0]?.images }, unavailable.scripts[1]] })).toBe(false);
  });
  it('accepts bounded raster images and rejects URLs, spoofed formats, bad dimensions, excess data and malformed ownership', () => {
    const value = projectSop({ tree: MISSING_ITEM_SOP_TREE, progress: startSopProgress(MISSING_ITEM_SOP_TREE), role: 'agent', taskId: 'test-task', revision: 1 });
    const png = value.images[0]!;
    const gif = { alt: '合成图片', dataUrl: 'data:image/gif;base64,R0lGODdhAgACAIEAAP///wAAAAAAAAAAACwAAAAAAgACAAAIBgABCAQQEAA7' };
    const jpeg = { alt: '合成图片', dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AD//Z' };
    expect(isSyntheticSopImage(png)).toBe(true);
    expect(isSyntheticSopImage(gif)).toBe(true);
    expect(isSyntheticSopImage(jpeg)).toBe(true);
    expect(isSopProjection({ ...value, images: [png, png] })).toBe(true);
    for (const dataUrl of ['https://example.com/image.png', 'file:///tmp/image.png', 'data:image/svg+xml;base64,PHN2Zy8+',
      png.dataUrl.replace('image/png', 'image/jpeg'), `${png.dataUrl}!`, `${png.dataUrl}==`, `data:image/png;base64,${'A'.repeat(128 * 1024)}`]) {
      expect(isSyntheticSopImage({ alt: '图片', dataUrl })).toBe(false);
    }
    const bytes = Uint8Array.from(atob(png.dataUrl.split(',')[1]!), char => char.charCodeAt(0));
    bytes.set([0, 0, 16, 0], 16);
    const oversized = { ...png, dataUrl: `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}` };
    expect(isSyntheticSopImage(oversized)).toBe(false);
    expect(isSopProjection({ ...value, images: [oversized] })).toBe(false);
    const gifBytes = Uint8Array.from(atob(gif.dataUrl.split(',')[1]!), char => char.charCodeAt(0));
    gifBytes[6] = 1; // The frame is still two pixels wide, outside the logical screen.
    expect(isSyntheticSopImage({ ...gif, dataUrl: `data:image/gif;base64,${btoa(String.fromCharCode(...gifBytes))}` })).toBe(false);
    expect(() => validateSopTree(tree([{ ...content, id: 'a', kind: 'terminal', images: [oversized] }]))).toThrow(/images are invalid/);
    expect(() => validateSopTree(tree([{ ...content, id: 'a', kind: 'terminal', images: [png, png, png, png] }]))).toThrow(/images are invalid/);
    const manyNodes: SopNode[] = Array.from({ length: 43 }, (_, index) => ({ ...content, id: index === 0 ? 'a' : `n${index}`,
      kind: 'action', nextId: `n${index + 1}`, images: [png, png, png] }));
    expect(() => validateSopTree(tree(manyNodes))).toThrow(/total limit/);
    const manual = projectSopManualImages([MISSING_ITEM_SOP_TREE]);
    expect(isSopManualImageProjections([...manual, manual[0]])).toBe(false);
    expect(isSopManualImageProjections([{ ...manual[0], url: 'https://example.com' }])).toBe(false);
    expect(isQuerySopCommand({ type: 'next', taskId: 'test-task', revision: 1, stepIndex: 1, dataUrl: png.dataUrl })).toBe(false);
  });
  it('keeps essential instructions visible while limiting manager notes', () => {
    const progress = { sceneId: MISSING_ITEM_SOP_TREE.sceneId, nodeId: 'escalate', stepIndex: 3 };
    const agent = projectSop({ tree: MISSING_ITEM_SOP_TREE, progress, role: 'agent', taskId: 'test-task', revision: 1 });
    const owner = projectSop({ tree: MISSING_ITEM_SOP_TREE, progress, role: 'owner', taskId: 'test-task', revision: 1 });
    expect(agent.prompt).toContain('提交');
    expect(agent.internalNote).toBeNull();
    expect(owner.internalNote).toContain('处理方案');
  });
  it('marks unavailable scripts without creating a copy target and blocks authoring placeholders', () => {
    const value = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'test-task', revision: 1, published: new Set() });
    expect(value.scripts[0]?.unpublished).toBe(true);
    for (const answerText of ['您好 {订单号}', '预计 {日期} 发出', '您好 {{姓名}}', '您好 ${姓名}', '您好 【待填写姓名】', '您好 {}', '您好 {{}}']) {
      expect(sopScriptCopyable({ id: 's', title: '回复', condition: '核实', answerText }, 'fixture')).toBe(false);
    }
    expect(sopScriptCopyable({ id: 's', title: '回复', condition: '核实', answerText: '您好，已为您核实。' }, 'fixture')).toBe(true);
  });
  it('matches only explicitly supplied terms of the current decision', () => {
    const edges = [
      { id: 'a', label: '选项 A', criterion: '人工核实', matchTerms: ['ＡＢＣ', '分包'] },
      { id: 'b', label: '选项 B', criterion: '人工核实', matchTerms: ['分包'] },
      { id: 'c', label: '无法判断', criterion: '信息不足', matchTerms: [] },
    ];
    expect([...matchSopChoices('  abc，分包  ', edges)]).toEqual([['a', ['ＡＢＣ', '分包']], ['b', ['分包']]]);
    expect([...matchSopChoices('没有线索', edges)]).toEqual([]);
    expect([...matchSopChoices('  ', edges)]).toEqual([]);
  });
  it('preserves authoring terms with spaces and supplementary Unicode characters', () => {
    const decision = tree([{ ...content, id: 'a', kind: 'decision', edges: [
      { id: 'yes', label: '有材料', criterion: '已核实', targetId: 'b', unableToDetermine: false, matchTerms: [' 原文 ', '😀'.repeat(128)] },
      { id: 'unknown', label: '无法判断', criterion: '资料不足', targetId: 'b', unableToDetermine: true, matchTerms: [] },
    ] }, { ...content, id: 'b', kind: 'terminal' }]);
    expect(() => validateSopTree(decision)).not.toThrow();
    const projection = projectSop({ tree: decision, progress: startSopProgress(decision), role: 'agent', taskId: 'test-task', revision: 1 });
    expect(isSopProjection(projection)).toBe(true);
    expect([...matchSopChoices('情况：原文', projection.edges)]).toEqual([['yes', [' 原文 ']]]);
    expect(isSopProjection({ ...projection, edges: [{ ...projection.edges[0], matchTerms: ['😀'.repeat(129)] }] })).toBe(false);
  });
  it('rejects extra fields, invalid copy targets and malformed nested projection data', () => {
    const value = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'test-task', revision: 1 });
    expect(isSopProjection({ ...value, selectedScriptId: 'other' })).toBe(false);
    expect(isSopProjection({ ...value, shellState: 'opening' })).toBe(false);
    expect(isSopProjection({ ...value, internalTask: '旧入口' })).toBe(false);
    expect(isSopWindowResult({ ok: false, code: 'SOP_LAYOUT_TIMEOUT', message: '旧窗口' })).toBe(false);
    expect(isSopWindowResult({ ok: false, code: 'FAILED', message: '流程没打开' })).toBe(true);
    expect(isSopProjection({ ...value, scripts: [{ ...value.scripts[0], productCopy: true }] })).toBe(false);
    expect(isSopProjection({ ...value, edges: [{ ...value.edges[0], matchTerms: [''] }] })).toBe(false);
    expect(isSopProjection({ ...value, history: [{ stepIndex: 1, nodeId: 'a', title: 'a' }] })).toBe(false);
    expect(isQuerySopCopyRequest({ taskId: 'test-task', revision: 1, stepIndex: 1, scriptId: 's', answerText: '注入' })).toBe(false);
    expect(isQuerySopCommand({ type: 'check', taskId: 'test-task', revision: 1, stepIndex: 1, requirementId: 'a', checked: 'yes' })).toBe(false);
  });
});
