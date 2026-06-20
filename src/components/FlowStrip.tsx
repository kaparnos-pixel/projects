import { useNavigate } from 'react-router-dom'
import { flowStages } from '../data/workflow'

// Horizontal lifecycle flow used on the dashboard, clickable stages
// that route into each Agent Hub module.
export default function FlowStrip({ activeKey }: { activeKey?: string }) {
  const navigate = useNavigate()

  return (
    <div className="flow-strip">
      {flowStages.map((stage, i) => (
        <div className="flow-node-wrap" key={stage.key}>
          <button
            type="button"
            className={`flow-node${stage.key === activeKey ? ' is-active' : ''}`}
            onClick={() => navigate(stage.route)}
          >
            <span className="flow-icon" aria-hidden>
              {stage.icon}
            </span>
            <strong>{stage.label}</strong>
            <small>{stage.blurb}</small>
          </button>
          {i < flowStages.length - 1 && (
            <span className="flow-arrow" aria-hidden>
              →
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
