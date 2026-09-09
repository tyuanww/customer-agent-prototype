// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createSessionStore } from '../../src/main/product-session-store';
const secure = vi.hoisted(() => ({ available: true }));
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => secure.available, getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (value: string) => Buffer.from([...Buffer.from(value)].map(n => n ^ 0x55)),
  decryptString: (value: Buffer) => Buffer.from([...value].map(n => n ^ 0x55)).toString(),
} }));
const directories: string[] = [];
afterEach(() => { secure.available = true; for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true }); });
it('persists only encrypted bytes and clears both files', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'desktop-session-test-')); directories.push(directory);
  const store = createSessionStore(directory); const value = { access_token: 'synthetic-token', expires_at: '2026-09-09T00:00:00Z' };
  store.write(value); expect(readFileSync(path.join(directory, 'product-session.enc')).toString()).not.toContain('synthetic-token');
  expect(store.read()).toEqual(value); store.clear(); expect(store.read()).toBe(null);
});
it('does not write a plaintext fallback when encryption is unavailable', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'desktop-session-test-')); directories.push(directory);
  secure.available = false; const store = createSessionStore(directory);
  expect(() => store.write({ access_token: 'secret', expires_at: '' })).toThrow();
  expect(existsSync(path.join(directory, 'product-session.enc'))).toBe(false);
});
