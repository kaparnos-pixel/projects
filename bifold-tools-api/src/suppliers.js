// Suppliers & Vendors: one directory per company of who supplies what (categories, brands, products) and who to call there.
// Each supplier holds any number of contact persons (sales, accounts, technical, logistics ...).
//
// Storage (Table Storage "suppliers", PartitionKey "supplier", RowKey = uuid):
//   co, name, kind, status, categories (JSON), brands (JSON), supplies, website, email, phone, address, emirate, country,
//   trn, licenceNo, paymentTerms, creditDays, creditLimit, currency, rating, notes, contacts (JSON), created/updated stamps
//
// Access: section "suppliers" to add and edit. People with the PDC log can also read the list (to look up payees).
// Only the person who added a supplier or a manager can delete it.

const crypto = require("crypto");

const KINDS = ["Supplier", "Vendor", "Distributor", "Manufacturer", "Subcontractor", "Service provider"];
const STATUS = ["active", "preferred", "onhold", "blocked"];
const MAX_CONTACTS = 30, MAX_TAGS = 40;

module.exports = function makeSuppliers(H) {
  const { table, getOrNull, all, fail, clean, num, CO, rowCo, inCo, writeCo, diff } = H;
  const T = "suppliers", PK = "supplier";
  const json = (s, d) => { try { const v = JSON.parse(s || ""); return Array.isArray(v) ? v : d; } catch { return d; } };
  const emailRx = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  // Tags: accept an array or a "a, b; c" string. Keeps the first spelling of each tag, case-insensitively.
  function tags(v) {
    const arr = Array.isArray(v) ? v : String(v || "").split(/[,;\n|]+/);
    const seen = new Set(), out = [];
    for (const x of arr) { const t = clean(x, 60).replace(/\s+/g, " "); const k = t.toLowerCase(); if (t && !seen.has(k)) { seen.add(k); out.push(t); } if (out.length >= MAX_TAGS) break; }
    return out;
  }
  function contactIn(c) {
    c = c || {};
    const o = {
      id: clean(c.id, 40) || crypto.randomUUID().slice(0, 8), name: clean(c.name, 100), role: clean(c.role, 80), mobile: clean(c.mobile, 40),
      phone: clean(c.phone, 40), email: clean(c.email, 150).toLowerCase(), handles: clean(c.handles, 200), notes: clean(c.notes, 400), primary: !!c.primary,
    };
    if (o.email && !emailRx.test(o.email)) fail(400, `The email for ${o.name || "a contact"} is not valid.`);
    return o;
  }
  function contactsIn(list) {
    const arr = (Array.isArray(list) ? list : []).map(contactIn).filter(c => c.name || c.email || c.mobile || c.phone);
    if (arr.length > MAX_CONTACTS) fail(400, `A supplier can have at most ${MAX_CONTACTS} contacts.`);
    arr.forEach(c => { if (!c.name) fail(400, "Every contact needs a name."); });
    // Exactly one primary contact when there are any.
    let p = arr.findIndex(c => c.primary); if (p < 0) p = 0;
    arr.forEach((c, i) => { c.primary = i === p; });
    return arr;
  }
  function fieldsIn(b) {
    const f = {
      name: clean(b.name, 150), kind: clean(b.kind, 30) || "Supplier", status: clean(b.status, 20) || "active",
      supplies: clean(b.supplies, 1500), website: clean(b.website, 200), email: clean(b.email, 150).toLowerCase(), phone: clean(b.phone, 50),
      address: clean(b.address, 300), emirate: clean(b.emirate, 50), country: clean(b.country, 60) || "UAE",
      trn: clean(b.trn, 30), licenceNo: clean(b.licenceNo, 50), paymentTerms: clean(b.paymentTerms, 80),
      creditDays: Math.max(0, Math.min(3650, Math.round(num(b.creditDays)))), creditLimit: Math.max(0, Math.round(num(b.creditLimit) * 100) / 100),
      currency: clean(b.currency, 5).toUpperCase() || "AED", rating: Math.max(0, Math.min(5, Math.round(num(b.rating)))), notes: clean(b.notes, 3000),
    };
    if (!f.name) fail(400, "Enter the supplier name.");
    if (!KINDS.includes(f.kind)) fail(400, "Choose a valid supplier type.");
    if (!STATUS.includes(f.status)) fail(400, "Choose a valid status.");
    if (f.email && !emailRx.test(f.email)) fail(400, "The company email is not valid.");
    if (f.creditLimit > 1e10) fail(400, "The credit limit is too large.");
    return { ...f, categories: JSON.stringify(tags(b.categories)), brands: JSON.stringify(tags(b.brands)), contacts: JSON.stringify(contactsIn(b.contacts)) };
  }
  const out = e => ({
    id: e.rowKey, co: rowCo(e), name: e.name, kind: e.kind || "Supplier", status: e.status || "active",
    categories: json(e.categories, []), brands: json(e.brands, []), supplies: e.supplies || "", contacts: json(e.contacts, []),
    website: e.website || "", email: e.email || "", phone: e.phone || "", address: e.address || "", emirate: e.emirate || "", country: e.country || "",
    trn: e.trn || "", licenceNo: e.licenceNo || "", paymentTerms: e.paymentTerms || "", creditDays: num(e.creditDays), creditLimit: num(e.creditLimit),
    currency: e.currency || "AED", rating: num(e.rating), notes: e.notes || "",
    createdBy: e.createdBy, createdAt: e.createdAt, updatedBy: e.updatedBy, updatedAt: e.updatedAt, etag: e.etag,
  });

  async function list(user) {
    return (await all(await table(T), PK)).filter(e => inCo(e, user)).map(out).sort((a, b) => a.name.localeCompare(b.name));
  }
  async function dupOf(name, co, exceptId) {
    const n = name.toLowerCase();
    return (await all(await table(T), PK, ["RowKey", "co", "name"])).find(e => rowCo(e) === co && String(e.name).toLowerCase() === n && (e.rowKey || e.RowKey) !== exceptId);
  }
  async function create(user, b) {
    const co = writeCo(user);
    const f = fieldsIn(b);
    const d = await dupOf(f.name, co);
    if (d) fail(409, `${d.name} is already in the supplier list.`, { id: d.rowKey || d.RowKey });
    const now = new Date().toISOString();
    const e = { partitionKey: PK, rowKey: crypto.randomUUID(), co, ...f, createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now };
    const t = await table(T);
    await t.createEntity(e);
    return out(await t.getEntity(PK, e.rowKey));
  }
  async function load(user, id) {
    const e = await getOrNull(await table(T), PK, id);
    if (!e || !inCo(e, user)) fail(404, "This supplier no longer exists.");
    return e;
  }
  async function update(user, id, b) {
    const cur = await load(user, id);
    const co = writeCo(user);
    const f = fieldsIn(b);
    const d = await dupOf(f.name, co, id);
    if (d) fail(409, `${d.name} is already in the supplier list.`);
    const next = { partitionKey: PK, rowKey: id, co, ...f, createdBy: cur.createdBy, createdAt: cur.createdAt, updatedBy: user.email, updatedAt: new Date().toISOString() };
    if (user.aud) { user.aud.name = cur.name; user.aud.changes = diff(cur, next).concat(contactChanges(json(cur.contacts, []), json(next.contacts, []))); }
    const t = await table(T);
    try { await t.updateEntity(next, "Replace", { etag: b.etag || cur.etag }); }
    catch (err) { if (err.statusCode === 412) fail(409, "Someone else changed this supplier after you opened it. Reload to see their changes, then make yours again."); throw err; }
    return out(await t.getEntity(PK, id));
  }
  function contactChanges(a, b) {
    const ids = new Set(a.map(c => c.id)), bid = new Set(b.map(c => c.id)), res = [];
    b.filter(c => !ids.has(c.id)).forEach(c => res.push(`added contact ${c.name}`));
    a.filter(c => !bid.has(c.id)).forEach(c => res.push(`removed contact ${c.name}`));
    b.filter(c => ids.has(c.id)).forEach(c => { const o = a.find(x => x.id === c.id); if (["name", "role", "mobile", "phone", "email"].some(k => (o[k] || "") !== (c[k] || ""))) res.push(`edited contact ${c.name}`); });
    return res;
  }
  async function remove(user, id) {
    const t = await table(T);
    const cur = await getOrNull(t, PK, id);
    if (!cur || !inCo(cur, user)) return;
    writeCo(user);
    if (user.aud) user.aud.name = cur.name;
    if (!user.isManager && cur.createdBy !== user.email) fail(403, "Only the person who added this supplier or a manager can delete it. Set its status to On hold or Blocked instead.");
    try { await t.deleteEntity(PK, id); } catch (e) { if (e.statusCode !== 404) throw e; }
  }

  // Bulk import from Excel / CSV (parsed in the browser), one contact per row. Rows with the same supplier name are merged,
  // so a sheet with three salespeople at one distributor becomes one supplier with three contacts.
  async function importRows(user, b) {
    const co = writeCo(user);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) fail(400, "The file has no supplier rows.");
    if (rows.length > 2000) fail(400, "Import up to 2,000 rows at a time. Split the file and import it in parts.");
    const t = await table(T);
    const existing = new Map((await all(t, PK)).filter(e => rowCo(e) === co).map(e => [String(e.name).toLowerCase(), e]));
    const groups = new Map(); const invalid = [];
    rows.forEach((r, i) => {
      const name = clean(r && r.name, 150);
      if (!name) { invalid.push({ row: i + 1, reason: "No supplier name" }); return; }
      const k = name.toLowerCase();
      if (!groups.has(k)) groups.set(k, { name, rows: [] });
      groups.get(k).rows.push(r);
    });
    const now = new Date().toISOString();
    const actions = []; let added = 0, updated = 0, contactsAdded = 0; const skipped = [];
    for (const [k, g] of groups) {
      const cur = existing.get(k);
      if (cur && !b.update) { skipped.push({ name: g.name, reason: "Already in the list" }); continue; }
      const base = cur ? out(cur) : { name: g.name, kind: "Supplier", status: "active", categories: [], brands: [], contacts: [], country: "UAE", currency: "AED" };
      const s = { ...base };
      let changed = !cur;
      for (const r of g.rows) {
        for (const f of ["supplies", "website", "email", "phone", "address", "emirate", "country", "trn", "licenceNo", "paymentTerms"]) {
          const v = clean(r[f], f === "supplies" ? 1500 : 300); if (v && v !== s[f]) { if (f === "supplies" && s[f] && !s[f].toLowerCase().includes(v.toLowerCase())) s[f] = (s[f] + "; " + v).slice(0, 1500); else if (f !== "supplies" || !s[f]) s[f] = v; changed = true; }
        }
        const kind = KINDS.find(x => x.toLowerCase() === clean(r.kind, 30).toLowerCase()); if (kind && kind !== s.kind) { s.kind = kind; changed = true; }
        const cd = num(r.creditDays); if (cd > 0 && cd !== s.creditDays) { s.creditDays = cd; changed = true; }
        for (const f of ["categories", "brands"]) { const n = tags(s[f].concat(tags(r[f]))); if (n.length !== s[f].length) { s[f] = n; changed = true; } }
        const c = { name: clean(r.contactName, 100), role: clean(r.contactRole, 80), mobile: clean(r.contactMobile, 40), phone: clean(r.contactPhone, 40), email: clean(r.contactEmail, 150).toLowerCase() };
        if (c.email && !emailRx.test(c.email)) c.email = "";
        if (!c.name && c.email) c.name = c.email.split("@")[0];
        if (c.name) {
          const same = s.contacts.find(x => (c.email && x.email === c.email) || x.name.toLowerCase() === c.name.toLowerCase());
          if (same) { for (const f of ["role", "mobile", "phone", "email"]) if (c[f] && !same[f]) { same[f] = c[f]; changed = true; } }
          else if (s.contacts.length < MAX_CONTACTS) { s.contacts = s.contacts.concat({ ...c, primary: !s.contacts.length }); contactsAdded++; changed = true; }
        }
      }
      if (!changed) { skipped.push({ name: g.name, reason: "No changes" }); continue; }
      let f; try { f = fieldsIn(s); } catch (e) { invalid.push({ name: g.name, reason: e.message }); continue; }
      if (cur) { actions.push(["update", { partitionKey: PK, rowKey: cur.rowKey, co, ...f, updatedBy: user.email, updatedAt: now }, "Merge"]); updated++; }
      else { actions.push(["create", { partitionKey: PK, rowKey: crypto.randomUUID(), co, ...f, createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now }]); added++; }
    }
    for (let i = 0; i < actions.length; i += 100) await t.submitTransaction(actions.slice(i, i + 100));
    return { added, updated, contactsAdded, skipped, invalid };
  }

  async function route(method, seg, user, body) {
    const [id] = seg;
    if (!id && method === "GET") return list(user);
    if (!id && method === "POST") return create(user, body);
    if (id === "import" && method === "POST") return importRows(user, body);
    if (id && method === "GET") return out(await load(user, id));
    if (id && method === "PUT") return update(user, id, body);
    if (id && method === "DELETE") return remove(user, id);
    fail(404, "Unknown request.");
  }
  return { route, KINDS, STATUS, list };
};
