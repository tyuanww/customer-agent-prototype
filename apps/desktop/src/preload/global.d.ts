import type { CustomerAgentApi } from '../shared/contracts';
import type { LoginWindowApi } from '../shared/login-window';
import type { SopWindowApi } from '../shared/sop-window';

declare global {
  interface Window {
    customerAgent?: CustomerAgentApi;
    loginWindow?: LoginWindowApi;
    sopWindow?: SopWindowApi;
  }
}

export {};
