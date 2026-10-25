import { Fragment, type ReactNode } from 'react';
import type { AccessBlock } from '@shared/workbench-access';
import { DeskKnowledge } from './DeskKnowledge';
import { IntakeLibrary } from './IntakeLibrary';
import { IntakeManagement } from './IntakeManagement';
import { IntakeOverview } from './IntakeOverview';
import { IntakePermissions } from './IntakePermissions';
import { SopLibraryModule } from './SopLibraryModule';
import {
  INTAKE_DESTINATION_ROWS,
  type IntakeDestination,
  type IntakeDestinationRow,
} from './intake-destination-rows';

export type {
  IntakeDestination,
  IntakeDestinationGroup,
  IntakeSidebarItem,
} from './intake-destination-rows';
export {
  INTAKE_DESTINATIONS,
  intakeDestinationItem,
  intakeDestinationsExcludeAnnounce,
  intakeSidebarItems,
  isIntakeDestination,
  readIntakePreviewPage,
} from './intake-destination-rows';

export type IntakeDestinationContext = {
  active: IntakeDestination;
  canOpenPermissions: boolean;
  seatLibraryOnly: boolean;
  jobKnown: boolean;
  jobPending: boolean;
  canUploadSop: boolean;
  canUpdateSop: boolean;
  canDeleteSop: boolean;
  sessionKey: string;
  uploadBlock: string;
  canGrant: boolean;
  grantAccess: AccessBlock | null;
  onOpen: (target: 'content' | 'wording' | 'permissions') => void;
  onTodoCount: (count: number) => void;
  onSupplyScript: (question: string) => void;
  scriptDraft: string | null;
  onDraftConsumed: () => void;
};

const INTAKE_DESTINATION_MOUNTS: {
  [Id in IntakeDestination]: (ctx: IntakeDestinationContext) => ReactNode;
} = {
  overview: (ctx) => <IntakeOverview key={ctx.sessionKey} onOpen={ctx.onOpen} onTodoCount={ctx.onTodoCount} onSupplyScript={ctx.onSupplyScript} />,
  wording: (ctx) => <IntakeLibrary active={ctx.active === 'wording'} seatNotice={ctx.seatLibraryOnly} />,
  sop: (ctx) => <SopLibraryModule canUploadSop={ctx.canUploadSop} canUpdateSop={ctx.canUpdateSop} canDeleteSop={ctx.canDeleteSop} uploadBlock={ctx.uploadBlock} />,
  content: (ctx) => <div hidden={ctx.active !== 'content'}><DeskKnowledge draftQuestion={ctx.scriptDraft} onDraftConsumed={ctx.onDraftConsumed} /></div>,
  materials: () => <IntakeManagement />,
  permissions: (ctx) => (
    <div hidden={ctx.active !== 'permissions'}>
      <IntakePermissions active={ctx.active === 'permissions'} canGrant={ctx.canGrant} grantAccess={ctx.grantAccess} />
    </div>
  ),
};

function shouldMount(row: IntakeDestinationRow, ctx: IntakeDestinationContext): boolean {
  if (row.needsPermissionBridge && !ctx.canOpenPermissions) return false;
  if (row.audience === 'staff' && (!ctx.jobKnown || ctx.seatLibraryOnly)) return false;
  if (row.keepAlive) return true;
  return row.id === ctx.active;
}

const JOB_PENDING = '正在确认你的职务……';

export function renderIntakeDestinations(ctx: IntakeDestinationContext): ReactNode {
  const pages = INTAKE_DESTINATION_ROWS.filter((row) => shouldMount(row, ctx)).map((row) => (
    <Fragment key={row.id}>{INTAKE_DESTINATION_MOUNTS[row.id](ctx)}</Fragment>
  ));
  if (!ctx.jobKnown) {
    return <>
      {pages}
      <section className="dash-module" data-testid={ctx.jobPending ? 'module-job-pending' : 'module-signed-out'}>
        <p>{ctx.jobPending ? JOB_PENDING : '请先登录。'}</p>
      </section>
    </>;
  }
  return pages;
}
