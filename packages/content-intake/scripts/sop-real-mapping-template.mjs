#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const [structurePath, outputPath] = process.argv.slice(2);
if (!structurePath || !outputPath) {
  console.error('usage: sop-real-mapping-template.mjs <real-workbook-structure.json> <mapping-template.json>');
  process.exit(2);
}

const structure = JSON.parse(await readFile(structurePath, 'utf8'));
if (!structure || typeof structure !== 'object' || !Array.isArray(structure.sheets)
  || typeof structure.sourcePath !== 'string' || !structure.sourcePath.startsWith('/')
  || typeof structure.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(structure.sha256)
  || structure.sheets.length !== 6) {
  throw new Error('invalid read-only workbook structure evidence');
}

const sheets = structure.sheets.map((sheet) => {
  if (!sheet || typeof sheet !== 'object' || typeof sheet.name !== 'string') {
    throw new Error('invalid sheet structure evidence');
  }
  return {
    sheet: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    imageCount: sheet.imageCount,
    stableBusinessIds: [],
    entryTerms: [],
    branchTargets: [],
    unableToDeterminePaths: [],
    knowledgeOwnership: [],
    resourceOwnership: [],
    imageOwnership: [],
    applicability: [],
    visibility: [],
    effectiveInterval: null,
  };
});
if (new Set(sheets.map((sheet) => sheet.sheet)).size !== 6) {
  throw new Error('duplicate sheet structure evidence');
}

const output = {
  version: 'menokin-six-sheet-mapping-v1',
  mappingState: 'candidate',
  mappingStatus: 'needs-business-confirmation',
  publishable: false,
  sourcePath: structure.sourcePath,
  sourceSha256: structure.sha256,
  entryCodeHeaderPresent: false,
  sheets,
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
