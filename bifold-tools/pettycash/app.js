// Petty Cash (single-page app; the API is /api/pc/*). Each custodian holds a float of cash and logs what they
// spend with a photo of the receipt; spending counts against the float straight away. Managers and people with
// full Books access set up floats, top them up, take cash back and post everything to Books & VAT.
(function () {
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const aed = n => num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = n => { n = +n || 0; return Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + "M" : Math.abs(n) >= 1e4 ? Math.round(n / 1e3) + "K" : aed(n); };
const fd = d => d ? new Date(String(d).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const fdt = d => d ? new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const nameOf = e => String(e || "").split("@")[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const ini = e => { const p = String(e || "").split("@")[0].split(/[._-]+/).filter(Boolean); return ((p[0] || "?")[0] + (p[1] ? p[1][0] : (p[0] || "")[1] || "")).toUpperCase(); };
const monthName = ym => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

let D = null, FL = new Map(), CAT = new Map(), BANK = new Map();

/* ---------- plumbing ---------- */
function toast(m, e) { const t = document.createElement("div"); t.className = "toast" + (e ? " err" : ""); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), e ? 6500 : 2600); }
async function api(method, path, body) {
  let r; try { r = await fetch("/api/pc/" + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, cache: "no-store" }); }
  catch { throw new Error("Can't reach the server. Check your connection and try again."); }
  const ct = r.headers.get("content-type") || "";
  if (r.redirected || (r.ok && r.status !== 204 && !ct.includes("json"))) throw new Error("Your session has ended. Reload the page to sign in again.");
  let j = null; if (r.status !== 204) { try { j = await r.json(); } catch {} }
  if (!r.ok) { const e = new Error((j && j.error) || "The request failed."); e.status = r.status; throw e; }
  return j;
}
async function load() {
  D = await api("GET", "bootstrap");
  FL = new Map(D.floats.map(f => [f.id, f])); CAT = new Map(D.categories.map(c => [c.code, c])); BANK = new Map(D.banks.map(b => [b.code, b]));
}
const refresh = async () => { await load(); route(); };
function go(h) { if (location.hash === h) route(); else location.hash = h; }
const busy = (btn, on) => { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.t = btn.textContent; btn.textContent = "Working…"; } else if (btn.dataset.t) btn.textContent = btn.dataset.t; };
const loaded = {};
const script = src => loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error("Couldn't load a library. Check your connection.")); }; document.head.appendChild(s); }));
const xlsx = () => script("/assets/vendor/xlsx-0.18.5.full.min.js").then(() => window.XLSX);
const jspdf = async () => { await script("/assets/vendor/jspdf-2.5.2.umd.min.js"); await script("/assets/vendor/jspdf-autotable-3.8.4.min.js"); return window.jspdf.jsPDF; };
const safe = s => String(s).replace(/:/g, "").replace(/[\\/*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
async function exportSheet(name, sheets) { const X = await xlsx(); const wb = X.utils.book_new(); sheets.forEach(([n, rows, widths]) => { const ws = X.utils.aoa_to_sheet(rows); if (widths) ws["!cols"] = widths.map(w => ({ wch: w })); X.utils.book_append_sheet(wb, ws, n); }); X.writeFile(wb, safe(name) + ".xlsx"); }
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
async function confirmBox(title, text, okLabel, danger) {
  return dialog(`<form method="dialog"><h3>${esc(title)}</h3><p style="margin:0">${text}</p><div class="foot"><button type="button" data-x>Cancel</button><button type="submit" class="${danger ? "danger" : "primary"}" id="ok">${esc(okLabel)}</button></div></form>`,
    { onOpen: (d, done) => { d.querySelector("form").onsubmit = e => { e.preventDefault(); done(true); }; } });
}
const BR = () => window.BIFOLD_BRAND || {};
const admin = () => !!(D && D.admin);
const mine = f => f && f.custodian === D.me;
const floatName = id => (FL.get(id) || {}).name || "";
const catName = c => c ? (CAT.get(c) ? CAT.get(c).name : c) : "";
const kindTag = x => `<span class="kd ${x.kind}">${esc(D.kinds[x.kind])}</span>`;
const inBooks = x => x.kind === "count" ? `<span class="muted sm">Not posted</span>` : x.booksId && x.booksId !== "pending" ? `<a class="bk-ok" href="/books/#/doc/${esc(x.booksId)}">${esc(x.booksNo)}</a>` : `<span class="bk-no">Not in Books</span>`;
const PAPERCLIP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/></svg>`;
const clip = x => x.kind !== "expense" ? "" : x.files.length ? `<span class="clip">${PAPERCLIP}${x.files.length} receipt${x.files.length === 1 ? "" : "s"}</span>` : `<span class="clip miss">No receipt</span>`;
const signed = x => x.kind === "topup" ? x.amount : x.kind === "count" ? 0 : -x.amount;
const fileUrl = (x, f, dl) => `/api/pc/entries/${encodeURIComponent(x.id)}/files/${encodeURIComponent(f.id)}${dl ? "/download" : ""}`;
// What the VAT on an expense will do in Books.
function vatState(x) {
  if (!(x.vatAmt > 0)) return { cls: "", text: "No VAT on this receipt." };
  if (!D.vatRegistered) return { cls: "", text: `${D.company.name} isn't VAT registered in Books, so VAT is part of the cost.` };
  if (x.booksId && x.booksId !== "pending") return x.vatClaimed ? { cls: "ok", text: `Input VAT of AED ${aed(x.vatAmt)} claimed in Books.` } : { cls: "warn", text: `VAT of AED ${aed(x.vatAmt)} added to the cost (not recoverable).` };
  if (/^\d{15}$/.test(x.payeeTrn || "") && x.receiptNo) return { cls: "ok", text: `AED ${aed(x.vatAmt)} VAT will be claimed: the receipt shows the supplier's TRN and number.` };
  return { cls: "warn", text: `AED ${aed(x.vatAmt)} VAT can't be claimed without the supplier's 15-digit TRN and the receipt number; it will be added to the cost.` };
}

/* ---------- layout ---------- */
const SECTION = { floats: "Floats", float: "Floats", entries: "All entries" };
function nav(key) {
  const BX = window.BX; if (!BX) return;
  const k = key === "float" ? "floats" : key;
  BX.markSub("#/" + k);
  BX.crumb(k === "floats" ? [["Petty Cash", "#/floats"]] : [["Petty Cash", "#/floats"], [SECTION[k]]]);
  if (D && admin()) BX.subCount("#/entries", D.entries.filter(x => x.kind !== "count" && !x.booksId).length, "Entries not posted to Books yet");
}
function page(title, tag, acts, body, key) {
  nav(key);
  $("app").innerHTML = `<header class="top"><div><h1><span class="tag">${esc(tag)}</span>${esc(title)}</h1></div><div class="acts">${acts || ""}</div></header>${body}`;
  window.scrollTo(0, 0);
}
function route() {
  if (!D) return;
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?"); const [a, id] = path.split("/");
  const q = new URLSearchParams(qs || "");
  if (a === "float" && id && FL.has(id)) return floatView(id);
  if (a === "entries") return entriesView(q);
  return floatsView();
}

/* ---------- floats overview ---------- */
function floatCard(f) {
  const pct = f.limit > 0 ? Math.max(0, Math.min(100, f.balance / f.limit * 100)) : 0;
  const cls = f.status === "closed" ? "closed" : f.balance <= 0 ? "empty0" : f.low ? "low" : "";
  const flags = [f.status === "closed" ? `<span class="flag closed">Closed</span>` : "", f.status !== "closed" && f.balance <= 0 ? `<span class="flag out">Empty</span>` : f.low ? `<span class="flag low">Low</span>` : "", f.request ? `<span class="flag req">Top-up asked</span>` : ""].join(" ");
  const canLog = f.status === "active" && (mine(f) || admin());
  return `<div class="fcard ${cls}" data-f="${esc(f.id)}" tabindex="0">
    <div class="hd"><div><h3>${esc(f.name)}</h3><div class="who"><span class="av">${esc(ini(f.custodian))}</span>${esc(nameOf(f.custodian))}${mine(f) ? " (you)" : ""}</div></div><div>${flags}</div></div>
    <div><div class="bal"><small>AED</small>${aed(f.balance)}</div><div class="muted sm">of AED ${aed(f.limit)} float · account ${esc(f.account)}</div></div>
    <div class="gauge ${f.balance <= 0 ? "out" : f.low ? "low" : ""}"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="meta"><span>Spent this month <b class="mono">AED ${aed(f.spentThisMonth)}</b></span>${admin() && f.unposted ? `<span class="bk-no">${f.unposted} not in Books</span>` : f.lastCount ? `<span>Counted ${fd(f.lastCount.date)}${Math.abs(f.lastCount.diff) > 0.004 ? `, <b style="color:var(--bad)">${f.lastCount.diff > 0 ? "+" : ""}${aed(f.lastCount.diff)}</b>` : ", matched"}</span>` : ""}</div>
    ${canLog ? `<div class="acts">${`<button type="button" class="primary" data-a="expense">Log expense</button>`}${admin() ? `<button type="button" data-a="topup">Top up</button>` : `<button type="button" data-a="request">${f.request ? "Change request" : "Request top-up"}</button>`}</div>` : ""}
  </div>`;
}
function wireCards(root) {
  root.querySelectorAll(".fcard").forEach(c => {
    c.onclick = e => { const b = e.target.closest("button[data-a]"); if (b) { e.stopPropagation(); return act(b.dataset.a, c.dataset.f); } go("#/float/" + c.dataset.f); };
    c.onkeydown = e => { if (e.key === "Enter" && e.target === c) go("#/float/" + c.dataset.f); };
  });
}
function floatsView() {
  const act0 = D.floats.filter(f => f.status === "active"), closed = D.floats.filter(f => f.status !== "active");
  const ym = D.today.slice(0, 7);
  const exM = D.entries.filter(x => x.kind === "expense" && x.date.slice(0, 7) === ym);
  const unposted = D.entries.filter(x => x.kind !== "count" && !x.booksId);
  const vatM = exM.filter(x => x.vatAmt > 0 && (x.booksId ? x.vatClaimed : /^\d{15}$/.test(x.payeeTrn) && x.receiptNo)).reduce((a, x) => a + x.vatAmt, 0);
  const noR = D.entries.filter(x => x.kind === "expense" && !x.files.length && !x.booksId);
  const reqs = act0.filter(f => f.request);
  if (!D.floats.length) return firstRun();
  // Categories this month, for the side card.
  const byCat = {}; exM.forEach(x => { byCat[x.category] = r2((byCat[x.category] || 0) + x.amount); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]); const cmax = Math.max(1, ...cats.map(c => c[1]));
  page("Petty Cash", D.company.name, `${admin() ? `<button type="button" id="newF">+ New float</button>` : ""}<button type="button" class="primary" id="logE">Log expense</button>`, `
    <div class="kpis">
      <div class="kpi"><div class="k">Cash held</div><div class="v"><small>AED</small>${aed(act0.reduce((a, f) => a + f.balance, 0))}</div><div class="s">${act0.length} active float${act0.length === 1 ? "" : "s"} · AED ${short(act0.reduce((a, f) => a + f.limit, 0))} in total</div></div>
      <a class="kpi" href="#/entries?month=${ym}&kind=expense" style="--c:var(--red)"><div class="k">Spent in ${esc(monthName(ym).split(" ")[0])}</div><div class="v"><small>AED</small>${aed(exM.reduce((a, x) => a + x.amount, 0))}</div><div class="s">${exM.length} expense${exM.length === 1 ? "" : "s"}${vatM ? ` · AED ${aed(vatM)} VAT to claim` : ""}</div></a>
      ${admin() ? `<a class="kpi" href="#/entries?show=unposted" style="--c:var(--warn)"><div class="k">Not in Books yet</div><div class="v">${unposted.length}</div><div class="s">${unposted.length ? "AED " + aed(unposted.reduce((a, x) => a + x.amount, 0)) + " to post" : "Everything is posted"}</div></a>` : ""}
      <a class="kpi" href="#/entries?show=noreceipt" style="--c:var(--bad)"><div class="k">Missing receipts</div><div class="v">${noR.length}</div><div class="s">${noR.length ? "Attach a photo before posting" : "Every expense has a receipt"}</div></a>
    </div>
    ${admin() && reqs.length ? `<div class="note" style="margin-bottom:14px"><b>Top-up requested</b>${reqs.map(f => `${esc(f.name)}: AED ${aed(f.request.amount)}${f.request.note ? " (" + esc(f.request.note) + ")" : ""}, asked ${fdt(f.request.at)}`).join("<br>")}</div>` : ""}
    <div class="prof2">
      <div class="floats">${act0.map(floatCard).join("")}</div>
      <div class="card"><header><h2>Spending by category <span>${esc(monthName(ym))}</span></h2><a href="#/entries?month=${ym}&kind=expense">All</a></header>
        ${cats.length ? `<div class="catbars">${cats.slice(0, 8).map(([c, v]) => `<div class="r0"><span>${esc(catName(c))}</span><span class="n">AED ${aed(v)}</span><span class="tr"><i style="width:${(v / cmax * 100).toFixed(1)}%"></i></span></div>`).join("")}</div>` : `<div class="empty">No spending logged this month.</div>`}
        <header style="border-top:1px solid var(--line)"><h2>Recent</h2><a href="#/entries">All entries</a></header>
        ${D.entries.slice(0, 6).map(x => `<a class="mi" href="#/entries?open=${esc(x.id)}"><span><b>${esc(x.kind === "expense" ? x.payee : D.kinds[x.kind])}</b><span class="t">${fd(x.date)} · ${esc(floatName(x.floatId))}</span></span><span class="amt ${x.kind === "topup" ? "in" : ""}">${x.kind === "count" ? "" : (x.kind === "topup" ? "+" : "−") + aed(x.amount)}</span></a>`).join("") || `<div class="empty">Nothing logged yet.</div>`}
      </div>
    </div>
    ${closed.length ? `<h3 class="sec2">Closed floats</h3><div class="floats">${closed.map(floatCard).join("")}</div>` : ""}`, "floats");
  wireCards($("app"));
  if ($("newF")) $("newF").onclick = () => floatForm();
  $("logE").onclick = () => entryForm("expense");
}
function firstRun() {
  page("Petty Cash", D.company.name, admin() ? `<button type="button" class="primary" id="newF">+ Set up the first float</button>` : "", `
    <div class="panel"><div class="empty" style="padding:20px 10px"><strong>${admin() ? "No petty cash floats yet" : "You don't hold a petty cash float"}</strong>${admin() ? "A float is the cash one person holds for small expenses. Set one up for each person who holds cash." : `Ask ${esc(BR().manager || "your manager")} to set up a float for you.`}</div>
    ${admin() ? `<div class="howto">
      <div><b>1. Set up a float</b>Choose who holds the cash and the amount they should hold. The tool creates a Books cash account for them.</div>
      <div><b>2. Top it up</b>Record the cash handed over from the bank. It posts to Books as a transfer.</div>
      <div><b>3. They log spending</b>With a photo of each receipt, from a phone or computer. The balance drops straight away.</div>
      <div><b>4. Post to Books</b>Each expense posts with its receipt and the right VAT treatment. Top up again to bring the float back to its amount.</div></div>` : ""}</div>`, "floats");
  if ($("newF")) $("newF").onclick = () => floatForm();
}

/* ---------- one float: statement ---------- */
function statementRows(f, from, to) {
  const list = D.entries.filter(x => x.floatId === f.id).slice().sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt));
  let bal = f.opening; const before = [], rows = [];
  for (const x of list) { if (from && x.date < from) { bal = r2(bal + signed(x)); before.push(x); continue; } if (to && x.date > to) continue; rows.push({ x, bal: (bal = r2(bal + signed(x))) }); }
  const opening = r2(f.opening + before.reduce((a, x) => a + signed(x), 0));
  return { opening, rows, closing: rows.length ? rows[rows.length - 1].bal : opening };
}
function floatView(id) {
  const f = FL.get(id);
  const months = [...new Set(D.entries.filter(x => x.floatId === id).map(x => x.date.slice(0, 7)).concat(D.today.slice(0, 7)))].sort().reverse();
  const canLog = f.status === "active" && (mine(f) || admin());
  const acts = [
    canLog ? `<button type="button" data-a="count">Cash count</button>` : "",
    f.status === "active" && admin() ? `<button type="button" data-a="return">Cash returned</button><button type="button" data-a="topup">Top up</button>` : "",
    f.status === "active" && !admin() && mine(f) ? `<button type="button" data-a="request">${f.request ? "Change top-up request" : "Request top-up"}</button>` : "",
    canLog ? `<button type="button" class="primary" data-a="expense">Log expense</button>` : "",
  ].join("");
  const pct = f.limit > 0 ? Math.max(0, Math.min(100, f.balance / f.limit * 100)) : 0;
  page(f.name, "Petty cash float", acts, `
    <div class="fhead">
      <div><div class="muted sm">Cash in hand now</div><div class="bal"><small>AED</small>${aed(f.balance)}</div>
        <div class="gauge ${f.balance <= 0 ? "out" : f.low ? "low" : ""}" style="max-width:420px;margin-top:8px"><i style="width:${pct.toFixed(1)}%"></i></div>
        <div class="facts"><span>Held by <b>${esc(nameOf(f.custodian))}</b> (${esc(f.custodian)})</span><span>Float <b class="mono">AED ${aed(f.limit)}</b></span><span>Top-up to full <b class="mono">AED ${aed(Math.max(0, f.limit - f.balance))}</b></span><span>Books account <b>${esc(f.account)}</b></span>${f.lastCount ? `<span>Last count <b>${fd(f.lastCount.date)}</b>: ${Math.abs(f.lastCount.diff) > 0.004 ? `<b style="color:var(--bad)">${f.lastCount.diff > 0 ? "over" : "short"} by AED ${aed(Math.abs(f.lastCount.diff))}</b>` : "matched"}</span>` : ""}</div>
        ${f.request ? `<div class="note" style="margin-top:10px"><b>Top-up requested: AED ${aed(f.request.amount)}</b>${esc(f.request.note || "")} <span class="muted">(${esc(nameOf(f.request.by))}, ${fdt(f.request.at)})</span></div>` : ""}
        ${f.status === "closed" ? `<div class="note warn" style="margin-top:10px"><b>This float is closed.</b>Reopen it to log against it again.</div>` : ""}
      </div>
      ${admin() ? `<div class="btnrow" style="justify-content:flex-end"><button type="button" id="edF">Edit float</button><button type="button" id="stF">${f.status === "closed" ? "Reopen float" : "Close float"}</button></div>` : ""}
    </div>
    <div class="tools"><label class="sm muted" for="pm">Statement for</label><select id="pm"><option value="all">All time</option>${months.map(m => `<option value="${m}">${esc(monthName(m))}</option>`).join("")}</select>
      <span class="cnt" id="cnt"></span></div>
    <div class="panel listpanel"><div class="tblwrap"><table class="list pcl"><thead><tr><th>Date</th><th>Voucher</th><th>Details</th><th class="r">In</th><th class="r">Out</th><th class="r">Balance</th><th>Books</th></tr></thead><tbody id="rows"></tbody><tfoot id="foot"></tfoot></table></div></div>
    <div class="btnrow" style="margin-top:12px"><button type="button" id="xl">Export to Excel</button><button type="button" id="pv">Preview statement</button><button type="button" class="primary" id="pdf">Download statement (PDF)</button></div>`, "float");
  document.querySelectorAll("header.top [data-a]").forEach(b => b.onclick = () => act(b.dataset.a, id));
  if ($("edF")) $("edF").onclick = () => floatForm(f);
  if ($("stF")) $("stF").onclick = () => setStatus(f);
  const sel = $("pm"); sel.value = months.includes(D.today.slice(0, 7)) ? D.today.slice(0, 7) : "all";
  const period = () => sel.value === "all" ? ["", ""] : [sel.value + "-01", sel.value + "-31"];
  const draw = () => {
    const [from, to] = period(); const S = statementRows(f, from, to);
    const ins = S.rows.reduce((a, r) => a + (r.x.kind === "topup" ? r.x.amount : 0), 0), outs = S.rows.reduce((a, r) => a + (["expense", "return"].includes(r.x.kind) ? r.x.amount : 0), 0);
    $("rows").innerHTML = `<tr class="nohov"><td colspan="5" class="muted">Opening balance${from ? " on " + fd(from) : ""}</td><td class="r mono">${aed(S.opening)}</td><td></td></tr>` + S.rows.map(({ x, bal }) => `<tr data-id="${esc(x.id)}" tabindex="0">
      <td>${fd(x.date)}</td><td><div class="t mono">${esc(x.number || "")}</div>${kindTag(x)}</td>
      <td>${x.kind === "expense" ? `<div class="t">${esc(x.payee)}</div><div class="s">${esc(x.description)} · ${esc(catName(x.category))}${x.vatAmt ? ` · VAT ${aed(x.vatAmt)}` : ""}</div>${clip(x)}` : x.kind === "count" ? `<div class="t">Counted AED ${aed(x.amount)}</div><div class="s">${Math.abs(x.amount - x.expected) > 0.004 ? `<b style="color:var(--bad)">${x.amount > x.expected ? "Over" : "Short"} by AED ${aed(Math.abs(x.amount - x.expected))}</b>` : "Matched the balance"}${x.note ? " · " + esc(x.note) : ""}</div>` : `<div class="t">${esc(x.method)}</div><div class="s">${x.kind === "topup" ? "From" : "To"} ${esc(x.bankAccount)} ${esc((BANK.get(x.bankAccount) || {}).name || "")}${x.ref ? " · " + esc(x.ref) : ""}</div>`}</td>
      <td class="r mono in">${x.kind === "topup" ? aed(x.amount) : ""}</td><td class="r mono">${["expense", "return"].includes(x.kind) ? aed(x.amount) : ""}</td><td class="r mono">${aed(bal)}</td><td>${inBooks(x)}</td></tr>`).join("");
    $("foot").innerHTML = `<tr><td colspan="3">Closing balance${to && to < D.today ? " on " + fd(to.slice(0, 7) + "-" + new Date(Date.UTC(+to.slice(0, 4), +to.slice(5, 7), 0)).getUTCDate()) : ""}</td><td class="r mono">${aed(ins)}</td><td class="r mono">${aed(outs)}</td><td class="r mono">${aed(S.closing)}</td><td></td></tr>`;
    $("cnt").textContent = `${S.rows.length} entr${S.rows.length === 1 ? "y" : "ies"}`;
    $("rows").querySelectorAll("tr[data-id]").forEach(tr => { tr.onclick = e => { if (!e.target.closest("a")) entryView(tr.dataset.id); }; tr.onkeydown = e => { if (e.key === "Enter") entryView(tr.dataset.id); }; });
  };
  sel.onchange = draw; draw();
  const label = () => sel.value === "all" ? "all time" : monthName(sel.value);
  const build = () => { const [from, to] = period(); return statementPdf(f, from, to, label()); };
  const fname = () => safe(`${f.name} statement ${label()}`) + ".pdf";
  $("pv").onclick = () => window.BXPdf.preview(build, fname());
  $("pdf").onclick = async e => { busy(e.target, true); try { saveBlob(await build(), fname()); } catch (err) { toast(err.message, true); } finally { busy(e.target, false); } };
  $("xl").onclick = () => { const [from, to] = period(); const S = statementRows(f, from, to);
    exportSheet(`${f.name} ${label()}`, [["Statement", [[f.name, "", "", "", "Held by " + f.custodian], ["Period", label()], [], ["Date", "Voucher", "Type", "Paid to / method", "Details", "Category", "VAT (AED)", "In (AED)", "Out (AED)", "Balance (AED)", "Books"], ["", "", "", "", "Opening balance", "", "", "", "", S.opening, ""],
      ...S.rows.map(({ x, bal }) => [x.date, x.number, D.kinds[x.kind], x.kind === "expense" ? x.payee : x.method, x.kind === "count" ? `Counted ${aed(x.amount)} (expected ${aed(x.expected)})` : x.description || x.ref, catName(x.category), x.vatAmt || "", x.kind === "topup" ? x.amount : "", ["expense", "return"].includes(x.kind) ? x.amount : "", bal, x.booksNo || ""])], [11, 12, 12, 22, 34, 22, 9, 11, 11, 12, 11]]]); };
}

