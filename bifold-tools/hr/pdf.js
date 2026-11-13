// HR PDFs: payslip, salary payment receipt, payroll register and end-of-service gratuity statement.
// jsPDF + AutoTable, the same libraries and letterhead style as Books.
(function () {
"use strict";
const LIB = { jspdf: "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js", autotable: "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js" };
const loaded = {};
const load = src => loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error("Couldn't load the PDF library. Check your connection and try again.")); }; document.head.appendChild(s); }));
async function lib() { await load(LIB.jspdf); await load(LIB.autotable); return window.jspdf.jsPDF; }
let logoP = {};
function image(src) {
  return logoP[src] || (logoP[src] = new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext("2d").drawImage(im, 0, 0); res({ data: c.toDataURL("image/png"), w: im.naturalWidth, h: im.naturalHeight }); }; im.onerror = () => res(null); im.src = src; }));
}
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function w3(n) { const h = Math.floor(n / 100), r = n % 100; return [h ? ONES[h] + " Hundred" : "", r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? " " + ONES[r % 10] : "")].filter(Boolean).join(" "); }
function words(amount) {
  const v = Math.round(Math.abs(Number(amount) || 0) * 100); let d = Math.floor(v / 100); const f = v % 100;
  if (!d && !f) return "UAE Dirhams Zero Only";
  const parts = []; [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"], [1, ""]].forEach(([u, n]) => { const q = Math.floor(d / u); if (q) { parts.push(w3(q) + (n ? " " + n : "")); d %= u; } });
  return `UAE Dirhams ${parts.join(" ") || "Zero"}${f ? " and Fils " + w3(f) : ""} Only`;
}
const H = () => window.HR;
const money = n => H().aed(n);
const fd = d => H().fd(d);
const palette = () => (window.BIFOLD_BRAND || {}).key === "techhub" ? { p: [0, 60, 80], a: [40, 160, 140], soft: [232, 244, 242] } : { p: [30, 90, 140], a: [216, 31, 42], soft: [233, 240, 247] };

async function start() { const JsPDF = await lib(); return new JsPDF({ unit: "mm", format: "a4" }); }
async function head(doc, title, sub, line3) {
  const C = palette(), B = window.BIFOLD_BRAND || {}, W = 210, M = 14;
  const logo = await image(B.logo || "/assets/bifold_logo.png");
  if (logo) { const h = 16, w = Math.min(62, logo.w / logo.h * h); doc.addImage(logo.data, "PNG", M, 12, w, w === 62 ? 62 * logo.h / logo.w : h); }
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...C.p); doc.text(title, W - M, 18, { align: "right" });
  doc.setFontSize(10); doc.setTextColor(40); doc.text(sub || "", W - M, 24.5, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90); if (line3) doc.text(line3, W - M, 29.5, { align: "right" });
  doc.setDrawColor(...C.a); doc.setLineWidth(0.9); doc.line(M, 34, W - M, 34);
  return { doc, C, W, M, y: 40 };
}
function footer(doc, note) {
  const O = H().D.org || {}, C = palette(), W = 210, M = 14, n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); const Hh = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...C.p); doc.setLineWidth(0.3); doc.line(M, Hh - 16, W - M, Hh - 16);
    doc.setFontSize(7.5); doc.setTextColor(100); doc.setFont("helvetica", "normal");
    doc.text([O.legalName, O.licenceNo ? "Licence " + O.licenceNo : ""].filter(Boolean).join("  ·  "), M, Hh - 12);
    doc.text(doc.splitTextToSize([O.address, O.phone, O.email, O.website].filter(Boolean).join("  ·  "), W - 2 * M - 30)[0] || "", M, Hh - 8.5);
    doc.text(`Page ${i} of ${n}`, W - M, Hh - 12, { align: "right" });
    doc.setFontSize(7); doc.setTextColor(130); doc.text(note || "Private and confidential. Computer-generated document.", W / 2, Hh - 4.5, { align: "center" });
  }
}
function box(ctx, items, cols = 4) {
  items = items.filter(x => x && x[1] !== "" && x[1] != null); if (!items.length) return;
  const { doc, M, W, C } = ctx; const cw = (W - 2 * M) / cols, rows = Math.ceil(items.length / cols);
  doc.setFillColor(...C.soft); doc.roundedRect(M, ctx.y, W - 2 * M, rows * 11 + 2, 1.5, 1.5, "F");
  items.forEach(([k, v], i) => { const x = M + 3 + (i % cols) * cw, y = ctx.y + 5 + Math.floor(i / cols) * 11; doc.setFontSize(6.8); doc.setFont("helvetica", "bold"); doc.setTextColor(110); doc.text(k.toUpperCase(), x, y); doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(20); doc.text(doc.splitTextToSize(String(v), cw - 5)[0], x, y + 4.5); });
  ctx.y += rows * 11 + 6;
}
function sign(ctx, labels) {
  const { doc, M, W } = ctx; let y = ctx.y + 16; if (y > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); y = 34; }
  const cw = (W - 2 * M) / labels.length;
  labels.forEach((l, i) => { const x = M + i * cw; doc.setDrawColor(150); doc.setLineWidth(0.2); doc.line(x, y, x + cw - 14, y); doc.setFontSize(8); doc.setTextColor(90); doc.text(l, x, y + 4); });
  ctx.y = y + 8;
}
const monthName = ym => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const mask = a => a ? (a.length > 8 ? a.slice(0, 4) + " **** " + a.slice(-4) : a) : "";
// Each fixed component for the days paid; rounding goes to the basic so the parts add up to the line's fixed pay.
function parts(l) {
  const f = (l.employed - l.unpaidDays) / l.daysInMonth;
  const p = { housing: H().r2(l.housing * f), transport: H().r2(l.transport * f), otherAllow: H().r2(l.otherAllow * f) };
  p.basic = H().r2(l.fixed - p.housing - p.transport - p.otherAllow); return p;
}

