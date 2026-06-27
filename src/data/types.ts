// Domain model for the AusGlobal Ship Agent platform.
//
// AusGlobal is the HUB agent. Three parties transact on the platform:
//   - Principal  : ship owner / charterer / operator / ship-management company
//   - Hub        : AusGlobal (the HUB agent and operator of this platform)
//   - Sub-Agent  : a vetted local port agency that executes the port call
//
// Everything is organised around a Voyage (a single port call with a unique
// Voyage ID) that moves through the appointment -> PDA -> funding -> execution
// -> FDA -> settlement lifecycle described in the AusGlobal business model.

export type UserRole = 'Hub Manager' | 'Principal' | 'Sub-Agent'

export type PlanTier = 'starter' | 'pro' | 'enterprise'

// ---------------------------------------------------------------------------
// Voyage lifecycle
// ---------------------------------------------------------------------------

// The ordered lifecycle of a single port call. Each transition is performed by
// exactly one party, generates an auto-email and writes an audit entry.
export type VoyageStage =
  | 'appointed' //      Principal nominates AusGlobal for the port call
  | 'forwarded' //      Hub forwards the appointment to the local Sub-Agent
  | 'pda-submitted' //  Sub-Agent submits the Proforma Disbursement Account
  | 'pda-vetted' //     Hub experts vet the PDA against agreed tariffs
  | 'pda-approved' //   Principal approves the PDA
  | 'funded' //         Principal transfers 100% of estimated funds to the Hub
  | 'advanced' //       Hub releases a matching operational advance to Sub-Agent
  | 'in-port' //        Vessel alongside; Sub-Agent logs the Statement of Facts
  | 'sailed' //         Vessel sails; husbandry complete
  | 'fda-submitted' //  Sub-Agent submits the Final Disbursement Account
  | 'fda-audited' //    Hub auditors review the FDA line-by-line
  | 'invoiced' //       Hub issues a single unified FDA invoice to the Principal
  | 'settled' //        Balance refunded / credited; Voyage closed & archived

export const voyageStageOrder: VoyageStage[] = [
  'appointed',
  'forwarded',
  'pda-submitted',
  'pda-vetted',
  'pda-approved',
  'funded',
  'advanced',
  'in-port',
  'sailed',
  'fda-submitted',
  'fda-audited',
  'invoiced',
  'settled',
]

export type VoyagePhase = 'appointment' | 'funding' | 'execution' | 'settlement'

export interface StageMeta {
  stage: VoyageStage
  label: string
  phase: VoyagePhase
  actor: UserRole // who performs the transition *into* this stage
  short: string
}

// A disbursement-account line. The same line carries the proforma (PDA) estimate
// and, later, the final (FDA) actual, so variance can be audited line-by-line.
export interface DALine {
  id: string
  category: string // standardised Port DA category (pilotage, towage, dues...)
  description: string
  proforma: number // PDA estimate (USD)
  final?: number // FDA actual (USD), filled in at FDA stage
  tariffCap?: number // pre-agreed port tariff limit, used to flag overcharging
  currency: string
}

// A Statement of Facts event, logged in real time by the Sub-Agent.
export interface SofEvent {
  id: string
  label: string // ETA, NOR Tendered, All Fast, Cargo Commenced, Unberthed...
  at: string
}

export type LedgerKind =
  | 'principal-funding' // Principal funds 100% of PDA into the Hub account
  | 'advance' //          Hub releases an operational advance to the Sub-Agent
  | 'fda-invoice' //      Hub issues the unified FDA invoice to the Principal
  | 'refund' //           Hub refunds the unused PDA balance to the Principal

export interface LedgerEntry {
  id: string
  kind: LedgerKind
  amount: number
  currency: string
  at: string
  note: string
}

export interface DocItem {
  id: string
  name: string
  kind: string // PDA, FDA, Voucher, Customs, Receipt, SLA, Statement of Facts
  uploadedBy: UserRole
  at: string
  size: string
}

export interface VoyageHistory {
  stage: VoyageStage
  at: string
  actor: string
}

