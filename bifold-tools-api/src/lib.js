// Bifold Tools API: shared customers, saved PnL documents with per-document sharing, the sales pipeline, the PDC cheque log
// and the AMC Tracker (src/amc.js).
// Storage: Azure Table Storage (setting STORAGE_CONNECTION).
// Settings (see also src/amc.js and src/access.js):
//   BIFOLD_DOMAINS / TECHHUB_DOMAINS   email domains of each company (bifoldtech.com / techhubrak.ae)
//   BIFOLD_MANAGERS / TECHHUB_MANAGERS managers of each company (Team access, see everything in their company)
//   GROUP_ADMINS                       people who may switch company and open the read-only Group view (default: nobody)
//   STORAGE_CONNECTION  connection string of the storage account (required)
//   ALLOWED_DOMAINS     comma-separated email domains allowed to use the API (default bifoldtech.com)
//   BIFOLD_MANAGERS     comma-separated emails who can view, edit and share every PnL (default ranjan@bifoldtech.com)

const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");
const crypto = require("crypto");

class HttpError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}
const fail = (status, message, data) => { throw new HttpError(status, message, data); };

const list = (v, d) => String(v || d).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const domains = () => list(process.env.ALLOWED_DOMAINS, "bifoldtech.com,techhubrak.ae");
const emailOk = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && domains().some(d => e.endsWith("@" + d));

// ---------- companies ----------
// Each person belongs to the company of their email domain and only ever sees that company's records.
// GROUP_ADMINS (empty by default) may switch between companies and open the combined Group view (read-only).
const CO = {
  bifold: { key: "bifold", name: "Bifold Technologies", domains: () => list(process.env.BIFOLD_DOMAINS, "bifoldtech.com"), managers: () => list(process.env.BIFOLD_MANAGERS, "ranjan@bifoldtech.com") },
  techhub: { key: "techhub", name: "Tech Hub IT", domains: () => list(process.env.TECHHUB_DOMAINS, "techhubrak.ae"), managers: () => list(process.env.TECHHUB_MANAGERS, "ranjan@techhubrak.ae") },
};
const groupAdmins = () => String(process.env.GROUP_ADMINS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const coForEmail = e => (Object.values(CO).find(c => c.domains().some(d => String(e).endsWith("@" + d))) || {}).key || null;
const managers = () => Object.values(CO).flatMap(c => c.managers());
// Records written before companies existed belong to Bifold, except Tech Hub items logged under the company field.
const rowCo = e => e.co || (e.company === "Tech Hub IT" ? "techhub" : "bifold");
const inCo = (e, user) => user.co === "all" || rowCo(e) === user.co;
const writeCo = user => { if (user.co === "all") fail(400, "You're in the Group view, which is read-only. Switch to Bifold or Tech Hub in the top bar to make changes."); return user.co; };
const sameCoEmail = (e, user) => coForEmail(e) === (user.co === "all" ? user.homeCo : user.co);

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
  const homeCo = coForEmail(email);
  if (!emailOk(email) || !homeCo) fail(403, `Only ${domains().map(d => "@" + d).join(", ")} accounts can use these tools. You are signed in as ${email || "an unknown account"}.`);
  const group = groupAdmins().includes(email);
  let co = homeCo;
  const want = String(getHeader("x-bifold-company") || "").toLowerCase();
  if (group && (CO[want] || want === "all")) co = want;
  return { email, homeCo, co, group, isManager: group || CO[homeCo].managers().includes(email) };
}

