import { Link } from 'react-router-dom'
import { usePlatform } from '../platform/PlatformContext'
import { Badge, Card, PageHeader } from '../components/ui'

export default function Principals() {
  const platform = usePlatform()

  return (
    <div className="stack">
      <PageHeader
        title="Principals"
        subtitle="Ship owners, charterers, operators and managers under master service agreement with AusGlobal. Each is assigned a dedicated Hub Manager as a single point of contact."
      />

      <div className="agent-grid">
        {platform.principals.map((p) => {
          const voyages = platform.voyages.filter((v) => v.principalId === p.id)
          return (
            <Card key={p.id} className="agent-card">
              <div className="agent-top">
                <div className="agent-avatar">{p.company.slice(0, 2).toUpperCase()}</div>
                <div className="agent-id">
                  <strong>{p.company}</strong>
                  <span>{p.country}</span>
                </div>
                <Badge label={p.type} tone="info" />
              </div>
              <p className="agent-about">{p.about}</p>
              <div className="cd-grid" style={{ marginBottom: 0 }}>
                <div>
                  <span className="cd-label">Fleet</span>
                  <strong>{p.fleet} vessels</strong>
                </div>
                <div>
                  <span className="cd-label">Voyages</span>
                  <strong>{voyages.length}</strong>
                </div>
                <div>
                  <span className="cd-label">Hub Manager</span>
                  <strong>{p.hubManager}</strong>
                </div>
              </div>
              <div className="agent-stats">
                <span>📨 {p.email}</span>
                <span>{p.masterSla ? '📝 Master SLA signed' : '✍️ SLA in negotiation'}</span>
              </div>
              <p className="muted-text">Fee basis: {p.feeStructure}</p>
              {voyages.length > 0 && (
                <div className="chips">
                  {voyages.slice(0, 4).map((v) => (
                    <Link key={v.id} className="chip" to={`/voyages/${v.id}`}>{v.id}</Link>
                  ))}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
