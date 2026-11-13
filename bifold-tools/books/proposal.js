/* ===== Proposals: a quotation sent as a full commercial proposal =====
 * Same customer, lines and totals as the quotation, plus written sections (executive summary, requirements,
 * solution, product descriptions, timeline, warranty, terms) and a solution diagram. The customer's BoQ can be
 * imported from Excel, CSV, PDF, a photo or pasted text, and Claude can draft every section and the diagram.
 * Prices always come from the lines, never from Claude. Word output in the Tech Hub or Bifold house style.
 */
const BKPROP = (function () {
  "use strict";
  const B = () => window.BK;
  const esc = s => B().esc(s);
  const nd = v => (v == null ? "" : String(v)).replace(/\s*[—–]\s*/g, ", ");
  const r2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
  const num = v => { const n = Number(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const longDate = iso => { if (!iso) return ""; const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`; };
  const DIA = () => (typeof PCRDIAGRAM !== "undefined" ? PCRDIAGRAM : window.PCRDIAGRAM) || null;
  const isTH = () => (B().brand() || {}).key === "techhub";

  /* ---------- text <-> fields (one paragraph per blank line, one bullet or row per line) ---------- */
  const paras = t => String(t || "").split(/\n\s*\n/).map(s => s.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  const linesOf = t => String(t || "").split(/\n/).map(s => s.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);
  const kvOf = t => linesOf(t).map(l => { const i = l.indexOf(":"); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : ["", l]; });
  const kvText = rows => (rows || []).map(r => r[0] ? `${r[0]}: ${r[1]}` : r[1]).join("\n");
  const prodText = list => (list || []).map(p => [p.title + (p.code ? ` (${p.code})` : ""), Array.isArray(p.description) ? p.description.join(" ") : p.description || "", ...(p.specs || []).map(s => `${s[0]}: ${s[1]}`)].filter(Boolean).join("\n")).join("\n\n");
  const prodOf = t => String(t || "").split(/\n\s*\n/).map(b => { const L = b.split("\n").map(s => s.trim()).filter(Boolean); if (!L.length) return null; const m = L[0].match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    const rest = L.slice(1); const specs = rest.filter(l => /^[^:]{1,40}:\s*\S/.test(l)).map(l => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; });
    return { title: m ? m[1] : L[0], code: m ? m[2] : "", description: rest.filter(l => !/^[^:]{1,40}:\s*\S/.test(l)).join(" "), specs }; }).filter(Boolean);
  const tlText = tl => (tl && tl.phases || []).map(p => [p.activity, p.duration, p.responsible, (p.weeks || []).length ? "weeks " + compactWeeks(p.weeks) : ""].join(" | ").replace(/( \| )+$/, "")).join("\n");
  function compactWeeks(w) { const a = [...new Set(w.map(Number))].sort((x, y) => x - y); const out = []; let s = a[0], p = a[0]; for (let i = 1; i <= a.length; i++) { if (a[i] === p + 1) { p = a[i]; continue; } out.push(s === p ? `${s}` : `${s}-${p}`); s = p = a[i]; } return out.join(","); }
  const weeksOf = t => { const out = []; String(t || "").replace(/weeks?/i, "").split(",").forEach(part => { const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/); if (m) { const a = +m[1], b = +(m[2] || m[1]); for (let i = a; i <= b && i < 60; i++) out.push(i); } }); return out; };
  const tlOf = (t, total, weeks) => ({ phases: linesOf(t).map(l => { const c = l.split("|").map(s => s.trim()); return { activity: c[0] || "", duration: c[1] || "", responsible: c[2] || "", weeks: weeksOf(c[3]) }; }), total: total || "", weeks: Number(weeks) || 0 });
  const whyText = w => (w || []).map(c => `${c.title}: ${c.body}`).join("\n");
  const whyOf = t => kvOf(t).map(([k, v]) => ({ title: k || v, body: k ? v : "" }));

  /* ---------- the panel inside the quotation editor ---------- */
  let P = {}, CTX = null;
  const FIELDS = [
    ["Cover", [["title", "Proposal title (the solution name on the cover)", "input"], ["tagline", "Tagline (e.g. Wi-Fi 7  |  Core Switching  |  IP DECT)", "input"]]],
    ["1. Executive summary", [["summary", "Paragraphs (leave a blank line between paragraphs). The first should state what we propose and the total.", 5]]],
    ["2. Customer requirements", [["background", "Background (paragraphs)", 3], ["requirements", "Key requirements (one per line)", 4], ["assumptions", "Assumptions (paragraphs)", 3], ["exclusions", "Exclusions (one per line)", 4]]],
    ["3. Proposed solution", [["overview", "Solution overview (paragraphs)", 4], ["products", "Product descriptions: one block per product; first line is the name with the part number in brackets, then a sentence, then \"Spec: value\" lines. Blank line between products.", 8]]],
    ["4. Commercial", [["payment", "Payment terms (one per line, \"Label: value\")", 3], ["warranty", "Warranty and support (\"Label: value\")", 3], ["terms", "Terms and conditions (\"Label: value\" or a sentence per line)", 5]]],
    ["5. Delivery", [["timeline", "Timeline: one phase per line as \"Activity | duration | responsible | weeks 1-2\"", 5], ["tlTotal", "Total duration (e.g. 6 Weeks)", "input"], ["responsibilities", "What our project team does (one per line)", 4]]],
    ["6. Why us", [["why", "Cards, one per line as \"Title: one sentence\"", 4]]],
  ];
  const toField = k => ({ summary: () => (P.summary || []).join("\n\n"), background: () => (P.background || []).join("\n\n"), assumptions: () => (P.assumptions || []).join("\n\n"), overview: () => (P.overview || []).join("\n\n"),
    requirements: () => (P.requirements || []).join("\n"), exclusions: () => (P.exclusions || []).join("\n"), responsibilities: () => (P.responsibilities || []).join("\n"),
    products: () => prodText(P.products), payment: () => kvText(P.payment), warranty: () => kvText(P.warranty), terms: () => kvText(P.terms), timeline: () => tlText(P.timeline), tlTotal: () => (P.timeline || {}).total || "",
    why: () => whyText(P.why), title: () => P.title || "", tagline: () => P.tagline || "" }[k] || (() => ""))();
  function fromFields(root) {
    const v = k => (root.querySelector(`[data-pf="${k}"]`) || {}).value || "";
    Object.assign(P, { title: v("title").trim(), tagline: v("tagline").trim(), summary: paras(v("summary")), background: paras(v("background")), requirements: linesOf(v("requirements")), assumptions: paras(v("assumptions")),
      exclusions: linesOf(v("exclusions")), overview: paras(v("overview")), products: prodOf(v("products")), payment: kvOf(v("payment")), warranty: kvOf(v("warranty")), terms: kvOf(v("terms")),
      timeline: tlOf(v("timeline"), v("tlTotal").trim(), (P.timeline || {}).weeks), responsibilities: linesOf(v("responsibilities")), why: whyOf(v("why")), notes: v("notes") });
    return P;
  }

  function panel(d) {
    P = JSON.parse(JSON.stringify(d.proposal || {}));
    const ai = B().D.ai;
    return `<section class="panel prop" id="propBox">
      <div class="prophd"><div><b>Proposal</b><span class="hint" style="margin:0">Uses the customer, lines and totals above. Word file in the ${isTH() ? "Tech Hub" : "Bifold"} proposal format, with a solution diagram.</span></div></div>
      <div class="propai">
        <label><span class="lbl">About the customer and the requirement (for Claude)</span><textarea data-pf="notes" rows="3" maxlength="5000" placeholder="e.g. 4-floor office in Al Hamra, 120 users, replacing old Wi-Fi 5, needs guest network and PoE for 30 IP phones, go-live before Ramadan">${esc(P.notes || "")}</textarea></label>
        <div class="propbtns"><button type="button" class="primary" id="pDraft"${ai ? "" : " disabled title=\"Claude isn't set up on the tools site yet\""}>${(P.summary || []).length ? "Redraft all sections with Claude" : "Draft the proposal with Claude"}</button><span class="hint" id="pStat" style="margin:0">${ai ? "Import the customer's BoQ first (the button under the lines), then let Claude write the sections and draw the diagram. Prices stay exactly as in the lines." : "Claude drafting needs the ANTHROPIC_API_KEY setting on the tools site. You can still write the sections yourself."}</span></div>
      </div>
      <div class="propdia" id="pDia"></div>
      ${FIELDS.map(([g, fs]) => `<details class="propsec"${(P.summary || []).length ? "" : ""}><summary>${esc(g)}</summary><div class="propf">${fs.map(([k, l, r]) => r === "input" ? `<label><span class="lbl">${esc(l)}</span><input data-pf="${k}" maxlength="200" value="${esc(toField(k))}"></label>` : `<label><span class="lbl">${esc(l)}</span><textarea data-pf="${k}" rows="${r}">${esc(toField(k))}</textarea></label>`).join("")}</div></details>`).join("")}
      <label class="chk"><input type="checkbox" id="pLetter"${P.letter === false ? "" : " checked"}> Include a covering letter${isTH() ? " (Bifold format only)" : ""}</label>
    </section>`;
  }
  function drawDiagram() {
    const box = document.getElementById("pDia"); if (!box) return;
    const dg = P.diagram, has = dg && (dg.nodes || []).length && DIA();
    const r = has ? DIA().svg(dg, colours()) : null;
    box.innerHTML = `<div class="propdhd"><b>${esc(has ? dg.title || "Solution diagram" : "Solution diagram")}</b><span class="hint" style="margin:0">${has ? esc(dg.caption || "") : "Claude draws it from the BoQ and your notes."}</span></div>
      ${r ? `<div class="propsvg">${r.svg}</div>` : ""}
      <div class="propbtns"><input id="pDiaInst" placeholder="${has ? "What to change, e.g. add the existing firewall above the core switch" : "Anything Claude should show (optional)"}" maxlength="500"><button type="button" id="pDiaGo"${B().D.ai ? "" : " disabled"}>${has ? "Redraw" : "Draw diagram"}</button>${has ? `<button type="button" class="danger" id="pDiaRm">Remove</button>` : ""}</div>`;
    document.getElementById("pDiaGo").onclick = async e => { const b = e.target; b.disabled = true; b.textContent = "Drawing…"; try { const dgm = await ai("diagram", { instructions: document.getElementById("pDiaInst").value, diagram: P.diagram }); P.diagram = cleanDiagram(dgm); drawDiagram(); } catch (er) { B().toast(er.message, 1); b.disabled = false; b.textContent = has ? "Redraw" : "Draw diagram"; } };
    const rm = document.getElementById("pDiaRm"); if (rm) rm.onclick = () => { P.diagram = null; drawDiagram(); };
  }
  const cleanDiagram = d => d && Array.isArray(d.nodes) ? { title: nd(d.title || ""), caption: nd(d.caption || ""), nodes: d.nodes.slice(0, 24), edges: (d.edges || []).slice(0, 60) } : null;
  const colours = () => isTH() ? { primary: "#003C50", accent: "#28A08C", soft: "#E6F4F2", line: "#8FB5B9" } : { primary: "#1E5A8C", accent: "#D81F2A", soft: "#E8F0F7", line: "#8FA6BC" };

  // ctx: { d, lines (live array), draw(), header() }
  function wire(ctx) {
    CTX = ctx; const root = document.getElementById("propBox");
    drawDiagram();
    root.addEventListener("input", () => fromFields(root));
    document.getElementById("pDraft").onclick = async e => {
      fromFields(root);
      if (!lineData().length) return B().toast("Add the lines or import the customer's BoQ first.", 1);
      if ((P.summary || []).length && !confirm("Replace the written sections with a new draft from Claude? The lines and prices don't change.")) return;
      const b = e.target, st = document.getElementById("pStat"); b.disabled = true; const t0 = b.textContent; b.textContent = "Claude is writing…"; st.textContent = "Drafting the summary, solution, terms and diagram in parallel. This takes about 30 seconds.";
      const res = await Promise.allSettled([ai("story"), ai("commercial"), ai("diagram")]);
      const [s, c, dg] = res.map(r => r.status === "fulfilled" ? r.value : null);
      if (s) Object.assign(P, { title: s.title || P.title, tagline: s.tagline || P.tagline, summary: s.summary || [], background: s.background || [], requirements: s.requirements || [], assumptions: s.assumptions || [], overview: s.overview || [], products: (s.products || []).map(p => ({ ...p, description: Array.isArray(p.description) ? p.description.join(" ") : p.description })) });
      if (c) Object.assign(P, { payment: c.payment || [], warranty: c.warranty || [], terms: c.terms || [], exclusions: c.exclusions || [], responsibilities: c.responsibilities || [], why: c.why || [],
        timeline: { phases: ((c.timeline || {}).phases || []).map(p => ({ ...p, responsible: String(p.responsible || "").replace(/COMPANY/g, isTH() ? "Tech Hub" : "Bifold") })), total: (c.timeline || {}).total || "", weeks: (c.timeline || {}).weeks || 0 } });
      if (dg) P.diagram = cleanDiagram(dg);
      const failed = res.filter(r => r.status === "rejected");
      root.querySelectorAll("[data-pf]").forEach(el => { if (el.dataset.pf !== "notes") el.value = toField(el.dataset.pf); });
      if (!document.getElementById("ed").querySelector("#title").value && P.title) document.getElementById("ed").querySelector("#title").value = P.title;
      drawDiagram(); root.querySelectorAll("details.propsec").forEach(x => { x.open = true; });
      b.disabled = false; b.textContent = "Redraft all sections with Claude";
      st.textContent = failed.length ? `Part of the draft failed (${failed[0].reason.message}). Try again for the rest, or write it yourself.` : "Draft ready. Read it through and edit anything below, then save.";
      if (failed.length) B().toast(failed[0].reason.message, 1);
    };
  }
  const lineData = () => (CTX ? CTX.lines : []).filter(l => l && (l.name || l.description));
  function totals(lines) {
    const V = B().D.vat, vatOn = B().D.settings.vatRegistered; let sub = 0, vat = 0;
    lines.forEach(l => { const net = r2(num(l.qty || 1) * num(l.rate) * (1 - num(l.discPct) / 100)); sub += net; const code = vatOn ? l.vat || "SR" : "OS"; if (!["RC", "IM", "DR"].includes(code)) vat += r2(net * ((V[code] || {}).rate || 0) / 100); });
    return { sub: r2(sub), vat: r2(vat), total: r2(sub + vat) };
  }
  async function ai(part, extra) {
    const h = CTX.header(), lines = lineData(), t = totals(lines);
    return B().api("POST", "ai", { part, customer: h.customer, attention: h.attention, title: h.title || P.title, notes: P.notes || "", validDays: h.validDays, subtotal: t.sub, total: t.total,
      lines: lines.map(l => ({ section: l.section || "", sub: !!l.sub, name: l.name, description: l.description, model: l.model || "", qty: num(l.qty || 1), unit: l.unit || "", rate: num(l.rate) })), ...(extra || {}) });
  }
  const value = () => { const root = document.getElementById("propBox"); if (root) fromFields(root); const out = JSON.parse(JSON.stringify(P)); const lt = document.getElementById("pLetter"); out.letter = lt ? lt.checked : true; return out; };

  /* ---------- customer BoQ import (Excel, CSV, PDF, photo, pasted text) ---------- */
  const SKIP = /^(sub[\s-]?total|total|grand total|vat|net total|total amount|amount in words|discount)\b/i;
  function rowsToLines(rows, map) {
    const c = map.cols || {}, at = (r, k) => c[k] != null && c[k] >= 0 ? String(r[c[k]] == null ? "" : r[c[k]]).trim() : "";
    const out = []; let section = "";
    rows.slice((map.header || 0) + 1).forEach(r => {
      const desc = at(r, "description"); if (!desc) return;
      const qty = num(at(r, "qty")), rate = num(at(r, "rate")), total = num(at(r, "total"));
      if (SKIP.test(desc) && !qty) return;
      if (!qty && !rate && !total) { if (desc.length < 90) section = desc; return; }
      const ref = at(r, "ref"), model = [at(r, "brand"), at(r, "model")].filter(Boolean).join(" ");
      out.push(lineFrom({ description: desc, model, qty: qty || 1, uom: at(r, "uom"), rate: rate || (total && qty ? r2(total / qty) : 0), section, sub: /^\d+\.\d+/.test(ref) || /^[a-z]\)|^-\s/i.test(ref) }));
    });
    return out;
  }
  function lineFrom(it) {
    const d = nd(it.description).replace(/\s+/g, " ").trim(); let name = d, rest = "";
    if (d.length > 140) { const cut = d.lastIndexOf(" ", 140); name = d.slice(0, cut > 60 ? cut : 140); rest = d.slice(name.length).trim(); }
    return { name, description: rest, model: nd(it.model || ""), qty: num(it.qty) || 1, unit: nd(it.uom || "").slice(0, 20), rate: it.rate == null ? "" : r2(num(it.rate)), vat: "SR", account: "4000", section: nd(it.section || ""), sub: !!it.sub };
  }
  const b64 = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(new Error(`Couldn't read ${file.name}.`)); r.readAsDataURL(file); });
  async function fromRows(rows) {
    rows = rows.filter(r => r.some(v => String(v).trim() !== ""));
    if (!rows.length) throw new Error("The BoQ looks empty.");
    const sample = rows.slice(0, 25).map((r, i) => `${i}: ` + r.map(v => String(v).replace(/\s+/g, " ").slice(0, 80)).join(" | ")).join("\n");
    const map = await B().api("POST", "ai", { part: "boqmap", sample });
    return rowsToLines(rows, map);
  }
  async function importBoq() {
    const D = B().D;
    return new Promise(resolve => {
      const dlg = document.createElement("dialog"); dlg.className = "wide";
      dlg.innerHTML = `<form><h3>Import the customer's BoQ</h3>
        <p class="hint" style="margin:0">Excel or CSV is read exactly. PDF, a photo or pasted text is read by Claude; check the prices afterwards. The lines are added to this quotation, where you can edit them.</p>
        <label class="drop" id="bDrop" style="cursor:pointer;margin:0">Drop the BoQ here or click to choose (Excel, CSV, PDF, PNG, JPG)<input type="file" id="bFile" hidden accept=".xlsx,.xls,.csv,.txt,.pdf,.png,.jpg,.jpeg,.webp"></label>
        <div class="hint" id="bName" style="margin:0"></div>
        <label><span class="lbl">Or paste the BoQ (copied from Excel, an email or a PDF)</span><textarea id="bPaste" rows="7" placeholder="Paste rows here"></textarea></label>
        <label class="chk"><input type="checkbox" id="bReplace" checked> Replace the current lines</label>
        <div class="err" id="bErr"></div>
        <div class="foot"><button type="button" data-x>Cancel</button><button class="primary" id="bGo"${D.ai ? "" : " disabled"}>Import</button></div></form>`;
      document.body.appendChild(dlg);
      let file = null; const done = v => { dlg.close(); dlg.remove(); resolve(v); };
      dlg.querySelector("[data-x]").onclick = () => done(null); dlg.addEventListener("cancel", e => { e.preventDefault(); done(null); });
      const pick = f => { file = f; dlg.querySelector("#bName").textContent = f ? `${f.name} (${Math.round(f.size / 1024)} KB)` : ""; };
      dlg.querySelector("#bFile").onchange = e => pick(e.target.files[0]);
      const z = dlg.querySelector("#bDrop"); ["dragenter", "dragover"].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add("on"); })); ["dragleave", "drop"].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove("on"); }));
      z.addEventListener("drop", e => pick(e.dataTransfer.files[0]));
      if (!D.ai) dlg.querySelector("#bErr").textContent = "Reading a BoQ needs Claude, which isn't set up on the tools site yet (ANTHROPIC_API_KEY).";
      dlg.querySelector("form").onsubmit = async e => {
        e.preventDefault(); const btn = dlg.querySelector("#bGo"), err = dlg.querySelector("#bErr"); err.textContent = "";
        const text = dlg.querySelector("#bPaste").value.trim();
        if (!file && !text) { err.textContent = "Choose a file or paste the BoQ."; return; }
        btn.disabled = true; btn.textContent = "Reading…";
        try {
          let lines = [];
          if (file && /\.(xlsx|xls|csv)$/i.test(file.name)) {
            const X = await B().xlsx(); const wb = X.read(await file.arrayBuffer(), { type: "array" });
            const best = wb.SheetNames.map(n => X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" })).sort((a, b) => b.length - a.length)[0] || [];
            lines = await fromRows(best);
          } else if (file && /\.txt$/i.test(file.name)) lines = await fromText(await file.text());
          else if (file) {
            if (file.size > 5 * 1024 * 1024) throw new Error("That file is over 5 MB. Export the BoQ to Excel or split the PDF.");
            const type = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "image/png");
            const r = await B().api("POST", "ai", { part: "boqread", file: { name: file.name, type, data: await b64(file) } });
            lines = (r.items || []).map(lineFrom);
          } else lines = await fromText(text);
          if (!lines.length) throw new Error("No line items were found. Check the file, or paste just the item rows.");
          done({ lines, replace: dlg.querySelector("#bReplace").checked });
        } catch (er) { err.textContent = er.message; btn.disabled = false; btn.textContent = "Import"; }
      };
      dlg.showModal();
    });
  }
  async function fromText(text) {
    const rows = text.split(/\r?\n/).filter(l => l.trim());
    if (rows.filter(l => l.includes("\t")).length >= rows.length * 0.6) return fromRows(rows.map(l => l.split("\t")));
    // Free text: Claude reads it in parts of about 45 lines, in parallel, so long BoQs stay inside the time limit.
    const parts = []; for (let i = 0; i < rows.length; i += 45) parts.push(rows.slice(i, i + 45).join("\n"));
    const res = await Promise.all(parts.slice(0, 8).map(t => B().api("POST", "ai", { part: "boqread", text: t })));
    return res.flatMap(r => (r.items || []).map(lineFrom));
  }

  /* ---------- Word output ---------- */
  function sections(lines) {
    const out = []; lines.forEach(l => { const s = l.section || ""; if (!out.length || out[out.length - 1].title !== s) out.push({ title: s, items: [] }); out[out.length - 1].items.push(l); });
    return out;
  }
  async function build(d) {
    const D = B().D, p = d.proposal || {}, lines = (d.lines || []).filter(l => l.name), co = B().brand();
    const t = { sub: d.subtotal, vat: d.vatAmt, total: d.total };
    const fmt = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const days = Math.max(1, Math.round((Date.parse(d.dueDate) - Date.parse(d.date)) / 864e5)) || 30;
    const client = d.contactName, title = nd(p.title || d.title || "Commercial Proposal");
    const docNo = d.number || "DRAFT";
    let img = null;
    if (p.diagram && (p.diagram.nodes || []).length && DIA()) {
      const pg = await DIA().png(p.diagram, colours(), 2);
      if (pg) { const w = Math.min(640, pg.w), h = Math.round(pg.h * w / pg.w); img = { bytes: pg.bytes, w, h }; }
    }
    const prose = (p.products || []).map(pr => [pr.title + (pr.code ? ` (${pr.code})` : "") + ".", pr.description, (pr.specs || []).map(s => `${s[0]}: ${s[1]}`).join(". ")].filter(Boolean).join(" ").replace(/\.\./g, ".") + (/[.]$/.test(pr.title) ? "" : ""));
    if (isTH()) {
      const cfg = {
        meta: { title, client, proposalNo: docNo, date: longDate(d.date), validUntil: `${longDate(d.dueDate)} (${days} days from issue)`, preparedBy: d.salesperson ? `${d.salesperson}, Tech Hub Information Technology` : "Tech Hub Information Technology" },
        executiveSummary: p.summary || [],
        clientUnderstanding: { background: p.background || [], scope: p.requirements || [], assumptions: p.assumptions || [], exclusions: p.exclusions || [] },
        solution: { overview: p.overview || [], specs: prose, boq: { vatRate: 5, sections: sections(lines).map(s => ({ title: s.title, items: s.items.map(l => ({ description: [l.name, l.description].filter(Boolean).join(" "), model: l.model || "", qtyUnit: `${l.qty}${l.unit ? " " + l.unit : ""}`, priceLabel: l.name, qty: l.qty, unit: l.rate, total: l.net, italic: !!l.sub })) })), subTotal: t.sub, vat: t.vat, total: t.total } },
        commercial: { paymentTerms: p.payment || [] }, timeline: { phases: (p.timeline || {}).phases || [], total: (p.timeline || {}).total || "" }, warranty: p.warranty || [],
        terms: (p.terms || []).map(r => r[0] ? `${r[0]}: ${r[1]}` : r[1]), whyTechHub: (p.why || []).filter(c => c.title), diagram: p.diagram || {},
      };
      return BKPROPDOCX.techhub(cfg, img);
    }
    let ref = 0;
    const cfg = {
      meta: { version: "v.01", client, title, tagline: p.tagline || "", subtitle: "Supply, Installation & Commissioning", date: longDate(d.date).replace(/^0/, ""), docRef: docNo, validity: `${days} Days from date of issue`,
        preparedBy: d.salesperson || "Ranjan Mazumder", email: D.me, mobile: "" },
      company: { name: "BIFOLD TECHNOLOGIES LLC", addressLine: "Office A306, Saraya Avenue, PO Box 554567, Al Garhoud, Dubai, United Arab Emirates", phone: "+971 04 2640 374", email: "info@bifoldtech.com", website: "www.bifoldtech.com" },
      letter: p.letter === false ? false : { attention: d.attention || "", subject: `Commercial Proposal: ${title}`, body: [
        `Thank you for the opportunity to submit our proposal for ${title} at ${client}. We are pleased to present this commercial offer for the supply, installation and commissioning of the proposed solution.`,
        `The enclosed proposal sets out the scope of works, technical specifications, bill of quantities and commercial terms. The total investment for the project is AED ${fmt(t.total)} (inclusive of VAT), as detailed in the Bill of Quantities.`,
        `BIFOLD TECHNOLOGIES LLC brings proven expertise in ICT infrastructure delivery, with certified engineers and a dedicated project manager assigned to ensure a smooth, on-time deployment. This proposal is valid for ${days} days from the date of issue.`,
        "Should you require any clarification or wish to discuss any aspect of this proposal, please do not hesitate to contact me directly using the details below."] },
      overview: [...(p.summary || []), ...(p.background || [])],
      solutionBrief: (p.overview || []).length || (p.requirements || []).length ? { intro: (p.overview || []).join(" "), pillars: p.requirements || [] } : null,
      products: p.products || [], diagram: p.diagram || {},
      boq: { sections: sections(lines).map((s, si) => { let sub = 0; return { title: s.title ? `${String(si + 1).padStart(2, "0")}.  ${s.title}` : "", items: s.items.map(l => { if (!l.sub) { ref++; sub = 0; } else sub++; return { ref: l.sub ? `${ref}.${sub}` : String(ref), description: [l.name, l.description, l.model ? `(${l.model})` : ""].filter(Boolean).join(" "), qty: String(l.qty), unit: l.rate ? fmt(l.rate) : "TBD", total: l.rate ? fmt(l.net) : "TBD", italic: !!l.sub }; }) }; }),
        totals: { exVat: "AED " + fmt(t.sub), vat: "AED " + fmt(t.vat), vatRate: "5%", incVat: "AED " + fmt(t.total) } },
      payment: p.payment || [], terms: [...(p.warranty || []), ...(p.terms || [])].map(r => [r[0] || "Note", r[1]]),
      projectManagement: { intro: "BIFOLD TECHNOLOGIES LLC will assign a dedicated Project Manager and certified engineers for the deployment, responsible for:", responsibilities: p.responsibilities || [] },
      implementation: { intro: (p.timeline || {}).total ? `Estimated completion within ${String(p.timeline.total).toLowerCase()} from receipt of the confirmed Purchase Order.` : "", weeks: (p.timeline || {}).weeks || Math.max(1, ...((p.timeline || {}).phases || []).flatMap(x => x.weeks || [1])), phases: ((p.timeline || {}).phases || []).map(x => ({ name: x.activity, active: x.weeks || [] })) },
      exclusions: { intro: "The following are outside the scope of this proposal:", items: p.exclusions || [] },
    };
    return BKPROPDOCX.bifold(cfg, img);
  }
  const fileName = d => `${(d.contactName || "Customer").replace(/[\\/:*?"<>|]/g, "-")} Proposal ${d.number || "draft"} ${isTH() ? "TechHub" : "Bifold"}.docx`;

  // Preview the Word file in the page (docx-preview), with Download beside it.
  async function preview(d) {
    const dlg = document.createElement("dialog"); dlg.className = "bxpv propv";
    dlg.innerHTML = `<div class="hd"><b>${esc(fileName(d))}</b><button type="button" class="dl" id="pvDl">Download Word</button><button type="button" id="pvX">Close</button></div><div class="bd"><div class="msg" id="pvMsg">Building the proposal…</div><div id="pvBox"></div></div>`;
    document.body.appendChild(dlg); dlg.showModal();
    const close = () => { dlg.close(); dlg.remove(); }; dlg.querySelector("#pvX").onclick = close; dlg.addEventListener("cancel", e => { e.preventDefault(); close(); });
    try {
      const blob = await build(d);
      dlg.querySelector("#pvDl").onclick = () => save(blob, fileName(d));
      await BKPROPDOCX.load(BKPROPDOCX.LIB.jszip); await BKPROPDOCX.loadAs("https://cdn.jsdelivr.net/npm/docx-preview@0.3.5/dist/docx-preview.min.js", "docxPreview");
      await window.docx_preview_render(blob, dlg.querySelector("#pvBox"));
      dlg.querySelector("#pvMsg").hidden = true;
    } catch (e) { dlg.querySelector("#pvMsg").textContent = e.message || "The preview couldn't be drawn. Use Download Word."; }
  }
  function save(blob, name) { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); }
  async function download(d) { save(await build(d), fileName(d)); }

  return { panel, wire, value, importBoq, preview, download, build, fileName, lineFrom };
})();
// docx-preview exposes window.docx (clashing with docx.js); render through whichever global it registered.
window.docx_preview_render = async (blob, el) => {
  const lib = window.docxPreview;
  if (!lib) throw new Error("The preview viewer couldn't load. Use Download Word.");
  el.innerHTML = ""; await lib.renderAsync(blob, el, null, { inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, experimental: true, renderHeaders: true, renderFooters: true });
};
