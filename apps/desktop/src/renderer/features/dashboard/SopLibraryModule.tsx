import { useEffect, useState } from 'react';
import { allergySopTree } from '@shared/synthetic-sops';
import type { SopNodeKind } from '@shared/sop-window';
import { StatusBadge } from './StatusBadge';

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

  return (
    <div className="dash-module" data-testid="module-sop">
      <header className="dash-module-head">
        <div>
          <h1>SOP</h1>
          <p className="dash-kicker">合成过敏树只读 · 不编辑、不发布</p>
        </div>
        <StatusBadge label="合成演示" tone="mock" />
      </header>
      <p className="dash-scope dash-scope-important">
        只读浏览坐席窗同一份过敏售后树。持久化与话术师更新要等合同 intake。过敏步骤含停手文案，不承诺赔付。
      </p>
      <section className="sop-library" aria-label={tree.sceneTitle}>
        <div className="source-readiness">
          <div>
            <span className="dash-card-label">当前场景</span>
            <strong>{tree.sceneTitle}</strong>
          </div>
          <StatusBadge label="合成树已挂载" tone="warn" />
          <p>{tree.nodes.length} 个节点 · 起点 {tree.startNodeId}</p>
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
