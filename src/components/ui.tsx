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
  // sub-agent enlistment
  prospect: 'muted',
  vetting: 'warn',
  enlisted: 'good',
  suspended: 'bad',
  // principal flags
  owner: 'info',
  charterer: 'info',
  operator: 'info',
  'ship manager': 'info',
  // voyage lifecycle
  appointed: 'muted',
  forwarded: 'info',
  'pda submitted': 'info',
  'pda vetted': 'warn',
  'pda approved': 'warn',
  funded: 'warn',
  'advance released': 'warn',
  'in port': 'info',
  sailed: 'info',
  'fda submitted': 'info',
  'fda audited': 'warn',
  invoiced: 'good',
  'settled & archived': 'good',
  settled: 'good',
  // billing
  paid: 'good',
  due: 'warn',
  failed: 'bad',
  active: 'good',
  trialing: 'info',
  'past-due': 'bad',
}

export function Badge({ label, tone }: { label: string; tone?: string }) {
  const t = tone ?? toneByLabel[label.toLowerCase()] ?? 'muted'
  return <span className={`badge badge-${t}`}>{label.replace(/-/g, ' ')}</span>
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

// A compact flag pill (used for compliance ticks/crosses).
export function Flag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`badge badge-${ok ? 'good' : 'muted'}`} title={label}>
      {ok ? '✓' : '—'} {label}
    </span>
  )
}
