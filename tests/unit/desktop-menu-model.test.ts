import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createApplicationMenuModel,
  createOverlayContextMenuModel,
  createTrayMenuModel,
  trayIconCandidates,
  trayIconPath,
} from '../../src/main/desktop-menu-model';

describe('desktop menu model', () => {
  it('keeps the Tray menu fixed to query, dashboard and explicit Demo exit', () => {
    expect(createTrayMenuModel()).toEqual([
      { type: 'action', id: 'open-search', label: '打开话术查询' },
      { type: 'action', id: 'open-dashboard', label: '打开运营工作台' },
      { type: 'separator' },
      { type: 'action', id: 'quit', label: '退出 Demo' },
    ]);
  });

  it('preserves native edit commands before trusted app actions in the query input menu', () => {
    const menu = createOverlayContextMenuModel({
      canUndo: true,
      canRedo: false,
      canCut: true,
      canCopy: true,
      canPaste: false,
      canSelectAll: true,
    });
    const editEntries = menu.filter((entry) => entry.type === 'edit');

    expect(editEntries.map((entry) => entry.role)).toEqual([
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'selectAll',
    ]);
    expect(editEntries.map((entry) => entry.enabled)).toEqual([
      true,
      false,
      true,
      true,
      false,
      true,
    ]);
    expect(menu.slice(-4)).toEqual(createTrayMenuModel());
  });

  it('does not add edit roles when right-clicking non-editable Fox or Query chrome', () => {
    expect(createOverlayContextMenuModel(null)).toEqual(createTrayMenuModel());
  });

  it('keeps app, edit and window system roles around the Customer Agent menu', () => {
    const macMenu = createApplicationMenuModel('darwin');
    expect(macMenu.map((section) => section.type === 'role' ? section.role : section.label)).toEqual([
      'appMenu',
      '客服 Agent',
      'editMenu',
      'windowMenu',
    ]);
    const agent = macMenu.find((section) => section.type === 'agent');
    expect(agent?.items).toEqual([
      { type: 'action', id: 'open-search', label: '打开话术查询' },
      { type: 'action', id: 'open-dashboard', label: '打开运营工作台' },
    ]);

    const windowsAgent = createApplicationMenuModel('win32').find(
      (section) => section.type === 'agent',
    );
    expect(windowsAgent?.items.at(-1)).toEqual({
      type: 'action',
      id: 'quit',
      label: '退出 Demo',
    });
  });

  it('uses appPath in development and resourcesPath after packaging', () => {
    expect(
      trayIconPath({
        isPackaged: false,
        appPath: '/repo/customer-agent-prototype',
        resourcesPath: '/Applications/Demo.app/Contents/Resources',
      }),
    ).toBe(join('/repo/customer-agent-prototype', 'fox-head.png'));
    expect(
      trayIconPath({
        isPackaged: true,
        appPath: '/Applications/Demo.app/Contents/Resources/app.asar',
        resourcesPath: '/Applications/Demo.app/Contents/Resources',
      }),
    ).toBe(join('/Applications/Demo.app/Contents/Resources', 'fox-head.png'));
    expect(
      trayIconCandidates({
        isPackaged: false,
        appPath: '/repo/customer-agent-prototype/out/main',
        resourcesPath: '/Electron.app/Contents/Resources',
      }),
    ).toEqual([
      join('/repo/customer-agent-prototype/out/main', 'fox-head.png'),
      join('/repo/customer-agent-prototype', 'fox-head.png'),
    ]);
  });
});
