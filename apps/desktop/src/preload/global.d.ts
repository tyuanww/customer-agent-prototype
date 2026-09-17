import type { CustomerAgentApi } from '../shared/contracts';
import type { LoginWindowApi } from '../shared/login-window';

declare global {
  interface Window {
    customerAgent?: CustomerAgentApi;
    loginWindow?: LoginWindowApi;
  }
}

export {};
