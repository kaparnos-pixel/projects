import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { demoUsers, useAuth } from '../auth/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const result = login(email, password)
    if (result.ok) navigate(from, { replace: true })
    else setError(result.error)
  }

  function quickFill(userEmail: string) {
    setEmail(userEmail)
    setPassword('demo1234')
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

        <h1 className="login-title">Sign in</h1>
        <p className="login-sub">Agent Hub. The appointment side of how the world runs a port call.</p>

        <form onSubmit={submit} className="login-form">
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn btn-primary login-submit">
            Sign in
          </button>
        </form>

        <div className="login-demo">
          <span className="login-demo-label">Demo accounts. Click one to fill it in (password: demo1234)</span>
          <div className="login-demo-grid">
            {demoUsers.map((u) => (
              <button key={u.email} type="button" className="login-demo-btn" onClick={() => quickFill(u.email)}>
                <strong>{u.role}</strong>
                <span>{u.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="login-foot">This is mock sign-in for the demo. There's no real backend behind it.</p>
    </div>
  )
}
