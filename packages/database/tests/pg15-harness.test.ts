import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Pg15Harness } from '../src/testkit/index.js';

const TEMP_PREFIX = 'customer-agent-pg15-';

function pg15TemporaryRoots(): string[] {
  return readdirSync(os.tmpdir()).filter((entry) => entry.startsWith(TEMP_PREFIX)).sort();
}

describe('PostgreSQL 15 harness lifecycle', () => {
  it('does not allocate a temporary cluster when binary discovery fails', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'pg15-harness-test-'));
    const originalBin = process.env.CUSTOMER_AGENT_PG15_BIN;
    const tempDirectory = vi.spyOn(os, 'tmpdir').mockReturnValue(directory);
    process.env.CUSTOMER_AGENT_PG15_BIN = '/definitely-missing/customer-agent-pg15';
    try {
      expect(() => new Pg15Harness()).toThrow();
      expect(pg15TemporaryRoots()).toEqual([]);
    } finally {
      if (originalBin === undefined) delete process.env.CUSTOMER_AGENT_PG15_BIN;
      else process.env.CUSTOMER_AGENT_PG15_BIN = originalBin;
      tempDirectory.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
