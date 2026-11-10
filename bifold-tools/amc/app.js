// Bifold Tools: AMC Tracker. Talks to /api/amc/* (bifold-tools-api/src/amc.js) and the shared /api/customers list.
(function(){
"use strict";
/* ============ constants ============ */
const RANJAN = "ranjan@bifoldtech.com";
const LIB = {
  docx: "https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js",
  jspdf: "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
  autotable: "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js",
  jszip: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
};
// Company branding: everything a document or screen says about "us" comes from here.
const BRANDS = {
  bifold: { key: "bifold", name: "Bifold Technologies LLC", short: "Bifold", desk: "the Bifold service desk", phone: "+971 04 264 0374", web: "bifoldtech.com",
    hours: "Mon–Sat, 9 AM – 6 PM", hoursLarge: "Mon–Sat, 8 AM – 8 PM", manager: "Ranjan",
    images: ["/assets/amc/bifold_logo.png", "/assets/amc/ranjan_signature.png", "/assets/amc/bifold_stamp.png"],
    about: { paragraphs: [
      "Bifold Technologies LLC is a Dubai-based enterprise ICT solutions and managed services provider serving large enterprise, hospitality, fitness, government, and education clients across the United Arab Emirates. We design, deploy, and operate mission-critical IT and communications infrastructure with a focus on networking, server platforms, unified communications and telephony, cybersecurity, structured cabling, and ongoing managed support.",
      "Our managed services practice supports clients under structured Annual Maintenance Contracts that combine onsite engineering attendance, remote monitoring, vendor escalation, and clear service-level commitments. Each engagement is anchored by a named delivery team and underpinned by documented procedures, escalation matrices, and reporting cadence."],
      strengths: ["Vendor-certified engineering capability across Avaya, HPE, Cisco, Aruba, Fortinet, Veeam, and Microsoft platforms.", "Dedicated managed services delivery model with named account ownership.", "Voice, network and security experience across hospitality, commercial and government environments in the UAE.", "Local presence in Dubai with rapid onsite response capability across the Emirates."] } },
  techhub: { key: "techhub", name: "Tech Hub Information Technology", short: "Tech Hub", desk: "the Tech Hub support desk", phone: "+971 07 258 1926", web: "techhubrak.ae",
    hours: "Sun–Thu, 9 AM – 6 PM", hoursLarge: "Sun–Thu, 8 AM – 8 PM", manager: "Ranjan",
    images: ["/assets/techhub/techhub_logo.png"],
    about: { paragraphs: [
      "Tech Hub Information Technology is an IT solutions provider based in Al Nakheel, Ras Al Khaimah, serving businesses, schools, hospitality and government entities across RAK and the wider UAE. We supply, install and support IT infrastructure, from servers, networks and endpoints to CCTV and telephony.",
      "Our maintenance contracts combine scheduled preventive maintenance with SLA-backed remote and on-site support, so that unplanned downtime becomes a fixed, budgeted annual cost."],
      strengths: ["Single-source IT partner for supply, installation and ongoing support.", "SLA-backed support with defined response and resolution targets.", "Proactive preventive maintenance and patch management.", "RAK-wide delivery with fast on-site response."] } },
};
const B = () => BRANDS[S.co === "techhub" ? "techhub" : "bifold"];
const STATUS = { draft: "Draft", sent: "Proposal sent", awarded: "Awarded", lost: "Lost" };
const PM_LABEL = { 0: "No scheduled PM", 1: "Monthly", 3: "Quarterly", 6: "Every 6 months", 12: "Once a year" };

/* ============ state ============ */
const S = { me: null, meId: null, isAdmin: false, features: { ai: false, mail: false }, can: { amc: true, visits: true },
  customers: new Map(), amcs: new Map(), contracts: new Map(), visits: new Map(), amcFilter: "all", visitFilter: "upcoming",
  openAmc: null, openVisit: null, draftFiles: [], ready: false };

async function api(method, path, body) {
  let r;
  try { r = await fetch("/api/" + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, cache: "no-store" }); }
  catch { throw new Error("Can't reach the server. Check your connection and try again."); }
  const ct = r.headers.get("content-type") || "";
  if (r.redirected || (r.ok && r.status !== 204 && !ct.includes("json"))) throw new Error("Your session has ended. Reload the page to sign in again.");
  let j = null; if (r.status !== 204) { try { j = await r.json(); } catch {} }
  if (!r.ok) { const e = new Error((j && j.error) || "The request failed."); e.status = r.status; throw e; }
  return j;
}
/* ============ utils ============ */
const $ = id => document.getElementById(id);
const noEm = v => String(v == null ? "" : v).replace(/\s*\u2014\s*/g, ", ");
const deEm = o => typeof o === "string" ? noEm(o) : Array.isArray(o) ? o.map(deEm) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deEm(v)])) : o;
const esc = v => noEm(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; };
const money = n => { const r = Math.round(n * 100) / 100; return r.toLocaleString("en-US", { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
const aed = n => "AED " + money(n);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, "0");
const isoOf = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = () => isoOf(new Date());
const parseISO = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const addMonths = (iso, n) => { const d = parseISO(iso); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return isoOf(d); };
const daysTo = iso => Math.round((parseISO(iso) - parseISO(today())) / 86400000);
const fmt = iso => GEN.fmtDate(iso);
const nowISO = () => new Date().toISOString();
const extOf = n => (String(n).match(/\.([a-z0-9]{1,6})$/i) || [, "file"])[1].toLowerCase();
const kb = b => b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
const safeName = s => String(s || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
const shortName = n => String(n || "").replace(/\b(LLC|L\.L\.C\.?|FZE|FZ-LLC|FZCO|Co\.?|Company|Limited|Ltd\.?|Est\.?|Establishment|Trading)\b/gi, "").replace(/\s+/g, " ").trim() || String(n || "");
const code = n => (shortName(n).split(/\s+/).filter(Boolean).map((w, i, a) => a.length > 1 ? w.slice(0, i < 2 ? 4 : 1) : w.slice(0, 8)).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "CUST").slice(0, 10);
let toastT;
function toast(msg, ms = 2600) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }
function errMsg(e) { if (!e) return "Something went wrong."; return e.message || String(e); }
function closeOn(dlg) { dlg.querySelectorAll("[data-close]").forEach(b => b.onclick = () => dlg.close()); }
document.querySelectorAll("dialog").forEach(closeOn);
function arm(btn, label, fn) { btn.onclick = async () => { if (!btn.classList.contains("armed")) { btn.classList.add("armed"); btn.dataset.t = btn.textContent; btn.textContent = label; setTimeout(() => { btn.classList.remove("armed"); if (btn.dataset.t) btn.textContent = btn.dataset.t; }, 3500); return; } btn.classList.remove("armed"); btn.textContent = btn.dataset.t; await fn(); }; }
const loaded = {};
function loadScript(src) { return loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error("Could not load a document library. Check your connection and try again.")); }; document.head.appendChild(s); })); }
async function libDocx() { await loadScript(LIB.docx); return window.docx; }
async function libZip() { await loadScript(LIB.jszip); return window.JSZip; }
let thTpl = null;
async function thTemplate() { if (!thTpl) { const r = await fetch("/assets/techhub/base_template.docx"); if (!r.ok) throw new Error("The Tech Hub template is missing from the site."); thTpl = await r.arrayBuffer(); } return thTpl; }
async function libPdf() { await loadScript(LIB.jspdf); await loadScript(LIB.autotable); return window.jspdf.jsPDF; }
function busy(btn, on, label) { if (!btn) return; if (on) { btn.dataset.t = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + esc(label || "Working"); } else { btn.disabled = false; if (btn.dataset.t) btn.innerHTML = btn.dataset.t; } }

/* ============ brand images ============ */
let brandP;
function b64(bytes) { let s = ""; const ch = 0x8000; for (let i = 0; i < bytes.length; i += ch) s += String.fromCharCode.apply(null, bytes.subarray(i, i + ch)); return btoa(s); }
async function loadPng(path) { const r = await fetch(path); if (!r.ok) throw new Error("brand image missing"); const buf = new Uint8Array(await r.arrayBuffer()); const dv = new DataView(buf.buffer); return { bytes: buf, w: dv.getUint32(16), h: dv.getUint32(20), fmt: "PNG", dataUrl: "data:image/png;base64," + b64(buf) }; }
const brandPs = {};
function brand() { const b = B(); return brandPs[b.key] || (brandPs[b.key] = Promise.all(b.images.map(p => loadPng(p).catch(() => null))).then(([logo, sig, stamp]) => ({ logo, sig: sig || null, stamp: stamp || null }))); }

/* ============ files assets ============ */
const toB64 = async blob => { const u = new Uint8Array(await blob.arrayBuffer()); return b64(u); };
async function uploadFile(file) {
  if (file.size > 10 * 1048576) throw new Error(file.name + " is larger than 10 MB.");
  return api("POST", "amc/files", { name: file.name, type: file.type || "application/octet-stream", data: await toB64(file) });
}
async function fileBlob(f) {
  const r = await fetch("/api/amc/files/" + encodeURIComponent(f.id) + "/download", { cache: "no-store" });
  if (!r.ok) throw new Error("That file is no longer available.");
  return await r.blob();
}
async function save(filename, data) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); return true;
}
async function downloadFile(f, btn) { busy(btn, true, ""); try { await save(f.name, await fileBlob(f)); } catch (e) { toast(errMsg(e)); } finally { busy(btn, false); } }
function filesHTML(list, canDel) {
  if (!list || !list.length) return '<div class="muted small">No files yet.</div>';
  return list.map((f, i) => `<div class="file"><span class="ext">${esc(extOf(f.name))}</span><span class="nm" title="${esc(f.name)}">${esc(f.name)}</span><span class="sub">${kb(f.size || 0)}</span><button type="button" class="sm" data-dl="${i}">Download</button>${canDel ? `<button type="button" class="ghost sm" data-rm="${i}" aria-label="Remove ${esc(f.name)}">✕</button>` : ""}</div>`).join("");
}
function wireDrop(drop, input, onFiles) {
  input.onchange = () => { if (input.files.length) onFiles([...input.files]); input.value = ""; };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); };
}

/* ============ db paths ============ */
// Every change goes through the API, which checks access and returns the full saved record.
async function writeAmc(a, patch, logText) {
  const body = {}; ["customerId", "systems", "value", "status", "proposal", "proposalSource", "proposalStatus", "files", "proposedStart", "termMonths", "terms"].forEach(k => { if (patch[k] !== undefined) body[k] = patch[k]; });
  if (logText) body.log = logText;
  const full = await api("PUT", "amc/amcs/" + encodeURIComponent(a.id), body);
  full._full = true; S.amcs.set(full.id, full); return full;
}
async function loadFull(id) { const full = await api("GET", "amc/amcs/" + encodeURIComponent(id)); full._full = true; S.amcs.set(id, full); return full; }

/* ============ derived ============ */
function contractState(c) {
  if (!c) return null;
  if (c.status === "renewed") return "renewed";
  if (c.status === "closed") return "closed";
  const d = daysTo(c.end);
  if (d < 0) return "expired";
  if (d <= (c.alertDays || 60)) return "expiring";
  return "active";
}
function amcState(a) {
  if (a.status !== "awarded") return a.status;
  const c = S.contracts.get(a.id); const st = contractState(c || { end: (a.award || {}).end, alertDays: (a.award || {}).alertDays });
  return st;
}
function chip(st) {
  const lab = { draft: "Draft", sent: "Proposal sent", awarded: "Awarded", lost: "Lost", active: "Active", expiring: "Expiring soon", expired: "Expired", renewed: "Renewed", closed: "Closed",
    scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled", overdue: "Overdue" }[st] || st;
  return `<span class="chip ${esc(st)}">${esc(lab)}</span>`;
}
function visitState(v) { if (v.status === "scheduled" && v.scheduledDate < today()) return "overdue"; return v.status; }
function termHTML(c) {
  if (!c) return '<span class="muted">-</span>';
  const st = contractState(c); const total = Math.max(1, daysTo(c.end) - daysTo(c.start)); const used = Math.min(total, Math.max(0, -daysTo(c.start)));
  const d = daysTo(c.end);
  const left = st === "renewed" ? "Renewed" : d < 0 ? `Expired ${-d} day${d === -1 ? "" : "s"} ago` : `${d} day${d === 1 ? "" : "s"} left`;
  return `<div class="term ${st}"><span class="small">${esc(fmt(c.start))} – ${esc(fmt(c.end))}</span><div class="track"><div class="fill" style="width:${Math.round(used / total * 100)}%"></div></div><span class="sub">${esc(left)}</span></div>`;
}
const nameOf = email => !email ? "-" : email === S.meId ? "You" : String(email).split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());

