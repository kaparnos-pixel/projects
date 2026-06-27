import type { PlanTier } from '../data/types'

const tierOrder: PlanTier[] = ['starter', 'pro', 'enterprise']

export function tierRank(tier: PlanTier): number {
  return tierOrder.indexOf(tier)
}

export const tierName: Record<PlanTier, string> = {
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

// Short summary of what each workspace plan includes, shown on sign-up & billing.
export const planAccess: Record<PlanTier, string> = {
  starter: 'Core hub: voyages, sub-agent network & audit',
  pro: 'Everything in Starter + repository, benchmarking & priority SLA',
  enterprise: 'Unlimited voyages, premium compliance, SSO & data residency',
}
