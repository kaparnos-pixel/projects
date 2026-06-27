import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { getOwnerEmail, useAuth } from '../auth/AuthContext'
import { tierName } from '../auth/entitlements'
import { usePlatform } from '../platform/PlatformContext'
import type { UserRole } from '../data/types'

interface NavItem {
  to: string
  label: string
  icon: string
  end?: boolean
  roles?: UserRole[] // if set, only these roles see the item
}

interface NavGroup {
  title: string | null
  items: NavItem[]
  ownerOnly?: boolean
}

const navGroups: NavGroup[] = [
  { title: null, items: [{ to: '/', label: 'Dashboard', icon: '🛰️', end: true }] },
  {
    title: 'Operations',
    items: [
      { to: '/voyages', label: 'Voyages', icon: '⚓' },
      { to: '/inbox', label: 'Inbox', icon: '✉️' },
      { to: '/repository', label: 'Repository', icon: '🗄️' },
      { to: '/audit', label: 'Audit trail', icon: '🧾' },
    ],
  },
  {
    title: 'Network',
    items: [
      { to: '/sub-agents', label: 'Sub-Agent Network', icon: '🌐', roles: ['Hub Manager'] },
      { to: '/principals', label: 'Principals', icon: '🚢', roles: ['Hub Manager'] },
      { to: '/contracts', label: 'Contracts & SLAs', icon: '📄' },
      { to: '/services', label: 'Services portfolio', icon: '🧰' },
    ],
  },
  { title: 'Account', items: [{ to: '/subscription', label: 'Subscription', icon: '💳' }] },
  {
    title: 'Admin',
    ownerOnly: true,
    items: [{ to: '/admin/users', label: 'Users', icon: '👥' }],
  },
]

// Marketing site lives one level up from the app's base (/projects/app/ → /projects/).
const siteHome = import.meta.env.BASE_URL.replace(/app\/$/, '')

export default function Layout() {
  const { user, logout } = useAuth()
  const { resetDemo } = usePlatform()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const ownerEmail = getOwnerEmail()
  const isOwner = !!user && !!ownerEmail && user.email.toLowerCase() === ownerEmail.toLowerCase()
  const role = user?.role ?? 'Hub Manager'

  const visibleGroups = navGroups
    .filter((g) => !g.ownerOnly || isOwner)
    .map((g) => ({ ...g, items: g.items.filter((it) => !it.roles || it.roles.includes(role)) }))
    .filter((g) => g.items.length > 0)

  function leave() {
    setMenuOpen(false)
    logout()
    navigate('/login', { replace: true })
  }

  function doReset() {
    if (!window.confirm('Reset all voyages, network and audit data to the seeded demo state?')) return
    resetDemo()
    navigate('/')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/ausglobal.svg" alt="AusGlobal" width={34} height={34} />
          <div>
            <strong>AusGlobal</strong>
            <span>Ship Agency Hub</span>
          </div>
        </div>

        <nav className="nav">
          {visibleGroups.map((group, gi) => (
            <div className="nav-group" key={group.title ?? `g${gi}`}>
              {group.title && <span className="nav-group-title">{group.title}</span>}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  <span className="nav-icon" aria-hidden>
                    {item.icon}
                  </span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="ecosystem">
          <span className="ecosystem-title">The AusGlobal model</span>
          <div className="eco-item active">
            <span className="eco-dot port" /> Principal
            <em>appoints</em>
          </div>
          <div className="eco-item active">
            <span className="eco-dot amber" /> Hub agent
            <em>coordinates</em>
          </div>
          <div className="eco-item active">
            <span className="eco-dot starboard" /> Sub-agent
            <em>executes</em>
          </div>
        </div>

        <div className="sidebar-foot">
          <div className="layer-chip">Brisbane · Global ports</div>
          <p>Principals · Hub managers · Sub-agents</p>
          <button className="reset-demo" type="button" onClick={doReset}>
            ↺ Reset demo data
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-search">
            <span aria-hidden>🔎</span>
            <input placeholder="Search voyages, vessels, ports, sub-agents…" />
          </div>
          <div className="topbar-right">
            <a className="site-link" href={siteHome} title="Back to AusGlobal site">
              ↗ AusGlobal site
            </a>
            <button className="ghost-btn" type="button">
              🔔
            </button>
            {user && (
              <NavLink to="/subscription" className={`tier-badge tier-${user.tier}`} title="Your plan">
                {tierName[user.tier]}
              </NavLink>
            )}
            <div className="user-menu">
              <button className="user-pill" type="button" onClick={() => setMenuOpen((v) => !v)}>
                <div className="avatar">{user?.initials ?? 'HM'}</div>
                <div className="user-meta">
                  <strong>{user?.name ?? 'Hub Desk'}</strong>
                  <span>{user?.role ?? 'Hub Manager'}</span>
                </div>
                <span className="user-caret" aria-hidden>
                  ▾
                </span>
              </button>
              {menuOpen && (
                <>
                  <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                  <div className="user-dropdown" role="menu">
                    <div className="ud-head">
                      <strong>{user?.name}</strong>
                      <span>{user?.email}</span>
                    </div>
                    <button type="button" className="ud-item" onClick={leave}>
                      🔁 Switch account
                    </button>
                    <button type="button" className="ud-item" onClick={leave}>
                      ⎋ Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
