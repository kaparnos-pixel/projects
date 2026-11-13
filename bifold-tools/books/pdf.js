// Books PDFs: tax invoice, tax credit note, quotation, purchase order, payment receipt, statement of account and reports.
// jsPDF + AutoTable (the same libraries the AMC and Completion tools use). Branded per company.
(function () {
"use strict";
const LIB = { jspdf: "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js", autotable: "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js" };
const loaded = {};
const load = src => loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error("Couldn't load the PDF library. Check your connection and try again.")); }; document.head.appendChild(s); }));
async function lib() { await load(LIB.jspdf); await load(LIB.autotable); return window.jspdf.jsPDF; }
const imgCache = {};
function image(src) {
  return imgCache[src] || (imgCache[src] = new Promise(res => {
    const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext("2d").drawImage(im, 0, 0); res({ data: c.toDataURL("image/png"), w: im.naturalWidth, h: im.naturalHeight }); };
    im.onerror = () => res(null); im.src = src;
  }));
}

// Amount in words, UAE style: "UAE Dirhams One Thousand Two Hundred Fifty and Fils Fifty Only".
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function w3(n) { const h = Math.floor(n / 100), r = n % 100; return [h ? ONES[h] + " Hundred" : "", r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? " " + ONES[r % 10] : "")].filter(Boolean).join(" "); }
function words(amount) {
  const v = Math.round(Math.abs(Number(amount) || 0) * 100); let d = Math.floor(v / 100); const f = v % 100;
  if (!d && !f) return "UAE Dirhams Zero Only";
  const parts = []; [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"], [1, ""]].forEach(([u, n]) => { const q = Math.floor(d / u); if (q) { parts.push(w3(q) + (n ? " " + n : "")); d %= u; } });
  return `UAE Dirhams ${parts.join(" ") || "Zero"}${f ? " and Fils " + w3(f) : ""} Only`;
}

function palette() {
  const B = window.BK.brand();
  return B.key === "techhub" ? { p: [0, 60, 80], a: [40, 160, 140], soft: [232, 244, 242] } : { p: [30, 90, 140], a: [216, 31, 42], soft: [233, 240, 247] };
}
const money = n => window.BK.aed(n);
const fd = d => window.BK.fd(d);

async function base(title, number, dateLine) {
  const JsPDF = await lib();
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const C = palette(), D = window.BK.D, S = D.settings, B = window.BK.brand();
  const W = 210, M = 14;
  const logo = await image(B.logo || "/assets/bifold_logo.png");
  if (logo) { const h = 16, w = Math.min(62, logo.w / logo.h * h); doc.addImage(logo.data, "PNG", M, 12, w, w === 62 ? 62 * logo.h / logo.w : h); }
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...C.p); doc.text(title, W - M, 18, { align: "right" });
  doc.setFontSize(10); doc.setTextColor(40); doc.text(number || "", W - M, 24.5, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90); if (dateLine) doc.text(dateLine, W - M, 29.5, { align: "right" });
  doc.setDrawColor(...C.a); doc.setLineWidth(0.9); doc.line(M, 34, W - M, 34);
  return { doc, C, D, S, B, W, M, y: 40 };
}
function footer(ctx, note) {
  const { doc, S, W, M, C } = ctx; const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...C.p); doc.setLineWidth(0.3); doc.line(M, H - 16, W - M, H - 16);
    doc.setFontSize(7.5); doc.setTextColor(100); doc.setFont("helvetica", "normal");
    const l1 = [S.legalName, S.vatRegistered && S.trn ? "TRN " + S.trn : "", S.licenceNo ? "Licence " + S.licenceNo : ""].filter(Boolean).join("  ·  ");
    const l2 = [S.address, S.phone, S.email, S.website].filter(Boolean).join("  ·  ");
    doc.text(l1, M, H - 12); doc.text(doc.splitTextToSize(l2, W - 2 * M - 30)[0] || "", M, H - 8.5);
    doc.text(`Page ${i} of ${n}`, W - M, H - 12, { align: "right" });
    doc.setFontSize(7); doc.setTextColor(130); doc.text(doc.splitTextToSize([S.footer, note || "Computer-generated document."].filter(Boolean).join("  ·  "), W - 2 * M)[0], W / 2, H - 4.5, { align: "center" });
  }
}
function stampText(ctx, txt, col) {
  const { doc } = ctx; const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.saveGraphicsState && doc.saveGraphicsState(); if (doc.GState) doc.setGState(new doc.GState({ opacity: 0.12 })); doc.setFont("helvetica", "bold"); doc.setFontSize(90); doc.setTextColor(...col); doc.text(txt, 105, 170, { align: "center", angle: 30 }); if (doc.GState) doc.setGState(new doc.GState({ opacity: 1 })); doc.restoreGraphicsState && doc.restoreGraphicsState(); }
}
function parties(ctx, leftT, left, rightT, right) {
  const { doc, M, W } = ctx; let y = ctx.y; const colW = (W - 2 * M - 8) / 2;
  const block = (x, t, lines) => { let yy = y; doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(110); doc.text(t.toUpperCase(), x, yy); yy += 4.5;
    lines.forEach((l, i) => { if (!l) return; doc.setFont("helvetica", i === 0 || /^TRN/.test(l) ? "bold" : "normal"); doc.setFontSize(i === 0 ? 10.5 : 9); doc.setTextColor(25); doc.splitTextToSize(l, colW).forEach(s => { doc.text(s, x, yy); yy += i === 0 ? 4.8 : 4.1; }); }); return yy; };
  const a = block(M, leftT, left), b = right ? block(M + colW + 8, rightT, right) : y;
  ctx.y = Math.max(a, b) + 3;
}
function metaRow(ctx, items) {
  items = items.filter(x => x && x[1]); if (!items.length) return;
  const { doc, M, W, C } = ctx; const per = Math.min(4, items.length); const cw = (W - 2 * M) / per; const rows = Math.ceil(items.length / per);
  doc.setFillColor(...C.soft); doc.roundedRect(M, ctx.y, W - 2 * M, rows * 11 + 2, 1.5, 1.5, "F");
  items.forEach(([k, v], i) => { const x = M + 3 + (i % per) * cw, y = ctx.y + 5 + Math.floor(i / per) * 11; doc.setFontSize(6.8); doc.setFont("helvetica", "bold"); doc.setTextColor(110); doc.text(k.toUpperCase(), x, y); doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(20); doc.text(doc.splitTextToSize(String(v), cw - 5)[0], x, y + 4.5); });
  ctx.y += rows * 11 + 6;
}
function totals(ctx, rows) {
  const { doc, W, M, C } = ctx; let y = ctx.y + 2; const x1 = W - M - 80, x2 = W - M;
  if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 20; }
  rows.forEach(([k, v, strong]) => { if (strong) { doc.setFillColor(...C.p); doc.rect(x1 - 2, y - 4.2, 82, 6.6, "F"); doc.setTextColor(255); } else doc.setTextColor(30);
    doc.setFont("helvetica", strong ? "bold" : "normal"); doc.setFontSize(strong ? 10 : 9); doc.text(k, x1, y); doc.text(v, x2 - 1, y, { align: "right" }); y += strong ? 8 : 5.6; });
  ctx.y = y;
}
function para(ctx, title, text, size = 8.5) {
  if (!text) return; const { doc, M, W } = ctx; const lines = doc.splitTextToSize(String(text), W - 2 * M);
  if (ctx.y + 6 + lines.length * 3.8 > doc.internal.pageSize.getHeight() - 22) { doc.addPage(); ctx.y = 20; }
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(90); doc.text(title.toUpperCase(), M, ctx.y); ctx.y += 4;
  doc.setFont("helvetica", "normal"); doc.setFontSize(size); doc.setTextColor(35); doc.text(lines, M, ctx.y); ctx.y += lines.length * 3.8 + 3;
}
function signatures(ctx, labels) {
  const { doc, M, W } = ctx; let y = ctx.y + 12; if (y > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); y = 34; }
  const cw = (W - 2 * M) / labels.length;
  labels.forEach((l, i) => { const x = M + i * cw; doc.setDrawColor(150); doc.setLineWidth(0.2); doc.line(x, y, x + cw - 14, y); doc.setFontSize(8); doc.setTextColor(90); doc.text(l, x, y + 4); });
  ctx.y = y + 8;
}