const clean = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ---------- customers (shared by every tool) ----------
const CUST = "customers", CPK = "customer";
const custOut = e => ({
  id: e.rowKey, co: rowCo(e), name: e.name, contactName: e.contactName || "", email: e.email || "", phone: e.phone || "",
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
async function listCustomers(user) {
  const rows = await all(await table(CUST), CPK);
  return rows.filter(e => inCo(e, user)).map(custOut).sort((a, b) => a.name.localeCompare(b.name));
}
async function findDuplicate(name, exceptId, co) {
  const n = name.toLowerCase();
  return (await all(await table(CUST), CPK)).map(custOut).find(c => c.co === co && c.name.toLowerCase() === n && c.id !== exceptId);
}
async function createCustomer(user, b) {
  const f = custIn(b);
  const co = writeCo(user);
  const dup = await findDuplicate(f.name, null, co);
  if (dup) fail(409, `${dup.name} is already in the customer list.`, { customer: dup });
  const now = new Date().toISOString();
  const e = { partitionKey: CPK, rowKey: crypto.randomUUID(), co, ...f, createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now };
  await (await table(CUST)).createEntity(e);
  return custOut(e);
}
// Bulk import from a CSV / Excel file (parsed in the browser). Up to 1,000 rows per request.
// Rows whose name is already in the list (or repeated in the file) are skipped, or, with update set,
// their blank-or-changed details are overwritten with the non-empty values from the file.
async function importCustomers(user, b) {
  const co = writeCo(user);
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) fail(400, "The file has no customer rows.");
  if (rows.length > 1000) fail(400, "Import up to 1,000 customers at a time. Split the file and import it in parts.");
  const t = await table(CUST);
  const existing = new Map((await all(t, CPK)).filter(e => rowCo(e) === co).map(e => [String(e.name).toLowerCase(), e]));
  const now = new Date().toISOString();
  const creates = [], updates = [], skipped = [], invalid = [];
  const seen = new Set();
  rows.forEach((r, i) => {
    const name = clean(r && r.name, 150);
    if (!name) { invalid.push({ row: i + 1, reason: "No customer name" }); return; }
    const f = { name, contactName: clean(r.contactName, 100), email: clean(r.email, 150), phone: clean(r.phone, 50), trn: clean(r.trn, 30), emirate: clean(r.emirate, 50), address: clean(r.address, 300) };
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) f.email = "";
    const key = name.toLowerCase();
    if (seen.has(key)) { skipped.push({ row: i + 1, name, reason: "Repeated in the file" }); return; }
    seen.add(key);
    const cur = existing.get(key);
    if (cur) {
      if (!b.update) { skipped.push({ row: i + 1, name, reason: "Already in the list" }); return; }
      const ch = {}; for (const k of ["contactName", "email", "phone", "trn", "emirate", "address"]) if (f[k] && f[k] !== (cur[k] || "")) ch[k] = f[k];
      if (!Object.keys(ch).length) { skipped.push({ row: i + 1, name, reason: "No changes" }); return; }
      updates.push({ partitionKey: CPK, rowKey: cur.rowKey, co, ...ch, updatedBy: user.email, updatedAt: now });
      return;
    }
    creates.push({ partitionKey: CPK, rowKey: crypto.randomUUID(), co, ...f, createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now });
  });
  const actions = creates.map(e => ["create", e]).concat(updates.map(e => ["update", e, "Merge"]));
  for (let i = 0; i < actions.length; i += 100) await t.submitTransaction(actions.slice(i, i + 100));
  return { added: creates.length, updated: updates.length, skipped, invalid };
}
async function updateCustomer(user, id, b) {
  const t = await table(CUST);
  const cur = await getOrNull(t, CPK, id);
  if (!cur || !inCo(cur, user)) fail(404, "This customer no longer exists.");
  const co = writeCo(user);
  const f = custIn(b);
  const dup = await findDuplicate(f.name, id, co);
  if (dup) fail(409, `${dup.name} is already in the customer list.`, { customer: dup });
  const e = { partitionKey: CPK, rowKey: id, co, ...f, updatedBy: user.email, updatedAt: new Date().toISOString() };
  if (user.aud) user.aud.changes = audit().diff(cur, e);
  await t.updateEntity(e, "Merge");
  return custOut({ ...cur, ...e });
}
async function deleteCustomer(user, id) {
  if (!user.isManager) fail(403, "Only managers can delete customers.");
  writeCo(user);
  const t = await table(CUST);
  const cur = await getOrNull(t, CPK, id);
  if (!cur || !inCo(cur, user)) return;
  if (user.aud) user.aud.name = cur.name;
  try { await t.deleteEntity(CPK, id); } catch (e) { if (e.statusCode !== 404) throw e; }
}

// ---------- PnL documents ----------
const PNL = "pnl", PPK = "pnl";
const SUMMARY_COLS = ["RowKey", "co", "title", "company", "customerId", "customerName", "poNo", "poValue", "directCost", "netProfit", "netPct", "owner", "acl", "files", "status", "closedAt", "closedBy", "closeNote", "createdAt", "updatedAt", "updatedBy"];

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
  if (!inCo(e, user)) return null;
  if (e.owner === user.email) return "owner";
  if (user.isManager) return "manager";
  const r = aclOf(e)[user.email];
  return r === "edit" || r === "view" ? r : null;
}
const canEdit = r => r === "owner" || r === "manager" || r === "edit";
const canShare = r => r === "owner" || r === "manager";
const isClosed = e => e.status === "closed";
const CLOSED_MSG = "This project is closed. Reopen it to make changes.";

