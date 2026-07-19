import type { ReactNode } from 'react'
import ReportHeader from '../ReportHeader'
import {
  husbandryPurpose,
  husbandryServiceTypes,
  husbandryStatus,
  placeOfServiceOptions,
  reportRid,
  type HusbandryReport,
  type HusbandryServiceLine,
  type Report,
} from '../../../data/reporting'

const TIME_PH = 'e.g. 2026-07-04 08:30'

export default function Husbandry({
  report,
  onChange,
  onSubmit,
}: {
  report: HusbandryReport
  onChange: (r: Report) => void
  onSubmit: () => void
}) {
  const update = (p: Partial<HusbandryReport>) => onChange({ ...report, ...p })

  function updateService(id: string, p: Partial<HusbandryServiceLine>) {
    update({ services: report.services.map((s) => (s.id === id ? { ...s, ...p } : s)) })
  }
  function addService() {
    update({
      services: [
        ...report.services,
        { id: reportRid('svc'), serviceType: husbandryServiceTypes[0], status: 'Awaiting Order', remark: '', attachment: null },
      ],
    })
  }
  function removeService(id: string) {
    update({ services: report.services.filter((s) => s.id !== id) })
  }

  return (
    <div className="stack">
      <ReportHeader report={report} onPatch={(p) => onChange({ ...report, ...p })} />

      <div className="card">
        <div className="form-grid">
          <label>
            Purpose of Call
            <select value={report.purposeOfCall} onChange={(e) => update({ purposeOfCall: e.target.value })}>
              {husbandryPurpose.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
          <label>
            Place of Service
            <select value={report.placeOfService} onChange={(e) => update({ placeOfService: e.target.value })}>
              {placeOfServiceOptions.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
        </div>
        <label className="full">
          Cargo Type & Total Quantity
          <input value={report.cargo} onChange={(e) => update({ cargo: e.target.value })} placeholder="e.g. 34,000 MT gasoil" />
        </label>
      </div>

      <div className="card">
        <div className="section-title">Port movement timestamps</div>
        <div className="time-grid">
          <TimeCol title="Arrival">
            <T label="EOSP" v={report.arrival.eosp} on={(v) => update({ arrival: { ...report.arrival, eosp: v } })} />
            <T label="Anchor Dropped" v={report.arrival.anchorDropped} on={(v) => update({ arrival: { ...report.arrival, anchorDropped: v } })} />
            <T label="NOR Tendered" v={report.arrival.norTendered} on={(v) => update({ arrival: { ...report.arrival, norTendered: v } })} />
          </TimeCol>
          <TimeCol title="Shifting">
            <T label="Anchor Aweigh" v={report.shifting.anchorAweigh} on={(v) => update({ shifting: { ...report.shifting, anchorAweigh: v } })} />
            <T label="Pilot On Board" v={report.shifting.pilotOnBoard} on={(v) => update({ shifting: { ...report.shifting, pilotOnBoard: v } })} />
            <T label="First Line Ashore" v={report.shifting.firstLineAshore} on={(v) => update({ shifting: { ...report.shifting, firstLineAshore: v } })} />
            <T label="All Fast" v={report.shifting.allFast} on={(v) => update({ shifting: { ...report.shifting, allFast: v } })} />
          </TimeCol>
          <TimeCol title="Sailing">
            <T label="Cargo Ops Completed" v={report.sailing.cargoCompleted} on={(v) => update({ sailing: { ...report.sailing, cargoCompleted: v } })} />
            <T label="Documents Signed" v={report.sailing.documentsSigned} on={(v) => update({ sailing: { ...report.sailing, documentsSigned: v } })} />
            <T label="Pilot Disembarked" v={report.sailing.pilotDisembarked} on={(v) => update({ sailing: { ...report.sailing, pilotDisembarked: v } })} />
            <T label="COSP" v={report.sailing.cosp} on={(v) => update({ sailing: { ...report.sailing, cosp: v } })} />
          </TimeCol>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="section-title">Services rendered</div>
          <button className="btn btn-ghost btn-sm" onClick={addService}>+ Add service line</button>
        </div>
        <div className="svc-list">
          {report.services.map((s) => (
            <div className="svc-line" key={s.id}>
              <div className="svc-grid">
                <label>
                  Type of Service
                  <select value={s.serviceType} onChange={(e) => updateService(s.id, { serviceType: e.target.value })}>
                    {husbandryServiceTypes.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </label>
                <label>
                  Current Status
                  <select value={s.status} onChange={(e) => updateService(s.id, { status: e.target.value })}>
                    {husbandryStatus.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </label>
                <label className="svc-remark">
                  Remarks (this service)
                  <input value={s.remark} onChange={(e) => updateService(s.id, { remark: e.target.value })} placeholder="Line-specific note" />
                </label>
              </div>
              <div className="svc-foot">
                {s.status === 'Completed' ? (
                  s.attachment ? (
                    <span className="file-chip">📎 {s.attachment} <button onClick={() => updateService(s.id, { attachment: null })}>✕</button></span>
                  ) : (
                    <label className="file-btn">
                      ⬆ Work-done attachment
                      <input type="file" onChange={(e) => updateService(s.id, { attachment: e.target.files?.[0]?.name ?? 'workdone.pdf' })} />
                    </label>
                  )
                ) : (
                  <span className="muted-text">Attachment unlocks when status is “Completed”.</span>
                )}
                {report.services.length > 1 && (
                  <button className="btn btn-ghost btn-sm danger" onClick={() => removeService(s.id)}>Remove</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <label className="full">
          General Remarks
          <textarea rows={3} value={report.generalRemarks} onChange={(e) => update({ generalRemarks: e.target.value })} placeholder="Overall port condition notes" />
        </label>
        <div className="section-title" style={{ marginTop: 8 }}>Additional attachments</div>
        <p className="muted-text">Immigration stamp copies, Bunker Delivery Notes (BDN), Captain’s receipts…</p>
        <div className="chips">
          {report.attachments.map((a, i) => (
            <span className="file-chip" key={i}>📎 {a} <button onClick={() => update({ attachments: report.attachments.filter((_, j) => j !== i) })}>✕</button></span>
          ))}
          <label className="file-btn">
            ⬆ Add file
            <input type="file" onChange={(e) => { const n = e.target.files?.[0]?.name; if (n) update({ attachments: [...report.attachments, n] }) }} />
          </label>
        </div>
      </div>

      <div className="bar-between">
        <span className="muted-text">{report.jobCode ? `Filing against ${report.jobCode}` : 'Select a Job Code to enable submission'}</span>
        <button className="btn btn-primary" onClick={onSubmit} disabled={!report.jobCode}>
          Submit report
        </button>
      </div>
    </div>
  )
}

function TimeCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="time-col">
      <span className="time-col-title">{title}</span>
      {children}
    </div>
  )
}

function T({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return (
    <label className="time-field">
      <span>{label}</span>
      <input value={v} onChange={(e) => on(e.target.value)} placeholder={TIME_PH} />
    </label>
  )
}
