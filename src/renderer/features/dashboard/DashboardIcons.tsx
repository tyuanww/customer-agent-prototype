export type DashboardNavIconId =
  | 'overview'
  | 'workorders'
  | 'ledger'
  | 'review'
  | 'wording'
  | 'iteration'
  | 'content'
  | 'announce'
  | 'architecture'
  | 'workorder-trash';

const NAV_ICON_PATHS: Record<DashboardNavIconId, readonly string[]> = {
  overview: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  workorders: ['M6 3h9l3 3v15H6z', 'M9 11h6', 'M9 15h6'],
  ledger: ['M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14', 'm16 16 4 4'],
  review: ['M5 4h14v16H5z', 'm8 10 2 2 5-5', 'M8 16h8'],
  wording: ['M4 5c3-1 6 0 8 2v13c-2-2-5-3-8-2z', 'M20 5c-3-1-6 0-8 2v13c2-2 5-3 8-2z'],
  iteration: ['M20 7v5h-5', 'M4 17v-5h5', 'M18.5 9A7 7 0 0 0 6 7', 'M5.5 15A7 7 0 0 0 18 17'],
  content: ['M12 3v12', 'm8 7 4-4 4 4', 'M5 14v6h14v-6'],
  announce: ['M6 17h12l-2-3v-4a4 4 0 0 0-8 0v4z', 'M10 20h4'],
  architecture: ['M12 4v5', 'M5 20v-5h14v5', 'M5 15h14', 'm12 9-7 6', 'm12-6 7 6'],
  'workorder-trash': ['M4 7h16', 'M9 7V4h6v3', 'M7 7l1 14h8l1-14'],
};

export function DashboardNavIcon({ id }: { id: DashboardNavIconId }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {NAV_ICON_PATHS[id].map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

export type DashboardChromeIconId = 'panel-close' | 'panel-open' | 'light' | 'dark' | 'system';

const CHROME_ICON_PATHS: Record<DashboardChromeIconId, readonly string[]> = {
  'panel-close': ['M4 4.5h16v15H4z', 'M9 4.5v15', 'm16 9-3 3 3 3'],
  'panel-open': ['M4 4.5h16v15H4z', 'M9 4.5v15', 'm13 9 3 3-3 3'],
  light: ['M12 3v2', 'M12 19v2', 'M3 12h2', 'M19 12h2', 'm5.6-5.4-1.4-1.4', 'm11.6 11.6-1.4-1.4', 'm0-9.2 1.4-1.4', 'm-11.6 11.6 1.4-1.4', 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
  dark: ['M20 15.2A8 8 0 0 1 8.8 4 8.2 8.2 0 1 0 20 15.2'],
  system: ['M4 5h16v11H4z', 'M9 20h6', 'M12 16v4'],
};

export function DashboardChromeIcon({ id }: { id: DashboardChromeIconId }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {CHROME_ICON_PATHS[id].map((path) => <path key={path} d={path} />)}
    </svg>
  );
}
