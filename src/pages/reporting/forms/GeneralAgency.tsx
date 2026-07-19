import type { ReactNode } from 'react'
import ReportHeader from '../ReportHeader'
import {
  cargoOpsStatus,
  generalAttachmentSlots,
  generalPurpose,
  interruptionCategories,
  laytimeImpact,
  reportRid,
  type CargoOpsRow,
  type GeneralAgencyReport,
  type InterruptionRow,
  type Report,
} from '../../../data/reporting'

const TIME_PH = 'e.g. 2026-07-04 08:30'

export default function GeneralAgency({
  report,
  onChange,
  onSubmit,
}: {
  report: GeneralAgencyReport
  onChange: (r: Report) => void
  onSubmit: () => void
}) {
  const update = (p: Partial<GeneralAgencyReport>) => onChange({ ...report, ...p })

  // ---- cargo ops grid ----
  const addOps = () =>
    update({
      cargoOps: [
        ...report.cargoOps,
        { id: reportRid('co'), label: `Day ${report.cargoOps.length + 1}`, status: 'Working', qty24h: 0, cumulative: 0, remaining: 0, cranes: '' },
      ],
    })
  const setOps = (id: string, p: Partial<CargoOpsRow>) =>
    update({ cargoOps: report.cargoOps.map((r) => (r.id === id ? { ...r, ...p } : r)) })
  const delOps = (id: string) => update({ cargoOps: report.cargoOps.filter((r) => r.id !== id) })

  // ---- interruptions ----
  const addInt = () =>
    update({
      interruptions: [
        ...report.interruptions,
        { id: reportRid('int'), category: interruptionCategories[0], from: '', to: '', laytime: laytimeImpact[0] },
      ],
    })
  const setInt = (id: string, p: Partial<InterruptionRow>) =>
    update({ interruptions: report.interruptions.map((r) => (r.id === id ? { ...r, ...p } : r)) })
  const delInt = (id: string) => update({ interruptions: report.interruptions.filter((r) => r.id !== id) })

  // ---- SOF pins ----
  const addPin = () => update({ sofPins: [...report.sofPins, { id: reportRid('sof'), event: '', at: '' }] })
  const setPin = (id: string, p: Partial<{ event: string; at: string }>) =>
    update({ sofPins: report.sofPins.map((r) => (r.id === id ? { ...r, ...p } : r)) })
  const delPin = (id: string) => update({ sofPins: report.sofPins.filter((r) => r.id !== id) })

  return (
    <div className="stack">
      <ReportHeader report={report} onPatch={(p) => onChange({ ...report, ...p })} />

      {/* 1 · commercial intent */}
      <div className="card">
        <div className="section-title">Commercial intent</div>
        <div className="form-grid">
          <label>
            Purpose of Call
            <select value={report.purposeOfCall} onChange={(e) => update({ purposeOfCall: e.target.value })}>
              {generalPurpose.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
          <label>
            Cargo Type
            <input value={report.cargoType} onChange={(e) => update({ cargoType: e.target.value })} placeholder="Coal, Crude Oil, Wheat, Iron Ore…" />
          </label>
          <label>
            Total Manifested Quantity
            <input value={report.manifestedQty} onChange={(e) => update({ manifestedQty: e.target.value })} placeholder="MT / Bbls / TEU" />
          </label>
          <label>
            Place of Operations
            <input value={report.placeOfOperations} onChange={(e) => update({ placeOfOperations: e.target.value })} placeholder="Terminal / Berth / Anchorage" />
          </label>
          <label>
            Draft Survey — Initial
            <input value={report.draftInitial} onChange={(e) => update({ draftInitial: e.target.value })} placeholder="e.g. 11.2 m" />
          </label>
          <label>
            Draft Survey — Final
            <input value={report.draftFinal} onChange={(e) => update({ draftFinal: e.target.value })} placeholder="e.g. 6.4 m" />
          </label>
        </div>
      </div>

      {/* 2 · milestones */}
      <div className="card">
        <div className="section-title">Port movement milestones</div>
        <div className="time-grid">
          <TimeCol title="Arrival">
            <T label="ETA" v={report.arrival.eta} on={(v) => update({ arrival: { ...report.arrival, eta: v } })} />
            <T label="Actual Arrival" v={report.arrival.actualArrival} on={(v) => update({ arrival: { ...report.arrival, actualArrival: v } })} />
            <T label="EOSP" v={report.arrival.eosp} on={(v) => update({ arrival: { ...report.arrival, eosp: v } })} />
            <T label="Anchored" v={report.arrival.anchored} on={(v) => update({ arrival: { ...report.arrival, anchored: v } })} />
            <T label="NOR Tendered" v={report.arrival.norTendered} on={(v) => update({ arrival: { ...report.arrival, norTendered: v } })} />
            <T label="NOR Accepted" v={report.arrival.norAccepted} on={(v) => update({ arrival: { ...report.arrival, norAccepted: v } })} />
          </TimeCol>
          <TimeCol title="Shifting">
            <T label="Pilot On Board / Tugs" v={report.shifting.pilotOnBoard} on={(v) => update({ shifting: { ...report.shifting, pilotOnBoard: v } })} />
            <T label="First Line Ashore" v={report.shifting.firstLineAshore} on={(v) => update({ shifting: { ...report.shifting, firstLineAshore: v } })} />
            <T label="All Fast" v={report.shifting.allFast} on={(v) => update({ shifting: { ...report.shifting, allFast: v } })} />
            <T label="Gangway Down & Secured" v={report.shifting.gangwayDown} on={(v) => update({ shifting: { ...report.shifting, gangwayDown: v } })} />
          </TimeCol>
          <TimeCol title="Sailing">
            <T label="Cargo Ops Completed" v={report.sailing.cargoCompleted} on={(v) => update({ sailing: { ...report.sailing, cargoCompleted: v } })} />
            <T label="Documents Signed" v={report.sailing.documentsSigned} on={(v) => update({ sailing: { ...report.sailing, documentsSigned: v } })} />
            <T label="Lines Cast Off" v={report.sailing.linesCastOff} on={(v) => update({ sailing: { ...report.sailing, linesCastOff: v } })} />
            <T label="Pilot Disembarked" v={report.sailing.pilotDisembarked} on={(v) => update({ sailing: { ...report.sailing, pilotDisembarked: v } })} />
            <T label="COSP" v={report.sailing.cosp} on={(v) => update({ sailing: { ...report.sailing, cosp: v } })} />
          </TimeCol>
        </div>
      </div>

      {/* 3 · cargo ops grid */}
      <div className="card">
        <div className="card-head">
          <div className="section-title">Cargo operations — live tracking</div>
          <button className="btn btn-ghost btn-sm" onClick={addOps}>+ Add shift / day</button>
        </div>
        <div className="grid-scroll">
          <table className="table da-table">
            <thead>
              <tr>
                <th>Shift / Day</th><th>Status</th>
                <th style={{ textAlign: 'right' }}>Last 24h</th>
                <th style={{ textAlign: 'right' }}>Cumulative</th>
                <th style={{ textAlign: 'right' }}>Remaining</th>
                <th style={{ textAlign: 'right' }}>Rate /hr</th>
                <th style={{ textAlign: 'right' }}>ETC (hrs)</th>
                <th>Hatches / Cranes</th><th />
              </tr>
            </thead>
            <tbody>
              {report.cargoOps.map((r) => {
                const rate = r.qty24h > 0 ? Math.round(r.qty24h / 24) : 0
                const etc = rate > 0 && r.remaining > 0 ? Math.ceil(r.remaining / rate) : 0
                return (
                  <tr key={r.id}>
                    <td><input className="cell-in" value={r.label} onChange={(e) => setOps(r.id, { label: e.target.value })} /></td>
                    <td>
                      <select className="cell-in" value={r.status} onChange={(e) => setOps(r.id, { status: e.target.value })}>
                        {cargoOpsStatus.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </td>
                    <td><input className="cell-in num" type="number" value={r.qty24h} onChange={(e) => setOps(r.id, { qty24h: Number(e.target.value) })} /></td>
                    <td><input className="cell-in num" type="number" value={r.cumulative} onChange={(e) => setOps(r.id, { cumulative: Number(e.target.value) })} /></td>
                    <td><input className="cell-in num" type="number" value={r.remaining} onChange={(e) => setOps(r.id, { remaining: Number(e.target.value) })} /></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{rate.toLocaleString()}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{etc || '—'}</td>
                    <td><input className="cell-in" value={r.cranes} onChange={(e) => setOps(r.id, { cranes: e.target.value })} placeholder="Gantry 1,2…" /></td>
                    <td><button className="icon-btn" onClick={() => delOps(r.id)}>✕</button></td>
                  </tr>
                )
              })}
              {report.cargoOps.length === 0 && <tr><td colSpan={9} className="empty">No shifts logged yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted-text">Rate (MT/hr) and ETC are calculated automatically from the last-24h quantity and remaining cargo.</p>
      </div>

      {/* 4 · interruptions */}
      <div className="card">
        <div className="card-head">
          <div className="section-title">Interruptions & delays <span className="muted-text">(laytime / demurrage)</span></div>
          <button className="btn btn-ghost btn-sm" onClick={addInt}>+ Add interruption</button>
        </div>
        <div className="grid-scroll">
          <table className="table da-table">
            <thead>
              <tr><th>Category</th><th>From</th><th>To</th><th>Laytime impact</th><th /></tr>
            </thead>
            <tbody>
              {report.interruptions.map((r) => (
                <tr key={r.id}>
                  <td style={{ minWidth: 220 }}>
                    <select className="cell-in" value={r.category} onChange={(e) => setInt(r.id, { category: e.target.value })}>
                      {interruptionCategories.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </td>
                  <td><input className="cell-in" value={r.from} onChange={(e) => setInt(r.id, { from: e.target.value })} placeholder="HH:MM" /></td>
                  <td><input className="cell-in" value={r.to} onChange={(e) => setInt(r.id, { to: e.target.value })} placeholder="HH:MM" /></td>
                  <td>
                    <select className="cell-in" value={r.laytime} onChange={(e) => setInt(r.id, { laytime: e.target.value })}>
                      {laytimeImpact.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </td>
                  <td><button className="icon-btn" onClick={() => delInt(r.id)}>✕</button></td>
                </tr>
              ))}
              {report.interruptions.length === 0 && <tr><td colSpan={5} className="empty">No interruptions logged.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5 · documents, facts & remarks */}
      <div className="card">
        <div className="card-head">
          <div className="section-title">Statement of Facts — timeline pins</div>
          <button className="btn btn-ghost btn-sm" onClick={addPin}>+ Pin event</button>
        </div>
        {report.sofPins.map((p) => (
          <div className="pin-row" key={p.id}>
            <input value={p.event} onChange={(e) => setPin(p.id, { event: e.target.value })} placeholder="Event (e.g. Cargo Commenced)" />
            <input value={p.at} onChange={(e) => setPin(p.id, { at: e.target.value })} placeholder={TIME_PH} />
            <button className="icon-btn" onClick={() => delPin(p.id)}>✕</button>
          </div>
        ))}
        <label className="full" style={{ marginTop: 12 }}>
          Commercial remarks <span className="muted-text">(Deadfreight, cargo damage, stevedore damage, Letters of Protest)</span>
          <textarea rows={3} value={report.commercialRemarks} onChange={(e) => update({ commercialRemarks: e.target.value })} />
        </label>
        <div className="section-title" style={{ marginTop: 8 }}>Categorized attachments vault</div>
        <div className="slot-grid">
          {generalAttachmentSlots.map((slot) => (
            <div className="slot" key={slot}>
              <span className="slot-label">{slot}</span>
              {report.attachments[slot] ? (
                <span className="file-chip">📎 {report.attachments[slot]}
                  <button onClick={() => { const a = { ...report.attachments }; delete a[slot]; update({ attachments: a }) }}>✕</button>
                </span>
              ) : (
                <label className="file-btn">⬆ Upload
                  <input type="file" onChange={(e) => { const n = e.target.files?.[0]?.name; if (n) update({ attachments: { ...report.attachments, [slot]: n } }) }} />
                </label>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bar-between">
        <span className="muted-text">{report.jobCode ? `Filing against ${report.jobCode}` : 'Select a Job Code to enable submission'}</span>
        <button className="btn btn-primary" onClick={onSubmit} disabled={!report.jobCode}>Submit report</button>
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