/* ---------- tax invoice, tax credit note, quotation, purchase order, receipt ---------- */
async function docPdf(d) {
  const BK = window.BK, D = BK.D, S = D.settings, vat = S.vatRegistered;
  const T = d.type;
  const TITLE = { invoice: vat ? "TAX INVOICE" : "INVOICE", creditnote: vat ? "TAX CREDIT NOTE" : "CREDIT NOTE", quote: "QUOTATION", po: "PURCHASE ORDER", receipt: "PAYMENT RECEIPT" }[T] || T.toUpperCase();
  const ctx = await base(TITLE, d.number || "DRAFT", `Date: ${fd(d.date)}`);
  const { doc, M, W, C } = ctx;
  const us = [S.legalName, S.tradeName && S.tradeName !== S.legalName ? `Trading as ${S.tradeName}` : "", S.address, [S.phone, S.email].filter(Boolean).join("  ·  "), vat && S.trn ? `TRN ${S.trn}` : ""];
  const them = [d.contactName, d.attention ? "Attn: " + d.attention : "", d.contactAddress, d.contactEmail, d.contactTrn ? `TRN ${d.contactTrn}` : ""];
  if (T === "po") parties(ctx, "Supplier", them, "Buyer", us); else parties(ctx, "From", us, T === "receipt" ? "Received from" : T === "quote" ? "Prepared for" : "Bill to", them);
  const meta = [];
  if (T === "invoice") meta.push(["Invoice no.", d.number || "Draft"], ["Invoice date", fd(d.date)], ["Date of supply", fd(d.supplyDate || d.date)], ["Due date", fd(d.dueDate)], ["Customer PO", d.ref], ["Place of supply", vat ? d.placeOfSupply || d.emirate : ""], ["Salesperson", d.salesperson], ["Currency", "AED"]);
  if (T === "creditnote") meta.push(["Credit note no.", d.number || "Draft"], ["Date", fd(d.date)], ["Original invoice", d.invoiceNo], ["Invoice date", fd(d.invoiceDate)], ["Reason", d.reason], ["Currency", "AED"]);
  if (T === "quote") meta.push(["Quotation no.", d.number], ["Date", fd(d.date)], ["Valid until", fd(d.dueDate)], ["Your reference", d.ref], ["Subject", d.title], ["Prepared by", d.salesperson], ["Currency", "AED"]);
  if (T === "po") meta.push(["PO no.", d.number], ["Date", fd(d.date)], ["Delivery by", fd(d.dueDate)], ["Your quote", d.ref], ["Deliver to", d.deliverTo], ["Currency", "AED"]);
  if (T === "receipt") meta.push(["Receipt no.", d.number], ["Date", fd(d.date)], ["Method", d.method], ["Cheque no.", d.chequeNo], ["Cheque date", fd(d.chequeDate)], ["Reference", d.bankRef]);
  metaRow(ctx, meta);
  if (T === "receipt") {
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(30);
    doc.text(`Received with thanks the sum of AED ${money(d.amount)}`, M, ctx.y + 2); doc.setFontSize(9); doc.setTextColor(80); doc.text(doc.splitTextToSize(`(${words(d.amount)})`, W - 2 * M), M, ctx.y + 7); ctx.y += 14;
    if ((d.applied || []).length) doc.autoTable({ startY: ctx.y, margin: { left: M, right: M }, head: [["Invoice", "Invoice date", "Invoice total (AED)", "Paid now (AED)"]], body: d.applied.map(a => [a.number, fd(a.date), money(a.total), money(a.amt)]),
      headStyles: { fillColor: C.p, fontSize: 8.5 }, styles: { fontSize: 8.5 }, columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } } });
    ctx.y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : ctx.y) + 6;
    const left = d.amount - (d.applied || []).reduce((a, x) => a + x.amt, 0);
    if (left > 0.004) para(ctx, "Advance", `AED ${money(left)} is held as an advance on account.`);
    para(ctx, "Notes", d.notes);
    signatures(ctx, ["Received by", "Authorised signatory"]);
    footer(ctx, "This receipt is not a tax invoice."); if (d.status === "void") stampText(ctx, "VOID", [200, 30, 40]);
    return doc.output("blob");
  }
  const lines = d.lines || []; const disc = lines.some(l => l.discPct);
  const head = ["#", "Description", "Qty", "Unit price"]; if (disc) head.push("Disc."); head.push(vat ? "Taxable (AED)" : "Amount (AED)"); if (vat) head.push("VAT", "VAT (AED)", "Total (AED)");
  const body = lines.map((l, i) => { const r = [String(i + 1), l.name + (l.description ? "\n" + l.description : ""), `${l.qty}${l.unit ? " " + l.unit : ""}`, money(l.rate)]; if (disc) r.push(l.discPct ? l.discPct + "%" : ""); r.push(money(l.net));
    if (vat) { const self = ["RC", "IM", "DR"].includes(l.vat); r.push(l.vat === "SR" ? "5%" : l.vat === "ZR" ? "0%" : l.vat === "EX" ? "Exempt" : l.vat === "OS" ? "Out of scope" : self ? "Reverse charge" : l.vat, self ? "0.00" : money(l.vatAmt), money(l.net + (self ? 0 : l.vatAmt))); } return r; });
  const right = {}; for (let i = 2; i < head.length; i++) right[i] = { halign: "right" };
  doc.autoTable({ startY: ctx.y, margin: { left: M, right: M, bottom: 22 }, head: [head], body, theme: "grid",
    headStyles: { fillColor: C.p, textColor: 255, fontSize: 7.8, fontStyle: "bold", lineColor: C.p }, styles: { fontSize: 8.2, cellPadding: 1.8, lineColor: [220, 226, 232], lineWidth: 0.15, textColor: 30, valign: "top" },
    columnStyles: { 0: { cellWidth: 7 }, 1: { cellWidth: "auto" }, ...right },
  });
  ctx.y = doc.lastAutoTable.finalY + 6;
  const tot = [[vat ? "Total excluding VAT" : "Subtotal", money(d.subtotal)]];
  if (vat) tot.push([lines.some(l => l.vat === "DR") ? "VAT charged" : "VAT @ 5%", money(d.vatAmt)]);
  tot.push([vat ? "Total including VAT (AED)" : "Total (AED)", money(d.total), true]);
  if (T === "invoice" && d.status === "posted" && d.paid > 0.004) tot.push(["Paid / credited", money(d.paid)], ["Balance due (AED)", money(d.balance), true]);
  totals(ctx, tot);
  doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(70); doc.text(doc.splitTextToSize(words(d.total), W - 2 * M), W - M, ctx.y, { align: "right" }); ctx.y += 7;
  if (vat) {
    const byRate = {}; lines.forEach(l => { const k = l.vat; byRate[k] = byRate[k] || [0, 0]; byRate[k][0] += l.net; byRate[k][1] += l.vatAmt; });
    if (Object.keys(byRate).length > 1 || T === "creditnote") para(ctx, "VAT summary (AED)", Object.entries(byRate).map(([k, v]) => `${D.vat[k] ? D.vat[k].name : k}: taxable ${money(v[0])}, VAT ${money(v[1])}`).join("   ·   "));
    if (T === "creditnote" && d.invoiceNo) {
      if (ctx.y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); ctx.y = 20; }
      doc.autoTable({ startY: ctx.y, margin: { left: M, right: M }, head: [["Original tax invoice", "Value of supply on the invoice (AED)", "Corrected value (AED)", "Difference (AED)", "VAT on the difference (AED)"]],
        body: [[`${d.invoiceNo} of ${fd(d.invoiceDate)}${(d.earlierCredits || []).length ? "\nafter " + d.earlierCredits.join(", ") : ""}`, money(d.origValue), money(d.newValue), money(d.subtotal), money(d.vatAmt)]],
        headStyles: { fillColor: C.a, fontSize: 7.8 }, styles: { fontSize: 8.5 }, columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } } });
      ctx.y = doc.lastAutoTable.finalY + 5;
      para(ctx, "Reason", d.reason);
    }
    if (d.vatNote) { const due = lines.filter(l => l.vat === "DR").reduce((a, l) => a + l.vatAmt, 0); para(ctx, "Reverse charge", d.vatNote + (due && (T === "invoice" || T === "quote" || T === "creditnote") ? ` VAT the customer accounts for: AED ${money(due)}.` : "")); }
    if (lines.some(l => l.vat === "ZR")) para(ctx, "Zero-rated supply", "Zero-rated lines are supplied at 0% VAT under the UAE VAT law.");
  }
  if (T === "invoice" && (S.iban || S.bankName)) para(ctx, "Payment details", [S.bankAccountName || S.legalName, S.bankName, S.bankAccountNo ? "Account " + S.bankAccountNo : "", S.iban ? "IBAN " + S.iban : "", S.swift ? "SWIFT " + S.swift : ""].filter(Boolean).join("   ·   "));
  para(ctx, "Notes", d.notes);
  para(ctx, T === "quote" ? "Terms and conditions" : "Terms", d.terms, 8);
  signatures(ctx, T === "quote" ? ["For " + S.legalName, "Accepted by customer (name, signature, stamp)"] : T === "po" ? ["Authorised signatory", "Supplier acknowledgement"] : ["Authorised signatory", "Received by"]);
  footer(ctx, T === "invoice" || T === "creditnote" ? (vat ? "Computer-generated tax document. All amounts in UAE Dirhams." : "Computer-generated document.") : "");
  if (d.status === "void" || d.status === "cancelled") stampText(ctx, d.status === "void" ? "VOID" : "CANCELLED", [200, 30, 40]);
  else if (d.status === "draft" && (T === "invoice" || T === "creditnote")) stampText(ctx, "DRAFT", [120, 130, 140]);
  return doc.output("blob");
}

