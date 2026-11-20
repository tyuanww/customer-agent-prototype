import { useEffect, useRef } from 'react';

export function SopBookmark({ name }: { name: string }) {
  const timer = useRef<number | undefined>(undefined);
  const cancelHover = () => window.clearTimeout(timer.current);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <button
    type="button"
    className="sop-bookmark"
    aria-label={`恢复 ${name}`}
    title={name}
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
  >{name}</button>;
}
