#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const [sourceReviewPath, progressPath, outputPath] = process.argv.slice(2);
if (!sourceReviewPath || !progressPath || !outputPath) {
  console.error('usage: build-sop-formal-mapping-workpack.mjs <source-review.json> <mapping-progress.json> <workpack.json>');
  process.exit(2);
}

const parse = async (path) => JSON.parse(await readFile(path, 'utf8'));
const source = await parse(sourceReviewPath);
const progress = await parse(progressPath);

const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};
const isSha256 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const isRange = (value) => Array.isArray(value) && value.length === 2
  && value.every((item) => Number.isInteger(item) && item > 0);
const hasForbiddenContent = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return /(?:rawText|imageBytes|internalUrl|token|credential)/iu.test(value);
  if (Array.isArray(value)) return value.some(hasForbiddenContent);
  if (typeof value === 'object') return Object.entries(value).some(([key, item]) => {
    if (['customerDataPersisted', 'rawWorkbookTextPersisted', 'imageBytesPersisted'].includes(key) && item === false) return false;
    return /(?:rawText|imageBytes|internalUrl|token|credential)/iu.test(key) || hasForbiddenContent(item);
  });
  return false;
};

requireValue(source && typeof source === 'object', 'invalid source review');
requireValue(typeof source.sourcePath === 'string' && source.sourcePath.startsWith('/'), 'source path must be absolute');
requireValue(isSha256(source.sourceSha256), 'invalid source sha256');
requireValue(typeof source.sheet === 'string' && source.sheet.length > 0, 'source sheet is required');
requireValue(Number.isInteger(source.rowCount) && source.rowCount > 0, 'source row count is required');
requireValue(Number.isInteger(source.columnCount) && source.columnCount > 0, 'source column count is required');
requireValue(Array.isArray(source.groups) && source.groups.length > 0, 'source groups are required');
for (const group of source.groups) {
  requireValue(group && typeof group.family === 'string' && isRange(group.rowRange), 'invalid source group');
  requireValue(Number.isInteger(group.rowCount) && group.rowCount > 0, `invalid row count for ${group.family}`);
}
const expectedGroups = [
  ['过敏流程SOP', [2, 55], 54],
  ['长痘痘SOP', [56, 79], 24],
  ['少错破SOP', [80, 115], 36],
  ['品质售后SOP', [116, 124], 9],
  ['税收相关规则', [125, 139], 15],
  ['品牌对接资源汇总', [140, 153], 14],
];
requireValue(source.groups.length === expectedGroups.length, 'source groups must contain all six current families');
for (const [family, rowRange, rowCount] of expectedGroups) {
  const matches = source.groups.filter((group) => group.family === family);
  requireValue(matches.length === 1, `source group must contain exactly one ${family}`);
  const [group] = matches;
  requireValue(JSON.stringify(group.rowRange) === JSON.stringify(rowRange) && group.rowCount === rowCount,
    `source group range/count mismatch for ${family}`);
}
requireValue(progress && typeof progress === 'object', 'invalid mapping progress');
requireValue(progress.source?.sha256 === source.sourceSha256, 'source sha mismatch');
requireValue(progress.source?.rows === source.rowCount - 1, 'source row count mismatch');
requireValue(Array.isArray(progress.candidateStories), 'candidate stories are required');
requireValue(Array.isArray(progress.candidateDeclarations), 'candidate declarations are required');
requireValue(Array.isArray(progress.remainingFormalFields) && progress.remainingFormalFields.length > 0, 'formal fields are required');
requireValue(Array.isArray(progress.remainingEvidence) && progress.remainingEvidence.length > 0, 'evidence gates are required');
requireValue(Array.isArray(progress.confirmedFieldDeclarations), 'confirmed field declarations are required');
requireValue(hasForbiddenContent(source) === false && hasForbiddenContent(progress) === false, 'raw or sensitive content is forbidden');

const fields = [
  { id: 'stableBusinessIds', owner: 'business', evidence: 'business-review' },
  { id: 'entryTerms', owner: 'business', evidence: 'business-review' },
  { id: 'branchTargets', owner: 'business', evidence: 'business-review' },
  { id: 'unableToDeterminePaths', owner: 'business', evidence: 'business-review' },
  { id: 'knowledgeOwnership', owner: 'business', evidence: 'business-review' },
  { id: 'resourceOwnership', owner: 'business', evidence: 'business-review' },
  { id: 'imageOwnership', owner: 'business', evidence: 'business-review' },
  { id: 'applicability', owner: 'business', evidence: 'business-review' },
  { id: 'visibility', owner: 'business', evidence: 'business-review' },
  { id: 'effectiveInterval', owner: 'business', evidence: 'business-review' },
];
const fieldIds = new Set(fields.map((field) => field.id));
requireValue(progress.remainingFormalFields.every((field) => fieldIds.has(field)), 'unknown formal field');

const workpack = {
  version: 'menokin-single-sheet-formal-mapping-workpack-v1',
  status: 'needs-business-confirmation',
  mappingState: 'candidate',
  publishable: false,
  runtimeEnabled: false,
  source: {
    path: source.sourcePath,
    sha256: source.sourceSha256,
    sheet: source.sheet,
    dataRows: source.rowCount - 1,
    columnCount: source.columnCount,
  },
  candidateDeclarations: progress.candidateDeclarations.map((declaration) => ({
    family: declaration.family,
    branchId: declaration.branchId,
    branchLabel: declaration.branchLabel,
    targetTaskId: declaration.targetTaskId,
    candidateTargetNode: declaration.candidateTargetNode,
    candidateSourceRows: declaration.candidateSourceRows,
    formalBusinessIdApproved: declaration.formalBusinessIdApproved === true,
    status: declaration.status,
    evidence: declaration.evidence,
    note: declaration.note,
  })),
  candidateStories: progress.candidateStories.map((story) => ({
    family: story.family,
    rowRange: story.rows,
    storyExits: story.storyExits,
    status: story.status,
    runtimeEnabled: story.runtimeEnabled === true,
  })),
  sourceGroups: source.groups.map((group) => ({
    family: group.family,
    rowRange: group.rowRange,
    rowCount: group.rowCount,
  })),
  formalFields: fields.map((field) => ({
    ...field,
    status: progress.confirmedFieldDeclarations.some((item) => item.field === field.id) ? 'candidate-confirmed' : 'missing',
    declarations: progress.confirmedFieldDeclarations.filter((item) => item.field === field.id).map((item) => ({
      family: item.family,
      value: item.value,
      evidence: item.evidence,
      status: item.status,
      formalFrozen: item.formalFrozen === true,
    })),
  })),
  structuralFindings: progress.sourceFindings.map((id) => ({ id, status: 'needs-review' })),
  evidenceGates: progress.remainingEvidence.map((id) => ({ id, status: 'missing' })),
  privacy: {
    rawWorkbookTextPersisted: false,
    imageBytesPersisted: false,
    customerDataPersisted: false,
  },
  nextGate: 'business-review-of-formal-fields-and-remaining-row-groups',
};

requireValue(hasForbiddenContent(workpack) === false, 'generated workpack contains forbidden content');
await writeFile(outputPath, `${JSON.stringify(workpack, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  status: workpack.status,
  sourceSha256: workpack.source.sha256,
  families: workpack.candidateStories.length,
  formalFields: workpack.formalFields.length,
  missingFields: workpack.formalFields.filter((field) => field.status === 'missing').length,
  publishable: workpack.publishable,
}, null, 2));
