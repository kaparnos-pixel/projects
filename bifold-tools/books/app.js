// Books: UAE VAT-compliant accounting and quotations (single-page app; the API is /api/books/*).
// Everything shown is worked out from the posted documents the API returns; the API does the posting and checks.
(function () {
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const aed = (n, d = 2) => (num(n) < 0 ? "-" : "") + Math.abs(num(n)).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const aedS = n => { const a = Math.abs(num(n)); const s = a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e4 ? (a / 1e3).toFixed(1) + "K" : aed(a, 0); return (num(n) < 0 ? "-" : "") + s; };
const fd = d => d ? new Date(d.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

const LISTS = { quotes: "quote", invoices: "invoice", receipts: "receipt", creditnotes: "creditnote", pos: "po", bills: "bill", payments: "payment", vendorcredits: "vendorcredit", expenses: "expense", journals: "journal", transfers: "transfer" };
const ROUTE_OF = Object.fromEntries(Object.entries(LISTS).map(([k, v]) => [v, k]));
const PLURAL = { quote: "Quotations", invoice: "Invoices", receipt: "Payments received", creditnote: "Credit notes", po: "Purchase orders", bill: "Bills", payment: "Payments made", vendorcredit: "Vendor credits", expense: "Expenses", journal: "Manual journals", transfer: "Transfers" };
const NAME = { quote: "Quotation", invoice: "Invoice", receipt: "Payment received", creditnote: "Credit note", po: "Purchase order", bill: "Bill", payment: "Payment made", vendorcredit: "Vendor credit", expense: "Expense", journal: "Manual journal", transfer: "Transfer" };
const SALES = new Set(["quote", "invoice", "receipt", "creditnote"]);
const LINE_TYPES = new Set(["quote", "invoice", "creditnote", "po", "bill", "vendorcredit", "expense"]);
const METHODS = ["Bank transfer", "Cheque", "PDC", "Cash", "Card", "Online payment"];

let D = null, ACC = new Map(), CUS = new Map(), VEN = new Map(), ITEMS = new Map(), DOCS = new Map(), ME = null;
const BK = window.BK = { esc, aed, aedS, fd, r2, num, addDays, get D() { return D; }, ACC: () => ACC, CUS: () => CUS, VEN: () => VEN, DOCS: () => DOCS, contactName, brand: () => window.BIFOLD_BRAND || {}, go, toast, api, xlsx, openDoc: id => go("#/doc/" + id) };

/* ---------- plumbing ---------- */
function toast(m, e) { const t = document.createElement("div"); t.className = "toast" + (e ? " err" : ""); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), e ? 6500 : 2600); }
async function api(method, path, body) {
  let r; try { r = await fetch("/api/books/" + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, cache: "no-store" }); }
  catch { throw new Error("Can't reach the server. Check your connection and try again."); }
  const ct = r.headers.get("content-type") || "";
  if (r.redirected || (r.ok && r.status !== 204 && !ct.includes("json"))) throw new Error("Your session has ended. Reload the page to sign in again.");
  let j = null; if (r.status !== 204) { try { j = await r.json(); } catch {} }
  if (!r.ok) { const e = new Error((j && j.error) || "The request failed."); e.status = r.status; throw e; }
  return j;
}
async function load() {
  D = await api("GET", "bootstrap");
  ACC = new Map(D.accounts.map(a => [a.code, a])); CUS = new Map(D.customers.map(c => [c.id, c])); VEN = new Map(D.vendors.map(v => [v.id, v]));
  ITEMS = new Map(D.items.map(i => [i.id, i])); DOCS = new Map(D.docs.map(d => [d.id, d]));
  $("dlItems").innerHTML = D.items.filter(i => i.active).map(i => `<option value="${esc(i.name)}">${esc([i.sku, i.brand, "AED " + aed(i.salePrice)].filter(Boolean).join(" · "))}</option>`).join("");
}
function supplierVerified(id) { const v = (D.vver || {})[id]; return !!(v && v.checks && v.checks.trn && v.checks.licence && v.checks.address); }
BK.supplierVerified = supplierVerified;
// Input VAT claimed on a supply from a UAE supplier (box 9, or a domestic reverse charge from a resident supplier):
// the supplies FTA Decision 13 of 2026 expects verified. Services bought from abroad are left out.
BK.domesticInput = d => { const v = VEN.get(d.contactId); const uae = !v || !v.country || /^(uae|united arab emirates|ae)$/i.test(v.country.trim()); return (d.tax || []).some(x => x[0] === "9" || (x[0] === "10" && uae && d.type !== "expense" && (d.tax || []).some(y => y[0] === "3"))); };
function contactName(id) { return (CUS.get(id) || VEN.get(id) || {}).name || ""; }
const acctName = c => { const a = ACC.get(c); return a ? `${a.code} ${a.name}` : c || ""; };
function go(h) { if (location.hash === h) route(); else location.hash = h; }
const params = () => Object.fromEntries(new URLSearchParams((location.hash.split("?")[1] || "")));
const busy = (btn, on) => { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.t = btn.textContent; btn.textContent = "Working…"; } else if (btn.dataset.t) btn.textContent = btn.dataset.t; };
function st(v) { const L = { posted: "Posted", draft: "Draft", void: "Void", open: "Open", overdue: "Overdue", partial: "Part paid", paid: "Paid", applied: "Applied", unapplied: "Unapplied", sent: "Sent", accepted: "Accepted", declined: "Declined", converted: "Converted", cancelled: "Cancelled", expired: "Expired" }; return `<span class="st ${esc(v)}">${esc(L[v] || v)}</span>`; }
const vatOn = () => D.settings.vatRegistered;
const docTitle = d => d.type === "invoice" ? (vatOn() ? "Tax invoice" : "Invoice") : d.type === "creditnote" ? (vatOn() ? "Tax credit note" : "Credit note") : NAME[d.type];
const label = d => `${docTitle(d)} ${d.number || "(draft)"}`;
const today = () => D.today;

// Excel export (SheetJS, loaded when needed, same library the other tools use).
let xlsxP = null;
function xlsx() { return xlsxP || (xlsxP = new Promise((res, rej) => { if (window.XLSX) return res(window.XLSX); const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = () => res(window.XLSX); s.onerror = () => { xlsxP = null; rej(new Error("Couldn't load the Excel library. Check your connection.")); }; document.head.appendChild(s); })); }
async function exportSheets(name, sheets) {
  const X = await xlsx(); const wb = X.utils.book_new();
  sheets.forEach(([n, rows]) => X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), n.slice(0, 31)));
  X.writeFile(wb, name.replace(/[\\/:*?"<>|]/g, "-") + ".xlsx");
}
BK.exportSheets = exportSheets;

/* ---------- small dialogs ---------- */
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
function ask(title, text, { input, okText = "OK", danger, placeholder = "" } = {}) {
  return dialog(`<form method="dialog"><h3>${esc(title)}</h3><p style="margin:0">${esc(text)}</p>${input ? `<textarea rows="2" maxlength="300" placeholder="${esc(placeholder)}" required></textarea>` : ""}<div class="err"></div><div class="foot"><button type="button" data-x>Cancel</button><button class="${danger ? "danger" : "primary"}" type="submit">${esc(okText)}</button></div></form>`,
    { onOpen: (d, done) => d.querySelector("form").onsubmit = e => { e.preventDefault(); const t = d.querySelector("textarea"); if (t && !t.value.trim()) { d.querySelector(".err").textContent = "This is required."; return; } done(t ? t.value.trim() : true); } });
}
async function quickContact(kind) {
  const em = D.emirates.map(e => `<option>${e}</option>`).join("");
  return dialog(`<form><h3>New ${kind === "customer" ? "customer" : "supplier"}</h3>
    <label><span class="lbl">Legal name *</span><input name="name" required maxlength="150"></label>
    <div class="fields"><label><span class="lbl">TRN</span><input name="trn" maxlength="20" inputmode="numeric" placeholder="15 digits if VAT registered"></label><label><span class="lbl">Email</span><input name="email" type="email" maxlength="150"></label></div>
    <div class="fields"><label><span class="lbl">Emirate / city</span><input name="emirate" list="emQ" maxlength="50"></label>${kind === "vendor" ? `<label><span class="lbl">Country</span><input name="country" value="UAE" maxlength="60"></label>` : `<label><span class="lbl">Phone</span><input name="phone" maxlength="50"></label>`}</div>
    <label><span class="lbl">Address</span><input name="address" maxlength="300"></label>
    <datalist id="emQ">${em}</datalist>
    <p class="hint" style="margin:0">Saved to the shared ${kind === "customer" ? "Customers" : "Suppliers & Vendors"} list, so every tool sees it.</p>
    <div class="err"></div><div class="foot"><button type="button" data-x>Cancel</button><button class="primary" type="submit">Add</button></div></form>`, {
    onOpen: (d, done) => d.querySelector("form").onsubmit = async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const btn = e.submitter; busy(btn, true);
      if (f.trn && !/^\d{15}$/.test(f.trn.replace(/\s/g, ""))) { d.querySelector(".err").textContent = "A UAE TRN has 15 digits."; busy(btn, false); return; }
      try { const c = await api("POST", kind === "customer" ? "customers" : "vendors", f); await load(); done(c); } catch (err) { d.querySelector(".err").textContent = err.message; busy(btn, false); }
    } });
}

/* ---------- navigation ---------- */
function nav(active) {
  const P = D.perms;
  const L = (h, t, k) => `<a href="#/${h}" class="${active === (k || h) ? "on" : ""}">${esc(t)}</a>`;
  if (P.quotesOnly) { $("bkNav").innerHTML = L("quotes", "Quotations"); return; }
  $("bkNav").innerHTML = L("dashboard", "Dashboard") + `<span class="sep"></span><span class="gl">Sales</span>` + L("customers", "Customers") + L("quotes", "Quotations") + L("invoices", "Invoices") + L("receipts", "Received") + L("creditnotes", "Credit notes")
    + `<span class="sep"></span><span class="gl">Purchases</span>` + L("vendors", "Suppliers") + L("pos", "POs") + L("bills", "Bills") + L("payments", "Paid") + L("expenses", "Expenses") + L("vendorcredits", "Vendor credits")
    + `<span class="sep"></span><span class="gl">Accountant</span>` + L("banking", "Banking") + L("journals", "Journals") + L("accounts", "Chart of accounts") + L("items", "Items")
    + `<span class="sep"></span>` + L("reports", "Reports") + L("vat", "VAT return", "vat") + L("report/ct", "Corporate tax", "ct") + L("settings", "Settings");
  const on = $("bkNav").querySelector("a.on"); if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function page(title, tag, acts, body, navKey) {
  nav(navKey);
  $("app").innerHTML = `<header class="top"><div><h1><span class="tag">${esc(tag)}</span>${esc(title)}</h1></div><div class="acts">${acts || ""}</div></header>${body}`;
  window.scrollTo(0, 0);
}

async function route() {
  if (!D) return;
  const h = location.hash.replace(/^#\/?/, "").split("?")[0];
  const [a, b, c] = h.split("/");
  const P = D.perms;
  try {
    if (P.quotesOnly && !["quotes", "doc", "new", "edit"].includes(a)) return go("#/quotes");
    if (!a || a === "dashboard") return dashboard();
    if (LISTS[a]) return listView(LISTS[a]);
    if (a === "customers") return contactsView("customer");
    if (a === "vendors") return contactsView("vendor");
    if (a === "contact") return contactView(b, c);
    if (a === "doc") return docView(b);
    if (a === "new") return editor(b, null);
    if (a === "edit") return editor(null, b);
    if (a === "banking") return banking();
    if (a === "account") return accountView(b);
    if (a === "accounts") return coa();
    if (a === "items") return itemsView();
    if (a === "reports") return reportsHome();
    if (a === "report") return BKREP.render(b, params(), page);
    if (a === "vat") return BKREP.render("vat", params(), page);
    if (a === "settings") return settingsView();
    go("#/dashboard");
  } catch (e) { console.error(e); $("app").innerHTML = `<div class="empty"><strong>Something went wrong</strong>${esc(e.message)}</div>`; }
}
addEventListener("hashchange", route);

/* ---------- ledger helpers (shared with reports) ---------- */
function ledger() {
  const out = [];
  D.docs.forEach(d => { if (d.status !== "posted") return; d.gl.forEach(g => out.push({ date: d.date, id: d.id, type: d.type, number: d.number, contact: g[3] || "", party: d.contactName, acct: g[0], dr: g[1], cr: g[2], memo: g[4] || d.ref || "" })); });
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.number.localeCompare(y.number));
}
BK.ledger = ledger;
function balanceOf(code, to, from) { return r2(ledger().filter(l => l.acct === code && (!to || l.date <= to) && (!from || l.date >= from)).reduce((a, l) => a + l.dr - l.cr, 0)); }
BK.balanceOf = balanceOf;
const signed = (code, v) => { const g = (ACC.get(code) || {}).group; return g === "asset" || g === "expense" ? v : -v; };
BK.signed = signed;
function fyStart(d) { const m = D.settings.fyStartMonth; const y = Number(d.slice(0, 4)), mm = Number(d.slice(5, 7)); const sy = mm >= m ? y : y - 1; return `${sy}-${String(m).padStart(2, "0")}-01`; }
BK.fyStart = fyStart;
// VAT periods follow the company's stagger: quarters ending Mar/Jun/Sep/Dec ("jan"), Apr/Jul/Oct/Jan ("feb") or May/Aug/Nov/Feb ("mar").
function vatPeriod(d, back = 0) {
  const s = D.settings; const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  if (s.vatPeriod === "monthly") { const t = new Date(Date.UTC(y, m - 1 - back, 1)); const e = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)); return [t.toISOString().slice(0, 10), e.toISOString().slice(0, 10)]; }
  const off = { jan: 0, feb: 1, mar: 2 }[s.vatStagger] || 0;
  const idx = Math.floor((y * 12 + (m - 1) - off) / 3) - back; const startM = idx * 3 + off;
  const t = new Date(Date.UTC(Math.floor(startM / 12), startM % 12, 1)); const e = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 3, 0));
  return [t.toISOString().slice(0, 10), e.toISOString().slice(0, 10)];
}
BK.vatPeriod = vatPeriod;
function vatBoxes(from, to) {
  const box = {}; D.docs.forEach(d => { if (d.status !== "posted" || d.date < from || d.date > to) return; d.tax.forEach(([k, n, v]) => { box[k] = box[k] || { net: 0, vat: 0, docs: [] }; box[k].net = r2(box[k].net + n); box[k].vat = r2(box[k].vat + v); box[k].docs.push([d.id, n, v]); }); });
  return box;
}
BK.vatBoxes = vatBoxes;

