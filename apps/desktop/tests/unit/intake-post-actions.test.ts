import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { actionsForIntakePost, DEFAULT_INTAKE_POST, INTAKE_POSTS } from '../../src/shared/intake-post-actions';

const MODULE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/shared/intake-post-actions.ts');

describe('intake post actions', () => {
  it('maps 客服 to query only', () => {
    expect(actionsForIntakePost('客服')).toEqual({ ok: true, actions: ['query'] });
  });

  it('maps 客服主管 to manage, upload, source confirm, and publish', () => {
    expect(actionsForIntakePost('客服主管')).toEqual({
      ok: true,
      actions: ['content-manage', 'import', 'source-confirm', 'publish'],
    });
  });

  it('returns unknown-post instead of guessing', () => {
    expect(actionsForIntakePost('')).toEqual({ ok: false, error: 'unknown-post' });
    expect(actionsForIntakePost('客服 ')).toEqual({ ok: false, error: 'unknown-post' });
    expect(actionsForIntakePost('主管')).toEqual({ ok: false, error: 'unknown-post' });
    expect(actionsForIntakePost('review')).toEqual({ ok: false, error: 'unknown-post' });
    expect(actionsForIntakePost(null)).toEqual({ ok: false, error: 'unknown-post' });
  });

  it('locks the two posts and the default', () => {
    expect([...INTAKE_POSTS]).toEqual(['客服', '客服主管']);
    expect(DEFAULT_INTAKE_POST).toBe('客服');
    expect(actionsForIntakePost(DEFAULT_INTAKE_POST).ok).toBe(true);
  });

  it('does not import a UI runtime', () => {
    const source = readFileSync(MODULE_PATH, 'utf8');
    const imports = source.split('\n').filter((line) => /^\s*import\b/.test(line)).join('\n');
    expect(imports).not.toMatch(/\breact\b/);
    expect(imports).not.toMatch(/\belectron\b/);
  });
});
