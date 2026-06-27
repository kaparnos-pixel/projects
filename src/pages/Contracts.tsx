import { useState } from 'react'
import { Badge, Card, PageHeader } from '../components/ui'
import { seedContracts } from '../data/seed'

// Draft contract copies held in the system: the Sub-Agent SLA / frame agreement
// and the Principal master service agreement are always available to view.
export default function Contracts() {
  const [selected, setSelected] = useState(seedContracts[0].id)
  const active = seedContracts.find((c) => c.id === selected)!

  return (
    <div className="stack">
      <PageHeader
        title="Contracts & SLAs"
        subtitle="Standard agreement drafts are kept in the system: sub-agents sign the SLA & frame agreement, principals sign the master service agreement. Both are available to review at any time."
      />

      <div className="contract-shell">
        <div className="contract-list">
          {seedContracts.map((c) => (
            <button
              key={c.id}
              className={`contract-row${selected === c.id ? ' active' : ''}`}
              onClick={() => setSelected(c.id)}
            >
              <div className="cr-top">
                <strong>{c.title}</strong>
                <Badge label={c.audience} tone="info" />
              </div>
              <span className="cr-meta">{c.version} · updated {c.updated}</span>
            </button>
          ))}
        </div>

        <Card className="contract-detail">
          <div className="cd-head">
            <div>
              <h2>{active.title}</h2>
              <p className="cd-sub muted-text">For: {active.audience}</p>
            </div>
            <Badge label={active.version} tone="info" />
          </div>
          <div className="compliance-flag is-audited">
            ✓ Standard template · compliance pre-reviewed · ready for e-signature
          </div>
          <p className="page-sub" style={{ maxWidth: 'none' }}>{active.summary}</p>
          <div className="section-title" style={{ marginTop: 18 }}>Key clauses</div>
          <ul className="gate-features" style={{ maxWidth: 'none', margin: '8px 0 20px' }}>
            {active.clauses.map((cl) => <li key={cl}>{cl}</li>)}
          </ul>
          <div className="cd-actions">
            <button className="btn btn-primary">Download draft</button>
            <button className="btn btn-ghost">Send for signature</button>
          </div>
        </Card>
      </div>
    </div>
  )
}
