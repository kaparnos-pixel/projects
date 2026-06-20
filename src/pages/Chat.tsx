import { useState } from 'react'
import { PageHeader } from '../components/ui'
import { conversations as seed } from '../data/mock'
import type { ChatMessage, Conversation } from '../data/types'

export default function Chat() {
  const [threads, setThreads] = useState<Conversation[]>(seed)
  const [activeId, setActiveId] = useState(seed[0].id)
  const [draft, setDraft] = useState('')

  const active = threads.find((t) => t.id === activeId)!

  function send() {
    const body = draft.trim()
    if (!body) return
    const msg: ChatMessage = {
      id: `m${Date.now()}`,
      author: 'You (Operator)',
      role: 'Operator',
      body,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      self: true,
    }
    setThreads((prev) =>
      prev.map((t) =>
        t.id === activeId
          ? { ...t, messages: [...t.messages, msg], lastActivity: 'just now', unread: 0 }
          : t,
      ),
    )
    setDraft('')
  }

  return (
    <div className="stack">
      <PageHeader
        title="Secure chat"
        subtitle="End-to-end encrypted, vessel-scoped messaging. Every exchange is recorded to the audit trail."
      />

      <div className="chat-shell">
        <aside className="chat-list">
          {threads.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`chat-list-item${t.id === activeId ? ' active' : ''}`}
              onClick={() => {
                setActiveId(t.id)
                setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, unread: 0 } : x)))
              }}
            >
              <div className="cli-top">
                <strong>{t.agentName}</strong>
                {t.unread > 0 && <span className="unread">{t.unread}</span>}
              </div>
              <span className="cli-subject">{t.subject}</span>
              <span className="cli-meta">
                {t.encrypted && '🔐 '}
                {t.lastActivity}
              </span>
            </button>
          ))}
        </aside>

        <section className="chat-panel">
          <header className="chat-head">
            <div>
              <strong>{active.agentName}</strong>
              <span className="muted-text"> · {active.subject}</span>
            </div>
            <span className="enc-pill">🔐 End-to-end encrypted</span>
          </header>

          <div className="chat-messages">
            {active.messages.map((m) => (
              <div key={m.id} className={`bubble-row${m.self ? ' self' : ''}`}>
                <div className="bubble">
                  <div className="bubble-author">
                    {m.author} <span className="role-tag">{m.role}</span>
                  </div>
                  <p>{m.body}</p>
                  <span className="bubble-time">{m.time}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="chat-compose">
            <input
              value={draft}
              placeholder={`Message ${active.agentName}…`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
            />
            <button type="button" className="btn btn-primary" onClick={send}>
              Send
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
