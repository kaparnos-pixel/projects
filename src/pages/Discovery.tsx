import { useMemo, useState } from 'react'
import { Badge, Card, PageHeader, Stars } from '../components/ui'
import { agents } from '../data/mock'

const allServices = Array.from(new Set(agents.flatMap((a) => a.services))).sort()

export default function Discovery() {
  const [query, setQuery] = useState('')
  const [service, setService] = useState('All services')
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [shortlist, setShortlist] = useState<string[]>([])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return agents.filter((a) => {
      const matchesQuery =
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.company.toLowerCase().includes(q) ||
        a.port.toLowerCase().includes(q) ||
        a.country.toLowerCase().includes(q)
      const matchesService = service === 'All services' || a.services.includes(service)
      const matchesVerified = !verifiedOnly || a.verified
      return matchesQuery && matchesService && matchesVerified
    })
  }, [query, service, verifiedOnly])

  function toggleShortlist(id: string) {
    setShortlist((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  return (
    <div className="stack">
      <PageHeader
        title="Agent discovery"
        subtitle="Search the verified directory of port agents by location, service and performance."
        action={<span className="pill-count">{shortlist.length} shortlisted</span>}
      />

      <Card className="filters">
        <div className="filter-search">
          <span aria-hidden>🔎</span>
          <input
            placeholder="Search by agent, company, port or country…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select value={service} onChange={(e) => setService(e.target.value)}>
          <option>All services</option>
          {allServices.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => setVerifiedOnly(e.target.checked)}
          />
          Verified only
        </label>
      </Card>

      <div className="agent-grid">
        {results.map((a) => (
          <Card key={a.id} className="agent-card">
            <div className="agent-top">
              <div className="agent-avatar" aria-hidden>
                {a.countryCode}
              </div>
              <div className="agent-id">
                <strong>{a.company}</strong>
                <span>
                  {a.name} · {a.port}, {a.country}
                </span>
              </div>
              <Badge label={a.status} />
            </div>

            <p className="agent-about">{a.about}</p>

            <div className="chips">
              {a.services.map((s) => (
                <span className="chip" key={s}>
                  {s}
                </span>
              ))}
            </div>

            <div className="agent-stats">
              <Stars value={a.rating} />
              <span>⏱ {a.responseTimeMins}m avg reply</span>
              <span>⚓ {a.portCalls} calls</span>
              <span>since {a.since}</span>
            </div>

            <div className="agent-actions">
              <button
                type="button"
                className={`btn ${shortlist.includes(a.id) ? 'btn-soft' : 'btn-primary'}`}
                onClick={() => toggleShortlist(a.id)}
              >
                {shortlist.includes(a.id) ? '✓ Shortlisted' : '+ Shortlist'}
              </button>
              <button type="button" className="btn btn-ghost">
                Message
              </button>
            </div>
          </Card>
        ))}
        {results.length === 0 && <Card className="empty">No agents match your filters.</Card>}
      </div>
    </div>
  )
}