async function slipPage(doc, run, l, mode, first) {
  if (!first) doc.addPage();
  const D = H().D, emp = D.employees.find(e => e.id === l.empId) || {};
  const ctx = await head(doc, mode === "receipt" ? "SALARY RECEIPT" : "PAYSLIP", monthName(run.month), run.status === "paid" ? `Paid on ${fd(run.payDate)}` : `Salary due by ${fd(H().dueOf(run.month))}`);
  const { M, W, C } = ctx;
  box(ctx, [["Employee", l.name], ["Employee no.", l.empNo || "-"], ["Designation", l.designation || "-"], ["Department", emp.department || "-"],
    ["Joining date", fd(l.joinDate)], ["MOHRE person ID", l.personId || "-"], ["Paid through", D.payMethods[l.payMethod] || l.payMethod], [l.payMethod === "card" ? "Salary card" : "IBAN", mask(l.account) || "-"]]);
  box(ctx, [["Pay period", `${fd(l.from)} to ${fd(l.to)}`], ["Days in month", l.daysInMonth], ["Days employed", l.employed], ["Unpaid leave days", l.unpaidDays], ["Days paid", l.employed - l.unpaidDays]]);
  if (mode === "receipt") {
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(25);
    const txt = `I, ${l.name}${l.empNo ? ` (employee no. ${l.empNo})` : ""}, acknowledge that I have received the sum of AED ${money(l.net)} (${words(l.net)}) from ${(D.org || {}).legalName || D.company.name}, being my net salary for ${monthName(run.month)}${l.payMethod === "none" ? "" : ", paid through the Wage Protection System"}${run.payDate ? ` on ${fd(run.payDate)}` : ""}. The amount is made up as follows.`;
    const lines = doc.splitTextToSize(txt, W - 2 * M); doc.text(lines, M, ctx.y + 2); ctx.y += lines.length * 5 + 4;
  }
  const p = parts(l);
  const earn = [["Basic salary", p.basic], ["Housing allowance", p.housing], ["Transport allowance", p.transport], ["Other allowances", p.otherAllow], ["Overtime", l.overtime], ["Bonus", l.bonus], ["Commission", l.commission], ["Other additions", l.otherAdd]].filter((x, i) => i < 1 || x[1]);
  const ded = [["Salary advance recovered", l.advance], ["Other deductions", l.otherDed]].filter(x => x[1]);
  const gross = H().r2(l.fixed + l.variable);
  const rows = Math.max(earn.length, ded.length || 1);
  const body = []; for (let i = 0; i < rows; i++) { const e = earn[i], d = ded[i]; body.push([e ? e[0] : "", e ? money(e[1]) : "", d ? d[0] : (i === 0 && !ded.length ? "None" : ""), d ? money(d[1]) : ""]); }
  doc.autoTable({ startY: ctx.y, margin: { left: M, right: M }, head: [["Earnings", "AED", "Deductions", "AED"]], body, foot: [["Total earnings", money(gross), "Total deductions", money(l.deductions)]],
    headStyles: { fillColor: C.p, fontSize: 9 }, footStyles: { fillColor: C.soft, textColor: 20, fontSize: 9 }, styles: { fontSize: 9, cellPadding: 2.2 }, columnStyles: { 1: { halign: "right", cellWidth: 32 }, 3: { halign: "right", cellWidth: 32 } } });
  ctx.y = doc.lastAutoTable.finalY + 5;
  doc.setFillColor(...C.p); doc.rect(W - M - 84, ctx.y - 4.4, 84, 8, "F"); doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("NET PAY", W - M - 81, ctx.y + 1); doc.text("AED " + money(l.net), W - M - 2, ctx.y + 1, { align: "right" });
  ctx.y += 9; doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(80); doc.text(doc.splitTextToSize(words(l.net), W - 2 * M), W - M, ctx.y, { align: "right" }); ctx.y += 7;
  const contracted = H().r2(l.basic + l.housing + l.transport + l.otherAllow);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(70);
  const info = [`Contracted monthly wage: AED ${money(contracted)} (basic AED ${money(l.basic)}).`, l.note ? `Note: ${l.note}` : "", l.gcc ? "UAE / GCC national: pension contributions are handled under the pension law." : ""].filter(Boolean);
  info.forEach(t => { doc.text(doc.splitTextToSize(t, W - 2 * M), M, ctx.y); ctx.y += 4.6; });
  if (mode === "receipt") sign(ctx, ["Employee signature", "Date received", "For the employer"]);
  else sign(ctx, ["Employee signature (received)", "Authorised signatory"]);
}
async function slips(run, lines, mode) {
  const doc = await start(); for (let i = 0; i < lines.length; i++) await slipPage(doc, run, lines[i], mode, i === 0);
  footer(doc); return doc.output("blob");
}

