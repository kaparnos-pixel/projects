import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { UserRole } from '../data/types'

export interface DemoUser {
  email: string
  password: string
  name: string
  initials: string
  role: UserRole
}

// Demo accounts, mock only, no backend. Passwords live client-side on purpose.
export const demoUsers: DemoUser[] = [
  { email: 'ops@beacon.io', password: 'demo1234', name: 'Ops Desk', initials: 'OP', role: 'Operator' },
  { email: 'charter@beacon.io', password: 'demo1234', name: 'Mara Voss', initials: 'MV', role: 'Charterer' },
  { email: 'fleet@beacon.io', password: 'demo1234', name: 'Jon Reyes', initials: 'JR', role: 'Fleet Manager' },
  { email: 'portops@beacon.io', password: 'demo1234', name: 'Sara Lund', initials: 'SL', role: 'Port-Ops' },
]

export interface SessionUser {
  email: string
  name: string
  initials: string
  role: UserRole
}

interface AuthValue {
  user: SessionUser | null
  login: (email: string, password: string) => { ok: true } | { ok: false; error: string }
  logout: () => void
}

const STORAGE_KEY = 'beacon.session'
const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as SessionUser) : null
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
        setUser({ email: match.email, name: match.name, initials: match.initials, role: match.role })
        return { ok: true }
      },
      logout() {
        setUser(null)
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
