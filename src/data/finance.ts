// Finance layers of BEACON: PCM (cost control & benchmarking) and Purser
// (payments / settlement). PCM reads disbursement accounts from Vendor Dock;
// this file adds benchmark reference data and the payment ledger.

export type PaymentStatus = 'pending' | 'initiated' | 'in-transit' | 'settled' | 'failed'
export type PaymentMethod = 'SWIFT' | 'Local rails' | 'Escrow'
export type CounterpartyType = 'Agent' | 'Supplier'

export interface Payment {
  id: string
  ref: string
  counterparty: string
  type: CounterpartyType
  vessel: string
  port: string
  amount: number
  currency: string
  method: PaymentMethod
  status: PaymentStatus
  reference: string // related DA / offer reference
  createdAt: string
  updatedAt: string
}

export interface PortBenchmark {
  port: string
  // network-average all-in cost for a comparable port call (USD)
  benchmarkPerCall: number
}

export interface PcmState {
  budgets: Record<string, number> // daId -> budget
  reconciled: Record<string, boolean> // daId -> reconciled
  payments: Payment[]
}

export const portBenchmarks: PortBenchmark[] = [
  { port: 'Jebel Ali', benchmarkPerCall: 24000 },
  { port: 'Khalifa Port', benchmarkPerCall: 19500 },
  { port: 'Fujairah', benchmarkPerCall: 9000 },
  { port: 'Khorfakkan', benchmarkPerCall: 14000 },
  { port: 'Hamriyah', benchmarkPerCall: 12500 },
]

export const seedPayments: Payment[] = [
  {
    id: 'pay-1',
    ref: 'PAY-2026-0101',
    counterparty: 'Khalifa Survey Partners',
    type: 'Supplier',
    vessel: 'MV Emirates Trader',
    port: 'Khalifa Port',
    amount: 1200,
    currency: 'USD',
    method: 'Local rails',
    status: 'settled',
    reference: 'OF-1003',
    createdAt: '2026-06-17 10:20',
    updatedAt: '2026-06-17 14:02',
  },
  {
    id: 'pay-2',
    ref: 'PAY-2026-0102',
    counterparty: 'Gulf Maritime Agencies LLC',
    type: 'Agent',
    vessel: 'MT Arabian Falcon',
    port: 'Jebel Ali',
    amount: 18650,
    currency: 'USD',
    method: 'SWIFT',
    status: 'in-transit',
    reference: 'DA-2026-0042',
    createdAt: '2026-06-19 16:40',
    updatedAt: '2026-06-20 08:05',
  },
  {
    id: 'pay-3',
    ref: 'PAY-2026-0103',
    counterparty: 'Gulf Provisions Trading',
    type: 'Supplier',
    vessel: 'MT Arabian Falcon',
    port: 'Jebel Ali',
    amount: 4850,
    currency: 'USD',
    method: 'Escrow',
    status: 'initiated',
    reference: 'OF-1001',
    createdAt: '2026-06-20 09:30',
    updatedAt: '2026-06-20 09:30',
  },
  {
    id: 'pay-4',
    ref: 'PAY-2026-0104',
    counterparty: 'Khalifa Port Agency Group',
    type: 'Agent',
    vessel: 'MV Emirates Trader',
    port: 'Khalifa Port',
    amount: 15000,
    currency: 'USD',
    method: 'SWIFT',
    status: 'pending',
    reference: 'DA-2026-0043',
    createdAt: '2026-06-20 11:15',
    updatedAt: '2026-06-20 11:15',
  },
]

export const pcmSeed: PcmState = {
  budgets: {},
  reconciled: {},
  payments: seedPayments,
}

// The ordered settlement lifecycle used by Purser.
export const paymentFlow: PaymentStatus[] = ['pending', 'initiated', 'in-transit', 'settled']
