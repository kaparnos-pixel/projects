import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { canAccess, type Feature } from './entitlements'
import UpgradeGate from '../components/UpgradeGate'

// Gates a route by paid tier. If the current user's tier doesn't include the
// feature, the upgrade screen is shown instead of the module.
export default function RequireTier({ feature, children }: { feature: Feature; children: ReactNode }) {
  const { user } = useAuth()
  if (user && canAccess(user.tier, feature)) return <>{children}</>
  return <UpgradeGate feature={feature} />
}