async function register(run) {
  const D = H().D, doc = await start();
  doc.deletePage(1); doc.addPage("a4", "landscape");
  const C = palette(), W = 297, M = 12;
  const logo = await image((window.BIFOLD_BRAND || {}).logo || "/assets/bifold_logo.png");
  if (logo) { const h = 13, w = Math.min(55, logo.w / logo.h * h); doc.addImage(logo.data, "PNG", M, 10, w, h); }
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...C.p); doc.text("PAYROLL REGISTER", W - M, 15, { align: "right" });
  doc.setFontSize(10); doc.setTextColor(40); doc.text(`${monthName(run.month)}  ·  ${run.lines.length} employees  ·  ${run.status.toUpperCase()}`, W - M, 21, { align: "right" });
  doc.setDrawColor(...C.a); doc.setLineWidth(0.8); doc.line(M, 26, W - M, 26);
  const L = run.lines, s = k => money(L.reduce((a, l) => a + (Number(l[k]) || 0), 0));
  doc.autoTable({ startY: 30, margin: { left: M, right: M },
    head: [["Employee", "Person ID", "Paid days", "Fixed wage", "Fixed paid", "Overtime", "Bonus / comm.", "Other add.", "Advance", "Other ded.", "Net pay", "Method"]],
    body: L.map(l => [`${l.name}${l.empNo ? " (" + l.empNo + ")" : ""}`, l.personId || "-", `${l.employed - l.unpaidDays}/${l.daysInMonth}`, money(l.fixedGross), money(l.fixed), money(l.overtime), money(l.bonus + l.commission), money(l.otherAdd), money(l.advance), money(l.otherDed), money(l.net), l.payMethod === "none" ? "Outside WPS" : l.payMethod === "card" ? "WPS card" : "WPS bank"]),
    foot: [["Total", "", "", s("fixedGross"), s("fixed"), s("overtime"), money(L.reduce((a, l) => a + l.bonus + l.commission, 0)), s("otherAdd"), s("advance"), s("otherDed"), s("net"), ""]],
    headStyles: { fillColor: C.p, fontSize: 7.5 }, footStyles: { fillColor: C.soft, textColor: 20, fontSize: 8 }, styles: { fontSize: 7.8, cellPadding: 1.8 },
    columnStyles: Object.fromEntries([2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => [i, { halign: "right" }])),
    didParseCell: c => { if (c.column.index >= 2 && c.column.index <= 10) c.cell.styles.halign = "right"; } });
  let y = doc.lastAutoTable.finalY + 8; doc.setFontSize(8.5); doc.setTextColor(70); doc.setFont("helvetica", "normal");
  const st = [`Salary due through WPS by ${fd(H().dueOf(run.month))}.`, run.approvedBy ? `Approved by ${run.approvedBy} on ${fd(run.approvedAt)}.` : "", run.sifAt ? `WPS file created ${fd(run.sifAt)}.` : "", run.status === "paid" ? `Paid on ${fd(run.payDate)}.` : ""].filter(Boolean).join("  ");
  doc.text(doc.splitTextToSize(st, W - 2 * M), M, y);
  y += 16; ["Prepared by", "Checked by", "Approved by"].forEach((t, i) => { const x = M + i * 90; doc.setDrawColor(150); doc.line(x, y, x + 70, y); doc.text(t, x, y + 4); });
  const O = D.org || {}, n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(110); doc.text(`${O.legalName || D.company.name}  ·  Private and confidential`, M, 203); doc.text(`Page ${i} of ${n}`, W - M, 203, { align: "right" }); }
  return doc.output("blob");
}

