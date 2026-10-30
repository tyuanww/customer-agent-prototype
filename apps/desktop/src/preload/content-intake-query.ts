import { ipcRenderer } from 'electron';
import { IPC_CHANNELS as C } from '../shared/ipc-channels';
import { exactKeys } from '../shared/product-session';
import { intakeQueryFailure, isIntakeFailure, isIntakeContextResult, isIntakeSearchResult,
  isIntakeSelection, isIntakeShopRequest, isIntakeSearchRequest, isIntakeCopyRequest, isIntakeQueryInvalidationEvent,
  type IntakeQueryApi, type IntakeQueryInvalidationEvent, type IntakeQueryResult } from '../shared/content-intake-query';

const listeners = new Set<(event: IntakeQueryInvalidationEvent) => void>();
ipcRenderer.on(C.INTAKE_QUERY_INVALIDATED, (_event, ...args: unknown[]) => {
  if (args.length === 1 && isIntakeQueryInvalidationEvent(args[0])) for (const listener of listeners) listener(args[0]);
});
async function invoke<T>(channel: string, args: unknown[], valid: (value: unknown) => value is IntakeQueryResult<T>): Promise<IntakeQueryResult<T>> {
  try {
    const value: unknown = await ipcRenderer.invoke(channel, ...args);
    return valid(value) ? value : intakeQueryFailure('UNAVAILABLE');
  } catch { return intakeQueryFailure('UNAVAILABLE'); }
}
/** Kept in the overlay bundle; never imported by independent sandbox preloads. */
export const intakeQuery: IntakeQueryApi = {
  mode: () => invoke(C.INTAKE_QUERY_MODE, [], (v): v is IntakeQueryResult<{ enabled: boolean }> => isIntakeFailure(v)
    || (exactKeys(v, ['ok', 'enabled']) && v.ok === true && typeof v.enabled === 'boolean')),
  access: () => invoke(C.INTAKE_QUERY_ACCESS, [], isIntakeContextResult),
  selectShop: request => isIntakeShopRequest(request) ? invoke(C.INTAKE_QUERY_SELECT, [request], isIntakeContextResult)
    : Promise.resolve(intakeQueryFailure('VALIDATION')),
  selectConditions: request => isIntakeSelection(request) ? invoke(C.INTAKE_QUERY_CONDITIONS, [request], isIntakeContextResult)
    : Promise.resolve(intakeQueryFailure('VALIDATION')),
  search: request => isIntakeSearchRequest(request) ? invoke(C.INTAKE_QUERY_SEARCH, [request], isIntakeSearchResult)
    : Promise.resolve(intakeQueryFailure('VALIDATION')),
  copy: request => isIntakeCopyRequest(request) ? invoke(C.INTAKE_QUERY_COPY, [request], (v): v is IntakeQueryResult<{ copied: true }> => isIntakeFailure(v)
    || (exactKeys(v, ['ok', 'copied']) && v.ok === true && v.copied === true)) : Promise.resolve(intakeQueryFailure('VALIDATION')),
  cancel: () => invoke(C.INTAKE_QUERY_CANCEL, [], (v): v is IntakeQueryResult<{ cancelled: true }> => isIntakeFailure(v)
    || (exactKeys(v, ['ok', 'cancelled']) && v.ok === true && v.cancelled === true)),
  onInvalidated: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
