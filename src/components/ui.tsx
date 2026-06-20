import type { ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {action && <div className="page-action">{action}</div>}
    </div>
  )
}

const toneByLabel: Record<string, string> = {
  // agent
  verified: 'good',
  onboarding: 'warn',
  invited: 'muted',
  // contract
  draft: 'muted',
  'in-negotiation': 'warn',
  'pending-signature': 'info',
  executed: 'good',
  archived: 'muted',
  // port call
  nominated: 'muted',
  'pre-arrival': 'info',
  alongside: 'warn',
  operations: 'warn',
  departed: 'good',
  // billing
  paid: 'good',
  due: 'warn',
  failed: 'bad',
  active: 'good',
  trialing: 'info',
  'past-due': 'bad',
  // vendor — offers
  requested: 'muted',
  quoted: 'info',
  accepted: 'good',
  declined: 'bad',
  // vendor — disbursement accounts
  'pro-forma': 'muted',
  submitted: 'info',
  approved: 'warn',
  settled: 'good',
}

export function Badge({ label }: { label: string }) {
  const tone = toneByLabel[label] ?? 'muted'
  return <span className={`badge badge-${tone}`}>{label.replace(/-/g, ' ')}</span>
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`card${className ? ' ' + className : ''}`}>{children}</div>
}

export function Stars({ value }: { value: number }) {
  return (
    <span className="stars" title={`${value} / 5`}>
      {'★'.repeat(Math.round(value))}
      {'☆'.repeat(5 - Math.round(value))}
      <em>{value.toFixed(1)}</em>
    </span>
  )
}
