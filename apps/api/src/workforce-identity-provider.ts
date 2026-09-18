import { IdentityFailure, type SyntheticIdentityProvider } from './product-auth-service.js';
import { createFeishuIdentityProvider, type FeishuIdentityProviderConfig } from './feishu-identity-provider.js';
import { createSyntheticIdentityProvider } from './synthetic-identity-provider.js';

/**
 * Two authenticators, one product session.
 * Feishu owns authorize_url. Account passwords issue one-time codes on the loopback
 * password server; those codes are exchanged first. Remaining codes go to Feishu.
 */
export function createWorkforceIdentityProvider(
  feishu: FeishuIdentityProviderConfig,
  passwordOrigin: string,
  callbackUrl: string,
): SyntheticIdentityProvider {
  const feishuProvider = createFeishuIdentityProvider(feishu);
  const passwordProvider = createSyntheticIdentityProvider(passwordOrigin, callbackUrl);
  return Object.freeze({
    authorizeUrl: (state: string) => feishuProvider.authorizeUrl(state),
    async exchange(code: string) {
      try {
        return await passwordProvider.exchange(code);
      } catch (error) {
        if (!(error instanceof IdentityFailure) || error.reason !== 'LOGIN_INVALID') throw error;
        return feishuProvider.exchange(code);
      }
    },
    close() {
      feishuProvider.close();
      passwordProvider.close();
    },
  });
}
