import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerProductCatalogIpc } from '../../src/main/product-catalog-ipc';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { isProductCatalogResult, productCatalogEntries } from '../../src/shared/product-catalog';
import { SYNTHETIC_CATALOG } from '../../src/shared/synthetic-catalog';

const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>());
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(name, callback) } }));

it('flattens the catalog with the parent link the renderer needs', () => {
  const entries = productCatalogEntries();
  const expected = SYNTHETIC_CATALOG.reduce((count, category) => count + 1 + category.products.length, 0);
  expect(entries).toHaveLength(expected);
  for (const category of SYNTHETIC_CATALOG) {
    expect(entries.find((candidate) => candidate.id === category.id))
      .toMatchObject({ type: 'category', label: category.label, parentId: null });
    for (const product of category.products) {
      expect(entries.find((candidate) => candidate.id === product.id))
        .toMatchObject({ type: 'sku', label: product.label, parentId: category.id });
    }
  }
});

it('accepts only the exact success and failure shapes', () => {
  expect(isProductCatalogResult({ ok: true, entries: productCatalogEntries() })).toBe(true);
  expect(isProductCatalogResult({ ok: true, entries: [{ type: 'sku', id: 'sku_a', label: 'A', parentId: null }] })).toBe(true);
  expect(isProductCatalogResult({ ok: true, entries: [{ type: 'sku', id: 'sku_a', label: 'A' }] })).toBe(false);
  expect(isProductCatalogResult({ ok: true, entries: [{ type: 'bundle', id: 'sku_a', label: 'A', parentId: null }] })).toBe(false);
  expect(isProductCatalogResult({ ok: true, entries: [{ type: 'sku', id: 'bad id', label: 'A', parentId: null }] })).toBe(false);
  expect(isProductCatalogResult({ ok: true, entries: [{ type: 'sku', id: 'sku_a', label: '', parentId: null }] })).toBe(false);
  expect(isProductCatalogResult({ ok: true })).toBe(false);
  expect(isProductCatalogResult({ ok: false, sessionEpoch: 0, code: 'FORBIDDEN', message: '当前身份不能执行此操作' })).toBe(true);
  expect(isProductCatalogResult({ ok: false, sessionEpoch: 0, code: 'FORBIDDEN', message: 'nope' })).toBe(false);
});

it('serves the catalog only to the trusted query main frame', () => {
  const frame = { parent: null };
  const query = { id: 1, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=query', mainFrame: frame } as unknown as WebContents;
  const fox = { ...query, id: 2 } as WebContents;
  const dashboard = { ...query, id: 3 } as WebContents;
  registerProductCatalogIpc(() => [query, fox, dashboard], wc => (wc.id === 1 ? 'query' : wc.id === 2 ? 'fox' : null), () => 'http://127.0.0.1:5173/');
  const handler = handlers.get(IPC_CHANNELS.PRODUCT_CATALOG)!;
  const event = (sender: WebContents, senderFrame: unknown = frame) => ({ sender, senderFrame }) as IpcMainInvokeEvent;

  expect(handler(event(query))).toMatchObject({ ok: true });
  expect(handler(event(fox))).toMatchObject({ code: 'FORBIDDEN' });
  expect(handler(event(dashboard))).toMatchObject({ code: 'FORBIDDEN' });
  expect(handler(event({ ...query, id: 9 } as WebContents))).toMatchObject({ code: 'FORBIDDEN' });
  expect(handler(event(query, {}))).toMatchObject({ code: 'FORBIDDEN' });
  expect(handler(event(query), 'extra')).toMatchObject({ code: 'VALIDATION' });
});
