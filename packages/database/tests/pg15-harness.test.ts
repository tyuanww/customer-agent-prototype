import { readdirSync } from 'node:fs';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { Pg15Harness } from '../src/testkit/index.js';

const TEMP_PREFIX = 'customer-agent-pg15-';

function pg15TemporaryRoots(): string[] {
  return readdirSync(os.tmpdir()).filter((entry) => entry.startsWith(TEMP_PREFIX)).sort();
}

describe('PostgreSQL 15 harness lifecycle', () => {
  it('does not allocate a temporary cluster when binary discovery fails', () => {
    const before = pg15TemporaryRoots();
    const original = process.env.CUSTOMER_AGENT_PG15_BIN;
    process.env.CUSTOMER_AGENT_PG15_BIN = '/definitely-missing/customer-agent-pg15';
    try {
      expect(() => new Pg15Harness()).toThrow();
    } finally {
      if (original === undefined) delete process.env.CUSTOMER_AGENT_PG15_BIN;
      else process.env.CUSTOMER_AGENT_PG15_BIN = original;
    }
    expect(pg15TemporaryRoots()).toEqual(before);
  });
});
