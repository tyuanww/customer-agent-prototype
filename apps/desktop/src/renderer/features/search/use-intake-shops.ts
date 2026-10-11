import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyIntakeQueryContext, type IntakeQuerySelection, type IntakeQueryContext } from '@shared/content-intake-query';

/** Menu intent state only. Main must authorize even IDs returned by this hook. */
export function useIntakeShops(enabled: boolean, signedIn: boolean, epoch: number, reset: () => void) {
  const [context, setContext] = useState<IntakeQueryContext>(emptyIntakeQueryContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  // Notice changes update view-reset behavior without restarting discovery.
  const resetRef = useRef(reset); resetRef.current = reset;
  const load = useCallback(async (shopId?: string) => {
    const api = window.customerAgent?.intakeQuery;
    if (!enabled || !signedIn || !api) return;
    const request = ++sequence.current;
    resetRef.current(); setBusy(true); setError(''); setContext(emptyIntakeQueryContext());
    try {
      const value = await (shopId ? api.selectShop({ shopId }) : api.access());
      if (request !== sequence.current) return;
      if (value.ok) setContext(value);
      else setError(value.message);
    } catch { if (request === sequence.current) setError('店铺读取失败，请重试。'); }
    finally { if (request === sequence.current) { resetRef.current(); setBusy(false); } }
  }, [enabled, signedIn]);
  const selectConditions = useCallback(async (selection: IntakeQuerySelection) => {
    const api = window.customerAgent?.intakeQuery;
    if (!enabled || !signedIn || !api) return;
    const request = ++sequence.current;
    resetRef.current(); setBusy(true); setError('');
    // Reflect the checkbox intent immediately; search stays disabled until Main accepts it.
    setContext(current => ({ ...current, ...selection }));
    try {
      const value = await api.selectConditions(selection);
      if (request !== sequence.current) return;
      if (value.ok) setContext(value);
      else { setContext(emptyIntakeQueryContext()); setError(value.message); }
    } catch {
      if (request === sequence.current) { setContext(emptyIntakeQueryContext()); setError('筛选条件更新失败，请刷新店铺。'); }
    } finally { if (request === sequence.current) { resetRef.current(); setBusy(false); } }
  }, [enabled, signedIn]);
  useEffect(() => {
    if (!context.validUntil) return;
    const timer = setTimeout(() => {
      sequence.current++; resetRef.current(); setContext(emptyIntakeQueryContext()); setBusy(false);
      setError('筛选资格已到期，请刷新店铺。');
    }, Math.max(0, Math.min(2_147_483_647, Date.parse(context.validUntil) - Date.now())));
    return () => clearTimeout(timer);
  }, [context.validUntil]);
  useEffect(() => {
    if (!context.shopNamesValidUntil) return;
    const timer = setTimeout(() => setContext(current => ({ ...current, shopNames: [], shopNamesValidUntil: null })),
      Math.max(0, Math.min(2_147_483_647, Date.parse(context.shopNamesValidUntil)-Date.now())));
    return () => clearTimeout(timer);
  }, [context.shopNamesValidUntil]);
  const invalidate = useCallback(() => { sequence.current++; }, []);
  useEffect(() => {
    invalidate(); setContext(emptyIntakeQueryContext()); setError(''); setBusy(false);
    if (enabled && signedIn) void load();
    return invalidate;
  }, [enabled, signedIn, epoch, load, invalidate]);
  return { ...context, busy, error, load, selectConditions };
}