/* ---------- all entries ---------- */
function entriesView(q) {
  const months = [...new Set(D.entries.map(x => x.date.slice(0, 7)))].sort().reverse();
  page("All entries", "Petty cash", `<button type="button" class="primary" id="logE">Log expense</button>`, `
    <div class="tools"><input type="search" id="q" placeholder="Search payee, description, voucher or receipt no.">
      <select id="ff"><option value="">All floats</option>${D.floats.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("")}</select>
      <select id="fk"><option value="">All types</option>${Object.entries(D.kinds).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
      <select id="fm"><option value="">Any month</option>${months.map(m => `<option value="${m}">${esc(monthName(m))}</option>`).join("")}</select>
      <div class="seg" id="fs"><button type="button" aria-pressed="true" data-v="">All</button>${admin() ? `<button type="button" aria-pressed="false" data-v="unposted">Not in Books</button>` : ""}<button type="button" aria-pressed="false" data-v="noreceipt">No receipt</button></div>
      <span class="cnt" id="cnt"></span></div>
    <div id="bulk"></div>
    <div class="panel listpanel"><div class="tblwrap"><table class="list pcl"><thead><tr>${admin() ? `<th class="ck"><input type="checkbox" id="all" aria-label="Select all not in Books"></th>` : ""}<th>Date</th><th>Voucher</th><th>Float</th><th>Details</th><th class="r">VAT</th><th class="r">Amount (AED)</th><th>Books</th></tr></thead><tbody id="rows"></tbody><tfoot id="foot"></tfoot></table><div class="empty" id="empty" hidden></div></div></div>
    <div class="btnrow" style="margin-top:12px"><button type="button" id="xl">Export to Excel</button></div>`, "entries");
  $("logE").onclick = () => entryForm("expense", { floatId: $("ff").value || undefined });
  if (q.get("float")) $("ff").value = q.get("float");
  if (q.get("kind")) $("fk").value = q.get("kind");
  if (q.get("month") && months.includes(q.get("month"))) $("fm").value = q.get("month");
  let show = q.get("show") || ""; if (show === "unposted" && !admin()) show = "";
  const sel = new Set();
  const segs = () => document.querySelectorAll("#fs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === show));
  const list = () => {
    const w = $("q").value.trim().toLowerCase().split(/\s+/).filter(Boolean), fl = $("ff").value, k = $("fk").value, m = $("fm").value;
    return D.entries.filter(x => (!fl || x.floatId === fl) && (!k || x.kind === k) && (!m || x.date.slice(0, 7) === m)
      && (show !== "unposted" || (x.kind !== "count" && !x.booksId)) && (show !== "noreceipt" || (x.kind === "expense" && !x.files.length && !x.booksId))
      && (!w.length || (h => w.every(t => h.includes(t)))([x.number, x.payee, x.description, x.receiptNo, x.ref, x.project, catName(x.category), floatName(x.floatId), x.booksNo, x.note].join(" ").toLowerCase())));
  };
  const drawBulk = () => {
    if (!admin()) return;
    const n = [...sel].filter(id => D.entries.some(x => x.id === id && !x.booksId)).length;
    $("bulk").innerHTML = n ? `<div class="bulk"><b>${n} selected</b><span class="sp"></span><span class="muted">Each expense posts as a Books expense with its receipts; top-ups and cash returned post as transfers.</span><button type="button" class="primary" id="postSel">Post ${n} to Books</button></div>` : "";
    if (n) $("postSel").onclick = e => postIds([...sel], e.target);
  };
  const draw = () => {
    segs(); const L = list();
    const tot = L.reduce((a, x) => a + (x.kind === "count" ? 0 : x.kind === "topup" ? 0 : x.amount), 0);
    $("rows").innerHTML = L.map(x => `<tr data-id="${esc(x.id)}" tabindex="0">${admin() ? `<td class="ck">${x.kind !== "count" && !x.booksId ? `<input type="checkbox" data-ck="${esc(x.id)}" ${sel.has(x.id) ? "checked" : ""} aria-label="Select ${esc(x.number)}">` : ""}</td>` : ""}
      <td>${fd(x.date)}</td><td><div class="t mono">${esc(x.number || "")}</div>${kindTag(x)}</td><td><div class="s">${esc(floatName(x.floatId))}</div></td>
      <td>${x.kind === "expense" ? `<div class="t">${esc(x.payee)}</div><div class="s">${esc(x.description)} · ${esc(catName(x.category))}${x.project ? " · " + esc(x.project) : ""}</div>${clip(x)}` : x.kind === "count" ? `<div class="t">Cash count</div><div class="s">Counted AED ${aed(x.amount)}, expected AED ${aed(x.expected)}</div>` : `<div class="t">${esc(x.method)}</div><div class="s">${x.kind === "topup" ? "From" : "To"} ${esc((BANK.get(x.bankAccount) || {}).name || x.bankAccount)}${x.ref ? " · " + esc(x.ref) : ""}</div>`}</td>
      <td class="r mono">${x.vatAmt ? aed(x.vatAmt) : ""}</td><td class="r mono ${x.kind === "topup" ? "in" : ""}">${x.kind === "count" ? "" : (x.kind === "topup" ? "+" : "") + aed(x.amount)}</td><td>${inBooks(x)}</td></tr>`).join("");
    $("foot").innerHTML = L.length ? `<tr>${admin() ? "<td></td>" : ""}<td colspan="4">Spent and returned (${L.filter(x => x.kind === "expense").length} expenses)</td><td class="r mono">${aed(L.filter(x => x.kind === "expense").reduce((a, x) => a + x.vatAmt, 0))}</td><td class="r mono">${aed(tot)}</td><td></td></tr>` : "";
    $("empty").hidden = L.length > 0; $("empty").textContent = D.entries.length ? "Nothing matches these filters." : "Nothing logged yet.";
    $("cnt").textContent = `${L.length} entr${L.length === 1 ? "y" : "ies"}`;
    $("rows").querySelectorAll("tr[data-id]").forEach(tr => { tr.onclick = e => { if (e.target.closest("a,input")) return; entryView(tr.dataset.id); }; tr.onkeydown = e => { if (e.key === "Enter" && e.target === tr) entryView(tr.dataset.id); }; });
    $("rows").querySelectorAll("[data-ck]").forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.ck) : sel.delete(c.dataset.ck); drawBulk(); });
    if ($("all")) { const ids = L.filter(x => x.kind !== "count" && !x.booksId).map(x => x.id); $("all").checked = ids.length > 0 && ids.every(id => sel.has(id)); $("all").onchange = () => { ids.forEach(id => $("all").checked ? sel.add(id) : sel.delete(id)); draw(); }; }
    drawBulk();
  };
  ["q", "ff", "fk", "fm"].forEach(i => $(i).addEventListener(i === "q" ? "input" : "change", draw));
  document.querySelectorAll("#fs button").forEach(b => b.onclick = () => { show = b.dataset.v; draw(); });
  draw();
  $("xl").onclick = () => exportSheet(`Petty cash entries ${D.company.name}`, [["Entries", [["Date", "Voucher", "Type", "Float", "Held by", "Paid to / method", "Description", "Category", "Project / customer", "Receipt no.", "Supplier TRN", "Amount (AED)", "VAT (AED)", "VAT claimed", "Books", "Receipts", "Logged by"],
    ...list().map(x => [x.date, x.number, D.kinds[x.kind], floatName(x.floatId), (FL.get(x.floatId) || {}).custodian || "", x.kind === "expense" ? x.payee : x.method, x.kind === "count" ? `Counted ${aed(x.amount)}, expected ${aed(x.expected)}` : x.description || x.ref, catName(x.category), x.project, x.receiptNo, x.payeeTrn, x.kind === "count" ? "" : x.amount, x.vatAmt || "", x.vatClaimed ? "Yes" : "", x.booksNo, x.files.length, x.createdBy])], [11, 12, 12, 20, 24, 22, 32, 22, 18, 12, 17, 12, 10, 10, 11, 8, 24]]]);
  if (q.get("open")) entryView(q.get("open"));
}
async function postIds(ids, btn) {
  busy(btn, true);
  try {
    const r = await api("POST", "post", { ids });
    await load(); route();
    if (r.failed.length) await dialog(`<form method="dialog"><h3>${r.done.length} posted, ${r.failed.length} not posted</h3><div style="display:grid;gap:6px;font-size:13px">${r.failed.map(f => `<div><b>${esc(f.number)}</b>: ${esc(f.reason)}</div>`).join("")}</div><div class="foot"><button type="button" class="primary" data-x>OK</button></div></form>`);
    else toast(`Posted ${r.done.length} to Books.`);
  } catch (e) { toast(e.message, true); busy(btn, false); }
}

