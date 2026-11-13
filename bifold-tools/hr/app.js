// HR & Payroll (single-page app; the API is /api/hr/*). Employees, leave, monthly payroll through WPS,
// payslips and salary receipts, the WPS salary information file (SIF), gratuity and document expiry.
(function () {
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const aed = (n, d = 2) => (num(n) < 0 ? "-" : "") + Math.abs(num(n)).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const ymd = d => String(d).length > 10 ? new Date(Date.parse(d) + 4 * 3600e3).toISOString().slice(0, 10) : String(d); // timestamps shown in UAE time
const fd = d => d ? new Date(ymd(d) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const monthName = ym => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dueOf = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 1)).toISOString().slice(0, 10);
const initials = n => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");

let D = null;
window.HR = { aed, fd, r2, dueOf, get D() { return D; } };

/* ---------- plumbing ---------- */
function toast(m, e) { const t = document.createElement("div"); t.className = "toast" + (e ? " err" : ""); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), e ? 6500 : 2600); }
async function api(method, path, body) {
  let r; try { r = await fetch("/api/hr/" + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, cache: "no-store" }); }
  catch { throw new Error("Can't reach the server. Check your connection and try again."); }
  const ct = r.headers.get("content-type") || "";
  if (r.redirected || (r.ok && r.status !== 204 && !ct.includes("json"))) throw new Error("Your session has ended. Reload the page to sign in again.");
  let j = null; if (r.status !== 204) { try { j = await r.json(); } catch {} }
  if (!r.ok) { const e = new Error((j && j.error) || "The request failed."); e.status = r.status; throw e; }
  return j;
}
async function load() { D = await api("GET", "bootstrap"); }
async function reload() { await load(); route(); }
function go(h) { if (location.hash === h) route(); else location.hash = h; }
const busy = (btn, on) => { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.t = btn.textContent; btn.textContent = "Working…"; } else if (btn.dataset.t) btn.textContent = btn.dataset.t; };
async function act(btn, fn, ok) { busy(btn, true); try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message, true); } finally { busy(btn, false); } }
let xlsxP = null;
function xlsx() { return xlsxP || (xlsxP = new Promise((res, rej) => { if (window.XLSX) return res(window.XLSX); const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = () => res(window.XLSX); s.onerror = () => { xlsxP = null; rej(new Error("Couldn't load the Excel library. Check your connection.")); }; document.head.appendChild(s); })); }
async function exportSheet(name, rows) { const X = await xlsx(); const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), "Sheet1"); X.writeFile(wb, name.replace(/[\\/:*?"<>|]/g, "-") + ".xlsx"); }
function saveBlob(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
// Every PDF has a Preview button beside its Download button.
function pdfButtons(id, label) { return `<button type="button" data-pv="${id}">Preview</button><button type="button" class="primary" data-dl="${id}">${esc(label)}</button>`; }
function wirePdf(root, map) {
  root.querySelectorAll("[data-pv]").forEach(b => { const [build, name] = map[b.dataset.pv]; b.onclick = () => window.BXPdf.preview(build, name); });
  root.querySelectorAll("[data-dl]").forEach(b => { const [build, name] = map[b.dataset.dl]; b.onclick = () => act(b, async () => saveBlob(await build(), name)); });
}
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
const confirmBox = (title, text, okLabel = "Confirm", danger) => dialog(`<form method="dialog"><h3>${esc(title)}</h3><p>${text}</p><div class="foot"><button type="button" data-x>Cancel</button><button class="${danger ? "danger" : "primary"}" id="ok">${esc(okLabel)}</button></div></form>`, { onOpen: (d, done) => { d.querySelector("form").onsubmit = e => { e.preventDefault(); done(true); }; } });
function st(v) { const L = { draft: "Draft", approved: "Approved", paid: "Paid", active: "Active", leave: "On leave", left: "Left" }; const c = { draft: "draft", approved: "open", paid: "paid", active: "posted", leave: "partial", left: "void" }[v] || v; return `<span class="st ${c}">${esc(L[v] || v)}</span>`; }
function expTag(d) { if (!d) return `<span class="exp na">Not recorded</span>`; const t = D.today; if (d < t) return `<span class="exp x">Expired ${fd(d)}</span>`; if (d <= addDays(t, 30)) return `<span class="exp s">${fd(d)}</span>`; return `<span class="exp ok">${fd(d)}</span>`; }

/* ---------- layout ---------- */
const SECTION = { dashboard: "Dashboard", employees: "Employees", employee: "Employees", leave: "Leave", payroll: "Payroll runs", run: "Payroll runs", gratuity: "End of service", documents: "Documents and expiry", settings: "Settings" };
function nav(active) {
  const BX = window.BX; if (!BX) return;
  const key = active === "employee" ? "employees" : active === "run" ? "payroll" : active || "dashboard";
  BX.markSub("#/" + key);
  BX.crumb(key === "dashboard" ? [["HR & Payroll", "#/dashboard"]] : [["HR & Payroll", "#/dashboard"], [SECTION[key]]]);
  if (D) {
    const soon = addDays(D.today, 30);
    BX.subCount("#/documents", D.employees.filter(e => e.status !== "left" && Object.keys(D.docs).some(k => e[k] && e[k] <= soon)).length, "Documents expired or expiring within 30 days");
    BX.subCount("#/payroll", D.runs.filter(r => r.status !== "paid").length, "Payroll runs not yet paid");
  }
}
function page(title, tag, acts, body, navKey) {
  nav(navKey);
  $("app").innerHTML = `<header class="top"><div><h1><span class="tag">${esc(tag)}</span>${esc(title)}</h1></div><div class="acts">${acts || ""}</div></header>${body}`;
  window.scrollTo(0, 0);
}
const active = () => D.employees.filter(e => e.status !== "left");
const fixedGross = e => r2(e.basic + e.housing + e.transport + e.otherAllow);

async function route() {
  if (!D) return;
  const [a, b] = location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
  try {
    if (!a || a === "dashboard") return dashboard();
    if (a === "employees") return employees();
    if (a === "employee" && b) return employee(b);
    if (a === "leave") return leaveView();
    if (a === "payroll") return payroll();
    if (a === "run" && b) return runView(b);
    if (a === "gratuity") return gratuityView();
    if (a === "documents") return documents();
    if (a === "settings") return settingsView();
    go("#/dashboard");
  } catch (e) { console.error(e); $("app").innerHTML = `<div class="empty"><strong>Something went wrong</strong>${esc(e.message)}</div>`; }
}

/* ---------- dashboard ---------- */
function dashboard() {
  const emps = active(), t = D.today, cur = t.slice(0, 7);
  const lastYm = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 2, 1)).toISOString().slice(0, 7);
  const monthly = emps.reduce((a, e) => a + fixedGross(e), 0), liab = emps.reduce((a, e) => a + (e.gratuity.amount || 0), 0);
  const soon = addDays(t, 30), exp = [];
  emps.forEach(e => Object.entries(D.docs).forEach(([k, l]) => { if (e[k] && e[k] <= soon) exp.push([e, l, e[k]]); }));
  exp.sort((x, y) => x[2].localeCompare(y[2]));
  const runFor = ym => D.runs.find(r => r.month === ym);
  const card = ym => { const r = runFor(ym); return `<a class="mi" href="${r ? "#/run/" + ym : "#/payroll"}"><span><b>${esc(monthName(ym))}</b><span class="t">${r ? `${r.count} employees · due by ${fd(dueOf(ym))}` : "No payroll run yet"}</span></span><span class="amt">${r ? "AED " + aed(r.total) + " " + st(r.status) : `<span class="st draft">Not started</span>`}</span></a>`; };
  const missing = emps.filter(e => e.payMethod !== "none" && (!e.personId || !e.routing || !e.account));
  const setupGaps = [!D.settings.employerId && "MOHRE establishment ID", !D.settings.employerRouting && "employer bank routing code"].filter(Boolean);
  page("HR & Payroll", D.company.name, `<button id="nEmp">+ Employee</button><button class="primary" id="nRun">+ Payroll run</button>`, `
    ${setupGaps.length ? `<div class="note warn" style="margin-bottom:14px"><b>WPS setup incomplete</b>Add the ${setupGaps.join(" and ")} in <a href="#/settings">Settings</a> before creating a WPS salary file.</div>` : ""}
    ${(() => { const r = runFor(lastYm); return emps.length && (!r || r.status !== "paid") && t >= dueOf(lastYm) ? `<div class="note bad" style="margin-bottom:14px"><b>${esc(monthName(lastYm))} salaries are overdue</b>Salaries were due through WPS by ${fd(dueOf(lastYm))}. ${r ? `<a href="#/run/${lastYm}">Open the run</a>` : `<a href="#/payroll">Create the run</a>`}.</div>` : ""; })()}
    <div class="kpis">
      <a class="kpi" href="#/employees"><div class="k">Active employees</div><div class="v">${emps.length}</div><div class="s">${D.employees.length - emps.length} left</div></a>
      <div class="kpi"><div class="k">Monthly fixed payroll</div><div class="v"><small>AED</small>${aed(monthly, 0)}</div><div class="s">basic and allowances</div></div>
      <a class="kpi" href="#/gratuity" style="--c:var(--warn)"><div class="k">Gratuity liability</div><div class="v"><small>AED</small>${aed(liab, 0)}</div><div class="s">as of ${fd(t)}</div></a>
      <a class="kpi" href="#/documents" style="--c:${exp.length ? "var(--bad)" : "var(--good)"}"><div class="k">Documents to renew</div><div class="v">${exp.length}</div><div class="s">expired or within 30 days</div></a>
    </div>
    <div class="grid2">
      <section class="card"><header><h2>Payroll<span>salaries due by the 1st of the next month</span></h2><a href="#/payroll">All runs →</a></header>${card(cur)}${card(lastYm)}</section>
      <section class="card"><header><h2>Documents to renew</h2><a href="#/documents">All →</a></header>${exp.slice(0, 6).map(([e, l, d]) => `<a class="mi" href="#/employee/${e.id}"><span><b>${esc(e.name)}</b><span class="t">${esc(l)}</span></span><span class="amt">${expTag(d)}</span></a>`).join("") || `<div class="empty">Nothing expiring in the next 30 days.</div>`}</section>
      <section class="card"><header><h2>WPS details missing<span>${missing.length}</span></h2><a href="#/employees">Employees →</a></header>${missing.slice(0, 6).map(e => `<a class="mi" href="#/employee/${e.id}"><span><b>${esc(e.name)}</b><span class="t">${[!e.personId && "person ID", !e.routing && "routing code", !e.account && (e.payMethod === "card" ? "card number" : "IBAN")].filter(Boolean).join(", ")} missing</span></span></a>`).join("") || `<div class="empty">Every employee paid through WPS has a person ID, routing code and account.</div>`}</section>
      <section class="card"><header><h2>Recent leave</h2><a href="#/leave">All leave →</a></header>${D.leave.slice(0, 6).map(l => { const e = D.employees.find(x => x.id === l.empId) || {}; return `<a class="mi" href="#/leave"><span><b>${esc(e.name || "")}</b><span class="t">${esc(D.leaveTypes[l.type])} · ${fd(l.from)} to ${fd(l.to)}</span></span><span class="amt">${l.days} d</span></a>`; }).join("") || `<div class="empty">No leave recorded.</div>`}</section>
    </div>`, "dashboard");
  $("nEmp").onclick = () => editEmployee(); $("nRun").onclick = newRun;
}

/* ---------- employees ---------- */
function employees() {
  page("Employees", "HR & Payroll", `<button id="xl">Export to Excel</button><button class="primary" id="nEmp">+ Employee</button>`, `
    <div class="tools"><input type="search" id="q" placeholder="Search name, number, designation"><div class="seg" id="sf"><button aria-pressed="true" data-v="current">Current</button><button aria-pressed="false" data-v="left">Left</button><button aria-pressed="false" data-v="">All</button></div><span class="cnt" id="cnt"></span></div>
    <div class="panel listpanel"><div class="tblwrap"><table class="list"><thead><tr><th>Employee</th><th>Department</th><th>Joined</th><th>Pay through</th><th class="r">Monthly wage</th><th class="r">Leave balance</th><th class="r">Gratuity</th><th>Status</th></tr></thead><tbody id="rows"></tbody></table><div class="empty" id="empty" hidden></div></div></div>`, "employees");
  let f = "current";
  const draw = () => {
    const q = $("q").value.trim().toLowerCase();
    const list = D.employees.filter(e => (f === "current" ? e.status !== "left" : f === "left" ? e.status === "left" : true) && (!q || [e.name, e.empNo, e.designation, e.department].join(" ").toLowerCase().includes(q)));
    $("rows").innerHTML = list.map(e => `<tr data-id="${e.id}"><td><div class="who"><span class="av">${esc(initials(e.name))}</span><div><div class="t">${esc(e.name)}</div><div class="s">${esc([e.empNo, e.designation].filter(Boolean).join(" · "))}</div></div></div></td><td>${esc(e.department)}</td><td>${fd(e.joinDate)}</td>
      <td>${e.payMethod === "none" ? `<span class="muted">Outside WPS</span>` : (!e.personId || !e.routing || !e.account) ? `<span class="st overdue">WPS details missing</span>` : esc(e.payMethod === "card" ? "WPS card" : "WPS bank")}</td>
      <td class="r">${aed(fixedGross(e))}</td><td class="r">${e.leave.balance} d</td><td class="r">${aed(e.gratuity.amount)}</td><td>${st(e.status)}</td></tr>`).join("");
    $("empty").hidden = !!list.length; $("empty").innerHTML = D.employees.length ? "No employees match." : `<strong>No employees yet</strong>Add your team to run payroll.`;
    $("cnt").textContent = `${list.length} employee${list.length === 1 ? "" : "s"}`;
    $("rows").querySelectorAll("tr").forEach(tr => tr.onclick = () => go("#/employee/" + tr.dataset.id));
  };
  $("q").oninput = draw;
  $("sf").querySelectorAll("button").forEach(b => b.onclick = () => { f = b.dataset.v; $("sf").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); draw(); });
  $("nEmp").onclick = () => editEmployee();
  $("xl").onclick = () => act($("xl"), () => exportSheet(`Employees ${D.company.name} ${D.today}`, [["Employee no.", "Name", "Designation", "Department", "Nationality", "Joining date", "Contract", "Status", "Last working day", "MOHRE person ID", "Pay through", "Routing code", "IBAN / card", "Bank", "Basic", "Housing", "Transport", "Other allowances", "Monthly wage", "Leave balance (days)", "Years of service", "Gratuity (AED)", "Passport expiry", "Visa expiry", "Emirates ID expiry", "Labour card expiry", "Insurance expiry"],
    ...D.employees.map(e => [e.empNo, e.name, e.designation, e.department, e.nationality, e.joinDate, e.contract, e.status, e.endDate, e.personId, D.payMethods[e.payMethod], e.routing, e.account, e.bankName, e.basic, e.housing, e.transport, e.otherAllow, fixedGross(e), e.leave.balance, r2(e.service.years), e.gratuity.amount, e.passportExpiry, e.visaExpiry, e.eidExpiry, e.labourCardExpiry, e.insuranceExpiry])]));
  draw();
}

function editEmployee(e) {
  const v = e || { status: "active", contract: "unlimited", payMethod: "bank", joinDate: D.today };
  const inp = (k, l, attrs = "") => `<label><span class="lbl">${l}</span><input name="${k}" value="${esc(v[k] ?? "")}" ${attrs}></label>`;
  const sel = (k, l, opts) => `<label><span class="lbl">${l}</span><select name="${k}">${Object.entries(opts).map(([a, b]) => `<option value="${a}"${v[k] === a ? " selected" : ""}>${esc(b)}</option>`).join("")}</select></label>`;
  const n = (k, l) => inp(k, l, `class="num" inputmode="decimal" value="${v[k] || ""}"`);
  return dialog(`<form><h3>${e ? "Edit employee" : "New employee"}</h3>
    <div class="sec">Employment</div>
    <div class="fields">${inp("name", "Full name (as on labour contract) *", "required maxlength=120")}${inp("empNo", "Employee no.", "maxlength=20")}</div>
    <div class="fields">${inp("designation", "Designation", "maxlength=100")}${inp("department", "Department", "maxlength=60")}${inp("nationality", "Nationality", "maxlength=60 list=natL")}</div>
    <div class="fields">${inp("joinDate", "Joining date *", "type=date required")}${sel("contract", "Contract", { unlimited: "Unlimited", limited: "Limited (fixed term)" })}${sel("status", "Status", { active: "Active", leave: "On leave", left: "Left" })}</div>
    <div class="fields" id="leftF">${inp("endDate", "Last working day", "type=date")}${inp("endReason", "Reason for leaving", "maxlength=200")}</div>
    <div class="fields">${inp("email", "Email", "type=email maxlength=150")}${inp("mobile", "Mobile", "maxlength=30")}</div>
    <div class="sec">Monthly wage (AED, as in the MOHRE contract)</div>
    <div class="fields">${n("basic", "Basic *")}${n("housing", "Housing")}${n("transport", "Transport")}${n("otherAllow", "Other allowances")}</div>
    <div class="sec">Wage Protection System</div>
    <div class="fields">${sel("payMethod", "Paid through", D.payMethods)}${inp("personId", "MOHRE person ID (14 digits)", "maxlength=14 inputmode=numeric")}</div>
    <div class="fields">${inp("routing", "Bank / exchange routing code (9 digits)", "maxlength=9 inputmode=numeric")}${inp("account", "IBAN or salary card number", "maxlength=34")}${inp("bankName", "Bank / exchange house", "maxlength=80")}</div>
    <div class="sec">Documents</div>
    <div class="fields">${inp("passportNo", "Passport no.", "maxlength=20")}${inp("passportExpiry", "Passport expiry", "type=date")}${inp("eidNo", "Emirates ID no.", "maxlength=20")}${inp("eidExpiry", "Emirates ID expiry", "type=date")}</div>
    <div class="fields">${inp("visaExpiry", "Residence visa expiry", "type=date")}${inp("labourCardExpiry", "Labour card / work permit expiry", "type=date")}${inp("insuranceExpiry", "Health insurance expiry", "type=date")}</div>
    <div class="sec">Opening balances (when moving from another system)</div>
    <div class="fields">${inp("leaveOpening", "Annual leave balance (days)", `class="num" inputmode="decimal" value="${v.leaveOpening || ""}"`)}${inp("leaveAsOf", "Balance as of", "type=date")}${inp("unpaidBefore", "Unpaid leave days before", `class="num" inputmode="numeric" value="${v.unpaidBefore || ""}"`)}</div>
    <label><span class="lbl">Notes</span><textarea name="notes" rows="2" maxlength="2000">${esc(v.notes || "")}</textarea></label>
    <datalist id="natL">${["India", "Pakistan", "Philippines", "Bangladesh", "Nepal", "Sri Lanka", "Egypt", "Jordan", "Lebanon", "Syria", "United Kingdom", "UAE", "Saudi Arabia", "Oman", "Kuwait", "Bahrain", "Qatar"].map(x => `<option value="${x}">`).join("")}</datalist>
    <div class="foot"><button type="button" data-x>Cancel</button><button class="primary" id="sv">Save employee</button></div></form>`, { wide: true, onOpen: (d, done) => {
    const f = d.querySelector("form");
    const sync = () => { d.querySelector("#leftF").hidden = f.status.value !== "left"; };
    f.status.onchange = sync; sync();
    f.onsubmit = async ev => {
      ev.preventDefault(); const body = Object.fromEntries(new FormData(f)); if (e) body.etag = e.etag;
      const r = await act(d.querySelector("#sv"), () => api(e ? "PUT" : "POST", "employees" + (e ? "/" + e.id : ""), body), e ? "Employee saved" : "Employee added");
      if (r) { done(r); await load(); go("#/employee/" + r.id); }
    };
  } });
}

function employee(id) {
  const e = D.employees.find(x => x.id === id); if (!e) return go("#/employees");
  const g = e.gratuity, lv = e.leave, s = e.service;
  const leave = D.leave.filter(l => l.empId === id);
  const slips = D.runs.filter(r => r.lines.some(l => l.empId === id));
  const dl = (k, v) => `<div><span>${k}</span><b>${v || "-"}</b></div>`;
  page(e.name, [e.designation, e.empNo].filter(Boolean).join(" · ") || "Employee", `<button id="ed">Edit</button><button id="lv">+ Leave</button>`, `
    <div class="prof"><div>
      <section class="card" style="margin-bottom:16px"><header><h2>Employment</h2>${st(e.status)}</header><div class="bd dl2">
        ${dl("Department", esc(e.department))}${dl("Nationality", esc(e.nationality) + (e.gcc ? " (GCC national)" : ""))}${dl("Joining date", fd(e.joinDate))}${dl("Contract", e.contract === "limited" ? "Limited" : "Unlimited")}
        ${e.status === "left" ? dl("Last working day", fd(e.endDate)) + dl("Reason", esc(e.endReason)) : ""}${dl("Service", `${r2(s.years).toFixed(2)} years`)}${dl("Email", esc(e.email))}${dl("Mobile", esc(e.mobile))}</div></section>
      <section class="card" style="margin-bottom:16px"><header><h2>Wage and WPS</h2></header><div class="bd dl2">
        ${dl("Basic", "AED " + aed(e.basic))}${dl("Housing", "AED " + aed(e.housing))}${dl("Transport", "AED " + aed(e.transport))}${dl("Other allowances", "AED " + aed(e.otherAllow))}${dl("Monthly wage", "<b>AED " + aed(fixedGross(e)) + "</b>")}
        ${dl("Paid through", esc(D.payMethods[e.payMethod]))}${e.payMethod !== "none" ? dl("MOHRE person ID", esc(e.personId) || `<span class="st overdue">Missing</span>`) + dl("Routing code", esc(e.routing) || `<span class="st overdue">Missing</span>`) + dl(e.payMethod === "card" ? "Salary card" : "IBAN", esc(e.account) || `<span class="st overdue">Missing</span>`) + dl("Bank", esc(e.bankName)) : ""}</div></section>
      <section class="card" style="margin-bottom:16px"><header><h2>Documents</h2></header><div class="bd dl2">
        ${dl("Passport", esc(e.passportNo) + " " + expTag(e.passportExpiry))}${dl("Emirates ID", esc(e.eidNo) + " " + expTag(e.eidExpiry))}${dl("Residence visa", expTag(e.visaExpiry))}${dl("Labour card", expTag(e.labourCardExpiry))}${dl("Health insurance", expTag(e.insuranceExpiry))}</div></section>
      <section class="card" style="margin-bottom:16px"><header><h2>Payslips<span>${slips.length}</span></h2></header>
        <div class="tblwrap"><table class="list compact nohover"><thead><tr><th>Month</th><th>Status</th><th class="r">Net pay</th><th class="r"></th></tr></thead><tbody>${slips.map(r => { const l = r.lines.find(x => x.empId === id); return `<tr><td><a href="#/run/${r.month}">${esc(monthName(r.month))}</a></td><td>${st(r.status)}</td><td class="r">${aed(l.net)}</td><td class="r"><span class="lk">${pdfButtons("s" + r.month, "Payslip")}</span></td></tr>`; }).join("") || `<tr><td colspan="4" class="muted">No payroll yet.</td></tr>`}</tbody></table></div></section>
      <section class="card"><header><h2>Leave history<span>${leave.length}</span></h2></header>
        <div class="tblwrap"><table class="list compact nohover"><thead><tr><th>Type</th><th>From</th><th>To</th><th class="r">Days</th><th>Note</th></tr></thead><tbody>${leave.map(l => `<tr><td>${esc(D.leaveTypes[l.type])}</td><td>${fd(l.from)}</td><td>${fd(l.to)}</td><td class="r">${l.days}</td><td>${esc(l.note)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No leave recorded.</td></tr>`}</tbody></table></div></section>
    </div><aside class="side">
      <section class="card"><header><h2>Annual leave</h2></header><div class="bd kv">
        <span>Opening${lv.asOf ? " at " + fd(lv.asOf) : ""}</span><b>${lv.opening} d</b><span>Earned</span><b>${lv.accrued} d</b><span>Taken</span><b>${lv.taken} d</b><span><b>Balance</b></span><b>${lv.balance} d</b></div>
        <div class="bd muted" style="font-size:12px;padding-top:0">2 days a month after six months' service, 30 days a year after the first year (Art. 29).</div></section>
      <section class="card"><header><h2>End-of-service gratuity</h2></header><div class="bd kv">
        <span>Service counted</span><b>${s.days} days</b><span>Unpaid leave excluded</span><b>${s.unpaid} days</b><span><b>Gratuity today</b></span><b>AED ${aed(g.amount)}</b></div>
        <div class="bd muted" style="font-size:12px;padding-top:0">${esc(g.note)}</div>
        <div class="bd acts2" style="padding-top:0">${pdfButtons("gr", "Gratuity statement")}</div></section>
      ${e.notes ? `<section class="card"><header><h2>Notes</h2></header><div class="bd" style="white-space:pre-line;font-size:13px">${esc(e.notes)}</div></section>` : ""}
      ${D.isManager ? `<div class="acts2"><button class="danger" id="del">Delete employee</button></div>` : ""}
    </aside></div>`, "employee");
  const map = { gr: [() => window.HRPdf.gratuity(e, D.today), `Gratuity statement ${e.name} ${D.today}.pdf`] };
  slips.forEach(r => { const l = r.lines.find(x => x.empId === id); map["s" + r.month] = [() => window.HRPdf.slips(r, [l], "slip"), `Payslip ${e.name} ${r.month}.pdf`]; });
  wirePdf($("app"), map);
  $("ed").onclick = () => editEmployee(e);
  $("lv").onclick = () => editLeave(null, id);
  if ($("del")) $("del").onclick = async () => { if (!await confirmBox("Delete employee?", `${esc(e.name)} will be removed. Employees with payroll history can't be deleted; mark them as left instead.`, "Delete", true)) return; if (await act($("del"), () => api("DELETE", "employees/" + id), "Employee deleted") !== undefined) { await load(); go("#/employees"); } };
}

/* ---------- leave ---------- */
function editLeave(l, empId) {
  const v = l || { empId: empId || "", type: "annual", from: D.today, to: D.today };
  return dialog(`<form><h3>${l ? "Edit leave" : "Record leave"}</h3>
    <label><span class="lbl">Employee *</span><select name="empId" required><option value="">Choose…</option>${D.employees.filter(e => e.status !== "left" || e.id === v.empId).map(e => `<option value="${e.id}"${e.id === v.empId ? " selected" : ""}>${esc(e.name)} (balance ${e.leave.balance} d)</option>`).join("")}</select></label>
    <div class="fields"><label><span class="lbl">Type</span><select name="type">${Object.entries(D.leaveTypes).map(([k, t]) => `<option value="${k}"${k === v.type ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      <label><span class="lbl">First day *</span><input type="date" name="from" required value="${esc(v.from)}"></label><label><span class="lbl">Last day *</span><input type="date" name="to" required value="${esc(v.to)}"></label>
      <label><span class="lbl">Days</span><input name="days" class="num" inputmode="decimal" value="${l ? l.days : ""}" placeholder="calendar days"></label></div>
    <label><span class="lbl">Note</span><input name="note" maxlength="300" value="${esc(v.note || "")}"></label>
    <p class="muted" style="font-size:12px;margin:0">Unpaid leave reduces that month's pay and isn't counted as service for gratuity. Leave the days blank to count calendar days.</p>
    <div class="foot">${l ? `<button type="button" class="danger" id="dl" style="margin-right:auto">Delete</button>` : ""}<button type="button" data-x>Cancel</button><button class="primary" id="sv">Save</button></div></form>`, { onOpen: (d, done) => {
    const f = d.querySelector("form");
    f.onsubmit = async ev => { ev.preventDefault(); const r = await act(d.querySelector("#sv"), () => api(l ? "PUT" : "POST", "leave" + (l ? "/" + l.id : ""), Object.fromEntries(new FormData(f))), "Leave saved"); if (r) { done(r); reload(); } };
    const del = d.querySelector("#dl"); if (del) del.onclick = async () => { if (await act(del, () => api("DELETE", "leave/" + l.id), "Leave deleted") !== undefined) { done(true); reload(); } };
  } });
}
function leaveView() {
  page("Leave", "HR & Payroll", `<button class="primary" id="nl">+ Record leave</button>`, `
    <div class="grid2" style="grid-template-columns:minmax(0,2fr) minmax(300px,1fr)">
      <section class="card"><header><h2>Leave records<span>${D.leave.length}</span></h2></header><div class="tblwrap"><table class="list compact"><thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th class="r">Days</th><th>Note</th></tr></thead><tbody id="rows">${D.leave.map(l => { const e = D.employees.find(x => x.id === l.empId) || {}; return `<tr data-id="${l.id}"><td>${esc(e.name)}</td><td>${l.type === "unpaid" ? `<span class="st partial">Unpaid</span>` : esc(D.leaveTypes[l.type])}</td><td>${fd(l.from)}</td><td>${fd(l.to)}</td><td class="r">${l.days}</td><td>${esc(l.note)}</td></tr>`; }).join("")}</tbody></table>${D.leave.length ? "" : `<div class="empty">No leave recorded yet.</div>`}</div></section>
      <section class="card"><header><h2>Annual leave balances</h2></header><div class="tblwrap"><table class="list compact nohover"><thead><tr><th>Employee</th><th class="r">Earned</th><th class="r">Taken</th><th class="r">Balance</th></tr></thead><tbody>${active().map(e => `<tr><td><a href="#/employee/${e.id}">${esc(e.name)}</a></td><td class="r">${r2(e.leave.opening + e.leave.accrued)}</td><td class="r">${e.leave.taken}</td><td class="r"><b>${e.leave.balance}</b></td></tr>`).join("")}</tbody></table></div>
      <div class="bd muted" style="font-size:12px">Statutory leave (Labour Law Art. 29 to 32): 30 days annual after a year, 90 days sick (15 full, 30 half, 45 unpaid), 60 days maternity (45 full, 15 half), 5 days parental, 3 to 5 days bereavement, up to 10 days study.</div></section>
    </div>`, "leave");
  $("nl").onclick = () => editLeave();
  $("rows").querySelectorAll("tr").forEach(tr => tr.onclick = () => editLeave(D.leave.find(l => l.id === tr.dataset.id)));
}

/* ---------- payroll ---------- */
async function newRun() {
  const t = D.today; const def = D.runs.some(r => r.month === t.slice(0, 7)) ? new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7), 1)).toISOString().slice(0, 7) : t.slice(0, 7);
  return dialog(`<form><h3>New payroll run</h3><label><span class="lbl">Salary month</span><input type="month" name="month" required value="${def}"></label>
    <p class="muted" style="font-size:13px">Takes every employee employed in that month, prorates joiners and leavers by calendar days, and deducts unpaid leave already recorded. You can then add overtime, bonuses and deductions before approving.</p>
    <div class="foot"><button type="button" data-x>Cancel</button><button class="primary" id="sv">Create run</button></div></form>`, { onOpen: (d, done) => {
    d.querySelector("form").onsubmit = async ev => { ev.preventDefault(); const m = d.querySelector("[name=month]").value; const r = await act(d.querySelector("#sv"), () => api("POST", "runs", { month: m }), "Payroll run created"); if (r) { done(r); await load(); go("#/run/" + r.month); } };
  } });
}
function payroll() {
  page("Payroll runs", "HR & Payroll", `<button class="primary" id="nr">+ Payroll run</button>`, `
    <div class="panel listpanel"><div class="tblwrap"><table class="list"><thead><tr><th>Month</th><th>Status</th><th class="r">Employees</th><th class="r">Net pay (AED)</th><th>Due by</th><th>WPS file</th><th>Books</th><th>Paid on</th></tr></thead><tbody id="rows">${D.runs.map(r => `<tr data-m="${r.month}"><td class="t">${esc(monthName(r.month))}</td><td>${st(r.status)}</td><td class="r">${r.count}</td><td class="r">${aed(r.total)}</td><td>${r.status !== "paid" && D.today >= dueOf(r.month) ? `<span class="st overdue">${fd(dueOf(r.month))}</span>` : fd(dueOf(r.month))}</td><td>${r.sifAt ? fd(r.sifAt) : `<span class="muted">-</span>`}</td><td>${r.journalId ? `<span class="st posted">Posted</span>` : `<span class="muted">-</span>`}</td><td>${fd(r.payDate)}</td></tr>`).join("")}</tbody></table>${D.runs.length ? "" : `<div class="empty"><strong>No payroll yet</strong>Create the first monthly run.</div>`}</div></div>`, "payroll");
  $("nr").onclick = newRun;
  $("rows").querySelectorAll("tr").forEach(tr => tr.onclick = () => go("#/run/" + tr.dataset.m));
}

// WPS salary information file: one EDR line per employee paid through WPS and the SCR control line.
function buildSif(run) {
  const S = D.settings, lines = run.lines.filter(l => l.payMethod !== "none"), errs = [];
  if (!/^\d{1,13}$/.test(S.employerId)) errs.push("MOHRE establishment ID (Settings)");
  if (!/^\d{9}$/.test(S.employerRouting)) errs.push("employer bank routing code (Settings)");
  lines.forEach(l => { const m = [!/^\d{1,14}$/.test(l.personId || "") && "person ID", !/^\d{9}$/.test(l.routing || "") && "routing code", !l.account && "IBAN / card"].filter(Boolean); if (m.length) errs.push(`${l.name}: ${m.join(", ")}`); if (l.net < 0) errs.push(`${l.name}: net pay is negative`); });
  if (!lines.length) errs.push("nobody in this run is paid through WPS");
  const now = new Date(Date.now() + 4 * 3600e3), iso = now.toISOString(); // UAE time
  const date = iso.slice(0, 10), hhmm = iso.slice(11, 13) + iso.slice(14, 16), stamp = iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10) + iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19);
  const f2 = n => r2(n).toFixed(2);
  let total = 0;
  const edr = lines.map(l => {
    const fixed = r2(Math.min(l.sifFixed, Math.max(0, l.net))), variable = r2(Math.max(0, l.net - fixed)); total += fixed + variable;
    return ["EDR", String(l.personId).padStart(14, "0"), l.routing, l.account, l.from, l.to, l.employed, f2(fixed), f2(variable), l.unpaidDays].join(",");
  });
  const emp = String(S.employerId).padStart(13, "0"), mm = run.month.slice(5, 7) + run.month.slice(0, 4);
  const scr = ["SCR", emp, S.employerRouting, date, hhmm, mm, edr.length, f2(total), "AED", (S.employerName || D.company.name).replace(/,/g, " ").slice(0, 35)].join(",");
  return { errs, text: edr.concat(scr).join("\r\n") + "\r\n", name: `${emp}${stamp}.SIF`, count: edr.length, total: r2(total), outside: run.lines.length - lines.length };
}

function runView(ym) {
  const r = D.runs.find(x => x.month === ym); if (!r) return go("#/payroll");
  const draft = r.status === "draft", L = r.lines;
  const sum = k => L.reduce((a, l) => a + num(l[k]), 0);
  const steps = [["Draft", true], ["Approved", r.status !== "draft"], ["WPS file", !!r.sifAt], ["Posted to Books", !!r.journalId], ["Paid", r.status === "paid"]];
  const nowStep = steps.findIndex(s => !s[1]);
  const late = r.status !== "paid" && D.today >= dueOf(ym);
  const cell = (l, k) => draft ? `<input class="num" data-e="${l.empId}" data-k="${k}" value="${l[k] || ""}" inputmode="decimal" placeholder="0">` : aed(l[k]);
  page(`Payroll ${monthName(ym)}`, `${r.count} employees · net AED ${aed(r.total)}`, `${draft ? `<button class="danger" id="delRun">Delete draft</button><button id="save">Save changes</button><button class="primary" id="approve">Approve payroll</button>` : r.status === "approved" && !r.journalId ? `<button id="reopen">Reopen</button>` : ""}`, `
    <div class="steps">${steps.map((s, i) => `<span class="${s[1] ? "done" : i === nowStep ? "now" : ""}">${s[1] ? "✓ " : ""}${s[0]}</span>`).join("")}</div>
    ${late ? `<div class="note bad" style="margin-bottom:12px"><b>Salary overdue</b>Salaries for ${esc(monthName(ym))} were due through WPS by ${fd(dueOf(ym))}. Late payment can lead to MOHRE work-permit suspension and fines.</div>` : `<div class="note" style="margin-bottom:12px"><b>Due by ${fd(dueOf(ym))}</b>Salaries must be paid through WPS by the 1st of the following month.</div>`}
    ${r.warnings.length ? `<div class="note warn" style="margin-bottom:12px"><b>Check before paying</b>${r.warnings.map(esc).join("<br>")}</div>` : ""}
    <section class="card" style="margin-bottom:16px"><header><h2>Employees<span>${draft ? "type overtime, bonuses and deductions, then save" : "approved figures"}</span></h2></header>
      <div class="tblwrap"><table class="pay"><thead><tr><th>Employee</th><th>Days paid</th><th>Unpaid days</th><th>Fixed wage</th><th>Fixed paid</th><th>Overtime</th><th>Bonus</th><th>Commission</th><th>Other add.</th><th>Advance</th><th>Other ded.</th><th>Net pay</th><th>Note</th></tr></thead>
      <tbody>${L.map(l => `<tr class="${l.net < 0 ? "bad" : ""}"><td><a href="#/employee/${l.empId}"><b>${esc(l.name)}</b></a><span class="s">${esc([l.empNo, l.payMethod === "none" ? "outside WPS" : l.payMethod === "card" ? "WPS card" : "WPS bank"].filter(Boolean).join(" · "))}${l.employed < l.daysInMonth ? ` · ${fd(l.from)} to ${fd(l.to)}` : ""}</span></td>
        <td>${l.employed - l.unpaidDays}/${l.daysInMonth}</td><td>${draft ? `<input class="num ud" data-e="${l.empId}" data-k="unpaidDays" value="${l.unpaidDays}" title="From unpaid leave records. Change it to override.">` : l.unpaidDays}</td>
        <td>${aed(l.fixedGross)}</td><td>${aed(l.fixed)}</td><td>${cell(l, "overtime")}</td><td>${cell(l, "bonus")}</td><td>${cell(l, "commission")}</td><td>${cell(l, "otherAdd")}</td><td>${cell(l, "advance")}</td><td>${cell(l, "otherDed")}</td>
        <td class="net">${aed(l.net)}</td><td>${draft ? `<input class="nt" data-e="${l.empId}" data-k="note" value="${esc(l.note)}" maxlength="200">` : `<span class="s">${esc(l.note)}</span>`}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td><td></td><td>${sum("unpaidDays")}</td><td>${aed(sum("fixedGross"))}</td><td>${aed(sum("fixed"))}</td><td>${aed(sum("overtime"))}</td><td>${aed(sum("bonus"))}</td><td>${aed(sum("commission"))}</td><td>${aed(sum("otherAdd"))}</td><td>${aed(sum("advance"))}</td><td>${aed(sum("otherDed"))}</td><td>${aed(sum("net"))}</td><td></td></tr></tfoot></table></div>
      <div class="bd muted" style="font-size:12px">Fixed pay is the monthly wage for the calendar days employed less unpaid leave. Deductions over 20% of the month's wage are flagged (Labour Law Art. 25).</div></section>
    <section class="card" style="margin-bottom:16px"><header><h2>Payslips and salary receipts<span>one page per employee; the receipt carries the employee's signed acknowledgement</span></h2></header>
      <div class="tblwrap"><table class="list compact nohover"><thead><tr><th>Employee</th><th class="r">Net pay (AED)</th><th>Payslip</th><th>Salary receipt</th></tr></thead><tbody>${L.map(l => `<tr><td>${esc(l.name)}</td><td class="r">${aed(l.net)}</td><td><span class="lk">${pdfButtons("p" + l.empId, "Download")}</span></td><td><span class="lk">${pdfButtons("r" + l.empId, "Download")}</span></td></tr>`).join("")}</tbody></table></div></section>
    <div class="grid3">
      <section class="card"><header><h2>Documents</h2></header><div class="bd acts2">
        <div style="display:flex;gap:8px">${pdfButtons("reg", "Payroll register")}</div>
        <div style="display:flex;gap:8px">${pdfButtons("all", "All payslips")}</div>
        <div style="display:flex;gap:8px">${pdfButtons("rcp", "All salary receipts")}</div>
        <button id="xl">Export to Excel</button></div></section>
      <section class="card"><header><h2>WPS salary file (SIF)</h2>${r.sifAt ? `<span class="st posted">Created ${fd(r.sifAt)}</span>` : ""}</header><div class="bd acts2" id="sifBd"></div></section>
      <section class="card"><header><h2>Accounts and payment</h2></header><div class="bd acts2">
        ${r.journalId ? `<div class="kv"><span>Payroll journal</span><b>${D.books ? `<a href="/books/#/doc/${r.journalId}">Open in Books</a>` : "Posted"}</b>${r.payJournalId ? `<span>Payment journal</span><b>${D.books ? `<a href="/books/#/doc/${r.payJournalId}">Open in Books</a>` : "Posted"}</b>` : ""}</div>`
          : `<p class="muted" style="font-size:12px;margin:0">Posts salaries and allowances to ${esc(D.settings.expenseAccount)}, net pay to ${esc(D.settings.payableAccount)} Salaries Payable, advances recovered to ${esc(D.settings.advanceAccount)}${D.settings.eosbAccrual ? " and the month's gratuity accrual to 2300" : ""}.</p><button id="post"${draft || !D.books ? " disabled" : ""}>Post to Books</button>${!D.books ? `<span class="muted" style="font-size:12px">Needs Books access.</span>` : ""}`}
        ${r.status === "paid" ? `<div class="kv"><span>Paid on</span><b>${fd(r.payDate)}</b><span>Marked by</span><b>${esc(r.paidBy)}</b></div>` : `<button class="primary" id="paid"${draft ? " disabled" : ""}>Mark as paid</button>`}
        ${r.approvedBy ? `<div class="muted" style="font-size:12px">Approved by ${esc(r.approvedBy)} on ${fd(r.approvedAt)}.</div>` : ""}</div></section>
    </div>`, "run");

  // PDFs
  const map = { reg: [() => window.HRPdf.register(r), `Payroll register ${ym}.pdf`], all: [() => window.HRPdf.slips(r, L, "slip"), `Payslips ${ym}.pdf`], rcp: [() => window.HRPdf.slips(r, L, "receipt"), `Salary receipts ${ym}.pdf`] };
  L.forEach(l => { map["p" + l.empId] = [() => window.HRPdf.slips(r, [l], "slip"), `Payslip ${l.name} ${ym}.pdf`]; map["r" + l.empId] = [() => window.HRPdf.slips(r, [l], "receipt"), `Salary receipt ${l.name} ${ym}.pdf`]; });
  wirePdf($("app"), map);
  $("xl").onclick = () => act($("xl"), () => exportSheet(`Payroll ${ym} ${D.company.name}`, [["Employee no.", "Name", "Person ID", "Pay through", "From", "To", "Days in month", "Days employed", "Unpaid days", "Fixed wage", "Fixed paid", "Overtime", "Bonus", "Commission", "Other additions", "Advance", "Other deductions", "Net pay", "Note"],
    ...L.map(l => [l.empNo, l.name, l.personId, D.payMethods[l.payMethod], l.from, l.to, l.daysInMonth, l.employed, l.unpaidDays, l.fixedGross, l.fixed, l.overtime, l.bonus, l.commission, l.otherAdd, l.advance, l.otherDed, l.net, l.note])]));

  // SIF
  const sif = buildSif(r);
  $("sifBd").innerHTML = draft ? `<p class="muted" style="font-size:13px;margin:0">Approve the payroll to create the WPS file for your bank or exchange house.</p>`
    : sif.errs.length ? `<div class="note bad"><b>Can't create the file yet</b>${sif.errs.map(esc).join("<br>")}</div>`
    : `<div class="kv"><span>Employees in file</span><b>${sif.count}</b><span>File total</span><b>AED ${aed(sif.total)}</b>${sif.outside ? `<span>Paid outside WPS</span><b>${sif.outside}</b>` : ""}</div><div class="sifbox" id="sifPre" hidden></div><div style="display:flex;gap:8px"><button id="sifPv">Preview</button><button class="primary" id="sifDl">Download SIF</button></div><div class="muted" style="font-size:12px">Upload the file to your bank or exchange house WPS portal. A new file name is stamped each time you download.</div>`;
  if ($("sifPv")) $("sifPv").onclick = () => { const p = $("sifPre"); p.hidden = !p.hidden; p.textContent = `${sif.name}\n\n${buildSif(r).text}`; };
  if ($("sifDl")) $("sifDl").onclick = () => act($("sifDl"), async () => {
    const s = buildSif(r); saveBlob(new Blob([s.text], { type: "text/plain" }), s.name);
    await api("POST", `runs/${ym}/status`, { action: "sif" }); await reload();
  }, "WPS file downloaded");

  // actions
  const collect = () => { const m = new Map(L.map(l => [l.empId, { empId: l.empId, overtime: l.overtime, bonus: l.bonus, commission: l.commission, otherAdd: l.otherAdd, advance: l.advance, otherDed: l.otherDed, note: l.note, unpaidManual: l.unpaidManual, unpaidDays: l.unpaidDays }]));
    $("app").querySelectorAll("[data-e]").forEach(i => { const o = m.get(i.dataset.e); if (i.dataset.k === "note") o.note = i.value; else if (i.dataset.k === "unpaidDays") { const v = Math.max(0, Math.round(num(i.value))); const orig = L.find(l => l.empId === i.dataset.e); if (v !== orig.unpaidDays || orig.unpaidManual) { o.unpaidManual = true; o.unpaidDays = v; } } else o[i.dataset.k] = num(i.value); });
    return [...m.values()]; };
  let dirty = false; $("app").querySelectorAll("[data-e]").forEach(i => i.oninput = () => { dirty = true; });
  const save = () => api("PUT", "runs/" + ym, { lines: collect(), etag: r.etag });
  if ($("save")) $("save").onclick = async () => { if (await act($("save"), save, "Payroll recalculated")) reload(); };
  if ($("approve")) $("approve").onclick = async () => {
    const b = $("approve"); if (dirty && !await act(b, save)) return;
    if (!await confirmBox(`Approve payroll for ${monthName(ym)}?`, `Net pay AED ${aed(r.total)} for ${r.count} employees${r.warnings.length ? `. <b>${r.warnings.length} warning(s) are shown above.</b>` : "."} Once approved, the figures are locked for the WPS file and payslips.`, "Approve")) return;
    if (await act(b, () => api("POST", `runs/${ym}/status`, { action: "approve" }), "Payroll approved")) reload();
  };
  if ($("reopen")) $("reopen").onclick = async () => { if (await confirmBox("Reopen payroll?", "It goes back to draft so you can change it. Any WPS file already sent to the bank must be cancelled with them.", "Reopen") && await act($("reopen"), () => api("POST", `runs/${ym}/status`, { action: "reopen" }), "Payroll reopened")) reload(); };
  if ($("delRun")) $("delRun").onclick = async () => { if (await confirmBox("Delete this draft?", `The ${esc(monthName(ym))} draft run will be deleted.`, "Delete", true) && await act($("delRun"), () => api("DELETE", "runs/" + ym), "Draft deleted") !== undefined) { await load(); go("#/payroll"); } };
  if ($("post")) $("post").onclick = async () => { if (await confirmBox("Post to Books?", `A manual journal dated ${fd(ym + "-" + String(L[0].daysInMonth).padStart(2, "0"))} will be created for net pay AED ${aed(r.total)}.`, "Post") && await act($("post"), () => api("POST", `runs/${ym}/status`, { action: "post" }), "Posted to Books")) reload(); };
  if ($("paid")) $("paid").onclick = () => dialog(`<form><h3>Mark ${esc(monthName(ym))} as paid</h3><label><span class="lbl">Date the salaries were paid (WPS transfer date)</span><input type="date" name="d" required value="${D.today}"></label>
    ${r.journalId ? `<label class="chk"><input type="checkbox" name="j" checked> Post the payment in Books (Dr ${esc(D.settings.payableAccount)} Salaries Payable, Cr ${esc(D.settings.payAccount)} bank)</label>` : ""}
    <div class="foot"><button type="button" data-x>Cancel</button><button class="primary" id="sv">Mark paid</button></div></form>`, { onOpen: (d, done) => {
    d.querySelector("form").onsubmit = async ev => { ev.preventDefault(); const f = ev.target; const x = await act(d.querySelector("#sv"), () => api("POST", `runs/${ym}/status`, { action: "paid", payDate: f.d.value, postPayment: f.j ? f.j.checked : false }), "Marked as paid"); if (x) { done(x); reload(); } };
  } });
}

/* ---------- gratuity, documents ---------- */
function gratuityView() {
  const list = D.employees.filter(e => e.status !== "left");
  const tot = list.reduce((a, e) => a + e.gratuity.amount, 0);
  page("End-of-service gratuity", `Liability as of ${fd(D.today)}`, `<button id="xl">Export to Excel</button>`, `
    <div class="kpis"><div class="kpi"><div class="k">Total liability</div><div class="v"><small>AED</small>${aed(tot)}</div><div class="s">${list.length} current employees</div></div>
      <div class="kpi" style="--c:var(--warn)"><div class="k">Eligible now</div><div class="v">${list.filter(e => e.gratuity.eligible).length}</div><div class="s">one year of service or more</div></div></div>
    <div class="panel listpanel"><div class="tblwrap"><table class="list"><thead><tr><th>Employee</th><th>Joined</th><th class="r">Service (years)</th><th class="r">Unpaid days</th><th class="r">Basic</th><th class="r">Gratuity (AED)</th><th>Basis</th><th></th></tr></thead><tbody>${list.map(e => `<tr><td><a href="#/employee/${e.id}"><b>${esc(e.name)}</b></a></td><td>${fd(e.joinDate)}</td><td class="r">${r2(e.service.years).toFixed(2)}</td><td class="r">${e.service.unpaid}</td><td class="r">${aed(e.basic)}</td><td class="r"><b>${aed(e.gratuity.amount)}</b></td><td class="muted" style="font-size:12px;max-width:360px">${esc(e.gratuity.note)}</td><td><span class="lk" style="display:inline-flex;gap:4px">${pdfButtons("g" + e.id, "PDF")}</span></td></tr>`).join("")}</tbody>
    <tfoot><tr><td>Total</td><td></td><td></td><td></td><td></td><td class="r">${aed(tot)}</td><td></td><td></td></tr></tfoot></table></div></div>
    <p class="muted" style="font-size:12px">Labour Law Art. 51: 21 days' basic wage a year for the first five years and 30 days a year after, from one year of continuous service, capped at two years' wage. UAE and GCC nationals are covered by the pension law instead. Compare the total with account 2300 End-of-service provision in Books.</p>`, "gratuity");
  const map = {}; list.forEach(e => { map["g" + e.id] = [() => window.HRPdf.gratuity(e, D.today), `Gratuity statement ${e.name} ${D.today}.pdf`]; }); wirePdf($("app"), map);
  $("xl").onclick = () => act($("xl"), () => exportSheet(`Gratuity ${D.company.name} ${D.today}`, [["Employee no.", "Name", "Joining date", "Service days", "Unpaid days", "Years", "Basic", "Gratuity (AED)", "Basis"], ...list.map(e => [e.empNo, e.name, e.joinDate, e.service.days, e.service.unpaid, r2(e.service.years), e.basic, e.gratuity.amount, e.gratuity.note])]));
}
function documents() {
  const rows = [];
  active().forEach(e => Object.entries(D.docs).forEach(([k, l]) => rows.push([e, l, e[k]])));
  rows.sort((a, b) => (a[2] || "9999").localeCompare(b[2] || "9999"));
  const soon = addDays(D.today, 30);
  page("Documents and expiry", "HR & Payroll", "", `
    <div class="tools"><div class="seg" id="sf"><button aria-pressed="true" data-v="due">Expired or due in 30 days</button><button aria-pressed="false" data-v="missing">Not recorded</button><button aria-pressed="false" data-v="">All</button></div></div>
    <div class="panel listpanel"><div class="tblwrap"><table class="list"><thead><tr><th>Employee</th><th>Document</th><th>Expiry</th></tr></thead><tbody id="rows"></tbody></table><div class="empty" id="empty" hidden>Nothing to show.</div></div></div>
    <p class="muted" style="font-size:12px">Renew the residence visa and work permit before expiry to avoid MOHRE and ICP fines, and keep health insurance in force for every employee (mandatory across the UAE from 2025).</p>`, "documents");
  let f = "due";
  const draw = () => { const l = rows.filter(([, , d]) => f === "due" ? d && d <= soon : f === "missing" ? !d : true);
    $("rows").innerHTML = l.map(([e, n, d]) => `<tr data-id="${e.id}"><td>${esc(e.name)}</td><td>${esc(n)}</td><td>${expTag(d)}</td></tr>`).join(""); $("empty").hidden = !!l.length;
    $("rows").querySelectorAll("tr").forEach(tr => tr.onclick = () => go("#/employee/" + tr.dataset.id)); };
  $("sf").querySelectorAll("button").forEach(b => b.onclick = () => { f = b.dataset.v; $("sf").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); draw(); });
  draw();
}

/* ---------- settings ---------- */
function settingsView() {
  const S = D.settings;
  page("Settings", "HR & Payroll", "", `<form id="f" class="settings" style="max-width:820px">
    <section class="panel"><h2>Wage Protection System</h2>
      <div class="fields"><label><span class="lbl">MOHRE establishment (employer) ID</span><input name="employerId" maxlength="13" inputmode="numeric" value="${esc(S.employerId)}"></label>
        <label><span class="lbl">Employer bank routing code (9 digits)</span><input name="employerRouting" maxlength="9" inputmode="numeric" value="${esc(S.employerRouting)}"></label></div>
      <label><span class="lbl">Employer name / reference in the file (up to 35 characters)</span><input name="employerName" maxlength="35" value="${esc(S.employerName)}"></label>
      <p class="muted" style="font-size:12px;margin:0">The SIF file name is the 13-digit employer ID followed by the creation date and time (YYMMDDHHMMSS). Your bank or exchange house gives you the routing code of the account the salaries are paid from.</p></section>
    <section class="panel"><h2>Posting to Books</h2>
      <div class="fields"><label><span class="lbl">Salaries expense account</span><input name="expenseAccount" maxlength="10" value="${esc(S.expenseAccount)}"></label><label><span class="lbl">Salaries payable account</span><input name="payableAccount" maxlength="10" value="${esc(S.payableAccount)}"></label></div>
      <div class="fields"><label><span class="lbl">Bank account salaries are paid from</span><input name="payAccount" maxlength="10" value="${esc(S.payAccount)}"></label><label><span class="lbl">Staff advances account</span><input name="advanceAccount" maxlength="10" value="${esc(S.advanceAccount)}"></label></div>
      <label class="chk"><input type="checkbox" name="eosbAccrual"${S.eosbAccrual ? " checked" : ""}> Accrue end-of-service gratuity each month (Dr 6020, Cr 2300) when payroll is posted</label></section>
    <div class="edfoot"><button class="primary" id="sv">Save settings</button></div></form>`, "settings");
  $("f").onsubmit = async ev => { ev.preventDefault(); const b = Object.fromEntries(new FormData(ev.target)); b.eosbAccrual = !!ev.target.eosbAccrual.checked; if (await act($("sv"), () => api("PUT", "settings", b), "Settings saved")) reload(); };
}

/* ---------- start ---------- */
async function boot() {
  try { await load(); }
  catch (e) { $("app").innerHTML = `<div class="empty"><strong>${e.status === 403 ? "No access" : e.status === 400 ? "Choose a company" : "Couldn't load HR & Payroll"}</strong>${esc(e.message)}</div>`; nav("dashboard"); return; }
  route();
}
window.addEventListener("hashchange", route);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
