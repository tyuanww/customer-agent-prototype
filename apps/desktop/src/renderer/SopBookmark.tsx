import { useEffect, useRef } from 'react';
import { sopCaseLabel } from '@shared/sop-unified';

export function SopBookmark({ caseNumber, name }: { caseNumber: number; name: string }) {
  const label = sopCaseLabel(caseNumber, name);
  const timer = useRef<number | undefined>(undefined);
  const cancelHover = () => window.clearTimeout(timer.current);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <button
    type="button"
    className="sop-bookmark"
    aria-label={`恢复 ${label}`}
    title={label}
    onPointerEnter={event => {
      if (event.pointerType !== 'mouse') return;
      cancelHover();
      timer.current = window.setTimeout(() => { void window.sopWindow?.bookmark?.('restore-hover'); }, 150);
    }}
    onPointerLeave={cancelHover}
    onClick={() => {
      cancelHover();
      void window.sopWindow?.bookmark?.('restore');
    }}
  >{label}</button>;
}