function summaryOut(e, role) {
  return {
    id: e.rowKey, co: rowCo(e), title: e.title || "", company: e.company || "", customerId: e.customerId || "", customerName: e.customerName || "",
    poNo: e.poNo || "", poValue: num(e.poValue), directCost: num(e.directCost), netProfit: num(e.netProfit), netPct: num(e.netPct),
    docs: (() => { const f = pnlFiles(e); return { po: f.filter(x => x.kind === "po").length, invoices: f.filter(x => x.kind === "invoice").length, invoiced: f.reduce((a, x) => a + (x.kind === "invoice" ? num(x.amount) : 0), 0) }; })(),
    owner: e.owner, createdAt: e.createdAt, updatedAt: e.updatedAt, updatedBy: e.updatedBy, role,
    status: isClosed(e) ? "closed" : "open", closedAt: e.closedAt || "", closedBy: e.closedBy || "", closeNote: e.closeNote || "",
  };
}
function fullOut(e, role) {
  return {
    ...summaryOut(e, role), data: unpackJson(e), files: pnlFiles(e), etag: e.etag,
    canEdit: canEdit(role) && !isClosed(e), canShare: canShare(role), access: canShare(role) ? aclOf(e) : undefined,
    canClose: canEdit(role) && !isClosed(e), canReopen: canShare(role) && isClosed(e),
  };
}
function docFields(b, co) {
  const d = b && typeof b.data === "object" && b.data ? b.data : fail(400, "Nothing to save.");
  d.company = CO[co].name;
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
  const co = writeCo(user);
  const e = { partitionKey: PPK, rowKey: newId(), co, ...docFields(b, co), owner: user.email, acl: "{}", createdAt: now, updatedAt: now, updatedBy: user.email };
  await t.createEntity(e);
  return getPnl(user, e.rowKey);
}
async function updatePnl(user, id, b) {
  const { e, role } = await loadDoc(user, id);
  if (!canEdit(role)) fail(403, "You can view this PnL but not change it. Ask its owner or a manager for edit rights.");
  if (isClosed(e)) fail(409, CLOSED_MSG);
  const next = {
    partitionKey: PPK, rowKey: id, co: rowCo(e), ...docFields(b, writeCo(user)), owner: e.owner, acl: e.acl, files: e.files || "[]", createdAt: e.createdAt,
    status: e.status || "open", closedAt: e.closedAt || "", closedBy: e.closedBy || "", closeNote: e.closeNote || "",
    updatedAt: new Date().toISOString(), updatedBy: user.email,
  };
  const t = await table(PNL);
  if (user.aud) user.aud.changes = audit().diff(e, next);
  try {
    await t.updateEntity(next, "Replace", { etag: b.etag || e.etag });
  } catch (err) {
    if (err.statusCode !== 412) throw err;
    // Attaching documents changes the row too. If nobody saved the figures since this person opened them, save anyway.
    const cur = await getOrNull(t, PPK, id);
    if (cur && isClosed(cur)) fail(409, CLOSED_MSG);
    if (!cur || !b.base || cur.updatedAt !== b.base) fail(409, "Someone else saved this PnL after you opened it. Reload it to see their changes, then make yours again.");
    try { await t.updateEntity({ ...next, files: cur.files || "[]" }, "Replace", { etag: cur.etag }); }
    catch (err2) { if (err2.statusCode === 412) fail(409, "Someone else changed this PnL at the same moment. Try saving again."); throw err2; }
  }
  return getPnl(user, id);
}
async function deletePnl(user, id) {
  const { e, role } = await loadDoc(user, id);
  if (user.aud) user.aud.name = [e.customerName, e.poNo].filter(Boolean).join(", ");
  if (!canShare(role)) fail(403, "Only the owner or a manager can delete this PnL.");
  writeCo(user);
  await (await table(PNL)).deleteEntity(PPK, id);
  const c = await pnlBlobs();
  await Promise.all(pnlFiles(e).map(f => c.deleteBlob(f.id).catch(() => {})));
}
// Open = still being delivered or invoiced to the customer. Closed = finished; figures and documents are locked.
async function setPnlStatus(user, id, b) {
  const { e, role } = await loadDoc(user, id);
  const want = b.status === "closed" ? "closed" : b.status === "open" ? "open" : fail(400, "Choose open or closed.");
  if (user.aud) { user.aud.name = [e.customerName, e.poNo].filter(Boolean).join(", "); user.aud.status = want; }
  if (want === "closed") {
    if (!canEdit(role)) fail(403, "You need edit rights on this PnL to close the project.");
    if (isClosed(e)) fail(409, "This project is already closed.");
  } else {
    if (!canShare(role)) fail(403, "Only the owner or a manager can reopen a closed project.");
    if (!isClosed(e)) fail(409, "This project is already open.");
  }
  writeCo(user);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(clean(b.date, 10)) ? clean(b.date, 10) : new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  const patch = want === "closed"
    ? { status: "closed", closedAt: date, closedBy: user.email, closeNote: clean(b.note, 300) }
    : { status: "open", closedAt: "", closedBy: "", closeNote: "" };
  try { await (await table(PNL)).updateEntity({ partitionKey: PPK, rowKey: id, ...patch }, "Merge", { etag: e.etag }); }
  catch (err) { if (err.statusCode === 412) fail(409, "Someone changed this PnL at the same moment. Reload it and try again."); throw err; }
  return getPnl(user, id);
}
async function setAccess(user, id, b) {
  const { e, role } = await loadDoc(user, id);
  if (!canShare(role)) fail(403, "Only the owner or a manager can change who has access.");
  const email = clean(b.email, 150).toLowerCase();
  const r = String(b.role || "");
  if (!emailOk(email) || !sameCoEmail(email, user)) fail(400, "Enter the email address of a colleague in your company.");
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
const DEAL_COLS = ["RowKey", "co", "title", "company", "customerId", "customerName", "value", "stage", "probability", "expectedClose",
  "source", "nextAction", "nextActionDate", "lostReason", "notes", "owner", "closedAt", "stageAt", "createdBy", "createdAt", "updatedAt", "updatedBy"];
const LOG_MAX = 200;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

function dealOut(e) {
  return {
    id: e.rowKey || e.RowKey, co: rowCo(e), title: e.title || "", company: e.company || "", customerId: e.customerId || "", customerName: e.customerName || "",
    value: num(e.value), stage: e.stage, probability: num(e.probability), expectedClose: e.expectedClose || "",
    source: e.source || "", nextAction: e.nextAction || "", nextActionDate: e.nextActionDate || "", lostReason: e.lostReason || "",
    notes: e.notes || "", owner: e.owner, closedAt: e.closedAt || "", stageAt: e.stageAt || "",
    createdBy: e.createdBy, createdAt: e.createdAt, updatedAt: e.updatedAt, updatedBy: e.updatedBy,
  };
}
const dealVisible = (e, user) => inCo(e, user) && (user.isManager || e.owner === user.email);

function dealIn(b, user, cur) {
  const f = {
    title: clean(b.title, 150), company: clean(b.company, 80), customerId: clean(b.customerId, 60), customerName: clean(b.customerName, 150),
    value: Math.max(0, num(b.value)), stage: String(b.stage || "lead"), expectedClose: clean(b.expectedClose, 10),
    source: clean(b.source, 60), nextAction: clean(b.nextAction, 200), nextActionDate: clean(b.nextActionDate, 10),
    lostReason: clean(b.lostReason, 300), notes: clean(b.notes, 4000),
  };
  if (!f.title) fail(400, "Enter what the deal is for.");
  if (!f.customerId) fail(400, "Choose a customer.");
  f.company = CO[writeCo(user)].name;
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
    if (!emailOk(want) || !sameCoEmail(want, user)) fail(400, "Enter the email address of a colleague in your company as the owner.");
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
  const c0 = await getOrNull(await table(CUST), CPK, f.customerId);
  const c = c0 && rowCo(c0) === f.co ? c0 : null;
  if (c) f.customerName = c.name;
  else if (cur && cur.customerId === f.customerId) f.customerName = cur.customerName || f.customerName;
  else fail(400, "That customer is no longer in the customer list. Choose another.");
}
async function createDeal(user, b) {
  const f = dealIn(b, user, null);
  f.co = writeCo(user);
  await resolveCustomer(f, null); delete f.co;
  const now = new Date().toISOString();
  const closed = f.stage === "won" || f.stage === "lost";
  const log = [logEntry(user, "create", `Created at ${STAGE_NAMES[f.stage]}` + (f.owner !== user.email ? `, assigned to ${f.owner}` : ""))];
  const e = { partitionKey: DPK, rowKey: dealId(), co: writeCo(user), ...f, closedAt: closed ? now : "", stageAt: now, createdBy: user.email, createdAt: now, updatedAt: now, updatedBy: user.email, ...packJson({ log }) };
  await (await table(DEALS)).createEntity(e);
  return getDeal(user, e.rowKey);
}
async function updateDeal(user, id, b) {
  const cur = await loadDeal(user, id);
  const f = dealIn(b, user, cur);
  f.co = rowCo(cur);
  await resolveCustomer(f, cur); delete f.co;
  const now = new Date().toISOString();
  let log = unpackJson(cur).log || [];
  for (const [kind, text] of describeChanges(cur, f)) log = addLog(log, logEntry(user, kind, text));
  const stageChanged = cur.stage !== f.stage;
  const closed = f.stage === "won" || f.stage === "lost";
  const next = {
    partitionKey: DPK, rowKey: id, co: rowCo(cur), ...f,
    closedAt: closed ? (stageChanged || !cur.closedAt ? now : cur.closedAt) : "",
    stageAt: stageChanged ? now : (cur.stageAt || cur.createdAt),
    createdBy: cur.createdBy, createdAt: cur.createdAt, updatedAt: now, updatedBy: user.email, ...packJson({ log }),
  };
  if (user.aud) { user.aud.changes = audit().diff(cur, next); user.aud.name = cur.title || cur.customerName; }
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
  if (user.aud) user.aud.name = [cur.title, cur.customerName].filter(Boolean).join(", ");
  writeCo(user);
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
    id: e.rowKey, co: rowCo(e), kind: e.kind || "pdc", form: e.form || "", company: e.company || "", payeeType: e.payeeType || "", payee: e.payee || "",
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
async function listCheques(user) {
  const rows = await all(await table(PDC), QPK);
  return rows.filter(e => inCo(e, user)).map(chqOut).sort((a, b) => a.clearanceDate.localeCompare(b.clearanceDate));
}
async function findChequeNo(f, exceptId) {
  if (!f.chequeNo) return null;
  const n = f.chequeNo.toLowerCase();
  return (await all(await table(PDC), QPK)).map(chqOut).find(c => c.co === f.co && c.kind === f.kind && c.chequeNo.toLowerCase() === n && c.id !== exceptId && c.status !== "cancelled");
}
const dupMsg = (d, f) => `${KINDS[d.kind]} ${d.chequeNo} for ${f.company} is already logged (${d.payee}).`;
async function createCheque(user, b) {
  const f = chqIn(b);
  f.co = writeCo(user); f.company = CO[f.co].name;
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
  if (!cur || !inCo(cur, user)) fail(404, "This entry no longer exists.");
  const f = chqIn(b);
  f.co = writeCo(user); f.company = CO[f.co].name;
  const dup = await findChequeNo(f, id);
  if (dup) fail(409, dupMsg(dup, f));
  const reminderSentAt = cur.clearanceDate === f.clearanceDate ? (cur.reminderSentAt || "") : "";
  const next = { partitionKey: QPK, rowKey: id, ...f, reminderSentAt, createdBy: cur.createdBy, createdAt: cur.createdAt, updatedBy: user.email, updatedAt: new Date().toISOString() };
  if (user.aud) user.aud.changes = audit().diff(cur, next);
  try { await t.updateEntity(next, "Replace", { etag: b.etag || cur.etag }); }
  catch (err) { if (err.statusCode === 412) fail(409, "Someone else changed this entry after you opened it. Reload to see their changes, then make yours again."); throw err; }
  return chqOut(await t.getEntity(QPK, id));
}
async function deleteCheque(user, id) {
  const t = await table(PDC);
  const cur = await getOrNull(t, QPK, id);
  if (!cur || !inCo(cur, user)) return;
  if (user.aud) user.aud.name = [cur.type, cur.chequeNo || cur.ref, cur.party || cur.customerName, cur.amount ? "AED " + cur.amount : ""].filter(Boolean).join(" ");
  writeCo(user);
  if (!user.isManager && cur.createdBy !== user.email) fail(403, "Only the person who logged this entry or a manager can delete it. Mark it cancelled instead.");
  await t.deleteEntity(QPK, id);
}

// ---------- AMC Tracker (src/amc.js) ----------
const mailReadyFor = co => ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET"].every(k => process.env[k]) && !!(co === "techhub" ? process.env.TECHHUB_MAIL_SENDER : co === "bifold" ? process.env.MAIL_SENDER : "");
let amcRoute;
const amc = () => amcRoute || (amcRoute = require("./amc")({ table, getOrNull, all, packJson, unpackJson, fail, clean, num, isDate, emailOk, CUST, CPK, CO, rowCo, inCo, writeCo, sameCoEmail, mailReadyFor, diff: (a, b) => audit().diff(a, b) }));

// ---------- Email Campaigns (src/mk.js) ----------
let mkMod;
const mk = () => mkMod || (mkMod = require("./mk")({ table, getOrNull, packJson, unpackJson, fail, clean, CO, writeCo, record: x => audit().record(x) }));

// ---------- Project Completion Reports (src/pcr.js) ----------
let pcrMod;
const pcr = () => pcrMod || (pcrMod = require("./pcr")({ table, getOrNull, all, packJson, unpackJson, fail, clean, num, isDate, CUST, CPK, CO, rowCo, inCo, writeCo, mailReadyFor, diff: (a, b) => audit().diff(a, b), record: x => audit().record(x) }));

// ---------- Suppliers & Vendors (src/suppliers.js) ----------
let supMod;
const sup = () => supMod || (supMod = require("./suppliers")({ table, getOrNull, all, fail, clean, num, CO, rowCo, inCo, writeCo, diff: (a, b) => audit().diff(a, b) }));

// ---------- team access (src/access.js) ----------
let accessMod;
let auditMod;
const audit = () => auditMod || (auditMod = require("./audit")({ table, fail, clean, CO }));
const access = () => accessMod || (accessMod = require("./access")({ table, getOrNull, all, fail, clean, emailOk, domains, managers, CO, coForEmail, rowCo }));

// ---------- alerts for the top bar and home page ----------
// Everything that needs someone's attention today, limited to the sections they can use.
async function alerts(user) {
  const has = k => user.isManager || (user.sections || []).includes(k);
  const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  const plus = n => new Date(Date.parse(today + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const days = d => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 864e5);
  const fd = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const out = [];
  const jobs = [];
  if (has("pdc")) jobs.push(listCheques(user).then(list => list.filter(c => c.status === "pending" && c.clearanceDate <= plus(7)).forEach(c => {
    const d = days(c.clearanceDate);
    out.push({ tool: "pdc", severity: d < 0 ? "high" : d <= 2 ? "medium" : "low", when: c.clearanceDate, href: "/pdc/",
      title: `${c.kind === "pdc" ? "Cheque" : c.kind === "apg" ? "Guarantee" : "Deposit"} ${c.chequeNo || ""} to ${c.payee}`.replace(/\s+/g, " "),
      text: `AED ${c.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })} · ${d < 0 ? "overdue since " + fd(c.clearanceDate) : d === 0 ? "due today" : "due " + fd(c.clearanceDate)}` });
  })).catch(() => {}));
  if (has("pipeline")) jobs.push(listDeals(user).then(list => list.filter(x => !["won", "lost"].includes(x.stage)).forEach(x => {
    if (x.nextActionDate && x.nextActionDate <= today) out.push({ tool: "pipeline", severity: x.nextActionDate < today ? "medium" : "low", when: x.nextActionDate, href: "/pipeline/",
      title: x.nextAction || "Follow up", text: `${x.customerName} · ${x.nextActionDate < today ? "was due " + fd(x.nextActionDate) : "due today"}` });
    else if (x.expectedClose && x.expectedClose < today) out.push({ tool: "pipeline", severity: "low", when: x.expectedClose, href: "/pipeline/",
      title: `${x.title}: close date passed`, text: `${x.customerName} · expected ${fd(x.expectedClose)}` });
  })).catch(() => {}));
  if (has("amc") || has("visits")) jobs.push(amc()("GET", ["bootstrap"], user, {}).then(b => {
    b.contracts.filter(c => c.status === "active").forEach(c => { const d = days(c.end); if (d <= (c.alertDays || 60) && d > -60)
      out.push({ tool: "amc", severity: d < 0 ? "high" : d <= 30 ? "medium" : "low", when: c.end, href: "/amc/#amcs", title: `AMC ${d < 0 ? "expired" : "expiring"}: ${c.customerName}`,
        text: `${c.ref} · ${d < 0 ? "ended " + fd(c.end) : d + " days left"}${c.renewalAmcId ? " · renewal started" : ""}` }); });
    if (has("visits")) {
      // One line per contract, however many of its visits are overdue.
      const late = {}; b.visits.filter(v => v.status === "scheduled" && v.scheduledDate < today).forEach(v => (late[v.amcId] ||= []).push(v));
      Object.values(late).forEach(vs => { vs.sort((x, y) => x.scheduledDate.localeCompare(y.scheduledDate)); const v = vs[0];
        out.push({ tool: "visits", severity: vs.length > 1 ? "high" : "medium", when: v.scheduledDate, href: "/amc/#visits",
          title: vs.length > 1 ? `${vs.length} visits overdue: ${v.customerName}` : `Visit overdue: ${v.customerName}`,
          text: vs.length > 1 ? `Oldest planned ${fd(v.scheduledDate)} · ${v.ref}` : `Planned ${fd(v.scheduledDate)} · ${v.engineers || "no engineer assigned"}` }); });
    }
  }).catch(() => {}));
  await Promise.all(jobs);
  const rank = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || String(a.when).localeCompare(String(b.when)));
  return { count: out.length, items: out.slice(0, 40) };
}

// ---------- PnL documents: customer PO and supplier invoices (Blob Storage "pnl-files") ----------
// The list lives in the PnL row's "files" column, apart from the PnL figures, so attaching a document never
// conflicts with someone editing the numbers. Anyone who can open the PnL can view its documents;
// people who can edit it can add, describe and remove them.
const PNL_FILE_MAX = 10 * 1048576;
const FILE_KINDS = ["po", "invoice", "other"];
function pnlFiles(e) { try { const a = JSON.parse(e.files || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } }
let pnlContainer;
async function pnlBlobs() {
  if (!pnlContainer) {
    const cs = process.env.STORAGE_CONNECTION; if (!cs) fail(500, "Storage is not set up yet. Add the STORAGE_CONNECTION setting to the Static Web App.");
    pnlContainer = BlobServiceClient.fromConnectionString(cs).getContainerClient("pnl-files");
    await pnlContainer.createIfNotExists();
  }
  return pnlContainer;
}
const fileMeta = b => ({ supplier: clean(b.supplier, 120), ref: clean(b.ref, 60), date: /^\d{4}-\d{2}-\d{2}$/.test(clean(b.date, 10)) ? clean(b.date, 10) : "", amount: Math.max(0, Math.round(num(b.amount) * 100) / 100) });
// Change the file list with a retry, in case two people attach documents at the same moment.
async function changeFiles(id, fn) {
  const t = await table(PNL);
  for (let i = 0; i < 4; i++) {
    const e = await getOrNull(t, PPK, id); if (!e) fail(404, "This PnL doesn't exist or was deleted.");
    const files = fn(pnlFiles(e));
    try { const r = await t.updateEntity({ partitionKey: PPK, rowKey: id, files: JSON.stringify(files) }, "Merge", { etag: e.etag }); return { files, etag: r && r.etag }; }
    catch (err) { if (err.statusCode !== 412) throw err; }
  }
  fail(409, "The documents were changed by someone else at the same time. Try again.");
}
async function addPnlFile(user, id, b) {
  const { e, role } = await loadDoc(user, id);
  if (!canEdit(role)) fail(403, "You can view this PnL but not add documents to it.");
  if (isClosed(e)) fail(409, CLOSED_MSG);
  const co = writeCo(user);
  if (pnlFiles(e).length >= 60) fail(400, "A PnL can hold at most 60 documents.");
  const kind = FILE_KINDS.includes(b.kind) ? b.kind : "other";
  const name = clean(b.name, 200) || "document"; const type = clean(b.type, 120) || "application/octet-stream";
  const buf = Buffer.from(String(b.data || ""), "base64");
  if (!buf.length) fail(400, "The file is empty.");
  if (buf.length > PNL_FILE_MAX) fail(413, `${name} is larger than 10 MB.`);
  const fid = crypto.randomUUID();
  await (await pnlBlobs()).getBlockBlobClient(fid).uploadData(buf, { blobHTTPHeaders: { blobContentType: type }, metadata: { name: encodeURIComponent(name), pnl: id, co } });
  const f = { id: fid, kind, name, type, size: buf.length, by: user.email, at: new Date().toISOString(), ...fileMeta(b) };
  return { file: f, ...(await changeFiles(id, l => l.concat(f))) };
}
async function editPnlFile(user, id, fid, b) {
  const { e, role } = await loadDoc(user, id);
  if (!canEdit(role)) fail(403, "You can view this PnL but not change its documents.");
  if (isClosed(e)) fail(409, CLOSED_MSG);
  writeCo(user);
  let found = false;
  const out = await changeFiles(id, l => l.map(f => { if (f.id !== fid) return f; found = true; const n = { ...f, ...fileMeta(b), kind: FILE_KINDS.includes(b.kind) ? b.kind : f.kind }; if (user.aud) { user.aud.name = f.name; user.aud.changes = audit().diff(f, n); } return n; }));
  if (!found) fail(404, "That document is no longer attached.");
  return out;
}
async function removePnlFile(user, id, fid) {
  const { e, role } = await loadDoc(user, id);
  if (!canEdit(role)) fail(403, "You can view this PnL but not remove its documents.");
  if (isClosed(e)) fail(409, CLOSED_MSG);
  writeCo(user);
  const out = await changeFiles(id, l => l.filter(f => { if (f.id === fid && user.aud) user.aud.name = f.name; return f.id !== fid; }));
  await (await pnlBlobs()).deleteBlob(fid).catch(() => {});
  return out;
}
async function getPnlFile(user, id, fid, download) {
  const { e } = await loadDoc(user, id);
  const f = pnlFiles(e).find(x => x.id === fid);
  if (!f) fail(404, "That document is no longer attached.");
  if (user.aud) user.aud.name = f.name;
  let buf;
  try { buf = await (await pnlBlobs()).getBlockBlobClient(fid).downloadToBuffer(); } catch (err) { if (err.statusCode === 404) fail(404, "That document is no longer available."); throw err; }
  const inline = !download && /^(image\/|application\/pdf$)/.test(f.type);
  return { __binary: buf, headers: { "Content-Type": f.type || "application/octet-stream", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`, "Cache-Control": "private, no-store" } };
}

// ---------- routing ----------
async function route(method, seg, user, body) {
  const [a, id, sub] = seg;
  access().guard(method, seg, body, user);
  if (a === "access") return access().route(method, seg, user, body);
  if (a === "amc") return amc()(method, seg.slice(1), user, body);
  if (a === "mk") return mk().route(method, seg.slice(1), user, body);
  if (a === "pcr") return pcr().route(method, seg.slice(1), user, body);
  if (a === "suppliers") return sup().route(method, seg.slice(1), user, body);
  if (a === "alerts" && method === "GET") return alerts(user);
  if (a === "audit" && method === "GET") return audit().list(user, id);
  if (a === "me" && method === "GET") { if (access().touch(user.email) && user.aud) { user.aud.signin = true; user.aud.noAccess = !user.isManager && !user.sections.length; }
    if (!user.isManager && !user.sections.length) return { email: user.email, homeCo: user.homeCo, co: user.co, group: false, isManager: false, sections: [], noAccess: true, managers: [], allSections: [], companies: [], mailReady: false };
    return { ...user, managers: CO[user.homeCo].managers(), domains: domains(), allSections: access().SECTIONS, companies: Object.values(CO).map(c => ({ key: c.key, name: c.name })), mailReady: mailReadyFor(user.co) }; }
  if (a === "customers") {
    if (!id && method === "GET") return listCustomers(user);
    if (!id && method === "POST") return createCustomer(user, body);
    if (id === "import" && method === "POST") return importCustomers(user, body);
    if (id && method === "PUT") return updateCustomer(user, id, body);
    if (id && method === "DELETE") return deleteCustomer(user, id);
  }
  if (a === "pnl") {
    if (!id && method === "GET") return listPnl(user);
    if (!id && method === "POST") return createPnl(user, body);
    if (id && sub === "access" && method === "PUT") return setAccess(user, id, body);
    if (id && sub === "status" && method === "PUT") return setPnlStatus(user, id, body);
    if (id && sub === "files") {
      const fid = seg[3];
      if (!fid && method === "POST") return addPnlFile(user, id, body);
      if (fid && method === "GET") return getPnlFile(user, id, fid, seg[4] === "download");
      if (fid && method === "PUT") return editPnlFile(user, id, fid, body);
      if (fid && method === "DELETE") return removePnlFile(user, id, fid);
    }
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
    if (!id && method === "GET") return listCheques(user);
    if (!id && method === "POST") return createCheque(user, body);
    if (id && method === "PUT") return updateCheque(user, id, body);
    if (id && method === "DELETE") return deleteCheque(user, id);
  }
  fail(404, "Unknown request.");
}

const outsiderSeen = new Map();
// Which requests go in the activity log: every change (and every refused one), every document opened or
// downloaded, refused reads, the first sign-in of the day, and sign-in attempts from outside accounts.
function shouldRecord(method, seg, status, user, body) {
  const [a, b, c] = seg;
  if (a === "audit") return false;
  if (a === "mk" && (b === "audience" || b === "render.js")) return false;
  if (a === "me") return !!(user && user.aud && user.aud.signin);
  const fileGet = method === "GET" && ((a === "pnl" && c === "files" && seg[3]) || (a === "amc" && b === "files" && c));
  // Photos and signatures shown in the report editor are not logged one by one; downloads are.
  if (a === "pcr" && b === "files" && method === "GET") return seg[3] === "download" || status === 403;
  // Refused reads are logged for people who have some access (trying beyond it); people with none are logged at sign-in.
  if (method === "GET" && !fileGet) return status === 403 && (user.isManager || user.sections.length > 0);
  if (status >= 400 && status !== 401 && status !== 403 && !(fileGet && status === 404)) return false;
  // Background bookkeeping from the AMC page (proposal progress flags) is not a person's action.
  if (a === "amc" && b === "amcs" && method === "PUT" && Object.keys(body || {}).every(k => ["etag", "proposalStatus", "log"].includes(k))) return false;
  return true;
}
async function dispatch(method, path, getHeader, readBody, log = console) {
  let user = null, body = {}, status = 200, error = "", res;
  const seg = String(path || "").replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  const ip = String(getHeader("x-forwarded-for") || getHeader("x-client-ip") || "").split(",")[0].trim();
  let out;
  // Public routes (no sign-in): the unsubscribe page, images used in campaign emails, and customer signing links.
  if (seg[0] === "public") {
    try {
      const o = seg[1] === "pcr" ? await pcr().publicRoute(method, seg.slice(2), ip, readBody) : await mk().publicRoute(method, seg.slice(1), ip);
      return o && o.__binary ? { status: 200, raw: o.__binary, headers: o.headers } : { status: 200, body: o };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
      log.error(e); return { status: 500, body: { error: "Something went wrong. Please try again in a moment." } };
    }
  }
  try {
    user = getUser(getHeader);
    user.aud = {};
    user.sections = await access().sectionsFor(user);
    if (method === "POST" || method === "PUT") { try { body = (await readBody()) || {}; } catch { fail(400, "The request could not be read."); } }
    out = await route(method, seg, user, body);
    if (out && out.__binary) res = { status: 200, raw: out.__binary, headers: out.headers };
    else res = out === undefined ? { status: 204 } : { status: 200, body: out };
    status = res.status;
  } catch (e) {
    if (e instanceof HttpError) { status = e.status; error = e.message; res = { status: e.status, body: { error: e.message, ...(e.data || {}) } }; }
    else { log.error(e); status = 500; res = { status: 500, body: { error: "The server hit an error. Try again, and tell IT if it keeps happening." } }; }
  }
  try {
    if (!user) {
      // Someone signed in with an account outside both companies: note it once a day per account.
      let email = "";
      try { email = String(JSON.parse(Buffer.from(getHeader("x-ms-client-principal") || "", "base64").toString("utf8")).userDetails || "").toLowerCase(); } catch {}
      const day = new Date().toISOString().slice(0, 10);
      if (email && status === 403 && outsiderSeen.get(email) !== day) {
        outsiderSeen.set(email, day);
        await audit().record({ email, co: "security", method, seg: ["outsider"], body: {}, out: {}, status, error, ip, aud: { name: "Sign-in from an outside account" } });
      }
    } else if (shouldRecord(method, seg, status, user, body)) {
      await audit().record({ user, method, seg, body, out: out && !out.__binary ? out : {}, status, error, ip, aud: user.aud });
    }
  } catch (e) { log.error(e); }
  return res;
}

module.exports = { dispatch, compute };
