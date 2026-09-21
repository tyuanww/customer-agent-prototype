import type { CustomerAgentApi } from '../shared/contracts';
import type { DashboardContentApi } from '../shared/dashboard-content';
import type { DashboardIterationApi } from '../shared/dashboard-iteration';
import type { DashboardOpsApi } from '../shared/dashboard-ops-loop';
import type { DashboardWordingApi } from '../shared/dashboard-wording';
import type { LoginWindowApi } from '../shared/login-window';
import type { SopWindowApi } from '../shared/sop-window';

declare global {
  interface Window {
    customerAgent?: CustomerAgentApi;
    dashboardWording?: DashboardWordingApi;
    dashboardContent?: DashboardContentApi;
    dashboardIteration?: DashboardIterationApi;
    dashboardOps?: DashboardOpsApi;
    loginWindow?: LoginWindowApi;
    sopWindow?: SopWindowApi;
  }
}

export {};
