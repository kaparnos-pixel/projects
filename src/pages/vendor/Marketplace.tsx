import { useMemo, useState } from 'react'
import { Card, PageHeader, Stars } from '../../components/ui'
import { suppliers, type Supplier, type SupplierCategory } from '../../data/vendor'
import { useVendor } from '../../vendor/VendorContext'

const categories: (SupplierCategory | 'All categories')[] = [
  'All categories',
  'Provisions & Stores',
  'Spare Parts',
  'Bunker Supply',
  'Surveys & Inspection',
  'Repairs & Riding Crew',
  'Waste & Slops',
  'Security & Escort',
  'Husbandry',
]

type View = 'buyer' | 'supplier'

export default function Marketplace() {
  const { createRFQ, offers, submitQuote } = useVendor()
  const [view, setView] = useState<View>('buyer')

  return (
    <div className="stack">
      <PageHeader
        title="Supplier marketplace"
        subtitle="A marketplace that works both ways. Source and vet suppliers as a buyer, or answer incoming RFQs as a supplier."
        action={
          <div className="seg-toggle">
            <button className={view === 'buyer' ? 'active' : ''} onClick={() => setView('buyer')}>
              🛒 Buyer
            </button>
            <button className={view === 'supplier' ? 'active' : ''} onClick={() => setView('supplier')}>
              🏷️ Supplier
            </button>
          </div>
        }
      />
      {view === 'buyer' ? (
        <BuyerView onCreate={createRFQ} />
      ) : (
        <SupplierView offers={offers} onQuote={submitQuote} />
      )}
    </div>
  )
}

/* ---------------- Buyer view: browse suppliers + request quote ---------------- */

function BuyerView({ onCreate }: { onCreate: ReturnType<typeof useVendor>['createRFQ'] }) {
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<SupplierCategory | 'All categories'>('All categories')
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [rfqFor, setRfqFor] = useState<Supplier | null>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return suppliers
      .filter((s) => {
        const mq =
          !q ||
          s.company.toLowerCase().includes(q) ||
          s.port.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q)
        const mc = cat === 'All categories' || s.category === cat
        const mv = !verifiedOnly || s.verified
        return mq && mc && mv
      })
      .sort((a, b) => Number(b.featured) - Number(a.featured))
  }, [query, cat, verifiedOnly])

  return (
    <>
      <Card className="filters">
        <div className="filter-search">
          <span aria-hidden>🔎</span>
          <input
            placeholder="Search suppliers, port or category…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value as SupplierCategory | 'All categories')}>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />
          Verified only
        </label>
      </Card>

      <div className="agent-grid">
        {results.map((s) => (
          <Card key={s.id} className="agent-card">
            <div className="agent-top">
              <div className="agent-avatar vd-avatar" aria-hidden>
                {s.countryCode}
              </div>
              <div className="agent-id">
                <strong>{s.company}</strong>
                <span>
                  {s.contact} · {s.port}, {s.country}
                </span>
                <span className="agent-type type-husbandry">{s.category}</span>
              </div>
              {s.featured && <span className="feat-pill">★ Featured</span>}
            </div>
            <p className="agent-about">{s.about}</p>
            <div className="agent-stats">
              <Stars value={s.rating} />
              <span>💬 {s.reviews} reviews</span>
              <span>⏱ {s.leadTimeDays}d lead time</span>
              {s.verified && <span className="vd-verified">✓ Verified</span>}
            </div>
            <div className="agent-actions">
              <button className="btn btn-primary" onClick={() => setRfqFor(s)}>
                Request quote
              </button>
            </div>
          </Card>
        ))}
        {results.length === 0 && <Card className="empty">No suppliers match your filters.</Card>}
      </div>

      {rfqFor && <RFQModal supplier={rfqFor} onClose={() => setRfqFor(null)} onCreate={onCreate} />}
    </>
  )
}

