// Inventory: stock items, locations, and every movement in or out (table "inventory").
//
// Stock is never stored as a number that can drift: it is worked out from the movements.
//   it-<co>   items: name, part no., brand, category, unit, serial-tracked or not, reorder level, unit cost,
//             optional link to a Books item
//   loc-<co>  locations: office, store, site or vehicle
//   mv-<co>   movements, one per receipt / issue / transfer / adjustment, with lines
//             { itemId, qty, from, to, serials[], unitCost }; "from" takes stock out of a location, "to" puts it in.
//             A movement is never edited or deleted; a mistake is undone with a reversing movement.
//   rsv-<co>  reservations against a quotation: { itemId, qty } per line. A reservation counts only while the
//             quotation is open (draft, sent or accepted), and only for what hasn't been issued yet on the
//             quotation or on the challans and invoices made from it.
//
// Movements can be linked to a Books quotation, delivery challan or invoice. Stock already issued anywhere
// along the quotation > challan > invoice chain counts once, so goods aren't taken out twice.

const crypto = require("crypto");

const KINDS = { in: "Received", out: "Issued", transfer: "Transferred", adjust: "Adjusted" };
const REASONS = {
  in: { purchase: "Purchase / supplier delivery", leftover: "Leftover from a project", return: "Returned by customer", opening: "Opening stock", other: "Other" },
  out: { customer: "Supplied to customer", project: "Used on a project", internal: "Internal use", sample: "Sample / demo", other: "Other" },
  transfer: { transfer: "Moved between locations" },
  adjust: { count: "Stock count correction", damaged: "Damaged / written off", lost: "Lost", found: "Found", other: "Other" },
};
const LOC_KINDS = { office: "Office", store: "Store / warehouse", site: "Customer site", vehicle: "Vehicle" };

