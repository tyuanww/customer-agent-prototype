import { exactKeys } from './product-session';
import { isIntakeSelection, isIntakeShopRequest, type IntakeQueryContext } from './content-intake-query';
export type IntakeCatalogRow = {
  /** `sop` is a presentation bucket derived from the source's registered tuple, not a
   * scope domain: the frozen contract has no `sop` domain, so SOP workbooks are
   * registered under an existing scope and flagged by their mapping version. */
  id: string; domain: 'product' | 'campaign' | 'presale' | 'aftersale' | 'sop';
  title: string; answerText: string; applicabilityNote: string; riskNote: string; category: string;
  scriptVersion: number; effectiveFrom: string; effectiveTo: string | null;
};
/** A complete current-selection projection, never a whole-shop inventory or an
 * authorization ticket. No copy handle or provider/session token crosses here. */
export type IntakeCatalogView = {
  signedIn: boolean; busy: boolean; context: IntakeQueryContext;
  releaseId: string | null; validUntil: string | null; rows: IntakeCatalogRow[];
};
export type IntakeCatalogCommand = { action: 'refresh' | 'cancel' }
  | { action: 'select-shop'; shopId: string }
  | { action: 'select-conditions'; productIds: string[]; scenarioIds: string[] };
export type IntakeCatalogReply = { ok: true; view: IntakeCatalogView }
  | { ok: false; code: string; message: string; view: IntakeCatalogView | null };
export type IntakeCatalogApi = {
  current(): Promise<IntakeCatalogReply>;
  command(command: IntakeCatalogCommand): Promise<IntakeCatalogReply>;
  onInvalidated(listener: () => void): () => void;
};
export function isIntakeCatalogCommand(value: unknown): value is IntakeCatalogCommand {
  if (!value || typeof value !== 'object' || !('action' in value)) return false;
  const record = value as Record<string, unknown>;
  if (record.action === 'refresh' || record.action === 'cancel') return exactKeys(value, ['action']);
  if (record.action === 'select-shop') return exactKeys(value, ['action','shopId']) && isIntakeShopRequest({ shopId: record.shopId });
  return record.action === 'select-conditions' && exactKeys(value, ['action','productIds','scenarioIds'])
    && isIntakeSelection({ productIds: record.productIds, scenarioIds: record.scenarioIds });
}
