import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { pcmSeed, paymentFlow, type Payment, type PaymentStatus, type PcmState } from '../data/finance'
import { useVendor } from '../vendor/VendorContext'

const STORAGE_KEY = 'beacon.finance.v1'

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`
}
function stamp(): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

interface FinanceValue extends PcmState {
  // PCM
  setBudget: (daId: string, amount: number) => void
  setReconciled: (daId: string, value: boolean) => void
  // Purser
  addPayment: (p: Omit<Payment, 'id' | 'status' | 'createdAt' | 'updatedAt'>) => void
  advancePayment: (id: string) => void
  failPayment: (id: string) => void
  resetFinance: () => void
}

const FinanceContext = createContext<FinanceValue | null>(null)

function load(): PcmState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as PcmState
  } catch {
    /* ignore */
  }
  return pcmSeed
}

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PcmState>(load)
  const { das, setDAStatus } = useVendor()

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  // Tie: an approved (or settled) DA auto-creates a pending Purser payment
  // to its party for the final total, created once, keyed on the DA ref.
  useEffect(() => {
    const toCreate = das.filter(
      (d) =>
        (d.status === 'approved' || d.status === 'settled') &&
        !state.payments.some((p) => p.reference === d.ref),
    )
    if (toCreate.length === 0) return
    setState((s) => {
      const existing = new Set(s.payments.map((p) => p.reference))
      const created: Payment[] = toCreate
        .filter((d) => !existing.has(d.ref))
        .map((d) => ({
          id: uid('pay'),
          ref: `PAY-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
          counterparty: d.party,
          type: 'Agent',
          vessel: d.vessel,
          port: d.port,
          amount: d.lines.reduce((sum, l) => sum + (l.actual ?? l.proforma), 0),
          currency: d.currency,
          method: 'SWIFT',
          status: 'pending',
          reference: d.ref,
          createdAt: stamp(),
          updatedAt: stamp(),
        }))
      if (created.length === 0) return s
      return { ...s, payments: [...created, ...s.payments] }
    })
  }, [das, state.payments])

  // Tie: a settled payment closes its DA, flips the linked DA to settled.
  useEffect(() => {
    for (const p of state.payments) {
      if (p.status !== 'settled') continue
      const da = das.find((d) => d.ref === p.reference)
      if (da && da.status !== 'settled') setDAStatus(da.id, 'settled')
    }
  }, [state.payments, das, setDAStatus])

  const value = useMemo<FinanceValue>(() => {
    return {
      ...state,

      setBudget(daId, amount) {
        setState((s) => ({ ...s, budgets: { ...s.budgets, [daId]: amount } }))
      },

      setReconciled(daId, value) {
        setState((s) => ({ ...s, reconciled: { ...s.reconciled, [daId]: value } }))
      },

      addPayment(p) {
        const payment: Payment = {
          ...p,
          id: uid('pay'),
          status: 'pending',
          createdAt: stamp(),
          updatedAt: stamp(),
        }
        setState((s) => ({ ...s, payments: [payment, ...s.payments] }))
      },

      advancePayment(id) {
        setState((s) => ({
          ...s,
          payments: s.payments.map((p) => {
            if (p.id !== id) return p
            const i = paymentFlow.indexOf(p.status as PaymentStatus)
            if (i < 0 || i >= paymentFlow.length - 1) return p
            return { ...p, status: paymentFlow[i + 1], updatedAt: stamp() }
          }),
        }))
      },

      failPayment(id) {
        setState((s) => ({
          ...s,
          payments: s.payments.map((p) =>
            p.id === id ? { ...p, status: 'failed', updatedAt: stamp() } : p,
          ),
        }))
      },

      resetFinance() {
        setState(pcmSeed)
      },
    }
  }, [state])

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>
}

export function useFinance(): FinanceValue {
  const ctx = useContext(FinanceContext)
  if (!ctx) throw new Error('useFinance must be used within FinanceProvider')
  return ctx
}
