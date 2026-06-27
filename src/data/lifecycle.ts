import type { StageMeta, UserRole, VoyagePhase, VoyageStage } from './types'
import { voyageStageOrder } from './types'

// Metadata for every lifecycle stage: which party drives the transition into it,
// which phase it belongs to, and human labels. This is the single source of
// truth the Voyage screen uses to decide who can advance a port call.
export const stageMeta: Record<VoyageStage, StageMeta> = {
  appointed: {
    stage: 'appointed',
    label: 'Appointed',
    phase: 'appointment',
    actor: 'Principal',
    short: 'Principal nominates AusGlobal for the port call.',
  },
  forwarded: {
    stage: 'forwarded',
    label: 'Forwarded to Sub-Agent',
    phase: 'appointment',
    actor: 'Hub Manager',
    short: 'Hub forwards vessel & cargo details to the local Sub-Agent.',
  },
  'pda-submitted': {
    stage: 'pda-submitted',
    label: 'PDA submitted',
    phase: 'appointment',
    actor: 'Sub-Agent',
    short: 'Sub-Agent submits the Proforma Disbursement Account.',
  },
  'pda-vetted': {
    stage: 'pda-vetted',
    label: 'PDA vetted',
    phase: 'appointment',
    actor: 'Hub Manager',
    short: 'Hub experts vet the PDA against pre-agreed tariffs.',
  },
  'pda-approved': {
    stage: 'pda-approved',
    label: 'PDA approved',
    phase: 'appointment',
    actor: 'Principal',
    short: 'Principal approves the proforma estimate.',
  },
  funded: {
    stage: 'funded',
    label: 'Funded',
    phase: 'funding',
    actor: 'Principal',
    short: 'Principal transfers 100% of estimated funds to the Hub account.',
  },
  advanced: {
    stage: 'advanced',
    label: 'Advance released',
    phase: 'funding',
    actor: 'Hub Manager',
    short: 'Hub releases a matching operational advance to the Sub-Agent.',
  },
  'in-port': {
    stage: 'in-port',
    label: 'In port',
    phase: 'execution',
    actor: 'Sub-Agent',
    short: 'Vessel alongside; Sub-Agent logs the Statement of Facts live.',
  },
  sailed: {
    stage: 'sailed',
    label: 'Sailed',
    phase: 'execution',
    actor: 'Sub-Agent',
    short: 'Vessel sails; husbandry services complete.',
  },
  'fda-submitted': {
    stage: 'fda-submitted',
    label: 'FDA submitted',
    phase: 'settlement',
    actor: 'Sub-Agent',
    short: 'Sub-Agent submits the Final Disbursement Account with vouchers.',
  },
  'fda-audited': {
    stage: 'fda-audited',
    label: 'FDA audited',
    phase: 'settlement',
    actor: 'Hub Manager',
    short: 'Hub auditors review every FDA line against the vouchers.',
  },
  invoiced: {
    stage: 'invoiced',
    label: 'Invoiced',
    phase: 'settlement',
    actor: 'Hub Manager',
    short: 'Hub issues a single unified FDA invoice to the Principal.',
  },
  settled: {
    stage: 'settled',
    label: 'Settled & archived',
    phase: 'settlement',
    actor: 'Hub Manager',
    short: 'Balance refunded or credited; Voyage closed and archived.',
  },
}

export const phaseMeta: Record<VoyagePhase, { label: string; icon: string; blurb: string }> = {
  appointment: {
    label: 'Appointment & PDA',
    icon: '📝',
    blurb: 'Nomination, sub-agent forwarding, proforma disbursement & approval.',
  },
  funding: {
    label: 'Funding & Pre-funding',
    icon: '🏦',
    blurb: 'Principal funds the Hub; the Hub holds capital and advances the agent.',
  },
  execution: {
    label: 'Port-call execution',
    icon: '⚓',
    blurb: 'Husbanding services with a live, timestamped Statement of Facts.',
  },
  settlement: {
    label: 'FDA, audit & settlement',
    icon: '🧾',
    blurb: 'Final disbursement, line-by-line audit, unified invoice & refund.',
  },
}

export function stageIndex(stage: VoyageStage): number {
  return voyageStageOrder.indexOf(stage)
}

// The stage that follows `stage`, or null when the voyage is settled.
export function nextStage(stage: VoyageStage): VoyageStage | null {
  const i = stageIndex(stage)
  return i >= 0 && i < voyageStageOrder.length - 1 ? voyageStageOrder[i + 1] : null
}

// Whether `role` is the party responsible for advancing a voyage out of `stage`.
export function canAdvance(stage: VoyageStage, role: UserRole): boolean {
  const next = nextStage(stage)
  if (!next) return false
  return stageMeta[next].actor === role
}

const phaseTone: Record<VoyagePhase, string> = {
  appointment: 'info',
  funding: 'warn',
  execution: 'info',
  settlement: 'good',
}

export function stageTone(stage: VoyageStage): string {
  if (stage === 'settled') return 'good'
  return phaseTone[stageMeta[stage].phase]
}
