import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PlanTier, UserRole } from '../data/types'

export interface SessionUser {
  email: string
  name: string
  initials: string
  role: UserRole
  tier: PlanTier
}

interface StoredUser extends SessionUser {
  password: string
}

export interface RegisterInput {
  name: string
  email: string
  password: string
  tier: PlanTier
}

type Result = { ok: true } | { ok: false; error: string }

interface AuthValue {
  user: SessionUser | null
  login: (email: string, password: string) => Result
  register: (input: RegisterInput) => Result
  logout: () => void
  setTier: (tier: PlanTier) => void
}

const SESSION_KEY = 'beacon.session'
const USERS_KEY = 'beacon.users'
const AuthContext = createContext<AuthValue | null>(null)

function loadUsers(): StoredUser[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]') as StoredUser[]
  } catch {
    return []
  }
}

function saveUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  const letters = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
  return letters.toUpperCase() || 'U'
}

function strip(u: StoredUser): SessionUser {
  const { password: _password, ...session } = u
  return session
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as SessionUser
      return { ...parsed, tier: parsed.tier ?? 'starter' }
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user))
    else localStorage.removeItem(SESSION_KEY)
  }, [user])

  const value = useMemo<AuthValue>(
    () => ({
      user,

      login(email, password) {
        const e = email.trim().toLowerCase()
        const match = loadUsers().find((u) => u.email.toLowerCase() === e && u.password === password)
        if (!match) return { ok: false, error: 'No account matches that email and password.' }
        setUser(strip(match))
        return { ok: true }
      },

      register({ name, email, password, tier }) {
        const e = email.trim().toLowerCase()
        if (!name.trim()) return { ok: false, error: 'Please enter your name.' }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, error: 'Please enter a valid email.' }
        if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' }
        const users = loadUsers()
        if (users.some((u) => u.email.toLowerCase() === e)) {
          return { ok: false, error: 'An account with that email already exists. Try signing in.' }
        }
        const newUser: StoredUser = {
          email: email.trim(),
          name: name.trim(),
          initials: initialsOf(name),
          role: 'Operator',
          tier,
          password,
        }
        saveUsers([...users, newUser])
        setUser(strip(newUser))
        return { ok: true }
      },

      logout() {
        setUser(null)
      },

      setTier(tier) {
        setUser((u) => {
          if (!u) return u
          // Persist the tier on the stored account too, so it sticks on next sign-in.
          const users = loadUsers().map((su) =>
            su.email.toLowerCase() === u.email.toLowerCase() ? { ...su, tier } : su,
          )
          saveUsers(users)
          return { ...u, tier }
        })
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
