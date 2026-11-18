// Inventory (single-page app; the API is /api/inv/*). Stock items, locations, and every movement:
// received, issued, transferred between locations, adjusted after a count. Stock and serial numbers are
// worked out from the movements, so nothing is ever typed in as a balance. Movements can be linked to a
// Books quotation (reserve), delivery challan or invoice (issue).
(function () {
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r3 = x => Math.round((Number(x) + Number.EPSILON) * 1000) / 1000;
const qf = n => r3(n).toLocaleString("en-US", { maximumFractionDigits: 3 });
const aed = n => num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fd = d => d ? new Date(String(d).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const fdt = d => d ? new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const splitSn = v => [...new Set(String(v || "").split(/[\n,;]+/).map(x => x.trim()).filter(Boolean))];

let D = null, IT = new Map(), LOC = new Map(), ST = new Map(), DOC = new Map();

/* ---------- plumbing ---------- */
function toast(m, e) { const t = document.createElement("div"); t.className = "toast" + (e ? " err" : ""); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), e ? 6500 : 2600); }
async function api(method, path, body) {
  let r; try { r = await fetch("/api/inv/" + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, cache: "no-store" }); }
  catch { throw new Error("Can't reach the server. Check your connection and try again."); }
  const ct = r.headers.get("content-type") || "";
  if (r.redirected || (r.ok && r.status !== 204 && !ct.includes("json"))) throw new Error("Your session has ended. Reload the page to sign in again.");
  let j = null; if (r.status !== 204) { try { j = await r.json(); } catch {} }
  if (!r.ok) { const e = new Error((j && j.error) || "The request failed."); e.status = r.status; throw e; }
  return j;
}
async function load() {
  D = await api("GET", "bootstrap");
  IT = new Map(D.items.map(i => [i.id, i])); LOC = new Map(D.locations.map(l => [l.id, l])); ST = new Map(D.stock.map(s => [s.itemId, s])); DOC = new Map(D.docs.map(d => [d.id, d]));
}
function go(h) { if (location.hash === h) route(); else location.hash = h; }
const busy = (btn, on) => { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.t = btn.textContent; btn.textContent = "Working…"; } else if (btn.dataset.t) btn.textContent = btn.dataset.t; };
async function act(btn, fn, ok) { busy(btn, true); try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message, true); } finally { busy(btn, false); } }
const loaded = {};
const script = src => loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error("Couldn't load a library. Check your connection.")); }; document.head.appendChild(s); }));
const xlsx = () => script("/assets/vendor/xlsx-0.18.5.full.min.js").then(() => window.XLSX);
async function exportSheet(name, sheets) { const X = await xlsx(); const wb = X.utils.book_new(); sheets.forEach(([n, rows]) => X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), n)); X.writeFile(wb, name.replace(/[\\/:*?"<>|]/g, "-") + ".xlsx"); }
function saveBlob(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
function dialog(html, { wide, onOpen } = {}) {
  return new Promise(resolve => {
    const d = document.createElement("dialog"); if (wide) d.className = "wide";
    d.innerHTML = html; document.body.appendChild(d);
    const done = v => { d.close(); d.remove(); resolve(v); };
    d.addEventListener("cancel", e => { e.preventDefault(); done(null); });
    d.querySelectorAll("[data-x]").forEach(b => b.onclick = () => done(null));
    if (onOpen) onOpen(d, done);
    d.showModal();
  });
}
const BR = () => window.BIFOLD_BRAND || {};
const locName = id => (LOC.get(id) || {}).name || "";
const itemLabel = i => i ? i.name + (i.sku ? ` (${i.sku})` : "") : "";
const docLabel = d => d ? `${{ quote: "Quotation", dc: "Delivery challan", invoice: "Invoice" }[d.type]} ${d.number || "(draft)"}` : "";
const docLink = (id, no, type) => id ? `<a href="/books/#/doc/${esc(id)}">${esc(no || ({ quote: "Quotation", dc: "Challan", invoice: "Invoice" }[type] || "Document"))}</a>` : "";
const kindTag = m => `<span class="mk ${m.kind}${m.reverses ? " undo" : ""}">${m.reverses ? "Undo" : esc(D.kinds[m.kind])}</span>`;
const value = s => r3(s.onHand) * num((IT.get(s.itemId) || {}).unitCost);

/* ---------- layout ---------- */
const SECTION = { stock: "Stock", item: "Stock", moves: "Movements", items: "Items", locations: "Locations", reserved: "Reserved on quotations" };
function nav(key) {
  const BX = window.BX; if (!BX) return;
  const k = key === "item" ? "stock" : key;
  BX.markSub("#/" + k);
  BX.crumb(k === "stock" ? [["Inventory", "#/stock"]] : [["Inventory", "#/stock"], [SECTION[k]]]);
  if (D) BX.subCount("#/stock", D.items.filter(i => i.active && i.minQty > 0 && num((ST.get(i.id) || {}).onHand) <= i.minQty).length, "Items at or below their reorder level");
}
function page(title, tag, acts, body, key) {
  nav(key);
  $("app").innerHTML = `<header class="top"><div><h1><span class="tag">${esc(tag)}</span>${esc(title)}</h1></div><div class="acts">${acts || ""}</div></header>${body}`;
  window.scrollTo(0, 0);
}
const moveBtns = () => `<button type="button" data-mv="adjust">Adjust</button><button type="button" data-mv="transfer">Transfer</button><button type="button" data-mv="out">Issue</button><button type="button" class="primary" data-mv="in">Receive stock</button>`;
function wireMoveBtns(pre) { document.querySelectorAll("[data-mv]").forEach(b => b.onclick = () => moveForm(b.dataset.mv, pre && pre())); }

function route() {
  if (!D) return;
  const [a, id] = location.hash.replace(/^#\/?/, "").split("/");
  if (a === "item" && id) return itemView(id);
  if (a === "moves") return movesView();
  if (a === "items") return itemsView();
  if (a === "locations") return locationsView();
  if (a === "reserved") return reservedView();
  return stockView();
}

/* ---------- stock ---------- */
function stockView() {
  if (!D.locations.length) return firstRun();
  const act0 = D.items.filter(i => i.active);
  const low = act0.filter(i => i.minQty > 0 && num((ST.get(i.id) || {}).onHand) <= i.minQty);
  const units = D.stock.reduce((a, s) => a + num(s.onHand), 0), val = D.stock.reduce((a, s) => a + value(s), 0), res = D.stock.reduce((a, s) => a + num(s.reserved), 0);
  const cats = [...new Set(D.items.map(i => i.category).filter(Boolean))].sort();
  page("Stock", "Inventory", `<button type="button" id="imp">Import from Excel</button>${moveBtns()}`, `
    <div class="kpis">
      <div class="kpi"><div class="k">Items in stock</div><div class="v">${D.stock.filter(s => s.onHand > 0).length}</div><div class="s">${act0.length} items in the list</div></div>
      <div class="kpi"><div class="k">Units on hand</div><div class="v">${qf(units)}</div><div class="s">across ${D.locations.filter(l => l.active).length} location${D.locations.filter(l => l.active).length === 1 ? "" : "s"}</div></div>
      <div class="kpi" style="--c:var(--good)"><div class="k">Stock value at cost</div><div class="v"><small>AED</small>${aed(val)}</div><div class="s">Quantity x unit cost</div></div>
      <a class="kpi" href="#/reserved" style="--c:var(--warn)"><div class="k">Reserved on quotations</div><div class="v">${qf(res)}</div><div class="s">${D.reservations.length} open quotation${D.reservations.length === 1 ? "" : "s"}</div></a>
      <div class="kpi" style="--c:var(--bad)"><div class="k">At or below reorder level</div><div class="v">${low.length}</div><div class="s">${low.slice(0, 2).map(i => esc(i.name)).join(", ") || "None"}</div></div>
    </div>
    <div class="tools"><input type="search" id="q" placeholder="Search item, part no., brand or serial number">
      <select id="fl"><option value="">All locations</option>${D.locations.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select>
      ${cats.length ? `<select id="fc"><option value="">All categories</option>${cats.map(c => `<option>${esc(c)}</option>`).join("")}</select>` : ""}
      <div class="seg" id="sf"><button aria-pressed="true" data-v="in">In stock</button><button aria-pressed="false" data-v="low">Low</button><button aria-pressed="false" data-v="all">All items</button></div>
      <span class="cnt" id="cnt"></span></div>
    <div class="panel listpanel"><div class="tblwrap"><table class="list"><thead><tr><th>Item</th><th>Brand</th><th>Where</th><th class="r">On hand</th><th class="r">Reserved</th><th class="r">Available</th><th class="r">Value (AED)</th></tr></thead><tbody id="rows"></tbody><tfoot id="foot"></tfoot></table><div class="empty" id="empty" hidden></div></div></div>
    <div class="btnrow" style="margin-top:12px"><button type="button" id="xl">Export to Excel</button><button type="button" id="pv">Preview stock report</button><button type="button" class="primary" id="pdf">Download stock report (PDF)</button></div>`, "stock");
  let f = "in";
  const rows = () => {
    const q = $("q").value.trim().toLowerCase(), lc = $("fl").value, cat = $("fc") ? $("fc").value : "";
    return D.items.filter(i => {
      const s = ST.get(i.id) || { onHand: 0, byLoc: {}, serials: [] };
      const oh = lc ? num(s.byLoc[lc]) : s.onHand;
      if (f === "in" && !(oh > 0)) return false;
      if (f === "low" && !(i.minQty > 0 && s.onHand <= i.minQty)) return false;
      if (f !== "all" && !i.active && !(oh > 0)) return false;
      if (cat && i.category !== cat) return false;
      return !q || [i.name, i.sku, i.brand, i.category].join(" ").toLowerCase().includes(q) || s.serials.some(x => x.sn.toLowerCase().includes(q));
    }).map(i => ({ i, s: ST.get(i.id) || { onHand: 0, reserved: 0, available: 0, byLoc: {}, serials: [] } }));
  };
  const draw = () => {
    const lc = $("fl").value, list = rows();
    $("rows").innerHTML = list.map(({ i, s }) => {
      const oh = lc ? num(s.byLoc[lc]) : s.onHand, lowc = i.minQty > 0 && s.onHand <= i.minQty;
      const where = Object.entries(s.byLoc).filter(([, n]) => n > 0).map(([l, n]) => `<span class="lc">${esc(locName(l))} <b>${qf(n)}</b></span>`).join("") || `<span class="muted">None</span>`;
      return `<tr data-id="${i.id}"><td><div class="t">${esc(i.name)}${i.serialized ? ` <span class="sn" title="Serial-tracked">S/N</span>` : ""}</div><div class="s">${esc([i.sku, i.category].filter(Boolean).join(" · "))}</div></td><td>${esc(i.brand)}</td><td><div class="lcs">${where}</div></td>
        <td class="r"><b>${qf(oh)}</b> <span class="s">${esc(i.unit)}</span>${lowc ? `<div><span class="st overdue">Reorder at ${qf(i.minQty)}</span></div>` : ""}</td><td class="r">${s.reserved ? qf(s.reserved) : ""}</td><td class="r">${qf(s.available)}</td><td class="r">${aed(r3(oh) * i.unitCost)}</td></tr>`;
    }).join("");
    const tq = list.reduce((a, x) => a + (lc ? num(x.s.byLoc[lc]) : x.s.onHand), 0), tv = list.reduce((a, x) => a + (lc ? num(x.s.byLoc[lc]) : x.s.onHand) * x.i.unitCost, 0);
    $("foot").innerHTML = list.length ? `<tr><td colspan="3">Total</td><td class="r">${qf(tq)}</td><td></td><td></td><td class="r">${aed(tv)}</td></tr>` : "";
    $("empty").hidden = !!list.length; $("empty").innerHTML = D.items.length ? "Nothing matches." : `<strong>No stock yet</strong>Use Receive stock, or import your current stock from Excel.`;
    $("cnt").textContent = `${list.length} item${list.length === 1 ? "" : "s"}`;
    $("rows").querySelectorAll("tr").forEach(tr => tr.onclick = () => go("#/item/" + tr.dataset.id));
  };
  $("q").oninput = draw; $("fl").onchange = draw; if ($("fc")) $("fc").onchange = draw;
  $("sf").querySelectorAll("button").forEach(b => b.onclick = () => { f = b.dataset.v; $("sf").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); draw(); });
  wireMoveBtns(); $("imp").onclick = importDialog;
  const name = () => `Stock report ${BR().short || ""} ${D.today}${$("fl").value ? " " + locName($("fl").value) : ""}`;
  $("xl").onclick = () => act($("xl"), () => exportSheet(name(), [["Stock", [["Item", "Part no.", "Brand", "Category", "Unit", "Location", "Quantity", "Reserved", "Available", "Unit cost", "Value (AED)", "Serial numbers"],
    ...rows().flatMap(({ i, s }) => { const L = Object.entries(s.byLoc).filter(([l, n]) => n > 0 && (!$("fl").value || l === $("fl").value)); return (L.length ? L : [["", 0]]).map(([l, n]) => [i.name, i.sku, i.brand, i.category, i.unit, locName(l), n, s.reserved, s.available, i.unitCost, r3(n * i.unitCost), s.serials.filter(x => x.loc === l).map(x => x.sn).join(", ")]); })]]]));
  const build = () => stockPdf(rows(), $("fl").value);
  $("pv").onclick = () => window.BXPdf.preview(build, name() + ".pdf");
  $("pdf").onclick = () => act($("pdf"), async () => saveBlob(await build(), name() + ".pdf"));
  draw();
}
function firstRun() {
  page("Inventory", "Inventory", "", `<section class="card"><div class="bd" style="display:grid;gap:12px;max-width:640px">
    <h2 style="margin:0">Set up your stock locations</h2>
    <p style="margin:0">Start with the places stock is kept: the office, a store, a service van or a customer site. Then receive stock into them, or import what you have now from Excel.</p>
    <div class="btnrow"><button class="primary" id="nl">+ Add a location</button><button id="imp">Import stock from Excel</button></div></div></section>`, "stock");
  $("nl").onclick = () => editLoc(); $("imp").onclick = importDialog;
}

/* ---------- item ---------- */
function itemView(id) {
  const i = IT.get(id); if (!i) return go("#/stock");
  const s = ST.get(id) || { onHand: 0, reserved: 0, available: 0, byLoc: {}, serials: [] };
  const mv = D.moves.filter(m => m.lines.some(l => l.itemId === id));
  const rs = D.reservations.filter(r => r.lines[id]);
  page(i.name, "Inventory · Stock", `<a class="btn" href="#/stock">← Stock</a><button type="button" id="ed">Edit item</button>${moveBtns()}`, `
    <div class="kpis">
      <div class="kpi"><div class="k">On hand</div><div class="v">${qf(s.onHand)} <small>${esc(i.unit)}</small></div><div class="s">${i.minQty ? "Reorder level " + qf(i.minQty) : "No reorder level"}</div></div>
      <div class="kpi" style="--c:var(--warn)"><div class="k">Reserved</div><div class="v">${qf(s.reserved)}</div><div class="s">${rs.length} quotation${rs.length === 1 ? "" : "s"}</div></div>
      <div class="kpi" style="--c:var(--good)"><div class="k">Available</div><div class="v">${qf(s.available)}</div><div class="s">On hand less reserved</div></div>
      <div class="kpi"><div class="k">Value at cost</div><div class="v"><small>AED</small>${aed(r3(s.onHand) * i.unitCost)}</div><div class="s">${i.unitCost ? "AED " + aed(i.unitCost) + " each" : "No unit cost"}</div></div>
    </div>
    <div class="prof2">
      <div style="display:grid;gap:16px;align-content:start">
        <section class="card"><header><h2>By location</h2></header><div class="tblwrap"><table class="list compact nohover"><thead><tr><th>Location</th><th class="r">Quantity</th>${i.serialized ? "<th>Serial numbers</th>" : ""}</tr></thead><tbody>
          ${Object.entries(s.byLoc).filter(([, n]) => n > 0).map(([l, n]) => `<tr><td>${esc(locName(l))}</td><td class="r">${qf(n)}</td>${i.serialized ? `<td class="mono sm">${s.serials.filter(x => x.loc === l).map(x => esc(x.sn)).join(", ")}</td>` : ""}</tr>`).join("") || `<tr><td colspan="3" class="muted">Not in stock</td></tr>`}</tbody></table></div></section>
        <section class="card"><header><h2>Movements<span>${mv.length}</span></h2></header>${movesTable(mv, id)}</section>
      </div>
      <div style="display:grid;gap:16px;align-content:start">
        <section class="card"><header><h2>Details</h2></header><div class="bd dl2">
          ${[["Part no. / model", i.sku], ["Brand", i.brand], ["Category", i.category], ["Unit", i.unit], ["Serial numbers", i.serialized ? "Tracked" : "Not tracked"], ["Status", i.active ? "Active" : "Inactive"]].map(([k, v]) => `<div><span>${k}</span><b>${esc(v || "-")}</b></div>`).join("")}
          ${i.notes ? `<div style="grid-column:1/-1"><span>Notes</span><b style="white-space:pre-wrap">${esc(i.notes)}</b></div>` : ""}</div></section>
        ${rs.length ? `<section class="card"><header><h2>Reserved on</h2></header>${rs.map(r => `<a class="mi" href="/books/#/doc/${r.quoteId}"><span><b>${esc(docLabel(r.quote))}</b><div class="t">${esc(r.quote ? r.quote.contactName : "")}</div></span><b>${qf(r.lines[id])}</b></a>`).join("")}</section>` : ""}
      </div>
    </div>`, "item");
  $("ed").onclick = () => editItem(i);
  wireMoveBtns(() => ({ itemId: id }));
  wireMovesTable();
}

/* ---------- movements ---------- */
function movesTable(list, itemId) {
  if (!list.length) return `<div class="empty">No movements yet.</div>`;
  return `<div class="tblwrap"><table class="list compact mvt"><thead><tr><th>Date</th><th>Movement</th><th>Items</th><th>From / to</th><th>Linked to</th><th>By</th><th></th></tr></thead><tbody>${list.map(m => {
    const L = itemId ? m.lines.filter(l => l.itemId === itemId) : m.lines;
    const items = L.slice(0, 4).map(l => `${qf(l.qty)} x ${esc((IT.get(l.itemId) || {}).name || "Deleted item")}${l.serials && l.serials.length ? ` <span class="s mono">${esc(l.serials.slice(0, 4).join(", "))}${l.serials.length > 4 ? " +" + (l.serials.length - 4) : ""}</span>` : ""}`).join("<br>") + (L.length > 4 ? `<br><span class="s">and ${L.length - 4} more</span>` : "");
    const ft = [...new Set(L.map(l => [l.from && esc(locName(l.from)), l.to && esc(locName(l.to))].filter(Boolean).join(" → ")))].join("<br>");
    return `<tr data-mid="${m.id}"><td>${fd(m.date)}</td><td>${kindTag(m)}<div class="s">${esc((D.reasons[m.kind] || {})[m.reason] || "")}</div></td><td>${items}</td><td>${ft}</td>
      <td>${docLink(m.docId, m.docNo, m.docType)}${m.party ? `<div class="s">${esc(m.party)}</div>` : ""}${m.ref ? `<div class="s">${esc(m.ref)}</div>` : ""}</td><td class="s">${esc(String(m.createdBy).split("@")[0])}<br>${fdt(m.createdAt)}</td>
      <td>${m.reversedBy ? `<span class="st void">Undone</span>` : ""}</td></tr>`; }).join("")}</tbody></table></div>`;
}
function wireMovesTable() { document.querySelectorAll("tr[data-mid]").forEach(tr => tr.onclick = e => { if (e.target.closest("a")) return; moveDetail(tr.dataset.mid); }); }
function movesView() {
  page("Movements", "Inventory", `<button type="button" id="xl">Export to Excel</button>${moveBtns()}`, `
    <div class="tools"><input type="search" id="q" placeholder="Search item, serial, reference, customer or document">
      <select id="fk"><option value="">All movements</option>${Object.entries(D.kinds).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
      <select id="fl"><option value="">All locations</option>${D.locations.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select>
      <input type="date" id="d1" aria-label="From date"><input type="date" id="d2" aria-label="To date"><span class="cnt" id="cnt"></span></div>
    <div class="panel listpanel" id="box"></div>`, "moves");
  const list = () => { const q = $("q").value.trim().toLowerCase(), k = $("fk").value, l = $("fl").value, a = $("d1").value, b = $("d2").value;
    return D.moves.filter(m => (!k || m.kind === k) && (!l || m.lines.some(x => x.from === l || x.to === l)) && (!a || m.date >= a) && (!b || m.date <= b)
      && (!q || [m.ref, m.note, m.party, m.docNo, ...m.lines.map(x => ((IT.get(x.itemId) || {}).name || "") + " " + ((IT.get(x.itemId) || {}).sku || "") + " " + (x.serials || []).join(" "))].join(" ").toLowerCase().includes(q))); };
  const draw = () => { const L = list(); $("box").innerHTML = movesTable(L); $("cnt").textContent = `${L.length} movement${L.length === 1 ? "" : "s"}`; wireMovesTable(); };
  ["q", "fk", "fl", "d1", "d2"].forEach(x => $(x)[x === "q" ? "oninput" : "onchange"] = draw);
  wireMoveBtns();
  $("xl").onclick = () => act($("xl"), () => exportSheet(`Stock movements ${BR().short || ""} ${D.today}`, [["Movements", [["Date", "Movement", "Reason", "Item", "Part no.", "Quantity", "From", "To", "Serial numbers", "Unit cost", "Document", "Customer / supplier", "Reference", "Note", "By", "Recorded at", "Undone"],
    ...list().flatMap(m => m.lines.map(l => [m.date, m.reverses ? "Undo" : D.kinds[m.kind], (D.reasons[m.kind] || {})[m.reason] || "", (IT.get(l.itemId) || {}).name, (IT.get(l.itemId) || {}).sku, l.qty, locName(l.from), locName(l.to), (l.serials || []).join(", "), l.unitCost, m.docNo, m.party, m.ref, m.note, m.createdBy, m.createdAt, m.reversedBy ? "Yes" : ""]))]]]));
  draw();
}
async function moveDetail(id) {
  const m = D.moves.find(x => x.id === id); if (!m) return;
  const canUndo = !m.reversedBy && !m.reverses;
  const r = await dialog(`<form method="dialog"><h3>${m.reverses ? "Undo of an earlier movement" : esc(D.kinds[m.kind]) + " stock"} · ${fd(m.date)}</h3>
    <div class="dl2" style="margin-bottom:10px">${[["Reason", (D.reasons[m.kind] || {})[m.reason]], ["Linked to", docLabel(DOC.get(m.docId)) || m.docNo], ["Customer / supplier", m.party], ["Reference", m.ref], ["Recorded by", m.createdBy + ", " + fdt(m.createdAt)]].filter(x => x[1]).map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
    ${m.note ? `<p style="margin:0 0 10px;white-space:pre-wrap">${esc(m.note)}</p>` : ""}
    <div class="tblwrap"><table class="list compact nohover"><thead><tr><th>Item</th><th class="r">Qty</th><th>From</th><th>To</th><th>Serial numbers</th></tr></thead><tbody>${m.lines.map(l => `<tr><td>${esc(itemLabel(IT.get(l.itemId)))}</td><td class="r">${qf(l.qty)}</td><td>${esc(locName(l.from))}</td><td>${esc(locName(l.to))}</td><td class="mono sm">${esc((l.serials || []).join(", "))}</td></tr>`).join("")}</tbody></table></div>
    ${m.reversedBy ? `<p class="hint">This movement was undone.</p>` : ""}
    ${canUndo ? `<label style="margin-top:12px;display:block"><span class="lbl">To undo it, say why</span><input id="why" maxlength="300" placeholder="e.g. Entered against the wrong location"></label>` : ""}
    <div class="err" id="err"></div>
    <div class="foot"><button type="button" data-x>Close</button>${canUndo ? `<button type="button" class="danger" id="undo">Undo this movement</button>` : ""}</div></form>`,
    { wide: true, onOpen: (dl, done) => { const u = dl.querySelector("#undo"); if (u) u.onclick = async () => { const why = dl.querySelector("#why").value.trim(); if (!why) { dl.querySelector("#err").textContent = "Say why it is being undone."; return; } busy(u, true); try { await api("POST", `moves/${id}/reverse`, { reason: why }); done(true); } catch (e) { dl.querySelector("#err").textContent = e.message; busy(u, false); } }; } });
  if (r) { await load(); toast("Movement undone. Stock has been put back."); route(); }
}

/* ---------- receive / issue / transfer / adjust ---------- */
async function moveForm(kind, pre = {}) {
  const T = { in: "Receive stock", out: "Issue stock", transfer: "Transfer stock", adjust: "Adjust stock" }[kind];
  const locs = D.locations.filter(l => l.active);
  if (!locs.length) { toast("Add a location first.", true); return go("#/locations"); }
  const lines = [{ itemId: pre.itemId || "", qty: "", serials: "", dir: "add", unitCost: "" }];
  const needFrom = kind === "out" || kind === "transfer", needTo = kind === "in" || kind === "transfer";
  const docOpts = D.docs.filter(d => kind === "out" ? ["dc", "invoice"].includes(d.type) && !["cancelled", "void"].includes(d.status) : kind === "in" ? ["dc", "invoice"].includes(d.type) : false)
    .sort((a, b) => String(b.date).localeCompare(a.date)).slice(0, 300);
  const html = `<form novalidate><h3>${T}</h3>
    <div class="fields three">
      <label><span class="lbl">Date</span><input type="date" id="date" value="${D.today}" max="${D.today}"></label>
      <label><span class="lbl">Reason</span><select id="reason">${Object.entries(D.reasons[kind]).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></label>
      ${needFrom ? `<label><span class="lbl">From location</span><select id="from">${locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select></label>` : ""}
      ${needTo ? `<label><span class="lbl">${kind === "transfer" ? "To location" : "Into location"}</span><select id="to">${locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select></label>` : ""}
      ${kind === "adjust" ? `<label><span class="lbl">Location</span><select id="to">${locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select></label>` : ""}
      ${docOpts.length ? `<label><span class="lbl">${kind === "out" ? "Issued on (challan or invoice)" : "Returned against (optional)"}</span><select id="doc"><option value="">Not linked</option>${docOpts.map(d => `<option value="${d.id}">${esc(docLabel(d))} · ${esc(d.contactName)}</option>`).join("")}</select></label>` : ""}
      <label><span class="lbl">${kind === "in" ? "Supplier / customer" : kind === "out" ? "Customer / project" : "Customer / project (optional)"}</span><input id="party" maxlength="150"></label>
      <label><span class="lbl">Reference</span><input id="ref" maxlength="100" placeholder="${kind === "in" ? "Supplier invoice, PO or project" : "Job, PO or ticket"}"></label>
    </div>
    <div class="tblwrap" style="margin-top:12px"><table class="lines mvl"><thead><tr><th>Item</th>${kind === "adjust" ? "<th>Add / remove</th>" : ""}<th class="n">Qty</th><th>Serial numbers</th>${kind === "in" ? `<th class="n">Unit cost</th>` : ""}<th class="rm"></th></tr></thead><tbody id="ln"></tbody></table></div>
    <div class="btnrow" style="margin-top:8px"><button type="button" id="add">+ Add line</button><button type="button" id="newit">+ New item</button><span class="hint" id="hint" style="margin:0"></span></div>
    <label style="margin-top:10px;display:block"><span class="lbl">Note${kind === "adjust" ? " (required: what the count found or what happened)" : ""}</span><textarea id="note" rows="2" maxlength="500"></textarea></label>
    <datalist id="dlIt">${D.items.filter(i => i.active).map(i => `<option value="${esc(itemLabel(i))}"></option>`).join("")}</datalist>
    <div class="err" id="err"></div>
    <div class="foot"><button type="button" data-x>Cancel</button><button class="primary" type="submit" id="go">${T}</button></div></form>`;
  const ok = await dialog(html, { wide: true, onOpen: (dl, done) => {
    const q = s => dl.querySelector(s);
    const byLabel = v => D.items.find(i => itemLabel(i) === v || i.name === v || (i.sku && i.sku === v));
    const fromLoc = () => kind === "adjust" ? q("#to").value : q("#from") ? q("#from").value : "";
    const avail = (itemId, loc) => num(((ST.get(itemId) || {}).byLoc || {})[loc]);
    const row = (l, n) => { const it = IT.get(l.itemId); const at = needFrom || (kind === "adjust" && l.dir === "remove") ? fromLoc() : "";
      const sns = it && it.serialized && at ? ((ST.get(it.id) || {}).serials || []).filter(x => x.loc === at).map(x => x.sn) : [];
      return `<tr data-i="${n}"><td><input list="dlIt" data-k="item" value="${esc(itemLabel(it))}" placeholder="Type to find an item">${it ? `<div class="s">${needFrom || kind === "adjust" ? `${qf(avail(it.id, fromLoc()))} ${esc(it.unit)} at ${esc(locName(fromLoc()))}` : `${qf((ST.get(it.id) || {}).onHand || 0)} ${esc(it.unit)} in stock`}</div>` : ""}</td>
        ${kind === "adjust" ? `<td><select data-k="dir"><option value="add"${l.dir === "add" ? " selected" : ""}>Add</option><option value="remove"${l.dir === "remove" ? " selected" : ""}>Remove</option></select></td>` : ""}
        <td class="n"><input class="num" data-k="qty" inputmode="decimal" value="${esc(l.qty)}"${it && it.serialized ? ` readonly title="Counted from the serial numbers"` : ""}></td>
        <td>${it && it.serialized ? `<textarea data-k="serials" class="mono" rows="2" placeholder="One per line or comma separated">${esc(l.serials)}</textarea>${sns.length ? `<div class="snpick">${sns.slice(0, 60).map(x => `<button type="button" data-sn="${esc(x)}" class="${splitSn(l.serials).includes(x) ? "on" : ""}">${esc(x)}</button>`).join("")}${sns.length > 60 ? `<span class="s">+${sns.length - 60} more: type them</span>` : ""}</div>` : ""}` : `<span class="s">${it ? "Not serial-tracked" : ""}</span>`}</td>
        ${kind === "in" ? `<td class="n"><input class="num" data-k="unitCost" inputmode="decimal" value="${esc(l.unitCost)}" placeholder="${it && it.unitCost ? aed(it.unitCost) : "0.00"}"></td>` : ""}
        <td class="rm"><button type="button" class="x" data-rm aria-label="Remove line">×</button></td></tr>`; };
    const draw = () => { q("#ln").innerHTML = lines.map(row).join(""); };
    q("#ln").addEventListener("input", e => { const tr = e.target.closest("tr"); if (!tr) return; const l = lines[tr.dataset.i], k = e.target.dataset.k;
      if (k === "item") { const it = byLabel(e.target.value); if (it && it.id !== l.itemId) { l.itemId = it.id; l.qty = it.serialized ? "" : l.qty; draw(); const t = q(`#ln tr[data-i="${tr.dataset.i}"] [data-k="${it.serialized ? "serials" : "qty"}"]`); if (t) t.focus(); } return; }
      l[k] = e.target.value; if (k === "serials") { l.qty = splitSn(l.serials).length || ""; tr.querySelector('[data-k="qty"]').value = l.qty; tr.querySelectorAll("[data-sn]").forEach(b => b.classList.toggle("on", splitSn(l.serials).includes(b.dataset.sn))); } });
    q("#ln").addEventListener("change", e => { if (e.target.dataset.k === "dir") { lines[e.target.closest("tr").dataset.i].dir = e.target.value; draw(); } });
    q("#ln").addEventListener("click", e => { const tr = e.target.closest("tr"); if (!tr) return; const l = lines[tr.dataset.i];
      if (e.target.dataset.rm != null) { lines.splice(+tr.dataset.i, 1); if (!lines.length) lines.push({ itemId: "", qty: "", serials: "", dir: "add", unitCost: "" }); draw(); }
      if (e.target.dataset.sn) { const cur = splitSn(l.serials), sn = e.target.dataset.sn; l.serials = (cur.includes(sn) ? cur.filter(x => x !== sn) : cur.concat(sn)).join("\n"); l.qty = splitSn(l.serials).length || ""; draw(); } });
    ["#from", "#to"].forEach(s => { if (q(s)) q(s).onchange = draw; });
    q("#add").onclick = () => { lines.push({ itemId: "", qty: "", serials: "", dir: "add", unitCost: "" }); draw(); q("#ln tr:last-child input").focus(); };
    q("#newit").onclick = async () => { const it = await editItem(null, true); if (it) { q("#dlIt").innerHTML = D.items.filter(i => i.active).map(i => `<option value="${esc(itemLabel(i))}"></option>`).join(""); const blank = lines.find(l => !l.itemId); if (blank) blank.itemId = it.id; else lines.push({ itemId: it.id, qty: "", serials: "", dir: "add", unitCost: "" }); draw(); } };
    if (q("#doc")) q("#doc").onchange = () => { const d = DOC.get(q("#doc").value); if (d && !q("#party").value) q("#party").value = d.contactName; };
    q("#hint").textContent = kind === "transfer" ? "Moves stock between your locations; the total doesn't change." : kind === "adjust" ? "Use after a stock count, or for damaged, lost or found items." : "";
    draw();
    q("form").onsubmit = async e => { e.preventDefault(); const b = q("#go");
      const L = lines.filter(l => l.itemId).map(l => ({ itemId: l.itemId, qty: l.qty, serials: l.serials, dir: l.dir, unitCost: l.unitCost, from: q("#from") ? q("#from").value : kind === "adjust" ? q("#to").value : "", to: q("#to") ? q("#to").value : "" }));
      if (!L.length) { q("#err").textContent = "Choose at least one item."; return; }
      busy(b, true);
      try { await api("POST", "moves", { kind, reason: q("#reason").value, date: q("#date").value, ref: q("#ref").value, party: q("#party").value, note: q("#note").value, docId: q("#doc") ? q("#doc").value : "", lines: L }); done(true); }
      catch (err) { q("#err").textContent = err.message; busy(b, false); } };
  } });
  if (ok) { await load(); toast({ in: "Stock received.", out: "Stock issued.", transfer: "Stock transferred.", adjust: "Stock adjusted." }[kind]); route(); }
}

/* ---------- items ---------- */
function itemsView() {
  page("Items", "Inventory", `<button type="button" id="imp">Import from Excel</button><button type="button" class="primary" id="ni">+ New item</button>`, `
    <div class="tools"><input type="search" id="q" placeholder="Search name, part no., brand or category"><div class="seg" id="sf"><button aria-pressed="true" data-v="1">Active</button><button aria-pressed="false" data-v="0">Inactive</button></div><span class="cnt" id="cnt"></span></div>
    <div class="panel listpanel"><div class="tblwrap"><table class="list"><thead><tr><th>Item</th><th>Part no. / model</th><th>Brand</th><th>Category</th><th>Unit</th><th>Serials</th><th class="r">Reorder level</th><th class="r">Unit cost</th><th class="r">On hand</th></tr></thead><tbody id="rows"></tbody></table><div class="empty" id="empty" hidden></div></div></div>`, "items");
  let f = "1";
  const draw = () => { const q = $("q").value.trim().toLowerCase();
    const L = D.items.filter(i => String(+i.active) === f && (!q || [i.name, i.sku, i.brand, i.category].join(" ").toLowerCase().includes(q)));
    $("rows").innerHTML = L.map(i => `<tr data-id="${i.id}"><td class="t">${esc(i.name)}</td><td class="mono sm">${esc(i.sku)}</td><td>${esc(i.brand)}</td><td>${esc(i.category)}</td><td>${esc(i.unit)}</td><td>${i.serialized ? "Tracked" : ""}</td><td class="r">${i.minQty ? qf(i.minQty) : ""}</td><td class="r">${i.unitCost ? aed(i.unitCost) : ""}</td><td class="r">${qf((ST.get(i.id) || {}).onHand || 0)}</td></tr>`).join("");
    $("empty").hidden = !!L.length; $("empty").innerHTML = D.items.length ? "Nothing matches." : "<strong>No items yet</strong>Add the products you keep in stock, or import them from Excel.";
    $("cnt").textContent = `${L.length} item${L.length === 1 ? "" : "s"}`;
    $("rows").querySelectorAll("tr").forEach(tr => tr.onclick = () => editItem(IT.get(tr.dataset.id))); };
  $("q").oninput = draw;
  $("sf").querySelectorAll("button").forEach(b => b.onclick = () => { f = b.dataset.v; $("sf").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); draw(); });
  $("ni").onclick = () => editItem(); $("imp").onclick = importDialog;
  draw();
}
async function editItem(i, inner) {
  const has = i && (ST.get(i.id) || {}).onHand > 0, used = i && D.moves.some(m => m.lines.some(l => l.itemId === i.id));
  const cats = [...new Set(D.items.map(x => x.category).filter(Boolean))].sort();
  const r = await dialog(`<form novalidate><h3>${i ? "Edit item" : "New stock item"}</h3>
    <div class="fields">
      <label style="grid-column:1/-1"><span class="lbl">Item name *</span><input name="name" maxlength="200" required value="${esc(i ? i.name : "")}" placeholder="e.g. Aruba AP-735 access point"></label>
      <label><span class="lbl">Part no. / model</span><input name="sku" maxlength="80" value="${esc(i ? i.sku : "")}" placeholder="Matches quotation and challan lines"></label>
      <label><span class="lbl">Brand</span><input name="brand" maxlength="80" value="${esc(i ? i.brand : "")}"></label>
      <label><span class="lbl">Category</span><input name="category" maxlength="80" list="dlCat" value="${esc(i ? i.category : "")}" placeholder="e.g. Networking"></label>
      <label><span class="lbl">Unit</span><input name="unit" maxlength="20" value="${esc(i ? i.unit : "Nos")}"></label>
      <label><span class="lbl">Reorder level</span><input name="minQty" inputmode="decimal" value="${i && i.minQty ? i.minQty : ""}" placeholder="Alert at or below"></label>
      <label><span class="lbl">Unit cost (AED)</span><input name="unitCost" inputmode="decimal" value="${i && i.unitCost ? i.unitCost : ""}" placeholder="Updated when stock is received at a cost"></label>
      <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="serialized"${i && i.serialized ? " checked" : ""}${has && i.serialized ? " disabled" : ""}> Track serial numbers for this item${has && i.serialized ? " (in stock, so it stays tracked)" : ""}</label>
      ${i ? `<label class="chk" style="grid-column:1/-1"><input type="checkbox" name="active"${i.active ? " checked" : ""}> Active (inactive items are hidden from the lists)</label>` : ""}
      <label style="grid-column:1/-1"><span class="lbl">Notes</span><textarea name="notes" rows="2" maxlength="1000">${esc(i ? i.notes : "")}</textarea></label>
    </div><datalist id="dlCat">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    <div class="err"></div>
    <div class="foot">${i && !used ? `<button type="button" class="danger" id="del" style="margin-right:auto">Delete</button>` : ""}<button type="button" data-x>Cancel</button><button class="primary" type="submit">${i ? "Save" : "Add item"}</button></div></form>`,
    { onOpen: (dl, done) => {
      const del = dl.querySelector("#del"); if (del) del.onclick = async () => { busy(del, true); try { await api("DELETE", "items/" + i.id); done("deleted"); } catch (e) { dl.querySelector(".err").textContent = e.message; busy(del, false); } };
      dl.querySelector("form").onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), b = e.target.querySelector("[type=submit]");
        const body = { name: f.get("name"), sku: f.get("sku"), brand: f.get("brand"), category: f.get("category"), unit: f.get("unit"), minQty: f.get("minQty"), unitCost: f.get("unitCost"), notes: f.get("notes"),
          serialized: has && i.serialized ? true : !!f.get("serialized"), active: i ? !!f.get("active") : true, bookItemId: i ? i.bookItemId : "", etag: i && i.etag };
        busy(b, true); try { done(await api(i ? "PUT" : "POST", i ? "items/" + i.id : "items", body)); } catch (err) { dl.querySelector(".err").textContent = err.message; busy(b, false); } };
    } });
  if (!r) return null;
  await load();
  if (inner) return r === "deleted" ? null : IT.get(r.id);
  toast(r === "deleted" ? "Item deleted." : i ? "Item saved." : "Item added.");
  route();
  return r;
}

/* ---------- locations ---------- */
function locationsView() {
  page("Locations", "Inventory", `<button type="button" class="primary" id="nl">+ New location</button>`, `
    <div class="panel listpanel"><div class="tblwrap"><table class="list"><thead><tr><th>Location</th><th>Type</th><th>Address</th><th class="r">Items</th><th class="r">Units</th><th class="r">Value (AED)</th><th>Status</th></tr></thead><tbody>
    ${D.locations.map(l => { const S = D.stock.filter(s => num(s.byLoc[l.id]) > 0); return `<tr data-id="${l.id}"><td class="t">${esc(l.name)}</td><td>${esc(D.locKinds[l.kind])}</td><td>${esc(l.address)}</td><td class="r">${S.length}</td><td class="r">${qf(S.reduce((a, s) => a + num(s.byLoc[l.id]), 0))}</td><td class="r">${aed(S.reduce((a, s) => a + num(s.byLoc[l.id]) * num((IT.get(s.itemId) || {}).unitCost), 0))}</td><td>${l.active ? `<span class="st posted">Active</span>` : `<span class="st void">Closed</span>`}</td></tr>`; }).join("")}
    </tbody></table>${D.locations.length ? "" : `<div class="empty"><strong>No locations yet</strong>Add the office, store, vans or sites where stock is kept.</div>`}</div></div>`, "locations");
  $("nl").onclick = () => editLoc();
  document.querySelectorAll("tr[data-id]").forEach(tr => tr.onclick = () => editLoc(LOC.get(tr.dataset.id)));
}
async function editLoc(l) {
  const r = await dialog(`<form novalidate><h3>${l ? "Edit location" : "New location"}</h3><div class="fields">
    <label><span class="lbl">Name *</span><input name="name" maxlength="100" value="${esc(l ? l.name : "")}" placeholder="e.g. RAK store, Service van 1"></label>
    <label><span class="lbl">Type</span><select name="kind">${Object.entries(D.locKinds).map(([k, v]) => `<option value="${k}"${l && l.kind === k ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
    <label style="grid-column:1/-1"><span class="lbl">Address (optional)</span><input name="address" maxlength="300" value="${esc(l ? l.address : "")}"></label>
    ${l ? `<label class="chk" style="grid-column:1/-1"><input type="checkbox" name="active"${l.active ? " checked" : ""}> Active (a location can be closed once it holds no stock)</label>` : ""}</div>
    <div class="err"></div><div class="foot"><button type="button" data-x>Cancel</button><button class="primary" type="submit">${l ? "Save" : "Add location"}</button></div></form>`,
    { onOpen: (dl, done) => dl.querySelector("form").onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), b = e.target.querySelector("[type=submit]"); busy(b, true);
      try { done(await api(l ? "PUT" : "POST", l ? "locations/" + l.id : "locations", { name: f.get("name"), kind: f.get("kind"), address: f.get("address"), active: l ? !!f.get("active") : true })); } catch (err) { dl.querySelector(".err").textContent = err.message; busy(b, false); } } });
  if (r) { await load(); toast("Location saved."); route(); }
}

/* ---------- reservations ---------- */
function reservedView() {
  page("Reserved on quotations", "Inventory", "", `<p class="hint" style="margin:0 0 12px">Stock is reserved from a quotation in Books & VAT. A reservation lasts while the quotation is open and shrinks as the goods are issued on its delivery challans or invoices.</p>
    <div class="panel listpanel"><div class="tblwrap"><table class="list"><thead><tr><th>Quotation</th><th>Customer</th><th>Items held</th><th>Status</th></tr></thead><tbody>
    ${D.reservations.map(r => `<tr data-q="${r.quoteId}"><td class="t">${esc(r.quote ? r.quote.number || "Draft" : "")}</td><td>${esc(r.quote ? r.quote.contactName : "")}</td><td>${Object.entries(r.lines).map(([id, n]) => `${qf(n)} x ${esc((IT.get(id) || {}).name || "")}`).join("<br>")}</td><td>${esc(r.quote ? r.quote.status : "")}</td></tr>`).join("")}
    </tbody></table>${D.reservations.length ? "" : `<div class="empty">Nothing is reserved. Open a quotation in Books & VAT and use Reserve stock.</div>`}</div></div>`, "reserved");
  document.querySelectorAll("tr[data-q]").forEach(tr => tr.onclick = () => { location.href = "/books/#/doc/" + tr.dataset.q; });
}

/* ---------- import ---------- */
const IMPCOLS = [["name", "Item name", /^(item|item name|name|description|product)$/i], ["sku", "Part no. / model", /part|model|sku|code/i], ["brand", "Brand", /brand|make|manufacturer/i], ["category", "Category", /categ|group|type/i],
  ["unit", "Unit", /^(unit|uom)$/i], ["qty", "Quantity", /^(qty|quantity|stock|on hand|count)$/i], ["serials", "Serial numbers", /serial|s\/n/i], ["location", "Location", /loc|store|warehouse|site/i], ["unitCost", "Unit cost", /cost|price|rate/i], ["minQty", "Reorder level", /reorder|min/i], ["serialized", "Serial tracked (Y/N)", /tracked/i]];
async function importDialog() {
  const r = await dialog(`<form novalidate><h3>Import stock from Excel</h3>
    <p class="hint" style="margin:0 0 10px">One row per item and location. New items and locations are created; quantities and serial numbers are received into stock. Download the template for the column headings.</p>
    <div class="btnrow"><button type="button" id="tpl">Download the Excel template</button><label class="btn" style="cursor:pointer">Choose file<input type="file" id="f" accept=".xlsx,.xls,.csv" hidden></label><span class="hint" id="fn" style="margin:0"></span></div>
    <div class="fields" style="margin-top:10px"><label><span class="lbl">This stock is</span><select id="why"><option value="opening">Opening stock (what we have today)</option><option value="leftover">Leftover from a project</option></select></label><label><span class="lbl">Note</span><input id="note" maxlength="300" placeholder="e.g. Stock count 18 Nov"></label></div>
    <div id="pvw" class="hint"></div><div class="err" id="err"></div>
    <div class="foot"><button type="button" data-x>Cancel</button><button class="primary" type="submit" id="go" disabled>Import</button></div></form>`,
    { wide: true, onOpen: (dl, done) => {
      const q = s => dl.querySelector(s); let rows = [];
      q("#tpl").onclick = () => act(q("#tpl"), () => exportSheet("Inventory import template", [["Stock", [IMPCOLS.map(c => c[1]), ["Aruba AP-735 access point", "S1G42A", "HPE Aruba", "Networking", "Nos", 3, "CNAP001, CNAP002, CNAP003", "RAK store", 1450, 2, "Y"], ["Cat6 patch cord 1m", "CAT6-1M", "", "Cabling", "Nos", 50, "", "RAK store", 6, 20, "N"]]]]));
      q("#f").onchange = async () => { const file = q("#f").files[0]; if (!file) return; q("#fn").textContent = file.name; q("#err").textContent = "";
        try { const X = await xlsx(); const wb = /\.csv$/i.test(file.name) ? X.read(await file.text(), { type: "string" }) : X.read(await file.arrayBuffer(), { type: "array" });
          const grid = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" }).map(r => r.map(c => String(c ?? "").trim())).filter(r => r.some(Boolean));
          const hi = grid.slice(0, 15).findIndex(r => r.some(c => IMPCOLS[0][2].test(c))); if (hi < 0) throw new Error("No 'Item name' column was found. Use the template's headings.");
          const head = grid[hi], used = new Set(), idx = IMPCOLS.map(([, , re]) => { const j = head.findIndex((h, j) => !used.has(j) && re.test(h)); if (j >= 0) used.add(j); return j; });
          rows = grid.slice(hi + 1).map(r => Object.fromEntries(IMPCOLS.map(([k], i) => [k, idx[i] >= 0 ? r[idx[i]] : ""]))).filter(r => r.name);
          const qty = rows.reduce((a, r) => a + (splitSn(r.serials).length || num(r.qty)), 0), newItems = rows.filter(r => !D.items.some(i => (r.sku && i.sku.toLowerCase() === r.sku.toLowerCase()) || (!r.sku && i.name.toLowerCase() === r.name.toLowerCase()))).length;
          const newLocs = [...new Set(rows.map(r => r.location).filter(Boolean))].filter(n => !D.locations.some(l => l.name.toLowerCase() === n.toLowerCase()));
          q("#pvw").innerHTML = `<b>${rows.length} rows</b>: ${newItems} new item${newItems === 1 ? "" : "s"}, ${qf(qty)} units to receive${newLocs.length ? `, new location${newLocs.length > 1 ? "s" : ""}: ${esc(newLocs.join(", "))}` : ""}.${!D.locations.length && !newLocs.length ? " <b>Add a Location column</b>: there are no locations yet." : ""}`;
          q("#go").disabled = !rows.length;
        } catch (e) { q("#err").textContent = e.message || "That file couldn't be read."; q("#go").disabled = true; } };
      q("form").onsubmit = async e => { e.preventDefault(); const b = q("#go"); busy(b, true);
        try { done(await api("POST", "import", { rows, reason: q("#why").value, note: q("#note").value })); } catch (err) { q("#err").textContent = err.message; busy(b, false); } };
    } });
  if (r) { await load(); toast(`Imported: ${r.items} new item${r.items === 1 ? "" : "s"}, ${r.lines} stock line${r.lines === 1 ? "" : "s"} received.`); go("#/stock"); route(); }
}

/* ---------- stock report PDF ---------- */
async function stockPdf(list, loc) {
  await script("/assets/vendor/jspdf-2.5.2.umd.min.js"); await script("/assets/vendor/jspdf-autotable-3.8.4.min.js");
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const B = BR(), C = B.key === "techhub" ? { p: [0, 60, 80], a: [40, 160, 140], soft: [232, 244, 242] } : { p: [30, 90, 140], a: [216, 31, 42], soft: [233, 240, 247] };
  const W = 297, M = 12;
  const img = await new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext("2d").drawImage(im, 0, 0); res({ data: c.toDataURL("image/png"), w: im.naturalWidth, h: im.naturalHeight }); }; im.onerror = () => res(null); im.src = B.logo || "/assets/bifold_logo.png"; });
  if (img) { const h = 13; doc.addImage(img.data, "PNG", M, 9, Math.min(55, img.w / img.h * h), h); }
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...C.p); doc.text("STOCK REPORT", W - M, 15, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(80); doc.text(`${B.name || ""}  ·  ${loc ? locName(loc) : "All locations"}  ·  as at ${fd(D.today)}`, W - M, 21, { align: "right" });
  doc.setDrawColor(...C.a); doc.setLineWidth(0.7); doc.line(M, 26, W - M, 26);
  const body = list.flatMap(({ i, s }) => Object.entries(s.byLoc).filter(([l, n]) => n > 0 && (!loc || l === loc)).map(([l, n]) => [i.name + (i.sku ? "\n" + i.sku : ""), i.brand, locName(l), qf(n) + " " + i.unit, s.reserved ? qf(s.reserved) : "", qf(s.available), i.unitCost ? aed(i.unitCost) : "", aed(n * i.unitCost), s.serials.filter(x => x.loc === l).map(x => x.sn).join(", ")]));
  const tq = list.reduce((a, x) => a + (loc ? num(x.s.byLoc[loc]) : x.s.onHand), 0), tv = list.reduce((a, x) => a + (loc ? num(x.s.byLoc[loc]) : x.s.onHand) * x.i.unitCost, 0);
  doc.autoTable({ startY: 31, margin: { left: M, right: M, bottom: 16 }, head: [["Item / part no.", "Brand", "Location", "On hand", "Reserved", "Available", "Unit cost", "Value (AED)", "Serial numbers"]], body,
    foot: [[{ content: "Total", colSpan: 3 }, qf(tq), "", "", "", aed(tv), ""]], theme: "grid",
    headStyles: { fillColor: C.p, textColor: 255, fontSize: 7.8, fontStyle: "bold" }, footStyles: { fillColor: C.soft, textColor: 20, fontStyle: "bold", fontSize: 8.4 },
    styles: { fontSize: 8, cellPadding: 1.6, lineColor: [220, 226, 232], lineWidth: 0.15, textColor: 30, valign: "top" },
    columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: 28 }, 2: { cellWidth: 30 }, 3: { halign: "right", cellWidth: 20 }, 4: { halign: "right", cellWidth: 17 }, 5: { halign: "right", cellWidth: 18 }, 6: { halign: "right", cellWidth: 20 }, 7: { halign: "right", cellWidth: 24 }, 8: { fontSize: 7 } } });
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) { doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(120); doc.text(`${B.name || ""}  ·  Stock report  ·  printed ${fdt(new Date().toISOString())}`, M, 205); doc.text(`Page ${p} of ${n}`, W - M, 205, { align: "right" }); }
  return doc.output("blob");
}

/* ---------- start ---------- */
window.addEventListener("hashchange", route);
(async () => {
  try { await load(); if (!location.hash) history.replaceState(null, "", "#/stock"); route(); }
  catch (e) { $("app").innerHTML = `<div class="empty"><strong>${e.status === 403 ? "No access" : "Couldn't load Inventory"}</strong>${esc(e.message)}</div>`; }
})();
})();
