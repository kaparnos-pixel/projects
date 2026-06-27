import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { usePlatform, type NewVoyageInput } from '../platform/PlatformContext'
import { Badge, Card, PageHeader } from '../components/ui'
import { stageMeta } from '../data/lifecycle'
import { pdaTotal, usd } from '../data/calc'
import type { VoyagePhase } from '../data/types'

const phaseLabel: Record<VoyagePhase, string> = {
  appointment: 'Appointment',
  funding: 'Funding',
  execution: 'Execution',
  settlement: 'Settlement',
}

export default function Voyages() {
  const platform = usePlatform()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<VoyagePhase | 'all'>('all')
  const [showAppoint, setShowAppoint] = useState(false)

  const role = user?.role ?? 'Hub Manager'
  const canAppoint = role === 'Principal' || role === 'Hub Manager'

  const voyages = useMemo(() => {
    if (phase === 'all') return platform.voyages
    return platform.voyages.filter((v) => stageMeta[v.stage].phase === phase)
  }, [platform.voyages, phase])

  return (
    <div className="stack">
      <PageHeader
        title="Voyages"
        subtitle="Every port call AusGlobal coordinates, from appointment through final settlement. Each carries a unique Voyage ID against which all documents are archived."
        action={
          canAppoint ? (
            <button className="btn btn-primary" onClick={() => setShowAppoint(true)}>
              + Appoint a port call
            </button>
          ) : undefined
        }
      />

      <div className="tabs">
        {(['all', 'appointment', 'funding', 'execution', 'settlement'] as const).map((p) => (
          <button
            key={p}
            className={`tab${phase === p ? ' active' : ''}`}
            onClick={() => setPhase(p)}
          >
            {p === 'all' ? 'All' : phaseLabel[p]}
            <span className="tab-count">
              {p === 'all'
                ? platform.voyages.length
                : platform.voyages.filter((v) => stageMeta[v.stage].phase === p).length}
            </span>
          </button>
        ))}
      </div>

      <Card>
        <table className="table">
          <thead>
            <tr>
              <th>Voyage</th>
              <th>Vessel</th>
              <th>Port</th>
              <th>Principal</th>
              <th>Sub-agent</th>
              <th className="num" style={{ textAlign: 'right' }}>PDA</th>
              <th>Stage</th>
            </tr>
          </thead>
          <tbody>
            {voyages.map((v) => {
              const principal = platform.principal(v.principalId)
              const sub = platform.subAgent(v.subAgentId)
              return (
                <tr
                  key={v.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/voyages/${v.id}`)}
                >
                  <td className="mono">{v.id}</td>
                  <td>
                    <strong>{v.vessel}</strong>
                    <div className="muted-text">{v.vesselType}</div>
                  </td>
                  <td>{v.port}<div className="muted-text">{v.country}</div></td>
                  <td>{principal?.company ?? '—'}</td>
                  <td>{sub?.company ?? <span className="muted-text">unassigned</span>}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {v.daLines.length ? usd(pdaTotal(v.daLines)) : '—'}
                  </td>
                  <td><Badge label={stageMeta[v.stage].label} /></td>
                </tr>
              )
            })}
            {voyages.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">No voyages in this phase.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {showAppoint && <AppointModal onClose={() => setShowAppoint(false)} />}
    </div>
  )
}

const VESSEL_TYPES = [
  'Handysize bulk carrier',
  'Supramax bulk carrier',
  'Panamax bulk carrier',
  'Capesize bulk carrier',
  'Product / chemical tanker',
  'Aframax tanker',
  'VLCC tanker',
  'Container vessel',
]

function AppointModal({ onClose }: { onClose: () => void }) {
  const platform = usePlatform()
  const { user } = useAuth()
  const navigate = useNavigate()
  const actor = { name: user?.name ?? 'Hub Desk', role: user?.role ?? 'Hub Manager' as const }

  const [form, setForm] = useState<NewVoyageInput>({
    vessel: '',
    imo: '',
    vesselType: VESSEL_TYPES[0],
    gt: 30000,
    port: 'Singapore',
    country: 'Singapore',
    countryCode: 'SG',
    cargo: '',
    principalId: platform.principals[0]?.id ?? '',
    eta: '2026-07-10',
    etd: '2026-07-13',
    services: ['Port Agency'],
    agencyFee: 5000,
  })

  function set<K extends keyof NewVoyageInput>(k: K, val: NewVoyageInput[K]) {
    setForm((f) => ({ ...f, [k]: val }))
  }

  const valid = form.vessel.trim() && form.imo.trim() && form.cargo.trim() && form.principalId

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Appoint AusGlobal for a port call</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="form-grid">
          <label>
            Vessel name
            <input value={form.vessel} onChange={(e) => set('vessel', e.target.value)} placeholder="MV Example" />
          </label>
          <label>
            IMO number
            <input value={form.imo} onChange={(e) => set('imo', e.target.value)} placeholder="9xxxxxx" />
          </label>
          <label>
            Vessel type
            <select value={form.vesselType} onChange={(e) => set('vesselType', e.target.value)}>
              {VESSEL_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>
            Gross tonnage
            <input type="number" value={form.gt} onChange={(e) => set('gt', Number(e.target.value))} />
          </label>
          <label>
            Port
            <input value={form.port} onChange={(e) => set('port', e.target.value)} />
          </label>
          <label>
            Country
            <input value={form.country} onChange={(e) => set('country', e.target.value)} />
          </label>
          <label>
            Principal
            <select value={form.principalId} onChange={(e) => set('principalId', e.target.value)}>
              {platform.principals.map((p) => <option key={p.id} value={p.id}>{p.company}</option>)}
            </select>
          </label>
          <label>
            Agency fee (USD)
            <input type="number" value={form.agencyFee} onChange={(e) => set('agencyFee', Number(e.target.value))} />
          </label>
          <label>
            ETA
            <input value={form.eta} onChange={(e) => set('eta', e.target.value)} placeholder="2026-07-10" />
          </label>
          <label>
            ETD
            <input value={form.etd} onChange={(e) => set('etd', e.target.value)} placeholder="2026-07-13" />
          </label>
        </div>
        <label className="full">
          Cargo / scope
          <input value={form.cargo} onChange={(e) => set('cargo', e.target.value)} placeholder="e.g. 60,000 mt iron ore (discharge)" />
        </label>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!valid}
            onClick={() => {
              const id = platform.appoint(form, actor)
              onClose()
              navigate(`/voyages/${id}`)
            }}
          >
            Appoint AusGlobal
          </button>
        </div>
      </div>
    </div>
  )
}
