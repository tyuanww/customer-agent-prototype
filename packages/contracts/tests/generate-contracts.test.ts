import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

type GeneratorModule = Readonly<{
  toRuntimeSchema: (value: unknown) => unknown;
}>;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let generator: GeneratorModule;

beforeAll(async () => {
  generator = await import(
    pathToFileURL(path.join(packageRoot, 'scripts/generate-contracts.mjs')).href
  ) as GeneratorModule;
});

describe('contract runtime schema transformation', () => {
  it('preserves validation extensions without prototype-sensitive key loss', () => {
    const source = JSON.parse(`{
      "type": "array",
      "description": "annotation only",
      "x-unique-by": "domain",
      "x-annotation-only": true,
      "items": {
        "type": "object",
        "properties": {
          "__proto__": { "type": "string" },
          "domain": { "type": "string" }
        }
      }
    }`) as Record<string, unknown>;

    const transformed = generator.toRuntimeSchema(source) as Record<string, unknown>;
    const items = transformed.items as Record<string, unknown>;
    const properties = items.properties as Record<string, unknown>;

    expect(Object.getPrototypeOf(transformed)).toBeNull();
    expect(Object.getPrototypeOf(properties)).toBeNull();
    expect(Object.hasOwn(properties, '__proto__')).toBe(true);
    expect(transformed['x-unique-by']).toBe('domain');
    expect(transformed).not.toHaveProperty('description');
    expect(transformed).not.toHaveProperty('x-annotation-only');
  });

  it('preserves composite uniqueness and rejects ambiguous field lists', () => {
    expect(generator.toRuntimeSchema({ 'x-unique-by': ['script_id', 'content_hash'] })).toEqual({ 'x-unique-by': ['script_id', 'content_hash'] });
    for (const value of [[], ['domain', 'domain'], [42]]) {
      expect(() => generator.toRuntimeSchema({ 'x-unique-by': value })).toThrow();
    }
  });

  it('fails closed for malformed validation extensions and non-schema references', () => {
    expect(() => generator.toRuntimeSchema({ 'x-unique-by': [''] })).toThrow(
      /x-unique-by must be a non-empty string/,
    );
    expect(() => generator.toRuntimeSchema({ $ref: '#/components/responses/Invalid' })).toThrow(
      /non-schema reference/,
    );
  });
});
