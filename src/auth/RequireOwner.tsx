import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { getOwnerEmail, useAuth } from './AuthContext'

// Restricts a route to the workspace owner (the first account on this device).
export default function RequireOwner({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const owner = getOwnerEmail()
  const isOwner = !!user && !!owner && user.email.toLowerCase() === owner.toLowerCase()

  if (isOwner) return <>{children}</>

  return (
    <div className="stack">
      <div className="gate">
        <div className="gate-lock" aria-hidden>
          🛡️
        </div>
        <h1>Admin only</h1>
        <p className="gate-sub">
          The Users area is available to the workspace owner, which is the first account created on this
          device.
        </p>
        <div className="gate-actions">
          <Link className="btn btn-primary" to="/">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
