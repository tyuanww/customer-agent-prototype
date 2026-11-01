import ExcelJS from 'exceljs';
import { SOP_MAINTENANCE_HEADERS, createSopMaintenanceTemplate } from '../../src/maintenance.js';

export type AuthoringSheet = keyof typeof SOP_MAINTENANCE_HEADERS;
export type AuthoringRecord = Readonly<{ sheet: AuthoringSheet; fields: Readonly<Record<string, string>> }>;

/** Real XLSX round trips for cross-package synthetic integration tests only. */
export async function writeAuthoringWorkbook(records: readonly AuthoringRecord[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const template = await createSopMaintenanceTemplate();
  await book.xlsx.load(new Uint8Array(template).buffer);
  for (const record of records) {
    const sheet = book.getWorksheet(record.sheet);
    if (!sheet) throw new Error('Missing authoring sheet');
    sheet.addRow(SOP_MAINTENANCE_HEADERS[record.sheet].map(header => record.fields[header] ?? ''));
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

export async function readAuthoringWorkbook(bytes: Buffer): Promise<AuthoringRecord[]> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(bytes).buffer);
  const records: AuthoringRecord[] = [];
  for (const name of ['场景目录', '执行任务', '判断分支', '客户话术', '知识与案例', '资源与图片'] satisfies AuthoringSheet[]) {
    const sheet = book.getWorksheet(name);
    if (!sheet) throw new Error('Missing authoring sheet');
    sheet.eachRow((row, number) => {
      if (number < 3) return;
      const fields: Record<string, string> = {};
      SOP_MAINTENANCE_HEADERS[name].forEach((header, index) => {
        const value = row.getCell(index + 1).value;
        if (value !== null && typeof value !== 'string') throw new Error('Expected text');
        fields[header] = value ?? '';
      });
      records.push({ sheet: name, fields });
    });
  }
  return records;
}
