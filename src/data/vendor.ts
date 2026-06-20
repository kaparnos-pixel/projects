// Vendor Dock — the supply side of BEACON. Domain model for the supplier
// marketplace, offers/quotations, disbursement-account tracking and SOF.

export type SupplierCategory =
  | 'Provisions & Stores'
  | 'Spare Parts'
  | 'Bunker Supply'
  | 'Surveys & Inspection'
  | 'Repairs & Riding Crew'
  | 'Waste & Slops'
  | 'Security & Escort'
  | 'Husbandry'

export interface Supplier {
  id: string
  company: string
  contact: string
  category: SupplierCategory
  port: string
  country: string
  countryCode: string
  rating: number
  reviews: number
  leadTimeDays: number
  verified: boolean
  featured: boolean
  about: string
}

export type OfferStatus = 'requested' | 'quoted' | 'accepted' | 'declined'

export interface OfferLine {
  description: string
  qty: number
  unit: string
}

export interface Offer {
  id: string
  supplierId: string
  supplierName: string
  category: SupplierCategory
  title: string
  vessel: string
  port: string
  neededBy: string
  lines: OfferLine[]
  note: string
  status: OfferStatus
  quoteAmount: number | null // set when supplier quotes
  currency: string
  createdAt: string
}

export type DAStatus = 'pro-forma' | 'submitted' | 'approved' | 'settled'

export interface DALine {
  id: string
  category: string
  description: string
  proforma: number
  actual: number | null
}

export interface DisbursementAccount {
  id: string
  ref: string
  vessel: string
  port: string
  party: string
  currency: string
  status: DAStatus
  lines: DALine[]
  updatedAt: string
}

export type SOFStatus = 'draft' | 'submitted'

export interface SOFEvent {
  id: string
  at: string // ISO-like "YYYY-MM-DD HH:mm"
  remark: string
}

export interface SOF {
  id: string
  ref: string
  vessel: string
  port: string
  berth: string
  voyage: string
  cargo: string
  status: SOFStatus
  events: SOFEvent[]
  submittedAt: string | null
}

export interface VendorState {
  offers: Offer[]
  das: DisbursementAccount[]
  sofs: SOF[]
}

// ---------------------------------------------------------------------------
// Seed data (UAE beachhead, consistent with Agent Hub)
// ---------------------------------------------------------------------------

export const suppliers: Supplier[] = [
  {
    id: 'sup-01',
    company: 'Gulf Provisions Trading',
    contact: 'Hassan Iqbal',
    category: 'Provisions & Stores',
    port: 'Jebel Ali',
    country: 'United Arab Emirates',
    countryCode: 'AE',
    rating: 4.8,
    reviews: 214,
    leadTimeDays: 1,
    verified: true,
    featured: true,
    about: 'Fresh and bonded provisions, cabin and deck stores delivered alongside across all Dubai ports.',
  },
  {
    id: 'sup-02',
    company: 'Fujairah Marine Spares',
    contact: 'Daniel Park',
    category: 'Spare Parts',
    port: 'Fujairah',
    country: 'United Arab Emirates',
    countryCode: 'AE',
    rating: 4.7,
    reviews: 168,
    leadTimeDays: 2,
    verified: true,
    featured: true,
    about: 'OEM and aftermarket engine, pump and electrical spares with customs clearance at Fujairah.',
  },
  {
    id: 'sup-03',
    company: 'East Coast Bunker Co.',
    contact: 'Omar Sayed',
    category: 'Bunker Supply',
    port: 'Fujairah',
    country: 'United Arab Emirates',
    countryCode: 'AE',
    rating: 4.6,
    reviews: 132,
    leadTimeDays: 1,
    verified: true,
    featured: false,
    about: 'VLSFO, LSMGO and HSFO barge supply at Fujairah OPL and anchorage with mass-flow metering.',
  },
  {
    id: 'sup-04',
    company: 'Khalifa Survey Partners',
    contact: 'Lena Fischer',
    category: 'Surveys & Inspection',
    port: 'Khalifa Port',
    country: 'United Arab Emirates',
    countryCode: 'AE',
    rating: 4.9,
    reviews: 97,
    leadTimeDays: 1,
    verified: true,
    featured: false,
    about: 'Draft, bunker, on/off-hire and cargo surveys across Abu Dhabi terminals; P&I approved.',
  },
  {
    id: 'sup-05',
    company: 'Sharjah Riding Crew Services',
    contact: 'Vikram Rao',
    category: 'Repairs & Riding Crew',
    port: 'Port Khalid',
    country: 'United Arab Emirates',
    countryCode: 'AE',
    rating: 4.5,
    reviews: 76,
    leadTimeDays: 3,
    verified: true,
    featured: false,
    about: 'Voyage-repair teams, fitters and riding crew for steel renewal and hot work underway.',
  },
  {
    id: 'sup-06',
    company: 'Hamriyah Waste Reception',
    contact: 'Aya Nakamura',
    category: 'Waste & Slops',
    port: 'Hamriyah',
    country: 'United Arab Emirates',
    countryCode: 'AE',
    rating: 4.4,
    reviews: 54,
    leadTimeDays: 2,
    verified: true,
    featured: false,
    about: 'MARPOL Annex I/IV/V waste and slops reception with compliant disposal certificates.',
  },
  {
    id: 'sup-07',
    company: 'Strait Security Maritime',
    contact: 'Idris Bello',
    category: 'Security & Escort',
    port: 'Fujairah',
    country: 'United Arab Emirates',
    countryCode: 'AE',
    rating: 4.6,
    reviews: 61,
    leadTimeDays: 4,
    verified: false,
    featured: false,
    about: 'Embarked security teams and escort coordination for high-risk-area transits ex-UAE.',
  },
  {
    id: 'sup-08',
    company: 'Singapore Stores Direct',
    contact: 'Mei Ling Tan',
    category: 'Provisions & Stores',
    port: 'Singapore',
    country: 'Singapore',
    countryCode: 'SG',
    rating: 4.8,
    reviews: 305,
    leadTimeDays: 1,
    verified: true,
    featured: false,
    about: 'Provisions and bonded stores at Singapore anchorages — expansion lane reference supplier.',
  },
]

