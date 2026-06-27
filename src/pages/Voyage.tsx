import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { usePlatform } from '../platform/PlatformContext'
import { Badge, Card, PageHeader } from '../components/ui'
import { PhaseStrip } from '../components/Flow'
import { nextStage, stageMeta } from '../data/lifecycle'
import { seedTariffs } from '../data/seed'
import {
  fdaSla,
  fdaTotal,
  hubMargin,
  isOverTariff,
  ledgerBalance,
  lineVariance,
  pdaTotal,
  settlementDelta,
  subAgentRemittance,
  usd,
} from '../data/calc'
import type { DALine, UserRole } from '../data/types'

const SOF_LABELS = [
  'NOR Tendered',
  'All Fast (alongside)',
  'Cargo operations commenced',
  'Cargo operations completed',
  'Bunkers commenced',
  'Surveyor on board',
]

// Build a sensible default PDA from the port tariff reference.
function defaultPdaLines(port: string, agencyFee: number): DALine[] {
  const tariffs = seedTariffs.filter((t) => t.port === port)
  const lines: DALine[] = tariffs
    .filter((t) => t.category !== 'Agency fee')
    .map((t, i) => ({
      id: `l${i + 1}`,
      category: t.category,
      description: t.category,
      proforma: Math.round(t.cap * 0.9),
      tariffCap: t.cap,
      currency: 'USD',
    }))
  if (lines.length === 0) {
    ;['Pilotage', 'Towage / Tugs', 'Berth hire / Dockage', 'Port & light dues'].forEach((c, i) =>
      lines.push({ id: `l${i + 1}`, category: c, description: c, proforma: 4000, currency: 'USD' }),
    )
  }
  const agencyCap = tariffs.find((t) => t.category === 'Agency fee')?.cap
  lines.push({
    id: `l${lines.length + 1}`,
    category: 'Agency fee',
    description: 'AusGlobal agency fee',
    proforma: agencyFee,
    tariffCap: agencyCap,
    currency: 'USD',
  })
  return lines
}

