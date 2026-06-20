// The Agent Hub end-to-end flow, mirroring the BEACON appointment lifecycle.
// Each stage maps to a portal module / route.

export interface FlowStage {
  key: string
  label: string
  route: string
  blurb: string
  icon: string
}

export const flowStages: FlowStage[] = [
  {
    key: 'discovery',
    label: 'Discover',
    route: '/discovery',
    blurb: 'Search the verified directory and shortlist agents by port & service.',
    icon: '🔎',
  },
  {
    key: 'onboarding',
    label: 'Onboard',
    route: '/onboarding',
    blurb: 'KYC, sanctions screening and capability profiling before go-live.',
    icon: '🪪',
  },
  {
    key: 'chat',
    label: 'Secure chat',
    route: '/chat',
    blurb: 'End-to-end encrypted messaging tied to a vessel & call.',
    icon: '🔐',
  },
  {
    key: 'contracts',
    label: 'Negotiate',
    route: '/contracts',
    blurb: 'Draft, counter and execute appointment contracts with version history.',
    icon: '📝',
  },
  {
    key: 'port-calls',
    label: 'Coordinate',
    route: '/port-calls',
    blurb: 'Track the port call from nomination through departure.',
    icon: '⚓',
  },
  {
    key: 'audit',
    label: 'Audit',
    route: '/audit',
    blurb: 'Every action hashed to an immutable, exportable audit trail.',
    icon: '🧾',
  },
]
