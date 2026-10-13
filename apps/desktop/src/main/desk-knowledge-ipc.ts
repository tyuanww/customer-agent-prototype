import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { DeskKnowledgeStore, isDeskCommand, type DeskReply, type DeskRole } from '../shared/desk-knowledge';
import type { ProductSession } from './product-session';
import { isTrustedMainFrameSender } from './sender-guard';

const CURRENT = 'dashboard:desk-current';
const COMMAND = 'dashboard:desk-command';

function openStore(directory: string): DeskKnowledgeStore {
  const file = join(directory, 'desk-knowledge.json');
  return new DeskKnowledgeStore({
    now: () => new Date().toISOString(),
    load: () => {
      try {
        return readFileSync(file, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        // A damaged or unreadable file must not take down the dashboard.
        return '{}';
      }
    },
    save: (raw) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, raw, { mode: 0o600 });
    },
  });
}

/** The dashboard main frame is the only caller. Role comes from the product
 * session, never from the renderer. */
export function registerDeskKnowledgeIpc(
  session: ProductSession | null,
  dashboard: () => WebContents | null,
  devUrl: () => string | undefined,
  userDataDirectory: string,
): { dispose(): void } {
  const store = session ? openStore(userDataDirectory) : null;
  const roleOf = (): { role: DeskRole | null; displayName: string | null } => {
    const view = session?.view();
    if (!view?.signedIn || !view.role) return { role: null, displayName: view?.displayName ?? null };
    return { role: view.role === 'agent' ? 'seat' : 'operator', displayName: view.displayName };
  };
  const refuse = (code: 'FORBIDDEN' | 'UNAVAILABLE', message: string): DeskReply => ({ ok: false, code, message, view: null });
  const handle = (event: IpcMainInvokeEvent, command?: unknown): DeskReply => {
    const contents = dashboard();
    if (!contents || !isTrustedMainFrameSender(event, [contents], devUrl())) return refuse('FORBIDDEN', '请求未完成或权限已改变。');
    if (!store) return refuse('UNAVAILABLE', '当前运行模式没有接上知识库。');
    const actor = roleOf();
    if (command === undefined) return store.reply(actor.role, actor.displayName);
    if (!isDeskCommand(command)) return { ok: false, code: 'VALIDATION', message: '请检查输入。', view: store.reply(actor.role, actor.displayName).view };
    return store.command(actor.role, command, actor.displayName);
  };
  ipcMain.handle(CURRENT, (event) => handle(event));
  ipcMain.handle(COMMAND, (event, command: unknown) => handle(event, command));
  return { dispose: () => { ipcMain.removeHandler(CURRENT); ipcMain.removeHandler(COMMAND); } };
}
