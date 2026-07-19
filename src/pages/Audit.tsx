import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlatform } from '../platform/PlatformContext'
import { Badge, Card, PageHeader } from '../components/ui'
import type { AuditCategory } from '../data/types'

const CATEGORIES: (AuditCategory | 'all')[] = [
  'all',
  'appointment',
  'pda',
  'funding',
  'execution',
  'fda',
  'settlement',
  'network',
]

export default function Audit() {
  const platform = usePlatform()
  const [cat, setCat] = useState<AuditCategory | 'all'>('all')

  const entries = platform.audit.filter((e) => cat === 'all' || e.category === cat)

  return (
    <div className="stack">
      <PageHeader
        title="Audit Trail"
        subtitle="Every input across the appointment, disbursement, funding and settlement lifecycle is recorded with an actor, timestamp and hash, giving all three parties a single transparent financial record."
      />

      <div className="tabs">
        {CATEGORIES.map((c) => (
          <button key={c} className={`tab${cat === c ? ' active' : ''}`} onClick={() => setCat(c)}>
            {c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>

      <Card>
        <table className="table audit-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Detail</th>
              <th>Voyage</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="audit-foot mono nowrap">{e.at}</td>
                <td>
                  <div className="audit-actor">
                    <div>
                      <strong>{e.actor}</strong>
                      <Badge label={e.role} tone="info" />
                    </div>
                  </div>
                </td>
                <td><strong>{e.action}</strong><div><Badge label={e.category} /></div></td>
                <td className="audit-detail">{e.detail}</td>
                <td className="mono">
                  {e.voyageId ? <Link className="link" to={`/voyages/${e.voyageId}`}>{e.voyageId}</Link> : '-'}
                </td>
                <td className="audit-foot mono">{e.hash}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={6} className="empty">No entries in this category.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
