// Team access on every Bifold Tools page: hides menu links and dashboard tiles the signed-in person can't use,
// adds "Team access" for managers, and blocks a page whose section they don't have.
// Usage: <script src="/assets/access.js" data-section="pnl"></script>  (data-section is a section key, or "amc|visits";
// data-hold="1" on a page with no section keeps it hidden until links are filtered)
// The API enforces the same rules; this only keeps people from landing on pages that would refuse them.
(function () {
  const me = document.currentScript;
  const pageNeeds = (me && me.dataset.section || "").split("|").filter(Boolean);
  const LINK = { "/pnl/": ["pnl"], "/pipeline/": ["pipeline"], "/pdc/": ["pdc"], "/customers/": ["customers"], "/amc/": ["amc", "visits"], "/access/": ["manager"] };
  const allowed = (m, keys) => keys.some(k => k === "manager" ? m.isManager : m.isManager || (m.sections || []).includes(k));
  const css = document.createElement("style");
  css.textContent = "[hidden]{display:none!important}.noaccess{max-width:560px;margin:56px auto;padding:28px;background:var(--surface,#fff);border:1px solid var(--line,#d5dce3);border-radius:10px;text-align:center;font-family:Arial,sans-serif}.noaccess h2{margin:0 0 8px;font-size:20px}.noaccess p{margin:0 0 14px;color:var(--muted,#5b6a78)}.noaccess a{font-weight:700;color:var(--accent,#1E5A8C)}";
  document.head.appendChild(css);
  if (pageNeeds.length || (me && me.dataset.hold)) document.documentElement.style.visibility = "hidden";
  const reveal = () => { document.documentElement.style.visibility = ""; };
  fetch("/api/me", { cache: "no-store" }).then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j))).then(m => {
    window.BIFOLD_ME = m;
    const apply = () => {
      if (!m.isManager) document.querySelectorAll('[data-manager]').forEach(el => { el.hidden = true; });
      document.querySelectorAll('a[href]').forEach(a => {
        const keys = LINK[a.getAttribute("href")];
        if (keys && !allowed(m, keys)) a.hidden = true;
      });
      if (m.isManager) document.querySelectorAll(".brandbar nav, .bar .who").forEach(nav => {
        if (nav.querySelector('a[href="/access/"]')) return;
        const a = document.createElement("a"); a.href = "/access/"; a.textContent = "Team access";
        const who = nav.querySelector("#who, #user"); nav.insertBefore(a, who || nav.lastChild);
      });
      if (pageNeeds.length && !allowed(m, pageNeeds)) {
        // Hide the tool rather than remove it, so its own scripts keep running quietly against the hidden page.
        document.querySelectorAll("body > *:not(.brandbar):not(script)").forEach(el => { el.hidden = true; });
        const box = document.createElement("div"); box.className = "noaccess";
        box.innerHTML = `<h2>You don't have access to this tool</h2><p>Ask Ranjan to give you access in Team access. You are signed in as ${String(m.email).replace(/[<>&]/g, "")}.</p><a href="/">Back to all tools</a>`;
        document.body.appendChild(box);
      }
      if (!m.isManager && !(m.sections || []).length) {
        const wrap = document.querySelector("main, .wrap");
        if (wrap) wrap.innerHTML = `<div class="noaccess"><h2>You don't have access to any tools yet</h2><p>Ask Ranjan to give you access in Team access. You are signed in as ${String(m.email).replace(/[<>&]/g, "")}.</p></div>`;
      }
      reveal();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
  }).catch(() => reveal());
})();
