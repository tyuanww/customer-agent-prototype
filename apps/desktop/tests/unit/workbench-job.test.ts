import { expect, it } from 'vitest';
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

it('ignores a disabled twin when one enabled row remains', () => {
  expect(resolveJobTitle('客服总监', [
    { name: '客服总监', enabled: false },
    { name: '客服总监', enabled: true },
  ])).toMatchObject({ status: 'resolved', role: 'director', rights: { publish: true, grant: true } });
});
