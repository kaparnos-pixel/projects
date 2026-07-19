import { usePlatform } from '../../platform/PlatformContext'
import type { ReportBase } from '../../data/reporting'

// Shared header for every report form: Job Code auto-fill (locks ship / IMO /
// voyage / port from the central voyage database), captain, place, timestamps
// and the report-level Open/Completed status used by the archive.
// The patch never touches `id` or the discriminant `type`, so excluding them
// keeps the spread in each form narrowed to its concrete report type.
type HeaderPatch = Partial<Omit<ReportBase, 'id' | 'type'>>

export default function ReportHeader({
  report,
  onPatch,
}: {
  report: ReportBase
  onPatch: (p: HeaderPatch) => void
}) {
  const platform = usePlatform()

  function pickJob(id: string) {
    const v = platform.voyage(id)
    if (!v) {
      onPatch({ jobCode: '', vessel: '', imo: '', voyageNo: '', port: '', country: '' })
      return
    }
    onPatch({
      jobCode: v.id,
      vessel: v.vessel,
      imo: v.imo,
      voyageNo: v.id,
      port: v.port,
      country: v.country,
    })
  }

  return (
    <div className="card report-header">
      <div className="rh-stamps">
        <span>🕓 Reporting time · <strong>{report.createdAtLocal}</strong> (local) · <strong>{report.createdAtUtc}</strong></span>
        <span className={`badge badge-${report.status === 'Completed' ? 'good' : 'warn'}`}>{report.status}</span>
      </div>
      <div className="form-grid">
        <label>
          Voyage / Job Code
          <select value={report.jobCode} onChange={(e) => pickJob(e.target.value)}>
            <option value="">- select a job code -</option>
            {platform.voyages.map((v) => (
              <option key={v.id} value={v.id}>{v.id} · {v.vessel}</option>
            ))}
          </select>
        </label>
        <label>
          Ship’s name <span className="auto-tag">auto</span>
          <input value={report.vessel} readOnly placeholder="from job code" />
        </label>
        <label>
          IMO number <span className="auto-tag">auto</span>
          <input value={report.imo} readOnly placeholder="from job code" />
        </label>
        <label>
          Name of the Captain
          <input value={report.captain} onChange={(e) => onPatch({ captain: e.target.value })} placeholder="Capt. …" />
        </label>
        <label>
          Port of Call
          <input value={report.port} onChange={(e) => onPatch({ port: e.target.value })} placeholder="Port" />
        </label>
        <label>
          Country
          <input value={report.country} onChange={(e) => onPatch({ country: e.target.value })} placeholder="Country" />
        </label>
        <label>
          Report status
          <select value={report.status} onChange={(e) => onPatch({ status: e.target.value })}>
            <option>Open</option>
            <option>Completed</option>
          </select>
        </label>
      </div>
    </div>
  )
}
