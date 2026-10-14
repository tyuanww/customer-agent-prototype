import { writeFileSync } from 'node:fs';
import { serializeUsageLogCsv, usageRowIsExportable, type UsageSourceRow } from '../shared/usage-log-csv';

/** Main-process entry for a confirmed usage export. It does not invent rows. */
export function saveUsageLogCsv(filePath: string, rows: readonly UsageSourceRow[]): { written: number } {
  const written = rows.filter(usageRowIsExportable).length;
  writeFileSync(filePath, serializeUsageLogCsv(rows), 'utf8');
  return { written };
}
