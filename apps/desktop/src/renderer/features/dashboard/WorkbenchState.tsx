import { Button, Skeleton } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';

export const LONG_WAIT_MS = 8_000;

export function WorkbenchLoading({ rows = 4, label = '正在读取' }: { rows?: number; label?: string }) {
  const [long, setLong] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLong(true), LONG_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  return <div className="wb-state wb-state-loading" role="status" aria-live="polite" aria-busy="true" aria-label={label}>
    <Skeleton active title={false} paragraph={{ rows, width: ['92%', '78%', '86%', '64%', '80%', '70%'].slice(0, rows) }} />
    {long ? <p className="wb-state-line">还在读取…</p> : null}
  </div>;
}

export function WorkbenchEmpty({ children }: { children: ReactNode }) {
  return <p className="wb-state wb-state-empty">{children}</p>;
}

export function WorkbenchFailed({ message, onRetry, retryLabel = '重试' }: {
  message: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return <div className="wb-state wb-state-failed" role="alert">
    <span>{message}</span>
    {onRetry ? <Button size="small" autoInsertSpace={false} onClick={onRetry}>{retryLabel}</Button> : null}
  </div>;
}

export function WorkbenchUncertain({ message, onCheck, checkLabel = '刷新查看', disabled = false }: {
  message: ReactNode;
  onCheck: () => void;
  checkLabel?: string;
  disabled?: boolean;
}) {
  return <div className="wb-state wb-state-uncertain" role="status">
    <span>{message}</span>
    <Button size="small" autoInsertSpace={false} disabled={disabled} onClick={onCheck}>{checkLabel}</Button>
  </div>;
}

export type AccessRole = '客服主管' | '管理员';

export function WorkbenchNoAccess({ need, ask, detail }: { need: string; ask?: AccessRole; detail?: string }) {
  const line = detail ?? (ask !== undefined ? `请联系${ask}开通。` : '');
  return <div className="wb-state wb-state-noaccess" role="note" data-testid="workbench-no-access">
    <p className="wb-state-title">{`你还不能${need}`}</p>
    <p className="wb-state-line">{line}</p>
  </div>;
}
