// Books reports, all worked out in the browser from the posted journal lines and VAT tags the API returns.
(function () {
"use strict";
const B = () => window.BK;
const GN = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses" };
const R2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

function periodBar(p, opts = {}) {
  const BK = B(), t = BK.D.today;
  const y = t.slice(0, 4), m = t.slice(5, 7);
  const lastMonthEnd = BK.addDays(t.slice(0, 8) + "01", -1);
  const fy = BK.fyStart(t), lfy = BK.fyStart(BK.addDays(fy, -1));
  const [qs, qe] = BK.vatPeriod(t), [lqs, lqe] = BK.vatPeriod(t, 1);
  const P = opts.asOf ? [["today", "Today", "", t], ["lme", "End of last month", "", lastMonthEnd], ["lfye", "End of last financial year", "", BK.addDays(fy, -1)]]
    : [["tm", "This month", `${y}-${m}-01`, t], ["lm", "Last month", lastMonthEnd.slice(0, 8) + "01", lastMonthEnd], ["tq", opts.vat ? "This VAT period" : "This quarter", qs, qe], ["lq", opts.vat ? "Last VAT period" : "Last quarter", lqs, lqe], ["fy", "This financial year", fy, t], ["lfy", "Last financial year", lfy, BK.addDays(fy, -1)]];
  const from = p.from || (opts.asOf ? "" : opts.vat ? lqs : fy), to = p.to || (opts.vat ? lqe : t);
  const html = `<div class="periodbar"><select id="pp"><option value="">Choose a period</option>${P.map(x => `<option value="${x[0]}">${x[1]}</option>`).join("")}</select>${opts.asOf ? "" : `<input type="date" id="pf" value="${from}">`}<input type="date" id="pt" value="${to}">${opts.extra || ""}</div>`;
  const wire = key => {
    const base = key === "vat" ? "#/vat" : "#/report/" + key;
    const nav = (f, tt) => { const q = new URLSearchParams(p); if (f) q.set("from", f); else q.delete("from"); q.set("to", tt); B().go(`${base}?${q}`); };
    document.getElementById("pp").onchange = e => { const x = P.find(z => z[0] === e.target.value); if (x) nav(x[2], x[3]); };
    if (!opts.asOf) document.getElementById("pf").onchange = () => nav(document.getElementById("pf").value, document.getElementById("pt").value);
    document.getElementById("pt").onchange = () => nav(opts.asOf ? "" : document.getElementById("pf").value, document.getElementById("pt").value);
  };
  return { from, to, html, wire };
}
function money(n) { return B().aed(n); }
const sumBy = (rows, f) => R2(rows.reduce((a, r) => a + f(r), 0));

// Account balances over a range, signed so that positive is the account's normal side.
function balances(from, to) {
  const BK = B(), m = new Map();
  BK.ledger().forEach(l => { if ((from && l.date < from) || (to && l.date > to)) return; m.set(l.acct, R2((m.get(l.acct) || 0) + l.dr - l.cr)); });
  return m;
}

function build(key, p) {
  const BK = B(), D = BK.D, ACC = BK.ACC(), esc = BK.esc, fd = BK.fd, t = D.today;
  const an = c => { const a = ACC.get(c); return a ? `${a.code} ${a.name}` : c; };
  const link = c => `#/account/${c}`;
  if (key === "pl") {
    const pb = periodBar(p); const bal = balances(pb.from, pb.to);
    const rows = []; const sec = (title, types, sign) => { const accts = D.accounts.filter(a => types.includes(a.type) && Math.abs(bal.get(a.code) || 0) > 0.004); rows.push({ kind: "grp", cells: [title, ""] }); let s = 0; accts.forEach(a => { const v = sign * (bal.get(a.code) || 0); s += v; rows.push({ kind: "ind", cells: [an(a.code), money(v)], href: link(a.code) + `?from=${pb.from}&to=${pb.to}` }); }); rows.push({ kind: "sub", cells: [`Total ${title.toLowerCase()}`, money(s)] }); return R2(s); };
    const inc = sec("Operating income", ["income"], -1), cogs = sec("Cost of sales", ["cogs"], 1);
    rows.push({ kind: "tot", cells: ["Gross profit", money(inc - cogs)] });
    const exp = sec("Operating expenses", ["expense"], 1);
    rows.push({ kind: "tot", cells: ["Operating profit", money(inc - cogs - exp)] });
    const oi = sec("Other income", ["other_income"], -1), oe = sec("Other expenses", ["other_expense"], 1);
    rows.push({ kind: "tot", cells: ["Net profit", money(inc - cogs - exp + oi - oe)] });
    const gm = inc ? Math.round((inc - cogs) / inc * 1000) / 10 : 0, nm = inc ? Math.round((inc - cogs - exp + oi - oe) / inc * 1000) / 10 : 0;
    return { title: "Profit and loss", period: `${fd(pb.from)} to ${fd(pb.to)}`, pb, head: [{ t: "Account" }, { t: "AED", n: 1 }], rows, note: `Gross margin ${gm}% · net margin ${nm}%. Amounts exclude VAT.` };
  }
  if (key === "bs") {
    const pb = periodBar(p, { asOf: true }); const to = pb.to; const fy = BK.fyStart(to);
    const bal = balances("", to);
    let cyEarn = 0, prior = 0; BK.ledger().forEach(l => { if (l.date > to) return; const g = (ACC.get(l.acct) || {}).group; if (g !== "income" && g !== "expense") return; const v = l.cr - l.dr; if (l.date >= fy) cyEarn += v; else prior += v; });
    const rows = []; const sums = {};
    for (const g of ["asset", "liability", "equity"]) {
      rows.push({ kind: "grp", cells: [GN[g], ""] }); let s = 0;
      const sub = {}; D.accounts.filter(a => a.group === g).forEach(a => { const v = (g === "asset" ? 1 : -1) * (bal.get(a.code) || 0); if (Math.abs(v) < 0.005) return; const tp = D.acctTypes[a.type][1]; (sub[tp] ||= []).push([a, v]); });
      Object.entries(sub).forEach(([tp, l]) => { rows.push({ kind: "sub", cells: [tp, ""] }); l.forEach(([a, v]) => { s += v; rows.push({ kind: "ind", cells: [an(a.code), money(v)], href: link(a.code) + `?to=${to}` }); }); });
      if (g === "equity") { if (Math.abs(prior) > 0.004) { rows.push({ kind: "ind", cells: ["Retained earnings from earlier years", money(prior)] }); s += prior; } rows.push({ kind: "ind", cells: ["Current year earnings", money(cyEarn)], href: `#/report/pl?from=${fy}&to=${to}` }); s += cyEarn; }
      sums[g] = R2(s); rows.push({ kind: "tot", cells: [`Total ${GN[g].toLowerCase()}`, money(s)] });
    }
    rows.push({ kind: "tot", cells: ["Total liabilities and equity", money(sums.liability + sums.equity)] });
    const diff = R2(sums.asset - sums.liability - sums.equity);
    return { title: "Balance sheet", period: `As at ${fd(to)}`, pb, head: [{ t: "Account" }, { t: "AED", n: 1 }], rows, note: Math.abs(diff) > 0.004 ? `Out of balance by AED ${money(diff)}. Check opening balances.` : "Assets equal liabilities plus equity." };
  }
  if (key === "tb") {
    const pb = periodBar(p, { asOf: true }); const bal = balances("", pb.to);
    const rows = []; let dr = 0, cr = 0;
    D.accounts.forEach(a => { const v = bal.get(a.code) || 0; if (Math.abs(v) < 0.005) return; if (v > 0) dr += v; else cr -= v; rows.push({ cells: [a.code, a.name, D.acctTypes[a.type][1], v > 0 ? money(v) : "", v < 0 ? money(-v) : ""], href: link(a.code) + `?to=${pb.to}` }); });
    rows.push({ kind: "tot", cells: ["", "Total", "", money(dr), money(cr)] });
    return { title: "Trial balance", period: `As at ${fd(pb.to)}`, pb, head: [{ t: "Code" }, { t: "Account" }, { t: "Type" }, { t: "Debit", n: 1 }, { t: "Credit", n: 1 }], rows, note: Math.abs(dr - cr) < 0.005 ? "Debits equal credits." : `Difference AED ${money(dr - cr)}.` };
  }
  if (key === "gl" || key === "daybook") {
    const pb = periodBar(p); const L = BK.ledger();
    const rows = [];
    if (key === "gl") {
      D.accounts.forEach(a => {
        const open = R2(L.filter(l => l.acct === a.code && l.date < pb.from).reduce((s, l) => s + l.dr - l.cr, 0));
        const tx = L.filter(l => l.acct === a.code && l.date >= pb.from && l.date <= pb.to); if (!tx.length && Math.abs(open) < 0.005) return;
        rows.push({ kind: "grp", cells: [an(a.code), "", "", "", "", ""], href: link(a.code) + `?from=${pb.from}&to=${pb.to}` });
        rows.push({ kind: "ind", cells: ["Opening balance", "", "", "", "", money(open)] }); let run = open;
        tx.forEach(l => { run = R2(run + l.dr - l.cr); rows.push({ kind: "ind", cells: [fd(l.date), `${l.number}`, BK.contactName(l.contact) || l.party || "", l.dr ? money(l.dr) : "", l.cr ? money(l.cr) : "", money(run)], href: "#/doc/" + l.id }); });
        rows.push({ kind: "sub", cells: ["Closing balance", "", "", money(sumBy(tx, l => l.dr)), money(sumBy(tx, l => l.cr)), money(run)] });
      });
      return { title: "General ledger", period: `${fd(pb.from)} to ${fd(pb.to)}`, pb, head: [{ t: "Date / account" }, { t: "Document" }, { t: "Contact" }, { t: "Debit", n: 1 }, { t: "Credit", n: 1 }, { t: "Balance", n: 1 }], rows, landscape: true };
    }
    const docs = D.docs.filter(d => d.status === "posted" && d.date >= pb.from && d.date <= pb.to).sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
    let dr = 0, cr = 0;
    docs.forEach(d => { rows.push({ kind: "grp", cells: [`${fd(d.date)}  ${d.number}`, d.contactName || "", "", ""], href: "#/doc/" + d.id }); d.gl.forEach(g => { dr += g[1]; cr += g[2]; rows.push({ kind: "ind", cells: [an(g[0]), g[3] ? BK.contactName(g[3]) : "", g[1] ? money(g[1]) : "", g[2] ? money(g[2]) : ""] }); }); });
    rows.push({ kind: "tot", cells: ["Total", "", money(dr), money(cr)] });
    return { title: "Journal report", period: `${fd(pb.from)} to ${fd(pb.to)}`, pb, head: [{ t: "Account" }, { t: "Contact" }, { t: "Debit", n: 1 }, { t: "Credit", n: 1 }], rows };
  }
  if (key === "cf") {
    const pb = periodBar(p); const L = BK.ledger();
    const accts = D.accounts.filter(a => a.type === "bank" || a.type === "cash" || (a.type === "current_asset" && /pdc/i.test(a.name)));
    const rows = []; const tot = [0, 0, 0, 0];
    accts.forEach(a => { const open = R2(L.filter(l => l.acct === a.code && l.date < pb.from).reduce((s, l) => s + l.dr - l.cr, 0)); const tx = L.filter(l => l.acct === a.code && l.date >= pb.from && l.date <= pb.to); const i = sumBy(tx, l => l.dr), o = sumBy(tx, l => l.cr);
      [open, i, o, open + i - o].forEach((v, k) => tot[k] += v); rows.push({ cells: [an(a.code), money(open), money(i), money(o), money(open + i - o)], href: link(a.code) + `?from=${pb.from}&to=${pb.to}` }); });
    rows.push({ kind: "tot", cells: ["Total", ...tot.map(money)] });
    // Where the money came from and went, by the other side of each entry.
    const by = new Map(); const codes = new Set(accts.map(a => a.code));
    D.docs.forEach(d => { if (d.status !== "posted" || d.date < pb.from || d.date > pb.to) return; const cash = d.gl.filter(g => codes.has(g[0])).reduce((s, g) => s + g[1] - g[2], 0); if (Math.abs(cash) < 0.005 || d.type === "transfer") return; const k = { receipt: "Customer receipts", payment: "Supplier payments", expense: "Expenses paid", journal: "Journals" }[d.type] || "Other"; by.set(k, R2((by.get(k) || 0) + cash)); });
    rows.push({ kind: "grp", cells: ["Movements by source", "", "", "", ""] }); by.forEach((v, k) => rows.push({ kind: "ind", cells: [k, "", v > 0 ? money(v) : "", v < 0 ? money(-v) : "", ""] }));
    return { title: "Cash summary", period: `${fd(pb.from)} to ${fd(pb.to)}`, pb, head: [{ t: "Account" }, { t: "Opening", n: 1 }, { t: "Money in", n: 1 }, { t: "Money out", n: 1 }, { t: "Closing", n: 1 }], rows };
  }
  if (key === "ar" || key === "ap") {
    const pb = periodBar(p, { asOf: true }); const to = pb.to; const sales = key === "ar";
    const tgt = sales ? "invoice" : "bill", cr = sales ? ["receipt", "creditnote"] : ["payment", "vendorcredit"];
    // Balance on the chosen date: total minus what was applied by payments / credits dated on or before it.
    const docs = D.docs.filter(d => d.status === "posted" && d.date <= to);
    const paidBy = new Map(), usedBy = new Map();
    docs.forEach(d => { if (!cr.includes(d.type)) return; d.allocs.forEach(a => { paidBy.set(a.id, (paidBy.get(a.id) || 0) + a.amt); usedBy.set(d.id, (usedBy.get(d.id) || 0) + a.amt); }); });
    const per = new Map(); const get = id => { if (!per.has(id)) per.set(id, [0, 0, 0, 0, 0, 0]); return per.get(id); };
    docs.forEach(d => {
      if (d.type === tgt) { const open = R2(d.total - (paidBy.get(d.id) || 0)); if (open < 0.005) return; const late = BK.addDays(d.dueDate, 0) < to ? Math.round((Date.parse(to) - Date.parse(d.dueDate)) / 864e5) : 0; const b = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4; get(d.contactId)[b] += open; }
      if (cr.includes(d.type)) { const left = R2((d.type === "receipt" || d.type === "payment" ? d.amount : d.total) - (usedBy.get(d.id) || 0)); if (left > 0.004) get(d.contactId)[5] -= left; }
    });
    const rows = []; const tot = [0, 0, 0, 0, 0, 0, 0];
    [...per.entries()].map(([id, v]) => [BK.contactName(id) || "(unknown)", id, v]).sort((a, b) => a[0].localeCompare(b[0])).forEach(([n, id, v]) => { const total = v.reduce((a, b) => a + b, 0); if (Math.abs(total) < 0.005 && !v.some(x => Math.abs(x) > 0.005)) return; v.concat(total).forEach((x, i) => tot[i] += x); rows.push({ cells: [n, ...v.map(money), money(total)], href: `#/contact/${sales ? "customer" : "vendor"}/${id}` }); });
    rows.push({ kind: "tot", cells: ["Total", ...tot.map(money)] });
    return { title: sales ? "Receivables aging" : "Payables aging", period: `As at ${fd(to)} · by days past due`, pb, head: [{ t: sales ? "Customer" : "Supplier" }, { t: "Current", n: 1 }, { t: "1-30", n: 1 }, { t: "31-60", n: 1 }, { t: "61-90", n: 1 }, { t: "90+", n: 1 }, { t: "Unused credits", n: 1 }, { t: "Total", n: 1 }], rows, landscape: true };
  }
  if (key === "salescust" || key === "purchvend") {
    const pb = periodBar(p); const sales = key === "salescust";
    const per = new Map();
    D.docs.forEach(d => { if (d.status !== "posted" || d.date < pb.from || d.date > pb.to) return; const types = sales ? ["invoice", "creditnote"] : ["bill", "vendorcredit", "expense"]; if (!types.includes(d.type)) return; const sg = d.type === "creditnote" || d.type === "vendorcredit" ? -1 : 1; const k = d.contactId || "payee:" + d.contactName; const x = per.get(k) || { n: d.contactName, c: 0, net: 0, vat: 0 }; x.c++; x.net += sg * d.subtotal; x.vat += sg * d.vatAmt; per.set(k, x); });
    const rows = [...per.entries()].sort((a, b) => b[1].net - a[1].net).map(([id, x]) => ({ cells: [x.n || "(no name)", String(x.c), money(x.net), money(x.vat), money(x.net + x.vat)], href: id.startsWith("payee:") ? "" : `#/contact/${sales ? "customer" : "vendor"}/${id}` }));
    const T = [...per.values()].reduce((a, x) => [a[0] + x.c, a[1] + x.net, a[2] + x.vat], [0, 0, 0]);
    rows.push({ kind: "tot", cells: ["Total", String(T[0]), money(T[1]), money(T[2]), money(T[1] + T[2])] });
    return { title: sales ? "Sales by customer" : "Purchases by supplier", period: `${fd(pb.from)} to ${fd(pb.to)}`, pb, head: [{ t: sales ? "Customer" : "Supplier / payee" }, { t: "Documents", n: 1 }, { t: "Net", n: 1 }, { t: "VAT", n: 1 }, { t: "Gross", n: 1 }], rows };
  }
  if (key === "vatdetail") {
    const pb = periodBar(p, { vat: true });
    const docs = D.docs.filter(d => d.status === "posted" && d.date >= pb.from && d.date <= pb.to && d.tax.length).sort((a, b) => a.date.localeCompare(b.date));
    const rows = []; docs.forEach(d => d.tax.forEach(([box, n, v]) => rows.push({ cells: [fd(d.date), d.number, d.ref || "", d.contactName || "", d.contactTrn || "", "Box " + box, money(n), money(v)], href: "#/doc/" + d.id })));
    return { title: "VAT detail", period: `${fd(pb.from)} to ${fd(pb.to)}`, pb, head: [{ t: "Date" }, { t: "Document" }, { t: "Supplier ref" }, { t: "Contact" }, { t: "TRN" }, { t: "Box" }, { t: "Amount", n: 1 }, { t: "VAT", n: 1 }], rows, landscape: true };
  }
  if (key === "vat" || key === "faf") {
    const pb = periodBar(p, { vat: true });
    const bx = BK.vatBoxes(pb.from, pb.to); const g = k => bx[k] || { net: 0, vat: 0, docs: [] };
    const E = [["1a", "Abu Dhabi"], ["1b", "Dubai"], ["1c", "Sharjah"], ["1d", "Ajman"], ["1e", "Umm Al Quwain"], ["1f", "Ras Al Khaimah"], ["1g", "Fujairah"]];
    const rows = [{ kind: "grp", cells: ["", "VAT on sales and all other outputs", "", "", ""] }];
    const R = (box, label, amt, vat, kind) => rows.push({ kind, box, cells: [box, label, amt == null ? "" : money(amt), vat == null ? "" : money(vat), "0.00"], href: bx[box] ? `#/report/vatbox?box=${box}&from=${pb.from}&to=${pb.to}` : "" });
    E.forEach(([k, n]) => R(k, `Standard rated supplies in ${n}`, g(k).net, g(k).vat, "ind"));
    R("2", "Tax refunds provided to tourists under the Tax Refunds for Tourists Scheme", 0, 0, "ind");
    R("3", "Supplies subject to the reverse charge provisions", g("3").net, g("3").vat, "ind");
    R("4", "Zero rated supplies", g("4").net, null, "ind");
    R("5", "Exempt supplies", g("5").net, null, "ind");
    R("6", "Goods imported into the UAE", g("6").net, g("6").vat, "ind");
    R("7", "Adjustments to goods imported into the UAE", 0, 0, "ind");
    const outNet = E.reduce((a, [k]) => a + g(k).net, 0) + g("3").net + g("4").net + g("5").net + g("6").net, outVat = E.reduce((a, [k]) => a + g(k).vat, 0) + g("3").vat + g("6").vat;
    R("8", "Totals", outNet, outVat, "sub");
    rows.push({ kind: "grp", cells: ["", "VAT on expenses and all other inputs", "", "", ""] });
    R("9", "Standard rated expenses", g("9").net, g("9").vat, "ind");
    R("10", "Supplies subject to the reverse charge provisions", g("10").net, g("10").vat, "ind");
    R("11", "Totals", g("9").net + g("10").net, g("9").vat + g("10").vat, "sub");
    rows.push({ kind: "grp", cells: ["", "Net VAT due", "", "", ""] });
    const due = R2(outVat), rec = R2(g("9").vat + g("10").vat);
    rows.push({ kind: "ind", box: "12", cells: ["12", "Total value of due tax for the period", "", money(due), ""] });
    rows.push({ kind: "ind", box: "13", cells: ["13", "Total value of recoverable tax for the period", "", money(rec), ""] });
    rows.push({ kind: "tot", box: "14", cells: ["14", due - rec >= 0 ? "Payable tax for the period" : "Refundable tax for the period", "", money(due - rec), ""] });
    return { title: key === "faf" ? "FTA audit file" : "VAT return (VAT 201)", period: `Tax period ${fd(pb.from)} to ${fd(pb.to)} · due ${fd(BK.addDays(pb.to, 28))}`, pb, head: [{ t: "Box" }, { t: "Description" }, { t: "Amount (AED)", n: 1 }, { t: "VAT amount (AED)", n: 1 }, { t: "Adjustment (AED)", n: 1 }], rows, vat: { due, rec, from: pb.from, to: pb.to, bx } };
  }
  if (key === "ct") return ctModel(p);
  if (key === "vatbox") {
    const pb = periodBar(p, { vat: true, extra: `<span class="st">Box ${esc(p.box || "")}</span>` }); const bx = BK.vatBoxes(pb.from, pb.to)[p.box] || { docs: [] };
    const DOCS = BK.DOCS();
    const rows = bx.docs.map(([id, n, v]) => { const d = DOCS.get(id); return { cells: [fd(d.date), d.number, d.ref || "", d.contactName || "", d.contactTrn || "", money(n), money(v)], href: "#/doc/" + id }; });
    rows.push({ kind: "tot", cells: ["Total", "", "", "", "", money(bx.net || 0), money(bx.vat || 0)] });
    return { title: `VAT return box ${p.box}`, period: `${fd(pb.from)} to ${fd(pb.to)}`, pb, head: [{ t: "Date" }, { t: "Document" }, { t: "Reference" }, { t: "Contact" }, { t: "TRN" }, { t: "Amount", n: 1 }, { t: "VAT", n: 1 }], rows, landscape: true };
  }
  return null;
}


/* ---------- corporate tax ---------- */
const SBR_LIMIT = 3000000, BAND = 375000, RATE = 0.09, SBR_LAST = "2029-12-31";
function fyEnd(start) { const d = new Date(start + "T00:00:00Z"); return new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), 0)).toISOString().slice(0, 10); }
function plus9Months(end) { const d = new Date(end + "T00:00:00Z"); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() === d.getUTCDate();
  const t = last ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 10, 0)) : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 9, d.getUTCDate())); return t.toISOString().slice(0, 10); }
