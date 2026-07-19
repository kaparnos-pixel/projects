// Sub-Agent digital reporting subsystem.
//
// On login a sub-agent chooses a reporting form from four menus:
//   Husbandry · General Agency · Protecting Agency · EPDA & FDA
// Each has a "Generate a Report" form and an "Archived Reports" view.
// This file defines the report data model, the option lists taken verbatim
// from the reporting specification, and a factory that auto-fills the header
// (ship, IMO, port, voyage) from the selected Job Code (a Voyage).

import type { Voyage } from './types'

export type ReportType = 'husbandry' | 'general-agency' | 'protecting-agency' | 'epda-fda'

export const reportTypeMeta: Record<
  ReportType,
  { label: string; short: string; icon: string; route: string }
> = {
  husbandry: {
    label: 'Husbandry Service',
    short: 'Crew, stores, CTM, bunkers and vessel husbandry - service by service.',
    icon: '🧑‍✈️',
    route: 'husbandry',
  },
  'general-agency': {
    label: 'General Agency',
    short: 'Full port call: milestones, live cargo ops, delays and Statement of Facts.',
    icon: '⚓',
    route: 'general-agency',
  },
  'protecting-agency': {
    label: 'Protecting Agency',
    short: 'Owner-appointed oversight of the nominated agent and disbursements.',
    icon: '🛡️',
    route: 'protecting-agency',
  },
  'epda-fda': {
    label: 'EPDA & FDA',
    short: 'Estimated and final disbursement accounts filed against the voyage.',
    icon: '🧾',
    route: 'epda-fda',
  },
}

// ---- Option lists (verbatim from the reporting spec) ----------------------

export const husbandryPurpose = [
  'Loading',
  'Discharging',
  'Bunkering Only',
  'Crew Change Only',
  'Drydocking',
  'Emergency',
]

export const husbandryServiceTypes = [
  'Crew Change (Sign-on / Sign-off)',
  'Fresh Water Supply',
  'Bunker Supply / Luboil Delivery',
  'Provisions & Bonded Stores',
  'Ship Spares Clearance & Delivery',
  'Cash to Master (CTM)',
  'Medical / Dental Assistance',
  'Sludge / Garbage Disposal',
  'Underwater Inspection / Hull Cleaning',
  'Other Service',
]

export const husbandryStatus = [
  'Awaiting Order',
  'Customs Clearing',
  'In Transit',
  'In Progress',
  'Completed',
]

export const placeOfServiceOptions = [
  'Berth',
  'Anchorage Zone',
  'Inner Harbor',
  'Outer Harbor',
]

export const generalPurpose = [
  'Loading',
  'Discharging',
  'Outer Anchorage STS (Ship-to-Ship)',
  'Lay-up',
  'Bunkering & Transit',
]

export const cargoOpsStatus = ['Working', 'Idle', 'Interrupted']

export const interruptionCategories = [
  'Weather Delays (rain, winds, swell, fog)',
  'Technical / Mechanical (ship gear, shore crane, conveyor)',
  'Logistics & Supply (barge, truck/rail, tank full)',
  'Labor Issues (shift change, strike, shortage)',
  'Port Authority (channel closure, shifting, priority vessel)',
]

export const laytimeImpact = ['Counts 100%', 'Counts 50%', 'Does Not Count']

export const generalAttachmentSlots = [
  'Notice of Readiness (NOR)',
  'Bill of Lading (B/L) & Cargo Manifest',
  'Mate’s Receipt',
  'Draft Survey Report',
  'Time Sheets / Port Log Copies',
]

// ---- Report data model -----------------------------------------------------

export interface ReportBase {
  id: string
  type: ReportType
  jobCode: string // = Voyage ID
  vessel: string
  imo: string
  captain: string
  voyageNo: string
  port: string
  country: string
  status: string
  createdAtLocal: string
  createdAtUtc: string
  submitted: boolean
  subAgentId: string | null
}

export interface HusbandryServiceLine {
  id: string
  serviceType: string
  status: string
  remark: string
  attachment: string | null
}

export interface HusbandryReport extends ReportBase {
  type: 'husbandry'
  purposeOfCall: string
  cargo: string
  arrival: { eosp: string; anchorDropped: string; norTendered: string }
  shifting: { anchorAweigh: string; pilotOnBoard: string; firstLineAshore: string; allFast: string }
  sailing: { cargoCompleted: string; documentsSigned: string; pilotDisembarked: string; cosp: string }
  placeOfService: string
  services: HusbandryServiceLine[]
  generalRemarks: string
  attachments: string[]
}

export interface CargoOpsRow {
  id: string
  label: string // shift / day label
  status: string
  qty24h: number
  cumulative: number
  remaining: number
  cranes: string
}

export interface InterruptionRow {
  id: string
  category: string
  from: string
  to: string
  laytime: string
}

