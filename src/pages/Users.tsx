import { useState } from 'react'
import { Card, PageHeader } from '../components/ui'
import { getAccounts, getOwnerEmail, useAuth, type AccountSummary } from '../auth/AuthContext'
import { tierName } from '../auth/entitlements'
import type { PlanTier } from '../data/types'

const tiers: PlanTier[] = ['starter', 'pro', 'enterprise']

export default function Users() {
  const { user, adminSetTier, adminSetPassword, adminDeleteUser } = useAuth()
  const [accounts, setAccounts] = useState<AccountSummary[]>(() => getAccounts())
  const [notice, setNotice] = useState('')

  const ownerEmail = getOwnerEmail()
  const refresh = () => setAccounts(getAccounts())

  function changeTier(email: string, tier: PlanTier) {
    adminSetTier(email, tier)
    refresh()
    setNotice(`Updated ${email} to ${tierName[tier]}.`)
  }

  function resetPw(email: string) {
    const pw = window.prompt(`Set a new password for ${email} (min 6 characters):`)
    if (pw == null) return
    const r = adminSetPassword(email, pw)
    setNotice(r.ok ? `Password reset for ${email}.` : r.error)
  }

  function remove(email: string) {
    const self = user?.email.toLowerCase() === email.toLowerCase()
    const msg = self
      ? 'Delete your own account? You will be signed out.'
      : `Delete the account for ${email}?`
    if (!window.confirm(msg)) return
    adminDeleteUser(email)
    refresh()
  }

  return (
    <div className="stack">
      <PageHeader
        title="Users"
        subtitle="Every account created in this workspace on this device. Change a plan, reset a password, or remove an account."
        action={<span className="pill-count">{accounts.length} accounts</span>}
      />

      {notice && <div className="banner banner-good">{notice}</div>}

      <Card>
        <table className="table users-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Plan</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const isOwner = ownerEmail?.toLowerCase() === a.email.toLowerCase()
              const isSelf = user?.email.toLowerCase() === a.email.toLowerCase()
              return (
                <tr key={a.email}>
                  <td>
                    <div className="user-cell">
                      <span className="account-avatar">{a.initials}</span>
                      <div>
                        <strong>
                          {a.name}
                          {isOwner && <span className="owner-tag">Owner</span>}
                          {isSelf && !isOwner && <span className="you-tag">You</span>}
                        </strong>
                        <span className="mini-meta">{a.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>{a.role}</td>
                  <td>
                    <select
                      className="tier-select"
                      value={a.tier}
                      onChange={(e) => changeTier(a.email, e.target.value as PlanTier)}
                    >
                      {tiers.map((t) => (
                        <option key={t} value={t}>
                          {tierName[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => resetPw(a.email)}>
                        Reset password
                      </button>
                      <button className="btn btn-ghost btn-sm danger" onClick={() => remove(a.email)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <div className="empty">No accounts yet.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <p className="audit-foot">
        🔒 Accounts live in this browser only (local demo). The first account created is the workspace
        owner and the only one who can open this page.
      </p>
    </div>
  )
}
