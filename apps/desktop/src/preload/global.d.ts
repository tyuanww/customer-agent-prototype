import type { CustomerAgentApi } from '../shared/contracts';

declare global {
  interface Window {
    customerAgent?: CustomerAgentApi;
  }
}

export {};
