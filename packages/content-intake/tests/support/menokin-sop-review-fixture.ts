import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  MENOKIN_FLAT_SOP_WORKBOOK_HEADERS, MENOKIN_FLAT_SOP_WORKBOOK_SHEET_NAME, MENOKIN_SOP_REVIEW_VERSION,
  SOP_TASK_HEADERS, SOP_TASK_SHEETS, parseSopTaskWorkbook, prepareMenokinSopReview,
  type MenokinSopReviewRecord, type MenokinSopReviewedEntity, type MenokinSopAuthoringPlan,
  type MenokinSopSelection, type MenokinFlatSopColumn,
} from '@customer-agent/content-intake';
import { graphImageFixtures, syntheticTaskGraphWorkbook } from './sop-task-graph-workbook.js';

export async function syntheticFlatReviewSource(extraPending = false): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(MENOKIN_FLAT_SOP_WORKBOOK_SHEET_NAME);
  sheet.addRow([...MENOKIN_FLAT_SOP_WORKBOOK_HEADERS]);
  const images = [...graphImageFixtures.entries()];
  for (let index = 0; index < images.length + Number(extraPending); index++) {
    const values: Partial<Record<MenokinFlatSopColumn, string>> = {
      地区: '合成地区', 商业类型: '合成业务', 店铺: '合成店铺', 作用: `合成作用 ${index}`,
      SOP归属: '少错破SOP', 步骤: 'D1', 步骤说明: `合成源行 ${index}`,
      操作说明: index === 0 ? '  核实材料\r\n原句必须保留  ' : `合成操作 ${index}`,
      话术: index === 0 ? '内部提示。合成对客原文 A\n版本 1。内部备注。' : `合成话术 ${index}`,
      路径选择: '无', 字段: '无', 快捷语: '无', 类型判断: '合成类型识别，不是执行任务', 图片: '无',
    };
    sheet.addRow(MENOKIN_FLAT_SOP_WORKBOOK_HEADERS.map(header => values[header] ?? ''));
    const image = images[index]?.[1];
    if (image) {
      const imageId = book.addImage({ base64: image.bytes.toString('base64'), extension: image.extension });
      sheet.addImage(imageId, { tl: { col: 17, row: index + 1 }, ext: { width: 1, height: 1 } });
    }
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

export async function syntheticReviewRecord(bytes: Buffer, selection?: MenokinSopSelection): Promise<MenokinSopReviewRecord> {
  const initial = await prepareMenokinSopReview(bytes, selection ? { selection } : {});
  if (initial.kind !== 'needs-review') throw new Error('Expected fresh review report');
  const rows = initial.review.sourceRows, primary = rows[0];
  if (!primary) throw new Error('Synthetic source has no rows');
  const workbook = await parseSopTaskWorkbook(await syntheticTaskGraphWorkbook());
  const entities: MenokinSopReviewedEntity[] = [];
  const imageResources = [...graphImageFixtures.keys()];
  for (const sheet of SOP_TASK_SHEETS) for (const [index, row] of workbook.sheets[sheet].entries()) {
    const imageIndex = sheet === '资源与图片' ? imageResources.indexOf(row.values['资源编号'] ?? '') : -1;
    const source = imageIndex >= 0 ? rows[imageIndex] : primary;
    if (!source) throw new Error('Missing synthetic source row');
    const fields = Object.entries(row.values).filter(([column]) => !['维护状态', '业务确认人', '待确认事项'].includes(column)).map(([column, value]) => {
      if (sheet === '客户话术' && column === '对客正文' && row.values['话术编号'] === 'script-a') {
        const original = primary.cells.find(cell => cell.column === '话术')?.originalDisplayText ?? '';
        const start = original.indexOf(value);
        return { column, kind: 'source' as const, separator: '', excerpts: [{ rowId: primary.rowId, column: '话术' as const,
          start, end: start + value.length, text: value }] };
      }
      return { column, kind: 'reviewed' as const, value };
    });
    entities.push({ sheet, entityId: `entity-${SOP_TASK_SHEETS.indexOf(sheet)}-${index}`, rowIds: [source.rowId], maintenance: '启用', fields });
  }
  return {
    version: MENOKIN_SOP_REVIEW_VERSION, sourceSha256: initial.review.sourceSha256, targetDigest: initial.review.targetDigest,
    reviewer: '合成负责人自审', reviewedAt: '2026-11-15T00:00:00.000Z', basis: '合成负责人明确审核完整流程及关联，结构化明确值均属于本次审核', entities,
    rows: rows.map(row => {
      const entityIds = entities.filter(entity => entity.rowIds.includes(row.rowId)).map(entity => entity.entityId);
      return entityIds.length ? { rowId: row.rowId, kind: 'mapped' as const, entityIds }
        : { rowId: row.rowId, kind: 'pending' as const, reason: '合成未确认补偿与店铺全称' };
    }), holds: [],
    images: imageResources.map((resourceId, index) => ({ resourceId, rowId: rows[index]?.rowId ?? '',
      contentSha256: createHash('sha256').update(graphImageFixtures.get(resourceId)?.bytes ?? '').digest('hex') })),
  };
}

/** Synthetic test writer. Production authoring remains the external reviewed workflow. */
export async function syntheticReviewPlanWorkbook(plan: Pick<MenokinSopAuthoringPlan, 'tables' | 'imageBindings'>): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const sheetName of SOP_TASK_SHEETS) {
    const sheet = book.addWorksheet(sheetName);
    sheet.addRow([...SOP_TASK_HEADERS[sheetName]]);
    for (const row of plan.tables[sheetName]) {
      const written = sheet.addRow(SOP_TASK_HEADERS[sheetName].map(column => row.values[column] ?? ''));
      const binding = plan.imageBindings.find(binding => binding.resourceId === row.values['资源编号']);
      if (sheetName === '资源与图片' && binding) {
        const fixture = graphImageFixtures.get(binding.resourceId);
        if (!fixture || createHash('sha256').update(fixture.bytes).digest('hex') !== binding.contentSha256) throw new Error('Missing exact synthetic media');
        const imageId = book.addImage({ base64: fixture.bytes.toString('base64'), extension: fixture.extension });
        sheet.addImage(imageId, { tl: { col: 6, row: written.number - 1 }, ext: { width: 1, height: 1 } });
      }
    }
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

export function withSyntheticIndependentFlow(record: MenokinSopReviewRecord, rowId: string,
  flowId = 'flow-other'): MenokinSopReviewRecord {
  const flow = record.entities.find(entity => entity.sheet === '场景目录');
  const terminal = record.entities.find(entity => entity.sheet === '执行任务'
    && entity.fields.some(field => field.column === '任务类型' && field.kind === 'reviewed' && field.value === '结束'));
  if (!flow || !terminal) throw new Error('Missing synthetic flow templates');
  const taskId = `${flowId}-end`;
  const clone = (entity: MenokinSopReviewedEntity, entityId: string): MenokinSopReviewedEntity => ({
    ...entity, entityId, rowIds: [rowId], fields: entity.fields.map(field => {
      const replacements: Record<string, string> = {
        场景编号: flowId, 起始任务编号: taskId, 任务编号: taskId, 关联知识编号: '[]', 关联资源编号: '[]',
      };
      return field.column in replacements ? { column: field.column, kind: 'reviewed', value: replacements[field.column] ?? '' } : field;
    }),
  });
  const entities = [clone(flow, `${flowId}-header`), clone(terminal, `${flowId}-terminal`)];
  return { ...record, entities: [...record.entities, ...entities], rows: record.rows.map(row => row.rowId === rowId
    ? { rowId, kind: 'mapped', entityIds: [...(row.kind === 'mapped' ? row.entityIds : []), ...entities.map(entity => entity.entityId)] } : row) };
}

export function withSyntheticTaskRowDependency(record: MenokinSopReviewRecord,
  kind: '确认项' | '话术引用', column: '关联知识编号' | '关联资源编号') {
  const owner = record.entities.find(entity => entity.sheet === '执行任务'
    && entity.fields.some(field => field.column === '记录类型' && field.kind === 'reviewed' && field.value === kind));
  const sheet = column === '关联知识编号' ? '知识与案例' : '资源与图片';
  const idColumn = column === '关联知识编号' ? '知识编号' : '资源编号';
  const templateId = column === '关联知识编号' ? 'knowledge-a' : 'document-a';
  const template = record.entities.find(entity => entity.sheet === sheet
    && entity.fields.some(field => field.column === idColumn && field.kind === 'reviewed' && field.value === templateId));
  if (!owner || !template) throw new Error('Missing synthetic dependency templates');
  const dependencyId = `${templateId}-subrow`, dependency = {
    ...template, entityId: `${template.entityId}-subrow`, rowIds: owner.rowIds,
    fields: template.fields.map(field => field.column === idColumn ? { column: field.column, kind: 'reviewed' as const, value: dependencyId }
      : field.column === '关联资源编号' ? { column: field.column, kind: 'reviewed' as const, value: '[]' } : field),
  };
  const review: MenokinSopReviewRecord = {
    ...record, entities: [...record.entities.map(entity => entity.entityId === owner.entityId ? {
      ...entity, fields: entity.fields.map(field => field.column === column
        ? { column, kind: 'reviewed' as const, value: JSON.stringify([dependencyId]) } : field),
    } : entity), dependency],
    rows: record.rows.map(row => row.kind === 'mapped' && owner.rowIds.includes(row.rowId)
      ? { ...row, entityIds: [...row.entityIds, dependency.entityId] } : row),
  };
  return { review, owner, dependencyId, dependency };
}
