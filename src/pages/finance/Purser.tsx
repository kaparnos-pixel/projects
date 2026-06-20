import { useEffect, useMemo, useState } from 'react'
import { Badge, Card, PageHeader } from '../../components/ui'
import { paymentFlow, type PaymentMethod, type PaymentStatus } from '../../data/finance'
import { money, useVendor } from '../../vendor/VendorContext'
import { useFinance } from '../../finance/FinanceContext'

const tabs: { key: PaymentStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'initiated', label: 'Initiated' },
  { key: 'in-transit', label: 'In transit' },
  { key: 'settled', label: 'Settled' },
  { key: 'failed', label: 'Failed' },
]

const methods: PaymentMethod[] = ['SWIFT', 'Local rails', 'Escrow']

export default function Purser() {
  const { das } = useVendor()
  const { payments, addPayment, advancePayment, failPayment } = useFinance()
  const [filter, setFilter] = useState<PaymentStatus | 'all'>('all')
  const [live, setLive] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // "Real-time" simulation: while live, nudge in-flight payments toward settled.
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => {
      const moving = payments.find((p) => p.status === 'initiated' || p.status === 'in-transit')
      if (moving) advancePayment(moving.id)
    }, 3000)
    return () => clearInterval(t)
  }, [live, payments, advancePayment])

  const totals = useMemo(() => {
    const sum = (pred: (s: PaymentStatus) => boolean) =>
      payments.filter((p) => pred(p.status)).reduce((s, p) => s + p.amount, 0)
    return {
      outstanding: sum((s) => s !== 'settled' && s !== 'failed'),
      inTransit: sum((s) => s === 'in-transit'),
      settled: sum((s) => s === 'settled'),
    }
  }, [payments])

  const list = filter === 'all' ? payments : payments.filter((p) => p.status === filter)
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: payments.length }
    for (const p of payments) c[p.status] = (c[p.status] ?? 0) + 1
    return c
  }, [payments])

  return (
    <div className="stack">
      <PageHeader
        title="Purser"
        subtitle="See where every payment stands in real time, from “service delivered” all the way to “account settled.”"
        action={
          <label className="live-toggle">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            <span className={`live-dot ${live ? 'on' : ''}`} /> Live mode
          </label>
        }
      />

      <section className="kpi-grid kpi-grid-3">
        <Card className="kpi">
          <span className="kpi-icon purser-icon" aria-hidden>⏳</span>
          <div>
            <div className="kpi-value">{money(totals.outstanding)}</div>
            <div className="kpi-label">Outstanding</div>
            <div className="kpi-sub">awaiting settlement</div>
          </div>
        </Card>
        <Card className="kpi">
          <span className="kpi-icon purser-icon" aria-hidden>🔄</span>
          <div>
            <div className="kpi-value">{money(totals.inTransit)}</div>
            <div className="kpi-label">In transit</div>
            <div className="kpi-sub">on the rails now</div>
          </div>
        </Card>
        <Card className="kpi">
          <span className="kpi-icon purser-icon" aria-hidden>✅</span>
          <div>
            <div className="kpi-value">{money(totals.settled)}</div>
            <div className="kpi-label">Settled</div>
            <div className="kpi-sub">loop closed</div>
          </div>
        </Card>
      </section>

      <div className="bar-between">
        <div className="tabs">
          {tabs.map((t) => (
            <button key={t.key} className={`tab${filter === t.key ? ' active' : ''}`} onClick={() => setFilter(t.key)}>
              {t.label} {counts[t.key] ? <span className="tab-count">{counts[t.key]}</span> : null}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          + New payment
        </button>
      </div>

      {showForm && <NewPaymentForm das={das} onAdd={addPayment} onClose={() => setShowForm(false)} />}

      <div className="pay-list">
        {list.map((p) => {
          const idx = paymentFlow.indexOf(p.status as PaymentStatus)
          const canAdvance = p.status !== 'settled' && p.status !== 'failed'
          return (
            <Card key={p.id} className="pay-card">
              <div className="pay-main">
                <div className="pay-head">
                  <strong className="mono">{p.ref}</strong>
                  <Badge label={p.status} />
                  {p.status === 'in-transit' && <span className="pulse" aria-hidden />}
                </div>
                <div className="pay-party">
                  {p.counterparty} <span className="role-tag">{p.type}</span>
                </div>
                <div className="offer-meta">
                  <span>🚢 {p.vessel}</span>
                  <span>📍 {p.port}</span>
                  <span>🏦 {p.method}</span>
                  <span>🔗 {p.reference}</span>
                </div>
                <div className="pay-flow">
                  {paymentFlow.map((st, i) => (
                    <div key={st} className={`pf-step${i <= idx && p.status !== 'failed' ? ' done' : ''}${st === p.status ? ' current' : ''}`}>
                      <span className="pf-dot" />
                      {st.replace('-', ' ')}
                    </div>
                  ))}
                </div>
                <div className="mini-meta">Updated {p.updatedAt}</div>
              </div>
              <div className="pay-side">
                <div className="pay-amount">{money(p.amount, p.currency)}</div>
                <div className="pay-actions">
                  {canAdvance && (
                    <button className="btn btn-primary btn-sm" onClick={() => advancePayment(p.id)}>
                      {p.status === 'pending' ? 'Initiate' : p.status === 'initiated' ? 'Send' : 'Mark settled'}
                    </button>
                  )}
                  {canAdvance && p.status !== 'pending' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => failPayment(p.id)}>
                      Flag
                    </button>
                  )}
                  {p.status === 'settled' && <span className="ok-tag">✓ Settled</span>}
                  {p.status === 'failed' && <span className="fail-tag">⚠ Failed</span>}
                </div>
              </div>
            </Card>
          )
        })}
        {list.length === 0 && <Card className="empty">No payments in this view.</Card>}
      </div>
    </div>
  )
}

