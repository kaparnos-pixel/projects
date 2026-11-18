// Books: the Stock panel on quotations, delivery challans and invoices (people with Inventory access).
// Quotation: reserve stock for it. Challan / invoice: issue the goods from stock, with locations and serial
// numbers. Stock already issued anywhere along the quotation > challan > invoice chain counts once.
// The API is /api/inv/* (src/inventory.js).
(function () {
"use strict";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r3 = x => Math.round((Number(x) + Number.EPSILON) * 1000) / 1000;
const qf = n => r3(n).toLocaleString("en-US", { maximumFractionDigits: 3 });
const splitSn = v => [...new Set(String(v || "").split(/[\n,;]+/).map(x => x.trim()).filter(Boolean))];
function toast(m, e) { const t = document.createElement("div"); t.className = "toast" + (e ? " err" : ""); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), e ? 6500 : 2600); }
async function api(method, path, body) {
  let r; try { r = await fetch("/api/inv/" + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, cache: "no-store" }); }
  catch { throw new Error("Can't reach the server. Check your connection and try again."); }
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error((j && j.error) || "The request failed.");
  return j;
}
function dialog(html, onOpen) {
  return new Promise(resolve => {
    const d = document.createElement("dialog"); d.className = "wide"; d.style.width = "min(1000px, calc(100% - 32px))";
    d.innerHTML = html; document.body.appendChild(d);
    const done = v => { d.close(); d.remove(); resolve(v); };
    d.addEventListener("cancel", e => { e.preventDefault(); done(null); });
    d.querySelectorAll("[data-x]").forEach(b => b.onclick = () => done(null));
    onOpen(d, done); d.showModal();
  });
}

async function mount(doc, el) {
  let S;
  try { S = await api("GET", "doc/" + doc.id); }
  catch (e) { el.innerHTML = `<header><h2>Stock</h2></header><div class="bd hint">${esc(e.message)}</div>`; return; }
  const IT = new Map(S.items.map(i => [i.id, i])), LOC = new Map(S.locations.map(l => [l.id, l]));
  const isQ = doc.type === "quote";
  const lines = S.lines.filter(l => l.qty > 0);
  const rsvd = S.reservation && S.reservation.quoteId === doc.id ? S.reservation : null;
  const row = l => {
    const it = IT.get(l.stockItemId), st = it ? S.stock[it.id] : null;
    const iss = it ? num(S.issued[it.id]) : 0;
    const right = !it ? `<span class="hint" style="margin:0">Not in stock list</span>`
      : isQ ? `<b>${qf(st.onHand - st.reserved + (rsvd && rsvd.open ? num((rsvd.left || {})[it.id]) : 0))}</b> free${rsvd && num((rsvd.left || {})[it.id]) ? ` · ${qf(rsvd.left[it.id])} held` : ""}`
      : `${qf(Math.min(iss, l.qty))} of ${qf(l.qty)} issued`;
    return `<div class="mi" style="cursor:default"><span><b>${esc(l.name)}</b><div class="t">${it ? `${esc(it.name)} · ${qf(st.onHand)} ${esc(it.unit)} on hand` : "Add it to Inventory to track it"}</div></span><span style="text-align:right;font-size:12px;white-space:nowrap">${right}</span></div>`;
  };
  const anyMatch = lines.some(l => l.stockItemId);
  const toIssue = lines.some(l => l.stockItemId && num(S.issued[l.stockItemId]) < l.qty);
  const btns = [];
  if (isQ && anyMatch && ["draft", "sent", "accepted"].includes(doc.status)) btns.push(`<button type="button" data-st="reserve" class="${rsvd ? "" : "primary"}">${rsvd && rsvd.open ? "Change reservation" : "Reserve stock"}</button>`);
  if (isQ && rsvd && rsvd.open) btns.push(`<button type="button" data-st="release">Release</button>`);
  if (!isQ && doc.status !== "cancelled" && doc.status !== "void" && (toIssue || !anyMatch)) btns.push(`<button type="button" data-st="issue" class="primary">Issue from stock</button>`);
  const mv = S.moves.filter(m => m.docId === doc.id && !m.reverses);
  el.innerHTML = `<header><h2>Stock${S.chain.length > 1 ? `<span>with ${S.chain.filter(x => x.id !== doc.id).map(x => esc(x.number || "draft")).join(", ")}</span>` : ""}</h2><a href="/inventory/#/stock">Inventory →</a></header>
    ${lines.map(row).join("") || `<div class="bd hint">No lines.</div>`}
    ${mv.length ? `<div class="bd" style="font-size:12px;display:grid;gap:4px;border-top:1px solid var(--line)">${mv.map(m => `<div>${m.reversedBy ? "<s>" : ""}${m.kind === "out" ? "Issued" : "Returned"} ${m.lines.map(l => `${qf(l.qty)} x ${esc((IT.get(l.itemId) || {}).name || "")} ${m.kind === "out" ? "from" : "to"} ${esc((LOC.get(l.from || l.to) || {}).name || "")}`).join(", ")} · ${esc(m.date)}${m.reversedBy ? "</s> (undone)" : ""}</div>`).join("")}<a href="/inventory/#/moves" style="font-size:12px">Undo or return in Inventory →</a></div>` : ""}
    ${btns.length ? `<div class="bd acts2">${btns.join("")}</div>` : ""}`;
  el.querySelectorAll("[data-st]").forEach(b => b.onclick = () => ({ reserve, release, issue })[b.dataset.st](doc, S, el));
}

