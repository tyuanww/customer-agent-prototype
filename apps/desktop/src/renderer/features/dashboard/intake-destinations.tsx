import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { canOpenSettings, type PageUseSnapshot } from '@shared/page-use';
import type { WorkbenchKind } from '@shared/workbench-mode';
import { IntakeLibrary } from './IntakeLibrary';
import { IntakeManagement } from './IntakeManagement';
import { IntakeOverview } from './IntakeOverview';
import { IntakePermissions } from './IntakePermissions';
import { SopLibraryModule } from './SopLibraryModule';
import { WorkbenchFailed, WorkbenchLoading, WorkbenchNoAccess } from './WorkbenchState';
import {
  INTAKE_DESTINATION_ROWS,
  intakeRowVisible,
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
  intakeRowVisible,
  intakeSidebarItems,
  isIntakeDestination,
  readIntakePreviewPage,
} from './intake-destination-rows';

export type IntakeDestinationContext = {
  active: IntakeDestination;
  canViewGrantSettings: boolean;
  canManageAccounts: boolean;
  canUploadSop: boolean;
  seatLibraryOnly: boolean;
  jobKnown: boolean;
  jobPending: boolean;
  sessionKey: string;
  workbenchMode: WorkbenchKind | null;
  workbenchStatus: 'pending' | 'ready' | 'error';
  onRetryWorkbench: () => void;
  snapshot: PageUseSnapshot;
  onOpen: (target: 'wording' | 'materials' | 'settings') => void;
  onTodoCount: (count: number) => void;
};

const INTAKE_DESTINATION_MOUNTS: {
  [Id in IntakeDestination]: (ctx: IntakeDestinationContext) => ReactNode;
} = {
  overview: (ctx) => ctx.workbenchMode === 'legacy' ? <IntakeOverview key={ctx.sessionKey} mode={ctx.workbenchMode} onOpen={ctx.onOpen} onTodoCount={ctx.onTodoCount} /> : null,
  wording: (ctx) => <ContentLibraryDestination ctx={ctx} />,
  sop: (ctx) => ctx.workbenchMode === 'legacy'
    ? <SopLibraryModule sop={ctx.snapshot.phase === 'ready' ? ctx.snapshot.sop : undefined} canUploadSop={ctx.canUploadSop} />
    : <section className="dash-module" data-testid="module-sop"><h1 className="desk-sr">SOP</h1><p className="content-empty">SOP 学习与执行尚未开放。</p></section>,
  materials: (ctx) => <MaterialsDestination key={ctx.sessionKey} active={ctx.active === 'materials' || (ctx.active === 'overview' && ctx.workbenchMode !== 'legacy')}
    presentation={ctx.active === 'overview' && ctx.workbenchMode !== 'legacy' ? 'overview' : 'review'} onOpenReview={() => ctx.onOpen('materials')} />,
  settings: (ctx) => (
    <div hidden={ctx.active !== 'settings'}>
      {ctx.snapshot.phase === 'ready' && (ctx.canViewGrantSettings || ctx.canManageAccounts)
        ? <IntakePermissions
            active={ctx.active === 'settings'}
            canViewGrantSettings={ctx.canViewGrantSettings}
            canManageAccounts={ctx.canManageAccounts}
            gate={ctx.snapshot.settings.grants.state === 'open' ? ctx.snapshot.settings.grants : null}
          />
        : ctx.snapshot.phase === 'ready' && ctx.snapshot.settings.grants.state === 'closed'
          ? <section className="dash-module" aria-label="设置"><h1 className="desk-sr">设置</h1>
            <WorkbenchNoAccess need="查看设置" detail={ctx.snapshot.settings.grants.recovery ?? '当前没有可查看的设置。'} /></section>
          : null}
    </div>
  ),
};

function ContentLibraryDestination({ ctx }: { ctx: IntakeDestinationContext }) {
  const active = ctx.active === 'wording';
  return <section hidden={!active} aria-label="内容库">
    <IntakeLibrary active={active} includeSop={ctx.workbenchMode === 'legacy'} seatNotice={ctx.seatLibraryOnly} />
  </section>;
}

function MaterialsDestination({ active, presentation, onOpenReview }: { active: boolean; presentation: 'overview' | 'review'; onOpenReview: () => void }) {
  const [visited, setVisited] = useState(active);
  const [generation, setGeneration] = useState(0);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  useEffect(() => {
    if (!visited && !active) return undefined;
    return window.dashboardIntake?.onInvalidated(() => setGeneration(value => value + 1));
  }, [visited, active]);
  return <div hidden={!active}>{(visited || active) && <IntakeManagement key={generation} active={active} presentation={presentation} onOpenReview={onOpenReview} />}</div>;
}

function shouldMount(row: IntakeDestinationRow, ctx: IntakeDestinationContext): boolean {
  if (!intakeRowVisible(row, canOpenSettings(ctx.snapshot), ctx.seatLibraryOnly, ctx.jobKnown)) return false;
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
  if (ctx.workbenchStatus === 'pending') {
    return <section className="dash-module" aria-label="工作台"><WorkbenchLoading label="正在确认工作台" /></section>;
  }
  if (ctx.workbenchStatus === 'error') {
    return <section className="dash-module" aria-label="工作台"><WorkbenchFailed message="工作台暂不可用，请重试。" onRetry={ctx.onRetryWorkbench} /></section>;
  }
  return pages;
}
