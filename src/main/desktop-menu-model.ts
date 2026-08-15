import { join, resolve } from 'node:path';

export type DesktopActionId = 'open-search' | 'open-dashboard' | 'quit';
export type EditRole = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

export type DesktopMenuEntry =
  | {
      type: 'action';
      id: DesktopActionId;
      label: string;
    }
  | {
      type: 'edit';
      role: EditRole;
      label: string;
      enabled: boolean;
    }
  | {
      type: 'separator';
    };

export type ApplicationMenuSection =
  | {
      type: 'role';
      role: 'appMenu' | 'editMenu' | 'windowMenu';
    }
  | {
      type: 'agent';
      label: '客服 Agent';
      items: readonly DesktopMenuEntry[];
    };

export type EditCapabilities = {
  canUndo: boolean;
  canRedo: boolean;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canSelectAll: boolean;
};

const ACTIONS = {
  'open-search': { type: 'action', id: 'open-search', label: '打开话术查询' },
  'open-dashboard': { type: 'action', id: 'open-dashboard', label: '打开运营工作台' },
  quit: { type: 'action', id: 'quit', label: '退出 Demo' },
} as const satisfies Record<DesktopActionId, DesktopMenuEntry>;

const EDIT_LABELS: Readonly<Record<EditRole, string>> = {
  undo: '撤销',
  redo: '重做',
  cut: '剪切',
  copy: '复制',
  paste: '粘贴',
  selectAll: '全选',
};

const EDIT_CAPABILITY_BY_ROLE: Readonly<Record<EditRole, keyof EditCapabilities>> = {
  undo: 'canUndo',
  redo: 'canRedo',
  cut: 'canCut',
  copy: 'canCopy',
  paste: 'canPaste',
  selectAll: 'canSelectAll',
};

const EDIT_GROUPS: readonly (readonly EditRole[])[] = [
  ['undo', 'redo'],
  ['cut', 'copy', 'paste'],
  ['selectAll'],
];

function action(id: DesktopActionId): DesktopMenuEntry {
  return { ...ACTIONS[id] };
}

function separator(): DesktopMenuEntry {
  return { type: 'separator' };
}

function editEntries(capabilities: EditCapabilities): DesktopMenuEntry[] {
  return EDIT_GROUPS.flatMap((group, groupIndex) => [
    ...(groupIndex === 0 ? [] : [separator()]),
    ...group.map((role): DesktopMenuEntry => ({
      type: 'edit',
      role,
      label: EDIT_LABELS[role],
      enabled: capabilities[EDIT_CAPABILITY_BY_ROLE[role]],
    })),
  ]);
}

export function createOverlayContextMenuModel(
  capabilities: EditCapabilities | null,
): readonly DesktopMenuEntry[] {
  const editing = capabilities ? [...editEntries(capabilities), separator()] : [];
  return [
    ...editing,
    action('open-search'),
    action('open-dashboard'),
    separator(),
    action('quit'),
  ];
}

export function createTrayMenuModel(): readonly DesktopMenuEntry[] {
  return [
    action('open-search'),
    action('open-dashboard'),
    separator(),
    action('quit'),
  ];
}

export function createApplicationMenuModel(
  platform: NodeJS.Platform,
): readonly ApplicationMenuSection[] {
  const agentItems: DesktopMenuEntry[] = [action('open-search'), action('open-dashboard')];
  if (platform !== 'darwin') {
    agentItems.push(separator(), action('quit'));
  }
  return [
    { type: 'role', role: 'appMenu' },
    { type: 'agent', label: '客服 Agent', items: agentItems },
    { type: 'role', role: 'editMenu' },
    { type: 'role', role: 'windowMenu' },
  ];
}

export type TrayIconLocation = {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
};

export function trayIconPath(location: TrayIconLocation): string {
  return location.isPackaged
    ? join(location.resourcesPath, 'fox-head.png')
    : join(location.appPath, 'fox-head.png');
}

export function trayIconCandidates(location: TrayIconLocation): readonly string[] {
  if (location.isPackaged) {
    return [trayIconPath(location)];
  }
  // `electron-vite dev` reports the project root as appPath, while launching
  // the compiled entry directly (as Playwright does) reports `out/main`.
  // Keep both deterministic locations so the menu-bar entry works in either
  // supported development path without relying on the caller's cwd.
  return Array.from(
    new Set([
      trayIconPath(location),
      resolve(location.appPath, '../..', 'fox-head.png'),
    ]),
  );
}
