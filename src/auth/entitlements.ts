import type { PlanTier } from '../data/types'

// Feature groups that the portal gates by paid tier.
export type Feature = 'agent-hub' | 'vendor-dock' | 'pcm' | 'purser' | 'account'

const tierOrder: PlanTier[] = ['starter', 'pro', 'enterprise']

export function tierRank(tier: PlanTier): number {
  return tierOrder.indexOf(tier)
}

// Lowest tier that includes each feature.
export const featureMinTier: Record<Feature, PlanTier> = {
  'agent-hub': 'starter',
  account: 'starter',
  'vendor-dock': 'pro',
  pcm: 'enterprise',
  purser: 'enterprise',
}

export const featureLabel: Record<Feature, string> = {
  'agent-hub': 'Agent Hub',
  'vendor-dock': 'Vendor Dock',
  pcm: 'Port Cost Management',
  purser: 'Purser',
  account: 'Account',
}

export const tierName: Record<PlanTier, string> = {
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

export function canAccess(tier: PlanTier, feature: Feature): boolean {
  return tierRank(tier) >= tierRank(featureMinTier[feature])
}