async function gratuity(emp, asOf) {
  const D = H().D, doc = await start();
  const ctx = await head(doc, "END OF SERVICE", "Gratuity statement", `As of ${fd(asOf)}`);
  const { M, W, C } = ctx, g = emp.gratuity, s = emp.service;
  box(ctx, [["Employee", emp.name], ["Employee no.", emp.empNo || "-"], ["Designation", emp.designation || "-"], ["Nationality", emp.nationality || "-"],
    ["Joining date", fd(emp.joinDate)], ["Service up to", fd(s.end)], ["Contract", emp.contract === "limited" ? "Limited" : "Unlimited"], ["Status", emp.status === "left" ? "Left" : "Active"]]);
  doc.autoTable({ startY: ctx.y, margin: { left: M, right: M }, theme: "plain", styles: { fontSize: 9.5, cellPadding: 2.4 }, columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
    body: [["Calendar days of service", String(s.days + s.unpaid)], ["Less unpaid leave days (not counted as service)", String(s.unpaid)], ["Days of continuous service counted", String(s.days)],
      ["Years of service", H().r2(s.years).toFixed(2)], ["Basic monthly wage (AED)", money(emp.basic)], ["Daily basic wage (basic / 30)", g.daily != null ? money(g.daily) : "-"],
      ["Gratuity (AED)", money(g.amount)]] });
  ctx.y = doc.lastAutoTable.finalY + 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(40);
  const t = [g.note, "Basis: Federal Decree-Law No. 33 of 2021, Article 51. 21 days' basic wage for each of the first five years of service and 30 days' basic wage for each further year, pro rata for part years, after at least one year of continuous service. Unpaid leave is not counted. The total can't exceed two years' wage.",
    "This statement is an estimate as of the date shown. The final settlement also includes salary to the last working day, the cash value of unused annual leave on basic wage, and any other amounts due, and must be paid within 14 days of the end of employment."];
  t.forEach(x => { const l = doc.splitTextToSize(x, W - 2 * M); doc.text(l, M, ctx.y); ctx.y += l.length * 4.4 + 3; });
  sign(ctx, ["Prepared by", "Employee acknowledgement"]);
  footer(doc); return doc.output("blob");
}

window.HRPdf = { slips, register, gratuity, words };
})();
