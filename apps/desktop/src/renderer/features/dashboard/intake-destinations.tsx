import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Button, Tabs } from 'antd';
import type { PageUseSnapshot } from '@shared/page-use';
import type { WorkbenchKind } from '@shared/workbench-mode';
import { DeskKnowledge } from './DeskKnowledge';
import { IntakeLibrary } from './IntakeLibrary';
import { IntakeManagement } from './IntakeManagement';
import { IntakeOverview } from './IntakeOverview';
import { IntakePermissions } from './IntakePermissions';
import { SopLibraryModule } from './SopLibraryModule';
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
  canOpenPermissions: boolean;
  canGrant: boolean;
  canUploadSop: boolean;
  seatLibraryOnly: boolean;
  jobKnown: boolean;
  jobPending: boolean;
  sessionKey: string;
  workbenchMode: WorkbenchKind | null;
  snapshot: PageUseSnapshot;
  onOpen: (target: 'content' | 'wording' | 'permissions' | 'materials') => void;
  onTodoCount: (count: number) => void;
  onSupplyScript: (question: string) => void;
  scriptDraft: string | null;
  onDraftConsumed: () => void;
};

const INTAKE_DESTINATION_MOUNTS: {
  [Id in IntakeDestination]: (ctx: IntakeDestinationContext) => ReactNode;
} = {
  overview: (ctx) => ctx.workbenchMode === 'legacy' ? <IntakeOverview key={ctx.sessionKey} mode={ctx.workbenchMode} onOpen={ctx.onOpen} onTodoCount={ctx.onTodoCount} onSupplyScript={ctx.onSupplyScript} /> : null,
  wording: (ctx) => <ContentLibraryDestination ctx={ctx} />,
  sop: (ctx) => ctx.workbenchMode === 'legacy'
    ? <SopLibraryModule sop={ctx.snapshot.phase === 'ready' ? ctx.snapshot.sop : undefined} canUploadSop={ctx.canUploadSop} />
    : <section className="dash-module" data-testid="module-sop"><h1 className="desk-sr">SOP</h1><p className="content-empty">SOP 学习与执行尚未开放。</p></section>,
  content: () => null,
  materials: (ctx) => <MaterialsDestination key={ctx.sessionKey} active={ctx.active === 'materials' || (ctx.active === 'overview' && ctx.workbenchMode !== 'legacy')}
    presentation={ctx.active === 'overview' && ctx.workbenchMode !== 'legacy' ? 'overview' : 'review'} onOpenReview={() => ctx.onOpen('materials')} />,
  permissions: (ctx) => (
    <div hidden={ctx.active !== 'permissions'}>
      {ctx.snapshot.phase === 'ready' && ctx.snapshot.permissions.state === 'open'
        ? <IntakePermissions active={ctx.active === 'permissions'} canGrant={ctx.canGrant} gate={ctx.snapshot.permissions} />
        : null}
    </div>
  ),
};

function ContentLibraryDestination({ ctx }: { ctx: IntakeDestinationContext }) {
  const active = ctx.active === 'wording' || ctx.active === 'content';
  const canEdit = ctx.jobKnown && !ctx.seatLibraryOnly;
  const drafts = canEdit && ctx.active === 'content';
  return <section hidden={!active} aria-label="内容库">
    <Tabs className="content-library-tabs" activeKey={drafts ? 'drafts' : 'published'}
      onChange={key => ctx.onOpen(key === 'drafts' ? 'content' : 'wording')}
      items={[{ key: 'published', label: '已发布' }, ...(canEdit ? [{ key: 'drafts', label: '本机草稿' }] : [])]}
      tabBarExtraContent={canEdit ? <Button onClick={() => ctx.onOpen('materials')}>上传团队资料</Button> : undefined} />
    <IntakeLibrary active={active && !drafts} seatNotice={ctx.seatLibraryOnly} />
    {canEdit && <div hidden={!drafts}>
      <p className="content-library-note">草稿仅保存在这台电脑。团队使用的内容请到资料审核上传并发布。</p>
      <DeskKnowledge active={active && drafts} draftQuestion={ctx.scriptDraft} onDraftConsumed={ctx.onDraftConsumed} />
    </div>}
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
  if (!intakeRowVisible(row, ctx.canOpenPermissions, ctx.seatLibraryOnly, ctx.jobKnown)) return false;
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
