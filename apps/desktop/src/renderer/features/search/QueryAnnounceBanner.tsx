import type { Ref } from 'react';
import type { LibraryDomain } from '@shared/library-delta';
import { ANNOUNCE_EXPIRED_MESSAGE, contentUpdatedBannerCopy } from './query-view-model';

type QueryAnnounceBannerProps = {
  invalid: boolean;
  domains: readonly LibraryDomain[];
  contentUpdatedBannerRef: Ref<HTMLParagraphElement>;
  onDismiss: () => void;
};

export function QueryAnnounceBanner({
  invalid,
  domains,
  contentUpdatedBannerRef,
  onDismiss,
}: QueryAnnounceBannerProps) {
  if (invalid) {
    return (
      <p className="product-announce-banner is-invalid" data-testid="announce-banner" role="status">
        {ANNOUNCE_EXPIRED_MESSAGE}
      </p>
    );
  }
  if (domains.length === 0) {
    return null;
  }
  return (
    <p
      ref={contentUpdatedBannerRef}
      className="product-announce-banner is-muted"
      data-testid="announce-content-updated-banner"
      role="status"
      data-domains={domains.join(',')}
    >
      <span>{contentUpdatedBannerCopy(domains)}</span>
      <button
        type="button"
        className="product-announce-dismiss"
        data-testid="announce-content-updated-dismiss"
        aria-label="关掉话术更新提示"
        onClick={onDismiss}
      >
        知道了
      </button>
    </p>
  );
}
