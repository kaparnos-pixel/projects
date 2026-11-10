// Team access: each company's managers (BIFOLD_MANAGERS, default ranjan@bifoldtech.com; TECHHUB_MANAGERS, default
// ranjan@techhubrak.ae) choose which sections each person in their company can use. Nobody has access until a
// manager gives it. Managers always have every section and are the only ones who can change access.
//
// Storage (Table Storage):
//   access       PK "user"   RowKey = email     sections (JSON array), updatedBy, updatedAt
//                PK "policy" RowKey = "default-<company>" sections for anyone in that company not listed (until set: every section)
//   accessseen   PK "seen"   RowKey = email     lastSeen (stamped at most once a day, so managers can see who signs in)

const SECTIONS = [
  { key: "pnl", name: "PnL Calculator", hint: "Create, view and share project PnLs" },
  { key: "pipeline", name: "Sales Pipeline", hint: "Deals from lead to PO" },
  { key: "pdc", name: "PDC & Guarantees Log", hint: "Post-dated cheques, deposits and guarantees" },
  { key: "customers", name: "Customers", hint: "Open the customer list and edit customer details" },
  { key: "amc", name: "AMC proposals & contracts", hint: "Create AMC proposals, award contracts, see contract values" },
  { key: "visits", name: "Maintenance visits & reports", hint: "Schedule and complete visits, upload photos, send visit reports" },
];
const KEYS = SECTIONS.map(s => s.key);
const CACHE_MS = 30000;

