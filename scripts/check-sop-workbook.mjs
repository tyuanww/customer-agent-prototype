#!/usr/bin/env node
/**
 * Checks whether a workbook would be accepted by the intake parser, without uploading it.
 *
 * The registered SOP template changed: identity is now the operator's own `条目编码` column, so a
 * workbook exported from the older template is refused on every sheet with
 * MISSING_ENTRY_CODE_HEADER. This runs the same parser the API runs, so the answer here is the
 * same answer the upload would give.
 *
 * Prints counts and issue codes only. Sheet rows carry business text; this never echoes them.
 *
 *   node scripts/check-sop-workbook.mjs <file.xlsx> [more.xlsx ...]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseSopWorkbook, SOP_SHEET_NAMES } from '../packages/content-intake/dist/workbook.js';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/check-sop-workbook.mjs <file.xlsx> [more.xlsx ...]');
  process.exit(2);
}

const context = {
  sourceId: process.env.SOP_SOURCE_ID ?? 'src-menokin-sop-v2',
  brandId: process.env.SOP_BRAND_ID ?? 'brand-menokin',
  scope: process.env.SOP_BRAND_ID ?? 'brand-menokin',
  scopeKind: 'brand',
  selectedSheets: [...SOP_SHEET_NAMES],
};

let rejected = 0;
for (const file of files) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    rejected += 1;
    console.log(`${path.basename(file)}: unreadable (${error.code ?? 'error'})`);
    continue;
  }
  const parsed = await parseSopWorkbook(bytes, context);
  const codes = (parsed.issues ?? []).map(issue => issue.code);
  const summary = Object.entries(codes.reduce((counts, code) => {
    counts[code] = (counts[code] ?? 0) + 1;
    return counts;
  }, {})).map(([code, count]) => `${code}x${String(count)}`).join(' ');
  console.log(`${path.basename(file)}: ${bytes.length} bytes, ok=${String(parsed.ok)}, rows=${String(parsed.rows?.length ?? 0)}`
    + `${summary ? `, issues=${summary}` : ''}`);
  if (!parsed.ok) rejected += 1;
}
process.exitCode = rejected > 0 ? 1 : 0;