const pickItem = (S, sel) => `<select data-k="item"><option value="">Not from stock</option>${S.items.filter(i => i.active).map(i => `<option value="${i.id}"${i.id === sel ? " selected" : ""}>${esc(i.name)}${i.sku ? " (" + esc(i.sku) + ")" : ""}</option>`).join("")}</select>`;

async function reserve(doc, S, el) {
  const rsv = S.reservation && S.reservation.quoteId === doc.id ? S.reservation : null;
  const rows = S.lines.filter(l => l.qty > 0).map(l => ({ l, itemId: l.stockItemId, qty: rsv ? num((rsv.left || {})[l.stockItemId]) || "" : "" }));
  rows.forEach(r => { if (r.itemId && r.qty === "") { const st = S.stock[r.itemId]; const free = r3(st.onHand - st.reserved + (rsv && rsv.open ? num((rsv.left || {})[r.itemId]) : 0)); r.qty = Math.max(0, Math.min(r.l.qty, free)) || ""; } });
  const ok = await dialog(`<form novalidate><h3>Reserve stock for ${esc(doc.number || "this quotation")}</h3>
    <p class="hint" style="margin:0 0 10px">Reserved stock is held for this quotation while it is open, and is released as the goods are issued on its challans or invoices, or when it is cancelled or declined.</p>
    <div class="tblwrap"><table class="list compact nohover"><thead><tr><th>Quotation line</th><th>Stock item</th><th class="r">On quote</th><th class="r">Free</th><th class="r">Reserve</th></tr></thead><tbody>
    ${rows.map((r, i) => { const st = r.itemId ? S.stock[r.itemId] : null; return `<tr data-i="${i}"><td>${esc(r.l.name)}</td><td>${pickItem(S, r.itemId)}</td><td class="r">${qf(r.l.qty)}</td><td class="r" data-free>${st ? qf(st.onHand - st.reserved + (rsv && rsv.open ? num((rsv.left || {})[r.itemId]) : 0)) : ""}</td><td class="r"><input class="num" data-k="qty" inputmode="decimal" style="width:90px" value="${esc(r.qty)}"></td></tr>`; }).join("")}
    </tbody></table></div><div class="err"></div><div class="foot"><button type="button" data-x>Cancel</button><button type="submit" class="primary">Reserve</button></div></form>`,
    (dl, done) => {
      dl.querySelector("tbody").addEventListener("change", e => { const tr = e.target.closest("tr"), r = rows[tr.dataset.i]; if (e.target.dataset.k === "item") { r.itemId = e.target.value; const st = S.stock[r.itemId]; tr.querySelector("[data-free]").textContent = st ? qf(st.onHand - st.reserved) : ""; } });
      dl.querySelector("tbody").addEventListener("input", e => { const r = rows[e.target.closest("tr").dataset.i]; if (e.target.dataset.k === "qty") r.qty = e.target.value; });
      dl.querySelector("form").onsubmit = async e => { e.preventDefault(); const b = e.target.querySelector("[type=submit]"); b.disabled = true;
        try { await api("PUT", "reserve/" + doc.id, { lines: rows.filter(r => r.itemId && num(r.qty) > 0).map(r => ({ itemId: r.itemId, qty: r.qty })) }); done(true); }
        catch (err) { dl.querySelector(".err").textContent = err.message; b.disabled = false; } };
    });
  if (ok) { toast("Stock reserved."); mount(doc, el); }
}
async function release(doc, S, el) {
  try { await api("PUT", "reserve/" + doc.id, { lines: [] }); toast("Reservation released."); mount(doc, el); } catch (e) { toast(e.message, 1); }
}

