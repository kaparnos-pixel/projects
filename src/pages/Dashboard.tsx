import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { usePlatform } from '../platform/PlatformContext'
import { Badge, Card } from '../components/ui'
import { PartyFlow, PhaseStrip } from '../components/Flow'
import { nextStage, stageMeta } from '../data/lifecycle'
import { ledgerBalance, pdaTotal, usd } from '../data/calc'
import type { UserRole } from '../data/types'

const roleIntro: Record<UserRole, string> = {
  'Hub Manager': 'You coordinate principals and sub-agents, vet every PDA, hold and release funds, and audit each FDA.',
  Principal: 'Appoint AusGlobal, approve proformas, fund port calls and receive one unified invoice per voyage.',
  'Sub-Agent': 'Submit PDAs in the standardised format, execute the port call, log the Statement of Facts and file the FDA.',
}

export default function Dashboard() {
  const { user } = useAuth()
  const platform = usePlatform()
  const role: UserRole = user?.role ?? 'Hub Manager'

  const open = platform.voyages.filter((v) => v.stage !== 'settled')
  const mine = open.filter((v) => {
    const n = nextStage(v.stage)
    return n && (stageMeta[n].actor === role || role === 'Hub Manager')
  })
  const fundsHeld = platform.voyages.reduce((s, v) => s + ledgerBalance(v.ledger).held, 0)
  const settledCount = platform.voyages.filter((v) => v.stage === 'settled').length

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Welcome back, {user?.name?.split(' ')[0] ?? 'there'}</h1>
          <p className="page-sub">{roleIntro[role]}</p>
        </div>
        <Link to="/voyages" className="btn btn-primary">View all voyages →</Link>
      </div>

      <Card>
        <div className="section-title">The AusGlobal model</div>
        <PartyFlow />
      </Card>

      <div className="kpi-grid">
        <Card>
          <div className="kpi">
            <div className="kpi-icon">⚓</div>
            <div>
              <div className="kpi-value">{open.length}</div>
              <div className="kpi-label">Open voyages</div>
              <div className="kpi-sub">in progress now</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="kpi">
            <div className="kpi-icon">⏳</div>
            <div>
              <div className="kpi-value">{mine.length}</div>
              <div className="kpi-label">Awaiting your action</div>
              <div className="kpi-sub">{role}</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="kpi">
            <div className="kpi-icon">🏦</div>
            <div>
              <div className="kpi-value">{usd(fundsHeld)}</div>
              <div className="kpi-label">Capital held by hub</div>
              <div className="kpi-sub">pre-funded, not yet advanced</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="kpi">
            <div className="kpi-icon">✅</div>
            <div>
              <div className="kpi-value">{settledCount}</div>
              <div className="kpi-label">Settled & archived</div>
              <div className="kpi-sub">fully reconciled</div>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="section-title">Port-call lifecycle</div>
        <PhaseStrip />
      </Card>

      <div className="two-col">
        <Card>
          <div className="card-head">
            <div className="section-title">Needs your attention</div>
            <Link className="link" to="/voyages">All voyages</Link>
          </div>
          {mine.length === 0 ? (
            <p className="muted-text">Nothing waiting on you right now.</p>
          ) : (
            <ul className="mini-feed">
              {mine.slice(0, 6).map((v) => {
                const n = nextStage(v.stage)!
                return (
                  <li key={v.id}>
                    <span className="dot dot-contract" />
                    <div>
                      <strong>
                        <Link className="link" to={`/voyages/${v.id}`}>{v.vessel}</Link> · {v.port}
                      </strong>
                      <span className="mini-detail">Next: {stageMeta[n].label} — {stageMeta[n].short}</span>
                      <span className="mini-meta">{v.id} · {stageMeta[n].actor}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card>
          <div className="card-head">
            <div className="section-title">Recent activity</div>
            <Link className="link" to="/audit">Audit trail</Link>
          </div>
          <ul className="mini-feed">
            {platform.audit.slice(0, 6).map((a) => (
              <li key={a.id}>
                <span className={`dot dot-${a.category === 'funding' ? 'port-call' : a.category === 'fda' || a.category === 'settlement' ? 'onboarding' : 'discovery'}`} />
                <div>
                  <strong>{a.action}</strong>
                  <span className="mini-detail">{a.detail}</span>
                  <span className="mini-meta">{a.actor} · {a.role} · {a.at}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <div className="card-head">
          <div className="section-title">Latest voyages</div>
          <Link className="link" to="/voyages">See all</Link>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Voyage</th>
              <th>Vessel</th>
              <th>Port</th>
              <th className="num" style={{ textAlign: 'right' }}>PDA</th>
              <th>Stage</th>
            </tr>
          </thead>
          <tbody>
            {platform.voyages.slice(0, 6).map((v) => (
              <tr key={v.id}>
                <td className="mono"><Link className="link" to={`/voyages/${v.id}`}>{v.id}</Link></td>
                <td>{v.vessel}</td>
                <td>{v.port}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{v.daLines.length ? usd(pdaTotal(v.daLines)) : '—'}</td>
                <td><Badge label={stageMeta[v.stage].label} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
