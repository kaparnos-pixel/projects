/* ===== Project Completion Report / Work Completion Certificate: Word (docx) and PDF (jsPDF) in the Bifold and Tech Hub house styles ===== */
const PCRGEN = (function () {
  const BRANDS = {
    bifold: { primary: "1E5A8C", accent: "D81F2A", label: "F2F3F5", band: "EAECEF", soft: "E8F0F7", cover: "C9DBEA",
      company: "Bifold Technologies LLC", tagline: "Enterprise ICT Solutions & Managed Services",
      addressLine: "Office A306, Saraya Avenue, Al Garhoud, Dubai, UAE  |  PO Box 554567",
      contactLine: "Tel: +971 04 264 0374  |  bifoldtech.com  |  info@bifoldtech.com" },
    techhub: { primary: "003C50", accent: "28A08C", label: "EEF4F5", band: "E3EEF0", soft: "E6F4F2", cover: "BFE3DC",
      company: "Tech Hub Information Technology", tagline: "Information Technology  |  Ras Al Khaimah",
      addressLine: "Blue Building, Injaz Road, Al Nakheel, Ras Al Khaimah, UAE",
      contactLine: "sales@techhubrak.ae  |  +971 07 258 1926  |  www.techhubrak.ae" },
  };
  const DARK = "222222", MUTE = "777777", BORDER = "CCCCCC", PASS = "1F7A4D";
  let C = BRANDS.bifold;
  const use = k => { C = BRANDS[k] || BRANDS.bifold; return C; };
  // House rule: no em or en dashes in any document.
  const s = v => (v == null ? "" : String(v)).replace(/\s*[—–]\s*/g, ", ");
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function fmtDate(iso) { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); if (!y || !m) return s(iso); return String(d).padStart(2, "0") + " " + MONTHS[m - 1] + " " + y; }
  const fitBox = (p, maxW, maxH) => { let w = maxW, h = Math.round(maxW * p.h / p.w); if (h > maxH) { h = maxH; w = Math.round(maxH * p.w / p.h); } return { width: w, height: h }; };
  const resultColor = r => r === "Pass" ? PASS : r === "Fail" || r === "Open" ? C.accent : DARK;

  /* ---------- the parts every document shares, worked out once ---------- */
  const certReg = cfg => cfg.include.serials && cfg.serials.length ? "serials" : cfg.include.boq && cfg.boq.length ? "boq" : "";
  function plan(cfg) {
    const inc = cfg.include || {};
    const report = cfg.mode !== "certificate";
    const parts = [];
    const add = (key, title, ok) => { if (ok) parts.push({ key, title }); };
    if (report) {
      add("letter", "Completion Certificate", true);
      add("summary", "Project Summary", true);
      add("scope", "Scope Delivered", (cfg.scope.streams || []).length > 0 || !!cfg.scope.intro);
      add("boq", "Customer Bill of Quantities", inc.boq && cfg.boq.length > 0);
      add("serials", "Equipment Register & Serial Numbers", inc.serials && cfg.serials.length > 0);
      add("diagram", "System Diagram", inc.diagram && !!cfg.diagramImg);
      add("testing", "Testing & Commissioning", inc.testing && cfg.testing.length > 0);
      add("photos", "Site Photographs", inc.photos && cfg.photos.length > 0);
      add("handover", "Handover Deliverables", cfg.handover.length > 0);
      add("warranty", "Warranty & Support", inc.warranty);
      add("snags", "Snag List", inc.snags);
      add("signoff", "Acceptance & Sign-off", inc.signoff);
    } else {
      // The certificate is a letter: the main register and the warranty line sit inside it.
      const reg = certReg(cfg);
      add("letter", "", true);
      add("boq", "Bill of Quantities", reg !== "boq" && inc.boq && cfg.boq.length > 0);
      add("serials", "Equipment Installed", reg !== "serials" && inc.serials && cfg.serials.length > 0);
      add("diagram", "System Diagram", inc.diagram && !!cfg.diagramImg);
      add("testing", "Testing & Commissioning", inc.testing && cfg.testing.length > 0);
      add("photos", "Site Photographs", inc.photos && cfg.photos.length > 0);
      add("snags", "Snag List", inc.snags);
      add("signoff", "Acceptance", inc.signoff);
    }
    let n = 0; parts.forEach(p => { p.num = p.title && report ? String(++n) : ""; });
    return parts;
  }
  function summaryRows(cfg) {
    return [
      ["Client", cfg.customer.name], cfg.customer.trn ? ["Client TRN", cfg.customer.trn] : null, ["Project", cfg.projectTitle || "-"],
      ["Customer PO Reference", [cfg.poRef || "-", cfg.poDate ? "dated " + fmtDate(cfg.poDate) : ""].filter(Boolean).join(", ")],
      ["Site / Location", cfg.site || "-"], cfg.startDate ? ["Commencement Date", fmtDate(cfg.startDate)] : null, ["Completion Date", fmtDate(cfg.completionDate) || "-"],
      ["Prepared By", [cfg.preparedBy, cfg.preparedTitle].filter(Boolean).join(", ") || "-"], cfg.customer.attention ? ["Client Representative", cfg.customer.attention] : null,
      ["Current Status", cfg.statusLine],
    ].filter(Boolean);
  }
  function warrantyRows(cfg) {
    const w = cfg.warranty; const rows = [];
    if (w.hwMonths) rows.push(["Hardware Warranty", `${w.hwMonths} months from ${fmtDate(w.start)}${w.hwUntil ? ", until " + fmtDate(w.hwUntil) : ""}, per manufacturer warranty`]);
    if (w.wkMonths) rows.push(["Workmanship Warranty", `${w.wkMonths} months from ${fmtDate(w.start)}${w.wkUntil ? ", until " + fmtDate(w.wkUntil) : ""}`]);
    if (w.hours) rows.push(["Support Hours", w.hours]);
    rows.push(["Support Contact", cfg.supportLine]);
    return rows;
  }
  const serialRows = cfg => cfg.serials.map((r, i) => [String(i + 1), r.type || "-", r.model || "-", r.serial || "-", r.location || "-"]);
  const boqRows = cfg => cfg.boq.map((r, i) => [r.item || String(i + 1), r.desc || "-", r.model || "-", r.qty || "-", r.unit || "-", r.remarks || ""]);
  const testRows = cfg => cfg.testing.map((r, i) => [String(i + 1), r.test || "-", r.method || "-", r.result || "-", r.remarks || ""]);
  const signText = cfg => cfg.mode === "certificate"
    ? `By signing below, ${cfg.customer.name} confirms that the works described in this certificate have been completed and accepted.`
    : `By signing below, both parties confirm that the works described in this report have been completed, tested and handed over, and that ${cfg.customer.name} accepts the works${cfg.poRef ? " under customer PO " + cfg.poRef : ""}${cfg.include.snags && cfg.snags.length ? ", subject to the open items in the snag list" : ""}.`;
  function customerSignLine(sg) {
    if (!sg) return "";
    const when = new Date(sg.at).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    return `Signed electronically ${sg.method === "link" ? "using a secure signing link" : "on site"} on ${when} (UAE time)`;
  }

  /* =================================== WORD =================================== */
  function docx(D, cfg, img) {
    use(cfg.brand);
    const { Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, Header, Footer, AlignmentType, TabStopType, BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber, TableLayoutType, PageBreak } = D;
    const CW = 9746;
    const T = (text, o = {}) => new TextRun({ text: s(text), font: "Arial", color: DARK, size: 20, ...o });
    const P = (children, o = {}) => new Paragraph({ spacing: { after: 120, line: 276 }, ...o, children: Array.isArray(children) ? children : [T(children)] });
    const bl = { style: BorderStyle.SINGLE, size: 4, color: BORDER };
    const borders = { top: bl, bottom: bl, left: bl, right: bl };
    const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
    const scale = (ws, total = CW) => { const sum = ws.reduce((a, b) => a + b, 0); const out = ws.map(w => Math.floor(w * total / sum)); out[out.length - 1] += total - out.reduce((a, b) => a + b, 0); return out; };
    const cell = (text, w, o = {}) => new TableCell({ borders, width: { size: w, type: WidthType.DXA }, shading: o.fill ? { fill: o.fill, type: ShadingType.CLEAR, color: "auto" } : undefined,
      margins: { top: 60, bottom: 60, left: 110, right: 110 }, verticalAlign: VerticalAlign.CENTER, columnSpan: o.span,
      children: s(text).split("\n").map(l => new Paragraph({ alignment: o.align || AlignmentType.LEFT, children: [new TextRun({ text: l, font: o.mono ? "Consolas" : "Arial", bold: !!o.bold, size: o.size || 19, color: o.color || DARK })] })) });
    const hcell = (text, w) => cell(text, w, { fill: C.primary, bold: true, color: "FFFFFF" });
    function grid(headers, widths, rows, o = {}) {
      const ws = scale(widths); const compact = rows.length > 10;
      return new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: ws, layout: TableLayoutType.FIXED, rows: [
        new TableRow({ tableHeader: true, children: headers.map((h, j) => hcell(h, ws[j])) }),
        ...rows.map(r => new TableRow({ cantSplit: true, children: r.map((c, j) => cell(c, ws[j], { size: compact ? 17 : 19, mono: (o.mono || []).includes(j), bold: (o.bold || []).includes(j),
          align: (o.center || []).includes(j) ? AlignmentType.CENTER : AlignmentType.LEFT, color: o.colorOf ? o.colorOf(j, c) : undefined })) })),
      ] });
    }
    function kv(rows) {
      const ws = scale([3000, 6746]);
      return new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: ws, layout: TableLayoutType.FIXED,
        rows: rows.map(r => new TableRow({ cantSplit: true, children: [cell(r[0], ws[0], { fill: C.label, bold: true, color: C.primary }), cell(r[1], ws[1])] })) });
    }
    const h1 = (num, text) => new Paragraph({ spacing: { before: 300, after: 140 }, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: C.accent, space: 4 } },
      children: (num ? [new TextRun({ text: num + ".  ", font: "Arial", bold: true, size: 26, color: C.accent })] : []).concat([new TextRun({ text: s(text).toUpperCase(), font: "Arial", bold: true, size: 26, color: C.primary })]) });
    const h2 = text => new Paragraph({ spacing: { before: 180, after: 80 }, keepNext: true, children: [new TextRun({ text: s(text), font: "Arial", bold: true, size: 21, color: C.primary })] });
    const bullet = text => new Paragraph({ numbering: { reference: "b", level: 0 }, spacing: { after: 60, line: 264 }, children: [T(text)] });
    const rule = (size = 18, color = C.accent) => new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size, color, space: 1 } }, children: [new TextRun({ text: "", size: 2 })] });
    const gap = (after = 120) => new Paragraph({ spacing: { after }, children: [new TextRun({ text: "", size: 2 })] });
    const block = (fill, children, pad = 260) => new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [CW], layout: TableLayoutType.FIXED, borders: noBorders,
      rows: [new TableRow({ children: [new TableCell({ borders: noBorders, width: { size: CW, type: WidthType.DXA }, shading: { fill, type: ShadingType.CLEAR, color: "auto" }, margins: { top: pad, bottom: pad, left: 360, right: 360 }, children })] })] });
    const imgRun = (im, size) => new ImageRun({ data: im.bytes, type: im.type || "png", transformation: size });

    const parts = plan(cfg);
    const B = [];
    const title = cfg.mode === "certificate" ? "Work Completion Certificate" : "Project Completion Report";

    // ---- cover (report) / title block (certificate)
    if (cfg.mode !== "certificate") {
      if (img.logo) B.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400, after: 500 }, children: [imgRun(img.logo, fitBox(img.logo, 230, 110))] }));
      B.push(block(C.primary, [
        new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: s(C.tagline), italics: true, font: "Arial", size: 20, color: C.cover })] }),
        new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: title.toUpperCase(), bold: true, font: "Arial", size: 40, color: "FFFFFF" })] }),
        new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: s(cfg.docNo), font: "Consolas", size: 22, color: C.cover })] }),
        new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "FOR CLIENT", font: "Arial", size: 17, color: C.cover, characterSpacing: 40 })] }),
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: s(cfg.customer.name), bold: true, font: "Arial", size: 30, color: "FFFFFF" })] }),
        new Paragraph({ children: [new TextRun({ text: s(cfg.projectTitle), font: "Arial", size: 22, color: "FFFFFF" })] }),
      ], 380));
      B.push(rule(30)); B.push(gap(240));
      B.push(kv([["Document No.", cfg.docNo], ["Customer PO Reference", cfg.poRef || "-"], ["Site / Location", cfg.site || "-"], ["Completion Date", fmtDate(cfg.completionDate) || "-"], ["Prepared By", [cfg.preparedBy, cfg.preparedTitle].filter(Boolean).join(", ") || "-"], ["Issue Date", fmtDate(cfg.issueDate)]]));
      B.push(gap(400));
      B.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: s(C.company), bold: true, font: "Arial", size: 22, color: C.primary })] }));
      B.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s(C.addressLine), font: "Arial", size: 16, color: MUTE })] }));
      B.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s(C.contactLine), font: "Arial", size: 16, color: MUTE })] }));
      B.push(new Paragraph({ children: [new PageBreak()] }));
    } else {
      B.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 }, children: [new TextRun({ text: title.toUpperCase(), bold: true, font: "Arial", size: 34, color: C.primary })] }));
      B.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: s(cfg.docNo), font: "Consolas", size: 19, color: MUTE })] }));
      B.push(rule(14)); B.push(gap(160));
    }

    for (const p of parts) {
      if (p.title && !(cfg.mode === "certificate" && p.key === "letter")) B.push(h1(p.num, p.title));
      if (p.key === "letter") {
        const L = cfg.letter;
        B.push(P(fmtDate(cfg.issueDate)));
        B.push(new Paragraph({ spacing: { after: 0 }, children: [T(cfg.customer.name, { bold: true })] }));
        cfg.customer.addressLines.forEach(l => B.push(new Paragraph({ spacing: { after: 0 }, children: [T(l)] })));
        if (cfg.customer.attention) B.push(new Paragraph({ spacing: { before: 80, after: 0 }, children: [T("Attn: ", { bold: true }), T(cfg.customer.attention)] }));
        B.push(gap(160));
        B.push(P([T("Subject: ", { bold: true, color: C.primary }), T(L.subject, { bold: true })]));
        B.push(P(L.salutation));
        L.body.forEach(x => B.push(P(x)));
        if (cfg.mode === "certificate") {
          const reg = certReg(cfg);
          if (reg === "serials") { B.push(grid(["#", "Device Type", "Make & Model", "Serial Number", "Location"], [500, 1900, 2500, 2600, 2246], serialRows(cfg), { mono: [3], center: [0] })); B.push(gap(140)); }
          else if (reg === "boq") { B.push(grid(["#", "Description", "Make / Model", "Qty", "Unit", "Remarks"], [500, 3700, 2000, 800, 800, 1946], boqRows(cfg), { center: [0, 3, 4] })); B.push(gap(140)); }
          if (cfg.include.warranty) B.push(P(cfg.warrantyLine));
        }
        B.push(P(L.closing));
        B.push(new Paragraph({ spacing: { before: 160, after: 0 }, children: [T("Yours faithfully,")] }));
        B.push(new Paragraph({ spacing: { before: 360, after: 0 }, children: [T(cfg.preparedBy, { bold: true })] }));
        if (cfg.preparedTitle) B.push(new Paragraph({ spacing: { after: 0 }, children: [T(cfg.preparedTitle)] }));
        B.push(new Paragraph({ spacing: { after: 120 }, children: [T(C.company, { color: C.primary, bold: true })] }));
      }
      if (p.key === "summary") B.push(kv(summaryRows(cfg)));
      if (p.key === "scope") {
        if (cfg.scope.intro) B.push(P(cfg.scope.intro));
        cfg.scope.streams.forEach(st => { if (st.heading) B.push(h2(st.heading)); st.bullets.forEach(x => B.push(bullet(x))); });
      }
      if (p.key === "boq") {
        B.push(P("The table below lists the items in the customer's bill of quantities supplied and installed under this order."));
        B.push(grid(["#", "Description", "Make / Model", "Qty", "Unit", "Remarks"], [500, 3700, 2000, 800, 800, 1946], boqRows(cfg), { center: [0, 3, 4] }));
      }
      if (p.key === "serials") {
        B.push(P(`The following equipment has been supplied, installed, configured and commissioned at site. ${cfg.serials.length} unit${cfg.serials.length === 1 ? " is" : "s are"} recorded below with serial numbers for warranty registration and future support.`));
        B.push(grid(["#", "Device Type", "Make & Model", "Serial Number", "Location"], [500, 1900, 2500, 2600, 2246], serialRows(cfg), { mono: [3], center: [0] }));
      }
      if (p.key === "diagram") {
        if (cfg.diagram.title) B.push(h2(cfg.diagram.title));
        B.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 80 }, children: [imgRun(cfg.diagramImg, fitBox(cfg.diagramImg, 640, 760))] }));
        if (cfg.diagram.caption) B.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [T(cfg.diagram.caption, { italics: true, color: MUTE, size: 18 })] }));
      }
      if (p.key === "testing") {
        B.push(P("Tests carried out before handover and their results:"));
        B.push(grid(["#", "Test", "Method", "Result", "Remarks"], [500, 3300, 2300, 1100, 2546], testRows(cfg), { center: [0, 3], bold: [3], colorOf: (j, c) => j === 3 ? resultColor(c) : undefined }));
      }
      if (p.key === "photos") {
        const ws = scale([1, 1]); const rows = [];
        for (let i = 0; i < cfg.photos.length; i += 2) {
          const pair = cfg.photos.slice(i, i + 2);
          rows.push(new TableRow({ cantSplit: true, children: [0, 1].map(j => { const ph = pair[j];
            return new TableCell({ borders: noBorders, width: { size: ws[j], type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 80, right: 80 },
              children: ph ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [imgRun(ph, fitBox(ph, 300, 230))] }),
                new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60 }, children: [T("Photo " + (i + j + 1) + (ph.caption ? ": " + ph.caption : ""), { italics: true, color: MUTE, size: 17 })] })] : [new Paragraph("")] }); }) }));
        }
        B.push(new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: ws, layout: TableLayoutType.FIXED, borders: noBorders, rows }));
      }
      if (p.key === "handover") cfg.handover.forEach(x => B.push(bullet(x)));
      if (p.key === "warranty") {
        B.push(kv(warrantyRows(cfg)));
        if (cfg.warranty.terms.length) { B.push(h2("Warranty Terms")); cfg.warranty.terms.forEach(x => B.push(bullet(x))); }
        if (cfg.warranty.exclusions.length) { B.push(h2("Exclusions")); cfg.warranty.exclusions.forEach(x => B.push(bullet(x))); }
      }
      if (p.key === "snags") {
        if (cfg.snags.length) B.push(grid(["#", "Open Item", "Owner", "Target Date"], [500, 5600, 1800, 1846], cfg.snags.map((r, i) => [String(i + 1), r.item, r.owner || "-", r.target || "-"]), { center: [0] }));
        else B.push(block(C.label, [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "NIL, no open snags at handover.", bold: true, font: "Arial", size: 20, color: C.primary })] })], 160));
      }
      if (p.key === "signoff") {
        B.push(P(signText(cfg)));
        B.push(signTable());
      }
    }

    function signTable() {
      const ws = scale([1, 1]);
      const col = (label, who) => {
        const ch = [new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: label, bold: true, font: "Arial", size: 18, color: C.primary, characterSpacing: 40 })] })];
        const pics = [];
        if (who.sigImg) pics.push(imgRun(who.sigImg, fitBox(who.sigImg, 190, 70)));
        if (who.stamp) pics.push(imgRun(who.stamp, fitBox(who.stamp, 80, 80)));
        ch.push(new Paragraph({ spacing: { after: 0 }, children: pics.length ? pics : [T(" ", { size: 60 })] }));
        ch.push(new Paragraph({ spacing: { before: 0, after: 100 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: C.primary, space: 4 } }, children: [T("Signature" + (who.stampable ? " & company stamp" : ""), { color: MUTE, size: 16 })] }));
        ch.push(new Paragraph({ spacing: { after: 60 }, children: [T("Name: ", { bold: true }), T(who.name || "")] }));
        ch.push(new Paragraph({ spacing: { after: 60 }, children: [T("Designation: ", { bold: true }), T(who.title || "")] }));
        ch.push(new Paragraph({ spacing: { after: 60 }, children: [T("Company: ", { bold: true }), T(who.company || "")] }));
        ch.push(new Paragraph({ spacing: { after: 60 }, children: [T("Date: ", { bold: true }), T(who.date || "")] }));
        if (who.note) ch.push(new Paragraph({ children: [T(who.note, { italics: true, color: MUTE, size: 16 })] }));
        return ch;
      };
      const top = { style: BorderStyle.SINGLE, size: 12, color: C.primary };
      return new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: ws, layout: TableLayoutType.FIXED, borders: noBorders, rows: [new TableRow({ cantSplit: true, children: [
        new TableCell({ borders: { ...noBorders, top }, width: { size: ws[0], type: WidthType.DXA }, margins: { top: 160, bottom: 100, left: 0, right: 300 }, children: col("PREPARED BY", cfg.signoff.company) }),
        new TableCell({ borders: { ...noBorders, top }, width: { size: ws[1], type: WidthType.DXA }, margins: { top: 160, bottom: 100, left: 300, right: 0 }, children: col("ACCEPTED BY", cfg.signoff.customer) }),
      ] })] });
    }

    const header = new Header({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: CW }], spacing: { after: 60 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.primary, space: 6 } },
      children: (img.logo ? [imgRun(img.logo, fitBox(img.logo, 110, 46))] : []).concat([new TextRun({ text: "\t" }), new TextRun({ text: s(cfg.headerTitle), font: "Arial", size: 16, color: MUTE })]) })] });
    const footer = new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: CW }], border: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 6 } }, children: [
      new TextRun({ text: s(C.addressLine) + "   |   " + s(cfg.docNo), font: "Arial", size: 14, color: "888888" }), new TextRun({ text: "\t" }),
      new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], font: "Arial", size: 14, color: "888888" })] })] });
    const page = { size: { width: 11906, height: 16838 }, margin: { top: 1100, right: 1080, bottom: 1000, left: 1080, header: 500, footer: 450 } };
    return new D.Document({
      creator: C.company, title: `${title} ${cfg.docNo}`, description: `${title} for ${cfg.customer.name}`,
      numbering: { config: [{ reference: "b", levels: [{ level: 0, format: D.LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { run: { color: C.accent }, paragraph: { indent: { left: 460, hanging: 240 } } } }] }] },
      styles: { default: { document: { run: { font: "Arial", size: 20, color: DARK } } } },
      sections: [{ properties: { page, titlePage: cfg.mode !== "certificate" }, headers: { default: header, first: new Header({ children: [new Paragraph("")] }) }, footers: { default: footer, first: new Footer({ children: [new Paragraph("")] }) }, children: B }],
    });
  }

  /* =================================== PDF =================================== */
  const rgb = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  // The built-in PDF fonts cover Latin-1 only, so typographic characters are mapped and anything else dropped.
  const P = v => s(v).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/×/g, "x").replace(/•/g, "-").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
  function pdf(jsPDF, cfg, img) {
    use(cfg.brand);
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = 595.28, H = 841.89, M = 54, CWp = W - 2 * M, TOP = 84, BOT = H - 64;
    let y = TOP;
    const need = h => { if (y + h > BOT) { doc.addPage(); y = TOP; } };
    const font = (st = "normal", size = 10, color = DARK) => { doc.setFont("helvetica", st); doc.setFontSize(size); doc.setTextColor(...rgb(color)); };
    function text(str, o = {}) {
      const size = o.size || 10, lh = size * 1.42;
      font(o.bold ? (o.italic ? "bolditalic" : "bold") : o.italic ? "italic" : "normal", size, o.color || DARK);
      doc.splitTextToSize(P(str), CWp - (o.indent || 0)).forEach(l => { need(lh); doc.text(l, M + (o.indent || 0) + (o.center ? (CWp - (o.indent || 0)) / 2 : 0), y + size, o.center ? { align: "center" } : undefined); y += lh; });
      y += o.after == null ? 7 : o.after;
    }
    function h1(num, t, room) {
      need(64 + (room || 0)); y += 12; font("bold", 13, C.accent);
      const lead = num ? num + ".  " : ""; doc.text(lead, M, y + 13); const lw = doc.getTextWidth(lead);
      font("bold", 13, C.primary); doc.text(P(t).toUpperCase(), M + lw, y + 13); y += 19;
      doc.setDrawColor(...rgb(C.accent)); doc.setLineWidth(1.2); doc.line(M, y, M + CWp, y); y += 12;
    }
    const h2 = t => { need(36); y += 4; text(t, { bold: true, size: 10.5, color: C.primary, after: 3 }); };
    function bullet(t) {
      font("normal", 10); const ls = doc.splitTextToSize(P(t), CWp - 18); need(14);
      doc.setFillColor(...rgb(C.accent)); doc.circle(M + 6, y + 6.5, 1.8, "F"); font("normal", 10);
      ls.forEach(l => { need(14); doc.text(l, M + 18, y + 10); y += 14; }); y += 3;
    }
    function table(head, rows, o = {}) {
      doc.autoTable({ startY: y, margin: { left: M, right: M, top: TOP, bottom: H - BOT }, head: head ? [head.map(P)] : undefined, body: rows.map(r => r.map(P)),
        theme: "grid", styles: { font: "helvetica", fontSize: rows.length > 10 ? 8.5 : 9, cellPadding: 4.5, lineColor: rgb(BORDER), lineWidth: 0.5, textColor: rgb(DARK), valign: "middle", overflow: "linebreak" },
        headStyles: { fillColor: rgb(C.primary), textColor: [255, 255, 255], fontStyle: "bold" }, columnStyles: o.columnStyles || {}, rowPageBreak: "avoid",
        didParseCell: d => { if (o.mono && d.section === "body" && o.mono.includes(d.column.index)) { d.cell.styles.font = "courier"; d.cell.styles.fontStyle = "bold"; } if (o.didParseCell) o.didParseCell(d); } });
      y = doc.lastAutoTable.finalY + 12;
    }
    const kv = rows => table(null, rows, { columnStyles: { 0: { fontStyle: "bold", fillColor: rgb(C.label), textColor: rgb(C.primary), cellWidth: 150 } } });
    function image(im, w, maxH, fmt) { const d = fitBox(im, w, maxH || 9999); need(d.height); doc.addImage(im.dataUrl, fmt || im.fmt || "PNG", M + (CWp - d.width) / 2, y, d.width, d.height); y += d.height; }

    const parts = plan(cfg);
    const title = cfg.mode === "certificate" ? "Work Completion Certificate" : "Project Completion Report";
    if (cfg.mode !== "certificate") {
      y = 70;
      if (img.logo) image(img.logo, 190, 92);
      y += 34;
      const bh = 196; doc.setFillColor(...rgb(C.primary)); doc.rect(M, y, CWp, bh, "F");
      let yy = y + 32;
      font("italic", 10, C.cover); doc.text(P(C.tagline), M + 24, yy); yy += 32;
      font("bold", 22, "FFFFFF"); doc.text(title.toUpperCase(), M + 24, yy); yy += 22;
      doc.setFont("courier", "normal"); doc.setFontSize(10.5); doc.setTextColor(...rgb(C.cover)); doc.text(P(cfg.docNo), M + 24, yy); yy += 30;
      font("normal", 8.5, C.cover); doc.text("F O R   C L I E N T", M + 24, yy); yy += 20;
      font("bold", 15, "FFFFFF"); doc.splitTextToSize(P(cfg.customer.name), CWp - 48).slice(0, 2).forEach(l => { doc.text(l, M + 24, yy); yy += 18; });
      font("normal", 11, "FFFFFF"); doc.splitTextToSize(P(cfg.projectTitle), CWp - 48).slice(0, 2).forEach(l => { doc.text(l, M + 24, yy); yy += 14; });
      y += bh; doc.setFillColor(...rgb(C.accent)); doc.rect(M, y, CWp, 3.5, "F"); y += 22;
      kv([["Document No.", cfg.docNo], ["Customer PO Reference", cfg.poRef || "-"], ["Site / Location", cfg.site || "-"], ["Completion Date", fmtDate(cfg.completionDate) || "-"], ["Prepared By", [cfg.preparedBy, cfg.preparedTitle].filter(Boolean).join(", ") || "-"], ["Issue Date", fmtDate(cfg.issueDate)]]);
      y = Math.max(y + 30, H - 140);
      text(C.company, { bold: true, color: C.primary, size: 11, center: true, after: 2 });
      text(C.addressLine, { size: 8, color: MUTE, center: true, after: 1 });
      text(C.contactLine, { size: 8, color: MUTE, center: true });
      doc.addPage(); y = TOP;
    } else {
      text(title.toUpperCase(), { bold: true, size: 17, color: C.primary, center: true, after: 2 });
      doc.setFont("courier", "normal"); doc.setFontSize(9.5); doc.setTextColor(...rgb(MUTE)); doc.text(P(cfg.docNo), W / 2, y + 9, { align: "center" }); y += 18;
      doc.setFillColor(...rgb(C.accent)); doc.rect(M, y, CWp, 2, "F"); y += 18;
    }

    for (const p of parts) {
      // Keep a heading with the start of what follows it.
      const room = p.key === "diagram" && cfg.diagramImg ? fitBox(cfg.diagramImg, CWp, 560).height + (cfg.diagram.title ? 24 : 0) : p.key === "photos" ? 230 : p.key === "signoff" ? 250 : 0;
      if (p.title && !(cfg.mode === "certificate" && p.key === "letter")) h1(p.num, p.title, room);
      if (p.key === "letter") {
        const L = cfg.letter;
        text(fmtDate(cfg.issueDate), { after: 10 });
        text(cfg.customer.name, { bold: true, after: 0 }); cfg.customer.addressLines.forEach(l => text(l, { after: 0 }));
        if (cfg.customer.attention) { y += 4; text("Attn: " + cfg.customer.attention, { after: 0 }); }
        y += 12;
        text("Subject: " + L.subject, { bold: true, color: C.primary, after: 10 });
        text(L.salutation);
        L.body.forEach(x => text(x));
        if (cfg.mode === "certificate") {
          const reg = certReg(cfg);
          if (reg === "serials") table(["#", "Device Type", "Make & Model", "Serial Number", "Location"], serialRows(cfg), { mono: [3], columnStyles: { 0: { halign: "center", cellWidth: 24 } } });
          if (reg === "boq") table(["#", "Description", "Make / Model", "Qty", "Unit", "Remarks"], boqRows(cfg), { columnStyles: { 0: { halign: "center", cellWidth: 26 }, 3: { halign: "center", cellWidth: 36 }, 4: { halign: "center", cellWidth: 40 } } });
          if (cfg.include.warranty) text(cfg.warrantyLine);
        }
        text(L.closing, { after: 14 });
        text("Yours faithfully,", { after: 26 });
        text(cfg.preparedBy, { bold: true, after: 0 }); if (cfg.preparedTitle) text(cfg.preparedTitle, { after: 0 });
        text(C.company, { bold: true, color: C.primary });
      }
      if (p.key === "summary") kv(summaryRows(cfg));
      if (p.key === "scope") { if (cfg.scope.intro) text(cfg.scope.intro); cfg.scope.streams.forEach(st => { if (st.heading) h2(st.heading); st.bullets.forEach(bullet); }); }
      if (p.key === "boq") { text("The table below lists the items in the customer's bill of quantities supplied and installed under this order."); table(["#", "Description", "Make / Model", "Qty", "Unit", "Remarks"], boqRows(cfg), { columnStyles: { 0: { halign: "center", cellWidth: 26 }, 3: { halign: "center", cellWidth: 36 }, 4: { halign: "center", cellWidth: 40 } } }); }
      if (p.key === "serials") { text(`The following equipment has been supplied, installed, configured and commissioned at site. ${cfg.serials.length} unit${cfg.serials.length === 1 ? " is" : "s are"} recorded below with serial numbers for warranty registration and future support.`); table(["#", "Device Type", "Make & Model", "Serial Number", "Location"], serialRows(cfg), { mono: [3], columnStyles: { 0: { halign: "center", cellWidth: 24 } } }); }
      if (p.key === "diagram") { if (cfg.diagram.title) h2(cfg.diagram.title); y += 4; image(cfg.diagramImg, CWp, 560); y += 8; if (cfg.diagram.caption) text(cfg.diagram.caption, { italic: true, size: 9, color: MUTE, center: true }); }
      if (p.key === "testing") { text("Tests carried out before handover and their results:"); table(["#", "Test", "Method", "Result", "Remarks"], testRows(cfg), { columnStyles: { 0: { halign: "center", cellWidth: 24 }, 3: { halign: "center", cellWidth: 52, fontStyle: "bold" } }, didParseCell: d => { if (d.section === "body" && d.column.index === 3) d.cell.styles.textColor = rgb(resultColor(d.cell.raw)); } }); }
      if (p.key === "photos") {
        const w = (CWp - 18) / 2, maxH = 200;
        for (let i = 0; i < cfg.photos.length; i += 2) {
          const pair = cfg.photos.slice(i, i + 2); const dims = pair.map(ph => fitBox(ph, w, maxH)); const rh = Math.max(...dims.map(d => d.height));
          need(rh + 28);
          pair.forEach((ph, j) => { const x = M + j * (w + 18); doc.addImage(ph.dataUrl, "JPEG", x + (w - dims[j].width) / 2, y, dims[j].width, dims[j].height);
            font("italic", 8.5, MUTE); doc.text(doc.splitTextToSize(P("Photo " + (i + j + 1) + (ph.caption ? ": " + ph.caption : "")), w)[0], x + w / 2, y + rh + 13, { align: "center" }); });
          y += rh + 26;
        }
      }
      if (p.key === "handover") cfg.handover.forEach(bullet);
      if (p.key === "warranty") { kv(warrantyRows(cfg)); if (cfg.warranty.terms.length) { h2("Warranty Terms"); cfg.warranty.terms.forEach(bullet); } if (cfg.warranty.exclusions.length) { h2("Exclusions"); cfg.warranty.exclusions.forEach(bullet); } }
      if (p.key === "snags") {
        if (cfg.snags.length) table(["#", "Open Item", "Owner", "Target Date"], cfg.snags.map((r, i) => [String(i + 1), r.item, r.owner || "-", r.target || "-"]), { columnStyles: { 0: { halign: "center", cellWidth: 24 } } });
        else { need(34); doc.setFillColor(...rgb(C.label)); doc.rect(M, y, CWp, 30, "F"); font("bold", 10, C.primary); doc.text("NIL, no open snags at handover.", W / 2, y + 19, { align: "center" }); y += 42; }
      }
      if (p.key === "signoff") { need(250); text(signText(cfg)); signBlock(); }
    }

    function signBlock() {
      need(190); y += 10;
      const w = (CWp - 30) / 2;
      [["PREPARED BY", cfg.signoff.company], ["ACCEPTED BY", cfg.signoff.customer]].forEach(([label, who], i) => {
        const x = M + i * (w + 30); let yy = y;
        doc.setDrawColor(...rgb(C.primary)); doc.setLineWidth(1.4); doc.line(x, yy, x + w, yy); yy += 16;
        font("bold", 8.5, C.primary); doc.text(label.split("").join(" "), x, yy); yy += 8;
        const boxH = 56;
        if (who.sigImg) { const d = fitBox(who.sigImg, 150, boxH); doc.addImage(who.sigImg.dataUrl, "PNG", x, yy + boxH - d.height, d.width, d.height); }
        if (who.stamp) { const d = fitBox(who.stamp, 62, 62); doc.addImage(who.stamp.dataUrl, "PNG", x + w - d.width, yy - 4, d.width, d.height); }
        yy += boxH + 4;
        doc.setDrawColor(...rgb(C.primary)); doc.setLineWidth(0.6); doc.line(x, yy, x + w * 0.8, yy); yy += 10;
        font("normal", 7.5, MUTE); doc.text("Signature" + (who.stampable ? " & company stamp" : ""), x, yy); yy += 16;
        [["Name", who.name], ["Designation", who.title], ["Company", who.company], ["Date", who.date]].forEach(([k, v]) => {
          font("bold", 9, DARK); doc.text(k + ":", x, yy); font("normal", 9, DARK); doc.text(doc.splitTextToSize(P(v || ""), w - 70)[0] || "", x + 66, yy); yy += 14;
        });
        if (who.note) { font("italic", 7.5, MUTE); doc.splitTextToSize(P(who.note), w).forEach(l => { doc.text(l, x, yy); yy += 10; }); }
      });
      y += 196;
    }

    // running header and footer
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      if (cfg.mode !== "certificate" && i === 1) continue;
      doc.setPage(i);
      if (img.logo) { const d = fitBox(img.logo, 84, 34); doc.addImage(img.logo.dataUrl, "PNG", M, 28, d.width, d.height); }
      font("normal", 8, MUTE); doc.text(P(cfg.headerTitle), W - M, 52, { align: "right" });
      doc.setDrawColor(...rgb(C.primary)); doc.setLineWidth(0.8); doc.line(M, 64, W - M, 64);
      doc.setDrawColor(...rgb(BORDER)); doc.setLineWidth(0.5); doc.line(M, H - 44, W - M, H - 44);
      font("normal", 7, "888888"); doc.text(P(C.addressLine + "   |   " + cfg.docNo), M, H - 32); doc.text(`Page ${i} of ${n}`, W - M, H - 32, { align: "right" });
    }
    doc.setProperties({ title: `${title} ${cfg.docNo}`, subject: `${title} for ${cfg.customer.name}`, author: C.company, creator: C.company });
    return doc;
  }

  return { docx, pdf, fmtDate, plan, BRANDS, use };
})();
if (typeof module !== "undefined") module.exports = PCRGEN;
