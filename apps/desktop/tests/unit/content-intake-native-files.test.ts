// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { createIntakeNativeFiles } from '../../src/main/content-intake-native-files';
import { INTAKE_UPLOAD_MAX_BYTES } from '../../src/shared/content-intake-upload';
const dialogs = vi.hoisted(() => ({ showOpenDialog: vi.fn(), showSaveDialog: vi.fn() }));
vi.mock('electron', () => ({ dialog: dialogs }));
const directories: string[] = [];
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1]);
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'intake-native-test-')); directories.push(dir);
  const path = join(dir, '合成 FAQ.xlsx'); await writeFile(path, zip);
  const window = { isDestroyed: () => false } as BrowserWindow;
  dialogs.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path] });
  dialogs.showSaveDialog.mockResolvedValue({ canceled: false, filePath: path });
  return { dir, path, files: createIntakeNativeFiles(window), controller: new AbortController() };
}
afterEach(async () => { vi.resetAllMocks(); await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
it('reads exact bytes without exposing a path and handles native cancellation', async () => {
  const f = await fixture();
  expect(await f.files.chooseWorkbook(f.controller.signal)).toEqual({ name: '合成 FAQ.xlsx', bytes: zip });
  dialogs.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  expect(await f.files.chooseWorkbook(f.controller.signal)).toBeNull();
});
it('rejects oversize, renamed non-ZIP, symlink and wrong extension before upload', async () => {
  const f = await fixture(); await truncate(f.path, INTAKE_UPLOAD_MAX_BYTES + 1);
  await expect(f.files.chooseWorkbook(f.controller.signal)).rejects.toMatchObject({ reason: 'FILE_LIMIT' });
  await writeFile(f.path, 'not an Excel file');
  await expect(f.files.chooseWorkbook(f.controller.signal)).rejects.toMatchObject({ reason: 'FILE_INVALID' });
  const alias = join(f.dir, 'alias.xlsx'); await symlink(f.path, alias);
  dialogs.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [alias] });
  await expect(f.files.chooseWorkbook(f.controller.signal)).rejects.toMatchObject({ code: 'VALIDATION' });
  dialogs.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [join(f.dir, 'file.csv')] });
  await expect(f.files.chooseWorkbook(f.controller.signal)).rejects.toMatchObject({ reason: 'FILE_INVALID' });
});
it('checks cancellation after a native dialog resolves before reading or replacing anything', async () => {
  const f = await fixture();
  dialogs.showOpenDialog.mockImplementation(async () => { f.controller.abort(); return { canceled: false, filePaths: [f.path] }; });
  await expect(f.files.chooseWorkbook(f.controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
  const controller = new AbortController();
  dialogs.showSaveDialog.mockImplementation(async () => { controller.abort(); return { canceled: false, filePath: f.path }; });
  await expect(f.files.saveReport(Buffer.from('changed'), controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(await readFile(f.path)).toEqual(zip); expect(await readdir(f.dir)).toEqual(['合成 FAQ.xlsx']);
});
it('atomically replaces a selected destination, creates private files and leaves no temporary output', async () => {
  const f = await fixture(), report = Buffer.concat([zip, Buffer.from('synthetic report')]);
  expect(await f.files.saveReport(report, f.controller.signal)).toBe(true);
  expect(await readFile(f.path)).toEqual(report);
  if (process.platform !== 'win32') expect((await stat(f.path)).mode & 0o777).toBe(0o600);
  expect(await readdir(f.dir)).toEqual(['合成 FAQ.xlsx']);
  dialogs.showSaveDialog.mockResolvedValue({ canceled: true });
  expect(await f.files.saveReport(zip, f.controller.signal)).toBe(false);
  expect(await readFile(f.path)).toEqual(report);
});
it('does not stack a second OS dialog while a cancelled first dialog still exists', async () => {
  const f = await fixture(); let finish!: () => void;
  dialogs.showOpenDialog.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ canceled: false, filePaths: [f.path] }); }));
  const first = f.files.chooseWorkbook(f.controller.signal);
  const cancelled = expect(first).rejects.toMatchObject({ code: 'CANCELLED' });
  f.controller.abort();
  await expect(f.files.saveReport(zip, new AbortController().signal)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(dialogs.showSaveDialog).not.toHaveBeenCalled(); finish(); await cancelled;
  expect(await f.files.saveReport(zip, new AbortController().signal)).toBe(true);
});
it('a failed destination replacement preserves existing contents and removes only its temporary file', async () => {
  const f = await fixture();
  const folder = join(f.dir, 'target.xlsx');
  const { mkdir } = await import('node:fs/promises'); await mkdir(folder);
  dialogs.showSaveDialog.mockResolvedValue({ canceled: false, filePath: folder });
  await expect(f.files.saveReport(zip, f.controller.signal)).rejects.toThrow();
  expect(await readFile(f.path)).toEqual(zip);
  expect((await readdir(f.dir)).sort()).toEqual(['target.xlsx', '合成 FAQ.xlsx']);
});
