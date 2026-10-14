import { writeFile } from 'node:fs/promises';
import { serializeUsageLogCsv, usageRowIsExportable, type UsageSourceRow } from '../shared/usage-log-csv';

/** Main-process entry for a confirmed usage export. It does not invent rows. */
export async function saveUsageLogCsv(filePath: string, rows: readonly UsageSourceRow[]): Promise<{ written: number }> {
  const written = rows.filter(usageRowIsExportable).length;
  await writeFile(filePath, serializeUsageLogCsv(rows), 'utf8');
  return { written };
}
