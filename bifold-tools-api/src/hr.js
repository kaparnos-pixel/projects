// HR & Payroll: employees, leave, monthly payroll through the UAE Wage Protection System (WPS), payslips,
// end-of-service gratuity and document expiry alerts. One set per company (Tech Hub, Bifold).
//
// Rules applied (Federal Decree-Law No. 33 of 2021 and MOHRE WPS rules; not legal advice):
//   * Salary for a month is due by the 1st of the next month through WPS (Ministerial Resolution No. 340 of 2026).
//     A payroll run shows that date and the alerts flag a run not marked paid by then.
//   * WPS SIF: one EDR line per employee (14-digit MOHRE person ID, 9-digit agent routing code, IBAN / salary card,
//     pay period, days, fixed and variable income, unpaid leave days) and one SCR line. Built in the browser.
//   * Gratuity (Art. 51): after one year of continuous service, 21 days' basic wage a year for the first five years
//     and 30 days a year after that, pro rata for part years, unpaid leave excluded, capped at two years' wage.
//     UAE and GCC nationals are covered by the pension law instead (flagged, not calculated).
//   * Annual leave (Art. 29): 2 days a month after six months' service, 30 days a year after the first year.
//   * Deductions above 20% of the wage are flagged (Art. 25 limits deductions); a run that pays less than 85% of
//     contracted wages is flagged against the WPS compliance threshold.
//
// Storage (Table Storage "hrpayroll"): "set-<co>"/org, "emp-<co>"/<uuid>, "leave-<co>"/<uuid>, "run-<co>"/<YYYY-MM>
// Access: section "hr" (HR & Payroll). Managers always.

const crypto = require("crypto");

const LEAVE_TYPES = { annual: "Annual leave", sick: "Sick leave", unpaid: "Unpaid leave", maternity: "Maternity leave", parental: "Parental leave", bereavement: "Bereavement leave", hajj: "Hajj / Umrah leave", study: "Study leave", other: "Other" };
const PAY_METHODS = { bank: "WPS: bank account", card: "WPS: salary card", none: "Not paid through WPS" };
const DOCS = { passportExpiry: "Passport", visaExpiry: "Residence visa", eidExpiry: "Emirates ID", labourCardExpiry: "Labour card / work permit", insuranceExpiry: "Health insurance" };
const GCC = /^(uae|united arab emirates|emirati|saudi arabia|saudi|kuwait|kuwaiti|bahrain|bahraini|qatar|qatari|oman|omani)$/i;

