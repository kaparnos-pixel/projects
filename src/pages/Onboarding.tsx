import { useState } from 'react'
import { Card, PageHeader } from '../components/ui'
import { onboardingSteps } from '../data/mock'
import type { OnboardingStepStatus } from '../data/types'

const statusLabel: Record<OnboardingStepStatus, string> = {
  done: 'Complete',
  active: 'In progress',
  pending: 'Pending',
}

export default function Onboarding() {
  const [steps, setSteps] = useState(onboardingSteps)

  const completed = steps.filter((s) => s.status === 'done').length
  const progress = Math.round((completed / steps.length) * 100)

  function advance(id: string) {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === id)
      if (idx === -1 || prev[idx].status !== 'active') return prev
      const next = prev.map((s, i) => {
        if (i === idx) return { ...s, status: 'done' as OnboardingStepStatus }
        if (i === idx + 1 && s.status === 'pending')
          return { ...s, status: 'active' as OnboardingStepStatus }
        return s
      })
      return next
    })
  }

  return (
    <div className="stack">
      <PageHeader
        title="Agent onboarding"
        subtitle="Compliant intake — KYC, sanctions screening and capability profiling before an agent goes live."
        action={<span className="pill-count">{progress}% complete</span>}
      />

      <Card>
        <div className="onb-head">
          <div>
            <strong>Lagos Marine Logistics</strong>
            <span className="muted-text"> · Lagos, Nigeria · applied 2026-06-14</span>
          </div>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <ol className="stepper">
          {steps.map((s, i) => (
            <li key={s.id} className={`step step-${s.status}`}>
              <div className="step-marker">{s.status === 'done' ? '✓' : i + 1}</div>
              <div className="step-body">
                <div className="step-row">
                  <strong>{s.title}</strong>
                  <span className={`step-tag tag-${s.status}`}>{statusLabel[s.status]}</span>
                </div>
                <p>{s.description}</p>
                {s.status === 'active' && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => advance(s.id)}>
                    Approve & continue
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>

        {progress === 100 && (
          <div className="banner banner-good">
            🎉 Onboarding complete — agent published to the discovery directory.
          </div>
        )}
      </Card>
    </div>
  )
}
