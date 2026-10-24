import { DASHBOARD_NAV, type DashboardNavItem } from '../../data/dashboard-manifest';

export const INTAKE_MODULE_IDS = ['overview', 'wording', 'sop', 'content'] as const;
export type IntakeModuleId = (typeof INTAKE_MODULE_IDS)[number];

export const INTAKE_DESTINATIONS = [
  ...INTAKE_MODULE_IDS,
  'permissions',
  'materials',
] as const;
export type IntakeDestination = (typeof INTAKE_DESTINATIONS)[number];

// The assignment fails if `announce` is added to `INTAKE_DESTINATIONS`.
type AnnounceExcluded = 'announce' extends IntakeDestination ? never : true;
export const intakeDestinationsExcludeAnnounce: AnnounceExcluded = true;

export type IntakeSidebarItem = {
  readonly id: IntakeDestination;
  readonly label: string;
  readonly group: DashboardNavItem['group'];
  readonly blurb?: string;
};

const INTAKE_DESTINATION_SET: ReadonlySet<string> = new Set(INTAKE_DESTINATIONS);

export function isIntakeDestination(value: string): value is IntakeDestination {
  return INTAKE_DESTINATION_SET.has(value);
}

/** Loopback `preview=intake` only. `announce` opens 话术库 and this function does not write the URL. */
export function readIntakePreviewPage(
  location: Pick<Location, 'hostname' | 'search'>,
  canOpenPermissions: boolean,
): IntakeDestination {
  const local = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  const params = new URLSearchParams(location.search);
  if (!local || params.get('preview') !== 'intake') return 'overview';
  const page = params.get('page');
  if (page === 'permissions' && !canOpenPermissions) return 'overview';
  if (page === 'announce') return 'wording';
  if (page !== null && isIntakeDestination(page)) return page;
  return 'overview';
}

function intakeModuleLabel(id: IntakeModuleId, navLabel: string): string {
  if (id === 'overview') return '概览';
  if (id === 'content') return '知识库';
  return navLabel;
}

/** `seatLibraryOnly` is a resolved 客服坐席. They get 话术库 and SOP. Other pages stay off the sidebar. */
export function intakeSidebarItems(canOpenPermissions: boolean, seatLibraryOnly = false): readonly IntakeSidebarItem[] {
  if (seatLibraryOnly) {
    return INTAKE_MODULE_IDS.filter((id) => id === 'wording' || id === 'sop').map((id) => {
      const nav = DASHBOARD_NAV.find((entry) => entry.id === id);
      if (!nav) throw new Error(`DASHBOARD_NAV is missing ${id}`);
      return { id, label: nav.label, group: nav.group, blurb: nav.blurb };
    });
  }
  const items: IntakeSidebarItem[] = INTAKE_MODULE_IDS.map((id) => {
    const nav = DASHBOARD_NAV.find((entry) => entry.id === id);
    if (!nav) throw new Error(`DASHBOARD_NAV is missing ${id}`);
    return {
      id,
      label: intakeModuleLabel(id, nav.label),
      group: nav.group,
      blurb: nav.blurb,
    };
  });
  items.push({ id: 'materials', label: '资料', group: '治理与架构' });
  if (canOpenPermissions) {
    items.push({ id: 'permissions', label: '权限', group: '治理与架构' });
  }
  return items;
}
