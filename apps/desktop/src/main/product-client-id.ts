import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ProductHttpError } from './product-http';

const FILE = 'product-client-id';
const PATTERN = /^desk_[0-9a-f]{32}$/;

/** Install-stable X-Client-Id. Not a secret; never accepted from renderer. */
export function readProductClientId(directory: string): string {
  mkdirSync(directory, { recursive: true });
  const target = path.join(directory, FILE);
  try {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.size > 128) throw new ProductHttpError('UNAVAILABLE');
    const value = readFileSync(target, 'utf8').trim();
    if (!PATTERN.test(value)) throw new ProductHttpError('UNAVAILABLE');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (error instanceof ProductHttpError) throw error;
      throw new ProductHttpError('UNAVAILABLE');
    }
  }
  const value = `desk_${randomBytes(16).toString('hex')}`;
  writeFileSync(target, `${value}\n`, { mode: 0o644, flag: 'wx' });
  return value;
}
