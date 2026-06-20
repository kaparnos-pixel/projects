import { Link } from 'react-router-dom'
import { Card, PageHeader } from '../../components/ui'
import { suppliers } from '../../data/vendor'
import { money, useVendor } from '../../vendor/VendorContext'

const steps = [
  { icon: '🛒', label: 'Marketplace', route: '/vendor/marketplace', blurb: 'Discover & vet suppliers, request quotes.' },
  { icon: '🧾', label: 'Offers & Quotes', route: '/vendor/offers', blurb: 'Compare quotes, accept or decline.' },
  { icon: '💱', label: 'DA Tracking', route: '/vendor/da', blurb: 'Pro-forma vs. final reconciliation.' },
  { icon: '📑', label: 'SOF', route: '/vendor/sof', blurb: 'Build & submit the Statement of Facts.' },
]

export default function VendorOverview() {
  const { offers, das, sofs } = useVendor()

  const openRfq = offers.filter((o) => o.status === 'requested' || o.status === 'quoted').length
  const daValue = das.reduce(
    (sum, d) => sum + d.lines.reduce((s, l) => s + (l.actual ?? l.proforma), 0),
    0,
  )
  const draftSof = sofs.filter((s) => s.status === 'draft').length

  const kpis = [
    { icon: '🏷️', value: suppliers.length, label: 'Suppliers in network', sub: `${suppliers.filter((s) => s.verified).length} verified` },
    { icon: '🧾', value: openRfq, label: 'Open RFQs / quotes', sub: 'awaiting action' },
    { icon: '💱', value: money(daValue), label: 'DA value tracked', sub: `${das.length} accounts` },
    { icon: '📑', value: draftSof, label: 'SOFs in draft', sub: `${sofs.length} total` },
  ]

  return (
    <div className="stack">
      <PageHeader
        title="Vendor Dock"
        subtitle="The supply side of the port call. Source suppliers, manage quotations, keep an eye on disbursement accounts and file your statements of fact."
        action={<span className="vd-tag">Starboard · Supply</span>}
      />

      <section>
        <h2 className="section-title">Procurement flow</h2>
        <div className="flow-strip">
          {steps.map((s, i) => (
            <div className="flow-node-wrap" key={s.route}>
              <Link className="flow-node" to={s.route}>
                <span className="flow-icon" aria-hidden>
                  {s.icon}
                </span>
                <strong>{s.label}</strong>
                <small>{s.blurb}</small>
              </Link>
              {i < steps.length - 1 && (
                <span className="flow-arrow" aria-hidden>
                  →
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="kpi-grid">
        {kpis.map((k) => (
          <Card key={k.label} className="kpi">
            <span className="kpi-icon vd-icon" aria-hidden>
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

      <Card>
        <div className="banner banner-info">
          🔗 Vendor Dock works hand in hand with Agent Hub. Accepted quotes flow into Disbursement Accounts, and
          port events build the SOF, so data is never re-keyed.
        </div>
      </Card>
    </div>
  )
}
