// Targets & Commission: sales targets per salesperson, who gets credit for each invoice, gross profit, quarterly
// tiered commission paid as customers pay, and monthly commission statements that flow into payroll.
//
// The model (how IT solution providers usually run sales compensation, kept small enough to manage by hand):
//  * Plan: one per salesperson, per year, per company. Monthly sales and gross-profit (GP) targets, the commission basis
//    (GP or sales) and up to four rate bands by how much of the quarter's target is reached. Bands are marginal, like tax
//    bands: with 0% → 5%, 50% → 10%, 100% → 15%, the first half of the quarter's target earns 5%, the second half 10%,
//    anything above target 15%. Nobody loses what they already earned when the next invoice lands.
//  * Credit: every issued tax invoice belongs to someone. In order: a manager's assignment (which can split an invoice
//    between up to three people, or mark it a house account), the owner of the deal it came from (quotation → deal),
//    the customer's account manager. Anything left is "needs a salesperson".
//  * Sales = invoice value before VAT less credit notes against it. GP = sales less cost: the manager's figure, else item
//    purchase prices from Books. If some lines have no known cost, GP-basis commission waits until a manager enters it.
//  * Commission per invoice: the quarter's credited invoices, in date order, fill the quarter's bands in turn.
//  * Payable as the customer pays: commission × share of the invoice collected by the month end (advances and part
//    payments pay part). Credit notes lower the invoice; anything already paid out comes back off the next statement.
//  * Statement: per person per month = payable at the month end − everything approved before. A manager approves it into
//    a payroll month (the commission field of that payroll run) or for separate payment. Months are approved in order;
//    a month that comes out at zero or below (a clawback) is skipped and nets off the next one.
//
// Storage (Table Storage "sales"):
//   plan-<co>    RowKey "<year>|<email>"  name, basis, bands JSON, targets JSON {sales[12], gp[12]}
//   credit-<co>  RowKey <invoice id>      splits JSON [{email, pct}] ([] = house account), cost ("" = automatic; with costDocs: other
//                                          cost added on top), costDocs JSON [{id, lines: [{i, qty}]}] (supplier PO, bill or expense lines), note
//   acct-<co>    RowKey <customer id>     email (account manager), customer
//   stmt-<co>    RowKey "<email>|<ym>"    lines JSON, total, pay ("payroll" | "separate"), payrollMonth, status, approvedBy...

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const T = "sales";
const BASIS = { gp: "Gross profit", sales: "Sales" };
const DEFAULT_BANDS = { gp: [{ from: 0, rate: 5 }, { from: 50, rate: 10 }, { from: 100, rate: 15 }], sales: [{ from: 0, rate: 0.5 }, { from: 50, rate: 1 }, { from: 100, rate: 1.5 }] };
const MAX_SPLITS = 3;

const today = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);
const daysIn = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
const monthEnd = ym => `${ym}-${String(daysIn(ym)).padStart(2, "0")}`;
const addMonths = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const isYm = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const monthName = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const j = (s, d) => { try { const v = JSON.parse(s || ""); return v == null ? d : v; } catch { return d; } };
const zeros = () => Array(12).fill(0);

// ---------- commission bands (pure; exported for tests) ----------
// Commission earned by moving from `from` to `to` (AED of the basis) against a quarter target, with marginal bands.
function bandValue(x, target, bands) {
  // Integral of the rate from 0 to x. Below zero (a quarter that is negative so far) the first band's rate applies.
  const b = bands.slice().sort((p, q) => p.from - q.from);
  if (x <= 0) return x * b[0].rate / 100;
  let total = 0;
  for (let i = 0; i < b.length; i++) {
    const lo = b[i].from / 100 * target, hi = i + 1 < b.length ? b[i + 1].from / 100 * target : Infinity;
    if (x <= lo) break;
    total += (Math.min(x, hi) - lo) * b[i].rate / 100;
  }
  return total;
}
function onTargetRate(bands) { const b = bands.slice().sort((p, q) => p.from - q.from).filter(x => x.from < 100); return (b[b.length - 1] || bands[0]).rate; }
function bandCommission(from, amt, target, bands) {
  if (!(target > 0)) return amt * onTargetRate(bands) / 100; // no target set for the quarter: the on-target rate
  return bandValue(from + amt, target, bands) - bandValue(from, target, bands);
}
function rateAt(x, target, bands) {
  if (!(target > 0)) return onTargetRate(bands);
  const b = bands.slice().sort((p, q) => p.from - q.from); let r = b[0].rate;
  b.forEach(k => { if (x >= k.from / 100 * target) r = k.rate; }); return r;
}