/* ---------- dashboard ---------- */
function dashboard() {
  const t = today(), docs = D.docs;
  const inv = docs.filter(d => d.type === "invoice" && d.status === "posted" && d.balance > 0.004);
  const od = inv.filter(d => d.view === "overdue");
  const bills = docs.filter(d => d.type === "bill" && d.status === "posted" && d.balance > 0.004);
  const billsDue = bills.filter(d => d.dueDate <= addDays(t, 7));
  const cashAccts = D.accounts.filter(a => a.type === "bank" || a.type === "cash");
  const L = ledger();
  const bal = c => r2(L.filter(l => l.acct === c).reduce((a, l) => a + l.dr - l.cr, 0));
  const cash = cashAccts.reduce((a, x) => a + bal(x.code), 0);
  const ms = t.slice(0, 8) + "01";
  const pl = (from, to) => { let inc = 0, exp = 0; L.forEach(l => { if (l.date < from || l.date > to) return; const g = (ACC.get(l.acct) || {}).group; if (g === "income") inc += l.cr - l.dr; if (g === "expense") exp += l.dr - l.cr; }); return [r2(inc), r2(exp)]; };
  const [mi, me] = pl(ms, t);
  const [vs, ve] = vatPeriod(t); const vb = vatBoxes(vs, ve);
  const outV = Object.entries(vb).filter(([k]) => /^1[a-g]$|^3$|^6$/.test(k)).reduce((a, [, x]) => a + x.vat, 0), inV = Object.entries(vb).filter(([k]) => k === "9" || k === "10").reduce((a, [, x]) => a + x.vat, 0);
  // 12 months income vs expense
  const months = []; for (let i = 11; i >= 0; i--) { const dt = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1 - i, 1)); const f = dt.toISOString().slice(0, 10); const e = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); months.push([dt.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), ...pl(f, e)]); }
  const mx = Math.max(1, ...months.flatMap(m => [m[1], m[2]]));
  const quotes = docs.filter(d => d.type === "quote" && ["draft", "sent", "accepted"].includes(d.view));
  // VAT registration watch: taxable supplies over the last 12 months.
  const y1 = addDays(t, -365);
  const taxable = docs.filter(d => (d.type === "invoice" || d.type === "creditnote") && d.status === "posted" && d.date > y1).reduce((a, d) => a + (d.type === "creditnote" ? -d.subtotal : d.subtotal), 0);
  const eDays = daysBetween(t, "2027-07-01"), aspDays = daysBetween(t, "2027-03-31");
  const kpi = (k, v, s, href, c) => `<a class="kpi" href="${href}" style="--c:${c || "var(--accent)"}"><div class="k">${k}</div><div class="v"><small>AED</small>${aedS(v)}</div><div class="s">${s}</div></a>`;
  const s = D.settings;
  const warn = [];
  if (!s.vatRegistered && taxable > 375000) warn.push(`<div class="note bad"><b>VAT registration is mandatory</b>Taxable supplies in the last 12 months are AED ${aed(taxable, 0)}, over the AED 375,000 threshold. Register with the FTA within 30 days and turn on VAT in Settings.</div>`);
  else if (!s.vatRegistered && taxable > 187500) warn.push(`<div class="note warn"><b>Voluntary VAT registration is open</b>Taxable supplies in the last 12 months are AED ${aed(taxable, 0)} (voluntary threshold AED 187,500; mandatory AED 375,000).</div>`);
  if (s.vatRegistered && !s.trn) warn.push(`<div class="note bad"><b>Add your TRN</b>Tax invoices must show your Tax Registration Number. <a href="#/settings">Open Settings</a></div>`);
  if (aspDays > 0 && aspDays < 240) warn.push(`<div class="note"><b>E-invoicing: ${aspDays} days to appoint an Accredited Service Provider</b>Businesses under AED 50M revenue must appoint an ASP by 31 Mar 2027 and issue e-invoices from 1 Jul 2027 (${eDays} days). Keep customer TRNs and addresses complete; the Settings page has a readiness check.</div>`);
  page("Dashboard", `${D.company.name} · Books`, `<button class="primary" data-new="invoice">+ Invoice</button><button data-new="quote">+ Quotation</button><button data-new="receipt">Receive payment</button><button data-new="bill">+ Bill</button><button data-new="expense">+ Expense</button>`,
    `${warn.length ? `<div style="display:grid;gap:8px;margin-bottom:16px">${warn.join("")}</div>` : ""}
    <section class="kpis">
      ${kpi("Receivables", inv.reduce((a, d) => a + d.balance, 0), `${inv.length} open · <b class="${od.length ? "neg" : ""}">${od.length} overdue (AED ${aedS(od.reduce((a, d) => a + d.balance, 0))})</b>`, "#/invoices?view=unpaid", "var(--accent)")}
      ${kpi("Payables", bills.reduce((a, d) => a + d.balance, 0), `${bills.length} open · ${billsDue.length} due within 7 days`, "#/bills?view=unpaid", "var(--warn)")}
      ${kpi("Cash and bank", cash, cashAccts.length + " accounts", "#/banking", "var(--good)")}
      ${kpi("Profit this month", mi - me, `Income ${aedS(mi)} · expenses ${aedS(me)}`, "#/report/pl", mi - me < 0 ? "var(--bad)" : "var(--good)")}
      ${vatOn() ? kpi(`VAT ${fd(vs).slice(3)} to ${fd(ve).slice(3)}`, outV - inV, `Output ${aedS(outV)} · input ${aedS(inV)} · due ${fd(addDays(ve, 28))}`, "#/vat", "var(--red)") : ""}
    </section>
    <div class="grid2">
      <section class="card"><header><h2>Income and expenses<span>last 12 months</span></h2><a href="#/report/pl">Profit and loss →</a></header>
        <div class="bars">${months.map(m => `<div class="b" title="${m[0]}: income AED ${aed(m[1], 0)}, expenses AED ${aed(m[2], 0)}"><div class="pair"><i style="height:${Math.max(1, m[1] / mx * 100)}%"></i><i class="e" style="height:${Math.max(1, m[2] / mx * 100)}%"></i></div><span>${m[0]}</span></div>`).join("")}</div>
        <div class="legend"><span><i></i>Income</span><span><i class="e"></i>Expenses</span></div></section>
      <section class="card"><header><h2>Overdue invoices<span>${od.length}</span></h2><a href="#/report/ar">Aging →</a></header>
        ${od.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 7).map(d => `<a class="mi" href="#/doc/${d.id}"><span><b>${esc(d.contactName)}</b><div class="t">${esc(d.number)} · due ${fd(d.dueDate)} · ${daysBetween(d.dueDate, t)} days late</div></span><span class="amt">${aed(d.balance)}</span></a>`).join("") || `<div class="empty">Nothing overdue.</div>`}</section>
      <section class="card"><header><h2>Bills to pay<span>${bills.length}</span></h2><a href="#/report/ap">Aging →</a></header>
        ${bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 7).map(d => `<a class="mi" href="#/doc/${d.id}"><span><b>${esc(d.contactName)}</b><div class="t">${esc(d.ref || d.number)} · due ${fd(d.dueDate)}${d.dueDate < t ? ` · <span class="neg">overdue</span>` : ""}</div></span><span class="amt">${aed(d.balance)}</span></a>`).join("") || `<div class="empty">No unpaid bills.</div>`}</section>
      <section class="card"><header><h2>Open quotations<span>${quotes.length}</span></h2><a href="#/quotes">All →</a></header>
        ${quotes.slice(0, 7).map(d => `<a class="mi" href="#/doc/${d.id}"><span><b>${esc(d.contactName)}</b><div class="t">${esc(d.number)} · ${st(d.view)} · valid to ${fd(d.dueDate)}</div></span><span class="amt">${aed(d.total)}</span></a>`).join("") || `<div class="empty">No open quotations.</div>`}</section>
      ${(() => { const c = BKREP.ctCompute(fyStart(t)); const pct = Math.min(100, c.revenue / 30000); return `<section class="card"><header><h2>Corporate tax<span>this financial year to date</span></h2><a href="#/report/ct">Computation →</a></header><div class="bd" style="display:grid;gap:10px">
        <div><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)"><span>Revenue against the AED 3M Small Business Relief limit</span><b class="${c.revenue > 3e6 ? "neg" : ""}">${aedS(c.revenue)} / 3M</b></div><div style="height:8px;background:var(--sunk);border-radius:99px;overflow:hidden;margin-top:4px"><div style="height:100%;width:${pct}%;background:${pct > 90 ? "var(--bad)" : pct > 75 ? "var(--warn)" : "var(--good)"}"></div></div></div>
        <div class="vatgrid"><span>Taxable income so far</span><span class="n">${aed(c.ti0)}</span><span>Estimated tax${c.sbr ? " (relief elected)" : ""}</span><span class="n">${aed(c.tax)}</span><span class="tot">Return due</span><span class="n tot">${fd(c.due)}</span></div>
        ${c.eligible ? "" : `<div class="note warn" style="font-size:12px">${esc(c.why)}</div>`}</div></section>`; })()}
      <section class="card"><header><h2>Cash and bank</h2><a href="#/banking">Banking →</a></header>
        ${cashAccts.map(a => `<a class="mi" href="#/account/${a.code}"><span><b>${esc(a.name)}</b><div class="t">${esc(a.code)} · ${a.type === "bank" ? "Bank" : "Cash"}</div></span><span class="amt">${aed(bal(a.code))}</span></a>`).join("")}</section>
    </div>`, "dashboard");
  $("app").querySelectorAll("[data-new]").forEach(b => b.onclick = () => go("#/new/" + b.dataset.new));
}

/* ---------- lists ---------- */
const VIEWS = {
  quote: [["", "All"], ["open", "Open"], ["accepted", "Accepted"], ["converted", "Invoiced"], ["expired", "Expired"], ["declined", "Declined"]],
  invoice: [["", "All"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["paid", "Paid"], ["draft", "Draft"], ["void", "Void"]],
  bill: [["", "All"], ["unpaid", "Unpaid"], ["due", "Due in 7 days"], ["overdue", "Overdue"], ["paid", "Paid"], ["draft", "Draft"], ["void", "Void"]],
  po: [["", "All"], ["open", "Open"], ["converted", "Billed"], ["cancelled", "Cancelled"]],
};
function listView(type) {
  const p = params(); const view = p.view || "";
  const t = today();
  let rows = D.docs.filter(d => d.type === type);
  const match = d => {
    if (!view) return true;
    if (view === "unpaid") return d.status === "posted" && d.balance > 0.004;
    if (view === "due") return d.status === "posted" && d.balance > 0.004 && d.dueDate <= addDays(t, 7);
    if (view === "open") return ["draft", "sent", "accepted"].includes(d.status) && d.view !== "expired";
    return d.view === view || d.status === view;
  };
  const cols = {
    quote: [["Date", d => fd(d.date)], ["Quotation", d => `<span class="t">${esc(d.number)}</span>`], ["Customer", d => esc(d.contactName)], ["Reference", d => esc(d.ref || d.title)], ["Valid until", d => fd(d.dueDate)], ["Status", d => st(d.view)], ["Amount", d => aed(d.total), "r mono"]],
    invoice: [["Date", d => fd(d.date)], ["Invoice", d => `<span class="t">${esc(d.number || "Draft")}</span>`], ["Customer", d => esc(d.contactName)], ["PO / ref", d => esc(d.ref)], ["Due", d => fd(d.dueDate)], ["Status", d => st(d.view)], ["Total", d => aed(d.total), "r mono"], ["Balance", d => d.status === "posted" ? aed(d.balance) : "", "r mono"]],
    creditnote: [["Date", d => fd(d.date)], ["Credit note", d => `<span class="t">${esc(d.number || "Draft")}</span>`], ["Customer", d => esc(d.contactName)], ["Status", d => st(d.view)], ["Total", d => aed(d.total), "r mono"], ["Unapplied", d => d.status === "posted" ? aed(d.balance) : "", "r mono"]],
    receipt: [["Date", d => fd(d.date)], ["Receipt", d => `<span class="t">${esc(d.number)}</span>`], ["Customer", d => esc(d.contactName)], ["Into", d => esc(acctName(d.account))], ["Status", d => st(d.view)], ["Amount", d => aed(d.amount), "r mono"], ["Unapplied", d => d.status === "posted" ? aed(d.balance) : "", "r mono"]],
    po: [["Date", d => fd(d.date)], ["PO", d => `<span class="t">${esc(d.number)}</span>`], ["Supplier", d => esc(d.contactName)], ["Expected", d => fd(d.dueDate)], ["Status", d => st(d.view)], ["Amount", d => aed(d.total), "r mono"]],
    bill: [["Date", d => fd(d.date)], ["Bill", d => `<span class="t">${esc(d.number)}</span>`], ["Supplier", d => esc(d.contactName)], ["Supplier inv.", d => esc(d.ref)], ["Due", d => fd(d.dueDate)], ["Status", d => st(d.view)], ["Total", d => aed(d.total), "r mono"], ["Balance", d => d.status === "posted" ? aed(d.balance) : "", "r mono"]],
    vendorcredit: [["Date", d => fd(d.date)], ["Vendor credit", d => `<span class="t">${esc(d.number)}</span>`], ["Supplier", d => esc(d.contactName)], ["Status", d => st(d.view)], ["Total", d => aed(d.total), "r mono"], ["Unapplied", d => d.status === "posted" ? aed(d.balance) : "", "r mono"]],
    payment: [["Date", d => fd(d.date)], ["Payment", d => `<span class="t">${esc(d.number)}</span>`], ["Supplier", d => esc(d.contactName)], ["From", d => esc(acctName(d.account))], ["Status", d => st(d.view)], ["Amount", d => aed(d.amount), "r mono"], ["Unapplied", d => d.status === "posted" ? aed(d.balance) : "", "r mono"]],
    expense: [["Date", d => fd(d.date)], ["Expense", d => `<span class="t">${esc(d.number)}</span>`], ["Payee", d => esc(d.contactName)], ["Receipt no.", d => esc(d.ref)], ["Paid from", d => esc(acctName(d.account))], ["Status", d => st(d.view)], ["Total", d => aed(d.total), "r mono"]],
    journal: [["Date", d => fd(d.date)], ["Journal", d => `<span class="t">${esc(d.number)}</span>`], ["Accounts", d => esc([...new Set(d.gl.map(g => (ACC.get(g[0]) || {}).name))].slice(0, 3).join(", "))], ["Status", d => st(d.view)], ["Amount", d => aed(d.total), "r mono"]],
    transfer: [["Date", d => fd(d.date)], ["Transfer", d => `<span class="t">${esc(d.number)}</span>`], ["From", d => esc(acctName(d.account))], ["To", d => esc(acctName((d.gl.find(g => g[1] > 0) || [])[0]))], ["Status", d => st(d.view)], ["Amount", d => aed(d.amount), "r mono"]],
  }[type];
  cols[1] = [cols[1][0], (f => d => f(d) + clipCount(d))(cols[1][1]), cols[1][2]];
  const views = VIEWS[type] || [["", "All"], ["posted", "Posted"], ["void", "Void"]];
  page(PLURAL[type], SALES.has(type) ? "Sales" : type === "journal" || type === "transfer" ? "Accountant" : "Purchases",
    `<button id="xl">Export to Excel</button><button class="primary" id="newBtn">+ New ${NAME[type].toLowerCase()}</button>`,
    `<div class="tools"><div class="seg" id="vseg">${views.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${k === view}">${l}</button>`).join("")}</div>
      <input type="search" id="q" placeholder="Search number, name, reference" value="${esc(p.q || "")}"><input type="date" id="from" value="${esc(p.from || "")}" aria-label="From"><input type="date" id="to" value="${esc(p.to || "")}" aria-label="To"><span class="cnt" id="cnt"></span></div>
    <div class="panel listpanel"><div class="tblwrap"><table class="list"><thead><tr>${cols.map(c => `<th class="${c[2] || ""}">${c[0]}</th>`).join("")}</tr></thead><tbody id="rows"></tbody><tfoot id="foot"></tfoot></table><div class="empty" id="empty" hidden></div></div></div>`, ROUTE_OF[type]);
  const draw = () => {
    const q = $("q").value.trim().toLowerCase(), from = $("from").value, to = $("to").value;
    const vis = rows.filter(d => match(d) && (!from || d.date >= from) && (!to || d.date <= to) && (!q || [d.number, d.contactName, d.ref, d.title, String(d.total), String(d.amount)].join(" ").toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
    $("rows").innerHTML = vis.map(d => `<tr data-id="${d.id}" class="${d.status === "void" || d.status === "cancelled" ? "void" : ""}">${cols.map(c => `<td class="${c[2] || ""}">${c[1](d)}</td>`).join("")}</tr>`).join("");
    const live = vis.filter(d => d.status !== "void" && d.status !== "cancelled");
    const tot = live.reduce((a, d) => a + (d.type === "receipt" || d.type === "payment" || d.type === "transfer" ? d.amount : d.total), 0), bal = live.reduce((a, d) => a + (d.balance || 0), 0);
    $("foot").innerHTML = vis.length ? `<tr>${cols.map((c, i) => `<td class="${c[2] || ""}">${i === 0 ? `${vis.length} shown` : c[0] === "Balance" || c[0] === "Unapplied" ? aed(bal) : ["Amount", "Total"].includes(c[0]) ? aed(tot) : ""}</td>`).join("")}</tr>` : "";
    $("empty").hidden = !!vis.length; $("empty").innerHTML = rows.length ? "Nothing matches these filters." : `<strong>No ${PLURAL[type].toLowerCase()} yet</strong>Use + New to create the first one.`;
    $("cnt").textContent = `${vis.length} of ${rows.length}`;
    $("rows").querySelectorAll("tr").forEach(tr => tr.onclick = () => go("#/doc/" + tr.dataset.id));
    $("xl").onclick = () => exportSheets(`${D.company.name} ${PLURAL[type]}`, [[PLURAL[type], [cols.map(c => c[0])].concat(vis.map(d => cols.map(c => { const v = c[1](d); const tmp = document.createElement("div"); tmp.innerHTML = v; const t2 = tmp.textContent; return c[2] && c[2].includes("mono") ? num(t2.replace(/,/g, "")) : t2; })))]]).catch(e => toast(e.message, 1));
  };
  ["q", "from", "to"].forEach(id => $(id).oninput = draw);
  $("vseg").querySelectorAll("button").forEach(b => b.onclick = () => { const pp = new URLSearchParams(params()); if (b.dataset.v) pp.set("view", b.dataset.v); else pp.delete("view"); go(`#/${ROUTE_OF[type]}${pp.toString() ? "?" + pp : ""}`); });
  $("newBtn").onclick = () => go("#/new/" + type);
  draw();
}

