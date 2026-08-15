import { DASHBOARD_MANIFEST } from '../../data/dashboard-manifest';
import { StatusBadge } from './StatusBadge';
import type { ArchitectureNode } from '../../data/dashboard-manifest';

const data = DASHBOARD_MANIFEST.architecture;

function NodeCard({ node }: { node: ArchitectureNode }) {
  const tone = node.status === 'demo-ready' ? 'ok' : node.status === 'visual-mock' ? 'warn' : 'mock';
  return (
    <article
      className={`arch-card${node.redline ? ' is-redline' : ''}`}
      data-testid={`arch-node-${node.id}`}
    >
      <div className="dash-card-row">
        <strong>{node.title}</strong>
        <StatusBadge label={node.statusLabel} tone={tone} />
      </div>
      <p>{node.detail}</p>
      {node.redline ? <p className="arch-redline">红线 · 正式端口未接入</p> : null}
    </article>
  );
}

export function ArchitectureModule() {
  return (
    <div className="dash-module" data-testid="module-architecture">
      <header className="dash-module-head">
        <div>
          <h1>{data.title}</h1>
          <p className="dash-kicker">{data.kicker}</p>
        </div>
      </header>
      <p className="dash-scope">{DASHBOARD_MANIFEST.banners.architectureMark}</p>

      <div className="arch-map" data-testid="architecture-map">
        <section>
          <h2>产品表面</h2>
          <div className="arch-row">
            {data.surfaces.map((node) => (
              <NodeCard key={node.id} node={node} />
            ))}
          </div>
        </section>
        <div className="arch-connector" aria-hidden="true">
          白名单 IPC / 无 Node 的 Dashboard
        </div>
        <section>
          <h2>九端口</h2>
          <div className="arch-grid">
            {data.ports.map((node) => (
              <NodeCard key={node.id} node={node} />
            ))}
          </div>
        </section>
        <div className="arch-connector" aria-hidden="true">
          SoR / 对象存储 / outbox
        </div>
        <section>
          <h2>数据与异步</h2>
          <div className="arch-row">
            {data.dataPlane.map((node) => (
              <NodeCard key={node.id} node={node} />
            ))}
          </div>
        </section>
        <div className="arch-connector" aria-hidden="true">
          可选，默认关闭
        </div>
        <section>
          <h2>可选模型</h2>
          <NodeCard node={data.llm} />
        </section>
      </div>
    </div>
  );
}