function plusMonths(end, n) { const d = new Date(end + "T00:00:00Z"); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n + 1, 0)).toISOString().slice(0, 10); }
function ctYears() {
  const BK = B(), D = BK.D; const first = D.docs.filter(d => d.status === "posted").map(d => d.date).sort()[0] || D.today;
  const out = []; let y = BK.fyStart(first); const cur = BK.fyStart(D.today);
  while (y <= cur) { out.push(y); y = BK.addDays(fyEnd(y), 1); } return out;
}
const memos = new WeakMap();
function ctCompute(fy) {
  const BK = B(), D = BK.D, ACC = BK.ACC(); if (!memos.has(D)) memos.set(D, {}); const memo = memos.get(D); const key = fy;
  if (memo[key]) return memo[key];
  const end = fyEnd(fy), inp = (D.settings.ct || {})[fy] || {};
  const bal = balances(fy, end);
  let revenue = 0, profit = 0; const addBacks = [];
  D.accounts.forEach(a => { const v = bal.get(a.code) || 0; if (!v) return;
    if (a.group === "income") { revenue -= v; profit -= v; }
    if (a.group === "expense") { profit -= v; if (a.code !== "8000" && a.ctPct > 0 && v > 0) addBacks.push({ label: `${a.code} ${a.name} (${a.ctPct}% of ${money(v)})`, amt: R2(v * a.ctPct / 100), href: `#/account/${a.code}?from=${fy}&to=${end}` }); } });
  const ctExp = bal.get("8000") || 0; const profitBefore = R2(profit + ctExp);
  revenue = R2(revenue);
  // Earlier financial years in the books: revenue over AED 3M there rules out the relief for good.
  const years = ctYears(); const prev = years.filter(y => y < fy);
  const prevOver = prev.find(y => R2(-[...balances(y, fyEnd(y)).entries()].filter(([c]) => (ACC.get(c) || {}).group === "income").reduce((a, [, v]) => a + v, 0)) > SBR_LIMIT);
  const why = revenue > SBR_LIMIT ? `Revenue AED ${money(revenue)} is over AED 3,000,000` : prevOver ? `Revenue went over AED 3,000,000 in the year from ${BK.fd(prevOver)}` : inp.priorOver3m ? "Revenue went over AED 3,000,000 in a period before these books" : end > SBR_LAST ? "Small Business Relief applies only to tax periods ending by 31 Dec 2029" : "";
  const eligible = !why, sbr = eligible && !!inp.sbr;
  const manAdd = (inp.adj || []).filter(a => a.kind === "add"), manLess = (inp.adj || []).filter(a => a.kind === "less");
  const ti0 = R2(profitBefore + addBacks.reduce((a, x) => a + x.amt, 0) + manAdd.reduce((a, x) => a + x.amt, 0) - manLess.reduce((a, x) => a + x.amt, 0));
  // Losses brought forward: entered for the year, otherwise carried from the previous year in the books.
  const p0 = prev[prev.length - 1];
  const lossBf = inp.lossBf ? R2(inp.lossBf) : p0 ? ctCompute(p0).lossCf : 0;
  let used = 0, ti = ti0, lossCf = lossBf;
  if (sbr) { ti = 0; lossCf = lossBf; }
  else { if (ti0 > 0) { used = R2(Math.min(lossBf, ti0 * 0.75)); ti = R2(ti0 - used); lossCf = R2(lossBf - used); } else { ti = 0; lossCf = R2(lossBf - ti0); } }
  const tax = sbr ? 0 : Math.round(Math.max(0, R2(ti - BAND)) * RATE * 100 + 1e-6) / 100;
  const out = { fy, end, inp, revenue, profitBefore, ctExp, addBacks, manAdd, manLess, ti0, lossBf, used, ti, lossCf, tax, eligible, why, sbr, due: plus9Months(end), waiver: plusMonths(end, 7) };
  memo[key] = out; return out;
}
function ctModel(p) {
  const BK = B(), fd = BK.fd; const years = ctYears(); const fy = years.includes(p.fy) ? p.fy : (years.length > 1 && BK.D.today < plus9Months(fyEnd(years[years.length - 2])) ? years[years.length - 2] : years[years.length - 1]);
  const c = ctCompute(fy); const inProgress = c.end > BK.D.today;
  const rows = [];
  rows.push({ kind: "grp", cells: ["Small Business Relief test", ""] });
  rows.push({ kind: "ind", cells: ["Revenue for the tax period", money(c.revenue)], href: `#/report/pl?from=${c.fy}&to=${c.end}` });
  rows.push({ kind: "ind", cells: ["Small Business Relief revenue limit", money(SBR_LIMIT)] });
  rows.push({ kind: "ind", cells: ["Eligible for Small Business Relief", c.eligible ? "Yes" : "No: " + c.why] });
  rows.push({ kind: "sub", cells: ["Small Business Relief elected in the return", c.sbr ? "Yes" : "No"] });
  rows.push({ kind: "grp", cells: ["Taxable income", ""] });
  rows.push({ kind: "ind", cells: ["Accounting net profit before corporate tax", money(c.profitBefore)], href: `#/report/pl?from=${c.fy}&to=${c.end}` });
  c.addBacks.forEach(a => rows.push({ kind: "ind", cells: ["Add: non-deductible " + a.label, money(a.amt)], href: a.href }));
  c.manAdd.forEach(a => rows.push({ kind: "ind", cells: ["Add: " + a.label, money(a.amt)] }));
  c.manLess.forEach(a => rows.push({ kind: "ind", cells: ["Less: " + a.label, money(-a.amt)] }));
  rows.push({ kind: "sub", cells: ["Taxable income before loss relief", money(c.ti0)] });
  rows.push({ kind: "ind", cells: ["Tax losses brought forward", money(c.lossBf)] });
  rows.push({ kind: "ind", cells: ["Loss relief used (up to 75% of taxable income)", money(-c.used)] });
  if (c.sbr) rows.push({ kind: "ind", cells: ["Taxable income treated as nil (Small Business Relief)", money(-(c.ti0 - c.used))] });
  rows.push({ kind: "sub", cells: ["Taxable income", money(c.ti)] });
  rows.push({ kind: "ind", cells: ["Taxed at 0% (first AED 375,000)", money(Math.min(c.ti, BAND))] });
  rows.push({ kind: "ind", cells: ["Taxed at 9%", money(Math.max(0, c.ti - BAND))] });
  rows.push({ kind: "tot", cells: ["Corporate tax payable", money(c.tax)] });
  rows.push({ kind: "ind", cells: ["Tax losses carried forward", money(c.lossCf)] });
  rows.push({ kind: "grp", cells: ["Filing", ""] });
  rows.push({ kind: "ind", cells: ["Tax period", `${fd(c.fy)} to ${fd(c.end)}`] });
  rows.push({ kind: "ind", cells: ["Return and payment due (EmaraTax)", fd(c.due)] });
  rows.push({ kind: "ind", cells: ["First tax period only: file by this date for the late-registration penalty waiver", fd(c.waiver)] });
  rows.push({ kind: "ind", cells: ["Corporate tax already booked in the accounts (8000)", money(c.ctExp)] });
  const yearSel = `<div class="periodbar"><select id="cty">${years.map(y => `<option value="${y}"${y === fy ? " selected" : ""}>Financial year ${fd(y)} to ${fd(fyEnd(y))}</option>`).join("")}</select></div>`;
  const note = (inProgress ? "This year is still running, so the figures are an estimate to date. " : "") + (c.sbr ? "Under Small Business Relief no loss relief is used in this period and a loss of this period isn't carried forward. " : "") + "Have your tax agent confirm the adjustments before filing.";
  return { title: "Corporate tax computation", period: `Tax period ${fd(c.fy)} to ${fd(c.end)} · return due ${fd(c.due)}`, pb: { html: yearSel, from: c.fy, to: c.end, wire: () => { document.getElementById("cty").onchange = e => B().go("#/report/ct?fy=" + e.target.value); } }, head: [{ t: "Item" }, { t: "AED", n: 1 }], rows, note, ct: c };
}
async function ctInputs(c) {
  const BK = B(), esc = BK.esc, inp = c.inp || {};
  const d = document.createElement("dialog"); d.className = "wide";
  const adj = (inp.adj || []).slice(); if (!adj.length) adj.push({ kind: "add", label: "", amt: "" });
  const row = (a, i) => `<tr data-i="${i}"><td><select data-k="kind"><option value="add">Add back</option><option value="less"${a.kind === "less" ? " selected" : ""}>Deduct</option></select></td><td><input data-k="label" maxlength="150" value="${esc(a.label)}" placeholder="e.g. Interest over the 30% EBITDA limit, exempt dividend"></td><td><input class="num" data-k="amt" value="${a.amt || ""}" style="width:130px"></td><td><button type="button" class="x" data-rm>×</button></td></tr>`;
  d.innerHTML = `<form><h3>Corporate tax inputs · ${BK.fd(c.fy)} to ${BK.fd(c.end)}</h3>
    <label class="chk"><input type="checkbox" id="sbr"${inp.sbr ? " checked" : ""}${c.eligible ? "" : " disabled"}> Elect Small Business Relief in this return${c.eligible ? "" : ` (not available: ${esc(c.why)})`}</label>
    <label class="chk"><input type="checkbox" id="prior"${inp.priorOver3m ? " checked" : ""}> Revenue went over AED 3,000,000 in a tax period before these books started</label>
    <div class="fields"><label><span class="lbl">Tax losses brought forward (AED)</span><input class="num" id="loss" value="${inp.lossBf || ""}" placeholder="Leave blank to carry from the previous year"></label></div>
    <div class="sec">Other adjustments advised by your tax agent</div>
    <div class="tblwrap"><table class="list compact nohover" style="min-width:0"><tbody id="adj">${adj.map(row).join("")}</tbody></table></div>
    <div><button type="button" id="addA">+ Add adjustment</button></div>
    <p class="hint" style="margin:0">Expense accounts marked non-deductible in the Chart of accounts (for example 50% of business entertainment, fines and penalties) are added back automatically.</p>
    <div class="err"></div><div class="foot"><button type="button" data-x>Cancel</button><button class="primary" type="submit">Save</button></div></form>`;
  document.body.appendChild(d);
  const body = d.querySelector("#adj");
  const read = () => [...body.querySelectorAll("tr")].map(tr => ({ kind: tr.querySelector("[data-k=kind]").value, label: tr.querySelector("[data-k=label]").value, amt: tr.querySelector("[data-k=amt]").value }));
  d.querySelector("#addA").onclick = () => { const a = read(); a.push({ kind: "add", label: "", amt: "" }); body.innerHTML = a.map(row).join(""); };
  body.onclick = e => { if (e.target.dataset.rm != null) { const a = read(); a.splice(Number(e.target.closest("tr").dataset.i), 1); body.innerHTML = a.map(row).join(""); } };
  d.querySelector("[data-x]").onclick = () => { d.close(); d.remove(); };
  d.querySelector("form").onsubmit = async e => { e.preventDefault();
    try { await BK.api("PUT", "ct", { year: c.fy, sbr: d.querySelector("#sbr").checked, priorOver3m: d.querySelector("#prior").checked, lossBf: d.querySelector("#loss").value, adj: read() }); location.reload(); }
    catch (err) { d.querySelector(".err").textContent = err.message; } };
  d.showModal();
}

