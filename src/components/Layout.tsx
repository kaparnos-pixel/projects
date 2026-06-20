import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { getOwnerEmail, useAuth } from '../auth/AuthContext'
import { canAccess, tierName, type Feature } from '../auth/entitlements'
import { flowStages } from '../data/workflow'

interface NavItem {
  to: string
  label: string
  icon: string
  end: boolean
  feature: Feature
}

const navGroups: { title: string | null; items: NavItem[]; ownerOnly?: boolean }[] = [
  { title: null, items: [{ to: '/', label: 'Dashboard', icon: '🛰️', end: true, feature: 'agent-hub' }] },
  {
    title: 'Agent Hub · Appointment',
    items: flowStages.map((s) => ({ to: s.route, label: stageNav(s.key), icon: s.icon, end: false, feature: 'agent-hub' as Feature })),
  },
  {
    title: 'Vendor Dock · Supply',
    items: [
      { to: '/vendor', label: 'Overview', icon: '🚢', end: true, feature: 'vendor-dock' },
      { to: '/vendor/marketplace', label: 'Marketplace', icon: '🛒', end: false, feature: 'vendor-dock' },
      { to: '/vendor/offers', label: 'Offers & Quotes', icon: '🧾', end: false, feature: 'vendor-dock' },
      { to: '/vendor/da', label: 'DA Tracking', icon: '💱', end: false, feature: 'vendor-dock' },
      { to: '/vendor/sof', label: 'SOF', icon: '📑', end: false, feature: 'vendor-dock' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { to: '/pcm', label: 'PCM · Cost', icon: '🧮', end: false, feature: 'pcm' },
      { to: '/purser', label: 'Purser · Pay', icon: '💸', end: false, feature: 'purser' },
    ],
  },
  { title: 'Account', items: [{ to: '/subscription', label: 'Subscription', icon: '💳', end: false, feature: 'account' }] },
  {
    title: 'Admin',
    ownerOnly: true,
    items: [{ to: '/admin/users', label: 'Users', icon: '👥', end: false, feature: 'account' }],
  },
]

function stageNav(key: string): string {
  switch (key) {
    case 'discovery':
      return 'Agent Discovery'
    case 'onboarding':
      return 'Onboarding'
    case 'chat':
      return 'Secure Chat'
    case 'contracts':
      return 'Contracts'
    case 'port-calls':
      return 'Port Calls'
    case 'audit':
      return 'Audit Trail'
    default:
      return key
  }
}

// Marketing site lives one level up from the app's base (/projects/app/ → /projects/).
const siteHome = import.meta.env.BASE_URL.replace(/app\/$/, '')

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const ownerEmail = getOwnerEmail()
  const isOwner = !!user && !!ownerEmail && user.email.toLowerCase() === ownerEmail.toLowerCase()
  const visibleGroups = navGroups.filter((g) => !g.ownerOnly || isOwner)

  function leave() {
    setMenuOpen(false)
    logout()
    navigate('/login', { replace: true })
  }

  function resetDemo() {
    if (!window.confirm('Reset all Vendor Dock and Finance demo data to defaults?')) return
    localStorage.removeItem('beacon.vendor.v1')
    localStorage.removeItem('beacon.finance.v1')
    window.location.reload()
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/beacon.svg" alt="BEACON" width={34} height={34} />
          <div>
            <strong>BEACON</strong>
            <span>Agent Hub</span>
          </div>
          <span className="portside-dot" title="Port-side product" aria-hidden />
        </div>

        <nav className="nav">
          {visibleGroups.map((group, gi) => (
            <div className="nav-group" key={group.title ?? `g${gi}`}>
              {group.title && <span className="nav-group-title">{group.title}</span>}
              {group.items.map((item) => {
                const locked = user ? !canAccess(user.tier, item.feature) : false
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `nav-link${isActive ? ' active' : ''}${locked ? ' locked' : ''}`
                    }
                  >
                    <span className="nav-icon" aria-hidden>
                      {item.icon}
                    </span>
                    {item.label}
                    {locked && (
                      <span className="nav-lock" aria-label="Upgrade required">
                        🔒
                      </span>
                    )}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="ecosystem">
          <span className="ecosystem-title">BEACON ecosystem</span>
          <div className="eco-item active">
            <span className="eco-dot port" /> Agent Hub
            <em>appointment</em>
          </div>
          <div className="eco-item active">
            <span className="eco-dot starboard" /> Vendor Dock
            <em>supply</em>
          </div>
          <div className="eco-item active">
            <span className="eco-dot neutral" /> PCM
            <em>cost</em>
          </div>
          <div className="eco-item active">
            <span className="eco-dot amber" /> Purser
            <em>pay</em>
          </div>
        </div>

        <div className="sidebar-foot">
          <div className="layer-chip">Appointment + Supply</div>
          <p>Operators · Charterers · Agents · Suppliers · Port-ops</p>
          <button className="reset-demo" type="button" onClick={resetDemo}>
            ↺ Reset demo data
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-search">
            <span aria-hidden>🔎</span>
            <input placeholder="Search agents, vessels, ports, contracts…" />
          </div>
          <div className="topbar-right">
            <a className="site-link" href={siteHome} title="Back to beacon site">
              ↗ BEACON site
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
                <div className="avatar">{user?.initials ?? 'OP'}</div>
                <div className="user-meta">
                  <strong>{user?.name ?? 'Ops Desk'}</strong>
                  <span>{user?.role ?? 'Operator'}</span>
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
