// One row is one live page. DASHBOARD_NAV is a projection of these rows.
export const INTAKE_DESTINATION_ROWS = [
  {
    id: 'overview',
    label: '概览',
    blurb: '当前登录者的查询、待办和不准样本',
    group: '经营总览',
    audience: 'staff',
    needsPermissionBridge: false,
    keepAlive: false,
  },
  {
    id: 'wording',
    label: '话术库',
    blurb: '当前可用话术目录',
    group: '话术运营',
    audience: 'everyone',
    needsPermissionBridge: false,
    keepAlive: true,
  },
  {
    id: 'sop',
    label: 'SOP',
    blurb: '当前产品会话 SOP 树',
    group: '话术运营',
    audience: 'everyone',
    needsPermissionBridge: false,
    keepAlive: false,
  },
  {
    id: 'content',
    label: '知识库',
    blurb: '人设知识',
    group: '治理与架构',
    audience: 'staff',
    needsPermissionBridge: false,
    keepAlive: true,
  },
  {
    id: 'materials',
    label: '资料',
    blurb: '上传、确认来源、发布、回退',
    group: '治理与架构',
    audience: 'staff',
    needsPermissionBridge: false,
    keepAlive: false,
  },
  {
    id: 'permissions',
    label: '权限',
    blurb: '授权',
    group: '治理与架构',
    audience: 'staff',
    needsPermissionBridge: true,
    keepAlive: true,
  },
] as const satisfies readonly {
  readonly id: string;
  readonly label: string;
  readonly blurb: string;
  readonly group: '经营总览' | '话术运营' | '治理与架构';
  readonly audience: 'everyone' | 'staff';
  readonly needsPermissionBridge: boolean;
  readonly keepAlive: boolean;
}[];

type RowId<Row> = Row extends { readonly id: infer Id extends string } ? Id : never;

// The assignment below fails when two rows share an id.
type AssertUniqueIds<
  Rows extends readonly { readonly id: string }[],
  Seen extends string = never,
> = Rows extends readonly [infer Head, ...infer Tail]
  ? RowId<Head> extends Seen
    ? never
    : Tail extends readonly { readonly id: string }[]
      ? AssertUniqueIds<Tail, Seen | RowId<Head>>
      : true
  : true;

const _intakeDestinationIdsAreUnique: AssertUniqueIds<typeof INTAKE_DESTINATION_ROWS> = true;

export type IntakeDestinationRow = (typeof INTAKE_DESTINATION_ROWS)[number];
export type IntakeDestination = IntakeDestinationRow['id'];
export type IntakeDestinationGroup = IntakeDestinationRow['group'];
export type IntakeSidebarItem = IntakeDestinationRow;

export const INTAKE_DESTINATIONS: readonly IntakeDestination[] = INTAKE_DESTINATION_ROWS.map((row) => row.id);

// The assignment fails if `announce` is added to the live sidebar.
type AnnounceExcluded = 'announce' extends IntakeDestination ? never : true;
export const intakeDestinationsExcludeAnnounce: AnnounceExcluded = true;

const INTAKE_DESTINATION_SET: ReadonlySet<string> = new Set(INTAKE_DESTINATIONS);

export function isIntakeDestination(value: string): value is IntakeDestination {
  return INTAKE_DESTINATION_SET.has(value);
}

export function intakeDestinationItem(id: IntakeDestination): IntakeSidebarItem {
  for (const row of INTAKE_DESTINATION_ROWS) {
    if (row.id === id) return row;
  }
  return INTAKE_DESTINATION_ROWS[0];
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

/**
 * Before the job is known, and for a resolved 客服坐席, the sidebar is 话术库 and SOP.
 * A resolved non-seat also sees staff rows. 权限 also needs the permissions bridge.
 */
export function intakeSidebarItems(
  canOpenPermissions: boolean,
  seatLibraryOnly: boolean,
  jobKnown: boolean,
): readonly IntakeSidebarItem[] {
  return INTAKE_DESTINATION_ROWS.filter((row) => {
    if (row.audience === 'staff' && (!jobKnown || seatLibraryOnly)) return false;
    if (row.needsPermissionBridge && !canOpenPermissions) return false;
    return true;
  });
}
