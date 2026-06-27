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
