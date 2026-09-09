import { safeStorage } from 'electron';
import { readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync } from 'node:fs';
import path from 'node:path';
import type { SessionStore } from './product-session';
import { ProductHttpError } from './product-http';

/** Dedicated encrypted blob. Linux basic_text is explicitly not an encryption backend. */
export function createSessionStore(directory: string): SessionStore {
  const target = path.join(directory, 'product-session.enc'); const temporary = `${target}.tmp`;
  const secure = () => {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw new ProductHttpError('UNAVAILABLE');
    }
  };
  const remove = (file: string) => {
    try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ProductHttpError('UNAVAILABLE'); }
  };
  return {
    read() {
      let bytes: Buffer;
      try {
        const stat = lstatSync(target);
        if (!stat.isFile() || stat.size > 16_384) throw new ProductHttpError('UNAVAILABLE');
        bytes = readFileSync(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw new ProductHttpError('UNAVAILABLE');
      }
      secure(); if (bytes.length > 16_384) throw new ProductHttpError('UNAVAILABLE');
      return JSON.parse(safeStorage.decryptString(bytes)) as unknown;
    },
    write(value) {
      secure(); const bytes = safeStorage.encryptString(JSON.stringify(value));
      remove(temporary);
      try { writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' }); renameSync(temporary, target); }
      finally { remove(temporary); }
    },
    clear() { remove(target); remove(temporary); },
  };
}
