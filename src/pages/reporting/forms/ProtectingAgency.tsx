import ReportHeader from '../ReportHeader'
import type { ProtectingAgencyReport, Report } from '../../../data/reporting'

export default function ProtectingAgency({
  report,
  onChange,
  onSubmit,
}: {
  report: ProtectingAgencyReport
  onChange: (r: Report) => void
  onSubmit: () => void
}) {
  const update = (p: Partial<ProtectingAgencyReport>) => onChange({ ...report, ...p })

  return (
    <div className="stack">
      <ReportHeader report={report} onPatch={(p) => onChange({ ...report, ...p })} />

      <div className="card">
        <div className="section-title">Owners protective appointment</div>
        <div className="form-grid">
          <label>
            Appointed by (Owner / Manager)
            <input value={report.appointedBy} onChange={(e) => update({ appointedBy: e.target.value })} placeholder="e.g. Meridian Bulk Carriers Ltd" />
          </label>
          <label>
            Charterer-nominated agent
            <input value={report.nominatedAgent} onChange={(e) => update({ nominatedAgent: e.target.value })} placeholder="Agent being overseen" />
          </label>
        </div>
        <label className="full">
          Scope of protection
          <input value={report.scope} onChange={(e) => update({ scope: e.target.value })} placeholder="e.g. disbursement verification, cargo docs oversight" />
        </label>
        <label className="check" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={report.disbursementVerified} onChange={(e) => update({ disbursementVerified: e.target.checked })} />
          Disbursements independently verified against port scales
        </label>
      </div>

      <div className="card">
        <label className="full">
          Findings
          <textarea rows={3} value={report.findings} onChange={(e) => update({ findings: e.target.value })} placeholder="Observations on the nominated agent's conduct and charges" />
        </label>
        <label className="full">
          Remarks to owner
          <textarea rows={3} value={report.remarks} onChange={(e) => update({ remarks: e.target.value })} />
        </label>
        <div className="chips">
          {report.attachments.map((a, i) => (
            <span className="file-chip" key={i}>📎 {a} <button onClick={() => update({ attachments: report.attachments.filter((_, j) => j !== i) })}>✕</button></span>
          ))}
          <label className="file-btn">⬆ Add file
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
