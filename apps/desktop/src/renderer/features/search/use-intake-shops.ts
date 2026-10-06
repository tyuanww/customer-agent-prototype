import { useCallback, useEffect, useRef, useState } from 'react';
import type { IntakeQueryContext } from '@shared/content-intake-query';

/** Menu intent state only. Main must authorize even IDs returned by this hook. */
export function useIntakeShops(enabled: boolean, signedIn: boolean, epoch: number, reset: () => void) {
  const [context, setContext] = useState<IntakeQueryContext>({ shops: [], shopId: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  // Notice changes update view-reset behavior without restarting discovery.
  const resetRef = useRef(reset); resetRef.current = reset;
  const load = useCallback(async (shopId?: string) => {
    const api = window.customerAgent?.intakeQuery;
    if (!enabled || !signedIn || !api) return;
    const request = ++sequence.current;
    resetRef.current(); setBusy(true); setError(''); setContext({ shops: [], shopId: null });
    try {
      const value = await (shopId ? api.selectShop({ shopId }) : api.access());
      if (request !== sequence.current) return;
      if (value.ok) { setContext({ shops: value.shops, shopId: value.shopId }); resetRef.current(); }
      else setError(value.message);
    } catch { if (request === sequence.current) setError('店铺读取失败，请重试。'); }
    finally { if (request === sequence.current) setBusy(false); }
  }, [enabled, signedIn]);
  const invalidate = useCallback(() => { sequence.current++; }, []);
  useEffect(() => {
    invalidate(); setContext({ shops: [], shopId: null }); setError(''); setBusy(false);
    if (enabled && signedIn) void load();
    return invalidate;
  }, [enabled, signedIn, epoch, load, invalidate]);
  return { ...context, busy, error, load };
}
