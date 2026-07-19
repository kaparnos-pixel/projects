import { useMemo, useState } from 'react'
import { usePlatform } from '../../platform/PlatformContext'
import { Badge, Card } from '../../components/ui'
import { exportReportsCsv, printReports } from '../../data/exportReport'
import { reportTypeMeta, type Report, type ReportType } from '../../data/reporting'

export default function Archived({ type }: { type: ReportType }) {
  const platform = usePlatform()
  const [vessel, setVessel] = useState('')
  const [job, setJob] = useState('')
  const [status, setStatus] = useState<'all' | 'Open' | 'Completed'>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [view, setView] = useState<Report | null>(null)

  const rows = useMemo(() => {
    return platform.reports
      .filter((r) => r.type === type)
      .filter((r) => (vessel ? r.vessel.toLowerCase().includes(vessel.toLowerCase()) : true))
      .filter((r) => (job ? r.jobCode.toLowerCase().includes(job.toLowerCase()) : true))
      .filter((r) => (status === 'all' ? true : r.status === status))
      .filter((r) => {
        const d = r.createdAtLocal.slice(0, 10)
        if (from && d < from) return false
        if (to && d > to) return false
        return true
      })
  }, [platform.reports, type, vessel, job, status, from, to])

  const label = reportTypeMeta[type].label

  return (
    <div className="stack">
      <Card>
        <div className="filters">
          <div className="filter-search">
            <span aria-hidden>🚢</span>
            <input placeholder="Vessel name" value={vessel} onChange={(e) => setVessel(e.target.value)} />
          </div>
          <div className="filter-search">
            <span aria-hidden>#</span>
            <input placeholder="Job code" value={job} onChange={(e) => setJob(e.target.value)} />
          </div>
          <label className="date-field">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="date-field">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All statuses</option>
            <option value="Open">Open</option>
            <option value="Completed">Completed</option>
          </select>
          <span className="pill-count">{rows.length}</span>
        </div>
        <div className="bar-between" style={{ marginTop: 14 }}>
          <span className="muted-text">Export historical logs for owners’ teams:</span>
          <div className="row-actions">
            <button className="btn btn-ghost btn-sm" disabled={!rows.length} onClick={() => exportReportsCsv(rows, `ausglobal-${type}-reports.csv`)}>⬇ Export Excel (CSV)</button>
            <button className="btn btn-ghost btn-sm" disabled={!rows.length} onClick={() => printReports(rows, `AusGlobal · ${label} reports`)}>🖨 Export PDF</button>
          </div>
        </div>
      </Card>

      <Card>
        <table className="table">
          <thead>
            <tr>
              <th>Report</th><th>Job code</th><th>Vessel</th><th>Port</th><th>Status</th><th>Created</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.id}</td>
                <td className="mono">{r.jobCode || '—'}</td>
                <td>{r.vessel || '—'}</td>
                <td>{r.port || '—'}</td>
                <td><Badge label={r.status} /></td>
                <td className="muted-text mono">{r.createdAtLocal}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => setView(r)}>View</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="empty">No {label.toLowerCase()} reports match these filters.</td></tr>}
          </tbody>
        </table>
      </Card>

      {view && <ReportModal report={view} onClose={() => setView(null)} onDelete={() => { platform.deleteReport(view.id); setView(null) }} />}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  if (!v) return null
  return (
    <div className="kv-row">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{v}</span>
    </div>
  )
}

function ReportModal({ report: r, onClose, onDelete }: { report: Report; onClose: () => void; onDelete: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{reportTypeMeta[r.type].label} · {r.vessel || 'report'}</h2>
            <p className="muted-text">{r.id} · {r.createdAtLocal} local · {r.createdAtUtc}</p>
          </div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="kv">
          <Row k="Job code" v={r.jobCode} />
          <Row k="IMO" v={r.imo} />
          <Row k="Captain" v={r.captain} />
          <Row k="Port" v={`${r.port}${r.country ? ', ' + r.country : ''}`} />
          <Row k="Status" v={r.status} />
        </div>

        {r.type === 'husbandry' && (
          <>
            <Row k="Purpose" v={r.purposeOfCall} />
            <Row k="Cargo" v={r.cargo} />
            <Row k="Place of service" v={r.placeOfService} />
            <div className="section-title" style={{ margin: '14px 0 8px' }}>Services</div>
            <table className="table">
              <tbody>
                {r.services.map((s) => (
                  <tr key={s.id}>
                    <td>{s.serviceType}</td>
                    <td><Badge label={s.status === 'Completed' ? 'Completed' : 'Open'} /></td>
                    <td className="muted-text">{s.remark}</td>
                    <td className="muted-text">{s.attachment ? `📎 ${s.attachment}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Row k="General remarks" v={r.generalRemarks} />
            {r.attachments.length > 0 && <Row k="Attachments" v={r.attachments.join(', ')} />}
          </>
        )}

        {r.type === 'general-agency' && (
          <>
            <Row k="Purpose" v={r.purposeOfCall} />
            <Row k="Cargo" v={`${r.cargoType} ${r.manifestedQty}`} />
            <Row k="Draft (initial → final)" v={r.draftInitial ? `${r.draftInitial} → ${r.draftFinal}` : ''} />
            <Row k="Place of operations" v={r.placeOfOperations} />
            {r.cargoOps.length > 0 && (
              <>
                <div className="section-title" style={{ margin: '14px 0 8px' }}>Cargo operations</div>
                <table className="table">
                  <tbody>
                    {r.cargoOps.map((o) => (
                      <tr key={o.id}>
                        <td>{o.label}</td><td>{o.status}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{o.qty24h.toLocaleString()} / 24h</td>
                        <td className="muted-text">{o.cranes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {r.interruptions.length > 0 && (
              <>
                <div className="section-title" style={{ margin: '14px 0 8px' }}>Interruptions</div>
                {r.interruptions.map((i) => (
                  <Row key={i.id} k={`${i.from}–${i.to}`} v={`${i.category} · ${i.laytime}`} />
                ))}
              </>
            )}
            <Row k="Commercial remarks" v={r.commercialRemarks} />
          </>
        )}

        {r.type === 'protecting-agency' && (
          <>
            <Row k="Appointed by" v={r.appointedBy} />
            <Row k="Nominated agent" v={r.nominatedAgent} />
            <Row k="Scope" v={r.scope} />
            <Row k="Disbursements verified" v={r.disbursementVerified ? 'Yes' : 'No'} />
            <Row k="Findings" v={r.findings} />
            <Row k="Remarks" v={r.remarks} />
          </>
        )}

        {r.type === 'epda-fda' && (
          <>
            <Row k="Stage" v={r.stage} />
            <div className="section-title" style={{ margin: '14px 0 8px' }}>Line items</div>
            <table className="table">
              <tbody>
                {r.lines.map((l) => (
                  <tr key={l.id}><td>{l.category}</td><td className="mono" style={{ textAlign: 'right' }}>{r.currency} {l.amount.toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
            <Row k="Remarks" v={r.remarks} />
          </>
        )}

        <div className="modal-foot">
          <button className="btn btn-ghost btn-sm danger" onClick={onDelete}>Delete</button>
          <button className="btn btn-ghost" onClick={() => printReports([r], `AusGlobal · ${reportTypeMeta[r.type].label} · ${r.vessel}`)}>🖨 Export PDF</button>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