/* ============ routing ============ */
const VIEWS = ["overview", "amcs", "visits"];
// Team access: without the AMC section, proposals and contract values are hidden; without the visits
// section, visits are read-only. The API enforces the same rules.
function applyCan() {
  const c = S.can;
  document.querySelectorAll('nav.tabs a[data-v="amcs"], [data-act="new-amc"], [data-act="export-amcs"]').forEach(el => el.hidden = !c.amc);
  document.querySelectorAll('[data-act="new-visit"]').forEach(el => el.hidden = !c.visits);
  document.querySelector("#v-overview .view-head p").textContent = c.amc ? `Contracts, renewals and site visits across ${B().short}'s maintenance book.` : `Maintenance visits for ${B().short}'s awarded contracts.`;
  route();
}
function route() {
  const open = VIEWS.filter(n => n !== "amcs" || S.can.amc);
  const v = open.includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
  if (location.hash && location.hash.slice(1) !== v) history.replaceState(null, "", "#" + v);
  VIEWS.forEach(n => { $("v-" + n).hidden = n !== v; });
  document.querySelectorAll("nav.tabs a").forEach(a => { if (a.dataset.v === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
}
addEventListener("hashchange", route);

/* ============ render ============ */
let rq = 0;
function renderAll() { cancelAnimationFrame(rq); rq = requestAnimationFrame(() => { renderAlerts(); renderOverview(); renderAmcs(); renderVisits(); if (S.openAmc && $("sAmc").open) renderAmcSheet(); }); }

function alertContracts() { return [...S.contracts.values()].filter(c => { const st = contractState(c); return st === "expiring" || st === "expired"; }).filter(c => daysTo(c.end) > -60).sort((a, b) => a.end.localeCompare(b.end)); }
function renderAlerts() {
  const list = alertContracts(); const bar = $("alertbar");
  if (!list.length) { bar.hidden = true; return; }
  bar.hidden = false;
  const first = list[0]; const d = daysTo(first.end);
  bar.innerHTML = `<b>${list.length} contract${list.length > 1 ? "s" : ""} need${list.length > 1 ? "" : "s"} renewal</b><span>${esc(first.customerName)} ${d < 0 ? "expired on" : "expires on"} ${esc(fmt(first.end))}${list.length > 1 ? ` and ${list.length - 1} more` : ""}.</span><button type="button" class="sm" id="alertGo">Review</button>`;
  $("alertGo").hidden = !S.can.amc;
  $("alertGo").onclick = () => { S.amcFilter = "expiring"; syncSeg("amcSeg", "expiring"); location.hash = "amcs"; renderAmcs(); };
}

function renderOverview() {
  const amcs = [...S.amcs.values()]; const contracts = [...S.contracts.values()]; const visits = [...S.visits.values()];
  const active = contracts.filter(c => ["active", "expiring"].includes(contractState(c)));
  const awardedValue = amcs.filter(a => a.status === "awarded" && ["active", "expiring"].includes(amcState(a))).reduce((s, a) => s + num(a.value), 0);
  const pipe = amcs.filter(a => a.status === "draft" || a.status === "sent");
  const exp = contracts.filter(c => contractState(c) === "expiring");
  const t = today(), in14 = addDays(t, 14);
  const due = visits.filter(v => v.status === "scheduled" && v.scheduledDate >= t && v.scheduledDate <= in14);
  const overdue = visits.filter(v => visitState(v) === "overdue");
  const doneMonth = visits.filter(v => v.status === "completed" && (v.completedDate || v.scheduledDate || "").slice(0, 7) === t.slice(0, 7));
  $("kpis").innerHTML = [
    ["Active contracts", active.length, `${exp.length} expiring soon`, exp.length > 0],
    ["Awarded annual value", aed(awardedValue), S.isAdmin ? "All active AMCs, excl. VAT" : "Your active AMCs, excl. VAT"],
    ["Open proposals", pipe.length, aed(pipe.reduce((s, a) => s + num(a.value), 0)) + " in pipeline"],
    ["Visits due in 14 days", due.length, `${doneMonth.length} completed this month`],
    ["Overdue visits", overdue.length, overdue.length ? "Scheduled date has passed" : "Nothing overdue", overdue.length > 0],
  ].filter(x => S.can.amc || !/value|proposals/i.test(x[0])).map(([k, v, s, hot]) => `<div class="kpi${hot ? " hot" : ""}"><span class="k">${esc(k)}</span><span class="v mono">${esc(v)}</span><span class="s">${esc(s)}</span></div>`).join("");

  const att = [];
  alertContracts().forEach(c => att.push({ when: c.end, html: `<span class="dateblock late"><div class="m">${esc(fmt(c.end).split(" ")[1] || "")}</div><div class="d">${esc(fmt(c.end).split(" ")[0])}</div></span><span><span class="t">${esc(c.customerName)}</span><br><span class="sub">${daysTo(c.end) < 0 ? "Contract expired. Start the renewal" : "Contract expires in " + daysTo(c.end) + " days"} · ${esc(c.ref)}</span></span>${chip(contractState(c))}`, open: () => openAmcById(c.amcId) }));
  overdue.forEach(v => att.push({ when: v.scheduledDate, html: visitLiHTML(v), open: () => openVisit(v.id) }));
  amcs.filter(a => a.status === "sent" && a.sentAt && daysTo(a.sentAt.slice(0, 10)) < -14).forEach(a => att.push({ when: a.sentAt, html: `<span class="dateblock"><div class="m">Sent</div><div class="d">${Math.abs(daysTo(a.sentAt.slice(0, 10)))}d</div></span><span><span class="t">${esc(a.customerName)}</span><br><span class="sub">Proposal sent ${esc(fmt(a.sentAt))}. Follow up for a decision</span></span>${chip("sent")}`, open: () => openAmc(a) }));
  att.sort((a, b) => String(a.when).localeCompare(String(b.when)));
  listInto($("attention"), att.slice(0, 8), S.ready ? "Nothing needs attention right now." : "Loading…");
  const nx = visits.filter(v => v.status === "scheduled" || v.status === "in_progress").filter(v => v.scheduledDate >= t).sort((a, b) => (a.scheduledDate + (a.time || "")).localeCompare(b.scheduledDate + (b.time || ""))).slice(0, 8);
  listInto($("nextVisits"), nx.map(v => ({ html: visitLiHTML(v), open: () => openVisit(v.id) })), S.ready ? "No visits scheduled. Mark an AMC as awarded to plan its PM visits." : "Loading…");
}
function visitLiHTML(v) {
  const st = visitState(v); const [d, m] = fmt(v.scheduledDate).split(" ");
  return `<span class="dateblock${st === "overdue" ? " late" : ""}"><div class="m">${esc(m || "")}</div><div class="d">${esc(d || "")}</div></span><span><span class="t">${esc(v.customerName)}</span><br><span class="sub">${esc(GEN.typeLabel(v.type))}${v.time ? " · " + esc(v.time) : ""}${v.engineers ? " · " + esc(v.engineers) : ""}</span></span>${chip(st)}`;
}
function listInto(box, items, emptyText) {
  box.innerHTML = ""; if (!items.length) { box.innerHTML = `<div class="empty"><span>${esc(emptyText)}</span></div>`; return; }
  items.forEach(it => { const b = document.createElement("button"); b.type = "button"; b.className = "li"; b.innerHTML = it.html; b.onclick = it.open; box.appendChild(b); });
}

function syncSeg(id, val) { $(id).querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.f === val))); }
$("amcSeg").onclick = e => { const b = e.target.closest("button"); if (!b) return; S.amcFilter = b.dataset.f; syncSeg("amcSeg", S.amcFilter); renderAmcs(); };
$("visitSeg").onclick = e => { const b = e.target.closest("button"); if (!b) return; S.visitFilter = b.dataset.f; syncSeg("visitSeg", S.visitFilter); renderVisits(); };
["amcSearch", "visitSearch"].forEach(id => $(id).oninput = () => renderAll());
$("visitContract").onchange = renderVisits;

