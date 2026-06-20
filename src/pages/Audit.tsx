import { useMemo, useState } from 'react'
import { Card, PageHeader } from '../components/ui'
import { auditEntries } from '../data/mock'
import type { AuditCategory } from '../data/types'

const categories: { key: AuditCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'discovery', label: 'Discovery' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'chat', label: 'Chat' },
  { key: 'contract', label: 'Contracts' },
  { key: 'port-call', label: 'Port calls' },
  { key: 'security', label: 'Security' },
]

export default function Audit() {
  const [filter, setFilter] = useState<AuditCategory | 'all'>('all')

  const entries = useMemo(
    () => (filter === 'all' ? auditEntries : auditEntries.filter((e) => e.category === filter)),
    [filter],
  )

  return (
    <div className="stack">
      <PageHeader
        title="Auditable comms"
        subtitle="An immutable, hash-chained record of every action taken in the Agent Hub."
        action={<button className="btn btn-ghost">⬇ Export trail (CSV)</button>}
      />

      <div className="tabs">
        {categories.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`tab${filter === c.key ? ' active' : ''}`}
            onClick={() => setFilter(c.key)}
          >
            {c.label}
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
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="mono nowrap">{e.time}</td>
                <td>
                  <div className="audit-actor">
                    <span className={`dot dot-${e.category}`} aria-hidden />
                    <div>
                      <strong>{e.actor}</strong>
                      <span className="mini-meta">{e.role}</span>
                    </div>
                  </div>
                </td>
                <td>{e.action}</td>
                <td className="audit-detail">{e.detail}</td>
                <td className="mono nowrap">{e.hash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="audit-foot">
        🔒 {entries.length} record{entries.length === 1 ? '' : 's'} · each entry is SHA-256 chained to
        the previous; tampering breaks the chain.
      </p>
    </div>
  )
}