export interface SofPin {
  id: string
  event: string
  at: string
}

export interface GeneralAgencyReport extends ReportBase {
  type: 'general-agency'
  purposeOfCall: string
  cargoType: string
  manifestedQty: string
  draftInitial: string
  draftFinal: string
  placeOfOperations: string
  arrival: { eta: string; actualArrival: string; eosp: string; anchored: string; norTendered: string; norAccepted: string }
  shifting: { pilotOnBoard: string; firstLineAshore: string; allFast: string; gangwayDown: string }
  sailing: { cargoCompleted: string; documentsSigned: string; linesCastOff: string; pilotDisembarked: string; cosp: string }
  cargoOps: CargoOpsRow[]
  interruptions: InterruptionRow[]
  sofPins: SofPin[]
  commercialRemarks: string
  attachments: Record<string, string> // slot label -> file name
}

export interface ProtectingAgencyReport extends ReportBase {
  type: 'protecting-agency'
  appointedBy: string
  nominatedAgent: string
  scope: string
  disbursementVerified: boolean
  findings: string
  remarks: string
  attachments: string[]
}

export interface EpdaFdaLine {
  id: string
  category: string
  amount: number
}

export interface EpdaFdaReport extends ReportBase {
  type: 'epda-fda'
  stage: 'EPDA' | 'FDA'
  currency: string
  lines: EpdaFdaLine[]
  remarks: string
  attachments: string[]
}

export type Report =
  | HusbandryReport
  | GeneralAgencyReport
  | ProtectingAgencyReport
  | EpdaFdaReport

// ---- Helpers ---------------------------------------------------------------

function stamps(): { local: string; utc: string } {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const local = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  const utc = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
  return { local, utc }
}

function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

export function reportRef(type: ReportType, jobCode: string): string {
  const code = { husbandry: 'HUS', 'general-agency': 'GA', 'protecting-agency': 'PA', 'epda-fda': 'DA' }[type]
  return `${code}-${jobCode.replace(/^AUS-/, '')}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`
}

// Build a fresh report of the given type, auto-filled from the selected Voyage.
export function newReport(type: ReportType, voyage: Voyage | undefined, subAgentId: string | null): Report {
  const s = stamps()
  const base: ReportBase = {
    id: rid('rep'),
    type,
    jobCode: voyage?.id ?? '',
    vessel: voyage?.vessel ?? '',
    imo: voyage?.imo ?? '',
    captain: '',
    voyageNo: voyage?.id ?? '',
    port: voyage?.port ?? '',
    country: voyage?.country ?? '',
    status: 'Open',
    createdAtLocal: s.local,
    createdAtUtc: s.utc,
    submitted: false,
    subAgentId,
  }
  switch (type) {
    case 'husbandry':
      return {
        ...base,
        type: 'husbandry',
        purposeOfCall: husbandryPurpose[0],
        cargo: voyage?.cargo ?? '',
        arrival: { eosp: '', anchorDropped: '', norTendered: '' },
        shifting: { anchorAweigh: '', pilotOnBoard: '', firstLineAshore: '', allFast: '' },
        sailing: { cargoCompleted: '', documentsSigned: '', pilotDisembarked: '', cosp: '' },
        placeOfService: placeOfServiceOptions[0],
        services: [{ id: rid('svc'), serviceType: husbandryServiceTypes[0], status: 'Awaiting Order', remark: '', attachment: null }],
        generalRemarks: '',
        attachments: [],
      }
    case 'general-agency':
      return {
        ...base,
        type: 'general-agency',
        purposeOfCall: generalPurpose[0],
        cargoType: '',
        manifestedQty: '',
        draftInitial: '',
        draftFinal: '',
        placeOfOperations: '',
        arrival: { eta: '', actualArrival: '', eosp: '', anchored: '', norTendered: '', norAccepted: '' },
        shifting: { pilotOnBoard: '', firstLineAshore: '', allFast: '', gangwayDown: '' },
        sailing: { cargoCompleted: '', documentsSigned: '', linesCastOff: '', pilotDisembarked: '', cosp: '' },
        cargoOps: [],
        interruptions: [],
        sofPins: [],
        commercialRemarks: '',
        attachments: {},
      }
    case 'protecting-agency':
      return {
        ...base,
        type: 'protecting-agency',
        appointedBy: '',
        nominatedAgent: '',
        scope: '',
        disbursementVerified: false,
        findings: '',
        remarks: '',
        attachments: [],
      }
    case 'epda-fda':
      return {
        ...base,
        type: 'epda-fda',
        stage: 'EPDA',
        currency: 'USD',
        lines: voyage
          ? voyage.daLines.map((l) => ({ id: rid('ln'), category: l.category, amount: l.proforma }))
          : [{ id: rid('ln'), category: 'Pilotage', amount: 0 }],
        remarks: '',
        attachments: [],
      }
  }
}