/* ---------- customers / suppliers with balances ---------- */
function contactBalances(kind) {
  const m = new Map();
  const get = id => { if (!m.has(id)) m.set(id, { due: 0, overdue: 0, credits: 0, docs: 0, sales: 0 }); return m.get(id); };
  D.docs.forEach(d => {
    if (d.status !== "posted" || !d.contactId) return;
    if (kind === "customer" && !SALES.has(d.type)) return;
    if (kind === "vendor" && SALES.has(d.type)) return;
    const x = get(d.contactId); x.docs++;
    if (d.type === "invoice" || d.type === "bill") { x.due += d.balance; if (d.view === "overdue") x.overdue += d.balance; x.sales += d.subtotal; }
    if (["receipt", "creditnote", "payment", "vendorcredit"].includes(d.type)) x.credits += d.balance;
    if (d.type === "creditnote" || d.type === "vendorcredit") x.sales -= d.subtotal;
  });
  return m;
}
function contactsView(kind) {
  const list = kind === "customer" ? D.customers : D.vendors;
  const bal = contactBalances(kind);
  page(kind === "customer" ? "Customers" : "Suppliers", kind === "customer" ? "Sales" : "Purchases",
    `<a class="btn" href="${kind === "customer" ? "/customers/" : "/suppliers/"}">Manage the full list</a><button class="primary" id="add">+ New ${kind === "customer" ? "customer" : "supplier"}</button>`,
    `<div class="tools"><input type="search" id="q" placeholder="Search name or TRN"><label class="chk"><input type="checkbox" id="only"> Only with a balance</label><span class="cnt" id="cnt"></span></div>
    <div class="panel listpanel"><div class="tblwrap"><table class="list"><thead><tr><th>Name</th><th>TRN</th><th>Emirate</th><th class="r">${kind === "customer" ? "Receivable" : "Payable"}</th><th class="r">Overdue</th><th class="r">Unused credits</th><th class="r">${kind === "customer" ? "Net sales" : "Net purchases"}</th></tr></thead><tbody id="rows"></tbody><tfoot id="foot"></tfoot></table></div></div>`, kind === "customer" ? "customers" : "vendors");
  const draw = () => {
    const q = $("q").value.toLowerCase(), only = $("only").checked;
    const vis = list.filter(c => (!q || (c.name + " " + c.trn).toLowerCase().includes(q)) && (!only || (bal.get(c.id) || {}).due > 0.004));
    const z = { due: 0, overdue: 0, credits: 0, sales: 0 };
    $("rows").innerHTML = vis.map(c => { const b = bal.get(c.id) || { due: 0, overdue: 0, credits: 0, sales: 0 }; Object.keys(z).forEach(k => z[k] += b[k]);
      return `<tr data-id="${c.id}"><td><span class="t">${esc(c.name)}</span></td><td class="mono">${esc(c.trn) || `<span class="muted">none</span>`}</td><td>${esc(c.emirate)}</td><td class="r mono">${aed(b.due)}</td><td class="r mono ${b.overdue ? "neg" : ""}">${aed(b.overdue)}</td><td class="r mono">${aed(b.credits)}</td><td class="r mono">${aed(b.sales)}</td></tr>`; }).join("");
    $("foot").innerHTML = `<tr><td>${vis.length}</td><td></td><td></td><td class="r mono">${aed(z.due)}</td><td class="r mono">${aed(z.overdue)}</td><td class="r mono">${aed(z.credits)}</td><td class="r mono">${aed(z.sales)}</td></tr>`;
    $("cnt").textContent = `${vis.length} of ${list.length}`;
    $("rows").querySelectorAll("tr").forEach(tr => tr.onclick = () => go(`#/contact/${kind}/${tr.dataset.id}`));
  };
  $("q").oninput = draw; $("only").onchange = draw;
  $("add").onclick = async () => { const c = await quickContact(kind); if (c) go(`#/contact/${kind}/${c.id}`); };
  draw();
}
// Statement lines for a customer or supplier: invoices/bills raise the balance; receipts, payments and credits lower it.
function statement(kind, id, from, to) {
  const rows = D.docs.filter(d => d.status === "posted" && d.contactId === id && (kind === "customer" ? SALES.has(d.type) : !SALES.has(d.type)) && ["invoice", "creditnote", "receipt", "bill", "vendorcredit", "payment"].includes(d.type));
  const amt = d => ["invoice", "bill"].includes(d.type) ? d.total : -(d.type === "receipt" || d.type === "payment" ? d.amount : d.total);
  const opening = r2(rows.filter(d => from && d.date < from).reduce((a, d) => a + amt(d), 0));
  let run = opening;
  const lines = rows.filter(d => (!from || d.date >= from) && (!to || d.date <= to)).sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))
    .map(d => { run = r2(run + amt(d)); return { d, debit: amt(d) > 0 ? amt(d) : 0, credit: amt(d) < 0 ? -amt(d) : 0, bal: run }; });
  return { opening, lines, closing: run };
}
BK.statement = statement;
function contactView(kind, id) {
  const c = (kind === "customer" ? CUS : VEN).get(id); if (!c) return go(kind === "customer" ? "#/customers" : "#/vendors");
  const p = params(); const t = today(); const from = p.from || addDays(t, -90).slice(0, 8) + "01", to = p.to || t;
  const s = statement(kind, id, from, to);
  const open = D.docs.filter(d => d.contactId === id && (d.type === (kind === "customer" ? "invoice" : "bill")) && d.status === "posted" && d.balance > 0.004);
  const aging = [0, 0, 0, 0, 0]; open.forEach(d => { const late = daysBetween(d.dueDate, t); aging[late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4] += d.balance; });
  const lbl = { invoice: "Invoice", creditnote: "Credit note", receipt: "Payment", bill: "Bill", vendorcredit: "Vendor credit", payment: "Payment" };
  page(c.name, kind === "customer" ? "Customer" : "Supplier",
    `<button id="pdf">Statement PDF</button><button id="prev">Preview</button>${kind === "customer" ? `<button data-new="quote">+ Quotation</button><button data-new="receipt">Receive payment</button><button class="primary" data-new="invoice">+ Invoice</button>` : `<button data-new="po">+ PO</button><button data-new="payment">Pay</button><button class="primary" data-new="bill">+ Bill</button>`}`,
    `<section class="kpis">${["Current", "1 to 30 days", "31 to 60 days", "61 to 90 days", "Over 90 days"].map((k, i) => `<div class="kpi" style="--c:${i ? "var(--bad)" : "var(--good)"}"><div class="k">${k}</div><div class="v"><small>AED</small>${aed(aging[i])}</div></div>`).join("")}</section>
    <div class="grid2" style="grid-template-columns:minmax(0,2fr) minmax(260px,1fr)">
    <section class="card"><header><h2>Statement of account<span>${fd(from)} to ${fd(to)}</span></h2><div class="periodbar"><input type="date" id="f" value="${from}"><input type="date" id="t" value="${to}"></div></header>
    <div class="tblwrap"><table class="list compact"><thead><tr><th>Date</th><th>Transaction</th><th>Details</th><th class="r">${kind === "customer" ? "Invoiced" : "Billed"}</th><th class="r">${kind === "customer" ? "Received / credited" : "Paid / credited"}</th><th class="r">Balance</th></tr></thead>
    <tbody><tr class="nohover"><td>${fd(from)}</td><td colspan="4"><b>Opening balance</b></td><td class="r mono">${aed(s.opening)}</td></tr>${s.lines.map(l => `<tr data-id="${l.d.id}"><td>${fd(l.d.date)}</td><td>${lbl[l.d.type]} <b>${esc(l.d.number)}</b></td><td class="muted">${esc(l.d.ref || (l.d.dueDate && ["invoice", "bill"].includes(l.d.type) ? "due " + fd(l.d.dueDate) : ""))}</td><td class="r mono">${l.debit ? aed(l.debit) : ""}</td><td class="r mono">${l.credit ? aed(l.credit) : ""}</td><td class="r mono">${aed(l.bal)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td></td><td colspan="4">Balance due ${fd(to)}</td><td class="r mono">${aed(s.closing)}</td></tr></tfoot></table></div></section>
    <section class="card"><header><h2>Details</h2><a href="${kind === "customer" ? "/customers/?q=" + encodeURIComponent(c.name) : "/suppliers/#s=" + encodeURIComponent(c.id)}">Edit →</a></header><div class="bd kv" style="grid-template-columns:auto 1fr">
      <span>TRN</span><div>${esc(c.trn) ? esc(c.trn) + (/^\d{15}$/.test(c.trn) ? "" : ` <span class="neg">(not 15 digits)</span>`) : `<span class="neg">Not recorded</span>`}</div><span>Emirate</span><div>${esc(c.emirate || "")}</div>${kind === "vendor" ? `<span>Country</span><div>${esc(c.country)}</div>` : ""}<span>Address</span><div>${esc(c.address || "")}</div><span>Email</span><div>${esc(c.email || "")}</div><span>Phone</span><div>${esc(c.phone || "")}</div></div></section>
    ${kind === "vendor" ? verifyCard(c) : ""}</div>`, kind === "customer" ? "customers" : "vendors");
  if (kind === "vendor") wireVerify(c);
  const re = () => go(`#/contact/${kind}/${id}?from=${$("f").value}&to=${$("t").value}`);
  $("f").onchange = re; $("t").onchange = re;
  $("app").querySelectorAll("tbody tr[data-id]").forEach(tr => tr.onclick = () => go("#/doc/" + tr.dataset.id));
  $("app").querySelectorAll("[data-new]").forEach(b => b.onclick = () => go(`#/new/${b.dataset.new}?contact=${id}`));
  const build = () => BKPDF.statement({ kind, contact: c, from, to, st: s, aging });
  $("pdf").onclick = () => build().then(b => saveBlob(b, `Statement ${c.name} ${to}.pdf`)).catch(e => toast(e.message, 1));
  $("prev").onclick = () => window.BXPdf.preview(build, `Statement ${c.name} ${to}.pdf`);
}
// Supplier verification before claiming input VAT (FTA Decision No. 13 of 2026, from 1 Oct 2026).
const VCHK = [["trn", "TRN checked on the FTA TRN verification service and matches the tax invoice"], ["licence", "Trade licence seen and valid; legal name matches"], ["address", "Business address / premises confirmed"], ["bank", "Payment goes to a bank account in the supplier's own name"], ["activity", "The supplier's licensed activity fits what they sell us"]];
function verifyCard(c) {
  const v = (D.vver || {})[c.id] || { checks: {} };
  return `<section class="card" style="grid-column:1/-1"><header><h2>VAT supplier verification<span>FTA Decision No. 13 of 2026</span></h2>${supplierVerified(c.id) ? st("posted") : `<span class="st partial">Not verified</span>`}</header><div class="bd" style="display:grid;gap:8px">
    <p class="hint" style="margin:0">From 1 Oct 2026, input VAT can be denied where the supply chain involves tax evasion and the supplier and supply weren't verified before the VAT was claimed. Record the checks here; they're kept with your books.</p>
    ${VCHK.map(([k, l]) => `<label class="chk"><input type="checkbox" data-vk="${k}"${v.checks[k] ? " checked" : ""}> ${esc(l)}</label>`).join("")}
    <div class="fields"><label><span class="lbl">Date checked</span><input type="date" id="vdate" value="${esc(v.date || today())}"></label><label style="grid-column:span 2"><span class="lbl">Notes / evidence location</span><input id="vnote" maxlength="1000" value="${esc(v.note || "")}" placeholder="e.g. licence copy in SharePoint › Suppliers"></label></div>
    ${v.by ? `<div class="hint">Last recorded by ${esc(v.by)} on ${fd(v.date)}</div>` : ""}<div class="err" id="verr"></div><div><button class="primary" type="button" id="vsave">Save verification</button></div></div></section>`;
}
function wireVerify(c) {
  $("vsave").onclick = async e => { const b = e.target; busy(b, true); $("verr").textContent = "";
    const checks = {}; document.querySelectorAll("[data-vk]").forEach(i => checks[i.dataset.vk] = i.checked);
    try { await api("PUT", `vendors/${c.id}/verify`, { checks, date: $("vdate").value, note: $("vnote").value }); await load(); toast("Verification saved."); contactView("vendor", c.id); } catch (err) { $("verr").textContent = err.message; busy(b, false); } };
}
/* ---------- attachments ---------- */
const CLIP = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/></svg>';
const clipCount = d => d.fileCount ? ` <span class="clip" title="${d.fileCount} attachment${d.fileCount === 1 ? "" : "s"}">${CLIP}${d.fileCount}</span>` : "";
const DEF_KIND = { quote: "other", invoice: "po", creditnote: "other", receipt: "payment", po: "quote", bill: "invoice", vendorcredit: "invoice", payment: "payment", expense: "receipt", journal: "other", transfer: "payment" };
const FILE_MAX = 10 * 1048576;
const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
function readB64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(new Error(`Couldn't read ${file.name}.`)); r.readAsDataURL(file); }); }
async function uploadFiles(id, files, kind) {
  let ok = 0; const errs = [];
  for (const f of files) {
    if (f.size > FILE_MAX) { errs.push(`${f.name} is larger than 10 MB`); continue; }
    try { await api("POST", `docs/${id}/files`, { name: f.name, type: f.type || "application/octet-stream", kind: f.kind || kind, data: await readB64(f) }); ok++; }
    catch (e) { errs.push(`${f.name}: ${e.message}`); }
  }
  if (errs.length) toast(errs.join(" · "), 1); else if (ok) toast(`${ok} file${ok === 1 ? "" : "s"} attached.`);
  return ok;
}
const fileUrl = (id, f, dl) => `/api/books/docs/${id}/files/${f.id}${dl ? "/download" : ""}`;
function attachCard(d) {
  const files = d.files || [];
  const kinds = D.fileKinds || {};
  return `<section class="card" id="attCard"><header><h2>Attachments<span>${files.length}</span></h2><label class="btn" style="padding:4px 10px;font-size:12px;cursor:pointer">+ Upload<input type="file" id="attIn" multiple hidden></label></header>
    <div class="drop" id="attDrop">Drop files here (PDF, images, Excel, Word; up to 10 MB each)</div>
    ${files.map(f => `<div class="att" data-f="${f.id}"><button type="button" class="an" data-open title="Open">${esc(f.name)}</button><select data-kind aria-label="File type">${Object.entries(kinds).map(([k, l]) => `<option value="${k}"${k === f.kind ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <span class="am">${kb(f.size)} · ${esc(String(f.by).split("@")[0])} · ${fd(f.at)}</span><span class="aa"><a class="btn" href="${fileUrl(d.id, f, 1)}" title="Download">Download</a><button type="button" class="x" data-rm title="Remove">×</button></span></div>`).join("") || `<div class="bd muted" style="font-size:12px">No files yet. Attach the customer's PO, supplier's tax invoice, receipts, delivery notes or photos.</div>`}</section>`;
}
function wireAttach(d, reload) {
  const kind = DEF_KIND[d.type] || "other";
  const go2 = async files => { if (!files.length) return; toast(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`); if (await uploadFiles(d.id, [...files], kind)) reload(); };
  $("attIn").onchange = e => go2(e.target.files);
  const z = $("attDrop");
  ["dragenter", "dragover"].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add("on"); }));
  ["dragleave", "drop"].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove("on"); }));
  z.addEventListener("drop", e => go2(e.dataTransfer.files));
  $("attCard").querySelectorAll(".att").forEach(row => {
    const f = (d.files || []).find(x => x.id === row.dataset.f);
    row.querySelector("[data-open]").onclick = () => {
      if (/pdf$/.test(f.type)) window.BXPdf.preview(() => fetch(fileUrl(d.id, f)).then(r => { if (!r.ok) throw new Error("Couldn't open the file."); return r.blob(); }), f.name);
      else if (/^image\//.test(f.type)) window.open(fileUrl(d.id, f), "_blank", "noopener");
      else location.href = fileUrl(d.id, f, 1);
    };
    row.querySelector("[data-kind]").onchange = async e => { try { await api("PUT", `docs/${d.id}/files/${f.id}`, { kind: e.target.value }); toast("Saved."); } catch (err) { toast(err.message, 1); } };
    row.querySelector("[data-rm]").onclick = async () => { if (!await ask(`Remove ${f.name}?`, "The file is deleted from this document.", { okText: "Remove", danger: true })) return; try { await api("DELETE", `docs/${d.id}/files/${f.id}`); reload(); } catch (err) { toast(err.message, 1); } };
  });
}
// Files picked in an editor are uploaded once the document is saved.
function editorFiles(d) {
  const has = (d.files || []).length;
  return `<section class="panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b>Attachments</b><label class="btn" style="cursor:pointer">+ Add files<input type="file" id="edFiles" multiple hidden></label></div>
    <div class="drop" id="edDrop">Drop files here, or use Add files. They're attached when you save.${has ? ` This document already has ${has} file${has === 1 ? "" : "s"}; manage them on the document page.` : ""}</div><div id="edList" class="hint"></div></section>`;
}
function wireEditorFiles(queue) {
  const show = () => { $("edList").innerHTML = queue.map((f, i) => `<span class="chipf">${CLIP} ${esc(f.name)} <small>${kb(f.size)}</small> <button type="button" class="x" data-i="${i}" aria-label="Remove">×</button></span>`).join(" "); $("edList").querySelectorAll("[data-i]").forEach(b => b.onclick = () => { queue.splice(Number(b.dataset.i), 1); show(); }); };
  const add = fl => { [...fl].forEach(f => { if (f.size > FILE_MAX) toast(`${f.name} is larger than 10 MB.`, 1); else queue.push(f); }); show(); };
  $("edFiles").onchange = e => { add(e.target.files); e.target.value = ""; };
  const z = $("edDrop");
  ["dragenter", "dragover"].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add("on"); }));
  ["dragleave", "drop"].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove("on"); }));
  z.addEventListener("drop", e => add(e.dataTransfer.files));
}
async function afterSave(r, queue, type) { if (queue.length) await uploadFiles(r.id, queue, DEF_KIND[type] || "other"); }
function saveBlob(blob, name) { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); }
BK.saveBlob = saveBlob;

