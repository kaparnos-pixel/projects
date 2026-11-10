// Bifold Tools API: shared customers, saved PnL documents with per-document sharing, the sales pipeline, the PDC cheque log
// and the AMC Tracker (src/amc.js).
// Storage: Azure Table Storage (setting STORAGE_CONNECTION).
// Settings:
//   STORAGE_CONNECTION  connection string of the storage account (required)
//   ALLOWED_DOMAINS     comma-separated email domains allowed to use the API (default bifoldtech.com)
//   BIFOLD_MANAGERS     comma-separated emails who can view, edit and share every PnL (default ranjan@bifoldtech.com)

const { TableClient } = require("@azure/data-tables");
const crypto = require("crypto");

class HttpError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}
const fail = (status, message, data) => { throw new HttpError(status, message, data); };

const list = (v, d) => String(v || d).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const domains = () => list(process.env.ALLOWED_DOMAINS, "bifoldtech.com");
const managers = () => list(process.env.BIFOLD_MANAGERS, "ranjan@bifoldtech.com");
const emailOk = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && domains().some(d => e.endsWith("@" + d));

// ---------- storage ----------
const clients = {};
async function table(name) {
  if (!clients[name]) {
    const cs = process.env.STORAGE_CONNECTION;
    if (!cs) fail(500, "Storage is not set up yet. Add the STORAGE_CONNECTION setting to the Static Web App.");
    const c = TableClient.fromConnectionString(cs, name, { allowInsecureConnection: /127\.0\.0\.1|localhost/.test(cs) });
    try { await c.createTable(); } catch (e) { if (e.statusCode !== 409) throw e; }
    clients[name] = c;
  }
  return clients[name];
}
async function getOrNull(t, pk, rk) {
  try { return await t.getEntity(pk, rk); } catch (e) { if (e.statusCode === 404) return null; throw e; }
}
async function all(t, pk, select) {
  const out = [];
  const queryOptions = { filter: `PartitionKey eq '${pk}'` };
  if (select) queryOptions.select = select;
  for await (const e of t.listEntities({ queryOptions })) out.push(e);
  return out;
}

// Azure Table string properties hold at most 32K characters, so long JSON is split across columns.
const CHUNK = 30000, MAX_CHUNKS = 20;
function packJson(obj) {
  const s = JSON.stringify(obj);
  if (s.length > CHUNK * MAX_CHUNKS) fail(413, "This record is too large to save. Split it into smaller documents.");
  const out = { dataChunks: Math.max(1, Math.ceil(s.length / CHUNK)) };
  for (let i = 0; i < out.dataChunks; i++) out["data" + i] = s.slice(i * CHUNK, (i + 1) * CHUNK);
  return out;
}
function unpackJson(e) {
  let s = "";
  for (let i = 0; i < (e.dataChunks || 0); i++) s += e["data" + i] || "";
  try { return JSON.parse(s || "{}"); } catch { return {}; }
}

// ---------- identity ----------
function getUser(getHeader) {
  const raw = getHeader("x-ms-client-principal");
  if (!raw) fail(401, "Your session has ended. Reload the page to sign in again.");
  let p;
  try { p = JSON.parse(Buffer.from(raw, "base64").toString("utf8")); } catch { fail(401, "Your session has ended. Reload the page to sign in again."); }
  const email = String(p.userDetails || "").trim().toLowerCase();
  if (!emailOk(email)) fail(403, `Only ${domains().map(d => "@" + d).join(", ")} accounts can use Bifold Tools. You are signed in as ${email || "an unknown account"}.`);
  return { email, isManager: managers().includes(email) };
}

