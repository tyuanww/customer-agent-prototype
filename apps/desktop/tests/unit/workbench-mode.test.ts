import { expect, it } from 'vitest';
import { workbenchKind } from '../../src/shared/workbench-mode';

it('treats an https profile without intake as product-remote', () => {
  expect(workbenchKind({ apiOrigin: 'https://agent-auth.jianghua.site' })).toBe('product-remote');
});

it('keeps faq-v2 even on a loopback origin', () => {
  expect(workbenchKind({ apiOrigin: 'http://127.0.0.1:43100', contentIntake: 'faq-v2' })).toBe('faq-v2');
});

it('keeps a loopback profile without intake on the legacy nav', () => {
  expect(workbenchKind({ apiOrigin: 'http://127.0.0.1:43100' })).toBe('legacy');
  expect(workbenchKind(null)).toBe('legacy');
});
