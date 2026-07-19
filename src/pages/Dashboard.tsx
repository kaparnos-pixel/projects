import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { usePlatform } from '../platform/PlatformContext'
import { Badge, Card } from '../components/ui'
import { PartyFlow, PhaseStrip } from '../components/Flow'
import { nextStage, stageMeta } from '../data/lifecycle'
import { fdaSla, hubMargin, ledgerBalance, pdaTotal, usd } from '../data/calc'
import type { UserRole } from '../data/types'

interface Kpi {
  icon: string
  value: string | number
  label: string
  sub: string
}

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

  // Aggregates for the role-specific dashboards.
  const all = platform.voyages
  const totalFunded = all.reduce((s, v) => s + ledgerBalance(v.ledger).funded, 0)
  const advancesReceived = all.reduce(
    (s, v) => s + v.ledger.filter((g) => g.kind === 'advance').reduce((a, g) => a + g.amount, 0),
    0,
  )
  const marginBooked = all
    .filter((v) => v.stage === 'invoiced' || v.stage === 'settled')
    .reduce((s, v) => s + hubMargin(v), 0)
  const invoicesIssued = all.filter((v) => v.stage === 'invoiced' || v.stage === 'settled').length
  const pdasToApprove = all.filter((v) => v.stage === 'pda-vetted').length
  const pdasToSubmit = all.filter((v) => v.stage === 'forwarded').length
  const fdasDue = all.filter((v) => v.stage === 'sailed')
  const fdasOverdue = fdasDue.filter((v) => {
    const s = fdaSla(v)
    return s && s.daysLeft < 0
  }).length

  const kpisByRole: Record<UserRole, Kpi[]> = {
    'Hub Manager': [
      { icon: '⚓', value: open.length, label: 'Open voyages', sub: 'in progress now' },
      { icon: '⏳', value: mine.length, label: 'Awaiting hub action', sub: 'vet · advance · audit · invoice' },
      { icon: '🏦', value: usd(fundsHeld), label: 'Capital held by hub', sub: 'pre-funded, not advanced' },
      { icon: '💼', value: usd(marginBooked), label: 'AusGlobal margin booked', sub: 'on invoiced & settled calls' },
    ],
    Principal: [
      { icon: '⚓', value: open.length, label: 'My open voyages', sub: 'in progress' },
      { icon: '✅', value: pdasToApprove, label: 'PDAs to approve', sub: 'vetted, awaiting you' },
      { icon: '🏦', value: usd(totalFunded), label: 'Total pre-funded', sub: 'into the hub account' },
      { icon: '🧾', value: invoicesIssued, label: 'Unified invoices', sub: 'one per completed call' },
    ],
    'Sub-Agent': [
      { icon: '⚓', value: open.length, label: 'Assigned voyages', sub: 'in progress' },
      { icon: '📝', value: pdasToSubmit, label: 'PDAs to submit', sub: 'appointments forwarded to you' },
      { icon: '💵', value: usd(advancesReceived), label: 'Advances received', sub: 'for authority payments' },
      { icon: '⏱', value: fdasDue.length, label: 'FDAs due', sub: fdasOverdue ? `${fdasOverdue} overdue` : 'within 30-day SLA' },
    ],
  }
  const myKpis = kpisByRole[role]

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

      {role === 'Sub-Agent' && (
        <Card>
          <div className="card-head">
            <div className="section-title">📝 Your reporting desk</div>
            <Link className="btn btn-primary btn-sm" to="/reporting">Open reporting →</Link>
          </div>
          <p className="muted-text" style={{ margin: 0 }}>
            File Husbandry, General Agency, Protecting Agency and EPDA/FDA reports against a Job Code, log
            the Statement of Facts live, and export archived logs to PDF or Excel.
          </p>
        </Card>
      )}

      <div className="kpi-grid">
        {myKpis.map((k) => (
          <Card key={k.label}>
            <div className="kpi">
              <div className="kpi-icon">{k.icon}</div>
              <div>
                <div className="kpi-value">{k.value}</div>
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-sub">{k.sub}</div>
              </div>
            </div>
          </Card>
        ))}
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
