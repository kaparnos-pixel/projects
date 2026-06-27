import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlatform } from '../platform/PlatformContext'
import { Card, PageHeader } from '../components/ui'

// The platform auto-generates an email on every input. Owners, the hub and
// sub-agents each have a platform email ID, and the system sends from the
// originating party's address whenever they act in the system.
export default function Inbox() {
  const platform = usePlatform()
  const [selected, setSelected] = useState(platform.mail[0]?.id ?? '')
  const active = platform.mail.find((m) => m.id === selected) ?? platform.mail[0]

  return (
    <div className="stack">
      <PageHeader
        title="Inbox"
        subtitle="Every action in the platform generates an email from the acting party's designated address. This is the auto-generated communication log across principals, the hub and sub-agents."
      />

      <div className="chat-shell">
        <div className="chat-list">
          {platform.mail.map((m) => (
            <button
              key={m.id}
              className={`chat-list-item${active?.id === m.id ? ' active' : ''}`}
              onClick={() => setSelected(m.id)}
            >
              <div className="cli-top">
                <strong>{m.subject.replace(/^\[[^\]]+\]\s*/, '')}</strong>
              </div>
              <span className="cli-subject">{m.from} → {m.to}</span>
              <span className="cli-meta">{m.at}</span>
            </button>
          ))}
          {platform.mail.length === 0 && <p className="empty">No messages yet.</p>}
        </div>

        {active && (
          <div className="chat-panel">
            <div className="chat-head">
              <div>
                <strong>{active.subject}</strong>
                <div className="muted-text">{active.from} → {active.to}</div>
              </div>
              <span className="enc-pill">auto-generated</span>
            </div>
            <div className="chat-messages" style={{ display: 'block' }}>
              <Card>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.6 }}>{active.body}</p>
                <div className="agent-stats" style={{ marginTop: 16 }}>
                  <span>Trigger: {active.trigger.replace(/-/g, ' ')}</span>
                  <span>Sent: {active.at}</span>
                  {active.voyageId && (
                    <Link className="link" to={`/voyages/${active.voyageId}`}>{active.voyageId} →</Link>
                  )}
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