export { rid as reportRid }

// ---- Seed reports (so the archive is populated on first load) ---------------

export const seedReports: Report[] = [
  {
    id: 'rep-seed-1',
    type: 'husbandry',
    jobCode: 'AUS-2026-0039',
    vessel: 'MV North Star Pioneer',
    imo: '9488771',
    captain: 'Capt. R. Andersen',
    voyageNo: 'AUS-2026-0039',
    port: 'Houston',
    country: 'United States',
    status: 'Completed',
    createdAtLocal: '2026-06-25 16:20',
    createdAtUtc: '2026-06-25 21:20 UTC',
    submitted: true,
    subAgentId: 'sa-hou',
    purposeOfCall: 'Crew Change Only',
    cargo: '28,500 mt steel coils (discharge)',
    arrival: { eosp: '2026-06-25 03:40', anchorDropped: '-', norTendered: '2026-06-25 04:35' },
    shifting: { anchorAweigh: '-', pilotOnBoard: '2026-06-25 07:30', firstLineAshore: '2026-06-25 09:05', allFast: '2026-06-25 09:20' },
    sailing: { cargoCompleted: '', documentsSigned: '', pilotDisembarked: '', cosp: '' },
    placeOfService: 'Berth',
    services: [
      { id: 'svc-1', serviceType: 'Crew Change (Sign-on / Sign-off)', status: 'Completed', remark: '6 signers, visas & hotels arranged', attachment: 'immigration-stamps.pdf' },
      { id: 'svc-2', serviceType: 'Cash to Master (CTM)', status: 'Completed', remark: 'USD 15,000 delivered on board', attachment: 'ctm-receipt.pdf' },
      { id: 'svc-3', serviceType: 'Fresh Water Supply', status: 'In Progress', remark: 'Barge ordered for next tide', attachment: null },
    ],
    generalRemarks: 'All crew changes completed without delay. Port congestion moderate.',
    attachments: ['crew-list.pdf', 'BDN-0039.pdf'],
  },
  {
    id: 'rep-seed-2',
    type: 'general-agency',
    jobCode: 'AUS-2026-0035',
    vessel: 'MV Meridian Dawn',
    imo: '9421998',
    captain: 'Capt. S. Ibrahim',
    voyageNo: 'AUS-2026-0035',
    port: 'Singapore',
    country: 'Singapore',
    status: 'Completed',
    createdAtLocal: '2026-06-15 05:10',
    createdAtUtc: '2026-06-14 21:10 UTC',
    submitted: true,
    subAgentId: 'sa-sin',
    purposeOfCall: 'Discharging',
    cargoType: 'Coal',
    manifestedQty: '52,000 MT',
    draftInitial: '11.2 m',
    draftFinal: '6.4 m',
    placeOfOperations: 'Bulk Berth B3',
    arrival: { eta: '2026-06-12 00:00', actualArrival: '2026-06-12 01:40', eosp: '2026-06-12 01:50', anchored: '-', norTendered: '2026-06-12 02:20', norAccepted: '2026-06-12 03:00' },
    shifting: { pilotOnBoard: '2026-06-12 06:30', firstLineAshore: '2026-06-12 07:30', allFast: '2026-06-12 07:40', gangwayDown: '2026-06-12 08:10' },
    sailing: { cargoCompleted: '2026-06-14 18:30', documentsSigned: '2026-06-14 22:00', linesCastOff: '2026-06-15 02:50', pilotDisembarked: '2026-06-15 03:20', cosp: '2026-06-15 03:15' },
    cargoOps: [
      { id: 'co-1', label: 'Day 1', status: 'Working', qty24h: 24000, cumulative: 24000, remaining: 28000, cranes: 'Gantry 1,2,3' },
      { id: 'co-2', label: 'Day 2', status: 'Working', qty24h: 28000, cumulative: 52000, remaining: 0, cranes: 'Gantry 1,2,3,4' },
    ],
    interruptions: [
      { id: 'int-1', category: 'Weather Delays (rain, winds, swell, fog)', from: '2026-06-13 14:00', to: '2026-06-13 16:30', laytime: 'Does Not Count' },
    ],
    sofPins: [
      { id: 'sof-1', event: 'NOR Tendered', at: '2026-06-12 02:20' },
      { id: 'sof-2', event: 'Cargo Commenced', at: '2026-06-12 10:00' },
      { id: 'sof-3', event: 'Cargo Completed', at: '2026-06-14 18:30' },
    ],
    commercialRemarks: 'One Letter of Protest issued for rain stoppage. No cargo damage observed.',
    attachments: {
      'Notice of Readiness (NOR)': 'NOR-0035.pdf',
      'Draft Survey Report': 'draft-survey-0035.pdf',
      'Time Sheets / Port Log Copies': 'timesheet-0035.pdf',
    },
  },
]