/* ---------- document view ---------- */
async function docView(id) {
  nav(ROUTE_OF[(DOCS.get(id) || {}).type]);
  $("app").innerHTML = `<div class="empty">Opening…</div>`;
  let d; try { d = await api("GET", "docs/" + id); } catch (e) { $("app").innerHTML = `<div class="empty"><strong>Can't open this document</strong>${esc(e.message)}</div>`; return; }
  const P = D.perms, tp = d.type, posted = d.status === "posted";
  const A = []; // [label, action, primary?, danger?]
  const canEdit = (tp === "quote" || tp === "po") ? !["converted", "cancelled"].includes(d.status) : d.status === "draft" || (posted && ["bill", "receipt", "payment", "expense", "journal", "transfer"].includes(tp));
  if (d.status === "draft" && ["invoice", "creditnote", "bill"].includes(tp)) A.push([tp === "bill" ? "Post bill" : "Issue " + docTitle(d).toLowerCase(), "issue", true]);
  if (tp === "invoice" && posted && d.balance > 0.004) A.push(["Record payment", "pay", true]);
  if (tp === "bill" && posted && d.balance > 0.004) A.push(["Pay bill", "pay", true]);
  if ((tp === "quote") && P.acct && ["draft", "sent", "accepted"].includes(d.status)) A.push(["Convert to invoice", "convert", true]);
  if (tp === "po" && ["draft", "sent", "accepted"].includes(d.status)) A.push(["Convert to bill", "convert", true]);
  if (["creditnote", "vendorcredit", "receipt", "payment"].includes(tp) && posted && d.balance > 0.004) A.push(["Apply to " + (SALES.has(tp) ? "invoices" : "bills"), "apply", true]);
  if (canEdit) A.push(["Edit", "edit"]);
  if (["quote", "invoice", "creditnote", "po", "receipt"].includes(tp)) A.push(["Preview PDF", "preview"], ["Download PDF", "pdf"]);
  if (["quote", "invoice", "creditnote", "po"].includes(tp) && d.status !== "draft" || (tp === "quote" || tp === "po")) A.push(["Email", "email"]);
  if (tp === "quote" && ["draft", "sent"].includes(d.status)) A.push(["Mark accepted", "accept"], ["Mark declined", "decline"]);
  if (["quote", "invoice", "po"].includes(tp) && !d.sentAt && d.status !== "draft" && d.status !== "void") A.push(["Mark as sent", "sent"]);
  if (tp === "invoice" && posted) A.push(["Create credit note", "credit"]);
  if (tp === "bill" && posted) A.push(["Record vendor credit", "credit"]);
  if (LINE_TYPES.has(tp)) A.push(["Duplicate", "dup"]);
  if (posted && (P.acct)) A.push(["Void", "void", false, true]);
  if ((tp === "quote" || tp === "po") && ["draft", "sent", "accepted", "declined"].includes(d.status)) A.push(["Cancel", "cancel", false, true]);
  if (d.status === "draft" || ((tp === "quote" || tp === "po") && d.status !== "converted")) A.push(["Delete", "del", false, true]);
  const lines = d.lines || [];
  const B = BK.brand();
  const showVat = vatOn() && !["journal", "transfer"].includes(tp);
  const contactBlock = tp === "journal" || tp === "transfer" ? "" : `<div><h4>${SALES.has(tp) ? "Bill to" : tp === "expense" ? "Paid to" : "Supplier"}</h4><b>${esc(d.contactName || "")}</b><br>${d.attention ? "Attn: " + esc(d.attention) + "<br>" : ""}${esc(d.contactAddress || "")}${d.contactTrn ? `<br>TRN ${esc(d.contactTrn)}` : ""}</div>`;
  const meta = [];
  const M = (k, v) => v && meta.push(`<div><span>${k}</span>${esc(v)}</div>`);
  M("Date", fd(d.date));
  if (tp === "invoice") { M("Date of supply", fd(d.supplyDate)); M("Due date", fd(d.dueDate)); M("Customer PO", d.ref); M("Place of supply", d.placeOfSupply); M("Salesperson", d.salesperson); }
  if (tp === "quote") { M("Valid until", fd(d.dueDate)); M("Reference", d.ref); M("Salesperson", d.salesperson); }
  if (tp === "po") { M("Expected by", fd(d.dueDate)); M("Reference", d.ref); }
  if (tp === "bill") { M("Supplier invoice", d.ref); M("Due date", fd(d.dueDate)); }
  if (tp === "creditnote") { M("Against invoice", d.invoiceNo ? `${d.invoiceNo} of ${fd(d.invoiceDate)}` : ""); M("Reason", d.reason); }
  if (tp === "vendorcredit") { M("Reason", d.reason); M("Supplier ref", d.ref); }
  if (tp === "expense") { M("Receipt no.", d.ref); M("Paid from", acctName(d.account)); }
  if (tp === "receipt" || tp === "payment") { M(tp === "receipt" ? "Received into" : "Paid from", acctName(d.account)); M("Method", d.method); M("Cheque no.", d.chequeNo); M("Cheque date", fd(d.chequeDate)); M("Bank reference", d.bankRef); }
  if (tp === "transfer") { M("From", acctName(d.account)); M("To", acctName(d.toAccount)); }
  let body = "";
  if (LINE_TYPES.has(tp)) {
    body = `<table><thead><tr><th>#</th><th>Item and description</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th>${lines.some(l => l.discPct) ? `<th style="text-align:right">Disc.</th>` : ""}<th style="text-align:right">Taxable</th>${showVat ? `<th>VAT</th><th style="text-align:right">VAT AED</th>` : ""}<th style="text-align:right">Amount</th></tr></thead><tbody>
      ${lines.map((l, i) => `<tr><td>${i + 1}</td><td><b>${esc(l.name)}</b>${l.description ? `<div class="ds">${esc(l.description)}</div>` : ""}${!SALES.has(tp) ? `<div class="ds">${esc(acctName(l.account))}${l.blocked ? " · VAT not recoverable" : ""}</div>` : ""}</td><td style="text-align:right">${l.qty} ${esc(l.unit || "")}</td><td style="text-align:right">${aed(l.rate)}</td>${lines.some(x => x.discPct) ? `<td style="text-align:right">${l.discPct ? l.discPct + "%" : ""}</td>` : ""}<td style="text-align:right">${aed(l.net)}</td>${showVat ? `<td>${l.vat === "DR" ? "Reverse charge" : esc(l.vat) + " " + (D.vat[l.vat] ? D.vat[l.vat].rate + "%" : "")}</td><td style="text-align:right">${aed(l.vatAmt)}</td>` : ""}<td style="text-align:right">${aed(l.net + (["RC", "IM", "DR"].includes(l.vat) ? 0 : l.vatAmt))}</td></tr>`).join("")}</tbody></table>
      <div class="pt"><span>Total excluding VAT</span><span class="n">${aed(d.subtotal)}</span>${showVat ? `<span>VAT 5%</span><span class="n">${aed(d.vatAmt)}</span>` : ""}<span class="big">Total AED</span><span class="n big">${aed(d.total)}</span>
      ${["invoice", "bill"].includes(tp) && posted ? `<span>Paid / credited</span><span class="n">${aed(d.paid)}</span><span class="big">Balance due</span><span class="n big">${aed(d.balance)}</span>` : ""}</div>
      <div class="words">${esc(BKPDF.words(d.total))}</div>${d.vatNote ? `<div class="pn">${esc(d.vatNote)}</div>` : ""}
      ${tp === "creditnote" && d.invoiceNo ? `<table style="margin-top:14px;min-width:0;max-width:520px"><tbody><tr><td>Value of supply on tax invoice ${esc(d.invoiceNo)}${(d.earlierCredits || []).length ? " (after " + esc(d.earlierCredits.join(", ")) + ")" : ""}</td><td style="text-align:right">${aed(d.origValue)}</td></tr><tr><td>Corrected value of supply</td><td style="text-align:right">${aed(d.newValue)}</td></tr><tr><td><b>Difference</b></td><td style="text-align:right"><b>${aed(d.subtotal)}</b></td></tr><tr><td><b>VAT on the difference</b></td><td style="text-align:right"><b>${aed(d.vatAmt)}</b></td></tr></tbody></table>` : ""}${d.cashBlocked ? `<div class="note warn" style="margin-top:10px">Paid in cash above the AED ${aed(D.settings.cashVatThreshold, 0)} threshold, so the VAT is not recoverable (Art. 54(3)) and is included in the cost.</div>` : ""}`;
  } else if (tp === "journal") {
    body = `<table><thead><tr><th>Account</th><th>Contact</th><th>Memo</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th></tr></thead><tbody>${(d.jlines || []).map(l => `<tr><td>${esc(acctName(l.account))}</td><td>${esc(l.contactName || contactName(l.contactId))}</td><td>${esc(l.memo)}</td><td style="text-align:right">${l.debit ? aed(l.debit) : ""}</td><td style="text-align:right">${l.credit ? aed(l.credit) : ""}</td></tr>`).join("")}</tbody></table><div class="pt"><span class="big">Total</span><span class="n big">${aed(d.total)}</span></div>`;
  } else {
    body = `<div class="pt" style="justify-content:start"><span class="big">Amount AED</span><span class="n big">${aed(d.amount)}</span></div><div class="words" style="text-align:left">${esc(BKPDF.words(d.amount))}</div>`;
    if (d.applied && d.applied.length) body += `<h4 style="margin:18px 0 6px">Applied to</h4><table><thead><tr><th>Document</th><th>Date</th><th style="text-align:right">Document total</th><th style="text-align:right">Applied</th></tr></thead><tbody>${d.applied.map(a => `<tr><td><a href="#/doc/${a.id}">${esc(a.number)}</a></td><td>${fd(a.date)}</td><td style="text-align:right">${aed(a.total)}</td><td style="text-align:right">${aed(a.amt)}</td></tr>`).join("")}</tbody></table>`;
  }
  if (["creditnote", "vendorcredit"].includes(tp) && d.applied && d.applied.length) body += `<h4 style="margin:18px 0 6px">Applied to</h4><table><tbody>${d.applied.map(a => `<tr><td><a href="#/doc/${a.id}">${esc(a.number)}</a></td><td>${fd(a.date)}</td><td style="text-align:right">${aed(a.amt)}</td></tr>`).join("")}</tbody></table>`;
  if (tp === "receipt" && posted && d.balance > 0.004 && vatOn()) body += `<div class="note warn" style="margin-top:14px"><b>Advance payment: VAT may be due now</b>AED ${aed(d.balance)} isn't applied to an invoice. If it is an advance for a taxable supply, the date of supply is the date it was received: issue a tax invoice for it within 14 days and report the VAT in this period. A fully refundable security deposit is different and isn't taxed on receipt.</div>`;
  if (["bill", "expense"].includes(tp) && posted && vatOn() && d.contactId && BK.domesticInput(d) && !supplierVerified(d.contactId)) body += `<div class="note warn" style="margin-top:14px"><b>Supplier not verified yet</b>From 1 Oct 2026 input VAT may be denied unless the supplier and the supply were verified before the VAT is claimed (FTA Decision No. 13 of 2026). <a href="#/contact/vendor/${esc(d.contactId)}">Record the verification</a>.</div>`;
  const glRows = d.gl || [];
  const showPaper = `<article class="paper" style="--brand:${B.key === "techhub" ? "#003C50" : "#1E5A8C"}">
    <div class="ph"><img src="${esc(B.logo || "/assets/bifold_logo.png")}" alt=""><div><h2>${esc(docTitle(d).toUpperCase())}</h2><div class="no"><b>${esc(d.number || "DRAFT")}</b>${d.status === "void" ? `<br><span class="stamp">VOID</span>` : d.status === "draft" ? `<br><span class="stamp" style="border-color:var(--muted);color:var(--muted)">DRAFT</span>` : ""}</div></div></div>
    <div class="pp"><div><h4>From</h4><b>${esc(D.settings.legalName)}</b><br>${esc(D.settings.address)}${vatOn() && D.settings.trn ? `<br>TRN ${esc(D.settings.trn)}` : ""}</div>${contactBlock}</div>
    <div class="meta">${meta.join("")}</div>${body}${d.notes ? `<div class="pn"><b>Notes</b>\n${esc(d.notes)}</div>` : ""}${d.terms ? `<div class="pn"><b>Terms</b>\n${esc(d.terms)}</div>` : ""}${d.voidReason ? `<div class="note bad" style="margin-top:12px"><b>${d.status === "cancelled" ? "Cancelled" : "Voided"}</b>${esc(d.voidReason)}</div>` : ""}</article>`;
  const linked = [];
  if (d.fromId && DOCS.get(d.fromId)) linked.push(`<a class="mi" href="#/doc/${d.fromId}"><span><b>Created from</b><div class="t">${esc(label(DOCS.get(d.fromId)))}</div></span></a>`);
  if (d.toId && DOCS.get(d.toId)) linked.push(`<a class="mi" href="#/doc/${d.toId}"><span><b>Converted to</b><div class="t">${esc(label(DOCS.get(d.toId)))}</div></span></a>`);
  if (d.source) linked.push(`<a class="mi" href="#/doc/${d.source.id}"><span><b>Against</b><div class="t">${esc(d.source.number)}</div></span></a>`);
  (d.payments || []).forEach(x => linked.push(`<a class="mi" href="#/doc/${x.id}"><span><b>${esc(NAME[x.type])} ${esc(x.number)}</b><div class="t">${fd(x.date)}</div></span><span class="amt">${aed(x.amt)}</span></a>`));
  page(`${docTitle(d)} ${d.number || ""}`.trim(), `${PLURAL[tp]} · ${d.contactName || ""}`, `<a class="btn" href="#/${ROUTE_OF[tp]}">← ${PLURAL[tp]}</a>`,
    `<div class="dv">${showPaper}<aside class="side">
      <section class="card"><header><h2>${st(d.view)}</h2><span class="muted" style="font-size:12px">${d.sentAt ? "Sent " + fd(d.sentAt) : ""}</span></header><div class="bd acts2">${A.map(([l, k, p, x]) => `<button type="button" data-a="${k}" class="${p ? "primary" : x ? "danger" : ""}">${esc(l)}</button>`).join("")}</div></section>
      ${attachCard(d)}
      ${["invoice", "bill", "creditnote", "vendorcredit", "receipt", "payment"].includes(tp) && posted ? `<section class="card"><header><h2>Balance</h2></header><div class="bd kv"><span>Total</span><b>${aed(d.total || d.amount)}</b><span>${["invoice", "bill"].includes(tp) ? "Paid / credited" : "Applied"}</span><b>${aed(["invoice", "bill"].includes(tp) ? d.paid : (d.total || d.amount) - d.balance)}</b><span>${["invoice", "bill"].includes(tp) ? "Balance due" : "Unapplied"}</span><b>${aed(d.balance)}</b></div></section>` : ""}
      ${linked.length ? `<section class="card"><header><h2>Linked</h2></header>${linked.join("")}</section>` : ""}
      ${P.acct && glRows.length ? `<section class="card"><header><h2>Journal entry</h2></header><div class="tblwrap"><table class="list compact nohover gltbl"><thead><tr><th>Account</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead><tbody>${glRows.map(g => `<tr><td>${esc(acctName(g[0]))}${g[3] ? `<div class="s">${esc(contactName(g[3]))}</div>` : ""}</td><td class="r mono">${g[1] ? aed(g[1]) : ""}</td><td class="r mono">${g[2] ? aed(g[2]) : ""}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      ${P.acct && d.tax && d.tax.length ? `<section class="card"><header><h2>VAT return boxes</h2></header><div class="bd vatgrid">${d.tax.map(x => `<span>Box ${esc(x[0])}</span><span class="n">${aed(x[1])} / VAT ${aed(x[2])}</span>`).join("")}</div></section>` : ""}
      <section class="card"><header><h2>History</h2></header><div class="bd" style="font-size:12px;color:var(--muted)">Created by ${esc(d.createdBy)} on ${fd(d.createdAt)}${d.issuedAt ? `<br>Issued by ${esc(d.issuedBy)} on ${fd(d.issuedAt)}` : ""}<br>Last changed by ${esc(d.updatedBy)} on ${fd(d.updatedAt)}${d.voidedBy ? `<br>Voided by ${esc(d.voidedBy)}` : ""}<br><span>Every change is in the Activity log.</span></div></section>
    </aside></div>`, ROUTE_OF[tp]);
  wireAttach(d, async () => { await load(); docView(id); });
  const pdfName = `${docTitle(d)} ${d.number || "draft"} ${d.contactName || ""}.pdf`;
  const build = () => BKPDF.doc(d);
  const act = {
    issue: async () => { if (!await ask(`${tp === "bill" ? "Post" : "Issue"} ${docTitle(d).toLowerCase()}?`, tp === "bill" ? "The bill will be posted to the ledger." : `It gets the next ${docTitle(d).toLowerCase()} number and can't be edited afterwards. Corrections are made with a credit note. Tax invoices are due within 14 days of the date of supply.`, { okText: tp === "bill" ? "Post" : "Issue" })) return;
      await api("PUT", "docs/" + id, { ...d, lines: d.lines, status: "posted" }); },
    pay: () => { go(`#/new/${tp === "invoice" ? "receipt" : "payment"}?contact=${d.contactId}&apply=${id}`); return "nav"; },
    convert: async () => { const r = await api("POST", `docs/${id}/convert`, {}); sessionStorage.setItem("bk-draft", JSON.stringify(r.draft)); go(`#/new/${r.draft.type}?draft=1`); return "nav"; },
    credit: async () => { const r = await api("POST", `docs/${id}/convert`, {}); sessionStorage.setItem("bk-draft", JSON.stringify(r.draft)); go(`#/new/${r.draft.type}?draft=1`); return "nav"; },
    apply: async () => { await applyDialog(d); return "stay"; },
    edit: () => { go("#/edit/" + id); return "nav"; },
    dup: () => { const x = { type: tp, contactId: d.contactId, lines: d.lines, notes: d.notes, terms: d.terms, ref: "", emirate: d.emirate, account: d.account, payee: d.contactName }; sessionStorage.setItem("bk-draft", JSON.stringify(x)); go(`#/new/${tp}?draft=1`); return "nav"; },
    preview: () => { window.BXPdf.preview(build, pdfName); return "stay"; },
    pdf: async () => { saveBlob(await build(), pdfName); return "stay"; },
    email: async () => { saveBlob(await build(), pdfName); const to = d.contactEmail || ""; const subj = `${docTitle(d)} ${d.number || ""} from ${D.settings.legalName}`; const bodyTxt = `Dear ${d.attention || d.contactName},\n\nPlease find attached ${docTitle(d).toLowerCase()} ${d.number || ""} for AED ${aed(d.total || d.amount)}${tp === "invoice" ? `, due on ${fd(d.dueDate)}` : tp === "quote" ? `, valid until ${fd(d.dueDate)}` : ""}.\n\nThe PDF has been downloaded; please attach it to this email.\n\nKind regards,\n${D.settings.legalName}`; location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(bodyTxt)}`; if (!d.sentAt && d.status !== "draft") await api("POST", `docs/${id}/sent`, {}); toast("PDF downloaded. Attach it to the email that just opened."); },
    sent: () => api("POST", `docs/${id}/sent`, {}),
    accept: () => api("PUT", "docs/" + id, { ...d, status: "accepted" }),
    decline: () => api("PUT", "docs/" + id, { ...d, status: "declined" }),
    void: async () => { const r = await ask(`Void ${label(d)}?`, "The entry is reversed and the document is kept, marked void, with your reason. This can't be undone.", { input: true, okText: "Void", danger: true, placeholder: "Reason, e.g. issued to the wrong customer" }); if (!r) return "stay"; return api("POST", `docs/${id}/void`, { reason: r }); },
    cancel: async () => { const r = await ask(`Cancel ${label(d)}?`, "It stays on file, marked cancelled.", { input: true, okText: "Cancel it", danger: true, placeholder: "Reason" }); if (!r) return "stay"; return api("POST", `docs/${id}/void`, { reason: r }); },
    del: async () => { if (!await ask(`Delete ${label(d)}?`, "This removes it completely.", { okText: "Delete", danger: true })) return "stay"; await api("DELETE", "docs/" + id); await load(); go("#/" + ROUTE_OF[tp]); return "nav"; },
  };
  $("app").querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
    busy(b, true);
    try { const r = await act[b.dataset.a](); if (r !== "nav" && r !== "stay") { await load(); docView(id); } }
    catch (e) { toast(e.message, 1); }
    finally { busy(b, false); }
  });
}
async function applyDialog(d) {
  const target = SALES.has(d.type) ? "invoice" : "bill";
  const open = D.docs.filter(x => x.type === target && x.status === "posted" && x.contactId === d.contactId && (x.balance > 0.004 || (d.applied || []).some(a => a.id === x.id)));
  const cur = new Map((d.applied || []).map(a => [a.id, a.amt]));
  const cap = d.type === "receipt" || d.type === "payment" ? d.amount : d.total;
  const r = await dialog(`<form><h3>Apply ${esc(label(d))}</h3><p class="hint" style="margin:0">AED ${aed(cap)} available. Enter how much goes to each ${target}.</p>
    <div class="tblwrap"><table class="list compact nohover"><thead><tr><th>${target === "invoice" ? "Invoice" : "Bill"}</th><th>Date</th><th class="r">Open</th><th class="r">Apply</th></tr></thead><tbody>${open.map(x => `<tr><td>${esc(x.number)}${x.ref ? `<div class="s">${esc(x.ref)}</div>` : ""}</td><td>${fd(x.date)}</td><td class="r mono">${aed(x.balance + (cur.get(x.id) || 0))}</td><td class="r"><input class="num" style="width:120px" data-id="${x.id}" data-max="${r2(x.balance + (cur.get(x.id) || 0))}" value="${cur.get(x.id) || ""}"></td></tr>`).join("") || `<tr><td colspan="4" class="muted">No open ${target}s for this ${target === "invoice" ? "customer" : "supplier"}.</td></tr>`}</tbody></table></div>
    <div class="err"></div><div class="foot"><button type="button" data-x>Cancel</button><button type="button" id="auto">Fill oldest first</button><button class="primary" type="submit">Save</button></div></form>`, { wide: true,
    onOpen: (dl, done) => {
      dl.querySelector("#auto").onclick = () => { let left = cap; dl.querySelectorAll("input[data-id]").forEach(i => { const v = Math.min(left, num(i.dataset.max)); i.value = v > 0 ? r2(v) : ""; left = r2(left - v); }); };
      dl.querySelector("form").onsubmit = async e => { e.preventDefault(); const allocs = [...dl.querySelectorAll("input[data-id]")].map(i => ({ id: i.dataset.id, amt: r2(num(i.value)) })).filter(a => a.amt > 0);
        try { await api("PUT", `docs/${d.id}/apply`, { allocs }); done(true); } catch (err) { dl.querySelector(".err").textContent = err.message; } };
    } });
  if (r) { await load(); docView(d.id); toast("Applied."); }
}

/* ---------- editors ---------- */
function acctOptions(filter, sel) {
  const groups = {};
  D.accounts.filter(a => (a.active || a.code === sel) && filter(a)).forEach(a => (groups[D.acctTypes[a.type][1]] ||= []).push(a));
  return Object.entries(groups).map(([g, l]) => `<optgroup label="${esc(g)}">${l.map(a => `<option value="${a.code}"${a.code === sel ? " selected" : ""}>${esc(a.code + " " + a.name)}</option>`).join("")}</optgroup>`).join("");
}
const isLineAcct = side => a => side === "sales" ? ["income", "other_income"].includes(a.type) : !["receivable", "payable"].includes(a.type) && ![D.sys.VAT_IN, D.sys.VAT_OUT, D.sys.AR, D.sys.AP].includes(a.code);
const isMoneyAcct = a => ["bank", "cash"].includes(a.type) || (a.type === "current_asset" && /pdc/i.test(a.name));
const isPaidFrom = a => ["bank", "cash"].includes(a.type) || (["current_liability", "equity"].includes(a.type) && !Object.values(D.sys).includes(a.code));

async function editor(type, id) {
  let d = null;
  if (id) { try { d = await api("GET", "docs/" + id); } catch (e) { toast(e.message, 1); return go("#/dashboard"); } type = d.type; }
  const p = params();
  if (!d && p.draft) { try { d = JSON.parse(sessionStorage.getItem("bk-draft") || "null"); } catch {} sessionStorage.removeItem("bk-draft"); if (d) { d.type = type; d._fresh = true; } }
  if (!NAME[type]) return go("#/dashboard");
  if (D.perms.quotesOnly && type !== "quote") return go("#/quotes");
  if (!d) d = { type, _fresh: true, contactId: p.contact || "", date: today(), lines: [] };
  if (LINE_TYPES.has(type)) return lineEditor(d);
  if (type === "receipt" || type === "payment") return payEditor(d, p.apply);
  if (type === "journal") return journalEditor(d);
  if (type === "transfer") return transferEditor(d);
}
function headerFor(d, isNew) { const t = d.type; return [`${isNew ? "New" : "Edit"} ${NAME[t].toLowerCase()}`, d.number ? `${PLURAL[t]} · ${d.number}` : PLURAL[t]]; }
function contactPicker(kind, sel, optional) {
  const list = kind === "customer" ? D.customers : D.vendors.filter(v => v.status !== "blocked");
  return `<div class="pick"><select id="contact" ${optional ? "" : "required"}><option value="">${optional ? "No supplier (enter a payee)" : "Choose a " + (kind === "customer" ? "customer" : "supplier")}</option>${list.map(c => `<option value="${c.id}"${c.id === sel ? " selected" : ""}>${esc(c.name)}${c.trn ? " · TRN " + esc(c.trn) : ""}</option>`).join("")}</select><button type="button" id="addC" title="Add a new ${kind === "customer" ? "customer" : "supplier"}">+ New</button></div>`;
}
function wireContact(kind, onChange) {
  $("addC").onclick = async () => { const c = await quickContact(kind); if (!c) return; const sel = $("contact"); const o = document.createElement("option"); o.value = c.id; o.textContent = c.name; sel.appendChild(o); sel.value = c.id; onChange && onChange(); };
  $("contact").onchange = () => onChange && onChange();
}

function lineEditor(d) {
  const t = d.type, isNew = !d.id, side = SALES.has(t) ? "sales" : "purch";
  const s = D.settings, vat = vatOn();
  const kind = side === "sales" ? "customer" : "vendor";
  const [title, tag] = headerFor(d, isNew);
  const vatOpts = Object.entries(D.vat).filter(([, v]) => side === "sales" ? v.sales : v.purch);
  const defAcct = side === "sales" ? "4000" : t === "expense" ? "6950" : "5000";
  const lines = (d.lines && d.lines.length ? d.lines : [{ qty: 1, vat: "SR", account: defAcct }]).map(l => ({ ...l }));
  const extra = [];
  if (t === "invoice") extra.push(`<label><span class="lbl">Due date</span><input type="date" id="dueDate" value="${esc(d.dueDate || addDays(d.date || today(), s.dueDays))}"></label>`, `<label><span class="lbl">Date of supply (if different)</span><input type="date" id="supplyDate" value="${esc(d.supplyDate || "")}"></label>`, `<label><span class="lbl">Customer PO / reference</span><input id="ref" maxlength="80" value="${esc(d.ref || d.poRef || "")}"></label>`);
  if (t === "quote") extra.push(`<label><span class="lbl">Valid until</span><input type="date" id="dueDate" value="${esc(d.dueDate || addDays(d.date || today(), s.quoteValidDays))}"></label>`, `<label><span class="lbl">Customer reference / RFQ</span><input id="ref" maxlength="80" value="${esc(d.ref || "")}"></label>`, `<label><span class="lbl">Subject</span><input id="title" maxlength="150" value="${esc(d.title || "")}" placeholder="e.g. Network upgrade, Block B"></label>`);
  if (t === "po") extra.push(`<label><span class="lbl">Expected delivery</span><input type="date" id="dueDate" value="${esc(d.dueDate || addDays(d.date || today(), 14))}"></label>`, `<label><span class="lbl">Supplier quote ref.</span><input id="ref" maxlength="80" value="${esc(d.ref || "")}"></label>`, `<label><span class="lbl">Deliver to</span><input id="deliverTo" maxlength="300" value="${esc(d.deliverTo || s.address)}"></label>`);
  if (t === "bill") extra.push(`<label><span class="lbl">Supplier invoice no. *</span><input id="ref" maxlength="80" required value="${esc(d.ref || "")}"></label>`, `<label><span class="lbl">Due date</span><input type="date" id="dueDate" value="${esc(d.dueDate || "")}" placeholder="from supplier terms"></label>`);
  if (t === "creditnote") { const invs = D.docs.filter(x => x.type === "invoice" && x.status === "posted" && (!d.contactId || x.contactId === d.contactId)); extra.push(`<label><span class="lbl">Against tax invoice${vat ? " *" : ""}</span><select id="invoiceId"><option value="">${vat ? "Choose the invoice being corrected" : "Not linked"}</option>${invs.map(x => `<option value="${x.id}"${x.id === d.invoiceId ? " selected" : ""}>${esc(x.number)} · ${fd(x.date)} · AED ${aed(x.total)}</option>`).join("")}</select></label>`, `<label style="grid-column:span 2"><span class="lbl">Reason *</span><input id="reason" maxlength="500" required value="${esc(d.reason || "")}" placeholder="Returned goods, price correction, cancelled service…"></label>`); }
  if (t === "vendorcredit") extra.push(`<label><span class="lbl">Supplier credit note no.</span><input id="ref" maxlength="80" value="${esc(d.ref || "")}"></label>`, `<label style="grid-column:span 2"><span class="lbl">Reason</span><input id="reason" maxlength="500" value="${esc(d.reason || "")}"></label>`);
  if (t === "expense") extra.push(`<label><span class="lbl">Paid from *</span><select id="account">${acctOptions(isPaidFrom, d.account || "1010")}</select></label>`, `<label><span class="lbl">Receipt / tax invoice no.</span><input id="ref" maxlength="80" value="${esc(d.ref || "")}"></label>`, `<label><span class="lbl">Payee (if not a listed supplier)</span><input id="payee" maxlength="150" value="${esc(!d.contactId ? d.contactName || d.payee || "" : "")}"></label>`, `<label><span class="lbl">Payee's TRN (to recover VAT)</span><input id="payeeTrn" maxlength="20" inputmode="numeric" value="${esc(d.payeeTrn || "")}" placeholder="15 digits from their tax invoice"></label>`);
  const salesExtra = t === "invoice" || t === "quote" ? `<label><span class="lbl">Salesperson</span><input id="salesperson" maxlength="100" value="${esc(d.salesperson || (isNew ? (D.me.split("@")[0].split(/[._-]/).map(w => w[0].toUpperCase() + w.slice(1)).join(" ")) : ""))}"></label>` : "";
  const emSel = side === "sales" && vat ? `<label><span class="lbl">Emirate for VAT return (box 1)</span><select id="emirate">${D.emirates.map(e => `<option${e === (d.emirate || s.emirate) ? " selected" : ""}>${e}</option>`).join("")}</select></label>` : "";
  const draftable = ["quote", "invoice", "creditnote", "po", "bill"].includes(t);
  const saveBtns = t === "quote" || t === "po" ? `<button type="button" data-s="draft">Save as draft</button><button type="button" class="primary" data-s="sent">Save as sent</button>`
    : draftable && (isNew || d.status === "draft") ? `<button type="button" data-s="draft">Save as draft</button><button type="button" class="primary" data-s="posted">${t === "bill" ? "Save and post" : "Save and issue"}</button>` : `<button type="button" class="primary" data-s="posted">Save</button>`;
  page(title, tag, `<a class="btn" href="${d.id ? "#/doc/" + d.id : "#/" + ROUTE_OF[t]}">Cancel</a>`,
    `<form class="ed" id="ed" novalidate>
      <section class="panel"><div class="row wide">
        <label><span class="lbl">${t === "expense" ? "Supplier (optional)" : side === "sales" ? "Customer *" : "Supplier *"}</span>${contactPicker(kind, d.contactId, t === "expense")}</label>
        <label><span class="lbl">${t === "invoice" ? "Invoice date" : t === "quote" ? "Quotation date" : "Date"}</span><input type="date" id="date" value="${esc(d.date || today())}" required></label>
        ${extra.join("")}${emSel}${salesExtra}
      </div>
      ${t === "invoice" || t === "quote" ? `<label><span class="lbl">Attention (contact person)</span><input id="attention" maxlength="100" value="${esc(d.attention || "")}"></label>` : ""}
      ${vat && side === "sales" ? `<div class="note warn" id="drBox" hidden><b>Domestic reverse charge on electronic devices (Cabinet Decision No. 91 of 2023)</b>Only for phones, computers, tablets and their parts sold to a VAT-registered customer who will resell them or use them to make electronic devices. No VAT is charged; the customer accounts for it. Get their written declaration before the supply.<label class="chk" style="margin-top:6px"><input type="checkbox" id="drDeclaration"${d.drDeclaration ? " checked" : ""}> The customer's signed declaration (VAT registered, buying to resell or manufacture) is on file</label></div>` : ""}
      ${vat && side === "purch" ? `<div class="hint">Buying phones, computers, tablets or parts to resell? Use <b>Domestic reverse charge</b>: the supplier shouldn't charge VAT, and you give them your written declaration.</div>` : ""}
      <div class="hint" id="cinfo"></div></section>
      <section class="panel" style="padding:0;overflow:hidden"><div class="tblwrap"><table class="lines"><thead><tr><th class="h">#</th><th>Item / description</th><th class="n">Qty</th><th class="p">Rate</th><th class="d">Disc %</th>${vat ? `<th class="v">VAT</th>` : ""}<th class="a">Account</th><th class="amt">Amount</th><th class="rm"></th></tr></thead><tbody id="lines"></tbody></table></div>
        <div style="padding:10px 14px;display:flex;gap:8px;flex-wrap:wrap"><button type="button" id="addLine">+ Add line</button>${D.perms.acct ? `<a class="btn" href="#/items" target="_blank">Manage items</a>` : ""}</div>
        <div style="padding:0 16px 14px"><div class="totals" id="totals"></div></div></section>
      <section class="panel"><div class="row"><label><span class="lbl">Notes${side === "sales" ? " (shown on the document)" : ""}</span><textarea id="notes" rows="3" maxlength="3000">${esc(d.notes || "")}</textarea></label>
        ${["quote", "invoice", "po"].includes(t) ? `<label><span class="lbl">Terms and conditions</span><textarea id="terms" rows="3" maxlength="4000">${esc(d.terms != null && !d._fresh ? d.terms : d.terms || (t === "quote" ? s.quoteTerms : t === "po" ? s.poTerms : s.invoiceTerms))}</textarea></label>` : ""}</div></section>
      ${editorFiles(d)}
      <div class="err" id="err"></div>
      <div class="edfoot">${saveBtns}</div>
    </form>`, ROUTE_OF[t]);
  const queue = []; wireEditorFiles(queue);
  const body = $("lines");
  const acctSel = (sel) => acctOptions(isLineAcct(side), sel);
  const rowHTML = (l, i) => `<tr data-i="${i}"><td class="h">${i + 1}</td>
    <td><input list="dlItems" data-k="name" value="${esc(l.name || "")}" placeholder="Type an item or a description" maxlength="300"><textarea data-k="description" rows="1" maxlength="2000" placeholder="Details (optional)">${esc(l.description || "")}</textarea></td>
    <td class="n"><input class="num" data-k="qty" inputmode="decimal" value="${l.qty ?? 1}"><input data-k="unit" placeholder="unit" maxlength="20" value="${esc(l.unit || "")}" style="margin-top:4px;font-size:11px"></td>
    <td class="p"><input class="num" data-k="rate" inputmode="decimal" value="${l.rate ?? ""}"></td>
    <td class="d"><input class="num" data-k="discPct" inputmode="decimal" value="${l.discPct || ""}"></td>
    ${vat ? `<td class="v"><select data-k="vat">${vatOpts.map(([k, v]) => `<option value="${k}"${k === (l.vat || "SR") ? " selected" : ""}>${esc(v.name)}</option>`).join("")}</select>${side === "purch" ? `<label class="blk"><input type="checkbox" data-k="blocked"${l.blocked ? " checked" : ""}> VAT not recoverable</label>` : ""}</td>` : ""}
    <td class="a"><select data-k="account">${acctSel(l.account || defAcct)}</select></td>
    <td class="amt" data-amt></td><td class="rm"><button type="button" class="x" data-rm aria-label="Remove line">×</button></td></tr>`;
  const calc = () => {
    let sub = 0, v = 0, rc = 0;
    lines.forEach((l, i) => { const net = r2(num(l.qty) * num(l.rate) * (1 - num(l.discPct) / 100)); const va = vat ? r2(net * ((D.vat[l.vat || "SR"] || {}).rate || 0) / 100) : 0; sub += net; if (["RC", "IM", "DR"].includes(l.vat)) rc += va; else v += va; const c = body.querySelector(`tr[data-i="${i}"] [data-amt]`); if (c) c.textContent = aed(net); });
    $("totals").innerHTML = `<span>Total excluding VAT</span><span class="n">${aed(sub)}</span>${vat ? `<span>VAT</span><span class="n">${aed(v)}</span>` : ""}${rc ? `<span class="muted">${side === "sales" ? "Reverse charge VAT (customer accounts for it)" : "Reverse charge VAT (we account for it)"}</span><span class="n muted">${aed(rc)}</span>` : ""}<span class="big">Total AED</span><span class="n big">${aed(sub + v)}</span>`;
    const dr = $("drBox"); if (dr) dr.hidden = !lines.some(l => l.vat === "DR");
  };
  const draw = () => { body.innerHTML = lines.map(rowHTML).join(""); calc(); };
  body.addEventListener("input", e => {
    const tr = e.target.closest("tr"); if (!tr) return; const l = lines[tr.dataset.i]; const k = e.target.dataset.k;
    l[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (k === "name") { const it = D.items.find(x => x.name === e.target.value); if (it) { Object.assign(l, { itemId: it.id, description: l.description || it.description, unit: it.unit, rate: side === "sales" ? it.salePrice : it.purchasePrice, vat: it.vat, account: side === "sales" ? (it.salesAcct || defAcct) : (it.purchaseAcct || defAcct) }); const i = Number(tr.dataset.i); tr.outerHTML = rowHTML(l, i); } }
    calc();
  });
  body.addEventListener("click", e => { if (e.target.dataset.rm != null) { const i = Number(e.target.closest("tr").dataset.i); lines.splice(i, 1); if (!lines.length) lines.push({ qty: 1, vat: "SR", account: defAcct }); draw(); } });
  $("addLine").onclick = () => { lines.push({ qty: 1, vat: lines.length ? lines[lines.length - 1].vat : "SR", account: lines.length ? lines[lines.length - 1].account : defAcct }); draw(); body.querySelector("tr:last-child input").focus(); };
  const showInfo = () => {
    const c = (kind === "customer" ? CUS : VEN).get($("contact").value); const el = $("cinfo"); if (!c) { el.textContent = ""; return; }
    const bits = [c.trn ? "TRN " + c.trn : (vat && side === "sales" ? "No TRN on file (fine for an unregistered customer)" : ""), c.address, kind === "vendor" && c.country && c.country !== "UAE" ? `Outside the UAE: use Reverse charge for services or Import of goods for customs imports` : ""].filter(Boolean);
    el.textContent = bits.join(" · ");
    if (t === "bill" && !$("dueDate").value && c.creditDays) $("dueDate").value = addDays($("date").value, c.creditDays);
  };
  wireContact(kind, showInfo); showInfo();
  draw();
  $("app").querySelectorAll("[data-s]").forEach(b => b.onclick = async () => {
    $("err").textContent = "";
    const v = id => $(id) ? $(id).value : undefined;
    const payload = { type: t, contactId: v("contact"), date: v("date"), dueDate: v("dueDate"), supplyDate: v("supplyDate"), ref: v("ref"), title: v("title"), deliverTo: v("deliverTo"), attention: v("attention"),
      salesperson: v("salesperson"), emirate: v("emirate"), drDeclaration: $("drDeclaration") ? $("drDeclaration").checked : false, payeeTrn: v("payeeTrn"), invoiceId: v("invoiceId") ?? d.invoiceId, billId: d.billId, reason: v("reason"), account: v("account"), payee: v("payee"), notes: v("notes"), terms: v("terms"),
      lines: lines.map(l => ({ ...l, vat: vat ? (l.vat || "SR") : "OS" })), status: b.dataset.s, etag: d.etag, fromId: d.fromId, placeOfSupply: d.placeOfSupply, poRef: d.poRef };
    const vend = VEN.get(payload.contactId); if (t === "bill" && vend && !payload.dueDate) payload.creditDays = vend.creditDays;
    if (b.dataset.s === "posted" && t === "invoice" && payload.supplyDate && daysBetween(payload.supplyDate, payload.date) > 14 && !await ask("Issued more than 14 days after the supply", `The date of supply is ${fd(payload.supplyDate)}. A tax invoice must be issued within 14 days of the date of supply (Art. 67 of the VAT Decree-Law), and the VAT is due for the period of the supply date. Issue it anyway?`, { okText: "Continue" })) return;
    if (b.dataset.s === "posted" && ["invoice", "creditnote"].includes(t) && !await ask(`Issue this ${docTitle({ type: t }).toLowerCase()}?`, "It gets the next number in the sequence and can't be changed afterwards.", { okText: "Issue" })) return;
    busy(b, true);
    try { const r = d.id ? await api("PUT", "docs/" + d.id, payload) : await api("POST", "docs", payload); await afterSave(r, queue, t); await load(); toast(`${NAME[t]} ${r.number || "draft"} saved.`); go("#/doc/" + r.id); }
    catch (e) { $("err").textContent = e.message; busy(b, false); }
  });
}

function payEditor(d, applyId) {
  const t = d.type, isNew = !d.id, kind = t === "receipt" ? "customer" : "vendor", target = t === "receipt" ? "invoice" : "bill";
  const [title, tag] = headerFor(d, isNew);
  const cur = new Map((d.allocs || d.applied || []).map(a => [a.id, a.amt]));
  page(title, tag, `<a class="btn" href="${d.id ? "#/doc/" + d.id : "#/" + ROUTE_OF[t]}">Cancel</a>`,
    `<form class="ed" id="ed" novalidate><section class="panel"><div class="row wide">
      <label><span class="lbl">${kind === "customer" ? "Customer *" : "Supplier *"}</span>${contactPicker(kind, d.contactId)}</label>
      <label><span class="lbl">Date</span><input type="date" id="date" value="${esc(d.date || today())}"></label>
      <label><span class="lbl">Amount (AED) *</span><input class="num" id="amount" inputmode="decimal" value="${d.amount || ""}"></label>
      <label><span class="lbl">${t === "receipt" ? "Received into" : "Paid from"}</span><select id="account">${acctOptions(isMoneyAcct, d.account || "1100")}</select></label>
      <label><span class="lbl">Method</span><select id="method">${METHODS.map(m => `<option${m === (d.method || "Bank transfer") ? " selected" : ""}>${m}</option>`).join("")}</select></label>
      <label><span class="lbl">Cheque no.</span><input id="chequeNo" maxlength="40" value="${esc(d.chequeNo || "")}"></label>
      <label><span class="lbl">Cheque date</span><input type="date" id="chequeDate" value="${esc(d.chequeDate || "")}"></label>
      <label><span class="lbl">Bank reference</span><input id="bankRef" maxlength="80" value="${esc(d.bankRef || "")}"></label>
      </div><p class="hint" style="margin:0">${t === "receipt" ? "Post-dated cheques can go into <b>PDCs Received</b> and be moved to the bank with a transfer when they clear." : "A post-dated cheque you issue can also be logged in the PDC & Guarantees tool for its reminder."}</p></section>
      <section class="panel" style="padding:0;overflow:hidden"><header style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line)"><b>Apply to open ${target}s</b><button type="button" id="auto">Fill oldest first</button></header>
        <div class="tblwrap"><table class="list compact nohover"><thead><tr><th>${target === "invoice" ? "Invoice" : "Bill"}</th><th>Date</th><th>Due</th><th class="r">Total</th><th class="r">Open</th><th class="r">Payment</th></tr></thead><tbody id="open"></tbody></table></div>
        <div style="padding:10px 16px" class="totals" id="tot"></div></section>
      <section class="panel"><label><span class="lbl">Notes</span><textarea id="notes" rows="2" maxlength="3000">${esc(d.notes || "")}</textarea></label></section>
      ${editorFiles(d)}
      <div class="err" id="err"></div><div class="edfoot"><button type="button" class="primary" id="save">Save</button></div></form>`, ROUTE_OF[t]);
  const queue = []; wireEditorFiles(queue);
  const drawOpen = () => {
    const cid = $("contact").value;
    const open = D.docs.filter(x => x.type === target && x.status === "posted" && x.contactId === cid && (x.balance > 0.004 || cur.has(x.id))).sort((a, b) => a.date.localeCompare(b.date));
    $("open").innerHTML = open.map(x => { const avail = r2(x.balance + (cur.get(x.id) || 0)); return `<tr><td><b>${esc(x.number)}</b>${x.ref ? `<div class="s">${esc(x.ref)}</div>` : ""}</td><td>${fd(x.date)}</td><td class="${x.view === "overdue" ? "neg" : ""}">${fd(x.dueDate)}</td><td class="r mono">${aed(x.total)}</td><td class="r mono">${aed(avail)}</td><td class="r"><input class="num" style="width:130px" data-id="${x.id}" data-max="${avail}" value="${cur.get(x.id) || (x.id === applyId && isNew ? avail : "")}"></td></tr>`; }).join("") || `<tr><td colspan="6" class="muted">${cid ? `No open ${target}s. The whole amount will be kept as an advance to apply later.` : `Choose the ${kind === "customer" ? "customer" : "supplier"} first.`}</td></tr>`;
    if (applyId && isNew && !$("amount").value) { const i = $("open").querySelector(`[data-id="${applyId}"]`); if (i) $("amount").value = i.value; }
    sum();
  };
  const sum = () => { const a = [...$("open").querySelectorAll("input")].reduce((s, i) => s + num(i.value), 0); const amt = num($("amount").value); $("tot").innerHTML = `<span>Amount</span><span class="n">${aed(amt)}</span><span>Applied</span><span class="n">${aed(a)}</span><span class="big">${a > amt + 0.004 ? "Over-applied" : "Left as advance"}</span><span class="n big ${a > amt + 0.004 ? "neg" : ""}">${aed(amt - a)}</span>`; };
  wireContact(kind, () => { cur.clear(); drawOpen(); });
  $("open").addEventListener("input", sum); $("amount").oninput = sum;
  $("auto").onclick = () => { let left = num($("amount").value); const ins = [...$("open").querySelectorAll("input")]; if (!left) { left = ins.reduce((s, i) => s + num(i.dataset.max), 0); $("amount").value = r2(left); } ins.forEach(i => { const v = Math.min(left, num(i.dataset.max)); i.value = v > 0 ? r2(v) : ""; left = r2(left - v); }); sum(); };
  drawOpen();
  $("save").onclick = async e => {
    const b = e.target; $("err").textContent = ""; busy(b, true);
    const payload = { type: t, contactId: $("contact").value, date: $("date").value, amount: $("amount").value, account: $("account").value, method: $("method").value, chequeNo: $("chequeNo").value, chequeDate: $("chequeDate").value, bankRef: $("bankRef").value, notes: $("notes").value,
      allocs: [...$("open").querySelectorAll("input")].map(i => ({ id: i.dataset.id, amt: num(i.value) })).filter(a => a.amt > 0), etag: d.etag };
    try { const r = d.id ? await api("PUT", "docs/" + d.id, payload) : await api("POST", "docs", payload); await afterSave(r, queue, t); await load(); toast(`${NAME[t]} ${r.number} saved.`); go("#/doc/" + r.id); }
    catch (err) { $("err").textContent = err.message; busy(b, false); }
  };
}

function journalEditor(d) {
  const isNew = !d.id; const [title, tag] = headerFor(d, isNew);
  const lines = (d.jlines || d.lines || []).length ? (d.jlines || d.lines).map(l => ({ ...l })) : [{}, {}];
  const contacts = [...D.customers.map(c => [c.id, c.name, "customer"]), ...D.vendors.map(c => [c.id, c.name, "vendor"])];
  page(title, tag, `<a class="btn" href="${d.id ? "#/doc/" + d.id : "#/journals"}">Cancel</a>`,
    `<form class="ed" novalidate><section class="panel"><div class="row"><label><span class="lbl">Date</span><input type="date" id="date" value="${esc(d.date || today())}"></label><label><span class="lbl">Reference</span><input id="ref" maxlength="80" value="${esc(d.ref || "")}"></label><label class="chk" style="align-self:end"><input type="checkbox" id="opening"${d.opening ? " checked" : ""}> Opening balances</label></div>
      <label><span class="lbl">Narration *</span><textarea id="notes" rows="2" maxlength="3000" placeholder="Why this entry is made">${esc(d.notes || "")}</textarea></label>
      <p class="hint" style="margin:0">Opening balances: debit assets, credit liabilities, and put the difference to <b>3900 Opening Balance Equity</b>. Customer and supplier balances need the customer or supplier on the line.</p></section>
      <section class="panel" style="padding:0;overflow:hidden"><div class="tblwrap"><table class="lines" style="min-width:860px"><thead><tr><th class="h">#</th><th>Account</th><th>Customer / supplier</th><th>Memo</th><th class="p">Debit</th><th class="p">Credit</th><th class="rm"></th></tr></thead><tbody id="jl"></tbody></table></div>
      <div style="padding:10px 14px"><button type="button" id="add">+ Add line</button></div><div style="padding:0 16px 14px" class="totals" id="jt"></div></section>
      ${editorFiles(d)}
      <div class="err" id="err"></div><div class="edfoot"><button type="button" class="primary" id="save">Save journal</button></div></form>`, "journals");
  const queue = []; wireEditorFiles(queue);
  const row = (l, i) => `<tr data-i="${i}"><td class="h">${i + 1}</td><td><select data-k="account"><option value="">Choose</option>${acctOptions(() => true, l.account)}</select></td>
    <td><select data-k="contactId"><option value="">-</option>${contacts.map(([id, n, k]) => `<option value="${id}"${id === l.contactId ? " selected" : ""}>${esc(n)} (${k})</option>`).join("")}</select></td>
    <td><input data-k="memo" maxlength="200" value="${esc(l.memo || "")}"></td><td class="p"><input class="num" data-k="debit" value="${l.debit || ""}"></td><td class="p"><input class="num" data-k="credit" value="${l.credit || ""}"></td><td class="rm"><button type="button" class="x" data-rm>×</button></td></tr>`;
  const sum = () => { const dr = lines.reduce((a, l) => a + num(l.debit), 0), cr = lines.reduce((a, l) => a + num(l.credit), 0); $("jt").innerHTML = `<span>Debits</span><span class="n">${aed(dr)}</span><span>Credits</span><span class="n">${aed(cr)}</span><span class="big">Difference</span><span class="n big ${Math.abs(dr - cr) > 0.004 ? "neg" : ""}">${aed(dr - cr)}</span>`; };
  const draw = () => { $("jl").innerHTML = lines.map(row).join(""); sum(); };
  $("jl").addEventListener("input", e => { const tr = e.target.closest("tr"); const l = lines[tr.dataset.i]; l[e.target.dataset.k] = e.target.value; if (e.target.dataset.k === "contactId") l.contactName = contactName(e.target.value); sum(); });
  $("jl").addEventListener("click", e => { if (e.target.dataset.rm != null) { lines.splice(Number(e.target.closest("tr").dataset.i), 1); while (lines.length < 2) lines.push({}); draw(); } });
  $("add").onclick = () => { lines.push({}); draw(); };
  draw();
  $("save").onclick = async e => { const b = e.target; busy(b, true); $("err").textContent = "";
    try { const payload = { type: "journal", date: $("date").value, ref: $("ref").value, notes: $("notes").value, opening: $("opening").checked, lines, etag: d.etag };
      const r = d.id ? await api("PUT", "docs/" + d.id, payload) : await api("POST", "docs", payload); await afterSave(r, queue, "journal"); await load(); toast(`Journal ${r.number} saved.`); go("#/doc/" + r.id); }
    catch (err) { $("err").textContent = err.message; busy(b, false); } };
}
function transferEditor(d) {
  const isNew = !d.id; const [title, tag] = headerFor(d, isNew);
  const okT = a => ["bank", "cash", "current_asset"].includes(a.type) && !Object.values(D.sys).includes(a.code);
  page(title, tag, `<a class="btn" href="${d.id ? "#/doc/" + d.id : "#/banking"}">Cancel</a>`,
    `<form class="ed" novalidate><section class="panel"><div class="row"><label><span class="lbl">From</span><select id="from">${acctOptions(okT, d.account || "1100")}</select></label><label><span class="lbl">To</span><select id="to">${acctOptions(okT, d.toAccount || "1000")}</select></label>
      <label><span class="lbl">Amount (AED)</span><input class="num" id="amount" value="${d.amount || ""}"></label><label><span class="lbl">Date</span><input type="date" id="date" value="${esc(d.date || today())}"></label><label><span class="lbl">Reference</span><input id="ref" maxlength="80" value="${esc(d.ref || "")}"></label></div>
      <label><span class="lbl">Notes</span><textarea id="notes" rows="2">${esc(d.notes || "")}</textarea></label><p class="hint" style="margin:0">Use this for cash deposits, withdrawals, PDCs that cleared into the bank, or moving funds between accounts.</p></section>
      ${editorFiles(d)}
      <div class="err" id="err"></div><div class="edfoot"><button type="button" class="primary" id="save">Save transfer</button></div></form>`, "banking");
  const queue = []; wireEditorFiles(queue);
  $("save").onclick = async e => { const b = e.target; busy(b, true); $("err").textContent = "";
    try { const payload = { type: "transfer", account: $("from").value, toAccount: $("to").value, amount: $("amount").value, date: $("date").value, ref: $("ref").value, notes: $("notes").value, etag: d.etag };
      const r = d.id ? await api("PUT", "docs/" + d.id, payload) : await api("POST", "docs", payload); await afterSave(r, queue, "transfer"); await load(); toast(`Transfer ${r.number} saved.`); go("#/doc/" + r.id); }
    catch (err) { $("err").textContent = err.message; busy(b, false); } };
}

/* ---------- banking and account registers ---------- */
function banking() {
  const accts = D.accounts.filter(a => isMoneyAcct(a) && a.active);
  const L = ledger();
  const bal = c => r2(L.filter(l => l.acct === c).reduce((a, l) => a + l.dr - l.cr, 0));
  page("Banking", "Accountant", `<button data-new="transfer">Transfer</button><button data-new="expense">+ Expense</button><button data-new="payment">Pay a supplier</button><button class="primary" data-new="receipt">Receive payment</button>`,
    `<section class="kpis">${accts.map(a => `<a class="kpi" href="#/account/${a.code}" style="--c:${bal(a.code) < 0 ? "var(--bad)" : "var(--good)"}"><div class="k">${esc(a.name)}</div><div class="v"><small>AED</small>${aed(bal(a.code))}</div><div class="s">${esc(a.code)} · ${esc(D.acctTypes[a.type][1])}</div></a>`).join("")}</section>
    <div class="note">Add more bank or card accounts in the <a href="#/accounts">Chart of accounts</a> (type Bank). Open an account to see every transaction and its running balance.</div>`, "banking");
  $("app").querySelectorAll("[data-new]").forEach(b => b.onclick = () => go("#/new/" + b.dataset.new));
}
function accountView(code) {
  const a = ACC.get(code); if (!a) return go("#/accounts");
  const p = params(); const t = today(); const from = p.from || fyStart(t), to = p.to || t;
  const L = ledger().filter(l => l.acct === code);
  const open = r2(L.filter(l => l.date < from).reduce((s, l) => s + l.dr - l.cr, 0));
  let run = open;
  const rows = L.filter(l => l.date >= from && l.date <= to).map(l => { run = r2(run + l.dr - l.cr); return { ...l, bal: run }; });
  page(`${a.code} ${a.name}`, `Account · ${D.acctTypes[a.type][1]}`, `<button id="xl">Export to Excel</button><a class="btn" href="#/accounts">Chart of accounts</a>`,
    `<div class="tools periodbar"><input type="date" id="f" value="${from}"><input type="date" id="t" value="${to}"><span class="cnt">${rows.length} transactions</span></div>
    <div class="panel listpanel"><div class="tblwrap"><table class="list compact"><thead><tr><th>Date</th><th>Transaction</th><th>Contact / payee</th><th>Memo</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead>
    <tbody><tr class="nohover"><td>${fd(from)}</td><td colspan="5"><b>Opening balance</b></td><td class="r mono">${aed(open)}</td></tr>${rows.map(l => `<tr data-id="${l.id}"><td>${fd(l.date)}</td><td>${esc(NAME[l.type])} <b>${esc(l.number)}</b></td><td>${esc(contactName(l.contact) || l.party)}</td><td class="muted">${esc(l.memo)}</td><td class="r mono">${l.dr ? aed(l.dr) : ""}</td><td class="r mono">${l.cr ? aed(l.cr) : ""}</td><td class="r mono">${aed(l.bal)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td></td><td colspan="3">Closing balance ${fd(to)}</td><td class="r mono">${aed(rows.reduce((s, l) => s + l.dr, 0))}</td><td class="r mono">${aed(rows.reduce((s, l) => s + l.cr, 0))}</td><td class="r mono">${aed(run)}</td></tr></tfoot></table></div></div>`, isMoneyAcct(a) ? "banking" : "accounts");
  const re = () => go(`#/account/${code}?from=${$("f").value}&to=${$("t").value}`); $("f").onchange = re; $("t").onchange = re;
  $("app").querySelectorAll("tr[data-id]").forEach(tr => tr.onclick = () => go("#/doc/" + tr.dataset.id));
  $("xl").onclick = () => exportSheets(`${a.code} ${a.name} ${from} to ${to}`, [["Transactions", [["Date", "Type", "Number", "Contact", "Memo", "Debit", "Credit", "Balance"], [from, "Opening balance", "", "", "", "", "", open], ...rows.map(l => [l.date, NAME[l.type], l.number, contactName(l.contact) || l.party, l.memo, l.dr, l.cr, l.bal])]]]).catch(e => toast(e.message, 1));
}

/* ---------- chart of accounts ---------- */
function coa() {
  const L = ledger();
  const bal = c => r2(L.filter(l => l.acct === c).reduce((a, l) => a + l.dr - l.cr, 0));
  const groups = ["asset", "liability", "equity", "income", "expense"];
  const GN = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses" };
  page("Chart of accounts", "Accountant", `<button class="primary" id="add">+ New account</button>`,
    `<div class="tools"><input type="search" id="q" placeholder="Search code or name"><label class="chk"><input type="checkbox" id="inact"> Show inactive</label></div>
    <div class="panel listpanel"><div class="tblwrap"><table class="list compact"><thead><tr><th>Code</th><th>Account</th><th>Type</th><th class="r">Balance (AED)</th></tr></thead><tbody id="rows"></tbody></table></div></div>`, "accounts");
  const draw = () => {
    const q = $("q").value.toLowerCase(), ia = $("inact").checked;
    $("rows").innerHTML = groups.map(g => { const l = D.accounts.filter(a => a.group === g && (ia || a.active) && (!q || (a.code + " " + a.name).toLowerCase().includes(q)));
      return l.length ? `<tr class="nohover"><td colspan="4" style="background:var(--sunk);font-weight:700;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">${GN[g]}</td></tr>` + l.map(a => `<tr data-c="${a.code}" class="${a.active ? "" : "void"}"><td class="mono">${a.code}</td><td><span class="t">${esc(a.name)}</span>${a.system ? ` <span class="st">system</span>` : ""}${a.ctPct ? ` <span class="st partial" title="Not deductible for corporate tax">CT ${a.ctPct}% add-back</span>` : ""}${a.description ? `<div class="s">${esc(a.description)}</div>` : ""}</td><td>${esc(D.acctTypes[a.type][1])}</td><td class="r mono"><a href="#/account/${a.code}" onclick="event.stopPropagation()">${aed(signed(a.code, bal(a.code)))}</a></td></tr>`).join("") : ""; }).join("");
    $("rows").querySelectorAll("tr[data-c]").forEach(tr => tr.onclick = () => acctDialog(ACC.get(tr.dataset.c)));
  };
  $("q").oninput = draw; $("inact").onchange = draw; $("add").onclick = () => acctDialog(null); draw();
}
async function acctDialog(a) {
  const types = Object.entries(D.acctTypes).map(([k, v]) => `<option value="${k}"${a && a.type === k ? " selected" : ""}>${esc(v[1])} (${v[0]})</option>`).join("");
  const r = await dialog(`<form><h3>${a ? "Edit account" : "New account"}</h3><div class="fields"><label><span class="lbl">Code</span><input name="code" required maxlength="6" inputmode="numeric" value="${esc(a ? a.code : "")}" ${a ? "disabled" : ""}></label><label><span class="lbl">Type</span><select name="type" ${a && a.system ? "disabled" : ""}>${types}</select></label></div>
    <label><span class="lbl">Name</span><input name="name" required maxlength="100" value="${esc(a ? a.name : "")}"></label><label><span class="lbl">Description</span><input name="description" maxlength="300" value="${esc(a ? a.description : "")}"></label>
    <label><span class="lbl">Not deductible for corporate tax (%)</span><input name="ctPct" class="num" value="${a && a.ctPct ? a.ctPct : ""}" placeholder="0" style="max-width:140px"><span class="hint">Expenses only. E.g. 50 for business entertainment, 100 for fines. Added back in the corporate tax computation.</span></label>
    ${a && !a.system ? `<label class="chk"><input type="checkbox" name="active"${a.active ? " checked" : ""}> Active</label>` : ""}
    <div class="err"></div><div class="foot">${a && !a.system ? `<button type="button" class="danger" id="del" style="margin-right:auto">Delete</button>` : ""}<button type="button" data-x>Cancel</button><button class="primary" type="submit">Save</button></div></form>`, {
    onOpen: (dl, done) => {
      const f = dl.querySelector("form");
      f.onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); v.active = a && !a.system ? f.active.checked : true; if (a && a.system) v.type = a.type;
        try { a ? await api("PUT", "accounts/" + a.code, v) : await api("POST", "accounts", v); done(true); } catch (err) { dl.querySelector(".err").textContent = err.message; } };
      const del = dl.querySelector("#del"); if (del) del.onclick = async () => { try { await api("DELETE", "accounts/" + a.code); done(true); } catch (err) { dl.querySelector(".err").textContent = err.message; } };
    } });
  if (r) { await load(); coa(); }
}

/* ---------- items ---------- */
function itemsView() {
  page("Items", "Accountant", `<button id="imp">Import from Excel</button><button id="xl">Export</button><button class="primary" id="add">+ New item</button>`,
    `<div class="tools"><input type="search" id="q" placeholder="Search name, SKU or brand"><select id="k"><option value="">Goods and services</option><option value="goods">Goods</option><option value="service">Services</option></select><label class="chk"><input type="checkbox" id="inact"> Show inactive</label><span class="cnt" id="cnt"></span></div>
    <div class="panel listpanel"><div class="tblwrap"><table class="list"><thead><tr><th>Item</th><th>SKU</th><th>Type</th><th>VAT</th><th class="r">Sale price</th><th class="r">Purchase price</th><th class="r">Margin</th></tr></thead><tbody id="rows"></tbody></table><div class="empty" id="empty" hidden><strong>No items yet</strong>Add the products and services you sell so quotations and invoices fill themselves.</div></div></div>`, "items");
  const draw = () => {
    const q = $("q").value.toLowerCase(), k = $("k").value, ia = $("inact").checked;
    const vis = D.items.filter(i => (ia || i.active) && (!k || i.kind === k) && (!q || [i.name, i.sku, i.brand].join(" ").toLowerCase().includes(q)));
    $("rows").innerHTML = vis.map(i => `<tr data-id="${i.id}" class="${i.active ? "" : "void"}"><td><span class="t">${esc(i.name)}</span>${i.brand ? `<div class="s">${esc(i.brand)}</div>` : ""}</td><td class="mono">${esc(i.sku)}</td><td>${i.kind === "service" ? "Service" : "Goods"}</td><td>${esc(i.vat)}</td><td class="r mono">${aed(i.salePrice)}</td><td class="r mono">${aed(i.purchasePrice)}</td><td class="r mono">${i.salePrice ? Math.round((i.salePrice - i.purchasePrice) / i.salePrice * 100) + "%" : ""}</td></tr>`).join("");
    $("empty").hidden = !!D.items.length; $("cnt").textContent = `${vis.length} of ${D.items.length}`;
    $("rows").querySelectorAll("tr").forEach(tr => tr.onclick = () => itemDialog(ITEMS.get(tr.dataset.id)));
  };
  ["q", "k"].forEach(id => $(id).oninput = draw); $("inact").onchange = draw; $("add").onclick = () => itemDialog(null);
  $("xl").onclick = () => exportSheets(`${D.company.name} items`, [["Items", [["name", "sku", "brand", "kind", "unit", "salePrice", "purchasePrice", "vat", "salesAcct", "purchaseAcct", "description"], ...D.items.map(i => [i.name, i.sku, i.brand, i.kind, i.unit, i.salePrice, i.purchasePrice, i.vat, i.salesAcct, i.purchaseAcct, i.description])]]]).catch(e => toast(e.message, 1));
  $("imp").onclick = importItems;
  draw();
}
async function itemDialog(i) {
  const r = await dialog(`<form><h3>${i ? "Edit item" : "New item"}</h3>
    <label><span class="lbl">Name *</span><input name="name" required maxlength="200" value="${esc(i ? i.name : "")}"></label>
    <div class="fields"><label><span class="lbl">SKU / part no.</span><input name="sku" maxlength="60" value="${esc(i ? i.sku : "")}"></label><label><span class="lbl">Brand</span><input name="brand" maxlength="60" value="${esc(i ? i.brand : "")}"></label><label><span class="lbl">Type</span><select name="kind"><option value="goods">Goods</option><option value="service"${i && i.kind === "service" ? " selected" : ""}>Service</option></select></label></div>
    <div class="fields"><label><span class="lbl">Sale price (AED, excl. VAT)</span><input name="salePrice" class="num" value="${i ? i.salePrice : ""}"></label><label><span class="lbl">Purchase price</span><input name="purchasePrice" class="num" value="${i ? i.purchasePrice : ""}"></label><label><span class="lbl">Unit</span><input name="unit" maxlength="20" value="${esc(i ? i.unit : "")}" placeholder="pcs, hrs, lot"></label></div>
    <div class="fields"><label><span class="lbl">VAT on sale</span><select name="vat">${Object.entries(D.vat).filter(([, v]) => v.sales).map(([k, v]) => `<option value="${k}"${(i ? i.vat : "SR") === k ? " selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>
      <label><span class="lbl">Sales account</span><select name="salesAcct">${acctOptions(a => ["income", "other_income"].includes(a.type), i ? i.salesAcct : "4000")}</select></label><label><span class="lbl">Purchase account</span><select name="purchaseAcct">${acctOptions(isLineAcct("purch"), i ? i.purchaseAcct : "5000")}</select></label></div>
    <label><span class="lbl">Description (copied to documents)</span><textarea name="description" rows="3" maxlength="2000">${esc(i ? i.description : "")}</textarea></label>
    ${i ? `<label class="chk"><input type="checkbox" name="active"${i.active ? " checked" : ""}> Active</label>` : ""}
    <div class="err"></div><div class="foot">${i ? `<button type="button" class="danger" id="del" style="margin-right:auto">Delete</button>` : ""}<button type="button" data-x>Cancel</button><button class="primary" type="submit">Save</button></div></form>`, { wide: true,
    onOpen: (dl, done) => {
      const f = dl.querySelector("form");
      f.onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); v.active = i ? f.active.checked : true; v.etag = i && i.etag;
        try { i ? await api("PUT", "items/" + i.id, v) : await api("POST", "items", v); done(true); } catch (err) { dl.querySelector(".err").textContent = err.message; } };
      const del = dl.querySelector("#del"); if (del) del.onclick = async () => { try { await api("DELETE", "items/" + i.id); done(true); } catch (err) { dl.querySelector(".err").textContent = err.message; } };
    } });
  if (r) { await load(); itemsView(); }
}
async function importItems() {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".xlsx,.xls,.csv";
  inp.onchange = async () => {
    try {
      const X = await xlsx(); const wb = X.read(await inp.files[0].arrayBuffer()); const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const pick = (r, ...keys) => { for (const k of Object.keys(r)) if (keys.includes(k.toLowerCase().replace(/[^a-z]/g, ""))) return r[k]; return ""; };
      const out = rows.map(r => ({ name: pick(r, "name", "item", "itemname", "description"), sku: pick(r, "sku", "partno", "code", "partnumber"), brand: pick(r, "brand"), kind: /serv/i.test(pick(r, "kind", "type")) ? "service" : "goods", unit: pick(r, "unit", "uom"),
        salePrice: pick(r, "saleprice", "price", "sellingprice", "rate"), purchasePrice: pick(r, "purchaseprice", "cost", "costprice"), vat: pick(r, "vat") || "SR", salesAcct: String(pick(r, "salesacct") || ""), purchaseAcct: String(pick(r, "purchaseacct") || ""), description: pick(r, "details", "longdescription", "description") }));
      if (!await ask("Import items?", `${out.length} rows found in ${inp.files[0].name}. Items already in the list (same SKU or name) are updated.`, { okText: "Import" })) return;
      const res = await api("POST", "items/import", { rows: out, update: true });
      await load(); itemsView(); toast(`${res.added} added, ${res.updated} updated${res.invalid.length ? `, ${res.invalid.length} skipped` : ""}.`, res.invalid.length > 0);
    } catch (e) { toast(e.message, 1); }
  };
  inp.click();
}

/* ---------- reports home ---------- */
function reportsHome() {
  const R = [["Business overview", [["pl", "Profit and loss", "Income, cost of sales and expenses for a period"], ["bs", "Balance sheet", "Assets, liabilities and equity on a date"], ["cf", "Cash summary", "Money in and out of every bank and cash account"]]],
    ["Tax (FTA)", [["vat", "VAT return (VAT 201)", "Box-by-box figures for the period, with the documents behind each box"], ["vatdetail", "VAT detail", "Every taxable document line by line, for review before filing"], ["faf", "FTA audit file", "Company, supply, purchase and ledger listings in an Excel workbook"], ["ct", "Corporate tax computation", "Taxable income, Small Business Relief test, losses, 9% tax and the return due date"]]],
    ["Receivables", [["ar", "Receivables aging", "What each customer owes, by how late"], ["salescust", "Sales by customer", "Net sales per customer for a period"]]],
    ["Payables", [["ap", "Payables aging", "What you owe each supplier, by how late"], ["purchvend", "Purchases by supplier", "Net purchases per supplier for a period"]]],
    ["Accountant", [["tb", "Trial balance", "Every account's debit or credit balance"], ["gl", "General ledger", "Every transaction in every account"], ["daybook", "Journal report", "Every entry, document by document"]]]];
  page("Reports", "Books", "", R.map(([g, l]) => `<h3 style="margin:18px 0 8px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)">${g}</h3><div class="rgrid">${l.map(([k, t, s]) => `<a class="rcard" href="#/${k === "vat" ? "vat" : "report/" + k}"><em>${esc(g)}</em><b>${esc(t)}</b><span>${esc(s)}</span></a>`).join("")}</div>`).join(""), "reports");
}

/* ---------- settings ---------- */
function settingsView() {
  const s = D.settings, P = D.perms;
  const custs = D.customers, noTrn = custs.filter(c => !c.trn), noAddr = custs.filter(c => !c.address);
  const usedC = new Set(D.docs.filter(d => d.type === "invoice" && d.status === "posted" && d.date >= addDays(today(), -365)).map(d => d.contactId));
  const activeNoTrn = noTrn.filter(c => usedC.has(c.id));
  const chk = (ok, text, warn) => `<div class="${ok ? "ok" : warn ? "wa" : "no"}"><i>${ok ? "✓" : warn ? "!" : "✗"}</i><span>${text}</span></div>`;
  page("Settings", "Books", "",
    `<form class="settings" id="sf" novalidate>
      <section class="panel"><h2>Company on documents</h2>
        <div class="fields"><label><span class="lbl">Legal name (as on trade licence) *</span><input name="legalName" maxlength="150" value="${esc(s.legalName)}"></label><label><span class="lbl">Trade name</span><input name="tradeName" maxlength="150" value="${esc(s.tradeName)}"></label><label><span class="lbl">Trade licence no.</span><input name="licenceNo" maxlength="50" value="${esc(s.licenceNo)}"></label></div>
        <label><span class="lbl">Address</span><input name="address" maxlength="300" value="${esc(s.address)}"></label>
        <div class="fields"><label><span class="lbl">Emirate of establishment</span><select name="emirate">${D.emirates.map(e => `<option${e === s.emirate ? " selected" : ""}>${e}</option>`).join("")}</select></label><label><span class="lbl">Phone</span><input name="phone" maxlength="40" value="${esc(s.phone)}"></label><label><span class="lbl">Email</span><input name="email" maxlength="150" value="${esc(s.email)}"></label><label><span class="lbl">Website</span><input name="website" maxlength="150" value="${esc(s.website)}"></label></div></section>
      <section class="panel"><h2>VAT</h2>
        <label class="chk"><input type="checkbox" name="vatRegistered"${s.vatRegistered ? " checked" : ""}> VAT registered with the FTA (documents are titled Tax Invoice and charge VAT)</label>
        <div class="fields"><label><span class="lbl">TRN (15 digits)</span><input name="trn" maxlength="20" inputmode="numeric" value="${esc(s.trn)}"></label><label><span class="lbl">Return period</span><select name="vatPeriod"><option value="quarterly">Quarterly</option><option value="monthly"${s.vatPeriod === "monthly" ? " selected" : ""}>Monthly</option></select></label>
          <label><span class="lbl">Quarters end in</span><select name="vatStagger"><option value="jan">Mar, Jun, Sep, Dec</option><option value="feb"${s.vatStagger === "feb" ? " selected" : ""}>Apr, Jul, Oct, Jan</option><option value="mar"${s.vatStagger === "mar" ? " selected" : ""}>May, Aug, Nov, Feb</option></select></label>
          <label><span class="lbl">Corporate tax TRN</span><input name="ctTrn" maxlength="20" inputmode="numeric" value="${esc(s.ctTrn)}"></label>
          <label><span class="lbl">Cash payment VAT limit (AED)</span><input name="cashVatThreshold" class="num" value="${s.cashVatThreshold || ""}" placeholder="Not set"></label></div>
        <p class="hint" style="margin:0">Cash payment limit: from 1 Oct 2026 input VAT can't be recovered on supplies paid in cash above a limit the Minister of Finance sets (Cabinet Decision 149 of 2026, Art. 54(3)). Enter it once it's published; expenses paid from a Cash account above it will treat the VAT as a cost.</p></section>
      <section class="panel"><h2>Bank details printed on invoices</h2>
        <div class="fields"><label><span class="lbl">Bank</span><input name="bankName" maxlength="100" value="${esc(s.bankName)}"></label><label><span class="lbl">Account name</span><input name="bankAccountName" maxlength="150" value="${esc(s.bankAccountName)}"></label><label><span class="lbl">Account no.</span><input name="bankAccountNo" maxlength="40" value="${esc(s.bankAccountNo)}"></label></div>
        <div class="fields"><label><span class="lbl">IBAN</span><input name="iban" maxlength="40" value="${esc(s.iban)}" placeholder="AE.."></label><label><span class="lbl">SWIFT</span><input name="swift" maxlength="15" value="${esc(s.swift)}"></label></div></section>
      <section class="panel"><h2>Defaults and numbering</h2>
        <div class="fields"><label><span class="lbl">Invoice due after (days)</span><input name="dueDays" class="num" value="${s.dueDays}"></label><label><span class="lbl">Quotation valid for (days)</span><input name="quoteValidDays" class="num" value="${s.quoteValidDays}"></label><label><span class="lbl">Financial year starts</span><select name="fyStartMonth">${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => `<option value="${i + 1}"${s.fyStartMonth === i + 1 ? " selected" : ""}>${m}</option>`).join("")}</select></label></div>
        <div class="fields">${Object.keys(D.types).map(k => `<label><span class="lbl">${esc(NAME[k])} prefix</span><input data-px="${k}" maxlength="12" value="${esc(s.prefixes[k])}"></label>`).join("")}</div>
        <p class="hint" style="margin:0">Numbers run on from the last one used (e.g. INV-00042). Tax invoices and tax credit notes are numbered only when issued, so the sequence has no gaps.</p>
        <label><span class="lbl">Default invoice terms</span><textarea name="invoiceTerms" rows="2" maxlength="1500">${esc(s.invoiceTerms)}</textarea></label>
        <label><span class="lbl">Default quotation terms</span><textarea name="quoteTerms" rows="3" maxlength="3000">${esc(s.quoteTerms)}</textarea></label>
        <label><span class="lbl">Default purchase order terms</span><textarea name="poTerms" rows="2" maxlength="1500">${esc(s.poTerms)}</textarea></label>
        <label><span class="lbl">Footer line on every document</span><input name="footer" maxlength="300" value="${esc(s.footer)}"></label></section>
      <section class="panel"><h2>Lock date</h2>
        <div class="fields"><label><span class="lbl">Books locked up to and including</span><input type="date" name="lockDate" value="${esc(s.lockDate)}" ${P.manager ? "" : "disabled"}></label></div>
        <p class="hint" style="margin:0">Set this to the last day of a VAT period once its return is filed. Nothing on or before it can be created, edited or voided. ${P.manager ? "" : "Only a manager can change it."}</p></section>
      <section class="panel"><h2>Readiness check</h2><div class="check">
        ${chk(!s.vatRegistered || /^\d{15}$/.test(s.trn), "Company TRN recorded for tax invoices")}
        ${chk(!!s.address && !!s.legalName, "Legal name and address recorded")}
        ${chk(!!s.iban, "Bank details printed on invoices", true)}
        ${chk(!activeNoTrn.length, activeNoTrn.length ? `${activeNoTrn.length} customer(s) invoiced in the last year have no TRN on file (${esc(activeNoTrn.slice(0, 4).map(c => c.name).join(", "))}${activeNoTrn.length > 4 ? "…" : ""}). B2B e-invoices need the buyer's TRN where they are registered.` : "Customers invoiced in the last year all have a TRN on file", true)}
        ${chk(!custs.some(c => c.trn && !/^\d{15}$/.test(c.trn)), custs.some(c => c.trn && !/^\d{15}$/.test(c.trn)) ? `${custs.filter(c => c.trn && !/^\d{15}$/.test(c.trn)).length} customer TRN(s) are not 15 digits; tax invoices to them can't be issued until corrected` : "Customer TRNs on file are all 15 digits")}
        ${(() => { const used = new Set(D.docs.filter(d => d.status === "posted" && BK.domesticInput(d) && d.contactId).map(d => d.contactId)); const un = [...used].filter(id => !supplierVerified(id)); return chk(!un.length, un.length ? `${un.length} supplier(s) you claim input VAT from aren't verified yet (FTA Decision No. 13 of 2026): ${esc(un.slice(0, 4).map(contactName).join(", "))}${un.length > 4 ? "…" : ""}` : "Every supplier you claim input VAT from has a verification record", true); })()}
        ${chk(!noAddr.length, noAddr.length ? `${noAddr.length} customer(s) have no address on file` : "Every customer has an address", true)}
        ${chk(!!s.lockDate, s.lockDate ? `Books locked up to ${fd(s.lockDate)}` : "No lock date yet: lock each VAT period after filing", true)}
        ${chk(false, "E-invoicing (businesses under AED 50M revenue): appoint an FTA Accredited Service Provider by 31 Mar 2027; e-invoices become mandatory from 1 Jul 2027. Every invoice here already carries the data an ASP needs (TRNs, addresses, line VAT, sequential numbers).", true)}
      </div></section>
      <div class="err" id="err"></div><div class="edfoot"><button type="submit" class="primary" id="save">Save settings</button></div></form>`, "settings");
  $("sf").onsubmit = async e => {
    e.preventDefault(); const f = e.target; const v = Object.fromEntries(new FormData(f)); v.vatRegistered = f.vatRegistered.checked; v.prefixes = {}; f.querySelectorAll("[data-px]").forEach(i => v.prefixes[i.dataset.px] = i.value); if (!P.manager) v.lockDate = s.lockDate; v.etag = s.etag;
    const b = $("save"); busy(b, true); $("err").textContent = "";
    try { await api("PUT", "settings", v); await load(); toast("Settings saved."); settingsView(); } catch (err) { $("err").textContent = err.message; busy(b, false); }
  };
}

/* ---------- start ---------- */
let started = false;
async function start(m) {
  if (started || !m) return; started = true;
  ME = m; if (ME.noAccess) return;
  if (ME.co === "all") { $("app").innerHTML = `<div class="empty"><strong>Books work one company at a time</strong>Switch to Bifold or Tech Hub in the top bar.</div>`; return; }
  try { await load(); route(); } catch (err) { $("app").innerHTML = `<div class="empty"><strong>Couldn't open the books</strong>${esc(err.message)}</div>`; }
}
document.addEventListener("bifold:me", e => start(e.detail));
if (window.BIFOLD_ME && window.BIFOLD_BRAND && document.querySelector(".bx-side")) start(window.BIFOLD_ME);
})();
