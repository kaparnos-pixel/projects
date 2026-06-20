// Domain model for the BEACON Agent Hub portal.

export type UserRole =
  | 'Operator'
  | 'Charterer'
  | 'Fleet Manager'
  | 'Port-Ops'

export type AgentStatus = 'verified' | 'onboarding' | 'invited'

export interface Agent {
  id: string
  name: string
  company: string
  port: string
  country: string
  countryCode: string
  services: string[]
  status: AgentStatus
  rating: number
  responseTimeMins: number
  portCalls: number
  verified: boolean
  since: string
  about: string
}

export type OnboardingStepStatus = 'done' | 'active' | 'pending'

export interface OnboardingStep {
  id: string
  title: string
  description: string
  status: OnboardingStepStatus
}

export interface ChatMessage {
  id: string
  author: string
  role: UserRole | 'Agent'
  body: string
  time: string
  self?: boolean
}

export interface Conversation {
  id: string
  agentId: string
  agentName: string
  subject: string
  vessel: string
  unread: number
  lastActivity: string
  encrypted: boolean
  messages: ChatMessage[]
}

export type ContractStatus =
  | 'draft'
  | 'in-negotiation'
  | 'pending-signature'
  | 'executed'
  | 'archived'

export interface ContractRevision {
  version: string
  author: string
  date: string
  note: string
}

export interface Contract {
  id: string
  title: string
  agentName: string
  vessel: string
  port: string
  value: string
  status: ContractStatus
  updated: string
  revisions: ContractRevision[]
}

export type PortCallStage =
  | 'nominated'
  | 'pre-arrival'
  | 'alongside'
  | 'operations'
  | 'departed'

export interface PortCall {
  id: string
  vessel: string
  imo: string
  port: string
  berth: string
  agent: string
  eta: string
  etd: string
  stage: PortCallStage
  cargo: string
}

export type PlanTier = 'starter' | 'pro' | 'enterprise'

export interface Plan {
  tier: PlanTier
  name: string
  priceMonthly: number | null // null = custom / contact sales
  blurb: string
  highlights: string[]
  limits: {
    agents: number | null // null = unlimited
    portCallsPerMonth: number | null
    seats: number | null
  }
}

export interface UsageMetric {
  label: string
  used: number
  limit: number | null // null = unlimited
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

export type AuditCategory =
  | 'discovery'
  | 'onboarding'
  | 'chat'
  | 'contract'
  | 'port-call'
  | 'security'

export interface AuditEntry {
  id: string
  time: string
  actor: string
  role: UserRole
  category: AuditCategory
  action: string
  detail: string
  hash: string
}