export default function Voyage() {
  const { id } = useParams()
  const { user } = useAuth()
  const platform = usePlatform()
  const v = platform.voyage(id ?? '')

  const [modal, setModal] = useState<null | 'forward' | 'pda' | 'advance' | 'fda'>(null)

  if (!v) {
    return (
      <div className="stack">
        <Card>
          <p className="muted-text">Voyage not found.</p>
          <Link className="link" to="/voyages">
            ← Back to voyages
          </Link>
        </Card>
      </div>
    )
  }

  const role: UserRole = user?.role ?? 'Hub Manager'
  const actor = { name: user?.name ?? 'Hub Desk', role }
  const principal = platform.principal(v.principalId)
  const subAgent = platform.subAgent(v.subAgentId)

  const next = nextStage(v.stage)
  const requiredActor = next ? stageMeta[next].actor : null
  // The Hub Manager operates the platform and may act on any party's behalf in
  // the demo; principals and sub-agents can only drive their own steps.
  const canAct = !!requiredActor && (role === requiredActor || role === 'Hub Manager')
  const onBehalf = canAct && requiredActor !== role

  const pTotal = pdaTotal(v.daLines)
  const fTotal = fdaTotal(v.daLines)
  const bal = ledgerBalance(v.ledger)
  const delta = settlementDelta(v)
  const hasFinal = v.daLines.some((l) => l.final != null)
  const remit = subAgentRemittance(v)
  const margin = hubMargin(v)
  const sla = fdaSla(v)
  const fdaPending = v.stage === 'sailed'

  function runPrimary() {
    if (!next) return
    switch (next) {
      case 'forwarded':
      case 'pda-submitted':
      case 'advanced':
      case 'fda-submitted':
        setModal(next === 'forwarded' ? 'forward' : next === 'pda-submitted' ? 'pda' : next === 'advanced' ? 'advance' : 'fda')
        break
      case 'pda-vetted':
        platform.vetPda(v!.id, actor)
        break
      case 'pda-approved':
        platform.approvePda(v!.id, actor)
        break
      case 'funded':
        platform.fund(v!.id, actor)
        break
      case 'in-port':
        platform.beginPortCall(v!.id, actor)
        break
      case 'sailed':
        platform.markSailed(v!.id, actor)
        break
      case 'fda-audited':
        platform.auditFda(v!.id, actor)
        break
      case 'invoiced':
        platform.invoice(v!.id, actor)
        break
      case 'settled':
        platform.settle(v!.id, actor)
        break
    }
  }

  const primaryLabel: Record<string, string> = {
    forwarded: 'Forward to sub-agent →',
    'pda-submitted': 'Submit PDA →',
    'pda-vetted': 'Vet PDA against tariffs →',
    'pda-approved': 'Approve PDA →',
    funded: 'Confirm 100% pre-funding →',
    advanced: 'Release operational advance →',
    'in-port': 'Begin port call →',
    sailed: 'Mark vessel sailed →',
    'fda-submitted': 'Submit FDA →',
    'fda-audited': 'Audit FDA line-by-line →',
    invoiced: 'Issue unified FDA invoice →',
    settled: 'Settle & archive voyage →',
  }

  return (
    <div className="stack">
      <PageHeader
        title={`${v.vessel}`}
        subtitle={`${v.vesselType} · IMO ${v.imo} · GT ${v.gt.toLocaleString()} · ${v.port}, ${v.country}`}
        action={<Badge label={stageMeta[v.stage].label} />}
      />

      <Link className="link" to="/voyages">
        ← All voyages
      </Link>

      {/* Snapshot */}
      <Card>
        <div className="cd-grid">
          <div>
            <span className="cd-label">Voyage ID</span>
            <strong className="mono">{v.id}</strong>
          </div>
          <div>
            <span className="cd-label">Cargo</span>
            <strong>{v.cargo}</strong>
          </div>
          <div>
            <span className="cd-label">ETA → ETD</span>
            <strong>{v.eta} → {v.etd}</strong>
          </div>
          <div>
            <span className="cd-label">Principal</span>
            <strong>{principal?.company ?? '—'}</strong>
          </div>
          <div>
            <span className="cd-label">Sub-agent</span>
            <strong>{subAgent?.company ?? 'Not yet assigned'}</strong>
          </div>
          <div>
            <span className="cd-label">Hub Manager (SPOC)</span>
            <strong>{v.hubManager}</strong>
          </div>
        </div>
      </Card>

      <PhaseStrip stage={v.stage} />

      <div className="two-col">
        {/* Action panel */}
        <Card>
          <div className="section-title">Next step</div>
          {next ? (
            <>
              <p className="page-sub" style={{ marginTop: 0 }}>
                <strong>{stageMeta[next].label}.</strong> {stageMeta[next].short}
              </p>
              <p className="muted-text">
                Responsible party: <strong>{requiredActor}</strong>
              </p>
              {onBehalf && (
                <div className="banner-info" style={{ marginBottom: 12 }}>
                  You are the Hub Manager acting on behalf of the {requiredActor} for this demo step.
                </div>
              )}
              {canAct ? (
                <button className="btn btn-primary" onClick={runPrimary}>
                  {primaryLabel[next]}
                </button>
              ) : (
                <div className="banner-info">
                  Waiting on the <strong>{requiredActor}</strong>. Sign in as that party to advance.
                </div>
              )}
            </>
          ) : (
            <div className="banner banner-good">✓ Voyage settled and archived. Nothing left to do.</div>
          )}

          {/* FDA SLA countdown once the vessel has sailed */}
          {fdaPending && sla && (
            <div
              className={`banner ${sla.daysLeft < 0 ? 'banner-bad' : sla.daysLeft <= 7 ? 'banner-warn' : 'banner-info'}`}
              style={{ marginTop: 12 }}
            >
              ⏱ FDA due by <strong>{sla.dueDate}</strong> ·{' '}
              {sla.daysLeft < 0
                ? `${-sla.daysLeft} day${sla.daysLeft === -1 ? '' : 's'} overdue`
                : `${sla.daysLeft} day${sla.daysLeft === 1 ? '' : 's'} remaining`}{' '}
              (SLA: 30 days from sailing)
            </div>
          )}

          {/* Live SoF logging while in port */}
          {v.stage === 'in-port' && (role === 'Sub-Agent' || role === 'Hub Manager') && (
            <div style={{ marginTop: 18 }}>
              <div className="section-title">Log a Statement of Facts event</div>
              <div className="chips">
                {SOF_LABELS.map((label) => (
                  <button key={label} className="chip" onClick={() => platform.addSof(v.id, label, actor)}>
                    + {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Financial summary */}
        <Card>
          <div className="section-title">Financial position</div>
          <table className="table">
            <tbody>
              <tr>
                <td>Proforma DA (PDA)</td>
                <td className="mono" style={{ textAlign: 'right' }}>{usd(pTotal)}</td>
              </tr>
              <tr>
                <td>Final DA (FDA)</td>
                <td className="mono" style={{ textAlign: 'right' }}>{hasFinal ? usd(fTotal) : '—'}</td>
              </tr>
              <tr>
                <td>Remit to sub-agent <span className="muted-text">(90%)</span></td>
                <td className="mono" style={{ textAlign: 'right' }}>{usd(remit)}</td>
              </tr>
              <tr>
                <td>AusGlobal retains <span className="muted-text">(margin)</span></td>
                <td className="mono" style={{ textAlign: 'right' }}><strong>{usd(margin)}</strong></td>
              </tr>
              <tr>
                <td>Funded into hub account</td>
                <td className="mono" style={{ textAlign: 'right' }}>{usd(bal.funded)}</td>
              </tr>
              <tr>
                <td>Advanced to sub-agent</td>
                <td className="mono" style={{ textAlign: 'right' }}>{usd(bal.advanced)}</td>
              </tr>
              <tr>
                <td>Capital held by hub</td>
                <td className="mono" style={{ textAlign: 'right' }}>{usd(bal.held)}</td>
              </tr>
              {hasFinal && (
                <tr>
                  <td><strong>{delta >= 0 ? 'Refund / credit due' : 'Additional billing'}</strong></td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    <strong className={delta >= 0 ? 'var-down' : 'var-up'}>{usd(Math.abs(delta))}</strong>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Disbursement account */}
      <Card>
        <div className="card-head">
          <div className="section-title">Disbursement account · standardised Port DA</div>
          <span className="muted-text">Values flagged in red exceed the pre-agreed port tariff cap (EDI validation)</span>
        </div>
        {v.daLines.length === 0 ? (
          <p className="muted-text">No PDA submitted yet. The sub-agent submits the proforma once the appointment is forwarded.</p>
        ) : (
          <table className="table da-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Description</th>
                <th className="num" style={{ textAlign: 'right' }}>PDA est.</th>
                <th className="num" style={{ textAlign: 'right' }}>Tariff cap</th>
                <th className="num" style={{ textAlign: 'right' }}>FDA final</th>
                <th className="num" style={{ textAlign: 'right' }}>Variance</th>
              </tr>
            </thead>
            <tbody>
              {v.daLines.map((l) => {
                const variance = lineVariance(l)
                const over = isOverTariff(l)
                return (
                  <tr key={l.id}>
                    <td><strong>{l.category}</strong></td>
                    <td className="muted-text">{l.description}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{usd(l.proforma)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{l.tariffCap ? usd(l.tariffCap) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{l.final != null ? usd(l.final) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {l.tariffCap == null ? (
                        '—'
                      ) : (
                        <span className={over ? 'var-up' : 'var-down'}>
                          {over ? '▲ ' : '▼ '}
                          {usd(Math.abs(variance))}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}><strong>Total</strong></td>
                <td className="mono" style={{ textAlign: 'right' }}><strong>{usd(pTotal)}</strong></td>
                <td />
                <td className="mono" style={{ textAlign: 'right' }}><strong>{hasFinal ? usd(fTotal) : '—'}</strong></td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      <div className="two-col">
        {/* Statement of Facts */}
        <Card>
          <div className="section-title">Statement of Facts</div>
          {v.sof.length === 0 ? (
            <p className="muted-text">No events logged yet. Timestamps are recorded live during the port call.</p>
          ) : (
            <ul className="sof-timeline">
              {v.sof.map((e) => (
                <li key={e.id}>
                  <span className="sof-time mono">{e.at}</span>
                  <span className="sof-remark">{e.label}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Funding ledger */}
        <Card>
          <div className="section-title">Funding ledger</div>
          {v.ledger.length === 0 ? (
            <p className="muted-text">No movements yet. The principal funds 100% of the PDA into the hub account before any advance is released.</p>
          ) : (
            <ul className="mini-feed">
              {v.ledger.map((g) => (
                <li key={g.id}>
                  <span className={`dot dot-${g.kind === 'refund' ? 'onboarding' : 'port-call'}`} />
                  <div>
                    <strong>{usd(g.amount)} · {g.kind.replace(/-/g, ' ')}</strong>
                    <span className="mini-detail">{g.note}</span>
                    <span className="mini-meta">{g.at}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="two-col">
        {/* Documents */}
        <Card>
          <div className="card-head">
            <div className="section-title">Documents archived to {v.id}</div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() =>
                platform.addDocument(v.id, {
                  name: `upload-${v.documents.length + 1}.pdf`,
                  kind: 'Receipt',
                  uploadedBy: role,
                  size: '64 KB',
                })
              }
            >
              ⬆ Upload file
            </button>
          </div>
          {v.documents.length === 0 ? (
            <p className="muted-text">No documents yet.</p>
          ) : (
            <table className="table">
              <tbody>
                {v.documents.map((d) => (
                  <tr key={d.id}>
                    <td>📎 {d.name}</td>
                    <td><Badge label={d.kind} tone="info" /></td>
                    <td className="muted-text">{d.uploadedBy}</td>
                    <td className="muted-text mono">{d.at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* History */}
        <Card>
          <div className="section-title">Lifecycle history</div>
          <ul className="mini-feed">
            {[...v.history].reverse().map((h, i) => (
              <li key={i}>
                <span className="dot dot-discovery" />
                <div>
                  <strong>{stageMeta[h.stage].label}</strong>
                  <span className="mini-detail">{h.actor}</span>
                  <span className="mini-meta">{h.at}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {modal === 'forward' && (
        <ForwardModal voyageId={v.id} port={v.port} onClose={() => setModal(null)} />
      )}
      {modal === 'pda' && (
        <PdaModal
          voyageId={v.id}
          initial={defaultPdaLines(v.port, v.agencyFee)}
          actor={actor}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'advance' && (
        <AdvanceModal voyageId={v.id} suggested={Math.round(pTotal * 0.7)} actor={actor} onClose={() => setModal(null)} />
      )}
      {modal === 'fda' && (
        <FdaModal voyageId={v.id} lines={v.daLines} actor={actor} onClose={() => setModal(null)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

type Actor = { name: string; role: UserRole }

function ForwardModal({ voyageId, port, onClose }: { voyageId: string; port: string; onClose: () => void }) {
  const platform = usePlatform()
  const { user } = useAuth()
  const actor: Actor = { name: user?.name ?? 'Hub Desk', role: user?.role ?? 'Hub Manager' }
  const enlisted = platform.subAgents.filter((s) => s.status === 'enlisted')
  const local = enlisted.filter((s) => s.port === port)
  const options = local.length ? local : enlisted
  const [sel, setSel] = useState(options[0]?.id ?? '')

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Forward appointment to a sub-agent</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <p className="page-sub" style={{ marginTop: 0 }}>
          {local.length
            ? `Enlisted sub-agents serving ${port}:`
            : `No enlisted sub-agent in ${port} yet — choose any enlisted partner:`}
        </p>
        <div className="login-accounts-grid" style={{ marginBottom: 16 }}>
          {options.map((s) => (
            <button
              key={s.id}
              className={`account-chip${sel === s.id ? ' selected' : ''}`}
              onClick={() => setSel(s.id)}
              style={sel === s.id ? { borderColor: 'var(--navy-800)' } : undefined}
            >
              <span className="account-avatar">{s.countryCode}</span>
              <span className="account-meta">
                <strong>{s.company}</strong>
                <span>{s.port} · {s.responseHrs}h SLA · ★ {s.rating}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!sel}
            onClick={() => {
              platform.forward(voyageId, sel, actor)
              onClose()
            }}
          >
            Forward appointment
          </button>
        </div>
      </div>
    </div>
  )
}

function PdaModal({
  voyageId,
  initial,
  actor,
  onClose,
}: {
  voyageId: string
  initial: DALine[]
  actor: Actor
  onClose: () => void
}) {
  const platform = usePlatform()
  const [lines, setLines] = useState<DALine[]>(initial)

  function setProforma(id: string, value: number) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, proforma: value } : l)))
  }

  const total = useMemo(() => pdaTotal(lines), [lines])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Submit Proforma Disbursement Account</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <p className="page-sub" style={{ marginTop: 0 }}>
          Enter estimated port expenses in the standardised AusGlobal format. Lines over the tariff cap will be flagged for the hub.
        </p>
        <table className="table da-table">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num" style={{ textAlign: 'right' }}>Estimate (USD)</th>
              <th className="num" style={{ textAlign: 'right' }}>Cap</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td><strong>{l.category}</strong></td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    className="actual-input"
                    type="number"
                    value={l.proforma}
                    onChange={(e) => setProforma(l.id, Number(e.target.value))}
                  />
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {l.tariffCap ? (l.proforma > l.tariffCap ? <span className="var-up">{usd(l.tariffCap)}</span> : usd(l.tariffCap)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Total estimate</strong></td>
              <td className="mono" style={{ textAlign: 'right' }}><strong>{usd(total)}</strong></td>
              <td />
            </tr>
          </tfoot>
        </table>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              platform.submitPda(voyageId, lines, actor)
              onClose()
            }}
          >
            Submit PDA
          </button>
        </div>
      </div>
    </div>
  )
}

function AdvanceModal({
  voyageId,
  suggested,
  actor,
  onClose,
}: {
  voyageId: string
  suggested: number
  actor: Actor
  onClose: () => void
}) {
  const platform = usePlatform()
  const [amount, setAmount] = useState(suggested)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Release operational advance</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <p className="page-sub" style={{ marginTop: 0 }}>
          The hub holds the principal's capital and releases a matching advance so the sub-agent can pay
          port authorities — never the full sum up front.
        </p>
        <label className="full">
          Advance amount (USD)
          <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </label>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              platform.releaseAdvance(voyageId, amount, actor)
              onClose()
            }}
          >
            Release advance
          </button>
        </div>
      </div>
    </div>
  )
}

function FdaModal({
  voyageId,
  lines,
  actor,
  onClose,
}: {
  voyageId: string
  lines: DALine[]
  actor: Actor
  onClose: () => void
}) {
  const platform = usePlatform()
  const [finals, setFinals] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.final ?? l.proforma])),
  )
  const total = Object.values(finals).reduce((s, n) => s + n, 0)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Submit Final Disbursement Account</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <p className="page-sub" style={{ marginTop: 0 }}>
          Enter the actual amounts from the authority vouchers and receipts. The hub will audit every line
          against these figures.
        </p>
        <table className="table da-table">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num" style={{ textAlign: 'right' }}>PDA est.</th>
              <th className="num" style={{ textAlign: 'right' }}>Final (USD)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td><strong>{l.category}</strong></td>
                <td className="mono" style={{ textAlign: 'right' }}>{usd(l.proforma)}</td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    className="actual-input"
                    type="number"
                    value={finals[l.id]}
                    onChange={(e) => setFinals((f) => ({ ...f, [l.id]: Number(e.target.value) }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Final total</strong></td>
              <td />
              <td className="mono" style={{ textAlign: 'right' }}><strong>{usd(total)}</strong></td>
            </tr>
          </tfoot>
        </table>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              platform.submitFda(voyageId, finals, actor)
              onClose()
            }}
          >
            Submit FDA
          </button>
        </div>
      </div>
    </div>
  )
}