function NewPaymentForm({
  das,
  onAdd,
  onClose,
}: {
  das: ReturnType<typeof useVendor>['das']
  onAdd: ReturnType<typeof useFinance>['addPayment']
  onClose: () => void
}) {
  const [counterparty, setCounterparty] = useState('')
  const [type, setType] = useState<'Agent' | 'Supplier'>('Agent')
  const [vessel, setVessel] = useState('')
  const [port, setPort] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('SWIFT')
  const [reference, setReference] = useState('')

  function prefillFromDA(daId: string) {
    const d = das.find((x) => x.id === daId)
    if (!d) return
    const total = d.lines.reduce((s, l) => s + (l.actual ?? l.proforma), 0)
    setCounterparty(d.party)
    setType('Agent')
    setVessel(d.vessel)
    setPort(d.port)
    setAmount(String(total))
    setReference(d.ref)
  }

  const valid = counterparty.trim() && vessel.trim() && amount !== '' && Number(amount) > 0

  return (
    <Card className="inline-form">
      <div className="form-grid">
        <label>
          From DA (optional)
          <select onChange={(e) => prefillFromDA(e.target.value)} defaultValue="">
            <option value="" disabled>
              Prefill from a DA…
            </option>
            {das.map((d) => (
              <option key={d.id} value={d.id}>
                {d.ref} · {d.vessel}
              </option>
            ))}
          </select>
        </label>
        <label>
          Counterparty
          <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as 'Agent' | 'Supplier')}>
            <option>Agent</option>
            <option>Supplier</option>
          </select>
        </label>
        <label>
          Vessel
          <input value={vessel} onChange={(e) => setVessel(e.target.value)} />
        </label>
        <label>
          Port
          <input value={port} onChange={(e) => setPort(e.target.value)} />
        </label>
        <label>
          Amount (USD)
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {methods.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Reference
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="DA / offer ref" />
        </label>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!valid}
          onClick={() => {
            onAdd({
              ref: `PAY-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
              counterparty: counterparty.trim(),
              type,
              vessel: vessel.trim(),
              port: port.trim() || '-',
              amount: Number(amount),
              currency: 'USD',
              method,
              reference: reference.trim() || '-',
            })
            onClose()
          }}
        >
          Create payment
        </button>
      </div>
    </Card>
  )
}
