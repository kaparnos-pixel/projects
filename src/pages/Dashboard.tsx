import { Link } from 'react-router-dom'
import FlowStrip from '../components/FlowStrip'
import { Badge, Card, PageHeader } from '../components/ui'
import { agents, auditEntries, contracts, portCalls } from '../data/mock'

const kpis = [
  { label: 'Verified agents', value: agents.filter((a) => a.verified).length, sub: `${agents.length} in network`, icon: '🪪' },
  { label: 'Active port calls', value: portCalls.filter((p) => p.stage !== 'departed').length, sub: 'across 5 ports', icon: '⚓' },
  { label: 'Contracts in flight', value: contracts.filter((c) => c.status === 'in-negotiation' || c.status === 'pending-signature').length, sub: 'awaiting action', icon: '📝' },
  { label: 'Audited events (24h)', value: auditEntries.length, sub: 'hash-chained', icon: '🧾' },
]

export default function Dashboard() {
  return (
    <div className="stack">
      <PageHeader
        title="Agent Hub overview"
        subtitle="The appointment side of how you run a port call. Discover, onboard and manage your UAE port agents and husbandry providers, with every conversation and contract kept on one record you can actually audit."
      />

      <section>
        <h2 className="section-title">Appointment lifecycle</h2>
        <FlowStrip />
      </section>

      <section className="kpi-grid">
        {kpis.map((k) => (
          <Card key={k.label} className="kpi">
            <span className="kpi-icon" aria-hidden>
              {k.icon}
            </span>
            <div>
              <div className="kpi-value">{k.value}</div>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-sub">{k.sub}</div>
            </div>
          </Card>
        ))}
      </section>

      <div className="two-col">
        <Card>
          <div className="card-head">
            <h2 className="section-title">Upcoming port calls</h2>
            <Link to="/port-calls" className="link">
              View board →
            </Link>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Vessel</th>
                <th>Port</th>
                <th>ETA</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {portCalls.slice(0, 4).map((p) => (
                <tr key={p.id}>
                  <td>{p.vessel}</td>
                  <td>{p.port}</td>
                  <td className="mono">{p.eta}</td>
                  <td>
                    <Badge label={p.stage} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <div className="card-head">
            <h2 className="section-title">Latest auditable comms</h2>
            <Link to="/audit" className="link">
              Full trail →
            </Link>
          </div>
          <ul className="mini-feed">
            {auditEntries.slice(0, 5).map((e) => (
              <li key={e.id}>
                <span className={`dot dot-${e.category}`} aria-hidden />
                <div>
                  <strong>{e.action}</strong>
                  <span className="mini-detail">{e.detail}</span>
                  <span className="mini-meta">
                    {e.actor} · {e.time} · <span className="mono">{e.hash}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
