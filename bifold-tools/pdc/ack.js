/* ===== Security deposit acknowledgement letter: Word (docx) and PDF (jsPDF) in the Bifold and Tech Hub house styles =====
   PDCACK.docx(docxLib, cfg, img) -> docx Document      PDCACK.pdf(jsPDF, cfg, img) -> jsPDF document
   cfg: { brand: "bifold"|"techhub", letterNo, date, customer, address, contact, contactTitle, project, reference,
          advanceAmount, chequeNo, bank, chequeDate, amount, returnWhen, signatory, signatoryTitle }
   img: { logo: { bytes, w, h, dataUrl, type } } (optional)
   The wording of the conditions lives in CONDITIONS below; change it there and both formats follow. */
const PDCACK = (function () {
  const BRANDS = {
    bifold: { primary: "1E5A8C", accent: "D81F2A", label: "EEF3F8",
      company: "Bifold Technologies LLC",
      addressLine: "Office A306, Saraya Avenue, Al Garhoud, Dubai, UAE  |  PO Box 554567",
      contactLine: "Tel: +971 04 264 0374  |  bifoldtech.com  |  info@bifoldtech.com" },
    techhub: { primary: "003C50", accent: "28A08C", label: "EAF4F3",
      company: "Tech Hub Information Technology",
      addressLine: "Blue Building, Injaz Road, Al Nakheel, Ras Al Khaimah, UAE",
      contactLine: "sales@techhubrak.ae  |  +971 07 258 1926  |  www.techhubrak.ae" },
  };
  const DEFAULT_RETURN = "on completion of the project, or once the advance payment has been fully adjusted against our invoices, whichever is earlier";
  const DARK = "222222", MUTE = "6B7280", BORDER = "C9D1DB";
  let C = BRANDS.bifold;
  const use = k => { C = BRANDS[k] || BRANDS.bifold; return C; };
  // House rule: no em or en dashes in any document.
  const s = v => (v == null ? "" : String(v)).replace(/\s*[—–]\s*/g, ", ");
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function fmtDate(iso) { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); if (!y || !m) return s(iso); return d + " " + MONTHS[m - 1] + " " + y; }
  const money = n => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fitBox = (p, maxW, maxH) => { let w = maxW, h = Math.round(maxW * p.h / p.w); if (h > maxH) { h = maxH; w = Math.round(maxH * p.w / p.h); } return { width: w, height: h }; };

  /* ---------- amount in words (UAE Dirhams) ---------- */
  const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function below1000(n) {
    let out = ""; if (n >= 100) { out += ONES[Math.floor(n / 100)] + " Hundred"; n %= 100; if (n) out += " "; }
    if (n >= 20) { out += TENS[Math.floor(n / 10)]; if (n % 10) out += " " + ONES[n % 10]; } else if (n) out += ONES[n];
    return out;
  }
  function intWords(n) {
    if (n === 0) return "Zero";
    const parts = [];
    for (const [v, name] of [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"]]) if (n >= v) { parts.push(below1000(Math.floor(n / v)) + " " + name); n %= v; }
    if (n) parts.push(below1000(n));
    return parts.join(" ");
  }
  function aedWords(amount) {
    const cents = Math.round((Number(amount) || 0) * 100), d = Math.floor(cents / 100), f = cents % 100;
    return "UAE Dirhams " + intWords(d) + (f ? " and " + intWords(f) + " Fils" : "") + " Only";
  }

  /* ---------- the wording, shared by Word and PDF ---------- */
  // Each paragraph is a list of runs: [text, bold?]. One list feeds both formats so they always say the same thing.
  function content(cfg) {
    const co = C.company, adv = money(cfg.advanceAmount);
    return {
      subject: `Acknowledgement of Receipt of Security Cheque against Advance Payment${cfg.project ? ", " + cfg.project : ""}`,
      intro: [["With reference to the advance payment of "], ["AED " + adv, true], [" received from you"],
        ...(cfg.project ? [[" for the project "], [cfg.project, true]] : []), [cfg.reference ? ` (PO / reference ${cfg.reference})` : ""],
        [`, ${co} hereby hands over the following cheque to you as a security against the said advance payment:`]],
      details: [
        ["Cheque number", cfg.chequeNo || "-"],
        ["Drawn on bank", cfg.bank || "-"],
        ["Cheque date", cfg.chequeDate ? fmtDate(cfg.chequeDate) : "Undated"],
        ["Amount", `AED ${money(cfg.amount)}\n(${aedWords(cfg.amount)})`],
        ["Payable to", cfg.customer],
        ["Against", `Advance payment of AED ${adv}${cfg.reference ? ", PO / reference " + cfg.reference : ""}${cfg.project ? "\nProject: " + cfg.project : ""}`],
      ],
      lead: "This cheque is handed over on the following conditions:",
      conditions: [
        [["The cheque is issued "], ["solely as a security", true], [` against the advance payment mentioned above. It is not a payment and does not represent any amount due from ${co}.`]],
        [[`The cheque shall not be deposited, presented for payment or encashed without first consulting ${co} and obtaining its written consent.`, true]],
        [[`If you have any concern about the project or the advance payment, you agree to notify ${co} in writing and give it a reasonable opportunity to resolve the matter before taking any action on this cheque.`]],
        [["The cheque shall not be endorsed, transferred or handed to any third party."]],
        [[`The cheque shall be returned to ${co} ${cfg.returnWhen || DEFAULT_RETURN}.`]],
        [[`You agree to keep the cheque in safe custody and to inform ${co} in writing immediately if it is lost or damaged.`]],
      ],
      closing: "Kindly sign and stamp below to acknowledge receipt of the above cheque and your acceptance of these conditions, and return a signed copy to us for our records.",
      accept: `We acknowledge receipt of cheque no. ${cfg.chequeNo || "-"} for AED ${money(cfg.amount)} and agree to the conditions above, including not to deposit it without consulting ${co}.`,
    };
  }
  const addressLines = cfg => s(cfg.address).split(/\s*\n\s*/).filter(Boolean);

  /* =================================== WORD =================================== */
  function docx(D, cfg, img) {
    use(cfg.brand);
    const { Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, Header, Footer, AlignmentType, TabStopType, BorderStyle, WidthType, ShadingType, VerticalAlign, TableLayoutType, LevelFormat } = D;
    const CW = 9746, X = content(cfg);
    const T = (text, o = {}) => new TextRun({ text: s(text), font: "Arial", color: DARK, size: 19, ...o });
    const runs = list => list.filter(r => r[0]).map(([t, b]) => T(t, { bold: !!b }));
    const P = (children, o = {}) => new Paragraph({ spacing: { after: 100, line: 252 }, ...o, children: Array.isArray(children) ? children : [T(children)] });
    const bl = { style: BorderStyle.SINGLE, size: 4, color: BORDER };
    const borders = { top: bl, bottom: bl, left: bl, right: bl };
    const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
    const cellP = (text, o = {}) => s(text).split("\n").map((l, i) => new Paragraph({ children: [new TextRun({ text: l, font: "Arial", bold: !!o.bold && i === 0, size: i ? 16 : 18, color: o.color || DARK, italics: i > 0 })] }));
    const cell = (text, w, o = {}) => new TableCell({ borders, width: { size: w, type: WidthType.DXA }, shading: o.fill ? { fill: o.fill, type: ShadingType.CLEAR, color: "auto" } : undefined,
      margins: { top: 36, bottom: 36, left: 110, right: 110 }, verticalAlign: VerticalAlign.CENTER, children: cellP(text, o) });
    const kw = [3000, CW - 3000];
    const details = new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: kw, layout: TableLayoutType.FIXED,
      rows: X.details.map(([k, v]) => new TableRow({ cantSplit: true, children: [cell(k, kw[0], { fill: C.label, bold: true, color: C.primary }), cell(v, kw[1], { bold: k === "Amount" })] })) });
    const imgRun = (im, size) => new ImageRun({ data: im.bytes, type: im.type || "png", transformation: size });

    const B = [];
    B.push(new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: CW }], spacing: { before: 0, after: 160 },
      children: [T("Ref: ", { bold: true }), T(cfg.letterNo), new TextRun({ text: "\t" }), T("Date: ", { bold: true }), T(fmtDate(cfg.date))] }));
    B.push(new Paragraph({ spacing: { after: 0 }, children: [T("To,")] }));
    B.push(new Paragraph({ spacing: { after: 0 }, children: [T(cfg.customer, { bold: true })] }));
    addressLines(cfg).forEach(l => B.push(new Paragraph({ spacing: { after: 0 }, children: [T(l)] })));
    if (cfg.contact) B.push(new Paragraph({ spacing: { before: 60, after: 0 }, children: [T("Attn: ", { bold: true }), T([cfg.contact, cfg.contactTitle].filter(Boolean).join(", "))] }));
    B.push(new Paragraph({ spacing: { before: 160, after: 120 }, children: [T("Subject: ", { bold: true, color: C.primary }), T(X.subject, { bold: true, color: C.primary })] }));
    B.push(P("Dear Sir / Madam,"));
    B.push(P(runs(X.intro)));
    B.push(details);
    B.push(P([T(X.lead, { bold: true })], { spacing: { before: 160, after: 60 }, keepNext: true }));
    X.conditions.forEach(c => B.push(new Paragraph({ numbering: { reference: "cond", level: 0 }, spacing: { after: 40, line: 240 }, children: runs(c) })));
    B.push(P(X.closing, { spacing: { before: 100, after: 140 } }));

    // Signature blocks: ours on the left, the customer's box on the right.
    const sw = [Math.floor(CW * 0.46), CW - Math.floor(CW * 0.46)];
    const line = (label, w) => new Table({ width: { size: w - 440, type: WidthType.DXA }, columnWidths: [1500, w - 1940], layout: TableLayoutType.FIXED, borders: noBorders, rows: [new TableRow({ children: [
      new TableCell({ borders: noBorders, width: { size: 1500, type: WidthType.DXA }, margins: { top: 120, bottom: 0, left: 0, right: 80 }, children: [new Paragraph({ children: [T(label, { size: 17 })] })] }),
      new TableCell({ borders: { ...noBorders, bottom: { style: BorderStyle.SINGLE, size: 4, color: "555555" } }, width: { size: w - 1940, type: WidthType.DXA }, children: [new Paragraph({ children: [T(" ", { size: 17 })] })] }),
    ] })] });
    const ours = [
      new Paragraph({ spacing: { after: 480 }, children: [T("For " + C.company, { bold: true, color: C.primary })] }),
      new Paragraph({ spacing: { after: 40 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: C.primary, space: 4 } }, children: [T("Authorised signature & company stamp", { size: 16, color: MUTE })] }),
      new Paragraph({ spacing: { after: 20 }, children: [T("Name: ", { bold: true }), T(cfg.signatory || "")] }),
      new Paragraph({ children: [T("Designation: ", { bold: true }), T(cfg.signatoryTitle || "")] }),
    ];
    const theirs = [
      new Paragraph({ spacing: { after: 40 }, children: [T("Received and accepted by " + cfg.customer, { bold: true, color: C.primary })] }),
      new Paragraph({ spacing: { after: 40 }, children: [T(X.accept, { size: 16, color: MUTE })] }),
      line("Name", sw[1]), line("Designation", sw[1]), line("Signature", sw[1]), line("Date", sw[1]),
      new Paragraph({ spacing: { before: 140, after: 360 }, children: [T("Company stamp", { size: 17 })] }),
    ];
    const box = { style: BorderStyle.SINGLE, size: 8, color: C.primary };
    B.push(new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: sw, layout: TableLayoutType.FIXED, borders: noBorders, rows: [new TableRow({ cantSplit: true, children: [
      new TableCell({ borders: noBorders, width: { size: sw[0], type: WidthType.DXA }, margins: { top: 120, bottom: 80, left: 0, right: 360 }, children: ours }),
      new TableCell({ borders: { top: box, bottom: box, left: box, right: box }, width: { size: sw[1], type: WidthType.DXA }, margins: { top: 140, bottom: 80, left: 220, right: 220 }, children: theirs }),
    ] })] }));

    const header = new Header({ children: [
      new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: CW }], spacing: { after: 40 }, children: (img && img.logo ? [imgRun(img.logo, fitBox(img.logo, 130, 54))] : [T(C.company, { bold: true, size: 26, color: C.primary })])
        .concat([new TextRun({ text: "\t" }), T(C.company, { bold: true, size: 18, color: C.primary })]) }),
      new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: [T(C.addressLine, { size: 14, color: MUTE })] }),
      new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 60 }, border: { bottom: { style: BorderStyle.SINGLE, size: 14, color: C.accent, space: 6 } }, children: [T(C.contactLine, { size: 14, color: MUTE })] }),
    ] });
    const footer = new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: CW }], border: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 6 } }, children: [
      T(C.company, { size: 14, color: "888888" }), new TextRun({ text: "\t" }), T(cfg.letterNo, { size: 14, color: "888888" })] })] });
    return new D.Document({
      creator: C.company, title: `Security cheque acknowledgement ${cfg.letterNo}`, description: `Security cheque acknowledgement for ${cfg.customer}`,
      numbering: { config: [{ reference: "cond", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { run: { bold: true, color: C.primary }, paragraph: { indent: { left: 400, hanging: 340 } } } }] }] },
      styles: { default: { document: { run: { font: "Arial", size: 19, color: DARK } } } },
      sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1760, right: 1080, bottom: 760, left: 1080, header: 420, footer: 360 } } }, headers: { default: header }, footers: { default: footer }, children: B }],
    });
  }

  /* =================================== PDF =================================== */
  const rgb = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  // The built-in PDF fonts cover Latin-1 only, so typographic characters are mapped and anything else dropped.
  const L1 = v => s(v).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
  function pdf(jsPDF, cfg, img) {
    use(cfg.brand);
    const X = content(cfg);
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = 595.28, H = 841.89, M = 54, CWp = W - 2 * M, TOP = 100, BOT = H - 48;
    let y = TOP;
    const pages = [1];
    const need = h => { if (y + h > BOT) { doc.addPage(); y = TOP; } };
    const font = (st = "normal", size = 9.3, color = DARK) => { doc.setFont("helvetica", st); doc.setFontSize(size); doc.setTextColor(...rgb(color)); };
    // Wrapped text made of runs of normal and bold words.
    function rich(list, o = {}) {
      const size = o.size || 9.3, lh = size * 1.32, x0 = M + (o.indent || 0), width = CWp - (o.indent || 0);
      const words = [];
      list.forEach(([t, b]) => L1(t).split(/(\s+)/).forEach(w => { if (w) words.push({ w, b: !!b || !!o.bold }); }));
      let line = [], lw = 0;
      const flush = () => {
        while (line.length && /^\s+$/.test(line[line.length - 1].w)) line.pop();
        need(lh); let x = x0;
        // Same-style words are drawn as one string so spacing and kerning come out right.
        const segs = []; line.forEach(p => { const l = segs[segs.length - 1]; if (l && (l.b === p.b || /^\s+$/.test(p.w))) l.w += p.w; else segs.push({ w: p.w, b: p.b }); });
        // Leading and trailing spaces are measured by hand: the PDF library drops them when measuring a string.
        segs.forEach(p => {
          font(p.b ? "bold" : "normal", size, o.color || DARK);
          const sp = doc.getTextWidth("a a") - doc.getTextWidth("aa");
          const lead = p.w.length - p.w.trimStart().length, body = p.w.trim(), trail = p.w.length - p.w.trimEnd().length;
          x += lead * sp; if (body) { doc.text(body, x, y + size); x += doc.getTextWidth(body); } x += trail * sp;
        });
        y += lh; line = []; lw = 0;
      };
      words.forEach(p => {
        font(p.b ? "bold" : "normal", size); const ww = doc.getTextWidth(p.w);
        if (/^\s+$/.test(p.w)) { if (line.length) { line.push(p); lw += ww; } return; }
        if (lw + ww > width && line.length) flush();
        line.push(p); lw += ww;
      });
      if (line.length) flush();
      y += o.after == null ? 5 : o.after;
    }
    const text = (t, o) => rich([[t, o && o.bold]], o);

    // reference and date
    font("bold", 9.3); doc.text("Ref:", M, y + 10); const rw = doc.getTextWidth("Ref: ");
    font("normal", 9.3); doc.text(L1(cfg.letterNo), M + rw, y + 10);
    const dt = fmtDate(cfg.date); const dw = doc.getTextWidth(dt); doc.text(dt, W - M, y + 10, { align: "right" });
    font("bold", 9.3); doc.text("Date: ", W - M - dw - doc.getTextWidth("Date: "), y + 10);
    y += 22;
    text("To,", { after: 0 });
    text(cfg.customer, { bold: true, after: 0 });
    addressLines(cfg).forEach(l => text(l, { after: 0 }));
    if (cfg.contact) { y += 3; rich([["Attn: ", true], [[cfg.contact, cfg.contactTitle].filter(Boolean).join(", ")]], { after: 0 }); }
    y += 8;
    rich([["Subject: " + X.subject, true]], { color: C.primary, after: 6 });
    text("Dear Sir / Madam,");
    rich(X.intro, { after: 6 });

    doc.autoTable({ startY: y, margin: { left: M, right: M, top: TOP, bottom: H - BOT }, body: X.details.map(([k, v]) => [L1(k), L1(v)]), theme: "grid",
      styles: { font: "helvetica", fontSize: 8.9, cellPadding: { top: 3, bottom: 3, left: 5, right: 5 }, lineColor: rgb(BORDER), lineWidth: 0.5, textColor: rgb(DARK), valign: "middle", overflow: "linebreak" },
      columnStyles: { 0: { fontStyle: "bold", fillColor: rgb(C.label), textColor: rgb(C.primary), cellWidth: 150 } },
      didParseCell: d => { if (d.section === "body" && d.column.index === 1 && d.row.index === 3) d.cell.styles.fontStyle = "bold"; } });
    y = doc.lastAutoTable.finalY + 10;

    need(40); text(X.lead, { bold: true, after: 3 });
    X.conditions.forEach((c, i) => {
      need(14); font("bold", 9.3, C.primary); doc.text((i + 1) + ".", M + 4, y + 9.3);
      rich(c, { indent: 20, after: 1.5 });
    });
    y += 4;
    text(X.closing, { after: 12 });

    // signature blocks
    const blockH = 158; need(blockH);
    const lw = CWp * 0.44, rx = M + CWp * 0.5, rw2 = CWp * 0.5;
    let yy = y;
    font("bold", 9.3, C.primary); doc.text(L1("For " + C.company), M, yy + 10);
    yy += 58; doc.setDrawColor(...rgb(C.primary)); doc.setLineWidth(0.8); doc.line(M, yy, M + lw * 0.9, yy);
    font("normal", 7.5, MUTE); doc.text("Authorised signature & company stamp", M, yy + 10);
    yy += 24; font("bold", 9); doc.text("Name:", M, yy); font("normal", 9); doc.text(L1(cfg.signatory || ""), M + 34, yy);
    yy += 13; font("bold", 9); doc.text("Designation:", M, yy); font("normal", 9); doc.text(L1(cfg.signatoryTitle || ""), M + 60, yy);

    let ty = y + 9; const ix = rx + 10, iw = rw2 - 20;
    font("bold", 9.4, C.primary); doc.splitTextToSize(L1("Received and accepted by " + cfg.customer), iw).slice(0, 2).forEach(l => { doc.text(l, ix, ty); ty += 12; });
    font("normal", 7.2, MUTE); doc.splitTextToSize(L1(X.accept), iw).forEach(l => { doc.text(l, ix, ty); ty += 8.8; });
    ty += 2;
    ["Name", "Designation", "Signature", "Date"].forEach(k => { ty += 13.5; font("normal", 8.6); doc.text(k, ix, ty); doc.setDrawColor(85, 85, 85); doc.setLineWidth(0.5); doc.line(ix + 62, ty + 1, ix + iw, ty + 1); });
    ty += 16; font("normal", 8.6); doc.text("Company stamp", ix, ty);
    ty += 26; // room for the stamp
    doc.setDrawColor(...rgb(C.primary)); doc.setLineWidth(1); doc.rect(rx, y - 4, rw2, ty - y + 4, "S");
    y = Math.max(yy, ty) + 8;

    // letterhead and footer on every page
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      if (img && img.logo) { const d = fitBox(img.logo, 116, 46); doc.addImage(img.logo.dataUrl, img.logo.fmt || "PNG", M, 28, d.width, d.height, "logo", "FAST"); }
      else { font("bold", 14, C.primary); doc.text(L1(C.company), M, 54); }
      font("bold", 9, C.primary); doc.text(L1(C.company), W - M, 42, { align: "right" });
      font("normal", 7, MUTE); doc.text(L1(C.addressLine), W - M, 54, { align: "right" }); doc.text(L1(C.contactLine), W - M, 64, { align: "right" });
      doc.setFillColor(...rgb(C.accent)); doc.rect(M, 80, CWp, 2.2, "F");
      doc.setDrawColor(...rgb(BORDER)); doc.setLineWidth(0.5); doc.line(M, H - 36, W - M, H - 36);
      font("normal", 7, "888888"); doc.text(L1(C.company), M, H - 25); doc.text(L1(cfg.letterNo) + (n > 1 ? `   |   Page ${i} of ${n}` : ""), W - M, H - 25, { align: "right" });
    }
    doc.setProperties({ title: `Security cheque acknowledgement ${cfg.letterNo}`, subject: `Security cheque acknowledgement for ${cfg.customer}`, author: C.company, creator: C.company });
    return doc;
  }

  return { docx, pdf, aedWords, fmtDate, content, BRANDS, DEFAULT_RETURN };
})();
if (typeof module !== "undefined") module.exports = PDCACK;
