import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PlanTier, UserRole } from '../data/types'

export interface DemoUser {
  email: string
  password: string
  name: string
  initials: string
  role: UserRole
  tier: PlanTier
}

// Demo accounts, mock only, no backend. Passwords live client-side on purpose.
// Each account sits on a different paid tier so access rights can be tried out.
export const demoUsers: DemoUser[] = [
  { email: 'ops@beacon.io', password: 'demo1234', name: 'Ops Desk', initials: 'OP', role: 'Operator', tier: 'enterprise' },
  { email: 'charter@beacon.io', password: 'demo1234', name: 'Mara Voss', initials: 'MV', role: 'Charterer', tier: 'pro' },
  { email: 'fleet@beacon.io', password: 'demo1234', name: 'Jon Reyes', initials: 'JR', role: 'Fleet Manager', tier: 'starter' },
  { email: 'portops@beacon.io', password: 'demo1234', name: 'Sara Lund', initials: 'SL', role: 'Port-Ops', tier: 'pro' },
]

export interface SessionUser {
  email: string
  name: string
  initials: string
  role: UserRole
  tier: PlanTier
}

interface AuthValue {
  user: SessionUser | null
  login: (email: string, password: string) => { ok: true } | { ok: false; error: string }
  logout: () => void
  setTier: (tier: PlanTier) => void
}

const STORAGE_KEY = 'beacon.session'
const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as SessionUser
      // Backfill tier for sessions created before tiers existed.
      return { ...parsed, tier: parsed.tier ?? 'starter' }
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    else localStorage.removeItem(STORAGE_KEY)
  }, [user])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      login(email, password) {
        const match = demoUsers.find(
          (u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password,
        )
        if (!match) return { ok: false, error: 'Invalid email or password.' }
        setUser({
          email: match.email,
          name: match.name,
          initials: match.initials,
          role: match.role,
          tier: match.tier,
        })
        return { ok: true }
      },
      logout() {
        setUser(null)
      },
      setTier(tier) {
        setUser((u) => (u ? { ...u, tier } : u))
      },
    }),
    [user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
