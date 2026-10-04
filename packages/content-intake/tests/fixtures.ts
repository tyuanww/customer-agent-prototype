import ExcelJS from 'exceljs';
import { createTemplate, TEMPLATE_VERSION, type ParseContext } from '@customer-agent/content-intake';
export const context: ParseContext = { sourceId: 'synthetic-source', brandId: 'synthetic-brand', scope: 'shop-a', domain: 'product', sheet: 'FAQ', templateVersion: TEMPLATE_VERSION };
export const sampleRows = [
  ['faq-001', '合成快捷短语一', '第一行：核对合成资料。\n第二行：由坐席人工选择。', '', '', '合成分类', '', '启用', '', '', '', '', '', '', 'false'],
  ['faq-002', '合成快捷短语二', '请确认合成示例说明。', '', '', '合成分类', '', '启用', '', '', '', '', '', '', 'false'],
];
export async function fixture(options: { missingC3?: boolean; count?: number; richExcluded?: boolean } = {}): Promise<Buffer> {
  const rows = options.count ? Array.from({ length: options.count }, (_, i) => [...sampleRows[i % 2]!.map((s) => s),].map((s, col) => col === 0 ? `faq-${i + 1}` : s)) : structuredClone(sampleRows);
  if (options.missingC3) rows[1]![2] = '';
  const bytes = await createTemplate(context, rows);
  if (!options.richExcluded) return bytes;
  const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const internal = book.addWorksheet('内部资源（合成排除）');
  internal.mergeCells('A1:C2'); internal.getCell('A1').value = '合成内部资源';
  const imageId = book.addImage({ base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=', extension: 'png' });
  for (let i = 0; i < 8; i++) internal.addImage(imageId, { tl: { col: i % 4, row: Math.floor(i / 4) + 2 }, ext: { width: 1, height: 1 } });
  return Buffer.from(await book.xlsx.writeBuffer());
}
