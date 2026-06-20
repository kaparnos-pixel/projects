# BEACON · Agent Hub

The **Agent Hub** portal is the *Appointment* layer of the BEACON maritime
ecosystem. It gives operators, charterers, fleet managers and port-ops teams a
single place to discover agents, onboard them compliantly, communicate
securely, negotiate and store contracts, coordinate port calls, and keep an
auditable record of every interaction.

## The flow

The portal is organised around the appointment lifecycle:

```
Discover → Onboard → Secure chat → Negotiate → Coordinate → Audit
```

Each stage is a module in the portal:

| Stage        | Module               | What it does                                                        |
| ------------ | -------------------- | ------------------------------------------------------------------ |
| Discover     | Agent Discovery      | Search the verified directory by port, service and performance.    |
| Onboard      | Onboarding           | KYC, sanctions screening and capability profiling before go-live.  |
| Secure chat  | Secure Chat          | End-to-end encrypted, vessel-scoped messaging.                     |
| Negotiate    | Contracts            | Draft, counter and execute contracts with full version history.    |
| Coordinate   | Port Calls           | Track each call from nomination through departure.                 |
| Audit        | Auditable Comms      | Immutable, hash-chained trail of every action.                     |

## Tech stack

- [Vite](https://vitejs.dev/) + [React 18](https://react.dev/) + TypeScript
- [React Router](https://reactrouter.com/) for client-side routing
- Hand-rolled CSS design system (no UI framework) — maritime navy/amber theme

Data is mocked in `src/data/` so the portal runs entirely client-side. Swap
those modules for API calls to wire it to a backend.

## Getting started

```bash
npm install
npm run dev      # start the dev server at http://localhost:5173
npm run build    # type-check and produce a production build in dist/
npm run preview  # preview the production build
```

## Project structure

```
src/
  components/   Layout, FlowStrip, shared UI primitives
  pages/        One screen per Agent Hub module
  data/         Domain types, mock data, workflow definition
  styles/       Global stylesheet / design tokens
```
