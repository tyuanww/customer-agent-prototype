import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  SOP_AUTHORING_SHEET_NAMES,
  createSopAuthoringPreview,
  materializeSopReleaseFacts,
  parseSopAuthoringWorkbook,
  type SopAuthoringParseContext,
} from '@customer-agent/content-intake';

const context: SopAuthoringParseContext = {
  sourceId: 'synthetic-sop-source',
  brandId: 'synthetic-brand',
  scope: 'synthetic-shop',
  scopeKind: 'shop',
};

type WorkbookOptions = {
  steps?: readonly (readonly string[])[];
  branches?: readonly (readonly string[])[];
  messages?: readonly (readonly string[])[];
  resources?: readonly (readonly string[])[];
  searchEntries?: readonly (readonly string[])[];
};

function addTable(
  book: ExcelJS.Workbook,
  sheetName: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): void {
  const sheet = book.addWorksheet(sheetName);
  sheet.addRow([...headers]);
  rows.forEach((row) => {
    const added = sheet.addRow([...row]);
    row.forEach((value, index) => {
      if (value.startsWith('=DISPIMG(')) {
        added.getCell(index + 1).value = { formula: value.slice(1), result: '' };
      }
    });
  });
}

async function workbook(options: WorkbookOptions = {}): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  addTable(book, 'SOP场景', ['场景编码', 'SOP编码', 'SOP类型', '标题', '起始步骤'], [
    ['synthetic-allergy', 'synthetic-allergy', 'allergy', '合成过敏流程', 'step1'],
  ]);
  addTable(book, 'SOP步骤', [
    'SOP编码', '节点编码', '节点类型', '顺序', '父节点', '下一节点', '跳转目标', '标题', '说明',
  ], options.steps ?? [
    ['synthetic-allergy', 'step1', 'ordered', '1', '', 'step2', '', '步骤一', '合成说明'],
    ['synthetic-allergy', 'step2', 'ordered', '2', '', 'step3', '', '步骤二', '合成说明'],
    ['synthetic-allergy', 'step3', 'ordered', '3', '', '', '', '步骤三', '合成说明'],
    ['synthetic-allergy', 'A', 'decision', '4', 'step3', '', '', '分支 A', '由坐席选择'],
    ['synthetic-allergy', 'B', 'decision', '5', 'step3', '', '', '分支 B', '由坐席选择'],
    ['synthetic-allergy', 'C', 'decision', '6', 'step3', '', '', '分支 C', '由坐席选择'],
    ['synthetic-allergy', 'A1', 'execution', '7', 'A', '', '', '执行 A1', '合成说明'],
    ['synthetic-allergy', 'B1', 'execution', '8', 'B', '', '', '执行 B1', '合成说明'],
    ['synthetic-allergy', 'C1', 'execution', '9', 'C', '', '', '执行 C1', '合成说明'],
  ]);
  addTable(book, 'SOP分支', ['SOP编码', '分支编码', '决策节点', '标签', '目标节点'], options.branches ?? [
    ['synthetic-allergy', 'branch-a', 'A', '走 A', 'A1'],
    ['synthetic-allergy', 'branch-b', 'B', '走 B', 'B1'],
    ['synthetic-allergy', 'branch-c', 'C', '走 C', 'C1'],
  ]);
  addTable(book, 'SOP话术', ['SOP编码', '话术编码', '步骤编码', '正文', '风险级别'], options.messages ?? [
    ['synthetic-allergy', 'message-step1', 'step1', '第一步合成话术', 'low'],
    ['synthetic-allergy', 'message-step2', 'step2', '第二步合成话术', 'medium'],
    ['synthetic-allergy', 'message-step3', 'step3', '第三步合成话术', 'high'],
    ['synthetic-allergy', 'message-a1', 'A1', '分支合成话术', 'medium'],
    ['synthetic-allergy', 'message-b1', 'B1', '分支 B 合成话术', 'medium'],
    ['synthetic-allergy', 'message-c1', 'C1', '分支 C 合成话术', 'medium'],
  ]);
  addTable(book, 'SOP资源', ['SOP编码', '资源编码', '步骤编码', '图片公式', '序号', '说明'], options.resources ?? []);
  addTable(book, 'SOP搜索词', ['SOP编码', '词条编码', '步骤编码', '用途', '文本'], options.searchEntries ?? [
    ['synthetic-allergy', 'classify-allergy', 'step1', 'classify', '过敏流程'],
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe('normalized SOP authoring workbook', () => {
  it('parses the normalized entity tables without an entry-code-shaped static tree', async () => {
    const result = await parseSopAuthoringWorkbook(await workbook(), context);
    expect(result.ok).toBe(true);
    expect(result.document?.definitions).toHaveLength(1);
    const definition = result.document!.definitions[0]!;
    expect(definition.groupId).toBe('allergy');
    expect(definition.steps.filter((step) => step.kind === 'ordered').map((step) => step.sequence)).toEqual([1, 2, 3]);
    expect(definition.messages).toHaveLength(6);
    expect(definition.searchEntries).toEqual([
      expect.objectContaining({ purpose: 'classify', text: '过敏流程', stepId: 'step1' }),
    ]);
    const release = materializeSopReleaseFacts(result.document!, 'rel_synthetic_content', null);
    expect(release.projection.severityOrder).toBeNull();
    expect(release.projection.indexHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => materializeSopReleaseFacts(
      result.document!,
      'rel_synthetic_content',
      ['allergy'],
    )).toThrow('SOP_SEVERITY_ORDER_INVALID');
  });

  it('rejects a D/E node without an operator-supplied semantic classification', async () => {
    const bytes = await workbook({
      steps: [
        ['synthetic-allergy', 'step1', 'ordered', '1', '', 'step2', '', '步骤一', '合成说明'],
        ['synthetic-allergy', 'step2', 'ordered', '2', '', 'step3', '', '步骤二', '合成说明'],
        ['synthetic-allergy', 'step3', 'ordered', '3', '', '', '', '步骤三', '合成说明'],
        ['synthetic-allergy', 'D1', '', '4', 'step3', '', '', '待业务确认', ''],
      ],
      messages: [
        ['synthetic-allergy', 'message-step1', 'step1', '第一步合成话术', 'low'],
        ['synthetic-allergy', 'message-step2', 'step2', '第二步合成话术', 'low'],
        ['synthetic-allergy', 'message-step3', 'step3', '第三步合成话术', 'low'],
      ],
    });
    const result = await parseSopAuthoringWorkbook(bytes, context);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'SOP_GATE_B_UNRESOLVED',
      nodeId: 'D1',
    }));
    expect(result.document).toBeNull();
  });

  it('accepts explicit synthetic D/E semantics without assigning business meaning in code', async () => {
    const bytes = await workbook({
      steps: [
        ['synthetic-allergy', 'step1', 'ordered', '1', '', 'step2', '', '步骤一', '合成说明'],
        ['synthetic-allergy', 'step2', 'ordered', '2', '', 'step3', '', '步骤二', '合成说明'],
        ['synthetic-allergy', 'step3', 'ordered', '3', '', '', '', '步骤三', '合成说明'],
        ['synthetic-allergy', 'D1', 'decision', '4', 'step3', '', '', '合成 D1', '仅测机制'],
        ['synthetic-allergy', 'D2', 'execution', '5', 'D1', '', '', '合成 D2', '仅测机制'],
        ['synthetic-allergy', 'DS', 'jump', '6', '', '', 'D2', '合成跳转', '仅测机制'],
        ['synthetic-allergy', 'E1', 'terminal', '7', '', '', '', '合成终止', '仅测机制'],
      ],
      branches: [['synthetic-allergy', 'branch-d1', 'D1', '合成分支', 'D2']],
      messages: [
        ['synthetic-allergy', 'message-step1', 'step1', '第一步合成话术', 'low'],
        ['synthetic-allergy', 'message-step2', 'step2', '第二步合成话术', 'low'],
        ['synthetic-allergy', 'message-step3', 'step3', '第三步合成话术', 'low'],
        ['synthetic-allergy', 'message-d2', 'D2', 'D2 合成话术', 'low'],
      ],
    });
    const result = await parseSopAuthoringWorkbook(bytes, context);
    expect(result.ok).toBe(true);
    expect(result.document?.definitions[0]?.steps.find((step) => step.stepId === 'D1')?.kind).toBe('decision');
    expect(result.document?.definitions[0]?.steps.find((step) => step.stepId === 'DS')).toMatchObject({
      kind: 'jump',
      targetStepId: 'D2',
    });
  });

  it('rejects cycles, dangling branch targets, duplicate nodes, missing messages, and wrong top-level order', async () => {
    const cycle = await parseSopAuthoringWorkbook(await workbook({
      steps: [
        ['synthetic-allergy', 'step1', 'ordered', '1', '', 'step2', '', '步骤一', ''],
        ['synthetic-allergy', 'step2', 'ordered', '2', '', 'step1', '', '步骤二', ''],
        ['synthetic-allergy', 'step3', 'ordered', '3', '', '', '', '步骤三', ''],
      ],
      branches: [],
      messages: [
        ['synthetic-allergy', 'message-step1', 'step1', '第一步', 'low'],
        ['synthetic-allergy', 'message-step2', 'step2', '第二步', 'low'],
        ['synthetic-allergy', 'message-step3', 'step3', '第三步', 'low'],
      ],
    }), context);
    expect(cycle.issues).toContainEqual(expect.objectContaining({ code: 'SOP_CYCLE' }));

    const dangling = await parseSopAuthoringWorkbook(await workbook({
      branches: [['synthetic-allergy', 'branch-a', 'A', '走 A', 'missing-step']],
    }), context);
    expect(dangling.issues).toContainEqual(expect.objectContaining({ code: 'SOP_DANGLING_TARGET' }));

    const duplicate = await parseSopAuthoringWorkbook(await workbook({
      steps: [
        ['synthetic-allergy', 'step1', 'ordered', '1', '', 'step2', '', '步骤一', ''],
        ['synthetic-allergy', 'step2', 'ordered', '2', '', 'step3', '', '步骤二', ''],
        ['synthetic-allergy', 'step3', 'ordered', '3', '', '', '', '步骤三', ''],
        ['synthetic-allergy', 'A', 'decision', '4', 'step3', '', '', 'A', ''],
        ['synthetic-allergy', 'A', 'decision', '5', 'step3', '', '', 'A 重复', ''],
      ],
      branches: [],
      messages: [
        ['synthetic-allergy', 'message-step1', 'step1', '第一步', 'low'],
        ['synthetic-allergy', 'message-step2', 'step2', '第二步', 'low'],
        ['synthetic-allergy', 'message-step3', 'step3', '第三步', 'low'],
      ],
    }), context);
    expect(duplicate.issues).toContainEqual(expect.objectContaining({ code: 'SOP_DUPLICATE_NODE' }));

    const missingMessage = await parseSopAuthoringWorkbook(await workbook({
      messages: [
        ['synthetic-allergy', 'message-step1', 'step1', '第一步', 'low'],
        ['synthetic-allergy', 'message-step2', 'step2', '第二步', 'low'],
        ['synthetic-allergy', 'message-step3', 'step3', '第三步', 'low'],
      ],
    }), context);
    expect(missingMessage.issues).toContainEqual(expect.objectContaining({
      code: 'SOP_MISSING_MESSAGE',
      nodeId: 'A1',
    }));

    const wrongOrder = await parseSopAuthoringWorkbook(await workbook({
      steps: [
        ['synthetic-allergy', 'step1', 'ordered', '1', '', 'step3', '', '步骤一', ''],
        ['synthetic-allergy', 'step2', 'ordered', '2', '', 'step3', '', '步骤二', ''],
        ['synthetic-allergy', 'step3', 'ordered', '3', '', '', '', '步骤三', ''],
        ['synthetic-allergy', 'A', 'decision', '4', 'step3', '', '', 'A', ''],
      ],
      branches: [],
      messages: [
        ['synthetic-allergy', 'message-step1', 'step1', '第一步', 'low'],
        ['synthetic-allergy', 'message-step2', 'step2', '第二步', 'low'],
        ['synthetic-allergy', 'message-step3', 'step3', '第三步', 'low'],
      ],
    }), context);
    expect(wrongOrder.issues).toContainEqual(expect.objectContaining({ code: 'SOP_STEP_ORDER' }));

    const wrongDecision = await parseSopAuthoringWorkbook(await workbook({
      steps: [
        ['synthetic-allergy', 'step1', 'ordered', '1', '', 'step2', '', '步骤一', ''],
        ['synthetic-allergy', 'step2', 'ordered', '2', '', 'step3', '', '步骤二', ''],
        ['synthetic-allergy', 'step3', 'ordered', '3', '', '', '', '步骤三', ''],
        ['synthetic-allergy', 'A', 'execution', '4', 'step3', '', '', 'A', ''],
      ],
      branches: [],
      messages: [
        ['synthetic-allergy', 'message-step1', 'step1', '第一步', 'low'],
        ['synthetic-allergy', 'message-step2', 'step2', '第二步', 'low'],
        ['synthetic-allergy', 'message-step3', 'step3', '第三步', 'low'],
        ['synthetic-allergy', 'message-a', 'A', 'A 合成话术', 'low'],
      ],
    }), context);
    expect(wrongDecision.issues).toContainEqual(expect.objectContaining({
      code: 'SOP_NODE_TYPE_INVALID',
      nodeId: 'A',
    }));
  });

  it('rejects workbook headers that differ from the normalized schema', async () => {
    const book = new ExcelJS.Workbook();
    for (const sheetName of SOP_AUTHORING_SHEET_NAMES) book.addWorksheet(sheetName);
    book.getWorksheet('SOP场景')!.addRow(['错误表头']);
    const result = await parseSopAuthoringWorkbook(Buffer.from(await book.xlsx.writeBuffer()), context);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'SOP_HEADER_MISMATCH' }));
  });

  it('rejects child facts owned by an unknown SOP and duplicate normalized facts', async () => {
    const unknownOwner = await parseSopAuthoringWorkbook(await workbook({
      messages: [
        ['synthetic-allergy', 'message-step1', 'step1', '第一步', 'low'],
        ['synthetic-allergy', 'message-step2', 'step2', '第二步', 'low'],
        ['synthetic-allergy', 'message-step3', 'step3', '第三步', 'low'],
        ['synthetic-allergy', 'message-a1', 'A1', '分支', 'low'],
        ['unregistered-sop', 'message-orphan', 'step1', '孤立', 'low'],
      ],
    }), context);
    expect(unknownOwner.issues).toContainEqual(expect.objectContaining({
      code: 'SOP_UNKNOWN_OWNER',
      sheet: 'SOP话术',
      nodeId: 'unregistered-sop',
    }));

    const duplicateSequence = await parseSopAuthoringWorkbook(await workbook({
      steps: [
        ['synthetic-allergy', 'step1', 'ordered', '1', '', 'step2', '', '步骤一', ''],
        ['synthetic-allergy', 'step2', 'ordered', '1', '', 'step3', '', '步骤二', ''],
        ['synthetic-allergy', 'step3', 'ordered', '3', '', '', '', '步骤三', ''],
        ['synthetic-allergy', 'A', 'decision', '4', 'step3', '', '', 'A', ''],
      ],
      branches: [],
      messages: [
        ['synthetic-allergy', 'message-step1', 'step1', '第一步', 'low'],
        ['synthetic-allergy', 'message-step2', 'step2', '第二步', 'low'],
        ['synthetic-allergy', 'message-step3', 'step3', '第三步', 'low'],
      ],
    }), context);
    expect(duplicateSequence.issues).toContainEqual(expect.objectContaining({
      code: 'SOP_STEP_ORDER',
      nodeId: 'step2',
    }));
  });

  it('binds a WPS DISPIMG image to the exact normalized step', async () => {
    const bytes = await workbook({
      resources: [
        ['synthetic-allergy', 'resource-a1', 'A1', '=DISPIMG("ID_IMAGE_1",1)', '1', '合成图片'],
      ],
    });
    const zip = await JSZip.loadAsync(bytes);
    zip.file('xl/cellimages.xml', `<?xml version="1.0" encoding="UTF-8"?>
<etc:cellImages xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData"
 xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <etc:cellImage><xdr:pic>
    <xdr:nvPicPr><xdr:cNvPr id="1" name="ID_IMAGE_1" descr="合成图片"/></xdr:nvPicPr>
    <xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill>
  </xdr:pic></etc:cellImage>
</etc:cellImages>`);
    zip.file('xl/_rels/cellimages.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    Target="media/synthetic.png"/>
</Relationships>`);
    zip.file('xl/media/synthetic.png', Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=',
      'base64',
    ));
    const result = await parseSopAuthoringWorkbook(
      await zip.generateAsync({ type: 'nodebuffer' }),
      context,
    );
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.images).toHaveLength(1);
    expect(result.document?.definitions[0]?.resources).toEqual([
      expect.objectContaining({
        resourceId: 'resource-a1',
        stepId: 'A1',
        mediaId: result.images[0]!.id,
      }),
    ]);
    const preview = createSopAuthoringPreview(result.document!, result.images);
    expect(preview.scenes[0]?.steps.find((step) => step.stepId === 'A1')?.resources).toEqual([
      expect.objectContaining({
        mediaId: result.images[0]!.id,
        mime: 'image/png',
        sheet: 'SOP资源',
        row: 2,
        column: 'D',
      }),
    ]);
    expect(JSON.stringify(preview)).not.toContain('"data"');
  });
});
