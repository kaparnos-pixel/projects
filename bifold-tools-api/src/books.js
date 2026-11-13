// Books: UAE VAT-compliant accounting and quotations, one set of books per company (Tech Hub, Bifold).
//
// Double-entry ledger built from documents. Every posted document carries its own journal lines ("gl") and its
// VAT return tags ("tax"), worked out here on the server when it is posted, so reports are a sum of what was posted.
//
//   Sales:      quote (no ledger) -> invoice (Tax Invoice) -> receipt (payment received); creditnote (Tax Credit Note)
//   Purchases:  po (no ledger) -> bill -> payment (payment made); vendorcredit; expense (paid on the spot)
//   Banking:    transfer between bank / cash accounts;  journal (manual journal, opening balances)
//
// Storage (Table Storage "books"):
//   PartitionKey "set-<co>"   RowKey "org"        company profile, TRN, bank details, numbering, lock date
//   PartitionKey "acct-<co>"  RowKey <code>       chart of accounts
//   PartitionKey "item-<co>"  RowKey uuid         products and services
//   PartitionKey "doc-<co>"   RowKey uuid         documents: header columns + gl/tax/allocs JSON + lines (packed)
//
// Compliance rules enforced here (checked against the VAT Decree-Law, Executive Regulation Arts. 59/60 as amended by
// Cabinet Decisions 100 of 2025 and 149 of 2026, Cabinet Decision 91 of 2023, FTA Decision 13 of 2026):
//   * Tax invoices and tax credit notes get a gapless sequential number when they are issued, never before.
//   * Issued tax invoices and credit notes can't be edited or deleted; they are corrected by a credit note or voided
//     (the number is kept and the void is logged). Nothing posted is ever deleted (5 years VAT, 7 years corporate tax).
//   * Nothing dated on or before the lock date (the last filed VAT period) can be created, changed or voided.
//   * VAT is worked out line by line at 5%, in AED, and tagged to the VAT 201 boxes (1a-1g by emirate, 3, 4, 5, 6, 9, 10).
//   * Input VAT on expenses paid in cash above the configured threshold is treated as not recoverable
//     (Cabinet Decision No. 149 of 2026, Article 54(3); the AED threshold is set by Ministerial Decision).
//
// Access: section "books" = full accounting. Section "quotes" = quotations only (sales staff).

const crypto = require("crypto");
const { BlobServiceClient } = require("@azure/storage-blob");

const EMIRATES = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"];
const BOX1 = { "Abu Dhabi": "1a", "Dubai": "1b", "Sharjah": "1c", "Ajman": "1d", "Umm Al Quwain": "1e", "Ras Al Khaimah": "1f", "Fujairah": "1g" };

const VAT = {
  SR: { name: "Standard rated 5%", rate: 5, sales: true, purch: true },
  ZR: { name: "Zero rated 0%", rate: 0, sales: true, purch: true },
  EX: { name: "Exempt", rate: 0, sales: true, purch: true },
  OS: { name: "Out of scope", rate: 0, sales: true, purch: true },
  RC: { name: "Reverse charge 5% (services from abroad)", rate: 5, sales: false, purch: true },
  IM: { name: "Import of goods 5% (via customs)", rate: 5, sales: false, purch: true },
  // Cabinet Decision No. 91 of 2023: mobile phones, smartphones, computers, tablets and their parts supplied between UAE
  // registrants for resale or manufacturing. The supplier doesn't charge VAT; the registered recipient accounts for it.
  DR: { name: "Domestic reverse charge 5% (electronic devices)", rate: 5, sales: true, purch: true },
};

const TYPES = {
  quote: { side: "sales", party: "customer", lines: true, ledger: false, prefix: "QT-", label: "Quotation", quoteOk: true },
  invoice: { side: "sales", party: "customer", lines: true, ledger: true, taxDoc: true, prefix: "INV-", label: "Tax invoice" },
  creditnote: { side: "sales", party: "customer", lines: true, ledger: true, taxDoc: true, credit: true, prefix: "CN-", label: "Tax credit note" },
  receipt: { side: "sales", party: "customer", pay: true, ledger: true, prefix: "RCT-", label: "Payment received" },
  po: { side: "purch", party: "vendor", lines: true, ledger: false, prefix: "PO-", label: "Purchase order" },
  bill: { side: "purch", party: "vendor", lines: true, ledger: true, prefix: "BILL-", label: "Bill" },
  vendorcredit: { side: "purch", party: "vendor", lines: true, ledger: true, credit: true, prefix: "VC-", label: "Vendor credit" },
  payment: { side: "purch", party: "vendor", pay: true, ledger: true, prefix: "PAY-", label: "Payment made" },
  expense: { side: "purch", party: "vendorOpt", lines: true, ledger: true, paidFrom: true, prefix: "EXP-", label: "Expense" },
  journal: { journal: true, ledger: true, prefix: "JV-", label: "Manual journal" },
  transfer: { transfer: true, ledger: true, prefix: "TRF-", label: "Transfer" },
};
// What a payment or credit can be applied to.
const APPLIES = { receipt: "invoice", creditnote: "invoice", payment: "bill", vendorcredit: "bill" };
const DRAFTABLE = new Set(["quote", "invoice", "creditnote", "po", "bill"]);
const OFFER_STATUS = ["draft", "sent", "accepted", "declined", "cancelled"]; // quote / po; "converted" is set by converting

const ACCT_TYPES = {
  bank: ["asset", "Bank"], cash: ["asset", "Cash"], receivable: ["asset", "Accounts receivable"], current_asset: ["asset", "Other current asset"],
  inventory: ["asset", "Stock"], fixed_asset: ["asset", "Fixed asset"], other_asset: ["asset", "Other asset"],
  payable: ["liability", "Accounts payable"], current_liability: ["liability", "Other current liability"], long_liability: ["liability", "Long-term liability"],
  equity: ["equity", "Equity"],
  income: ["income", "Income"], other_income: ["income", "Other income"],
  cogs: ["expense", "Cost of sales"], expense: ["expense", "Expense"], other_expense: ["expense", "Other expense"],
};
// Codes the posting rules rely on. They can be renamed but not removed or retyped.
const SYS = { AR: "1200", AP: "2000", VAT_IN: "1400", VAT_OUT: "2100", RE: "3200", OBE: "3900" };
const SYS_CODES = new Set(Object.values(SYS));

const DEFAULT_COA = [
  ["1000", "Petty Cash", "cash"], ["1010", "Cash in Hand", "cash"], ["1100", "Bank Current Account", "bank"],
  ["1200", "Accounts Receivable", "receivable"], ["1250", "PDCs Received", "current_asset"], ["1300", "Stock in Hand", "inventory"],
  ["1350", "Prepaid Expenses", "current_asset"], ["1360", "Advances to Suppliers", "current_asset"], ["1370", "Security Deposits Paid", "other_asset"],
  ["1400", "Input VAT Recoverable", "current_asset"],
  ["1500", "Furniture and Fixtures", "fixed_asset"], ["1510", "Computer Equipment", "fixed_asset"], ["1520", "Vehicles", "fixed_asset"], ["1590", "Accumulated Depreciation", "fixed_asset"],
  ["2000", "Accounts Payable", "payable"], ["2100", "Output VAT Payable", "current_liability"], ["2110", "VAT Settlement with FTA", "current_liability"],
  ["2200", "Accrued Expenses", "current_liability"], ["2210", "Salaries Payable", "current_liability"], ["2220", "Customer Advances", "current_liability"],
  ["2230", "PDCs Issued", "current_liability"], ["2240", "Corporate Tax Payable", "current_liability"],
  ["2300", "End of Service Benefits Provision", "long_liability"], ["2500", "Loan from Owner", "long_liability"],
  ["3000", "Share Capital", "equity"], ["3100", "Owner's Current Account", "equity"], ["3200", "Retained Earnings", "equity"], ["3900", "Opening Balance Equity", "equity"],
  ["4000", "Sales: Hardware", "income"], ["4010", "Sales: Software and Licences", "income"], ["4020", "Services: Installation", "income"], ["4030", "Services: AMC and Support", "income"],
  ["4900", "Other Income", "other_income"], ["4910", "Foreign Exchange Gain", "other_income"],
  ["5000", "Cost of Sales: Hardware", "cogs"], ["5010", "Cost of Sales: Software and Licences", "cogs"], ["5020", "Subcontractor Costs", "cogs"], ["5030", "Freight, Duty and Clearing", "cogs"],
  ["6000", "Salaries and Wages", "expense"], ["6010", "Visa and Labour Costs", "expense"], ["6020", "End of Service Benefits", "expense"],
  ["6100", "Rent", "expense"], ["6110", "Electricity and Water", "expense"], ["6120", "Telephone and Internet", "expense"],
  ["6200", "Marketing and Advertising", "expense"], ["6210", "Business Entertainment", "expense", 50], ["6300", "Travel and Transport", "expense"], ["6310", "Fuel and Vehicle Expenses", "expense"],
  ["6400", "Office Supplies", "expense"], ["6410", "Printing and Stationery", "expense"], ["6500", "Professional Fees", "expense"], ["6510", "Trade Licence and Government Fees", "expense"],
  ["6520", "Bank Charges", "expense"], ["6600", "Insurance", "expense"], ["6700", "Repairs and Maintenance", "expense"], ["6800", "Depreciation", "expense"],
  ["6900", "Bad Debts", "expense"], ["6950", "Miscellaneous Expenses", "expense"], ["6960", "Fines and Penalties", "expense", 100], ["6970", "Donations", "expense", 100],
  ["7000", "Foreign Exchange Loss", "other_expense"], ["8000", "Corporate Tax Expense", "other_expense", 100],
];

const DEFAULT_ORG = {
  techhub: { legalName: "Tech Hub Information Technology", emirate: "Ras Al Khaimah", address: "Blue Building, Injaz Road, Al Nakheel, Ras Al Khaimah, UAE", phone: "+971 7 258 1926", website: "www.techhubrak.ae" },
  bifold: { legalName: "Bifold Technologies L.L.C", emirate: "Dubai", address: "Office A306, Saraya Avenue, Al Garhoud, Dubai, UAE", phone: "", website: "www.bifoldtech.com" },
};
const MAX_LINES = 300;

