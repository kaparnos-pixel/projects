import { useMemo, useState } from 'react'
import { Badge, Card, PageHeader } from '../../components/ui'
import { portBenchmarks } from '../../data/finance'
import type { DisbursementAccount } from '../../data/vendor'
import { money, useVendor } from '../../vendor/VendorContext'
import { useFinance } from '../../finance/FinanceContext'

function proformaTotal(da: DisbursementAccount) {
  return da.lines.reduce((s, l) => s + l.proforma, 0)
}
// Final = actuals where known, falling back to pro-forma for open lines.
function finalTotal(da: DisbursementAccount) {
  return da.lines.reduce((s, l) => s + (l.actual ?? l.proforma), 0)
}
function isComplete(da: DisbursementAccount) {
  return da.lines.length > 0 && da.lines.every((l) => l.actual != null)
}

export default function PCM() {
  const { das } = useVendor()
  const { budgets, reconciled, setBudget, setReconciled } = useFinance()
  const [tab, setTab] = useState<'reconcile' | 'benchmark'>('reconcile')

  const portfolio = useMemo(() => {
    const pf = das.reduce((s, d) => s + proformaTotal(d), 0)
    const fin = das.reduce((s, d) => s + finalTotal(d), 0)
    const budget = das.reduce((s, d) => s + (budgets[d.id] ?? 0), 0)
    return { pf, fin, variance: fin - pf, budget }
  }, [das, budgets])

  return (
    <div className="stack">
      <PageHeader
        title="Port Cost Management"
        subtitle="Reconcile pro-forma against final disbursement accounts, control budgets, and benchmark your port costs against the network."
        action={<span className="vd-tag pcm-tag">Cost layer</span>}
      />

      <section className="kpi-grid">
        <Card className="kpi">
          <span className="kpi-icon pcm-icon" aria-hidden>📄</span>
          <div>
            <div className="kpi-value">{money(portfolio.pf)}</div>
            <div className="kpi-label">Pro-forma total</div>
            <div className="kpi-sub">{das.length} accounts</div>
          </div>
        </Card>
        <Card className="kpi">
          <span className="kpi-icon pcm-icon" aria-hidden>🧮</span>
          <div>
            <div className="kpi-value">{money(portfolio.fin)}</div>
            <div className="kpi-label">Final / projected</div>
            <div className="kpi-sub">actuals where known</div>
          </div>
        </Card>
        <Card className="kpi">
          <span className="kpi-icon pcm-icon" aria-hidden>📈</span>
          <div>
            <div className={`kpi-value ${portfolio.variance > 0 ? 'var-up' : portfolio.variance < 0 ? 'var-down' : ''}`}>
              {(portfolio.variance > 0 ? '+' : '') + money(portfolio.variance)}
            </div>
            <div className="kpi-label">Variance vs pro-forma</div>
            <div className="kpi-sub">{portfolio.pf ? Math.round((portfolio.variance / portfolio.pf) * 100) : 0}% overall</div>
          </div>
        </Card>
        <Card className="kpi">
          <span className="kpi-icon pcm-icon" aria-hidden>🎯</span>
          <div>
            <div className="kpi-value">{portfolio.budget ? money(portfolio.budget) : '—'}</div>
            <div className="kpi-label">Total budget set</div>
            <div className="kpi-sub">across accounts</div>
          </div>
        </Card>
      </section>

      <div className="tabs">
        <button className={`tab${tab === 'reconcile' ? ' active' : ''}`} onClick={() => setTab('reconcile')}>
          Reconciliation &amp; budget
        </button>
        <button className={`tab${tab === 'benchmark' ? ' active' : ''}`} onClick={() => setTab('benchmark')}>
          Cost benchmarking
        </button>
      </div>

      {tab === 'reconcile' ? (
        <Card>
          <table className="table pcm-table">
            <thead>
              <tr>
                <th>DA / vessel</th>
                <th className="num">Pro-forma</th>
                <th className="num">Final</th>
                <th className="num">Variance</th>
                <th className="num">Budget</th>
                <th>Utilisation</th>
                <th>Reconciled</th>
              </tr>
            </thead>
            <tbody>
              {das.map((d) => {
                const pf = proformaTotal(d)
                const fin = finalTotal(d)
                const variance = fin - pf
                const budget = budgets[d.id] ?? 0
                const util = budget > 0 ? Math.min(150, Math.round((fin / budget) * 100)) : 0
                const over = budget > 0 && fin > budget
                return (
                  <tr key={d.id}>
                    <td>
                      <strong className="mono">{d.ref}</strong>
                      <div className="mini-meta">
                        {d.vessel} · {d.port} {isComplete(d) ? '' : '· interim'}
                      </div>
                    </td>
                    <td className="num mono">{money(pf)}</td>
                    <td className="num mono">{money(fin)}</td>
                    <td className={`num mono ${variance > 0 ? 'var-up' : variance < 0 ? 'var-down' : ''}`}>
                      {(variance > 0 ? '+' : '') + money(variance)}
                    </td>
                    <td className="num">
                      <input
                        className="actual-input mono"
                        type="number"
                        placeholder="—"
                        value={budgets[d.id] ?? ''}
                        onChange={(e) => setBudget(d.id, e.target.value === '' ? 0 : Number(e.target.value))}
                      />
                    </td>
                    <td>
                      {budget > 0 ? (
                        <div className="util">
                          <div className="util-bar">
                            <div className={`util-fill ${over ? 'over' : ''}`} style={{ width: `${Math.min(100, util)}%` }} />
                          </div>
                          <span className={over ? 'var-up' : 'muted-text'}>{util}%</span>
                        </div>
                      ) : (
                        <span className="muted-text">set budget</span>
                      )}
                    </td>
                    <td>
                      <label className="recon-toggle">
                        <input
                          type="checkbox"
                          checked={!!reconciled[d.id]}
                          onChange={(e) => setReconciled(d.id, e.target.checked)}
                        />
                        {reconciled[d.id] ? <Badge label="settled" /> : <span className="muted-text">open</span>}
                      </label>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {das.length === 0 && <div className="empty">No disbursement accounts yet — create them in Vendor Dock → DA Tracking.</div>}
        </Card>
      ) : (
        <Benchmarking das={das} />
      )}
    </div>
  )
}

function Benchmarking({ das }: { das: DisbursementAccount[] }) {
  const rows = useMemo(() => {
    return portBenchmarks.map((b) => {
      const atPort = das.filter((d) => d.port === b.port)
      const avg = atPort.length
        ? Math.round(atPort.reduce((s, d) => s + finalTotal(d), 0) / atPort.length)
        : null
      const delta = avg != null ? Math.round(((avg - b.benchmarkPerCall) / b.benchmarkPerCall) * 100) : null
      return { ...b, avg, delta, calls: atPort.length }
    })
  }, [das])

  const max = Math.max(...portBenchmarks.map((b) => b.benchmarkPerCall), ...rows.map((r) => r.avg ?? 0))

  return (
    <Card>
      <div className="card-head">
        <h2 className="section-title">Your cost per call vs network benchmark</h2>
        <span className="muted-text">Lower is better · green = under benchmark</span>
      </div>
      <div className="bench-list">
        {rows.map((r) => (
          <div className="bench-row" key={r.port}>
            <div className="bench-port">
              <strong>{r.port}</strong>
              <span className="mini-meta">{r.calls} call{r.calls === 1 ? '' : 's'}</span>
            </div>
            <div className="bench-bars">
              <div className="bench-track">
                <div className="bench-bar benchmark" style={{ width: `${(r.benchmarkPerCall / max) * 100}%` }}>
                  <span>Benchmark {money(r.benchmarkPerCall)}</span>
                </div>
              </div>
              <div className="bench-track">
                {r.avg != null ? (
                  <div
                    className={`bench-bar yours ${r.delta != null && r.delta > 0 ? 'over' : 'under'}`}
                    style={{ width: `${(r.avg / max) * 100}%` }}
                  >
                    <span>You {money(r.avg)}</span>
                  </div>
                ) : (
                  <span className="muted-text bench-na">no calls yet</span>
                )}
              </div>
            </div>
            <div className={`bench-delta ${r.delta == null ? '' : r.delta > 0 ? 'var-up' : 'var-down'}`}>
              {r.delta == null ? '—' : `${r.delta > 0 ? '+' : ''}${r.delta}%`}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
