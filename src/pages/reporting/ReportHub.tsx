import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { usePlatform } from '../../platform/PlatformContext'
import { PageHeader } from '../../components/ui'
import { newReport, reportTypeMeta, type Report, type ReportType } from '../../data/reporting'
import Husbandry from './forms/Husbandry'
import GeneralAgency from './forms/GeneralAgency'
import ProtectingAgency from './forms/ProtectingAgency'
import EpdaFda from './forms/EpdaFda'
import Archived from './Archived'

const ROUTE_TO_TYPE: Record<string, ReportType> = {
  husbandry: 'husbandry',
  'general-agency': 'general-agency',
  'protecting-agency': 'protecting-agency',
  'epda-fda': 'epda-fda',
}

export default function ReportHub() {
  const { type: routeType } = useParams()
  const platform = usePlatform()
  const type = routeType ? ROUTE_TO_TYPE[routeType] : undefined

  const subAgentId: string | null = null
  const [tab, setTab] = useState<'generate' | 'archived'>('generate')
  const [report, setReport] = useState<Report>(() => newReport(type ?? 'husbandry', undefined, subAgentId))
  const [notice, setNotice] = useState('')

  // Reset the working report whenever the report type in the URL changes.
  useEffect(() => {
    if (type) {
      setReport(newReport(type, undefined, subAgentId))
      setTab('generate')
      setNotice('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  if (!type) return <Navigate to="/reporting" replace />

  const meta = reportTypeMeta[type]

  function submit() {
    platform.saveReport({ ...report, submitted: true })
    setReport(newReport(type!, undefined, subAgentId))
    setNotice(`${meta.label} report submitted and archived.`)
    setTab('archived')
  }

  return (
    <div className="stack">
      <PageHeader
        title={`${meta.icon} ${meta.label} reporting`}
        subtitle={meta.short}
        action={<Link className="btn btn-ghost" to="/reporting">← All report types</Link>}
      />

      <div className="tabs">
        <button className={`tab${tab === 'generate' ? ' active' : ''}`} onClick={() => setTab('generate')}>Generate a Report</button>
        <button className={`tab${tab === 'archived' ? ' active' : ''}`} onClick={() => setTab('archived')}>
          Archived Reports
          <span className="tab-count">{platform.reports.filter((r) => r.type === type).length}</span>
        </button>
      </div>

      {notice && tab === 'archived' && <div className="banner banner-good">✓ {notice}</div>}

      {tab === 'generate' ? (
        <>
          {report.type === 'husbandry' && <Husbandry report={report} onChange={setReport} onSubmit={submit} />}
          {report.type === 'general-agency' && <GeneralAgency report={report} onChange={setReport} onSubmit={submit} />}
          {report.type === 'protecting-agency' && <ProtectingAgency report={report} onChange={setReport} onSubmit={submit} />}
          {report.type === 'epda-fda' && <EpdaFda report={report} onChange={setReport} onSubmit={submit} />}
        </>
      ) : (
        <Archived type={type} />
      )}
    </div>
  )
}
