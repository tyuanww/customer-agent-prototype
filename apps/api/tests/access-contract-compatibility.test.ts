import { expect, it } from 'vitest';
import type {
  AccessDecision as ArcAccessDecision,
  AdminAccessView as ArcAdminAccessView,
  DashboardSettingsView as ArcDashboardSettingsView,
  QueryAccessView as ArcQueryAccessView,
} from '../../../packages/unified-contracts/src/index.js';
import type {
  AccessDecision,
  AdminAccessView,
  DashboardSettingsView,
  QueryAccessView,
} from '../src/access/evaluator.js';

type Assignable<Contract, Local extends Contract> = Local;

type DecisionContract = Assignable<ArcAccessDecision, AccessDecision>;
type QueryContract = Assignable<ArcQueryAccessView, QueryAccessView>;
type SettingsContract = Assignable<ArcDashboardSettingsView, DashboardSettingsView>;
type AdminContract = Assignable<ArcAdminAccessView, AdminAccessView>;

it('keeps evaluator projections structurally compatible with the shared contracts', () => {
  const proofs: [DecisionContract?, QueryContract?, SettingsContract?, AdminContract?] = [];
  expect(proofs).toHaveLength(0);
});
