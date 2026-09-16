import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPackagedRetrievalDefaults, defaultSyntheticStackFile } from '../../src/main/packaged-retrieval-paths';

const directories: string[] = [];
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('packaged retrieval defaults', () => {
  it('leaves env alone when the off-repo files are missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'packaged-retrieval-missing-'));
    directories.push(root);
    const env: NodeJS.ProcessEnv = {
      CUSTOMER_AGENT_HYDRATE_INDEX: '/tmp/from-shell-hydrate.json',
      CUSTOMER_AGENT_RETRIEVAL_INDEX: '/tmp/from-shell-index.json',
    };
    applyPackagedRetrievalDefaults(env, {
      hydrate: path.join(root, 'retrieval-hydrate.json'),
      index: path.join(root, 'retrieval-index.json'),
    });
    expect(env.CUSTOMER_AGENT_HYDRATE_INDEX).toBe('/tmp/from-shell-hydrate.json');
    expect(env.CUSTOMER_AGENT_RETRIEVAL_INDEX).toBe('/tmp/from-shell-index.json');
  });

  it('points packaged env at existing off-repo files and ignores shell paths', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'packaged-retrieval-present-'));
    directories.push(root);
    const hydrate = path.join(root, 'retrieval-hydrate.json');
    const index = path.join(root, 'retrieval-index.json');
    writeFileSync(hydrate, '{}\n');
    writeFileSync(index, '{}\n');
    const env: NodeJS.ProcessEnv = {
      CUSTOMER_AGENT_HYDRATE_INDEX: '/tmp/from-shell-hydrate.json',
      CUSTOMER_AGENT_RETRIEVAL_INDEX: '/tmp/from-shell-index.json',
    };
    applyPackagedRetrievalDefaults(env, { hydrate, index });
    expect(env.CUSTOMER_AGENT_HYDRATE_INDEX).toBe(hydrate);
    expect(env.CUSTOMER_AGENT_RETRIEVAL_INDEX).toBe(index);
  });

  it('names the default files next to the synthetic stack root', () => {
    expect(defaultSyntheticStackFile('retrieval-hydrate.json', '/Users/demo')).toBe(
      '/Users/demo/.customer-agent-synthetic-stack/retrieval-hydrate.json',
    );
  });

  it('applies defaults after the packaged profile and before search IPC', () => {
    const main = readFileSync(path.join(desktopRoot, 'src/main/main.ts'), 'utf8');
    expect(main).toContain('if (app.isPackaged) applyPackagedRetrievalDefaults(process.env);');
    expect(main.indexOf('if (app.isPackaged) applyPackagedRetrievalDefaults(process.env);'))
      .toBeGreaterThan(main.indexOf('resolveProductProfile(app.isPackaged, userDataDirectory, process.env)'));
    expect(main.indexOf('if (app.isPackaged) applyPackagedRetrievalDefaults(process.env);'))
      .toBeLessThan(main.indexOf('registerProductSearchIpc('));
  });
});
