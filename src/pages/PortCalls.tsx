import { Card, PageHeader } from '../components/ui'
import { portCalls } from '../data/mock'
import type { PortCall, PortCallStage } from '../data/types'

const stages: { key: PortCallStage; label: string }[] = [
  { key: 'nominated', label: 'Nominated' },
  { key: 'pre-arrival', label: 'Pre-arrival' },
  { key: 'alongside', label: 'Alongside' },
  { key: 'operations', label: 'Operations' },
  { key: 'departed', label: 'Departed' },
]

export default function PortCalls() {
  const byStage = (k: PortCallStage): PortCall[] => portCalls.filter((p) => p.stage === k)

  return (
    <div className="stack">
      <PageHeader
        title="Port-call coordination"
        subtitle="Track each appointed call from nomination through departure across your fleet."
        action={<button className="btn btn-primary">+ Nominate call</button>}
      />

      <div className="board">
        {stages.map((s) => (
          <div className="board-col" key={s.key}>
            <div className="board-col-head">
              <span>{s.label}</span>
              <span className="col-count">{byStage(s.key).length}</span>
            </div>
            <div className="board-col-body">
              {byStage(s.key).map((p) => (
                <Card key={p.id} className="pc-card">
                  <strong>{p.vessel}</strong>
                  <span className="pc-imo mono">IMO {p.imo}</span>
                  <div className="pc-line">
                    📍 {p.port} · {p.berth}
                  </div>
                  <div className="pc-line">📦 {p.cargo}</div>
                  <div className="pc-line">🏷 {p.agent}</div>
                  <div className="pc-times">
                    <span>
                      <small>ETA</small>
                      <span className="mono">{p.eta}</span>
                    </span>
                    <span>
                      <small>ETD</small>
                      <span className="mono">{p.etd}</span>
                    </span>
                  </div>
                </Card>
              ))}
              {byStage(s.key).length === 0 && <div className="board-empty">—</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
