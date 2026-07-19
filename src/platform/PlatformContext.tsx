import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  AuditCategory,
  AuditEntry,
  DALine,
  DocItem,
  MailMessage,
  Principal,
  SubAgent,
  UserRole,
  Voyage,
  VoyageStage,
} from '../data/types'
import {
  seedAudit,
  seedMail,
  seedPrincipals,
  seedSubAgents,
  seedVoyages,
} from '../data/seed'
import { seedReports, reportTypeMeta, type Report } from '../data/reporting'
import { pdaTotal } from '../data/calc'

const HUB_MAIL = 'hub@ausglobal.com.au'
const STORE_KEY = 'ausglobal.platform.v1'

interface PlatformState {
  voyages: Voyage[]
  subAgents: SubAgent[]
  principals: Principal[]
  mail: MailMessage[]
  audit: AuditEntry[]
  reports: Report[]
}

interface Actor {
  name: string
  role: UserRole
}

export interface NewVoyageInput {
  vessel: string
  imo: string
  vesselType: string
  gt: number
  port: string
  country: string
  countryCode: string
  cargo: string
  principalId: string
  eta: string
  etd: string
  services: string[]
  agencyFee: number
}

interface PlatformValue extends PlatformState {
  // selectors
  voyage: (id: string) => Voyage | undefined
  subAgent: (id: string | null) => SubAgent | undefined
  principal: (id: string) => Principal | undefined
  // lifecycle actions
  appoint: (input: NewVoyageInput, actor: Actor) => string
  forward: (voyageId: string, subAgentId: string, actor: Actor) => void
  submitPda: (voyageId: string, lines: DALine[], actor: Actor) => void
  vetPda: (voyageId: string, actor: Actor) => void
  approvePda: (voyageId: string, actor: Actor) => void
  fund: (voyageId: string, actor: Actor) => void
  releaseAdvance: (voyageId: string, amount: number, actor: Actor) => void
  beginPortCall: (voyageId: string, actor: Actor) => void
  addSof: (voyageId: string, label: string, actor: Actor) => void
  markSailed: (voyageId: string, actor: Actor) => void
  submitFda: (voyageId: string, finals: Record<string, number>, actor: Actor) => void
  auditFda: (voyageId: string, actor: Actor) => void
  invoice: (voyageId: string, actor: Actor) => void
  settle: (voyageId: string, actor: Actor) => void
  addDocument: (voyageId: string, doc: Omit<DocItem, 'id' | 'at'>) => void
  // network actions
  updateSubAgent: (id: string, patch: Partial<SubAgent>) => void
  enlistSubAgent: (id: string, actor: Actor) => void
  // sub-agent reporting
  saveReport: (report: Report) => void
  deleteReport: (id: string) => void
  resetDemo: () => void
}

const PlatformContext = createContext<PlatformValue | null>(null)

function seedState(): PlatformState {
  return {
    voyages: structuredClone(seedVoyages),
    subAgents: structuredClone(seedSubAgents),
    principals: structuredClone(seedPrincipals),
    mail: structuredClone(seedMail),
    audit: structuredClone(seedAudit),
    reports: structuredClone(seedReports),
  }
}

function load(): PlatformState {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return seedState()
    const parsed = JSON.parse(raw) as Partial<PlatformState>
    // Merge missing top-level keys so state saved before a new field was added
    // (e.g. reports) still loads with sensible defaults instead of undefined.
    return { ...seedState(), ...parsed }
  } catch {
    return seedState()
  }
}

