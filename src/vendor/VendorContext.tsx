import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  seedState,
  type DALine,
  type DisbursementAccount,
  type Offer,
  type OfferLine,
  type SOF,
  type SOFEvent,
  type Supplier,
  type VendorState,
} from '../data/vendor'

const STORAGE_KEY = 'beacon.vendor.v1'

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

interface CreateRFQInput {
  supplier: Supplier
  title: string
  vessel: string
  port: string
  neededBy: string
  note: string
  lines: OfferLine[]
}

interface VendorValue extends VendorState {
  // Offers / quotations
  createRFQ: (input: CreateRFQInput) => void
  submitQuote: (offerId: string, amount: number) => void
  setOfferStatus: (offerId: string, status: Offer['status']) => void
  // Disbursement accounts
  addDA: (da: Omit<DisbursementAccount, 'id' | 'updatedAt'>) => void
  addDALine: (daId: string, line: Omit<DALine, 'id'>) => void
  setDAActual: (daId: string, lineId: string, actual: number | null) => void
  setDAStatus: (daId: string, status: DisbursementAccount['status']) => void
  // SOF
  createSOF: (sof: Omit<SOF, 'id' | 'status' | 'events' | 'submittedAt'>) => string
  addSOFEvent: (sofId: string, event: Omit<SOFEvent, 'id'>) => void
  removeSOFEvent: (sofId: string, eventId: string) => void
  submitSOF: (sofId: string) => void
  resetVendorData: () => void
}

const VendorContext = createContext<VendorValue | null>(null)

function load(): VendorState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as VendorState
  } catch {
    /* ignore */
  }
  return seedState
}

export function VendorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VendorState>(load)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const value = useMemo<VendorValue>(() => {
    return {
      ...state,

      createRFQ(input) {
        const offer: Offer = {
          id: uid('of'),
          supplierId: input.supplier.id,
          supplierName: input.supplier.company,
          category: input.supplier.category,
          title: input.title,
          vessel: input.vessel,
          port: input.port,
          neededBy: input.neededBy,
          lines: input.lines,
          note: input.note,
          status: 'requested',
          quoteAmount: null,
          currency: 'USD',
          createdAt: today(),
        }
        setState((s) => ({ ...s, offers: [offer, ...s.offers] }))
      },

      submitQuote(offerId, amount) {
        setState((s) => ({
          ...s,
          offers: s.offers.map((o) =>
            o.id === offerId ? { ...o, status: 'quoted', quoteAmount: amount } : o,
          ),
        }))
      },

      setOfferStatus(offerId, status) {
        setState((s) => ({
          ...s,
          offers: s.offers.map((o) => (o.id === offerId ? { ...o, status } : o)),
        }))
      },

      addDA(da) {
        const next: DisbursementAccount = { ...da, id: uid('da'), updatedAt: today() }
        setState((s) => ({ ...s, das: [next, ...s.das] }))
      },

      addDALine(daId, line) {
        setState((s) => ({
          ...s,
          das: s.das.map((d) =>
            d.id === daId
              ? { ...d, updatedAt: today(), lines: [...d.lines, { ...line, id: uid('l') }] }
              : d,
          ),
        }))
      },

      setDAActual(daId, lineId, actual) {
        setState((s) => ({
          ...s,
          das: s.das.map((d) =>
            d.id === daId
              ? {
                  ...d,
                  updatedAt: today(),
                  lines: d.lines.map((l) => (l.id === lineId ? { ...l, actual } : l)),
                }
              : d,
          ),
        }))
      },

      setDAStatus(daId, status) {
        setState((s) => ({
          ...s,
          das: s.das.map((d) => (d.id === daId ? { ...d, status, updatedAt: today() } : d)),
        }))
      },

      createSOF(sof) {
        const id = uid('sof')
        const next: SOF = { ...sof, id, status: 'draft', events: [], submittedAt: null }
        setState((s) => ({ ...s, sofs: [next, ...s.sofs] }))
        return id
      },

      addSOFEvent(sofId, event) {
        setState((s) => ({
          ...s,
          sofs: s.sofs.map((f) =>
            f.id === sofId
              ? {
                  ...f,
                  events: [...f.events, { ...event, id: uid('e') }].sort((a, b) =>
                    a.at.localeCompare(b.at),
                  ),
                }
              : f,
          ),
        }))
      },

      removeSOFEvent(sofId, eventId) {
        setState((s) => ({
          ...s,
          sofs: s.sofs.map((f) =>
            f.id === sofId ? { ...f, events: f.events.filter((e) => e.id !== eventId) } : f,
          ),
        }))
      },

      submitSOF(sofId) {
        setState((s) => ({
          ...s,
          sofs: s.sofs.map((f) =>
            f.id === sofId
              ? { ...f, status: 'submitted', submittedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') }
              : f,
          ),
        }))
      },

      resetVendorData() {
        setState(seedState)
      },
    }
  }, [state])

  return <VendorContext.Provider value={value}>{children}</VendorContext.Provider>
}

export function useVendor(): VendorValue {
  const ctx = useContext(VendorContext)
  if (!ctx) throw new Error('useVendor must be used within VendorProvider')
  return ctx
}

export function money(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    amount,
  )
}