module.exports = function makeInventory(H) {
  const { table, getOrNull, all, packJson, unpackJson, fail, clean, num, isDate, books } = H;
  const T = "inventory";
  const r3 = x => Math.round((Number(x) + Number.EPSILON) * 1000) / 1000;
  const now = () => new Date().toISOString();
  const today = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  const coOf = user => { if (user.co === "all") fail(400, "Inventory works one company at a time. Switch to Bifold or Tech Hub in the top bar."); return user.co; };
  const canInv = user => user.isManager || (user.sections || []).includes("inventory");
  const needInv = user => { if (!canInv(user)) fail(403, "You don't have access to Inventory. Ask a manager to give you access."); };
  const serialsIn = v => [...new Set((Array.isArray(v) ? v : String(v || "").split(/[\n,;]+/)).map(x => clean(x, 80)).filter(Boolean))].slice(0, 2000);
  const norm = s => String(s || "").trim().toLowerCase();

  /* ---------------- loading ---------------- */
  const itemOut = e => ({ id: e.rowKey, name: e.name, sku: e.sku || "", brand: e.brand || "", category: e.category || "", unit: e.unit || "Nos", serialized: !!e.serialized,
    minQty: num(e.minQty), unitCost: num(e.unitCost), bookItemId: e.bookItemId || "", notes: e.notes || "", active: e.active !== false, createdAt: e.createdAt || "", etag: e.etag });
  const locOut = e => ({ id: e.rowKey, name: e.name, kind: e.kind || "store", address: e.address || "", active: e.active !== false });
  const mvOut = e => { const b = unpackJson(e); return { id: e.rowKey, kind: e.kind, reason: e.reason || "", date: e.date, ref: e.ref || "", note: e.note || "", docId: e.docId || "", docType: e.docType || "", docNo: e.docNo || "",
    party: e.party || "", lines: b.lines || [], reverses: e.reverses || "", reversedBy: e.reversedBy || "", createdBy: e.createdBy, createdAt: e.createdAt }; };
  async function loadAll(co) {
    const t = await table(T);
    const [items, locs, mvs, rsv] = await Promise.all([all(t, "it-" + co), all(t, "loc-" + co), all(t, "mv-" + co), all(t, "rsv-" + co)]);
    return { items: items.map(itemOut).sort((a, b) => a.name.localeCompare(b.name)), locations: locs.map(locOut).sort((a, b) => a.name.localeCompare(b.name)),
      moves: mvs.map(mvOut).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), reservations: rsv.map(e => ({ quoteId: e.rowKey, lines: unpackJson(e).lines || [], createdBy: e.createdBy, updatedAt: e.updatedAt })) };
  }

  // On hand per item per location, and where each serial number is now.
  function stockOf(moves) {
    const qty = {}, serial = {};
    const add = (it, loc, q) => { if (!loc) return; (qty[it] = qty[it] || {})[loc] = r3((qty[it][loc] || 0) + q); };
    for (const m of moves) for (const l of m.lines) {
      add(l.itemId, l.from, -num(l.qty)); add(l.itemId, l.to, num(l.qty));
      for (const sn of l.serials || []) { const k = l.itemId + "\u0000" + norm(sn); serial[k] = { itemId: l.itemId, sn, loc: l.to || "", lastMove: m.id }; }
    }
    return { qty, serial };
  }
  const onHand = (S, itemId, loc) => loc ? num((S.qty[itemId] || {})[loc]) : Object.values(S.qty[itemId] || {}).reduce((a, b) => a + b, 0);

  // The quotation > challan > invoice family a document belongs to.
  function chainOf(docs, id) {
    const byId = new Map(docs.map(d => [d.id, d])), seen = new Set([id]), q = [id];
    while (q.length) {
      const d = byId.get(q.shift()); if (!d) continue;
      const near = [d.fromId, d.toId, d.invoiceRef].concat(docs.filter(x => x.fromId === d.id || x.invoiceRef === d.id || x.toId === d.id).map(x => x.id));
      near.filter(x => x && byId.has(x) && !seen.has(x)).forEach(x => { seen.add(x); q.push(x); });
    }
    return seen;
  }
  // Net quantity issued per item on a set of documents (issues minus returns against them).
  function issuedOn(moves, ids) {
    const out = {};
    for (const m of moves) if (m.docId && ids.has(m.docId)) for (const l of m.lines) {
      // Issued against the document, less anything returned (or undone) against it.
      const sign = m.kind === "out" ? 1 : m.kind === "in" ? -1 : 0;
      if (sign) out[l.itemId] = r3((out[l.itemId] || 0) + sign * num(l.qty));
    }
    return out;
  }
  const OPEN_QUOTE = new Set(["draft", "sent", "accepted"]);
  // What is still held for open quotations: reserved minus already issued along each quotation's chain.
  function reservedOf(D, docs) {
    const byId = new Map(docs.map(d => [d.id, d])), per = {}, byQuote = {};
    for (const r of D.reservations) {
      const q = byId.get(r.quoteId); if (!q || !OPEN_QUOTE.has(q.status)) continue;
      const iss = issuedOn(D.moves, chainOf(docs, r.quoteId));
      for (const l of r.lines) { const left = Math.max(0, r3(num(l.qty) - num(iss[l.itemId]))); if (!left) continue; per[l.itemId] = r3((per[l.itemId] || 0) + left); (byQuote[r.quoteId] = byQuote[r.quoteId] || {})[l.itemId] = left; }
    }
    return { per, byQuote };
  }
  const docsFor = user => books().stockDocs(user).catch(() => []);

  /* ---------------- bootstrap ---------------- */
  async function bootstrap(user) {
    const co = coOf(user);
    const [D, docs] = await Promise.all([loadAll(co), docsFor(user)]);
    const S = stockOf(D.moves), R = reservedOf(D, docs);
    const docIx = Object.fromEntries(docs.map(d => [d.id, d]));
    const stock = D.items.map(it => {
      const by = S.qty[it.id] || {}, oh = r3(onHand(S, it.id)), res = num(R.per[it.id]);
      return { itemId: it.id, onHand: oh, reserved: res, available: r3(oh - res), byLoc: by, serials: Object.values(S.serial).filter(s => s.itemId === it.id && s.loc).map(s => ({ sn: s.sn, loc: s.loc })) };
    });
    return { co, today: today(), items: D.items, locations: D.locations, stock, moves: D.moves.slice(-800).reverse(),
      reservations: Object.entries(R.byQuote).map(([quoteId, lines]) => ({ quoteId, quote: docIx[quoteId] || null, lines })),
      docs, kinds: KINDS, reasons: REASONS, locKinds: LOC_KINDS };
  }

  /* ---------------- items ---------------- */
  function itemFields(b) {
    const f = { name: clean(b.name, 200), sku: clean(b.sku, 80), brand: clean(b.brand, 80), category: clean(b.category, 80), unit: clean(b.unit, 20) || "Nos",
      serialized: !!b.serialized, minQty: Math.max(0, r3(num(b.minQty))), unitCost: Math.max(0, Math.round(num(b.unitCost) * 100) / 100), bookItemId: clean(b.bookItemId, 60), notes: clean(b.notes, 1000), active: b.active !== false };
    if (!f.name) fail(400, "Enter the item name.");
    return f;
  }
  async function saveItem(user, id, b) {
    const co = coOf(user), t = await table(T);
    const f = itemFields(b);
    const items = (await all(t, "it-" + co)).map(itemOut);
    const dup = items.find(x => x.id !== id && ((f.sku && norm(x.sku) === norm(f.sku)) || (!f.sku && !x.sku && norm(x.name) === norm(f.name))));
    if (dup) fail(400, `${dup.name}${dup.sku ? " (" + dup.sku + ")" : ""} is already in the item list.`);
    if (user.aud) user.aud.name = f.name;
    if (!id) {
      const e = { partitionKey: "it-" + co, rowKey: crypto.randomUUID(), ...f, createdBy: user.email, createdAt: now(), updatedBy: user.email, updatedAt: now() };
      await t.createEntity(e); return itemOut(await getOrNull(t, "it-" + co, e.rowKey));
    }
    const cur = await getOrNull(t, "it-" + co, id); if (!cur) fail(404, "This item doesn't exist.");
    if (cur.serialized && !f.serialized) { const S = stockOf((await all(t, "mv-" + co)).map(mvOut)); if (Object.values(S.serial).some(s => s.itemId === id && s.loc)) fail(400, "Serial numbers of this item are in stock, so it has to stay serial-tracked."); }
    await t.updateEntity({ partitionKey: "it-" + co, rowKey: id, ...f, updatedBy: user.email, updatedAt: now() }, "Merge", { etag: b.etag || "*" }).catch(err => { if (err.statusCode === 412) fail(409, "Someone else changed this item. Reload and try again."); throw err; });
    return itemOut(await getOrNull(t, "it-" + co, id));
  }
  async function deleteItem(user, id) {
    const co = coOf(user), t = await table(T);
    const cur = await getOrNull(t, "it-" + co, id); if (!cur) return;
    if (user.aud) user.aud.name = cur.name;
    const used = (await all(t, "mv-" + co)).map(mvOut).some(m => m.lines.some(l => l.itemId === id));
    if (used) fail(400, "This item has stock movements, so it's kept for the record. Mark it inactive instead.");
    await t.deleteEntity("it-" + co, id);
  }

  /* ---------------- locations ---------------- */
  async function saveLoc(user, id, b) {
    const co = coOf(user), t = await table(T);
    const f = { name: clean(b.name, 100), kind: LOC_KINDS[b.kind] ? b.kind : "store", address: clean(b.address, 300), active: b.active !== false };
    if (!f.name) fail(400, "Enter the location name.");
    const locs = (await all(t, "loc-" + co)).map(locOut);
    if (locs.some(l => l.id !== id && norm(l.name) === norm(f.name))) fail(400, `There is already a location called ${f.name}.`);
    if (user.aud) user.aud.name = f.name;
    if (id && !f.active) { const S = stockOf((await all(t, "mv-" + co)).map(mvOut)); if (Object.values(S.qty).some(by => num(by[id]) > 0)) fail(400, "There is stock at this location. Move it elsewhere before closing the location."); }
    const rk = id || crypto.randomUUID();
    await t.upsertEntity({ partitionKey: "loc-" + co, rowKey: rk, ...f, updatedBy: user.email, updatedAt: now() }, "Merge");
    return locOut(await getOrNull(t, "loc-" + co, rk));
  }

  /* ---------------- movements ---------------- */
  async function createMove(user, b, ctx) {
    const co = coOf(user), t = await table(T);
    const D = ctx || await loadAll(co);
    const kind = KINDS[b.kind] ? b.kind : fail(400, "Choose whether stock is received, issued, transferred or adjusted.");
    const reason = REASONS[kind][b.reason] ? b.reason : Object.keys(REASONS[kind])[0];
    const date = clean(b.date, 10) || today(); if (!isDate(date)) fail(400, "The date is not valid.");
    if (date > today()) fail(400, "The date can't be in the future.");
    const items = new Map(D.items.map(i => [i.id, i])), locs = new Map(D.locations.map(l => [l.id, l]));
    const S = stockOf(D.moves);
    const raw = Array.isArray(b.lines) ? b.lines.slice(0, 300) : [];
    const lines = [];
    // Running totals so two lines taking the same item from the same place are checked together.
    const taken = {}, snTaken = new Set();
    raw.forEach((l, i) => {
      const n = `Line ${i + 1}`;
      const it = items.get(clean(l.itemId, 60)); if (!it) fail(400, `${n}: choose an item.`);
      let qty = r3(num(l.qty));
      // Adjustments add or remove; the quantity itself is always positive.
      const remove = kind === "adjust" && (l.dir === "remove" || qty < 0); qty = Math.abs(qty);
      const serials = it.serialized ? serialsIn(l.serials) : [];
      if (it.serialized && serials.length) qty = serials.length;
      if (!(qty > 0)) fail(400, `${n}: enter a quantity greater than zero.`);
      if (it.serialized && !serials.length) fail(400, `${n}: ${it.name} is serial-tracked. Enter its serial numbers.`);
      let from = "", to = "";
      const loc = id => { const x = locs.get(clean(id, 60)); if (!x) fail(400, `${n}: choose a location.`); return x.id; };
      if (kind === "in") to = loc(l.to);
      else if (kind === "out") from = loc(l.from);
      else if (kind === "transfer") { from = loc(l.from); to = loc(l.to); if (from === to) fail(400, `${n}: choose two different locations.`); }
      else if (remove) from = loc(l.from || l.to); else to = loc(l.to || l.from);
      const L = { itemId: it.id, qty, from, to, serials, unitCost: Math.max(0, Math.round(num(l.unitCost) * 100) / 100) || (kind === "in" ? 0 : it.unitCost) };
      if (from) {
        const k = it.id + "@" + from; taken[k] = r3((taken[k] || 0) + qty);
        const have = onHand(S, it.id, from);
        if (taken[k] > have + 1e-9) fail(400, `${n}: only ${have} ${it.unit} of ${it.name} at ${locs.get(from).name}.`);
        for (const sn of serials) { const s = S.serial[it.id + "\u0000" + norm(sn)]; if (!s || s.loc !== from) fail(400, `${n}: serial ${sn} of ${it.name} isn't in stock at ${locs.get(from).name}.`); }
      }
      if (to && !from) for (const sn of serials) { const s = S.serial[it.id + "\u0000" + norm(sn)]; if (s && s.loc) fail(400, `${n}: serial ${sn} of ${it.name} is already in stock at ${(locs.get(s.loc) || {}).name || "another location"}.`); }
      for (const sn of serials) { const k = it.id + "\u0000" + norm(sn); if (snTaken.has(k)) fail(400, `${n}: serial ${sn} appears twice.`); snTaken.add(k); }
      lines.push(L);
    });
    if (!lines.length) fail(400, "Add at least one item.");
    if (kind === "adjust" && reason === "count" && !clean(b.note, 500)) fail(400, "Say what the count found, for the record.");
    if ((kind === "adjust" && ["damaged", "lost", "other"].includes(reason)) && !clean(b.note, 500)) fail(400, "Add a note saying what happened.");
    // Link to a Books quotation, challan or invoice.
    let doc = null;
    if (clean(b.docId, 60)) { doc = (await docsFor(user)).find(d => d.id === clean(b.docId, 60)); if (!doc) fail(400, "That document isn't in Books any more."); }
    if (doc && doc.type === "quote" && kind === "out") fail(400, "Stock is issued on the delivery challan or invoice. On a quotation it can only be reserved.");
    const e = { partitionKey: "mv-" + co, rowKey: String(9e15 - Date.now()).padStart(16, "0") + "-" + crypto.randomBytes(3).toString("hex"), kind, reason, date,
      ref: clean(b.ref, 100), note: clean(b.note, 500), party: clean(b.party, 150) || (doc ? doc.contactName : ""), docId: doc ? doc.id : "", docType: doc ? doc.type : "", docNo: doc ? doc.number : "",
      reverses: clean(b._reverses, 60), ...packJson({ lines }), createdBy: user.email, createdAt: now() };
    await t.createEntity(e);
    // Received at a cost: that becomes the item's cost.
    if (kind === "in") for (const l of lines) if (l.unitCost > 0) await t.updateEntity({ partitionKey: "it-" + co, rowKey: l.itemId, unitCost: l.unitCost }, "Merge").catch(() => {});
    if (user.aud) { user.aud.name = (KINDS[kind] + " stock").replace("Adjusted stock", "Stock adjustment"); user.aud.detail = lines.map(l => `${l.qty} x ${items.get(l.itemId).name}`).slice(0, 6).join(", ") + (lines.length > 6 ? ` and ${lines.length - 6} more` : "") + (doc ? `; ${doc.number || doc.type}` : ""); }
    return mvOut(await getOrNull(t, "mv-" + co, e.rowKey));
  }
  async function reverseMove(user, id, b) {
    const co = coOf(user), t = await table(T);
    const D = await loadAll(co);
    const m = D.moves.find(x => x.id === id); if (!m) fail(404, "This movement doesn't exist.");
    if (m.reversedBy) fail(400, "This movement has already been undone.");
    if (m.reverses) fail(400, "This movement is itself an undo. Record a new movement instead.");
    const why = clean(b && b.reason, 300); if (!why) fail(400, "Say why it is being undone.");
    const kind = m.kind === "in" ? "out" : m.kind === "out" ? "in" : m.kind;
    const lines = m.lines.map(l => ({ itemId: l.itemId, qty: l.qty, from: l.to, to: l.from, serials: l.serials, unitCost: l.unitCost }));
    // Undo uses the same checks as any movement (stock must be where the undo takes it from).
    const S = stockOf(D.moves), locs = new Map(D.locations.map(l => [l.id, l])), items = new Map(D.items.map(i => [i.id, i]));
    for (const l of lines) if (l.from) { if (onHand(S, l.itemId, l.from) + 1e-9 < l.qty) fail(400, `${items.get(l.itemId).name} is no longer at ${(locs.get(l.from) || {}).name} in that quantity, so this can't be undone.`); for (const sn of l.serials || []) { const s = S.serial[l.itemId + "\u0000" + norm(sn)]; if (!s || s.loc !== l.from) fail(400, `Serial ${sn} has moved since, so this can't be undone.`); } }
    const e = { partitionKey: "mv-" + co, rowKey: String(9e15 - Date.now()).padStart(16, "0") + "-" + crypto.randomBytes(3).toString("hex"), kind, reason: m.kind === "out" ? "return" : "other", date: today(),
      ref: m.ref, note: "Undo: " + why, party: m.party, docId: m.docId, docType: m.docType, docNo: m.docNo, reverses: m.id, ...packJson({ lines }), createdBy: user.email, createdAt: now() };
    await t.createEntity(e);
    await t.updateEntity({ partitionKey: "mv-" + co, rowKey: m.id, reversedBy: e.rowKey }, "Merge");
    if (user.aud) { user.aud.name = `${KINDS[m.kind]} on ${m.date}${m.docNo ? " (" + m.docNo + ")" : ""}`; user.aud.detail = why; }
    return mvOut(await getOrNull(t, "mv-" + co, e.rowKey));
  }

  /* ---------------- Books documents ---------------- */
  // Everything the stock card on a quotation, challan or invoice needs.
  async function forDoc(user, id) {
    const co = coOf(user);
    const [D, docs, doc] = await Promise.all([loadAll(co), docsFor(user), books().stockDoc(user, id)]);
    if (!doc) fail(404, "This document isn't in Books.");
    const S = stockOf(D.moves), R = reservedOf(D, docs);
    const chain = chainOf(docs, id);
    const issued = issuedOn(D.moves, chain);
    const quoteId = doc.type === "quote" ? doc.id : [...chain].find(x => (docs.find(d => d.id === x) || {}).type === "quote") || "";
    const rsv = D.reservations.find(r => r.quoteId === quoteId);
    // Suggest the stock item for each line: Books item link, then part no. / model, then the name.
    const match = l => {
      const act = D.items.filter(i => i.active);
      return (l.itemId && act.find(i => i.bookItemId === l.itemId)) || (l.model && act.find(i => i.sku && norm(i.sku) === norm(l.model)))
        || act.find(i => i.sku && (norm(l.name).includes(norm(i.sku)) || norm(l.description).includes(norm(i.sku)))) || act.find(i => norm(i.name) === norm(l.name)) || null;
    };
    const lines = doc.lines.filter(l => !l.sub || l.qty).map(l => { const it = match(l); return { ...l, stockItemId: it ? it.id : "" }; });
    const stock = Object.fromEntries(D.items.map(it => [it.id, { onHand: r3(onHand(S, it.id)), reserved: num(R.per[it.id]), byLoc: S.qty[it.id] || {}, serials: Object.values(S.serial).filter(s => s.itemId === it.id && s.loc).map(s => ({ sn: s.sn, loc: s.loc })) }]));
    return { doc, chain: [...chain].map(x => docs.find(d => d.id === x)).filter(Boolean), lines, issued, reservation: rsv ? { quoteId, lines: rsv.lines, open: !!R.byQuote[quoteId], left: R.byQuote[quoteId] || {} } : null,
      moves: D.moves.filter(m => m.docId && chain.has(m.docId)).reverse(), items: D.items, locations: D.locations.filter(l => l.active), stock };
  }
  async function reserve(user, quoteId, b) {
    const co = coOf(user), t = await table(T);
    const docs = await docsFor(user);
    const q = docs.find(d => d.id === quoteId && d.type === "quote"); if (!q) fail(404, "This quotation isn't in Books.");
    if (!OPEN_QUOTE.has(q.status)) fail(400, "Stock can only be reserved on an open quotation.");
    const D = await loadAll(co);
    const items = new Map(D.items.map(i => [i.id, i]));
    const lines = (Array.isArray(b.lines) ? b.lines : []).map(l => ({ itemId: clean(l.itemId, 60), qty: r3(num(l.qty)) })).filter(l => l.qty > 0);
    if (!lines.length) { await t.deleteEntity("rsv-" + co, quoteId).catch(() => {}); if (user.aud) user.aud.name = q.number || "quotation"; return { ok: true }; }
    // Check against what is free, not counting this quotation's own earlier reservation.
    const S = stockOf(D.moves), R = reservedOf({ ...D, reservations: D.reservations.filter(r => r.quoteId !== quoteId) }, docs);
    const per = {}; lines.forEach(l => { if (!items.has(l.itemId)) fail(400, "Choose the stock item for each line."); per[l.itemId] = r3((per[l.itemId] || 0) + l.qty); });
    for (const [id, qn] of Object.entries(per)) { const free = r3(onHand(S, id) - num(R.per[id])); if (qn > free + 1e-9) fail(400, `Only ${Math.max(0, free)} ${items.get(id).unit} of ${items.get(id).name} is free to reserve.`); }
    await t.upsertEntity({ partitionKey: "rsv-" + co, rowKey: quoteId, ...packJson({ lines }), createdBy: user.email, updatedAt: now() }, "Replace");
    if (user.aud) { user.aud.name = q.number || "quotation"; user.aud.detail = lines.map(l => `${l.qty} x ${items.get(l.itemId).name}`).slice(0, 6).join(", "); }
    return { ok: true };
  }

  /* ---------------- import: items with opening stock ---------------- */
  async function importRows(user, b) {
    const co = coOf(user), t = await table(T);
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 2000);
    if (!rows.length) fail(400, "There are no rows to import.");
    let D = await loadAll(co);
    const locByName = new Map(D.locations.map(l => [norm(l.name), l]));
    let made = 0, locMade = 0;
    for (const r of rows) {
      const ln = clean(r.location, 100);
      if (ln && !locByName.has(norm(ln))) { const l = await saveLoc({ ...user, aud: null }, null, { name: ln, kind: "store" }); locByName.set(norm(ln), l); locMade++; }
    }
    const findItem = r => D.items.find(i => (clean(r.sku, 80) && norm(i.sku) === norm(r.sku)) || (!clean(r.sku, 80) && norm(i.name) === norm(r.name)));
    for (const r of rows) if (!findItem(r) && clean(r.name, 200)) { const it = await saveItem({ ...user, aud: null }, null, { name: r.name, sku: r.sku, brand: r.brand, category: r.category, unit: r.unit, serialized: !!clean(r.serials, 20000) || /^(y|yes|true|1)$/i.test(String(r.serialized || "")), minQty: r.minQty, unitCost: r.unitCost }); D.items.push(it); made++; }
    const lines = rows.filter(r => num(r.qty) > 0 || clean(r.serials, 20000)).map((r, i) => {
      const it = findItem(r); if (!it) fail(400, `Row ${i + 1}: enter the item name.`);
      const loc = locByName.get(norm(clean(r.location, 100))) || D.locations[0] || [...locByName.values()][0];
      if (!loc) fail(400, "Add a Location column, or create a location first.");
      return { itemId: it.id, qty: r.qty, to: loc.id, serials: r.serials, unitCost: r.unitCost };
    });
    D = await loadAll(co);
    let mv = null;
    if (lines.length) mv = await createMove({ ...user, aud: null }, { kind: "in", reason: b.reason === "leftover" ? "leftover" : "opening", date: today(), note: clean(b.note, 300) || "Imported from Excel", lines }, D);
    if (user.aud) { user.aud.name = "Inventory import"; user.aud.detail = `${made} new items, ${lines.length} stock lines${locMade ? `, ${locMade} new locations` : ""}`; }
    return { items: made, locations: locMade, lines: lines.length, moveId: mv && mv.id };
  }

  /* ---------------- alerts: below reorder level ---------------- */
  async function alerts(user) {
    if (!canInv(user) || user.co === "all") return [];
    const D = await loadAll(user.co), S = stockOf(D.moves);
    return D.items.filter(i => i.active && i.minQty > 0 && onHand(S, i.id) <= i.minQty).slice(0, 20)
      .map(i => ({ tool: "inventory", severity: onHand(S, i.id) <= 0 ? "high" : "medium", when: today(), href: "/inventory/#/item/" + i.id, title: `${i.name}: ${r3(onHand(S, i.id))} ${i.unit} left`, detail: `Reorder level ${i.minQty}` }));
  }

  async function route(method, seg, user, body) {
    needInv(user);
    const [a, id, sub] = seg;
    if (a === "bootstrap" && method === "GET") return bootstrap(user);
    if (a === "items") { if (!id && method === "POST") return saveItem(user, null, body); if (id && method === "PUT") return saveItem(user, id, body); if (id && method === "DELETE") return deleteItem(user, id); }
    if (a === "locations") { if (!id && method === "POST") return saveLoc(user, null, body); if (id && method === "PUT") return saveLoc(user, id, body); }
    if (a === "moves") { if (!id && method === "POST") return createMove(user, body); if (id && sub === "reverse" && method === "POST") return reverseMove(user, id, body); }
    if (a === "doc" && id && method === "GET") return forDoc(user, id);
    if (a === "reserve" && id && method === "PUT") return reserve(user, id, body);
    if (a === "import" && method === "POST") return importRows(user, body);
    fail(404, "Unknown request.");
  }
  return { route, alerts, canInv };
};
