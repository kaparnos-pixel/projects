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