/* ---------- statement of account ---------- */
async function statement({ kind, contact, from, to, st, aging }) {
  const ctx = await base("STATEMENT OF ACCOUNT", contact.name, `${fd(from)} to ${fd(to)}`);
  const { doc, M, W, C, S } = ctx;
  parties(ctx, "From", [S.legalName, S.address, S.vatRegistered && S.trn ? "TRN " + S.trn : ""], kind === "customer" ? "Customer" : "Supplier", [contact.name, contact.address, contact.trn ? "TRN " + contact.trn : ""]);
  const lbl = { invoice: "Invoice", creditnote: "Credit note", receipt: "Payment received", bill: "Bill", vendorcredit: "Vendor credit", payment: "Payment" };
  doc.autoTable({ startY: ctx.y, margin: { left: M, right: M, bottom: 22 }, head: [["Date", "Transaction", "Reference", kind === "customer" ? "Invoiced" : "Billed", "Paid / credited", "Balance"]],
    body: [[fd(from), "Opening balance", "", "", "", money(st.opening)]].concat(st.lines.map(l => [fd(l.d.date), `${lbl[l.d.type]} ${l.d.number}`, l.d.ref || (l.d.dueDate && (l.d.type === "invoice" || l.d.type === "bill") ? "Due " + fd(l.d.dueDate) : ""), l.debit ? money(l.debit) : "", l.credit ? money(l.credit) : "", money(l.bal)])),
    foot: [["", "Balance due", "", "", "", money(st.closing)]], theme: "striped",
    headStyles: { fillColor: C.p, fontSize: 8.5 }, footStyles: { fillColor: C.soft, textColor: 20, fontStyle: "bold" }, styles: { fontSize: 8.5 }, columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } } });
  ctx.y = doc.lastAutoTable.finalY + 8;
  doc.autoTable({ startY: ctx.y, margin: { left: M, right: M }, head: [["Current", "1 to 30 days", "31 to 60 days", "61 to 90 days", "Over 90 days", "Total due"]], body: [aging.map(money).concat(money(aging.reduce((a, b) => a + b, 0)))],
    headStyles: { fillColor: C.a, fontSize: 8 }, styles: { fontSize: 9, halign: "right" } });
  ctx.y = doc.lastAutoTable.finalY + 6;
  if (kind === "customer" && (S.iban || S.bankName)) para(ctx, "Payment details", [S.bankAccountName || S.legalName, S.bankName, S.iban ? "IBAN " + S.iban : "", S.swift ? "SWIFT " + S.swift : ""].filter(Boolean).join("   ·   "));
  footer(ctx, "Please let us know within 14 days if anything on this statement doesn't match your records.");
  return doc.output("blob");
}