const clean = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ---------- customers (shared by every tool) ----------
const CUST = "customers", CPK = "customer";
const custOut = e => ({
  id: e.rowKey, name: e.name, contactName: e.contactName || "", email: e.email || "", phone: e.phone || "",
  trn: e.trn || "", emirate: e.emirate || "", address: e.address || "",
  createdBy: e.createdBy, createdAt: e.createdAt, updatedBy: e.updatedBy, updatedAt: e.updatedAt,
});
function custIn(b) {
  const f = {
    name: clean(b.name, 150), contactName: clean(b.contactName, 100), email: clean(b.email, 150), phone: clean(b.phone, 50),
    trn: clean(b.trn, 30), emirate: clean(b.emirate, 50), address: clean(b.address, 300),
  };
  if (!f.name) fail(400, "Enter the customer name.");
  return f;
}
async function listCustomers() {
  const rows = await all(await table(CUST), CPK);
  return rows.map(custOut).sort((a, b) => a.name.localeCompare(b.name));
}
async function findDuplicate(name, exceptId) {
  const n = name.toLowerCase();
  return (await listCustomers()).find(c => c.name.toLowerCase() === n && c.id !== exceptId);
}
async function createCustomer(user, b) {
  const f = custIn(b);
  const dup = await findDuplicate(f.name);
  if (dup) fail(409, `${dup.name} is already in the customer list.`, { customer: dup });
  const now = new Date().toISOString();
  const e = { partitionKey: CPK, rowKey: crypto.randomUUID(), ...f, createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now };
  await (await table(CUST)).createEntity(e);
  return custOut(e);
}
async function updateCustomer(user, id, b) {
  const t = await table(CUST);
  const cur = await getOrNull(t, CPK, id);
  if (!cur) fail(404, "This customer no longer exists.");
  const f = custIn(b);
  const dup = await findDuplicate(f.name, id);
  if (dup) fail(409, `${dup.name} is already in the customer list.`, { customer: dup });
  const e = { partitionKey: CPK, rowKey: id, ...f, updatedBy: user.email, updatedAt: new Date().toISOString() };
  await t.updateEntity(e, "Merge");
  return custOut({ ...cur, ...e });
}
async function deleteCustomer(user, id) {
  if (!user.isManager) fail(403, "Only managers can delete customers.");
  const t = await table(CUST);
  try { await t.deleteEntity(CPK, id); } catch (e) { if (e.statusCode !== 404) throw e; }
}

// ---------- PnL documents ----------
const PNL = "pnl", PPK = "pnl";
const SUMMARY_COLS = ["RowKey", "title", "company", "customerId", "customerName", "poNo", "poValue", "directCost", "netProfit", "netPct", "owner", "acl", "createdAt", "updatedAt", "updatedBy"];

// Same formula as the page, so list figures match the document.
function compute(d) {
  const po = num(d.poValue);
  const direct = (Array.isArray(d.lines) ? d.lines : []).reduce((a, l) => a + num(l.q) * num(l.u), 0);
  const cost = direct * (1 + num(d.contPct) / 100);
  const fin = cost * num(d.finRate) / 100 * num(d.credDays) / 365;
  const net = po - cost - po * num(d.commPct) / 100 - po * num(d.ohPct) / 100 - fin;
  return { poValue: po, directCost: direct, netProfit: net, netPct: po ? net / po * 100 : 0 };
}
const aclOf = e => { try { return JSON.parse(e.acl || "{}"); } catch { return {}; } };
function roleOf(e, user) {
  if (e.owner === user.email) return "owner";
  if (user.isManager) return "manager";
  const r = aclOf(e)[user.email];
  return r === "edit" || r === "view" ? r : null;
}
const canEdit = r => r === "owner" || r === "manager" || r === "edit";
const canShare = r => r === "owner" || r === "manager";

function summaryOut(e, role) {
  return {
    id: e.rowKey, title: e.title || "", company: e.company || "", customerId: e.customerId || "", customerName: e.customerName || "",
    poNo: e.poNo || "", poValue: num(e.poValue), directCost: num(e.directCost), netProfit: num(e.netProfit), netPct: num(e.netPct),
    owner: e.owner, createdAt: e.createdAt, updatedAt: e.updatedAt, updatedBy: e.updatedBy, role,
  };
}
function fullOut(e, role) {
  return {
    ...summaryOut(e, role), data: unpackJson(e), etag: e.etag,
    canEdit: canEdit(role), canShare: canShare(role), access: canShare(role) ? aclOf(e) : undefined,
  };
}
function docFields(b) {
  const d = b && typeof b.data === "object" && b.data ? b.data : fail(400, "Nothing to save.");
  if (!Array.isArray(d.lines)) d.lines = [];
  if (d.lines.length > 500) fail(413, "A PnL can have at most 500 cost lines.");
  const s = compute(d);
  const customerName = clean(d.customer, 150);
  const poNo = clean(d.poNo, 60);
  return {
    title: clean(b.title, 150) || [customerName, poNo].filter(Boolean).join(" · ") || "Untitled PnL",
    company: clean(d.company, 80), customerId: clean(d.customerId, 60), customerName, poNo, ...s, ...packJson(d),
  };
}
function newId() {
  const t = new Date(Date.now() + 4 * 3600e3).toISOString(); // Gulf time for the date part
  const rnd = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `PNL-${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}-${rnd}`;
}

