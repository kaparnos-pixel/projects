import { useState } from 'react'
import { Badge, Card, PageHeader } from '../components/ui'
import {
  currentSubscription,
  invoices,
  paymentMethod,
  plans,
  usage,
} from '../data/billing'
import type { PlanTier } from '../data/types'

function priceLabel(price: number | null): string {
  if (price === null) return 'Custom'
  if (price === 0) return 'Free'
  return `$${price}`
}

function limitLabel(value: number | null): string {
  return value === null ? '∞' : value.toLocaleString()
}

export default function Subscription() {
  const [activeTier, setActiveTier] = useState<PlanTier>(currentSubscription.tier)
  const [cycle, setCycle] = useState(currentSubscription.billingCycle)

  const currentPlan = plans.find((p) => p.tier === activeTier)!
  const order: PlanTier[] = ['starter', 'pro', 'enterprise']

  function changeLabel(tier: PlanTier): string {
    if (tier === activeTier) return 'Current plan'
    if (plans.find((p) => p.tier === tier)!.priceMonthly === null) return 'Contact sales'
    return order.indexOf(tier) > order.indexOf(activeTier) ? 'Upgrade' : 'Downgrade'
  }

  return (
    <div className="stack">
      <PageHeader
        title="Subscription & billing"
        subtitle="Manage your BEACON plan, monitor usage against limits, and review invoices."
        action={
          <div className="cycle-toggle">
            <button
              type="button"
              className={cycle === 'monthly' ? 'active' : ''}
              onClick={() => setCycle('monthly')}
            >
              Monthly
            </button>
            <button
              type="button"
              className={cycle === 'annual' ? 'active' : ''}
              onClick={() => setCycle('annual')}
            >
              Annual <span className="save-tag">−15%</span>
            </button>
          </div>
        }
      />

      {/* Current plan summary */}
      <Card className="sub-summary">
        <div className="sub-summary-main">
          <span className="cd-label">Current plan</span>
          <div className="sub-plan-row">
            <h2>{currentPlan.name}</h2>
            <Badge label={currentSubscription.status} />
          </div>
          <p className="muted-text">{currentPlan.blurb}</p>
        </div>
        <div className="sub-summary-meta">
          <div>
            <span className="cd-label">Price</span>
            <strong>
              {priceLabel(currentPlan.priceMonthly)}
              {currentPlan.priceMonthly ? <small> /{cycle === 'annual' ? 'yr*' : 'mo'}</small> : ''}
            </strong>
          </div>
          <div>
            <span className="cd-label">Renews on</span>
            <strong>{currentSubscription.renewsOn}</strong>
          </div>
          <div>
            <span className="cd-label">Billing cycle</span>
            <strong className="cap">{cycle}</strong>
          </div>
        </div>
      </Card>

      {/* Usage */}
      <section>
        <h2 className="section-title">Usage this period</h2>
        <div className="usage-grid">
          {usage.map((u) => {
            const pct = u.limit === null ? 0 : Math.min(100, Math.round((u.used / u.limit) * 100))
            const tone = pct >= 90 ? 'over' : pct >= 75 ? 'warn' : 'ok'
            return (
              <Card key={u.label} className="usage-card">
                <div className="usage-top">
                  <span>{u.label}</span>
                  <strong>
                    {u.used}
                    {u.unit && ` ${u.unit}`}
                    <span className="usage-limit">
                      {' '}
                      / {u.limit === null ? 'Unlimited' : `${u.limit}${u.unit ? ' ' + u.unit : ''}`}
                    </span>
                  </strong>
                </div>
                <div className="usage-bar">
                  <div className={`usage-fill usage-${tone}`} style={{ width: `${pct}%` }} />
                </div>
              </Card>
            )
          })}
        </div>
      </section>

      {/* Plans */}
      <section>
        <h2 className="section-title">Plans</h2>
        <div className="plans-grid">
          {plans.map((p) => (
            <Card
              key={p.tier}
              className={`plan-card${p.tier === activeTier ? ' is-current' : ''}${
                p.tier === 'pro' ? ' is-featured' : ''
              }`}
            >
              {p.tier === 'pro' && <span className="plan-ribbon">Most popular</span>}
              <h3>{p.name}</h3>
              <div className="plan-price">
                {priceLabel(p.priceMonthly)}
                {p.priceMonthly ? <span>/{cycle === 'annual' ? 'yr' : 'mo'}</span> : null}
              </div>
              <p className="plan-blurb">{p.blurb}</p>
              <ul className="plan-features">
                {p.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
              <div className="plan-limits mono">
                {limitLabel(p.limits.agents)} agents · {limitLabel(p.limits.portCallsPerMonth)} calls/mo ·{' '}
                {limitLabel(p.limits.seats)} seats
              </div>
              <button
                type="button"
                className={`btn ${p.tier === activeTier ? 'btn-soft' : 'btn-primary'} plan-btn`}
                disabled={p.tier === activeTier}
                onClick={() => setActiveTier(p.tier)}
              >
                {changeLabel(p.tier)}
              </button>
            </Card>
          ))}
        </div>
        {activeTier !== currentSubscription.tier && (
          <div className="banner banner-good plan-change-note">
            Plan change to <strong>{currentPlan.name}</strong> staged — it would take effect on your next
            renewal ({currentSubscription.renewsOn}). (Demo only — no charge is made.)
          </div>
        )}
      </section>

      {/* Payment + invoices */}
      <div className="two-col">
        <Card>
          <div className="card-head">
            <h2 className="section-title">Payment method</h2>
            <button className="link" type="button">
              Update
            </button>
          </div>
          <div className="pay-method">
            <div className="pay-card-visual">
              <span className="pay-brand">{paymentMethod.brand}</span>
              <span className="pay-number mono">•••• •••• •••• {paymentMethod.last4}</span>
              <div className="pay-foot">
                <span>{paymentMethod.holder}</span>
                <span>exp {paymentMethod.expiry}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="section-title">Billing history</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Period</th>
                <th>Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="mono">{inv.number}</td>
                  <td>{inv.period}</td>
                  <td>{inv.amount}</td>
                  <td>
                    <Badge label={inv.status} />
                  </td>
                  <td>
                    <button className="link" type="button">
                      PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <p className="audit-foot">* Annual billing applies a 15% discount versus the monthly rate.</p>
    </div>
  )
}
