/* ===== Proposal Word files in the approved house styles =====
 * Tech Hub: the approved base template (cover, running header, footer with the six linked social icons) with the
 *   cover tokens filled and the body injected, ported from the techhub-proposal generator (build_body.py).
 * Bifold:   the bifold-proposal generator (generate_proposal.js) running in the browser on docx.js.
 * Both take the same config built by proposal.js, plus an optional diagram PNG. No em or en dashes anywhere.
 */
const BKPROPDOCX = (function () {
  "use strict";
  const LIB = { jszip: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js", docx: "https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js" };
  const loaded = {};
  const load = src => loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error("Couldn't load the Word library. Check your connection and try again.")); }; document.head.appendChild(s); }));
  // docx.js and docx-preview both register window.docx: load each one into its own name and put back what was there.
  const named = {};
  const unset = () => { try { delete window.docx; } catch { window.docx = undefined; } };
  function loadAs(src, name) {
    return named[name] || (named[name] = new Promise((res, rej) => { const prev = window.docx; unset(); const s = document.createElement("script"); s.src = src;
      s.onload = () => { window[name] = window.docx; if (prev) window.docx = prev; else unset(); res(window[name]); };
      s.onerror = () => { if (prev) window.docx = prev; delete named[name]; rej(new Error("Couldn't load the Word library. Check your connection and try again.")); }; document.head.appendChild(s); }));
  }
  const nd = v => (v == null ? "" : String(v)).replace(/\s*[—–]\s*/g, ", ");
  const arr = x => Array.isArray(x) ? x : x == null || x === "" ? [] : [x];
  const money = x => x === "" || x == null || !Number.isFinite(Number(x)) ? "TBD" : Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ------------------------------------------------------------------ Tech Hub ------------------------------------------------------------------ */
  const NAVY = "003C50", TEAL = "28A08C", GREY = "555555", LGREY = "999999", SUB = "F5F5F5", BORDER = "D0D0D0", WHITE = "FFFFFF", TEXT = "1A1A1A", CW = 9746;
  const x = t => nd(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function rpr(o = {}) {
    let s = "";
    if (o.bold) s += "<w:b/><w:bCs/>"; if (o.italic) s += "<w:i/><w:iCs/>"; if (o.color) s += `<w:color w:val="${o.color}"/>`;
    if (o.spacing != null) s += `<w:spacing w:val="${o.spacing}"/>`; if (o.sz) s += `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>`;
    return s ? `<w:rPr>${s}</w:rPr>` : "";
  }
  const run = (t, o) => `<w:r>${rpr(o)}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
  function para(inner, o = {}) {
    let p = "<w:pPr>";
    if (o.num != null) p += `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${o.num}"/></w:numPr>`;
    if (o.keepNext) p += "<w:keepNext/>";
    if (o.border) p += `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="0" w:color="${o.border}"/></w:pBdr>`;
    p += `<w:spacing w:before="${o.before || 0}" w:after="${o.after == null ? 120 : o.after}"${o.line ? ` w:line="${o.line}" w:lineRule="auto"` : ""}/>`;
    if (o.align) p += `<w:jc w:val="${o.align}"/>`;
    return `<w:p>${p}</w:pPr>${inner}</w:p>`;
  }
  const heading = t => para(run(t, { color: NAVY, bold: true, sz: 24, spacing: 80 }), { before: 260, after: 80, keepNext: true }) + para("", { after: 160, border: TEAL, keepNext: true });
  const subheading = t => para(run(t, { color: NAVY, bold: true, sz: 21 }), { before: 160, after: 60, keepNext: true });
  const bodyP = (t, grey) => para(run(t, { color: grey ? LGREY : TEXT, sz: 20 }), { after: 100, line: 264 });
  const bullet = t => para(run(t, { color: TEXT, sz: 20 }), { after: 60, line: 252, num: 2 });
  const tcb = (c = BORDER) => "<w:tcBorders>" + ["top", "left", "bottom", "right"].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="${c}"/>`).join("") + "</w:tcBorders>";
  function cell(t, w, o = {}) {
    let p = `<w:tcW w:w="${w}" w:type="dxa"/>`;
    if (o.span) p += `<w:gridSpan w:val="${o.span}"/>`;
    p += o.accent ? `<w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="${BORDER}"/><w:left w:val="single" w:sz="24" w:space="0" w:color="${o.accent}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${BORDER}"/><w:right w:val="single" w:sz="4" w:space="0" w:color="${BORDER}"/></w:tcBorders>` : tcb();
    if (o.fill) p += `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>`;
    const v = o.vmar || 70;
    p += `<w:tcMar><w:top w:w="${v}" w:type="dxa"/><w:left w:w="130" w:type="dxa"/><w:bottom w:w="${v}" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/>`;
    const inner = o.paras != null ? o.paras : para(run(t, { color: o.color || TEXT, bold: o.bold, italic: o.italic, sz: o.sz || 20 }), { after: 0, align: o.align });
    return `<w:tc><w:tcPr>${p}</w:tcPr>${inner}</w:tc>`;
  }
  const row = (cells, head) => `<w:tr>${head ? "<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>" : "<w:trPr><w:cantSplit/></w:trPr>"}${cells.join("")}</w:tr>`;
  function table(grid, rows) {
    const g = grid.map(w => `<w:gridCol w:w="${w}"/>`).join("");
    const b = ["top", "left", "bottom", "right", "insideH", "insideV"].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="${BORDER}"/>`).join("");
    return `<w:tbl><w:tblPr><w:tblW w:w="${grid.reduce((a, c) => a + c, 0)}" w:type="dxa"/><w:tblBorders>${b}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="0"/></w:tblPr><w:tblGrid>${g}</w:tblGrid>${rows.join("")}</w:tbl>` + para("", { after: 40 });
  }
  const H = (t, w, align) => cell(t, w, { fill: NAVY, color: WHITE, bold: true, align });
  function secScope(boq) {
    const g = [520, 5200, 2400, 1626]; const rows = [row([H("#", g[0], "center"), H("Description", g[1]), H("Brand / Model", g[2]), H("Qty / Unit", g[3], "center")], true)]; let n = 0;
    boq.sections.forEach(sec => {
      if (sec.title) rows.push(row([cell(sec.title, CW, { span: 4, fill: SUB, bold: true, color: NAVY })]));
      sec.items.forEach(it => { const sub = it.italic; if (!sub) n++; const f = sub ? SUB : null;
        rows.push(row([cell(sub ? "" : String(n), g[0], { align: "center", fill: f }), cell(it.description, g[1], { italic: sub, color: sub ? GREY : TEXT, fill: f }), cell(it.model, g[2], { color: sub ? GREY : TEXT, fill: f }), cell(it.qtyUnit, g[3], { align: "center", fill: f })])); });
    });
    return table(g, rows);
  }
  function secPricing(boq) {
    const g = [480, 2150, 3216, 600, 1500, 1800]; const rows = [row([H("#", g[0], "center"), H("Part No.", g[1]), H("Item / Service", g[2]), H("Qty", g[3], "center"), H("Unit (AED)", g[4], "right"), H("Total (AED)", g[5], "right")], true)]; let n = 0;
    boq.sections.forEach(sec => {
      if (sec.title) rows.push(row([cell(sec.title, CW, { span: 6, fill: SUB, bold: true, color: NAVY })]));
      sec.items.forEach(it => { const sub = it.italic; if (!sub) n++; const f = sub ? SUB : null, c = sub ? GREY : TEXT;
        rows.push(row([cell(sub ? "" : String(n), g[0], { align: "center", fill: f }), cell(it.partNo || "", g[1], { bold: !sub, sz: 16, color: c, fill: f }), cell(it.priceLabel || it.description, g[2], { italic: sub, color: c, fill: f }), cell(String(it.qty), g[3], { align: "center", italic: sub, color: c, fill: f }),
          cell(money(it.unit), g[4], { align: "right", italic: sub, color: c, fill: f }), cell(money(it.total), g[5], { align: "right", bold: !sub, italic: sub, color: sub ? GREY : NAVY, fill: f })])); });
    });
    const span = g[0] + g[1] + g[2] + g[3] + g[4];
    const tr = (l, v, navy) => row([cell(l, span, { span: 5, fill: navy ? NAVY : SUB, bold: true, color: navy ? WHITE : NAVY, align: "right" }), cell(v, g[5], { fill: navy ? NAVY : SUB, bold: true, color: navy ? WHITE : NAVY, align: "right" })]);
    rows.push(tr("Sub-Total (Excl. VAT)", "AED " + money(boq.subTotal)), tr(`VAT (${boq.vatRate}%)`, "AED " + money(boq.vat)));
    if (boq.discount) rows.splice(rows.length - 2, 0, tr("Discount", "AED " + money(-boq.discount)));
    rows.push(tr("TOTAL INVESTMENT (INCL. VAT)", "AED " + money(boq.total), true));
    return table(g, rows);
  }
  const kv = (rows, w1 = 3000) => table([w1, CW - w1], rows.map(r => row([cell(r[0], w1, { bold: true, color: NAVY }), cell(r[1], CW - w1, { color: GREY, italic: true })])));
  function secTimeline(tl) {
    const g = [1100, 4646, 2000, 2000]; const rows = [row([H("Phase", g[0], "center"), H("Activity", g[1]), H("Duration", g[2], "center"), H("Responsible", g[3], "center")], true)];
    tl.phases.forEach((p, i) => rows.push(row([cell(String(i + 1), g[0], { align: "center" }), cell(p.activity, g[1]), cell(p.duration, g[2], { align: "center", italic: true, color: TEAL }), cell(p.responsible, g[3], { align: "center" })])));
    if (tl.total) rows.push(row([cell("Estimated Total Project Duration", g[0] + g[1] + g[2], { span: 3, fill: SUB, bold: true, color: NAVY }), cell(tl.total, g[3], { fill: SUB, bold: true, color: TEAL, align: "center", italic: true })]));
    return table(g, rows);
  }
  function secCards(cards) {
    const half = Math.floor(CW / 2), out = [];
    const none = `<w:tc><w:tcPr><w:tcW w:w="${half}" w:type="dxa"/><w:tcBorders>${["top", "left", "bottom", "right"].map(s => `<w:${s} w:val="none" w:sz="0" w:space="0" w:color="FFFFFF"/>`).join("")}</w:tcBorders></w:tcPr>${para("", { after: 0 })}</w:tc>`;
    for (let i = 0; i < cards.length; i += 2) {
      const cells = cards.slice(i, i + 2).map(c => cell("", half, { accent: TEAL, vmar: 180, paras: para(run(c.title, { color: NAVY, bold: true, sz: 22 }), { before: 20, after: 60 }) + para(run(c.body, { color: GREY, sz: 19 }), { after: 20, line: 252 }) }));
      if (cells.length === 1) cells.push(none);
      out.push(row(cells)); if (i + 2 < cards.length) out.push(`<w:tr>${none}${none}</w:tr>`);
    }
    return table([half, half], out);
  }
  function image(rid, w, h, name) {
    const cx = Math.round(w * 9525), cy = Math.round(h * 9525);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="901" name="${x(name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="901" name="${x(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
  function thBody(c, img) {
    const P = [], sol = c.solution, cu = c.clientUnderstanding;
    let n = 0; const sec = t => P.push(heading(`${++n}. ${t}`));
    let sub = 0; const sh = t => P.push(subheading(`${n}.${++sub} ${t}`));
    sec("EXECUTIVE SUMMARY"); arr(c.executiveSummary).forEach((t, i) => P.push(bodyP(t, i > 0)));
    if (cu.background.length || cu.scope.length || cu.assumptions.length || cu.exclusions.length) {
      sec("CLIENT UNDERSTANDING & SCOPE OF WORK"); sub = 0;
      if (cu.background.length) { sh("Background"); cu.background.forEach(t => P.push(bodyP(t))); }
      if (cu.scope.length) { sh("Key Requirements"); cu.scope.forEach(t => P.push(bullet(t))); }
      if (cu.assumptions.length || cu.exclusions.length) { sh("Assumptions & Exclusions"); cu.assumptions.forEach(t => P.push(bodyP(t, true))); cu.exclusions.forEach(t => P.push(bullet(t))); }
    }
    sec("PROPOSED SOLUTION"); sub = 0;
    if (sol.overview.length || img) { sh("Solution Overview"); sol.overview.forEach(t => P.push(bodyP(t))); }
    if (img) { P.push(para(image("rIdDiag1", img.w, img.h, "Solution figure"), { align: "center", before: 80, after: 60, keepNext: true })); P.push(para(run(c.diagram.caption || "Figure 1 - Logical network topology.", { color: GREY, italic: true, sz: 18 }), { align: "center", after: 160 })); }
    sh("Scope of Supply & Services"); P.push(secScope(sol.boq));
    if (sol.specs.length) { sh("Technical Specifications"); sol.specs.forEach(t => P.push(bodyP(t, true))); }
    sec("COMMERCIAL OFFER"); sub = 0;
    sh("Pricing Summary"); P.push(secPricing(sol.boq));
    sh("Payment Terms"); P.push(kv(c.commercial.paymentTerms.length ? c.commercial.paymentTerms : [["Advance Payment", "100% upon Purchase Order / Proforma Invoice"]]));
    if (c.timeline.phases.length) { sec("PROJECT DELIVERY TIMELINE"); P.push(secTimeline(c.timeline)); }
    if (c.warranty.length) { sec("WARRANTY & AFTER-SALES SUPPORT"); P.push(kv(c.warranty)); }
    if (c.terms.length) { sec("TERMS & CONDITIONS"); c.terms.forEach(t => P.push(bullet(t))); if (c.termsNote) P.push(bodyP(c.termsNote, true)); }
    if (c.whyTechHub.length) { sec("WHY TECH HUB"); P.push(secCards(c.whyTechHub)); }
    P.push(para(run(c.closing || `Thank you for considering Tech Hub for your IT needs. We look forward to a successful partnership with ${c.meta.client}.`, { color: GREY, italic: true, sz: 20 }), { before: 240, after: 80, align: "center" }));
    P.push(para(run(c.contactLine || "Tech Hub Information Technology  ·  sales@techhubrak.ae  ·  +971 07 258 1926  ·  www.techhubrak.ae", { color: NAVY, bold: true, sz: 19 }), { after: 0, align: "center" }));
    return P.join("\n");
  }
  async function techhub(c, img) {
    await load(LIB.jszip);
    const r = await fetch("/books/techhub_proposal_base.docx", { cache: "force-cache" }); if (!r.ok) throw new Error("The Tech Hub proposal template couldn't be loaded.");
    const zip = await window.JSZip.loadAsync(await r.arrayBuffer());
    let doc = await zip.file("word/document.xml").async("string");
    const m = c.meta;
    const tok = { "{{TITLE}}": m.title || "Commercial Proposal", "{{CLIENT}}": m.client, "{{PROPOSAL_NO}}": m.proposalNo, "{{DATE}}": m.date, "{{PREPARED_FOR}}": m.preparedFor || m.client, "{{PREPARED_BY}}": m.preparedBy || "Tech Hub Information Technology", "{{VALID_UNTIL}}": m.validUntil };
    Object.entries(tok).forEach(([k, v]) => { doc = doc.split(k).join(x(v || "")); });
    const at = doc.lastIndexOf("<w:sectPr"); if (at < 0) throw new Error("The proposal template is damaged.");
    doc = doc.slice(0, at) + thBody(c, img) + "\n" + doc.slice(at);
    zip.file("word/document.xml", doc);
    if (img) {
      zip.file("word/media/diagram1.png", img.bytes, { createFolders: false });
      let rels = await zip.file("word/_rels/document.xml.rels").async("string");
      rels = rels.replace("</Relationships>", `<Relationship Id="rIdDiag1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/diagram1.png"/></Relationships>`);
      zip.file("word/_rels/document.xml.rels", rels);
    }
    return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
  }

  /* ------------------------------------------------------------------- Bifold ------------------------------------------------------------------- */
  async function bifold(cfg, img) {
    const DX = await loadAs(LIB.docx, "DOCXJS");
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak, ImageRun, LevelFormat, TabStopType, SectionType, PageOrientation } = DX;
    const NV = "1E5A8C", RED = "D81F2A", GR = "F2F3F5", GRL = "EAECEF", WH = "FFFFFF", BG = "CCCCCC";
    const PAGE_W = 11906, MARGIN = 1080, W = PAGE_W - MARGIN * 2;
    const co = cfg.company;
    let logo = null;
    try { const r = await fetch("/assets/bifold_logo.png", { cache: "force-cache" }); if (r.ok) { const b = new Uint8Array(await r.arrayBuffer()); const dv = new DataView(b.buffer); logo = { data: b, w: dv.getUint32(16), h: dv.getUint32(20) }; } } catch {}
    const txt = (t, o = {}) => new TextRun({ text: nd(t), font: "Arial", size: o.size || 20, bold: !!o.bold, italics: !!o.italics, color: o.color || "222222" });
    const para2 = (runs, o = {}) => new Paragraph({ children: Array.isArray(runs) ? runs : [runs], alignment: o.align, spacing: { before: o.before ?? 60, after: o.after ?? 120, line: 264 }, border: o.border, keepNext: o.keepNext });
    const secH = (num, t) => new Paragraph({ spacing: { before: 300, after: 140 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: RED, space: 4 } }, keepNext: true,
      children: [new TextRun({ text: `${num}.  `, font: "Arial", size: 26, bold: true, color: RED }), new TextRun({ text: nd(t), font: "Arial", size: 26, bold: true, color: NV })] });
    const bl = t => new Paragraph({ numbering: { reference: "bl", level: 0 }, spacing: { before: 40, after: 40, line: 264 }, children: [txt(t)] });
    const thin = { style: BorderStyle.SINGLE, size: 1, color: BG }, cb = { top: thin, bottom: thin, left: thin, right: thin };
    const cl = (content, o = {}) => new TableCell({ borders: cb, width: { size: o.width, type: WidthType.DXA }, shading: o.fill ? { fill: o.fill, type: ShadingType.CLEAR, color: "auto" } : undefined, verticalAlign: VerticalAlign.CENTER, columnSpan: o.span,
      margins: { top: 60, bottom: 60, left: 110, right: 110 }, children: [new Paragraph({ alignment: o.align, spacing: { before: 20, after: 20, line: 248 }, children: [content] })] });
    const kvT = (rows, lw = Math.round(W * 0.34)) => new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [lw, W - lw], rows: rows.map(([k, v]) => new TableRow({ cantSplit: true, children: [cl(txt(k, { bold: true, color: NV }), { width: lw, fill: GR }), cl(txt(v), { width: W - lw })] })) });
    const m = cfg.meta;
    const mkHeader = W => new Header({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: W }], spacing: { after: 0 }, border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: NV, space: 6 } },
      children: logo ? [new ImageRun({ type: "png", data: logo.data, transformation: { width: Math.round(logo.w * 46 / logo.h), height: 46 } }), new TextRun({ text: "\t" + nd(m.title), font: "Arial", size: 16, color: "777777" })]
        : [new TextRun({ text: "BIFOLD ", font: "Arial", size: 22, bold: true, color: NV }), new TextRun({ text: "TECHNOLOGIES", font: "Arial", size: 22, bold: true, color: RED }), new TextRun({ text: "\t" + nd(m.title), font: "Arial", size: 16, color: "777777" })] })] });
    const fr = t => new TextRun({ text: t, font: "Arial", size: 14, color: "888888" });
    const mkFooter = W => new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: W }], spacing: { before: 4 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: BG, space: 6 } },
      children: [fr(co.addressLine + "  |  Confidential"), fr("\tPage "), new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 14, color: "888888" }), fr(" of "), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Arial", size: 14, color: "888888" })] })] });
    // cover
    const cover = [];
    if (logo) cover.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 320 }, children: [new ImageRun({ type: "png", data: logo.data, transformation: { width: Math.round(logo.w * 70 / logo.h), height: 70 } })] }));
    const band = (t, o) => new Paragraph({ shading: { fill: NV, type: ShadingType.CLEAR, color: "auto" }, spacing: { before: o.before || 0, after: o.after || 80 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: nd(t), font: "Arial", size: o.size, bold: !!o.bold, italics: !!o.italics, color: o.color, characterSpacing: o.cs })] });
    cover.push(band("COMMERCIAL PROPOSAL", { before: 600, size: 30, bold: true, color: WH, cs: 40 }), band(m.version || "v.01", { size: 18, color: "AEB7C7" }), band("FOR " + nd(m.client).toUpperCase(), { size: 22, bold: true, color: WH }), band(m.title, { size: 24, bold: true, color: WH, after: 120 }));
    if (m.tagline) cover.push(band(m.tagline, { size: 18, italics: true, color: "C9D2E0", after: 120 }));
    cover.push(band(m.subtitle || "Supply, Installation & Commissioning", { size: 18, italics: true, color: "C9D2E0", after: 600 }));
    cover.push(new Paragraph({ spacing: { before: 0, after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: RED, space: 1 } }, children: [txt("")] }));
    cover.push(kvT([["Date", m.date], ["Document Ref", m.docRef], ["Validity", m.validity], ["Prepared by", m.preparedBy], ["Email", m.email], ["Mobile", m.mobile]].filter(r => r[1]), Math.round(W * 0.30)));
    cover.push(new Paragraph({ spacing: { before: 360, after: 40 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: co.name, font: "Arial", size: 22, bold: true, color: NV })] }));
    cover.push(new Paragraph({ spacing: { after: 0 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: [co.phone, co.email, co.website].filter(Boolean).join("   ·   "), font: "Arial", size: 16, color: "777777" })] }));
    // body
    const k = []; let n = 0;
    const L = cfg.letter || {};
    if (cfg.letter !== false) {
      k.push(para2(txt(m.date, { color: "555555" }), { align: AlignmentType.RIGHT, before: 120, after: 180 }));
      k.push(para2(txt("To,", { bold: true, color: NV }), { before: 0, after: 20 }), para2(txt(m.client, { bold: true }), { before: 0, after: L.attention ? 0 : 10 }));
      if (L.attention) k.push(para2(txt(L.attention, { color: "555555" }), { before: 0, after: 10 }));
      k.push(para2([new TextRun({ text: "Subject:  ", font: "Arial", size: 20, bold: true, color: NV }), new TextRun({ text: nd(L.subject || "Commercial Proposal: " + m.title), font: "Arial", size: 20, bold: true, color: "222222" })], { before: 160, after: 160, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "DCE2E8", space: 6 } } }));
      k.push(para2(txt(L.salutation || "Dear Sir / Madam,"), { before: 60, after: 140 }));
      arr(L.body).forEach(p => k.push(para2(txt(p), { after: 130 })));
      k.push(para2(txt("We look forward to the opportunity of working with you."), { before: 40, after: 220 }), para2(txt("Yours sincerely,"), { before: 0, after: 60 }));
      k.push(para2(txt((L.signatory || {}).name || m.preparedBy, { bold: true, color: NV }), { before: 220, after: 0 }), para2(txt((L.signatory || {}).title || "Sales & Business Development", { color: "555555", size: 18 }), { before: 0, after: 0 }), para2(txt(co.name, { color: "555555", size: 18 }), { before: 0, after: 0 }));
      const ct = [m.mobile || co.phone, m.email || co.email].filter(Boolean).join("   ·   "); if (ct) k.push(para2(txt(ct, { color: "555555", size: 18 }), { before: 0, after: 0 }));
      k.push(new Paragraph({ children: [new PageBreak()] }));
    }
    n++; k.push(secH(n, "Project Overview")); arr(cfg.overview).forEach(p => k.push(para2(txt(p))));
    if (cfg.solutionBrief) { n++; k.push(secH(n, "Solution Brief")); if (cfg.solutionBrief.intro) k.push(para2(txt(cfg.solutionBrief.intro))); arr(cfg.solutionBrief.pillars).forEach(p => k.push(bl(p)));
      if ((cfg.solutionBrief.summary || []).length) { k.push(para2(txt("Solution Summary:", { bold: true, color: NV }), { before: 160, after: 80, keepNext: true })); k.push(kvT(cfg.solutionBrief.summary, Math.round(W * 0.32))); } }
    // The architecture drawing gets its own landscape page, like the house template.
    const land = [];
    if (img) {
      n++; land.push(secH(n, "Solution Architecture Diagram"));
      if (cfg.diagramIntro) land.push(para2(txt(cfg.diagramIntro, { size: 19 }), { after: 100 }));
      const w = Math.min(960, img.w), h0 = Math.round(img.h * w / img.w), h = Math.min(h0, 500), ww = Math.round(w * h / h0);
      land.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 }, keepNext: true, children: [new ImageRun({ type: "png", data: img.bytes, transformation: { width: ww, height: h } })] }));
      land.push(para2(txt(cfg.diagram.caption || `Figure 1: ${m.client} ${m.title}, high-level architecture`, { italics: true, color: "555555", size: 18 }), { align: AlignmentType.CENTER }));
    }
    const k1 = k.splice(0, k.length);
    if (cfg.products.length) {
      n++; k.push(secH(n, "Product Descriptions"));
      cfg.products.forEach((pr, i) => { k.push(new Paragraph({ spacing: { before: 220, after: 80 }, keepNext: true, children: [new TextRun({ text: `${n}.${i + 1}  `, font: "Arial", size: 22, bold: true, color: RED }), new TextRun({ text: nd(pr.title) + (pr.code ? `  (${nd(pr.code)})` : ""), font: "Arial", size: 22, bold: true, color: NV })] }));
        arr(pr.description).forEach(d => k.push(para2(txt(d)))); if (pr.specs && pr.specs.length) k.push(kvT(pr.specs)); });
    }
    // BoQ
    n++; k.push(secH(n, "Pricing: Bill of Quantities"));
    k.push(para2(txt(cfg.boq.intro || "All prices are in AED. VAT at 5% is shown separately.", { italics: true, color: "555555", size: 18 })));
    { const cIt = 800, cQ = 700, cU = 1300, cT = 1700, cD = W - cIt - cQ - cU - cT; const rows = [];
      const hd = t => txt(t, { bold: true, color: WH });
      rows.push(new TableRow({ tableHeader: true, children: [cl(hd("Item#"), { width: cIt, fill: NV }), cl(hd("Description"), { width: cD, fill: NV }), cl(hd("Qty"), { width: cQ, fill: NV, align: AlignmentType.CENTER }), cl(hd("Unit AED"), { width: cU, fill: NV, align: AlignmentType.RIGHT }), cl(hd("Total AED"), { width: cT, fill: NV, align: AlignmentType.RIGHT })] }));
      cfg.boq.sections.forEach(sec => {
        if (sec.title) rows.push(new TableRow({ children: [cl(txt(sec.title, { bold: true, color: NV }), { span: 5, width: W, fill: GRL })] }));
        sec.items.forEach(it => { const i_ = it.italic, c = i_ ? "666666" : "222222";
          rows.push(new TableRow({ cantSplit: true, children: [cl(txt(it.ref, { italics: i_, color: c, bold: !i_ }), { width: cIt, align: AlignmentType.CENTER }), cl(txt(it.description, { italics: i_, color: c }), { width: cD }),
            cl(txt(it.qty, { italics: i_, color: c }), { width: cQ, align: AlignmentType.CENTER }), cl(txt(it.unit, { italics: i_, color: c }), { width: cU, align: AlignmentType.RIGHT }), cl(txt(it.total, { italics: i_, color: c, bold: !i_ }), { width: cT, align: AlignmentType.RIGHT })] })); });
      });
      const t = cfg.boq.totals; const tr = (l, v, fill, col) => new TableRow({ children: [cl(txt(l, { bold: true, color: col || NV }), { span: 4, width: W - cT, fill, align: AlignmentType.RIGHT }), cl(txt(v, { bold: true, color: col || NV }), { width: cT, fill, align: AlignmentType.RIGHT })] });
      rows.push(tr("Total AED (Excluding VAT)", t.exVat, GR), tr("VAT " + t.vatRate, t.vat, GR), tr("Total Project (Including VAT)", t.incVat, NV, WH));
      k.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [cIt, cD, cQ, cU, cT], rows })); }
    if (cfg.payment.length) { n++; k.push(secH(n, "Payment Terms")); k.push(kvT(cfg.payment)); }
    if (cfg.terms.length) { n++; k.push(secH(n, "Terms & Conditions")); k.push(kvT(cfg.terms, Math.round(W * 0.30))); }
    if (cfg.projectManagement.responsibilities.length) { n++; k.push(secH(n, "Project Management")); k.push(para2(txt(cfg.projectManagement.intro))); cfg.projectManagement.responsibilities.forEach(r => k.push(bl(r))); }
    if (cfg.implementation.phases.length) {
      n++; k.push(secH(n, "Project Implementation Plan")); if (cfg.implementation.intro) k.push(para2(txt(cfg.implementation.intro)));
      const weeks = Math.max(1, Math.min(16, cfg.implementation.weeks || 7)), pw = Math.round(W * 0.40), ww = Math.floor((W - pw) / weeks);
      const rows = [new TableRow({ tableHeader: true, children: [cl(txt("Phase", { bold: true, color: WH }), { width: pw, fill: NV }), ...Array.from({ length: weeks }, (_, i) => cl(txt("Wk " + (i + 1), { bold: true, color: WH, size: 16 }), { width: ww, fill: NV, align: AlignmentType.CENTER }))] })];
      cfg.implementation.phases.forEach(ph => { const on = new Set(arr(ph.active).map(Number)); rows.push(new TableRow({ cantSplit: true, children: [cl(txt(ph.name, { size: 18 }), { width: pw }), ...Array.from({ length: weeks }, (_, i) => cl(txt(on.has(i + 1) ? "■" : "", { color: RED }), { width: ww, align: AlignmentType.CENTER, fill: on.has(i + 1) ? "DCE3EA" : undefined }))] })); });
      k.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [pw, ...Array(weeks).fill(ww)], rows }));
      k.push(para2([new TextRun({ text: "■ ", font: "Arial", size: 18, color: RED }), new TextRun({ text: "Active phase", font: "Arial", size: 16, color: "777777" })], { before: 80 }));
    }
    if (cfg.exclusions.items.length) { n++; k.push(secH(n, "Exclusions & Client Responsibilities")); k.push(para2(txt(cfg.exclusions.intro))); cfg.exclusions.items.forEach(i => k.push(bl(i))); }
    k.push(new Paragraph({ spacing: { before: 360 }, alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 8, color: NV, space: 8 } },
      children: [new TextRun({ text: co.name + "  |  ", font: "Arial", size: 18, bold: true, color: NV }), new TextRun({ text: "End of Proposal", font: "Arial", size: 18, italics: true, color: "777777" })] }));
    const page = { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 1100, right: MARGIN, bottom: 1000, left: MARGIN } } };
    const doc = new Document({ styles: { default: { document: { run: { font: "Arial", size: 20 } } } },
      numbering: { config: [{ reference: "bl", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { run: { color: RED }, paragraph: { indent: { left: 460, hanging: 240 } } } }] }] },
      sections: [{ properties: { ...page }, children: cover },
        { properties: { ...page, type: SectionType.NEXT_PAGE }, headers: { default: mkHeader(W) }, footers: { default: mkFooter(W) }, children: k1 },
        ...(land.length ? [{ properties: { type: SectionType.NEXT_PAGE, page: { size: { orientation: PageOrientation.LANDSCAPE, width: PAGE_W, height: 16838 }, margin: { top: 900, right: MARGIN, bottom: 800, left: MARGIN } } }, headers: { default: mkHeader(16838 - 2 * MARGIN) }, footers: { default: mkFooter(16838 - 2 * MARGIN) }, children: land }] : []),
        { properties: { ...page, type: SectionType.NEXT_PAGE }, headers: { default: mkHeader(W) }, footers: { default: mkFooter(W) }, children: k }] });
    return Packer.toBlob(doc);
  }

  return { techhub, bifold, load, loadAs, LIB };
})();
