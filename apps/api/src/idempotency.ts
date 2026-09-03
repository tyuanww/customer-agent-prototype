import { createHmac } from 'node:crypto';
import type { ApiHmacKeyRing } from './runtime-config.js';

type JsonPrimitive = string | number | boolean | null;
export type CanonicalJsonValue = JsonPrimitive | readonly CanonicalJsonValue[] | {
  readonly [key: string]: CanonicalJsonValue;
};

export type PreparedIdempotencyHashes = Readonly<{
  currentVersion: string;
  hashes: Readonly<Record<string, string>>;
}>;

function canonicalJson(value: CanonicalJsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  const objectValue = value as Readonly<Record<string, CanonicalJsonValue>>;
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key] as CanonicalJsonValue)}`)
    .join(',')}}`;
}

/**
 * Produce every currently accepted digest before raw request fields leave the
 * HTTP boundary. Retaining all active versions lets a 24h replay survive key
 * rotation without passing customer-capable text into the repository layer.
 */
export function prepareIdempotencyHashes(
  body: CanonicalJsonValue,
  keyRing: ApiHmacKeyRing,
): PreparedIdempotencyHashes {
  const canonical = canonicalJson(body);
  const hashes = Object.fromEntries(Object.entries(keyRing.keys).map(([version, key]) => [
    version,
    createHmac('sha256', key).update(`${version}\0${canonical}`, 'utf8').digest('hex'),
  ]));
  return Object.freeze({
    currentVersion: keyRing.currentVersion,
    hashes: Object.freeze(hashes),
  });
}

export function hmacSafeValue(value: string, version: string, key: string): string {
  return createHmac('sha256', key).update(`${version}\0${value}`, 'utf8').digest('hex');
}