module.exports = function makeHr(H) {
  const { table, getOrNull, all, packJson, unpackJson, fail, clean, num, isDate, CO, diff, books } = H;
  const T = "hrpayroll";
  const r2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
  const j = (s, d) => { try { const v = JSON.parse(s || ""); return v == null ? d : v; } catch { return d; } };
  const today = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const daysIn = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  const dayCount = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5) + 1; // inclusive
  const coOf = user => { if (user.co === "all") fail(400, "HR & Payroll works one company at a time. Switch to Bifold or Tech Hub in the top bar."); return user.co; };
  const needHr = user => { if (!user.isManager && !(user.sections || []).includes("hr")) fail(403, "You don't have access to HR & Payroll. Ask a manager to give you access."); };
  const quietly = async (user, fn) => { const keep = user.aud; user.aud = {}; try { return await fn(); } finally { user.aud = keep; } };

  /* ---------------- settings ---------------- */
  const setOut = (e, co) => ({
    employerId: e && e.employerId || "", employerRouting: e && e.employerRouting || "", employerName: e && e.employerName || CO[co].name.slice(0, 35),
    payAccount: e && e.payAccount || "1100", expenseAccount: e && e.expenseAccount || "6000", payableAccount: e && e.payableAccount || "2210",
    advanceAccount: e && e.advanceAccount || "1380", eosbAccrual: e ? e.eosbAccrual !== false : true, etag: e && e.etag,
  });
  async function settings(co) { return setOut(await getOrNull(await table(T), "set-" + co, "org"), co); }
  async function saveSettings(user, b) {
    const co = coOf(user);
    const f = { employerId: clean(b.employerId, 13).replace(/\D/g, ""), employerRouting: clean(b.employerRouting, 9).replace(/\D/g, ""), employerName: clean(b.employerName, 35),
      payAccount: clean(b.payAccount, 10) || "1100", expenseAccount: clean(b.expenseAccount, 10) || "6000", payableAccount: clean(b.payableAccount, 10) || "2210",
      advanceAccount: clean(b.advanceAccount, 10) || "1380", eosbAccrual: b.eosbAccrual !== false };
    if (f.employerId && f.employerId.length > 13) fail(400, "The MOHRE establishment ID has up to 13 digits.");
    if (f.employerRouting && f.employerRouting.length !== 9) fail(400, "The bank routing code has 9 digits.");
    const t = await table(T); const cur = await getOrNull(t, "set-" + co, "org");
    const e = { partitionKey: "set-" + co, rowKey: "org", ...f, updatedBy: user.email, updatedAt: new Date().toISOString() };
    if (user.aud) user.aud.changes = diff(cur || {}, e);
    await t.upsertEntity(e, "Replace");
    return settings(co);
  }

  /* ---------------- employees ---------------- */
  const ePK = co => "emp-" + co;
  const empOut = e => ({
    id: e.rowKey, empNo: e.empNo || "", name: e.name, designation: e.designation || "", department: e.department || "", nationality: e.nationality || "",
    email: e.email || "", mobile: e.mobile || "", joinDate: e.joinDate || "", contract: e.contract || "unlimited", status: e.status || "active", endDate: e.endDate || "", endReason: e.endReason || "",
    personId: e.personId || "", payMethod: e.payMethod || "bank", routing: e.routing || "", account: e.account || "", bankName: e.bankName || "",
    basic: num(e.basic), housing: num(e.housing), transport: num(e.transport), otherAllow: num(e.otherAllow),
    leaveOpening: num(e.leaveOpening), leaveAsOf: e.leaveAsOf || "", unpaidBefore: num(e.unpaidBefore), notes: e.notes || "",
    passportNo: e.passportNo || "", eidNo: e.eidNo || "", ...Object.fromEntries(Object.keys(DOCS).map(k => [k, e[k] || ""])),
    gcc: GCC.test(String(e.nationality || "").trim()), updatedAt: e.updatedAt, updatedBy: e.updatedBy, etag: e.etag,
  });
  function empIn(b) {
    const f = {
      empNo: clean(b.empNo, 20), name: clean(b.name, 120), designation: clean(b.designation, 100), department: clean(b.department, 60), nationality: clean(b.nationality, 60),
      email: clean(b.email, 150).toLowerCase(), mobile: clean(b.mobile, 30), joinDate: clean(b.joinDate, 10), contract: b.contract === "limited" ? "limited" : "unlimited",
      status: ["active", "leave", "left"].includes(b.status) ? b.status : "active", endDate: clean(b.endDate, 10), endReason: clean(b.endReason, 200),
      personId: clean(b.personId, 14).replace(/\D/g, ""), payMethod: PAY_METHODS[b.payMethod] ? b.payMethod : "bank", routing: clean(b.routing, 9).replace(/\D/g, ""),
      account: clean(b.account, 34).replace(/\s+/g, "").toUpperCase(), bankName: clean(b.bankName, 80),
      basic: Math.max(0, r2(num(b.basic))), housing: Math.max(0, r2(num(b.housing))), transport: Math.max(0, r2(num(b.transport))), otherAllow: Math.max(0, r2(num(b.otherAllow))),
      leaveOpening: r2(num(b.leaveOpening)), leaveAsOf: clean(b.leaveAsOf, 10), unpaidBefore: Math.max(0, Math.round(num(b.unpaidBefore))), notes: clean(b.notes, 2000),
      passportNo: clean(b.passportNo, 20), eidNo: clean(b.eidNo, 20),
    };
    Object.keys(DOCS).forEach(k => { f[k] = clean(b[k], 10); if (f[k] && !isDate(f[k])) fail(400, `The ${DOCS[k].toLowerCase()} expiry date is not valid.`); });
    if (!f.name) fail(400, "Enter the employee's full name as on the labour contract.");
    if (!isDate(f.joinDate)) fail(400, "Enter the joining date.");
    if (f.status === "left" && !isDate(f.endDate)) fail(400, "Enter the last working day.");
    if (f.endDate && f.endDate < f.joinDate) fail(400, "The last working day is before the joining date.");
    if (!(f.basic > 0)) fail(400, "Enter the basic salary.");
    if (f.leaveAsOf && (!isDate(f.leaveAsOf) || f.leaveAsOf < f.joinDate)) fail(400, "The leave balance date must be a date on or after joining.");
    if (f.payMethod !== "none") {
      if (f.personId && f.personId.length > 14) fail(400, "The MOHRE person ID has up to 14 digits.");
      if (f.routing && f.routing.length !== 9) fail(400, "The agent / bank routing code has 9 digits.");
      if (f.payMethod === "bank" && f.account && !/^AE\d{21}$/.test(f.account)) fail(400, "A UAE IBAN is AE followed by 21 digits.");
    }
    return f;
  }
  async function listEmployees(co) { return (await all(await table(T), ePK(co))).map(empOut).sort((a, b) => a.name.localeCompare(b.name)); }
  async function saveEmployee(user, id, b) {
    const co = coOf(user); const t = await table(T); const f = empIn(b); const now = new Date().toISOString();
    if (!id) {
      const e = { partitionKey: ePK(co), rowKey: crypto.randomUUID(), ...f, createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now };
      await t.createEntity(e); if (user.aud) user.aud.name = f.name; return empOut(e);
    }
    const cur = await getOrNull(t, ePK(co), id); if (!cur) fail(404, "This employee no longer exists.");
    const e = { partitionKey: ePK(co), rowKey: id, ...f, createdBy: cur.createdBy, createdAt: cur.createdAt, updatedBy: user.email, updatedAt: now };
    if (user.aud) { user.aud.name = f.name; user.aud.changes = diff(cur, e).filter(x => !/^(passport no|eid no)/.test(x)); }
    try { await t.updateEntity(e, "Replace", { etag: b.etag || cur.etag }); } catch (err) { if (err.statusCode === 412) fail(409, "Someone else changed this employee. Reload and try again."); throw err; }
    return empOut(await t.getEntity(ePK(co), id));
  }
  async function deleteEmployee(user, id) {
    const co = coOf(user); const t = await table(T); const cur = await getOrNull(t, ePK(co), id); if (!cur) return;
    if (user.aud) user.aud.name = cur.name;
    const runs = await all(t, "run-" + co);
    if (runs.some(r => (unpackJson(r).lines || []).some(l => l.empId === id))) fail(400, "This employee has payroll history, which is kept for the records. Mark them as left instead.");
    if (!user.isManager) fail(403, "Only a manager can delete an employee.");
    await t.deleteEntity(ePK(co), id);
  }

  /* ---------------- leave ---------------- */
  const lPK = co => "leave-" + co;
  const leaveOut = e => ({ id: e.rowKey, empId: e.empId, type: e.type, from: e.from, to: e.to, days: num(e.days), note: e.note || "", createdBy: e.createdBy, createdAt: e.createdAt });
  async function listLeave(co) { return (await all(await table(T), lPK(co))).map(leaveOut).sort((a, b) => b.from.localeCompare(a.from)); }
  async function saveLeave(user, id, b) {
    const co = coOf(user); const t = await table(T);
    const emp = await getOrNull(t, ePK(co), clean(b.empId, 60)); if (!emp) fail(400, "Choose the employee.");
    const f = { empId: emp.rowKey, type: LEAVE_TYPES[b.type] ? b.type : "annual", from: clean(b.from, 10), to: clean(b.to, 10), note: clean(b.note, 300) };
    if (!isDate(f.from) || !isDate(f.to) || f.to < f.from) fail(400, "Enter the leave dates (the last day can't be before the first).");
    f.days = num(b.days) > 0 ? r2(num(b.days)) : dayCount(f.from, f.to);
    if (f.days > 366) fail(400, "That's more than a year of leave.");
    const now = new Date().toISOString();
    const e = { partitionKey: lPK(co), rowKey: id || crypto.randomUUID(), ...f, createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now };
    await t.upsertEntity(e, "Replace");
    if (user.aud) { user.aud.name = emp.name; user.aud.changes = [`${LEAVE_TYPES[f.type]} ${f.from} to ${f.to} (${f.days} days)`]; }
    return leaveOut(e);
  }
  async function deleteLeave(user, id) { const co = coOf(user); const t = await table(T); const cur = await getOrNull(t, lPK(co), id); if (!cur) return; if (user.aud) user.aud.name = `${LEAVE_TYPES[cur.type]} ${cur.from}`; await t.deleteEntity(lPK(co), id); }
  // Unpaid leave days that fall inside a month.
  function unpaidInMonth(leave, empId, ym) {
    const a = ym + "-01", b = `${ym}-${String(daysIn(ym)).padStart(2, "0")}`;
    return leave.filter(l => l.empId === empId && l.type === "unpaid" && l.to >= a && l.from <= b)
      .reduce((s, l) => s + Math.min(l.days, dayCount(l.from < a ? a : l.from, l.to > b ? b : l.to)), 0);
  }

  /* ---------------- service, leave balance, gratuity ---------------- */
  function service(emp, leave, asOf) {
    const end = emp.status === "left" && emp.endDate && emp.endDate < asOf ? emp.endDate : asOf;
    const unpaid = (emp.unpaidBefore || 0) + leave.filter(l => l.empId === emp.id && l.type === "unpaid" && l.from <= end).reduce((s, l) => s + l.days, 0);
    const days = Math.max(0, dayCount(emp.joinDate, end) - unpaid);
    return { end, days, years: days / 365, unpaid };
  }
  function gratuity(emp, leave, asOf) {
    const s = service(emp, leave, asOf);
    const daily = emp.basic / 30;
    const total = emp.basic + emp.housing + emp.transport + emp.otherAllow;
    if (emp.gcc) return { ...s, eligible: false, amount: 0, note: "UAE / GCC national: end-of-service benefits follow the pension and social security law, not the labour-law gratuity." };
    if (s.years < 1) return { ...s, eligible: false, amount: 0, note: "Less than one year of continuous service: no gratuity yet." };
    const first = Math.min(5, s.years), rest = Math.max(0, s.years - 5);
    let amount = daily * 21 * first + daily * 30 * rest;
    const cap = total * 24, capped = amount > cap;
    amount = r2(Math.min(amount, cap));
    return { ...s, eligible: true, amount, daily: r2(daily), capped, note: `${r2(first)} year(s) at 21 days and ${r2(rest)} year(s) at 30 days of basic wage (AED ${r2(daily)} a day)${capped ? ", capped at two years' wage" : ""}.` };
  }
  // Leave earned up to a date under Art. 29: nothing in the first six months, 2 days a month from six to twelve months,
  // then 30 days a year (2.5 a month).
  function earned(emp, leave, date) {
    const s = service(emp, leave, date); const months = s.days / (365 / 12);
    if (months < 6) return 0; if (months < 12) return 2 * Math.floor(months);
    return 24 + 30 * ((s.days - 365) / 365); // the first year's 24 days (2 a month from month 6 to 12 in practice) then 30 a year
  }
  function leaveBalance(emp, leave, asOf) {
    // With a "balance as of" date the opening balance replaces everything before it; otherwise count from joining.
    const start = emp.leaveAsOf || emp.joinDate;
    const accrued = Math.max(0, earned(emp, leave, asOf) - (emp.leaveAsOf ? earned(emp, leave, emp.leaveAsOf) : 0));
    const taken = leave.filter(l => l.empId === emp.id && l.type === "annual" && l.from <= asOf && l.from >= start).reduce((a, l) => a + l.days, 0);
    return { accrued: r2(accrued), taken: r2(taken), opening: emp.leaveOpening, asOf: emp.leaveAsOf || "", balance: r2(emp.leaveOpening + accrued - taken) };
  }

  /* ---------------- payroll runs ---------------- */
  const rPK = co => "run-" + co;
  const runOut = e => { const d = unpackJson(e); return { id: e.rowKey, month: e.rowKey, status: e.status, payDate: e.payDate || "", total: num(e.total), count: num(e.count), lines: d.lines || [], journalId: e.journalId || "", payJournalId: e.payJournalId || "", sifAt: e.sifAt || "", approvedBy: e.approvedBy || "", approvedAt: e.approvedAt || "", paidBy: e.paidBy || "", updatedAt: e.updatedAt, updatedBy: e.updatedBy, etag: e.etag, warnings: d.warnings || [] }; };
  const due = ym => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 1)); return d.toISOString().slice(0, 10); };
  async function listRuns(co) { return (await all(await table(T), rPK(co))).map(runOut).sort((a, b) => b.month.localeCompare(a.month)); }
  // Works out one employee's pay for a month from their record, unpaid leave and the run's additions / deductions.
  function lineFor(emp, ym, leave, prev) {
    const n = daysIn(ym), a = ym + "-01", b = `${ym}-${String(n).padStart(2, "0")}`;
    const from = emp.joinDate > a ? emp.joinDate : a, to = emp.status === "left" && emp.endDate && emp.endDate < b ? emp.endDate : b;
    if (to < from) return null;
    const employed = dayCount(from, to);
    const unpaid = prev && prev.unpaidManual ? num(prev.unpaidDays) : unpaidInMonth(leave, emp.id, ym);
    const fixedGross = r2(emp.basic + emp.housing + emp.transport + emp.otherAllow);
    const paidDays = Math.max(0, employed - unpaid);
    const fixed = r2(fixedGross * paidDays / n);
    const add = { overtime: r2(num(prev && prev.overtime)), bonus: r2(num(prev && prev.bonus)), commission: r2(num(prev && prev.commission)), otherAdd: r2(num(prev && prev.otherAdd)) };
    const ded = { advance: r2(num(prev && prev.advance)), otherDed: r2(num(prev && prev.otherDed)) };
    const variable = r2(add.overtime + add.bonus + add.commission + add.otherAdd), deductions = r2(ded.advance + ded.otherDed);
    const net = r2(fixed + variable - deductions);
    return {
      empId: emp.id, empNo: emp.empNo, name: emp.name, joinDate: emp.joinDate, designation: emp.designation, personId: emp.personId, payMethod: emp.payMethod, routing: emp.routing, account: emp.account, bankName: emp.bankName,
      basic: emp.basic, housing: emp.housing, transport: emp.transport, otherAllow: emp.otherAllow, fixedGross, from, to, daysInMonth: n, employed, unpaidDays: unpaid, unpaidManual: !!(prev && prev.unpaidManual),
      fixed, ...add, variable, ...ded, deductions, net, note: clean(prev && prev.note, 200), gcc: emp.gcc,
      sifFixed: r2(Math.max(0, fixed - deductions)), sifVariable: variable,
    };
  }
  function warningsFor(lines, ym) {
    const w = [];
    lines.forEach(l => {
      if (l.deductions > 0.2 * (l.fixed + l.variable) + 0.004) w.push(`${l.name}: deductions are more than 20% of the wage for the month (Labour Law Art. 25 limits deductions).`);
      if (l.net < 0) w.push(`${l.name}: deductions are more than the pay.`);
      if (l.payMethod !== "none") {
        if (!/^\d{1,14}$/.test(l.personId || "")) w.push(`${l.name}: no MOHRE person ID, needed for the WPS file.`);
        if (!/^\d{9}$/.test(l.routing || "")) w.push(`${l.name}: no 9-digit bank / agent routing code, needed for the WPS file.`);
        if (!l.account) w.push(`${l.name}: no IBAN or salary card number, needed for the WPS file.`);
      }
    });
    const contracted = lines.reduce((s, l) => s + l.fixedGross * l.employed / l.daysInMonth, 0), paid = lines.reduce((s, l) => s + Math.max(0, l.net), 0);
    if (contracted > 0 && paid < 0.85 * contracted) w.push(`This run pays ${Math.round(paid / contracted * 100)}% of contracted wages; MOHRE treats paying at least 85% on time as compliant.`);
    return w;
  }
  async function buildRun(co, ym, prevLines) {
    const [emps, leave] = await Promise.all([listEmployees(co), listLeave(co)]);
    const prev = new Map((prevLines || []).map(l => [l.empId, l]));
    const lines = emps.filter(e => e.joinDate <= `${ym}-${String(daysIn(ym)).padStart(2, "0")}` && !(e.status === "left" && e.endDate && e.endDate < ym + "-01"))
      .map(e => lineFor(e, ym, leave, prev.get(e.empId || e.id))).filter(Boolean);
    return { lines, warnings: warningsFor(lines, ym) };
  }
  async function createRun(user, b) {
    const co = coOf(user); const ym = clean(b.month, 7); if (!/^\d{4}-\d{2}$/.test(ym)) fail(400, "Choose the month.");
    const t = await table(T); if (await getOrNull(t, rPK(co), ym)) fail(409, `A payroll run for ${ym} already exists.`);
    const { lines, warnings } = await buildRun(co, ym, []);
    if (!lines.length) fail(400, "No employees were employed in that month. Add employees first.");
    const now = new Date().toISOString();
    await t.createEntity({ partitionKey: rPK(co), rowKey: ym, status: "draft", total: r2(lines.reduce((s, l) => s + l.net, 0)), count: lines.length, ...packJson({ lines, warnings }), createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now });
    if (user.aud) user.aud.name = "Payroll " + ym;
    return runOut(await t.getEntity(rPK(co), ym));
  }
  async function loadRun(co, ym) { const e = await getOrNull(await table(T), rPK(co), ym); if (!e) fail(404, "This payroll run doesn't exist."); return e; }
  // Edit the variable parts (additions, deductions, manual unpaid days) and re-read employees.
  async function updateRun(user, ym, b) {
    const co = coOf(user); const e = await loadRun(co, ym);
    if (e.status !== "draft") fail(400, "This payroll is approved. Reopen it to change it.");
    const edits = (Array.isArray(b.lines) ? b.lines : []).map(l => ({ empId: clean(l.empId, 60), overtime: l.overtime, bonus: l.bonus, commission: l.commission, otherAdd: l.otherAdd, advance: l.advance, otherDed: l.otherDed, note: l.note, unpaidManual: !!l.unpaidManual, unpaidDays: Math.max(0, num(l.unpaidDays)) }));
    edits.forEach(l => ["overtime", "bonus", "commission", "otherAdd", "advance", "otherDed"].forEach(k => { if (num(l[k]) < 0) fail(400, "Additions and deductions can't be negative."); }));
    const { lines, warnings } = await buildRun(co, ym, edits);
    const t = await table(T);
    try { await t.updateEntity({ partitionKey: rPK(co), rowKey: ym, total: r2(lines.reduce((s, l) => s + l.net, 0)), count: lines.length, ...packJson({ lines, warnings }), updatedBy: user.email, updatedAt: new Date().toISOString() }, "Merge", { etag: b.etag || e.etag }); }
    catch (err) { if (err.statusCode === 412) fail(409, "Someone else changed this payroll. Reload and try again."); throw err; }
    if (user.aud) user.aud.name = "Payroll " + ym;
    return runOut(await t.getEntity(rPK(co), ym));
  }
  async function setRunStatus(user, ym, b) {
    const co = coOf(user); const e = await loadRun(co, ym); const t = await table(T); const s = await settings(co);
    const act = String(b.action || ""); const now = new Date().toISOString(); const patch = { partitionKey: rPK(co), rowKey: ym, updatedBy: user.email, updatedAt: now };
    const run = runOut(e);
    if (user.aud) user.aud.name = "Payroll " + ym;
    if (act === "approve") { if (e.status !== "draft") fail(400, "Only a draft can be approved."); Object.assign(patch, { status: "approved", approvedBy: user.email, approvedAt: now }); }
    else if (act === "reopen") {
      if (e.status === "paid") fail(400, "A paid payroll can't be reopened. Pay any correction in the next month.");
      if (e.journalId) fail(400, "This payroll is posted to Books. Void the journal in Books first, then reopen.");
      Object.assign(patch, { status: "draft", approvedBy: "", approvedAt: "" });
    } else if (act === "sif") { if (e.status === "draft") fail(400, "Approve the payroll before creating the WPS file."); patch.sifAt = now; }
    else if (act === "post") {
      if (e.status === "draft") fail(400, "Approve the payroll before posting it to Books.");
      if (e.journalId) fail(400, "Already posted to Books.");
      const lines = run.lines;
      const lastDay = `${ym}-${String(daysIn(ym)).padStart(2, "0")}`;
      const earn = r2(lines.reduce((a, l) => a + l.fixed + l.variable, 0)), adv = r2(lines.reduce((a, l) => a + l.advance, 0)), oth = r2(lines.reduce((a, l) => a + l.otherDed, 0)), net = r2(lines.reduce((a, l) => a + l.net, 0));
      const jl = [{ account: s.expenseAccount, debit: earn, memo: `Salaries and allowances ${ym}` }, { account: s.payableAccount, credit: net, memo: `Net salaries payable ${ym}` }];
      if (adv) jl.push({ account: s.advanceAccount, credit: adv, memo: "Salary advances recovered" });
      if (oth) jl.push({ account: s.expenseAccount, credit: oth, memo: "Other salary deductions" });
      // End-of-service accrual: the month's share of each expatriate employee's gratuity entitlement.
      if (s.eosbAccrual) { const yrs = l => (Date.parse(lastDay) - Date.parse(l.joinDate || lastDay)) / (365 * 864e5);
        const accr = r2(lines.filter(l => !l.gcc).reduce((a, l) => a + l.basic / 30 * (yrs(l) > 5 ? 30 : 21) / 12 * (l.employed - l.unpaidDays) / l.daysInMonth, 0)); if (accr) jl.push({ account: "6020", debit: accr, memo: "End-of-service benefits accrual" }, { account: "2300", credit: accr, memo: "End-of-service benefits provision" }); }
      if (adv) await quietly(user, () => books().route("POST", ["accounts"], user, { code: s.advanceAccount, name: "Staff Advances", type: "current_asset" })).catch(() => {});
      const doc = await quietly(user, () => books().route("POST", ["docs"], user, { type: "journal", date: lastDay, ref: `Payroll ${ym}`, notes: `Payroll for ${ym}: ${lines.length} employees, net AED ${net.toFixed(2)}.`, lines: jl }));
      patch.journalId = doc.id;
    } else if (act === "paid") {
      if (e.status === "draft") fail(400, "Approve the payroll before marking it paid.");
      const payDate = clean(b.payDate, 10) || today(); if (!isDate(payDate)) fail(400, "The payment date is not valid.");
      Object.assign(patch, { status: "paid", payDate, paidBy: user.email });
      if (e.journalId && !e.payJournalId && b.postPayment !== false) {
        const doc = await quietly(user, () => books().route("POST", ["docs"], user, { type: "journal", date: payDate, ref: `Salary payment ${ym}`, notes: `Salaries for ${ym} paid through WPS.`, lines: [{ account: s.payableAccount, debit: run.total, memo: "Salaries paid" }, { account: s.payAccount, credit: run.total, memo: "WPS salary transfer" }] }));
        patch.payJournalId = doc.id;
      }
    } else fail(400, "Unknown action.");
    await t.updateEntity(patch, "Merge");
    if (user.aud) user.aud.changes = [act];
    return runOut(await t.getEntity(rPK(co), ym));
  }
  async function deleteRun(user, ym) {
    const co = coOf(user); const e = await loadRun(co, ym);
    if (e.status !== "draft") fail(400, "Only a draft payroll can be deleted.");
    if (user.aud) user.aud.name = "Payroll " + ym;
    await (await table(T)).deleteEntity(rPK(co), ym);
  }

  /* ---------------- bootstrap and alerts ---------------- */
  async function bootstrap(user) {
    const co = coOf(user); const t0 = today();
    const [s, emps, leave, runs, org] = await Promise.all([settings(co), listEmployees(co), listLeave(co), listRuns(co), books().orgProfile(co).catch(() => ({ legalName: CO[co].name }))]);
    const enriched = emps.map(e => ({ ...e, service: service(e, leave, t0), gratuity: gratuity(e, leave, t0), leave: leaveBalance(e, leave, t0) }));
    return { company: { key: co, name: CO[co].name }, org, settings: s, employees: enriched, leave, runs, leaveTypes: LEAVE_TYPES, payMethods: PAY_METHODS, docs: DOCS, today: t0, me: user.email, isManager: !!user.isManager,
      books: user.isManager || ["books", "bk_bank"].some(k => (user.sections || []).includes(k)) };
  }
  async function alerts(user) {
    if (user.co === "all") return [];
    const co = user.co, t0 = today(), soon = addDays(t0, 30), out = [];
    const [emps, runs] = await Promise.all([listEmployees(co), listRuns(co)]);
    emps.filter(e => e.status !== "left").forEach(e => Object.entries(DOCS).forEach(([k, l]) => { const d = e[k]; if (d && d <= soon)
      out.push({ tool: "hr", severity: d < t0 ? "high" : "medium", when: d, href: "/hr/#/documents", title: `${l} ${d < t0 ? "expired" : "expiring"}: ${e.name}`, text: d < t0 ? `Expired ${d}` : `Expires ${d}` }); }));
    // Last month's salaries are due by the 1st of this month.
    const lastYm = new Date(Date.UTC(+t0.slice(0, 4), +t0.slice(5, 7) - 2, 1)).toISOString().slice(0, 7);
    const run = runs.find(r => r.month === lastYm);
    if (emps.some(e => e.status !== "left") && (!run || run.status !== "paid")) out.push({ tool: "hr", severity: "high", when: due(lastYm), href: "/hr/#/payroll", title: `Payroll ${lastYm} not marked paid`, text: `Salaries were due through WPS by ${due(lastYm)}` });
    return out;
  }

  async function route(method, seg, user, body) {
    needHr(user);
    const [a, id, sub] = seg;
    if (a === "bootstrap" && method === "GET") return bootstrap(user);
    if (a === "settings" && method === "PUT") return saveSettings(user, body);
    if (a === "employees") { if (!id && method === "POST") return saveEmployee(user, null, body); if (id && method === "PUT") return saveEmployee(user, id, body); if (id && method === "DELETE") return deleteEmployee(user, id); }
    if (a === "leave") { if (!id && method === "POST") return saveLeave(user, null, body); if (id && method === "PUT") return saveLeave(user, id, body); if (id && method === "DELETE") return deleteLeave(user, id); }
    if (a === "runs") {
      if (!id && method === "POST") return createRun(user, body);
      if (id && !sub && method === "PUT") return updateRun(user, id, body);
      if (id && !sub && method === "DELETE") return deleteRun(user, id);
      if (id && sub === "status" && method === "POST") return setRunStatus(user, id, body);
    }
    fail(404, "Unknown request.");
  }
  return { route, alerts };
};