function now(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function hash(): string {
  return '0x' + Math.random().toString(16).slice(2, 8)
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlatformState>(() => load())

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(state))
  }, [state])

  const value = useMemo<PlatformValue>(() => {
    // Apply a transition to one voyage and emit the matching mail + audit entry.
    function transition(
      voyageId: string,
      to: VoyageStage,
      actor: Actor,
      opts: {
        mutate?: (v: Voyage) => Voyage
        category: AuditCategory
        action: string
        detail: string
        mail?: (v: Voyage, ps: Principal[], sas: SubAgent[]) => { from: string; to: string; subject: string; body: string }
      },
    ) {
      setState((s) => {
        const voyages = s.voyages.map((v) => {
          if (v.id !== voyageId) return v
          const base = opts.mutate ? opts.mutate(v) : v
          return {
            ...base,
            stage: to,
            history: [...base.history, { stage: to, at: now(), actor: `${actor.name} · ${actor.role}` }],
          }
        })
        const v = voyages.find((x) => x.id === voyageId)!
        const mailMsg = opts.mail?.(v, s.principals, s.subAgents)
        const newMail: MailMessage[] = mailMsg
          ? [
              {
                id: rid('m'),
                voyageId,
                fromRole: actor.role,
                from: mailMsg.from,
                to: mailMsg.to,
                subject: mailMsg.subject,
                body: mailMsg.body,
                at: now(),
                trigger: to,
              },
              ...s.mail,
            ]
          : s.mail
        const newAudit: AuditEntry[] = [
          {
            id: rid('a'),
            at: now(),
            actor: actor.name,
            role: actor.role,
            category: opts.category,
            action: opts.action,
            detail: opts.detail,
            voyageId,
            hash: hash(),
          },
          ...s.audit,
        ]
        return { ...s, voyages, mail: newMail, audit: newAudit }
      })
    }

    const findP = (ps: Principal[], id: string) => ps.find((p) => p.id === id)
    const findS = (sas: SubAgent[], id: string | null) => sas.find((sa) => sa.id === id)

    return {
      ...state,

      voyage: (id) => state.voyages.find((v) => v.id === id),
      subAgent: (id) => state.subAgents.find((s) => s.id === id),
      principal: (id) => state.principals.find((p) => p.id === id),

      appoint(input, actor) {
        const seq = state.voyages.length + 52
        const id = `AUS-2026-${String(seq).padStart(4, '0')}`
        const principal = state.principals.find((p) => p.id === input.principalId)
        const voyage: Voyage = {
          id,
          vessel: input.vessel,
          imo: input.imo,
          vesselType: input.vesselType,
          gt: input.gt,
          port: input.port,
          country: input.country,
          countryCode: input.countryCode,
          cargo: input.cargo,
          principalId: input.principalId,
          subAgentId: null,
          hubManager: principal?.hubManager ?? 'Liam Harper',
          stage: 'appointed',
          eta: input.eta,
          etd: input.etd,
          services: input.services,
          agencyFee: input.agencyFee,
          daLines: [],
          sof: [],
          ledger: [],
          documents: [],
          history: [{ stage: 'appointed', at: now(), actor: `${actor.name} · ${actor.role}` }],
          createdAt: now(),
        }
        setState((s) => ({
          ...s,
          voyages: [voyage, ...s.voyages],
          mail: [
            {
              id: rid('m'),
              voyageId: id,
              fromRole: actor.role,
              from: principal?.email ?? HUB_MAIL,
              to: HUB_MAIL,
              subject: `[${id}] Appointment · ${input.vessel} · ${input.port}`,
              body: `${principal?.company ?? 'The principal'} appoints AusGlobal as agent for ${input.vessel} at ${input.port} (ETA ${input.eta}). Cargo: ${input.cargo}.`,
              at: now(),
              trigger: 'appointment',
            },
            ...s.mail,
          ],
          audit: [
            {
              id: rid('a'),
              at: now(),
              actor: actor.name,
              role: actor.role,
              category: 'appointment',
              action: 'Voyage appointed',
              detail: `${input.vessel} at ${input.port} (${id})`,
              voyageId: id,
              hash: hash(),
            },
            ...s.audit,
          ],
        }))
        return id
      },

      forward(voyageId, subAgentId, actor) {
        transition(voyageId, 'forwarded', actor, {
          mutate: (v) => ({ ...v, subAgentId }),
          category: 'appointment',
          action: 'Appointment forwarded',
          detail: `Forwarded to sub-agent for ${voyageId}`,
          mail: (v, _ps, sas) => {
            const sa = findS(sas, subAgentId)
            return {
              from: HUB_MAIL,
              to: sa?.email ?? HUB_MAIL,
              subject: `[${v.id}] Appointment · ${v.vessel} · ${v.port}`,
              body: `AusGlobal Hub forwards the appointment for ${v.vessel} (${v.vesselType}, GT ${v.gt}) at ${v.port}. ETA ${v.eta}. Please prepare and submit the PDA. Services: ${v.services.join(', ')}.`,
            }
          },
        })
      },

      submitPda(voyageId, lines, actor) {
        transition(voyageId, 'pda-submitted', actor, {
          mutate: (v) => ({ ...v, daLines: lines }),
          category: 'pda',
          action: 'PDA submitted',
          detail: `Proforma ${pdaTotal(lines).toLocaleString()} for ${voyageId}`,
          mail: (v) => ({
            from: findS(state.subAgents, v.subAgentId)?.email ?? HUB_MAIL,
            to: HUB_MAIL,
            subject: `[${v.id}] PDA submitted · ${v.vessel} · ${v.port}`,
            body: `Proforma Disbursement Account submitted for ${v.vessel}. Estimated total USD ${pdaTotal(lines).toLocaleString()} across ${lines.length} line items.`,
          }),
        })
      },

      vetPda(voyageId, actor) {
        transition(voyageId, 'pda-vetted', actor, {
          category: 'pda',
          action: 'PDA vetted',
          detail: `Hub vetted the PDA for ${voyageId}`,
          mail: (v, ps) => ({
            from: HUB_MAIL,
            to: findP(ps, v.principalId)?.email ?? HUB_MAIL,
            subject: `[${v.id}] PDA vetted & ready for approval · ${v.vessel}`,
            body: `The PDA for ${v.vessel} at ${v.port} has been vetted against pre-agreed port tariffs. Total USD ${pdaTotal(v.daLines).toLocaleString()}. Please review and approve.`,
          }),
        })
      },

      approvePda(voyageId, actor) {
        transition(voyageId, 'pda-approved', actor, {
          category: 'pda',
          action: 'PDA approved',
          detail: `Principal approved the PDA for ${voyageId}`,
          mail: (v, ps) => ({
            from: findP(ps, v.principalId)?.email ?? HUB_MAIL,
            to: HUB_MAIL,
            subject: `[${v.id}] PDA approved · ${v.vessel}`,
            body: `The proforma for ${v.vessel} is approved. We will arrange 100% pre-funding to the hub account.`,
          }),
        })
      },

      fund(voyageId, actor) {
        transition(voyageId, 'funded', actor, {
          mutate: (v) => ({
            ...v,
            ledger: [
              ...v.ledger,
              {
                id: rid('g'),
                kind: 'principal-funding',
                amount: pdaTotal(v.daLines),
                currency: 'USD',
                at: now(),
                note: '100% PDA pre-funding received into hub account',
              },
            ],
          }),
          category: 'funding',
          action: 'PDA pre-funding received',
          detail: `USD ${pdaTotal(state.voyages.find((v) => v.id === voyageId)?.daLines ?? []).toLocaleString()} funded for ${voyageId}`,
          mail: (v, ps) => ({
            from: findP(ps, v.principalId)?.email ?? HUB_MAIL,
            to: HUB_MAIL,
            subject: `[${v.id}] Funds transferred · ${v.vessel}`,
            body: `100% pre-funding of USD ${pdaTotal(v.daLines).toLocaleString()} transferred to the AusGlobal hub account for ${v.vessel}. Please proceed.`,
          }),
        })
      },

      releaseAdvance(voyageId, amount, actor) {
        transition(voyageId, 'advanced', actor, {
          mutate: (v) => ({
            ...v,
            ledger: [
              ...v.ledger,
              {
                id: rid('g'),
                kind: 'advance',
                amount,
                currency: 'USD',
                at: now(),
                note: 'Operational advance released to sub-agent for authority payments',
              },
            ],
          }),
          category: 'funding',
          action: 'Operational advance released',
          detail: `USD ${amount.toLocaleString()} advance for ${voyageId}`,
          mail: (v, _ps, sas) => ({
            from: HUB_MAIL,
            to: findS(sas, v.subAgentId)?.email ?? HUB_MAIL,
            subject: `[${v.id}] Operational advance released · ${v.vessel}`,
            body: `An operational advance of USD ${amount.toLocaleString()} has been released for ${v.vessel}. Settle port authority charges and retain all receipts for the FDA.`,
          }),
        })
      },

      beginPortCall(voyageId, actor) {
        transition(voyageId, 'in-port', actor, {
          mutate: (v) =>
            v.sof.length
              ? v
              : { ...v, sof: [{ id: rid('s'), label: 'ETA / Arrival pilot station', at: now() }] },
          category: 'execution',
          action: 'Port call commenced',
          detail: `Vessel arrived for ${voyageId}`,
          mail: (v) => ({
            from: findS(state.subAgents, v.subAgentId)?.email ?? HUB_MAIL,
            to: HUB_MAIL,
            subject: `[${v.id}] Vessel arrived · ${v.vessel}`,
            body: `${v.vessel} has arrived at ${v.port}. Statement of Facts logging has started.`,
          }),
        })
      },

      addSof(voyageId, label, _actor) {
        setState((s) => ({
          ...s,
          voyages: s.voyages.map((v) =>
            v.id === voyageId
              ? { ...v, sof: [...v.sof, { id: rid('s'), label, at: now() }] }
              : v,
          ),
        }))
      },

      markSailed(voyageId, actor) {
        transition(voyageId, 'sailed', actor, {
          mutate: (v) => ({ ...v, sof: [...v.sof, { id: rid('s'), label: 'Unberthed / Sailed', at: now() }] }),
          category: 'execution',
          action: 'Vessel sailed',
          detail: `Vessel sailed for ${voyageId}`,
          mail: (v) => ({
            from: findS(state.subAgents, v.subAgentId)?.email ?? HUB_MAIL,
            to: HUB_MAIL,
            subject: `[${v.id}] Vessel sailed · ${v.vessel}`,
            body: `${v.vessel} has sailed from ${v.port}. We will compile vouchers and submit the FDA within the SLA window.`,
          }),
        })
      },

      submitFda(voyageId, finals, actor) {
        transition(voyageId, 'fda-submitted', actor, {
          mutate: (v) => ({
            ...v,
            daLines: v.daLines.map((l) => ({ ...l, final: finals[l.id] ?? l.final ?? l.proforma })),
          }),
          category: 'fda',
          action: 'FDA submitted',
          detail: `Final disbursement submitted for ${voyageId}`,
          mail: (v) => ({
            from: findS(state.subAgents, v.subAgentId)?.email ?? HUB_MAIL,
            to: HUB_MAIL,
            subject: `[${v.id}] FDA submitted · ${v.vessel}`,
            body: `Final Disbursement Account submitted for ${v.vessel} with supporting authority vouchers. Ready for line-by-line audit.`,
          }),
        })
      },

      auditFda(voyageId, actor) {
        transition(voyageId, 'fda-audited', actor, {
          category: 'fda',
          action: 'FDA audited',
          detail: `Hub auditors reviewed the FDA for ${voyageId}`,
          mail: (v) => ({
            from: HUB_MAIL,
            to: HUB_MAIL,
            subject: `[${v.id}] FDA audited · ${v.vessel}`,
            body: `FDA for ${v.vessel} audited line-by-line against vouchers and pre-negotiated port scales.`,
          }),
        })
      },

      invoice(voyageId, actor) {
        transition(voyageId, 'invoiced', actor, {
          mutate: (v) => {
            const final = v.daLines.reduce((sum, l) => sum + (l.final ?? l.proforma), 0)
            return {
              ...v,
              ledger: [
                ...v.ledger,
                {
                  id: rid('g'),
                  kind: 'fda-invoice',
                  amount: final,
                  currency: 'USD',
                  at: now(),
                  note: 'Unified FDA invoice issued to the principal',
                },
              ],
            }
          },
          category: 'settlement',
          action: 'Unified FDA invoice issued',
          detail: `Single FDA invoice issued for ${voyageId}`,
          mail: (v, ps) => {
            const final = v.daLines.reduce((sum, l) => sum + (l.final ?? l.proforma), 0)
            return {
              from: HUB_MAIL,
              to: findP(ps, v.principalId)?.email ?? HUB_MAIL,
              subject: `[${v.id}] Unified FDA invoice · ${v.vessel}`,
              body: `A single, unified FDA invoice of USD ${final.toLocaleString()} has been issued for ${v.vessel}. Any pre-funded balance will be refunded or credited to your next voyage.`,
            }
          },
        })
      },

      settle(voyageId, actor) {
        transition(voyageId, 'settled', actor, {
          mutate: (v) => {
            const proforma = v.daLines.reduce((sum, l) => sum + l.proforma, 0)
            const final = v.daLines.reduce((sum, l) => sum + (l.final ?? l.proforma), 0)
            const delta = proforma - final // positive = under-spend to refund
            return {
              ...v,
              ledger: [
                ...v.ledger,
                {
                  id: rid('g'),
                  kind: 'refund',
                  amount: delta,
                  currency: 'USD',
                  at: now(),
                  note:
                    delta >= 0
                      ? 'Unused PDA balance refunded / credited to next voyage'
                      : 'Additional balance billed to principal',
                },
              ],
            }
          },
          category: 'settlement',
          action: 'Voyage settled & archived',
          detail: `Balance reconciled and Voyage closed for ${voyageId}`,
          mail: (v, ps) => ({
            from: HUB_MAIL,
            to: findP(ps, v.principalId)?.email ?? HUB_MAIL,
            subject: `[${v.id}] Settled & archived · ${v.vessel}`,
            body: `${v.vessel} at ${v.port} is fully settled. All receipts are archived against Voyage ID ${v.id} for audit and future reference.`,
          }),
        })
      },

      addDocument(voyageId, doc) {
        setState((s) => ({
          ...s,
          voyages: s.voyages.map((v) =>
            v.id === voyageId
              ? { ...v, documents: [...v.documents, { ...doc, id: rid('d'), at: now() }] }
              : v,
          ),
        }))
      },

      updateSubAgent(id, patch) {
        setState((s) => ({
          ...s,
          subAgents: s.subAgents.map((sa) => (sa.id === id ? { ...sa, ...patch } : sa)),
        }))
      },

      enlistSubAgent(id, actor) {
        setState((s) => {
          const sa = s.subAgents.find((x) => x.id === id)
          return {
            ...s,
            subAgents: s.subAgents.map((x) =>
              x.id === id ? { ...x, status: 'enlisted', slaSigned: true } : x,
            ),
            audit: [
              {
                id: rid('a'),
                at: now(),
                actor: actor.name,
                role: actor.role,
                category: 'network',
                action: 'Sub-agent enlisted',
                detail: `${sa?.company ?? id} signed the SLA / frame agreement`,
                voyageId: null,
                hash: hash(),
              },
              ...s.audit,
            ],
          }
        })
      },

      saveReport(report) {
        setState((s) => {
          const exists = s.reports.some((r) => r.id === report.id)
          const reports = exists
            ? s.reports.map((r) => (r.id === report.id ? report : r))
            : [report, ...s.reports]
          // Submitting a report writes an audit entry, keeping the transparent
          // record the model promises to all three parties.
          let audit = s.audit
          if (report.submitted && !(exists && s.reports.find((r) => r.id === report.id)?.submitted)) {
            const sa = s.subAgents.find((x) => x.id === report.subAgentId)
            audit = [
              {
                id: rid('a'),
                at: now(),
                actor: sa?.contact ?? 'Sub-Agent',
                role: 'Sub-Agent',
                category: 'execution',
                action: `${reportTypeMeta[report.type].label} report submitted`,
                detail: `${report.vessel} · ${report.port} (${report.jobCode || 'no job code'})`,
                voyageId: report.jobCode || null,
                hash: hash(),
              },
              ...s.audit,
            ]
          }
          return { ...s, reports, audit }
        })
      },

      deleteReport(id) {
        setState((s) => ({ ...s, reports: s.reports.filter((r) => r.id !== id) }))
      },

      resetDemo() {
        const fresh = seedState()
        setState(fresh)
      },
    }
  }, [state])

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>
}

export function usePlatform(): PlatformValue {
  const ctx = useContext(PlatformContext)
  if (!ctx) throw new Error('usePlatform must be used within PlatformProvider')
  return ctx
}

export { HUB_MAIL }
