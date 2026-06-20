import { useState } from 'react'
import { Badge, Card, PageHeader } from '../../components/ui'
import type { DAStatus, DisbursementAccount } from '../../data/vendor'
import { money, useVendor } from '../../vendor/VendorContext'

const flow: DAStatus[] = ['pro-forma', 'submitted', 'approved', 'settled']

function totals(da: DisbursementAccount) {
  const proforma = da.lines.reduce((s, l) => s + l.proforma, 0)
  const actual = da.lines.reduce((s, l) => s + (l.actual ?? 0), 0)
  const variance = actual - proforma
  return { proforma, actual, variance }
}

export default function DATracking() {
  const { das, addDA, addDALine, setDAActual, setDAStatus } = useVendor()
  const [activeId, setActiveId] = useState(das[0]?.id ?? '')
  const [showNewDA, setShowNewDA] = useState(false)
  const [showNewLine, setShowNewLine] = useState(false)

  const active = das.find((d) => d.id === activeId) ?? das[0]

  return (
    <div className="stack">
      <PageHeader
        title="Disbursement-account tracking"
        subtitle="Reconcile pro-forma against final figures line by line, watch the variance, and move each DA through to settled."
        action={
          <button className="btn btn-primary" onClick={() => setShowNewDA((v) => !v)}>
            + New DA
          </button>
        }
      />

      {showNewDA && <NewDAForm onAdd={addDA} onDone={() => setShowNewDA(false)} />}

      {!active && <Card className="empty">No disbursement accounts yet — create one to begin.</Card>}

      {active && (
        <div className="da-shell">
          <div className="da-list">
            {das.map((d) => {
              const t = totals(d)
              return (
                <button
                  key={d.id}
                  className={`da-row${d.id === active.id ? ' active' : ''}`}
                  onClick={() => setActiveId(d.id)}
                >
                  <div className="da-row-top">
                    <strong className="mono">{d.ref}</strong>
                    <Badge label={d.status} />
                  </div>
                  <span className="mini-meta">
                    {d.vessel} · {d.port}
                  </span>
                  <span className="mini-meta">{money(t.actual || t.proforma, d.currency)}</span>
                </button>
              )
            })}
          </div>

          <Card className="da-detail">
            <div className="cd-head">
              <div>
                <h2 className="mono">{active.ref}</h2>
                <p className="muted-text">
                  {active.vessel} · {active.port} · {active.party}
                </p>
              </div>
              <Badge label={active.status} />
            </div>

            <div className="da-stepper">
              {flow.map((st) => (
                <button
                  key={st}
                  className={`da-step${active.status === st ? ' current' : ''}${
                    flow.indexOf(st) < flow.indexOf(active.status) ? ' done' : ''
                  }`}
                  onClick={() => setDAStatus(active.id, st)}
                >
                  {st.replace('-', ' ')}
                </button>
              ))}
            </div>

            <table className="table da-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Description</th>
                  <th className="num">Pro-forma</th>
                  <th className="num">Actual</th>
                  <th className="num">Variance</th>
                </tr>
              </thead>
              <tbody>
                {active.lines.map((l) => {
                  const variance = l.actual != null ? l.actual - l.proforma : null
                  return (
                    <tr key={l.id}>
                      <td>{l.category}</td>
                      <td>{l.description}</td>
                      <td className="num mono">{money(l.proforma, active.currency)}</td>
                      <td className="num">
                        <input
                          className="actual-input mono"
                          type="number"
                          placeholder="—"
                          value={l.actual ?? ''}
                          onChange={(e) =>
                            setDAActual(active.id, l.id, e.target.value === '' ? null : Number(e.target.value))
                          }
                        />
                      </td>
                      <td className={`num mono ${variance == null ? '' : variance > 0 ? 'var-up' : variance < 0 ? 'var-down' : ''}`}>
                        {variance == null ? '—' : (variance > 0 ? '+' : '') + money(variance, active.currency)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>
                    <strong>Total</strong>
                  </td>
                  <td className="num mono">
                    <strong>{money(totals(active).proforma, active.currency)}</strong>
                  </td>
                  <td className="num mono">
                    <strong>{money(totals(active).actual, active.currency)}</strong>
                  </td>
                  <td className={`num mono ${totals(active).variance > 0 ? 'var-up' : totals(active).variance < 0 ? 'var-down' : ''}`}>
                    <strong>
                      {(totals(active).variance > 0 ? '+' : '') + money(totals(active).variance, active.currency)}
                    </strong>
                  </td>
                </tr>
              </tfoot>
            </table>

            {showNewLine ? (
              <NewLineForm
                onAdd={(line) => {
                  addDALine(active.id, line)
                  setShowNewLine(false)
                }}
                onCancel={() => setShowNewLine(false)}
              />
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowNewLine(true)}>
                + Add line item
              </button>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

function NewDAForm({
  onAdd,
  onDone,
}: {
  onAdd: ReturnType<typeof useVendor>['addDA']
  onDone: () => void
}) {
  const [ref, setRef] = useState('')
  const [vessel, setVessel] = useState('')
  const [port, setPort] = useState('')
  const [party, setParty] = useState('')
  const valid = ref.trim() && vessel.trim() && port.trim()
  return (
    <Card className="inline-form">
      <div className="form-grid">
        <label>
          DA reference
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="DA-2026-0044" />
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
          Agent / supplier
          <input value={party} onChange={(e) => setParty(e.target.value)} />
        </label>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!valid}
          onClick={() => {
            onAdd({ ref: ref.trim(), vessel: vessel.trim(), port: port.trim(), party: party.trim() || '—', currency: 'USD', status: 'pro-forma', lines: [] })
            onDone()
          }}
        >
          Create DA
        </button>
      </div>
    </Card>
  )
}

function NewLineForm({
  onAdd,
  onCancel,
}: {
  onAdd: (line: { category: string; description: string; proforma: number; actual: number | null }) => void
  onCancel: () => void
}) {
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [proforma, setProforma] = useState('')
  const valid = category.trim() && description.trim() && proforma !== ''
  return (
    <div className="line-add">
      <input placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
      <input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <input placeholder="Pro-forma" type="number" value={proforma} onChange={(e) => setProforma(e.target.value)} />
      <button className="btn btn-ghost btn-sm" onClick={onCancel}>
        Cancel
      </button>
      <button
        className="btn btn-primary btn-sm"
        disabled={!valid}
        onClick={() => onAdd({ category: category.trim(), description: description.trim(), proforma: Number(proforma), actual: null })}
      >
        Add
      </button>
    </div>
  )
}
