import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { plans } from '../data/billing'
import type { PlanTier } from '../data/types'

type Mode = 'signup' | 'signin'

const accessSummary: Record<PlanTier, string> = {
  starter: 'Agent Hub',
  pro: 'Agent Hub + Vendor Dock',
  enterprise: 'Everything, incl. PCM & Purser',
}

function priceLabel(price: number | null): string {
  if (price === null) return 'Custom'
  if (price === 0) return 'Free'
  return `$${price}/mo`
}

export default function Login() {
  const { login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [mode, setMode] = useState<Mode>('signup')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tier, setTier] = useState<PlanTier>('starter')
  const [error, setError] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const result =
      mode === 'signup' ? register({ name, email, password, tier }) : login(email, password)
    if (result.ok) navigate(from, { replace: true })
    else setError(result.error)
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <img src="/beacon.svg" alt="BEACON" width={44} height={44} />
          <div>
            <strong>BEACON</strong>
            <span>Agent Hub</span>
          </div>
        </div>

        <h1 className="login-title">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
        <p className="login-sub">
          {mode === 'signup'
            ? 'Pick a plan to get started. It sets which modules you can open.'
            : 'Sign in to your BEACON workspace.'}
        </p>

        <form onSubmit={submit} className="login-form">
          {mode === 'signup' && (
            <label>
              Full name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Mariner"
                autoComplete="name"
                required
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              autoComplete={mode === 'signup' ? 'email' : 'username'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
              required
            />
          </label>

          {mode === 'signup' && (
            <fieldset className="plan-pick">
              <legend>Choose your plan</legend>
              {plans.map((p) => (
                <button
                  type="button"
                  key={p.tier}
                  className={`plan-pick-row${tier === p.tier ? ' selected' : ''}`}
                  onClick={() => setTier(p.tier)}
                  aria-pressed={tier === p.tier}
                >
                  <span className="ppr-radio" aria-hidden />
                  <span className="ppr-main">
                    <span className="ppr-top">
                      <strong>{p.name}</strong>
                      {p.tier === 'pro' && <span className="ppr-pop">Popular</span>}
                    </span>
                    <span className="ppr-access">{accessSummary[p.tier]}</span>
                  </span>
                  <span className="ppr-price">{priceLabel(p.priceMonthly)}</span>
                </button>
              ))}
            </fieldset>
          )}

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn btn-primary login-submit">
            {mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="login-switch">
          {mode === 'signup' ? (
            <>
              Already have an account?{' '}
              <button type="button" className="link-btn" onClick={() => switchMode('signin')}>
                Sign in
              </button>
            </>
          ) : (
            <>
              New to BEACON?{' '}
              <button type="button" className="link-btn" onClick={() => switchMode('signup')}>
                Create an account
              </button>
            </>
          )}
        </p>
      </div>
      <p className="login-foot">
        This is a local demo. Accounts are stored in your browser only, with no real backend.
      </p>
    </div>
  )
}
