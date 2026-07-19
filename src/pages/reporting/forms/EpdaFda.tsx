import ReportHeader from '../ReportHeader'
import { reportRid, type EpdaFdaReport, type Report } from '../../../data/reporting'
import { usd } from '../../../data/calc'

export default function EpdaFda({
  report,
  onChange,
  onSubmit,
}: {
  report: EpdaFdaReport
  onChange: (r: Report) => void
  onSubmit: () => void
}) {
  const update = (p: Partial<EpdaFdaReport>) => onChange({ ...report, ...p })
  const total = report.lines.reduce((s, l) => s + l.amount, 0)

  const setLine = (id: string, p: Partial<{ category: string; amount: number }>) =>
    update({ lines: report.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) })
  const addLine = () => update({ lines: [...report.lines, { id: reportRid('ln'), category: '', amount: 0 }] })
  const delLine = (id: string) => update({ lines: report.lines.filter((l) => l.id !== id) })

  return (
    <div className="stack">
      <ReportHeader report={report} onPatch={(p) => onChange({ ...report, ...p })} />

      <div className="card">
        <div className="form-grid">
          <label>
            Account stage
            <select value={report.stage} onChange={(e) => update({ stage: e.target.value as 'EPDA' | 'FDA' })}>
              <option>EPDA</option>
              <option>FDA</option>
            </select>
          </label>
          <label>
            Currency
            <input value={report.currency} onChange={(e) => update({ currency: e.target.value })} />
          </label>
        </div>
        <p className="muted-text">
          {report.stage === 'EPDA'
            ? 'Estimated proforma disbursement account — the sub-agent’s pre-call estimate.'
            : 'Final disbursement account — reconciled against vouchers after the call.'}
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="section-title">{report.stage} line items</div>
          <button className="btn btn-ghost btn-sm" onClick={addLine}>+ Add line</button>
        </div>
        <table className="table da-table">
          <thead>
            <tr><th>Category</th><th style={{ textAlign: 'right' }}>Amount ({report.currency})</th><th /></tr>
          </thead>
          <tbody>
            {report.lines.map((l) => (
              <tr key={l.id}>
                <td><input className="cell-in" value={l.category} onChange={(e) => setLine(l.id, { category: e.target.value })} placeholder="Pilotage, tugs, dues…" /></td>
                <td><input className="cell-in num" type="number" value={l.amount} onChange={(e) => setLine(l.id, { amount: Number(e.target.value) })} /></td>
                <td><button className="icon-btn" onClick={() => delLine(l.id)}>✕</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Total</strong></td>
              <td className="mono" style={{ textAlign: 'right' }}><strong>{usd(total)}</strong></td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="card">
        <label className="full">
          Remarks
          <textarea rows={2} value={report.remarks} onChange={(e) => update({ remarks: e.target.value })} />
        </label>
        <div className="chips">
          {report.attachments.map((a, i) => (
            <span className="file-chip" key={i}>📎 {a} <button onClick={() => update({ attachments: report.attachments.filter((_, j) => j !== i) })}>✕</button></span>
          ))}
          <label className="file-btn">⬆ Attach voucher / receipt
            <input type="file" onChange={(e) => { const n = e.target.files?.[0]?.name; if (n) update({ attachments: [...report.attachments, n] }) }} />
          </label>
        </div>
      </div>

      <div className="bar-between">
        <span className="muted-text">{report.jobCode ? `Filing against ${report.jobCode}` : 'Select a Job Code to enable submission'}</span>
        <button className="btn btn-primary" onClick={onSubmit} disabled={!report.jobCode}>Submit report</button>
      </div>
    </div>
  )
}
