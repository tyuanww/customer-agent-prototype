import { ipcMain, type WebContents } from 'electron';
import { isIntakeCatalogCommand, type IntakeCatalogReply } from '../shared/content-intake-catalog';
import { ContentIntakeCatalog } from './content-intake-catalog';
import { IntakeUsageError, type IntakeUsageSession } from './content-intake-usage';
import { isTrustedMainFrameSender } from './sender-guard';
const channels = ['dashboard:intake-catalog-current', 'dashboard:intake-catalog-command'] as const;
const messages: Record<string, string> = {
  FORBIDDEN: '当前账号没有此范围的查询权限。', UNAUTHORIZED: '请重新登录后查看。',
  NO_PRINCIPAL: '没有权限，请找人开通。', FACTS_EXPIRED: '资料资格过期了，请稍后重试。',
  NO_GRANT: '没有权限，请找人开通。', ROLE_UNKNOWN: '没有权限，请找人开通。',
  VALIDATION: '查看条件无效，请重新选择。', STALE: '条件或会话已变化，请重新刷新。',
  EXPIRED: '查看资格已到期，请重新刷新。', LIMIT: '当前结果过多，请缩小条件后刷新。',
  UNAVAILABLE: '资料目录暂不可用，请稍后刷新。',
};
/** Each trusted Dashboard main frame owns its read. No Query selection, clipboard,
 * raw qualification, URL or identity is accepted through this boundary. */
export function registerContentIntakeCatalogIpc(session: IntakeUsageSession | null,
  dashboard: () => WebContents | null, devUrl: () => string | undefined) {
  const owners = new Map<WebContents, ContentIntakeCatalog>();
  const failure = (code: string, owner?: ContentIntakeCatalog): IntakeCatalogReply =>
    ({ ok: false, code, message: messages[code] ?? messages.UNAVAILABLE!, view: owner?.view() ?? null });
  for (const channel of channels) ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<IntakeCatalogReply> => {
    const wc = dashboard();
    if (!wc || !isTrustedMainFrameSender(event, [wc], devUrl())
      || new URL(wc.getURL()).searchParams.get('role') !== 'dashboard') return failure('FORBIDDEN');
    if (channel === channels[0] ? args.length !== 0 : args.length !== 1 || !isIntakeCatalogCommand(args[0])) return failure('VALIDATION');
    if (!session) return failure('UNAVAILABLE');
    let owner = owners.get(wc);
    if (!owner) {
      owner = new ContentIntakeCatalog(session); owners.set(wc, owner); const owned = owner;
      owner.subscribe(() => { if (!wc.isDestroyed()) wc.send('dashboard:intake-catalog-invalidated'); });
      wc.once('destroyed', () => { owners.delete(wc); owned.dispose(); });
    }
    try {
      return { ok: true, view: channel === channels[0] ? owner.view() : await owner.command(args[0] as Parameters<ContentIntakeCatalog['command']>[0]) };
    } catch (error) { return failure(error instanceof IntakeUsageError ? error.code : 'UNAVAILABLE', owner); }
  });
  return () => { for (const owner of owners.values()) owner.dispose(); owners.clear(); for (const channel of channels) ipcMain.removeHandler(channel); };
}
