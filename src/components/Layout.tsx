import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { flowStages } from '../data/workflow'

const navItems = [
  { to: '/', label: 'Dashboard', icon: '🛰️', end: true },
  ...flowStages.map((s) => ({ to: s.route, label: stageNav(s.key), icon: s.icon, end: false })),
  { to: '/subscription', label: 'Subscription', icon: '💳', end: false },
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

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
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
          {navItems.map((item) => (
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
        </nav>

        <div className="ecosystem">
          <span className="ecosystem-title">BEACON ecosystem</span>
          <div className="eco-item active">
            <span className="eco-dot port" /> Agent Hub
            <em>appointment</em>
          </div>
          <div className="eco-item" title="Supply side — separate product">
            <span className="eco-dot starboard" /> Vendor Dock
            <em>supply</em>
          </div>
          <div className="eco-item" title="Cost layer — separate product">
            <span className="eco-dot neutral" /> PCM
            <em>cost</em>
          </div>
          <div className="eco-item" title="Payment layer — separate product">
            <span className="eco-dot amber" /> Purser
            <em>pay</em>
          </div>
        </div>

        <div className="sidebar-foot">
          <div className="layer-chip">Appointment layer</div>
          <p>Operators · Charterers · Fleet managers · Port-ops</p>
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
            <div className="user-pill">
              <div className="avatar">{user?.initials ?? 'OP'}</div>
              <div className="user-meta">
                <strong>{user?.name ?? 'Ops Desk'}</strong>
                <span>{user?.role ?? 'Operator'}</span>
              </div>
            </div>
            <button className="ghost-btn logout-btn" type="button" onClick={handleLogout} title="Sign out">
              ⎋
            </button>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
