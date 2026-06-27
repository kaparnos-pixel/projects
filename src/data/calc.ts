import type { DALine, LedgerEntry, Voyage } from './types'

export function usd(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
}

export function pdaTotal(lines: DALine[]): number {
  return lines.reduce((s, l) => s + l.proforma, 0)
}

export function fdaTotal(lines: DALine[]): number {
  return lines.reduce((s, l) => s + (l.final ?? l.proforma), 0)
}

// A line is flagged when its proforma (or final) exceeds the pre-agreed tariff cap.
export function lineVariance(line: DALine): number {
  if (line.tariffCap == null) return 0
  const value = line.final ?? line.proforma
  return value - line.tariffCap
}

export function isOverTariff(line: DALine): boolean {
  return lineVariance(line) > 0
}

export function flaggedLines(lines: DALine[]): DALine[] {
  return lines.filter(isOverTariff)
}

export function ledgerBalance(ledger: LedgerEntry[]): {
  funded: number
  advanced: number
  invoiced: number
  refunded: number
  held: number
} {
  let funded = 0
  let advanced = 0
  let invoiced = 0
  let refunded = 0
  for (const e of ledger) {
    if (e.kind === 'principal-funding') funded += e.amount
    else if (e.kind === 'advance') advanced += e.amount
    else if (e.kind === 'fda-invoice') invoiced += e.amount
    else if (e.kind === 'refund') refunded += e.amount
  }
  // Capital the hub is still holding against this voyage.
  const held = funded - advanced
  return { funded, advanced, invoiced, refunded, held }
}

// Final-vs-proforma settlement delta. Positive = under-spend to refund/credit.
export function settlementDelta(v: Voyage): number {
  return pdaTotal(v.daLines) - fdaTotal(v.daLines)
}

// Revenue model: the principal pays the full invoice to the hub, which remits
// 90% to the sub-agent and retains the balance as its margin.
export const SUBAGENT_SHARE = 0.9
export const FDA_SLA_DAYS = 30

// The sub-agent remittance and the AusGlobal margin on a voyage's current total.
export function subAgentRemittance(v: Voyage): number {
  return Math.round(fdaTotal(v.daLines) * SUBAGENT_SHARE)
}
export function hubMargin(v: Voyage): number {
  return fdaTotal(v.daLines) - subAgentRemittance(v)
}

// The FDA must be filed within FDA_SLA_DAYS of the vessel sailing. Returns the
// due date and days remaining (negative = overdue), or null if not yet sailed.
export function fdaSla(v: Voyage): { dueDate: string; daysLeft: number } | null {
  const sailed = v.history.find((h) => h.stage === 'sailed')?.at
  if (!sailed) return null
  const d = new Date(sailed.replace(' ', 'T'))
  if (isNaN(d.getTime())) return null
  const due = new Date(d.getTime() + FDA_SLA_DAYS * 86_400_000)
  const daysLeft = Math.ceil((due.getTime() - Date.now()) / 86_400_000)
  return { dueDate: due.toISOString().slice(0, 10), daysLeft }
}