module.exports = function makeAccess(H) {
  const { table, getOrNull, all, fail, clean, emailOk, domains, CO, coForEmail, rowCo } = H;
  const cache = new Map(); const policies = new Map();
  // Team access is per company: managers see and set access only for people in their own company.
  const coOf = user => user.co === "all" ? user.homeCo : user.co;
  const coManagers = co => CO[co].managers();
  const parse = s => { try { const a = JSON.parse(s || "[]"); return Array.isArray(a) ? a.filter(k => KEYS.includes(k)) : []; } catch { return []; } };
  const sectionsIn = arr => [...new Set((Array.isArray(arr) ? arr : []).filter(k => KEYS.includes(k)))];

  // No one gets in by default: a manager must give each person access (strict mode).
  async function defaultSections() { return []; }
  async function sectionsFor(user) {
    if (user.isManager) return KEYS.slice();
    const hit = cache.get(user.email);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
    const e = await getOrNull(await table("access"), "user", user.email);
    const v = e ? parse(e.sections) : await defaultSections(user.homeCo);
    cache.set(user.email, { v, at: Date.now() });
    return v;
  }
  const seenToday = new Map();
  async function touch(email) {
    const day = new Date().toISOString().slice(0, 10);
    if (seenToday.get(email) === day) return;
    seenToday.set(email, day);
    try { await (await table("accessseen")).upsertEntity({ partitionKey: "seen", rowKey: email, lastSeen: new Date().toISOString() }, "Merge"); } catch {}
  }

  // Which section a request needs. Returns null when any signed-in user may make it.
  function need(method, seg, body) {
    const [a, b, c] = seg;
    if (a === "me" || a === "alerts") return null;
    if (a === "access") return "manager";
    if (a === "customers") {
      if (method === "GET") return "any";
      return method === "DELETE" ? "manager" : "customersOrTool";
    }
    if (a === "pnl") return "pnl";
    if (a === "deals") return "pipeline";
    if (a === "cheques") return "pdc";
    if (a === "amc") {
      if (b === "bootstrap" || b === "files") return ["amc", "visits"];
      if (b === "amcs") return "amc";
      if (b === "visits") return "visits";
      if (b === "ai" || b === "share") return body && (body.kind === "visit") ? "visits" : "amc";
      return ["amc", "visits"];
    }
    return null;
  }
  const boss = user => (CO[user.homeCo].managers()[0] || "your manager");
  const label = k => (SECTIONS.find(s => s.key === k) || {}).name || k;
  function guard(method, seg, body, user) {
    if (user.isManager) return;
    // Everything except "who am I" needs access granted by a manager.
    if (seg[0] !== "me" && !user.sections.length) fail(403, `You don't have access to ${user.homeCo === "techhub" ? "Tech Hub Tools" : "Bifold Tools"} yet. Ask ${boss(user)} to give you access.`);
    const n = need(method, seg, body);
    if (!n) return;
    if (n === "manager") fail(403, "Only managers can do this.");
    const has = k => user.sections.includes(k);
    if (n === "any") { if (!user.sections.length) fail(403, `You don't have access to ${user.homeCo === "techhub" ? "Tech Hub Tools" : "Bifold Tools"} yet. Ask ${boss(user)} to give you access.`); return; }
    if (n === "customersOrTool") { if (!["customers", "pnl", "pipeline", "pdc", "amc"].some(has)) fail(403, `You don't have access to edit customers. Ask ${boss(user)} to give you access.`); return; }
    const list = Array.isArray(n) ? n : [n];
    if (!list.some(has)) fail(403, `You don't have access to ${list.map(label).join(" or ")}. Ask ${boss(user)} to give you access.`);
  }

  async function overview(user) {
    const co = coOf(user);
    const t = await table("access");
    const rows = [];
    for await (const e of t.listEntities({ queryOptions: { filter: "PartitionKey eq 'user'" } })) rows.push(e);
    const seen = {};
    try { for await (const e of (await table("accessseen")).listEntities({ queryOptions: { filter: "PartitionKey eq 'seen'" } })) seen[e.rowKey] = e.lastSeen; } catch {}
    // People who have used the tools, so a manager can pick them without typing.
    const known = new Set(Object.keys(seen));
    const add = v => { const e = String(v || "").toLowerCase(); if (emailOk(e)) known.add(e); };
    const scan = async (name, pk, cols) => { try { (await all(await table(name), pk, cols)).forEach(r => cols.forEach(c => add(r[c]))); } catch {} };
    await Promise.all([scan("pnl", "pnl", ["owner"]), scan("deals", "deal", ["owner", "createdBy"]), scan("pdc", "cheque", ["createdBy"]), scan("customers", "customer", ["createdBy"]),
      scan("amc", "amc", ["owner"]), scan("amcvisits", "visit", ["createdBy", "updatedBy"])]);
    rows.forEach(r => known.add(r.rowKey));
    const listed = new Map(rows.map(r => [r.rowKey, r]));
    const managers = coManagers(co);
    [...known].forEach(e => { if (coForEmail(e) !== co) known.delete(e); });
    const users = [...known].sort().map(email => {
      const r = listed.get(email);
      return { email, isManager: managers.includes(email), listed: !!r, sections: managers.includes(email) ? KEYS.slice() : r ? parse(r.sections) : null,
        updatedBy: r ? r.updatedBy : "", updatedAt: r ? r.updatedAt : "", lastSeen: seen[email] || "" };
    });
    managers.forEach(m => { if (!known.has(m) && coForEmail(m) === co) users.push({ email: m, isManager: true, listed: false, sections: KEYS.slice(), updatedBy: "", updatedAt: "", lastSeen: seen[m] || "" }); });
    return { sections: SECTIONS, defaultSections: await defaultSections(co), users, domains: CO[co].domains(), company: { key: co, name: CO[co].name } };
  }
  async function setUser(user, email, body) {
    email = clean(email, 150).toLowerCase();
    const co = coOf(user);
    if (!emailOk(email) || coForEmail(email) !== co) fail(400, `Enter the email address of someone in ${CO[co].name} (${CO[co].domains().map(d => "@" + d).join(", ")}).`);
    if (coManagers(co).includes(email)) fail(400, "Managers always have access to every section.");
    const t = new Date().toISOString();
    await (await table("access")).upsertEntity({ partitionKey: "user", rowKey: email, sections: JSON.stringify(sectionsIn(body.sections)), updatedBy: user.email, updatedAt: t }, "Replace");
    cache.delete(email);
    return { email, sections: sectionsIn(body.sections), updatedBy: user.email, updatedAt: t };
  }
  async function removeUser(user, email) {
    email = clean(email, 150).toLowerCase();
    if (coForEmail(email) !== coOf(user)) fail(404, "That person isn't in your company.");
    try { await (await table("access")).deleteEntity("user", email); } catch (e) { if (e.statusCode !== 404) throw e; }
    cache.delete(email);
  }
  async function setDefault() { fail(400, "Access is given person by person. There is no default access."); }
  async function route(method, seg, user, body) {
    const [, b, c] = seg;
    if (!b && method === "GET") return overview(user);
    if (b === "users" && c && method === "PUT") return setUser(user, c, body);
    if (b === "users" && c && method === "DELETE") return removeUser(user, c);
    if (b === "default" && method === "PUT") return setDefault(user, body);
    fail(404, "Unknown request.");
  }
  return { sectionsFor, guard, touch, route, SECTIONS };
};
