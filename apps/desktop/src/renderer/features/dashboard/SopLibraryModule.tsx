import { useEffect, useState, type ChangeEvent } from 'react';
import { allergySopTree } from '@shared/synthetic-sops';
import type { SopNodeKind } from '@shared/sop-window';
import { StatusBadge } from './StatusBadge';

const WRITE_UNAVAILABLE = '未接入：SOP 持久化需要 contracts:intake，当前没有写库命令。';

function nodeKindLabel(kind: SopNodeKind): string {
  if (kind === 'copyable') return '可复制话术';
  if (kind === 'decision') return '分支';
  return '内部停手';
}

function privilegedFromSession(role: string | null | undefined, signedIn: boolean | undefined): boolean {
  return signedIn === true && (role === 'coach' || role === 'owner');
}

export function SopLibraryModule() {
  const tree = allergySopTree();
  const [privileged, setPrivileged] = useState(false);
  const [writeMessage, setWriteMessage] = useState<string | null>(null);

  useEffect(() => {
    const api = window.dashboardContent;
    if (!api) {
      setPrivileged(false);
      return undefined;
    }
    let live = true;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      void api.session().then((result) => {
        if (!live || current !== generation) return;
        setPrivileged(result.ok === true && privilegedFromSession(result.role, result.signedIn));
      }).catch(() => {
        if (!live || current !== generation) return;
        setPrivileged(false);
      });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      live = false;
      window.removeEventListener('focus', load);
    };
  }, []);

  const refuseWrite = () => setWriteMessage(WRITE_UNAVAILABLE);

  return (
    <div className="dash-module" data-testid="module-sop">
      <header className="dash-module-head">
        <div>
          <h1>SOP</h1>
          <p className="dash-kicker">坐席过敏树只读预览 · 写库未接入</p>
        </div>
      </header>
      <p className="dash-scope dash-scope-important">
        上传、更新、删除、导出、自定义步骤都需要 SOP 持久化合同。当前没有写库接口，按钮不会假装成功。
      </p>
      <div className="dash-filter-toolbar" aria-label="SOP 写操作">
        <label className="dash-reset">
          上传
          <input
            data-testid="sop-upload-input"
            type="file"
            accept=".csv,.xlsx"
            hidden
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              event.target.value = '';
              refuseWrite();
            }}
          />
        </label>
        <button type="button" className="dash-reset" data-testid="sop-update" onClick={refuseWrite}>更新</button>
        <button type="button" className="dash-reset" data-testid="sop-delete" onClick={refuseWrite}>删除</button>
        <button type="button" className="dash-reset" data-testid="sop-export" onClick={refuseWrite}>导出</button>
        <button type="button" className="dash-reset" data-testid="sop-custom-step" onClick={refuseWrite}>自定义步骤</button>
      </div>
      {writeMessage ? <p className="dash-scope" data-testid="sop-write-status">{writeMessage}</p> : null}
      <section className="sop-library" aria-label={tree.sceneTitle}>
        <div className="source-readiness">
          <div>
            <span className="dash-card-label">当前场景</span>
            <strong>{tree.sceneTitle}</strong>
          </div>
          <StatusBadge label="预览未入库" tone="warn" />
          <p>{tree.nodes.length} 个节点 · 与坐席过敏窗同一份预览树</p>
        </div>
        <ol className="sop-library-list" data-testid="sop-library-list">
          {tree.nodes.map((node) => (
            <li key={node.id} className="sop-library-node" data-testid={`sop-node-${node.id}`}>
              <div className="sop-library-node-head">
                <StatusBadge label={nodeKindLabel(node.kind)} tone={node.kind === 'internal' ? 'danger' : 'neutral'} />
                {node.riskLevel === 'high' ? <StatusBadge label="高风险" tone="danger" /> : null}
                <strong>{node.scopeLabel ?? node.prompt ?? node.id}</strong>
              </div>
              <p>{node.answerText || node.prompt}</p>
              {privileged && node.internalNote ? (
                <p className="sop-library-note">{node.internalNote}</p>
              ) : null}
              {privileged && node.internalTask ? (
                <p className="sop-library-stop">{node.internalTask}</p>
              ) : null}
              {node.edges.length > 0 ? (
                <p className="sop-library-edges">
                  分支：{node.edges.map((edge) => edge.label).join(' / ')}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
