// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, BrowserWindow: {}, dialog: {}, ipcMain: {} }));
import {
  operationRecoveryCommand,
  operationRecoveryOutcome,
} from '../../src/main/content-intake-management-ipc';
import type { IntakeManagementView } from '../../src/shared/content-intake-management';

it('uses the original idempotent confirmation when source confirmation is unknown', () => {
  expect(operationRecoveryCommand('materials', 'source-confirm')).toEqual({ action: 'retry' });
  expect(operationRecoveryCommand('materials', 'publish')).toEqual({ action: 'recover' });
  expect(operationRecoveryCommand('rollback', 'rollback')).toEqual({ action: 'rollback-recover' });
});

it('does not settle an unknown review from a different quality receipt', () => {
  const base = {
    pending: null,
    rollback: { pending: null, result: null },
    workflowResult: null,
    receipt: {
      operationId: 'quality-op-old',
      action: 'quality-freeze',
      state: 'initial_required',
      phase: null,
    },
  } as unknown as IntakeManagementView;

  expect(operationRecoveryOutcome(base, 'materials', 'review', 'control-op', 'quality-op-new'))
    .toEqual({ kind: 'unknown' });
  expect(operationRecoveryOutcome(base, 'materials', 'review', 'control-op', 'quality-op-old'))
    .toEqual({ kind: 'committed', resultRef: 'quality-op-old' });
});
