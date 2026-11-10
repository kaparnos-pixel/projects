// Project Completion Reports page: report list, the report editor (details pulled from the customer list, Claude drafting,
// BoQ and serial imports, system diagram, site pictures, warranty, snags), customer sign-off on the device or by link,
// Word and PDF output and email. Talks to /api/pcr/* (bifold-tools-api/src/pcr.js) and /api/customers.
(function () {
  "use strict";
  const LIB = {
    docx: "https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js",
    jspdf: "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
    autotable: "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js",
    xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  };
  const BR = {
    bifold: { name: "Bifold Technologies LLC", logo: "/assets/amc/bifold_logo.png", stamp: "/assets/amc/bifold_stamp.png", support: "+971 04 264 0374  |  bifoldtech.com",
      hours: "Monday to Saturday, 9 AM to 6 PM UAE time, excluding public holidays", diag: { primary: "#1E5A8C", accent: "#D81F2A", soft: "#E8F0F7" } },
    techhub: { name: "Tech Hub Information Technology", logo: "/assets/techhub/techhub_logo.png", stamp: "", support: "sales@techhubrak.ae  |  +971 07 258 1926",
      hours: "Sunday to Thursday, 9 AM to 6 PM UAE time, excluding public holidays", diag: { primary: "#003C50", accent: "#28A08C", soft: "#E6F4F2" } },
  };
  const $ = id => document.getElementById(id);
  const nd = v => String(v == null ? "" : v).replace(/\s*[—–]\s*/g, ", ");
  const esc = v => nd(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const today = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  const fd = iso => PCRGEN.fmtDate(iso);
  const fdt = iso => iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const addMonths = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const f = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)).getUTCDate(); return new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10); };
  const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const shortName = n => String(n || "").replace(/\b(LLC|L\.L\.C\.?|FZE|FZ-LLC|FZCO|Co\.?|Company|Limited|Ltd\.?|Est\.?|Establishment|Trading)\b/gi, "").replace(/\s+/g, " ").trim() || String(n || "");
  const safeName = s => String(s || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  function toast(m, e) { const t = document.createElement("div"); t.className = "toast" + (e ? " err" : ""); t.setAttribute("role", "status"); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), e ? 6500 : 2600); }
  const busy = (btn, on, label) => { if (!btn) return; if (on) { btn.dataset.l = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${esc(label || "Working")}`; } else { btn.disabled = false; if (btn.dataset.l) btn.innerHTML = btn.dataset.l; } };
  document.addEventListener("click", e => { const c = e.target.closest("[data-close]"); if (c) c.closest("dialog").close(); });
  async function api(method, path, body) {
    let r;
    try { r = await fetch("/api/" + path, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); }
    catch { throw new Error("Can't reach the server. Check your connection and try again."); }
    if (r.status === 204) return null;
    const ct = r.headers.get("content-type") || "";
    if (r.redirected || (r.ok && !ct.includes("json"))) throw new Error("Your session has ended. Reload the page to sign in again.");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `The server answered ${r.status}.`); e.status = r.status; e.data = j; throw e; }
    return j;
  }
  const loaded = {};
  const loadScript = src => loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error("A document library couldn't load. Check your connection and try again.")); }; document.head.appendChild(s); }));
  const b64 = bytes => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const toB64 = async blob => b64(new Uint8Array(await blob.arrayBuffer()));
  function saveBlob(name, blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }

  let ME = null, BOOT = null, CUST = [], R = null, FILTER = "all";
  const co = () => (BOOT && BOOT.co === "techhub") ? "techhub" : "bifold";
  const B = () => BR[co()];
  const STATUS = { draft: "Draft", awaiting: "Awaiting signature", signed: "Signed" };
  const stChip = s => `<span class="st ${esc(s)}">${esc(STATUS[s] || s)}</span>`;

  /* ================= start and routing ================= */
  function start(m) {
    ME = m; if (m.noAccess) return;
    Promise.all([api("GET", "pcr/bootstrap"), api("GET", "customers").catch(() => [])]).then(([b, c]) => { BOOT = b; CUST = c; addEventListener("hashchange", route); route(); }).catch(e => toast(e.message, true));
  }
  if (window.BIFOLD_ME) start(window.BIFOLD_ME); else document.addEventListener("bifold:me", e => start(e.detail), { once: true });

  async function route() {
    const [view, id] = (location.hash.replace(/^#/, "") || "list").split("/");
    if (R && !(view === "edit" && id === R.id)) { await flush(); R = null; }
    document.querySelectorAll(".view").forEach(v => v.hidden = true);
    if (view === "edit" && id) return openEditor(id);
    if (view === "new") { location.replace("#list"); return openNew(); }
    $("v-list").hidden = false; renderList();
    try { BOOT.reports = await api("GET", "pcr/reports"); renderList(); } catch {}
  }

  /* ================= list ================= */
  function renderList() {
    const all = BOOT.reports || [];
    const ym = today().slice(0, 7), yr = today().slice(0, 4);
    const k = (c, label, v, s) => `<div class="kpi" style="--c:${c}"><div class="k">${label}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    $("kpis").innerHTML = k("var(--accent)", "Drafts", all.filter(r => r.status === "draft").length, "Being prepared")
      + k("var(--warn)", "Awaiting signature", all.filter(r => r.status === "awaiting").length, "Signing link sent")
      + k("var(--good)", "Signed this month", all.filter(r => r.status === "signed" && String(r.signedAt).slice(0, 7) === ym).length, "Accepted by the customer")
      + k("var(--muted)", "Reports in " + yr, all.filter(r => String(r.createdAt).slice(0, 4) === yr).length, "Both document types");
    const q = $("q").value.trim().toLowerCase();
    const list = all.filter(r => FILTER === "all" || r.status === FILTER).filter(r => !q || [r.docNo, r.customerName, r.projectTitle, r.poRef, r.preparedBy].join(" ").toLowerCase().includes(q));
    $("rows").innerHTML = list.map(r => `<tr data-id="${esc(r.id)}"><td><span class="doc">${esc(r.docNo)}</span><div class="hint" style="margin:0">${r.mode === "certificate" ? "Certificate" : "Report"}</div></td><td><b>${esc(r.customerName)}</b></td><td>${esc(r.projectTitle || "-")}</td><td class="mono">${esc(r.poRef || "-")}</td><td>${esc(fd(r.completionDate) || "-")}</td><td>${esc(r.preparedBy)}</td><td>${stChip(r.status)}${r.status === "signed" ? `<div class="hint" style="margin:2px 0 0">${esc(r.signerName)}</div>` : ""}</td></tr>`).join("");
    $("empty").hidden = all.length > 0;
    $("rows").closest("table").hidden = !all.length;
    $("cnt").textContent = all.length ? `${list.length} of ${all.length}` : "";
  }
  $("q").addEventListener("input", renderList);
  $("fseg").addEventListener("click", e => { const b = e.target.closest("button[data-v]"); if (!b) return; FILTER = b.dataset.v; $("fseg").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); renderList(); });
  $("rows").addEventListener("click", e => { const tr = e.target.closest("tr[data-id]"); if (tr) location.hash = "edit/" + tr.dataset.id; });
  document.addEventListener("click", e => { if (e.target.closest('[data-act="new"]')) openNew(); });

  /* ================= new report ================= */
  function custOptions(sel, cur) {
    sel.innerHTML = `<option value="">Choose a customer…</option>` + CUST.map(c => `<option value="${esc(c.id)}"${c.id === cur ? " selected" : ""}>${esc(c.name)}</option>`).join("");
  }
  function openNew() {
    custOptions($("nCust"), ""); $("nPo").value = ""; $("nTitle").value = ""; $("nDate").value = today(); $("nBy").value = BOOT.me.name; $("nMode").value = "report"; $("nErr").textContent = "";
    $("newDlg").showModal(); $("nCust").focus();
  }
  $("newForm").onsubmit = async e => {
    e.preventDefault(); $("nErr").textContent = "";
    if (!$("nCust").value) { $("nErr").textContent = "Choose the customer."; return; }
    if (!$("nBy").value.trim()) { $("nErr").textContent = "Enter the name of the person preparing the report."; return; }
    busy($("nGo"), true, "Creating");
    try {
      const r = await api("POST", "pcr/reports", { customerId: $("nCust").value, poRef: $("nPo").value, projectTitle: $("nTitle").value, completionDate: $("nDate").value, preparedBy: $("nBy").value, mode: $("nMode").value });
      $("newDlg").close(); BOOT.reports = [r].concat(BOOT.reports || []); location.hash = "edit/" + r.id;
    } catch (err) { $("nErr").textContent = err.message; } finally { busy($("nGo"), false); }
  };
  let custTarget = null;
  function openCust(target) { custTarget = target; ["cName", "cContact", "cEmail", "cEmirate", "cTrn", "cAddr"].forEach(i => $(i).value = ""); $("cErr").textContent = ""; $("custDlg").showModal(); $("cName").focus(); }
  $("nNewCust").onclick = () => openCust($("nCust"));
  $("custForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const c = await api("POST", "customers", { name: $("cName").value, contactName: $("cContact").value, email: $("cEmail").value, emirate: $("cEmirate").value, trn: $("cTrn").value, address: $("cAddr").value });
      CUST.push(c); CUST.sort((a, b) => a.name.localeCompare(b.name)); $("custDlg").close();
      if (custTarget) { custOptions(custTarget, c.id); custTarget.dispatchEvent(new Event("change", { bubbles: true })); }
    } catch (err) {
      if (err.status === 409 && err.data && err.data.customer) { $("custDlg").close(); if (custTarget) { custOptions(custTarget, err.data.customer.id); custTarget.dispatchEvent(new Event("change", { bubbles: true })); } toast(err.message); }
      else $("cErr").textContent = err.message;
    }
  };

  /* ================= editor: load, save ================= */
  const HEAD = ["customerId", "poRef", "poDate", "projectTitle", "site", "startDate", "completionDate", "preparedBy", "preparedTitle", "attention", "mode"];
  const BODY = ["include", "notes", "instructions", "letter", "scope", "boq", "serials", "testing", "handover", "warranty", "snags", "diagram", "photos", "textSource"];
  let dirty = false, saving = null, timer = null;
  const locked = () => R && R.status === "signed";
  function setSave(t, err) { const s = $("saveSt"); s.textContent = t; s.classList.toggle("err", !!err); }
  function touch() { if (!R || locked()) return; dirty = true; setSave("Unsaved changes"); clearTimeout(timer); timer = setTimeout(() => save(), 1200); }
  async function save() {
    if (!R || !dirty) return saving;
    if (saving) { await saving; return save(); }
    dirty = false; clearTimeout(timer); setSave("Saving…");
    const body = { etag: R.etag }; HEAD.concat(BODY).forEach(k => body[k] = R[k]);
    saving = api("PUT", "pcr/reports/" + R.id, body).then(res => {
      const custChanged = res.customerId !== R._custLoaded;
      Object.assign(R, { etag: res.etag, docNo: res.docNo, customer: res.customer, customerName: res.customerName, status: res.status, updatedAt: res.updatedAt, history: res.history, _custLoaded: res.customerId });
      setSave("Saved " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })); head();
      if (custChanged) renderCard("details");
      const i = (BOOT.reports || []).findIndex(x => x.id === R.id); if (i >= 0) BOOT.reports[i] = Object.assign(BOOT.reports[i], res);
    }).catch(e => {
      if (e.status === 409) setSave("Someone else changed this report. Reload the page to see their changes.", true);
      else { dirty = true; setSave("Not saved: " + e.message, true); timer = setTimeout(() => save(), 8000); }
    }).finally(() => { saving = null; });
    return saving;
  }
  async function flush() { clearTimeout(timer); if (dirty) await save(); else if (saving) await saving; }
  addEventListener("beforeunload", e => { if (dirty) { save(); e.preventDefault(); e.returnValue = ""; } });

  async function openEditor(id) {
    $("v-edit").hidden = false; $("cards").innerHTML = `<div class="panel empty">Loading…</div>`; $("toc").innerHTML = "";
    try { R = await api("GET", "pcr/reports/" + id); } catch (e) { toast(e.message, true); location.hash = "list"; return; }
    R._custLoaded = R.customerId; dirty = false; setSave("");
    $("bAi").textContent = BOOT.features.ai ? "Draft with Claude" : "Fill standard wording";
    $("bMail").hidden = !BOOT.features.mail;
    if (!R.letter.body.length && !locked()) { applyTemplate(true); dirty = true; save(); }
    if (!R.warranty.hours) R.warranty.hours = B().hours;
    renderAll();
  }
  function head() {
    $("eDoc").textContent = R.docNo; $("eCust").textContent = [R.customerName, R.projectTitle].filter(Boolean).join(" · ");
    const lb = $("lockbar");
    if (R.status === "signed") { lb.className = "lockbar"; lb.hidden = false; const s = R.signature || {};
      lb.innerHTML = `<span><b>Signed by ${esc(s.name)}</b>${s.designation ? ", " + esc(s.designation) : ""} on ${esc(fdt(s.at))} (${s.method === "link" ? "signing link" : "on site"}). The report is locked.</span>${R.canReopen ? '<button type="button" id="bReopen">Reopen to edit</button>' : ""}`;
      const br = $("bReopen"); if (br) br.onclick = reopen; }
    else if (R.status === "awaiting" && R.link) { lb.className = "lockbar awaiting"; lb.hidden = false; lb.innerHTML = `<span><b>Waiting for the customer to sign.</b> The signing link expires on ${esc(fd(R.link.expires.slice(0, 10)))}. Changes you make now are what the customer will see.</span><button type="button" id="bShowLink">Show link</button>`; $("bShowLink").onclick = showLink; }
    else lb.hidden = true;
    $("cards").classList.toggle("lockedui", locked());
    $("bAi").hidden = locked();
    $("bDel").hidden = !R.canDelete;
  }

  /* ================= editor: cards ================= */
  const CARDS = [
    { key: "details", title: "Project & customer", sub: "Customer details come from the customer list" },
    { key: "notes", title: "Site notes for Claude", sub: "What was done, tested and handed over, in your own words" },
    { key: "text", title: "Report text", sub: "Letter, scope delivered and handover deliverables" },
    { key: "boq", title: "Customer BoQ", sub: "Items from the customer's bill of quantities", inc: "boq" },
    { key: "serials", title: "Equipment & serial numbers", sub: "Asset register for warranty and support", inc: "serials" },
    { key: "diagram", title: "System diagram", sub: "Drawn by Claude from the BoQ, serials and notes, or your own drawing", inc: "diagram" },
    { key: "testing", title: "Testing & commissioning", sub: "Only tests that were actually carried out", inc: "testing" },
    { key: "photos", title: "Site pictures", sub: "Installed equipment, racks, labels", inc: "photos" },
    { key: "warranty", title: "Warranty", sub: "Hardware and workmanship cover", inc: "warranty" },
    { key: "snags", title: "Snag list", sub: "Open items at handover", inc: "snags" },
    { key: "signoff", title: "Customer sign-off", sub: "Sign on this device, send a signing link, or print and sign", inc: "signoff" },
  ];
  function renderAll() {
    head();
    if (co() !== "bifold") R.include.stamp = false;
    $("cards").innerHTML = CARDS.filter(c => c.key !== "text" || R.mode !== "certificate" || true).map(c => `<section class="card" id="c-${c.key}"></section>`).join("");
    CARDS.forEach(c => renderCard(c.key));
    toc();
  }
  function toc() {
    const count = { boq: R.boq.length, serials: R.serials.length, testing: R.testing.length, photos: R.photos.length, snags: R.snags.length, diagram: R.diagram.nodes.length || (R.diagram.imageId ? 1 : 0) };
    $("toc").innerHTML = CARDS.map(c => `<a href="#edit/${esc(R.id)}" data-go="${c.key}" class="${c.inc && !R.include[c.inc] ? "off" : ""}"><span>${esc(c.title)}</span>${count[c.key] != null ? `<em>${count[c.key]}</em>` : c.inc && !R.include[c.inc] ? "<em>off</em>" : ""}</a>`).join("");
  }
  $("toc").addEventListener("click", e => { const a = e.target.closest("[data-go]"); if (!a) return; e.preventDefault(); $("c-" + a.dataset.go).scrollIntoView({ behavior: "smooth", block: "start" }); });
  function renderCard(key) {
    const c = CARDS.find(x => x.key === key), el = $("c-" + key); if (!el) return;
    const on = !c.inc || R.include[c.inc];
    el.classList.toggle("off", !on);
    el.innerHTML = `<header><h2>${esc(c.title)}<small>${esc(c.sub)}</small></h2>${c.inc ? `<label class="switch edit-only"><input type="checkbox" data-inc="${c.inc}"${on ? " checked" : ""}> Include in report</label>` : ""}</header><div class="bd">${on ? (BUILD[key] || (() => ""))() : ""}</div>`;
    if (locked()) el.querySelectorAll("input,textarea,select").forEach(x => x.disabled = true);
    if (key === "diagram" && on) drawDiagram();
    if (key === "photos" && on) bindDrop(el.querySelector(".drop"), files => addPhotos(files));
  }
  const field = (label, bind, val, o = {}) => `<label class="${o.cls || ""}"><span class="lbl">${esc(label)}</span>${o.area ? `<textarea data-b="${bind}" rows="${o.rows || 3}" placeholder="${esc(o.ph || "")}">${esc(val)}</textarea>` : `<input data-b="${bind}" type="${o.type || "text"}" value="${esc(val)}" placeholder="${esc(o.ph || "")}" maxlength="${o.max || 200}">`}${o.hint ? `<span class="hint">${esc(o.hint)}</span>` : ""}</label>`;

  const BUILD = {
    details() {
      const cu = R.customer || {};
      return `<div class="grid2">
        <label class="full"><span class="lbl">Customer</span><span class="row2"><select data-b="customerId" id="dCust"></select><button type="button" class="edit-only" id="dNewCust">New</button><button type="button" class="edit-only" id="dRefresh" title="Pull the latest details from the customer list">Refresh</button></span></label>
        <div class="custref full"><div><span>Customer reference</span>${esc(R.customerName)}</div><div><span>Contact</span>${esc(cu.contactName || "-")}</div><div><span>Email / phone</span>${esc([cu.email, cu.phone].filter(Boolean).join(" · ") || "-")}</div><div><span>TRN</span>${esc(cu.trn || "-")}</div><div><span>Address</span>${esc([cu.address, cu.emirate].filter(Boolean).join(", ") || "-")}</div></div>
        ${field("Customer PO reference", "poRef", R.poRef, { max: 80, ph: "e.g. PO-2026-0418" })}${field("PO date", "poDate", R.poDate, { type: "date" })}
        ${field("Project title", "projectTitle", R.projectTitle, { cls: "full", ph: "e.g. Network infrastructure: supply, installation and commissioning" })}
        ${field("Site / location", "site", R.site, { cls: "full" })}
        ${field("Start date", "startDate", R.startDate, { type: "date" })}${field("Completion date", "completionDate", R.completionDate, { type: "date", hint: "Warranty starts from this date unless you change it below." })}
        ${field("Prepared by", "preparedBy", R.preparedBy, { max: 100 })}${field("Designation", "preparedTitle", R.preparedTitle, { max: 100, ph: "e.g. Project Engineer" })}
        ${field("Customer representative (Attn)", "attention", R.attention, { max: 120 })}
        <label><span class="lbl">Document type</span><select data-b="mode"><option value="report"${R.mode !== "certificate" ? " selected" : ""}>Project completion report (full)</option><option value="certificate"${R.mode === "certificate" ? " selected" : ""}>Work completion certificate (short letter)</option></select></label>
        ${co() === "bifold" ? `<label class="chk full"><input type="checkbox" data-inc="stamp"${R.include.stamp ? " checked" : ""}> Print the company stamp next to the company signature</label>` : ""}
      </div>`;
    },
    notes() {
      return `${BOOT.features.ai ? "" : `<div class="aibanner">Claude drafting isn't switched on for the tools site yet, so <b>Fill standard wording</b> uses the house template. Ask IT to add the ANTHROPIC_API_KEY setting.</div>`}
        ${field("What was done on site", "notes", R.notes, { area: 1, rows: 7, ph: "e.g. Installed 2 x Aruba 1930 switches in the main rack and 9 x AP22 across L1 and L2. Configured VLAN 10/20/30. Walk test done, all areas covered. UPS runtime test passed (18 min). Customer IT trained on the Instant On app. Label for rack B patch panel still pending." })}
        ${field("Instructions for Claude (optional)", "instructions", R.instructions, { area: 1, rows: 2, ph: "e.g. Mention the out-of-hours cut-over on 7 October. Keep the letter short." })}
        <div class="btnrow edit-only"><button type="button" class="ai" data-ai="all">${BOOT.features.ai ? "Draft text, testing and diagram with Claude" : "Fill standard wording"}</button><span class="hint">Claude uses the BoQ, serial numbers and these notes. It never invents serials, results or dates; check every line before sending.</span></div>`;
    },
    text() {
      const L = R.letter, S = R.scope;
      return `<div class="grid2">
        ${field("Subject", "letter.subject", L.subject, { cls: "full", max: 250 })}
        ${field("Salutation", "letter.salutation", L.salutation, { max: 120 })}
        <label class="full"><span class="lbl">Letter paragraphs</span><textarea data-paras="letter.body" rows="7">${esc(L.body.join("\n\n"))}</textarea><span class="hint">Leave a blank line between paragraphs.</span></label>
        ${field("Closing line", "letter.closing", L.closing, { cls: "full", max: 600 })}
      </div>
      ${R.mode === "certificate" ? `<p class="hint" style="margin:0">The certificate is a short letter. Scope and handover are used in the full report only.</p>` : `
      ${field("Scope delivered: introduction", "scope.intro", S.intro, { area: 1, rows: 2 })}
      <div class="streams">${S.streams.map((st, i) => `<div class="stream"><div class="row2"><input data-b="scope.streams.${i}.heading" value="${esc(st.heading)}" placeholder="A. System or work package" maxlength="120"><button type="button" class="x edit-only" data-del="scope.streams" data-i="${i}" aria-label="Remove">&times;</button></div><textarea data-lines="scope.streams.${i}.bullets" rows="${Math.max(2, st.bullets.length)}" placeholder="One bullet per line">${esc(st.bullets.join("\n"))}</textarea></div>`).join("")}</div>
      <div class="btnrow edit-only"><button type="button" data-addstream>Add scope heading</button></div>
      <label><span class="lbl">Handover deliverables</span><textarea data-lines="handover" rows="${Math.max(3, R.handover.length)}" placeholder="One per line">${esc(R.handover.join("\n"))}</textarea><span class="hint">Passwords are never printed: note them as handed over under separate confidential cover.</span></label>`}`;
    },
    boq() { return tbl("boq", [["item", "#", 50], ["desc", "Description", 0], ["model", "Make / model", 170], ["qty", "Qty", 70], ["unit", "Unit", 80], ["remarks", "Remarks", 150]], "Import from Excel / CSV"); },
    serials() {
      const types = new Map(); R.serials.forEach(r => types.set(r.type || "Other", (types.get(r.type || "Other") || 0) + 1));
      const missing = R.serials.filter(r => !r.serial).length;
      return tbl("serials", [["type", "Device type", 150], ["model", "Make & model", 0], ["serial", "Serial number", 190, "mono"], ["location", "Location", 160]], "Import from Excel / CSV")
        + `<p class="hint" style="margin:0">${R.serials.length ? [...types].map(([t, n]) => `${n} x ${esc(t)}`).join(", ") : "Copy the serial numbers exactly as printed on the labels."}${missing ? ` <b style="color:var(--bad)">${missing} row${missing > 1 ? "s have" : " has"} no serial number.</b>` : ""}</p>`
        + `<details class="more edit-only"><summary>Paste a list of serial numbers</summary><div class="grid2" style="margin-top:10px"><label><span class="lbl">Device type</span><input id="psType" placeholder="e.g. Access Point"></label><label><span class="lbl">Make & model</span><input id="psModel" placeholder="e.g. Aruba AP22"></label><label><span class="lbl">Location</span><input id="psLoc"></label><label class="full"><span class="lbl">Serial numbers, one per line (or scanned)</span><textarea id="psList" rows="4" class="mono"></textarea></label></div><div class="btnrow"><button type="button" id="psAdd">Add to register</button></div></details>`;
    },
    diagram() {
      const D = R.diagram;
      return `<div class="grid2">${field("Diagram title", "diagram.title", D.title, { max: 120, ph: "e.g. Network topology as installed" })}${field("Caption", "diagram.caption", D.caption, { max: 300 })}</div>
        <div class="seg edit-only" role="group" aria-label="Diagram source"><button type="button" data-dsrc="drawn" aria-pressed="${D.source !== "upload"}">Drawn diagram</button><button type="button" data-dsrc="upload" aria-pressed="${D.source === "upload"}">Upload my own drawing</button></div>
        <div class="diag" id="diagBox"></div>
        ${D.source === "upload" ? `<label class="drop edit-only" id="diagDrop"><input type="file" accept="image/png,image/jpeg" hidden><b>Choose a drawing</b> (PNG or JPG, e.g. exported from Visio) or drop it here</label>` : `
        <div class="row2 edit-only"><input id="dInstr" placeholder="Tell Claude what to change, e.g. show the UPS powering both switches" aria-label="Instruction for Claude"><button type="button" class="ai" data-ai="diagram">${D.nodes.length ? "Redraw with Claude" : "Draw with Claude"}</button></div>
        <details class="more edit-only"><summary>Edit boxes and links by hand</summary>${diagEditor()}</details>`}`;
    },
    testing() {
      return tbl("testing", [["test", "Test", 0], ["method", "Method", 170], ["result", "Result", 110, "res"], ["remarks", "Remarks", 180]], "")
        + `<p class="hint" style="margin:0">Results print in the report. Leave a result blank if the test wasn't done, or remove the row.</p>`;
    },
    photos() {
      return `<label class="drop edit-only"><input type="file" accept="image/*" multiple hidden><b>Add pictures</b> or drop them here. They are resized to keep the report small.</label>
        <div class="photos">${R.photos.map((p, i) => `<div class="ph-card"><img src="/api/pcr/files/${esc(p.id)}" alt="${esc(p.caption || "Site picture " + (i + 1))}" loading="lazy"><div class="meta"><input data-b="photos.${i}.caption" value="${esc(p.caption)}" placeholder="Caption, e.g. Main rack after dressing" maxlength="200"><div class="btnrow edit-only"><button type="button" data-mv="-1" data-i="${i}"${i ? "" : " disabled"} aria-label="Move earlier">&larr;</button><button type="button" data-mv="1" data-i="${i}"${i < R.photos.length - 1 ? "" : " disabled"} aria-label="Move later">&rarr;</button><button type="button" class="danger" data-del="photos" data-i="${i}">Remove</button></div></div></div>`).join("")}</div>`;
    },
    warranty() {
      const w = R.warranty, st = w.start || R.completionDate;
      const until = m => m && st ? fd(addDays(addMonths(st, m), -1)) : "";
      return `<div class="grid2">
        <label><span class="lbl">Hardware warranty (months)</span><input data-b="warranty.hwMonths" type="number" min="0" max="120" value="${esc(w.hwMonths)}"><span class="hint">${w.hwMonths ? "Until " + esc(until(w.hwMonths)) : "Not offered"}</span></label>
        <label><span class="lbl">Workmanship warranty (months)</span><input data-b="warranty.wkMonths" type="number" min="0" max="120" value="${esc(w.wkMonths)}"><span class="hint">${w.wkMonths ? "Until " + esc(until(w.wkMonths)) : "Not offered"}</span></label>
        ${field("Warranty starts", "warranty.start", w.start, { type: "date", hint: w.start ? "" : "Blank means the completion date (" + fd(R.completionDate) + ")." })}
        ${field("Support hours", "warranty.hours", w.hours, { max: 120 })}
        <label class="full"><span class="lbl">Warranty terms</span><textarea data-lines="warranty.terms" rows="${Math.max(3, w.terms.length)}">${esc(w.terms.join("\n"))}</textarea></label>
        <label class="full"><span class="lbl">Exclusions</span><textarea data-lines="warranty.exclusions" rows="${Math.max(3, w.exclusions.length)}">${esc(w.exclusions.join("\n"))}</textarea></label>
      </div>`;
    },
    snags() { return tbl("snags", [["item", "Open item", 0], ["owner", "Owner", 160], ["target", "Target date", 140]], "") + `<p class="hint" style="margin:0">${R.snags.length ? "These print as open items, and the acceptance wording refers to them." : "With no rows, the report states that there are no open snags."}</p>`; },
    signoff() {
      const s = R.signature, cs = R.company || {};
      const box = (title, img, rows, extra) => `<div class="signbox"><h3>${title}</h3><div class="sigimg${img ? "" : " blank"}">${img ? `<img src="/api/pcr/files/${esc(img)}" alt="Signature">` : ""}</div><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || "-")}</dd>`).join("")}</dl>${extra || ""}</div>`;
      const linkLive = R.link && !s;
      return `<div class="sign2">
        ${box("Prepared by", cs.fileId, [["Name", R.preparedBy], ["Designation", R.preparedTitle], ["Company", B().name], ["Signed", cs.at ? fdt(cs.at) : "Not signed"]],
          `<div class="btnrow edit-only"><button type="button" data-sign="company">${cs.fileId ? "Sign again" : "Sign for the company"}</button>${cs.fileId ? '<button type="button" data-sign="company-clear">Remove</button>' : ""}</div>`)}
        ${box("Accepted by (customer)", s && s.fileId, s ? [["Name", s.name], ["Designation", s.designation], ["Company", R.customerName], ["Signed", fdt(s.at) + (s.method === "link" ? ", signing link" : ", on site")]] : [["Name", ""], ["Designation", ""], ["Company", R.customerName], ["Signed", linkLive ? "Waiting for the customer" : "Not signed"]],
          s ? (s.remarks ? `<p class="hint" style="margin:0">Customer remarks: ${esc(s.remarks)}</p>` : "") : `<div class="signopts edit-only">
            <button type="button" class="primary" data-sign="customer">Customer signs on this device<small style="color:inherit;opacity:.85">Hand over the tablet or phone on site</small></button>
            <button type="button" data-sign="link">${linkLive ? "Show signing link" : "Send a signing link"}<small>The customer reads and signs online, no account needed</small></button>
            <button type="button" data-sign="print">Print and sign on paper<small>Download the PDF with blank signature lines</small></button></div>`)}
      </div>`;
    },
  };

  /* ---- generic table editor ---- */
  function tbl(key, cols, importLabel) {
    const rows = R[key];
    return `<div class="tblwrap"><table class="grid-tbl"><thead><tr><th>#</th>${cols.map(c => `<th${c[2] ? ` style="width:${c[2]}px"` : ""}>${esc(c[1])}</th>`).join("")}<th></th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td class="n">${i + 1}</td>${cols.map(c => `<td>${c[3] === "res" ? `<select data-b="${key}.${i}.${c[0]}" class="res-${esc(r[c[0]])}">${["", "Pass", "Fail", "Open", "N/A"].map(v => `<option value="${v}"${r[c[0]] === v ? " selected" : ""}>${v || "-"}</option>`).join("")}</select>` : `<input data-b="${key}.${i}.${c[0]}" value="${esc(r[c[0]])}"${c[3] === "mono" ? ' class="mono"' : ""} maxlength="${key === "boq" && c[0] === "desc" ? 400 : 300}">`}</td>`).join("")}<td class="x"><button type="button" class="x edit-only" data-del="${key}" data-i="${i}" aria-label="Remove row ${i + 1}">&times;</button></td></tr>`).join("")}
      </tbody></table></div>
      <div class="tblfoot edit-only"><div class="btnrow"><button type="button" data-add="${key}">Add row</button>${importLabel ? `<button type="button" data-import="${key}">${esc(importLabel)}</button>` : ""}${rows.length ? `<button type="button" class="danger" data-clear="${key}">Clear all</button>` : ""}</div><span>${rows.length} row${rows.length === 1 ? "" : "s"}</span></div>`;
  }
  const BLANK = { boq: () => ({ item: "", desc: "", model: "", qty: "", unit: "Nos", remarks: "" }), serials: () => ({ type: "", model: "", serial: "", location: "" }), testing: () => ({ test: "", method: "", result: "", remarks: "" }), snags: () => ({ item: "", owner: "", target: "" }) };

  /* ---- binding ---- */
  function setPath(path, val) { const ks = path.split("."); let o = R; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = val; }
  function getPath(path) { return path.split(".").reduce((o, k) => o == null ? o : o[k], R); }
  $("cards").addEventListener("input", e => {
    const t = e.target; if (locked()) return;
    if (t.dataset.b) { let v = t.value; if (t.type === "number") v = Number(v) || 0; setPath(t.dataset.b, v); if (t.tagName === "SELECT" && t.dataset.b.endsWith(".result")) t.className = "res-" + v; }
    else if (t.dataset.lines) setPath(t.dataset.lines, t.value.split("\n").map(x => x.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean));
    else if (t.dataset.paras) setPath(t.dataset.paras, t.value.split(/\n\s*\n/).map(x => x.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean));
    else return;
    if (t.dataset.b && t.dataset.b.startsWith("diagram.")) drawDiagram();
    touch();
  });
  $("cards").addEventListener("change", e => {
    const t = e.target; if (locked()) return;
    if (t.dataset.inc) { R.include[t.dataset.inc] = t.checked; const c = CARDS.find(x => x.inc === t.dataset.inc); if (c) renderCard(c.key); toc(); touch(); return; }
    if (t.dataset.b === "mode") { renderCard("text"); }
    if (t.dataset.b === "customerId") { const c = CUST.find(x => x.id === t.value); if (c && !R.attention) R.attention = c.contactName || ""; flush(); }
    if (t.dataset.b && /^(warranty\.|completionDate)/.test(t.dataset.b)) renderCard("warranty");
    if (t.dataset.b && t.dataset.b.startsWith("diagram.") ) { renderCard("diagram"); }
  });
  $("cards").addEventListener("click", async e => {
    const t = e.target.closest("button"); if (!t || locked() && !t.dataset.sign) return;
    if (t.dataset.add) { R[t.dataset.add].push(BLANK[t.dataset.add]()); renderCard(t.dataset.add); toc(); touch(); const ins = $("c-" + t.dataset.add).querySelectorAll("tbody tr:last-child input"); if (ins[0]) ins[t.dataset.add === "boq" ? 1 : 0].focus(); return; }
    if (t.dataset.del) { const arr = getPath(t.dataset.del); arr.splice(Number(t.dataset.i), 1); renderCard(t.dataset.del.split(".")[0] === "scope" ? "text" : t.dataset.del); toc(); touch(); return; }
    if (t.dataset.clear) { if (!t.classList.contains("armed")) { t.classList.add("armed"); t.textContent = "Click again to clear"; setTimeout(() => { t.classList.remove("armed"); t.textContent = "Clear all"; }, 3000); return; } R[t.dataset.clear] = []; renderCard(t.dataset.clear); toc(); touch(); return; }
    if (t.dataset.import) return openImport(t.dataset.import);
    if (t.hasAttribute("data-addstream")) { R.scope.streams.push({ heading: String.fromCharCode(65 + R.scope.streams.length) + ". ", bullets: [] }); renderCard("text"); touch(); return; }
    if (t.dataset.mv) { const i = Number(t.dataset.i), j = i + Number(t.dataset.mv); [R.photos[i], R.photos[j]] = [R.photos[j], R.photos[i]]; renderCard("photos"); touch(); return; }
    if (t.dataset.ai) return draft(t.dataset.ai === "all" ? ["text", "closeout", "diagram"] : [t.dataset.ai], t);
    if (t.dataset.dsrc) { R.diagram.source = t.dataset.dsrc === "upload" ? "upload" : (R.diagram.nodes.length ? (R.diagram.source === "upload" ? "manual" : R.diagram.source || "manual") : ""); renderCard("diagram"); touch(); return; }
    if (t.dataset.dn) { diagEdit(t.dataset.dn, Number(t.dataset.i)); return; }
    if (t.dataset.sign) return signAction(t.dataset.sign, t);
    if (t.id === "psAdd") {
      const list = $("psList").value.split(/[\n,;\t]+/).map(x => x.trim()).filter(Boolean);
      if (!list.length) return toast("Paste at least one serial number.", true);
      const dupes = new Set(R.serials.map(r => r.serial.toUpperCase()));
      let skip = 0; list.forEach(sn => { if (dupes.has(sn.toUpperCase())) { skip++; return; } dupes.add(sn.toUpperCase()); R.serials.push({ type: $("psType").value.trim(), model: $("psModel").value.trim(), serial: sn, location: $("psLoc").value.trim() }); });
      renderCard("serials"); toc(); touch(); toast(`${list.length - skip} serial number${list.length - skip === 1 ? "" : "s"} added${skip ? `, ${skip} already in the register` : ""}.`); return;
    }
    if (t.id === "dNewCust") return openCust($("dCust"));
    if (t.id === "dRefresh") { await flush(); try { const res = await api("PUT", "pcr/reports/" + R.id, { etag: R.etag, refreshCustomer: true }); Object.assign(R, { etag: res.etag, customer: res.customer, customerName: res.customerName }); renderCard("details"); head(); toast("Customer details refreshed."); } catch (err) { toast(err.message, true); } }
  });
  // details card: the select needs its options after render
  const _rd = BUILD.details; BUILD.details = function () { setTimeout(() => { const s = $("dCust"); if (s) { custOptions(s, R.customerId); s.querySelector('option[value=""]').disabled = true; if (locked()) s.disabled = true; } }); return _rd(); };

  /* ================= Claude drafting / standard wording ================= */
  function applyTemplate(fillEmptyOnly) {
    const po = R.poRef ? `customer PO# ${R.poRef}` : "customer work order";
    const L = R.letter, co_ = B().name;
    const set = (o, k, v) => { if (!fillEmptyOnly || !o[k] || (Array.isArray(o[k]) && !o[k].length)) o[k] = v; };
    set(L, "subject", `Completion of ${po}`);
    set(L, "salutation", R.attention ? `Dear ${R.attention},` : "Dear Sir/Madam,");
    set(L, "body", [`Thank you for choosing ${co_} for the subject mentioned ${R.poRef ? "order" : "work order"}. We are pleased to confirm that ${R.projectTitle ? "the " + R.projectTitle.replace(/^./, c => c.toLowerCase()) : "the installation"} has been successfully completed and tested to meet your business requirements.`]
      .concat(R.mode === "certificate" ? [] : ["This report records the delivered scope, the equipment installed with serial numbers, the testing and commissioning results, the handover deliverables, and the applicable warranty terms. It also serves as the formal acceptance document for the order."]));
    set(L, "closing", "We appreciate your trust in our services and look forward to continuing to serve you.");
    set(R.scope, "intro", "The following scope has been delivered in full against the referenced order.");
    set(R, "handover", ["Device inventory with serial numbers", "As-built topology or layout drawing", "Configuration backups for all configurable devices", "Original equipment manufacturer warranty documentation", "Administrative credentials, handed over under separate confidential cover", "This signed completion report"]);
    set(R.warranty, "terms", ["Hardware is covered by the manufacturer's warranty for the period stated above, starting from the warranty start date.", `Installation workmanship by ${co_} is covered for the period stated above.`, "Hardware replacement follows the manufacturer's RMA process and lead times.", "Warranty claims must be raised in writing with the serial number and a description of the fault."]);
    set(R.warranty, "exclusions", ["Physical damage, misuse, unauthorised modification or relocation of equipment.", "Damage from power surges, lightning, water ingress or out-of-specification environmental conditions.", "Configuration changes made by third parties without our involvement.", "Consumables and UPS batteries beyond the manufacturer's stated warranty period.", "Any item not listed in this report."]);
    if (!R.warranty.hours) R.warranty.hours = B().hours;
  }
  async function draft(parts, btn) {
    await flush();
    if (!BOOT.features.ai) {
      applyTemplate(false); R.textSource = "template"; renderAll(); touch(); toast("Standard wording filled in. Check and edit it before sending."); return;
    }
    if (parts.length > 1 && !R.notes.trim() && !R.boq.length && !R.serials.length) { toast("Add the site notes, BoQ or serial numbers first, so Claude has something to work from.", true); $("c-notes").scrollIntoView({ behavior: "smooth" }); return; }
    const btns = [$("bAi"), btn].filter(Boolean); btns.forEach(b => busy(b, true, "Claude is drafting"));
    const instr = parts.length === 1 && parts[0] === "diagram" && $("dInstr") ? $("dInstr").value.trim() : "";
    const results = await Promise.allSettled(parts.map(p => api("POST", "pcr/ai", { id: R.id, part: p, instructions: instr || undefined })));
    btns.forEach(b => busy(b, false));
    const errs = [];
    results.forEach((r, i) => {
      const p = parts[i];
      if (r.status !== "fulfilled") { errs.push(r.reason.message); return; }
      const o = r.value || {};
      if (p === "text") {
        if (o.letter) R.letter = { subject: o.letter.subject || R.letter.subject, salutation: o.letter.salutation || R.letter.salutation, body: (o.letter.body || []).filter(Boolean).length ? o.letter.body : R.letter.body, closing: o.letter.closing || R.letter.closing };
        if (o.scope && Array.isArray(o.scope.streams)) R.scope = { intro: o.scope.intro || "", streams: o.scope.streams.map(s => ({ heading: String(s.heading || ""), bullets: (s.bullets || []).map(String) })) };
        if (Array.isArray(o.handover) && o.handover.length) R.handover = o.handover.map(String);
        R.textSource = "claude";
      }
      if (p === "closeout") {
        if (Array.isArray(o.testing)) { const old = new Map(R.testing.map(t => [String(t.test).toLowerCase(), t])); R.testing = o.testing.map(t => { const k = old.get(String(t.test || "").toLowerCase()); return { test: String(t.test || ""), method: String(t.method || ""), result: k && k.result ? k.result : ["Pass", "Fail", "Open", "N/A"].includes(t.result) ? t.result : "", remarks: String(t.remarks || (k && k.remarks) || "") }; }); }
        if (o.warranty) { if ((o.warranty.terms || []).length) R.warranty.terms = o.warranty.terms.map(String); if ((o.warranty.exclusions || []).length) R.warranty.exclusions = o.warranty.exclusions.map(String); }
        if (Array.isArray(o.snags) && o.snags.length) { R.snags = o.snags.map(s => ({ item: String(s.item || ""), owner: String(s.owner || ""), target: String(s.target || "") })); R.include.snags = true; }
      }
      if (p === "diagram" && Array.isArray(o.nodes) && o.nodes.length) {
        R.diagram = Object.assign(R.diagram, { title: o.title || R.diagram.title, caption: o.caption || R.diagram.caption, source: "claude",
          nodes: o.nodes.slice(0, 40).map(n => ({ id: String(n.id || "").replace(/[^\w-]/g, "").slice(0, 30), label: String(n.label || ""), sub: String(n.sub || ""), kind: PCRDIAGRAM.KINDS[n.kind] ? n.kind : "other", tier: Math.max(0, Math.min(6, Math.round(Number(n.tier) || 0))) })).filter(n => n.id && n.label),
          edges: (o.edges || []).slice(0, 80).map(e => ({ from: String(e.from || ""), to: String(e.to || ""), label: String(e.label || "") })) });
      }
    });
    renderAll(); touch(); await flush();
    if (errs.length === results.length) toast(errs[0], true);
    else toast(errs.length ? "Part of the draft failed: " + errs[0] : "Claude's draft is in. Check every section before sending.", !!errs.length);
  }
  $("bAi").onclick = () => locked() ? toast("Reopen the report to change it.", true) : draft(["text", "closeout", "diagram"], null);

  /* ================= diagram ================= */
  const diagColors = () => Object.assign({}, B().diag, { line: "#8FA6BC", text: "#1F2733", muted: "#5E6B7A", bg: "#FFFFFF" });
  function drawDiagram() {
    const box = $("diagBox"); if (!box) return; const D = R.diagram;
    if (D.source === "upload") { box.innerHTML = D.imageId ? `<img src="/api/pcr/files/${esc(D.imageId)}" alt="${esc(D.title || "System diagram")}">` : `<div class="ph">No drawing uploaded yet.</div>`; const dd = $("diagDrop"); if (dd) bindDrop(dd, f => uploadDiagram(f[0])); return; }
    const r = PCRDIAGRAM.svg(D, diagColors());
    box.innerHTML = r ? r.svg : `<div class="ph">No diagram yet. ${BOOT.features.ai ? "Add the BoQ or serial numbers, then use <b>Draw with Claude</b>, or add boxes by hand below." : "Add boxes and links by hand below, or upload your own drawing."}</div>`;
  }
  function diagEditor() {
    const D = R.diagram, opts = sel => Object.entries(PCRDIAGRAM.KINDS).map(([k, l]) => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(l)}</option>`).join("");
    const ids = v => D.nodes.map(n => `<option value="${esc(n.id)}"${n.id === v ? " selected" : ""}>${esc(n.label)}</option>`).join("");
    return `<div class="tblwrap" style="margin-top:10px"><table class="grid-tbl"><thead><tr><th>Box</th><th>Second line</th><th style="width:150px">Kind</th><th style="width:80px">Row</th><th></th></tr></thead><tbody>
      ${D.nodes.map((n, i) => `<tr><td><input data-b="diagram.nodes.${i}.label" value="${esc(n.label)}" maxlength="60"></td><td><input data-b="diagram.nodes.${i}.sub" value="${esc(n.sub)}" maxlength="80"></td><td><select data-b="diagram.nodes.${i}.kind">${opts(n.kind)}</select></td><td><input data-b="diagram.nodes.${i}.tier" type="number" min="0" max="6" value="${n.tier}"></td><td class="x"><button type="button" class="x" data-dn="delnode" data-i="${i}" aria-label="Remove box">&times;</button></td></tr>`).join("")}
      </tbody></table></div><div class="btnrow" style="margin:8px 0 14px"><button type="button" data-dn="addnode">Add box</button><span class="hint">Row 0 is the top of the drawing (internet), higher rows sit lower.</span></div>
      <div class="tblwrap"><table class="grid-tbl"><thead><tr><th>From</th><th>To</th><th>Link label</th><th></th></tr></thead><tbody>
      ${D.edges.map((e, i) => `<tr><td><select data-b="diagram.edges.${i}.from">${ids(e.from)}</select></td><td><select data-b="diagram.edges.${i}.to">${ids(e.to)}</select></td><td><input data-b="diagram.edges.${i}.label" value="${esc(e.label)}" maxlength="40" placeholder="e.g. 1G uplink, PoE, power"></td><td class="x"><button type="button" class="x" data-dn="deledge" data-i="${i}" aria-label="Remove link">&times;</button></td></tr>`).join("")}
      </tbody></table></div><div class="btnrow" style="margin-top:8px"><button type="button" data-dn="addedge"${D.nodes.length > 1 ? "" : " disabled"}>Add link</button></div>`;
  }
  function diagEdit(op, i) {
    const D = R.diagram;
    if (op === "addnode") { let n = D.nodes.length + 1; while (D.nodes.some(x => x.id === "n" + n)) n++; D.nodes.push({ id: "n" + n, label: "New device", sub: "", kind: "other", tier: Math.max(0, ...D.nodes.map(x => x.tier)) }); }
    if (op === "delnode") { const id = D.nodes[i].id; D.nodes.splice(i, 1); D.edges = D.edges.filter(e => e.from !== id && e.to !== id); }
    if (op === "addedge") D.edges.push({ from: D.nodes[0].id, to: D.nodes[1].id, label: "" });
    if (op === "deledge") D.edges.splice(i, 1);
    if (D.source !== "claude") D.source = "manual";
    const open = $("c-diagram").querySelector("details").open; renderCard("diagram"); $("c-diagram").querySelector("details").open = open; toc(); touch();
  }
  async function uploadDiagram(file) {
    if (!file) return;
    try { const r = await resize(file, 2400, file.type === "image/png" ? "image/png" : "image/jpeg"); const up = await api("POST", "pcr/files", { name: file.name, type: r.type, data: await toB64(r.blob) });
      Object.assign(R.diagram, { imageId: up.id, imageW: r.w, imageH: r.h, source: "upload" }); renderCard("diagram"); toc(); touch(); } catch (e) { toast(e.message, true); }
  }

  /* ================= photos ================= */
  function bindDrop(el, fn) {
    if (!el) return; const inp = el.querySelector("input[type=file]");
    inp.onchange = () => { fn([...inp.files]); inp.value = ""; };
    el.ondragover = e => { e.preventDefault(); el.classList.add("on"); }; el.ondragleave = () => el.classList.remove("on");
    el.ondrop = e => { e.preventDefault(); el.classList.remove("on"); fn([...e.dataTransfer.files]); };
  }
  async function resize(file, max, type) {
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(file.name + " isn't an image this browser can read. Use JPG or PNG.")); i.src = url; });
      const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)); const w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h); cx.drawImage(im, 0, 0, w, h);
      const blob = await new Promise(r => cv.toBlob(r, type, 0.82)); return { blob, w, h, type };
    } finally { URL.revokeObjectURL(url); }
  }
  async function addPhotos(files) {
    files = files.filter(f => /^image\//.test(f.type)); if (!files.length) return;
    if (R.photos.length + files.length > 60) return toast("A report can hold up to 60 pictures.", true);
    let n = 0; setSave(`Uploading ${files.length} picture${files.length > 1 ? "s" : ""}…`);
    for (const f of files) {
      try { const r = await resize(f, 1600, "image/jpeg"); const up = await api("POST", "pcr/files", { name: f.name.replace(/\.[^.]+$/, "") + ".jpg", type: "image/jpeg", data: await toB64(r.blob) });
        R.photos.push({ id: up.id, caption: "", w: r.w, h: r.h, by: ME.email, at: new Date().toISOString() }); n++; } catch (e) { toast(e.message, true); }
    }
    renderCard("photos"); toc(); touch(); if (n) toast(`${n} picture${n > 1 ? "s" : ""} added. Add a caption to each.`);
  }

  /* ================= import BoQ / serials ================= */
  const MAP = {
    boq: [["item", "Item no.", /^(#|item\s*(no|#)?|s\.?\s*no\.?|sr\.?\s*(no)?|sl\.?\s*no\.?|no\.?)$/i], ["desc", "Description", /desc|particular|item|product|scope/i], ["model", "Make / model", /model|make|brand|part|sku|code/i], ["qty", "Qty", /^qty|quant/i], ["unit", "Unit", /^(unit|uom|u\/m)$/i], ["remarks", "Remarks", /remark|note|comment/i]],
    serials: [["type", "Device type", /type|device|item|descr|product|category/i], ["model", "Make & model", /model|make|brand|part|sku/i], ["serial", "Serial number", /serial|s\/n|^sn$|^s\.n/i], ["location", "Location", /loc|area|floor|room|site|zone/i]],
  };
  let IMP = null;
  function openImport(key) {
    IMP = { key, head: [], rows: [] };
    $("impTitle").textContent = key === "boq" ? "Import the customer's BoQ" : "Import equipment and serial numbers";
    $("impPaste").value = ""; $("impMap").innerHTML = ""; $("impErr").textContent = ""; $("impGo").disabled = true; $("impReplace").checked = !R[key].length;
    $("impDlg").showModal();
  }
  function setGrid(grid) {
    grid = grid.map(r => r.map(c => String(c == null ? "" : c).trim())).filter(r => r.some(Boolean));
    // The heading row is the first row that matches at least two known columns (BoQs often start with a title block).
    let hi = grid.findIndex(r => MAP[IMP.key].filter(([, , re]) => r.some(c => re.test(c))).length >= 2); if (hi < 0) hi = 0;
    IMP.head = grid[hi] || []; IMP.rows = grid.slice(hi + 1);
    const used = new Set();
    const guess = MAP[IMP.key].map(([k, , re]) => { const j = IMP.head.findIndex((h, j) => !used.has(j) && re.test(h)); if (j >= 0) used.add(j); return j; });
    $("impMap").innerHTML = `<div class="grid2">${MAP[IMP.key].map(([k, label], i) => `<label><span class="lbl">${esc(label)}</span><select data-k="${k}"><option value="-1">(not in file)</option>${IMP.head.map((h, j) => `<option value="${j}"${guess[i] === j ? " selected" : ""}>${esc(h || "Column " + (j + 1))}</option>`).join("")}</select></label>`).join("")}</div><p class="hint">${IMP.rows.length} row${IMP.rows.length === 1 ? "" : "s"} found under the heading row. Rows without a ${IMP.key === "boq" ? "description" : "serial number"} are skipped.</p>`;
    $("impGo").disabled = !IMP.rows.length;
  }
  bindDrop(document.querySelector("#impDlg .drop"), async files => {
    const f = files[0]; if (!f) return; $("impErr").textContent = "";
    try {
      if (/\.csv$/i.test(f.name) || f.type === "text/csv") setGrid(parseDelim(await f.text(), ","));
      else { await loadScript(LIB.xlsx); const wb = XLSX.read(await f.arrayBuffer(), { type: "array" }); const ws = wb.Sheets[wb.SheetNames[0]]; setGrid(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" })); }
    } catch (e) { $("impErr").textContent = /library/.test(e.message) ? e.message : "That file couldn't be read. Save it as .xlsx or .csv and try again."; }
  });
  $("impPaste").addEventListener("input", () => { const t = $("impPaste").value; if (t.trim()) setGrid(parseDelim(t, t.includes("\t") ? "\t" : ",")); });
  function parseDelim(text, d) {
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) { const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"' && !cur) q = true; else if (ch === d) { row.push(cur); cur = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; } else cur += ch; }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  $("impForm").onsubmit = e => {
    e.preventDefault();
    const idx = {}; $("impMap").querySelectorAll("select[data-k]").forEach(s => idx[s.dataset.k] = Number(s.value));
    const must = IMP.key === "boq" ? "desc" : "serial";
    if (idx[must] < 0) { $("impErr").textContent = `Choose which column holds the ${IMP.key === "boq" ? "description" : "serial number"}.`; return; }
    const out = IMP.rows.map(r => Object.fromEntries(MAP[IMP.key].map(([k]) => [k, idx[k] >= 0 ? String(r[idx[k]] || "").trim() : ""]))).filter(r => r[must] && !/^(sub\s*total|total|grand total|vat)/i.test(r[must]));
    if (IMP.key === "boq") out.forEach(r => { if (/^\d+(\.0+)?$/.test(r.qty)) r.qty = String(Number(r.qty)); });
    const cap = IMP.key === "boq" ? 400 : 1000;
    R[IMP.key] = ($("impReplace").checked ? [] : R[IMP.key]).concat(out).slice(0, cap);
    $("impDlg").close(); renderCard(IMP.key); toc(); touch(); toast(`${out.length} row${out.length === 1 ? "" : "s"} imported.`);
  };

  /* ================= signatures ================= */
  const pad = (() => {
    const cv = $("sPad"), cx = cv.getContext("2d"); let drawing = false, ink = false, last = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height, p: e.pressure || 0.5 }; };
    cv.addEventListener("pointerdown", e => { drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); e.preventDefault(); });
    cv.addEventListener("pointermove", e => { if (!drawing) return; const p = pos(e); cx.strokeStyle = "#0A1C33"; cx.lineCap = "round"; cx.lineJoin = "round"; cx.lineWidth = 2.4 + 2.6 * (e.pointerType === "pen" ? p.p : 0.5); cx.beginPath(); cx.moveTo(last.x, last.y); cx.lineTo(p.x, p.y); cx.stroke(); last = p; ink = true; e.preventDefault(); });
    ["pointerup", "pointercancel", "pointerleave"].forEach(ev => cv.addEventListener(ev, () => drawing = false));
    const clear = () => { cx.clearRect(0, 0, cv.width, cv.height); ink = false; };
    $("sClear").onclick = clear;
    // The PNG is cropped to the ink so it sits neatly on the signature line.
    function png() {
      const d = cx.getImageData(0, 0, cv.width, cv.height).data; let x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0;
      for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) if (d[(y * cv.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 <= x0) return null; const m = 12; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(cv.width, x1 + m); y1 = Math.min(cv.height, y1 + m);
      const o = document.createElement("canvas"); o.width = x1 - x0; o.height = y1 - y0; o.getContext("2d").drawImage(cv, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
      return o.toDataURL("image/png");
    }
    return { clear, png, has: () => ink };
  })();
  let SIGMODE = "customer";
  function openSign(mode) {
    SIGMODE = mode; pad.clear(); $("sErr").textContent = "";
    const cust = mode === "customer";
    $("sigTitle").textContent = cust ? "Customer signature" : "Company signature";
    $("sigIntro").textContent = cust ? `Hand the device to the customer's representative. They confirm the works under ${R.docNo} are complete and accepted.` : `Sign as ${R.preparedBy || "the person who prepared the report"} for ${B().name}.`;
    $("sigWho").hidden = !cust; $("sAgreeL").hidden = !cust;
    $("sName").value = cust ? R.attention || "" : ""; $("sDesig").value = ""; $("sAgree").checked = false;
    $("sAgreeT").textContent = `I confirm, on behalf of ${R.customerName}, that the works described in ${R.docNo}${R.poRef ? " under PO " + R.poRef : ""} have been completed and are accepted${R.include.snags && R.snags.length ? ", subject to the open items in the snag list" : ""}.`;
    $("sigDlg").showModal();
  }
  $("sigForm").onsubmit = async e => {
    e.preventDefault(); $("sErr").textContent = "";
    const img = pad.png(); if (!img) { $("sErr").textContent = "Sign in the box first."; return; }
    if (SIGMODE === "customer") { if (!$("sName").value.trim()) { $("sErr").textContent = "Enter the name of the person signing."; return; } if (!$("sAgree").checked) { $("sErr").textContent = "Tick the box to confirm the works are accepted."; return; } }
    busy($("sGo"), true, "Saving"); await flush();
    try {
      const res = SIGMODE === "customer" ? await api("POST", `pcr/reports/${R.id}/sign`, { name: $("sName").value, designation: $("sDesig").value, agree: true, image: img })
        : await api("POST", `pcr/reports/${R.id}/company-sign`, { image: img });
      R = Object.assign(res, { _custLoaded: res.customerId }); $("sigDlg").close(); renderAll(); toast(SIGMODE === "customer" ? "Signed. The report is now locked." : "Company signature added.");
    } catch (err) { $("sErr").textContent = err.message; } finally { busy($("sGo"), false); }
  };
  let LINKURL = "";
  async function signAction(what, btn) {
    if (what === "customer") return openSign("customer");
    if (what === "company") return openSign("company");
    if (what === "company-clear") { await flush(); try { const res = await api("POST", `pcr/reports/${R.id}/company-sign`, { clear: true }); R = Object.assign(res, { _custLoaded: res.customerId }); renderAll(); } catch (e) { toast(e.message, true); } return; }
    if (what === "print") return download("pdf", btn);
    if (what === "link") {
      if (R.link) return showLink();
      busy(btn, true, "Creating link"); await flush();
      try { const res = await api("POST", `pcr/reports/${R.id}/link`, { etag: R.etag, origin: location.origin }); LINKURL = res.url; R = Object.assign(res.report, { _custLoaded: res.report.customerId }); renderAll(); showLink(); }
      catch (e) { toast(e.message, true); } finally { busy(btn, false); }
    }
  }
  function showLink() {
    if (!R.link) return;
    if (!LINKURL || !LINKURL.endsWith(R.link.token)) LINKURL = `${location.origin}/sign/?k=${R.link.token}`;
    $("lUrl").value = LINKURL; $("lExp").textContent = fd(R.link.expires.slice(0, 10)); $("lMail").hidden = !BOOT.features.mail; $("linkDlg").showModal(); $("lUrl").select();
  }
  $("lCopy").onclick = async () => { try { await navigator.clipboard.writeText($("lUrl").value); toast("Link copied."); } catch { $("lUrl").select(); document.execCommand("copy"); toast("Link copied."); } };
  $("lRevoke").onclick = async () => { try { const res = await api("DELETE", `pcr/reports/${R.id}/link`); R = Object.assign(res, { _custLoaded: res.customerId }); LINKURL = ""; $("linkDlg").close(); renderAll(); toast("Signing link cancelled."); } catch (e) { toast(e.message, true); } };
  $("lMail").onclick = () => { $("linkDlg").close(); openMail(true); };
  async function reopen() {
    const b = $("bReopen"); if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Click again: this removes the customer's signature"; setTimeout(() => { if (b.isConnected) { b.classList.remove("armed"); b.textContent = "Reopen to edit"; } }, 4000); return; }
    try { const res = await api("POST", `pcr/reports/${R.id}/reopen`); R = Object.assign(res, { _custLoaded: res.customerId }); renderAll(); toast("Reopened. Get the customer to sign again when you're done."); } catch (e) { toast(e.message, true); }
  }

  /* ================= documents ================= */
  async function loadImg(url) {
    const r = await fetch(url, { cache: "force-cache" }); if (!r.ok) return null;
    const blob = await r.blob(); const bytes = new Uint8Array(await blob.arrayBuffer());
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const bm = await createImageBitmap(blob).catch(() => null); if (!bm) return null;
    return { bytes, w: bm.width, h: bm.height, dataUrl: `data:image/${isPng ? "png" : "jpeg"};base64,` + b64(bytes), fmt: isPng ? "PNG" : "JPEG", type: isPng ? "png" : "jpg" };
  }
  async function buildCfg() {
    const br = B(), title = R.mode === "certificate" ? "Work Completion Certificate" : "Project Completion Report";
    const cu = R.customer || {}, s = R.signature, cs = R.company || {};
    const inc = Object.assign({}, R.include);
    const [logo, stamp, csig, ssig] = await Promise.all([loadImg(br.logo), inc.stamp && br.stamp ? loadImg(br.stamp) : null, cs.fileId ? loadImg("/api/pcr/files/" + cs.fileId) : null, s && s.fileId ? loadImg("/api/pcr/files/" + s.fileId) : null]);
    const photos = inc.photos ? (await Promise.all(R.photos.map(async p => { const im = await loadImg("/api/pcr/files/" + p.id); return im && Object.assign(im, { caption: p.caption }); }))).filter(Boolean) : [];
    let diagramImg = null;
    if (inc.diagram) diagramImg = R.diagram.source === "upload" ? (R.diagram.imageId ? await loadImg("/api/pcr/files/" + R.diagram.imageId) : null) : await PCRDIAGRAM.png(R.diagram, diagColors());
    const w = R.warranty, start = w.start || R.completionDate || today();
    const until = m => m ? addDays(addMonths(start, m), -1) : "";
    const parts = []; if (w.hwMonths) parts.push(`a ${w.hwMonths} month hardware warranty`); if (w.wkMonths) parts.push(`a ${w.wkMonths} month workmanship warranty`);
    const dropBlank = rows => rows.filter(r => Object.values(r).some(v => String(v).trim()));
    return {
      brand: co(), mode: R.mode, docNo: R.docNo, issueDate: s ? s.at.slice(0, 10) : today(), headerTitle: `${title}  |  ${shortName(R.customerName)}`,
      projectTitle: R.projectTitle, poRef: R.poRef, poDate: R.poDate, site: R.site, startDate: R.startDate, completionDate: R.completionDate, preparedBy: R.preparedBy, preparedTitle: R.preparedTitle,
      statusLine: s ? "Completed, tested, handed over and accepted by the client" : "Completed, tested and handed over",
      customer: { name: R.customerName, trn: cu.trn, attention: R.attention, addressLines: [cu.address, cu.emirate].filter(Boolean).join(", ").split(/\s*[\n,]\s*/).filter(Boolean).reduce((a, x) => { const l = a[a.length - 1]; if (l && (l + ", " + x).length < 48) a[a.length - 1] = l + ", " + x; else a.push(x); return a; }, []) },
      include: inc, letter: R.letter, scope: R.scope, boq: dropBlank(R.boq), serials: dropBlank(R.serials), testing: dropBlank(R.testing), handover: R.handover, snags: dropBlank(R.snags),
      diagram: R.diagram, diagramImg, photos,
      warranty: Object.assign({}, w, { start, hwUntil: until(w.hwMonths), wkUntil: until(w.wkMonths) }),
      warrantyLine: parts.length ? `The equipment and works carry ${parts.join(" and ")}, from ${fd(start)}${w.hours ? ". Support is available " + w.hours.replace(/^./, c => c.toLowerCase()) : ""}.` : "",
      supportLine: br.support,
      signoff: {
        company: { name: R.preparedBy, title: R.preparedTitle, company: br.name, date: cs.at ? fd(cs.at.slice(0, 10)) : "", sigImg: csig, stamp, stampable: co() === "bifold" },
        customer: s ? { name: s.name, title: s.designation, company: R.customerName, date: fd(s.at.slice(0, 10)), sigImg: ssig, note: PCRSIGN(s), stampable: true } : { name: "", title: "", company: R.customerName, date: "", sigImg: null, stampable: true },
      },
      _img: { logo },
    };
  }
  const PCRSIGN = s => `Signed electronically ${s.method === "link" ? "using a secure signing link" : "on site"} on ${fdt(s.at)} (UAE time)`;
  async function build(kind) {
    await flush();
    const cfg = await buildCfg();
    if (kind === "docx") { await loadScript(LIB.docx); return window.docx.Packer.toBlob(PCRGEN.docx(window.docx, cfg, cfg._img)); }
    await loadScript(LIB.jspdf); await loadScript(LIB.autotable);
    return PCRGEN.pdf(window.jspdf.jsPDF, cfg, cfg._img).output("blob");
  }
  const fileName = ext => safeName(`${R.docNo} ${shortName(R.customerName)} ${R.mode === "certificate" ? "Completion Certificate" : "Completion Report"}${R.status === "signed" ? " (signed)" : ""}`) + "." + ext;
  async function download(kind, btn) {
    const warn = checks(); if (warn) toast(warn, true);
    busy(btn, true, kind === "docx" ? "Word" : "PDF");
    try { saveBlob(fileName(kind), await build(kind)); } catch (e) { toast(e.message || "The document couldn't be made.", true); } finally { busy(btn, false); }
  }
  // Things worth fixing before a customer sees the document.
  function checks() {
    if (!R.customerName) return "";
    const miss = [];
    if (R.include.serials && R.serials.some(r => !r.serial)) miss.push("some equipment rows have no serial number");
    if (!R.poRef) miss.push("there is no customer PO reference");
    if (R.include.photos && R.photos.some(p => !p.caption)) miss.push("some pictures have no caption");
    return miss.length ? "Check before sending: " + miss.join(", ") + "." : "";
  }
  $("bDocx").onclick = () => download("docx", $("bDocx"));
  $("bPdf").onclick = () => download("pdf", $("bPdf"));

  /* ================= email ================= */
  function openMail(withLink) {
    const cu = R.customer || {};
    $("mTo").value = cu.email || ""; $("mCc").value = ""; $("mErr").textContent = "";
    $("mSubj").value = `${R.mode === "certificate" ? "Work Completion Certificate" : "Project Completion Report"} ${R.docNo}${R.poRef ? " | PO " + R.poRef : ""}`;
    const signed = R.status === "signed";
    $("mMsg").value = `${R.attention ? "Dear " + R.attention + "," : "Dear Sir/Madam,"}\n\nPlease find attached the ${R.mode === "certificate" ? "work completion certificate" : "project completion report"} for ${R.projectTitle || "the completed works"}${R.poRef ? " under your PO " + R.poRef : ""}.${signed ? "" : "\n\nWe would be grateful if you could review it and confirm your acceptance."}\n\nKind regards,\n${R.preparedBy}${R.preparedTitle ? "\n" + R.preparedTitle : ""}\n${B().name}`;
    $("mLinkL").hidden = signed; $("mLink").checked = !signed && (withLink || !!R.link);
    $("mailDlg").showModal();
  }
  $("bMail").onclick = () => openMail(false);
  $("mailForm").onsubmit = async e => {
    e.preventDefault(); $("mErr").textContent = "";
    if (!$("mTo").value.trim()) { $("mErr").textContent = "Add the customer's email address."; return; }
    busy($("mGo"), true, "Sending");
    try {
      const withLink = $("mLink").checked && R.status !== "signed";
      if (withLink && !R.link) { const res = await api("POST", `pcr/reports/${R.id}/link`, { etag: R.etag, origin: location.origin }); LINKURL = res.url; R = Object.assign(res.report, { _custLoaded: res.report.customerId }); }
      if (withLink && (!LINKURL || !LINKURL.endsWith(R.link.token))) LINKURL = `${location.origin}/sign/?k=${R.link.token}`;
      const pdf = await build("pdf");
      const paras = $("mMsg").value.split(/\n\s*\n/).map(p => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`);
      if (withLink) paras.splice(Math.max(1, paras.length - 1), 0, `<p style="margin:0 0 18px"><a href="${esc(LINKURL)}" style="display:inline-block;background:#${PCRGEN.BRANDS[co()].primary};color:#fff;text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:6px">Review and sign online</a><br><span style="font-size:12px;color:#777">The link works once and expires on ${esc(fd(R.link.expires.slice(0, 10)))}.</span></p>`);
      await api("POST", `pcr/reports/${R.id}/share`, { to: $("mTo").value, cc: $("mCc").value, subject: $("mSubj").value, withLink, html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">${paras.join("")}</div>`, attachment: { name: fileName("pdf"), data: await toB64(pdf) } });
      $("mailDlg").close(); toast("Email sent."); R = Object.assign(await api("GET", "pcr/reports/" + R.id), { _custLoaded: R.customerId }); renderAll();
    } catch (err) { $("mErr").textContent = err.message; } finally { busy($("mGo"), false); }
  };

  /* ================= more menu ================= */
  $("bMore").onclick = e => { e.stopPropagation(); $("moreMenu").hidden = !$("moreMenu").hidden; };
  document.addEventListener("click", e => { if (!e.target.closest("#moreMenu")) $("moreMenu").hidden = true; });
  $("bHist").onclick = () => { $("histList").innerHTML = (R.history || []).slice().reverse().map(h => `<div><time>${esc(fdt(h.at))}</time><span>${esc(h.text)}<br><span class="hint" style="margin:0">${esc(h.by)}</span></span></div>`).join("") || "<p>No history yet.</p>"; $("histDlg").showModal(); };
  $("bDel").onclick = async () => {
    const b = $("bDel"); if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Click again to delete"; setTimeout(() => { b.classList.remove("armed"); b.textContent = "Delete report"; }, 3500); return; }
    try { clearTimeout(timer); dirty = false; await api("DELETE", "pcr/reports/" + R.id); BOOT.reports = (BOOT.reports || []).filter(x => x.id !== R.id); R = null; toast("Report deleted."); location.hash = "list"; } catch (e) { toast(e.message, true); }
  };
})();
