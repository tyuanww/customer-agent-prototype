import { DASHBOARD_MANIFEST } from '../../data/dashboard-manifest';
import { StatusBadge } from './StatusBadge';
import type {
  ArchitectureEvidence,
  ArchitectureFlowStep,
  ArchitectureNode,
} from '../../data/dashboard-manifest';

const data = DASHBOARD_MANIFEST.architecture;

function designTone(status: ArchitectureEvidence['designStatus']) {
  return status === 'mapped' ? 'neutral' : 'warn';
}

function prototypeTone(status: ArchitectureEvidence['prototypeStatus']) {
  if (status === 'runtime-interactive') return 'ok';
  if (status === 'static-interactive') return 'mock';
  if (status === 'visual-only') return 'warn';
  return 'neutral';
}

function formalRuntimeTone(status: ArchitectureEvidence['formalRuntimeStatus']) {
  if (status === 'verified') return 'ok';
  if (status === 'in-progress') return 'warn';
  return 'mock';
}

function EvidenceBadges({ evidence }: { evidence: ArchitectureEvidence }) {
  return (
    <div className="arch-evidence" aria-label="设计、原型与正式运行证据">
      <span className="arch-evidence-item" data-axis="design">
        <small>设计</small>
        <StatusBadge label={evidence.designStatusLabel} tone={designTone(evidence.designStatus)} />
      </span>
      <span className="arch-evidence-item" data-axis="prototype">
        <small>原型</small>
        <StatusBadge label={evidence.prototypeStatusLabel} tone={prototypeTone(evidence.prototypeStatus)} />
      </span>
      <span className="arch-evidence-item" data-axis="formal-runtime">
        <small>正式</small>
        <StatusBadge
          label={evidence.formalRuntimeStatusLabel}
          tone={formalRuntimeTone(evidence.formalRuntimeStatus)}
        />
      </span>
    </div>
  );
}

function NodeCard({ node }: { node: ArchitectureNode }) {
  return (
    <article
      className={`arch-card${node.redline ? ' is-redline' : ''}`}
      data-testid={`arch-node-${node.id}`}
    >
      <div className="dash-card-row">
        <strong>{node.title}</strong>
      </div>
      <p>{node.detail}</p>
      <EvidenceBadges evidence={node} />
      {node.redline ? <p className="arch-redline">红线 · 正式端口未接入</p> : null}
    </article>
  );
}

function FlowStep({ step }: { step: ArchitectureFlowStep }) {
  return (
    <li className="arch-flow-step" data-testid={`arch-step-${step.code}`}>
      <span className="arch-flow-code" aria-hidden="true">{step.code}</span>
      <div>
        <div className="arch-flow-step-head">
          <strong>{step.title}</strong>
        </div>
        <p>{step.detail}</p>
        <EvidenceBadges evidence={step} />
      </div>
    </li>
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

      <section className="arch-implementation" aria-labelledby="architecture-implementation-title">
        <div className="arch-implementation-head">
          <div>
            <h2 id="architecture-implementation-title">{data.implementationDesign.title}</h2>
            <p>{data.implementationDesign.detail}</p>
          </div>
          <StatusBadge label="一期设计已映射" tone="warn" />
        </div>

        <div className="arch-flow-grid">
          {data.implementationDesign.flows.map((flow) => (
            <section className="arch-flow" key={flow.id} data-testid={`arch-flow-${flow.id}`}>
              <header>
                <h3>{flow.title}</h3>
                <p>{flow.detail}</p>
              </header>
              <ol className="arch-flow-steps">
                {flow.steps.map((step) => <FlowStep key={step.code} step={step} />)}
              </ol>
            </section>
          ))}
        </div>

        <div className="arch-guardrails" aria-labelledby="architecture-guardrails-title">
          <h3 id="architecture-guardrails-title">实现护栏</h3>
          <div className="arch-guardrail-grid">
            {data.implementationDesign.guardrails.map((guardrail) => (
              <article className="arch-guardrail" key={guardrail.id} data-testid={`arch-guardrail-${guardrail.id}`}>
                <strong>{guardrail.title}</strong>
                <p>{guardrail.detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

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
          Fox / Query：白名单 IPC · Dashboard：当前无 preload / IPC
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
