import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SYNTHETIC_STACK_PROFILE_FILE,
  developmentProductProfile,
  readPackagedProductProfile,
  resolveProductProfile,
} from '../../src/main/product-runtime-config';

const directories: string[] = [];
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(desktopRoot, '../..');
const PACKAGED_PROFILE_ERROR = /synthetic-stack\.json/;
const LOOPBACK_ENV = {
  CUSTOMER_AGENT_DESKTOP_API_ORIGIN: 'http://127.0.0.1:43110',
  CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: 'http://127.0.0.1:43111',
};
const STACK_PROFILE = {
  mode: 'synthetic-local',
  apiOrigin: 'http://127.0.0.1:43100',
  identityOrigin: 'http://127.0.0.1:43101',
};

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
    write(directory, STACK_PROFILE);
    expect(readPackagedProductProfile(directory)).toEqual({
      apiOrigin: 'http://127.0.0.1:43100',
      identityOrigin: 'http://127.0.0.1:43101',
    });
  });

  it('fail-closes for a missing, malformed or widened profile', () => {
    const directory = userDataDirectory();
    expect(() => readPackagedProductProfile(directory)).toThrow(PACKAGED_PROFILE_ERROR);

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
      expect(() => readPackagedProductProfile(directory), JSON.stringify(value)).toThrow(PACKAGED_PROFILE_ERROR);
    }

    writeFileSync(path.join(directory, SYNTHETIC_STACK_PROFILE_FILE), 'not json');
    expect(() => readPackagedProductProfile(directory)).toThrow(PACKAGED_PROFILE_ERROR);
    writeFileSync(path.join(directory, SYNTHETIC_STACK_PROFILE_FILE), '');
    expect(() => readPackagedProductProfile(directory)).toThrow(PACKAGED_PROFILE_ERROR);
  });

  it('refuses a symlinked profile file', () => {
    const directory = userDataDirectory();
    const target = path.join(directory, 'real.json');
    writeFileSync(target, JSON.stringify(STACK_PROFILE));
    const nested = path.join(directory, 'nested');
    mkdirSync(nested);
    symlinkSync(target, path.join(nested, SYNTHETIC_STACK_PROFILE_FILE));
    expect(() => readPackagedProductProfile(nested)).toThrow(PACKAGED_PROFILE_ERROR);
  });

  it('ignores environment origins in packaged mode and does not read the file unpackaged', () => {
    const directory = userDataDirectory();
    expect(() => resolveProductProfile(true, directory, LOOPBACK_ENV)).toThrow(PACKAGED_PROFILE_ERROR);

    write(directory, STACK_PROFILE);
    expect(resolveProductProfile(true, directory, LOOPBACK_ENV)).toEqual({
      apiOrigin: 'http://127.0.0.1:43100',
      identityOrigin: 'http://127.0.0.1:43101',
    });
    expect(resolveProductProfile(false, directory, {})).toBeUndefined();
    expect(resolveProductProfile(false, directory, LOOPBACK_ENV)).toEqual({
      apiOrigin: 'http://127.0.0.1:43110',
      identityOrigin: 'http://127.0.0.1:43111',
    });
  });

  it('wires packaged startup through resolveProductProfile and the stack userData path', () => {
    const main = readFileSync(path.join(desktopRoot, 'src/main/main.ts'), 'utf8');
    const stackProfile = readFileSync(path.join(repositoryRoot, 'scripts/synthetic-stack/profile.ts'), 'utf8');
    const packageJson = JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')) as {
      build: { productName: string };
    };
    expect(packageJson.build.productName).toBe('客服话术浮窗 Demo');
    expect(main).toContain("app.setName('客服话术浮窗 Demo')");
    expect(main.indexOf("app.setName('客服话术浮窗 Demo')")).toBeLessThan(
      main.indexOf('app.requestSingleInstanceLock()'),
    );
    expect(main).toContain('resolveProductProfile(app.isPackaged, userDataDirectory, process.env)');
    expect(main).not.toContain('developmentProductProfile(process.env)');
    expect(main).not.toContain('readPackagedProductProfile(userDataDirectory)');
    expect(stackProfile).toContain("'Library', 'Application Support', '客服话术浮窗 Demo'");
    expect(stackProfile).toContain("'synthetic-stack.json'");
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