/* ---------- reports ---------- */
async function report({ title, period, head, rows, landscape, note }) {
  const JsPDF = await lib(); const doc = new JsPDF({ unit: "mm", format: "a4", orientation: landscape ? "landscape" : "portrait" });
  const C = palette(), S = window.BK.D.settings, W = doc.internal.pageSize.getWidth(), M = 12;
  const B = window.BK.brand(); const logo = await image(B.logo || "/assets/bifold_logo.png");
  if (logo) { const h = 11; doc.addImage(logo.data, "PNG", M, 9, Math.min(48, logo.w / logo.h * h), h); }
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...C.p); doc.text(title, W - M, 14, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(80); doc.text([S.legalName + (S.vatRegistered && S.trn ? "  ·  TRN " + S.trn : ""), period || ""], W - M, 19.5, { align: "right" });
  doc.setDrawColor(...C.a); doc.setLineWidth(0.7); doc.line(M, 27, W - M, 27);
  const right = {}; head.forEach((h, i) => { if (h.n) right[i] = { halign: "right" }; });
  doc.autoTable({ startY: 31, margin: { left: M, right: M, bottom: 18 }, head: [head.map(h => h.t || h)], body: rows.map(r => r.cells), theme: "plain",
    headStyles: { fillColor: C.p, textColor: 255, fontSize: 8 }, styles: { fontSize: 8.2, cellPadding: 1.5, lineColor: [225, 230, 236], lineWidth: { bottom: 0.15 } }, columnStyles: right,
    didParseCell: h => { if (h.section !== "body") return; const r = rows[h.row.index]; if (!r) return; if (r.kind === "grp") { h.cell.styles.fontStyle = "bold"; h.cell.styles.fillColor = C.soft; } if (r.kind === "sub") h.cell.styles.fontStyle = "bold"; if (r.kind === "tot") { h.cell.styles.fontStyle = "bold"; h.cell.styles.fillColor = [235, 238, 242]; } if (r.kind === "ind" && h.column.index === 0) h.cell.styles.cellPadding = { left: 6, top: 1.5, bottom: 1.5, right: 1.5 }; } });
  if (note) { const y = doc.lastAutoTable.finalY + 6; doc.setFontSize(8); doc.setTextColor(90); doc.text(doc.splitTextToSize(note, W - 2 * M), M, y); }
  const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); const H = doc.internal.pageSize.getHeight(); doc.setFontSize(7.5); doc.setTextColor(120); doc.text(`Generated ${new Date().toLocaleString("en-GB")}`, M, H - 8); doc.text(`Page ${i} of ${n}`, W - M, H - 8, { align: "right" }); }
  return doc.output("blob");
}

window.BKPDF = { doc: docPdf, statement, report, words };
})();