module.exports = function makeBooks(H) {
  const { table, getOrNull, all, packJson, unpackJson, fail, clean, num, isDate, CO, rowCo, listCustomers, createCustomer, sup, diff, deals, amcGet } = H;
  const T = "books";
  const r2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
  const j = (s, d) => { try { const v = JSON.parse(s || ""); return v == null ? d : v; } catch { return d; } };
  const today = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

  // ---------- who may do what ----------
  const coOf = user => { if (user.co === "all") fail(400, "Books work one company at a time. Switch to Bifold or Tech Hub in the top bar."); return user.co; };
  const isAcct = user => user.isManager || (user.sections || []).includes("books");
  const needAcct = user => { if (!isAcct(user)) fail(403, "You can work on quotations only. Ask a manager for Books access to do anything else."); };
  const typeAllowed = (user, type) => isAcct(user) || (TYPES[type] && TYPES[type].quoteOk);

  // ---------- settings ----------
  const sPK = co => "set-" + co;
  function settingsOut(e, co) {
    const d = DEFAULT_ORG[co] || {};
    return {
      legalName: e && e.legalName || d.legalName || CO[co].name, tradeName: e && e.tradeName || "", trn: e && e.trn || "", vatRegistered: e ? e.vatRegistered !== false : true,
      address: e && e.address || d.address || "", emirate: e && e.emirate || d.emirate || "Dubai", phone: e && e.phone != null ? e.phone : d.phone || "",
      email: e && e.email || "", website: e && e.website != null ? e.website : d.website || "", licenceNo: e && e.licenceNo || "",
      bankName: e && e.bankName || "", bankAccountName: e && e.bankAccountName || "", iban: e && e.iban || "", swift: e && e.swift || "", bankAccountNo: e && e.bankAccountNo || "",
      fyStartMonth: Math.min(12, Math.max(1, num(e && e.fyStartMonth) || 1)), vatPeriod: e && e.vatPeriod || "quarterly", vatStagger: e && e.vatStagger || "jan",
      lockDate: e && e.lockDate || "", cashVatThreshold: num(e && e.cashVatThreshold),
      dueDays: e && e.dueDays != null ? num(e.dueDays) : 30, quoteValidDays: e && e.quoteValidDays != null ? num(e.quoteValidDays) : 30,
      invoiceTerms: e && e.invoiceTerms || "Payment is due by the due date shown. Please quote the invoice number with your payment.",
      quoteTerms: e && e.quoteTerms || "Prices are in AED and exclude VAT unless shown. Delivery subject to stock availability at the time of order.",
      poTerms: e && e.poTerms || "Please quote our PO number on your delivery note and tax invoice.",
      footer: e && e.footer || "", prefixes: { ...Object.fromEntries(Object.entries(TYPES).map(([k, t]) => [k, t.prefix])), ...j(e && e.prefixes, {}) },
      ctTrn: e && e.ctTrn || "", ct: j(e && e.ctData, {}),
      counters: j(e && e.counters, {}), etag: e && e.etag,
    };
  }
  async function loadSettings(co) { return settingsOut(await getOrNull(await table(T), sPK(co), "org"), co); }
  async function saveSettings(user, b) {
    needAcct(user);
    const co = coOf(user);
    const t = await table(T);
    const cur = await getOrNull(t, sPK(co), "org");
    const prev = settingsOut(cur, co);
    const f = {
      legalName: clean(b.legalName, 150), tradeName: clean(b.tradeName, 150), trn: clean(b.trn, 20).replace(/\s+/g, ""), vatRegistered: b.vatRegistered !== false,
      address: clean(b.address, 300), emirate: EMIRATES.includes(b.emirate) ? b.emirate : prev.emirate, phone: clean(b.phone, 40), email: clean(b.email, 150), website: clean(b.website, 150),
      licenceNo: clean(b.licenceNo, 50), bankName: clean(b.bankName, 100), bankAccountName: clean(b.bankAccountName, 150), iban: clean(b.iban, 40).replace(/\s+/g, "").toUpperCase(),
      swift: clean(b.swift, 15).toUpperCase(), bankAccountNo: clean(b.bankAccountNo, 40), fyStartMonth: Math.min(12, Math.max(1, Math.round(num(b.fyStartMonth) || 1))),
      vatPeriod: b.vatPeriod === "monthly" ? "monthly" : "quarterly", vatStagger: ["jan", "feb", "mar"].includes(b.vatStagger) ? b.vatStagger : "jan",
      cashVatThreshold: Math.max(0, r2(num(b.cashVatThreshold))), dueDays: Math.max(0, Math.min(365, Math.round(num(b.dueDays)))), quoteValidDays: Math.max(1, Math.min(365, Math.round(num(b.quoteValidDays) || 30))),
      ctTrn: clean(b.ctTrn, 20).replace(/\s+/g, ""),
      invoiceTerms: clean(b.invoiceTerms, 1500), quoteTerms: clean(b.quoteTerms, 3000), poTerms: clean(b.poTerms, 1500), footer: clean(b.footer, 300),
    };
    if (!f.legalName) fail(400, "Enter the company's legal name as it appears on the trade licence.");
    if (f.vatRegistered && !/^\d{15}$/.test(f.trn)) fail(400, "A UAE TRN has 15 digits. Enter it, or untick 'VAT registered' if the company isn't registered yet.");
    if (f.iban && !/^AE\d{21}$/.test(f.iban)) fail(400, "A UAE IBAN starts with AE followed by 21 digits.");
    const px = j(JSON.stringify(b.prefixes || {}), {}); const prefixes = {};
    for (const k of Object.keys(TYPES)) { const v = clean(px[k], 12).toUpperCase().replace(/[^A-Z0-9\-\/]/g, ""); prefixes[k] = v || TYPES[k].prefix; }
    f.prefixes = JSON.stringify(prefixes);
    // The lock date is a manager decision: it closes a period after its VAT return is filed.
    const lock = clean(b.lockDate, 10);
    if (lock !== prev.lockDate) {
      if (!user.isManager) fail(403, "Only a manager can change the lock date.");
      if (lock && !isDate(lock)) fail(400, "The lock date is not valid.");
      f.lockDate = lock;
      if (user.aud) user.aud.lock = lock || "removed";
    } else f.lockDate = prev.lockDate;
    const e = { partitionKey: sPK(co), rowKey: "org", ...f, counters: JSON.stringify(prev.counters), ctData: JSON.stringify(prev.ct), updatedBy: user.email, updatedAt: new Date().toISOString() };
    if (user.aud) user.aud.changes = diff(cur || {}, e);
    try {
      if (cur) await t.updateEntity(e, "Replace", { etag: b.etag || cur.etag });
      else await t.createEntity(e);
    } catch (err) { if (err.statusCode === 412 || err.statusCode === 409) fail(409, "The settings were changed by someone else. Reload and try again."); throw err; }
    return loadSettings(co);
  }
  // Corporate tax inputs for one financial year (keyed by its start date): the Small Business Relief election, losses
  // brought forward from before the books started, whether revenue went over AED 3M in a period before the books, and
  // manual adjustments the tax agent advises. Kept with the settings so the computation is the same for everyone.
  async function saveCt(user, b) {
    needAcct(user);
    const co = coOf(user);
    const year = clean(b.year, 10); if (!isDate(year)) fail(400, "Choose the financial year.");
    const adj = (Array.isArray(b.adj) ? b.adj : []).slice(0, 40).map(a => ({ label: clean(a.label, 150), amt: r2(Math.abs(num(a.amt))), kind: a.kind === "less" ? "less" : "add" })).filter(a => a.label && a.amt);
    const v = { sbr: !!b.sbr, priorOver3m: !!b.priorOver3m, lossBf: Math.max(0, r2(num(b.lossBf))), adj, note: clean(b.note, 1000), updatedBy: user.email, updatedAt: new Date().toISOString() };
    const t = await table(T);
    for (let i = 0; i < 5; i++) {
      const cur = await getOrNull(t, sPK(co), "org");
      const ct = { ...j(cur && cur.ctData, {}), [year]: v };
      if (user.aud) user.aud.name = "Corporate tax " + year.slice(0, 4);
      try {
        if (cur) await t.updateEntity({ partitionKey: sPK(co), rowKey: "org", ctData: JSON.stringify(ct) }, "Merge", { etag: cur.etag });
        else await t.createEntity({ partitionKey: sPK(co), rowKey: "org", ctData: JSON.stringify(ct) });
        return (await loadSettings(co)).ct;
      } catch (err) { if (err.statusCode !== 412 && err.statusCode !== 409) throw err; }
    }
    fail(409, "The settings kept changing. Try again.");
  }
  // Takes the next number for a document type. Retries if two people issue at the same moment.
  async function nextNumber(co, type) {
    const t = await table(T);
    for (let i = 0; i < 8; i++) {
      const cur = await getOrNull(t, sPK(co), "org");
      const s = settingsOut(cur, co);
      const n = (num(s.counters[type]) || 0) + 1;
      const counters = { ...s.counters, [type]: n };
      try {
        if (cur) await t.updateEntity({ partitionKey: sPK(co), rowKey: "org", counters: JSON.stringify(counters) }, "Merge", { etag: cur.etag });
        else await t.createEntity({ partitionKey: sPK(co), rowKey: "org", counters: JSON.stringify(counters) });
        return s.prefixes[type] + String(n).padStart(5, "0");
      } catch (err) { if (err.statusCode !== 412 && err.statusCode !== 409) throw err; }
    }
    fail(409, "Couldn't take the next number because others were issuing at the same time. Try again.");
  }

  // ---------- chart of accounts ----------
  const aPK = co => "acct-" + co;
  const acctOut = e => ({ code: e.rowKey, name: e.name, type: e.type, group: (ACCT_TYPES[e.type] || [])[0], description: e.description || "", active: e.active !== false, system: SYS_CODES.has(e.rowKey), ctPct: num(e.ctPct) });
  async function listAccounts(co) {
    const t = await table(T);
    let rows = await all(t, aPK(co));
    if (!rows.length) {
      // First use: lay down the standard UAE chart of accounts.
      const now = new Date().toISOString();
      const acts = DEFAULT_COA.map(([code, name, type, ctPct]) => ["upsert", { partitionKey: aPK(co), rowKey: code, name, type, ctPct: ctPct || 0, active: true, createdAt: now, createdBy: "system" }, "Replace"]);
      for (let i = 0; i < acts.length; i += 100) await t.submitTransaction(acts.slice(i, i + 100));
      rows = await all(t, aPK(co));
    }
    return rows.map(acctOut).sort((a, b) => a.code.localeCompare(b.code));
  }
  async function saveAccount(user, code, b) {
    needAcct(user);
    const co = coOf(user);
    const t = await table(T);
    const creating = !code;
    code = clean(creating ? b.code : code, 10);
    if (!/^\d{3,6}$/.test(code)) fail(400, "An account code is 3 to 6 digits.");
    const cur = await getOrNull(t, aPK(co), code);
    if (creating && cur) fail(409, `Code ${code} is already used by ${cur.name}.`);
    if (!creating && !cur) fail(404, "That account no longer exists.");
    const f = { name: clean(b.name, 100), type: String(b.type || ""), description: clean(b.description, 300), active: b.active !== false, ctPct: Math.min(100, Math.max(0, Math.round(num(b.ctPct)))) };
    if (!f.name) fail(400, "Enter the account name.");
    if (!ACCT_TYPES[f.type]) fail(400, "Choose an account type.");
    if (SYS_CODES.has(code)) { if (cur && f.type !== cur.type) fail(400, "This is a system account. You can rename it but not change its type."); f.active = true; }
    if (cur && f.type !== cur.type && (await usedAccounts(co)).has(code) && ACCT_TYPES[f.type][0] !== ACCT_TYPES[cur.type][0]) fail(400, "This account already has transactions, so it can't move to a different group (asset, liability, equity, income, expense).");
    const e = { partitionKey: aPK(co), rowKey: code, ...f, updatedBy: user.email, updatedAt: new Date().toISOString() };
    if (user.aud) { user.aud.name = `${code} ${f.name}`; if (cur) user.aud.changes = diff(cur, e); }
    if (creating) await t.createEntity({ ...e, createdBy: user.email, createdAt: e.updatedAt }); else await t.updateEntity(e, "Merge");
    return acctOut({ ...e });
  }
  async function deleteAccount(user, code) {
    needAcct(user);
    const co = coOf(user);
    const t = await table(T);
    const cur = await getOrNull(t, aPK(co), code);
    if (!cur) return;
    if (user.aud) user.aud.name = `${code} ${cur.name}`;
    if (SYS_CODES.has(code)) fail(400, "System accounts can't be deleted.");
    if ((await usedAccounts(co)).has(code)) fail(400, "This account has transactions or is used by an item. Mark it inactive instead.");
    await t.deleteEntity(aPK(co), code);
  }
  async function usedAccounts(co) {
    const used = new Set();
    (await all(await table(T), "doc-" + co, ["gl"])).forEach(e => j(e.gl, []).forEach(g => used.add(g[0])));
    (await all(await table(T), "item-" + co, ["salesAcct", "purchaseAcct"])).forEach(e => { used.add(e.salesAcct); used.add(e.purchaseAcct); });
    return used;
  }

  // ---------- items ----------
  const iPK = co => "item-" + co;
  const itemOut = e => ({ id: e.rowKey, sku: e.sku || "", name: e.name, kind: e.kind || "goods", unit: e.unit || "", brand: e.brand || "", description: e.description || "",
    salePrice: num(e.salePrice), purchasePrice: num(e.purchasePrice), vat: e.vat || "SR", salesAcct: e.salesAcct || "", purchaseAcct: e.purchaseAcct || "", active: e.active !== false,
    updatedAt: e.updatedAt, updatedBy: e.updatedBy, etag: e.etag });
  async function listItems(co) { return (await all(await table(T), iPK(co))).map(itemOut).sort((a, b) => a.name.localeCompare(b.name)); }
  function itemIn(b, accts) {
    const f = { sku: clean(b.sku, 60), name: clean(b.name, 200), kind: b.kind === "service" ? "service" : "goods", unit: clean(b.unit, 20), brand: clean(b.brand, 60), description: clean(b.description, 2000),
      salePrice: Math.max(0, r2(num(b.salePrice))), purchasePrice: Math.max(0, r2(num(b.purchasePrice))), vat: VAT[b.vat] && VAT[b.vat].sales ? b.vat : "SR",
      salesAcct: clean(b.salesAcct, 10), purchaseAcct: clean(b.purchaseAcct, 10), active: b.active !== false };
    if (!f.name) fail(400, "Enter the item name.");
    const A = new Map(accts.map(a => [a.code, a]));
    if (f.salesAcct && !["income", "other_income"].includes((A.get(f.salesAcct) || {}).type)) fail(400, "The sales account must be an income account.");
    if (f.purchaseAcct && !A.has(f.purchaseAcct)) fail(400, "Choose a valid purchase account.");
    return f;
  }
  async function saveItem(user, id, b) {
    needAcct(user);
    const co = coOf(user);
    const t = await table(T);
    const f = itemIn(b, await listAccounts(co));
    const dup = (await listItems(co)).find(x => x.id !== id && ((f.sku && x.sku.toLowerCase() === f.sku.toLowerCase()) || x.name.toLowerCase() === f.name.toLowerCase()));
    if (dup) fail(409, `${dup.name}${dup.sku ? " (" + dup.sku + ")" : ""} is already in the item list.`);
    const now = new Date().toISOString();
    if (!id) {
      const e = { partitionKey: iPK(co), rowKey: crypto.randomUUID(), ...f, createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now };
      await t.createEntity(e);
      return itemOut(e);
    }
    const cur = await getOrNull(t, iPK(co), id);
    if (!cur) fail(404, "This item no longer exists.");
    const e = { partitionKey: iPK(co), rowKey: id, ...f, updatedBy: user.email, updatedAt: now };
    if (user.aud) { user.aud.name = f.name; user.aud.changes = diff(cur, e); }
    try { await t.updateEntity(e, "Merge", { etag: b.etag || cur.etag }); } catch (err) { if (err.statusCode === 412) fail(409, "Someone else changed this item. Reload and try again."); throw err; }
    return itemOut(await t.getEntity(iPK(co), id));
  }
  async function importItems(user, b) {
    needAcct(user);
    const co = coOf(user);
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 2000) : [];
    if (!rows.length) fail(400, "The file has no item rows.");
    const t = await table(T), accts = await listAccounts(co), have = await listItems(co);
    const key = x => (x.sku || x.name).toLowerCase();
    const seen = new Map(have.map(x => [key(x), x]));
    const now = new Date().toISOString(); const acts = []; const invalid = []; let added = 0, updated = 0;
    rows.forEach((r, i) => {
      let f; try { f = itemIn({ ...r, vat: String(r.vat || "SR").toUpperCase() }, accts); } catch (e) { invalid.push({ row: i + 1, reason: e.message }); return; }
      const cur = seen.get(key(f));
      if (cur) { if (!b.update) return; acts.push(["update", { partitionKey: iPK(co), rowKey: cur.id, ...f, updatedBy: user.email, updatedAt: now }, "Merge"]); updated++; }
      else { const e = { partitionKey: iPK(co), rowKey: crypto.randomUUID(), ...f, createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now }; acts.push(["create", e]); seen.set(key(f), itemOut(e)); added++; }
    });
    for (let i = 0; i < acts.length; i += 100) await t.submitTransaction(acts.slice(i, i + 100));
    return { added, updated, invalid };
  }
  async function deleteItem(user, id) {
    needAcct(user);
    const co = coOf(user);
    const t = await table(T);
    const cur = await getOrNull(t, iPK(co), id);
    if (!cur) return;
    if (user.aud) user.aud.name = cur.name;
    // Items used on documents stay (the documents keep their own copy of each line); mark inactive to hide them.
    await t.deleteEntity(iPK(co), id);
  }

  // ---------- contacts (shared customer list, shared supplier list) ----------
  async function vendorsOf(user) {
    const rows = await all(await table("suppliers"), "supplier");
    return rows.filter(e => rowCo(e) === coOf(user)).map(e => ({ id: e.rowKey, name: e.name, trn: e.trn || "", address: e.address || "", emirate: e.emirate || "", country: e.country || "UAE",
      email: e.email || "", phone: e.phone || "", paymentTerms: e.paymentTerms || "", creditDays: num(e.creditDays), status: e.status || "active" })).sort((a, b) => a.name.localeCompare(b.name));
  }
  async function contactFor(user, kind, id) {
    if (kind === "customer") {
      const e = await getOrNull(await table("customers"), "customer", id);
      if (!e || rowCo(e) !== coOf(user)) fail(400, "That customer is no longer in the customer list. Choose another.");
      return { id, name: e.name, trn: e.trn || "", address: [e.address, e.emirate].filter(Boolean).join(", "), emirate: e.emirate || "", email: e.email || "", phone: e.phone || "", attention: e.contactName || "" };
    }
    const e = await getOrNull(await table("suppliers"), "supplier", id);
    if (!e || rowCo(e) !== coOf(user)) fail(400, "That supplier is no longer in the supplier list. Choose another.");
    if (e.status === "blocked") fail(400, `${e.name} is blocked in the supplier list.`);
    return { id, name: e.name, trn: e.trn || "", address: [e.address, e.emirate, e.country && e.country !== "UAE" ? e.country : ""].filter(Boolean).join(", "), emirate: e.emirate || "", country: e.country || "UAE", email: e.email || "", phone: e.phone || "", attention: "" };
  }

  // ---------- documents ----------
  const dPK = co => "doc-" + co;
  const HEAD = ["RowKey", "type", "number", "status", "date", "dueDate", "contactId", "contactName", "contactTrn", "ref", "subtotal", "vatAmt", "total", "amount", "account",
    "emirate", "allocs", "gl", "tax", "fromId", "toId", "sentAt", "voidReason", "createdBy", "createdAt", "updatedBy", "updatedAt", "title", "invoiceRef", "files", "internalNote", "internalBy", "internalAt", "dealId", "amcId", "amcRef"];
  function headOut(e) {
    return {
      id: e.rowKey || e.RowKey, type: e.type, number: e.number || "", status: e.status, date: e.date, dueDate: e.dueDate || "", contactId: e.contactId || "", contactName: e.contactName || "",
      contactTrn: e.contactTrn || "", ref: e.ref || "", subtotal: num(e.subtotal), vatAmt: num(e.vatAmt), total: num(e.total), amount: num(e.amount), account: e.account || "",
      emirate: e.emirate || "", allocs: j(e.allocs, []), gl: j(e.gl, []), tax: j(e.tax, []), fromId: e.fromId || "", toId: e.toId || "", sentAt: e.sentAt || "",
      voidReason: e.voidReason || "", createdBy: e.createdBy, createdAt: e.createdAt, updatedBy: e.updatedBy, updatedAt: e.updatedAt, title: e.title || "", invoiceRef: e.invoiceRef || "", fileCount: docFiles(e).length, internalNote: e.internalNote || "", internalBy: e.internalBy || "", internalAt: e.internalAt || "", dealId: e.dealId || "", amcId: e.amcId || "", amcRef: e.amcRef || "",
    };
  }
  async function allDocs(co) { return (await all(await table(T), dPK(co), HEAD)).map(headOut); }
  // Balance of every invoice / bill and the unapplied part of every payment / credit, from the non-void documents.
  function balances(docs) {
    const applied = new Map(); // target id -> paid
    const used = new Map(); // source id -> applied
    docs.forEach(d => { if (d.status !== "posted" || !APPLIES[d.type]) return; d.allocs.forEach(a => { applied.set(a.id, r2((applied.get(a.id) || 0) + num(a.amt))); used.set(d.id, r2((used.get(d.id) || 0) + num(a.amt))); }); });
    return { applied, used };
  }
  function statusView(d, bal, t0) {
    if (d.type === "invoice" || d.type === "bill") {
      if (d.status !== "posted") return d.status;
      const paid = bal.applied.get(d.id) || 0;
      if (paid >= d.total - 0.004) return "paid";
      if (d.dueDate && d.dueDate < t0) return "overdue";
      return paid > 0 ? "partial" : "open";
    }
    if (APPLIES[d.type]) { if (d.status !== "posted") return d.status; const left = (d.type === "receipt" || d.type === "payment" ? d.amount : d.total) - (bal.used.get(d.id) || 0); return left > 0.004 ? "unapplied" : "applied"; }
    if ((d.type === "quote" || d.type === "po") && ["draft", "sent"].includes(d.status) && d.dueDate && d.dueDate < t0) return "expired";
    return d.status;
  }
  function decorate(docs) {
    const bal = balances(docs), t0 = today();
    return docs.map(d => {
      const paid = bal.applied.get(d.id) || 0, used = bal.used.get(d.id) || 0;
      const base = d.type === "receipt" || d.type === "payment" ? d.amount : d.total;
      return { ...d, paid, balance: ["invoice", "bill"].includes(d.type) && d.status === "posted" ? r2(d.total - paid) : APPLIES[d.type] && d.status === "posted" ? r2(base - used) : 0, view: statusView(d, bal, t0) };
    });
  }

  // Lines: worked out the same way the page shows them. VAT per line, rounded to fils.
  function linesIn(raw, type, settings, accts) {
    const tp = TYPES[type];
    const A = new Map(accts.map(a => [a.code, a]));
    const list = (Array.isArray(raw) ? raw : []).filter(l => l && (clean(l.name, 300) || clean(l.description, 2000) || num(l.rate)));
    if (list.length > MAX_LINES) fail(400, `A document can have at most ${MAX_LINES} lines.`);
    return list.map((l, i) => {
      const o = {
        itemId: clean(l.itemId, 60), name: clean(l.name, 300), description: clean(l.description, 2000), qty: r2(num(l.qty === "" || l.qty == null ? 1 : l.qty) * 1000) / 1000 || 0,
        unit: clean(l.unit, 20), rate: Math.round(num(l.rate) * 10000) / 10000, discPct: Math.min(100, Math.max(0, r2(num(l.discPct)))), vat: String(l.vat || "SR"), account: clean(l.account, 10), blocked: !!l.blocked,
      };
      if (!o.name) fail(400, `Line ${i + 1} needs an item or description.`);
      if (!(o.qty > 0)) fail(400, `Line ${i + 1}: enter a quantity greater than zero.`);
      if (o.rate < 0) fail(400, `Line ${i + 1}: the rate can't be negative. Use a credit note for refunds.`);
      if (!VAT[o.vat] || (tp.side === "sales" && !VAT[o.vat].sales)) fail(400, `Line ${i + 1}: choose a VAT treatment.`);
      if (!settings.vatRegistered) o.vat = "OS";
      if (tp.side === "sales") { if (!o.account) o.account = "4000"; const a = A.get(o.account); if (!a || !["income", "other_income"].includes(a.type)) fail(400, `Line ${i + 1}: choose an income account.`); }
      else { if (!o.account) o.account = "6950"; const a = A.get(o.account); if (!a) fail(400, `Line ${i + 1}: choose an account.`); if (["receivable", "payable"].includes(a.type) || SYS_CODES.has(o.account) && o.account !== SYS.RE) fail(400, `Line ${i + 1}: ${a.name} can't be used on a line.`); }
      if (!(tp.side === "purch" && o.vat === "SR")) o.blocked = false;
      o.net = r2(o.qty * o.rate * (1 - o.discPct / 100));
      o.vatAmt = r2(o.net * VAT[o.vat].rate / 100);
      return o;
    });
  }

  // Journal lines and VAT return tags for a document. Amounts in AED. gl rows: [account, debit, credit, contactId, memo]
  function postingFor(d, lines, settings) {
    const gl = [], tax = [];
    const add = (acct, dr, cr, c, memo) => { dr = r2(dr); cr = r2(cr); if (dr || cr) gl.push([acct, dr, cr, c || "", memo || ""]); };
    const tag = (box, net, vat) => { const x = tax.find(t => t[0] === box); if (x) { x[1] = r2(x[1] + net); x[2] = r2(x[2] + vat); } else tax.push([box, r2(net), r2(vat)]); };
    const t = d.type, tp = TYPES[t], sign = tp.credit ? -1 : 1;
    const c = d.contactId;
    if (t === "invoice" || t === "creditnote") {
      const byAcct = new Map(); let vat = 0, total = 0;
      lines.forEach(l => { byAcct.set(l.account, r2((byAcct.get(l.account) || 0) + l.net)); const charged = l.vat === "DR" ? 0 : l.vatAmt; vat = r2(vat + charged); total = r2(total + l.net + charged);
        if (!settings.vatRegistered) return;
        if (l.vat === "SR") tag(BOX1[d.emirate] || "1f", sign * l.net, sign * l.vatAmt); else if (l.vat === "ZR") tag("4", sign * l.net, 0); else if (l.vat === "EX") tag("5", sign * l.net, 0);
        else if (l.vat === "DR") tag("DRS", sign * l.net, 0); }); // reverse-charge sales: the recipient accounts; listed separately for review
      if (sign > 0) { add(SYS.AR, total, 0, c); byAcct.forEach((v, a) => add(a, 0, v)); add(SYS.VAT_OUT, 0, vat); }
      else { add(SYS.AR, 0, total, c); byAcct.forEach((v, a) => add(a, v, 0)); add(SYS.VAT_OUT, vat, 0); }
    } else if (t === "bill" || t === "vendorcredit" || t === "expense") {
      let payable = 0; const dr = new Map(); let vatIn = 0, vatOutRc = 0;
      const put = (a, v) => dr.set(a, r2((dr.get(a) || 0) + v));
      lines.forEach(l => {
        if (l.vat === "SR" && !l.blocked) { put(l.account, l.net); vatIn = r2(vatIn + l.vatAmt); payable = r2(payable + l.net + l.vatAmt); if (settings.vatRegistered) tag("9", sign * l.net, sign * l.vatAmt); }
        else if (l.vat === "SR") { put(l.account, r2(l.net + l.vatAmt)); payable = r2(payable + l.net + l.vatAmt); }
        else if (l.vat === "RC" || l.vat === "IM" || l.vat === "DR") { put(l.account, l.net); payable = r2(payable + l.net);
          if (settings.vatRegistered) { vatIn = r2(vatIn + l.vatAmt); vatOutRc = r2(vatOutRc + l.vatAmt); tag(l.vat === "IM" ? "6" : "3", sign * l.net, sign * l.vatAmt); tag("10", sign * l.net, sign * l.vatAmt); } }
        else { put(l.account, l.net); payable = r2(payable + l.net); }
      });
      const credit = t === "expense" ? d.account : SYS.AP;
      if (sign > 0) { dr.forEach((v, a) => add(a, v, 0)); add(SYS.VAT_IN, vatIn, 0); add(SYS.VAT_OUT, 0, vatOutRc); add(credit, 0, payable, t === "expense" ? "" : c); }
      else { dr.forEach((v, a) => add(a, 0, v)); add(SYS.VAT_IN, 0, vatIn); add(SYS.VAT_OUT, vatOutRc, 0); add(credit, payable, 0, c); }
    } else if (t === "receipt") { add(d.account, d.amount, 0); add(SYS.AR, 0, d.amount, c); }
    else if (t === "payment") { add(SYS.AP, d.amount, 0, c); add(d.account, 0, d.amount); }
    else if (t === "transfer") { add(d.toAccount, d.amount, 0); add(d.account, 0, d.amount); }
    else if (t === "journal") lines.forEach(l => add(l.account, l.debit, l.credit, l.contactId, l.memo));
    const dr = r2(gl.reduce((a, g) => a + g[1], 0)), cr = r2(gl.reduce((a, g) => a + g[2], 0));
    if (Math.abs(dr - cr) > 0.005) fail(500, `The entry doesn't balance (debits ${dr}, credits ${cr}). Nothing was saved.`);
    return { gl, tax };
  }

  function journalLinesIn(raw, accts) {
    const A = new Map(accts.map(a => [a.code, a]));
    const list = (Array.isArray(raw) ? raw : []).filter(l => l && (l.account || num(l.debit) || num(l.credit)));
    if (list.length < 2) fail(400, "A journal needs at least two lines.");
    if (list.length > MAX_LINES) fail(400, `A journal can have at most ${MAX_LINES} lines.`);
    const out = list.map((l, i) => {
      const o = { account: clean(l.account, 10), debit: Math.max(0, r2(num(l.debit))), credit: Math.max(0, r2(num(l.credit))), memo: clean(l.memo, 200), contactId: clean(l.contactId, 60), contactName: clean(l.contactName, 150) };
      const a = A.get(o.account);
      if (!a) fail(400, `Line ${i + 1}: choose an account.`);
      if (o.debit && o.credit) fail(400, `Line ${i + 1}: enter a debit or a credit, not both.`);
      if (!o.debit && !o.credit) fail(400, `Line ${i + 1}: enter an amount.`);
      if ((a.type === "receivable" || a.type === "payable") && !o.contactId) fail(400, `Line ${i + 1}: choose the ${a.type === "receivable" ? "customer" : "supplier"} for ${a.name}.`);
      if (o.account === SYS.VAT_IN || o.account === SYS.VAT_OUT) o.memo = o.memo || "VAT adjustment";
      return o;
    });
    const dr = r2(out.reduce((a, l) => a + l.debit, 0)), cr = r2(out.reduce((a, l) => a + l.credit, 0));
    if (Math.abs(dr - cr) > 0.005) fail(400, `Debits (${dr.toFixed(2)}) and credits (${cr.toFixed(2)}) must be equal.`);
    return out;
  }

  const selfAccounted = l => l.vat === "RC" || l.vat === "IM" || l.vat === "DR";
  const trnOk = t => /^\d{15}$/.test(String(t || ""));
  const locked = (s, ...dates) => s.lockDate && dates.some(d => d && d <= s.lockDate);
  const lockMsg = s => `The books are locked up to ${s.lockDate} (a filed VAT period). Use a date after that, or ask a manager to move the lock date.`;

  // Reads and checks a document from the page. Returns the stored columns and the packed body.
  async function docIn(user, b, cur, ctx) {
    const type = cur ? cur.type : String(b.type || "");
    const tp = TYPES[type]; if (!tp) fail(400, "Unknown document type.");
    if (!typeAllowed(user, type)) needAcct(user);
    const { settings: s, accts } = ctx;
    const A = new Map(accts.map(a => [a.code, a]));
    const date = clean(b.date, 10) || today();
    if (!isDate(date)) fail(400, "The date is not valid.");
    const f = { type, date, ref: clean(b.ref, 80), title: clean(b.title, 150) };
    const body = { notes: clean(b.notes, 3000), terms: clean(b.terms, 4000) };
    if (tp.party === "customer" || tp.party === "vendor" || (tp.party === "vendorOpt" && b.contactId)) {
      const kind = tp.party === "customer" ? "customer" : "vendor";
      if (!b.contactId) fail(400, `Choose the ${kind === "customer" ? "customer" : "supplier"}.`);
      const c = await contactFor(user, kind, clean(b.contactId, 60));
      Object.assign(f, { contactId: c.id, contactName: c.name, contactTrn: c.trn });
      Object.assign(body, { contactAddress: c.address, contactEmail: c.email, contactPhone: c.phone, attention: clean(b.attention, 100) || c.attention, contactCountry: c.country || "" });
    } else Object.assign(f, { contactId: "", contactName: clean(b.payee, 150), contactTrn: "" });
    if (tp.lines) {
      const lines = linesIn(b.lines, type, s, accts);
      if (!lines.length) fail(400, "Add at least one line.");
      f.subtotal = r2(lines.reduce((a, l) => a + l.net, 0));
      f.vatAmt = r2(lines.reduce((a, l) => a + (selfAccounted(l) ? 0 : l.vatAmt), 0));
      f.total = r2(f.subtotal + f.vatAmt);
      body.lines = lines;
      body.vatNote = lines.some(l => l.vat === "DR") ? (tp.side === "sales" ? "Reverse charge: supply of electronic devices under Cabinet Decision No. 91 of 2023. VAT is not charged by the supplier; the recipient is required to account for the VAT." : "Domestic reverse charge (Cabinet Decision No. 91 of 2023): VAT on these electronic devices is accounted for by us as the recipient.")
        : lines.some(l => l.vat === "RC" || l.vat === "IM") ? "VAT on reverse charge lines is accounted for by the recipient." : "";
    }
    if (type === "quote" || type === "po") {
      f.dueDate = clean(b.dueDate, 10) || addDays(date, type === "quote" ? s.quoteValidDays : 14);
      if (!isDate(f.dueDate)) fail(400, type === "quote" ? "The valid-until date is not valid." : "The expected delivery date is not valid.");
      body.deliverTo = clean(b.deliverTo, 300); body.salesperson = clean(b.salesperson, 100);
    }
    if (type === "invoice" || type === "bill") {
      const days = type === "bill" ? (num(b.creditDays) || 30) : s.dueDays;
      f.dueDate = clean(b.dueDate, 10) || addDays(date, days);
      if (!isDate(f.dueDate) || f.dueDate < date) fail(400, "The due date must be on or after the document date.");
      body.supplyDate = clean(b.supplyDate, 10); if (body.supplyDate && !isDate(body.supplyDate)) fail(400, "The date of supply is not valid.");
      body.salesperson = clean(b.salesperson, 100); body.poRef = clean(b.poRef, 80);
    }
    if (type === "bill" && !f.ref) fail(400, "Enter the supplier's invoice number, so the bill can be matched to their tax invoice.");
    if (tp.side === "sales" && tp.lines) {
      f.emirate = EMIRATES.includes(b.emirate) ? b.emirate : s.emirate; // the emirate of the establishment the supply is reported under (VAT 201 box 1)
      body.placeOfSupply = clean(b.placeOfSupply, 60) || f.emirate;
    }
    if (type === "creditnote") {
      body.reason = clean(b.reason, 500); if (!body.reason) fail(400, "Say why the credit note is issued (for example returned goods or a price correction).");
      body.invoiceId = clean(b.invoiceId, 60); body.invoiceNo = ""; body.invoiceDate = "";
      // Art. 60: a tax credit note shows the original invoice, the value on it (after any earlier credit notes),
      // the corrected value, the difference and the VAT on the difference.
      if (!body.invoiceId && s.vatRegistered) fail(400, "Choose the tax invoice this credit note corrects. A tax credit note must refer to the original tax invoice.");
      if (body.invoiceId) {
        const inv = ctx.docs.find(x => x.id === body.invoiceId && x.type === "invoice" && x.status === "posted"); if (!inv) fail(400, "The original invoice wasn't found or isn't issued."); if (inv.contactId !== f.contactId) fail(400, "The original invoice is for a different customer.");
        body.invoiceNo = inv.number; body.invoiceDate = inv.date;
        const earlier = ctx.docs.filter(x => x.type === "creditnote" && x.status === "posted" && x.id !== (cur && cur.id) && x.invoiceRef === inv.id);
        body.origValue = r2(inv.subtotal - earlier.reduce((a, x) => a + x.subtotal, 0)); body.origVat = r2(inv.vatAmt - earlier.reduce((a, x) => a + x.vatAmt, 0));
        body.earlierCredits = earlier.map(x => x.number);
        if (f.subtotal > body.origValue + 0.004) fail(400, `The credit (AED ${f.subtotal.toFixed(2)} before VAT) is more than the AED ${body.origValue.toFixed(2)} left on ${inv.number}${earlier.length ? " after earlier credit notes" : ""}.`);
        body.newValue = r2(body.origValue - f.subtotal); body.newVat = r2(body.origVat - f.vatAmt);
        f.invoiceRef = inv.id;
      }
    }
    // A full tax invoice / credit note shows the recipient's name, address and TRN where the recipient is registered.
    // Whether this save ends with the document posted (new ledger documents post unless saved as a draft).
    const willPost = cur ? (cur.status === "posted" || b.status === "posted") : (tp.ledger && !(DRAFTABLE.has(type) && b.status === "draft"));
    if ((type === "invoice" || type === "creditnote") && s.vatRegistered && willPost) {
      if (f.contactTrn && !trnOk(f.contactTrn)) fail(400, `${f.contactName}'s TRN on file (${f.contactTrn}) isn't 15 digits. Correct it in Customers before issuing.`);
      if (f.contactTrn && !body.contactAddress) fail(400, `${f.contactName} is VAT registered, so the tax invoice must show their address. Add it in Customers before issuing.`);
    }
    if (tp.lines && tp.side === "sales" && body.lines.some(l => l.vat === "DR")) {
      if (!trnOk(f.contactTrn)) fail(400, "The reverse charge on electronic devices only applies when the customer is VAT registered. Record their 15-digit TRN, or charge VAT at 5%.");
      body.drDeclaration = !!b.drDeclaration;
      if (!body.drDeclaration && willPost && type !== "quote") fail(400, "Before applying the reverse charge, get the customer's written declaration that they are VAT registered and buy the devices to resell or to make electronic devices, then tick that it was received.");
    }
    if (type === "vendorcredit") { body.reason = clean(b.reason, 500); body.billId = clean(b.billId, 60); }
    if (type === "expense") {
      f.account = clean(b.account, 10);
      const a = A.get(f.account); if (!a || !["bank", "cash", "current_liability", "equity"].includes(a.type)) fail(400, "Choose the account the expense was paid from (bank, cash, a card or the owner's account).");
      if (!f.ref && body.lines.some(l => l.vat === "SR" && !l.blocked)) fail(400, "Enter the supplier's tax invoice or receipt number to claim the VAT.");
      // Input VAT on large cash payments is not recoverable (Art. 54(3)): the threshold is set in Settings once the Ministerial Decision is out.
      if (a.type === "cash" && s.cashVatThreshold > 0 && f.total > s.cashVatThreshold && body.lines.some(l => l.vat === "SR" && !l.blocked)) {
        body.lines.forEach(l => { if (l.vat === "SR") l.blocked = true; });
        body.cashBlocked = true;
      }
    }
    if (tp.pay) {
      f.amount = r2(num(b.amount)); if (!(f.amount > 0) || f.amount > 1e10) fail(400, "Enter the amount.");
      f.account = clean(b.account, 10);
      const a = A.get(f.account); if (!a || !["bank", "cash", "current_asset", "current_liability", "equity"].includes(a.type) || SYS_CODES.has(f.account)) fail(400, type === "receipt" ? "Choose the account the money went into (bank, cash or PDCs received)." : "Choose the account the money was paid from.");
      body.method = clean(b.method, 30) || "Bank transfer"; body.chequeNo = clean(b.chequeNo, 40); body.chequeDate = clean(b.chequeDate, 10); body.bankRef = clean(b.bankRef, 80);
      if (body.chequeDate && !isDate(body.chequeDate)) fail(400, "The cheque date is not valid.");
    }
    if (type === "transfer") {
      f.amount = r2(num(b.amount)); if (!(f.amount > 0)) fail(400, "Enter the amount.");
      f.account = clean(b.account, 10); body.toAccount = clean(b.toAccount, 10);
      const okT = c => A.get(c) && ["bank", "cash", "current_asset"].includes(A.get(c).type) && !SYS_CODES.has(c);
      if (!okT(f.account) || !okT(body.toAccount)) fail(400, "Choose the bank or cash accounts to move money between.");
      if (f.account === body.toAccount) fail(400, "Choose two different accounts.");
    }
    if (type === "journal") {
      body.jlines = journalLinesIn(b.lines, accts);
      body.opening = !!b.opening;
      f.total = r2(body.jlines.reduce((a, l) => a + l.debit, 0));
      if (!clean(b.notes, 3000)) fail(400, "Add a narration explaining the journal.");
    }
    // Input VAT is recoverable only on a tax invoice that shows the supplier's TRN.
    if (["bill", "vendorcredit", "expense"].includes(type) && s.vatRegistered && body.lines.some(l => l.vat === "SR" && !l.blocked)) {
      if (f.contactId && !trnOk(f.contactTrn)) fail(400, `${f.contactName} has no valid TRN on file, so the VAT can't be recovered. Add their 15-digit TRN in Suppliers, or tick "VAT not recoverable" on the lines.`);
      if (!f.contactId) { body.payeeTrn = clean(b.payeeTrn, 20).replace(/\s+/g, ""); if (!trnOk(body.payeeTrn)) fail(400, "Enter the 15-digit TRN printed on the payee's tax invoice to recover the VAT, or tick \"VAT not recoverable\"."); f.contactTrn = body.payeeTrn; }
    }
    if (APPLIES[type]) {
      const target = APPLIES[type];
      const allocs = (Array.isArray(b.allocs) ? b.allocs : []).map(a => ({ id: clean(a.id, 60), amt: r2(num(a.amt)) })).filter(a => a.id && a.amt > 0);
      const bal = balances(ctx.docs.filter(x => !cur || x.id !== cur.id));
      const cap = type === "receipt" || type === "payment" ? f.amount : f.total;
      let sum = 0;
      for (const a of allocs) {
        const t = ctx.docs.find(x => x.id === a.id);
        if (!t || t.type !== target || t.status !== "posted") fail(400, `A ${target} you applied this to isn't open any more. Reload and try again.`);
        if (t.contactId !== f.contactId) fail(400, `${t.number} belongs to a different ${tp.party === "customer" ? "customer" : "supplier"}.`);
        const open = r2(t.total - (bal.applied.get(t.id) || 0));
        if (a.amt > open + 0.004) fail(400, `${t.number} only has AED ${open.toFixed(2)} left to pay.`);
        sum = r2(sum + a.amt);
      }
      if (sum > cap + 0.004) fail(400, `You applied AED ${sum.toFixed(2)}, more than the ${type === "receipt" || type === "payment" ? "amount" : "credit"} of AED ${cap.toFixed(2)}.`);
      f.allocs = JSON.stringify(allocs);
    } else f.allocs = "[]";
    if (!tp.lines && !tp.pay && type !== "transfer") { f.subtotal = f.subtotal || 0; }
    return { f, body };
  }

  async function ctxFor(user) {
    const co = coOf(user);
    const [settings, accts, docs] = await Promise.all([loadSettings(co), listAccounts(co), allDocs(co)]);
    return { co, settings, accts, docs };
  }
  function postInto(f, body, settings) {
    const d = { ...f, toAccount: body.toAccount };
    const { gl, tax } = postingFor(d, TYPES[f.type].journal ? body.jlines : body.lines || [], settings);
    f.gl = JSON.stringify(gl); f.tax = JSON.stringify(tax);
  }
  const fullOut = e => ({ ...headOut(e), ...unpackJson(e), files: docFiles(e), etag: e.etag });

  async function getDoc(user, id) {
    const co = coOf(user);
    const e = await getOrNull(await table(T), dPK(co), id);
    if (!e) fail(404, "This document doesn't exist.");
    if (!typeAllowed(user, e.type)) needAcct(user);
    const docs = decorate(await allDocs(co));
    const d = docs.find(x => x.id === id);
    const out = { ...fullOut(e), paid: d.paid, balance: d.balance, view: d.view };
    // What this document was paid or credited by, and what it pays.
    if (["invoice", "bill"].includes(e.type)) out.payments = docs.filter(x => x.status === "posted" && APPLIES[x.type] === e.type && x.allocs.some(a => a.id === id)).map(x => ({ id: x.id, type: x.type, number: x.number, date: x.date, amt: x.allocs.filter(a => a.id === id).reduce((a, b) => a + b.amt, 0) }));
    if (APPLIES[e.type]) out.applied = j(e.allocs, []).map(a => { const t = docs.find(x => x.id === a.id); return { ...a, number: t ? t.number : "", date: t ? t.date : "", total: t ? t.total : 0 }; });
    if (e.type === "creditnote" || e.type === "vendorcredit") { const src = docs.find(x => x.id === out.invoiceId || x.id === out.billId); if (src) out.source = { id: src.id, number: src.number }; }
    return out;
  }
  function sameCo(e, co) { if (!e) fail(404, "This document doesn't exist."); return e; }

  async function createDoc(user, b) {
    const ctx = await ctxFor(user);
    const type = String(b.type || "");
    if (!TYPES[type]) fail(400, "Unknown document type.");
    if (!typeAllowed(user, type)) needAcct(user);
    const { f, body } = await docIn(user, b, null, ctx);
    const wantDraft = DRAFTABLE.has(type) && b.status === "draft";
    const now = new Date().toISOString();
    f.status = TYPES[type].ledger ? (wantDraft ? "draft" : "posted") : (OFFER_STATUS.includes(b.status) && b.status !== "cancelled" ? b.status : "draft");
    if (f.status === "posted" && locked(ctx.settings, f.date)) fail(400, lockMsg(ctx.settings));
    if (f.status === "posted") postInto(f, body, ctx.settings); else { f.gl = "[]"; f.tax = "[]"; }
    // Tax invoices and tax credit notes are numbered when issued; everything else when created.
    f.number = TYPES[type].taxDoc && f.status !== "posted" ? "" : await nextNumber(ctx.co, type);
    if (f.status === "posted") body.issuedAt = now, body.issuedBy = user.email;
    const fromId = clean(b.fromId, 60);
    const e = { partitionKey: dPK(ctx.co), rowKey: crypto.randomUUID(), ...f, fromId, toId: "", sentAt: f.status === "sent" ? now : "", voidReason: "", createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now, ...packJson(body) };
    const t = await table(T);
    await t.createEntity(e);
    // A converted quotation / PO points to what it became.
    if (fromId) { const src = ctx.docs.find(x => x.id === fromId); if (src && (src.type === "quote" || src.type === "po")) {
      await t.updateEntity({ partitionKey: dPK(ctx.co), rowKey: fromId, status: "converted", toId: e.rowKey }, "Merge").catch(() => {});
      if (src.type === "quote") { const q = await getOrNull(t, dPK(ctx.co), fromId); if (q && q.dealId) await syncDeal(user, q, `converted to invoice ${f.number || "(draft)"}`); } } }
    if (user.aud) user.aud.name = `${TYPES[type].label} ${f.number || "draft"}`;
    return getDoc(user, e.rowKey);
  }

  async function updateDoc(user, id, b) {
    const ctx = await ctxFor(user);
    const t = await table(T);
    const cur = sameCo(await getOrNull(t, dPK(ctx.co), id), ctx.co);
    const tp = TYPES[cur.type];
    if (!typeAllowed(user, cur.type)) needAcct(user);
    if (cur.status === "void") fail(400, "This document is void and can't be changed.");
    if (tp.taxDoc && cur.status === "posted") fail(400, `An issued ${tp.label.toLowerCase()} can't be changed. Issue a credit note for the difference, or void it and issue a new one.`);
    if (cur.type === "creditnote" || cur.type === "vendorcredit") { if (cur.status === "posted") fail(400, "An issued credit can't be changed. Use Apply credit, or void it."); }
    const { f, body } = await docIn(user, b, cur, ctx);
    let status = cur.status;
    if (tp.ledger) { if (cur.status === "draft" && b.status === "posted") status = "posted"; }
    else if (cur.status === "converted") status = "converted"; // a converted quotation / PO stays linked to what it became
    else if (OFFER_STATUS.includes(b.status)) status = b.status;
    if ((status === "posted" && locked(ctx.settings, f.date)) || (cur.status === "posted" && locked(ctx.settings, cur.date))) fail(400, lockMsg(ctx.settings));
    if (f.contactId !== cur.contactId && j(cur.allocs, []).length) fail(400, "Remove the invoices this is applied to before changing the customer or supplier.");
    // A bill can't drop below what's already been paid on it.
    if (cur.status === "posted" && (cur.type === "bill" || cur.type === "invoice")) {
      const paid = balances(ctx.docs).applied.get(id) || 0;
      if (f.total < paid - 0.004) fail(400, `AED ${paid.toFixed(2)} has already been paid on this ${cur.type}. The total can't go below that.`);
      if (paid > 0 && f.contactId !== cur.contactId) fail(400, "Payments are already applied, so the supplier can't change.");
    }
    const old = unpackJson(cur);
    f.status = status;
    if (status === "posted") postInto(f, body, ctx.settings); else { f.gl = "[]"; f.tax = "[]"; }
    f.number = cur.number || (tp.taxDoc && status !== "posted" ? "" : await nextNumber(ctx.co, cur.type));
    if (status === "posted" && cur.status !== "posted") { body.issuedAt = new Date().toISOString(); body.issuedBy = user.email; } else { body.issuedAt = old.issuedAt; body.issuedBy = old.issuedBy; }
    const next = { partitionKey: dPK(ctx.co), rowKey: id, ...f, files: cur.files || "[]", internalNote: cur.internalNote || "", internalBy: cur.internalBy || "", internalAt: cur.internalAt || "", dealId: cur.dealId || "", amcId: cur.amcId || "", amcRef: cur.amcRef || "", fromId: cur.fromId || "", toId: cur.toId || "", sentAt: cur.sentAt || (status === "sent" ? new Date().toISOString() : ""), voidReason: "", createdBy: cur.createdBy, createdAt: cur.createdAt,
      updatedBy: user.email, updatedAt: new Date().toISOString(), ...packJson(body) };
    if (user.aud) { user.aud.name = `${tp.label} ${f.number || "draft"}`; user.aud.changes = diff(cur, next); if (status === "posted" && cur.status !== "posted") user.aud.issued = true; }
    try { await t.updateEntity(next, "Replace", { etag: b.etag || cur.etag }); }
    catch (err) { if (err.statusCode === 412) fail(409, "Someone else changed this document after you opened it. Reload it and make your change again."); throw err; }
    if (cur.type === "quote" && cur.dealId) await syncDeal(user, next, status !== cur.status ? `marked ${status}` : `revised to AED ${num(next.subtotal).toLocaleString("en-US", { minimumFractionDigits: 2 })} before VAT`);
    return getDoc(user, id);
  }

  // Credit notes and vendor credits: change what they're applied to without touching the entry.
  async function applyCredit(user, id, b) {
    needAcct(user);
    const ctx = await ctxFor(user);
    const t = await table(T);
    const cur = sameCo(await getOrNull(t, dPK(ctx.co), id), ctx.co);
    if (!APPLIES[cur.type] || cur.status !== "posted") fail(400, "Only issued credits and payments can be applied.");
    const target = APPLIES[cur.type];
    const allocs = (Array.isArray(b.allocs) ? b.allocs : []).map(a => ({ id: clean(a.id, 60), amt: r2(num(a.amt)) })).filter(a => a.id && a.amt > 0);
    const bal = balances(ctx.docs.filter(x => x.id !== id));
    const cap = cur.type === "receipt" || cur.type === "payment" ? num(cur.amount) : num(cur.total);
    let sum = 0;
    for (const a of allocs) {
      const x = ctx.docs.find(d => d.id === a.id);
      if (!x || x.type !== target || x.status !== "posted" || x.contactId !== cur.contactId) fail(400, `One of the ${target}s isn't open for this ${target === "invoice" ? "customer" : "supplier"} any more.`);
      const open = r2(x.total - (bal.applied.get(x.id) || 0));
      if (a.amt > open + 0.004) fail(400, `${x.number} only has AED ${open.toFixed(2)} left.`);
      sum = r2(sum + a.amt);
    }
    if (sum > cap + 0.004) fail(400, `That's AED ${sum.toFixed(2)}, more than the AED ${cap.toFixed(2)} available.`);
    if (user.aud) { user.aud.name = `${TYPES[cur.type].label} ${cur.number}`; user.aud.changes = allocs.map(a => `${(ctx.docs.find(d => d.id === a.id) || {}).number}: AED ${a.amt.toFixed(2)}`); }
    try { await t.updateEntity({ partitionKey: dPK(ctx.co), rowKey: id, allocs: JSON.stringify(allocs), updatedBy: user.email, updatedAt: new Date().toISOString() }, "Merge", { etag: cur.etag }); }
    catch (err) { if (err.statusCode === 412) fail(409, "This changed while you were applying it. Reload and try again."); throw err; }
    return getDoc(user, id);
  }

  async function voidDoc(user, id, b) {
    const ctx = await ctxFor(user);
    const t = await table(T);
    const cur = sameCo(await getOrNull(t, dPK(ctx.co), id), ctx.co);
    const tp = TYPES[cur.type];
    if (!typeAllowed(user, cur.type)) needAcct(user);
    if (user.aud) user.aud.name = `${tp.label} ${cur.number || "draft"}`;
    if (!tp.ledger) {
      if (cur.status === "converted") fail(400, "This has been converted. Void the document it became instead.");
      await t.updateEntity({ partitionKey: dPK(ctx.co), rowKey: id, status: "cancelled", voidReason: clean(b.reason, 300), updatedBy: user.email, updatedAt: new Date().toISOString() }, "Merge");
      if (cur.type === "quote" && cur.dealId) await syncDeal(user, { ...cur, status: "cancelled" }, `cancelled (${clean(b.reason, 120)})`);
      return getDoc(user, id);
    }
    if (cur.status !== "posted") fail(400, "Only posted documents can be voided. Delete a draft instead.");
    if (locked(ctx.settings, cur.date)) fail(400, lockMsg(ctx.settings));
    const reason = clean(b.reason, 300); if (!reason) fail(400, "Say why it is being voided. The reason is kept with the document.");
    if (["invoice", "bill"].includes(cur.type)) {
      const by = ctx.docs.filter(x => x.status === "posted" && APPLIES[x.type] === cur.type && x.allocs.some(a => a.id === id));
      if (by.length) fail(400, `Payments or credits are applied to this ${cur.type} (${by.map(x => x.number).join(", ")}). Remove them first.`);
    }
    if (user.aud) user.aud.changes = [reason];
    await t.updateEntity({ partitionKey: dPK(ctx.co), rowKey: id, status: "void", gl: "[]", tax: "[]", allocs: "[]", voidReason: reason, voidedBy: user.email, voidedAt: new Date().toISOString(), updatedBy: user.email, updatedAt: new Date().toISOString() }, "Merge", { etag: cur.etag })
      .catch(err => { if (err.statusCode === 412) fail(409, "This changed while you were voiding it. Reload and try again."); throw err; });
    // A void quote link: let the quotation be converted again.
    if (cur.fromId) await t.updateEntity({ partitionKey: dPK(ctx.co), rowKey: cur.fromId, status: "accepted", toId: "" }, "Merge").catch(() => {});
    return getDoc(user, id);
  }

  async function deleteDoc(user, id) {
    const co = coOf(user);
    const t = await table(T);
    const cur = await getOrNull(t, dPK(co), id);
    if (!cur) return;
    if (!typeAllowed(user, cur.type)) needAcct(user);
    const tp = TYPES[cur.type];
    if (user.aud) user.aud.name = `${tp.label} ${cur.number || "draft"}`;
    if (tp.ledger && cur.status !== "draft") fail(400, "Posted documents are kept for the FTA record rules (5 years for VAT, 7 years for corporate tax). Void it instead.");
    if (cur.status === "converted") fail(400, "This has been converted, so it's kept. Cancel it instead.");
    if (!tp.ledger && cur.createdBy !== user.email && !user.isManager && !isAcct(user)) fail(403, "Only the person who created this or an accountant can delete it.");
    await t.deleteEntity(dPK(co), id);
    const fl = docFiles(cur); if (fl.length) { const c = await blobs(); await Promise.all(fl.map(x => c.deleteBlob(x.id).catch(() => {}))); }
  }

  // ---------- attachments: customer POs, supplier invoices, receipts, delivery notes, photos (Blob Storage "books-files") ----------
  // The list lives in the document row's "files" column. Anyone who can open the document can view and add files;
  // the person who added a file, an accountant or a manager can remove it. Removing a file from a posted document is
  // limited to managers, because supporting documents are part of the tax records.
  const FILE_MAX = 10 * 1048576, FILES_MAX = 40;
  const FILE_KINDS = { po: "Customer PO", quote: "Supplier quotation", invoice: "Supplier tax invoice", receipt: "Receipt", delivery: "Delivery note", contract: "Contract / LPO", declaration: "Customer declaration", payment: "Payment proof", photo: "Photo", other: "Other" };
  function docFiles(e) { try { const a = JSON.parse(e.files || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } }
  let container;
  async function blobs() {
    if (!container) { const cs = process.env.STORAGE_CONNECTION; if (!cs) fail(500, "Storage is not set up yet."); const c = BlobServiceClient.fromConnectionString(cs).getContainerClient("books-files"); await c.createIfNotExists(); container = c; }
    return container;
  }
  async function loadForFiles(user, id) {
    const co = coOf(user);
    const e = await getOrNull(await table(T), dPK(co), id);
    if (!e) fail(404, "This document doesn't exist.");
    if (!typeAllowed(user, e.type)) needAcct(user);
    return { co, e };
  }
  async function changeFiles(user, id, fn) {
    const t = await table(T);
    for (let i = 0; i < 4; i++) {
      const { co, e } = await loadForFiles(user, id);
      const files = fn(docFiles(e), e);
      try { await t.updateEntity({ partitionKey: dPK(co), rowKey: id, files: JSON.stringify(files) }, "Merge", { etag: e.etag }); return files; }
      catch (err) { if (err.statusCode !== 412) throw err; }
    }
    fail(409, "The attachments were changed by someone else at the same time. Try again.");
  }
  async function addFile(user, id, b) {
    const { co, e } = await loadForFiles(user, id);
    if (user.co === "all") fail(400, "Switch to a company to add files.");
    if (docFiles(e).length >= FILES_MAX) fail(400, `A document can hold at most ${FILES_MAX} files.`);
    const name = clean(b.name, 200).replace(/[\\/\u0000-\u001f]/g, "_") || "file", type = clean(b.type, 120) || "application/octet-stream";
    const buf = Buffer.from(String(b.data || ""), "base64");
    if (!buf.length) fail(400, `${name} is empty.`);
    if (buf.length > FILE_MAX) fail(413, `${name} is larger than 10 MB.`);
    const fid = crypto.randomUUID();
    await (await blobs()).getBlockBlobClient(fid).uploadData(buf, { blobHTTPHeaders: { blobContentType: type }, metadata: { name: encodeURIComponent(name), doc: id, co } });
    const f = { id: fid, kind: FILE_KINDS[b.kind] ? b.kind : "other", name, type, size: buf.length, note: clean(b.note, 200), by: user.email, at: new Date().toISOString() };
    if (user.aud) { user.aud.name = name; user.aud.changes = [`${TYPES[e.type].label} ${e.number || "draft"}`]; }
    try { const files = await changeFiles(user, id, l => { if (l.length >= FILES_MAX) fail(400, `A document can hold at most ${FILES_MAX} files.`); return l.concat(f); }); return { file: f, files }; }
    catch (err) { await (await blobs()).deleteBlob(fid).catch(() => {}); throw err; }
  }
  async function removeFile(user, id, fid) {
    let gone = null;
    const files = await changeFiles(user, id, (l, e) => {
      gone = l.find(x => x.id === fid); if (!gone) fail(404, "That file is no longer attached.");
      if (user.aud) { user.aud.name = gone.name; user.aud.changes = [`${TYPES[e.type].label} ${e.number || "draft"}`]; }
      if (e.status === "posted" && !user.isManager) fail(403, "This document is posted, so its supporting files are part of the tax records. Only a manager can remove them.");
      if (gone.by !== user.email && !isAcct(user) && !user.isManager) fail(403, "Only the person who added this file, an accountant or a manager can remove it.");
      return l.filter(x => x.id !== fid);
    });
    await (await blobs()).deleteBlob(fid).catch(() => {});
    return { files };
  }
  async function getFile(user, id, fid, download) {
    const { e } = await loadForFiles(user, id);
    const f = docFiles(e).find(x => x.id === fid); if (!f) fail(404, "That file is no longer attached.");
    if (user.aud) { user.aud.name = f.name; user.aud.changes = [`${TYPES[e.type].label} ${e.number || "draft"}`]; }
    let buf; try { buf = await (await blobs()).getBlockBlobClient(fid).downloadToBuffer(); } catch (err) { if (err.statusCode === 404) fail(404, "That file is no longer available."); throw err; }
    const inline = !download && /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(f.type);
    return { __binary: buf, headers: { "Content-Type": inline ? f.type : "application/octet-stream", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } };
  }
  async function editFile(user, id, fid, b) {
    const files = await changeFiles(user, id, (l, e) => { const x = l.find(y => y.id === fid); if (!x) fail(404, "That file is no longer attached."); if (user.aud) { user.aud.name = x.name; user.aud.changes = [`${TYPES[e.type].label} ${e.number || "draft"}`]; }
      return l.map(y => y.id === fid ? { ...y, kind: FILE_KINDS[b.kind] ? b.kind : y.kind, note: b.note != null ? clean(b.note, 200) : y.note } : y); });
    return { files };
  }

  // Internal notes: for the team only, never printed, editable on any document in any status (issued, paid,
  // converted, void, locked period), because they don't change the document or the ledger.
  async function saveInternal(user, id, b) {
    const co = coOf(user);
    const t = await table(T);
    const cur = await getOrNull(t, dPK(co), id);
    if (!cur) fail(404, "This document doesn't exist.");
    if (!typeAllowed(user, cur.type)) needAcct(user);
    const note = clean(b.internalNote, 3000);
    if (user.aud) { user.aud.name = `${TYPES[cur.type].label} ${cur.number || "draft"}`; user.aud.changes = [note ? "internal note: " + note.slice(0, 80) : "internal note cleared"]; }
    await t.updateEntity({ partitionKey: dPK(co), rowKey: id, internalNote: note, internalBy: user.email, internalAt: new Date().toISOString() }, "Merge");
    return getDoc(user, id);
  }

  // ---------- Sales Pipeline link: a quotation becomes a deal, and the deal follows the quotation ----------
  const canPipeline = user => user.isManager || (user.sections || []).includes("pipeline");
  const DEAL_STAGE = { draft: "proposal", sent: "proposal", accepted: "negotiation", converted: "won", declined: "lost", cancelled: "lost" };
  const STAGE_ORDER = ["lead", "survey", "proposal", "negotiation", "po", "won", "lost"];
  // Runs a pipeline call without letting it overwrite this request's activity-log entry.
  async function quietly(user, fn) { const keep = user.aud; user.aud = {}; try { return await fn(); } finally { user.aud = keep; } }
  async function addToPipeline(user, id, b) {
    const co = coOf(user);
    if (!canPipeline(user)) fail(403, "You don't have access to the Sales Pipeline. Ask a manager to give you access.");
    const t = await table(T);
    const q = await getOrNull(t, dPK(co), id);
    if (!q || q.type !== "quote") fail(404, "This quotation doesn't exist.");
    if (!typeAllowed(user, q.type)) needAcct(user);
    if (q.dealId) { const existing = await quietly(user, () => deals.get(user, q.dealId)).catch(() => null); if (existing) fail(409, "This quotation is already in the Sales Pipeline.", { dealId: q.dealId }); }
    if (!q.contactId) fail(400, "Choose the customer on the quotation first.");
    const t0 = today();
    const stage = DEAL_STAGE[q.status] || "proposal";
    const body = unpackJson(q);
    const first = (body.lines || [])[0];
    const deal = await quietly(user, () => deals.create(user, {
      title: clean(q.title || (first ? first.name : "") || `Quotation ${q.number}`, 150), customerId: q.contactId, value: r2(num(q.subtotal)), stage,
      expectedClose: q.dueDate && q.dueDate >= t0 ? q.dueDate : addDays(t0, 14), source: "Quotation",
      nextAction: stage === "proposal" ? `Follow up on quotation ${q.number}` : "", nextActionDate: stage === "proposal" ? addDays(t0, 3) : "",
      lostReason: stage === "lost" ? (q.status === "declined" ? "Quotation declined" : "Quotation cancelled") : "",
      notes: clean(`From quotation ${q.number} in Books (AED ${num(q.subtotal).toLocaleString("en-US", { minimumFractionDigits: 2 })} before VAT, AED ${num(q.total).toLocaleString("en-US", { minimumFractionDigits: 2 })} with VAT).${b.notes ? "\n" + b.notes : ""}`, 4000),
    }));
    await t.updateEntity({ partitionKey: dPK(co), rowKey: id, dealId: deal.id }, "Merge");
    if (user.aud) { user.aud.name = `Quotation ${q.number}`; user.aud.changes = [`deal ${deal.id}`]; }
    return { dealId: deal.id, deal };
  }
  // Keeps a linked deal in step when its quotation changes. Never blocks the quotation change itself.
  async function syncDeal(user, q, why) {
    if (!q || q.type !== "quote" || !q.dealId) return;
    try {
      await quietly(user, async () => {
        const d = await deals.get(user, q.dealId);
        const want = DEAL_STAGE[q.status] || d.stage;
        let stage = d.stage;
        if (want === "won" || want === "lost") stage = want;
        else if (!["won", "lost"].includes(d.stage) && STAGE_ORDER.indexOf(want) > STAGE_ORDER.indexOf(d.stage)) stage = want;
        const value = r2(num(q.subtotal));
        if (stage === d.stage && Math.abs(value - d.value) < 0.005) return;
        await deals.update(user, d.id, { title: d.title, customerId: d.customerId, value, stage, probability: stage === d.stage ? d.probability : "", expectedClose: d.expectedClose, source: d.source,
          nextAction: ["won", "lost"].includes(stage) ? "" : d.nextAction, nextActionDate: ["won", "lost"].includes(stage) ? "" : d.nextActionDate,
          lostReason: stage === "lost" ? (d.lostReason || (q.status === "declined" ? "Quotation declined" : "Quotation cancelled")) : "", notes: d.notes, owner: d.owner, etag: d.etag });
        await deals.note(user, d.id, { text: `Quotation ${q.number}: ${why}` }).catch(() => {});
      });
    } catch { /* the deal may be deleted or belong to someone else: the quotation change still stands */ }
  }

  // ---------- AMC Tracker link: an invoice can be tracked against an annual maintenance contract ----------
  const canAmc = user => user.isManager || (user.sections || []).includes("amc");
  async function linkAmc(user, id, b) {
    const co = coOf(user);
    needAcct(user);
    if (!canAmc(user)) fail(403, "You don't have access to AMC proposals and contracts. Ask a manager to give you access.");
    const t = await table(T);
    const inv = await getOrNull(t, dPK(co), id);
    if (!inv || inv.type !== "invoice") fail(404, "Only invoices can be tracked in the AMC Tracker.");
    const amcId = clean(b.amcId, 60);
    let ref = "";
    if (amcId) {
      const a = await (async () => { const keep = user.aud; user.aud = {}; try { return await amcGet(user, amcId); } finally { user.aud = keep; } })().catch(() => null);
      if (!a) fail(404, "That AMC no longer exists, or you can't see it.");
      if (a.customerId !== inv.contactId) fail(400, `That AMC is for ${a.customerName}, but this invoice is for ${inv.contactName}.`);
      ref = a.ref;
    }
    await t.updateEntity({ partitionKey: dPK(co), rowKey: id, amcId, amcRef: ref }, "Merge");
    if (user.aud) { user.aud.name = `Tax invoice ${inv.number || "draft"}`; user.aud.changes = [amcId ? `AMC ${ref}` : `unlinked from AMC ${inv.amcRef || ""}`]; }
    return getDoc(user, id);
  }
  async function invoicesForAmc(user, amcId) {
    if (user.co === "all") return [];
    const docs = decorate(await allDocs(user.co));
    return docs.filter(d => d.type === "invoice" && d.amcId === amcId && d.status !== "void")
      .map(d => ({ id: d.id, number: d.number, date: d.date, dueDate: d.dueDate, subtotal: d.subtotal, total: d.total, paid: d.paid, balance: d.balance, status: d.status, view: d.view }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // ---------- PnL Calculator: pull a quotation or invoice (and supplier bills as actual costs) ----------
  // Cost categories match the PnL Calculator's list.
  const PNL_CAT = acct => ({ "4010": "Software / licences", "4020": "Labour", "4030": "Labour", "5000": "Hardware", "5010": "Software / licences", "5020": "Subcontractor", "5030": "Logistics", "6300": "Logistics" })[acct];
  function catFor(l, item, side) {
    const byAcct = PNL_CAT(l.account) || (item && PNL_CAT(item.purchaseAcct));
    if (byAcct) return byAcct;
    const t = `${l.name} ${l.description || ""}`.toLowerCase();
    if (/licen[cs]e|subscription|software|microsoft 365|office 365|antivirus|cloud/.test(t)) return "Software / licences";
    if (/cabl|cat ?6|fiber|fibre|conduit|patch|rack|material/.test(t)) return "Cabling & materials";
    if (/install|config|labou?r|commission|programm|support|amc|service|manpower|technician|engineer/.test(t)) return item && item.kind === "goods" ? "Hardware" : "Labour";
    if (/freight|shipping|delivery|courier|clearing|customs/.test(t)) return "Logistics";
    if (/subcontract/.test(t)) return "Subcontractor";
    return item ? (item.kind === "service" ? "Labour" : "Hardware") : side === "purch" ? "Other" : "Hardware";
  }
  async function pnlSources(user, type) {
    const co = coOf(user);
    const want = type === "bill" ? ["bill"] : ["quote", "invoice"];
    const docs = decorate(await allDocs(co)).filter(d => want.includes(d.type) && typeAllowed(user, d.type) && !["void", "cancelled"].includes(d.status) && (d.type !== "invoice" || d.status === "posted"));
    return docs.map(d => ({ id: d.id, type: d.type, number: d.number, date: d.date, contactId: d.contactId, contactName: d.contactName, ref: d.ref, title: d.title, subtotal: d.subtotal, total: d.total, status: d.view }))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 1000);
  }
  async function pnlSource(user, id) {
    const co = coOf(user);
    const e = await getOrNull(await table(T), dPK(co), id);
    if (!e || !["quote", "invoice", "bill"].includes(e.type)) fail(404, "That quotation, invoice or bill doesn't exist.");
    if (!typeAllowed(user, e.type)) needAcct(user);
    const body = unpackJson(e), items = new Map((await listItems(co)).map(i => [i.id, i]));
    const side = e.type === "bill" ? "purch" : "sales";
    const lines = (body.lines || []).map(l => {
      const it = items.get(l.itemId) || [...items.values()].find(x => x.name === l.name) || null;
      const cost = side === "purch" ? r2(num(l.net) / (num(l.qty) || 1)) : it ? num(it.purchasePrice) : 0;
      return { d: side === "purch" ? `${e.contactName}: ${l.name}` : l.name, c: catFor(l, it, side), q: num(l.qty) || 1, u: cost, sell: side === "sales" ? r2(num(l.net) / (num(l.qty) || 1)) : 0, known: side === "purch" || cost > 0 };
    });
    if (user.aud) user.aud.name = `${TYPES[e.type].label} ${e.number}`;
    return { id: e.rowKey, type: e.type, number: e.number, date: e.date, contactId: e.contactId, contactName: e.contactName, ref: e.ref || "", poRef: body.poRef || "", title: e.title || "", subtotal: num(e.subtotal), total: num(e.total), lines };
  }

  async function markSent(user, id) {
    const co = coOf(user);
    const t = await table(T);
    const cur = await getOrNull(t, dPK(co), id);
    if (!cur) fail(404, "This document doesn't exist.");
    if (!typeAllowed(user, cur.type)) needAcct(user);
    const patch = { partitionKey: dPK(co), rowKey: id, sentAt: new Date().toISOString() };
    if ((cur.type === "quote" || cur.type === "po") && cur.status === "draft") patch.status = "sent";
    if (user.aud) user.aud.name = `${TYPES[cur.type].label} ${cur.number}`;
    await t.updateEntity(patch, "Merge");
    return getDoc(user, id);
  }

  // Quotation -> invoice draft, PO -> bill draft, invoice -> credit note draft (all lines, ready to edit).
  async function convert(user, id, b) {
    const co = coOf(user);
    const cur = await getOrNull(await table(T), dPK(co), id);
    if (!cur) fail(404, "This document doesn't exist.");
    const to = { quote: "invoice", po: "bill", invoice: "creditnote", bill: "vendorcredit" }[cur.type];
    if (!to) fail(400, "This document can't be converted.");
    if (!isAcct(user)) needAcct(user);
    if (cur.status === "converted" || cur.status === "cancelled" || cur.status === "void" || cur.status === "declined") fail(400, "This can't be converted in its current status.");
    if (cur.type === "invoice" && cur.status !== "posted") fail(400, "Issue the invoice before crediting it.");
    const body = unpackJson(cur);
    const draft = {
      type: to, contactId: cur.contactId, date: today(), ref: to === "bill" ? clean(b.ref, 80) : cur.ref, lines: body.lines, notes: body.notes, emirate: cur.emirate, placeOfSupply: body.placeOfSupply,
      fromId: cur.type === "quote" || cur.type === "po" ? id : "", poRef: cur.type === "quote" ? cur.ref : "", salesperson: body.salesperson, attention: body.attention,
    };
    if (to === "creditnote") Object.assign(draft, { invoiceId: id, reason: clean(b.reason, 500) || "Credit against " + cur.number });
    if (to === "vendorcredit") Object.assign(draft, { billId: id, reason: clean(b.reason, 500) || "Credit against " + cur.number, ref: clean(b.ref, 80) || "" });
    return { draft };
  }

  // ---------- bootstrap: everything the page needs ----------
  async function bootstrap(user) {
    const co = coOf(user);
    const acct = isAcct(user);
    const [settings, accts, items, docs, customers, vendors, vver] = await Promise.all([loadSettings(co), listAccounts(co), listItems(co), allDocs(co), listCustomers(user), acct ? vendorsOf(user) : Promise.resolve([]), acct ? verifications(co) : Promise.resolve({})]);
    let list = decorate(docs);
    if (!acct) list = list.filter(d => d.type === "quote").map(d => ({ ...d, gl: [], tax: [] }));
    const s = { ...settings }; delete s.counters;
    return {
      company: { key: co, name: CO[co].name }, settings: s, accounts: accts, items, docs: list, customers, vendors, vver,
      perms: { acct, manager: !!user.isManager, quotesOnly: !acct, pipeline: canPipeline(user), amc: canAmc(user) }, vat: VAT, types: Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, { label: v.label, side: v.side || "", prefix: settings.prefixes[k] }])),
      acctTypes: ACCT_TYPES, sys: SYS, fileKinds: FILE_KINDS, emirates: EMIRATES, today: today(), me: user.email,
    };
  }

  // Alerts for the bell and the home page.
  async function alerts(user) {
    if (user.co === "all" || !isAcct(user)) return [];
    const co = user.co, t0 = today(), wk = addDays(t0, 7);
    const docs = decorate(await allDocs(co));
    const out = [];
    const od = docs.filter(d => d.type === "invoice" && d.view === "overdue");
    if (od.length) out.push({ tool: "books", severity: "medium", when: od.map(d => d.dueDate).sort()[0], href: "/books/#/invoices?view=overdue",
      title: `${od.length} overdue invoice${od.length === 1 ? "" : "s"}`, text: `AED ${od.reduce((a, d) => a + d.balance, 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} to collect` });
    const due = docs.filter(d => d.type === "bill" && d.status === "posted" && d.balance > 0 && d.dueDate <= wk);
    if (due.length) out.push({ tool: "books", severity: due.some(d => d.dueDate < t0) ? "medium" : "low", when: due.map(d => d.dueDate).sort()[0], href: "/books/#/bills?view=due",
      title: `${due.length} bill${due.length === 1 ? "" : "s"} due within 7 days`, text: `AED ${due.reduce((a, d) => a + d.balance, 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} to pay` });
    return out;
  }

  // Supplier verification before deducting input VAT (FTA Decision No. 13 of 2026, effective 1 Oct 2026).
  // One record per supplier with the checks done, who did them and when.
  const vPK = co => "vver-" + co;
  const VCHECKS = ["trn", "licence", "address", "bank", "activity"];
  async function verifications(co) { const m = {}; (await all(await table(T), vPK(co))).forEach(e => { m[e.rowKey] = { checks: j(e.checks, {}), note: e.note || "", date: e.date || "", by: e.by || "" }; }); return m; }
  async function verifyVendor(user, id, b) {
    needAcct(user);
    const co = coOf(user);
    const v = await contactFor(user, "vendor", id);
    const checks = {}; VCHECKS.forEach(k => { checks[k] = !!(b.checks && b.checks[k]); });
    const date = clean(b.date, 10) || today(); if (!isDate(date)) fail(400, "The verification date is not valid.");
    if (checks.trn && !trnOk(v.trn)) fail(400, "Record the supplier's 15-digit TRN in Suppliers before marking it as checked.");
    const e = { partitionKey: vPK(co), rowKey: id, checks: JSON.stringify(checks), note: clean(b.note, 1000), date, by: user.email, at: new Date().toISOString() };
    await (await table(T)).upsertEntity(e, "Replace");
    if (user.aud) { user.aud.name = v.name; user.aud.changes = VCHECKS.filter(k => checks[k]); }
    return (await verifications(co))[id];
  }
  async function addVendor(user, b) {
    needAcct(user);
    return sup().route("POST", [], user, { name: b.name, trn: b.trn, email: b.email, phone: b.phone, address: b.address, emirate: b.emirate, country: b.country || "UAE", kind: "Supplier", status: "active" });
  }
  async function addCustomer(user, b) { return createCustomer(user, b); }

  async function route(method, seg, user, body) {
    const [a, id, sub] = seg;
    if (a === "bootstrap" && method === "GET") return bootstrap(user);
    if (a === "settings" && method === "PUT") return saveSettings(user, body);
    if (a === "ct" && method === "PUT") return saveCt(user, body);
    if (a === "accounts") {
      if (!id && method === "POST") return saveAccount(user, null, body);
      if (id && method === "PUT") return saveAccount(user, id, body);
      if (id && method === "DELETE") return deleteAccount(user, id);
    }
    if (a === "items") {
      if (id === "import" && method === "POST") return importItems(user, body);
      if (!id && method === "POST") return saveItem(user, null, body);
      if (id && method === "PUT") return saveItem(user, id, body);
      if (id && method === "DELETE") return deleteItem(user, id);
    }
    if (a === "pnl-sources" && !id && method === "GET") return pnlSources(user, "sales");
    if (a === "pnl-bills" && !id && method === "GET") return pnlSources(user, "bill");
    if (a === "pnl-sources" && id && method === "GET") return pnlSource(user, id);
    if (a === "vendors" && !id && method === "POST") return addVendor(user, body);
    if (a === "vendors" && id && sub === "verify" && method === "PUT") return verifyVendor(user, id, body);
    if (a === "customers" && method === "POST") return addCustomer(user, body);
    if (a === "docs") {
      if (!id && method === "POST") return createDoc(user, body);
      if (id && !sub && method === "GET") return getDoc(user, id);
      if (id && !sub && method === "PUT") return updateDoc(user, id, body);
      if (id && !sub && method === "DELETE") return deleteDoc(user, id);
      if (id && sub === "void" && method === "POST") return voidDoc(user, id, body);
      if (id && sub === "apply" && method === "PUT") return applyCredit(user, id, body);
      if (id && sub === "sent" && method === "POST") return markSent(user, id);
      if (id && sub === "internal" && method === "PUT") return saveInternal(user, id, body);
      if (id && sub === "deal" && method === "POST") return addToPipeline(user, id, body);
      if (id && sub === "amc" && method === "PUT") return linkAmc(user, id, body);
      if (id && sub === "convert" && method === "POST") return convert(user, id, body);
      if (id && sub === "files") {
        const fid = seg[3];
        if (!fid && method === "POST") return addFile(user, id, body);
        if (fid && method === "GET") return getFile(user, id, fid, seg[4] === "download");
        if (fid && method === "PUT") return editFile(user, id, fid, body);
        if (fid && method === "DELETE") return removeFile(user, id, fid);
      }
    }
    fail(404, "Unknown request.");
  }
  return { route, alerts, TYPES, invoicesForAmc };
};
