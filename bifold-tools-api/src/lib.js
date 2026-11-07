// Bifold Tools API: shared customers, saved PnL documents and per-document sharing.
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
  if (s.length > CHUNK * MAX_CHUNKS) fail(413, "This PnL is too large to save. Split it into smaller documents.");
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

// ---------- routing ----------
async function route(method, seg, user, body) {
  const [a, id, sub] = seg;
  if (a === "me" && method === "GET") return { ...user, managers: managers(), domains: domains() };
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
  fail(404, "Unknown request.");
}

async function dispatch(method, path, getHeader, readBody, log = console) {
  try {
    const user = getUser(getHeader);
    const seg = String(path || "").replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).map(decodeURIComponent);
    let body = {};
    if (method === "POST" || method === "PUT") { try { body = (await readBody()) || {}; } catch { fail(400, "The request could not be read."); } }
    const out = await route(method, seg, user, body);
    return out === undefined ? { status: 204 } : { status: 200, body: out };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message, ...(e.data || {}) } };
    log.error(e);
    return { status: 500, body: { error: "The server hit an error. Try again, and tell IT if it keeps happening." } };
  }
}

module.exports = { dispatch, compute };