/* ---------- actions ---------- */
function act(a, floatId) {
  if (a === "expense" || a === "topup" || a === "return" || a === "count") return entryForm(a, { floatId });
  if (a === "request") return requestForm(FL.get(floatId));
}
async function setStatus(f) {
  const closing = f.status !== "closed";
  if (!(await confirmBox(closing ? "Close this float?" : "Reopen this float?", closing ? `${esc(f.name)} will stop taking entries. Its history stays. The balance must be zero and everything posted to Books.` : `${esc(f.name)} will take entries again.`, closing ? "Close float" : "Reopen", closing))) return;
  try { await api("PUT", `floats/${f.id}/status`, { status: closing ? "closed" : "active" }); await refresh(); toast(closing ? "Float closed." : "Float reopened."); } catch (e) { toast(e.message, true); }
}
async function requestForm(f) {
  const r = await dialog(`<form><h3>Request a top-up</h3><p class="hint" style="margin:0">${esc(f.name)} holds AED ${aed(f.balance)} of AED ${aed(f.limit)}. ${esc(BR().manager || "Your manager")} sees the request in their alerts.</p>
    <div class="fields"><label><span class="lbl">Amount needed (AED)</span><input id="amt" type="number" min="1" step="0.01" inputmode="decimal" required value="${f.request ? f.request.amount : r2(Math.max(0, f.limit - f.balance)) || ""}"></label></div>
    <label><span class="lbl">Note (optional)</span><input id="note" maxlength="300" value="${esc(f.request ? f.request.note : "")}" placeholder="e.g. site visit tomorrow, parking and fuel"></label>
    <div class="err" id="err"></div><div class="foot">${f.request ? `<button type="button" class="danger" id="cx">Cancel request</button><span style="flex:1"></span>` : ""}<button type="button" data-x>Close</button><button type="submit" class="primary">Send request</button></div></form>`,
    { onOpen: (d, done) => {
      const q = s => d.querySelector(s);
      if (q("#cx")) q("#cx").onclick = async () => { try { done(await api("PUT", `floats/${f.id}/request`, { cancel: true })); } catch (e) { q("#err").textContent = e.message; } };
      q("form").onsubmit = async e => { e.preventDefault(); const b = e.submitter; busy(b, true); try { done(await api("PUT", `floats/${f.id}/request`, { amount: q("#amt").value, note: q("#note").value })); } catch (err) { q("#err").textContent = err.message; busy(b, false); } };
    } });
  if (r) { await refresh(); toast(r.request ? "Top-up requested." : "Request cancelled."); }
}
async function floatForm(f) {
  const edit = !!f;
  const people = [...new Set(D.floats.map(x => x.custodian))];
  const free = D.cashAccounts.filter(a => !a.usedBy || (edit && a.code === f.account));
  const r = await dialog(`<form novalidate><h3>${edit ? "Edit float" : "New petty cash float"}</h3>
    <div class="fields"><label><span class="lbl">Held by (work email) *</span><input id="cu" type="email" list="ppl" required maxlength="150" value="${esc(edit ? f.custodian : "")}" placeholder="name@${esc(D.me.split("@")[1])}"></label>
      <label><span class="lbl">Float name</span><input id="nm" maxlength="80" value="${esc(edit ? f.name : "")}" placeholder="Petty cash: name"></label></div>
    <div class="fields"><label><span class="lbl">Float amount (AED) *</span><input id="lim" type="number" min="1" step="0.01" inputmode="decimal" value="${edit ? f.limit : ""}" placeholder="e.g. 2000"><span class="hint">The cash they hold when fully topped up.</span></label>
      <label><span class="lbl">Warn when below</span><select id="low">${[10, 20, 25, 30, 40, 50].map(p => `<option value="${p}" ${(edit ? f.lowPct : 20) === p ? "selected" : ""}>${p}% of the float</option>`).join("")}</select></label></div>
    <label><span class="lbl">Books cash account</span><select id="ac">${edit ? "" : `<option value="new">Create a new cash account for this float (recommended)</option>`}${free.map(a => `<option value="${esc(a.code)}" ${edit && a.code === f.account ? "selected" : ""}>${esc(a.code)} ${esc(a.name)}</option>`).join("")}</select>
      <span class="hint">Each float has its own cash account, so Books shows the cash each person holds.</span></label>
    ${edit ? "" : `<div class="sec">Cash they already hold (optional)</div>
    <p class="hint" style="margin:0">Only if this cash is already in the Books account you chose (for example 1000 Petty Cash with an opening balance). New cash goes in with Top up after saving, which posts it to Books.</p>
    <div class="fields"><label><span class="lbl">Opening cash (AED)</span><input id="op" type="number" min="0" step="0.01" inputmode="decimal" value=""></label><label><span class="lbl">As at</span><input id="od" type="date" value="${esc(D.today)}"></label></div>`}
    <label><span class="lbl">Notes</span><textarea id="nt" rows="2" maxlength="1000" placeholder="What the float is for, spending limits per item, etc.">${esc(edit ? f.notes : "")}</textarea></label>
    <datalist id="ppl">${people.map(p => `<option value="${esc(p)}">`).join("")}</datalist>
    <div class="err" id="err"></div><div class="foot"><button type="button" data-x>Cancel</button><button type="submit" class="primary">${edit ? "Save" : "Create float"}</button></div></form>`,
    { onOpen: (d, done) => {
      const q = s => d.querySelector(s);
      q("form").onsubmit = async e => { e.preventDefault(); const b = e.submitter; busy(b, true);
        const body = { custodian: q("#cu").value, name: q("#nm").value, limit: q("#lim").value, lowPct: q("#low").value, account: q("#ac").value, notes: q("#nt").value };
        if (!edit) { body.opening = q("#op").value; body.openingDate = q("#od").value; } else { body.opening = f.opening; body.openingDate = f.openingDate; body.etag = f.etag; }
        try { done(await api(edit ? "PUT" : "POST", edit ? "floats/" + f.id : "floats", body)); } catch (err) { q("#err").textContent = err.message; busy(b, false); } };
      setTimeout(() => q("#cu").focus(), 50);
    } });
  if (r) { await load(); toast(edit ? "Float saved." : `Float created with Books account ${r.account}.`); go("#/float/" + r.id); route(); }
}

