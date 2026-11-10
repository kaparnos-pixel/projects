// Team access: managers (BIFOLD_MANAGERS, default ranjan@bifoldtech.com) choose which sections of Bifold Tools
// each person can use. Managers always have every section and are the only ones who can change access.
//
// Storage (Table Storage):
//   access       PK "user"   RowKey = email     sections (JSON array), updatedBy, updatedAt
//                PK "policy" RowKey = "default" sections for anyone not listed (until set: every section)
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
  const { table, getOrNull, all, fail, clean, emailOk, domains } = H;
  const cache = new Map(); let policy = { v: null, at: 0 };
  const parse = s => { try { const a = JSON.parse(s || "[]"); return Array.isArray(a) ? a.filter(k => KEYS.includes(k)) : []; } catch { return []; } };
  const sectionsIn = arr => [...new Set((Array.isArray(arr) ? arr : []).filter(k => KEYS.includes(k)))];

  async function defaultSections() {
    if (policy.v && Date.now() - policy.at < CACHE_MS) return policy.v;
    const e = await getOrNull(await table("access"), "policy", "default");
    policy = { v: e ? parse(e.sections) : KEYS.slice(), at: Date.now() };
    return policy.v;
  }
  async function sectionsFor(user) {
    if (user.isManager) return KEYS.slice();
    const hit = cache.get(user.email);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
    const e = await getOrNull(await table("access"), "user", user.email);
    const v = e ? parse(e.sections) : await defaultSections();
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
    if (a === "me") return null;
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
  const label = k => (SECTIONS.find(s => s.key === k) || {}).name || k;
  function guard(method, seg, body, user) {
    const n = need(method, seg, body);
    if (!n || user.isManager) return;
    if (n === "manager") fail(403, "Only managers can do this.");
    const has = k => user.sections.includes(k);
    if (n === "any") { if (!user.sections.length) fail(403, "You don't have access to Bifold Tools yet. Ask Ranjan to give you access."); return; }
    if (n === "customersOrTool") { if (!["customers", "pnl", "pipeline", "pdc", "amc"].some(has)) fail(403, "You don't have access to edit customers. Ask Ranjan to give you access."); return; }
    const list = Array.isArray(n) ? n : [n];
    if (!list.some(has)) fail(403, `You don't have access to ${list.map(label).join(" or ")}. Ask Ranjan to give you access.`);
  }

  async function overview() {
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
    const managers = H.managers();
    const users = [...known].sort().map(email => {
      const r = listed.get(email);
      return { email, isManager: managers.includes(email), listed: !!r, sections: managers.includes(email) ? KEYS.slice() : r ? parse(r.sections) : null,
        updatedBy: r ? r.updatedBy : "", updatedAt: r ? r.updatedAt : "", lastSeen: seen[email] || "" };
    });
    managers.forEach(m => { if (!known.has(m)) users.push({ email: m, isManager: true, listed: false, sections: KEYS.slice(), updatedBy: "", updatedAt: "", lastSeen: seen[m] || "" }); });
    return { sections: SECTIONS, defaultSections: await defaultSections(), users, domains: domains() };
  }
  async function setUser(user, email, body) {
    email = clean(email, 150).toLowerCase();
    if (!emailOk(email)) fail(400, `Enter a valid ${domains().map(d => "@" + d).join(" or ")} email address.`);
    if (H.managers().includes(email)) fail(400, "Managers always have access to every section.");
    const t = new Date().toISOString();
    await (await table("access")).upsertEntity({ partitionKey: "user", rowKey: email, sections: JSON.stringify(sectionsIn(body.sections)), updatedBy: user.email, updatedAt: t }, "Replace");
    cache.delete(email);
    return { email, sections: sectionsIn(body.sections), updatedBy: user.email, updatedAt: t };
  }
  async function removeUser(email) {
    email = clean(email, 150).toLowerCase();
    try { await (await table("access")).deleteEntity("user", email); } catch (e) { if (e.statusCode !== 404) throw e; }
    cache.delete(email);
  }
  async function setDefault(user, body) {
    await (await table("access")).upsertEntity({ partitionKey: "policy", rowKey: "default", sections: JSON.stringify(sectionsIn(body.sections)), updatedBy: user.email, updatedAt: new Date().toISOString() }, "Replace");
    policy = { v: null, at: 0 }; cache.clear();
    return { defaultSections: await defaultSections() };
  }
  async function route(method, seg, user, body) {
    const [, b, c] = seg;
    if (!b && method === "GET") return overview();
    if (b === "users" && c && method === "PUT") return setUser(user, c, body);
    if (b === "users" && c && method === "DELETE") return removeUser(c);
    if (b === "default" && method === "PUT") return setDefault(user, body);
    fail(404, "Unknown request.");
  }
  return { sectionsFor, guard, touch, route, SECTIONS };
};
