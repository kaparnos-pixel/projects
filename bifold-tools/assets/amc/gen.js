/* ===== Bifold document generators: AMC proposal, visit report, contract service report (Word + PDF) ===== */
const GEN = (function () {
  const NAVY = "34648C", RED = "AE3343", GREY = "EFF3F7", BLUE = "26506F", ALT = "F2F6FA", DARK = "1F2733", MUTE = "6B7280";
  const CW = 10080;
  const COMPANY = {
    company: "Bifold Technologies LLC", preparerName: "Ranjan Mazumder", preparerTitle: "Director",
    email: "ranjan@bifoldtech.com", phone: "+971 056 4243777", tagline: "Enterprise ICT Solutions & Managed Services",
    addressLine: "Office A306, Saraya Avenue, Al Garhoud, Dubai, UAE  |  PO Box 554567",
    contactLine: "Tel: +971 04 264 0374  |  bifoldtech.com  |  ranjan@bifoldtech.com",
  };
  const s = v => (v == null ? "" : String(v));
  const fitBox = (p, maxW, maxH) => { let w = maxW, h = Math.round(maxW * p.h / p.w); if (h > maxH) { h = maxH; w = Math.round(maxH * p.w / p.h); } return { width: w, height: h }; };
  const lines = t => s(t).split(/\n+/).map(x => x.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);

  /* ---------------- DOCX ---------------- */
  function docxKit(D, img) {
    const { Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, Header, Footer, AlignmentType, TabStopType,
      BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber, TableLayoutType } = D;
    const scaled = (im, w) => ({ width: w, height: Math.round(w * im.h / im.w) });
    const T = (text, o = {}) => new TextRun({ text: s(text), font: "Arial", color: DARK, size: 21, ...o });
    const h1 = text => new Paragraph({ spacing: { before: 320, after: 160 }, keepNext: true,
      border: { bottom: { style: BorderStyle.SINGLE, size: 14, color: RED, space: 6 } },
      children: [new TextRun({ text, font: "Arial", bold: true, size: 28, color: NAVY })] });
    const h2 = text => new Paragraph({ spacing: { before: 220, after: 90 }, keepNext: true, children: [new TextRun({ text, font: "Arial", bold: true, size: 23, color: BLUE })] });
    const body = text => new Paragraph({ spacing: { after: 140, line: 276 }, children: [T(text)] });
    const bullet = text => new Paragraph({ numbering: { reference: "b", level: 0 }, spacing: { after: 60, line: 264 }, children: [T(text)] });
    const tb = { style: BorderStyle.SINGLE, size: 4, color: "D6E0E9" };
    const cellBorders = { top: tb, bottom: tb, left: tb, right: tb };
    const hcell = (text, w) => new TableCell({ borders: cellBorders, width: { size: w, type: WidthType.DXA },
      shading: { fill: NAVY, type: ShadingType.CLEAR, color: "auto" }, margins: { top: 70, bottom: 70, left: 120, right: 120 }, verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({ children: [new TextRun({ text: s(text), font: "Arial", bold: true, color: "FFFFFF", size: 20 })] })] });
    const dcell = (text, w, { fill = "FFFFFF", bold = false, align = AlignmentType.LEFT, color = DARK } = {}) => new TableCell({ borders: cellBorders, width: { size: w, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR, color: "auto" }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, verticalAlign: VerticalAlign.CENTER,
      children: s(text).split("\n").map(line => new Paragraph({ alignment: align, children: [new TextRun({ text: line, font: "Arial", bold, size: 20, color })] })) });
    const noBorders = () => ({ top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } });
    const blockTable = (fill, children, pad = 240) => new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [CW], layout: TableLayoutType.FIXED, borders: noBorders(),
      rows: [new TableRow({ children: [new TableCell({ width: { size: CW, type: WidthType.DXA }, shading: { fill, type: ShadingType.CLEAR, color: "auto" }, margins: { top: pad, bottom: pad, left: 320, right: 320 }, children })] })] });
    const rule = () => new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: RED, space: 1 } }, children: [new TextRun({ text: "", size: 2 })] });
    const spacer = (after = 120) => new Paragraph({ spacing: { after }, children: [new TextRun({ text: "", size: 2 })] });
    function grid(headers, widths, rows, opts = {}) {
      return new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, rows: [
        new TableRow({ tableHeader: true, children: headers.map((h, j) => hcell(h, widths[j])) }),
        ...rows.map((r, i) => new TableRow({ cantSplit: true, children: r.map((c, j) => dcell(c, widths[j], { fill: i % 2 ? ALT : "FFFFFF", bold: (opts.boldCols || []).includes(j), align: (opts.center || []).includes(j) ? AlignmentType.CENTER : (opts.right || []).includes(j) ? AlignmentType.RIGHT : AlignmentType.LEFT })) })),
      ] });
    }
    function kvTable(rows) {
      const w = [3200, 6880];
      return new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: w, layout: TableLayoutType.FIXED, rows:
        rows.map((r, i) => new TableRow({ cantSplit: true, children: [dcell(r[0], w[0], { fill: GREY, bold: true }), dcell(r[1], w[1], { fill: i % 2 ? ALT : "FFFFFF" })] })) });
    }
    function header(title) {
      const ch = [];
      if (img && img.logo) ch.push(new ImageRun({ data: img.logo.bytes, type: "png", transformation: scaled(img.logo, 122) }));
      ch.push(new TextRun({ text: "\t", font: "Arial" }));
      ch.push(new TextRun({ text: title, italics: true, bold: true, font: "Arial", size: 17, color: NAVY }));
      return new Header({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: CW }], spacing: { after: 60 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RED, space: 6 } }, children: ch })] });
    }
    function footer() {
      return new Footer({ children: [
        new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: CW }], spacing: { before: 60 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: "AFC7DB", space: 6 } }, children: [
          new TextRun({ text: COMPANY.addressLine, font: "Arial", size: 15, color: MUTE }), new TextRun({ text: "\t", font: "Arial" }),
          new TextRun({ text: "Page ", font: "Arial", size: 15, color: MUTE }), new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 15, color: MUTE, bold: true }),
          new TextRun({ text: " of ", font: "Arial", size: 15, color: MUTE }), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Arial", size: 15, color: MUTE, bold: true })] }),
        new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: CW }], children: [
          new TextRun({ text: COMPANY.contactLine, font: "Arial", size: 15, color: MUTE }), new TextRun({ text: "\t", font: "Arial" }),
          new TextRun({ text: "CONFIDENTIAL", font: "Arial", size: 15, color: RED, bold: true })] }),
      ] });
    }
    function doc(sections) {
      return new D.Document({
        numbering: { config: [{ reference: "b", levels: [{ level: 0, format: D.LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { run: { color: RED }, paragraph: { indent: { left: 460, hanging: 240 } } } }] }] },
        styles: { default: { document: { run: { font: "Arial", size: 21, color: DARK } } } },
        sections,
      });
    }
    const page = { size: { width: 12240, height: 15840 } };
    const contentProps = { page: { ...page, margin: { top: 1320, right: 1080, bottom: 1180, left: 1080, header: 600, footer: 520 } } };
    const coverProps = { page: { ...page, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } };
    return { T, h1, h2, body, bullet, hcell, dcell, blockTable, rule, spacer, grid, kvTable, header, footer, doc, scaled, noBorders, contentProps, coverProps };
  }

  function amcDocx(D, cfg, img) {
    const K = docxKit(D, img);
    const { Paragraph, TextRun, ImageRun, PageBreak, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, TableLayoutType } = D;
    const meta = cfg.meta || {}; const customer = meta.customer || "[Customer Name]";
    const cover = [];
    if (img && img.logo) cover.push(new Paragraph({ spacing: { after: 120 }, children: [new ImageRun({ data: img.logo.bytes, type: "png", transformation: K.scaled(img.logo, 232) })] }));
    cover.push(K.rule());
    cover.push(K.blockTable(NAVY, [
      new Paragraph({ spacing: { after: 220 }, children: [new TextRun({ text: COMPANY.tagline, italics: true, color: "C9DBEA", font: "Arial", size: 20 })] }),
      new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "ANNUAL MAINTENANCE", color: "9CBBD5", font: "Arial", size: 22, characterSpacing: 40 })] }),
      new Paragraph({ spacing: { after: 140 }, children: [new TextRun({ text: "CONTRACT PROPOSAL", bold: true, color: "FFFFFF", font: "Arial", size: 52 })] }),
      new Paragraph({ children: [new TextRun({ text: meta.subtitle || "IT Support Plan", color: "FFFFFF", font: "Arial", size: 26 })] }),
      new Paragraph({ spacing: { before: 480 }, children: [new TextRun({ text: "", size: 2 })] }),
    ], 300));
    cover.push(K.rule());
    const dRow = (l, v) => new Paragraph({ spacing: { after: 30 }, children: [new TextRun({ text: l + "  ", bold: true, font: "Arial", size: 20, color: DARK }), new TextRun({ text: s(v), font: "Arial", size: 20, color: DARK })] });
    cover.push(K.blockTable(GREY, [
      new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: "PREPARED FOR", bold: true, color: MUTE, font: "Arial", size: 18, characterSpacing: 20 })] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: customer, bold: true, color: NAVY, font: "Arial", size: 30 })] }),
      dRow("Attention:", meta.attention || "The Management"), dRow("Proposal No.:", meta.proposalNo), dRow("Date:", meta.date), dRow("Valid Until:", meta.validUntil),
    ], 260));
    cover.push(K.spacer());
    cover.push(K.blockTable(NAVY, [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "CONFIDENTIAL  —  FOR THE NAMED RECIPIENT ONLY", bold: true, color: "FFFFFF", font: "Arial", size: 18, characterSpacing: 10 })] })], 130));

    const L = cfg.letter || {}; const B = [];
    B.push(K.h1("1. Introduction"));
    if (meta.date) B.push(K.body(meta.date));
    [["To,"], [L.toName || meta.attention || "The Management", { bold: true }], [customer]].forEach(([t, o]) => B.push(new Paragraph({ spacing: { after: 20 }, children: [K.T(t, o)] })));
    B.push(new Paragraph({ spacing: { after: 160 }, children: [K.T(L.toLocation || "Dubai, UAE")] }));
    if (L.subject) B.push(new Paragraph({ spacing: { after: 160 }, children: [K.T("Subject:  " + L.subject, { bold: true })] }));
    B.push(K.body(L.salutation || "Dear Sir/Madam,"));
    (L.body || []).forEach(p => B.push(K.body(p)));
    B.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [K.T(L.signoff || "Sincerely,")] }));
    if (img && img.sig) B.push(new Paragraph({ spacing: { after: 20 }, children: [new ImageRun({ data: img.sig.bytes, type: "png", transformation: K.scaled(img.sig, 110) })] }));
    [[COMPANY.preparerName, { bold: true }], [COMPANY.preparerTitle], [COMPANY.company]].forEach(([t, o]) => B.push(new Paragraph({ spacing: { after: 10 }, children: [K.T(t, o)] })));
    B.push(new Paragraph({ spacing: { after: 140 }, children: [K.T(COMPANY.email + "  |  " + COMPANY.phone)] }));
    if (img && img.stamp) B.push(new Paragraph({ children: [new ImageRun({ data: img.stamp.bytes, type: "png", transformation: K.scaled(img.stamp, 200) })] }));

    const ab = cfg.about || {}; B.push(K.h1("2. About Bifold Technologies"));
    (ab.paragraphs || []).forEach(p => B.push(K.body(p)));
    if ((ab.strengths || []).length) { B.push(K.h2("Our Strengths")); ab.strengths.forEach(x => B.push(K.bullet(x))); }
    const un = cfg.understanding || {}; B.push(K.h1("3. Understanding of Requirement"));
    (un.paragraphs || []).forEach(p => B.push(K.body(p)));
    if ((un.drivers || []).length) { B.push(K.h2("Engagement Drivers")); un.drivers.forEach(x => B.push(K.bullet(x))); }
    const sc = cfg.scope || {}; B.push(K.h1("4. Scope of Work"));
    if (sc.intro) B.push(K.body(sc.intro));
    (sc.streams || []).forEach(st => { if (st.heading) B.push(K.h2(st.heading)); if (st.text) B.push(K.body(st.text)); (st.bullets || []).forEach(x => B.push(K.bullet(x))); });
    const sp = cfg.servicePlan || {}; B.push(K.h1("5. Service Plan Summary"));
    if (sp.intro) B.push(K.body(sp.intro));
    if ((sp.rows || []).length) B.push(K.grid(["Parameter", "Coverage", "Notes"], [3180, 2400, 4500], sp.rows, { boldCols: [0] }));
    const rp = cfg.response || {}; B.push(K.h1("6. Response & Restoration Commitments"));
    if (rp.intro) B.push(K.body(rp.intro));
    if ((rp.rows || []).length) B.push(K.grid(["Priority", "Description", "Response", "Action Plan", "Restoration Target"], [1000, 3200, 1660, 1660, 2560], rp.rows, { boldCols: [0, 1], center: [0, 2, 3, 4] }));
    if ((rp.workflow || []).length) { B.push(K.h2("Support Workflow")); rp.workflow.forEach(x => B.push(K.bullet(x))); }
    const dc = cfg.documentation || {}; B.push(K.h1("7. Documentation Deliverables"));
    if (dc.intro) B.push(K.body(dc.intro));
    (dc.groups || []).forEach(g => { if (g.heading) B.push(K.h2(g.heading)); if (g.text) B.push(K.body(g.text)); (g.bullets || []).forEach(x => B.push(K.bullet(x))); });
    const cm = cfg.commercial || {}; B.push(K.h1("8. Commercial Terms"));
    if (cm.intro) B.push(K.body(cm.intro));
    const cw = [7680, 2400];
    const cr = [new TableRow({ tableHeader: true, children: [K.hcell("Line Item", cw[0]), K.hcell("Amount (AED)", cw[1])] })];
    (cm.lineItems || []).forEach(li => cr.push(new TableRow({ children: [K.dcell(li.desc, cw[0]), K.dcell(li.amount, cw[1], { align: AlignmentType.RIGHT })] })));
    if (cm.subtotal != null) cr.push(new TableRow({ children: [K.dcell("Subtotal", cw[0], { fill: ALT, bold: true }), K.dcell(cm.subtotal, cw[1], { fill: ALT, bold: true, align: AlignmentType.RIGHT })] }));
    if (cm.vat != null) cr.push(new TableRow({ children: [K.dcell(cm.vatLabel || "VAT @ 5%", cw[0]), K.dcell(cm.vat, cw[1], { align: AlignmentType.RIGHT })] }));
    if (cm.total != null) cr.push(new TableRow({ children: [K.dcell("Total Contract Value (incl. VAT)", cw[0], { fill: NAVY, bold: true, color: "FFFFFF" }), K.dcell(cm.total, cw[1], { fill: NAVY, bold: true, color: "FFFFFF", align: AlignmentType.RIGHT })] }));
    B.push(new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: cw, layout: TableLayoutType.FIXED, rows: cr }));
    if ((cm.paymentTerms || []).length) { B.push(K.h2("Payment Terms")); cm.paymentTerms.forEach(x => B.push(K.bullet(x))); }
    if ((cm.validity || []).length) { B.push(K.h2("Currency & Validity")); cm.validity.forEach(x => B.push(K.bullet(x))); }
    const ex = cfg.exclusions || {}; B.push(K.h1("9. Exclusions, Assumptions & Liability"));
    (ex.groups || []).forEach(g => { if (g.heading) B.push(K.h2(g.heading)); if (g.text) B.push(K.body(g.text)); (g.bullets || []).forEach(x => B.push(K.bullet(x))); });
    const so = cfg.signoff || {}; B.push(K.h1("10. Acceptance & Sign-off"));
    if (so.intro) B.push(K.body(so.intro));
    if (so.period) B.push(new Paragraph({ spacing: { after: 60 }, children: [K.T("Agreement Period:  " + so.period, { bold: true })] }));
    if (so.plan) B.push(new Paragraph({ spacing: { after: 60 }, children: [K.T("Service Plan:  " + so.plan, { bold: true })] }));
    if (so.total) B.push(new Paragraph({ spacing: { after: 160 }, children: [K.T("Total Contract Value:  " + so.total, { bold: true })] }));
    if (so.governing) B.push(K.body(so.governing));
    B.push(K.spacer(200));
    B.push(signTable(D, K, ["For and on behalf of " + COMPANY.company, "For and on behalf of " + customer]));
    B.push(new Paragraph({ spacing: { before: 320 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "— End of Proposal —", italics: true, font: "Arial", color: MUTE, size: 20 })] }));

    return K.doc([
      { properties: K.coverProps, children: cover },
      { properties: K.contentProps, headers: { default: K.header(meta.headerTitle || ("AMC Proposal — " + customer)) }, footers: { default: K.footer() }, children: B },
    ]);
  }

  function signTable(D, K, titles, names) {
    const { Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, TableLayoutType } = D;
    const cell = (title, name) => new TableCell({ borders: { top: { style: BorderStyle.SINGLE, size: 6, color: "AFC7DB" }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
      width: { size: 5040, type: WidthType.DXA }, margins: { top: 160, bottom: 160, left: 0, right: 240 }, children: [
        new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: title, font: "Arial", bold: true, color: BLUE, size: 21 })] }),
        new Paragraph({ spacing: { after: 120 }, children: [K.T("Name:  " + s(name))] }), new Paragraph({ spacing: { after: 120 }, children: [K.T("Title:")] }),
        new Paragraph({ spacing: { after: 120 }, children: [K.T("Date:")] }), new Paragraph({ children: [K.T("Signature & Stamp:")] })] });
    return new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [5040, 5040], layout: TableLayoutType.FIXED, borders: K.noBorders(),
      rows: [new TableRow({ cantSplit: true, children: [cell(titles[0], (names || [])[0]), cell(titles[1], (names || [])[1])] })] });
  }

  function reportCover(D, K, img, kind, titleLine, sub, rows) {
    const { Paragraph, TextRun, ImageRun } = D; const out = [];
    out.push(K.rule());
    out.push(K.blockTable(NAVY, [
      new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: kind, color: "9CBBD5", font: "Arial", size: 20, characterSpacing: 40 })] }),
      new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: titleLine, bold: true, color: "FFFFFF", font: "Arial", size: 40 })] }),
      new Paragraph({ children: [new TextRun({ text: sub, color: "FFFFFF", font: "Arial", size: 24 })] }),
    ], 260));
    out.push(K.rule()); out.push(K.spacer(160));
    out.push(K.kvTable(rows));
    return out;
  }

  function visitDocx(D, v, ctx, img, photos) {
    const K = docxKit(D, img); const { Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, TableLayoutType, AlignmentType, ShadingType, BorderStyle } = D;
    const B = reportCover(D, K, img, "MAINTENANCE VISIT REPORT", visitKindTitle(v.type), s(v.customerName), visitKv(v, ctx));
    let n = 1;
    if (ctx.systems) { B.push(K.h1((n++) + ". Systems Covered")); lines(ctx.systems).forEach(x => B.push(K.bullet(x))); }
    if ((v.checklist || []).length) {
      B.push(K.h1((n++) + ". Maintenance Checklist"));
      B.push(K.grid(["#", "Check Item", "Result", "Remarks"], [600, 4600, 1300, 3580], v.checklist.map((c, i) => [String(i + 1), c.item, resultLabel(c.result), c.note || ""]), { center: [0, 2] }));
    }
    [["Findings & Observations", v.findings], ["Actions Taken", v.actions], ["Recommendations", v.recommendations]].forEach(([t, txt]) => {
      const ls = lines(txt); if (!ls.length) return; B.push(K.h1((n++) + ". " + t)); ls.forEach(x => B.push(K.bullet(x)));
    });
    if (photos && photos.length) {
      B.push(K.h1((n++) + ". Site Photographs"));
      const colW = 5040, imgW = 300;
      const rows = [];
      for (let i = 0; i < photos.length; i += 2) {
        const pair = photos.slice(i, i + 2);
        rows.push(new TableRow({ cantSplit: true, children: [0, 1].map(j => { const p = pair[j];
          return new TableCell({ width: { size: colW, type: WidthType.DXA }, borders: K.noBorders(), margins: { top: 100, bottom: 100, left: 80, right: 80 },
            children: p ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: p.bytes, type: p.type || "jpg", transformation: fitBox(p, imgW, 240) })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60 }, children: [new TextRun({ text: "Photo " + (i + j + 1) + (p.caption ? " — " + p.caption : ""), font: "Arial", size: 18, color: MUTE, italics: true })] })] : [new Paragraph("")] }); }) }));
      }
      B.push(new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [colW, colW], layout: TableLayoutType.FIXED, borders: K.noBorders(), rows }));
    }
    B.push(K.h1((n++) + ". Sign-off"));
    B.push(K.body("Both parties confirm that the maintenance visit described in this report was carried out on the date stated and that the findings above were reviewed on site."));
    B.push(signTable(D, K, ["Bifold Technologies LLC — Engineer", "Customer Representative"], [v.engineers, v.customerRep]));
    return K.doc([{ properties: K.contentProps, headers: { default: K.header("Maintenance Report — " + s(v.customerName)) }, footers: { default: K.footer() }, children: B }]);
  }

  function contractDocx(D, c, visits, img) {
    const K = docxKit(D, img);
    const B = reportCover(D, K, img, "CONTRACT SERVICE REPORT", "AMC Service History", s(c.customerName), contractKv(c, visits));
    B.push(K.h1("1. Visit Summary"));
    const st = visitStats(visits);
    B.push(K.grid(["Measure", "Count"], [7680, 2400], [["Visits scheduled in term", st.total], ["Completed", st.done], ["Upcoming", st.upcoming], ["Overdue (not completed)", st.overdue], ["Cancelled", st.cancelled]].map(r => [r[0], String(r[1])]), { right: [1] }));
    B.push(K.h1("2. Visit Register"));
    if (visits.length) B.push(K.grid(["Date", "Type", "Status", "Engineer(s)", "Report No."], [1500, 1900, 1500, 2780, 2400], visits.map(v => [fmtDate(v.scheduledDate), typeLabel(v.type), statusLabel(v), s(v.engineers), s(v.reportNo)]), {}));
    else B.push(K.body("No visits have been recorded for this contract yet."));
    const withNotes = visits.filter(v => v.status === "completed" && (lines(v.findings).length || lines(v.recommendations).length));
    if (withNotes.length) {
      B.push(K.h1("3. Key Findings & Recommendations"));
      withNotes.forEach(v => { B.push(K.h2(fmtDate(v.scheduledDate) + " — " + typeLabel(v.type))); lines(v.findings).forEach(x => B.push(K.bullet(x))); lines(v.recommendations).forEach(x => B.push(K.bullet("Recommendation: " + x))); });
    }
    return K.doc([{ properties: K.contentProps, headers: { default: K.header("Service Report — " + s(c.customerName)) }, footers: { default: K.footer() }, children: B }]);
  }

  /* ---------------- shared helpers ---------------- */
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(iso) { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); if (!y) return s(iso); return d + " " + MONTHS[m - 1] + " " + y; }
  const TYPES = { pm: "Preventive Maintenance", corrective: "Corrective Maintenance", emergency: "Emergency Call-out", survey: "Site Survey / Audit" };
  const typeLabel = t => TYPES[t] || s(t);
  const visitKindTitle = t => ({ pm: "Preventive Maintenance", corrective: "Corrective Maintenance", emergency: "Emergency Call-out", survey: "Site Survey" })[t] || "Maintenance Visit";
  const resultLabel = r => ({ ok: "OK", issue: "Issue", na: "N/A" })[r] || "—";
  function statusLabel(v) { return ({ scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" })[v.status] || s(v.status); }
  function visitKv(v, ctx) {
    const time = [v.arrival, v.departure].filter(Boolean).join(" – ");
    return [["Report No.", s(v.reportNo)], ["Customer", s(v.customerName)], ["Site / Location", s(v.site || ctx.site)], ["Contract Ref.", s(v.ref)], ["Service Plan", s(ctx.plan)],
      ["Visit Type", typeLabel(v.type)], ["Visit Date", fmtDate(v.completedDate || v.scheduledDate)], ["Time on Site", time || "—"], ["Engineer(s)", s(v.engineers) || "—"], ["Customer Representative", s(v.customerRep) || "—"]];
  }
  function contractKv(c, visits) {
    return [["Customer", s(c.customerName)], ["Contract Ref.", s(c.ref)], ["Service Plan", s(c.plan)], ["Contract Period", fmtDate(c.start) + " to " + fmtDate(c.end)],
      ["PM Frequency", s(c.pmLabel)], ["Report Date", fmtDate(new Date().toISOString().slice(0, 10))], ["Visits on Record", String(visits.length)]];
  }
  function visitStats(vs) {
    const today = new Date().toISOString().slice(0, 10);
    return { total: vs.length, done: vs.filter(v => v.status === "completed").length, cancelled: vs.filter(v => v.status === "cancelled").length,
      upcoming: vs.filter(v => v.status !== "completed" && v.status !== "cancelled" && v.scheduledDate >= today).length,
      overdue: vs.filter(v => v.status !== "completed" && v.status !== "cancelled" && v.scheduledDate < today).length };
  }

  /* ---------------- PDF ---------------- */
  const rgb = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const P = t => s(t).replace(/[—–]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, "...").replace(/×/g, "x").replace(/[^\x00-\xFF•]/g, "");
  function pdfKit(jsPDF, img, headerTitle) {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const W = 612, H = 792, M = 54, CWp = W - 2 * M, TOP = 90, BOT = H - 70;
    let y = TOP;
    const st = { doc, M, CWp, W, H };
    function need(h) { if (y + h > BOT) { doc.addPage(); y = TOP; } }
    function text(str, { size = 10.5, bold = false, italic = false, color = DARK, indent = 0, after = 7, lineH = 1.38 } = {}) {
      doc.setFont("helvetica", bold ? (italic ? "bolditalic" : "bold") : italic ? "italic" : "normal"); doc.setFontSize(size); doc.setTextColor(...rgb(color));
      const ls = doc.splitTextToSize(P(str), CWp - indent);
      ls.forEach(l => { need(size * lineH); doc.text(l, M + indent, y + size); y += size * lineH; });
      y += after;
    }
    function h1(t) { need(60); y += 10; text(t, { size: 14, bold: true, color: NAVY, after: 2 }); doc.setDrawColor(...rgb(RED)); doc.setLineWidth(1.6); doc.line(M, y, M + CWp, y); y += 12; }
    function h2(t) { need(40); y += 4; text(t, { size: 11.5, bold: true, color: BLUE, after: 3 }); }
    function bullet(t) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(10.5);
      const ls = doc.splitTextToSize(P(t), CWp - 18);
      need(14.5);
      doc.setFillColor(...rgb(RED)); doc.circle(M + 6, y + 6.5, 1.8, "F");
      doc.setTextColor(...rgb(DARK));
      ls.forEach(l => { need(14.5); doc.text(l, M + 18, y + 10.5); y += 14.5; });
      y += 3;
    }
    function table(head, rows, opts = {}) {
      doc.autoTable({ startY: y, margin: { left: M, right: M, top: TOP, bottom: H - BOT }, head: head ? [head.map(P)] : undefined, body: rows.map(r => r.map(c => (typeof c === "object" && c) ? c : P(c))),
        theme: "grid", styles: { font: "helvetica", fontSize: 9.5, cellPadding: 5, lineColor: rgb("D6E0E9"), lineWidth: 0.5, textColor: rgb(DARK), valign: "middle" },
        headStyles: { fillColor: rgb(NAVY), textColor: [255, 255, 255], fontStyle: "bold" }, alternateRowStyles: { fillColor: rgb(ALT) },
        columnStyles: opts.columnStyles || {}, rowPageBreak: "avoid", didParseCell: opts.didParseCell });
      y = doc.lastAutoTable.finalY + 12;
    }
    function block(fill, h) { need(h); doc.setFillColor(...rgb(fill)); doc.rect(M, y, CWp, h, "F"); }
    function rule() { doc.setFillColor(...rgb(RED)); doc.rect(M, y, CWp, 2.5, "F"); y += 2.5; }
    function image(im, w, x) { const h = w * im.h / im.w; need(h); doc.addImage(im.dataUrl, im.fmt || "PNG", x == null ? M : x, y, w, h); y += h; }
    function chrome(skipFirst) {
      const n = doc.getNumberOfPages();
      for (let i = 1; i <= n; i++) {
        if (skipFirst && i === 1) continue;
        doc.setPage(i);
        if (img && img.logo) { const w = 92, h = w * img.logo.h / img.logo.w; doc.addImage(img.logo.dataUrl, "PNG", M, 30, w, h); }
        doc.setFont("helvetica", "bolditalic"); doc.setFontSize(8.5); doc.setTextColor(...rgb(NAVY)); doc.text(P(headerTitle), W - M, 52, { align: "right" });
        doc.setDrawColor(...rgb(RED)); doc.setLineWidth(0.8); doc.line(M, 62, W - M, 62);
        doc.setDrawColor(...rgb("AFC7DB")); doc.line(M, H - 50, W - M, H - 50);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...rgb(MUTE));
        doc.text(P(COMPANY.addressLine), M, H - 39); doc.text("Page " + i + " of " + n, W - M, H - 39, { align: "right" });
        doc.text(P(COMPANY.contactLine), M, H - 28); doc.setTextColor(...rgb(RED)); doc.setFont("helvetica", "bold"); doc.text("CONFIDENTIAL", W - M, H - 28, { align: "right" });
      }
    }
    Object.assign(st, { text, h1, h2, bullet, table, block, rule, image, chrome, need, TOP, BOT });
    Object.defineProperty(st, "y", { get() { return y; }, set(v) { y = v; } });
    return st;
  }

  function pdfCover(k, img, kicker, big, sub, kvRows, startY) {
    const { doc, M, CWp } = k; k.y = startY;
    if (img && img.logo) { k.image(img.logo, 170); k.y += 10; }
    k.rule();
    const h = 150; k.block(NAVY, h);
    let yy = k.y + 34;
    doc.setFont("helvetica", "italic"); doc.setFontSize(10); doc.setTextColor(...rgb("C9DBEA")); doc.text(P(COMPANY.tagline), M + 22, yy); yy += 30;
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...rgb("9CBBD5")); doc.text(P(kicker), M + 22, yy, { charSpace: 1.5 }); yy += 30;
    doc.setFont("helvetica", "bold"); doc.setFontSize(24); doc.setTextColor(255, 255, 255); doc.text(P(big), M + 22, yy); yy += 26;
    doc.setFont("helvetica", "normal"); doc.setFontSize(13); doc.text(doc.splitTextToSize(P(sub), CWp - 44)[0] || "", M + 22, yy);
    k.y += h; k.rule(); k.y += 14;
    return kvRows;
  }

  function amcPdf(jsPDF, cfg, img) {
    const meta = cfg.meta || {}; const customer = meta.customer || "[Customer Name]";
    const k = pdfKit(jsPDF, img, meta.headerTitle || ("AMC Proposal - " + customer)); const { doc, M, CWp } = k;
    pdfCover(k, img, "ANNUAL MAINTENANCE", "CONTRACT PROPOSAL", meta.subtitle || "IT Support Plan", null, 54);
    k.block(GREY, 150); let yy = k.y + 26;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...rgb(MUTE)); doc.text("PREPARED FOR", M + 22, yy); yy += 24;
    doc.setFontSize(15); doc.setTextColor(...rgb(NAVY)); doc.text(doc.splitTextToSize(P(customer), CWp - 44)[0], M + 22, yy); yy += 24;
    [["Attention:", meta.attention || "The Management"], ["Proposal No.:", meta.proposalNo], ["Date:", meta.date], ["Valid Until:", meta.validUntil]].forEach(([l, v]) => {
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...rgb(DARK)); doc.text(l, M + 22, yy); doc.setFont("helvetica", "normal"); doc.text(P(v), M + 110, yy); yy += 15; });
    k.y += 150 + 14; k.block(NAVY, 26);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(255, 255, 255); doc.text("CONFIDENTIAL  -  FOR THE NAMED RECIPIENT ONLY", M + CWp / 2, k.y + 16.5, { align: "center" });
    doc.addPage(); k.y = k.TOP;
    const L = cfg.letter || {};
    k.h1("1. Introduction");
    if (meta.date) k.text(meta.date);
    k.text("To,", { after: 1 }); k.text(L.toName || meta.attention || "The Management", { bold: true, after: 1 }); k.text(customer, { after: 1 }); k.text(L.toLocation || "Dubai, UAE", { after: 10 });
    if (L.subject) k.text("Subject:  " + L.subject, { bold: true, after: 10 });
    k.text(L.salutation || "Dear Sir/Madam,");
    (L.body || []).forEach(p => k.text(p));
    k.text(L.signoff || "Sincerely,", { after: 4 });
    if (img && img.sig) k.image(img.sig, 80);
    k.text(COMPANY.preparerName, { bold: true, after: 0 }); k.text(COMPANY.preparerTitle, { after: 0 }); k.text(COMPANY.company, { after: 0 }); k.text(COMPANY.email + "  |  " + COMPANY.phone, { after: 8 });
    if (img && img.stamp) k.image(img.stamp, 130);
    const ab = cfg.about || {}; k.h1("2. About Bifold Technologies"); (ab.paragraphs || []).forEach(p => k.text(p));
    if ((ab.strengths || []).length) { k.h2("Our Strengths"); ab.strengths.forEach(k.bullet); }
    const un = cfg.understanding || {}; k.h1("3. Understanding of Requirement"); (un.paragraphs || []).forEach(p => k.text(p));
    if ((un.drivers || []).length) { k.h2("Engagement Drivers"); un.drivers.forEach(k.bullet); }
    const sc = cfg.scope || {}; k.h1("4. Scope of Work"); if (sc.intro) k.text(sc.intro);
    (sc.streams || []).forEach(st => { if (st.heading) k.h2(st.heading); if (st.text) k.text(st.text); (st.bullets || []).forEach(k.bullet); });
    const sp = cfg.servicePlan || {}; k.h1("5. Service Plan Summary"); if (sp.intro) k.text(sp.intro);
    if ((sp.rows || []).length) k.table(["Parameter", "Coverage", "Notes"], sp.rows, { columnStyles: { 0: { fontStyle: "bold", cellWidth: 160 }, 1: { cellWidth: 120 } } });
    const rp = cfg.response || {}; k.h1("6. Response & Restoration Commitments"); if (rp.intro) k.text(rp.intro);
    if ((rp.rows || []).length) k.table(["Priority", "Description", "Response", "Action Plan", "Restoration Target"], rp.rows, { columnStyles: { 0: { fontStyle: "bold", halign: "center", cellWidth: 52 }, 1: { fontStyle: "bold" }, 2: { halign: "center", cellWidth: 82 }, 3: { halign: "center", cellWidth: 82 }, 4: { halign: "center", cellWidth: 110 } } });
    if ((rp.workflow || []).length) { k.h2("Support Workflow"); rp.workflow.forEach(k.bullet); }
    const dc = cfg.documentation || {}; k.h1("7. Documentation Deliverables"); if (dc.intro) k.text(dc.intro);
    (dc.groups || []).forEach(g => { if (g.heading) k.h2(g.heading); if (g.text) k.text(g.text); (g.bullets || []).forEach(k.bullet); });
    const cm = cfg.commercial || {}; k.h1("8. Commercial Terms"); if (cm.intro) k.text(cm.intro);
    const rows = (cm.lineItems || []).map(li => [li.desc, li.amount]);
    const marks = [];
    if (cm.subtotal != null) { marks.push(rows.length); rows.push(["Subtotal", cm.subtotal]); }
    if (cm.vat != null) rows.push([cm.vatLabel || "VAT @ 5%", cm.vat]);
    const totalIdx = rows.length; if (cm.total != null) rows.push(["Total Contract Value (incl. VAT)", cm.total]);
    k.table(["Line Item", "Amount (AED)"], rows, { columnStyles: { 1: { halign: "right", cellWidth: 120 } }, didParseCell: d => {
      if (d.section !== "body") return;
      if (marks.includes(d.row.index)) { d.cell.styles.fontStyle = "bold"; d.cell.styles.fillColor = rgb(ALT); }
      if (d.row.index === totalIdx) { d.cell.styles.fontStyle = "bold"; d.cell.styles.fillColor = rgb(NAVY); d.cell.styles.textColor = [255, 255, 255]; } } });
    if ((cm.paymentTerms || []).length) { k.h2("Payment Terms"); cm.paymentTerms.forEach(k.bullet); }
    if ((cm.validity || []).length) { k.h2("Currency & Validity"); cm.validity.forEach(k.bullet); }
    const ex = cfg.exclusions || {}; k.h1("9. Exclusions, Assumptions & Liability");
    (ex.groups || []).forEach(g => { if (g.heading) k.h2(g.heading); if (g.text) k.text(g.text); (g.bullets || []).forEach(k.bullet); });
    const so = cfg.signoff || {}; k.h1("10. Acceptance & Sign-off"); if (so.intro) k.text(so.intro);
    if (so.period) k.text("Agreement Period:  " + so.period, { bold: true, after: 2 });
    if (so.plan) k.text("Service Plan:  " + so.plan, { bold: true, after: 2 });
    if (so.total) k.text("Total Contract Value:  " + so.total, { bold: true, after: 10 });
    if (so.governing) k.text(so.governing);
    pdfSign(k, ["For and on behalf of " + COMPANY.company, "For and on behalf of " + customer]);
    k.y += 16; k.text("- End of Proposal -", { italic: true, color: MUTE, size: 10 });
    k.chrome(true);
    return doc;
  }

  function pdfSign(k, titles, names) {
    const { doc, M, CWp } = k; k.need(130); k.y += 14;
    const w = (CWp - 24) / 2;
    titles.forEach((t, i) => {
      const x = M + i * (w + 24); let yy = k.y;
      doc.setDrawColor(...rgb("AFC7DB")); doc.setLineWidth(0.8); doc.line(x, yy, x + w, yy); yy += 18;
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...rgb(BLUE)); doc.splitTextToSize(P(t), w).forEach(l => { doc.text(l, x, yy); yy += 13; }); yy += 10;
      doc.setFont("helvetica", "normal"); doc.setTextColor(...rgb(DARK));
      ["Name:  " + s((names || [])[i]), "Title:", "Date:", "Signature & Stamp:"].forEach(l => { doc.text(P(l), x, yy); yy += 20; });
    });
    k.y += 120;
  }

  function pdfReportCover(k, img, kicker, big, sub, kv) {
    pdfCover(k, null, kicker, big, sub, null, k.TOP);
    k.table(null, kv, { columnStyles: { 0: { fontStyle: "bold", fillColor: rgb(GREY), cellWidth: 170 } } });
  }

  function visitPdf(jsPDF, v, ctx, img, photos) {
    const k = pdfKit(jsPDF, img, "Maintenance Report - " + s(v.customerName));
    pdfReportCover(k, img, "MAINTENANCE VISIT REPORT", visitKindTitle(v.type), s(v.customerName), visitKv(v, ctx));
    let n = 1;
    if (ctx.systems) { k.h1((n++) + ". Systems Covered"); lines(ctx.systems).forEach(k.bullet); }
    if ((v.checklist || []).length) {
      k.h1((n++) + ". Maintenance Checklist");
      k.table(["#", "Check Item", "Result", "Remarks"], v.checklist.map((c, i) => [String(i + 1), c.item, resultLabel(c.result), c.note || ""]), { columnStyles: { 0: { halign: "center", cellWidth: 26 }, 2: { halign: "center", cellWidth: 56 }, 3: { cellWidth: 180 } },
        didParseCell: d => { if (d.section === "body" && d.column.index === 2) { if (d.cell.raw === "Issue") { d.cell.styles.textColor = rgb(RED); d.cell.styles.fontStyle = "bold"; } else if (d.cell.raw === "OK") d.cell.styles.textColor = [31, 122, 77]; } } });
    }
    [["Findings & Observations", v.findings], ["Actions Taken", v.actions], ["Recommendations", v.recommendations]].forEach(([t, txt]) => { const ls = lines(txt); if (!ls.length) return; k.h1((n++) + ". " + t); ls.forEach(k.bullet); });
    if (photos && photos.length) {
      k.h1((n++) + ". Site Photographs");
      const { doc, M, CWp } = k; const w = (CWp - 18) / 2, maxH = 190;
      for (let i = 0; i < photos.length; i += 2) {
        const pair = photos.slice(i, i + 2);
        const dims = pair.map(p => { let pw = w, ph = w * p.h / p.w; if (ph > maxH) { ph = maxH; pw = maxH * p.w / p.h; } return { pw, ph }; });
        const rowH = Math.max(...dims.map(d => d.ph)) + 26; k.need(rowH);
        pair.forEach((p, j) => { const x = M + j * (w + 18) + (w - dims[j].pw) / 2; doc.addImage(p.dataUrl, "JPEG", x, k.y, dims[j].pw, dims[j].ph);
          doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(...rgb(MUTE));
          doc.text(doc.splitTextToSize(P("Photo " + (i + j + 1) + (p.caption ? " - " + p.caption : "")), w)[0], M + j * (w + 18) + w / 2, k.y + Math.max(...dims.map(d => d.ph)) + 13, { align: "center" }); });
        k.y += rowH;
      }
    }
    k.h1((n++) + ". Sign-off");
    k.text("Both parties confirm that the maintenance visit described in this report was carried out on the date stated and that the findings above were reviewed on site.");
    pdfSign(k, ["Bifold Technologies LLC - Engineer", "Customer Representative"], [v.engineers, v.customerRep]);
    k.chrome(false);
    return k.doc;
  }

  function contractPdf(jsPDF, c, visits, img) {
    const k = pdfKit(jsPDF, img, "Service Report - " + s(c.customerName));
    pdfReportCover(k, img, "CONTRACT SERVICE REPORT", "AMC Service History", s(c.customerName), contractKv(c, visits));
    const st = visitStats(visits);
    k.h1("1. Visit Summary");
    k.table(["Measure", "Count"], [["Visits scheduled in term", st.total], ["Completed", st.done], ["Upcoming", st.upcoming], ["Overdue (not completed)", st.overdue], ["Cancelled", st.cancelled]].map(r => [r[0], String(r[1])]), { columnStyles: { 1: { halign: "right", cellWidth: 90 } } });
    k.h1("2. Visit Register");
    if (visits.length) k.table(["Date", "Type", "Status", "Engineer(s)", "Report No."], visits.map(v => [fmtDate(v.scheduledDate), typeLabel(v.type), statusLabel(v), s(v.engineers), s(v.reportNo)]));
    else k.text("No visits have been recorded for this contract yet.");
    const withNotes = visits.filter(v => v.status === "completed" && (lines(v.findings).length || lines(v.recommendations).length));
    if (withNotes.length) { k.h1("3. Key Findings & Recommendations");
      withNotes.forEach(v => { k.h2(fmtDate(v.scheduledDate) + " - " + typeLabel(v.type)); lines(v.findings).forEach(k.bullet); lines(v.recommendations).forEach(x => k.bullet("Recommendation: " + x)); }); }
    k.chrome(false);
    return k.doc;
  }

  return { amcDocx, amcPdf, visitDocx, visitPdf, contractDocx, contractPdf, fmtDate, typeLabel, TYPES, COMPANY, lines };
})();
if (typeof module !== "undefined") module.exports = GEN;