/* ---------- receipts: pick, shrink, send ---------- */
const readB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = () => rej(new Error("Couldn't read the file.")); fr.readAsDataURL(blob); });
// Phone photos are shrunk to about 1600 px so they upload quickly; PDFs are sent as they are.
async function prepFile(file) {
  if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size > 600 * 1024) {
    try {
      const bmp = await createImageBitmap(file); const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
      if (blob && blob.size < file.size) return { name: file.name.replace(/\.\w+$/, "") + ".jpg", type: "image/jpeg", data: await readB64(blob), size: blob.size, url: URL.createObjectURL(blob) };
    } catch {}
  }
  if (file.size > 10 * 1048576) throw new Error(`${file.name} is larger than 10 MB.`);
  if (!/^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf)$/.test(file.type)) throw new Error(`${file.name}: attach a photo or a PDF of the receipt.`);
  return { name: file.name, type: file.type, data: await readB64(file), size: file.size, url: URL.createObjectURL(file) };
}

/* ---------- log / edit an entry ---------- */
async function entryForm(kind, pre = {}, cur) {
  const edit = !!cur; if (edit) kind = cur.kind;
  const options = D.floats.filter(f => f.status === "active" && (admin() || mine(f)));
  if (!options.length) return toast(admin() ? "Set up a float first." : "You don't hold an active petty cash float.", true);
  const fid = (cur && cur.floatId) || pre.floatId || (options.find(mine) || options[0]).id;
  const fl = FL.get(fid);
  const v = cur || { date: D.today, amount: kind === "topup" && fl ? r2(Math.max(0, fl.limit - fl.balance)) || "" : kind === "return" && fl ? fl.balance : "", vatAmt: "", method: "Cash withdrawal" };
  const T = { expense: edit ? `Edit ${cur.number}` : "Log an expense", topup: edit ? `Edit top-up ${cur.number}` : "Top up a float", return: edit ? `Edit ${cur.number}` : "Cash returned to the bank", count: edit ? "Edit cash count" : "Cash count" }[kind];
  const lastBank = (D.entries.find(x => x.kind === "topup") || {}).bankAccount || (D.banks.find(b => b.type === "bank") || {}).code;
  const files = [];
  const r = await dialog(`<form novalidate><h3>${esc(T)}</h3>
    <div class="fields"><label><span class="lbl">Float</span><select id="fl" ${edit ? "disabled" : ""}>${options.map(f => `<option value="${esc(f.id)}" ${f.id === fid ? "selected" : ""}>${esc(f.name)} (AED ${aed(f.balance)})</option>`).join("")}</select></label>
      <label><span class="lbl">Date</span><input id="dt" type="date" max="${esc(D.today)}" value="${esc(v.date)}"></label></div>
    ${kind === "expense" ? `
    <div class="fields"><label><span class="lbl">Total paid (AED) *</span><input id="amt" type="number" min="0.01" step="0.01" inputmode="decimal" value="${v.amount}"><span class="hint">Including any VAT, as on the receipt.</span></label>
      <label><span class="lbl">VAT on the receipt (AED)</span><input id="vat" type="number" min="0" step="0.01" inputmode="decimal" value="${v.vatAmt || ""}" placeholder="0.00"><span class="quick"><button type="button" id="v5">5% included</button><button type="button" id="v0">No VAT</button></span></label></div>
    <div class="fields"><label><span class="lbl">Paid to *</span><input id="py" maxlength="150" list="pys" value="${esc(v.payee || "")}" placeholder="Shop, supplier or person"></label>
      <label><span class="lbl">Category *</span><select id="ct"><option value="">Choose…</option>${D.categories.map(c => `<option value="${esc(c.code)}" ${v.category === c.code ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label></div>
    <label><span class="lbl">What was it for? *</span><input id="ds" maxlength="500" value="${esc(v.description || "")}" placeholder="e.g. Patch cords for the Al Garhoud site"></label>
    <div class="fields three"><label><span class="lbl">Receipt / invoice no.</span><input id="rn" maxlength="60" value="${esc(v.receiptNo || "")}"></label>
      <label><span class="lbl">Supplier TRN</span><input id="trn" maxlength="20" inputmode="numeric" value="${esc(v.payeeTrn || "")}" placeholder="15 digits, if shown"></label>
      <label><span class="lbl">Project / customer</span><input id="pj" maxlength="150" list="pjs" value="${esc(v.project || "")}" placeholder="Optional"></label></div>
    <div class="vat-hint" id="vh"></div>
    ${edit ? "" : `<div><span class="lbl">Receipt photos or PDF</span><div class="files" id="fls"><label class="addfile">+ Add receipt<input type="file" id="fi" accept="image/*,application/pdf" multiple hidden></label></div></div>`}
    ` : kind === "count" ? `
    <div class="fields"><label><span class="lbl">Cash counted (AED) *</span><input id="amt" type="number" min="0" step="0.01" inputmode="decimal" value="${edit ? v.amount : ""}"></label><div><span class="lbl">Balance per the tool</span><div class="mono" id="exp" style="padding-top:8px;font-size:16px"></div></div></div>
    <div class="vat-hint" id="ch"></div>
    ` : `
    <div class="fields"><label><span class="lbl">Amount (AED) *</span><input id="amt" type="number" min="0.01" step="0.01" inputmode="decimal" value="${v.amount}"><span class="hint" id="ah"></span></label>
      <label><span class="lbl">${kind === "topup" ? "Paid from" : "Paid back into"}</span><select id="bk">${D.banks.map(b => `<option value="${esc(b.code)}" ${(v.bankAccount || lastBank) === b.code ? "selected" : ""}>${esc(b.code)} ${esc(b.name)}</option>`).join("")}</select></label></div>
    <div class="fields"><label><span class="lbl">How</span><select id="mt">${D.methods.map(m => `<option ${v.method === m ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></label><label><span class="lbl">Reference</span><input id="rf" maxlength="80" value="${esc(v.ref || "")}" placeholder="Cheque or transfer no."></label></div>`}
    <label><span class="lbl">Note</span><input id="nt" maxlength="1000" value="${esc(v.note || "")}" placeholder="Optional"></label>
    ${admin() && kind !== "count" && !edit ? `<label class="chk"><input type="checkbox" id="pb" ${kind !== "expense" ? "checked" : ""}> Post to Books now</label>` : ""}
    <datalist id="pys">${[...new Set(D.entries.filter(x => x.payee).map(x => x.payee))].slice(0, 60).map(p => `<option value="${esc(p)}">`).join("")}</datalist>
    <datalist id="pjs">${[...new Set(D.entries.filter(x => x.project).map(x => x.project))].slice(0, 60).map(p => `<option value="${esc(p)}">`).join("")}</datalist>
    <div class="err" id="err"></div><div class="foot"><button type="button" data-x>Cancel</button><button type="submit" class="primary">${edit ? "Save" : kind === "expense" ? "Save expense" : kind === "count" ? "Save count" : kind === "topup" ? "Record top-up" : "Record"}</button></div></form>`,
    { wide: kind === "expense", onOpen: (d, done) => {
      const q = s => d.querySelector(s);
      const flNow = () => FL.get(q("#fl").value);
      const hint = () => {
        if (kind === "expense") { const s = vatState({ vatAmt: num(q("#vat").value), payeeTrn: q("#trn").value.replace(/\s+/g, ""), receiptNo: q("#rn").value.trim() }); q("#vh").className = "vat-hint " + s.cls; q("#vh").textContent = s.text; }
        if (kind === "count") { const f = flNow(); const exp = edit ? cur.expected : f.balance; q("#exp").textContent = "AED " + aed(exp); const a = q("#amt").value; const df = r2(num(a) - exp);
          q("#ch").className = "vat-hint " + (a === "" ? "" : Math.abs(df) < 0.005 ? "ok" : "warn"); q("#ch").textContent = a === "" ? "Count the notes and coins in the box, then enter the total." : Math.abs(df) < 0.005 ? "The cash matches the balance." : `The cash is ${df > 0 ? "over" : "short"} by AED ${aed(Math.abs(df))}. Check for expenses not logged yet.`; }
        if (kind === "topup" || kind === "return") { const f = flNow(); q("#ah").textContent = kind === "topup" ? `Holds AED ${aed(f.balance)}; AED ${aed(Math.max(0, f.limit - f.balance))} brings it to the float.` : `Holds AED ${aed(f.balance)}.`; }
      };
      d.querySelectorAll("input,select").forEach(i => i.addEventListener("input", hint));
      if (kind === "expense") {
        q("#v5").onclick = () => { const a = num(q("#amt").value); q("#vat").value = a ? (a - r2(a / 1.05)).toFixed(2) : ""; hint(); };
        q("#v0").onclick = () => { q("#vat").value = ""; hint(); };
        const fi = q("#fi");
        if (fi) {
          const drawFiles = () => { q("#fls").querySelectorAll(".fthumb").forEach(x => x.remove()); files.forEach((f, i) => { const el = document.createElement("div"); el.className = "fthumb"; el.innerHTML = (f.type.startsWith("image/") && f.type !== "image/heic" ? `<img src="${f.url}" alt="">` : `<span>${esc(f.name)}</span>`) + `<button type="button" aria-label="Remove">×</button>`; el.querySelector("button").onclick = () => { files.splice(i, 1); drawFiles(); }; q("#fls").insertBefore(el, q(".addfile")); }); };
          fi.onchange = async () => { for (const f of fi.files) { try { files.push(await prepFile(f)); } catch (e) { toast(e.message, true); } } fi.value = ""; drawFiles(); };
        }
      }
      hint();
      q("form").onsubmit = async e => {
        e.preventDefault(); const b = e.submitter; busy(b, true); q("#err").textContent = "";
        const body = { kind, floatId: q("#fl").value, date: q("#dt").value, amount: q("#amt").value, note: q("#nt").value };
        if (kind === "expense") Object.assign(body, { vatAmt: q("#vat").value, payee: q("#py").value, category: q("#ct").value, description: q("#ds").value, receiptNo: q("#rn").value, payeeTrn: q("#trn").value, project: q("#pj").value, files: files.map(({ name, type, data }) => ({ name, type, data })) });
        if (kind === "topup" || kind === "return") Object.assign(body, { bankAccount: q("#bk").value, method: q("#mt").value, ref: q("#rf").value });
        if (q("#pb")) body.post = q("#pb").checked;
        if (edit) body.etag = cur.etag;
        if (kind === "expense" && !edit && !files.length && !(await confirmBox("No receipt attached", "Save without a photo of the receipt? You can attach it later from the entry.", "Save without receipt"))) { busy(b, false); return; }
        try { done(await api(edit ? "PUT" : "POST", edit ? "entries/" + cur.id : "entries", body)); } catch (err) { q("#err").textContent = err.message; busy(b, false); }
      };
    } });
  if (r) { await load(); route(); toast(r.postError ? `Saved, but not posted to Books: ${r.postError}` : r.posted ? `Saved and posted to Books as ${r.booksNo}.` : edit ? "Saved." : `${r.number || "Cash count"} saved.`, !!r.postError); }
}

/* ---------- one entry ---------- */
async function entryView(id) {
  const x = D.entries.find(e => e.id === id); if (!x) return toast("This entry no longer exists.", true);
  const f = FL.get(x.floatId) || {};
  const canEdit = !x.booksId && (admin() || x.createdBy === D.me);
  const st = x.kind === "expense" ? vatState(x) : null;
  const res = await dialog(`<form method="dialog"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><h3>${esc(x.number || D.kinds[x.kind])}</h3><div style="margin-top:4px">${kindTag(x)} ${inBooks(x)}</div></div><button type="button" class="x" data-x aria-label="Close">×</button></div>
    <div class="dl2">
      <div><span>Date</span><b>${fd(x.date)}</b></div><div><span>Float</span><b>${esc(f.name || "")}</b></div>
      <div><span>${x.kind === "count" ? "Cash counted" : "Amount"}</span><b class="mono">AED ${aed(x.amount)}</b></div>
      ${x.kind === "expense" ? `<div><span>Paid to</span><b>${esc(x.payee)}</b></div><div><span>Category</span><b>${esc(catName(x.category))}</b></div><div><span>VAT</span><b class="mono">${x.vatAmt ? "AED " + aed(x.vatAmt) : "None"}</b></div>
        <div><span>Receipt no.</span><b>${esc(x.receiptNo || "-")}</b></div><div><span>Supplier TRN</span><b class="mono">${esc(x.payeeTrn || "-")}</b></div>${x.project ? `<div><span>Project / customer</span><b>${esc(x.project)}</b></div>` : ""}` : ""}
      ${x.kind === "count" ? `<div><span>Balance per the tool</span><b class="mono">AED ${aed(x.expected)}</b></div><div><span>Difference</span><b class="mono" style="color:${Math.abs(x.amount - x.expected) > 0.004 ? "var(--bad)" : "var(--good)"}">${aed(x.amount - x.expected)}</b></div>` : ""}
      ${["topup", "return"].includes(x.kind) ? `<div><span>${x.kind === "topup" ? "From" : "To"}</span><b>${esc(x.bankAccount)} ${esc((BANK.get(x.bankAccount) || {}).name || "")}</b></div><div><span>How</span><b>${esc(x.method)}</b></div><div><span>Reference</span><b>${esc(x.ref || "-")}</b></div>` : ""}
    </div>
    ${x.kind === "expense" ? `<div><span class="lbl">For</span>${esc(x.description)}</div><div class="vat-hint ${st.cls}">${esc(st.text)}</div>` : ""}
    ${x.note ? `<div><span class="lbl">Note</span>${esc(x.note)}</div>` : ""}
    ${x.kind === "expense" ? `<div><span class="lbl">Receipts</span><div class="files" id="fls">${x.files.map(fl => `<a class="fthumb" href="${fileUrl(x, fl)}" target="_blank" rel="noopener" title="${esc(fl.name)}">${fl.type.startsWith("image/") && !/hei[cf]/.test(fl.type) ? `<img src="${fileUrl(x, fl)}" alt="${esc(fl.name)}" loading="lazy">` : `<span>PDF<br>${esc(fl.name)}</span>`}${canEdit && (admin() || fl.by === D.me) ? `<button type="button" data-rm="${esc(fl.id)}" aria-label="Remove ${esc(fl.name)}">×</button>` : ""}</a>`).join("")}${canEdit ? `<label class="addfile">+ Add receipt<input type="file" id="fi" accept="image/*,application/pdf" multiple hidden></label>` : ""}${!x.files.length && !canEdit ? `<span class="muted sm">None attached.</span>` : ""}</div>${x.booksId && x.booksId !== "pending" && x.files.length ? `<div class="hint">Copies are attached to ${esc(x.booksNo)} in Books.</div>` : ""}</div>` : ""}
    <div class="hint">Logged by ${esc(x.createdBy)} on ${fdt(x.createdAt)}${x.updatedAt !== x.createdAt ? `, last changed by ${esc(x.updatedBy)} on ${fdt(x.updatedAt)}` : ""}${x.postedAt && x.booksId ? `. Posted to Books by ${esc(x.postedBy)} on ${fdt(x.postedAt)}` : ""}.</div>
    ${x.booksId && admin() ? `<div class="note"><b>Locked: in Books as ${esc(x.booksNo)}</b>To correct it, void <a href="/books/#/doc/${esc(x.booksId)}">${esc(x.booksNo)}</a> in Books, then release this entry so it can be edited and posted again.</div>` : ""}
    <div class="err" id="err"></div>
    <div class="foot">
      ${canEdit ? `<button type="button" class="danger" id="del">Delete</button>` : ""}${x.booksId && admin() ? `<button type="button" id="rel">Release after void</button>` : ""}<span style="flex:1"></span>
      ${x.kind === "expense" ? `<button type="button" id="epv">Preview voucher</button><button type="button" id="vpdf">Voucher PDF</button>` : ""}
      ${canEdit ? `<button type="button" id="ed">Edit</button>` : ""}${admin() && !x.booksId && x.kind !== "count" ? `<button type="button" class="primary" id="post">Post to Books</button>` : ""}
    </div></form>`, { wide: true, onOpen: (d, done) => {
      const q = s => d.querySelector(s); const err = m => { q("#err").textContent = m; };
      if (q("#ed")) q("#ed").onclick = () => done("edit");
      if (q("#epv")) q("#epv").onclick = () => window.BXPdf.preview(() => voucherPdf(x), safe(`${x.number} ${x.payee}`) + ".pdf");
      if (q("#vpdf")) q("#vpdf").onclick = async e => { busy(e.target, true); try { saveBlob(await voucherPdf(x), safe(`${x.number} ${x.payee}`) + ".pdf"); } catch (er) { err(er.message); } finally { busy(e.target, false); } };
      if (q("#post")) q("#post").onclick = async e => { busy(e.target, true); try { const r = await api("POST", "post", { ids: [x.id] }); if (r.failed.length) { err(r.failed[0].reason); busy(e.target, false); } else done("posted"); } catch (er) { err(er.message); busy(e.target, false); } };
      if (q("#rel")) q("#rel").onclick = async e => { busy(e.target, true); try { await api("POST", `entries/${x.id}/release`); done("released"); } catch (er) { err(er.message); busy(e.target, false); } };
      if (q("#del")) q("#del").onclick = async e => { if (!confirm(`Delete ${x.number || "this entry"}? This can't be undone.`)) return; busy(e.target, true); try { await api("DELETE", "entries/" + x.id); done("deleted"); } catch (er) { err(er.message); busy(e.target, false); } };
      d.querySelectorAll("[data-rm]").forEach(b => b.onclick = async e => { e.preventDefault(); e.stopPropagation(); try { await api("DELETE", `entries/${x.id}/files/${b.dataset.rm}`); done("files"); } catch (er) { err(er.message); } });
      const fi = q("#fi"); if (fi) fi.onchange = async () => { try { for (const f0 of fi.files) { const p = await prepFile(f0); await api("POST", `entries/${x.id}/files`, { name: p.name, type: p.type, data: p.data }); } done("files"); } catch (er) { err(er.message); } };
    } });
  if (!res) return;
  await load(); route();
  if (res === "edit") return entryForm(x.kind, {}, D.entries.find(e => e.id === id));
  if (res === "files") return entryView(id);
  toast({ posted: "Posted to Books.", released: "Released. You can edit and post it again.", deleted: "Deleted." }[res] || "Saved.");
}

/* ---------- PDFs ---------- */
async function brandHead(doc, title, sub, W) {
  const B = BR(), C = B.key === "techhub" ? { p: [0, 60, 80], a: [40, 160, 140], soft: [232, 244, 242] } : { p: [30, 90, 140], a: [216, 31, 42], soft: [233, 240, 247] };
  const img = await new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext("2d").drawImage(im, 0, 0); res({ data: c.toDataURL("image/png"), w: im.naturalWidth, h: im.naturalHeight }); }; im.onerror = () => res(null); im.src = B.logo || "/assets/bifold_logo.png"; });
  const M = 14;
  if (img) { const h = 13; doc.addImage(img.data, "PNG", M, 10, Math.min(55, img.w / img.h * h), h); }
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...C.p); doc.text(title, W - M, 16, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(80); doc.text(sub, W - M, 22, { align: "right" });
  doc.setDrawColor(...C.a); doc.setLineWidth(0.7); doc.line(M, 27, W - M, 27);
  return C;
}
function footer(doc, W, H, label) {
  const n = doc.getNumberOfPages(), B = BR();
  for (let p = 1; p <= n; p++) { doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(120); doc.text(`${B.name || ""}  ·  ${label}  ·  printed ${fdt(new Date().toISOString())}`, 14, H - 8); doc.text(`Page ${p} of ${n}`, W - 14, H - 8, { align: "right" }); }
}
function words(n) {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"], t = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const w3 = x => { let s = ""; if (x >= 100) { s += a[Math.floor(x / 100)] + " Hundred"; x %= 100; if (x) s += " and "; } if (x >= 20) { s += t[Math.floor(x / 10)]; if (x % 10) s += " " + a[x % 10]; } else if (x) s += a[x]; return s; };
  const whole = Math.floor(n), fils = Math.round((n - whole) * 100); let s = "", i = 0; const big = ["", " Thousand", " Million"]; let x = whole;
  if (!x) s = "Zero"; while (x > 0) { const c = x % 1000; if (c) s = w3(c) + big[i] + (s ? " " + s : ""); x = Math.floor(x / 1000); i++; }
  return `UAE Dirhams ${s}${fils ? ` and ${w3(fils)} Fils` : ""} only`;
}
async function voucherPdf(x) {
  const P = await jspdf(); const doc = new P({ unit: "mm", format: "a4" }); const W = 210, H = 297, M = 14;
  const f = FL.get(x.floatId) || {};
  const C = await brandHead(doc, "PETTY CASH VOUCHER", `${x.number}  ·  ${fd(x.date)}`, W);
  const net = r2(x.amount - x.vatAmt);
  doc.autoTable({ startY: 33, margin: { left: M, right: M }, theme: "plain", styles: { fontSize: 9.5, cellPadding: 1.8, textColor: 30 }, columnStyles: { 0: { cellWidth: 38, textColor: 110 }, 2: { cellWidth: 34, textColor: 110 } },
    body: [["Paid to", x.payee, "Voucher no.", x.number], ["Supplier TRN", x.payeeTrn || "-", "Date", fd(x.date)], ["Receipt / invoice no.", x.receiptNo || "-", "Float", f.name || ""], ["Project / customer", x.project || "-", "Books", x.booksNo || "Not posted yet"]] });
  doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, margin: { left: M, right: M }, theme: "grid", head: [["Description", "Category", "Amount (AED)"]],
    body: [[x.description + (x.note ? "\n" + x.note : ""), catName(x.category), { content: aed(net), styles: { halign: "right" } }]],
    foot: [[{ content: "VAT", colSpan: 2, styles: { halign: "right" } }, { content: aed(x.vatAmt), styles: { halign: "right" } }], [{ content: "Total paid", colSpan: 2, styles: { halign: "right" } }, { content: aed(x.amount), styles: { halign: "right" } }]],
    headStyles: { fillColor: C.p, textColor: 255, fontSize: 9 }, footStyles: { fillColor: C.soft, textColor: 20, fontSize: 9.5 }, styles: { fontSize: 9.5, cellPadding: 2.4, lineColor: [220, 226, 232], lineWidth: 0.15, textColor: 30 }, columnStyles: { 1: { cellWidth: 50 }, 2: { cellWidth: 34 } } });
  let y = doc.lastAutoTable.finalY + 6;
  doc.setFontSize(9); doc.setTextColor(70); doc.setFont("helvetica", "italic"); doc.text(doc.splitTextToSize(words(x.amount), W - 2 * M), M, y); doc.setFont("helvetica", "normal");
  y += 8; const st = vatState(x); doc.setFontSize(8.5); doc.setTextColor(90); doc.text(doc.splitTextToSize(st.text, W - 2 * M), M, y);
  y += 16; const bw = (W - 2 * M - 12) / 3;
  [["Received by (payee)", ""], ["Paid by (custodian)", nameOf(f.custodian)], ["Approved by", ""]].forEach(([l, n], i) => { const bx = M + i * (bw + 6); doc.setDrawColor(150); doc.setLineWidth(0.3); doc.line(bx, y + 16, bx + bw, y + 16); doc.setFontSize(8.5); doc.setTextColor(90); doc.text(l, bx, y + 21); if (n) { doc.setTextColor(30); doc.text(n, bx, y + 13); } });
  y += 30; doc.setFontSize(8); doc.setTextColor(120);
  doc.text(`Logged by ${x.createdBy} on ${fdt(x.createdAt)}. ${x.files.length ? x.files.length + " receipt file" + (x.files.length === 1 ? "" : "s") + " attached in the tool" + (x.booksNo ? " and in Books " + x.booksNo : "") + "." : "No receipt attached."}`, M, y);
  // Receipt images on the next page, so the voucher and its proof print together.
  const imgs = x.files.filter(fl => /^image\/(jpeg|png|webp)$/.test(fl.type));
  for (const fl of imgs) {
    try {
      const blob = await (await fetch(fileUrl(x, fl), { cache: "no-store" })).blob(); const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas"); const s = Math.min(1, 1400 / Math.max(bmp.width, bmp.height)); c.width = bmp.width * s; c.height = bmp.height * s; c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      doc.addPage(); doc.setFontSize(9); doc.setTextColor(80); doc.text(`${x.number}: ${fl.name}`, M, 14);
      const mw = W - 2 * M, mh = H - 40, r = Math.min(mw / c.width, mh / c.height); doc.addImage(c.toDataURL("image/jpeg", 0.85), "JPEG", M, 20, c.width * r, c.height * r);
    } catch {}
  }
  footer(doc, W, H, "Petty cash voucher " + x.number);
  return doc.output("blob");
}
async function statementPdf(f, from, to, label) {
  const P = await jspdf(); const doc = new P({ unit: "mm", format: "a4" }); const W = 210, H = 297, M = 14;
  const C = await brandHead(doc, "PETTY CASH STATEMENT", `${f.name}  ·  ${label}`, W);
  const S = statementRows(f, from, to);
  doc.setFontSize(9); doc.setTextColor(60); doc.text(`Held by ${nameOf(f.custodian)} (${f.custodian})  ·  Float AED ${aed(f.limit)}  ·  Books account ${f.account}`, M, 33);
  const ex = S.rows.filter(r => r.x.kind === "expense").map(r => r.x);
  doc.autoTable({ startY: 37, margin: { left: M, right: M, bottom: 16 }, theme: "grid", head: [["Date", "Voucher", "Details", "In", "Out", "Balance", "Books"]],
    body: [["", "", { content: "Opening balance", styles: { fontStyle: "bold" } }, "", "", aed(S.opening), ""], ...S.rows.map(({ x, bal }) => [fd(x.date), x.number || D.kinds[x.kind],
      x.kind === "expense" ? `${x.payee}: ${x.description}\n${catName(x.category)}${x.vatAmt ? "  ·  VAT " + aed(x.vatAmt) : ""}${x.files.length ? "" : "  ·  no receipt"}` : x.kind === "count" ? `Cash count: ${aed(x.amount)} counted, ${aed(x.expected)} expected` : `${D.kinds[x.kind]}: ${x.method}${x.ref ? ", " + x.ref : ""}`,
      x.kind === "topup" ? aed(x.amount) : "", ["expense", "return"].includes(x.kind) ? aed(x.amount) : "", aed(bal), x.booksNo || (x.kind === "count" ? "" : "Not posted")])],
    foot: [[{ content: "Closing balance", colSpan: 3 }, aed(S.rows.reduce((a, r) => a + (r.x.kind === "topup" ? r.x.amount : 0), 0)), aed(S.rows.reduce((a, r) => a + (["expense", "return"].includes(r.x.kind) ? r.x.amount : 0), 0)), aed(S.closing), ""]],
    headStyles: { fillColor: C.p, textColor: 255, fontSize: 8.4 }, footStyles: { fillColor: C.soft, textColor: 20, fontStyle: "bold", fontSize: 8.6 }, styles: { fontSize: 8.2, cellPadding: 1.8, lineColor: [220, 226, 232], lineWidth: 0.15, textColor: 30, valign: "top" },
    columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 22 }, 3: { halign: "right", cellWidth: 20 }, 4: { halign: "right", cellWidth: 20 }, 5: { halign: "right", cellWidth: 22 }, 6: { cellWidth: 20 } } });
  if (ex.length) {
    const by = {}; ex.forEach(x => { const k = catName(x.category); by[k] = by[k] || [0, 0]; by[k][0] = r2(by[k][0] + x.amount - x.vatAmt); by[k][1] = r2(by[k][1] + x.vatAmt); });
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 8, margin: { left: M, right: M, bottom: 16 }, theme: "grid", head: [["Spending by category", "Before VAT", "VAT", "Total"]],
      body: Object.entries(by).sort((a, b) => b[1][0] - a[1][0]).map(([k, [n, v]]) => [k, aed(n), aed(v), aed(n + v)]),
      foot: [["Total", aed(ex.reduce((a, x) => a + x.amount - x.vatAmt, 0)), aed(ex.reduce((a, x) => a + x.vatAmt, 0)), aed(ex.reduce((a, x) => a + x.amount, 0))]],
      headStyles: { fillColor: C.p, textColor: 255, fontSize: 8.4 }, footStyles: { fillColor: C.soft, textColor: 20, fontStyle: "bold", fontSize: 8.6 }, styles: { fontSize: 8.4, cellPadding: 1.8, lineColor: [220, 226, 232], lineWidth: 0.15, textColor: 30 }, columnStyles: { 1: { halign: "right", cellWidth: 28 }, 2: { halign: "right", cellWidth: 24 }, 3: { halign: "right", cellWidth: 28 } } });
  }
  let y = doc.lastAutoTable.finalY + 20; if (y > H - 40) { doc.addPage(); y = 30; }
  const bw = (W - 2 * M - 12) / 3;
  [["Custodian", nameOf(f.custodian)], ["Checked by", ""], ["Approved by", ""]].forEach(([l, n], i) => { const bx = M + i * (bw + 6); doc.setDrawColor(150); doc.setLineWidth(0.3); doc.line(bx, y, bx + bw, y); doc.setFontSize(8.5); doc.setTextColor(90); doc.text(l, bx, y + 5); if (n) { doc.setTextColor(30); doc.text(n, bx, y - 3); } });
  footer(doc, W, H, "Petty cash statement");
  return doc.output("blob");
}

/* ---------- start ---------- */
window.addEventListener("hashchange", route);
(async () => {
  try { await load(); if (!location.hash) history.replaceState(null, "", D.floats.filter(f => f.status === "active").length === 1 && !D.admin ? "#/float/" + D.floats[0].id : "#/floats"); route(); }
  catch (e) { $("app").innerHTML = `<div class="empty"><strong>${e.status === 403 ? "No access" : "Couldn't load Petty Cash"}</strong>${esc(e.message)}</div>`; }
})();
})();
