import { Card, PageHeader } from '../components/ui'
import { serviceCatalogue } from '../data/seed'

// The global services portfolio offered under the AusGlobal brand, delivered
// through the vetted sub-agent network.
export default function Services() {
  return (
    <div className="stack">
      <PageHeader
        title="Services Portfolio"
        subtitle="By leveraging the local infrastructure of vetted sub-agents, AusGlobal markets a full array of specialised services under a single brand, for liner and tramp vessels alike."
      />

      <div className="two-col">
        {serviceCatalogue.map((cat) => (
          <Card key={cat.key}>
            <div className="agent-top">
              <div className="kpi-icon">{cat.icon}</div>
              <div className="agent-id">
                <strong>{cat.title}</strong>
                <span>{cat.blurb}</span>
              </div>
            </div>
            <ul className="gate-features" style={{ maxWidth: 'none', margin: '14px 0 0' }}>
              {cat.items.map((it) => <li key={it}>{it}</li>)}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  )
}
