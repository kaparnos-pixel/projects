import type { Invoice, PaymentMethod, Plan, Subscription, UsageMetric } from './types'

export const plans: Plan[] = [
  {
    tier: 'starter',
    name: 'Starter',
    priceMonthly: 0,
    blurb: 'For single operators trialling agent appointment.',
    highlights: [
      'Up to 5 verified agents',
      '25 port calls / month',
      'Secure chat & audit trail',
      'Community support',
    ],
    limits: { agents: 5, portCallsPerMonth: 25, seats: 2 },
  },
  {
    tier: 'pro',
    name: 'Pro',
    priceMonthly: 499,
    blurb: 'For fleets coordinating multiple ports at scale.',
    highlights: [
      'Up to 50 verified agents',
      '500 port calls / month',
      'Contract negotiation & ledger storage',
      'Priority support · 99.9% SLA',
    ],
    limits: { agents: 50, portCallsPerMonth: 500, seats: 15 },
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    priceMonthly: null,
    blurb: 'For global operators needing unlimited scale & compliance.',
    highlights: [
      'Unlimited agents & port calls',
      'SSO / SAML & custom roles',
      'Dedicated success manager',
      'Custom data residency & DPA',
    ],
    limits: { agents: null, portCallsPerMonth: null, seats: null },
  },
]

export const currentSubscription: Subscription = {
  tier: 'pro',
  status: 'active',
  billingCycle: 'monthly',
  renewsOn: '2026-07-15',
  seatsUsed: 9,
}

export const usage: UsageMetric[] = [
  { label: 'Verified agents', used: 32, limit: 50, unit: '' },
  { label: 'Port calls this month', used: 218, limit: 500, unit: '' },
  { label: 'Team seats', used: 9, limit: 15, unit: '' },
  { label: 'Contract storage', used: 6.4, limit: 25, unit: 'GB' },
]

export const paymentMethod: PaymentMethod = {
  brand: 'Visa',
  last4: '4242',
  expiry: '08/27',
  holder: 'TechHub RAK FZ-LLC',
}

export const invoices: Invoice[] = [
  { id: 'in-6', number: 'BEA-2026-0006', date: '2026-06-15', amount: 'USD 499.00', status: 'paid', period: 'Jun 2026' },
  { id: 'in-5', number: 'BEA-2026-0005', date: '2026-05-15', amount: 'USD 499.00', status: 'paid', period: 'May 2026' },
  { id: 'in-4', number: 'BEA-2026-0004', date: '2026-04-15', amount: 'USD 499.00', status: 'paid', period: 'Apr 2026' },
  { id: 'in-3', number: 'BEA-2026-0003', date: '2026-03-15', amount: 'USD 499.00', status: 'paid', period: 'Mar 2026' },
  { id: 'in-2', number: 'BEA-2026-0002', date: '2026-02-15', amount: 'USD 499.00', status: 'paid', period: 'Feb 2026' },
  { id: 'in-1', number: 'BEA-2026-0001', date: '2026-01-15', amount: 'USD 249.00', status: 'paid', period: 'Jan 2026' },
]