function renderAmcs() {
  const q = $("amcSearch").value.trim().toLowerCase(); const f = S.amcFilter;
  const all = [...S.amcs.values()].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const rows = all.filter(a => {
    const st = amcState(a);
    if (f === "open" && !(a.status === "draft" || a.status === "sent")) return false;
    if (f === "awarded" && a.status !== "awarded") return false;
    if (f === "expiring" && !(st === "expiring" || st === "expired")) return false;
    if (f === "closed" && !(a.status === "lost" || st === "expired" || st === "renewed" || st === "closed")) return false;
    return !q || [a.ref, a.customerName, a.systems].join(" ").toLowerCase().includes(q);
  });
  $("nAmcs").textContent = all.length;
  $("amcCount").textContent = rows.length + " of " + all.length;
  $("amcScope").textContent = S.isAdmin ? "Full access: every AMC created by the team." : "AMCs you created. Managers see every AMC.";
  const tb = $("amcRows"); tb.innerHTML = "";
  rows.forEach(a => {
    const tr = document.createElement("tr"); tr.className = "click"; tr.tabIndex = 0;
    const c = S.contracts.get(a.id);
    tr.innerHTML = `<td><span class="ref">${esc(a.ref)}</span>${a.proposalStatus === "generating" ? '<div class="sub"><span class="spin"></span> Drafting proposal</div>' : ""}</td><td><b>${esc(a.customerName)}</b></td><td class="small" style="max-width:300px">${esc(String(a.systems || "").split("\n").slice(0, 2).join(" · "))}</td><td class="r mono">${esc(money(num(a.value)))}</td><td>${chip(amcState(a))}</td><td>${a.status === "awarded" ? termHTML(c || a.award) : '<span class="muted small">Not awarded</span>'}</td><td class="small">${esc(nameOf(a.owner))}</td>`;
    tr.onclick = () => openAmc(a); tr.onkeydown = e => { if (e.key === "Enter") openAmc(a); };
    tb.appendChild(tr);
  });
  $("amcEmpty").hidden = !(S.ready && !all.length);
  if (S.ready && all.length && !rows.length) tb.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No AMCs match this filter.</td></tr>`;
}

function renderVisits() {
  const q = $("visitSearch").value.trim().toLowerCase(); const f = S.visitFilter; const cf = $("visitContract").value; const t = today();
  const all = [...S.visits.values()];
  $("nVisits").textContent = all.filter(v => v.status === "scheduled" || v.status === "in_progress").length;
  const sel = $("visitContract"); const cur = sel.value;
  sel.innerHTML = '<option value="">All contracts</option>' + [...S.contracts.values()].sort((a, b) => a.customerName.localeCompare(b.customerName)).map(c => `<option value="${esc(c.amcId)}">${esc(c.customerName)} · ${esc(c.ref)}</option>`).join("");
  sel.value = cur;
  let rows = all.filter(v => {
    const st = visitState(v);
    if (f === "upcoming" && !((v.status === "scheduled" || v.status === "in_progress") && v.scheduledDate >= t) && v.status !== "in_progress") return false;
    if (f === "overdue" && st !== "overdue") return false;
    if (f === "completed" && v.status !== "completed") return false;
    if (cf && v.amcId !== cf) return false;
    return !q || [v.customerName, v.engineers, v.reportNo, v.ref].join(" ").toLowerCase().includes(q);
  });
  rows.sort((a, b) => f === "completed" || f === "all" ? (b.scheduledDate || "").localeCompare(a.scheduledDate || "") : (a.scheduledDate || "").localeCompare(b.scheduledDate || ""));
  $("visitCount").textContent = rows.length + " visit" + (rows.length === 1 ? "" : "s");
  const tb = $("visitRows"); tb.innerHTML = "";
  rows.forEach(v => {
    const tr = document.createElement("tr"); tr.className = "click"; tr.tabIndex = 0;
    tr.innerHTML = `<td><b>${esc(fmt(v.scheduledDate))}</b>${v.time ? `<div class="sub">${esc(v.time)}</div>` : ""}</td><td><b>${esc(v.customerName)}</b><div class="ref">${esc(v.ref)}</div></td><td class="small">${esc(GEN.typeLabel(v.type))}</td><td class="small">${esc(v.engineers || "-")}</td><td>${chip(visitState(v))}</td><td class="small">${v.status === "completed" ? `<span class="ref">${esc(v.reportNo || "")}</span><div class="sub">${(v.photos || []).length} photo${(v.photos || []).length === 1 ? "" : "s"}</div>` : '<span class="muted">-</span>'}</td>`;
    tr.onclick = () => openVisit(v.id); tr.onkeydown = e => { if (e.key === "Enter") openVisit(v.id); };
    tb.appendChild(tr);
  });
  $("visitEmpty").hidden = !(S.ready && !rows.length);
}

/* ============ customers ============ */
let custCallback = null;
function openCustomer(c, cb) {
  custCallback = cb || null; $("fCust").reset(); $("c_err").textContent = ""; $("dCust").showModal(); $("c_name").focus();
}
$("fCust").onsubmit = async e => {
  e.preventDefault(); const v = id => $(id).value.trim();
  if (!v("c_name")) { $("c_err").textContent = "Enter the customer's company name."; return; }
  const btn = $("c_save"); busy(btn, true, "Adding");
  try {
    const c = await api("POST", "customers", { name: v("c_name"), contactName: v("c_contact"), phone: v("c_phone"), email: v("c_email"), trn: v("c_trn"), emirate: $("c_emirate").value, address: v("c_address") });
    S.customers.set(c.id, c); $("dCust").close(); toast(c.name + " added to customers"); if (custCallback) custCallback(c.id); renderAll();
  } catch (err) {
    if (err.status === 409) { await refreshCustomers(); }
    $("c_err").textContent = errMsg(err);
  } finally { busy(btn, false); }
};
async function refreshCustomers() { try { const list = await api("GET", "customers"); S.customers.clear(); list.forEach(c => S.customers.set(c.id, c)); } catch {} }
/* ============ amc create edit ============ */
let editingAmc = null;
function fillCustomerSelect(sel, selected) {
  const list = [...S.customers.values()].sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = '<option value="">Select a customer…</option>' + list.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  sel.value = selected || "";
}
function valueHint() { const v = num($("a_value").value); $("a_valueHint").textContent = v ? `+ VAT 5% ${money(v * 0.05)} = ${aed(v * 1.05)} total` : ""; }
$("a_value").oninput = valueHint;
$("a_newCust").onclick = () => openCustomer(null, id => fillCustomerSelect($("a_customer"), id));
function renderDraftFiles() {
  $("a_files").innerHTML = filesHTML(S.draftFiles, true);
  $("a_files").querySelectorAll("[data-dl]").forEach(b => b.onclick = () => downloadFile(S.draftFiles[+b.dataset.dl], b));
  $("a_files").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { S.draftFiles.splice(+b.dataset.rm, 1); renderDraftFiles(); });
}
wireDrop($("a_drop"), $("a_fileInput"), async files => {
  for (const f of files) { const row = document.createElement("div"); row.className = "file"; row.innerHTML = `<span class="spin"></span><span class="nm">${esc(f.name)}</span>`; $("a_files").appendChild(row);
    try { S.draftFiles.push(await uploadFile(f)); } catch (e) { toast(errMsg(e)); } }
  renderDraftFiles();
});
/* contract details on the AMC form: defaults follow the template until the creator changes them */
const PAY_TEXT = {
  annual: ["Annual advance payment: 100% due on contract signing."],
  semi: ["Semi-annual payment: 50% on contract signing and 50% at the start of month 7."],
  quarterly: ["Quarterly payment in advance: four equal instalments of 25%, the first due on contract signing."],
  monthly: ["Monthly payment in advance: twelve equal instalments, the first due on contract signing."],
};
const PM_TEXT = { monthly: "Monthly", quarterly: "Quarterly", semiannual: "Every 6 months", annual: "Once a year", none: "Not included" };
const PM_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12, none: 0 };
const touched = new Set();
const defStart = () => addMonths(today().slice(0, 8) + "01", 1);
const endFor = (start, months) => start ? addDays(addMonths(start, +months || 12), -1) : "";
function applyDefaults() {
  const v = num($("a_value").value), small = !v || v < 15000, cust = S.customers.get($("a_customer").value) || {};
  const set = (id, val) => { if (!touched.has(id)) $(id).value = val; };
  set("a_start", defStart()); set("a_end", endFor($("a_start").value, $("a_months").value));
  set("a_attn", cust.contactName || ""); set("a_loc", cust.emirate && cust.emirate !== "Outside UAE" ? cust.emirate + ", UAE" : "Dubai, UAE");
  set("a_pm", small ? "quarterly" : "monthly"); set("a_pay", small ? "annual" : "semi");
  set("a_cov", v > 60000 ? B().hoursLarge : B().hours);
}
["a_start", "a_months", "a_end", "a_attn", "a_loc", "a_pm", "a_pay", "a_cov", "a_valid"].forEach(id => $(id).addEventListener("input", () => { touched.add(id); if (id === "a_start" || id === "a_months") applyDefaults(); }));
["a_start", "a_months", "a_pm", "a_pay", "a_valid"].forEach(id => $(id).addEventListener("change", () => { touched.add(id); applyDefaults(); }));
$("a_customer").addEventListener("change", applyDefaults); $("a_value").addEventListener("input", applyDefaults);
function readTerms() {
  return { proposedStart: $("a_start").value, termMonths: +$("a_months").value,
    terms: { endDate: $("a_end").value, attention: $("a_attn").value.trim(), location: $("a_loc").value.trim(), pm: $("a_pm").value, payment: $("a_pay").value, coverage: $("a_cov").value.trim(), validDays: +$("a_valid").value } };
}
function openAmcForm(a) {
  editingAmc = a || null;
  touched.clear();
  const t = (a && a.terms) || {};
  $("a_start").value = (a && a.proposedStart) || ""; $("a_months").value = String((a && a.termMonths) || 12); $("a_end").value = t.endDate || "";
  $("a_attn").value = t.attention || ""; $("a_loc").value = t.location || ""; $("a_pm").value = t.pm || "quarterly"; $("a_pay").value = t.payment || "annual";
  $("a_cov").value = t.coverage || ""; $("a_valid").value = String(t.validDays || 30);
  if (a) { ["a_start", "a_months", "a_end", "a_valid"].forEach(id => touched.add(id)); ["attention:a_attn", "location:a_loc", "pm:a_pm", "payment:a_pay", "coverage:a_cov"].forEach(p => { const [k, id] = p.split(":"); if (t[k]) touched.add(id); }); if (!a.proposedStart) touched.delete("a_start"); if (!t.endDate) touched.delete("a_end"); }
  $("a_more").open = !!a;
  $("dAmcTitle").textContent = a ? "Edit AMC " + a.ref : "New AMC";
  fillCustomerSelect($("a_customer"), a ? a.customerId : "");
  $("a_systems").value = a ? a.systems || "" : ""; $("a_value").value = a ? money(num(a.value)) : ""; valueHint();
  S.draftFiles = a ? (a.files || []).slice() : []; renderDraftFiles();
  $("a_filesWrap").hidden = false;
  $("a_note").textContent = a ? "Changing the systems or value marks the proposal for redrafting." : (S.features.ai ? `Claude drafts the rest of the proposal in the ${B().short} AMC format after you save.` : "The proposal is filled from the Bifold AMC template after you save.");
  $("a_err").textContent = ""; applyDefaults(); $("dAmc").showModal();
}
$("fAmc").onsubmit = async e => {
  e.preventDefault();
  const cid = $("a_customer").value, systems = $("a_systems").value.trim(), value = num($("a_value").value);
  if (!cid) { $("a_err").textContent = "Choose a customer, or add a new one."; return; }
  if (!systems) { $("a_err").textContent = "Describe the systems the AMC covers."; return; }
  if (!(value > 0)) { $("a_err").textContent = "Enter the annual AMC value in AED, excluding VAT."; return; }
  const cust = S.customers.get(cid);
  const T = readTerms();
  if (T.terms.endDate && T.proposedStart && T.terms.endDate <= T.proposedStart) { $("a_err").textContent = "The contract end date must be after the start date."; $("a_more").open = true; return; }
  busy($("a_save"), true, "Saving");
  try {
    if (editingAmc) {
      const changed = editingAmc.systems !== systems || num(editingAmc.value) !== value || editingAmc.customerId !== cid;
      const patch = Object.assign({ customerId: cid, customerName: cust.name, systems, value, files: S.draftFiles }, T);
      const p = editingAmc.proposal;
      if (p && editingAmc.systems === systems && editingAmc.customerId === cid) {
        patch.proposal = deEm(assemble(Object.assign({}, editingAmc, T, { value }), cust, contentFromProposal(p))); patch.proposalSource = editingAmc.proposalSource || "template";
      }
      await writeAmc(editingAmc, patch, patch.proposal ? "Edited contract details (proposal updated)" : changed ? "Edited systems / value" : "Edited AMC details");
      $("dAmc").close(); toast("AMC updated"); renderAll();
    } else {
      const a = await api("POST", "amc/amcs", Object.assign({ customerId: cid, systems, value, files: S.draftFiles }, T));
      a._full = true; a.proposalStatus = "generating"; S.amcs.set(a.id, a);
      $("dAmc").close(); toast("AMC saved. Drafting the proposal now."); renderAll(); openAmc(a);
      generateProposal(a, "");
    }
  } catch (err) { $("a_err").textContent = errMsg(err); }
  finally { busy($("a_save"), false); }
};

/* ============ proposal content ============ */
function category(sys) { const s = String(sys).toLowerCase(); if (/pbx|avaya|mitel|ip office|handset|ip phone|telephon|voip|sip trunk|pstn|call manager|cucm|3cx|voice/.test(s)) return "voice"; if (/cctv|camera|nvr|dvr|vms|surveillance|access control/.test(s)) return "cctv"; return "it"; }
function sizeOf(v) { return v < 15000 ? "small" : v <= 60000 ? "medium" : "large"; }
const PLAN = { voice: "IP Telephony Support Plan", cctv: "CCTV & Security Support Plan", it: "IT Infrastructure Support Plan" };
function fallbackContent(a, cust) {
  const cat = category(a.systems), size = sizeOf(num(a.value)); const sysLines = GEN.lines(a.systems); const sysOne = sysLines.join(", ");
  const streams = {
    voice: [["A. PBX System Support & Maintenance", ["Administration and support of the PBX platform.", "System configuration management and parameter tuning.", "Firmware and software updates as released and validated.", "Periodic backup of the system configuration."]],
      ["B. IP Telephone (Handset) Support", ["Support and troubleshooting of the covered handsets.", "Handset registration, reset, and reconfiguration.", "Configuration of replacement handsets (hardware supplied separately)."]],
      ["C. Call Routing & Features Administration", ["Extension and user moves, adds, and changes (MAC).", "Voicemail, auto-attendant, hunt group, and call routing configuration.", "Time profiles, call barring, and dial plan adjustments."]],
      ["D. PSTN / Trunk & Connectivity Coordination", ["Diagnosis of inbound and outbound call faults.", "Coordination with the telecom provider on line and trunk issues.", "Verification of line status and call quality."]]],
    cctv: [["A. NVR/DVR & Recording Platform Support", ["Administration and health monitoring of the recording platform.", "Firmware updates as released and validated.", "User account and permission management."]],
      ["B. Camera & Field Device Support", ["Troubleshooting of camera image, focus, and connectivity faults.", "Configuration of replacement cameras (hardware supplied separately).", "Verification of camera positioning and coverage."]],
      ["C. Storage, Retention & Playback", ["Monitoring of storage capacity and disk health.", "Verification of recording schedules and retention periods.", "Assistance with footage search and export on request."]],
      ["D. Network & Connectivity Coordination", ["Diagnosis of PoE and network faults affecting cameras.", "Coordination with the client IT team on network changes."]]],
    it: [["A. Daily IT Operations & Support", ["Remote helpdesk support for covered systems.", "Incident logging, diagnosis, and resolution.", "User administration requests within scope."]],
      ["B. Network & Systems Management", ["Monitoring and administration of switches, firewalls and wireless.", "Configuration changes, VLAN and policy updates on request.", "Firmware updates as released and validated."]],
      ["C. Server & Application Administration", ["Health checks of servers, storage and virtualisation hosts.", "Backup job verification and restore testing.", "Patch management in agreed maintenance windows."]],
      ["D. Cybersecurity & Compliance (Advisory)", ["Review of firewall policies and security alerts.", "Advisory recommendations on hardening and access control."]],
      ["E. Vendor & Asset Management", ["Coordination with OEMs and distributors on warranty and RMA cases.", "Maintenance of the asset register for covered equipment."]]],
  }[cat].map(([heading, bullets]) => ({ heading, bullets }));
  const n = streams.length; const L = l => String.fromCharCode(65 + l);
  streams.push({ heading: L(n) + ". Preventive Maintenance & Health Checks", bullets: ["Scheduled inspection of system health, logs, and licences.", "Verification of configuration backups and firmware status.", "Documented findings and recommendations after each visit."] });
  streams.push({ heading: L(n + 1) + ". Support Coordination & Reporting", bullets: ["Ticket logging, lifecycle management, and escalation.", "Periodic service reporting and status updates.", "Advisory on future requirements."] });
  const pm = size === "small" ? "Quarterly" : "Monthly";
  const rows = [["Service Plan", PLAN[cat].replace(" Plan", ""), "Annual maintenance package"], ["Covered Systems", sysLines.length + " item" + (sysLines.length === 1 ? "" : "s"), "As listed in Section 3"], ["Preventive Maintenance", pm, "Scheduled health checks"], ["Remote Support", "Business Hours", "Diagnosis and resolution"],
    ["Onsite Support", size === "large" ? "Scheduled + On-Call" : "On-Call + PM Visits", "Major faults and scheduled PM"], ["Configuration Changes", "Included", "Reasonable volume"], ["Firmware & Software Updates", "Included", "As released and validated"], ["Configuration Backup", "Included", "Periodic backup"],
    ["Email & Telephone Support", "Included", "Ticketing and P1 emergency line"], ["Named Engineer Contacts", size === "small" ? "2" : "3", "Primary and secondary engineers"], ["Coverage Hours", size === "large" ? B().hoursLarge : B().hours, "P1 best-effort outside hours"],
    ["Hardware & Spare Parts", "Excluded", "Quoted separately"], ["Vendor Licences & Subscriptions", "Excluded", "Client to hold valid entitlements"], ["Service Reports", pm, "Visit report after each PM"]];
  let sla = size === "large" ? [["P1", "Emergency: service down", "30 minutes", "1 hour", "4 hours"], ["P2", "High: significant impact", "1 hour", "2 hours", "8 hours"], ["P3", "Medium: limited impact", "2 hours", "Next business day", "2 business days"], ["P4", "Low: service request", "4 hours", "2 business days", "3 business days"]]
    : [["P1", "Emergency: system down", "1 hour", "2 hours", "8 business hours"], ["P2", "High: major feature or multiple users affected", "2 hours", "4 hours", "1 business day"], ["P3", "Medium: single user or minor feature", "4 hours", "Next business day", "2 business days"], ["P4", "Low: service request / change", "1 business day", "2 business days", "3 business days"]];
  // Tech Hub's house SLA (Critical / High / Medium / Low, Sun–Thu business hours).
  if (B().key === "techhub") sla = [["Critical", "System down / business-stopping", "1 hour (remote)", "4 hours on site", "Same business day target"], ["High", "Major function impaired", "2 hours (remote)", "Next business day on site", "Tracked to closure"],
    ["Medium", "Degraded service or single user", "4 hours (remote)", "Remote first", "Tracked to closure"], ["Low", "Request or advisory", "Next business day", "As scheduled", "Tracked to closure"]];
  const short = shortName(cust.name);
  return {
    subtitle: PLAN[cat], planName: PLAN[cat].replace(" Plan", ""), letterSubjectTopic: PLAN[cat].replace(" Plan", " Services"),
    letter: [`${B().name} is pleased to submit this Annual Maintenance Contract (AMC) proposal for the support and maintenance of the systems in use at ${cust.name}. The engagement covers ${sysOne}, with structured preventive maintenance, rapid fault diagnosis, and committed response timelines.`,
      `This proposal outlines the scope of services, response and restoration commitments, service hours, deliverables, exclusions, and commercial terms for a ${termWords(a)} engagement. The terms herein are valid for ${(a.terms && a.terms.validDays) || 30} days from the date of issue.`,
      "We look forward to the opportunity of supporting your operations and building a long-term partnership with your team."],
    understanding: { paragraphs: [`${cust.name} relies on the following systems for its day-to-day operations: ${sysOne}. Each element must remain available and correctly configured to sustain business continuity.`,
      `The engagement is to be delivered as an AMC providing ${pm.toLowerCase()} preventive maintenance, remote support during business hours, onsite attendance for major faults, configuration management, and committed response and restoration timelines aligned to incident priority.`],
      drivers: ["Continuous availability of the covered systems.", "Rapid fault diagnosis and restoration.", "Orderly configuration and change management.", "Vendor coordination on warranty and support cases.", "A single point of accountability for the covered estate."] },
    scope: { intro: "The following service streams are included within this engagement. The complete scope is delivered as a unified managed service package under a single annual fee.", streams },
    servicePlan: { intro: "The following table summarises the coverage parameters under the support package selected for this engagement.", rows },
    response: { intro: `All incidents logged with ${B().name} are classified by priority and managed against the following committed response and restoration timelines. Timelines are measured during covered business hours; Emergency (P1) incidents are handled on a best-effort basis outside business hours.`, rows: sla,
      workflow: [`Support requests are raised via phone or email to ${B().desk}.`, "Each request receives a ticket acknowledgement and reference number.", "Tickets are assigned to a named engineer based on priority and skill set.", "Engineers respond within the committed SLA timeline, remotely where possible.", "Incidents are resolved within the restoration target and closed with the client."] },
    documentation: { intro: `As part of the AMC engagement, ${B().name} will produce and maintain the following documentation set covering the in-scope systems at ${cust.name}.`, groups: [
      { heading: "System Documentation", bullets: ["Configuration overview of each covered system.", "Licensing and firmware version record."] },
      { heading: "Operational Documentation", bullets: ["Asset inventory for covered equipment.", "Configuration backup records.", "Escalation matrix and contact list."] },
      { heading: "Maintenance Records", bullets: ["Preventive maintenance visit reports with site photographs.", "Updated records reflecting all approved changes."] }] },
    exclusions: { groups: [
      { heading: "Scope Exclusions", bullets: ["Supply, repair, or replacement of hardware and spare parts.", "Software licences, version upgrades, and manufacturer support entitlements.", "Cabling, structured cabling, and new point installation.", "Major upgrades, migrations, or redesign projects.", "Site visits beyond the included onsite attendance (chargeable)."] },
      { heading: "Future Purchases", bullets: ["New hardware and software purchases are chargeable separately.", "This agreement covers engineering time and managed service delivery only.", "Installation of new equipment proceeds only after customer approval."] },
      { heading: "Customer Obligations", bullets: ["Provide reasonable remote and onsite access to the covered systems.", "Maintain valid vendor licences and support entitlements.", "Maintain power, network, and environmental conditions required by the equipment.", "Refrain from unauthorised changes or third-party repairs to in-scope systems."] },
      { heading: "Security & Responsibility Model", text: `${B().name} provides support and configuration services for the covered systems under this engagement. Responsibility for the security of the wider network, user accounts, and connected systems remains with the client. ${B().short} issues advisory recommendations on security hardening and access control.` },
      { heading: "Disclaimers & Liability", bullets: ["No liability for force majeure events outside the reasonable control of either party.", "The customer is responsible for the legality of all software in use.", "No software will be installed without written approval from the customer.", `${B().short} is not responsible for cyberattacks, toll fraud, hacking incidents, or resulting loss arising from factors outside its control.`] },
      { heading: "Confidentiality", bullets: [`This proposal is confidential and intended solely for the named recipient. It may not be reproduced or disclosed to any third party without the prior written consent of ${B().name}.`, `All ${B().short} engineers are bound by confidentiality obligations covering client systems, data, and operational information.`, "A non-disclosure agreement (NDA) will be executed before the first onsite visit, if not already in place."] },
      { heading: "System Size Assumption", text: `This agreement is based on the current footprint of ${sysOne}. Scope and commercials may be reviewed if the estate is materially expanded beyond this baseline.` }] },
    lineItemDesc: `Annual Maintenance Contract: ${PLAN[cat].replace(" Plan", "")} (${sysLines.join(", ").slice(0, 160)}), ${termMonthsOf(a.proposedStart || defStart(), (a.terms && a.terms.endDate) || endFor(a.proposedStart || defStart(), a.termMonths || 12))} Months`,
    paymentTerms: size === "small" ? ["Annual advance payment: 100% due on contract signing."] : ["Semi-annual payment: 50% on contract signing and 50% at the start of month 7."],
    _short: short,
  };
}
function validContent(c) { return c && typeof c === "object" && Array.isArray(c.letter) && c.scope && Array.isArray(c.scope.streams) && c.servicePlan && Array.isArray(c.servicePlan.rows) && c.response && Array.isArray(c.response.rows) && c.exclusions && Array.isArray(c.exclusions.groups); }
function assemble(a, cust, content) {
  const T = a.terms || {};
  const v = num(a.value), vat = Math.round(v * 0.05 * 100) / 100, total = v + vat;
  const t = today(); const start = a.proposedStart || defStart(); const end = T.endDate || endFor(start, a.termMonths || 12);
  const months = termMonthsOf(start, end); const validDays = T.validDays || 30; const valid = addDays(t, validDays);
  const short = shortName(cust.name);
  const attention = T.attention || cust.contactName || "The Management";
  const pay = (T.payment ? PAY_TEXT[T.payment] : content.paymentTerms && content.paymentTerms.length ? content.paymentTerms : PAY_TEXT.annual).concat(["Support engagement commences upon contract signing and receipt of the first payment.", "VAT applicable at the prevailing rate (currently 5%).", "Additional charges may apply for customer-caused damages or scope outside this agreement."]);
  // Contract details chosen on the form win over the drafted service-plan rows.
  const rows = (content.servicePlan.rows || []).map(r => r.slice());
  const setRow = (re, label, val, note) => { const r = rows.find(x => re.test(String(x[0]))); if (r) { r[1] = val; if (note) r[2] = note; } else rows.push([label, val, note || ""]); };
  if (T.pm) setRow(/^preventive maintenance/i, "Preventive Maintenance", PM_TEXT[T.pm], T.pm === "none" ? "Corrective support only" : "Scheduled health checks");
  if (T.pm && T.pm !== "none") { const r = rows.find(x => /service reports/i.test(x[0])); if (r) r[1] = PM_TEXT[T.pm]; }
  if (T.coverage) setRow(/^coverage hours/i, "Coverage Hours", T.coverage, /24/.test(T.coverage) ? "Round-the-clock cover" : "P1 best-effort outside hours");
  return {
    meta: { customer: cust.name, attention, proposalNo: a.ref, date: fmt(t), dateISO: t, validUntil: fmt(valid), validISO: valid, subtitle: content.subtitle, headerTitle: "AMC Proposal: " + short },
    letter: { toName: attention, toLocation: T.location || (cust.emirate && cust.emirate !== "Outside UAE" ? cust.emirate + ", UAE" : "Dubai, UAE"), subject: `Annual Maintenance Contract Proposal: ${content.letterSubjectTopic || content.planName} (Reference: ${a.ref})`, salutation: attention && attention !== "The Management" ? "Dear " + attention.split(",")[0].trim() + "," : "Dear Sir/Madam,", body: content.letter, signoff: "Sincerely," },
    about: B().about, understanding: content.understanding, scope: content.scope, servicePlan: Object.assign({}, content.servicePlan, { rows }), response: content.response, documentation: content.documentation,
    commercial: { intro: `The commercial terms set out below cover the full ${months}-month engagement from ${fmt(start)} to ${fmt(end)}.`, startISO: start, endISO: end, vatPct: 5, valueNum: v,
      lineItems: [{ desc: content.lineItemDesc || ("Annual Maintenance Contract: " + content.planName + ", 12 Months"), amount: money(v) }], subtotal: money(v), vat: money(vat), vatLabel: "VAT @ 5%", total: money(total), paymentTerms: pay,
      validity: ["All values are quoted in UAE Dirhams (AED).", `Proposal validity: ${validDays} days from the date of issue (valid until ${fmt(valid)}).`] },
    exclusions: content.exclusions,
    signoff: { intro: `By signing below, both parties acknowledge agreement to the scope, service levels, commercial terms, and conditions set out in this Annual Maintenance Contract proposal. This document, upon signature, constitutes the binding agreement between ${B().name} and ${cust.name} for the contract period stated.`, period: `${fmt(start)} to ${fmt(end)}`, plan: content.planName, total: `${aed(total)} (inclusive of VAT)`, governing: "This agreement is governed by the laws of the United Arab Emirates. Either party may terminate this agreement with two months prior written notice. Any material change in scope requires written approval from both parties." },
  };
}
function contentFromProposal(p) {
  const m = String(p.letter.subject || "").match(/Proposal(?: \u2014|:) (.*) \(Reference/);
  return { subtitle: p.meta.subtitle, planName: p.signoff.plan, letterSubjectTopic: m ? m[1] : p.signoff.plan, letter: p.letter.body, understanding: p.understanding, scope: p.scope,
    servicePlan: p.servicePlan, response: p.response, documentation: p.documentation, exclusions: p.exclusions, lineItemDesc: (p.commercial.lineItems[0] || {}).desc,
    paymentTerms: (p.commercial.paymentTerms || []).filter(x => !/commences upon|prevailing rate|Additional charges/.test(x)) };
}
function termWords(a) { const m = termMonthsOf(a.proposedStart || defStart(), (a.terms && a.terms.endDate) || endFor(a.proposedStart || defStart(), a.termMonths || 12)); return ({ 6: "six-month", 12: "twelve-month", 24: "twenty-four-month", 36: "thirty-six-month" })[m] || m + "-month"; }
function termMonthsOf(start, end) { return Math.max(1, Math.round((parseISO(end) - parseISO(start)) / 86400000 / 30.44)); }
// Claude drafts the proposal in four parts in parallel (server side, if set up); any part that fails
// is filled from the standard template, so a proposal is always produced.
async function generateProposal(a, notes) {
  const cust = S.customers.get(a.customerId) || { name: a.customerName };
  const base = fallbackContent(a, cust);
  let content = Object.assign({}, base), parts = 0;
  if (S.features.ai) {
    const T = a.terms || {};
    const fixed = [T.pm && "Preventive maintenance: " + PM_TEXT[T.pm], T.coverage && "Support hours: " + T.coverage, T.payment && "Payment: " + PAY_TEXT[T.payment][0]].filter(Boolean).join(". ");
    const allNotes = [fixed && "Contract details already agreed (match them): " + fixed, notes].filter(Boolean).join("\n");
    const req = part => api("POST", "amc/ai", { kind: "proposal", part, customerName: cust.name, location: T.location || cust.emirate || "", systems: a.systems, value: num(a.value), termMonths: a.termMonths || 12, notes: allNotes, renewal: !!a.renewalOf }).catch(() => null);
    const [intro, scope, service, terms] = await Promise.all(["intro", "scope", "service", "terms"].map(req));
    if (intro && Array.isArray(intro.letter) && intro.letter.length && intro.understanding) { Object.assign(content, { subtitle: intro.subtitle || base.subtitle, planName: intro.planName || base.planName, letterSubjectTopic: intro.letterSubjectTopic || base.letterSubjectTopic, letter: intro.letter, understanding: intro.understanding, lineItemDesc: intro.lineItemDesc || base.lineItemDesc, paymentTerms: Array.isArray(intro.paymentTerms) && intro.paymentTerms.length ? intro.paymentTerms : base.paymentTerms }); parts++; }
    if (scope && scope.scope && Array.isArray(scope.scope.streams) && scope.scope.streams.length) { content.scope = scope.scope; parts++; }
    if (service && service.servicePlan && Array.isArray(service.servicePlan.rows) && service.response && Array.isArray(service.response.rows)) { content.servicePlan = service.servicePlan; content.response = service.response; parts++; }
    if (terms && terms.exclusions && Array.isArray(terms.exclusions.groups) && terms.documentation) { content.documentation = terms.documentation; content.exclusions = terms.exclusions; parts++; }
  }
  const source = parts === 4 ? "claude" : parts ? "mixed" : "template";
  const cfg = deEm(assemble(a, cust, content));
  try {
    await writeAmc(S.amcs.get(a.id) || a, { proposal: cfg, proposalSource: source }, (notes ? "Redrafted proposal" : "Drafted proposal") + (source === "claude" ? " with Claude" : source === "mixed" ? " (Claude + template)" : " from template"));
    renderAll(); toast("Proposal ready for " + shortName(cust.name));
  } catch (e) {
    const cur = S.amcs.get(a.id); if (cur) { cur.proposalStatus = cur.proposal ? "ready" : "pending"; renderAll(); }
    toast("Couldn't save the proposal: " + errMsg(e), 5000);
  }
}
/* ============ proposal html preview email ============ */
function proposalHTML(cfg, forEmail) {
  const h = []; const P = t => `<p>${esc(t)}</p>`; const UL = arr => arr && arr.length ? "<ul>" + arr.map(x => `<li>${esc(x)}</li>`).join("") + "</ul>" : "";
  const TB = (head, rows) => `${forEmail ? "" : '<div class="tw">'}<table${forEmail ? ' border="1" cellpadding="6" cellspacing="0"' : ""}><thead><tr>${head.map(x => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => "<tr>" + r.map(c => `<td>${esc(c)}</td>`).join("") + "</tr>").join("")}</tbody></table>${forEmail ? "" : "</div>"}`;
  const groups = gs => (gs || []).map(g => (g.heading ? `<h3>${esc(g.heading)}</h3>` : "") + (g.text ? P(g.text) : "") + UL(g.bullets)).join("");
  const m = cfg.meta, L = cfg.letter, cm = cfg.commercial, so = cfg.signoff;
  if (!forEmail) h.push(`<div class="pcover"><span class="k">ANNUAL MAINTENANCE CONTRACT PROPOSAL</span><span class="t">${esc(m.subtitle)}</span><span>Prepared for ${esc(m.customer)} · ${esc(m.proposalNo)} · ${esc(m.date)} · valid until ${esc(m.validUntil)}</span></div>`);
  h.push(`<h2>1. Introduction</h2>${P("Subject: " + L.subject)}${P(L.salutation)}${L.body.map(P).join("")}`);
  if (!forEmail) h.push(`<h2>2. About ${esc(B().name)}</h2>${cfg.about.paragraphs.map(P).join("")}${UL(cfg.about.strengths)}`);
  h.push(`<h2>${forEmail ? "" : "3. "}Understanding of Requirement</h2>${(cfg.understanding.paragraphs || []).map(P).join("")}${UL(cfg.understanding.drivers)}`);
  h.push(`<h2>${forEmail ? "" : "4. "}Scope of Work</h2>${cfg.scope.intro ? P(cfg.scope.intro) : ""}${groups(cfg.scope.streams)}`);
  h.push(`<h2>${forEmail ? "" : "5. "}Service Plan Summary</h2>${TB(["Parameter", "Coverage", "Notes"], cfg.servicePlan.rows)}`);
  h.push(`<h2>${forEmail ? "" : "6. "}Response &amp; Restoration Commitments</h2>${cfg.response.intro ? P(cfg.response.intro) : ""}${TB(["Priority", "Description", "Response", "Action Plan", "Restoration Target"], cfg.response.rows)}${UL(cfg.response.workflow)}`);
  if (!forEmail) h.push(`<h2>7. Documentation Deliverables</h2>${cfg.documentation.intro ? P(cfg.documentation.intro) : ""}${groups(cfg.documentation.groups)}`);
  h.push(`<h2>${forEmail ? "" : "8. "}Commercial Terms</h2>${P(cm.intro)}${TB(["Line Item", "Amount (AED)"], cm.lineItems.map(li => [li.desc, li.amount]).concat([["Subtotal", cm.subtotal], [cm.vatLabel, cm.vat], ["Total Contract Value (incl. VAT)", cm.total]]))}<h3>Payment Terms</h3>${UL(cm.paymentTerms)}${UL(cm.validity)}`);
  if (!forEmail) h.push(`<h2>9. Exclusions, Assumptions &amp; Liability</h2>${groups(cfg.exclusions.groups)}<h2>10. Acceptance &amp; Sign-off</h2>${P(so.intro)}${P("Agreement Period: " + so.period)}${P("Service Plan: " + so.plan)}${P("Total Contract Value: " + so.total)}${P(so.governing)}`);
  return h.join("");
}

/* ============ document builders ============ */
async function buildProposal(a, kind) {
  const cfg = a.proposal; if (!cfg) throw new Error("Draft the proposal first.");
  const img = await brand(); GEN.useBrand(B().key);
  if (B().key === "techhub") {
    // Tech Hub proposals follow the approved Tech Hub template (8 sections), built from the same edited content.
    const th = GEN.thFromAmc(cfg, a.systems);
    if (kind === "docx") { const [Z, tpl] = await Promise.all([libZip(), thTemplate()]); return await GEN.thAmcDocx(Z, th, tpl); }
    const J = await libPdf(); return GEN.thAmcPdf(J, th, img).output("blob");
  }
  if (kind === "docx") { const D = await libDocx(); return await D.Packer.toBlob(GEN.amcDocx(D, cfg, img)); }
  const J = await libPdf(); return GEN.amcPdf(J, cfg, img).output("blob");
}
const propName = (a, ext) => safeName(`${a.ref} ${shortName(a.customerName)} AMC Proposal`) + "." + ext;
async function downloadProposal(a, kind, btn) { busy(btn, true, kind === "docx" ? "Word" : "PDF"); try { await save(propName(a, kind), await buildProposal(a, kind)); } catch (e) { toast(errMsg(e), 5000); } finally { busy(btn, false); } }

async function photoData(p) {
  const r = await fetch("/api/amc/files/" + encodeURIComponent(p.id)); if (!r.ok) return null;
  const buf = new Uint8Array(await r.arrayBuffer());
  return { bytes: buf, dataUrl: "data:image/jpeg;base64," + b64(buf), w: p.w || 1200, h: p.h || 900, caption: p.caption || "", type: "jpg" };
}
function visitCtx(v) { const c = S.contracts.get(v.amcId) || {}; return { systems: c.systems || "", plan: c.plan || "", site: c.site || "" }; }
async function buildVisit(v, kind) {
  const img = await brand(); GEN.useBrand(B().key); const photos = (await Promise.all((v.photos || []).map(photoData))).filter(Boolean);
  if (kind === "docx") { const D = await libDocx(); return await D.Packer.toBlob(GEN.visitDocx(D, v, visitCtx(v), img, photos)); }
  const J = await libPdf(); return GEN.visitPdf(J, v, visitCtx(v), img, photos).output("blob");
}
const visitName = (v, ext) => safeName(`${v.reportNo || "Visit"} ${shortName(v.customerName)} Maintenance Report`) + "." + ext;
async function buildContract(c, kind) {
  const img = await brand(); GEN.useBrand(B().key); const vs = [...S.visits.values()].filter(v => v.amcId === c.amcId).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  const cc = Object.assign({}, c, { pmLabel: PM_LABEL[c.pmMonths] || "" });
  if (kind === "docx") { const D = await libDocx(); return await D.Packer.toBlob(GEN.contractDocx(D, cc, vs, img)); }
  const J = await libPdf(); return GEN.contractPdf(J, cc, vs, img).output("blob");
}

/* ============ amc sheet ============ */
function openAmcById(id) {
  const a = S.amcs.get(id); if (a) return openAmc(a);
  const vs = [...S.visits.values()].filter(v => v.amcId === id).sort((x, y) => x.scheduledDate.localeCompare(y.scheduledDate));
  if (!S.can.amc && vs.length) { $("visitContract").value = id; S.visitFilter = "all"; syncSeg("visitSeg", "all"); location.hash = "visits"; renderVisits(); return; }
  toast(`You don't have access to this AMC. Ask ${B().manager} for access to AMC proposals.`);
}
function openAmc(a) { S.openAmc = a.id; renderAmcSheet(); if (!$("sAmc").open) $("sAmc").showModal(); }
$("sAmc").addEventListener("close", () => { S.openAmc = null; });
let loadingFull = null;
function renderAmcSheet() {
  const a = S.amcs.get(S.openAmc); if (!a) { $("sAmc").close(); return; }
  if (!a._full) {
    $("s_ref").textContent = a.ref; $("s_customer").textContent = a.customerName; $("s_chips").innerHTML = chip(amcState(a));
    $("s_body").innerHTML = '<div class="callout"><span class="spin"></span> Loading the AMC…</div>';
    if (loadingFull !== a.id) { loadingFull = a.id; loadFull(a.id).then(() => { loadingFull = null; if (S.openAmc === a.id) renderAmcSheet(); }).catch(e => { loadingFull = null; $("s_body").innerHTML = `<div class="callout bad">${esc(errMsg(e))}</div>`; }); }
    return;
  }
  const c = S.contracts.get(a.id); const st = amcState(a); const cust = S.customers.get(a.customerId) || {};
  $("s_ref").textContent = a.ref; $("s_customer").textContent = a.customerName;
  $("s_chips").innerHTML = chip(st) + (a.proposalStatus === "generating" ? ' <span class="chip gen"><span class="spin"></span> Drafting proposal</span>' : "") + ` <span class="chip">Owner: ${esc(nameOf(a.owner))}</span>`;
  const v = num(a.value);
  const body = [];
  body.push(`<div class="sec"><h3>Contract</h3><div class="facts">
    <div class="fact"><div class="k">Annual value</div><div class="v mono">${esc(aed(v))}</div><div class="sub">${esc(aed(v * 1.05))} incl. VAT</div></div>
    <div class="fact"><div class="k">Plan</div><div class="v">${esc(a.planName || "-")}</div></div>
    <div class="fact"><div class="k">Contact</div><div class="v">${esc(cust.contactName || "-")}</div><div class="sub">${esc(cust.email || "")}</div></div>
    <div class="fact"><div class="k">Created</div><div class="v">${esc(fmt(a.createdAt))}</div><div class="sub">by ${esc(nameOf(a.owner))}</div></div></div>
    <div class="systems">${esc(a.systems)}</div>
    <div class="docrow"><button type="button" class="sm" id="x_edit">Edit</button>${a.status !== "awarded" ? `<button type="button" class="primary sm" id="x_award">Mark as awarded</button>` : ""}${a.status === "draft" ? '<button type="button" class="sm" id="x_sent">Mark as sent</button>' : ""}${a.status === "draft" || a.status === "sent" ? '<button type="button" class="sm" id="x_lost">Mark as lost</button>' : ""}${a.status === "lost" ? '<button type="button" class="sm" id="x_reopen">Reopen</button>' : ""}</div></div>`);
  if (a.status === "awarded" && c) {
    const d = daysTo(c.end), cst = contractState(c);
    const cls = cst === "expired" ? "bad" : cst === "expiring" ? "warn" : cst === "renewed" ? "ok" : "";
    const msg = cst === "renewed" ? "This contract was renewed." : d < 0 ? `Expired ${-d} days ago on ${fmt(c.end)}.` : cst === "expiring" ? `Expires in ${d} days on ${fmt(c.end)}. Start the renewal now.` : `${d} days left. Expiry alert goes to ${c.notifyEmail} and ranjan@bifoldtech.com ${c.alertDays} days before ${fmt(c.end)}.`;
    const vs = [...S.visits.values()].filter(x => x.amcId === a.id).sort((x, y) => x.scheduledDate.localeCompare(y.scheduledDate));
    body.push(`<div class="sec"><h3>Awarded contract</h3>${termHTML(c)}<div class="callout ${cls}">${esc(msg)}${(cst === "expiring" || cst === "expired") && !c.renewalAmcId ? '<button type="button" class="sm" id="x_renew" style="margin-left:auto">Start renewal</button>' : ""}${c.renewalAmcId ? `<button type="button" class="linky" id="x_goRenewal" style="margin-left:auto">Open renewal</button>` : ""}</div>
      <div class="facts"><div class="fact"><div class="k">Awarded</div><div class="v">${esc(fmt(c.awardDate))}</div></div><div class="fact"><div class="k">LPO</div><div class="v mono">${esc(c.lpo || "-")}</div></div><div class="fact"><div class="k">PM cadence</div><div class="v">${esc(PM_LABEL[c.pmMonths] || "-")}</div></div><div class="fact"><div class="k">Visits</div><div class="v">${vs.filter(x => x.status === "completed").length} of ${vs.length} done</div></div></div>
      <div class="docrow"><button type="button" class="primary sm" id="x_visit">Schedule visit</button><span class="muted small">Service report:</span><button type="button" class="sm" id="x_srDocx">Word</button><button type="button" class="sm" id="x_srPdf">PDF</button><button type="button" class="ghost sm" id="x_editAward">Edit award details</button></div>
      <div class="list" style="border:1px solid var(--line);border-radius:8px" id="x_visits"></div></div>`);
  }
  body.push(`<div class="sec"><h3>Proposal</h3>${proposalBlock(a)}</div>`);
  body.push(`<div class="sec"><h3>Files</h3><div class="files" id="x_files">${filesHTML(a.files, true)}</div><label class="drop" id="x_drop">Drop files here or click to upload (up to 10 MB each)<input type="file" id="x_fileInput" multiple></label></div>`);
  body.push(`<div class="sec"><h3>Activity</h3><div class="log">${(a.history || []).slice().reverse().map(h => `<div><time>${esc(fmt(h.at))}</time><span>${esc(h.text)} · ${esc(nameOf(h.by))}</span></div>`).join("") || '<span class="muted">No activity yet.</span>'}</div></div>`);
  if (a.status !== "awarded" || S.isAdmin) body.push(`<div class="sec"><h3>Remove</h3><div><button type="button" class="danger sm" id="x_delete">Delete this AMC</button> <span class="muted small">Removes the record and its proposal. Files stay in storage.</span></div></div>`);
  $("s_body").innerHTML = body.join("");
  wireAmcSheet(a, c);
}
function proposalBlock(a) {
  if (a.proposalStatus === "generating") return `<div class="callout"><span class="spin"></span> Drafting the proposal in the house AMC format. This takes up to a minute.</div>`;
  if (!a.proposal) return `<div class="callout warn">No proposal yet.<button type="button" class="sm" id="x_gen" style="margin-left:auto">Draft proposal</button></div>`;
  const shares = (a.shares || []).slice(-3).reverse().map(s => `<div><time>${esc(fmt(s.at))}</time><span>${esc(s.mode === "draft" ? "Outlook draft for" : "Emailed to")} ${esc(s.to)} · ${esc(nameOf(s.by))}</span></div>`).join("");
  return `${a.proposalStale ? '<div class="callout warn">Systems or value changed since this proposal was drafted. Redraft before sending.</div>' : ""}
    <div class="facts"><div class="fact"><div class="k">Proposal no.</div><div class="v mono">${esc(a.ref)}</div></div><div class="fact"><div class="k">Drafted</div><div class="v">${esc(fmt(a.proposalAt))}</div><div class="sub">${a.proposalSource === "claude" ? "by Claude" : a.proposalSource === "mixed" ? "Claude + template" : "from template"}</div></div><div class="fact"><div class="k">Total incl. VAT</div><div class="v mono">${esc("AED " + a.proposal.commercial.total)}</div></div></div>
    <div class="docrow"><button type="button" class="sm" id="x_prev">Preview</button><button type="button" class="sm" id="x_editp">Edit proposal</button><button type="button" class="sm" id="x_docx">Download Word</button><button type="button" class="sm" id="x_pdf">Download PDF</button><button type="button" class="accent sm" id="x_share">Share with customer</button><button type="button" class="ghost sm" id="x_regen">Redraft</button></div>
    ${shares ? `<div class="log">${shares}</div>` : ""}`;
}
function wireAmcSheet(a, c) {
  const on = (id, fn) => { const b = $(id); if (b) b.onclick = () => fn(b); };
  on("x_edit", () => openAmcForm(a));
  on("x_award", () => openAward(a));
  on("x_editAward", () => openAward(a));
  on("x_sent", async () => { try { const n = await writeAmc(a, { status: "sent", sentAt: nowISO() }, "Marked as sent"); S.amcs.set(n.id, n); renderAll(); } catch (e) { toast(errMsg(e)); } });
  on("x_lost", async () => { try { const n = await writeAmc(a, { status: "lost", lostAt: nowISO() }, "Marked as lost"); S.amcs.set(n.id, n); renderAll(); } catch (e) { toast(errMsg(e)); } });
  on("x_reopen", async () => { try { const n = await writeAmc(a, { status: "draft" }, "Reopened"); S.amcs.set(n.id, n); renderAll(); } catch (e) { toast(errMsg(e)); } });
  on("x_gen", async b => { busy(b, true, "Drafting"); const n = await writeAmc(a, { proposalStatus: "generating" }).catch(() => a); S.amcs.set(n.id, n); renderAll(); generateProposal(n, ""); });
  on("x_regen", () => { $("rg_notes").value = ""; $("dRegen").showModal(); });
  on("x_prev", () => openPreview(a));
  on("x_editp", () => openEditor(a));
  on("x_docx", b => downloadProposal(a, "docx", b));
  on("x_pdf", b => downloadProposal(a, "pdf", b));
  on("x_share", () => openShare({ kind: "amc", a }));
  on("x_visit", () => openNewVisit(a.id));
  if (!S.can.visits && $("x_visit")) $("x_visit").hidden = true;
  on("x_renew", b => startRenewal(a, c, b));
  on("x_goRenewal", () => openAmcById(c.renewalAmcId));
  on("x_srDocx", async b => { busy(b, true, ""); try { await save(safeName(c.ref + " " + shortName(c.customerName) + " Service Report") + ".docx", await buildContract(c, "docx")); } catch (e) { toast(errMsg(e)); } finally { busy(b, false); } });
  on("x_srPdf", async b => { busy(b, true, ""); try { await save(safeName(c.ref + " " + shortName(c.customerName) + " Service Report") + ".pdf", await buildContract(c, "pdf")); } catch (e) { toast(errMsg(e)); } finally { busy(b, false); } });
  if ($("x_delete")) arm($("x_delete"), "Click again to delete", async () => {
    try { await api("DELETE", "amc/amcs/" + encodeURIComponent(a.id)); S.amcs.delete(a.id); S.contracts.delete(a.id); $("sAmc").close(); toast("AMC deleted"); renderAll(); } catch (e) { toast(errMsg(e)); }
  });
  const fx = $("x_files");
  fx.querySelectorAll("[data-dl]").forEach(b => b.onclick = () => downloadFile(a.files[+b.dataset.dl], b));
  fx.querySelectorAll("[data-rm]").forEach(b => arm(b, "Remove?", async () => { const files = a.files.slice(); const [f] = files.splice(+b.dataset.rm, 1); try { const n = await writeAmc(a, { files }, "Removed file " + f.name); S.amcs.set(n.id, n); renderAll(); } catch (e) { toast(errMsg(e)); } }));
  if ($("x_drop")) wireDrop($("x_drop"), $("x_fileInput"), async files => {
    $("x_drop").innerHTML = '<span class="spin"></span> Uploading…';
    const added = []; for (const f of files) { try { added.push(await uploadFile(f)); } catch (e) { toast(errMsg(e)); } }
    const cur = S.amcs.get(a.id) || a;
    if (added.length) { try { const n = await writeAmc(cur, { files: (cur.files || []).concat(added) }, "Uploaded " + added.map(f => f.name).join(", ")); S.amcs.set(n.id, n); } catch (e) { toast(errMsg(e)); } }
    renderAll();
  });
  const vb = $("x_visits");
  if (vb) { const vs = [...S.visits.values()].filter(x => x.amcId === a.id).sort((x, y) => x.scheduledDate.localeCompare(y.scheduledDate)); listInto(vb, vs.map(v => ({ html: visitLiHTML(v), open: () => openVisit(v.id) })), "No visits scheduled for this contract."); }
}
$("fRegen").onsubmit = async e => {
  e.preventDefault(); const a = S.amcs.get(S.openAmc); if (!a) return; const notes = $("rg_notes").value.trim(); $("dRegen").close();
  try { const n = await writeAmc(a, { proposalStatus: "generating" }); S.amcs.set(n.id, n); renderAll(); generateProposal(n, notes); } catch (err) { toast(errMsg(err)); }
};
function openPreview(a) {
  $("pv_ref").textContent = a.ref; $("pv_body").innerHTML = proposalHTML(a.proposal, false);
  $("pv_docx").onclick = () => downloadProposal(a, "docx", $("pv_docx")); $("pv_pdf").onclick = () => downloadProposal(a, "pdf", $("pv_pdf"));
  $("pv_edit").onclick = () => { $("sPrev").close(); openEditor(S.amcs.get(a.id) || a); };
  $("sPrev").showModal();
}
async function startRenewal(a, c, btn) {
  busy(btn, true, "Creating");
  try {
    const r = await api("POST", "amc/amcs/" + encodeURIComponent(a.id) + "/renew");
    r.amc._full = true; S.amcs.set(r.amc.id, r.amc); S.contracts.set(r.contract.amcId, r.contract);
    toast("Renewal " + r.amc.ref + " created"); openAmc(r.amc);
    generateProposal(r.amc, "This is a renewal of the existing contract " + a.ref + ". Mention continuity of service in the cover letter.");
  } catch (e) { toast(errMsg(e)); busy(btn, false); }
}

