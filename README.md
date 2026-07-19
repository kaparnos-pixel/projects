# AusGlobal · Ship Agency Hub

*The HUB-agent operating system for global port calls.*

**AusGlobal Ship Agent Pty Ltd** is an asset-light global ship agency based in
Brisbane, Queensland. It operates as the **HUB agent** between three parties:

- **Principal** — ship owner, charterer, operator or ship-management company
- **AusGlobal Hub** — the HUB agent that coordinates and controls the port call
- **Sub-Agent** — a vetted local port agency that executes the call on the ground

This repository contains both halves of the product:

- a public **marketing website** (`website/`)
- the **operational platform** — a React SPA (`src/`) that runs the entire
  appointment → disbursement → funding → execution → settlement lifecycle.

## The lifecycle

Every port call is a **Voyage** with a unique Voyage ID. It moves through 13
stages grouped into four phases, and each transition is performed by exactly one
party, auto-generates an email and writes an audit entry:

| Phase | Stages | Who acts |
| ----- | ------ | -------- |
| **Appointment & PDA** | Appointed → Forwarded → PDA submitted → PDA vetted → PDA approved | Principal · Hub · Sub-Agent |
| **Funding & pre-funding** | Funded → Advance released | Principal · Hub |
| **Execution** | In port (live Statement of Facts) → Sailed | Sub-Agent |
| **FDA, audit & settlement** | FDA submitted → FDA audited → Invoiced → Settled & archived | Sub-Agent · Hub |

Key rules from the business model are enforced in the workflow:

- The sub-agent submits the **PDA** in a standardised Port DA format; lines over
  the pre-agreed port **tariff cap** are flagged automatically (EDI validation).
- The principal funds **100%** of the estimate into the central hub account; the
  hub **holds** the capital and releases **matching advances** to the sub-agent —
  never the full sum up front.
- The hub audits the **FDA line-by-line**, issues a **single unified invoice**,
  and refunds or credits any unused balance to the next voyage.
- Every document is archived against the **Voyage ID** in a central repository.

## Modules

| Route | Module | What it does |
| ----- | ------ | ------------ |
| `/` | Dashboard | Role-aware overview: what's awaiting you, funds held, pipeline. |
| `/voyages`, `/voyages/:id` | Voyages | The full port-call lifecycle with role-gated actions, PDA/FDA tables, SoF, funding ledger, documents & history. |
| `/reporting`, `/reporting/:type` | Sub-Agent Reporting | Digital reporting forms — Husbandry, General Agency, Protecting Agency, EPDA & FDA — each with a Generate form and an Archived view (filters + PDF/Excel export). Job-Code auto-fill, per-service grids, live cargo-ops tracking and an interruptions/laytime log. |
| `/sub-agents` | Sub-Agent Network | Sourcing, due-diligence (TRACE / FCPA / ISO 9001 / financials), SLA enlistment. |
| `/principals` | Principals | Owner / charterer / operator fleets under master SLA. |
| `/inbox` | Inbox | The platform's auto-generated emails across all parties. |
| `/repository` | Repository | Every document archived against its Voyage ID. |
| `/audit` | Audit trail | Hashed, filterable record of every action. |
| `/contracts` | Contracts & SLAs | Sub-agent frame agreement & principal master SLA drafts. |
| `/services` | Services portfolio | Port agency, OPA, husbandry and vessel life-cycle support. |
| `/admin/users` | Users | Workspace-owner account management. |

## Roles

Each account picks a role at sign-up: **Hub Manager**, **Principal** or
**Sub-Agent**. The lifecycle is role-gated — only the responsible party can
advance a given step — though the Hub Manager (who operates the platform) may act
on any party's behalf in this demo.

## Tech stack

- [Vite](https://vitejs.dev/) + [React 18](https://react.dev/) + TypeScript
- [React Router](https://reactrouter.com/) for client-side routing
- Hand-rolled CSS design system (no UI framework), maritime navy/amber theme

All state is mocked client-side and persisted to `localStorage` (seeded in
`src/data/seed.ts`, driven by `src/platform/PlatformContext.tsx`). Swap that
context for API calls to wire it to a real backend.

## Getting started

```bash
npm install
npm run dev      # start the dev server at http://localhost:5173
npm run build    # type-check and produce a production build in dist/
npm run preview  # preview the production build
```

Create an account on first launch (the first account on the device owns the
workspace). Use **Reset demo data** in the sidebar to restore the seeded state.

## Project structure

```
src/
  auth/        Authentication, roles & workspace ownership
  platform/    PlatformContext — the state engine & lifecycle actions
  components/  Layout, flow visuals, shared UI primitives
  pages/       One screen per module
  data/        Domain types, lifecycle definition, seed data, calculations
  styles/      Global stylesheet / design tokens
website/       Public marketing site (static HTML/CSS)
```
