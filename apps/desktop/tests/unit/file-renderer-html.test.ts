import { expect, it } from 'vitest';
import { stripCrossOriginAttributes } from '../../src/shared/file-renderer-html';

it('strips Vite crossorigin markers so isolated file:// sessions can load modules', () => {
  const html = '<script type="module" crossorigin src="./assets/index.js"></script>'
    + '<link rel="stylesheet" crossorigin href="./assets/index.css">'
    + '<script type="module" crossorigin="">import("./LoginApp.js")</script>';
  const stripped = stripCrossOriginAttributes(html);
  expect(stripped).toContain('type="module" src="./assets/index.js"');
  expect(stripped).toContain('rel="stylesheet" href="./assets/index.css"');
  expect(stripped).not.toMatch(/\scrossorigin/);
});
