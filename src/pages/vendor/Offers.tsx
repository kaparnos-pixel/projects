import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card, PageHeader } from '../../components/ui'
import type { OfferStatus } from '../../data/vendor'
import { money, useVendor } from '../../vendor/VendorContext'

const tabs: { key: OfferStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'requested', label: 'Requested' },
  { key: 'quoted', label: 'Quoted' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'declined', label: 'Declined' },
]

export default function Offers() {
  const { offers, setOfferStatus, das } = useVendor()
  const [filter, setFilter] = useState<OfferStatus | 'all'>('all')

  const inDA = (title: string) => das.some((d) => d.lines.some((l) => l.description === title))

  const list = useMemo(
    () => (filter === 'all' ? offers : offers.filter((o) => o.status === filter)),
    [offers, filter],
  )

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: offers.length }
    for (const o of offers) c[o.status] = (c[o.status] ?? 0) + 1
    return c
  }, [offers])

  return (
    <div className="stack">
      <PageHeader
        title="Offers & quotations"
        subtitle="Track every RFQ from request to award. Accepted quotes can be pushed into a disbursement account."
        action={
          <Link className="btn btn-primary" to="/vendor/marketplace">
            + New RFQ
          </Link>
        }
      />

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tab${filter === t.key ? ' active' : ''}`}
            onClick={() => setFilter(t.key)}
          >
            {t.label} {counts[t.key] ? <span className="tab-count">{counts[t.key]}</span> : null}
          </button>
        ))}
      </div>

      {list.length === 0 && <Card className="empty">No offers in this view.</Card>}

      <div className="offer-grid">
        {list.map((o) => (
          <Card key={o.id} className="offer-card">
            <div className="offer-top">
              <div>
                <strong>{o.title}</strong>
                <span className="mini-meta">
                  {o.supplierName} · {o.category}
                </span>
              </div>
              <Badge label={o.status} />
            </div>

            <div className="offer-meta">
              <span>🚢 {o.vessel}</span>
              <span>📍 {o.port}</span>
              <span>📅 needed by {o.neededBy}</span>
            </div>

            <ul className="rfq-lines">
              {o.lines.map((l, i) => (
                <li key={i}>
                  {l.qty} {l.unit} · {l.description}
                </li>
              ))}
            </ul>

            <div className="offer-foot">
              <div className="offer-amount">
                {o.quoteAmount != null ? (
                  <>
                    <span className="cd-label">Quote</span>
                    <strong>{money(o.quoteAmount, o.currency)}</strong>
                  </>
                ) : (
                  <span className="muted-text">Awaiting supplier quote…</span>
                )}
              </div>
              <div className="offer-actions">
                {o.status === 'quoted' && (
                  <>
                    <button className="btn btn-ghost btn-sm" onClick={() => setOfferStatus(o.id, 'declined')}>
                      Decline
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => setOfferStatus(o.id, 'accepted')}>
                      Accept
                    </button>
                  </>
                )}
                {o.status === 'requested' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setOfferStatus(o.id, 'declined')}>
                    Cancel RFQ
                  </button>
                )}
                {o.status === 'accepted' && (
                  <span className="ok-tag">✓ Awarded{inDA(o.title) ? ' · in DA' : ''}</span>
                )}
                {o.status === 'declined' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setOfferStatus(o.id, 'requested')}>
                    Reopen
                  </button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
