export const INTAKE_DESTINATION_ROWS = [
  {
    id: 'overview',
    label: '工作台',
    blurb: '当前有权处理的资料和待办',
    group: '经营总览',
    audience: 'staff',
    needsPermissionBridge: false,
    keepAlive: false,
  },
  {
    id: 'wording',
    label: '内容库',
    blurb: '已发布话术与本机草稿',
    group: '话术运营',
    audience: 'everyone',
    needsPermissionBridge: false,
    keepAlive: true,
  },
  {
    id: 'sop',
    label: 'SOP',
    blurb: '学习与执行操作流程',
    group: '话术运营',
    audience: 'everyone',
    needsPermissionBridge: false,
    keepAlive: false,
  },
  {
    id: 'content',
    label: '内容库',
    blurb: '本机草稿',
    group: '治理与架构',
    audience: 'staff',
    needsPermissionBridge: false,
    keepAlive: true,
  },
  {
    id: 'materials',
    label: '资料审核',
    blurb: '上传、确认来源、发布',
    group: '治理与架构',
    audience: 'staff',
    needsPermissionBridge: false,
    keepAlive: true,
  },
  {
    id: 'permissions',
    label: '成员与权限',
    blurb: '授权',
    group: '治理与架构',
    audience: 'staff',
    needsPermissionBridge: false,
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

export function intakeRowVisible(
  row: IntakeDestinationRow,
  canOpenPermissions: boolean,
  seatLibraryOnly: boolean,
  jobKnown: boolean,
): boolean {
  if (row.id === 'permissions') return canOpenPermissions;
  if (row.audience === 'staff' && (!jobKnown || seatLibraryOnly)) return false;
  if (row.needsPermissionBridge && !canOpenPermissions) return false;
  return true;
}

export function intakeSidebarItems(
  canOpenPermissions: boolean,
  seatLibraryOnly: boolean,
  jobKnown: boolean,
): readonly IntakeSidebarItem[] {
  return INTAKE_DESTINATION_ROWS.filter((row) => row.id !== 'content' && intakeRowVisible(row, canOpenPermissions, seatLibraryOnly, jobKnown));
}
