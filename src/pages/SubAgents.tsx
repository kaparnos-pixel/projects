import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { usePlatform } from '../platform/PlatformContext'
import { Badge, Card, PageHeader, Stars } from '../components/ui'
import type { Compliance, EnlistmentStatus, SubAgent } from '../data/types'

const STATUSES: (EnlistmentStatus | 'all')[] = ['all', 'prospect', 'vetting', 'enlisted', 'suspended']

const complianceLabels: { key: keyof Compliance; label: string }[] = [
  { key: 'financials', label: 'Financial stability' },
  { key: 'trace', label: 'TRACE anti-bribery' },
  { key: 'fcpa', label: 'FCPA alignment' },
  { key: 'iso9001', label: 'ISO 9001' },
]

function complianceComplete(c: Compliance): boolean {
  return c.financials && c.trace && c.fcpa && c.iso9001
}

export default function SubAgents() {
  const platform = usePlatform()
  const { user } = useAuth()
  const actor = { name: user?.name ?? 'Hub Desk', role: user?.role ?? 'Hub Manager' as const }
  const [filter, setFilter] = useState<EnlistmentStatus | 'all'>('all')

  const list = platform.subAgents.filter((s) => filter === 'all' || s.status === filter)
  const counts = {
    enlisted: platform.subAgents.filter((s) => s.status === 'enlisted').length,
    vetting: platform.subAgents.filter((s) => s.status === 'vetting').length,
    prospect: platform.subAgents.filter((s) => s.status === 'prospect').length,
  }

  function toggleCompliance(s: SubAgent, key: keyof Compliance) {
    platform.updateSubAgent(s.id, { compliance: { ...s.compliance, [key]: !s.compliance[key] } })
  }

  return (
    <div className="stack">
      <PageHeader
        title="Sub-Agent Network"
        subtitle="AusGlobal owns no offices in port. Instead it sources, vets and enlists top-tier local agencies through a strict procurement and compliance process, each bound by an SLA and frame agreement."
      />

      <div className="kpi-grid">
        <Card><div className="kpi"><div className="kpi-icon">🌐</div><div><div className="kpi-value">{platform.subAgents.length}</div><div className="kpi-label">In network</div></div></div></Card>
        <Card><div className="kpi"><div className="kpi-icon">✅</div><div><div className="kpi-value">{counts.enlisted}</div><div className="kpi-label">Enlisted</div></div></div></Card>
        <Card><div className="kpi"><div className="kpi-icon">🔎</div><div><div className="kpi-value">{counts.vetting}</div><div className="kpi-label">In vetting</div></div></div></Card>
        <Card><div className="kpi"><div className="kpi-icon">🧭</div><div><div className="kpi-value">{counts.prospect}</div><div className="kpi-label">Sourced prospects</div></div></div></Card>
      </div>

      <div className="tabs">
        {STATUSES.map((s) => (
          <button key={s} className={`tab${filter === s ? ' active' : ''}`} onClick={() => setFilter(s)}>
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="agent-grid">
        {list.map((s) => {
          const ready = complianceComplete(s.compliance)
          return (
            <Card key={s.id} className="agent-card">
              <div className="agent-top">
                <div className="agent-avatar">{s.countryCode}</div>
                <div className="agent-id">
                  <strong>{s.company}</strong>
                  <span>{s.port}, {s.country}</span>
                </div>
                <Badge label={s.status} />
              </div>
              <p className="agent-about">{s.about}</p>
              <div className="chips">
                {s.services.map((sv) => <span key={sv} className="chip">{sv}</span>)}
              </div>

              <div className="compliance-grid">
                {complianceLabels.map(({ key, label }) => (
                  <label key={key} className={`comp-check${s.compliance[key] ? ' on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={s.compliance[key]}
                      disabled={s.status === 'enlisted'}
                      onChange={() => toggleCompliance(s, key)}
                    />
                    {s.compliance[key] ? '✓' : '○'} {label}
                  </label>
                ))}
              </div>

              <div className="agent-stats">
                <Stars value={s.rating} />
                <span>📨 {s.email}</span>
                <span>⏱ {s.responseHrs}h SLA</span>
                <span>⚓ {s.portCalls} calls</span>
                <span>{s.slaSigned ? '📝 SLA signed' : '✍️ SLA pending'}</span>
              </div>

              <div className="agent-actions">
                {s.status === 'prospect' && (
                  <button className="btn btn-ghost" onClick={() => platform.updateSubAgent(s.id, { status: 'vetting' })}>
                    Begin due diligence
                  </button>
                )}
                {s.status === 'vetting' && (
                  <button
                    className="btn btn-primary"
                    disabled={!ready}
                    title={ready ? 'Sign SLA & enlist' : 'Clear all compliance checks first'}
                    onClick={() => platform.enlistSubAgent(s.id, actor)}
                  >
                    {ready ? 'Enlist & sign SLA' : 'Compliance incomplete'}
                  </button>
                )}
                {s.status === 'enlisted' && (
                  <button className="btn btn-ghost" onClick={() => platform.updateSubAgent(s.id, { status: 'suspended' })}>
                    Suspend
                  </button>
                )}
                {s.status === 'suspended' && (
                  <button className="btn btn-ghost" onClick={() => platform.updateSubAgent(s.id, { status: 'enlisted' })}>
                    Reinstate
                  </button>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
