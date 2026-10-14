import { parseSopWorkbook, SOP_SHEET_NAMES } from '@customer-agent/content-intake';
import type { LocalSopWorkbookParser } from '../shared/open-local-sop-workbook';

/** Adapter onto the candidate workbook parser. The context is local and is not a registered source. */
const LOCAL_CONTEXT = {
  sourceId: 'local-sop-workbook',
  brandId: 'local-brand',
  scope: 'local',
  scopeKind: 'brand' as const,
  selectedSheets: SOP_SHEET_NAMES,
};

export const parseLocalSopWorkbook: LocalSopWorkbookParser = async (bytes) => {
  const parsed = await parseSopWorkbook(bytes, LOCAL_CONTEXT);
  return { ok: parsed.ok, rows: parsed.rows, issues: parsed.issues };
};
