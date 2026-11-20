import { useEffect, useRef, useState } from 'react';

export function useManualSopEntry(intake: boolean, sessionEpoch: number) {
  const [availableEpoch, setAvailableEpoch] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<object | null>(null);
  const available = intake && availableEpoch === sessionEpoch;

  useEffect(() => {
    if (!intake) return;
    let mounted = true;
    setError('');
    setBusy(false);
    const api = window.customerAgent?.sopWindow;
    void api?.entryAvailable().then(
      value => { if (mounted) setAvailableEpoch(value ? sessionEpoch : null); },
      () => { if (mounted) setAvailableEpoch(null); },
    );
    return () => {
      mounted = false;
      request.current = null;
    };
  }, [intake, sessionEpoch]);

  const open = async () => {
    const api = window.customerAgent?.sopWindow;
    if (!available || !api || request.current) return;
    const attempt = {};
    request.current = attempt;
    setError('');
    setBusy(true);
    let message: string;
    try {
      const result = await api.open('sop-query');
      message = result.ok ? '' : result.message;
    } catch {
      message = '流程没有打开，请重试。';
    }
    if (request.current !== attempt) return;
    request.current = null;
    setError(message);
    setBusy(false);
  };

  return available ? { busy, error, open } : null;
}

export function SopQueryEntry({ entry }: { entry: NonNullable<ReturnType<typeof useManualSopEntry>> }) {
  return <button type="button" className="intake-filter-toggle manual-sop-entry" aria-busy={entry.busy}
    aria-disabled={entry.busy || undefined} onClick={() => { void entry.open(); }}>手动找流程</button>;
}
