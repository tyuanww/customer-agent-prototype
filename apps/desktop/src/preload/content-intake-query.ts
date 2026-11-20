import { ipcRenderer } from 'electron';
import { IPC_CHANNELS as C } from '../shared/ipc-channels';
import { exactKeys } from '../shared/product-session';
import { intakeQueryFailure, isIntakeFailure, isIntakeContextResult, isIntakeSearchResult,
  isIntakeSelection, isIntakeShopRequest, isIntakeSearchRequest, isIntakeCopyRequest, isIntakeQueryInvalidationEvent,
  isIntakeSopCandidateRequest, isIntakeSopCandidatesEvent,
  type IntakeQueryApi, type IntakeQueryInvalidationEvent, type IntakeQueryResult, type IntakeSopCandidatesEvent } from '../shared/content-intake-query';

const listeners = new Set<(event: IntakeQueryInvalidationEvent) => void>();
ipcRenderer.on(C.INTAKE_QUERY_INVALIDATED, (_event, ...args: unknown[]) => {
  if (args.length === 1 && isIntakeQueryInvalidationEvent(args[0])) for (const listener of listeners) listener(args[0]);
});
const sopListeners = new Set<(event: IntakeSopCandidatesEvent) => void>();
ipcRenderer.on(C.INTAKE_QUERY_SOP_CANDIDATES, (_event, ...args: unknown[]) => {
  if (args.length === 1 && isIntakeSopCandidatesEvent(args[0])) for (const listener of sopListeners) listener(args[0]);
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
  cancel: reason => reason === undefined || reason === 'overlay-handoff'
    ? invoke(C.INTAKE_QUERY_CANCEL, reason === undefined ? [] : [reason],
      (v): v is IntakeQueryResult<{ cancelled: true }> => isIntakeFailure(v)
        || (exactKeys(v, ['ok', 'cancelled']) && v.ok === true && v.cancelled === true))
    : Promise.resolve(intakeQueryFailure('VALIDATION')),
  openSopCandidate: request => isIntakeSopCandidateRequest(request)
    ? invoke(C.INTAKE_QUERY_OPEN_SOP_CANDIDATE, [request], (v): v is IntakeQueryResult<{ opened: true }> => isIntakeFailure(v)
      || (exactKeys(v, ['ok', 'opened']) && v.ok === true && v.opened === true))
    : Promise.resolve(intakeQueryFailure('VALIDATION')),
  onSopCandidates: listener => { sopListeners.add(listener); return () => { sopListeners.delete(listener); }; },
  onInvalidated: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
