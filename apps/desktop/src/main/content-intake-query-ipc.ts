import { ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS as C } from '../shared/ipc-channels';
import { intakeQueryFailure, isIntakeSelection, isIntakeCopyRequest, isIntakeSearchRequest, isIntakeShopRequest } from '../shared/content-intake-query';
import type { OverlayRole } from '../shared/overlay-events';
import { isTrustedMainFrameSender } from './sender-guard';
import { ContentIntakeQuery } from './content-intake-query';
import { IntakeUsageError, type IntakeUsageSession } from './content-intake-usage';
import { writeSystemClipboard } from './system-clipboard';

/** The caller supplies a session only when its configured workbench enables intake.
 * A capability belongs to one trusted Query main frame and dies with its window. */
export function registerContentIntakeQueryIpc(session: IntakeUsageSession | null,
  trusted: () => WebContents[], role: (sender: WebContents) => OverlayRole | null,
  devUrl: () => string | undefined) {
  const windows = new Map<WebContents, ContentIntakeQuery>();
  const channels = [C.INTAKE_QUERY_MODE, C.INTAKE_QUERY_ACCESS, C.INTAKE_QUERY_SELECT,
    C.INTAKE_QUERY_CONDITIONS, C.INTAKE_QUERY_SEARCH, C.INTAKE_QUERY_COPY, C.INTAKE_QUERY_CANCEL];
  for (const channel of channels) ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    if (!isTrustedMainFrameSender(event, trusted(), devUrl()) || role(event.sender) !== 'query') return intakeQueryFailure('FORBIDDEN');
    const valid = channel === C.INTAKE_QUERY_SELECT ? args.length === 1 && isIntakeShopRequest(args[0])
      : channel === C.INTAKE_QUERY_CONDITIONS ? args.length === 1 && isIntakeSelection(args[0])
      : channel === C.INTAKE_QUERY_SEARCH ? args.length === 1 && isIntakeSearchRequest(args[0])
        : channel === C.INTAKE_QUERY_COPY ? args.length === 1 && isIntakeCopyRequest(args[0]) : args.length === 0;
    if (!valid) return intakeQueryFailure('VALIDATION');
    if (channel === C.INTAKE_QUERY_MODE) return { ok: true, enabled: session !== null };
    if (!session) return intakeQueryFailure('UNAVAILABLE');
    let query = windows.get(event.sender);
    if (!query) {
      query = new ContentIntakeQuery(session, writeSystemClipboard); windows.set(event.sender, query);
      const owned = query;
      query.subscribe(invalidation => {
        if (!event.sender.isDestroyed()) event.sender.send(C.INTAKE_QUERY_INVALIDATED, invalidation);
      });
      event.sender.once('destroyed', () => { windows.delete(event.sender); owned.dispose(); });
    }
    try {
      if (channel === C.INTAKE_QUERY_ACCESS) return { ok: true, ...await query.access() };
      if (channel === C.INTAKE_QUERY_SELECT && isIntakeShopRequest(args[0])) return { ok: true, ...await query.access(args[0].shopId) };
      if (channel === C.INTAKE_QUERY_CONDITIONS && isIntakeSelection(args[0])) return { ok: true, ...query.selectConditions(args[0]) };
      if (channel === C.INTAKE_QUERY_SEARCH && isIntakeSearchRequest(args[0])) return { ok: true, rows: await query.search(args[0].queryText, args[0].contextId) };
      if (channel === C.INTAKE_QUERY_COPY && isIntakeCopyRequest(args[0])) return { ok: true, ...await query.copy(args[0].key) };
      query.cancel(); return { ok: true, cancelled: true };
    } catch (error) { return intakeQueryFailure(error instanceof IntakeUsageError ? error.code : 'UNAVAILABLE'); }
  });
  return () => {
    for (const query of windows.values()) query.dispose(); windows.clear();
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