async function issue(doc, S, el) {
  const locs = S.locations;
  if (!locs.length) { toast("Set up Inventory locations first.", 1); return; }
  const stockAt = (id, loc) => num(((S.stock[id] || {}).byLoc || {})[loc]);
  const bestLoc = id => (locs.map(l => [l.id, stockAt(id, l.id)]).sort((a, b) => b[1] - a[1])[0] || [locs[0].id])[0];
  // Issue what is left after anything already issued on this document's chain.
  const left = { ...S.issued };
  const rows = S.lines.filter(l => l.qty > 0).map(l => {
    const itemId = l.stockItemId, done = Math.min(num(left[itemId]), l.qty); if (itemId) left[itemId] = num(left[itemId]) - done;
    const it = S.items.find(i => i.id === itemId), loc = itemId ? bestLoc(itemId) : locs[0].id;
    const sn = it && it.serialized ? splitSn(l.serials).filter(x => ((S.stock[itemId] || {}).serials || []).some(s => s.sn.toLowerCase() === x.toLowerCase() && s.loc === loc)) : [];
    const want = r3(l.qty - done);
    return { l, itemId, loc, qty: it && it.serialized ? sn.length || "" : want > 0 ? Math.min(want, stockAt(itemId, loc)) || "" : "", serials: sn.join("\n"), want };
  });
  const ok = await dialog(`<form novalidate><h3>Issue from stock for ${esc(doc.number || "this document")}</h3>
    <p class="hint" style="margin:0 0 10px">Takes the goods out of stock and links the movement to ${esc(doc.number || "this document")}. Leave a line blank or set "Not from stock" for anything not held in stock.</p>
    <div class="tblwrap"><table class="lines mvl" style="min-width:860px"><thead><tr><th>Line</th><th>Stock item</th><th>From</th><th class="n">Qty</th><th>Serial numbers</th></tr></thead><tbody id="rw"></tbody></table></div>
    <div class="err"></div><div class="foot"><button type="button" data-x>Cancel</button><button type="submit" class="primary">Issue from stock</button></div></form>`,
    (dl, done) => {
      const draw = () => { dl.querySelector("#rw").innerHTML = rows.map((r, i) => { const it = S.items.find(x => x.id === r.itemId), st = it ? S.stock[it.id] : null;
        const sns = it && it.serialized ? (st.serials || []).filter(x => x.loc === r.loc).map(x => x.sn) : [];
        return `<tr data-i="${i}"><td><b>${esc(r.l.name)}</b><div class="s">${qf(r.l.qty)} on document${r.want < r.l.qty ? `, ${qf(r.l.qty - Math.max(0, r.want))} already issued` : ""}</div></td>
          <td>${pickItem(S, r.itemId)}</td>
          <td>${it ? `<select data-k="loc">${locs.map(l => `<option value="${l.id}"${l.id === r.loc ? " selected" : ""}>${esc(l.name)} (${qf(stockAt(it.id, l.id))})</option>`).join("")}</select>` : ""}</td>
          <td class="n">${it ? `<input class="num" data-k="qty" inputmode="decimal" value="${esc(r.qty)}"${it.serialized ? " readonly" : ""}>` : ""}</td>
          <td>${it && it.serialized ? `<textarea data-k="serials" class="mono" rows="2" placeholder="Serial numbers being issued">${esc(r.serials)}</textarea>${sns.length ? `<div class="snpick">${sns.slice(0, 60).map(x => `<button type="button" data-sn="${esc(x)}" class="${splitSn(r.serials).includes(x) ? "on" : ""}">${esc(x)}</button>`).join("")}</div>` : `<div class="s">None at this location</div>`}` : it ? `<span class="s">Not serial-tracked</span>` : ""}</td></tr>`; }).join(""); };
      const tb = dl.querySelector("#rw");
      tb.addEventListener("change", e => { const r = rows[e.target.closest("tr").dataset.i], k = e.target.dataset.k;
        if (k === "item") { r.itemId = e.target.value; r.loc = r.itemId ? bestLoc(r.itemId) : r.loc; r.serials = ""; r.qty = ""; draw(); }
        if (k === "loc") { r.loc = e.target.value; r.serials = ""; draw(); } });
      tb.addEventListener("input", e => { const tr = e.target.closest("tr"), r = rows[tr.dataset.i], k = e.target.dataset.k;
        if (k === "qty") r.qty = e.target.value;
        if (k === "serials") { r.serials = e.target.value; r.qty = splitSn(r.serials).length || ""; tr.querySelector('[data-k="qty"]').value = r.qty; tr.querySelectorAll("[data-sn]").forEach(b => b.classList.toggle("on", splitSn(r.serials).includes(b.dataset.sn))); } });
      tb.addEventListener("click", e => { if (!e.target.dataset.sn) return; const r = rows[e.target.closest("tr").dataset.i], cur = splitSn(r.serials), sn = e.target.dataset.sn;
        r.serials = (cur.includes(sn) ? cur.filter(x => x !== sn) : cur.concat(sn)).join("\n"); r.qty = splitSn(r.serials).length || ""; draw(); });
      draw();
      dl.querySelector("form").onsubmit = async e => { e.preventDefault(); const b = e.target.querySelector("[type=submit]");
        const L = rows.filter(r => r.itemId && (num(r.qty) > 0 || splitSn(r.serials).length)).map(r => ({ itemId: r.itemId, from: r.loc, qty: r.qty, serials: r.serials }));
        if (!L.length) { dl.querySelector(".err").textContent = "Nothing to issue: enter a quantity on at least one line."; return; }
        b.disabled = true;
        try { await api("POST", "moves", { kind: "out", reason: "customer", docId: doc.id, ref: doc.ref || "", lines: L }); done(true); }
        catch (err) { dl.querySelector(".err").textContent = err.message; b.disabled = false; } };
    });
  if (ok) { toast("Issued from stock."); mount(doc, el); }
}

window.BKSTOCK = { mount };
})();