async function listPnl(user) {
  const rows = await all(await table(PNL), PPK, SUMMARY_COLS);
  return rows.map(e => { e.rowKey = e.rowKey || e.RowKey; const r = roleOf(e, user); return r && summaryOut(e, r); })
    .filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
async function loadDoc(user, id) {
  const e = await getOrNull(await table(PNL), PPK, id);
  if (!e) fail(404, "This PnL doesn't exist or was deleted.");
  const role = roleOf(e, user);
  if (!role) fail(403, "You don't have access to this PnL. Ask its owner or a manager to share it with you.");
  return { e, role };
}
async function getPnl(user, id) { const { e, role } = await loadDoc(user, id); return fullOut(e, role); }
async function createPnl(user, b) {
  const t = await table(PNL);
  const now = new Date().toISOString();
  const e = { partitionKey: PPK, rowKey: newId(), ...docFields(b), owner: user.email, acl: "{}", createdAt: now, updatedAt: now, updatedBy: user.email };
  await t.createEntity(e);
  return getPnl(user, e.rowKey);
}
async function updatePnl(user, id, b) {
  const { e, role } = await loadDoc(user, id);
  if (!canEdit(role)) fail(403, "You can view this PnL but not change it. Ask its owner or a manager for edit rights.");
  const next = {
    partitionKey: PPK, rowKey: id, ...docFields(b), owner: e.owner, acl: e.acl, createdAt: e.createdAt,
    updatedAt: new Date().toISOString(), updatedBy: user.email,
  };
  try {
    await (await table(PNL)).updateEntity(next, "Replace", { etag: b.etag || e.etag });
  } catch (err) {
    if (err.statusCode === 412) fail(409, "Someone else saved this PnL after you opened it. Reload it to see their changes, then make yours again.");
    throw err;
  }
  return getPnl(user, id);
}
async function deletePnl(user, id) {
  const { role } = await loadDoc(user, id);
  if (!canShare(role)) fail(403, "Only the owner or a manager can delete this PnL.");
  await (await table(PNL)).deleteEntity(PPK, id);
}
async function setAccess(user, id, b) {
  const { e, role } = await loadDoc(user, id);
  if (!canShare(role)) fail(403, "Only the owner or a manager can change who has access.");
  const email = clean(b.email, 150).toLowerCase();
  const r = String(b.role || "");
  if (!emailOk(email)) fail(400, `Enter a valid ${domains().map(d => "@" + d).join(" or ")} email address.`);
  if (email === e.owner) fail(400, "The owner always has full access.");
  if (!["view", "edit", "none"].includes(r)) fail(400, "Choose view or edit.");
  const acl = aclOf(e);
  if (r === "none") delete acl[email]; else acl[email] = r;
  await (await table(PNL)).updateEntity({ partitionKey: PPK, rowKey: id, acl: JSON.stringify(acl) }, "Merge", { etag: e.etag })
    .catch(err => { if (err.statusCode === 412) fail(409, "This PnL changed while you were sharing it. Try again."); throw err; });
  return { access: acl };
}

// ---------- sales pipeline (deals) ----------
// A deal is visible to its owner (the salesperson) and to managers. Managers can reassign the owner.
const DEALS = "deals", DPK = "deal";
const STAGES = ["lead", "survey", "proposal", "negotiation", "po", "won", "lost"];
const STAGE_NAMES = { lead: "Lead", survey: "Site survey", proposal: "Proposal sent", negotiation: "Negotiation", po: "PO received", won: "Won", lost: "Lost" };
const STAGE_PROB = { lead: 10, survey: 20, proposal: 40, negotiation: 60, po: 90, won: 100, lost: 0 };
const COMPANIES = ["Bifold Technologies", "Tech Hub IT"];
const DEAL_COLS = ["RowKey", "title", "company", "customerId", "customerName", "value", "stage", "probability", "expectedClose",
  "source", "nextAction", "nextActionDate", "lostReason", "notes", "owner", "closedAt", "stageAt", "createdBy", "createdAt", "updatedAt", "updatedBy"];
const LOG_MAX = 200;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

function dealOut(e) {
  return {
    id: e.rowKey || e.RowKey, title: e.title || "", company: e.company || "", customerId: e.customerId || "", customerName: e.customerName || "",
    value: num(e.value), stage: e.stage, probability: num(e.probability), expectedClose: e.expectedClose || "",
    source: e.source || "", nextAction: e.nextAction || "", nextActionDate: e.nextActionDate || "", lostReason: e.lostReason || "",
    notes: e.notes || "", owner: e.owner, closedAt: e.closedAt || "", stageAt: e.stageAt || "",
    createdBy: e.createdBy, createdAt: e.createdAt, updatedAt: e.updatedAt, updatedBy: e.updatedBy,
  };
}
const dealVisible = (e, user) => user.isManager || e.owner === user.email;

function dealIn(b, user, cur) {
  const f = {
    title: clean(b.title, 150), company: clean(b.company, 80), customerId: clean(b.customerId, 60), customerName: clean(b.customerName, 150),
    value: Math.max(0, num(b.value)), stage: String(b.stage || "lead"), expectedClose: clean(b.expectedClose, 10),
    source: clean(b.source, 60), nextAction: clean(b.nextAction, 200), nextActionDate: clean(b.nextActionDate, 10),
    lostReason: clean(b.lostReason, 300), notes: clean(b.notes, 4000),
  };
  if (!f.title) fail(400, "Enter what the deal is for.");
  if (!f.customerId) fail(400, "Choose a customer.");
  if (!COMPANIES.includes(f.company)) fail(400, "Choose Bifold Technologies or Tech Hub IT.");
  if (!STAGES.includes(f.stage)) fail(400, "Choose a valid stage.");
  if (f.value > 1e10) fail(400, "The deal value is too large.");
  if (f.expectedClose && !isDate(f.expectedClose)) fail(400, "The expected close date is not valid.");
  if (f.nextActionDate && !isDate(f.nextActionDate)) fail(400, "The next action date is not valid.");
  if (f.stage === "lost" && !f.lostReason) fail(400, "Say why the deal was lost.");
  if (f.stage !== "lost") f.lostReason = "";
  const p = b.probability === "" || b.probability == null ? STAGE_PROB[f.stage] : num(b.probability);
  f.probability = f.stage === "won" ? 100 : f.stage === "lost" ? 0 : Math.min(100, Math.max(0, Math.round(p)));
  // Owner: salespeople always own what they create; managers can assign anyone on an allowed domain.
  let owner = cur ? cur.owner : user.email;
  const want = clean(b.owner, 150).toLowerCase();
  if (want && want !== owner) {
    if (!user.isManager) fail(403, "Only managers can reassign a deal.");
    if (!emailOk(want)) fail(400, `Enter a valid ${domains().map(d => "@" + d).join(" or ")} email for the owner.`);
    owner = want;
  }
  f.owner = owner;
  return f;
}

function dealId() {
  const t = new Date(Date.now() + 4 * 3600e3).toISOString();
  return `DEAL-${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}
const logEntry = (user, kind, text) => ({ at: new Date().toISOString(), by: user.email, kind, text: clean(text, 1000) });
const addLog = (log, entry) => { log.push(entry); return log.slice(-LOG_MAX); };

async function listDeals(user) {
  const rows = await all(await table(DEALS), DPK, DEAL_COLS);
  return rows.filter(e => dealVisible(e, user)).map(dealOut).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
async function loadDeal(user, id) {
  const e = await getOrNull(await table(DEALS), DPK, id);
  if (!e || !dealVisible(e, user)) fail(404, "This deal doesn't exist, was deleted, or isn't assigned to you.");
  return e;
}
const dealFull = e => ({ ...dealOut(e), log: unpackJson(e).log || [], etag: e.etag });
async function getDeal(user, id) { return dealFull(await loadDeal(user, id)); }

function describeChanges(cur, f) {
  const out = [];
  if (cur.stage !== f.stage) out.push(["stage", `Moved from ${STAGE_NAMES[cur.stage]} to ${STAGE_NAMES[f.stage]}` + (f.stage === "lost" ? `: ${f.lostReason}` : "")]);
  if (num(cur.value) !== f.value) out.push(["edit", `Value changed from AED ${num(cur.value).toLocaleString("en-US")} to AED ${f.value.toLocaleString("en-US")}`]);
  if (cur.owner !== f.owner) out.push(["edit", `Reassigned from ${cur.owner} to ${f.owner}`]);
  if ((cur.expectedClose || "") !== f.expectedClose) out.push(["edit", `Expected close changed to ${f.expectedClose || "not set"}`]);
  return out;
}

// The customer name always comes from the shared customer list, so renames there show up on the next save.
async function resolveCustomer(f, cur) {
  const c = await getOrNull(await table(CUST), CPK, f.customerId);
  if (c) f.customerName = c.name;
  else if (cur && cur.customerId === f.customerId) f.customerName = cur.customerName || f.customerName;
  else fail(400, "That customer is no longer in the customer list. Choose another.");
}
async function createDeal(user, b) {
  const f = dealIn(b, user, null);
  await resolveCustomer(f, null);
  const now = new Date().toISOString();
  const closed = f.stage === "won" || f.stage === "lost";
  const log = [logEntry(user, "create", `Created at ${STAGE_NAMES[f.stage]}` + (f.owner !== user.email ? `, assigned to ${f.owner}` : ""))];
  const e = { partitionKey: DPK, rowKey: dealId(), ...f, closedAt: closed ? now : "", stageAt: now, createdBy: user.email, createdAt: now, updatedAt: now, updatedBy: user.email, ...packJson({ log }) };
  await (await table(DEALS)).createEntity(e);
  return getDeal(user, e.rowKey);
}
async function updateDeal(user, id, b) {
  const cur = await loadDeal(user, id);
  const f = dealIn(b, user, cur);
  await resolveCustomer(f, cur);
  const now = new Date().toISOString();
  let log = unpackJson(cur).log || [];
  for (const [kind, text] of describeChanges(cur, f)) log = addLog(log, logEntry(user, kind, text));
  const stageChanged = cur.stage !== f.stage;
  const closed = f.stage === "won" || f.stage === "lost";
  const next = {
    partitionKey: DPK, rowKey: id, ...f,
    closedAt: closed ? (stageChanged || !cur.closedAt ? now : cur.closedAt) : "",
    stageAt: stageChanged ? now : (cur.stageAt || cur.createdAt),
    createdBy: cur.createdBy, createdAt: cur.createdAt, updatedAt: now, updatedBy: user.email, ...packJson({ log }),
  };
  try {
    await (await table(DEALS)).updateEntity(next, "Replace", { etag: b.etag || cur.etag });
  } catch (err) {
    if (err.statusCode === 412) fail(409, "Someone else changed this deal after you opened it. Reload to see their changes, then make yours again.");
    throw err;
  }
  return getDeal(user, id);
}
async function addDealNote(user, id, b) {
  const text = clean(b.text, 1000);
  if (!text) fail(400, "Write a note first.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await loadDeal(user, id);
    const log = addLog(unpackJson(cur).log || [], logEntry(user, "note", text));
    try {
      await (await table(DEALS)).updateEntity({ partitionKey: DPK, rowKey: id, ...packJson({ log }), updatedAt: new Date().toISOString(), updatedBy: user.email }, "Merge", { etag: cur.etag });
      return getDeal(user, id);
    } catch (err) { if (err.statusCode !== 412) throw err; }
  }
  fail(409, "The deal kept changing while you added the note. Try again.");
}
async function deleteDeal(user, id) {
  const cur = await loadDeal(user, id);
  if (!user.isManager && cur.owner !== user.email) fail(403, "Only the owner or a manager can delete this deal.");
  await (await table(DEALS)).deleteEntity(DPK, id);
}

// ---------- PDC log: post-dated cheques, security deposits and advance payment guarantees ----------
// One record per instrument. kind: "pdc" (post-dated cheque to a supplier/vendor),
// "deposit" (security deposit given against a PO) or "apg" (advance payment guarantee against a PO).
// clearanceDate is the date that matters: clearance for a PDC, expiry / return date for a deposit or APG.
// Status keys are shared: pending = pending / active, cleared = cleared / returned or released,
// bounced = bounced / encashed, cancelled.
// Everyone signed in sees every record for both companies. Anyone can log and edit; only the person who
// logged it or a manager can delete it. The daily reminder job (.github/scripts/pdc-reminders.cjs) emails
// createdBy + PDC_REMINDER_CC 7 days before clearanceDate and stamps reminderSentAt; changing the date re-arms it.
const PDC = "pdc", QPK = "cheque";
const KINDS = { pdc: "PDC cheque", deposit: "Security deposit", apg: "Advance payment guarantee" };
const CHQ_STATUS = ["pending", "cleared", "bounced", "cancelled"];
const PAYEE_TYPES = ["Supplier", "Vendor", "Customer"];
const FORMS = ["Cheque", "Bank guarantee", "Cash / transfer"];

function chqOut(e) {
  return {
    id: e.rowKey, kind: e.kind || "pdc", form: e.form || "", company: e.company || "", payeeType: e.payeeType || "", payee: e.payee || "",
    chequeNo: e.chequeNo || "", bank: e.bank || "", amount: num(e.amount), poValue: num(e.poValue),
    chequeDate: e.chequeDate || "", clearanceDate: e.clearanceDate || "",
    status: e.status || "pending", reference: e.reference || "", notes: e.notes || "",
    reminderSentAt: e.reminderSentAt || "", createdBy: e.createdBy, createdAt: e.createdAt,
    updatedBy: e.updatedBy, updatedAt: e.updatedAt, etag: e.etag,
  };
}
function chqIn(b) {
  const kind = clean(b.kind, 10) || "pdc";
  if (!KINDS[kind]) fail(400, "Choose PDC cheque, security deposit or advance payment guarantee.");
  const pdc = kind === "pdc";
  const f = {
    kind, form: pdc ? "Cheque" : (clean(b.form, 30) || (kind === "apg" ? "Bank guarantee" : "Cheque")),
    company: clean(b.company, 80), payeeType: clean(b.payeeType, 20) || (pdc ? "Supplier" : "Customer"), payee: clean(b.payee, 150),
    chequeNo: clean(b.chequeNo, 40), bank: clean(b.bank, 80), amount: Math.round(num(b.amount) * 100) / 100,
    poValue: pdc ? 0 : Math.max(0, Math.round(num(b.poValue) * 100) / 100),
    chequeDate: clean(b.chequeDate, 10), clearanceDate: clean(b.clearanceDate, 10), status: clean(b.status, 20) || "pending",
    reference: clean(b.reference, 150), notes: clean(b.notes, 1000),
  };
  if (!COMPANIES.includes(f.company)) fail(400, "Choose Bifold Technologies or Tech Hub IT.");
  if (!PAYEE_TYPES.includes(f.payeeType)) fail(400, "Choose supplier, vendor or customer.");
  if (!FORMS.includes(f.form)) fail(400, "Choose cheque, bank guarantee or cash / transfer.");
  if (!f.payee) fail(400, pdc ? "Enter the payee name." : "Enter who the " + KINDS[kind].toLowerCase() + " was given to.");
  if (!f.chequeNo && f.form !== "Cash / transfer") fail(400, f.form === "Bank guarantee" ? "Enter the guarantee number." : "Enter the cheque number.");
  if (!pdc && !f.reference) fail(400, "Enter the purchase order number.");
  if (!(f.amount > 0) || f.amount > 1e10) fail(400, "Enter an amount greater than zero.");
  if (f.poValue > 1e11) fail(400, "The PO value is too large.");
  if (!isDate(f.clearanceDate)) fail(400, pdc ? "Pick the clearance date." : "Pick the expiry / return date.");
  if (f.chequeDate && !isDate(f.chequeDate)) fail(400, "The issue date is not valid.");
  if (!CHQ_STATUS.includes(f.status)) fail(400, "Choose a valid status.");
  return f;
}
async function listCheques() {
  const rows = await all(await table(PDC), QPK);
  return rows.map(chqOut).sort((a, b) => a.clearanceDate.localeCompare(b.clearanceDate));
}
async function findChequeNo(f, exceptId) {
  if (!f.chequeNo) return null;
  const n = f.chequeNo.toLowerCase();
  return (await listCheques()).find(c => c.company === f.company && c.kind === f.kind && c.chequeNo.toLowerCase() === n && c.id !== exceptId && c.status !== "cancelled");
}
const dupMsg = (d, f) => `${KINDS[d.kind]} ${d.chequeNo} for ${f.company} is already logged (${d.payee}).`;
async function createCheque(user, b) {
  const f = chqIn(b);
  const dup = await findChequeNo(f);
  if (dup) fail(409, dupMsg(dup, f));
  const now = new Date().toISOString();
  const e = { partitionKey: QPK, rowKey: crypto.randomUUID(), ...f, reminderSentAt: "", createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now };
  await (await table(PDC)).createEntity(e);
  return chqOut(await (await table(PDC)).getEntity(QPK, e.rowKey));
}
async function updateCheque(user, id, b) {
  const t = await table(PDC);
  const cur = await getOrNull(t, QPK, id);
  if (!cur) fail(404, "This entry no longer exists.");
  const f = chqIn(b);
  const dup = await findChequeNo(f, id);
  if (dup) fail(409, dupMsg(dup, f));
  const reminderSentAt = cur.clearanceDate === f.clearanceDate ? (cur.reminderSentAt || "") : "";
  const next = { partitionKey: QPK, rowKey: id, ...f, reminderSentAt, createdBy: cur.createdBy, createdAt: cur.createdAt, updatedBy: user.email, updatedAt: new Date().toISOString() };
  try { await t.updateEntity(next, "Replace", { etag: b.etag || cur.etag }); }
  catch (err) { if (err.statusCode === 412) fail(409, "Someone else changed this entry after you opened it. Reload to see their changes, then make yours again."); throw err; }
  return chqOut(await t.getEntity(QPK, id));
}
async function deleteCheque(user, id) {
  const t = await table(PDC);
  const cur = await getOrNull(t, QPK, id);
  if (!cur) return;
  if (!user.isManager && cur.createdBy !== user.email) fail(403, "Only the person who logged this entry or a manager can delete it. Mark it cancelled instead.");
  await t.deleteEntity(QPK, id);
}

// ---------- AMC Tracker (src/amc.js) ----------
let amcRoute;
const amc = () => amcRoute || (amcRoute = require("./amc")({ table, getOrNull, all, packJson, unpackJson, fail, clean, num, isDate, emailOk, CUST, CPK }));

// ---------- team access (src/access.js) ----------
let accessMod;
const access = () => accessMod || (accessMod = require("./access")({ table, getOrNull, all, fail, clean, emailOk, domains, managers }));

// ---------- routing ----------
async function route(method, seg, user, body) {
  const [a, id, sub] = seg;
  access().guard(method, seg, body, user);
  if (a === "access") return access().route(method, seg, user, body);
  if (a === "amc") return amc()(method, seg.slice(1), user, body);
  if (a === "me" && method === "GET") { access().touch(user.email); return { ...user, managers: managers(), domains: domains(), allSections: access().SECTIONS }; }
  if (a === "customers") {
    if (!id && method === "GET") return listCustomers();
    if (!id && method === "POST") return createCustomer(user, body);
    if (id && method === "PUT") return updateCustomer(user, id, body);
    if (id && method === "DELETE") return deleteCustomer(user, id);
  }
  if (a === "pnl") {
    if (!id && method === "GET") return listPnl(user);
    if (!id && method === "POST") return createPnl(user, body);
    if (id && sub === "access" && method === "PUT") return setAccess(user, id, body);
    if (id && !sub && method === "GET") return getPnl(user, id);
    if (id && !sub && method === "PUT") return updatePnl(user, id, body);
    if (id && !sub && method === "DELETE") return deletePnl(user, id);
  }
  if (a === "deals") {
    if (!id && method === "GET") return listDeals(user);
    if (!id && method === "POST") return createDeal(user, body);
    if (id && sub === "notes" && method === "POST") return addDealNote(user, id, body);
    if (id && !sub && method === "GET") return getDeal(user, id);
    if (id && !sub && method === "PUT") return updateDeal(user, id, body);
    if (id && !sub && method === "DELETE") return deleteDeal(user, id);
  }
  if (a === "cheques") {
    if (!id && method === "GET") return listCheques();
    if (!id && method === "POST") return createCheque(user, body);
    if (id && method === "PUT") return updateCheque(user, id, body);
    if (id && method === "DELETE") return deleteCheque(user, id);
  }
  fail(404, "Unknown request.");
}

async function dispatch(method, path, getHeader, readBody, log = console) {
  try {
    const user = getUser(getHeader);
    user.sections = await access().sectionsFor(user);
    const seg = String(path || "").replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).map(decodeURIComponent);
    let body = {};
    if (method === "POST" || method === "PUT") { try { body = (await readBody()) || {}; } catch { fail(400, "The request could not be read."); } }
    const out = await route(method, seg, user, body);
    if (out && out.__binary) return { status: 200, raw: out.__binary, headers: out.headers };
    return out === undefined ? { status: 204 } : { status: 200, body: out };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message, ...(e.data || {}) } };
    log.error(e);
    return { status: 500, body: { error: "The server hit an error. Try again, and tell IT if it keeps happening." } };
  }
}

module.exports = { dispatch, compute };
