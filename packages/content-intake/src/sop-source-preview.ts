import ExcelJS from 'exceljs';
import type { InspectedSource } from './sop-source-inventory.js';

/** A generated inspection view only. Editing it does not change decisions. */
export async function createSyntheticSourcePreview(source: InspectedSource): Promise<Buffer> {
  const book = new ExcelJS.Workbook(), textSheet = book.addWorksheet('文字盘点预览'), imageSheet = book.addWorksheet('图片盘点预览');
  textSheet.addRow(['合成盘点：仅预览', null, '编辑不会回写决策；点击可查看长文本', null,
    `来源 SHA-256：${source.inventory.sourceSha256}`]);
  textSheet.addRow(['工作表', '单元格或位置', '原文或说明', '类型', '合并范围', '来源对象 ID']);
  imageSheet.addRow(['合成图片：仅预览', null, '请勿排序或筛选图片表', null,
    `来源 SHA-256：${source.inventory.sourceSha256}`, null, '图片未完整解码；预览比例可能与原表不同']);
  imageSheet.addRow(['工作表', '起锚位置', '图片预览', '类型', '来源对象 ID', '图片 SHA-256', '待核对']);
  for (const [sheet, widths] of [[textSheet, [20, 22, 60, 14, 18, 22]], [imageSheet, [20, 22, 20, 14, 22, 68, 50]]] as const) {
    widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(2).font = { bold: true };
  }
  const imageIds = new Map<string, number>();
  for (const item of source.inventory.objects) {
    const merge = item.kind === 'text'
      ? source.inventory.sheets.find(value => value.name === item.sheet)?.merges.find(value => value.split(':')[0] === item.cell) ?? '' : '';
    const position = item.kind === 'image' && item.position?.from.row !== undefined && item.position.from.col !== undefined
      ? `第 ${item.position.from.row + 1} 行，第 ${item.position.from.col + 1} 列`
      : item.kind === 'image' ? item.location
      : item.kind === 'text' ? item.cell : item.location;
    const detail = item.kind === 'text' ? item.text : item.kind === 'unsupported'
      ? [item.reason, item.rawText].filter(value => value !== undefined).join('\n') : '';
    const label = item.kind === 'text' ? '文字' : item.kind === 'image' ? '图片' : item.kind === 'background' ? '背景' : '待核对';
    if (item.kind === 'image' || item.kind === 'background') {
      const row = imageSheet.addRow([item.sheet, position, null, label, item.id, item.sha256, item.reviewWarnings.join('\n')]);
      row.eachCell((cell, column) => { cell.alignment = { vertical: 'top', wrapText: column === 7 }; });
      const bytes = source.images.get(item.id);
      if (!bytes) throw new Error('MISSING_IMAGE_BYTES');
      const key = `${item.extension}:${item.sha256}`;
      let imageId = imageIds.get(key);
      if (imageId === undefined) {
        imageId = book.addImage({ buffer: new Uint8Array(bytes).buffer, extension: item.extension });
        imageIds.set(key, imageId);
      }
      const scale = Math.min(96 / item.width, 72 / item.height, 1);
      row.height = 60;
      imageSheet.addImage(imageId, { tl: { col: 2, row: row.number - 1 },
        ext: { width: Math.max(1, item.width * scale), height: Math.max(1, item.height * scale) } });
    } else {
      const row = textSheet.addRow([item.sheet || null, position, detail || null, label, merge || null, item.id]);
      row.eachCell((cell, column) => { cell.alignment = { vertical: 'top', wrapText: column === 3 }; });
      if (detail) {
        const lines = detail.split(/\r\n|\r|\n/u).reduce((count, line) => count + Math.max(1, Math.ceil(Array.from(line).length / 35)), 0);
        row.height = Math.min(120, Math.max(20, 15 * lines));
      }
    }
  }
  textSheet.autoFilter = { from: 'A2', to: `F${textSheet.rowCount}` };
  return Buffer.from(await book.xlsx.writeBuffer());
}
