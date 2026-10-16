import { useEffect, useRef, useState } from 'react';
import type { DashboardContentDomain } from '@shared/dashboard-content';

export type LibraryOption = Readonly<{ value: DashboardContentDomain; label: string }>;

export function LibrarySelect({
  id,
  value,
  disabled,
  options,
  onChange,
}: {
  id: string;
  value: DashboardContentDomain | '';
  disabled?: boolean;
  options: readonly LibraryOption[];
  onChange: (value: DashboardContentDomain) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const selected = selectedRef.current;
    if (!list || !selected) return;
    const mid = list.clientHeight / 2;
    const target = selected.offsetTop + selected.offsetHeight / 2;
    list.scrollTop = Math.max(0, target - mid);
  }, [open, value]);

  return (
    <div className={`library-select${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        className="library-select-trigger"
        data-testid="content-domain-override"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((next) => !next)}
      >
        <span>{current?.label ?? '选择话术库'}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6.2 8 10l4-3.8" />
        </svg>
      </button>
      {open ? (
        <div
          ref={listRef}
          className="library-select-list"
          role="listbox"
          data-testid="content-domain-list"
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                ref={selected ? selectedRef : undefined}
                type="button"
                role="option"
                aria-selected={selected}
                data-testid={`content-domain-option-${option.value}`}
                className={`library-select-option${selected ? ' is-selected' : ''}${option.value === 'aftersale' ? ' is-aftersale' : ''}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
