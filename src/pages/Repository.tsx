import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlatform } from '../platform/PlatformContext'
import { Badge, Card, PageHeader } from '../components/ui'

interface ArchivedDoc {
  voyageId: string
  vessel: string
  port: string
  name: string
  kind: string
  uploadedBy: string
  at: string
  size: string
}

// The centralised repository: digitised copies of every receipt, customs
// document and master receipt, permanently archived against the unique Voyage
// ID for auditing.
export default function Repository() {
  const platform = usePlatform()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')

  const docs: ArchivedDoc[] = useMemo(
    () =>
      platform.voyages.flatMap((v) =>
        v.documents.map((d) => ({
          voyageId: v.id,
          vessel: v.vessel,
          port: v.port,
          name: d.name,
          kind: d.kind,
          uploadedBy: d.uploadedBy,
          at: d.at,
          size: d.size,
        })),
      ),
    [platform.voyages],
  )

  const kinds = ['all', ...Array.from(new Set(docs.map((d) => d.kind)))]
  const filtered = docs.filter(
    (d) =>
      (kind === 'all' || d.kind === kind) &&
      (q === '' ||
        `${d.name} ${d.vessel} ${d.voyageId} ${d.port}`.toLowerCase().includes(q.toLowerCase())),
  )

  return (
    <div className="stack">
      <PageHeader
        title="Document Repository"
        subtitle="Every PDA, FDA, voucher, customs document, receipt and Statement of Facts, permanently archived against its unique Voyage ID for audit and reprint at any time."
      />

      <Card>
        <div className="filters">
          <div className="filter-search">
            <span aria-hidden>🔎</span>
            <input placeholder="Search by file, vessel, voyage or port…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((k) => <option key={k} value={k}>{k === 'all' ? 'All document types' : k}</option>)}
          </select>
          <span className="pill-count">{filtered.length} documents</span>
        </div>
      </Card>

      <Card>
        <table className="table">
          <thead>
            <tr>
              <th>Document</th>
              <th>Type</th>
              <th>Voyage</th>
              <th>Vessel</th>
              <th>Uploaded by</th>
              <th>Archived</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d, i) => (
              <tr key={i}>
                <td>📎 {d.name}</td>
                <td><Badge label={d.kind} tone="info" /></td>
                <td className="mono"><Link className="link" to={`/voyages/${d.voyageId}`}>{d.voyageId}</Link></td>
                <td>{d.vessel}</td>
                <td className="muted-text">{d.uploadedBy}</td>
                <td className="muted-text mono">{d.at}</td>
                <td className="muted-text">{d.size}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="empty">No documents match your search.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
