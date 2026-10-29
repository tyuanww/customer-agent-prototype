import { expect, it } from 'vitest';
import { workbenchKind } from '../../src/shared/workbench-mode';

it('uses explicit product-remote mode without consulting an origin', () => {
  expect(workbenchKind({ mode: 'product-remote' })).toBe('product-remote');
});

it.each(['synthetic-local', 'product-remote', undefined] as const)(
  'keeps faq-v2 ahead of mode %s',
  (mode) => {
    expect(workbenchKind({ mode, contentIntake: 'faq-v2' })).toBe('faq-v2');
  },
);

it('does not upgrade an explicit synthetic-local profile because its origin is HTTPS', () => {
  const profile = { mode: 'synthetic-local', apiOrigin: 'https://api.example.com' } as const;
  expect(workbenchKind(profile)).toBe('legacy');
});

it('does not infer a missing mode from HTTPS', () => {
  const profile: NonNullable<Parameters<typeof workbenchKind>[0]> & { apiOrigin: string } = {
    apiOrigin: 'https://api.example.com',
  };
  expect(workbenchKind(profile)).toBe('legacy');
});

it('keeps synthetic-local and absent profiles on the legacy navigation', () => {
  expect(workbenchKind({ mode: 'synthetic-local' })).toBe('legacy');
  expect(workbenchKind({})).toBe('legacy');
  expect(workbenchKind(null)).toBe('legacy');
  expect(workbenchKind(undefined)).toBe('legacy');
});
