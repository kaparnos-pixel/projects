import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getAccounts, useAuth } from '../auth/AuthContext'
import { planAccess, tierName } from '../auth/entitlements'
import { plans } from '../data/billing'
import type { PlanTier, UserRole } from '../data/types'

type Mode = 'signup' | 'signin' | 'reset'

const roles: UserRole[] = ['Hub Manager', 'Principal', 'Sub-Agent']

const accessSummary: Record<PlanTier, string> = planAccess

function priceLabel(price: number | null): string {
  if (price === null) return 'Custom'
  if (price === 0) return 'Free'
  return `$${price}/mo`
}

export default function Login() {
  const { login, register, resetPassword } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const accounts = useMemo(() => getAccounts(), [])
  const [mode, setMode] = useState<Mode>(accounts.length > 0 ? 'signin' : 'signup')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('Hub Manager')
  const [tier, setTier] = useState<PlanTier>('starter')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (mode === 'signup') {
      const r = register({ name, email, password, role, tier })
      r.ok ? navigate(from, { replace: true }) : setError(r.error)
    } else if (mode === 'signin') {
      const r = login(email, password)
      r.ok ? navigate(from, { replace: true }) : setError(r.error)
    } else {
      const r = resetPassword(email, password)
      if (r.ok) {
        setMode('signin')
        setPassword('')
        setNotice('Password updated. You can sign in now.')
      } else {
        setError(r.error)
      }
    }
  }

  function go(next: Mode) {
    setMode(next)
    setError('')
    setNotice('')
  }

  const titles: Record<Mode, string> = {
    signup: 'Create your account',
    signin: 'Welcome back',
    reset: 'Reset your password',
  }
  const subtitles: Record<Mode, string> = {
    signup: 'Pick your role and plan to get started on the AusGlobal hub.',
    signin: 'Sign in to your AusGlobal workspace.',
    reset: 'Enter your email and a new password.',
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <img src="/ausglobal.svg" alt="AusGlobal" width={44} height={44} />
          <div>
            <strong>AusGlobal</strong>
            <span>Ship Agency Hub</span>
          </div>
        </div>

        <h1 className="login-title">{titles[mode]}</h1>
        <p className="login-sub">{subtitles[mode]}</p>

        {mode === 'signin' && accounts.length > 0 && (
          <div className="login-accounts">
            <span className="login-accounts-label">Switch to an account on this device</span>
            <div className="login-accounts-grid">
              {accounts.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  className="account-chip"
                  onClick={() => {
                    setEmail(a.email)
                    setError('')
                  }}
                >
                  <span className="account-avatar">{a.initials}</span>
                  <span className="account-meta">
                    <strong>{a.name}</strong>
                    <span>{a.role}</span>
                  </span>
                  <span className={`tier-badge tier-${a.tier}`}>{tierName[a.tier]}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={submit} className="login-form">
          {mode === 'signup' && (
            <label>
              Full name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Mariner" autoComplete="name" required />
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
            {mode === 'reset' ? 'New password' : 'Password'}
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signin' ? '••••••••' : 'At least 6 characters'}
              required
            />
          </label>

          {mode === 'signup' && (
            <label>
              Your role
              <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                {roles.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
          )}

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

          {notice && <div className="login-notice">{notice}</div>}
          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn btn-primary login-submit">
            {mode === 'signup' ? 'Create account' : mode === 'signin' ? 'Sign in' : 'Reset password'}
          </button>
        </form>

        {mode === 'signin' && (
          <p className="login-switch">
            <button type="button" className="link-btn" onClick={() => go('reset')}>
              Forgot your password?
            </button>
          </p>
        )}

        <p className="login-switch">
          {mode === 'signup' ? (
            <>
              Already have an account?{' '}
              <button type="button" className="link-btn" onClick={() => go('signin')}>
                Sign in
              </button>
            </>
          ) : (
            <>
              New to AusGlobal?{' '}
              <button type="button" className="link-btn" onClick={() => go('signup')}>
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
