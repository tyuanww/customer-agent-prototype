import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SYNTHETIC_STACK_PROFILE_FILE,
  developmentProductProfile,
  readPackagedProductProfile,
} from '../../src/main/product-runtime-config';

const directories: string[] = [];

function userDataDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'product-runtime-config-'));
  directories.push(directory);
  return directory;
}

function write(directory: string, value: unknown): void {
  writeFileSync(path.join(directory, SYNTHETIC_STACK_PROFILE_FILE), JSON.stringify(value));
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('packaged synthetic product profile', () => {
  it('accepts the exact loopback profile the stack writes', () => {
    const directory = userDataDirectory();
    write(directory, {
      mode: 'synthetic-local',
      apiOrigin: 'http://127.0.0.1:43100',
      identityOrigin: 'http://127.0.0.1:43101',
    });
    expect(readPackagedProductProfile(directory)).toEqual({
      apiOrigin: 'http://127.0.0.1:43100',
      identityOrigin: 'http://127.0.0.1:43101',
    });
  });

  it('stays offline for a missing, malformed or widened profile', () => {
    const directory = userDataDirectory();
    expect(readPackagedProductProfile(directory)).toBeUndefined();

    // A userinfo origin must be rejected. Built from parts so this fixture is
    // not itself a credential-shaped literal.
    const withUserinfo = `http://${['user', 'pass'].join(':')}@127.0.0.1:43100`;
    const cases: readonly unknown[] = [
      { mode: 'synthetic-local', apiOrigin: 'http://127.0.0.1:43100' },
      { mode: 'production', apiOrigin: 'http://127.0.0.1:43100', identityOrigin: 'http://127.0.0.1:43101' },
      { mode: 'synthetic-local', apiOrigin: 'http://10.0.0.5:43100', identityOrigin: 'http://127.0.0.1:43101' },
      { mode: 'synthetic-local', apiOrigin: 'https://127.0.0.1:43100', identityOrigin: 'http://127.0.0.1:43101' },
      { mode: 'synthetic-local', apiOrigin: 'http://127.0.0.1:80', identityOrigin: 'http://127.0.0.1:43101' },
      { mode: 'synthetic-local', apiOrigin: 'http://127.0.0.1:43100/v1', identityOrigin: 'http://127.0.0.1:43101' },
      { mode: 'synthetic-local', apiOrigin: withUserinfo, identityOrigin: 'http://127.0.0.1:43101' },
      { mode: 'synthetic-local', apiOrigin: 'http://127.0.0.1:43100', identityOrigin: 'http://127.0.0.1:43100' },
      { mode: 'synthetic-local', apiOrigin: 'http://localhost:43100', identityOrigin: 'http://127.0.0.1:43101' },
    ];
    for (const value of cases) {
      write(directory, value);
      expect(readPackagedProductProfile(directory), JSON.stringify(value)).toBeUndefined();
    }

    writeFileSync(path.join(directory, SYNTHETIC_STACK_PROFILE_FILE), 'not json');
    expect(readPackagedProductProfile(directory)).toBeUndefined();
  });

  it('refuses a symlinked profile file', () => {
    const directory = userDataDirectory();
    const target = path.join(directory, 'real.json');
    writeFileSync(target, JSON.stringify({
      mode: 'synthetic-local',
      apiOrigin: 'http://127.0.0.1:43100',
      identityOrigin: 'http://127.0.0.1:43101',
    }));
    const nested = path.join(directory, 'nested');
    mkdirSync(nested);
    symlinkSync(target, path.join(nested, SYNTHETIC_STACK_PROFILE_FILE));
    expect(readPackagedProductProfile(nested)).toBeUndefined();
  });

  it('reads development origins only when both are exact loopback origins', () => {
    expect(developmentProductProfile({})).toBeUndefined();
    expect(developmentProductProfile({
      CUSTOMER_AGENT_DESKTOP_API_ORIGIN: 'http://127.0.0.1:43100/',
      CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: 'http://127.0.0.1:43101/',
    })).toEqual({ apiOrigin: 'http://127.0.0.1:43100', identityOrigin: 'http://127.0.0.1:43101' });
    // A half-configured or widened pair must fail loudly rather than silently
    // falling back to the offline fixture profile.
    for (const environment of [
      { CUSTOMER_AGENT_DESKTOP_API_ORIGIN: 'http://127.0.0.1:43100' },
      { CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: 'http://127.0.0.1:43101' },
      { CUSTOMER_AGENT_DESKTOP_API_ORIGIN: 'http://example.com:43100', CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: 'http://127.0.0.1:43101' },
      { CUSTOMER_AGENT_DESKTOP_API_ORIGIN: 'http://127.0.0.1:43100', CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: 'not-a-url' },
    ]) {
      expect(() => developmentProductProfile(environment), JSON.stringify(environment)).toThrow(/loopback/);
    }
  });
});
