import { safeStorage } from 'electron';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync } from 'node:fs';
import path from 'node:path';
import type { SessionStore } from './product-session';
import { ProductHttpError } from './product-http';

export function sessionStoreFileName(apiOrigin: string): string {
  const id = createHash('sha256').update(apiOrigin).digest('hex').slice(0, 16);
  return `product-session.${id}.enc`;
}

/** Dedicated encrypted blob, keyed by API origin so local and remote tokens never mix. */
export function createSessionStore(directory: string, apiOrigin = 'http://127.0.0.1:43100'): SessionStore {
  const target = path.join(directory, sessionStoreFileName(apiOrigin)); const temporary = `${target}.tmp`;
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
