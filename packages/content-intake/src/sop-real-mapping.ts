/** Explicit, read-only mapping claims for the frozen Menokin single-sheet source.
 *
 * The workbook has no stable entry-code header. This contract therefore treats
 * every business identity, branch target, scope and ownership as an explicit
 * human claim. Physical row order and sheet names are evidence only.
 */
export const REAL_SOP_MAPPING_VERSION = 'menokin-single-sheet-mapping-v1' as const;
export const REAL_SOP_SOURCE_SHA256 = 'de81a688ff44aac00fe646b30806d750f9ebb6483dbf44fc939ed0a510ff2278' as const;
export const REAL_SOP_SHEETS = ['特殊流程 SOP'] as const;
export const REAL_SOP_STRUCTURE = Object.freeze({
  '特殊流程 SOP': { rowCount: 152, columnCount: 18, imageCount: 0 },
} satisfies Record<typeof REAL_SOP_SHEETS[number], Readonly<{ rowCount: number; columnCount: number; imageCount: number }>>);

export type MappingValue = Readonly<{ value: string; evidence: string }>;
export type RealSheetMapping = Readonly<{
  sheet: typeof REAL_SOP_SHEETS[number];
  rowCount: number;
  columnCount: number;
  imageCount: number;
  stableBusinessIds: readonly MappingValue[];
  entryTerms: readonly MappingValue[];
  branchTargets: readonly MappingValue[];
  unableToDeterminePaths: readonly MappingValue[];
  knowledgeOwnership: readonly MappingValue[];
  resourceOwnership: readonly MappingValue[];
  imageOwnership: readonly MappingValue[];
  applicability: readonly MappingValue[];
  visibility: readonly MappingValue[];
  effectiveInterval: Readonly<{ from: string; to: string | null; evidence: string }> | null;
}>;

/** Kept as a source-compatible type name for callers migrating from the legacy contract. */
export type RealSixSheetMapping = Readonly<{
  version: typeof REAL_SOP_MAPPING_VERSION;
  mappingState: 'candidate';
  mappingStatus: 'needs-business-confirmation' | 'ready-for-graph-preparation';
  publishable: false;
  sourcePath: string;
  sourceSha256: string;
  entryCodeHeaderPresent: false;
  sheets: readonly RealSheetMapping[];
}>;

export type RealMappingIssue = Readonly<{ sheet: string; field: string; reason: string }>;
export type RealMappingCheck = Readonly<{
  version: typeof REAL_SOP_MAPPING_VERSION;
  publishable: false;
  status: 'needs-business-confirmation' | 'ready-for-graph-preparation';
  issues: readonly RealMappingIssue[];
}>;

const sha256 = /^[0-9a-f]{64}$/u;
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
function validUtcTime(value: string): boolean {
  if (!iso.test(value)) return false;
  const instant = new Date(value);
  // Date parsing normalizes impossible dates and 24:00; preserve the authored calendar fields.
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 19) === value.slice(0, 19);
}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const placeholder = /(?:待业务确认|business-review:pending|\b(?:pending|tbd|todo)\b)/iu;

/** Validate only the explicit mapping claims; this never reads workbook bytes. */
export function checkRealSixSheetMapping(input: RealSixSheetMapping): RealMappingCheck {
  const issues: RealMappingIssue[] = [];
  const issue = (sheet: string, field: string, reason: string): void => { issues.push({ sheet, field, reason }); };
  if (input.version !== REAL_SOP_MAPPING_VERSION) issue('', 'version', 'mapping version is not supported');
  if (input.mappingState !== 'candidate') issue('', 'mappingState', 'real mapping must remain a candidate until graph preparation is approved');
  if (input.mappingStatus !== 'needs-business-confirmation' && input.mappingStatus !== 'ready-for-graph-preparation') {
    issue('', 'mappingStatus', 'mapping status must explicitly describe the review gate');
  }
  if (input.publishable !== false) issue('', 'publishable', 'real mapping is never directly publishable');
  if (!input.sourcePath.startsWith('/')) issue('', 'sourcePath', 'source path must be absolute');
  if (!sha256.test(input.sourceSha256)) issue('', 'sourceSha256', 'source hash must be lowercase SHA-256');
  else if (input.sourceSha256 !== REAL_SOP_SOURCE_SHA256) issue('', 'sourceSha256', 'source hash does not match the read-only Menokin evidence');
  if (input.entryCodeHeaderPresent !== false) issue('', 'entryCodeHeaderPresent', 'real workbook has no entry-code header');
  if (input.sheets.length !== REAL_SOP_SHEETS.length) issue('', 'sheets', 'the frozen single-sheet source is required');
  const seen = new Set<string>();
  for (const sheet of input.sheets) {
    if (!REAL_SOP_SHEETS.includes(sheet.sheet)) issue(sheet.sheet, 'sheet', 'sheet is not in the frozen single-sheet source');
    if (seen.has(sheet.sheet)) issue(sheet.sheet, 'sheet', 'duplicate sheet mapping');
    seen.add(sheet.sheet);
    const expected = REAL_SOP_STRUCTURE[sheet.sheet];
    if (!expected || sheet.rowCount !== expected.rowCount || sheet.columnCount !== expected.columnCount || sheet.imageCount !== expected.imageCount) {
      issue(sheet.sheet, 'structure', 'row, column and image counts do not match the read-only structure evidence');
    }
    for (const field of ['stableBusinessIds', 'entryTerms', 'branchTargets', 'unableToDeterminePaths', 'knowledgeOwnership', 'resourceOwnership', 'imageOwnership', 'applicability', 'visibility'] as const) {
      const values = sheet[field];
      if (!Array.isArray(values) || values.length === 0) {
        issue(sheet.sheet, field, 'explicit business mapping is required');
        continue;
      }
      for (const value of values as readonly MappingValue[]) {
        if (!nonempty(value?.value) || !nonempty(value?.evidence)) issue(sheet.sheet, field, 'each claim needs a value and evidence reference');
        else if (placeholder.test(value.value) || placeholder.test(value.evidence)) issue(sheet.sheet, field, 'placeholder business claims are not accepted');
      }
    }
    if (!sheet.effectiveInterval || !validUtcTime(sheet.effectiveInterval.from)
      || (sheet.effectiveInterval.to !== null && (!validUtcTime(sheet.effectiveInterval.to)
        || Date.parse(sheet.effectiveInterval.to) <= Date.parse(sheet.effectiveInterval.from)))
      || !nonempty(sheet.effectiveInterval?.evidence) || placeholder.test(sheet.effectiveInterval?.evidence ?? '')) issue(sheet.sheet, 'effectiveInterval', 'effective interval and evidence are required');
  }
  for (const sheet of REAL_SOP_SHEETS) if (!seen.has(sheet)) issue(sheet, 'sheet', 'missing registered sheet');
  const status = issues.length ? 'needs-business-confirmation' : 'ready-for-graph-preparation';
  if (input.mappingStatus !== status) issue('', 'mappingStatus', `mapping status must match validation result ${status}`);
  return { version: REAL_SOP_MAPPING_VERSION, publishable: false, status, issues };
}
