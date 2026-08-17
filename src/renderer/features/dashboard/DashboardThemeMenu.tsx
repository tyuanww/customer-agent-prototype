import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  DASHBOARD_THEME_OPTIONS,
  focusAdjacentTabbable,
  type DashboardThemeMode,
} from '../../lib/dashboard-appearance';
import { DashboardChromeIcon } from './DashboardIcons';

type ThemeMenuCloseReason = 'restore' | 'tab-forward' | 'tab-backward' | 'dismiss';

export function DashboardThemeMenu({
  themeMode,
  onChange,
}: {
  themeMode: DashboardThemeMode;
  onChange: (mode: DashboardThemeMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const closeReasonRef = useRef<ThemeMenuCloseReason | null>(null);
  const selectedIndex = Math.max(
    0,
    DASHBOARD_THEME_OPTIONS.findIndex((option) => option.mode === themeMode),
  );
  const [rovingIndex, setRovingIndex] = useState(selectedIndex);

  const closeMenu = useCallback((reason: ThemeMenuCloseReason) => {
    closeReasonRef.current = reason;
    setOpen(false);
  }, []);

  const openMenu = useCallback((index: number) => {
    closeReasonRef.current = null;
    setRovingIndex(index);
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const root = triggerRef.current?.closest('.dashboard-theme-menu');
      if (root?.contains(target)) return;
      closeMenu('dismiss');
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [closeMenu, open]);

  useLayoutEffect(() => {
    if (open) {
      itemRefs.current[rovingIndex]?.focus({ preventScroll: true });
      return;
    }

    const reason = closeReasonRef.current;
    closeReasonRef.current = null;
    const trigger = triggerRef.current;
    if (!trigger) return;
    if (reason === 'restore') {
      trigger.focus({ preventScroll: true });
      return;
    }
    if (reason === 'tab-forward' || reason === 'tab-backward') {
      focusAdjacentTabbable(trigger, reason === 'tab-forward' ? 'forward' : 'backward');
    }
  }, [open, rovingIndex]);

  const handleTriggerKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu(selectedIndex);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(selectedIndex);
    }
  };

  const handleMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu('restore');
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      closeMenu(event.shiftKey ? 'tab-backward' : 'tab-forward');
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setRovingIndex((index) => (index + 1) % DASHBOARD_THEME_OPTIONS.length);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setRovingIndex((index) => (
        (index - 1 + DASHBOARD_THEME_OPTIONS.length) % DASHBOARD_THEME_OPTIONS.length
      ));
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setRovingIndex(0);
    }
    if (event.key === 'End') {
      event.preventDefault();
      setRovingIndex(DASHBOARD_THEME_OPTIONS.length - 1);
    }
  };

  const currentOption = DASHBOARD_THEME_OPTIONS.find((option) => option.mode === themeMode)
    ?? DASHBOARD_THEME_OPTIONS[2];

  return (
    <div className="dashboard-theme-menu" data-testid="dashboard-theme-switcher">
      <button
        ref={triggerRef}
        type="button"
        className="dashboard-theme-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="dashboard-theme-menu"
        aria-label={`外观：${currentOption.label}`}
        title={`外观：${currentOption.label}`}
        data-testid="dashboard-theme-trigger"
        onClick={() => (open ? closeMenu('dismiss') : openMenu(selectedIndex))}
        onKeyDown={handleTriggerKey}
      >
        <DashboardChromeIcon id={themeMode} />
      </button>
      {open ? (
        <div
          id="dashboard-theme-menu"
          className="dashboard-theme-popover"
          role="menu"
          aria-label="工作台外观"
          data-testid="dashboard-theme-menu"
          onKeyDown={handleMenuKey}
        >
          {DASHBOARD_THEME_OPTIONS.map((option, index) => {
            const selected = themeMode === option.mode;
            return (
              <button
                key={option.mode}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={index === rovingIndex ? 0 : -1}
                className={selected ? 'is-selected' : ''}
                data-testid={`dashboard-theme-${option.mode}`}
                onClick={() => {
                  onChange(option.mode);
                  closeMenu('restore');
                }}
              >
                <DashboardChromeIcon id={option.mode} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