function RFQModal({
  supplier,
  onClose,
  onCreate,
}: {
  supplier: Supplier
  onClose: () => void
  onCreate: ReturnType<typeof useVendor>['createRFQ']
}) {
  const [title, setTitle] = useState('')
  const [vessel, setVessel] = useState('')
  const [port, setPort] = useState(supplier.port)
  const [neededBy, setNeededBy] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState([{ description: '', qty: 1, unit: 'lot' }])

  function updateLine(i: number, patch: Partial<{ description: string; qty: number; unit: string }>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  const valid = title.trim() && vessel.trim() && lines.some((l) => l.description.trim())

  function submit() {
    if (!valid) return
    onCreate({
      supplier,
      title: title.trim(),
      vessel: vessel.trim(),
      port: port.trim(),
      neededBy: neededBy || '-',
      note: note.trim(),
      lines: lines.filter((l) => l.description.trim()),
    })
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Request a quote</h2>
            <p className="muted-text">
              {supplier.company} · {supplier.category}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="form-grid">
          <label>
            RFQ title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly provisions" />
          </label>
          <label>
            Vessel
            <input value={vessel} onChange={(e) => setVessel(e.target.value)} placeholder="e.g. MT Arabian Falcon" />
          </label>
          <label>
            Port
            <input value={port} onChange={(e) => setPort(e.target.value)} />
          </label>
          <label>
            Needed by
            <input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </label>
        </div>

        <div className="lines-edit">
          <div className="lines-head">
            <span>Line items</span>
            <button className="link" onClick={() => setLines((ls) => [...ls, { description: '', qty: 1, unit: 'lot' }])}>
              + Add line
            </button>
          </div>
          {lines.map((l, i) => (
            <div className="line-row" key={i}>
              <input
                className="line-desc"
                placeholder="Description"
                value={l.description}
                onChange={(e) => updateLine(i, { description: e.target.value })}
              />
              <input
                className="line-qty"
                type="number"
                min={1}
                value={l.qty}
                onChange={(e) => updateLine(i, { qty: Number(e.target.value) })}
              />
              <input
                className="line-unit"
                value={l.unit}
                onChange={(e) => updateLine(i, { unit: e.target.value })}
              />
              {lines.length > 1 && (
                <button className="icon-btn" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        <label className="full">
          Note to supplier
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Delivery instructions, certificates required…" />
        </label>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid} onClick={submit}>
            Send RFQ →
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- Supplier view: respond to incoming RFQs ---------------- */

function SupplierView({
  offers,
  onQuote,
}: {
  offers: ReturnType<typeof useVendor>['offers']
  onQuote: ReturnType<typeof useVendor>['submitQuote']
}) {
  const inbound = offers.filter((o) => o.status === 'requested')

  return (
    <Card>
      <div className="card-head">
        <h2 className="section-title">Incoming RFQs ({inbound.length})</h2>
        <span className="muted-text">Respond with a quote to move it forward.</span>
      </div>
      {inbound.length === 0 && <div className="empty">No open RFQs awaiting a quote. 🎉</div>}
      <div className="rfq-list">
        {inbound.map((o) => (
          <QuoteRow key={o.id} offer={o} onQuote={onQuote} />
        ))}
      </div>
    </Card>
  )
}

function QuoteRow({
  offer,
  onQuote,
}: {
  offer: ReturnType<typeof useVendor>['offers'][number]
  onQuote: ReturnType<typeof useVendor>['submitQuote']
}) {
  const [amount, setAmount] = useState('')
  return (
    <div className="rfq-row">
      <div className="rfq-main">
        <strong>{offer.title}</strong>
        <span className="mini-meta">
          {offer.vessel} · {offer.port} · needed by {offer.neededBy}
        </span>
        <ul className="rfq-lines">
          {offer.lines.map((l, i) => (
            <li key={i}>
              {l.qty} {l.unit} · {l.description}
            </li>
          ))}
        </ul>
        {offer.note && <p className="rfq-note">“{offer.note}”</p>}
      </div>
      <div className="rfq-quote">
        <div className="amount-field">
          <span>USD</span>
          <input
            type="number"
            min={0}
            placeholder="Quote amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <button
          className="btn btn-primary"
          disabled={!amount || Number(amount) <= 0}
          onClick={() => onQuote(offer.id, Number(amount))}
        >
          Submit quote
        </button>
      </div>
    </div>
  )
}