/* ============ proposal editor ============ */
// Text sections round-trip through a light markup: "## " heading, "- " bullet, anything else a paragraph.
function groupsToText(intro, groups) {
  const out = []; if (intro) out.push(intro, "");
  (groups || []).forEach(g => { out.push("## " + (g.heading || "")); if (g.text) out.push(g.text); (g.bullets || []).forEach(b => out.push("- " + b)); out.push(""); });
  return out.join("\n").trim();
}
function textToGroups(text) {
  const intro = [], groups = []; let cur = null;
  String(text || "").split("\n").forEach(raw => { const l = raw.trim(); if (!l) return;
    if (l.startsWith("## ")) { cur = { heading: l.slice(3).trim(), bullets: [] }; groups.push(cur); return; }
    if (/^[-•*]\s+/.test(l)) { if (!cur) { cur = { heading: "", bullets: [] }; groups.push(cur); } cur.bullets.push(l.replace(/^[-•*]\s+/, "")); return; }
    if (cur) cur.text = cur.text ? cur.text + " " + l : l; else intro.push(l); });
  groups.forEach(g => { if (!g.bullets.length) delete g.bullets; });
  return { intro: intro.join(" "), groups };
}
const linesOf = t => String(t || "").split("\n").map(x => x.trim()).filter(Boolean);
const parasOf = t => String(t || "").split(/\n\s*\n/).map(x => x.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
function isoFromFmt(s) { const m = String(s || "").match(/^(\d{1,2}) (\w{3}) (\d{4})$/); if (!m) return ""; const mi = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(m[2]); return mi < 0 ? "" : m[3] + "-" + pad(mi + 1) + "-" + pad(+m[1]); }
function rowsEditor(box, rows, cols, labels) {
  box.innerHTML = "";
  rows.forEach((r, i) => {
    const d = document.createElement("div"); d.className = "erow c" + cols;
    d.innerHTML = labels.map((l, j) => `<input aria-label="${esc(l)}" placeholder="${esc(l)}" value="${esc(r[j] || "")}" data-j="${j}">`).join("") + `<button type="button" class="ghost sm" aria-label="Remove row">✕</button>`;
    d.querySelectorAll("input").forEach(inp => inp.oninput = () => { r[+inp.dataset.j] = inp.value; });
    d.querySelector("button").onclick = () => { rows.splice(i, 1); rowsEditor(box, rows, cols, labels); };
    box.appendChild(d);
  });
}
let editing = null;
function openEditor(a) {
  const p = a.proposal; if (!p) { toast("Draft the proposal first."); return; }
  const cfg = JSON.parse(JSON.stringify(p)); editing = { a, cfg };
  const m = cfg.meta, L = cfg.letter, cm = cfg.commercial;
  $("pe_ref").textContent = a.ref + " · " + a.customerName;
  $("pe_date").value = m.dateISO || isoFromFmt(m.date); $("pe_valid").value = m.validISO || isoFromFmt(m.validUntil);
  $("pe_attn").value = m.attention || ""; $("pe_loc").value = L.toLocation || ""; $("pe_subtitle").value = m.subtitle || ""; $("pe_plan").value = cfg.signoff.plan || "";
  $("pe_subject").value = L.subject || ""; $("pe_salut").value = L.salutation || ""; $("pe_letter").value = (L.body || []).join("\n\n");
  const period = String(cfg.signoff.period || "").split(" to ");
  $("pe_start").value = cm.startISO || isoFromFmt(period[0]); $("pe_end").value = cm.endISO || isoFromFmt(period[1]);
  $("pe_value").value = money(cm.valueNum != null ? cm.valueNum : num(a.value)); $("pe_vat").value = String(cm.vatPct != null ? cm.vatPct : 5);
  $("pe_item").value = (cm.lineItems[0] || {}).desc || "";
  $("pe_pay").value = (cm.paymentTerms || []).join("\n");
  rowsEditor($("pe_plan_rows"), cfg.servicePlan.rows = cfg.servicePlan.rows || [], 3, ["Parameter", "Coverage", "Notes"]);
  rowsEditor($("pe_sla_rows"), cfg.response.rows = cfg.response.rows || [], 5, ["Priority", "Description", "Response", "Action plan", "Restoration"]);
  $("pe_flow").value = (cfg.response.workflow || []).join("\n");
  $("pe_under").value = groupsToText((cfg.understanding.paragraphs || []).join("\n\n"), [{ heading: "Engagement Drivers", bullets: cfg.understanding.drivers || [] }]);
  $("pe_scope").value = groupsToText(cfg.scope.intro, cfg.scope.streams);
  $("pe_docs").value = groupsToText(cfg.documentation.intro, cfg.documentation.groups);
  $("pe_excl").value = groupsToText("", cfg.exclusions.groups);
  peHint(); $("pe_err").textContent = ""; $("sEdit").showModal();
}
function peHint() { const v = num($("pe_value").value), r = num($("pe_vat").value); $("pe_valueHint").textContent = v ? `+ VAT ${money(v * r / 100)} = ${aed(v + v * r / 100)} total` : ""; }
$("pe_value").oninput = peHint; $("pe_vat").oninput = peHint;
$("pe_plan_add").onclick = () => { editing.cfg.servicePlan.rows.push(["", "", ""]); rowsEditor($("pe_plan_rows"), editing.cfg.servicePlan.rows, 3, ["Parameter", "Coverage", "Notes"]); };
$("pe_sla_add").onclick = () => { const rs = editing.cfg.response.rows; rs.push(["P" + (rs.length + 1), "", "", "", ""]); rowsEditor($("pe_sla_rows"), rs, 5, ["Priority", "Description", "Response", "Action plan", "Restoration"]); };
$("fEdit").onsubmit = async e => {
  e.preventDefault(); const err = m => { $("pe_err").textContent = m; };
  const { a, cfg } = editing; const g = id => $(id).value.trim();
  const start = g("pe_start"), end = g("pe_end"), date = g("pe_date") || today(), valid = g("pe_valid");
  const v = num(g("pe_value")), rate = num(g("pe_vat"));
  if (!start || !end || end <= start) return err("Set a contract start date and an end date after it.");
  if (valid && valid < date) return err("The validity date can't be before the proposal date.");
  if (!(v > 0)) return err("Enter the annual AMC value, excluding VAT.");
  if (rate < 0 || rate > 20) return err("Enter a VAT rate between 0 and 20%.");
  if (!parasOf(g("pe_letter")).length) return err("The cover letter needs at least one paragraph.");
  const vat = Math.round(v * rate) / 100, total = v + vat, months = termMonthsOf(start, end);
  const validDays = valid ? Math.round((parseISO(valid) - parseISO(date)) / 86400000) : 30;
  const attention = g("pe_attn") || "The Management";
  Object.assign(cfg.meta, { attention, date: fmt(date), dateISO: date, validUntil: fmt(valid || addDays(date, 30)), validISO: valid || addDays(date, 30), subtitle: g("pe_subtitle") || cfg.meta.subtitle });
  Object.assign(cfg.letter, { toName: attention, toLocation: g("pe_loc") || "Dubai, UAE", subject: g("pe_subject"), salutation: g("pe_salut") || "Dear Sir/Madam,", body: parasOf(g("pe_letter")) });
  const und = textToGroups(g("pe_under"));
  cfg.understanding = { paragraphs: parasOf(g("pe_under").split(/^##.*$/m)[0]), drivers: und.groups.flatMap(x => x.bullets || []) };
  const sc = textToGroups(g("pe_scope")); cfg.scope = { intro: sc.intro, streams: sc.groups };
  const dc = textToGroups(g("pe_docs")); cfg.documentation = { intro: dc.intro, groups: dc.groups };
  cfg.exclusions = { groups: textToGroups(g("pe_excl")).groups };
  cfg.servicePlan.rows = cfg.servicePlan.rows.filter(r => r.some(x => String(x || "").trim()));
  cfg.response.rows = cfg.response.rows.filter(r => r.some(x => String(x || "").trim()));
  cfg.response.workflow = linesOf(g("pe_flow"));
  Object.assign(cfg.commercial, { intro: `The commercial terms set out below cover the full ${months}-month engagement from ${fmt(start)} to ${fmt(end)}.`, startISO: start, endISO: end, valueNum: v, vatPct: rate,
    lineItems: [{ desc: g("pe_item") || cfg.commercial.lineItems[0].desc, amount: money(v) }], subtotal: money(v), vat: money(vat), vatLabel: `VAT @ ${money(rate)}%`, total: money(total),
    paymentTerms: linesOf(g("pe_pay")), validity: ["All values are quoted in UAE Dirhams (AED).", `Proposal validity: ${validDays} days from the date of issue (valid until ${fmt(valid || addDays(date, 30))}).`] });
  Object.assign(cfg.signoff, { period: `${fmt(start)} to ${fmt(end)}`, plan: g("pe_plan") || cfg.signoff.plan, total: `${aed(total)} (inclusive of VAT)` });
  const T = Object.assign({}, a.terms || {}, { endDate: end, attention: g("pe_attn"), location: g("pe_loc"), validDays: [15, 30, 45, 60, 90].includes(validDays) ? validDays : (a.terms || {}).validDays || 30 });
  const btn = $("pe_save"); busy(btn, true, "Saving");
  try {
    await writeAmc(S.amcs.get(a.id) || a, { proposal: deEm(cfg), proposalSource: a.proposalSource || "template", value: v, proposedStart: start, termMonths: [6, 12, 24, 36].includes(months) ? months : (a.termMonths || 12), terms: T }, "Edited proposal");
    $("sEdit").close(); toast("Proposal saved"); renderAll();
  } catch (x) { err(errMsg(x)); } finally { busy(btn, false); }
};
/* ============ award ============ */
let awarding = null;
// Contract end: follows start + term; a date typed by hand stays put; a pre-filled custom end moves with the start.
let awEndManual = false, awPrevStart = "";
function awardEnd() { if (awEndManual) return; const s = $("aw_start").value; $("aw_end").value = s ? addDays(addMonths(s, +$("aw_months").value), -1) : ""; awPrevStart = s; }
$("aw_end").addEventListener("input", () => { awEndManual = true; });
function awStartChanged() {
  const s = $("aw_start").value, e = $("aw_end").value;
  if (!awEndManual && awPrevStart && e && s && $("aw_end").dataset.custom === "1") { $("aw_end").value = addDays(e, Math.round((parseISO(s) - parseISO(awPrevStart)) / 86400000)); awPrevStart = s; }
  else { $("aw_end").dataset.custom = ""; awardEnd(); }
}
$("aw_start").addEventListener("change", awStartChanged);
$("aw_months").addEventListener("change", () => { $("aw_end").dataset.custom = ""; awEndManual = false; awardEnd(); });
function openAward(a) {
  awarding = a; const c = S.contracts.get(a.id); const t = today();
  $("aw_sub").textContent = a.ref + " · " + a.customerName + " · " + aed(num(a.value)) + " excl. VAT";
  $("aw_date").value = c ? c.awardDate : t; $("aw_start").value = c ? c.start : (a.proposedStart && a.proposedStart >= t ? a.proposedStart : t);
  $("aw_months").value = String(c ? c.months : (a.termMonths || 12)); $("aw_lpo").value = c ? c.lpo || "" : "";
  const T = a.terms || {}; const pEnd = T.endDate || (a.proposal && a.proposal.commercial && a.proposal.commercial.endISO) || "";
  awEndManual = false; $("aw_end").dataset.custom = ""; awPrevStart = $("aw_start").value;
  const presetEnd = c ? c.end : (pEnd && a.proposedStart && $("aw_start").value === a.proposedStart ? pEnd : "");
  $("aw_pm").value = String(c ? c.pmMonths : (T.pm ? PM_MONTHS[T.pm] : 3)); $("aw_alert").value = String(c ? c.alertDays : 60);
  $("aw_email").value = c ? c.notifyEmail : (S.meId || "");
  $("aw_schedule").checked = !c; $("aw_schedule").parentElement.hidden = !!c;
  if (presetEnd) { $("aw_end").value = presetEnd; $("aw_end").dataset.custom = "1"; } else awardEnd();
  $("aw_err").textContent = ""; $("dAward").showModal();
}
$("fAward").onsubmit = async e => {
  e.preventDefault(); const a = S.amcs.get(awarding.id) || awarding; const prev = S.contracts.get(a.id);
  const v = id => $(id).value.trim();
  if (!v("aw_date") || !v("aw_start")) { $("aw_err").textContent = "Enter the award date and contract start date."; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v("aw_email"))) { $("aw_err").textContent = "Enter the email address that should get the expiry alerts."; return; }
  const btn = $("fAward").querySelector("button[type=submit]"); busy(btn, true, "Saving");
  try {
    const r = await api("POST", "amc/amcs/" + encodeURIComponent(a.id) + "/award", { awardDate: v("aw_date"), start: v("aw_start"), end: v("aw_end"), months: +v("aw_months"), lpo: v("aw_lpo"),
      pmMonths: +v("aw_pm"), alertDays: +v("aw_alert"), notifyEmail: v("aw_email"), schedule: !prev && $("aw_schedule").checked, checklist: defaultChecklist(a.systems) });
    r.amc._full = true; S.amcs.set(r.amc.id, r.amc); S.contracts.set(r.contract.amcId, r.contract); r.visits.forEach(x => S.visits.set(x.id, x));
    if (a.renewalOf && S.contracts.get(a.renewalOf)) S.contracts.get(a.renewalOf).status = "renewed";
    toast(prev ? "Award details updated" : r.visits.length ? `Awarded. ${r.visits.length} PM visit${r.visits.length === 1 ? "" : "s"} scheduled` : "Marked as awarded");
    $("dAward").close(); renderAll();
  } catch (err) { $("aw_err").textContent = errMsg(err); }
  finally { busy(btn, false); }
};
/* ============ visits ============ */
function defaultChecklist(systems) {
  const cat = category(systems); const base = ["Visual inspection of equipment, racks and cabling", "Check power, UPS status and environmental conditions", "Review system logs, alarms and error counters", "Verify firmware / software versions against vendor advisories", "Take and verify configuration backup"];
  const extra = { voice: ["Test inbound and outbound calls on all trunks / lines", "Verify voicemail, auto-attendant and hunt groups", "Check handset registration and audio quality"],
    cctv: ["Verify all cameras are online with clear images", "Check recording schedules, retention and storage health", "Test playback and footage export"],
    it: ["Check server hardware health (disks, PSU, fans)", "Verify backup jobs completed successfully", "Review firewall policies, licences and security alerts", "Check switch / wireless link status and utilisation"] }[cat];
  return base.concat(extra, ["Clean equipment and remove dust", "Update asset register and documentation"]).map(item => ({ item, result: "", note: "" }));
}
async function createVisit(c, o) {
  const v = await api("POST", "amc/visits", { amcId: c.amcId, type: o.type || "pm", scheduledDate: o.scheduledDate, time: o.time || "", engineers: o.engineers || "", notes: o.notes || "", checklist: defaultChecklist(c.systems) });
  S.visits.set(v.id, v); return v.id;
}
function openNewVisit(amcId) {
  if (!S.can.visits) { toast(`You don't have access to maintenance visits. Ask ${B().manager} for access.`); return; }
  const cs = [...S.contracts.values()].filter(c => ["active", "expiring"].includes(contractState(c))).sort((a, b) => a.customerName.localeCompare(b.customerName));
  if (!cs.length) { toast("Mark an AMC as awarded first. Visits belong to awarded contracts.", 4000); return; }
  $("nv_contract").innerHTML = cs.map(c => `<option value="${esc(c.amcId)}">${esc(c.customerName)} · ${esc(c.ref)}</option>`).join("");
  if (amcId) $("nv_contract").value = amcId;
  $("nv_type").value = "pm"; $("nv_date").value = today(); $("nv_time").value = ""; $("nv_eng").value = ""; $("nv_notes").value = ""; $("nv_err").textContent = "";
  $("dNewVisit").showModal();
}
$("fNewVisit").onsubmit = async e => {
  e.preventDefault(); const c = S.contracts.get($("nv_contract").value);
  if (!c) { $("nv_err").textContent = "Choose a contract."; return; } if (!$("nv_date").value) { $("nv_err").textContent = "Choose a date."; return; }
  try { const id = await createVisit(c, { type: $("nv_type").value, scheduledDate: $("nv_date").value, time: $("nv_time").value, engineers: $("nv_eng").value.trim(), notes: $("nv_notes").value.trim() }); $("dNewVisit").close(); toast("Visit scheduled for " + fmt($("nv_date").value)); renderAll(); openVisit(id); }
  catch (err) { $("nv_err").textContent = errMsg(err); }
};

let vDraft = null;
function openVisit(id) { const v = S.visits.get(id); if (!v) return; S.openVisit = id; vDraft = JSON.parse(JSON.stringify(v)); renderVisitSheet(); if (!$("sVisit").open) $("sVisit").showModal(); }
let vDirty = false;
$("sVisit").addEventListener("close", () => { S.openVisit = null; vDraft = null; vDirty = false; });
function renderVisitSheet() {
  const v = vDraft; const c = S.contracts.get(v.amcId) || {};
  $("vs_ref").textContent = v.ref + " · " + (v.reportNo || ""); $("vs_customer").textContent = v.customerName;
  $("vs_chips").innerHTML = chip(visitState(v)) + ` <span class="chip">${esc(GEN.typeLabel(v.type))}</span> <span class="chip">${esc(fmt(v.scheduledDate))}${v.time ? " · " + esc(v.time) : ""}</span>`;
  const done = v.status === "completed";
  const HB = [];
  HB.push(`<div class="sec"><h3>Visit</h3><div class="grid2">
    <label class="f">Visit type<select id="vf_type">${Object.entries(GEN.TYPES).map(([k, l]) => `<option value="${k}"${v.type === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
    <label class="f">Scheduled date<input id="vf_date" type="date" value="${esc(v.scheduledDate)}"></label>
    <label class="f">Engineer(s)<input id="vf_eng" value="${esc(v.engineers)}" placeholder="Who is attending"></label>
    <label class="f">Time<input id="vf_time" type="time" value="${esc(v.time)}"></label>
    <label class="f">Arrived on site<input id="vf_arr" type="time" value="${esc(v.arrival || "")}"></label>
    <label class="f">Left site<input id="vf_dep" type="time" value="${esc(v.departure || "")}"></label>
    <label class="f">Customer representative<input id="vf_rep" value="${esc(v.customerRep)}"></label>
    <label class="f">Site / location<input id="vf_site" value="${esc(v.site)}"></label>
    ${v.notes ? `<div class="full callout">${esc(v.notes)}</div>` : ""}
  </div>${c.systems ? `<details class="more"><summary>Systems covered</summary><div class="systems" style="margin-top:8px">${esc(c.systems)}</div></details>` : ""}</div>`);
  HB.push(`<div class="sec"><h3>Checklist</h3><div class="checklist" id="vf_ck"></div><div class="docrow"><input id="vf_ckNew" placeholder="Add a check item" style="flex:1;min-width:160px"><button type="button" class="sm" id="vf_ckAdd">Add</button></div></div>`);
  HB.push(`<div class="sec"><h3>Findings</h3>
    ${S.features.ai ? `<details class="more"><summary>Write up from rough notes with Claude</summary><div style="display:grid;gap:8px;margin-top:8px"><textarea id="vf_rough" rows="3" placeholder="e.g. ups battery 2y old runtime 6 min, cleaned rack, switch 3 port 12 flapping replaced patch cord, advise battery replacement"></textarea><div><button type="button" class="sm" id="vf_ai">Write findings, actions and recommendations</button></div></div></details>` : ""}
    <label class="f">Findings &amp; observations <span class="hint">One per line</span><textarea id="vf_find" rows="4">${esc(v.findings)}</textarea></label>
    <label class="f">Actions taken<textarea id="vf_act" rows="3">${esc(v.actions)}</textarea></label>
    <label class="f">Recommendations<textarea id="vf_rec" rows="3">${esc(v.recommendations)}</textarea></label></div>`);
  HB.push(`<div class="sec"><h3>Site photos</h3><div class="photos" id="vf_photos"></div>${'<label class="drop" id="vf_pdrop">Add site photos: drop images or click to choose<input type="file" id="vf_pinput" accept="image/*" multiple></label>'}</div>`);
  HB.push(`<div class="sec"><h3>Documents</h3><div class="files" id="vf_files">${filesHTML(v.files, true)}</div>${'<label class="drop" id="vf_fdrop">Upload signed job sheet or other documents<input type="file" id="vf_finput" multiple></label>'}</div>`);
  HB.push(`<div class="sec"><h3>Report</h3><div class="docrow"><button type="button" class="sm" id="vf_docx">Word report</button><button type="button" class="sm" id="vf_pdf">PDF report</button><button type="button" class="accent sm" id="vf_share">Share with customer</button></div>
    ${(v.shares || []).length ? `<div class="log">${v.shares.slice(-3).reverse().map(s => `<div><time>${esc(fmt(s.at))}</time><span>${esc(s.mode === "draft" ? "Outlook draft for" : "Emailed to")} ${esc(s.to)}</span></div>`).join("")}</div>` : ""}</div>`);
  HB.push(`<div class="sec" style="position:sticky;bottom:-28px;background:var(--surface);padding:12px 0 4px;border-top:1px solid var(--line)"><div class="docrow">
    <button type="button" class="primary" id="vf_save">Save</button>
    ${v.status === "scheduled" ? '<button type="button" id="vf_start">Start visit</button>' : ""}
    ${!done && v.status !== "cancelled" ? '<button type="button" id="vf_complete">Complete visit</button>' : ""}
    ${done ? '<button type="button" id="vf_reopen">Reopen</button>' : ""}
    ${v.status !== "cancelled" && !done ? '<button type="button" class="ghost" id="vf_cancel">Cancel visit</button>' : ""}
    <button type="button" class="danger sm" id="vf_delete" style="margin-left:auto">Delete</button></div><div class="err" id="vf_err" role="alert"></div></div>`);
  $("vs_body").innerHTML = HB.join("");
  renderChecklist(); renderPhotos(); wireVisit();
  if (!S.can.visits) {
    $("vs_body").querySelectorAll("input, textarea, select").forEach(el => el.disabled = true);
    $("vs_body").querySelectorAll(".ck button, .ph .x, .drop, details.more, #vf_ckNew, #vf_ckAdd, #vf_share, #vf_save, #vf_start, #vf_complete, #vf_reopen, #vf_cancel, #vf_delete, #vf_files [data-rm]").forEach(el => el.hidden = true);
    const n = document.createElement("div"); n.className = "callout"; n.textContent = `View only. Ask ${B().manager} for access to maintenance visits to update this visit.`; $("vs_body").prepend(n);
  }
}
function renderChecklist() {
  const box = $("vf_ck"); box.innerHTML = "";
  vDraft.checklist.forEach((c, i) => {
    const d = document.createElement("div"); d.className = "ck";
    d.innerHTML = `<span class="item">${esc(c.item)}</span><span style="display:flex;gap:6px;align-items:center"><span class="res" role="group" aria-label="Result">${["ok", "issue", "na"].map(r => `<button type="button" data-r="${r}" aria-pressed="${c.result === r}">${r === "ok" ? "OK" : r === "issue" ? "Issue" : "N/A"}</button>`).join("")}</span><button type="button" class="ghost sm" data-x aria-label="Remove item">✕</button></span><input placeholder="Remarks" value="${esc(c.note)}" aria-label="Remarks for ${esc(c.item)}">`;
    d.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { c.result = c.result === b.dataset.r ? "" : b.dataset.r; vDirty = true; renderChecklist(); });
    d.querySelector("[data-x]").onclick = () => { vDraft.checklist.splice(i, 1); vDirty = true; renderChecklist(); };
    d.querySelector("input").oninput = e => { c.note = e.target.value; vDirty = true; };
    box.appendChild(d);
  });
}
function renderPhotos() {
  const box = $("vf_photos"); box.innerHTML = ""; if (!vDraft.photos.length) { box.innerHTML = '<span class="muted small">No photos yet.</span>'; return; }
  vDraft.photos.forEach((p, i) => {
    const d = document.createElement("div"); d.className = "ph";
    d.innerHTML = `<img src="/api/amc/files/${esc(p.id)}" alt="${esc(p.caption || "Site photo " + (i + 1))}" loading="lazy"><input placeholder="Caption" value="${esc(p.caption)}" aria-label="Caption for photo ${i + 1}"><button type="button" class="sm x" aria-label="Remove photo">✕</button>`;
    d.querySelector("input").oninput = e => { p.caption = e.target.value; vDirty = true; };
    d.querySelector(".x").onclick = () => { vDraft.photos.splice(i, 1); vDirty = true; renderPhotos(); };
    box.appendChild(d);
  });
}
function readVisitForm() {
  const g = id => $(id) ? $(id).value.trim() : "";
  Object.assign(vDraft, { type: $("vf_type").value, scheduledDate: g("vf_date") || vDraft.scheduledDate, engineers: g("vf_eng"), time: g("vf_time"), arrival: g("vf_arr"), departure: g("vf_dep"), customerRep: g("vf_rep"), site: g("vf_site"), findings: $("vf_find").value, actions: $("vf_act").value, recommendations: $("vf_rec").value });
}
async function saveVisit(patch, msg) {
  readVisitForm(); Object.assign(vDraft, patch || {}, { updatedAt: nowISO() });
  const data = JSON.parse(JSON.stringify(vDraft)); delete data.id;
  const saved = await api("PUT", "amc/visits/" + encodeURIComponent(vDraft.id), data);
  S.visits.set(saved.id, saved); vDraft = JSON.parse(JSON.stringify(saved)); vDirty = false;
  if (msg) toast(msg); renderAll(); renderVisitSheet();
}
async function resizeImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(file.name + " isn't an image this browser can read.")); i.src = url; });
    const max = 1600; const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)); const w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h); cx.drawImage(im, 0, 0, w, h);
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.82)); return { blob, w, h };
  } finally { URL.revokeObjectURL(url); }
}
function wireVisit() {
  const on = (id, fn) => { const b = $(id); if (b) b.onclick = () => fn(b); };
  $("vs_body").querySelectorAll("input,textarea,select").forEach(x => x.addEventListener("input", () => vDirty = true));
  on("vf_ckAdd", () => { const t = $("vf_ckNew").value.trim(); if (!t) return; readVisitForm(); vDraft.checklist.push({ item: t, result: "", note: "" }); vDirty = true; $("vf_ckNew").value = ""; renderChecklist(); });
  $("vf_ckNew").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("vf_ckAdd").click(); } };
  const err = m => { $("vf_err").textContent = m; };
  on("vf_save", async b => { busy(b, true, "Saving"); try { await saveVisit(null, "Visit saved"); } catch (e) { err(errMsg(e)); busy(b, false); } });
  on("vf_start", async () => { try { await saveVisit({ status: "in_progress", startedAt: nowISO(), arrival: $("vf_arr").value || new Date().toTimeString().slice(0, 5) }, "Visit started"); } catch (e) { err(errMsg(e)); } });
  on("vf_complete", async () => { readVisitForm(); const open = vDraft.checklist.filter(c => !c.result).length;
    if (!vDraft.engineers) { err("Add the engineer name before completing the visit."); return; }
    try { await saveVisit({ status: "completed", completedAt: nowISO(), completedDate: vDraft.status === "completed" ? vDraft.completedDate : today(), departure: $("vf_dep").value || new Date().toTimeString().slice(0, 5) }, open ? `Visit completed. ${open} checklist item${open === 1 ? "" : "s"} left blank` : "Visit completed"); } catch (e) { err(errMsg(e)); } });
  on("vf_reopen", async () => { try { await saveVisit({ status: "in_progress" }, "Visit reopened"); } catch (e) { err(errMsg(e)); } });
  on("vf_cancel", async () => { try { await saveVisit({ status: "cancelled" }, "Visit cancelled"); } catch (e) { err(errMsg(e)); } });
  arm($("vf_delete"), "Click again to delete", async () => { try { await api("DELETE", "amc/visits/" + encodeURIComponent(vDraft.id)); S.visits.delete(vDraft.id); $("sVisit").close(); toast("Visit deleted"); renderAll(); } catch (e) { err(errMsg(e)); } });
  on("vf_ai", async b => {
    const rough = $("vf_rough").value.trim(); if (!rough) { err("Type your rough notes first."); return; }
    busy(b, true, "Writing"); readVisitForm();
    try {
      const c = S.contracts.get(vDraft.amcId) || {};
      const issues = vDraft.checklist.filter(x => x.result === "issue").map(x => x.item + (x.note ? " (" + x.note + ")" : "")).join("; ");
      const r = await api("POST", "amc/ai", { kind: "visit", customerName: vDraft.customerName, visitType: GEN.typeLabel(vDraft.type), systems: c.systems || "", issues, notes: rough });
      const j = a => Array.isArray(a) ? a.map(x => "• " + noEm(x)).join("\n") : "";
      const add = (cur, nw) => [cur.trim(), nw].filter(Boolean).join("\n");
      $("vf_find").value = add($("vf_find").value, j(r.findings)); $("vf_act").value = add($("vf_act").value, j(r.actions)); $("vf_rec").value = add($("vf_rec").value, j(r.recommendations)); vDirty = true;
      toast("Drafted. Review it and save.");
    } catch (e) { err(errMsg(e)); }
    finally { busy(b, false); }
  });
  if ($("vf_pdrop")) wireDrop($("vf_pdrop"), $("vf_pinput"), async files => {
    readVisitForm(); $("vf_pdrop").firstChild.textContent = "Uploading " + files.length + " photo" + (files.length === 1 ? "" : "s") + "…";
    for (const f of files) { try { const r = await resizeImage(f); const up = await api("POST", "amc/files", { name: (f.name || "photo").replace(/\.[^.]+$/, "") + ".jpg", type: "image/jpeg", data: await toB64(r.blob) }); vDraft.photos.push({ id: up.id, caption: "", w: r.w, h: r.h, by: S.meId, at: nowISO() }); } catch (e) { toast(errMsg(e)); } }
    try { await saveVisit(null, "Photos added"); } catch (e) { err(errMsg(e)); }
  });
  const fx = $("vf_files");
  fx.querySelectorAll("[data-dl]").forEach(b => b.onclick = () => downloadFile(vDraft.files[+b.dataset.dl], b));
  fx.querySelectorAll("[data-rm]").forEach(b => arm(b, "Remove?", async () => { readVisitForm(); vDraft.files.splice(+b.dataset.rm, 1); try { await saveVisit(null, "File removed"); } catch (e) { err(errMsg(e)); } }));
  if ($("vf_fdrop")) wireDrop($("vf_fdrop"), $("vf_finput"), async files => {
    readVisitForm(); for (const f of files) { try { vDraft.files.push(await uploadFile(f)); } catch (e) { toast(errMsg(e)); } }
    try { await saveVisit(null, "Uploaded"); } catch (e) { err(errMsg(e)); }
  });
  const rep = async (kind, b) => { busy(b, true, ""); try { readVisitForm(); if (vDirty) await saveVisit(); await save(visitName(vDraft, kind), await buildVisit(vDraft, kind)); } catch (e) { err(errMsg(e)); } finally { busy(b, false); } };
  on("vf_docx", b => rep("docx", b)); on("vf_pdf", b => rep("pdf", b));
  on("vf_share", async () => { readVisitForm(); if (vDirty) { try { await saveVisit(); } catch (e) { err(errMsg(e)); return; } } openShare({ kind: "visit", v: S.visits.get(vDraft.id) }); });
}

/* ============ share ============ */
let shareCtx = null;
function openShare(ctx) {
  shareCtx = ctx; $("sh_err").textContent = "";
  const myEmail = S.meId || "";
  if (ctx.kind === "amc") {
    const a = ctx.a; const cust = S.customers.get(a.customerId) || {};
    if (!a.proposal) { toast("Draft the proposal first."); return; }
    $("sh_title").textContent = "Send proposal to " + shortName(a.customerName);
    $("sh_to").value = cust.email || ""; const boss = ((window.BIFOLD_ME || {}).managers || [])[0] || (B().key === "bifold" ? RANJAN : ""); $("sh_cc").value = boss && myEmail !== boss ? boss : "";
    $("sh_subject").value = `AMC Proposal ${a.ref} | ${a.proposal.meta.subtitle} | ${B().name}`;
    $("sh_msg").value = `${a.proposal.letter.salutation}\n\nPlease find attached our Annual Maintenance Contract proposal for ${a.customerName}, covering ${GEN.lines(a.systems).join(", ")}.\n\nThe total contract value is AED ${a.proposal.commercial.total} including VAT, and the proposal is valid until ${a.proposal.meta.validUntil}.\n\nWe would be glad to walk you through it at your convenience.`;
  } else {
    const v = ctx.v; const c = S.contracts.get(v.amcId) || {};
    $("sh_title").textContent = "Send visit report to " + shortName(v.customerName);
    $("sh_to").value = c.contactEmail || ""; $("sh_cc").value = "";
    $("sh_subject").value = `Maintenance Report ${v.reportNo} | ${v.customerName} | ${fmt(v.completedDate || v.scheduledDate)}`;
    $("sh_msg").value = `Dear ${v.customerRep || c.contactName || "Sir/Madam"},\n\nThank you for your support during our ${GEN.typeLabel(v.type).toLowerCase()} visit on ${fmt(v.completedDate || v.scheduledDate)}. Please find the visit report attached, with a summary below.\n\nPlease let us know if you have any questions.`;
  }
  $("sh_how").innerHTML = S.features.mail
    ? `<span>The email goes out from ${esc(B().short)}'s tools mailbox with the PDF attached. You are copied and replies come to you (${esc(myEmail)}).</span>`
    : "<span>Email isn't set up on the tools site yet. Download the PDF and send it from Outlook.</span>";
  $("sh_send").disabled = !S.features.mail;
  $("dShare").showModal();
}
function shareBody() {
  const msg = $("sh_msg").value.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const sig = `<p>Best regards,<br>${esc(B().name)}<br>${esc(S.meId || "")} | Tel: ${esc(B().phone)} | ${esc(B().web)}</p>`;
  let summary = "";
  if (shareCtx.kind === "amc") summary = "<hr>" + proposalHTML(shareCtx.a.proposal, true);
  else {
    const v = shareCtx.v;
    const T = (h, rows) => `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse"><thead><tr>${h.map(x => `<th align="left">${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => "<tr>" + r.map(c => `<td>${esc(c)}</td>`).join("") + "</tr>").join("")}</tbody></table>`;
    const UL = t => { const l = GEN.lines(t); return l.length ? "<ul>" + l.map(x => `<li>${esc(x)}</li>`).join("") + "</ul>" : "<p>None.</p>"; };
    summary = `<hr><h3>Visit summary</h3>${T(["Item", "Detail"], [["Customer", v.customerName], ["Contract", v.ref], ["Visit type", GEN.typeLabel(v.type)], ["Date", fmt(v.completedDate || v.scheduledDate)], ["Engineer(s)", v.engineers || "-"]])}<h3>Findings</h3>${UL(v.findings)}<h3>Recommendations</h3>${UL(v.recommendations)}`;
  }
  return msg + sig + summary;
}
function shareDoc() {
  return shareCtx.kind === "amc"
    ? { build: () => buildProposal(shareCtx.a, "pdf"), name: propName(shareCtx.a, "pdf") }
    : { build: () => buildVisit(shareCtx.v, "pdf"), name: visitName(shareCtx.v, "pdf") };
}
$("fShare").onsubmit = async e => {
  e.preventDefault(); $("sh_err").textContent = "";
  const to = $("sh_to").value.trim(); if (!to) { $("sh_err").textContent = "Add the customer's email address."; return; }
  busy($("sh_send"), true, "Sending");
  try {
    const d = shareDoc(); const blob = await d.build();
    if (blob.size > 3 * 1048576) throw new Error("The PDF is larger than 3 MB, too big to email. Download it and share it another way, or remove some photos.");
    const r = await api("POST", "amc/share", { kind: shareCtx.kind, id: shareCtx.kind === "amc" ? shareCtx.a.id : shareCtx.v.id, to, cc: $("sh_cc").value, subject: $("sh_subject").value.trim(), html: shareBody(), attachment: { name: d.name, type: "application/pdf", data: await toB64(blob) } });
    $("dShare").close(); toast("Sent to " + r.to.join(", "));
    if (shareCtx.kind === "amc") await loadFull(shareCtx.a.id).catch(() => {}); else await refresh();
    renderAll(); if (S.openVisit && $("sVisit").open) { vDraft = JSON.parse(JSON.stringify(S.visits.get(S.openVisit))); renderVisitSheet(); }
  } catch (err) { $("sh_err").textContent = errMsg(err); }
  finally { busy($("sh_send"), false); $("sh_send").disabled = !S.features.mail; }
};
$("sh_dl").onclick = async () => { const b = $("sh_dl"); busy(b, true, "Preparing"); try { const d = shareDoc(); await save(d.name, await d.build()); } catch (e) { $("sh_err").textContent = errMsg(e); } finally { busy(b, false); } };
/* ============ exports ============ */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act;
  if (act === "new-amc") { if (!S.ready) return; if (!S.customers.size) { openCustomer(null, () => openAmcForm(null)); toast("Add the customer first"); return; } openAmcForm(null); }
  if (act === "new-visit") openNewVisit();
  if (act === "export-amcs") { const cols = ["ref", "customer", "systems", "value_aed_excl_vat", "status", "contract_start", "contract_end", "days_left", "lpo", "owner", "created"];
    save("AMC Register.csv", [cols.join(",")].concat([...S.amcs.values()].map(a => { const c = S.contracts.get(a.id) || {}; return [a.ref, a.customerName, a.systems, num(a.value), amcState(a), c.start || "", c.end || "", c.end ? daysTo(c.end) : "", c.lpo || "", a.owner, (a.createdAt || "").slice(0, 10)].map(csvCell).join(","); })).join("\n")); }
});
const csvCell = v => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

/* ============ boot ============ */
async function refresh() {
  const r = await api("GET", "amc/bootstrap");
  S.features = r.features || S.features;
  if (r.co) { S.co = r.co; document.documentElement.dataset.co = r.co; }
  const ccHint = $("aw_cc_hint"); if (ccHint) ccHint.textContent = B().key === "techhub" ? "The Tech Hub alert copy list is always copied." : "ranjan@bifoldtech.com is always copied.";
  const awEmail = $("aw_email"); if (awEmail) awEmail.placeholder = "you@" + B().web;
  if (r.can) { S.can = r.can; applyCan(); }
  const keepFull = new Map([...S.amcs.values()].filter(a => a._full).map(a => [a.id, a]));
  S.amcs.clear();
  r.amcs.forEach(a => { const f = keepFull.get(a.id); S.amcs.set(a.id, f && f.updatedAt === a.updatedAt ? f : a); });
  S.contracts.clear(); r.contracts.forEach(c => S.contracts.set(c.amcId, c));
  S.visits.clear(); r.visits.forEach(v => S.visits.set(v.id, v));
}
async function boot() {
  route();
  try {
    const [me, customers] = await Promise.all([api("GET", "me"), api("GET", "customers")]);
    S.me = me; S.meId = me.email; S.isAdmin = !!me.isManager;
    customers.forEach(c => S.customers.set(c.id, c));
    $("who").textContent = me.email;
    const tag = $("accessTag"); tag.textContent = S.isAdmin ? "Full access" : "Your AMCs"; tag.classList.toggle("full", S.isAdmin);
    tag.title = S.isAdmin ? "You can view and edit every AMC." : "You can view and edit the AMCs you create. Managers see every AMC.";
    await refresh();
    S.ready = true; renderAll();
  } catch (e) {
    S.ready = true; $("offline").hidden = false; $("offline").textContent = errMsg(e); renderAll(); return;
  }
  // Pick up colleagues' changes while the page stays open (skipped while a form or record is open).
  setInterval(async () => {
    if (document.hidden || document.querySelector("dialog[open]")) return;
    try { await Promise.all([refresh(), refreshCustomers()]); renderAll(); } catch {}
  }, 60000);
}
boot();
})();
