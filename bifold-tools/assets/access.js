// Bifold Tools application frame + team access, loaded by every page:
//   <script src="/assets/access.js" data-section="pnl"></script>   (a section key, "amc|visits", or none for the home page)
// Builds the navy sidebar (only the tools this person can use), the top bar with breadcrumb, Ctrl+K search,
// alerts and user menu, and blocks a page whose section they don't have. The API enforces the same rules.
(function () {
  const script = document.currentScript;
  const pageNeeds = (script && script.dataset.section || "").split("|").filter(Boolean);
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/assets/shell.css"; document.head.appendChild(link);
  document.documentElement.style.visibility = "hidden";
  const reveal = () => { document.documentElement.style.visibility = ""; };
  const failsafe = setTimeout(reveal, 4000);
  // Company: each person works in their own company's tools (Bifold or Tech Hub); the API enforces the separation.
  // Group admins can switch company; their choice is sent as a header, which the API ignores for everyone else.
  const BRANDS = {
    bifold: { key: "bifold", tools: "Bifold Tools", name: "Bifold Technologies L.L.C", short: "Bifold", logo: "/assets/bifold_logo.png", foot: "Al Garhoud, Dubai", manager: "Ranjan" },
    techhub: { key: "techhub", tools: "Tech Hub Tools", name: "Tech Hub Information Technology", short: "Tech Hub", logo: "/assets/techhub/techhub_logo.png", foot: "Al Nakheel, Ras Al Khaimah", manager: "Ranjan" },
  };
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const isHome = /^\/(index\.html)?$/.test(location.pathname);
  const chosen = store.get("bx-co");
  const sendCo = chosen && (chosen !== "all" || isHome) ? chosen : null;
  if (sendCo && /^(bifold|techhub|all)$/.test(sendCo)) {
    const of = window.fetch.bind(window);
    window.fetch = (u, o) => {
      const url = typeof u === "string" ? u : (u && u.url) || "";
      if (url.startsWith("/api/") || url.startsWith(location.origin + "/api/")) {
        o = Object.assign({}, o); const h = new Headers(o.headers || (typeof u === "string" ? undefined : u.headers)); h.set("x-bifold-company", sendCo); o.headers = h;
      }
      return of(u, o);
    };
  }
  const last = store.get("bx-last-co");
  if (last) document.documentElement.dataset.co = last;
  let BR = BRANDS[last === "techhub" ? "techhub" : "bifold"];
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // PDF preview shared by every tool: BXPdf.preview(build, fileName), where build is a Blob, a promise of one, or a
  // function returning one. Pages are drawn with pdf.js (hosted in /assets/pdfjs/), so the preview works the same on
  // phones and tablets as on a PC and doesn't depend on the browser's own PDF viewer.
  window.BXPdf = (function () {
    let dlg, url = "", blob = null, name = "document.pdf", pdf = null, zoom = 1, obs = null, run = 0;
    const PDFJS = "/assets/pdfjs/";
    let libP = null;
    const lib = () => libP || (libP = new Promise((res, rej) => {
      if (window.pdfjsLib) return res(window.pdfjsLib);
      const s = document.createElement("script"); s.src = PDFJS + "pdf.min.js";
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; res(window.pdfjsLib); };
      s.onerror = () => { libP = null; rej(new Error("The preview viewer couldn't load. Check your connection, or use Download PDF.")); };
      document.head.appendChild(s);
    }));
    function ui() {
      if (dlg) return dlg;
      const st = document.createElement("style");
      st.textContent = `.bxpv{border:0;padding:0;width:min(1120px,calc(100vw - 24px));height:calc(100vh - 24px);max-height:none;max-width:none;border-radius:14px;overflow:hidden;background:var(--surface,#fff);color:var(--fg,#15222e);box-shadow:0 24px 64px rgba(10,28,51,.35)}
.bxpv::backdrop{background:rgba(10,20,30,.55)}
.bxpv[open]{display:flex;flex-direction:column}
.bxpv .hd{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line,#d5dce3);flex-wrap:wrap}
.bxpv .hd b{flex:1 1 220px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.bxpv .hd button,.bxpv .hd a{font:inherit;font-size:13px;font-weight:600;cursor:pointer;border-radius:8px;border:1px solid var(--line,#d5dce3);background:var(--surface,#fff);color:var(--fg,#15222e);padding:7px 12px;text-decoration:none;white-space:nowrap}
.bxpv .hd button:disabled{opacity:.5;cursor:default}
.bxpv .hd .dl{background:var(--accent,#1E5A8C);border-color:var(--accent,#1E5A8C);color:var(--on-accent,#fff)}
.bxpv .zm{display:inline-flex;align-items:center;gap:4px}
.bxpv .zm button{padding:7px 11px}
.bxpv .zm span{font-size:12px;color:var(--muted,#5b6a78);min-width:74px;text-align:center;font-variant-numeric:tabular-nums}
.bxpv .bd{flex:1;position:relative;background:#525659;overflow:auto;-webkit-overflow-scrolling:touch}
.bxpv .pages{display:grid;justify-items:center;gap:14px;padding:16px 12px 28px}
.bxpv .pg{background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35);position:relative}
.bxpv .pg canvas{display:block;width:100%;height:100%}
.bxpv .msg{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-size:14px;text-align:center;padding:24px}
.bxpv .msg[hidden]{display:none}
.bxpv .spin{width:22px;height:22px;border:3px solid #fff;border-right-color:transparent;border-radius:50%;display:inline-block;animation:bxpvs .7s linear infinite;margin-bottom:10px}
@keyframes bxpvs{to{transform:rotate(360deg)}}
@media (max-width:640px){.bxpv{width:100vw;height:100dvh;border-radius:0}.bxpv .hd b{flex-basis:100%}.bxpv .tab{display:none}}`;
      document.head.appendChild(st);
      dlg = document.createElement("dialog"); dlg.className = "bxpv"; dlg.setAttribute("aria-label", "PDF preview");
      dlg.innerHTML = `<div class="hd"><b></b><span class="zm"><button type="button" class="zo" aria-label="Zoom out">&minus;</button><span class="pc"></span><button type="button" class="zi" aria-label="Zoom in">+</button></span><button type="button" class="dl" disabled>Download PDF</button><a class="tab" target="_blank" rel="noopener" hidden>Open in new tab</a><button type="button" class="x">Close</button></div><div class="bd"><div class="pages"></div><div class="msg"></div></div>`;
      document.body.appendChild(dlg);
      dlg.querySelector(".x").onclick = () => dlg.close();
      dlg.querySelector(".dl").onclick = () => { if (!blob) return; const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
      dlg.querySelector(".zo").onclick = () => setZoom(zoom / 1.25);
      dlg.querySelector(".zi").onclick = () => setZoom(zoom * 1.25);
      dlg.addEventListener("close", () => { run++; if (obs) obs.disconnect(); dlg.querySelector(".pages").innerHTML = ""; if (pdf) { pdf.destroy(); pdf = null; } if (url) { const u = url; setTimeout(() => URL.revokeObjectURL(u), 1000); } url = ""; blob = null; });
      return dlg;
    }
    function setZoom(z) { if (!pdf) return; zoom = Math.max(0.5, Math.min(3, z)); layout(); }
    // Sizes every page for the current zoom, then draws pages as they scroll into view.
    async function layout() {
      if (!pdf) return;
      const me = run, box = dlg.querySelector(".pages"), bd = dlg.querySelector(".bd");
      if (obs) obs.disconnect();
      box.innerHTML = "";
      const avail = Math.max(240, bd.clientWidth - 24);
      const first = await pdf.getPage(1); if (me !== run) return;
      const base = first.getViewport({ scale: 1 });
      const fit = Math.min(avail / base.width, 1.6);
      dlg.querySelector(".pc").textContent = `${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"} · ${zoom === 1 ? "fit" : Math.round(zoom * 100) + "%"}`;
      const els = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const el = document.createElement("div"); el.className = "pg"; el.dataset.n = i;
        el.style.width = Math.round(base.width * fit * zoom) + "px"; el.style.height = Math.round(base.height * fit * zoom) + "px";
        box.appendChild(el); els.push(el);
      }
      obs = new IntersectionObserver(ents => ents.forEach(en => { if (en.isIntersecting && !en.target.dataset.done) { en.target.dataset.done = "1"; draw(en.target, fit * zoom, me); } }), { root: bd, rootMargin: "600px 0px" });
      els.forEach(e => obs.observe(e));
    }
    async function draw(el, scale, me) {
      try {
        const page = await pdf.getPage(Number(el.dataset.n)); if (me !== run) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const vp = page.getViewport({ scale: scale * dpr });
        const cv = document.createElement("canvas"); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
        el.style.height = Math.round(vp.height / dpr) + "px";
        await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
        if (me === run) el.appendChild(cv);
      } catch (e) { el.dataset.done = ""; }
    }
    async function preview(build, fileName) {
      const d = ui(); name = String(fileName || "document.pdf"); if (!/\.pdf$/i.test(name)) name += ".pdf";
      const me = ++run, msg = d.querySelector(".msg"), dl = d.querySelector(".dl"), tab = d.querySelector(".tab");
      d.querySelector(".hd b").textContent = name; d.querySelector(".pc").textContent = ""; dl.disabled = true; tab.hidden = true; zoom = 1;
      d.querySelector(".pages").innerHTML = ""; msg.hidden = false; msg.innerHTML = `<div><span class="spin"></span><br>Preparing the preview…</div>`;
      if (!d.open) d.showModal();
      try {
        const [b, L] = await Promise.all([typeof build === "function" ? build() : build, lib()]);
        if (!(b instanceof Blob) || !b.size) throw new Error("The document couldn't be made.");
        if (me !== run) return;
        blob = b.type === "application/pdf" ? b : new Blob([b], { type: "application/pdf" }); url = URL.createObjectURL(blob);
        dl.disabled = false; tab.href = url; tab.hidden = false;
        pdf = await L.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, standardFontDataUrl: PDFJS + "standard_fonts/" }).promise;
        if (me !== run) return;
        msg.hidden = true; await layout();
      } catch (e) { if (me === run) msg.innerHTML = `<div>${esc((e && e.message) || "The preview couldn't be made.")}${blob ? "<br><br>Use Download PDF to open it instead." : ""}</div>`; }
    }
    addEventListener("resize", () => { if (dlg && dlg.open && pdf) { clearTimeout(dlg._r); dlg._r = setTimeout(layout, 200); } });
    return { preview };
  })();

  const I = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICON = {
    home: I('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
    pipeline: I('<path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/>'),
    pnl: I('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h2M12 18h4"/>'),
    pdc: I('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h6M6 14h4M15.5 13.5l1.5 1.5 3-3"/>'),
    amc: I('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
    visits: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4"/>'),
    customers: I('<path d="M4 21V5a1 1 0 0 1 1-1h9v17"/><path d="M14 9h5a1 1 0 0 1 1 1v11M8 8h2M8 12h2M8 16h2M3 21h18"/>'),
    suppliers: I('<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z"/><path d="M5 13v8h14v-8M10 21v-5h4v5"/>'),
    access: I('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4M12 15v2"/>'),
    log: I('<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>'),
    completion: I('<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M8.5 14.5l2.5 2.5 4.5-5"/>'),
    campaigns: I('<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
    books: I('<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H19v-3M8 7h7M8 10.5h4M14.5 12.5l1.5 1.5 3-3.5"/>'),
    bell: I('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>'),
    search: I('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
    menu: I('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    out: I('<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l4-4-4-4M14 12H4"/>'),
    user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6"/>'),
  };
  // Navigation by business function. "need" lists the sections that open an item.
  const NAV = [
    { group: null, items: [{ href: "/", label: "Home", icon: "home", need: [] }] },
    { group: "Sales", items: [{ href: "/pipeline/", label: "Sales Pipeline", icon: "pipeline", need: ["pipeline"] }, { href: "/pnl/", label: "PnL Calculator", icon: "pnl", need: ["pnl"] }] },
    { group: "Service", items: [{ href: "/amc/", label: "AMC Tracker", icon: "amc", need: ["amc", "visits"], subs: [["#overview", "Overview", []], ["#amcs", "Contracts & proposals", ["amc"]], ["#visits", "Maintenance visits", ["amc", "visits"]]] },
      { href: "/completion/", label: "Completion Reports", icon: "completion", need: ["completion"] }] },
    { group: "Marketing", items: [{ href: "/campaigns/", label: "Email Campaigns", icon: "campaigns", need: ["campaigns"], subs: [["#campaigns", "Campaigns", ["campaigns"]], ["#contacts", "Contacts & lists", ["campaigns"]], ["#media", "Image library", ["campaigns"]]] }] },
    { group: "Finance", items: [{ href: "/books/", label: "Books & VAT", icon: "books", need: ["books", "quotes"], subs: [["#/dashboard", "Dashboard", ["books"]],
        [null, "Sales", ["books", "quotes"]], ["#/customers", "Customers", ["books"]], ["#/quotes", "Quotations", ["books", "quotes"]], ["#/invoices", "Invoices", ["books"]], ["#/receipts", "Payments received", ["books"]], ["#/creditnotes", "Credit notes", ["books"]],
        [null, "Purchases", ["books"]], ["#/vendors", "Suppliers", ["books"]], ["#/pos", "Purchase orders", ["books"]], ["#/bills", "Bills", ["books"]], ["#/payments", "Payments made", ["books"]], ["#/expenses", "Expenses", ["books"]], ["#/vendorcredits", "Vendor credits", ["books"]],
        [null, "Accountant", ["books"]], ["#/banking", "Banking", ["books"]], ["#/journals", "Manual journals", ["books"]], ["#/accounts", "Chart of accounts", ["books"]], ["#/items", "Items", ["books"]],
        [null, "Tax and reports", ["books"]], ["#/vat", "VAT return", ["books"]], ["#/report/ct", "Corporate tax", ["books"]], ["#/reports", "All reports", ["books"]],
        [null, "Setup", ["books"]], ["#/settings", "Settings", ["books"]]] },
      { href: "/pdc/", label: "PDC & Guarantees", icon: "pdc", need: ["pdc"] }] },
    { group: "Master data", items: [{ href: "/customers/", label: "Customers", icon: "customers", need: ["customers"] }, { href: "/suppliers/", label: "Suppliers & Vendors", icon: "suppliers", need: ["suppliers", "pdc"], subs: [["#dir", "Directory", []], ["#what", "Who supplies what", []], ["#people", "All contacts", []]] }] },
    { group: "Administration", items: [{ href: "/access/", label: "Team access", icon: "access", need: ["manager"] }, { href: "/activity/", label: "Activity log", icon: "log", need: ["manager"] }] },
  ];
  const SECTION_NAMES = { books: "Books", quotes: "Quotations", pnl: "PnL", pipeline: "Pipeline", pdc: "PDC", customers: "Customers", suppliers: "Suppliers", amc: "AMC proposals", visits: "Visits", campaigns: "Campaigns", completion: "Completion" };
  const allowed = (m, keys) => !keys.length || keys.some(k => k === "manager" ? m.isManager : m.isManager || (m.sections || []).includes(k));
  const path = location.pathname.replace(/index\.html$/, "");
  const initials = e => { const p = String(e).split("@")[0].split(/[._-]+/).filter(Boolean); return ((p[0] || "?")[0] + (p[1] ? p[1][0] : (p[0] || "")[1] || "")).toUpperCase(); };
  const nameOf = e => String(e).split("@")[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

  // Rebrand the static page for Tech Hub, and hide the other company's choices (records are always the signed-in company's).
  const CO_NAMES = { bifold: "Bifold Technologies", techhub: "Tech Hub IT" };
  function brandPage(m) {
    const co = m.co;
    document.documentElement.dataset.co = co;
    store.set("bx-last-co", co === "all" ? m.homeCo : co);
    BR = BRANDS[co === "techhub" ? "techhub" : "bifold"];
    window.BIFOLD_BRAND = BR;
    if (co !== "all") {
      const other = CO_NAMES[co === "techhub" ? "bifold" : "techhub"], mine = CO_NAMES[co];
      document.querySelectorAll("[data-v]").forEach(el => { if (el.dataset.v === other || el.dataset.v === mine) (el.closest(".seg") || el).hidden = true; });
      document.querySelectorAll("select").forEach(sel => { const opts = [...sel.options]; if (!opts.some(o => (o.value || o.text) === mine)) return;
        opts.forEach(o => { if ((o.value || o.text) === other) o.remove(); }); sel.value = mine; const lab = sel.closest("label"); if (lab && sel.options.length === 1) lab.hidden = true; });
    }
    if (BR.key !== "techhub") return;
    document.title = document.title.replace(/Bifold Tools/g, BR.tools).replace(/Bifold/g, BR.short);
    document.querySelectorAll('img[src="/assets/bifold_logo.png"]').forEach(i => { i.src = BR.logo; i.alt = BR.name; });
    const ic = document.querySelector('link[rel="icon"]'); if (ic) ic.href = BR.logo;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const fix = t => t.replace(/Bifold Technologies L\.?L\.?C\.?/g, BR.name).replace(/Bifold Technologies/g, BR.name).replace(/Bifold Tools/g, BR.tools).replace(/Al Garhoud, Dubai/g, BR.foot).replace(/Office A306, Saraya Avenue, /g, "Blue Building, Injaz Road, ").replace(/\bBifold\b/g, BR.short);
    for (let n; (n = w.nextNode());) { if (/Bifold|Ranjan|Garhoud/.test(n.nodeValue) && !n.parentElement.closest("script,style,.bx-side,.bx-top")) n.nodeValue = fix(n.nodeValue); }
    document.querySelectorAll("[placeholder],[aria-label],[title]").forEach(el => ["placeholder", "aria-label", "title"].forEach(a => { const v = el.getAttribute(a); if (v && /Bifold/.test(v)) el.setAttribute(a, fix(v)); }));
  }

  // Sub-sections of the open tool. An entry with no link is a group heading; groups fold open and closed, the open/closed
  // choice is remembered, and the group holding the current page always opens.
  const folded = (() => { try { return new Set(JSON.parse(store.get("bx-folded") || "[]")); } catch { return new Set(); } })();
  let subsHTML = () => "";
  function build(m) {
    subsHTML = it => {
      const list = it.subs.filter(s => allowed(m, s[2]));
      let g = "", html = "";
      list.forEach((s, i) => {
        if (!s[0]) { const has = list.slice(i + 1).findIndex(x => !x[0]); const items = list.slice(i + 1, has < 0 ? undefined : i + 1 + has); if (!items.length) return;
          g = it.href + ":" + s[1]; html += `<button type="button" class="sgh${folded.has(g) ? " shut" : ""}" data-g="${esc(g)}" aria-expanded="${!folded.has(g)}"><span>${esc(s[1])}</span><i aria-hidden="true"></i></button>`; return; }
        html += `<a class="sub" href="${it.href}${s[0]}" data-hash="${s[0]}"${g ? ` data-g="${esc(g)}"` : ""}${g && folded.has(g) ? " hidden" : ""}>${esc(s[1])}<em class="ct" hidden></em></a>`;
      });
      return html ? `<div class="bx-subs">${html}</div>` : "";
    };
    document.body.classList.add("bx");
    const flat = [];
    const navHTML = NAV.map(g => {
      const items = g.items.filter(it => allowed(m, it.need));
      if (!items.length) return "";
      return `<div class="bx-grp">${g.group ? `<span>${esc(g.group)}</span>` : ""}${items.map(it => {
        flat.push(it);
        const on = it.href === "/" ? path === "/" : path.startsWith(it.href);
        const subs = on && it.subs ? subsHTML(it) : "";
        return `<a href="${it.href}" class="${on ? "on" : ""}" data-key="${it.icon}">${ICON[it.icon]}<span>${esc(it.label)}</span><em class="ct" hidden></em></a>${subs}`;
      }).join("")}</div>`;
    }).join("");
    const side = document.createElement("aside"); side.className = "bx-side"; side.setAttribute("aria-label", BR.tools);
    side.innerHTML = `<a class="bx-brand" href="/"><span class="lg"><img src="${BR.logo}" alt="${esc(BR.name)}"></span><span class="nm"><b>${esc(m.co === "all" ? "Group Tools" : BR.tools)}</b><span>${m.co === "all" ? "Bifold + Tech Hub" : "Enterprise suite"}</span></span></a>
      <nav class="bx-nav">${navHTML}</nav>
      <div class="bx-foot"><b>${esc(BR.name)}</b><br>${esc(BR.foot)} · Signed in with Microsoft 365</div>`;
    const current = flat.find(it => it.href !== "/" && path.startsWith(it.href));
    const group = current ? (NAV.find(g => g.items.includes(current)) || {}).group : null;
    const pageTitle = current ? current.label : path === "/" ? "Home" : document.title.replace(/^(Bifold|Tech Hub)\s*/, "");
    const top = document.createElement("header"); top.className = "bx-top";
    const role = m.isManager ? "Manager · full access" : "Team member";
    top.innerHTML = `<button class="bx-ib bx-burger" type="button" aria-label="Open menu">${ICON.menu}</button>
      <div class="bx-crumb"><a href="/">${esc(m.co === "all" ? "Group Tools" : BR.tools)}</a>${group ? `<i>/</i><span>${esc(group)}</span>` : ""}<i>/</i><b>${esc(pageTitle)}</b></div>
      ${m.group ? `<label class="bx-co"><span>Company</span><select aria-label="Company">${[["bifold", "Bifold"], ["techhub", "Tech Hub"]].concat(isHome ? [["all", "Group (read-only)"]] : []).map(([k, l]) => `<option value="${k}"${k === m.co ? " selected" : ""}>${l}</option>`).join("")}</select></label>` : ""}
      <button class="bx-search" type="button" aria-label="Search tools, customers and suppliers">${ICON.search}<span class="t">Search tools, customers, suppliers</span><kbd>Ctrl K</kbd></button>
      <button class="bx-ib bx-bell" type="button" aria-label="Alerts">${ICON.bell}<span class="dot" hidden></span></button>
      <button class="bx-user" type="button" aria-label="Account"><span class="bx-av">${esc(initials(m.email))}</span><span class="u"><b>${esc(nameOf(m.email))}</b><span>${esc(role)}</span></span></button>`;
    document.body.prepend(top); document.body.prepend(side);
    const coSel = top.querySelector(".bx-co select");
    if (coSel) coSel.onchange = () => { store.set("bx-co", coSel.value); location.reload(); };

    // sub-links for the AMC tracker follow the hash
    // Fold / unfold a group of sub-sections.
    side.addEventListener("click", e => { const h = e.target.closest(".sgh"); if (!h) return; e.preventDefault(); const g = h.dataset.g, shut = !h.classList.contains("shut");
      h.classList.toggle("shut", shut); h.setAttribute("aria-expanded", !shut); side.querySelectorAll(`a.sub[data-g="${CSS.escape(g)}"]`).forEach(a => { a.hidden = shut; });
      if (shut) folded.add(g); else folded.delete(g); store.set("bx-folded", JSON.stringify([...folded])); });
    // Pages with their own routing (Books) mark the current sub-section themselves: BX.markSub("#/invoices").
    window.BX = Object.assign(window.BX || {}, {
      markSub(hash) { side.querySelectorAll("a.sub").forEach(a => { const on = a.dataset.hash === hash; a.classList.toggle("on", on); if (on && a.hidden && a.dataset.g) { a.hidden = false; const h = side.querySelector(`.sgh[data-g="${CSS.escape(a.dataset.g)}"]`); if (h) { h.classList.remove("shut"); h.setAttribute("aria-expanded", "true"); side.querySelectorAll(`a.sub[data-g="${CSS.escape(a.dataset.g)}"]`).forEach(x => { x.hidden = false; }); } } });
        const cur = side.querySelector("a.sub.on"); if (cur) cur.scrollIntoView({ block: "nearest" }); },
      subCount(hash, n, title) { const a = side.querySelector(`a.sub[data-hash="${CSS.escape(hash)}"] .ct`); if (!a) return; a.hidden = !n; a.textContent = n > 99 ? "99+" : n || ""; if (title) a.title = title; },
      // Breadcrumb under the tool name: crumb([["Books & VAT", "#/dashboard"], ["Sales"], ["Invoices"]]). The tool name is the first part.
      crumb(parts) { const box = top.querySelector(".bx-crumb"); if (!box) return;
        let root = box.querySelector("[data-root]"); if (!root) { root = box.querySelector("b"); if (!root) return; root.dataset.root = "1"; root.dataset.label = root.textContent; }
        while (root.nextSibling) root.nextSibling.remove();
        const rest = (parts || []).slice(1);
        const el = document.createElement(rest.length ? "a" : "b"); el.dataset.root = "1"; el.dataset.label = root.dataset.label; el.textContent = root.dataset.label; if (rest.length) el.href = (parts[0] && parts[0][1]) || "#"; root.replaceWith(el);
        rest.forEach(([t], i) => { const sep = document.createElement("i"); sep.textContent = "/"; const x = document.createElement(i === rest.length - 1 ? "b" : "span"); x.textContent = t; box.append(sep, x); }); },
    });
    const syncSub = () => path.startsWith("/books/") ? null : side.querySelectorAll("a.sub").forEach(a => { const h = (location.hash || (path.startsWith("/campaigns/") ? "#campaigns" : path.startsWith("/suppliers/") ? "#dir" : path.startsWith("/books/") ? "#/dashboard" : "#overview")).replace(/^#(edit|report)\/.*$/, "#campaigns").replace(/^(#\/[a-z]+).*$/, "$1"); a.classList.toggle("on", h === a.dataset.hash); });
    syncSub(); addEventListener("hashchange", syncSub);
    top.querySelector(".bx-burger").onclick = () => document.body.classList.toggle("bx-open");
    side.addEventListener("click", e => { if (e.target.closest("a")) document.body.classList.remove("bx-open"); });

    let pop = null; const close = () => { if (pop) { pop.remove(); pop = null; } };
    document.addEventListener("click", e => { if (pop && !pop.contains(e.target) && !e.target.closest(".bx-bell,.bx-user,.bx-search")) close(); });
    addEventListener("keydown", e => { if (e.key === "Escape") close(); });

    // user menu
    top.querySelector(".bx-user").onclick = () => {
      if (pop && pop.classList.contains("bx-menu")) return close(); close();
      const secs = m.isManager ? Object.keys(SECTION_NAMES) : (m.sections || []);
      pop = document.createElement("div"); pop.className = "bx-pop bx-menu";
      pop.innerHTML = `<div class="hd"><span class="bx-av">${esc(initials(m.email))}</span><div><b>${esc(nameOf(m.email))}</b><span>${esc(m.email)}</span></div></div>
        <div class="acc">${esc(role)}<br>${secs.map(s => `<em>${esc(SECTION_NAMES[s] || s)}</em>`).join("") || "No tools yet"}</div>
        ${m.isManager ? `<a href="/access/">${ICON.access}Team access</a><a href="/activity/">${ICON.log}Activity log</a>` : ""}<a href="/.auth/logout">${ICON.out}Sign out</a>`;
      document.body.appendChild(pop);
    };

    // alerts
    let ALERTS = null;
    const TOOL = { pdc: "pdc", pipeline: "pipeline", amc: "amc", visits: "visits", books: "books" };
    const loadAlerts = () => fetch("/api/alerts", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(a => {
      if (!a) return; ALERTS = a; window.BIFOLD_ALERTS = a; document.dispatchEvent(new CustomEvent("bifold:alerts", { detail: a }));
      const dot = top.querySelector(".bx-bell .dot"); dot.hidden = !a.count; dot.textContent = a.count > 99 ? "99+" : a.count;
      const per = {}; a.items.forEach(x => { const k = x.tool === "visits" ? "amc" : x.tool; if (x.severity !== "low") per[k] = (per[k] || 0) + 1; });
      side.querySelectorAll("a[data-key]").forEach(el => { const n = per[el.dataset.key]; const ct = el.querySelector(".ct"); if (ct) { ct.hidden = !n; ct.textContent = n || ""; } });
    }).catch(() => {});
    loadAlerts(); setInterval(() => { if (!document.hidden) loadAlerts(); }, 120000);
    top.querySelector(".bx-bell").onclick = () => {
      if (pop && pop.classList.contains("bx-alerts")) return close(); close();
      pop = document.createElement("div"); pop.className = "bx-pop bx-alerts";
      const items = (ALERTS && ALERTS.items) || [];
      pop.innerHTML = `<h4>Needs attention <span>${items.length} item${items.length === 1 ? "" : "s"}</span></h4><div class="list">${items.map(x => `<a class="bx-al" href="${esc(x.href)}"><span class="sv ${esc(x.severity)}"></span><span><b>${esc(x.title)}</b><span>${esc(x.text)}</span></span></a>`).join("") || `<div class="bx-empty">You're all caught up.</div>`}</div>`;
      document.body.appendChild(pop);
    };

    // command palette: tools and customers
    let CUST = null, SUP = null;
    const openPal = () => {
      close();
      const scrim = document.createElement("div"); scrim.className = "bx-scrim";
      pop = document.createElement("div"); pop.className = "bx-pop bx-pal"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Search");
      pop.innerHTML = `<div class="in">${ICON.search}<input type="text" placeholder="Jump to a tool, customer, supplier or contact…" aria-label="Search"></div><div class="res"></div><div class="ft"><span>↑ ↓ to move</span><span>Enter to open</span><span>Esc to close</span></div>`;
      document.body.append(scrim, pop);
      const input = pop.querySelector("input"), res = pop.querySelector(".res"); let sel = 0, hits = [];
      const shut = () => { scrim.remove(); close(); };
      scrim.onclick = shut;
      const toolHits = q => flat.concat(flat.flatMap(it => (it.subs || []).filter(s => allowed(m, s[2])).map(s => ({ href: it.href + s[0], label: it.label + ": " + s[1], icon: it.icon }))))
        .filter(it => !q || it.label.toLowerCase().includes(q)).map(it => ({ href: it.href, label: it.label, icon: it.icon, kind: "Tools" }));
      const draw = () => {
        const q = input.value.trim().toLowerCase();
        const custs = (CUST || []).filter(c => q && [c.name, c.contactName, c.emirate].join(" ").toLowerCase().includes(q)).slice(0, 8)
          .map(c => ({ href: "/customers/?q=" + encodeURIComponent(c.name), label: c.name, small: [c.contactName, c.emirate].filter(Boolean).join(" · "), icon: "customers", kind: "Customers" }));
        const sups = [];
        (SUP || []).forEach(sp => { if (!q) return;
          if ([sp.name, sp.brands.join(" "), sp.categories.join(" "), sp.supplies].join(" ").toLowerCase().includes(q)) sups.push({ href: "/suppliers/#s=" + encodeURIComponent(sp.id), label: sp.name, small: sp.brands.slice(0, 4).join(", ") || sp.kind, icon: "suppliers", kind: "Suppliers" });
          sp.contacts.forEach(c => { if ([c.name, c.email, c.mobile].join(" ").toLowerCase().includes(q)) sups.push({ href: "/suppliers/#s=" + encodeURIComponent(sp.id), label: c.name, small: [c.role, sp.name].filter(Boolean).join(" · "), icon: "suppliers", kind: "Supplier contacts" }); }); });
        sups.sort((a, b) => a.kind.localeCompare(b.kind) * -1);
        hits = toolHits(q).concat(custs, sups.filter(x => x.kind === "Suppliers").slice(0, 6), sups.filter(x => x.kind !== "Suppliers").slice(0, 6)); sel = Math.min(sel, Math.max(0, hits.length - 1));
        let last = ""; res.innerHTML = hits.map((h, i) => (h.kind !== last ? `<div class="gh">${(last = h.kind)}</div>` : "") + `<a href="${esc(h.href)}" class="${i === sel ? "sel" : ""}">${ICON[h.icon]}<span>${esc(h.label)}</span>${h.small ? `<small>${esc(h.small)}</small>` : ""}</a>`).join("") || `<div class="bx-empty">Nothing matches "${esc(input.value)}".</div>`;
        res.querySelectorAll("a").forEach(a => a.onclick = shut);
      };
      input.oninput = () => { sel = 0; draw(); };
      input.onkeydown = e => {
        if (e.key === "ArrowDown") { sel = Math.min(hits.length - 1, sel + 1); draw(); e.preventDefault(); }
        if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
        if (e.key === "Enter" && hits[sel]) { location.href = hits[sel].href; shut(); }
        if (e.key === "Escape") shut();
      };
      draw(); input.focus();
      if (!SUP && allowed(m, ["suppliers", "pdc"]) && m.co !== "all") fetch("/api/suppliers", { cache: "no-store" }).then(r => r.ok ? r.json() : []).then(c => { SUP = c; draw(); }).catch(() => {});
      if (!CUST) fetch("/api/customers", { cache: "no-store" }).then(r => r.ok ? r.json() : []).then(c => { CUST = c; draw(); }).catch(() => {});
    };
    top.querySelector(".bx-search").onclick = openPal;
    addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPal(); } });
  }

  function block(m, msg) {
    document.querySelectorAll("body > *:not(.bx-side):not(.bx-top):not(script)").forEach(el => { el.hidden = true; });
    const box = document.createElement("div"); box.className = "noaccess";
    box.innerHTML = `<h2>${esc(msg)}</h2><p>Ask ${esc(BR.manager)} to give you access in Team access. You are signed in as ${esc(m.email)}.</p><a href="/">Back to ${esc(BR.tools)}</a>`;
    document.body.appendChild(box);
  }

  fetch("/api/me", { cache: "no-store" }).then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j))).then(m => {
    window.BIFOLD_ME = m;
    const apply = () => {
      brandPage(m);
      build(m);
      if (!m.isManager) document.querySelectorAll("[data-manager]").forEach(el => { el.hidden = true; });
      const LINK = { "/pnl/": ["pnl"], "/pipeline/": ["pipeline"], "/pdc/": ["pdc"], "/customers/": ["customers"], "/suppliers/": ["suppliers", "pdc"], "/amc/": ["amc", "visits"], "/campaigns/": ["campaigns"], "/completion/": ["completion"], "/books/": ["books", "quotes"], "/access/": ["manager"], "/activity/": ["manager"] };
      document.querySelectorAll("body > :not(.bx-side) a[href]").forEach(a => { const k = LINK[a.getAttribute("href")]; if (k && !allowed(m, k)) a.hidden = true; });
      if (m.noAccess) block(m, "You don't have access yet");
      else if (pageNeeds.length && !allowed(m, pageNeeds)) block(m, "You don't have access to this tool");
      else if (!m.isManager && !(m.sections || []).length && path === "/") block(m, "You don't have access to any tools yet");
      document.dispatchEvent(new CustomEvent("bifold:me", { detail: m }));
      clearTimeout(failsafe); reveal();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
  }).catch(j => {
    clearTimeout(failsafe);
    // Signed in with an account that may not use the tools (wrong domain): show only the reason and a way to switch account.
    const show = () => {
      document.querySelectorAll("body > *:not(script)").forEach(el => { el.hidden = true; });
      const box = document.createElement("div"); box.className = "noaccess";
      box.innerHTML = `<h2>You can't use these tools with this account</h2><p>${esc((j && j.error) || "Sign-in could not be checked. Reload the page to try again.")}</p><a href="/.auth/logout?post_logout_redirect_uri=/">Sign out and use your company account</a>`;
      document.body.appendChild(box); reveal();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show); else show();
  });
})();
