#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const file = process.argv[2] ?? 'docs/sop-real-six-sheet-candidate-registry.json';
const value = JSON.parse(await readFile(file, 'utf8'));
const fail = message => { throw new Error(`${file}: ${message}`); };
const sheets = ['过敏流程SOP', '长痘痘SOP', '少错破SOP', '品质售后SOP', '税收相关规则', '品牌对接资源汇总'];
const expectedKinds = new Map([
  ['过敏流程SOP', 'sop-family'],
  ['长痘痘SOP', 'sop-family'],
  ['少错破SOP', 'sop-family'],
  ['品质售后SOP', 'sop-family'],
  ['税收相关规则', 'rule-set'],
  ['品牌对接资源汇总', 'resource-set'],
]);
const id = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

if (value.schema !== 'menokin-six-sheet-candidate-registry-v1') fail('unsupported schema');
if (value.status !== 'CANDIDATE') fail('candidate status is required');
if (value.publishable !== false || value.runtimeEnabled !== false) fail('candidate registry must be disabled and non-publishable');
if (!Array.isArray(value.entries) || value.entries.length !== sheets.length) fail('exactly six entries are required');
if (value.entries.some(entry => !entry || !sheets.includes(entry.sheet) || entry.enabled !== false
  || typeof entry.candidateId !== 'string' || !id.test(entry.candidateId)
  || !Array.isArray(entry.entryTerms) || typeof entry.reason !== 'string' || entry.reason.length === 0)) {
  fail('each candidate entry must be complete and disabled');
}
if (new Set(value.entries.map(entry => entry.sheet)).size !== sheets.length) fail('sheet entries must be unique');
if (value.entries.some(entry => entry.kind !== expectedKinds.get(entry.sheet))) fail('candidate kind must match the registered sheet domain');
if (value.entries.some(entry => entry.kind !== 'sop-family' && entry.entryTerms.length > 0)) fail('rule and resource sets cannot have direct SOP entry terms');
console.log(`SOP candidate registry PASS: ${value.entries.length} disabled entries`);
