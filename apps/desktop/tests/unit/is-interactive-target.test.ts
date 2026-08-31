import { describe, expect, it } from 'vitest';
import { isInteractiveTarget } from '../../src/renderer/lib/is-interactive-target';

describe('isInteractiveTarget', () => {
  it('treats common interactive controls as blocked shortcut targets', () => {
    const nodes: HTMLElement[] = [
      document.createElement('input'),
      document.createElement('textarea'),
      document.createElement('select'),
      document.createElement('button'),
      document.createElement('a'),
    ];
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    nodes.push(editable);

    for (const node of nodes) {
      expect(isInteractiveTarget(node)).toBe(true);
    }
    expect(isInteractiveTarget(document.body)).toBe(false);
  });
});
