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

// Open a print-friendly window (the user saves as PDF) for a set of reports.
export function printReports(reports: Report[], title: string) {
  const rows = reports
    .map(
      (r) => `<tr>
        <td>${r.id}</td><td>${reportTypeMeta[r.type].label}</td><td>${r.jobCode}</td>
        <td>${r.vessel}</td><td>${r.port}</td><td>${r.status}</td><td>${r.createdAtLocal}</td>
      </tr>`,
    )
    .join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>
      body{font-family:Inter,system-ui,Arial,sans-serif;color:#122231;padding:32px}
      h1{font-size:20px;margin:0 0 4px} .sub{color:#647688;font-size:13px;margin:0 0 20px}
      table{width:100%;border-collapse:collapse;font-size:12.5px}
      th{background:#0b3d5c;color:#fff;text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
      td{padding:8px 10px;border-bottom:1px solid #eef3f8}
      .brand{color:#0b3d5c;font-weight:800;letter-spacing:1px}
    </style></head><body>
      <div class="brand">AUSGLOBAL</div>
      <h1>${title}</h1>
      <p class="sub">${reports.length} report(s) · generated ${new Date().toISOString().slice(0, 10)}</p>
      <table><thead><tr>
        <th>Report</th><th>Type</th><th>Job Code</th><th>Vessel</th><th>Port</th><th>Status</th><th>Created</th>
      </tr></thead><tbody>${rows}</tbody></table>
    </body></html>`
  const w = window.open('', '_blank')
  if (!w) {
    alert('Please allow pop-ups to export a PDF.')
    return
  }
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 250)
}