function toAoa(m) { return [[m.title], [B().D.settings.legalName], [m.period], [], m.head.map(h => h.t), ...m.rows.map(r => r.cells.map((c, i) => m.head[i] && m.head[i].n && /^-?[\d,]+\.\d\d$/.test(String(c)) ? Number(String(c).replace(/,/g, "")) : c))]; }

// The FTA audit file: company information, supply listing, purchase listing and the general ledger.
async function fafWorkbook(m) {
  const BK = B(), D = BK.D, S = D.settings, { from, to } = m.vat;
  const docs = D.docs.filter(d => d.status === "posted" && d.date >= from && d.date <= to);
  const company = [["Company information"], ["Legal name", S.legalName], ["Trade name", S.tradeName], ["TRN", S.trn], ["Licence no.", S.licenceNo], ["Address", S.address], ["Period start", from], ["Period end", to], ["Created", new Date().toISOString().slice(0, 10)], ["Product", "Bifold Tools Books"], ["Currency", "AED"]];
  const supply = [["Customer name", "Customer TRN", "Invoice date", "Invoice no.", "Permit / reference", "Line no.", "Product description", "Supply value AED", "VAT AED", "Tax code", "Country", "Emirate"]];
  const purch = [["Supplier name", "Supplier TRN", "Invoice date", "Invoice no.", "Permit / reference", "Line no.", "Product description", "Purchase value AED", "VAT AED", "Tax code", "Recoverable"]];
  // Line detail comes from each document.
  for (const d of docs.filter(x => ["invoice", "creditnote", "bill", "vendorcredit", "expense"].includes(x.type))) {
    const full = await BK.api("GET", "docs/" + d.id); const sg = d.type === "creditnote" || d.type === "vendorcredit" ? -1 : 1;
    (full.lines || []).forEach((l, i) => {
      if (d.type === "invoice" || d.type === "creditnote") supply.push([d.contactName, d.contactTrn, d.date, d.number, d.ref || "", i + 1, l.name, sg * l.net, sg * l.vatAmt, l.vat, "AE", d.emirate]);
      else purch.push([d.contactName, d.contactTrn, d.date, d.type === "expense" ? d.ref || d.number : d.ref, d.number, i + 1, l.name, sg * l.net, sg * l.vatAmt, l.vat, l.vat === "SR" && !l.blocked || l.vat === "RC" || l.vat === "IM" ? "Yes" : "No"]);
    });
  }
  supply.push(["Total", "", "", "", "", "", "", R2(supply.slice(1).reduce((a, r) => a + r[7], 0)), R2(supply.slice(1).reduce((a, r) => a + r[8], 0))]);
  purch.push(["Total", "", "", "", "", "", "", R2(purch.slice(1).reduce((a, r) => a + r[7], 0)), R2(purch.slice(1).reduce((a, r) => a + r[8], 0))]);
  const gl = [["Transaction date", "Account code", "Account name", "Transaction description", "Name", "Transaction ID", "Source document", "Source type", "Debit AED", "Credit AED"]];
  BK.ledger().filter(l => l.date >= from && l.date <= to).forEach(l => { const a = BK.ACC().get(l.acct) || {}; gl.push([l.date, l.acct, a.name, l.memo, BK.contactName(l.contact) || l.party || "", l.id.slice(0, 8), l.number, l.type, l.dr, l.cr]); });
  const box = toAoa(m);
  await BK.exportSheets(`FTA audit file ${S.legalName} ${from} to ${to}`, [["Company", company], ["Supply listing", supply], ["Purchase listing", purch], ["General ledger", gl], ["VAT 201 summary", box]]);
}

