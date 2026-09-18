import type { CustomerAgentApi } from '../shared/contracts';
import type { DashboardWordingApi } from '../shared/dashboard-wording';
import type { LoginWindowApi } from '../shared/login-window';
import type { SopWindowApi } from '../shared/sop-window';

declare global {
  interface Window {
    customerAgent?: CustomerAgentApi;
    dashboardWording?: DashboardWordingApi;
    loginWindow?: LoginWindowApi;
    sopWindow?: SopWindowApi;
  }
}

export {};