const now = '2026-06-20'

export const seedState: VendorState = {
  offers: [
    {
      id: 'of-1001',
      supplierId: 'sup-01',
      supplierName: 'Gulf Provisions Trading',
      category: 'Provisions & Stores',
      title: 'Weekly provisions — MT Arabian Falcon',
      vessel: 'MT Arabian Falcon',
      port: 'Jebel Ali',
      neededBy: '2026-06-22',
      lines: [
        { description: 'Fresh provisions (vegetables, fruit, dairy)', qty: 1, unit: 'lot' },
        { description: 'Bonded stores (cigarettes, beverages)', qty: 1, unit: 'lot' },
      ],
      note: 'Deliver alongside Berth 14 before sailing.',
      status: 'quoted',
      quoteAmount: 4850,
      currency: 'USD',
      createdAt: '2026-06-18',
    },
    {
      id: 'of-1002',
      supplierId: 'sup-02',
      supplierName: 'Fujairah Marine Spares',
      category: 'Spare Parts',
      title: 'ME fuel pump spares — MT Gulf Pioneer',
      vessel: 'MT Gulf Pioneer',
      port: 'Fujairah',
      neededBy: '2026-06-25',
      lines: [
        { description: 'Fuel injection pump plunger & barrel', qty: 2, unit: 'set' },
        { description: 'O-ring & gasket kit', qty: 4, unit: 'kit' },
      ],
      note: 'OEM preferred; share maker certificate.',
      status: 'requested',
      quoteAmount: null,
      currency: 'USD',
      createdAt: '2026-06-19',
    },
    {
      id: 'of-1003',
      supplierId: 'sup-04',
      supplierName: 'Khalifa Survey Partners',
      category: 'Surveys & Inspection',
      title: 'Bunker survey — MV Emirates Trader',
      vessel: 'MV Emirates Trader',
      port: 'Khalifa Port',
      neededBy: '2026-06-21',
      lines: [{ description: 'Bunker quantity survey (ROB + delivered)', qty: 1, unit: 'job' }],
      note: 'Attend before and after bunkering.',
      status: 'accepted',
      quoteAmount: 1200,
      currency: 'USD',
      createdAt: '2026-06-16',
    },
  ],
  das: [
    {
      id: 'da-1',
      ref: 'DA-2026-0042',
      vessel: 'MT Arabian Falcon',
      port: 'Jebel Ali',
      party: 'Gulf Maritime Agencies LLC',
      currency: 'USD',
      status: 'submitted',
      updatedAt: now,
      lines: [
        { id: 'l1', category: 'Port Dues', description: 'Tonnage & berth dues', proforma: 8200, actual: 8450 },
        { id: 'l2', category: 'Pilotage', description: 'In/out pilotage', proforma: 3100, actual: 3100 },
        { id: 'l3', category: 'Towage', description: '2 tugs in/out', proforma: 4200, actual: 4600 },
        { id: 'l4', category: 'Agency Fee', description: 'Attendance & agency', proforma: 2900, actual: 2900 },
        { id: 'l5', category: 'Provisions', description: 'Fresh & bonded stores', proforma: 4850, actual: null },
      ],
    },
    {
      id: 'da-2',
      ref: 'DA-2026-0043',
      vessel: 'MV Emirates Trader',
      port: 'Khalifa Port',
      party: 'Khalifa Port Agency Group',
      currency: 'USD',
      status: 'pro-forma',
      updatedAt: now,
      lines: [
        { id: 'l1', category: 'Port Dues', description: 'Container terminal dues', proforma: 11200, actual: null },
        { id: 'l2', category: 'Pilotage', description: 'In/out pilotage', proforma: 2600, actual: null },
        { id: 'l3', category: 'Survey', description: 'Bunker quantity survey', proforma: 1200, actual: null },
      ],
    },
  ],
  sofs: [
    {
      id: 'sof-1',
      ref: 'SOF-2026-0019',
      vessel: 'MV Desert Star',
      port: 'Khorfakkan',
      berth: 'KCT Berth 3',
      voyage: 'V.214E',
      cargo: 'Containers — 1,100 TEU',
      status: 'draft',
      submittedAt: null,
      events: [
        { id: 'e1', at: '2026-06-20 22:00', remark: 'EOSP — End of sea passage' },
        { id: 'e2', at: '2026-06-20 22:30', remark: 'Pilot on board' },
        { id: 'e3', at: '2026-06-20 23:18', remark: 'All fast alongside, gangway down' },
        { id: 'e4', at: '2026-06-20 23:45', remark: 'NOR tendered and accepted' },
      ],
    },
  ],
}
