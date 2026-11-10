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

  const I = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICON = {
    home: I('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
    pipeline: I('<path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/>'),
    pnl: I('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h2M12 18h4"/>'),
    pdc: I('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h6M6 14h4M15.5 13.5l1.5 1.5 3-3"/>'),
    amc: I('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
    visits: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4"/>'),
    customers: I('<path d="M4 21V5a1 1 0 0 1 1-1h9v17"/><path d="M14 9h5a1 1 0 0 1 1 1v11M8 8h2M8 12h2M8 16h2M3 21h18"/>'),
    access: I('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4M12 15v2"/>'),
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
    { group: "Service", items: [{ href: "/amc/", label: "AMC Tracker", icon: "amc", need: ["amc", "visits"], subs: [["#overview", "Overview", []], ["#amcs", "Contracts & proposals", ["amc"]], ["#visits", "Maintenance visits", ["amc", "visits"]]] }] },
    { group: "Finance", items: [{ href: "/pdc/", label: "PDC & Guarantees", icon: "pdc", need: ["pdc"] }] },
    { group: "Master data", items: [{ href: "/customers/", label: "Customers", icon: "customers", need: ["customers"] }] },
    { group: "Administration", items: [{ href: "/access/", label: "Team access", icon: "access", need: ["manager"] }] },
  ];
  const SECTION_NAMES = { pnl: "PnL", pipeline: "Pipeline", pdc: "PDC", customers: "Customers", amc: "AMC proposals", visits: "Visits" };
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

  function build(m) {
    document.body.classList.add("bx");
    const flat = [];
    const navHTML = NAV.map(g => {
      const items = g.items.filter(it => allowed(m, it.need));
      if (!items.length) return "";
      return `<div class="bx-grp">${g.group ? `<span>${esc(g.group)}</span>` : ""}${items.map(it => {
        flat.push(it);
        const on = it.href === "/" ? path === "/" : path.startsWith(it.href);
        const subs = on && it.subs ? it.subs.filter(s => allowed(m, s[2])).map(s => `<a class="sub" href="${it.href}${s[0]}" data-hash="${s[0]}">${esc(s[1])}</a>`).join("") : "";
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
      <button class="bx-search" type="button" aria-label="Search tools and customers">${ICON.search}<span class="t">Search tools and customers</span><kbd>Ctrl K</kbd></button>
      <button class="bx-ib bx-bell" type="button" aria-label="Alerts">${ICON.bell}<span class="dot" hidden></span></button>
      <button class="bx-user" type="button" aria-label="Account"><span class="bx-av">${esc(initials(m.email))}</span><span class="u"><b>${esc(nameOf(m.email))}</b><span>${esc(role)}</span></span></button>`;
    document.body.prepend(top); document.body.prepend(side);
    const coSel = top.querySelector(".bx-co select");
    if (coSel) coSel.onchange = () => { store.set("bx-co", coSel.value); location.reload(); };

    // sub-links for the AMC tracker follow the hash
    const syncSub = () => side.querySelectorAll("a.sub").forEach(a => a.classList.toggle("on", (location.hash || "#overview") === a.dataset.hash));
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
        ${m.isManager ? `<a href="/access/">${ICON.access}Team access</a>` : ""}<a href="/.auth/logout">${ICON.out}Sign out</a>`;
      document.body.appendChild(pop);
    };

    // alerts
    let ALERTS = null;
    const TOOL = { pdc: "pdc", pipeline: "pipeline", amc: "amc", visits: "visits" };
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
    let CUST = null;
    const openPal = () => {
      close();
      const scrim = document.createElement("div"); scrim.className = "bx-scrim";
      pop = document.createElement("div"); pop.className = "bx-pop bx-pal"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Search");
      pop.innerHTML = `<div class="in">${ICON.search}<input type="text" placeholder="Jump to a tool or customer…" aria-label="Search"></div><div class="res"></div><div class="ft"><span>↑ ↓ to move</span><span>Enter to open</span><span>Esc to close</span></div>`;
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
        hits = toolHits(q).concat(custs); sel = Math.min(sel, Math.max(0, hits.length - 1));
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
      const LINK = { "/pnl/": ["pnl"], "/pipeline/": ["pipeline"], "/pdc/": ["pdc"], "/customers/": ["customers"], "/amc/": ["amc", "visits"], "/access/": ["manager"] };
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
