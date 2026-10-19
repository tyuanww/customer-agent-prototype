import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { JOB_ROSTER } from '../../../api/src/job-roster';
import { resolveJobTitle } from '../../src/shared/workbench-job';

const one = (name: string) => [{ name, enabled: true }];

it('lets a director publish and grant', () => {
  expect(resolveJobTitle('客服总监', one('客服总监'))).toEqual({
    status: 'resolved',
    title: '客服总监',
    role: 'director',
    rights: { publish: true, grant: true, uploadSop: true, search: true, readCatalog: true },
  });
});

it('lets a manager publish and grant', () => {
  expect(resolveJobTitle('客服经理', one('客服经理'))).toEqual({
    status: 'resolved',
    title: '客服经理',
    role: 'manager',
    rights: { publish: true, grant: true, uploadSop: true, search: true, readCatalog: true },
  });
});

it('lets a supervisor publish without granting', () => {
  expect(resolveJobTitle('客服主管', one('客服主管'))).toEqual({
    status: 'resolved',
    title: '客服主管',
    role: 'supervisor',
    rights: { publish: true, grant: false, uploadSop: true, search: true, readCatalog: true },
  });
});

it('lets a lead publish without granting', () => {
  expect(resolveJobTitle('客服组长', one('客服组长'))).toEqual({
    status: 'resolved',
    title: '客服组长',
    role: 'lead',
    rights: { publish: true, grant: false, uploadSop: true, search: true, readCatalog: true },
  });
});

it('lets an AI赋能工程师 publish and grant', () => {
  expect(resolveJobTitle('AI赋能工程师', one('AI赋能工程师'))).toEqual({
    status: 'resolved',
    title: 'AI赋能工程师',
    role: 'engineer',
    rights: { publish: true, grant: true, uploadSop: true, search: true, readCatalog: true },
  });
});

it('lets an unrecognized title sit as 客服坐席 without publishing', () => {
  expect(resolveJobTitle('客服坐席', one('客服坐席'))).toEqual({
    status: 'resolved',
    title: '客服坐席',
    role: 'agent',
    rights: { publish: false, grant: false, uploadSop: false, search: true, readCatalog: true },
  });
});

it('lets an agent search and read without publishing', () => {
  expect(resolveJobTitle('普通客服', one('普通客服'))).toEqual({
    status: 'resolved',
    title: '普通客服',
    role: 'agent',
    rights: { publish: false, grant: false, uploadSop: false, search: true, readCatalog: true },
  });
});

it('rejects a blank title', () => {
  expect(resolveJobTitle('  ', one('客服总监'))).toEqual({ status: 'unresolved', reason: 'blank' });
});

it('rejects an unknown title even when the directory lists it', () => {
  expect(resolveJobTitle('服务赋能师', one('服务赋能师'))).toEqual({ status: 'unresolved', reason: 'unknown' });
});

it('rejects two enabled directory rows with the same name', () => {
  expect(resolveJobTitle('客服总监', [
    { name: '客服总监', enabled: true },
    { name: '客服总监', enabled: true },
  ])).toEqual({ status: 'unresolved', reason: 'duplicate' });
});

it('does not treat inherited object keys as job titles', () => {
  for (const name of ['toString', 'constructor', '__proto__']) {
    expect(resolveJobTitle(name, one(name))).toEqual({ status: 'unresolved', reason: 'unknown' });
  }
});

it('keeps the preload rights tuples equal to the shared roster', () => {
  const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/preload/dashboard.ts'), 'utf8');
  const start = source.indexOf('const JOB_RIGHTS');
  const end = source.indexOf('function isContentJob');
  const block = source.slice(start, end);
  expect(block.match(/: \[/g)).toHaveLength(JOB_ROSTER.length);
  for (const row of JOB_ROSTER) {
    const tuple = `[${[row.rights.publish, row.rights.grant, row.rights.uploadSop, row.rights.search, row.rights.readCatalog].join(', ')}]`;
    expect(block).toContain(`${row.title}: ${tuple}`);
  }
});

it('ignores a disabled twin when one enabled row remains', () => {
  expect(resolveJobTitle('客服总监', [
    { name: '客服总监', enabled: false },
    { name: '客服总监', enabled: true },
  ])).toMatchObject({ status: 'resolved', role: 'director', rights: { publish: true, grant: true } });
});
