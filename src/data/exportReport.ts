import type { Report } from './reporting'
import { reportTypeMeta } from './reporting'

function csvCell(v: string | number): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Download the filtered archive as an Excel-openable CSV.
export function exportReportsCsv(reports: Report[], filename = 'ausglobal-reports.csv') {
  const header = ['Report', 'Type', 'Job Code', 'Vessel', 'IMO', 'Port', 'Country', 'Status', 'Created (local)', 'Created (UTC)']
  const rows = reports.map((r) => [
    r.id,
    reportTypeMeta[r.type].label,
    r.jobCode,
    r.vessel,
    r.imo,
    r.port,
    r.country,
    r.status,
    r.createdAtLocal,
    r.createdAtUtc,
  ])
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// PDF export (print) — full detail with the AusGlobal logo
// ---------------------------------------------------------------------------

// The company logo, inlined so it renders in the standalone print window.
const LOGO_SVG = `<svg width="46" height="46" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <circle cx="32" cy="32" r="30" fill="#07263a"/>
  <circle cx="32" cy="32" r="21" fill="none" stroke="#4aa3df" stroke-width="2"/>
  <ellipse cx="32" cy="32" rx="9" ry="21" fill="none" stroke="#1c5777" stroke-width="1.6"/>
  <line x1="11" y1="32" x2="53" y2="32" stroke="#1c5777" stroke-width="1.6"/>
  <path d="M14 23 H50" stroke="#1c5777" stroke-width="1.3"/>
  <path d="M14 41 H50" stroke="#1c5777" stroke-width="1.3"/>
  <path d="M32 12 L38 34 L32 30 L26 34 Z" fill="#f5b301"/>
  <path d="M32 52 L26 30 L32 34 L38 30 Z" fill="#cfe0ec"/>
  <circle cx="32" cy="32" r="3.2" fill="#f5b301" stroke="#07263a" stroke-width="1.4"/>
</svg>`

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// A definition list; rows with an empty value are dropped.
function kvBlock(pairs: [string, unknown][]): string {
  const rows = pairs
    .filter(([, v]) => v !== '' && v != null && v !== '—')
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join('')
  return rows ? `<table class="kv">${rows}</table>` : ''
}

function section(title: string, body: string): string {
  return body ? `<h2>${esc(title)}</h2>${body}` : ''
}

function dataTable(headers: string[], rows: string[][]): string {
  if (!rows.length) return ''
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('')
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
  return `<table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

function timeBlock(title: string, pairs: [string, string][]): string {
  const rows = pairs.filter(([, v]) => v && v !== '—')
  if (!rows.length) return ''
  return `<div class="tcol"><h4>${esc(title)}</h4>${rows
    .map(([k, v]) => `<div class="trow"><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
    .join('')}</div>`
}

// Build the detailed HTML body for one report.
function renderReport(r: Report): string {
  const head = `
    <div class="rep-head">
      <div>
        <span class="rep-kicker">${esc(reportTypeMeta[r.type].label)} report</span>
        <h1>${esc(r.vessel || 'Report')}</h1>
        <p class="rep-ref">${esc(r.id)} · Job Code ${esc(r.jobCode || '—')}</p>
      </div>
      <div class="rep-stamp">
        <div><b>${esc(r.createdAtLocal)}</b> local</div>
        <div>${esc(r.createdAtUtc)}</div>
        <div class="status status-${r.status === 'Completed' ? 'done' : 'open'}">${esc(r.status)}</div>
      </div>
    </div>`

  const meta = kvBlock([
    ['Ship’s name', r.vessel],
    ['IMO number', r.imo],
    ['Name of the Captain', r.captain],
    ['Voyage number', r.voyageNo],
    ['Port of Call', `${r.port}${r.country ? ', ' + r.country : ''}`],
  ])

  let body = ''

  if (r.type === 'husbandry') {
    body += kvBlock([
      ['Purpose of Call', r.purposeOfCall],
      ['Cargo Type & Quantity', r.cargo],
      ['Place of Service', r.placeOfService],
    ])
    body += section(
      'Port movement timestamps',
      `<div class="tgrid">
        ${timeBlock('Arrival', [['EOSP', r.arrival.eosp], ['Anchor Dropped', r.arrival.anchorDropped], ['NOR Tendered', r.arrival.norTendered]])}
        ${timeBlock('Shifting', [['Anchor Aweigh', r.shifting.anchorAweigh], ['Pilot On Board', r.shifting.pilotOnBoard], ['First Line Ashore', r.shifting.firstLineAshore], ['All Fast', r.shifting.allFast]])}
        ${timeBlock('Sailing', [['Cargo Ops Completed', r.sailing.cargoCompleted], ['Documents Signed', r.sailing.documentsSigned], ['Pilot Disembarked', r.sailing.pilotDisembarked], ['COSP', r.sailing.cosp]])}
      </div>`,
    )
    body += section(
      'Services rendered',
      dataTable(
        ['Type of Service', 'Status', 'Remarks', 'Attachment'],
        r.services.map((s) => [s.serviceType, s.status, s.remark, s.attachment ?? '—']),
      ),
    )
    body += section('General remarks', r.generalRemarks ? `<p>${esc(r.generalRemarks)}</p>` : '')
    body += section('Additional attachments', r.attachments.length ? `<p>${r.attachments.map(esc).join(' · ')}</p>` : '')
  }

  if (r.type === 'general-agency') {
    body += kvBlock([
      ['Purpose of Call', r.purposeOfCall],
      ['Cargo Type', r.cargoType],
      ['Total Manifested Quantity', r.manifestedQty],
      ['Draft Survey (initial → final)', r.draftInitial ? `${r.draftInitial} → ${r.draftFinal}` : ''],
      ['Place of Operations', r.placeOfOperations],
    ])
    body += section(
      'Port movement milestones',
      `<div class="tgrid">
        ${timeBlock('Arrival', [['ETA', r.arrival.eta], ['Actual Arrival', r.arrival.actualArrival], ['EOSP', r.arrival.eosp], ['Anchored', r.arrival.anchored], ['NOR Tendered', r.arrival.norTendered], ['NOR Accepted', r.arrival.norAccepted]])}
        ${timeBlock('Shifting', [['Pilot On Board', r.shifting.pilotOnBoard], ['First Line Ashore', r.shifting.firstLineAshore], ['All Fast', r.shifting.allFast], ['Gangway Down', r.shifting.gangwayDown]])}
        ${timeBlock('Sailing', [['Cargo Ops Completed', r.sailing.cargoCompleted], ['Documents Signed', r.sailing.documentsSigned], ['Lines Cast Off', r.sailing.linesCastOff], ['Pilot Disembarked', r.sailing.pilotDisembarked], ['COSP', r.sailing.cosp]])}
      </div>`,
    )
    body += section(
      'Cargo operations',
      dataTable(
        ['Shift / Day', 'Status', 'Last 24h', 'Cumulative', 'Remaining', 'Hatches / Cranes'],
        r.cargoOps.map((o) => [o.label, o.status, o.qty24h.toLocaleString(), o.cumulative.toLocaleString(), o.remaining.toLocaleString(), o.cranes]),
      ),
    )
    body += section(
      'Interruptions & delays (laytime)',
      dataTable(
        ['Category', 'From', 'To', 'Laytime impact'],
        r.interruptions.map((i) => [i.category, i.from, i.to, i.laytime]),
      ),
    )
    body += section(
      'Statement of Facts',
      dataTable(['Event', 'Time'], r.sofPins.map((p) => [p.event, p.at])),
    )
    body += section('Commercial remarks', r.commercialRemarks ? `<p>${esc(r.commercialRemarks)}</p>` : '')
    const slots = Object.entries(r.attachments)
    body += section('Attachments vault', slots.length ? dataTable(['Document', 'File'], slots.map(([k, v]) => [k, v])) : '')
  }

  if (r.type === 'protecting-agency') {
    body += kvBlock([
      ['Appointed by', r.appointedBy],
      ['Charterer-nominated agent', r.nominatedAgent],
      ['Scope of protection', r.scope],
      ['Disbursements verified', r.disbursementVerified ? 'Yes' : 'No'],
    ])
    body += section('Findings', r.findings ? `<p>${esc(r.findings)}</p>` : '')
    body += section('Remarks to owner', r.remarks ? `<p>${esc(r.remarks)}</p>` : '')
    body += section('Attachments', r.attachments.length ? `<p>${r.attachments.map(esc).join(' · ')}</p>` : '')
  }

  if (r.type === 'epda-fda') {
    const total = r.lines.reduce((s, l) => s + l.amount, 0)
    body += kvBlock([['Account stage', r.stage], ['Currency', r.currency]])
    body += section(
      `${r.stage} line items`,
      dataTable(['Category', `Amount (${r.currency})`], r.lines.map((l) => [l.category, l.amount.toLocaleString()])) +
        `<p class="total">Total: ${esc(r.currency)} ${total.toLocaleString()}</p>`,
    )
    body += section('Remarks', r.remarks ? `<p>${esc(r.remarks)}</p>` : '')
    body += section('Attachments', r.attachments.length ? `<p>${r.attachments.map(esc).join(' · ')}</p>` : '')
  }

  return `<article class="report">${head}${section('Report details', meta)}${body}</article>`
}

const PRINT_CSS = `
  *{box-sizing:border-box}
  body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#122231;margin:0;padding:0}
  .page{max-width:840px;margin:0 auto;padding:28px 34px}
  .brand{display:flex;align-items:center;gap:12px;border-bottom:3px solid #f5b301;padding-bottom:14px;margin-bottom:6px}
  .brand .name{font-weight:800;letter-spacing:1px;color:#07263a;font-size:20px;line-height:1}
  .brand .name span{display:block;font-size:10.5px;letter-spacing:2px;color:#d99a00;font-weight:700;text-transform:uppercase;margin-top:3px}
  .brand .entity{margin-left:auto;text-align:right;font-size:11px;color:#647688;line-height:1.5}
  .report{padding:22px 0;border-bottom:1px solid #eef3f8}
  .rep-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
  .rep-kicker{font-size:10.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#4aa3df}
  .rep-head h1{font-size:20px;margin:4px 0 2px}
  .rep-ref{margin:0;color:#647688;font-size:12.5px;font-family:ui-monospace,Menlo,Consolas,monospace}
  .rep-stamp{text-align:right;font-size:11.5px;color:#51606f;line-height:1.6}
  .status{display:inline-block;margin-top:4px;padding:2px 10px;border-radius:999px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
  .status-done{background:#e3f6ec;color:#1f9d6b}
  .status-open{background:#fbeed2;color:#c77700}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#0b3d5c;margin:20px 0 8px;padding-bottom:5px;border-bottom:1px solid #e0e8f0}
  h4{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:#0b3d5c;margin:0 0 8px}
  p{font-size:13px;line-height:1.55;margin:0 0 6px}
  table{width:100%;border-collapse:collapse}
  table.kv th{width:210px;text-align:left;color:#647688;font-weight:600;font-size:12.5px;padding:6px 8px 6px 0;vertical-align:top}
  table.kv td{font-size:13px;padding:6px 0}
  table.grid{margin:4px 0 8px;font-size:12px}
  table.grid th{background:#0b3d5c;color:#fff;text-align:left;padding:7px 9px;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px}
  table.grid td{padding:7px 9px;border-bottom:1px solid #eef3f8;vertical-align:top}
  .tgrid{display:flex;gap:16px;flex-wrap:wrap}
  .tcol{flex:1;min-width:180px;background:#f6f9fc;border:1px solid #eef3f8;border-radius:8px;padding:10px 12px}
  .trow{display:flex;justify-content:space-between;gap:10px;font-size:11.5px;padding:3px 0}
  .trow span{color:#647688}
  .total{font-weight:700;text-align:right;font-size:13.5px}
  .foot{margin-top:18px;padding-top:12px;border-top:1px solid #e0e8f0;color:#8aa0b2;font-size:10.5px;text-align:center}
  @media print{.report{break-inside:avoid}}
`

// Open a print-friendly window (the user saves as PDF). Renders every report in
// full detail under a branded header with the company logo.
export function printReports(reports: Report[], title: string) {
  const generated = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>${PRINT_CSS}</style></head><body><div class="page">
      <div class="brand">
        ${LOGO_SVG}
        <div class="name">AUSGLOBAL<span>Ship Agency Hub</span></div>
        <div class="entity">AusGlobal Ship Agent Pty Ltd<br/>Brisbane, Queensland · Australia</div>
      </div>
      <p style="color:#647688;font-size:12px;margin:8px 0 0">${esc(title)} · ${reports.length} report(s)</p>
      ${reports.map(renderReport).join('')}
      <div class="foot">Digitally generated via the AusGlobal platform · ${esc(generated)} · This document is a system-of-record export.</div>
    </div></body></html>`

  const w = window.open('', '_blank')
  if (!w) {
    alert('Please allow pop-ups to export a PDF.')
    return
  }
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 300)
}
