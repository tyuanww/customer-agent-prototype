import type { IntakeCatalogApi } from '../shared/content-intake-catalog';
import type { IntakePermissionApi } from '../shared/content-intake-permissions';
import type { SeatAccountApi } from '../shared/seat-account-intent';
import type { IntakeManagementApi } from '../shared/content-intake-management';
import type { DeskKnowledgeApi } from '../shared/desk-knowledge';
import type { CustomerAgentApi } from '../shared/contracts';
import type { DashboardAnnounceApi } from '../shared/dashboard-announce';
import type { DashboardContentApi } from '../shared/dashboard-content';
import type { DashboardIterationApi } from '../shared/dashboard-iteration';
import type { DashboardOpsApi } from '../shared/dashboard-ops-loop';
import type { DashboardUsageLogApi } from '../shared/dashboard-usage-log';
import type { SopWorkbookOpenReply } from '../shared/sop-workbook-preview';
import type { DashboardWordingApi } from '../shared/dashboard-wording';
import type { LoginWindowApi } from '../shared/login-window';
import type { SopWindowApi } from '../shared/sop-window';

declare global {
  interface Window {
    dashboardIntakeCatalog?: IntakeCatalogApi;
    dashboardPermissions?: IntakePermissionApi;
    dashboardSeats?: SeatAccountApi;
    dashboardIntake?: IntakeManagementApi;
    dashboardDesk?: DeskKnowledgeApi;
    customerAgent?: CustomerAgentApi;
    dashboardWording?: DashboardWordingApi;
    dashboardAnnounce?: DashboardAnnounceApi;
    dashboardContent?: DashboardContentApi;
    dashboardIteration?: DashboardIterationApi;
    dashboardOps?: DashboardOpsApi;
    dashboardUsageLog?: DashboardUsageLogApi;
    dashboardSopWorkbook?: { open(): Promise<SopWorkbookOpenReply> };
    loginWindow?: LoginWindowApi;
    sopWindow?: SopWindowApi;
  }
}

export {};
