type QueryNoticeDialogProps = {
  noticeLoading: boolean;
  noticeBlocked: boolean;
  noticeBusy: boolean;
  noticeError: string;
  pendingNotice: boolean;
  noticeVersion: string | null;
  noticeContent: string | null;
  onRetry: () => void;
  onDecline: () => void;
  onAccept: () => void;
};

export function QueryNoticeDialog({
  noticeLoading,
  noticeBlocked,
  noticeBusy,
  noticeError,
  pendingNotice,
  noticeVersion,
  noticeContent,
  onRetry,
  onDecline,
  onAccept,
}: QueryNoticeDialogProps) {
  let noticeDialogContent = '暂时无法读取服务端告知，查询已暂停。';
  if (noticeLoading) {
    noticeDialogContent = '正在读取服务端告知，请稍候。';
  } else if (pendingNotice && noticeContent !== null) {
    noticeDialogContent = noticeContent;
  }
  const actionsDisabled = noticeBusy || noticeLoading;
  let noticeDialogActions = null;
  if (noticeBlocked) {
    noticeDialogActions = (
      <div className="notice-dialog-actions">
        <button
          type="button"
          className="notice-dialog-primary"
          data-testid="notice-retry"
          disabled={noticeLoading}
          onClick={onRetry}
        >
          重试
        </button>
      </div>
    );
  } else if (pendingNotice) {
    noticeDialogActions = (
      <div className="notice-dialog-actions">
        <button
          type="button"
          className="notice-dialog-secondary"
          data-testid="notice-decline"
          disabled={actionsDisabled}
          onClick={onDecline}
        >
          {noticeBusy ? '提交中…' : '不同意'}
        </button>
        <button
          type="button"
          className="notice-dialog-primary"
          data-testid="notice-accept"
          disabled={actionsDisabled}
          onClick={onAccept}
        >
          {noticeBusy ? '提交中…' : '同意并继续'}
        </button>
      </div>
    );
  }
  return (
    <div className="notice-backdrop" data-testid="notice-backdrop">
      <section className="notice-dialog" role="dialog" aria-modal="true" aria-labelledby="notice-title">
        <div className="notice-dialog-header">
          <div>
            <p className="notice-dialog-eyebrow">使用前请阅读</p>
            <h2 id="notice-title">{noticeBlocked ? '暂时无法读取告知' : '试点采集告知'}</h2>
          </div>
          {pendingNotice ? <span className="notice-dialog-version">{noticeVersion}</span> : null}
        </div>
        <p className="notice-dialog-content" data-testid="notice-content">
          {noticeDialogContent}
        </p>
        {noticeError ? <p className="notice-dialog-error" role="alert">{noticeError}</p> : null}
        {pendingNotice ? <p className="notice-dialog-hint">阅读页面不会自动表示同意，请选择下方按钮。</p> : null}
        {noticeDialogActions}
      </section>
    </div>
  );
}