module.exports = function makeSales(H) {
  const { table, getOrNull, all, fail, clean, num, CO, emailOk, coForEmail, books, hr, dealsFor } = H;
  const coOf = user => { if (user.co === "all") fail(400, "Choose Bifold or Tech Hub at the top to see targets and commission."); return user.co; };
  const needManager = user => { if (!user.isManager) fail(403, "Only managers can do this."); };
  const pk = (kind, co) => `${kind}-${co}`;
  const nameOf = (email, plans) => { const p = [...plans.values()].find(x => x.email === email && x.name); if (p) return p.name; const n = String(email).split("@")[0].split(/[._-]/).filter(Boolean); return n.map(w => w[0].toUpperCase() + w.slice(1)).join(" ") || email; };

  // ---------- storage readers ----------
  const planOut = e => ({ year: +String(e.rowKey).split("|")[0], email: String(e.rowKey).split("|")[1], name: e.name || "", basis: BASIS[e.basis] ? e.basis : "gp",
    bands: j(e.bands, DEFAULT_BANDS.gp), targets: (t => ({ sales: (t.sales || zeros()).map(num), gp: (t.gp || zeros()).map(num) }))(j(e.targets, {})), note: e.note || "", updatedBy: e.updatedBy || "", updatedAt: e.updatedAt || "" });
  const stmtOut = e => ({ email: String(e.rowKey).split("|")[0], ym: String(e.rowKey).split("|")[1], lines: j(e.lines, []), total: num(e.total), pay: e.pay || "payroll", payrollMonth: e.payrollMonth || "",
    status: e.status, approvedBy: e.approvedBy || "", approvedAt: e.approvedAt || "", paidAt: e.paidAt || "", paidBy: e.paidBy || "", paidNote: e.paidNote || "", note: e.note || "", payrollNote: e.payrollNote || "" });
  async function load(co) {
    const t = await table(T);
    const [plans, credits, accts, stmts] = await Promise.all(["plan", "credit", "acct", "stmt"].map(k => all(t, pk(k, co))));
    return {
      plans: new Map(plans.map(e => { const p = planOut(e); return [`${p.year}|${p.email}`, p]; })),
      credits: new Map(credits.map(e => [e.rowKey, { splits: j(e.splits, []), cost: e.cost === "" || e.cost == null ? null : num(e.cost), costDocs: j(e.costDocs, []), note: e.note || "", by: e.updatedBy || "", at: e.updatedAt || "" }])),
      accts: new Map(accts.map(e => [e.rowKey, { email: e.email, customer: e.customer || "" }])),
      stmts: stmts.map(stmtOut),
    };
  }

  // ---------- the model: every invoice credited, costed and commissioned ----------
  // Cost of the supplier lines picked for an invoice, from the documents as they are now.
  function docCost(costDocs, pmap) {
    let total = 0; const out = []; let missing = 0;
    (costDocs || []).forEach(cd => {
      const d = pmap.get(cd.id);
      if (!d) { missing++; return; }
      const lines = (cd.lines || []).map(x => { const l = d.lines.find(y => y.i === x.i); if (!l) return null; const qty = Math.min(num(x.qty), l.qty); return { i: l.i, name: l.name, qty, unit: l.unit, amt: r2(qty * l.unit) }; }).filter(Boolean);
      const t = r2(lines.reduce((a, l) => a + l.amt, 0)); total += t;
      out.push({ id: d.id, type: d.type, number: d.number, date: d.date, supplier: d.supplier, lines, total: t });
    });
    return { total: r2(total), docs: out, missing };
  }
  async function model(co) {
    const st0 = await load(co);
    const needDocs = [...st0.credits.values()].some(c => c.costDocs && c.costDocs.length);
    const [bk, deals, pdocs] = await Promise.all([books().salesData(co), dealsFor(co), needDocs ? books().purchaseDocs(co) : []]);
    const st = st0, pmap = new Map(pdocs.map(d => [d.id, d]));
    const dealMap = new Map(deals.map(d => [d.id, d]));
    const invs = bk.map(inv => {
      const c = st.credits.get(inv.id), d = inv.dealId ? dealMap.get(inv.dealId) : null, a = st.accts.get(inv.customerId);
      let src, splits;
      if (c) { src = c.splits.length ? "manual" : "house"; splits = c.splits; }
      else if (d && d.owner) { src = "deal"; splits = [{ email: d.owner, pct: 100 }]; }
      else if (a && a.email) { src = "account"; splits = [{ email: a.email, pct: 100 }]; }
      else { src = "none"; splits = []; }
      const fromDocs = c && c.costDocs && c.costDocs.length ? docCost(c.costDocs, pmap) : null;
      const manualCost = !!fromDocs || (c && c.cost != null);
      const cost = fromDocs ? r2(fromDocs.total + (c.cost || 0)) : manualCost ? c.cost : inv.itemCost;
      const costSrc = fromDocs ? "docs" : manualCost ? "manual" : inv.unknown.length ? "missing" : "items";
      const gp = r2(inv.sales - (inv.sales <= 0 && !manualCost ? 0 : cost));
      return { ...inv, src, splits, deal: d ? { id: d.id, title: d.title, owner: d.owner } : null, note: c ? c.note : "", cost: r2(cost), costSrc, gp, creditBy: c ? c.by : "", creditAt: c ? c.at : "",
        costDocs: fromDocs ? fromDocs.docs : [], costDocsMissing: fromDocs ? fromDocs.missing : 0, otherCost: c && c.cost != null ? c.cost : null };
    });
    // Collected share of an invoice at a date.
    const frac = (inv, asOf) => {
      if (inv.collectible <= 0.004) return 1;
      const got = inv.receipts.reduce((s, r) => s + (r.date <= asOf ? r.amt : 0), 0);
      return Math.max(0, Math.min(1, got / inv.collectible));
    };
    // Entries: one per invoice per person credited, with commission worked out quarter by quarter.
    const entries = [];
    invs.forEach(inv => inv.splits.forEach(s => entries.push({ inv, email: s.email, share: num(s.pct) / 100 })));
    const groups = new Map();
    entries.forEach(e => { const y = +e.inv.date.slice(0, 4), q = Math.floor((+e.inv.date.slice(5, 7) - 1) / 3); const k = `${e.email}|${y}|${q}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
    const quarters = new Map();
    groups.forEach((list, k) => {
      const [email, y, q] = k.split("|"); const plan = st.plans.get(`${y}|${email}`);
      list.sort((a, b) => a.inv.date.localeCompare(b.inv.date) || String(a.inv.number).localeCompare(String(b.inv.number), undefined, { numeric: true }));
      const target = plan ? [0, 1, 2].reduce((s, i) => s + plan.targets[plan.basis][+q * 3 + i], 0) : 0;
      let cum = 0;
      list.forEach(e => {
        e.sales = r2(e.inv.sales * e.share); e.gp = r2(e.inv.gp * e.share);
        if (!plan) { e.commission = 0; e.noPlan = true; e.basisAmt = 0; return; }
        e.basisAmt = plan.basis === "gp" ? e.gp : e.sales;
        e.commission = r2(bandCommission(cum, e.basisAmt, target, plan.bands));
        e.rate = rateAt(cum + Math.max(0, e.basisAmt), target, plan.bands);
        cum += e.basisAmt;
        e.held = plan.basis === "gp" && e.inv.costSrc === "missing";
      });
      quarters.set(k, { target, achieved: r2(cum), basis: plan ? plan.basis : null });
    });
    // Approved / paid amounts per person per invoice.
    const approved = new Map();
    st.stmts.forEach(s => s.lines.forEach(l => { const k = `${s.email}|${l.id}`; approved.set(k, r2((approved.get(k) || 0) + num(l.amt))); }));
    const payable = (e, asOf) => e.held || e.noPlan || e.inv.date > asOf ? 0 : r2(e.commission * frac(e.inv, asOf));
    entries.forEach(e => { e.paidOut = approved.get(`${e.email}|${e.inv.id}`) || 0; });
    return { co, invs, entries, quarters, st, deals, frac, payable };
  }

  // ---------- statements ----------
  function draftFor(m, email, ym) {
    const asOf = monthEnd(ym);
    const lines = [];
    m.entries.filter(e => e.email === email && e.inv.date <= asOf).forEach(e => {
      const due = r2(m.payable(e, asOf) - e.paidOut);
      if (Math.abs(due) >= 0.01) lines.push(lineOf(m, e, asOf, due));
    });
    // An invoice credited away from this person after commission was approved: take it back.
    const mine = new Set(m.entries.filter(e => e.email === email).map(e => e.inv.id));
    m.st.stmts.filter(s => s.email === email).forEach(s => s.lines.forEach(l => {
      if (mine.has(l.id) || lines.some(x => x.id === l.id)) return;
      const paid = r2(m.st.stmts.filter(x => x.email === email).reduce((a, x) => a + x.lines.filter(y => y.id === l.id).reduce((b, y) => b + num(y.amt), 0), 0));
      if (Math.abs(paid) >= 0.01) lines.push({ id: l.id, number: l.number, customer: l.customer, date: l.date, why: "No longer credited to this person", amt: r2(-paid) });
    }));
    lines.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { lines, total: r2(lines.reduce((a, l) => a + l.amt, 0)) };
  }
  function lineOf(m, e, asOf, due) {
    const f = m.frac(e.inv, asOf);
    return { id: e.inv.id, number: e.inv.number, customer: e.inv.customer, date: e.inv.date, share: Math.round(e.share * 100), sales: e.sales, gp: e.gp, basisAmt: e.basisAmt,
      commission: e.commission, rate: e.rate, collectedPct: Math.round(f * 1000) / 10, payable: m.payable(e, asOf), before: e.paidOut, amt: due,
      why: e.inv.credits.length && due < 0 ? "Credit note" : due < 0 ? "Adjustment" : f < 0.999 ? "Part payment" : e.paidOut ? "Balance" : "" };
  }
  async function payrollState(co, s) {
    if (s.status === "paid") return { state: "paid", label: s.pay === "separate" ? `Paid separately on ${s.paidAt}` : `Paid with ${monthName(s.payrollMonth)} payroll` };
    if (s.pay === "separate") return { state: "approved", label: "Approved, to be paid separately" };
    const run = await hr().runStatus(co, s.payrollMonth).catch(() => null);
    if (run && run.status === "paid") return { state: "paid", label: `Paid with ${monthName(s.payrollMonth)} payroll` + (run.payDate ? ` on ${run.payDate}` : "") };
    if (run) return { state: "approved", label: `In ${monthName(s.payrollMonth)} payroll (${run.status})` };
    return { state: "approved", label: `Goes into ${monthName(s.payrollMonth)} payroll when it is created` };
  }
  async function statements(user, ym) {
    const co = coOf(user);
    if (!isYm(ym)) fail(400, "Choose a month.");
    const m = await model(co);
    const people = peopleOf(m, user, +ym.slice(0, 4));
    const out = [];
    for (const email of people) {
      const s = m.st.stmts.find(x => x.email === email && x.ym === ym);
      const later = m.st.stmts.filter(x => x.email === email && x.ym > ym).sort((a, b) => a.ym.localeCompare(b.ym))[0];
      if (s) { const pst = await payrollState(co, s); out.push({ email, name: nameOf(email, m.st.plans), status: pst.state, statusLabel: pst.label, total: s.total, count: s.lines.length, payrollMonth: s.payrollMonth, pay: s.pay, approvedBy: s.approvedBy, approvedAt: s.approvedAt }); continue; }
      if (later) { out.push({ email, name: nameOf(email, m.st.plans), status: "closed", statusLabel: `Included in the ${monthName(later.ym)} statement`, total: 0, count: 0 }); continue; }
      const d = ym <= thisMonth() ? draftFor(m, email, ym) : { lines: [], total: 0 };
      out.push({ email, name: nameOf(email, m.st.plans), status: d.lines.length ? "draft" : "none", statusLabel: d.lines.length ? (d.total > 0 ? "Ready to approve" : "Clawback: carries to next month") : "Nothing this month", total: d.total, count: d.lines.length });
    }
    return { month: ym, people: out.filter(p => user.isManager || p.email === user.email), isCurrent: ym === thisMonth() };
  }
  async function statement(user, email, ym) {
    const co = coOf(user); email = String(email || "").toLowerCase();
    if (!user.isManager && email !== user.email) fail(403, "You can only see your own commission.");
    if (!isYm(ym)) fail(400, "Choose a month.");
    const m = await model(co);
    const s = m.st.stmts.find(x => x.email === email && x.ym === ym);
    const base = { email, name: nameOf(email, m.st.plans), month: ym, monthName: monthName(ym), company: CO[co].name };
    if (s) { const pst = await payrollState(co, s); return { ...base, ...s, status: pst.state, statusLabel: pst.label }; }
    const later = m.st.stmts.find(x => x.email === email && x.ym > ym);
    if (later) return { ...base, status: "closed", statusLabel: `Included in the ${monthName(later.ym)} statement`, lines: [], total: 0 };
    if (ym > thisMonth()) return { ...base, status: "none", statusLabel: "This month hasn't started", lines: [], total: 0 };
    const d = draftFor(m, email, ym);
    return { ...base, status: d.lines.length ? "draft" : "none", statusLabel: d.lines.length ? (d.total > 0 ? "Draft: not approved yet" : "Clawback: carries to next month") : "Nothing this month", ...d,
      waiting: waitingFor(m, email, monthEnd(ym)) };
  }
  // Commission earned on invoices but not yet payable because the customer hasn't paid (or the cost isn't known).
  function waitingFor(m, email, asOf) {
    let unpaid = 0, held = 0;
    m.entries.filter(e => e.email === email && e.inv.date <= asOf && !e.noPlan).forEach(e => { if (e.held) held += e.commission; else unpaid += e.commission - m.payable(e, asOf); });
    return { unpaid: r2(unpaid), held: r2(held) };
  }
  async function approve(user, email, ym, b) {
    needManager(user); const co = coOf(user); email = String(email || "").toLowerCase();
    if (!isYm(ym)) fail(400, "Choose a month.");
    if (ym > thisMonth()) fail(400, "This month hasn't started yet.");
    const t = await table(T);
    const m = await model(co);
    if (m.st.stmts.some(x => x.email === email && x.ym === ym)) fail(409, "This statement is already approved.");
    const later = m.st.stmts.find(x => x.email === email && x.ym > ym);
    if (later) fail(400, `The ${monthName(later.ym)} statement is already approved. Statements are approved in month order; anything from this month is in that one.`);
    const d = draftFor(m, email, ym);
    if (!d.lines.length) fail(400, "There is nothing to approve this month.");
    if (d.total <= 0) fail(400, `This month comes to AED ${d.total.toFixed(2)} (a clawback). There is nothing to pay; it nets off the next month's commission.`);
    if (b.expectTotal != null && Math.abs(num(b.expectTotal) - d.total) >= 0.01) fail(409, "The figures changed since you opened this statement (a payment, credit note or cost was recorded). Reload and check before approving.");
    const pay = b.pay === "separate" ? "separate" : "payroll";
    const payrollMonth = pay === "payroll" ? clean(b.payrollMonth, 7) || addMonths(ym, 1) : "";
    if (pay === "payroll" && (!isYm(payrollMonth) || payrollMonth < ym || payrollMonth > addMonths(ym, 3))) fail(400, "Choose the payroll month: this month or one of the next three.");
    const now = new Date().toISOString();
    let payrollNote = "";
    if (pay === "payroll") {
      const total = r2(d.total + m.st.stmts.filter(x => x.email === email && x.pay === "payroll" && x.payrollMonth === payrollMonth).reduce((a, x) => a + x.total, 0));
      const r = await hr().setCommission(co, payrollMonth, email, total);
      if (r.blocked) fail(400, `The ${monthName(payrollMonth)} payroll is already ${r.blocked}. Choose a later payroll month, pay separately, or reopen that payroll first.`);
      payrollNote = r.note || "";
    }
    const e = { partitionKey: pk("stmt", co), rowKey: `${email}|${ym}`, lines: JSON.stringify(d.lines.map(l => ({ id: l.id, number: l.number, customer: l.customer, date: l.date, amt: l.amt, why: l.why, share: l.share, sales: l.sales, gp: l.gp, basisAmt: l.basisAmt, commission: l.commission, rate: l.rate, collectedPct: l.collectedPct, payable: l.payable, before: l.before }))),
      total: d.total, pay, payrollMonth, status: "approved", approvedBy: user.email, approvedAt: now, note: clean(b.note, 300), payrollNote };
    await t.createEntity(e);
    if (user.aud) { user.aud.name = `${nameOf(email, m.st.plans)}, ${monthName(ym)}`; user.aud.changes = [`AED ${d.total.toFixed(2)}`, pay === "payroll" ? `${monthName(payrollMonth)} payroll` : "paid separately"]; }
    return statement(user, email, ym);
  }
  async function reopen(user, email, ym) {
    needManager(user); const co = coOf(user); email = String(email || "").toLowerCase();
    const t = await table(T); const e = await getOrNull(t, pk("stmt", co), `${email}|${ym}`);
    if (!e) fail(404, "This statement isn't approved.");
    const s = stmtOut(e); const st = await load(co);
    const later = st.stmts.find(x => x.email === email && x.ym > ym);
    if (later) fail(400, `The ${monthName(later.ym)} statement is approved too. Reopen that one first.`);
    const pst = await payrollState(co, s);
    if (pst.state === "paid") fail(400, "This commission is paid. Correct it on a later statement instead.");
    if (s.pay === "payroll") {
      const rest = r2(st.stmts.filter(x => x.email === email && x.pay === "payroll" && x.payrollMonth === s.payrollMonth && x.ym !== ym).reduce((a, x) => a + x.total, 0));
      const r = await hr().setCommission(co, s.payrollMonth, email, rest);
      if (r.blocked) fail(400, `The ${monthName(s.payrollMonth)} payroll is already ${r.blocked}. Reopen the payroll first.`);
    }
    await t.deleteEntity(pk("stmt", co), `${email}|${ym}`);
    if (user.aud) { user.aud.name = `${nameOf(email, st.plans)}, ${monthName(ym)}`; user.aud.changes = [`AED ${s.total.toFixed(2)}`]; }
    return statement(user, email, ym);
  }
  async function markPaid(user, email, ym, b) {
    needManager(user); const co = coOf(user); email = String(email || "").toLowerCase();
    const t = await table(T); const e = await getOrNull(t, pk("stmt", co), `${email}|${ym}`);
    if (!e) fail(404, "Approve the statement first.");
    if (e.pay !== "separate") fail(400, "This commission is paid through payroll. It shows as paid when that payroll is marked paid.");
    if (e.status === "paid") fail(400, "Already marked paid.");
    const date = clean(b.date, 10) || today(); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, "The payment date is not valid.");
    await t.updateEntity({ partitionKey: pk("stmt", co), rowKey: `${email}|${ym}`, status: "paid", paidAt: date, paidBy: user.email, paidNote: clean(b.note, 200) }, "Merge");
    if (user.aud) { user.aud.name = `${email}, ${monthName(ym)}`; user.aud.changes = [`paid ${date}`]; }
    return statement(user, email, ym);
  }

  // ---------- people ----------
  function peopleOf(m, user, year) {
    const set = new Set();
    m.st.plans.forEach(p => { if (p.year === year) set.add(p.email); });
    m.entries.forEach(e => { if (+e.inv.date.slice(0, 4) === year) set.add(e.email); });
    m.st.stmts.forEach(s => { if (+s.ym.slice(0, 4) === year) set.add(s.email); });
    if (!user.isManager) return [user.email];
    return [...set].sort((a, b) => nameOf(a, m.st.plans).localeCompare(nameOf(b, m.st.plans)));
  }

  // ---------- performance ----------
  async function performance(user, year) {
    const co = coOf(user);
    year = +year || +today().slice(0, 4);
    const m = await model(co);
    const t0 = today(), nowYm = thisMonth();
    const people = peopleOf(m, user, year).map(email => personView(m, email, year, t0));
    const team = { months: zeros().map((_, i) => ({ tSales: 0, tGp: 0, sales: 0, gp: 0, booked: 0, collected: 0, commission: 0 })) };
    people.forEach(p => p.months.forEach((x, i) => Object.keys(team.months[i]).forEach(k => { team.months[i][k] = r2(team.months[i][k] + x[k]); })));
    const unassigned = m.invs.filter(i => i.src === "none" && +i.date.slice(0, 4) === year);
    const costMissing = m.invs.filter(i => i.costSrc === "missing" && i.splits.length && +i.date.slice(0, 4) === year);
    return { year, today: t0, month: nowYm, company: CO[co].name, isManager: !!user.isManager, me: user.email, people, team,
      attention: user.isManager ? { unassigned: unassigned.length, unassignedSales: r2(unassigned.reduce((a, i) => a + i.sales, 0)), costMissing: costMissing.length } : null,
      years: [...new Set([year, +t0.slice(0, 4), ...m.invs.map(i => +i.date.slice(0, 4)), ...[...m.st.plans.values()].map(p => p.year)])].sort((a, b) => b - a) };
  }
  function personView(m, email, year, t0) {
    const plan = m.st.plans.get(`${year}|${email}`) || null;
    const months = zeros().map((_, i) => ({ tSales: plan ? plan.targets.sales[i] : 0, tGp: plan ? plan.targets.gp[i] : 0, sales: 0, gp: 0, booked: 0, collected: 0, commission: 0 }));
    const mine = m.entries.filter(e => e.email === email);
    const invoices = [];
    mine.forEach(e => {
      const y = +e.inv.date.slice(0, 4), mi = +e.inv.date.slice(5, 7) - 1;
      if (y === year) {
        months[mi].sales = r2(months[mi].sales + e.sales); months[mi].gp = r2(months[mi].gp + e.gp); months[mi].commission = r2(months[mi].commission + (e.commission || 0));
        invoices.push({ id: e.inv.id, number: e.inv.number, date: e.inv.date, dueDate: e.inv.dueDate, customer: e.inv.customer, title: e.inv.title, share: Math.round(e.share * 100), sales: e.sales, gp: e.gp,
          costSrc: e.inv.costSrc, src: e.inv.src, deal: e.inv.deal, commission: e.commission || 0, rate: e.rate, held: !!e.held, noPlan: !!e.noPlan,
          collectedPct: Math.round(m.frac(e.inv, t0) * 1000) / 10, payableNow: m.payable(e, t0), paidOut: e.paidOut, balance: r2(e.inv.balance * e.share), overdue: e.inv.overdue });
      }
      e.inv.receipts.forEach(r => { if (+r.date.slice(0, 4) === year) { const k = +r.date.slice(5, 7) - 1; months[k].collected = r2(months[k].collected + r.amt * e.share); } });
    });
    let open = 0, weighted = 0; const openDeals = [];
    m.deals.filter(d => d.owner === email).forEach(d => {
      const when = d.stage === "won" ? d.closedAt : d.stage === "po" ? (d.stageAt || d.closedAt) : "";
      if (when && +String(when).slice(0, 4) === year) { const k = new Date(Date.parse(when) + 4 * 3600e3).getUTCMonth(); months[k].booked = r2(months[k].booked + num(d.value)); }
      if (["lead", "survey", "proposal", "negotiation"].includes(d.stage)) { open += num(d.value); weighted += num(d.value) * num(d.probability) / 100; openDeals.push(d.id); }
    });
    // Quarters: attainment on the plan's basis, the band now and what it takes to reach the next one.
    const quarters = [0, 1, 2, 3].map(q => {
      const qk = m.quarters.get(`${email}|${year}|${q}`);
      const basis = plan ? plan.basis : "gp";
      const target = plan ? [0, 1, 2].reduce((s, i) => s + plan.targets[basis][q * 3 + i], 0) : 0;
      const achieved = qk ? qk.achieved : r2([0, 1, 2].reduce((s, i) => s + months[q * 3 + i][basis], 0));
      let next = null;
      if (plan && target > 0) {
        const b = plan.bands.slice().sort((x, y) => x.from - y.from).find(k => k.from / 100 * target > achieved);
        if (b) next = { from: b.from, rate: b.rate, need: r2(b.from / 100 * target - achieved) };
      }
      return { q: q + 1, basis, target: r2(target), achieved, pct: target > 0 ? Math.round(achieved / target * 1000) / 10 : null, rate: plan ? rateAt(achieved, target, plan.bands) : null, next,
        commission: r2([0, 1, 2].reduce((s, i) => s + months[q * 3 + i].commission, 0)) };
    });
    const sum = k => r2(months.reduce((a, x) => a + x[k], 0));
    const ytdTo = +t0.slice(0, 4) === year ? +t0.slice(5, 7) : year < +t0.slice(0, 4) ? 12 : 0;
    const ytd = k => r2(months.slice(0, ytdTo).reduce((a, x) => a + x[k], 0));
    const yearSales = sum("sales"), yearTargetSales = sum("tSales");
    const remaining = Math.max(0, yearTargetSales - yearSales);
    const approvedYear = m.st.stmts.filter(s => s.email === email && +s.ym.slice(0, 4) === year);
    const w = waitingFor(m, email, t0);
    const payableNow = r2(mine.reduce((a, e) => a + m.payable(e, t0), 0)), paidOutAll = r2(mine.reduce((a, e) => a + e.paidOut, 0));
    return {
      email, name: nameOf(email, m.st.plans),
      plan: plan ? { basis: plan.basis, bands: plan.bands, onTarget: r2(onTargetCommission(plan)), targetSales: r2(plan.targets.sales.reduce((a, x) => a + x, 0)), targetGp: r2(plan.targets.gp.reduce((a, x) => a + x, 0)) } : null,
      months, quarters,
      year: { tSales: yearTargetSales, tGp: sum("tGp"), sales: yearSales, gp: sum("gp"), booked: sum("booked"), collected: sum("collected"), commission: sum("commission"),
        ytdTargetSales: ytd("tSales"), ytdTargetGp: ytd("tGp") },
      pipeline: { open: r2(open), weighted: r2(weighted), deals: openDeals.length, coverage: remaining > 0 ? Math.round(weighted / remaining * 100) / 100 : null, remaining: r2(remaining) },
      receivables: { outstanding: r2(invoices.reduce((a, i) => a + i.balance, 0)), overdue: r2(invoices.filter(i => i.overdue).reduce((a, i) => a + i.balance, 0)) },
      commission: { earnedYear: sum("commission"), dueNow: r2(payableNow - paidOutAll), waitingPayment: w.unpaid, waitingCost: w.held,
        approvedYear: r2(approvedYear.reduce((a, s) => a + s.total, 0)) },
      invoices: invoices.sort((a, b) => b.date.localeCompare(a.date)),
    };
  }
  function onTargetCommission(plan) {
    let total = 0;
    for (let q = 0; q < 4; q++) { const t = [0, 1, 2].reduce((s, i) => s + plan.targets[plan.basis][q * 3 + i], 0); total += bandCommission(0, t, t, plan.bands); }
    return total;
  }

  // ---------- invoice credits (managers) ----------
  async function credits(user, year) {
    needManager(user); const co = coOf(user);
    year = +year || +today().slice(0, 4);
    const m = await model(co);
    const t0 = today();
    const rows = m.invs.filter(i => +i.date.slice(0, 4) === year).map(i => ({
      id: i.id, number: i.number, date: i.date, customer: i.customer, customerId: i.customerId, title: i.title, sales: i.sales, subtotal: i.subtotal, total: i.total, credits: i.credits,
      cost: i.cost, itemCost: i.itemCost, costSrc: i.costSrc, unknown: i.unknown, gp: i.gp, costDocs: i.costDocs, costDocsMissing: i.costDocsMissing, otherCost: i.otherCost, gpPct: i.sales ? Math.round(i.gp / i.sales * 1000) / 10 : null,
      src: i.src, splits: i.splits.map(s => ({ ...s, name: nameOf(s.email, m.st.plans) })), deal: i.deal, account: (m.st.accts.get(i.customerId) || {}).email || "", salesperson: i.salesperson,
      note: i.note, by: i.creditBy, at: i.creditAt, collectedPct: Math.round(m.frac(i, t0) * 1000) / 10, balance: i.balance, overdue: i.overdue,
      locked: m.entries.some(e => e.inv.id === i.id && e.paidOut),
    })).sort((a, b) => b.date.localeCompare(a.date) || String(b.number).localeCompare(String(a.number), undefined, { numeric: true }));
    return { year, invoices: rows };
  }
  async function saveCredit(user, invoiceId, b) {
    needManager(user); const co = coOf(user);
    const inv = (await books().salesData(co)).find(i => i.id === invoiceId);
    if (!inv) fail(404, "That invoice isn't issued, or doesn't exist.");
    const house = !!b.house;
    let splits = house ? [] : (Array.isArray(b.splits) ? b.splits : []).map(s => ({ email: clean(s.email, 150).toLowerCase(), pct: r2(num(s.pct)) })).filter(s => s.email);
    if (!house) {
      if (!splits.length) fail(400, "Choose who sold this, or mark it as a house account.");
      if (splits.length > MAX_SPLITS) fail(400, `An invoice can be shared by at most ${MAX_SPLITS} people.`);
      if (new Set(splits.map(s => s.email)).size !== splits.length) fail(400, "Each person can appear once.");
      splits.forEach(s => { if (!emailOk(s.email) || coForEmail(s.email) !== co) fail(400, `${s.email} isn't a ${CO[co].name} email address.`); if (!(s.pct > 0)) fail(400, "Each share must be more than 0%."); });
      if (Math.abs(splits.reduce((a, s) => a + s.pct, 0) - 100) > 0.01) fail(400, "The shares must add up to 100%.");
    }
    let cost = "";
    if (b.cost !== "" && b.cost != null) { cost = r2(num(b.cost)); if (cost < 0) fail(400, "The cost can't be negative."); if (cost > inv.subtotal * 20 + 1e6) fail(400, "That cost looks wrong. Check the figure."); }
    // Supplier lines picked as the cost: purchase orders, bills or expenses, each line with the quantity used for this sale.
    let costDocs = [];
    if (Array.isArray(b.costDocs) && b.costDocs.length) {
      if (b.costDocs.length > 30) fail(400, "Pick at most 30 supplier documents.");
      const pmap = new Map((await books().purchaseDocs(co)).map(d => [d.id, d]));
      costDocs = b.costDocs.map(cd => {
        const d = pmap.get(clean(cd.id, 60));
        if (!d) fail(400, "One of the supplier documents no longer exists or isn't posted. Pick the cost again.");
        const lines = (Array.isArray(cd.lines) ? cd.lines : []).map(x => {
          const l = d.lines.find(y => y.i === Math.round(num(x.i)));
          if (!l) fail(400, `A line on ${d.number} no longer exists. Pick the cost again.`);
          const qty = Math.round(num(x.qty) * 10000) / 10000;
          if (!(qty > 0) || qty > l.qty + 1e-9) fail(400, `On ${d.number}, "${l.name}": use between 0 and ${l.qty}.`);
          return { i: l.i, qty };
        });
        if (!lines.length) fail(400, `Pick at least one line on ${d.number}, or remove it.`);
        if (new Set(lines.map(l => l.i)).size !== lines.length) fail(400, `A line on ${d.number} is picked twice.`);
        return { id: d.id, lines };
      });
      if (new Set(costDocs.map(c => c.id)).size !== costDocs.length) fail(400, "A supplier document is picked twice.");
    }
    const t = await table(T), now = new Date().toISOString();
    await t.upsertEntity({ partitionKey: pk("credit", co), rowKey: invoiceId, splits: JSON.stringify(splits), cost, costDocs: JSON.stringify(costDocs), note: clean(b.note, 300), updatedBy: user.email, updatedAt: now }, "Replace");
    if (b.remember && splits.length === 1 && inv.customerId) await t.upsertEntity({ partitionKey: pk("acct", co), rowKey: inv.customerId, email: splits[0].email, customer: inv.customer, updatedBy: user.email, updatedAt: now }, "Replace");
    if (user.aud) { user.aud.name = `Invoice ${inv.number}`; user.aud.changes = [house ? "house account" : splits.map(s => `${s.email} ${s.pct}%`).join(", "), costDocs.length ? `cost from ${costDocs.length} supplier document${costDocs.length > 1 ? "s" : ""}${cost !== "" ? ` + AED ${cost} other` : ""}` : cost === "" ? "cost automatic" : `cost AED ${cost}`].concat(b.remember && splits.length === 1 ? [`account manager for ${inv.customer}`] : []); }
    return (await credits(user, +inv.date.slice(0, 4))).invoices.find(i => i.id === invoiceId);
  }
  async function resetCredit(user, invoiceId) {
    needManager(user); const co = coOf(user);
    try { await (await table(T)).deleteEntity(pk("credit", co), invoiceId); } catch (e) { if (e.statusCode !== 404) throw e; }
    const inv = (await books().salesData(co)).find(i => i.id === invoiceId);
    if (user.aud) user.aud.name = `Invoice ${inv ? inv.number : invoiceId}`;
    return inv ? (await credits(user, +inv.date.slice(0, 4))).invoices.find(i => i.id === invoiceId) : null;
  }

  // ---------- cost sources: supplier POs, bills and expenses that could be this invoice's cost ----------
  // Suggested when they share the invoice's deal, mention the customer, the invoice, quotation or customer PO number,
  // or buy the same items that were sold. Lines already used for other invoices show where, with what is left.
  async function costSources(user, invoiceId) {
    needManager(user); const co = coOf(user);
    const [inv0, pdocs, st] = await Promise.all([books().salesData(co).then(l => l), books().purchaseDocs(co), load(co)]);
    const inv = inv0.find(i => i.id === invoiceId);
    if (!inv) fail(404, "That invoice isn't issued, or doesn't exist.");
    const invNo = new Map(inv0.map(i => [i.id, i.number]));
    const used = new Map(); // docId|line → [{invoice, qty}]
    st.credits.forEach((c, id) => { if (id === invoiceId) return; (c.costDocs || []).forEach(cd => (cd.lines || []).forEach(l => { const k = `${cd.id}|${l.i}`; if (!used.has(k)) used.set(k, []); used.get(k).push({ invoice: invNo.get(id) || id, qty: num(l.qty) }); })); });
    const mine = st.credits.get(invoiceId);
    const picked = new Map(((mine && mine.costDocs) || []).map(cd => [cd.id, new Map(cd.lines.map(l => [l.i, num(l.qty)]))]));
    const soldQty = new Map(); inv.lines.forEach(l => { if (l.itemId) soldQty.set(l.itemId, (soldQty.get(l.itemId) || 0) + l.qty); });
    const lc = x => String(x || "").toLowerCase();
    const cust = lc(inv.customer).replace(/\b(llc|l\.l\.c|fze|fzco|fzc|co|company|est|establishment|trading|the)\b\.?/g, " ").replace(/\s+/g, " ").trim();
    const numbers = [inv.number, ...inv.srcNos, inv.poRef].filter(x => x && x.length >= 3).map(lc);
    const day = s2 => Date.parse(s2 + "T00:00:00Z") / 864e5;
    const lo = day(inv.date) - 365, hi = day(inv.date) + 120;
    const out = pdocs.filter(d => picked.has(d.id) || (day(d.date) >= lo && day(d.date) <= hi)).map(d => {
      // A bill made from a purchase order inherits what the order says (customer, deliver-to, deal).
      const po = d.fromId ? pdocs.find(x => x.id === d.fromId) : null;
      const text = lc([d.title, d.ref, d.deliverTo, d.note, d.supplier, ...d.lines.map(l => l.name), ...(po ? [po.title, po.deliverTo, po.note, po.ref] : [])].join(" "));
      const why = []; let score = 0;
      if (inv.dealId && (d.dealId === inv.dealId || (po && po.dealId === inv.dealId))) { score += 100; why.push("same deal"); }
      const nm = numbers.find(n => text.includes(n)); if (nm) { score += 60; why.push(`mentions ${nm.toUpperCase()}`); }
      if (cust.length >= 4 && text.includes(cust)) { score += 50; why.push("mentions the customer"); }
      const overlap = d.lines.filter(l => l.itemId && soldQty.has(l.itemId));
      if (overlap.length) { score += 30 + Math.min(20, overlap.length * 5); why.push(`${overlap.length} item${overlap.length > 1 ? "s" : ""} sold on this invoice`); }
      const gap = day(d.date) - day(inv.date); if (score && gap >= -90 && gap <= 30) score += 10;
      if (d.type === "po" && d.billedAs.length) score -= 25; // the bill is the better source
      if (po && score > 0) { score += 5; why.push(`billed from ${po.number}`); }
      const lines = d.lines.map(l => {
        const u = used.get(`${d.id}|${l.i}`) || [], usedQty = r2(u.reduce((a, x) => a + x.qty, 0)), left = Math.max(0, r2(l.qty - usedQty));
        const pickedQty = picked.has(d.id) ? picked.get(d.id).get(l.i) || 0 : 0;
        // Pre-select for a suggestion: lines for items sold here (up to the quantity sold), or every line still free when the match is on deal / numbers / customer.
        let suggestQty = 0;
        if (l.itemId && soldQty.has(l.itemId)) suggestQty = Math.min(left, soldQty.get(l.itemId));
        else if (!overlap.length && score >= 50) suggestQty = left;
        return { ...l, used: u, left, picked: pickedQty, suggestQty: r2(suggestQty) };
      });
      return { id: d.id, type: d.type, number: d.number, date: d.date, supplier: d.supplier, ref: d.ref, title: d.title, deliverTo: d.deliverTo, cost: d.cost, billedAs: d.billedAs,
        fromPo: d.fromId ? (pdocs.find(x => x.id === d.fromId) || {}).number || "" : "", score, why, picked: picked.has(d.id), lines };
    }).sort((a, b) => (b.picked - a.picked) || b.score - a.score || b.date.localeCompare(a.date)).slice(0, 400);
    return { invoice: { id: inv.id, number: inv.number, date: inv.date, customer: inv.customer, sales: inv.sales, lines: inv.lines }, docs: out, otherCost: mine && mine.cost != null ? mine.cost : null };
  }

  // ---------- account managers (customer → salesperson) ----------
  async function accounts(user) {
    needManager(user); const co = coOf(user);
    const st = await load(co);
    return [...st.accts.entries()].map(([id, a]) => ({ customerId: id, customer: a.customer, email: a.email, name: nameOf(a.email, st.plans) })).sort((a, b) => a.customer.localeCompare(b.customer));
  }
  async function saveAccount(user, customerId, b) {
    needManager(user); const co = coOf(user);
    const email = clean(b.email, 150).toLowerCase();
    if (!emailOk(email) || coForEmail(email) !== co) fail(400, `Choose someone with a ${CO[co].name} email address.`);
    const customer = clean(b.customer, 150);
    await (await table(T)).upsertEntity({ partitionKey: pk("acct", co), rowKey: clean(customerId, 60), email, customer, updatedBy: user.email, updatedAt: new Date().toISOString() }, "Replace");
    if (user.aud) { user.aud.name = customer || customerId; user.aud.changes = [`account manager ${email}`]; }
    return accounts(user);
  }
  async function removeAccount(user, customerId) {
    needManager(user); const co = coOf(user);
    try { await (await table(T)).deleteEntity(pk("acct", co), customerId); } catch (e) { if (e.statusCode !== 404) throw e; }
    return accounts(user);
  }

  // ---------- plans and targets ----------
  async function plans(user, year) {
    const co = coOf(user); year = +year || +today().slice(0, 4);
    const st = await load(co);
    const list = [...st.plans.values()].filter(p => p.year === year && (user.isManager || p.email === user.email))
      .map(p => ({ ...p, onTarget: r2(onTargetCommission(p)), targetSales: r2(p.targets.sales.reduce((a, x) => a + x, 0)), targetGp: r2(p.targets.gp.reduce((a, x) => a + x, 0)) }))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    const prev = [...st.plans.values()].filter(p => p.year === year - 1).length;
    return { year, plans: list, previousYearPlans: prev, defaults: DEFAULT_BANDS };
  }
  function bandsIn(raw) {
    const b = (Array.isArray(raw) ? raw : []).map(x => ({ from: r2(num(x.from)), rate: r2(num(x.rate)) })).sort((x, y) => x.from - y.from);
    if (!b.length || b.length > 4) fail(400, "Set between one and four commission bands.");
    if (b[0].from !== 0) fail(400, "The first band must start at 0% of target.");
    b.forEach((x, i) => { if (x.rate < 0 || x.rate > 50) fail(400, "Commission rates must be between 0% and 50%."); if (i && x.from <= b[i - 1].from) fail(400, "Each band must start above the one before."); if (x.from > 500) fail(400, "A band can start at most at 500% of target."); });
    return b;
  }
  async function savePlan(user, year, email, b) {
    needManager(user); const co = coOf(user);
    year = +year; email = clean(email, 150).toLowerCase();
    if (!(year >= 2020 && year <= 2100)) fail(400, "Choose a valid year.");
    if (!emailOk(email) || coForEmail(email) !== co) fail(400, `Enter the work email of someone in ${CO[co].name}.`);
    const basis = BASIS[b.basis] ? b.basis : "gp";
    const tg = b.targets || {};
    const targets = { sales: zeros().map((_, i) => Math.max(0, r2(num((tg.sales || [])[i])))), gp: zeros().map((_, i) => Math.max(0, r2(num((tg.gp || [])[i])))) };
    if (!targets[basis].some(x => x > 0)) fail(400, `Set a ${BASIS[basis].toLowerCase()} target: commission bands are measured against it.`);
    const bands = bandsIn(b.bands);
    const t = await table(T), now = new Date().toISOString();
    const cur = await getOrNull(t, pk("plan", co), `${year}|${email}`);
    const e = { partitionKey: pk("plan", co), rowKey: `${year}|${email}`, name: clean(b.name, 100), basis, bands: JSON.stringify(bands), targets: JSON.stringify(targets), note: clean(b.note, 500), updatedBy: user.email, updatedAt: now };
    await t.upsertEntity(e, "Replace");
    if (user.aud) {
      user.aud.name = `${e.name || email}, ${year}`;
      const was = cur ? planOut(cur) : null;
      user.aud.changes = was ? [
        was.basis !== basis ? `basis ${BASIS[was.basis]} → ${BASIS[basis]}` : "",
        JSON.stringify(was.bands) !== JSON.stringify(bands) ? `bands ${bands.map(x => `${x.from}%: ${x.rate}%`).join(", ")}` : "",
        JSON.stringify(was.targets) !== JSON.stringify(targets) ? `targets sales AED ${r2(targets.sales.reduce((a, x) => a + x, 0))}, GP AED ${r2(targets.gp.reduce((a, x) => a + x, 0))}` : "",
      ].filter(Boolean) : [`new plan: ${BASIS[basis]}, sales AED ${r2(targets.sales.reduce((a, x) => a + x, 0))}, GP AED ${r2(targets.gp.reduce((a, x) => a + x, 0))}`];
    }
    return (await plans(user, year)).plans.find(p => p.email === email);
  }
  async function deletePlan(user, year, email) {
    needManager(user); const co = coOf(user);
    const st = await load(co);
    if (st.stmts.some(s => s.email === email && +s.ym.slice(0, 4) === +year)) fail(400, "Commission for this year has been approved on this plan, so it can't be deleted. Change it instead; corrections flow into the next statement.");
    try { await (await table(T)).deleteEntity(pk("plan", co), `${year}|${email}`); } catch (e) { if (e.statusCode !== 404) throw e; }
    if (user.aud) user.aud.name = `${email}, ${year}`;
  }
  async function copyPlans(user, year, b) {
    needManager(user); const co = coOf(user); year = +year;
    const growth = Math.max(-90, Math.min(500, num(b.growth))) / 100;
    const st = await load(co);
    const from = [...st.plans.values()].filter(p => p.year === year - 1);
    if (!from.length) fail(400, `There are no ${year - 1} plans to copy.`);
    const t = await table(T), now = new Date().toISOString(); let n = 0;
    for (const p of from) {
      if (st.plans.has(`${year}|${p.email}`)) continue;
      const targets = { sales: p.targets.sales.map(x => r2(x * (1 + growth))), gp: p.targets.gp.map(x => r2(x * (1 + growth))) };
      await t.createEntity({ partitionKey: pk("plan", co), rowKey: `${year}|${p.email}`, name: p.name, basis: p.basis, bands: JSON.stringify(p.bands), targets: JSON.stringify(targets), note: p.note, updatedBy: user.email, updatedAt: now });
      n++;
    }
    if (user.aud) { user.aud.name = `${year} plans`; user.aud.changes = [`${n} copied from ${year - 1}`, growth ? `targets ${growth > 0 ? "+" : ""}${Math.round(growth * 100)}%` : ""].filter(Boolean); }
    return plans(user, year);
  }

  async function bootstrap(user) {
    const co = coOf(user);
    return { company: { key: co, name: CO[co].name }, me: user.email, isManager: !!user.isManager, today: today(), month: thisMonth(), basis: BASIS, defaults: DEFAULT_BANDS };
  }
  // Approved commission for one payroll month, by email (used when a payroll run is created).
  async function forPayroll(co, ym) {
    const st = await load(co); const out = {};
    st.stmts.filter(s => s.pay === "payroll" && s.payrollMonth === ym).forEach(s => { out[s.email] = r2((out[s.email] || 0) + s.total); });
    return out;
  }
  // Home alerts for managers: invoices waiting for a salesperson and statements ready to approve.
  async function alerts(user) {
    if (!user.isManager || user.co === "all") return [];
    const year = +today().slice(0, 4);
    try {
      const m = await model(user.co);
      const out = [];
      const un = m.invs.filter(i => i.src === "none" && +i.date.slice(0, 4) >= year - 1);
      if (un.length) out.push({ level: "warn", text: `${un.length} invoice${un.length > 1 ? "s" : ""} not credited to a salesperson`, href: "/sales/#/credits" });
      const last = addMonths(thisMonth(), -1);
      const ready = peopleOf(m, user, +last.slice(0, 4)).filter(email => !m.st.stmts.some(s => s.email === email && s.ym >= last) && draftFor(m, email, last).total > 0);
      if (ready.length) out.push({ level: "info", text: `${ready.length} commission statement${ready.length > 1 ? "s" : ""} for ${monthName(last)} ready to approve`, href: `/sales/#/statements/${last}` });
      return out;
    } catch { return []; }
  }

  async function route(method, seg, user, body) {
    const [a, b, c, d] = seg;
    const q = user.query || new URLSearchParams();
    if (a === "bootstrap" && method === "GET") return bootstrap(user);
    if (a === "performance" && method === "GET") return performance(user, q.get("year"));
    if (a === "statements") {
      if (b && !c && method === "GET") return statements(user, b);
      if (b && c && !d && method === "GET") return statement(user, c, b);
      if (b && c && d === "approve" && method === "POST") return approve(user, c, b, body);
      if (b && c && d === "reopen" && method === "POST") return reopen(user, c, b);
      if (b && c && d === "paid" && method === "POST") return markPaid(user, c, b, body);
    }
    if (a === "credits") {
      if (!b && method === "GET") return credits(user, q.get("year"));
      if (b && method === "PUT") return saveCredit(user, b, body);
      if (b && method === "DELETE") return resetCredit(user, b);
    }
    if (a === "costsources" && b && method === "GET") return costSources(user, b);
    if (a === "accounts") {
      if (!b && method === "GET") return accounts(user);
      if (b && method === "PUT") return saveAccount(user, b, body);
      if (b && method === "DELETE") return removeAccount(user, b);
    }
    if (a === "plans") {
      if (b && !c && method === "GET") return plans(user, b);
      if (b && c === "copy" && method === "POST") return copyPlans(user, b, body);
      if (b && c && method === "PUT") return savePlan(user, b, c, body);
      if (b && c && method === "DELETE") return deletePlan(user, b, c);
    }
    fail(404, "Unknown request.");
  }
  return { route, alerts, forPayroll };
};
module.exports.bandCommission = bandCommission;
module.exports.rateAt = rateAt;
