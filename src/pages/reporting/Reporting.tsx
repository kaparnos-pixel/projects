import { Link } from 'react-router-dom'
import { usePlatform } from '../../platform/PlatformContext'
import { Badge, Card, PageHeader } from '../../components/ui'
import { reportTypeMeta, type ReportType } from '../../data/reporting'

const ORDER: ReportType[] = ['husbandry', 'general-agency', 'protecting-agency', 'epda-fda']

export default function Reporting() {
  const platform = usePlatform()

  return (
    <div className="stack">
      <PageHeader
        title="Sub-Agent Reporting"
        subtitle="Report digitally against a Job Code. Choose a reporting form to generate a new report, or open the archive to filter and export historical logs."
      />

      <div className="report-menu">
        {ORDER.map((t) => {
          const meta = reportTypeMeta[t]
          const count = platform.reports.filter((r) => r.type === t).length
          return (
            <Link key={t} to={`/reporting/${meta.route}`} className="report-card">
              <span className="report-ico">{meta.icon}</span>
              <div className="report-card-body">
                <strong>{meta.label}</strong>
                <span>{meta.short}</span>
              </div>
              <span className="report-count">{count}</span>
            </Link>
          )
        })}
      </div>

      <Card>
        <div className="section-title">Recently filed</div>
        {platform.reports.length === 0 ? (
          <p className="muted-text">No reports filed yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Report</th><th>Type</th><th>Vessel</th><th>Port</th><th>Status</th><th>Filed</th></tr>
            </thead>
            <tbody>
              {platform.reports.slice(0, 8).map((r) => (
                <tr key={r.id}>
                  <td className="mono">
                    <Link className="link" to={`/reporting/${reportTypeMeta[r.type].route}`}>{r.id}</Link>
                  </td>
                  <td>{reportTypeMeta[r.type].label}</td>
                  <td>{r.vessel || '—'}</td>
                  <td>{r.port || '—'}</td>
                  <td><Badge label={r.status} /></td>
                  <td className="muted-text mono">{r.createdAtLocal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
