import type { Invoice, PaymentMethod, Plan, Subscription, UsageMetric } from './types'

// The AusGlobal platform is offered to hub operators as tiered SaaS, priced by
// managed voyages (port calls). The plan governs limits, not access — every
// party always sees the full audit trail and disbursement record.
export const plans: Plan[] = [
  {
    tier: 'starter',
    name: 'Starter',
    priceMonthly: 0,
    blurb: 'For a new hub desk piloting the AusGlobal model on a few routes.',
    highlights: [
      'Up to 25 managed voyages / month',
      'Up to 10 enlisted sub-agents',
      'Full PDA / FDA lifecycle & audit trail',
      'Email community support',
    ],
    limits: { voyagesPerMonth: 25, subAgents: 10, seats: 3 },
  },
  {
    tier: 'pro',
    name: 'Pro',
    priceMonthly: 899,
    blurb: 'For an established hub coordinating a global sub-agent network.',
    highlights: [
      'Up to 500 managed voyages / month',
      'Up to 100 enlisted sub-agents',
      'Tariff benchmarking & variance analytics',
      'Centralised repository & priority SLA',
    ],
    limits: { voyagesPerMonth: 500, subAgents: 100, seats: 25 },
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    priceMonthly: null,
    blurb: 'For global operators with heavy compliance & cross-border exposure.',
    highlights: [
      'Unlimited voyages & sub-agents',
      'Premium compliance & enhanced due-diligence',
      'SSO / SAML, custom roles & data residency',
      'Dedicated success manager & DPA',
    ],
    limits: { voyagesPerMonth: null, subAgents: null, seats: null },
  },
]

export const currentSubscription: Subscription = {
  tier: 'pro',
  status: 'active',
  billingCycle: 'monthly',
  renewsOn: '2026-07-15',
  seatsUsed: 11,
}

export const usage: UsageMetric[] = [
  { label: 'Managed voyages this month', used: 218, limit: 500, unit: '' },
  { label: 'Enlisted sub-agents', used: 36, limit: 100, unit: '' },
  { label: 'Team seats', used: 11, limit: 25, unit: '' },
  { label: 'Document archive', used: 14.2, limit: 50, unit: 'GB' },
]

export const paymentMethod: PaymentMethod = {
  brand: 'Visa',
  last4: '4242',
  expiry: '08/27',
  holder: 'AusGlobal Ship Agent Pty Ltd',
}

export const invoices: Invoice[] = [
  { id: 'in-6', number: 'AUS-INV-2026-0006', date: '2026-06-15', amount: 'AUD 899.00', status: 'paid', period: 'Jun 2026' },
  { id: 'in-5', number: 'AUS-INV-2026-0005', date: '2026-05-15', amount: 'AUD 899.00', status: 'paid', period: 'May 2026' },
  { id: 'in-4', number: 'AUS-INV-2026-0004', date: '2026-04-15', amount: 'AUD 899.00', status: 'paid', period: 'Apr 2026' },
  { id: 'in-3', number: 'AUS-INV-2026-0003', date: '2026-03-15', amount: 'AUD 899.00', status: 'paid', period: 'Mar 2026' },
  { id: 'in-2', number: 'AUS-INV-2026-0002', date: '2026-02-15', amount: 'AUD 899.00', status: 'paid', period: 'Feb 2026' },
  { id: 'in-1', number: 'AUS-INV-2026-0001', date: '2026-01-15', amount: 'AUD 499.00', status: 'paid', period: 'Jan 2026' },
]
