import { useState } from 'react'
import { Badge, Card, PageHeader } from '../components/ui'
import { contracts } from '../data/mock'

export default function Contracts() {
  const [activeId, setActiveId] = useState(contracts[0].id)
  const active = contracts.find((c) => c.id === activeId)!

  return (
    <div className="stack">
      <PageHeader
        title="Contract negotiation & storage"
        subtitle="Draft, counter and execute appointment contracts. Every revision is versioned and stored on the ledger."
        action={<button className="btn btn-primary">+ New contract</button>}
      />

      <div className="contract-shell">
        <div className="contract-list">
          {contracts.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`contract-row${c.id === activeId ? ' active' : ''}`}
              onClick={() => setActiveId(c.id)}
            >
              <div className="cr-top">
                <strong>{c.title}</strong>
                <Badge label={c.status} />
              </div>
              <span className="cr-meta">
                {c.vessel} · {c.port}
              </span>
              <span className="cr-meta mono">
                {c.id} · {c.value} · updated {c.updated}
              </span>
            </button>
          ))}
        </div>

        <Card className="contract-detail">
          <div className="cd-head">
            <div>
              <h2>{active.title}</h2>
              <p className="muted-text">
                {active.agentName} · {active.vessel} · {active.port}
              </p>
            </div>
            <Badge label={active.status} />
          </div>

          <div className="cd-grid">
            <div>
              <span className="cd-label">Contract value</span>
              <strong>{active.value}</strong>
            </div>
            <div>
              <span className="cd-label">Reference</span>
              <strong className="mono">{active.id}</strong>
            </div>
            <div>
              <span className="cd-label">Last updated</span>
              <strong>{active.updated}</strong>
            </div>
          </div>

          <h3 className="cd-sub">Revision history</h3>
          <ol className="revisions">
            {active.revisions.map((r) => (
              <li key={r.version}>
                <span className="rev-version mono">{r.version}</span>
                <div>
                  <strong>{r.note}</strong>
                  <span className="mini-meta">
                    {r.author} · {r.date}
                  </span>
                </div>
              </li>
            ))}
          </ol>

          <div className="cd-actions">
            {active.status === 'pending-signature' && (
              <button className="btn btn-primary">✍️ Sign &amp; execute</button>
            )}
            {active.status === 'in-negotiation' && (
              <button className="btn btn-primary">Send counter-proposal</button>
            )}
            {active.status === 'draft' && <button className="btn btn-primary">Issue to agent</button>}
            <button className="btn btn-ghost">Download PDF</button>
            <button className="btn btn-ghost">View on ledger</button>
          </div>
        </Card>
      </div>
    </div>
  )
}