function render(key, p, page) {
  const BK = B(), esc = BK.esc;
  const m = build(key, p);
  if (!m) return BK.go("#/reports");
  const isVat = key === "vat" || key === "faf";
  const P = BK.D.perms;
  const acts = `<button id="xl">Export to Excel</button><button id="pv">Preview PDF</button><button id="pdf">Download PDF</button><button id="pr">Print</button>${key === "faf" ? `<button class="primary" id="faf">Build audit file (Excel)</button>` : ""}${key === "vat" && P.manager ? `<button id="lock">Lock this period</button>` : ""}${key === "vat" && P.full ? `<button class="primary" id="settle">VAT settlement journal</button>` : ""}${key === "ct" && P.full ? `<button id="ctin">Corporate tax inputs</button><button class="primary" id="ctj">Corporate tax journal</button>` : ""}`;
  const table = `<table><thead><tr>${m.head.map(h => `<th class="${h.n ? "n" : ""}">${esc(h.t)}</th>`).join("")}</tr></thead><tbody>${m.rows.map(r => `<tr class="${r.kind || ""}">${r.cells.map((c, i) => `<td class="${m.head[i] && m.head[i].n ? "n" : ""}${isVat && i === 0 ? " box" : ""}">${r.href && i === (isVat ? 1 : 0) ? `<a href="${esc(r.href)}">${esc(c)}</a>` : esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const vatNote = isVat ? `<div class="note" style="margin-bottom:14px"><b>File on the FTA EmaraTax portal by ${BK.fd(BK.addDays(m.vat.to, 28))}</b>Copy these figures into the VAT 201 form. Box 1 is split by the emirate set on each invoice. Click a box to see the documents behind it. ${BK.D.settings.lockDate >= m.vat.to ? `This period is locked (books locked up to ${BK.fd(BK.D.settings.lockDate)}).` : "After filing, lock the period so nothing in it can change."}</div>` : "";
  const ctTop = key === "ct" ? `<div class="note ${m.ct.sbr ? "" : m.ct.eligible ? "warn" : ""}" style="margin-bottom:14px"><b>${m.ct.sbr ? "Small Business Relief elected: no corporate tax for this period" : m.ct.eligible ? "This company qualifies for Small Business Relief but it isn't elected" : "Small Business Relief isn't available"}</b>${m.ct.sbr ? "You still register, keep records and file the return on EmaraTax by " + BK.fd(m.ct.due) + ", electing the relief in it." : m.ct.eligible ? "Revenue is within AED 3,000,000. Electing it in the return treats taxable income as nil. Turn it on in Corporate tax inputs if you'll elect it." : esc(m.ct.why) + ". Corporate tax is 9% of taxable income above AED 375,000."}</div>` : "";
  let vatChecks = "";
  if (key === "vat") {
    const { from, to } = m.vat; const D = BK.D;
    const drs = (m.vat.bx.DRS || { net: 0 }).net;
    const adv = D.docs.filter(d => d.type === "receipt" && d.status === "posted" && d.date >= from && d.date <= to && d.balance > 0.004);
    const unv = D.docs.filter(d => d.status === "posted" && d.date >= from && d.date <= to && d.contactId && BK.domesticInput(d) && !BK.supplierVerified(d.contactId));
    const unvVat = R2(unv.reduce((a, d) => a + (d.tax || []).filter(x => x[0] === "9" || (x[0] === "10" && BK.domesticInput(d))).reduce((s, x) => s + x[2], 0), 0));
    const late = D.docs.filter(d => d.type === "invoice" && d.status === "posted" && d.date >= from && d.date <= to && d.supplyDate && Math.round((Date.parse(d.date) - Date.parse(d.supplyDate)) / 864e5) > 14);
    const items = [];
    if (drs) items.push(`<div class="note"><b>Reverse charge sales of electronic devices: AED ${money(drs)}</b>No output VAT is charged on these (Cabinet Decision No. 91 of 2023); your customers account for it. Confirm with your tax agent how the FTA wants the value shown on your return. Keep each customer's written declaration.</div>`);
    if (adv.length) items.push(`<div class="note warn"><b>${adv.length} customer payment(s) not yet matched to an invoice: AED ${money(adv.reduce((a, d) => a + d.balance, 0))}</b>If these are advances for taxable supplies, VAT is due in the period they were received: issue tax invoices for them. ${adv.slice(0, 5).map(d => `<a href="#/doc/${d.id}">${esc(d.number)}</a>`).join(", ")}</div>`);
    if (unv.length) items.push(`<div class="note warn"><b>Input VAT of AED ${money(unvVat)} is from ${new Set(unv.map(d => d.contactId)).size} supplier(s) without a verification record</b>FTA Decision No. 13 of 2026 expects supplier and supply checks before input VAT is claimed. Record them on each supplier's page.</div>`);
    vatChecks = items.length ? `<div style="display:grid;gap:8px;margin-bottom:14px">${items.join("")}</div>` : "";
  }
  const fafNote = key === "faf" ? `<div class="note" style="margin-bottom:14px"><b>FTA audit file</b>The workbook has the company information, the supply listing and purchase listing line by line, the general ledger, and the VAT 201 summary for the period. Use it when the FTA or your tax agent asks for an audit file. Large periods take a little longer while each document's lines are read.</div>` : "";
  page(m.title, "Reports", acts, `<div class="tools">${m.pb.html}<a class="btn" href="#/reports" style="margin-left:auto">All reports</a></div>${vatNote}${vatChecks}${fafNote}${ctTop}<div class="rep"><div class="rh"><h2>${esc(m.title)}</h2><div>${esc(BK.D.settings.legalName)}</div><div>${esc(m.period)}</div></div>${table}${m.note ? `<p class="hint">${esc(m.note)}</p>` : ""}</div>`, isVat ? "vat" : key === "ct" ? "ct" : "reports");
  m.pb.wire(key === "vat" ? "vat" : key);
  const name = `${m.title} ${BK.D.settings.legalName} ${m.pb.from || ""} ${m.pb.to}`.replace(/\s+/g, " ").trim();
  const pdf = () => window.BKPDF.report({ title: m.title, period: m.period, head: m.head, rows: m.rows, landscape: m.landscape, note: m.note });
  document.getElementById("xl").onclick = () => BK.exportSheets(name, [[m.title.slice(0, 31), toAoa(m)]]).catch(e => BK.toast(e.message, 1));
  document.getElementById("pv").onclick = () => window.BXPdf.preview(pdf, name + ".pdf");
  document.getElementById("pdf").onclick = () => pdf().then(b => BK.saveBlob(b, name + ".pdf")).catch(e => BK.toast(e.message, 1));
  document.getElementById("pr").onclick = () => window.print();
  const ci = document.getElementById("ctin"); if (ci) ci.onclick = () => ctInputs(m.ct);
  const cj = document.getElementById("ctj"); if (cj) cj.onclick = () => {
    const c = m.ct, delta = R2(c.tax - c.ctExp);
    if (Math.abs(delta) < 0.005) { BK.toast(c.tax ? "The corporate tax for this year is already booked." : "No corporate tax is payable for this year, so there's nothing to book."); return; }
    const lines = delta > 0 ? [{ account: "8000", debit: delta, memo: "Corporate tax for the year" }, { account: "2240", credit: delta, memo: "Corporate tax payable to the FTA" }] : [{ account: "2240", debit: -delta, memo: "Reduce corporate tax provision" }, { account: "8000", credit: -delta, memo: "Reduce corporate tax for the year" }];
    sessionStorage.setItem("bk-draft", JSON.stringify({ type: "journal", date: c.end, ref: `CT ${c.fy.slice(0, 4)}`, notes: `Corporate tax for ${BK.fd(c.fy)} to ${BK.fd(c.end)}: taxable income AED ${money(c.ti)}, tax AED ${money(c.tax)}${c.ctExp ? ` (AED ${money(c.ctExp)} already booked)` : ""}.`, lines }));
    BK.go("#/new/journal?draft=1");
  };
  const f = document.getElementById("faf"); if (f) f.onclick = async () => { f.disabled = true; f.textContent = "Building…"; try { await fafWorkbook(m); } catch (e) { BK.toast(e.message, 1); } f.disabled = false; f.textContent = "Build audit file (Excel)"; };
  const lk = document.getElementById("lock"); if (lk) lk.onclick = async () => {
    if (!confirm(`Lock the books up to ${BK.fd(m.vat.to)}? Nothing dated on or before it can be created, edited or voided afterwards.`)) return;
    try { await BK.api("PUT", "settings", { ...BK.D.settings, lockDate: m.vat.to }); location.reload(); } catch (e) { BK.toast(e.message, 1); }
  };
  const st = document.getElementById("settle"); if (st) st.onclick = () => {
    // Clears the period's output and input VAT into the FTA settlement account; the payment to the FTA is then made from the bank against 2110.
    const S = BK.D.sys; const lines = [];
    if (m.vat.due) lines.push({ account: S.VAT_OUT, debit: m.vat.due, memo: "Output VAT for the period" });
    if (m.vat.rec) lines.push({ account: S.VAT_IN, credit: m.vat.rec, memo: "Input VAT for the period" });
    const net = R2(m.vat.due - m.vat.rec);
    lines.push(net >= 0 ? { account: "2110", credit: net, memo: "VAT payable to the FTA" } : { account: "2110", debit: -net, memo: "VAT refundable by the FTA" });
    sessionStorage.setItem("bk-draft", JSON.stringify({ type: "journal", date: m.vat.to, ref: `VAT ${m.vat.from} to ${m.vat.to}`, notes: `VAT return for ${BK.fd(m.vat.from)} to ${BK.fd(m.vat.to)}: clear output and input VAT to the FTA settlement account.`, lines }));
    BK.go("#/new/journal?draft=1");
  };
  document.querySelectorAll(".rep a[href^='#/']").forEach(a => a.onclick = e => { e.preventDefault(); BK.go(a.getAttribute("href")); });
}

window.BKREP = { render, build, ctCompute, ctYears };
})();