export interface Voyage {
  id: string // unique Voyage ID, e.g. AUS-2026-0042
  vessel: string
  imo: string
  vesselType: string
  gt: number // gross tonnage
  port: string
  country: string
  countryCode: string
  cargo: string
  principalId: string
  subAgentId: string | null
  hubManager: string // the SPOC Hub Manager assigned to the Principal
  stage: VoyageStage
  eta: string
  etd: string
  services: string[]
  agencyFee: number // negotiated fixed agency fee for this call (USD)
  daLines: DALine[]
  sof: SofEvent[]
  ledger: LedgerEntry[]
  documents: DocItem[]
  history: VoyageHistory[]
  createdAt: string
}

// ---------------------------------------------------------------------------
// Sub-Agent network (sourcing, vetting, SLA)
// ---------------------------------------------------------------------------

export type EnlistmentStatus = 'prospect' | 'vetting' | 'enlisted' | 'suspended'

export interface Compliance {
  trace: boolean // TRACE anti-bribery membership
  fcpa: boolean // FCPA alignment attested
  iso9001: boolean // ISO 9001 quality management
  financials: boolean // financial-stability check cleared
}

export interface SubAgent {
  id: string
  company: string
  contact: string
  email: string // AusGlobal-issued platform email ID
  port: string
  country: string
  countryCode: string
  status: EnlistmentStatus
  rating: number
  services: string[]
  compliance: Compliance
  slaSigned: boolean // signed the SLA / frame agreement
  responseHrs: number // contractual responsiveness benchmark
  portCalls: number
  since: string
  about: string
}

// ---------------------------------------------------------------------------
// Principals (ship owners / charterers / operators)
// ---------------------------------------------------------------------------

export type PrincipalType = 'Owner' | 'Charterer' | 'Operator' | 'Ship Manager'

export interface Principal {
  id: string
  company: string
  type: PrincipalType
  contact: string
  email: string // AusGlobal-issued platform email ID
  country: string
  fleet: number // vessels under management
  masterSla: boolean // signed the master SLA with AusGlobal
  feeStructure: string // negotiated standardised fee basis
  hubManager: string // dedicated single point of contact (SPOC)
  since: string
  about: string
}

// ---------------------------------------------------------------------------
// Tariffs (the standardised Port DA reference used for EDI validation)
// ---------------------------------------------------------------------------

export interface PortTariff {
  port: string
  category: string
  cap: number // per-call cap (USD) used to flag financial variances
}

// ---------------------------------------------------------------------------
// Contract templates / frame agreements held in the system
// ---------------------------------------------------------------------------

export interface ContractTemplate {
  id: string
  title: string
  audience: 'Sub-Agent' | 'Principal'
  version: string
  updated: string
  summary: string
  clauses: string[]
}

// ---------------------------------------------------------------------------
// Auto-generated mail (the platform emails on every input)
// ---------------------------------------------------------------------------

export interface MailMessage {
  id: string
  voyageId: string | null
  fromRole: UserRole
  from: string
  to: string
  subject: string
  body: string
  at: string
  trigger: string // the lifecycle action that generated this email
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

export type AuditCategory =
  | 'appointment'
  | 'pda'
  | 'funding'
  | 'execution'
  | 'fda'
  | 'settlement'
  | 'network'
  | 'security'

export interface AuditEntry {
  id: string
  at: string
  actor: string
  role: UserRole
  category: AuditCategory
  action: string
  detail: string
  voyageId: string | null
  hash: string
}

// ---------------------------------------------------------------------------
// Services portfolio
// ---------------------------------------------------------------------------

export interface ServiceCategory {
  key: string
  title: string
  icon: string
  blurb: string
  items: string[]
}

// ---------------------------------------------------------------------------
// Billing / subscription (SaaS layer)
// ---------------------------------------------------------------------------

export interface Plan {
  tier: PlanTier
  name: string
  priceMonthly: number | null // null = custom / contact sales
  blurb: string
  highlights: string[]
  limits: {
    voyagesPerMonth: number | null
    subAgents: number | null
    seats: number | null
  }
}

export interface UsageMetric {
  label: string
  used: number
  limit: number | null
  unit: string
}

export type InvoiceStatus = 'paid' | 'due' | 'failed'

export interface Invoice {
  id: string
  number: string
  date: string
  amount: string
  status: InvoiceStatus
  period: string
}

export interface PaymentMethod {
  brand: string
  last4: string
  expiry: string
  holder: string
}

export interface Subscription {
  tier: PlanTier
  status: 'active' | 'trialing' | 'past-due'
  billingCycle: 'monthly' | 'annual'
  renewsOn: string
  seatsUsed: number
}
