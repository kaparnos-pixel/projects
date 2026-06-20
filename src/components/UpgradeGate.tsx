import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { featureLabel, featureMinTier, tierName, type Feature } from '../auth/entitlements'
import { plans } from '../data/billing'

// Shown in place of a module the current tier can't access.
export default function UpgradeGate({ feature }: { feature: Feature }) {
  const { user, setTier } = useAuth()
  const required = featureMinTier[feature]
  const plan = plans.find((p) => p.tier === required)

  return (
    <div className="stack">
      <div className="gate">
        <div className="gate-lock" aria-hidden>
          🔒
        </div>
        <span className="gate-kicker">{tierName[required]} plan</span>
        <h1>{featureLabel[feature]} is locked on your plan</h1>
        <p className="gate-sub">
          You're on <strong>{tierName[user?.tier ?? 'starter']}</strong>. Upgrade to{' '}
          <strong>{tierName[required]}</strong> to unlock {featureLabel[feature]} and everything it
          includes.
        </p>

        {plan && (
          <ul className="gate-features">
            {plan.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}

        <div className="gate-actions">
          <button className="btn btn-primary" onClick={() => setTier(required)}>
            Upgrade to {tierName[required]}
          </button>
          <Link className="btn btn-ghost" to="/subscription">
            Compare plans
          </Link>
        </div>
        <p className="gate-fine">This is a demo, so upgrading is instant and nothing is charged.</p>
      </div>
    </div>
  )
}
