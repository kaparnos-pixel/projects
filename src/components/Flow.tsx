import { phaseMeta, stageMeta } from '../data/lifecycle'
import type { VoyagePhase, VoyageStage } from '../data/types'

const phaseOrder: VoyagePhase[] = ['appointment', 'funding', 'execution', 'settlement']

// The four-phase lifecycle strip, with the voyage's current phase highlighted.
export function PhaseStrip({ stage }: { stage?: VoyageStage }) {
  const activePhase = stage ? stageMeta[stage].phase : null
  return (
    <div className="flow-strip">
      {phaseOrder.map((p, i) => (
        <div className="flow-node-wrap" key={p}>
          <div className={`flow-node${activePhase === p ? ' is-active' : ''}`}>
            <span className="flow-icon" aria-hidden>
              {phaseMeta[p].icon}
            </span>
            <strong>{phaseMeta[p].label}</strong>
            <small>{phaseMeta[p].blurb}</small>
          </div>
          {i < phaseOrder.length - 1 && (
            <span className="flow-arrow" aria-hidden>
              →
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// The three-party relationship at the heart of the AusGlobal model.
export function PartyFlow() {
  return (
    <div className="party-flow">
      <div className="party party-principal">
        <span className="party-ico" aria-hidden>🚢</span>
        <strong>Principal</strong>
        <span>Owner · Charterer · Operator</span>
        <em>Appoints & funds</em>
      </div>
      <span className="party-link" aria-hidden>⇄</span>
      <div className="party party-hub">
        <span className="party-ico" aria-hidden>🛰️</span>
        <strong>AusGlobal Hub</strong>
        <span>The HUB agent</span>
        <em>Vets · holds funds · audits</em>
      </div>
      <span className="party-link" aria-hidden>⇄</span>
      <div className="party party-subagent">
        <span className="party-ico" aria-hidden>⚓</span>
        <strong>Sub-Agent</strong>
        <span>Vetted local port agency</span>
        <em>Executes the port call</em>
      </div>
    </div>
  )
}
