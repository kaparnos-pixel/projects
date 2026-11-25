// Email Campaigns page: campaign list, block editor with live preview, Claude drafting, test sends, scheduling,
// sending reports, contacts with CSV import, the image library and settings. Talks to /api/mk/*.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const R = window.MkRender, TPL = window.MK_TEMPLATES || {};
  const num = n => Number(n || 0).toLocaleString("en-US");
  const uid = () => Math.random().toString(16).slice(2, 10);
  const clone = o => JSON.parse(JSON.stringify(o));
  let ME = null, BOOT = null, CAMPS = null, CONTACTS = null, MEDIA = null, SAVED = null;
  let ED = null; // open campaign in the editor

  // ---------- helpers ----------
  function toast(m, e) { const t = document.createElement("div"); t.className = "toast" + (e ? " err" : ""); t.setAttribute("role", "status"); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), e ? 6500 : 2600); }
  async function api(method, path, body) {
    const r = await fetch("/api/mk/" + path, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `The server answered ${r.status}.`); e.status = r.status; e.data = j; throw e; }
    return j;
  }
  const TZ = "Asia/Dubai";
  const fdt = iso => iso ? new Date(iso).toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const fd = iso => iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }) : "";
  const rel = iso => {
    const m = Math.round((new Date(iso) - Date.now()) / 60000), a = Math.abs(m);
    const t = a < 1 ? "now" : a < 60 ? a + " min" : a < 1440 ? Math.round(a / 60) + " h" : Math.round(a / 1440) + " days";
    return a < 1 ? "now" : m > 0 ? "in " + t : t + " ago";
  };
  const dubaiParts = d => { const s = new Date(d.getTime() + 4 * 3600e3).toISOString(); return { date: s.slice(0, 10), time: s.slice(11, 16) }; };
  const firstName = e => { const p = String(e || "").split("@")[0].split(/[._-]/)[0]; return p.charAt(0).toUpperCase() + p.slice(1); };
  const busy = (btn, on, label) => { if (!btn) return; if (on) { btn.dataset.l = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${esc(label || "Working…")}`; } else { btn.disabled = false; if (btn.dataset.l) btn.innerHTML = btn.dataset.l; } };
  const seg = (el, v) => el.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
  const segVal = el => (el.querySelector('button[aria-pressed="true"]') || {}).dataset?.v;
  const segBind = (el, fn) => el.addEventListener("click", e => { const b = e.target.closest("button[data-v]"); if (!b) return; seg(el, b.dataset.v); fn(b.dataset.v); });
  document.addEventListener("click", e => { const c = e.target.closest("[data-close]"); if (c) c.closest("dialog").close(); });
  const STATUS = { draft: "Draft", approval: "Awaiting approval", scheduled: "Scheduled", sending: "Sending", paused: "Paused", sent: "Sent", cancelled: "Cancelled", failed: "Failed" };
  const chip = s => `<span class="stchip ${esc(s)}">${esc(STATUS[s] || s)}</span>`;
  const audLabel = a => a && a.mode === "tags" ? (a.tags.length ? "Lists: " + a.tags.join(", ") : "No lists chosen") : "Everyone subscribed";
  const ask = (title, label, value) => new Promise(res => {
    $("askTitle").textContent = title; $("askLbl").textContent = label; $("askIn").value = value || ""; $("askErr").textContent = "";
    const d = $("askDlg"); let done = false;
    $("askForm").onsubmit = e => { e.preventDefault(); const v = $("askIn").value.trim(); if (!v) { $("askErr").textContent = "Enter a name."; return; } done = true; d.close(); res(v); };
    d.onclose = () => { if (!done) res(null); };
    d.showModal(); $("askIn").focus();
  });

  // Brand for previews: the same as the emails, with images from this site.
  const brand = () => ({ ...BOOT.brand, logo: `/email/${BOOT.co}.png` });
  function emailHtml(c, placeholders) {
    const r = R.renderEmail(c, brand(), { base: location.origin, placeholders });
    return R.personalize(r.html, { first_name: firstName(ME.email), email: ME.email, company: "" }, { unsubscribe_url: "#" }, true);
  }
  function setFrame(frame, html) { frame.srcdoc = html.replace("</head>", "<base target=\"_blank\"><style>body{overflow-x:hidden}</style></head>"); }

  // ---------- start ----------
  function start(m) {
    ME = m;
    if (m.noAccess) return;
    api("GET", "bootstrap").then(b => { BOOT = b; addEventListener("hashchange", route); route(); }).catch(e => toast(e.message, true));
  }
  if (window.BIFOLD_ME) start(window.BIFOLD_ME); else document.addEventListener("bifold:me", e => start(e.detail), { once: true });

  async function refreshBoot() { try { BOOT = await api("GET", "bootstrap"); } catch {} }

  let leaving = null;
  async function route() {
    const h = location.hash.replace(/^#/, "") || "campaigns";
    const [view, id] = h.split("/");
    if (ED && !(view === "edit" && id === ED.id)) { await flushSave(); ED = null; }
    if (PO && !(view === "post" && id === PO.p.id)) { await flushPost(); PO = null; }
    clearInterval(leaving); leaving = null;
    document.querySelectorAll(".view").forEach(v => { v.hidden = true; });
    const tab = { edit: "campaigns", report: "campaigns", post: "social" }[view] || view;
    document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === tab));
    $("tabs").hidden = view === "edit" || view === "post";
    $("pageHead").hidden = view === "edit" || view === "post";
    setupNote(view);
    if (view === "edit" && id) return openEditor(id);
    if (view === "report" && id) return openReport(id);
    if (view === "radar") return showRadar();
    if (view === "social") return showSocial(id, h.split("/")[2]);
    if (view === "post" && id) return openPost(id);
    if (view === "contacts") return showContacts();
    if (view === "media") return showMedia();
    if (view === "settings") return showSettings();
    return showCampaigns();
  }
  function setupNote(view) {
    const n = $("setupNote"); const s = BOOT.sending;
    if (!["campaigns", "edit", "settings"].includes(view) || s.ready) { n.hidden = true; return; }
    n.hidden = false;
    n.innerHTML = `<div><b>Sending isn't connected yet.</b> You can build, test-preview and schedule campaigns now; they go out once Azure email is connected${BOOT.isManager ? `. <a href="#settings">See what's missing</a>` : ". Ask a manager to finish the set-up."}</div>`;
  }
  function headActs(html) { $("headActs").innerHTML = html; }

  // ---------- campaigns list ----------
  let cFilter = "";
  async function showCampaigns() {
    $("v-campaigns").hidden = false;
    $("pageSub").textContent = "Design branded emails, send them to your contact lists on a schedule, and let people unsubscribe in one click.";
    headActs(BOOT.readOnly ? "" : `<button class="primary" type="button" id="newBtn">+ New campaign</button>`);
    if ($("newBtn")) $("newBtn").onclick = openNew;
    try { CAMPS = await api("GET", "campaigns"); } catch (e) { $("cList").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    drawKpis(); drawCampaigns();
    if (CAMPS.some(c => c.status === "sending")) { leaving = setInterval(async () => { if (document.hidden) return; try { CAMPS = await api("GET", "campaigns"); drawKpis(); drawCampaigns(); } catch {} }, 30000); }
  }
  function drawKpis() {
    const since = Date.now() - 30 * 864e5;
    const sched = CAMPS.filter(c => c.status === "scheduled").sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const sent30 = CAMPS.filter(c => c.sent && Date.parse(c.startedAt || c.scheduledAt) > since).reduce((a, c) => a + c.sent, 0);
    const k = BOOT.contacts;
    const rate = k.total ? (k.unsubscribed / k.total * 100) : 0;
    $("kpis").innerHTML = [
      ["Subscribed contacts", num(k.subscribed), `${BOOT.tags.length} list${BOOT.tags.length === 1 ? "" : "s"}`, "var(--good)"],
      ["Scheduled", num(sched.length), (n => n ? `${n} awaiting a manager's approval` : "")(CAMPS.filter(c => c.status === "approval").length) || (sched[0] ? "Next " + fdt(sched[0].scheduledAt) : "Nothing waiting"), "var(--accent)"],
      ["Emails sent, 30 days", num(sent30), (n => `${n} campaign${n === 1 ? "" : "s"} sent in total`)(CAMPS.filter(c => c.status === "sent").length), "var(--red)"],
      ["Unsubscribed", num(k.unsubscribed), k.total ? rate.toFixed(1) + "% of all contacts" : "No contacts yet", "var(--warn)"],
    ].map(([kk, v, s, c]) => `<div class="kpi" style="--c:${c}"><div class="k">${kk}</div><div class="v">${v}</div><div class="s">${esc(s)}</div></div>`).join("");
  }
  function drawCampaigns() {
    const q = $("cQ").value.trim().toLowerCase();
    const list = CAMPS.filter(c => (!cFilter || c.status === cFilter || (cFilter === "sending" && c.status === "paused")) && (!q || (c.name + " " + c.subject).toLowerCase().includes(q)));
    $("cCnt").textContent = `${list.length} of ${CAMPS.length}`;
    if (!CAMPS.length) { $("cList").innerHTML = `<div class="panel empty"><b>No campaigns yet.</b><br>Start from one of the ready-made ${esc(BOOT.co === "techhub" ? "Tech Hub" : "Bifold")} designs, or let Claude write the first draft.<br><br>${BOOT.readOnly ? "" : `<button class="primary" type="button" id="emptyNew">+ New campaign</button>`}</div>`; if ($("emptyNew")) $("emptyNew").onclick = openNew; return; }
    $("cList").innerHTML = list.map(c => {
      const pct = c.total ? Math.round(c.sent / c.total * 100) : 0;
      let res = "";
      if (["sending", "paused", "sent", "cancelled"].includes(c.status) && c.total) res = `<div class="n">${num(c.sent)} <span class="muted">/ ${num(c.total)}</span></div><div class="l">delivered to Azure${c.failed ? ` · <span class="neg">${num(c.failed)} failed</span>` : ""}</div><div class="bar"><i style="width:${pct}%"></i></div>`;
      else if (c.status === "approval") res = `<div class="n">Needs approval</div><div class="l">for ${esc(fdt(c.scheduledAt))}</div>`;
      else if (c.status === "scheduled") res = `<div class="n">${esc(rel(c.scheduledAt))}</div><div class="l">${esc(fdt(c.scheduledAt))}</div>`;
      else res = `<div class="l">Edited ${esc(fd(c.updatedAt))}</div><div class="l">by ${esc(firstName(c.updatedBy))}</div>`;
      const when = c.status === "sent" ? `Sent <b>${esc(fdt(c.completedAt || c.startedAt))}</b>` : c.status === "approval" ? `Waiting for a manager, requested by ${esc(firstName(c.requestedBy || c.createdBy))}` : c.status === "scheduled" ? `Goes out <b>${esc(fdt(c.scheduledAt))}</b>${c.approvedBy ? `, approved by ${esc(firstName(c.approvedBy))}` : ""}` : c.status === "sending" ? `Started <b>${esc(fdt(c.startedAt))}</b>` : "";
      return `<button type="button" class="ccard" data-id="${esc(c.id)}" data-st="${esc(c.status)}"><div><h3>${esc(c.name)} ${chip(c.status)}</h3><div class="subj">${esc(c.subject || "No subject yet")}</div>
        <div class="meta"><span>${esc(audLabel(c.audience))}</span>${when ? `<span>${when}</span>` : ""}<span>Created by ${esc(firstName(c.createdBy))}</span>${c.lastNote && c.status === "sending" ? `<span>Waiting: ${esc(c.lastNote)}</span>` : ""}${c.lastNote && c.status === "draft" && /^Returned/.test(c.lastNote) ? `<span class="neg">${esc(c.lastNote)}</span>` : ""}</div></div><div class="res">${res}</div></button>`;
    }).join("") || `<div class="empty">No campaigns match.</div>`;
  }
  segBind($("cStatus"), v => { cFilter = v; drawCampaigns(); });
  $("cQ").oninput = () => drawCampaigns();
  $("cList").addEventListener("click", e => { const b = e.target.closest(".ccard"); if (!b) return; location.hash = (["draft", "approval", "scheduled"].includes(b.dataset.st) ? "#edit/" : "#report/") + b.dataset.id; });

  // ---------- new campaign ----------
  async function openNew() {
    seg($("newMode"), "tpl"); $("newTpl").hidden = false; $("newAi").hidden = true; $("aiErr").textContent = "";
    $("newDlg").showModal();
    if (!SAVED) { try { SAVED = await api("GET", "templates"); } catch { SAVED = []; } }
    const mine = (TPL[BOOT.co] || []).map(t => ({ ...t, kind: "built" }));
    const saved = SAVED.filter(t => t.co === BOOT.co).map(t => ({ ...t, kind: "saved", note: "Saved by " + firstName(t.createdBy) }));
    const all = [{ id: "blank", name: "Blank", note: "Start with an empty email", kind: "blank" }, ...mine, ...saved];
    $("newTpl").innerHTML = all.map(t => `<button type="button" class="tpl ${t.kind === "blank" ? "blank" : ""}" data-id="${esc(t.id)}"><div class="tv">${t.kind === "blank" ? "+" : `<iframe loading="lazy" tabindex="-1" aria-hidden="true"></iframe>`}${t.kind === "saved" ? `<span class="del btn" role="button" data-del="${esc(t.id)}" title="Delete this saved design">×</span>` : ""}</div><div class="tt"><b>${esc(t.name)}</b><span>${esc(t.kind === "saved" ? t.note : t.note || "")}</span></div></button>`).join("");
    $("newTpl").querySelectorAll(".tpl").forEach(btn => {
      const t = all.find(x => x.id === btn.dataset.id); const f = btn.querySelector("iframe");
      if (f) setFrame(f, emailHtml(t, true));
      btn.onclick = async e => {
        const del = e.target.closest("[data-del]");
        if (del) { e.stopPropagation(); if (!confirm(`Delete the saved design "${t.name}"?`)) return; try { await api("DELETE", "templates/" + t.id); SAVED = SAVED.filter(x => x.id !== t.id); btn.remove(); } catch (er) { toast(er.message, true); } return; }
        createFrom(t.kind === "blank" ? { name: "Untitled campaign", subject: "", preheader: "", blocks: [{ t: "hero", title: "Your headline here", text: "One or two sentences that say what this email is about.", btn: "Learn more", url: BOOT.settings.website }, { t: "text", text: "Hi {{first_name|there}},\n\nWrite your message here." }] } : { name: t.name, subject: t.subject, preheader: t.preheader, edition: t.edition, style: t.style, blocks: t.blocks }, btn);
      };
    });
  }
  async function createFrom(d, btn, ideas) {
    busy(btn, true, "Creating…");
    try {
      const c = await api("POST", "campaigns", { ...d, blocks: clone(d.blocks || []).map(b => ({ ...b, id: uid() })), audience: { mode: "all", tags: [] } });
      $("newDlg").close(); window.__mkIdeas = ideas || null; location.hash = "#edit/" + c.id;
    } catch (e) { toast(e.message, true); } finally { busy(btn, false); }
  }
  segBind($("newMode"), v => { $("newTpl").hidden = v !== "tpl"; $("newAi").hidden = v !== "ai"; if (v === "ai") { if (!BOOT.ai) $("aiErr").textContent = "Claude drafting isn't set up on the tools site yet. A manager can add it in Settings."; $("aiBrief").focus(); } });
  $("newAi").onsubmit = async e => {
    e.preventDefault(); $("aiErr").textContent = "";
    const brief = $("aiBrief").value.trim(); if (!brief) { $("aiErr").textContent = "Describe what the email should be about."; return; }
    busy($("aiGo"), true, "Claude is writing… about 30 seconds");
    try {
      const r = await api("POST", "ai", { kind: "campaign", brief, audience: $("aiAud").value, url: $("aiUrl").value, tone: $("aiTone").value, length: $("aiLen").value });
      await createFrom({ name: r.name || "Claude draft", subject: r.subject || "", preheader: r.preheader || "", edition: r.edition || "", blocks: r.blocks || [] }, $("aiGo"), [r.subject, ...(r.subjects || [])].filter(Boolean));
    } catch (er) { $("aiErr").textContent = er.message; } finally { busy($("aiGo"), false); }
  };

  // ---------- editor ----------
  const BLOCK_INFO = {
    hero: ["Hero banner", "Big headline on your brand colour, with a button"], heading: ["Heading", "A section title"], text: ["Text", "Paragraphs, bullets, bold and links"],
    image: ["Image", "A photo or graphic, optionally linked"], button: ["Button", "A single call to action"], split: ["Image + text", "Picture beside a short story"],
    features: ["Three highlights", "Three short points side by side"], stats: ["Key figures", "Up to four numbers with labels"], quote: ["Quote", "A customer or partner quote"],
    cta: ["Call to action", "Tinted box with a title and button"], divider: ["Divider", "A thin line"], spacer: ["Spacer", "Extra space"], html: ["Custom HTML", "For advanced users"],
  };
  const ALIGN = [["center", "Centred"], ["left", "Left"]];
  const F = {
    hero: [["kicker", "Small label above the headline"], ["title", "Headline"], ["text", "Text", "area"], ["img", "Image above the banner (optional)", "img"], ["btn", "Button text"], ["url", "Button link"], ["align", "Alignment", "sel", ALIGN]],
    heading: [["kicker", "Small label (optional)"], ["text", "Heading"], ["size", "Size", "sel", [["lg", "Large"], ["md", "Medium"]]], ["align", "Alignment", "sel", [["left", "Left"], ["center", "Centred"]]]],
    text: [["text", "Text", "area", null, true], ["align", "Alignment", "sel", [["left", "Left"], ["center", "Centred"]]]],
    image: [["img", "Image", "img"], ["alt", "Describe the image (for people who can't see it)"], ["url", "Link when clicked (optional)"], ["caption", "Caption (optional)"], ["w", "Width", "sel", [["inset", "Inside the margins"], ["full", "Full width"]]]],
    button: [["btn", "Button text"], ["url", "Link"], ["style", "Style", "sel", [["", "Solid"], ["outline", "Outline"]]], ["align", "Alignment", "sel", ALIGN]],
    split: [["img", "Image", "img"], ["alt", "Describe the image"], ["title", "Title"], ["text", "Text", "area", null, true], ["btn", "Button text (optional)"], ["url", "Button link"], ["side", "Image side", "sel", [["left", "Image on the left"], ["right", "Image on the right"]]]],
    features: [["title", "Section title (optional)"], ["items", "Highlights", "items", { max: 3, fields: [["title", "Title"], ["text", "Text", "area"]] }]],
    stats: [["items", "Figures", "items", { max: 4, fields: [["v", "Figure"], ["l", "Label"]] }]],
    quote: [["text", "Quote", "area"], ["by", "Name and company"]],
    cta: [["title", "Title"], ["text", "Text", "area"], ["btn", "Button text"], ["url", "Button link"]],
    divider: [], spacer: [["h", "Height", "range"]], html: [["html", "HTML", "area"]],
  };
  const NEW_BLOCK = {
    hero: () => ({ title: "Your headline", text: "A sentence or two of supporting text.", btn: "Learn more", url: BOOT.settings.website }),
    heading: () => ({ text: "Section heading" }), text: () => ({ text: "Write your text here." }), image: () => ({ img: "", alt: "", w: "inset" }),
    button: () => ({ btn: "Learn more", url: BOOT.settings.website, align: "center" }), split: () => ({ img: "", title: "Title", text: "Short description.", side: "left" }),
    features: () => ({ items: [{ title: "First point", text: "One sentence." }, { title: "Second point", text: "One sentence." }, { title: "Third point", text: "One sentence." }] }),
    stats: () => ({ items: [{ v: "[Figure]", l: "[Label]" }, { v: "[Figure]", l: "[Label]" }, { v: "[Figure]", l: "[Label]" }] }),
    quote: () => ({ text: "[The quote]", by: "[Name, Company]" }), cta: () => ({ title: "Ready to talk?", text: "One line on what happens next.", btn: "Get in touch", url: BOOT.settings.website }),
    divider: () => ({}), spacer: () => ({ h: 24 }), html: () => ({ html: "<p>Your HTML</p>" }),
  };

  async function openEditor(id) {
    $("v-edit").hidden = false;
    let c;
    try { c = await api("GET", "campaigns/" + id); } catch (e) { toast(e.message, true); location.hash = "#campaigns"; return; }
    if (!["draft", "approval", "scheduled"].includes(c.status)) { location.replace("#report/" + id); return; }
    ED = { id, etag: c.etag, status: c.status, scheduledAt: c.scheduledAt, lastNote: c.lastNote || "", requestedBy: c.requestedBy || "", approvedBy: c.approvedBy || "", open: null, dirty: false, saving: null, c: { name: c.name, subject: c.subject, preheader: c.preheader, edition: c.edition || "", style: c.style || "signature", audience: c.audience || { mode: "all", tags: [] }, blocks: (c.blocks || []).map(b => ({ ...b, id: b.id || uid() })) } };
    $("eName").value = ED.c.name; $("eSubject").value = ED.c.subject; $("ePre").value = ED.c.preheader; $("eEd").value = ED.c.edition;
    $("eSubLen").textContent = ED.c.subject.length;
    const ideas = window.__mkIdeas; window.__mkIdeas = null;
    showIdeas(ideas ? { subjects: ideas } : (c.subjectIdeas || []).length ? { subjects: c.subjectIdeas } : null);
    const tr = c.trend;
    $("eTrend").hidden = !tr;
    if (tr) $("eTrend").innerHTML = `<div><b>Drafted by Trend Radar</b> from ${esc(tr.vendorName)} news: <a href="${esc(tr.link)}" target="_blank" rel="noopener">${esc(tr.title)}</a>${tr.score >= 0 ? ` (relevance ${esc(tr.score)}/10)` : ""}. Check every fact against the source and add images before scheduling.</div>`;
    drawEdStatus(); drawAudience(); drawStyles(); drawBlocks(); preview();
    $("eSaved").textContent = "Saved";
    const ro = BOOT.readOnly; ["eTpl", "eTest", "eSched"].forEach(k => { $(k).disabled = ro; });
  }
  // Only a manager's click lets a campaign go out: team members send it for approval; managers approve or schedule.
  function drawEdStatus() {
    const st = ED.status, mgr = BOOT.isManager;
    $("eStatus").outerHTML = `<span class="stchip ${st}" id="eStatus">${st === "scheduled" ? "Scheduled · " + esc(fdt(ED.scheduledAt)) : st === "approval" ? "Awaiting approval · " + esc(fdt(ED.scheduledAt)) : "Draft"}</span>`;
    $("eSched").textContent = mgr ? (st === "scheduled" ? "Reschedule" : "Schedule") : st === "draft" ? "Send for approval" : "Change requested time";
    $("eSched").hidden = mgr && st === "approval";
    $("eApprove").hidden = $("eReject").hidden = !(mgr && st === "approval");
    const note = st === "approval" ? (mgr ? `${esc(firstName(ED.requestedBy))} asked to send this campaign on ${esc(fdt(ED.scheduledAt))}. Check it, then approve or return it to draft. Nothing goes out until you approve.` : "Waiting for a manager's approval. Nothing goes out until a manager approves it. Changing it keeps it in the queue for approval.")
      : st === "scheduled" && !mgr ? `Approved${ED.approvedBy ? " by " + esc(firstName(ED.approvedBy)) : ""}. If you change it, it goes back to a manager for approval.`
      : st === "draft" && /^Returned/.test(ED.lastNote) ? esc(ED.lastNote) : "";
    $("eNote").hidden = !note; $("eNote").innerHTML = note;
  }
  $("eApprove").onclick = async () => {
    await flushSave();
    if (!confirm(`Approve "${ED.c.name}"? It will go to ${num(ED.count || 0)} people ${Date.parse(ED.scheduledAt) > Date.now() ? "on " + fdt(ED.scheduledAt) : "within about 10 minutes"}.`)) return;
    try { const r = await api("POST", `campaigns/${ED.id}/approve`); ED.status = r.status; ED.scheduledAt = r.scheduledAt; ED.etag = r.etag; ED.approvedBy = r.approvedBy; drawEdStatus(); toast(`Approved. It goes out ${fdt(r.scheduledAt)} (UAE time).`); location.hash = "#campaigns"; }
    catch (er) { toast(er.message, true); }
  };
  $("eReject").onclick = async () => {
    const reason = prompt("Why is it going back? (shown to the person who prepared it)", "");
    if (reason === null) return;
    try { const r = await api("POST", `campaigns/${ED.id}/reject`, { reason }); ED.status = r.status; ED.etag = r.etag; ED.lastNote = r.lastNote; drawEdStatus(); toast("Returned to draft. Nothing was sent."); }
    catch (er) { toast(er.message, true); }
  };
  function changed(redrawBlocks) {
    if (!ED) return;
    ED.dirty = true; $("eSaved").textContent = "Unsaved changes";
    if (redrawBlocks) drawBlocks();
    preview();
    clearTimeout(ED.timer); ED.timer = setTimeout(save, 1800);
  }
  async function save() {
    if (!ED || !ED.dirty || BOOT.readOnly) return;
    if (ED.saving) { await ED.saving.catch(() => {}); if (!ED || !ED.dirty) return; }
    const ed = ED; ed.dirty = false; $("eSaved").textContent = "Saving…";
    ed.saving = api("PUT", "campaigns/" + ed.id, { ...ed.c, etag: ed.etag }).then(r => { ed.etag = r.etag; if (ED === ed) $("eSaved").textContent = ed.dirty ? "Unsaved changes" : "Saved " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); })
      .catch(e => { ed.dirty = true; if (ED === ed) $("eSaved").textContent = "Not saved"; toast(e.message, true); throw e; })
      .finally(() => { ed.saving = null; });
    return ed.saving;
  }
  async function flushSave() { if (!ED) return; clearTimeout(ED.timer); try { if (ED.saving) await ED.saving; if (ED.dirty) await save(); } catch {} }
  addEventListener("beforeunload", e => { if (ED && (ED.dirty || ED.saving)) { save(); e.preventDefault(); e.returnValue = ""; } });
  addEventListener("keydown", e => { if (ED && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); clearTimeout(ED.timer); save(); } });

  $("eName").oninput = () => { ED.c.name = $("eName").value; changed(); };
  $("eSubject").oninput = () => { ED.c.subject = $("eSubject").value; $("eSubLen").textContent = ED.c.subject.length; changed(); };
  $("ePre").oninput = () => { ED.c.preheader = $("ePre").value; changed(); };
  $("eEd").oninput = () => { ED.c.edition = $("eEd").value; changed(); };

  // Design styles: same content, different look. Small sketches in the company's own colours.
  function sketch(k) {
    const T = R.THEMES[BOOT.co] || R.THEMES.bifold, w = "#fff";
    const L = (c, h, extra) => `<i style="background:${c};height:${h}px;${extra || ""}"></i>`;
    const page = { minimal: w, spotlight: T.soft, editorial: "#F6F7F9" }[k] || T.page;
    const parts = {
      signature: L(w, 6, `border-bottom:2px solid ${T.accent}`) + L(T.navy, 14) + `<i class="cols">${L(T.soft, 7)}${L(T.soft, 7)}${L(T.soft, 7)}</i>` + L(T.navy, 5),
      editorial: L(w, 5) + L(w, 3, `border-top:2px solid ${T.navy};border-bottom:1px solid ${T.navy}`) + L(w, 13, `background:linear-gradient(${T.navy},${T.navy}) 2px 1px/80% 3px no-repeat, linear-gradient(${T.navy},${T.navy}) 2px 6px/55% 3px no-repeat, linear-gradient(${T.accent},${T.accent}) 2px 11px/8px 2px no-repeat, ${w}`) + L(T.soft, 8, `border-top:2px solid ${T.navy}`) + L(T.navy, 6, `border-top:1px solid ${T.accent}`),
      impact: L(w, 5) + L(T.bold, 17) + `<i class="cols c">${L(T.accent, 7, "border-radius:50%;width:7px;flex:none")}${L(T.navy, 7, "border-radius:50%;width:7px;flex:none")}${L(T.accent, 7, "border-radius:50%;width:7px;flex:none")}</i>` + L(T.navy, 5),
      advisory: L(w, 5) + L(T.bold, 3) + L(w, 12, `border-left:3px solid ${T.accent}`) + L(T.soft, 4, `border-left:2px solid ${T.accent};margin-bottom:1px`) + L(T.soft, 4, `border-left:2px solid ${T.accent}`) + L(T.navy, 5),
      minimal: L(T.accent, 2) + L(w, 5, "border-bottom:1px solid " + T.line) + L(w, 12, `background:linear-gradient(${T.accent},${T.accent}) 2px 1px/6px 2px no-repeat, linear-gradient(${T.navy},${T.navy}) 2px 4px/75% 3px no-repeat, linear-gradient(${T.navy},${T.navy}) 2px 9px/40% 3px no-repeat, ${w}`) + L(w, 9, `background:repeating-linear-gradient(${w} 0 3px, ${T.line} 3px 4px)`) + L(T.soft, 6, `border-left:2px solid ${T.accent}`) + L(T.soft, 4),
      spotlight: L(w, 5) + L(T.navy, 14, `background:linear-gradient(90deg, ${T.navy} 4px, ${T.accent} 4px 14px, ${T.navy} 14px) top/100% 3px no-repeat, ${T.navy}`) + `<i class="cols">${L(T.navy, 8)}${L(T.navy2, 8)}${L(T.navy, 8)}</i>` + L(T.bold, 5),
      briefing: L(w, 5) + L(T.navy2, 3) + L(T.soft, 12) + L(w, 4, `border-left:2px solid ${T.accent};box-shadow:inset 0 0 0 1px ${T.line}`) + L(w, 4, `border-left:2px solid ${T.accent2};box-shadow:inset 0 0 0 1px ${T.line}`) + L(T.navy, 5),
    };
    return `<span class="sk" style="background:${page}">${parts[k] || ""}</span>`;
  }
  function drawStyles() {
    const cur = ED.c.style || "signature";
    $("eStyle").innerHTML = R.STYLES.map(s => `<button type="button" role="radio" aria-checked="${s.key === cur}" data-k="${s.key}" title="${esc(s.desc)}">${sketch(s.key)}<b>${esc(s.label)}</b></button>`).join("");
    $("eStyleDesc").textContent = (R.STYLES.find(s => s.key === cur) || {}).desc || "";
    $("eStyle").querySelectorAll("button").forEach(b => { b.disabled = BOOT.readOnly; b.onclick = () => setStyle(b.dataset.k); });
    $("eStyleNext").disabled = BOOT.readOnly;
  }
  function setStyle(k) { if (!ED || ED.c.style === k) return; ED.c.style = k; drawStyles(); changed(); }
  $("eStyleNext").onclick = () => { const ks = R.STYLE_KEYS, i = ks.indexOf(ED.c.style || "signature"); setStyle(ks[(i + 1) % ks.length]); };

  // preview
  let pTimer;
  function preview() {
    clearTimeout(pTimer);
    pTimer = setTimeout(() => {
      if (!ED) return;
      $("pInbox").textContent = `${ED.c.subject || "(no subject)"} · ${ED.c.preheader || ""}`;
      const f = $("pFrame"); const y = f.contentWindow ? f.contentWindow.scrollY : 0;
      setFrame(f, emailHtml(ED.c, true));
      f.onload = () => { try { f.contentWindow.scrollTo(0, y); } catch {} };
    }, 160);
  }
  segBind($("pSize"), v => $("pWrap").classList.toggle("mob", v === "mob"));

  // subject ideas
  function showIdeas(r) {
    const el = $("eSubIdeas");
    if (!r || !(r.subjects || []).length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<div class="mdhint">Subject ideas from Claude (click to use):</div>` + r.subjects.map(s => `<button type="button" data-s="${esc(s)}">${esc(s)}</button>`).join("");
    el.querySelectorAll("button").forEach(b => b.onclick = () => { $("eSubject").value = ED.c.subject = b.dataset.s; $("eSubLen").textContent = ED.c.subject.length; if (r.preheader && !ED.c.preheader) { $("ePre").value = ED.c.preheader = r.preheader; } changed(); });
  }
  $("eSuggest").onclick = async () => {
    if (!BOOT.ai) { toast("Claude drafting isn't set up on the tools site yet.", true); return; }
    busy($("eSuggest"), true, "Thinking…");
    try { showIdeas(await api("POST", "ai", { kind: "subjects", subject: ED.c.subject, summary: R.renderText(ED.c, brand(), "").slice(0, 3000) })); }
    catch (e) { toast(e.message, true); } finally { busy($("eSuggest"), false); }
  };

  // audience
  let audTimer;
  function drawAudience() {
    const a = ED.c.audience; seg($("eAudMode"), a.mode);
    const tp = $("eTags"); tp.hidden = a.mode !== "tags";
    tp.innerHTML = BOOT.tags.length ? BOOT.tags.map(t => `<button type="button" data-t="${esc(t.name)}" aria-pressed="${a.tags.includes(t.name)}">${esc(t.name)} <span class="muted">${num(t.n)}</span></button>`).join("") : `<span class="none">No lists yet. Lists are created when you import contacts or tag them on the Contacts page.</span>`;
    clearTimeout(audTimer);
    $("eAudN").innerHTML = `<span class="spin"></span>`;
    audTimer = setTimeout(async () => { try { const r = await api("POST", "audience", a); $("eAudN").innerHTML = `<b>${num(r.count)}</b> subscribed ${r.count === 1 ? "person" : "people"} will get this email.`; ED.count = r.count; } catch { $("eAudN").textContent = ""; } }, 300);
  }
  segBind($("eAudMode"), v => { ED.c.audience.mode = v; drawAudience(); changed(); });
  $("eTags").addEventListener("click", e => { const b = e.target.closest("button[data-t]"); if (!b) return; const t = b.dataset.t, a = ED.c.audience; a.tags = a.tags.includes(t) ? a.tags.filter(x => x !== t) : [...a.tags, t]; drawAudience(); changed(); });

  // blocks
  const summary = b => { const s = b.title || b.text || b.btn || b.alt || b.caption || (b.items || []).map(i => i.title || i.v).filter(Boolean).join(" · ") || (b.t === "spacer" ? (b.h || 24) + " px" : b.t === "html" ? "HTML" : ""); return String(s).replace(/\s+/g, " ").slice(0, 80); };
  function drawBlocks() {
    const list = ED.c.blocks;
    $("eBlkN").textContent = list.length + " block" + (list.length === 1 ? "" : "s");
    $("eBlocks").innerHTML = list.map((b, i) => `<div class="blk${ED.open === b.id ? " open" : ""}" data-id="${esc(b.id)}">
      <div class="bh" data-tog><span class="bt">${esc((BLOCK_INFO[b.t] || [b.t])[0])}</span><span class="bs">${esc(summary(b))}</span>
      <span class="bc"><button type="button" data-a="up" title="Move up" aria-label="Move up"${i ? "" : " disabled"}>↑</button><button type="button" data-a="down" title="Move down" aria-label="Move down"${i < list.length - 1 ? "" : " disabled"}>↓</button><button type="button" data-a="dup" title="Duplicate" aria-label="Duplicate">⧉</button><button type="button" data-a="del" title="Delete" aria-label="Delete">✕</button></span></div>
      ${ED.open === b.id ? `<div class="bb">${fieldsHtml(b)}</div>` : ""}</div>`).join("") || `<div class="empty">No content yet. Add a block to begin.</div>`;
    const open = $("eBlocks").querySelector(".blk.open"); if (open) bindFields(open, list.find(b => b.id === ED.open));
  }
  function fieldsHtml(b) {
    return (F[b.t] || []).map(([k, label, type, opt, ai]) => {
      const v = b[k] == null ? "" : b[k];
      if (type === "area") return `<div><label class="lbl">${esc(label)}</label><textarea data-k="${k}" rows="${k === "html" ? 8 : 5}">${esc(v)}</textarea>${b.t === "text" || b.t === "split" ? `<div class="mdhint">Blank line = new paragraph · "- " starts a bullet · **bold** · [link text](https://…) · {{first_name|there}}</div>` : ""}${ai ? `<div class="withbtn" style="margin-top:6px"><select data-ai-i aria-label="How should Claude improve it"><option>Make it clearer and more engaging</option><option>Make it shorter</option><option>Make it more friendly</option><option>Make it more formal</option><option>Fix spelling and grammar</option></select><button type="button" class="ai-btn" data-ai="${k}">✦ Improve</button></div>` : ""}</div>`;
      if (type === "sel") return `<div><label class="lbl">${esc(label)}</label><select data-k="${k}">${opt.map(([ov, ol]) => `<option value="${esc(ov)}"${String(v || opt[0][0]) === ov ? " selected" : ""}>${esc(ol)}</option>`).join("")}</select></div>`;
      if (type === "range") return `<div><label class="lbl">${esc(label)}: <span>${esc(v || 24)}</span> px</label><input type="range" min="8" max="80" step="4" data-k="${k}" value="${esc(v || 24)}"></div>`;
      if (type === "img") return `<div><label class="lbl">${esc(label)}</label><div class="imgf"><span class="ti" style="${v ? `background-image:url('${esc(v)}')` : ""}"></span><span class="nm">${v ? esc(v.split("/").pop()) : "No image"}</span><button type="button" data-img="${k}">${v ? "Change" : "Choose"}</button>${v ? `<button type="button" data-noimg="${k}" class="x" aria-label="Remove image">×</button>` : ""}</div></div>`;
      if (type === "items") return `<div><label class="lbl">${esc(label)}</label><div style="display:grid;gap:8px">${(b.items || []).map((it, n) => `<div class="item"><div class="withbtn"><b style="font-size:12px;flex:1">${n + 1}</b>${(b.items || []).length > 1 ? `<button type="button" class="x" data-rmi="${n}" aria-label="Remove">×</button>` : ""}</div>${opt.fields.map(([fk, fl, ft]) => ft === "area" ? `<textarea data-i="${n}" data-f="${fk}" rows="2" placeholder="${esc(fl)}" aria-label="${esc(fl)}">${esc(it[fk] || "")}</textarea>` : `<input data-i="${n}" data-f="${fk}" placeholder="${esc(fl)}" aria-label="${esc(fl)}" value="${esc(it[fk] || "")}">`).join("")}</div>`).join("")}${(b.items || []).length < opt.max ? `<button type="button" data-addi>+ Add</button>` : ""}</div></div>`;
      return `<div><label class="lbl">${esc(label)}</label><input data-k="${k}" value="${esc(v)}"${k === "url" ? ' placeholder="https://"' : ""}></div>`;
    }).join("") || `<p class="hint">Nothing to set for this block.</p>`;
  }
  function bindFields(el, b) {
    const bs = el.querySelector(".bs");
    el.querySelectorAll("[data-k]").forEach(inp => {
      const ev = inp.tagName === "SELECT" ? "change" : "input";
      inp.addEventListener(ev, () => { b[inp.dataset.k] = inp.type === "range" ? Number(inp.value) : inp.value; if (inp.type === "range") inp.previousElementSibling.querySelector("span").textContent = inp.value; bs.textContent = summary(b); changed(); });
    });
    el.querySelectorAll("[data-i]").forEach(inp => inp.addEventListener("input", () => { b.items[inp.dataset.i][inp.dataset.f] = inp.value; bs.textContent = summary(b); changed(); }));
    el.querySelectorAll("[data-rmi]").forEach(x => x.onclick = () => { b.items.splice(Number(x.dataset.rmi), 1); changed(true); });
    const addi = el.querySelector("[data-addi]"); if (addi) addi.onclick = () => { b.items.push({}); changed(true); };
    el.querySelectorAll("[data-img]").forEach(x => x.onclick = () => pickImage(url => { b[x.dataset.img] = url; if (!b.alt && b.t !== "hero") b.alt = ""; changed(true); }));
    el.querySelectorAll("[data-noimg]").forEach(x => x.onclick = () => { b[x.dataset.noimg] = ""; changed(true); });
    el.querySelectorAll("[data-ai]").forEach(x => x.onclick = async () => {
      if (!BOOT.ai) { toast("Claude drafting isn't set up on the tools site yet.", true); return; }
      const k = x.dataset.ai; busy(x, true, "Rewriting…");
      try { const r = await api("POST", "ai", { kind: "rewrite", text: b[k], instruction: el.querySelector("[data-ai-i]").value }); if (r.text) { b[k] = r.text; changed(true); toast("Rewritten by Claude. Check it reads right."); } }
      catch (e) { toast(e.message, true); } finally { busy(x, false); }
    });
  }
  $("eBlocks").addEventListener("click", e => {
    const blk = e.target.closest(".blk"); if (!blk) return;
    const list = ED.c.blocks; const i = list.findIndex(b => b.id === blk.dataset.id);
    const a = e.target.closest("[data-a]");
    if (a) {
      e.stopPropagation();
      if (a.dataset.a === "up" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
      else if (a.dataset.a === "down" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
      else if (a.dataset.a === "dup") { const n = { ...clone(list[i]), id: uid() }; list.splice(i + 1, 0, n); ED.open = n.id; }
      else if (a.dataset.a === "del") { if (!confirm(`Remove this ${(BLOCK_INFO[list[i].t] || [""])[0].toLowerCase()} block?`)) return; list.splice(i, 1); }
      changed(true); return;
    }
    if (e.target.closest("[data-tog]")) { ED.open = ED.open === blk.dataset.id ? null : blk.dataset.id; drawBlocks(); scrollPreviewTo(i); }
  });
  function scrollPreviewTo(i) { /* keep the preview roughly in step with the block being edited */
    try { const doc = $("pFrame").contentDocument; const rows = doc.querySelectorAll("table.w > tbody > tr"); const r = rows[Math.min(rows.length - 1, i + 1)]; if (r) r.scrollIntoView({ block: "center", behavior: "smooth" }); } catch {}
  }
  $("eAdd").onclick = () => {
    $("bPick").innerHTML = Object.entries(BLOCK_INFO).map(([t, [n, d]]) => `<button type="button" data-t="${t}"><b>${esc(n)}</b><span>${esc(d)}</span></button>`).join("");
    $("addDlg").showModal();
  };
  $("bPick").addEventListener("click", e => {
    const b = e.target.closest("button[data-t]"); if (!b) return;
    const n = { t: b.dataset.t, id: uid(), ...NEW_BLOCK[b.dataset.t]() };
    const list = ED.c.blocks; const at = ED.open ? list.findIndex(x => x.id === ED.open) + 1 : list.length;
    list.splice(at, 0, n); ED.open = n.id; $("addDlg").close(); changed(true);
    setTimeout(() => { const el = $("eBlocks").querySelector(".blk.open"); if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" }); scrollPreviewTo(at); }, 250);
  });

  // save as design
  $("eTpl").onclick = async () => {
    const name = await ask("Save as a design", "Name for this design (the team can start new campaigns from it)", ED.c.name);
    if (!name) return;
    try { await api("POST", "templates", { name, subject: ED.c.subject, preheader: ED.c.preheader, edition: ED.c.edition, style: ED.c.style, blocks: ED.c.blocks }); SAVED = null; toast("Design saved. It's now in New campaign."); } catch (e) { toast(e.message, true); }
  };

  // test send
  $("eTest").onclick = () => { $("testTo").value = $("testTo").value || ME.email; $("testErr").textContent = ""; $("testDlg").showModal(); };
  $("testForm").onsubmit = async e => {
    e.preventDefault(); $("testErr").textContent = "";
    busy($("testGo"), true, "Sending…");
    try { const r = await api("POST", `campaigns/${ED.id}/test`, { to: $("testTo").value, draft: ED.c }); $("testDlg").close(); toast(`Test sent to ${r.to.join(", ")}.`); }
    catch (er) { $("testErr").textContent = er.message; } finally { busy($("testGo"), false); }
  };

  // schedule
  $("eSched").onclick = async () => {
    await flushSave();
    const has = ["scheduled", "approval"].includes(ED.status);
    const when = has ? new Date(ED.scheduledAt) : new Date(Date.now() + 864e5);
    const p = dubaiParts(when);
    $("schedDate").value = p.date; $("schedTime").value = has ? p.time : "09:00";
    $("schedDate").min = dubaiParts(new Date()).date;
    seg($("schedMode"), "later"); $("schedWhen").hidden = false; $("schedErr").textContent = "";
    $("schedGo").textContent = !BOOT.isManager ? "Send for approval" : ED.status === "scheduled" ? "Update schedule" : "Schedule";
    let extra = $("schedForm").querySelector("[data-unsched]");
    if (has && !extra) { extra = document.createElement("button"); extra.type = "button"; extra.dataset.unsched = "1"; extra.textContent = "Move back to draft"; $("schedForm").querySelector(".foot > span").replaceWith(extra); }
    else if (!has && extra) extra.replaceWith(document.createElement("span"));
    if (extra && has) extra.onclick = async () => { try { const r = await api("POST", `campaigns/${ED.id}/unschedule`); ED.status = r.status; ED.etag = r.etag; drawEdStatus(); $("schedDlg").close(); toast("Moved back to draft. It won't be sent."); } catch (er) { $("schedErr").textContent = er.message; } };
    schedSummary();
    $("schedDlg").showModal();
  };
  function schedSummary() {
    const n = ED.count || 0; const s = BOOT.sending;
    const hours = n / Math.max(1, s.perHour);
    const dur = n <= s.perHour ? `about ${Math.max(1, Math.ceil(n / s.perMinute))} minute${Math.ceil(n / s.perMinute) === 1 ? "" : "s"}` : hours < 24 ? `about ${Math.ceil(hours)} hours` : `about ${Math.ceil(hours / 24)} days`;
    $("schedSum").innerHTML = `<div><b>${num(n)}</b> recipients · ${esc(audLabel(ED.c.audience))}</div>
      <div>Subject: ${esc(ED.c.subject || "(none yet)")}</div>
      <div>From: ${esc(s.sender || "not set yet")}${BOOT.settings.replyTo ? " · replies to " + esc(BOOT.settings.replyTo) : ""}</div>
      <div class="muted">Sending starts within about 10 minutes of the chosen time and takes ${dur} at the current limit of ${num(s.perHour)} emails an hour.</div>
      ${s.ready ? "" : `<div class="neg">Sending isn't connected yet, so this campaign will wait until it is.</div>`}
      ${BOOT.isManager ? "" : `<div><b>A manager must approve this campaign before it goes out.</b> They'll see it at the top of their screen.</div>`}`;
  }
  segBind($("schedMode"), v => { $("schedWhen").hidden = v === "now"; $("schedGo").textContent = !BOOT.isManager ? "Send for approval" : v === "now" ? "Send now" : ED.status === "scheduled" ? "Update schedule" : "Schedule"; });
  $("schedForm").onsubmit = async e => {
    e.preventDefault(); $("schedErr").textContent = "";
    const now = segVal($("schedMode")) === "now";
    let at = new Date().toISOString();
    if (!now) {
      if (!$("schedDate").value || !$("schedTime").value) { $("schedErr").textContent = "Pick a date and time."; return; }
      at = new Date(`${$("schedDate").value}T${$("schedTime").value}:00+04:00`).toISOString();
    }
    if (now && BOOT.isManager && !confirm(`Send "${ED.c.name}" to ${num(ED.count || 0)} people now?`)) return;
    busy($("schedGo"), true, "Scheduling…");
    try {
      await flushSave();
      const r = await api("POST", `campaigns/${ED.id}/schedule`, { at });
      ED.status = r.status; ED.scheduledAt = r.scheduledAt; ED.etag = r.etag; drawEdStatus();
      $("schedDlg").close();
      toast(r.status === "approval" ? "Sent to a manager for approval. It goes out only after they approve it." : now ? "Queued. Sending starts within about 10 minutes." : `Scheduled for ${fdt(r.scheduledAt)} (UAE time).`);
      location.hash = "#campaigns";
    } catch (er) { $("schedErr").textContent = er.message; } finally { busy($("schedGo"), false); }
  };

  // ---------- image picker and library ----------
  async function loadMedia(force) { if (!MEDIA || force) MEDIA = await api("GET", "media"); return MEDIA; }
  const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  const mediaCard = (m, pick) => `<${pick ? "button type=\"button\"" : "div"} class="mcard" data-url="${esc(m.url)}" data-id="${esc(m.id)}"><span class="im" style="background-image:url('${esc(m.url)}')"></span><span class="mi"><b title="${esc(m.name)}">${esc(m.name)}</b><span>${m.w ? m.w + " × " + m.h + " · " : ""}${fmtSize(m.size)}</span>${pick ? "" : `<span>${esc(firstName(m.by))} · ${esc(fd(m.at))}</span>`}</span>${pick ? "" : `<span class="ma"><button type="button" data-copy>Copy link</button><button type="button" class="danger" data-del>Delete</button></span>`}</${pick ? "button" : "div"}>`;
  let pickCb = null;
  async function pickImage(cb) {
    pickCb = cb; $("imgUrl").value = ""; $("imgGrid").innerHTML = `<div class="empty">Loading…</div>`; $("imgDlg").showModal();
    try { const list = await loadMedia(); $("imgGrid").innerHTML = list.map(m => mediaCard(m, true)).join("") || `<div class="empty">No images yet. Upload one above.</div>`; } catch (e) { $("imgGrid").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  $("imgGrid").addEventListener("click", e => { const c = e.target.closest(".mcard"); if (!c || !pickCb) return; pickCb(c.dataset.url); $("imgDlg").close(); });
  $("imgUse").onclick = () => { const u = $("imgUrl").value.trim(); if (!/^https:\/\//.test(u)) { toast("Paste a link that starts with https://", true); return; } pickCb(u); $("imgDlg").close(); };
  $("imgFile").onchange = async () => { const f = $("imgFile").files[0]; $("imgFile").value = ""; if (!f) return; try { const m = await uploadImage(f); MEDIA = [m, ...(MEDIA || [])]; pickCb(m.url); $("imgDlg").close(); } catch (e) { toast(e.message, true); } };

  // Resize big photos before upload (email images should be light) and convert WebP for Outlook.
  function readImage(file) {
    return new Promise((res, rej) => { const u = URL.createObjectURL(file); const im = new Image(); im.onload = () => { res(im); URL.revokeObjectURL(u); }; im.onerror = () => { rej(new Error(`${file.name} isn't an image this browser can read.`)); URL.revokeObjectURL(u); }; im.src = u; });
  }
  const toB64 = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(blob); });
  async function uploadImage(file) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error(`${file.name}: upload a JPG, PNG, GIF or WebP image.`);
    const im = await readImage(file);
    let blob = file, type = file.type, w = im.naturalWidth, h = im.naturalHeight, name = file.name;
    const MAXW = 1200;
    if (type !== "image/gif" && (w > MAXW || type === "image/webp" || file.size > 900 * 1024)) {
      const s = Math.min(1, MAXW / w); w = Math.round(w * s); h = Math.round(h * s);
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const cx = cv.getContext("2d");
      const keepPng = type === "image/png" && file.size < 1.5 * 1048576;
      if (!keepPng) { cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, w, h); }
      cx.drawImage(im, 0, 0, w, h);
      type = keepPng ? "image/png" : "image/jpeg";
      blob = await new Promise(r => cv.toBlob(r, type, .86));
      if (type === "image/jpeg") name = name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg";
    }
    if (blob.size > 5 * 1048576) throw new Error(`${file.name} is still larger than 5 MB after resizing.`);
    return api("POST", "media", { name, type, data: await toB64(blob), w, h });
  }

  async function showMedia() {
    $("v-media").hidden = false;
    $("pageSub").textContent = "Images for your campaigns. They are stored on the tools site and shown in emails from there.";
    headActs("");
    try { await loadMedia(true); drawMedia(); } catch (e) { $("mGrid").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  function drawMedia() { $("mGrid").innerHTML = MEDIA.map(m => mediaCard(m, false)).join("") || `<div class="empty">No images yet. Drop some above.</div>`; }
  async function uploadMany(files) {
    const list = [...files]; if (!list.length) return;
    let ok = 0; for (const f of list) { try { const m = await uploadImage(f); MEDIA = [m, ...(MEDIA || [])]; ok++; drawMedia(); } catch (e) { toast(e.message, true); } }
    if (ok) toast(`${ok} image${ok === 1 ? "" : "s"} uploaded.`);
  }
  $("mFile").onchange = () => { uploadMany($("mFile").files); $("mFile").value = ""; };
  const drop = $("drop");
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => uploadMany(e.dataTransfer.files));
  $("mGrid").addEventListener("click", async e => {
    const c = e.target.closest(".mcard"); if (!c) return;
    const m = MEDIA.find(x => x.id === c.dataset.id);
    if (e.target.closest("[data-copy]")) { const u = BOOT.sending.publicUrl + m.url; try { await navigator.clipboard.writeText(u); toast("Link copied."); } catch { prompt("Copy this link", u); } }
    if (e.target.closest("[data-del]")) { if (!confirm(`Delete ${m.name}? Emails already sent that use it will show a broken image.`)) return; try { await api("DELETE", "media/" + m.id); MEDIA = MEDIA.filter(x => x.id !== m.id); drawMedia(); } catch (er) { toast(er.message, true); } }
  });

  // ---------- report ----------
  async function openReport(id) {
    const v = $("v-report"); v.hidden = false; v.innerHTML = `<div class="empty">Loading…</div>`;
    headActs("");
    let c, r;
    try { [c, r] = await Promise.all([api("GET", "campaigns/" + id), api("GET", `campaigns/${id}/report`)]); } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (["draft", "scheduled"].includes(c.status)) { location.replace("#edit/" + id); return; }
    $("pageSub").innerHTML = `<a href="#campaigns" class="blink">← All campaigns</a>`;
    const total = r.total || c.total || 0, pct = total ? Math.round(r.sent / total * 100) : 0;
    const acts = BOOT.readOnly ? "" : [c.status === "sending" ? `<button type="button" data-st="pause">Pause</button>` : "", c.status === "paused" ? `<button type="button" class="primary" data-st="resume">Resume</button>` : "",
      ["sending", "paused"].includes(c.status) ? `<button type="button" class="danger" data-st="cancel">Cancel</button>` : "", `<button type="button" data-dup>Duplicate</button>`,
      !["sending", "paused"].includes(c.status) ? `<button type="button" class="danger" data-delc>Delete</button>` : ""].join("");
    v.innerHTML = `<div class="rgrid"><div style="display:grid;gap:14px;min-width:0">
      <div class="panel"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start"><div><h2 style="margin:0 0 4px;font-size:20px">${esc(c.name)}</h2>${chip(c.status)}</div><div style="display:flex;gap:8px;flex-wrap:wrap">${acts}</div></div>
        <div class="kpis" style="margin:16px 0 6px">
          <div class="kpi" style="--c:var(--good)"><div class="k">Handed to Azure</div><div class="v">${num(r.sent)}</div><div class="s">of ${num(total)} recipients</div></div>
          <div class="kpi" style="--c:var(--accent)"><div class="k">Still queued</div><div class="v">${num(r.queued)}</div><div class="s">${c.status === "sending" ? "sending at the hourly limit" : c.status === "paused" ? "paused" : "–"}</div></div>
          <div class="kpi" style="--c:var(--bad)"><div class="k">Failed</div><div class="v">${num(r.failed)}</div><div class="s">${num(r.skipped)} skipped (unsubscribed)</div></div>
          <div class="kpi" style="--c:var(--warn)"><div class="k">Unsubscribed</div><div class="v">${num(r.unsubscribed)}</div><div class="s">using this email's link</div></div>
        </div>
        <div class="bar" style="height:8px"><i style="width:${pct}%"></i></div>
        <dl class="facts"><dt>Subject</dt><dd>${esc(c.subject)}</dd><dt>Audience</dt><dd>${esc(audLabel(c.audience))}</dd><dt>Scheduled</dt><dd>${esc(fdt(c.scheduledAt))}</dd>
          ${c.startedAt ? `<dt>Started</dt><dd>${esc(fdt(c.startedAt))}</dd>` : ""}${c.completedAt ? `<dt>Finished</dt><dd>${esc(fdt(c.completedAt))}</dd>` : ""}${c.lastNote && c.status === "sending" ? `<dt>Waiting for</dt><dd>${esc(c.lastNote)}; it continues automatically</dd>` : ""}<dt>Created by</dt><dd>${esc(c.createdBy)}</dd></dl>
        <p class="hint">"Handed to Azure" means Azure accepted the email for delivery. Bounces from closed mailboxes show up later in Azure's delivery logs.</p></div>
      ${r.failedList.length ? `<div class="panel"><h3 class="ph">Failed addresses <span class="muted">${num(r.failed)}</span></h3><div class="flist">${r.failedList.map(f => `<div><b>${esc(f.email)}</b><br><span class="muted">${esc(f.error)}</span></div>`).join("")}</div></div>` : ""}
      </div><div class="pframe"><iframe id="rFrame" title="Email as sent" sandbox="allow-same-origin allow-popups"></iframe></div></div>`;
    setFrame($("rFrame"), emailHtml(c, false));
    v.querySelectorAll("[data-st]").forEach(b => b.onclick = async () => {
      const s = b.dataset.st; if (s === "cancel" && !confirm("Cancel this campaign? Nobody else on the list will get it.")) return;
      try { await api("POST", `campaigns/${id}/${s}`); toast({ pause: "Paused.", resume: "Resumed. Sending continues within about 10 minutes.", cancel: "Cancelled." }[s]); openReport(id); } catch (e) { toast(e.message, true); }
    });
    const dup = v.querySelector("[data-dup]"); if (dup) dup.onclick = async () => { try { const n = await api("POST", `campaigns/${id}/duplicate`); location.hash = "#edit/" + n.id; } catch (e) { toast(e.message, true); } };
    const del = v.querySelector("[data-delc]"); if (del) del.onclick = async () => { if (!confirm(`Delete "${c.name}"? Its report goes too.`)) return; try { await api("DELETE", "campaigns/" + id); location.hash = "#campaigns"; } catch (e) { toast(e.message, true); } };
    if (c.status === "sending") leaving = setInterval(() => { if (!document.hidden && location.hash === "#report/" + id) openReport(id); }, 30000);
  }

  // ---------- Trend Radar ----------
  let RAD = null, rShow = "top";
  async function showRadar() {
    $("v-radar").hidden = false;
    $("pageSub").textContent = "Vendor news from your partners, scored by Claude for your customers every morning. The best items become campaign drafts for you to review.";
    headActs("");
    $("rList").innerHTML = `<div class="empty">Loading the radar…</div>`;
    try { RAD = await api("GET", "radar"); } catch (e) { $("rList").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const vs = [...new Set(RAD.items.map(i => i.vendor))];
    $("rVendor").innerHTML = `<option value="">All vendors</option>` + RAD.vendors.filter(v => vs.includes(v.key)).map(v => `<option value="${esc(v.key)}">${esc(v.name)}</option>`).join("");
    drawRadarHead(); drawRadar();
  }
  function drawRadarHead() {
    const L = RAD.lastRun, S = RAD.settings, on = RAD.vendors.filter(v => S.vendors[v.key]);
    const when = L ? `Last scan <b>${esc(fdt(L.at))}</b>: ${num(L.fetched)} news items read, ${num(L.fresh)} new, <b>${num(L.drafted)}</b> campaign draft${L.drafted === 1 ? "" : "s"}${L.social ? `, <b>${num(L.social)}</b> social post${L.social === 1 ? "" : "s"}` : ""}.` : `<b>No scan yet.</b> The radar runs with the morning agents, once a day.`;
    $("rHead").innerHTML = `<div class="rh-t">${when}<br>Watching ${on.length} vendors (${on.filter(v => v.own).length} partners, ${on.filter(v => !v.own).length} for cross-selling). Drafts from score <b>${S.minScore}</b>, up to <b>${S.maxDrafts}</b> a morning, for ${esc(S.sectors.join(", "))}.${L && L.errors && L.errors.length ? `<br><span class="neg">${esc(L.errors[0])}</span>` : ""}${RAD.ai ? "" : `<br><span class="neg">Claude isn't connected on the tools site, so "Draft campaign" is unavailable here.</span>`}</div>
      <div class="rh-a">${RAD.isManager && !BOOT.readOnly ? `<button type="button" id="rSet">Radar settings</button>` : ""}</div>`;
    if ($("rSet")) $("rSet").onclick = openRadarSettings;
  }
  function drawRadar() {
    const q = $("rQ").value.trim().toLowerCase(), v = $("rVendor").value, min = RAD.settings.minScore;
    const list = RAD.items.filter(i => (!v || i.vendor === v) && (!q || (i.title + " " + i.summary + " " + i.vendorName).toLowerCase().includes(q)) &&
      (rShow === "all" ? i.status !== "dismissed" : rShow === "drafted" ? !!i.campaignId : rShow === "dismissed" ? i.status === "dismissed" : i.status !== "dismissed" && (i.score >= Math.max(5, min - 2) || i.campaignId)));
    $("rCnt").textContent = `${num(list.length)} item${list.length === 1 ? "" : "s"}`;
    if (!list.length) {
      $("rList").innerHTML = `<div class="panel empty">${!RAD.items.length ? "<b>Nothing on the radar yet.</b><br>After the next morning scan, vendor news appears here with a score and a campaign idea." : rShow === "top" ? `Nothing scored ${Math.max(5, min - 2)} or more in the last 30 days. Look under <b>All news</b>.` : "Nothing to show."}</div>`;
      return;
    }
    $("rList").innerHTML = list.map(i => {
      const cls = i.score < 0 ? "" : i.score >= 8 ? "hi" : i.score >= min ? "ok" : "";
      const vend = RAD.vendors.find(x => x.key === i.vendor) || {};
      const soc = i.socialId ? `<a class="btn" href="#post/${esc(i.socialId)}">Open social post</a>` : i.status === "dismissed" || BOOT.readOnly ? "" : `<button type="button" data-soc="${esc(i.id)}"${RAD.ai ? "" : " disabled"}>✦ Social post</button>`;
      const acts = (i.campaignId ? `<a class="btn primary" href="#edit/${esc(i.campaignId)}">Open draft</a>`
        : i.status === "dismissed" || BOOT.readOnly ? "" : `<button type="button" class="primary" data-draft="${esc(i.id)}"${RAD.ai ? "" : " disabled"}>✦ Draft campaign</button>`) + soc + (!i.campaignId && i.status !== "dismissed" && !BOOT.readOnly ? `<button type="button" data-dis="${esc(i.id)}">Not relevant</button>` : "");
      return `<article class="rcard${i.status === "dismissed" ? " done" : ""}"><div class="rscore ${cls}" title="Relevance scored by Claude">${i.score < 0 ? "–" : i.score}<small>/10</small></div>
        <div><div class="rmeta"><span class="vchip">${esc(i.vendorName)}</span><span class="ochip">${vend.own ? "Our partner" : "Cross-sell"}</span><span>${esc(fd(i.date))}</span><span>${i.official ? "Official news" : esc(i.source || "News coverage")}</span>${i.dup ? `<span class="ochip">Same story as another item</span>` : ""}${i.campaignId ? `<span class="stchip sent">Draft ready${i.draftedBy && i.draftedBy !== "Trend Radar" ? " · " + esc(firstName(i.draftedBy)) : ""}</span>` : ""}</div>
        <h3><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
        ${i.why ? `<p class="rwhy">${esc(i.why)}</p>` : i.score < 0 ? `<p class="rwhy">Not scored yet. Claude scores it on the next morning scan.</p>` : ""}
        ${i.angle ? `<p class="ridea"><b>Campaign idea:</b> ${esc(i.angle)}</p>` : ""}
        ${i.sectors.length ? `<div>${i.sectors.map(s => `<span class="tg">${esc(s)}</span>`).join("")}</div>` : ""}</div>
        <div class="racts">${acts}</div></article>`;
    }).join("");
  }
  segBind($("rShow"), v => { rShow = v; drawRadar(); });
  $("rVendor").onchange = () => drawRadar();
  $("rQ").oninput = () => drawRadar();
  $("rList").addEventListener("click", async e => {
    const d = e.target.closest("[data-draft]"), x = e.target.closest("[data-dis]"), so = e.target.closest("[data-soc]");
    if (so) {
      busy(so, true, "Claude is writing… about 30 seconds");
      try { const r = await api("POST", `radar/items/${so.dataset.soc}/social`); toast(r.existing ? "A social post already exists. Opening it." : "Social post drafted. Review it before approving."); location.hash = "#post/" + r.id; }
      catch (er) { toast(er.message, true); busy(so, false); }
    }
    if (d) {
      busy(d, true, "Claude is writing… about 30 seconds");
      try { const r = await api("POST", `radar/items/${d.dataset.draft}/draft`); toast(r.existing ? "A draft already exists. Opening it." : "Campaign drafted. Review it before scheduling."); location.hash = "#edit/" + r.id; }
      catch (er) { toast(er.message, true); busy(d, false); }
    }
    if (x) {
      try { await api("POST", `radar/items/${x.dataset.dis}/dismiss`); const it = RAD.items.find(i => i.id === x.dataset.dis); if (it) it.status = "dismissed"; drawRadar(); toast("Dismissed."); }
      catch (er) { toast(er.message, true); }
    }
  });
  function openRadarSettings() {
    const S = RAD.settings;
    const grp = (title, own) => `<div class="vgroup ${own ? "own" : ""}"><h4>${title}</h4><div class="vl">${RAD.vendors.filter(v => v.own === own).map(v => `<label title="${esc(v.source)}"><input type="checkbox" data-v="${esc(v.key)}"${S.vendors[v.key] ? " checked" : ""}> ${esc(v.name)}${v.source === "News search" ? "<span>news search</span>" : ""}</label>`).join("")}</div></div>`;
    $("radVendors").innerHTML = grp("Our partners", true) + grp("Sister company portfolio (cross-sell)", false);
    $("radSectors").innerHTML = RAD.sectors.map(s => `<button type="button" data-s="${esc(s)}" aria-pressed="${S.sectors.includes(s)}">${esc(s)}</button>`).join("");
    $("radMin").innerHTML = [5, 6, 7, 8, 9, 10].map(n => `<option value="${n}"${n === S.minScore ? " selected" : ""}>${n} out of 10${n === 7 ? " (recommended)" : ""}</option>`).join("");
    $("radMax").innerHTML = [0, 1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === S.maxDrafts ? " selected" : ""}>${n === 0 ? "None (only list the news)" : n}</option>`).join("");
    $("radOwner").value = S.owner || ""; $("radNews").checked = !!S.news; $("radErr").textContent = "";
    $("radDlg").showModal();
  }
  $("radSectors").addEventListener("click", e => { const b = e.target.closest("button[data-s]"); if (b) b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); });
  $("radForm").onsubmit = async e => {
    e.preventDefault(); $("radErr").textContent = "";
    const vendors = {}; $("radVendors").querySelectorAll("input[data-v]").forEach(c => { vendors[c.dataset.v] = c.checked; });
    const sectors = [...$("radSectors").querySelectorAll('button[aria-pressed="true"]')].map(b => b.dataset.s);
    if (!Object.values(vendors).some(Boolean)) { $("radErr").textContent = "Keep at least one vendor switched on."; return; }
    if (!sectors.length) { $("radErr").textContent = "Choose at least one sector."; return; }
    busy($("radGo"), true, "Saving…");
    try { RAD.settings = await api("PUT", "radar/settings", { vendors, sectors, minScore: Number($("radMin").value), maxDrafts: Number($("radMax").value), owner: $("radOwner").value.trim(), news: $("radNews").checked }); $("radDlg").close(); drawRadarHead(); drawRadar(); toast("Settings saved. They apply from the next morning scan."); }
    catch (er) { $("radErr").textContent = er.message; } finally { busy($("radGo"), false); }
  };

  // ---------- Social posts (src/social.js): drafted per network, approved by a manager, published from here ----------
  let SOC = null, sShow = "todo", PO = null, pNet = "linkedin", pvNet = "linkedin";
  const NETL = { linkedin: "LinkedIn", facebook: "Facebook", instagram: "Instagram", x: "X", google: "Google Business" };
  const NETS = ["linkedin", "facebook", "instagram", "x", "google"];
  const NETMAX = { linkedin: 3000, facebook: 5000, instagram: 2200, x: 280, google: 1500 };
  const NETTIP = {
    linkedin: "LinkedIn: hook, short paragraphs, • bullets, call to action, 5 to 7 hashtags. Only the first 2 to 3 lines show before \"see more\".",
    facebook: "Facebook: short, with the link written out. 4 to 6 hashtags.",
    instagram: "Instagram: links don't work in captions, so say \"link in bio\". 6 to 8 hashtags. The first line shows before \"more\".",
    x: "X: 280 characters at most. Links cost extra on X's API, so leave them out.",
    google: "Google Business: no hashtags or phone numbers (Google rejects them). The link becomes a Learn more button.",
  };
  const SST = { draft: "Draft", approval: "Awaiting approval", scheduled: "Scheduled", posting: "Posting", posted: "Posted", partial: "Partly posted", failed: "Failed", cancelled: "Cancelled" };
  const schip = s => `<span class="stchip ${esc(s === "posted" ? "sent" : s === "posting" ? "sending" : s === "partial" ? "approval" : s)}">${esc(SST[s] || s)}</span>`;
  const netIcon = n => `<span class="nicon n-${n}" title="${esc(NETL[n])}">${{ linkedin: "in", facebook: "f", instagram: "◎", x: "𝕏", google: "G" }[n]}</span>`;

  async function loadSoc() { SOC = await api("GET", "social"); return SOC; }
  async function showSocial(sub, arg) {
    $("v-social").hidden = false;
    $("pageSub").textContent = "Updates for LinkedIn, Facebook, Instagram, X and Google, drafted by Claude from Trend Radar or your brief, approved by a manager and posted from here.";
    headActs(BOOT.readOnly ? "" : `<button class="primary" type="button" id="spNewBtn">+ New post</button>`);
    if ($("spNewBtn")) $("spNewBtn").onclick = openSpNew;
    $("sList").innerHTML = `<div class="empty">Loading posts…</div>`;
    try { await loadSoc(); } catch (e) { $("sList").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    drawSocHead(); drawSocList();
    if (sub === "connected") { toast(`Connected: ${decodeURIComponent(arg || "")}.`); history.replaceState(null, "", "#social"); openSocSettings(); }
    if (sub === "error") { socConnErr = decodeURIComponent(arg || "The connection didn't work."); history.replaceState(null, "", "#social"); openSocSettings(); }
    if (sub === "pick") { history.replaceState(null, "", "#social"); openSocSettings(); }
    if (sub === "settings") { history.replaceState(null, "", "#social"); openSocSettings(); }
  }
  function drawSocHead() {
    const C = SOC.connected;
    const chips = NETS.map(n => `<span class="acchip ${C[n] ? (C[n].status === "error" ? "err" : "on") : ""}">${netIcon(n)}${C[n] ? esc(C[n].name || NETL[n]) : esc(NETL[n]) + " · not connected"}</span>`).join("");
    const none = !Object.keys(C).length;
    $("sHead").innerHTML = `<div class="rh-t"><div class="acchips">${chips}</div>
      <div style="margin-top:8px">${none ? `<b>No accounts connected yet.</b> Drafts are ready to review now; they can be posted once a manager connects the accounts.` : `Next free posting slot: <b>${esc(fdt(SOC.next))}</b> (UAE time).`}
      Trend Radar drafts <b>${SOC.settings.perDay}</b> social post${SOC.settings.perDay === 1 ? "" : "s"} a morning.</div></div>
      <div class="rh-a">${SOC.isManager && !BOOT.readOnly ? `<button type="button" id="socSet">Accounts and settings</button>` : ""}</div>`;
    if ($("socSet")) $("socSet").onclick = openSocSettings;
  }
  function drawSocList() {
    const q = $("sQ").value.trim().toLowerCase();
    const list = SOC.posts.filter(p => (sShow === "all" || (sShow === "todo" ? ["draft", "approval", "failed", "partial"].includes(p.status) : sShow === "scheduled" ? ["scheduled", "posting"].includes(p.status) : p.status === "posted")) &&
      (!q || (p.title + " " + Object.values(p.texts).join(" ")).toLowerCase().includes(q)));
    $("sCnt").textContent = `${num(list.length)} post${list.length === 1 ? "" : "s"}`;
    if (!list.length) { $("sList").innerHTML = `<div class="panel empty">${SOC.posts.length ? "Nothing here." : "<b>No social posts yet.</b><br>Trend Radar drafts them every morning, or start one with <b>+ New post</b>."}</div>`; return; }
    $("sList").innerHTML = list.map(p => {
      const first = String(p.texts.linkedin || p.texts.facebook || Object.values(p.texts)[0] || "").split("\n").find(Boolean) || "";
      const res = p.nets.map(n => { const r = p.results[n]; const st = r ? r.status : ""; return `<span class="nres ${esc(st)}" title="${esc(NETL[n] + (r && r.error ? ": " + r.error : st ? ": " + st : ""))}">${netIcon(n)}</span>`; }).join("");
      const when = p.status === "posted" || p.status === "partial" ? "Posted " + fdt(p.postedAt) : p.scheduledAt ? (p.status === "draft" ? "Planned " : "") + fdt(p.scheduledAt) : "Not scheduled";
      return `<button type="button" class="scard" data-id="${esc(p.id)}"><span class="sthumb"${p.image ? ` style="background-image:url('${esc(p.image)}')"` : ""}>${p.image ? "" : "No image"}</span>
        <span class="sbody"><span class="st">${esc(p.title)} ${schip(p.status)}${p.source === "radar" ? `<span class="ochip">Trend Radar</span>` : ""}</span>
        <span class="sx">${esc(first)}</span>
        <span class="sm"><span class="nrow">${res}</span><span>${esc(when)}</span>${p.requestedBy && p.status === "approval" ? `<span>from ${esc(firstName(p.requestedBy))}</span>` : ""}</span></span></button>`;
    }).join("");
  }
  segBind($("sShow"), v => { sShow = v; drawSocList(); });
  $("sQ").oninput = () => drawSocList();
  $("sList").addEventListener("click", e => { const c = e.target.closest(".scard"); if (c) location.hash = "#post/" + c.dataset.id; });

  // new post
  function openSpNew() { seg($("spMode"), "ai"); $("spAi").hidden = false; $("spErr").textContent = ""; $("spGo").innerHTML = "✦ Write post"; $("spNew").showModal(); $("spBrief").focus(); }
  segBind($("spMode"), v => { $("spAi").hidden = v !== "ai"; $("spGo").innerHTML = v === "ai" ? "✦ Write post" : "Create post"; });
  $("spNewForm").onsubmit = async e => {
    e.preventDefault(); $("spErr").textContent = "";
    const ai = segVal($("spMode")) === "ai";
    if (ai && !$("spBrief").value.trim()) { $("spErr").textContent = "Describe what the post should be about."; return; }
    busy($("spGo"), true, ai ? "Claude is writing… about 30 seconds" : "Creating…");
    try { const p = await api("POST", "social/new", ai ? { kind: "ai", brief: $("spBrief").value, link: $("spLink").value.trim() } : { kind: "blank" }); $("spNew").close(); $("spBrief").value = ""; location.hash = "#post/" + p.id; }
    catch (er) { $("spErr").textContent = er.message; } finally { busy($("spGo"), false); }
  };

  // settings and accounts
  let socConnErr = "";
  function openSocSettings() {
    if (!SOC || !SOC.isManager) return;
    const S = SOC.settings, C = SOC.connected;
    const errBox = socConnErr ? `<div class="connerr"><b>The last connection didn't work.</b> ${esc(socConnErr)}</div>` : "";
    socConnErr = "";
    $("socAccts").innerHTML = errBox + Object.entries(SOC.apps).map(([k, a]) => {
      const conn = a.nets.filter(n => C[n]);
      const pk = SOC.picks[k];
      return `<div class="acct"><div class="an">${a.nets.map(netIcon).join("")}<div><b>${esc(a.label)}</b>
        <div class="hint">${conn.length ? conn.map(n => `${esc(NETL[n])}: ${esc(C[n].name)}${C[n].status === "error" ? ` <span class="neg">needs reconnecting (${esc(C[n].error)})</span>` : ""}`).join("<br>") : a.ready ? "Not connected" : `Not set up: the ${esc(a.label)} app keys aren't in the site settings yet.`}${k === "meta" && C.facebook && !C.instagram ? `<br><span class="neg">No Instagram business account is linked to this Facebook Page.</span>` : ""}</div>
        <div class="hint redir">Return address to register: <code>${esc(a.redirect)}</code></div>${pk ? `<div class="pick"><span class="hint">Choose the page for this company:</span>${pk.map(x => `<button type="button" data-pick="${esc(k)}" data-id="${esc(x.id)}">${esc(x.name)}${x.extra ? ` <span class="hint">${esc(x.extra)}</span>` : ""}</button>`).join("")}</div>` : ""}</div></div>
        <div class="aa">${a.ready ? `<button type="button" data-conn="${esc(k)}">${conn.length ? "Reconnect" : "Connect"}</button>` : ""}${conn.length ? `<button type="button" data-disc="${esc(conn.join(","))}">Disconnect</button>` : ""}</div></div>`;
    }).join("");
    drawSlots(S.slots.map(x => ({ ...x })));
    $("socNets").innerHTML = NETS.map(n => `<button type="button" data-n="${n}" aria-pressed="${S.nets.includes(n)}">${esc(NETL[n])}</button>`).join("");
    $("socCta").value = S.cta || ""; $("socWa").value = S.whatsapp || ""; $("socTags").value = S.hashtags || ""; $("socPer").value = String(S.autoDraft ? S.perDay : 0); $("socErr").textContent = "";
    if (!$("socDlg").open) $("socDlg").showModal();
  }
  let SLOTS = [];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function drawSlots(list) {
    if (list) SLOTS = list;
    $("socSlots").innerHTML = SLOTS.map((s, i) => `<span class="slot"><select data-sd="${i}" aria-label="Day">${DAYS.map(d => `<option${d === s.d ? " selected" : ""}>${d}</option>`).join("")}</select><input type="time" step="900" data-st="${i}" value="${esc(s.t)}" aria-label="Time"><button type="button" class="x" data-sx="${i}" aria-label="Remove">×</button></span>`).join("");
  }
  $("socSlots").addEventListener("change", e => { const d = e.target.dataset.sd, t = e.target.dataset.st; if (d != null) SLOTS[d].d = e.target.value; if (t != null) SLOTS[t].t = e.target.value; });
  $("socSlots").addEventListener("click", e => { const x = e.target.closest("[data-sx]"); if (x) { SLOTS.splice(Number(x.dataset.sx), 1); drawSlots(); } });
  $("socAddSlot").onclick = () => { SLOTS.push({ d: "Tue", t: "09:30" }); drawSlots(); };
  $("socNets").addEventListener("click", e => { const b = e.target.closest("button[data-n]"); if (b) b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); });
  $("socAccts").addEventListener("click", async e => {
    const c = e.target.closest("[data-conn]"), d = e.target.closest("[data-disc]"), p = e.target.closest("[data-pick]");
    if (c) { busy(c, true, "Opening…"); try { const r = await api("POST", "social/connect/" + c.dataset.conn); location.href = r.url; } catch (er) { toast(er.message, true); busy(c, false); } }
    if (d) { if (!confirm("Disconnect? Scheduled posts for this network will fail until it's connected again.")) return; try { for (const n of d.dataset.disc.split(",")) await api("DELETE", "social/accounts/" + n); await loadSoc(); drawSocHead(); openSocSettings(); toast("Disconnected."); } catch (er) { toast(er.message, true); } }
    if (p) { try { const r = await api("POST", `social/accounts/${p.dataset.pick}/pick`, { id: p.dataset.id }); await loadSoc(); drawSocHead(); openSocSettings(); toast(`Connected: ${r.name}.`); } catch (er) { toast(er.message, true); } }
  });
  $("socForm").onsubmit = async e => {
    e.preventDefault(); $("socErr").textContent = "";
    const nets = [...$("socNets").querySelectorAll('button[aria-pressed="true"]')].map(b => b.dataset.n);
    if (!SLOTS.length) { $("socErr").textContent = "Add at least one posting time."; return; }
    busy($("socGo"), true, "Saving…");
    try { const per = Number($("socPer").value); SOC.settings = await api("PUT", "social/settings", { slots: SLOTS, nets, cta: $("socCta").value.trim(), whatsapp: $("socWa").value.trim(), hashtags: $("socTags").value.trim(), perDay: per, autoDraft: per > 0 }); $("socDlg").close(); await loadSoc(); drawSocHead(); drawSocList(); toast("Social settings saved."); }
    catch (er) { $("socErr").textContent = er.message; } finally { busy($("socGo"), false); }
  };

  // ---------- post editor ----------
  async function openPost(id) {
    $("v-post").hidden = false;
    let p;
    try { [p] = await Promise.all([api("GET", "social/" + id), SOC ? null : loadSoc()]); } catch (e) { toast(e.message, true); location.hash = "#social"; return; }
    PO = { p, dirty: false, timer: null, saving: null };
    pNet = p.nets[0] || "linkedin"; pvNet = pNet;
    $("pTitle").value = p.title; $("pLink").value = p.link;
    $("cKick").value = p.card.kicker || ""; $("cHead").value = p.card.headline || ""; $("cSub").value = p.card.sub || "";
    $("cLayout").innerHTML = ["navy", "light", "split", "bold"].map(l => `<button type="button" data-v="${l}" aria-pressed="${l === (p.card.layout || "navy")}">${{ navy: "Classic", light: "Light", split: "Split", bold: "Bold" }[l]}</button>`).join("");
    const tr = p.trend; $("pTrend").hidden = !tr;
    if (tr) $("pTrend").innerHTML = `<div><b>Drafted by Trend Radar</b> from ${esc(tr.vendorName)} news: <a href="${esc(tr.link)}" target="_blank" rel="noopener">${esc(tr.title)}</a>. Check every fact against the source before approving.</div>`;
    drawPost(); $("pSaved").textContent = "Saved";
  }
  const editable = () => PO && ["draft", "approval", "scheduled"].includes(PO.p.status) && !BOOT.readOnly;
  function drawPost() {
    const p = PO.p, st = p.status, mgr = BOOT.isManager, ed = editable();
    $("pStatus").outerHTML = `<span id="pStatus">${schip(st)}</span>`;
    $("pNets").innerHTML = NETS.map(n => { const c = SOC.connected[n]; return `<label class="netck${c ? "" : " off"}"><input type="checkbox" data-net="${n}"${p.nets.includes(n) ? " checked" : ""}${ed ? "" : " disabled"}> ${netIcon(n)} ${esc(NETL[n])}<span class="hint">${c ? esc(c.name) : "not connected"}</span></label>`; }).join("");
    $("pImg").innerHTML = p.image ? `<img src="${esc(p.image)}" alt="Post image">` : `<div class="empty">No image yet. Make a card or choose an image.</div>`;
    [$("pTitle"), $("pLink"), $("pText"), $("cKick"), $("cHead"), $("cSub")].forEach(x => { x.disabled = !ed; });
    ["pPick", "pNoImg", "cMake"].forEach(k => { $(k).disabled = !ed; });
    $("pNoImg").hidden = !p.image;
    drawTabs(); drawPreview();
    $("pSched").hidden = !ed || (mgr && st === "approval");
    $("pSched").textContent = mgr ? (st === "scheduled" ? "Reschedule" : "Schedule") : st === "draft" ? "Send for approval" : "Change requested time";
    $("pApprove").hidden = !(mgr && st === "approval" && !BOOT.readOnly);
    $("pReject").hidden = !(mgr && st === "approval" && !BOOT.readOnly);
    $("pNow").hidden = !(mgr && !BOOT.readOnly && ["draft", "approval", "scheduled", "failed", "partial"].includes(st));
    $("pNow").textContent = ["failed", "partial"].includes(st) ? "Retry now" : "Post now";
    $("pDel").hidden = BOOT.readOnly || st === "posting"; $("pDup").hidden = BOOT.readOnly;
    const note = st === "approval" ? (mgr ? `${esc(firstName(p.requestedBy || p.createdBy))} asked to post this on ${esc(fdt(p.scheduledAt))}. Check it, then approve or return it to draft. Nothing is posted until you approve.` : "Waiting for a manager's approval. Nothing is posted until a manager approves it.")
      : st === "scheduled" ? `Approved${p.approvedBy ? " by " + esc(firstName(p.approvedBy)) : ""}. Posts on <b>${esc(fdt(p.scheduledAt))}</b> (UAE time).${mgr ? "" : " If you change it, it goes back to a manager."}`
      : st === "draft" && /^Returned/.test(p.lastNote) ? esc(p.lastNote) : st === "draft" && p.scheduledAt ? `Planned for ${esc(fdt(p.scheduledAt))}. Schedule it or send it for approval when it's ready.` : "";
    $("pNote").hidden = !note; $("pNote").innerHTML = note;
    const r = p.results, keys = Object.keys(r);
    $("pRes").hidden = !keys.length;
    $("pRes").innerHTML = keys.length ? `<h3 class="ph">Posting results</h3>` + keys.map(n => `<div class="resrow">${netIcon(n)}<b>${esc(NETL[n])}</b> ${r[n].status === "posted" ? `<span class="pos">Posted</span>${r[n].url ? ` · <a href="${esc(r[n].url)}" target="_blank" rel="noopener">View post</a>` : ""}${r[n].note ? `<div class="hint">${esc(r[n].note)}</div>` : ""}` : r[n].status === "pending" ? `<span class="hint">Instagram is still processing the image; it finishes on the next check.</span>` : `<span class="neg">Failed: ${esc(r[n].error || "")}</span>`}<span class="hint"> ${esc(fdt(r[n].at))}</span></div>`).join("") : "";
  }
  function drawTabs() {
    const p = PO.p;
    const tab = (n, cur) => `<button type="button" role="tab" data-n="${n}" aria-selected="${n === cur}" class="${p.nets.includes(n) ? "" : "dim"}">${netIcon(n)} ${esc(NETL[n])}</button>`;
    $("pTabs").innerHTML = NETS.map(n => tab(n, pNet)).join("");
    $("pvTabs").innerHTML = NETS.filter(n => p.nets.includes(n)).map(n => tab(n, pvNet)).join("") || `<span class="hint">Choose a network.</span>`;
    $("pText").value = p.texts[pNet] || ""; $("pTip").textContent = NETTIP[pNet];
    count();
  }
  function count() {
    const t = $("pText").value, max = NETMAX[pNet];
    const len = pNet === "x" ? t.replace(/https?:\/\/\S+/g, "x".repeat(23)).length : t.length;
    $("pCount").innerHTML = `<span class="${len > max ? "neg" : ""}">${num(len)} / ${num(max)}</span>`;
  }
  $("pTabs").addEventListener("click", e => { const b = e.target.closest("button[data-n]"); if (!b) return; pNet = b.dataset.n; if (PO.p.nets.includes(pNet)) pvNet = pNet; drawTabs(); drawPreview(); });
  $("pvTabs").addEventListener("click", e => { const b = e.target.closest("button[data-n]"); if (!b) return; pvNet = b.dataset.n; drawTabs(); drawPreview(); });
  function pChanged() { PO.dirty = true; $("pSaved").textContent = "Unsaved changes"; clearTimeout(PO.timer); PO.timer = setTimeout(savePost, 1500); drawPreview(); }
  $("pText").oninput = () => { PO.p.texts[pNet] = $("pText").value; count(); pChanged(); };
  $("pTitle").oninput = () => { PO.p.title = $("pTitle").value; pChanged(); };
  $("pLink").oninput = () => { PO.p.link = $("pLink").value.trim(); pChanged(); };
  ["cKick", "cHead", "cSub"].forEach(k => { $(k).oninput = () => { PO.p.card = { ...PO.p.card, kicker: $("cKick").value, headline: $("cHead").value, sub: $("cSub").value }; pChanged(); }; });
  $("pNets").addEventListener("change", e => { const n = e.target.dataset.net; if (!n) return; const s = new Set(PO.p.nets); e.target.checked ? s.add(n) : s.delete(n); PO.p.nets = NETS.filter(x => s.has(x)); if (!PO.p.nets.includes(pvNet)) pvNet = PO.p.nets[0] || pNet; drawTabs(); pChanged(); });
  segBind($("cLayout"), v => { PO.p.card = { ...PO.p.card, layout: v }; });
  async function savePost() {
    if (!PO || !PO.dirty || !editable()) return;
    if (PO.saving) { await PO.saving.catch(() => {}); if (!PO || !PO.dirty) return; }
    const po = PO; po.dirty = false; $("pSaved").textContent = "Saving…";
    const p = po.p;
    po.saving = api("PUT", "social/" + p.id, { title: p.title, nets: p.nets, texts: p.texts, link: p.link, image: p.image, card: { ...p.card, layout: segVal($("cLayout")) || p.card.layout }, etag: p.etag })
      .then(r => { po.p.etag = r.etag; if (r.status !== po.p.status) { po.p.status = r.status; if (PO === po) drawPost(); } if (PO === po) $("pSaved").textContent = po.dirty ? "Unsaved changes" : "Saved " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); })
      .catch(e => { po.dirty = true; if (PO === po) $("pSaved").textContent = "Not saved"; toast(e.message, true); throw e; })
      .finally(() => { po.saving = null; });
    return po.saving;
  }
  async function flushPost() { if (!PO) return; clearTimeout(PO.timer); try { if (PO.saving) await PO.saving; if (PO.dirty) await savePost(); } catch {} }
  const takePost = r => { const keepNet = pNet; PO.p = r; pNet = keepNet; drawPost(); };
  $("cMake").onclick = async () => {
    await flushPost(); busy($("cMake"), true, "Drawing…");
    try { takePost(await api("POST", `social/${PO.p.id}/card`, { kicker: $("cKick").value, headline: $("cHead").value, sub: $("cSub").value, layout: segVal($("cLayout")) })); toast("New card ready."); }
    catch (e) { toast(e.message, true); } finally { busy($("cMake"), false); }
  };
  $("pPick").onclick = () => pickImage(u => { PO.p.image = u; drawPost(); pChanged(); });
  $("pNoImg").onclick = () => { PO.p.image = ""; drawPost(); pChanged(); };
  const pAct = async (act, body, msg) => { await flushPost(); try { const r = await api("POST", `social/${PO.p.id}/${act}`, body || {}); takePost(r); if (msg) toast(typeof msg === "function" ? msg(r) : msg); return r; } catch (e) { toast(e.message, true); } };
  $("pApprove").onclick = () => { if (confirm(`Approve "${PO.p.title}"? It posts on ${fdt(Date.parse(PO.p.scheduledAt) > Date.now() ? PO.p.scheduledAt : SOC.next)} (UAE time).`)) pAct("approve", {}, r => `Approved. It posts on ${fdt(r.scheduledAt)}.`); };
  $("pReject").onclick = () => { const reason = prompt("Why is it going back? (shown to the person who prepared it)", ""); if (reason !== null) pAct("reject", { reason }, "Returned to draft. Nothing was posted."); };
  $("pNow").onclick = async () => {
    const retry = ["failed", "partial"].includes(PO.p.status);
    if (!confirm(retry ? "Try the networks that failed again now?" : `Post "${PO.p.title}" to ${PO.p.nets.map(n => NETL[n]).join(", ")} now?`)) return;
    busy($("pNow"), true, "Posting…");
    try { await pAct(retry ? "retry" : "postnow", {}, r => r.status === "posted" ? "Posted everywhere." : r.status === "partial" ? "Posted, but some networks failed. See the results." : r.status === "posting" ? "Posting. Some networks finish in a few minutes." : "Posting failed. See the results."); }
    finally { busy($("pNow"), false); }
  };
  $("pDup").onclick = async () => { await flushPost(); try { const r = await api("POST", `social/${PO.p.id}/duplicate`); location.hash = "#post/" + r.id; } catch (e) { toast(e.message, true); } };
  $("pDel").onclick = async () => { if (!confirm(`Delete "${PO.p.title}"?${["posted", "partial"].includes(PO.p.status) ? " It stays on the networks; this only removes it from the tools." : ""}`)) return; try { await api("DELETE", "social/" + PO.p.id); PO = null; location.hash = "#social"; } catch (e) { toast(e.message, true); } };
  $("pSched").onclick = async () => {
    await flushPost();
    const p = PO.p, has = ["scheduled", "approval"].includes(p.status) || p.scheduledAt;
    const at = new Date(has && Date.parse(p.scheduledAt) > Date.now() ? p.scheduledAt : SOC.next);
    const d = dubaiParts(at); $("pDate").value = d.date; $("pTime").value = d.time; $("pDate").min = dubaiParts(new Date()).date;
    $("pSlotHint").textContent = `Your posting times: ${SOC.settings.slots.map(s => s.d + " " + s.t).join(", ")}. The next free one is filled in.`;
    $("pSchedSum").innerHTML = `<div>To: ${esc(p.nets.map(n => NETL[n]).join(", ") || "no network chosen")}</div>${p.nets.filter(n => !SOC.connected[n]).length ? `<div class="neg">Not connected yet: ${esc(p.nets.filter(n => !SOC.connected[n]).map(n => NETL[n]).join(", "))}. Those will fail unless a manager connects them first.</div>` : ""}${BOOT.isManager ? "" : `<div><b>A manager must approve this post before it goes out.</b></div>`}`;
    $("pSchedT").textContent = BOOT.isManager ? "Schedule this post" : "Send for approval"; $("pSchedGo").textContent = BOOT.isManager ? "Schedule" : "Send for approval"; $("pSchedErr").textContent = "";
    $("pSchedDlg").showModal();
  };
  $("pSchedForm").onsubmit = async e => {
    e.preventDefault(); $("pSchedErr").textContent = "";
    if (!$("pDate").value || !$("pTime").value) { $("pSchedErr").textContent = "Pick a date and time."; return; }
    const at = new Date(`${$("pDate").value}T${$("pTime").value}:00+04:00`).toISOString();
    busy($("pSchedGo"), true, "Saving…");
    try { await flushPost(); const r = await api("POST", `social/${PO.p.id}/schedule`, { at }); takePost(r); $("pSchedDlg").close(); toast(r.status === "approval" ? "Sent to a manager for approval." : `Scheduled for ${fdt(r.scheduledAt)} (UAE time).`); }
    catch (er) { $("pSchedErr").textContent = er.message; } finally { busy($("pSchedGo"), false); }
  };

  // previews: close to how each network shows a post
  function drawPreview() {
    if (!PO) return;
    const p = PO.p, n = pvNet;
    if (!p.nets.includes(n)) { $("pPrev").innerHTML = `<div class="empty">Choose at least one network.</div>`; return; }
    const acc = SOC.connected[n], name = (acc && acc.name) || BOOT.brand.name, logo = `/email/${BOOT.co}.png`;
    const raw = String(p.texts[n] || ""), cut = { linkedin: 210, instagram: 125, facebook: 480 }[n];
    const fmt = s => esc(s).replace(/(#\w+)/g, '<span class="hl">$1</span>').replace(/(https?:\/\/[^\s<]+)/g, '<span class="hl">$1</span>').replace(/\n/g, "<br>");
    const body = cut && raw.length > cut ? `${fmt(raw.slice(0, cut))}<span class="more">… see more</span><details><summary>Show full text</summary>${fmt(raw.slice(cut))}</details>` : fmt(raw);
    const img = p.image ? `<img class="pi" src="${esc(p.image)}" alt="">` : n === "instagram" ? `<div class="pi empty">Instagram needs an image</div>` : "";
    const head = sub => `<div class="ph2"><img src="${esc(logo)}" alt=""><div><b>${esc(name)}</b><span>${sub}</span></div></div>`;
    let h;
    if (n === "instagram") h = `<div class="mock ig">${head("")}${img}<div class="ig-acts">♡ 💬 ↗</div><div class="pt"><b>${esc((acc && acc.name || "").replace(/^@/, "") || "yourbrand")}</b> ${body}</div></div>`;
    else if (n === "x") h = `<div class="mock x"><div class="xr"><img src="${esc(logo)}" alt=""><div><div><b>${esc(BOOT.brand.name)}</b> <span class="hint">${esc((acc && acc.name) || "@handle")} · now</span></div><div class="pt">${fmt(raw)}</div>${img}</div></div></div>`;
    else if (n === "google") h = `<div class="mock gb">${img}<div class="pt">${fmt(raw)}</div>${p.link ? `<div class="gbtn">Learn more</div>` : ""}<div class="hint">${esc(name)} · Google Business Profile update</div></div>`;
    else h = `<div class="mock ${n}">${head(n === "linkedin" ? "Company page · now" : "Just now · 🌐")}<div class="pt">${body}</div>${img}<div class="li-acts">${n === "linkedin" ? "Like · Comment · Repost · Send" : "Like · Comment · Share"}</div></div>`;
    $("pPrev").innerHTML = h;
  }

  // ---------- contacts ----------
  let kPage = 0, kTag = "", sel = new Set();
  async function showContacts(force) {
    $("v-contacts").hidden = false;
    $("pageSub").textContent = "Everyone you can email, grouped into lists. People who unsubscribe are never emailed again, even if they are imported later.";
    headActs(BOOT.readOnly ? `<button type="button" id="kExp">Export CSV</button>` : `<button type="button" id="kExp">Export CSV</button><button type="button" id="kAdd">+ Add contact</button><button class="primary" type="button" id="kImp">Import CSV</button>`);
    $("kExp").onclick = exportCsv; if ($("kAdd")) { $("kAdd").onclick = () => editContact(null); $("kImp").onclick = openImport; }
    if (!CONTACTS || force) { $("kEmpty").hidden = false; $("kEmpty").textContent = "Loading contacts…"; $("kRows").innerHTML = ""; try { CONTACTS = await api("GET", "contacts"); } catch (e) { $("kEmpty").textContent = e.message; return; } }
    drawLists(); drawContacts();
  }
  function tagCounts() { const m = {}; CONTACTS.forEach(c => c.tags.forEach(t => { m[t] = (m[t] || 0) + 1; })); return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0])); }
  function drawLists() {
    const tc = tagCounts(); const none = CONTACTS.filter(c => !c.tags.length).length;
    $("lists").innerHTML = `<button type="button" data-t="" aria-pressed="${!kTag}">All contacts<em>${num(CONTACTS.length)}</em></button>` + tc.map(([t, n]) => `<button type="button" data-t="${esc(t)}" aria-pressed="${kTag === t}">${esc(t)}<em>${num(n)}</em></button>`).join("") + (none ? `<button type="button" data-t="\u0000" aria-pressed="${kTag === "\u0000"}">Not in a list<em>${num(none)}</em></button>` : "");
    $("kList").innerHTML = `<option value="">All lists</option>` + tc.map(([t]) => `<option value="${esc(t)}">${esc(t)}</option>`).join("") + (none ? `<option value="\u0000">Not in a list</option>` : "");
    $("kList").value = kTag;
    $("tagOpts").innerHTML = tc.map(([t]) => `<option value="${esc(t)}">`).join("");
  }
  function filtered() {
    const q = $("kQ").value.trim().toLowerCase(), st = $("kSt").value;
    return CONTACTS.filter(c => (!st || c.status === st || (st === "unsubscribed" && c.status === "bounced")) && (!kTag || (kTag === "\u0000" ? !c.tags.length : c.tags.includes(kTag))) && (!q || (c.email + " " + c.firstName + " " + c.lastName + " " + c.company).toLowerCase().includes(q)));
  }
  const PER = 100;
  function drawContacts() {
    const list = filtered(); const pages = Math.max(1, Math.ceil(list.length / PER)); kPage = Math.min(kPage, pages - 1);
    const rows = list.slice(kPage * PER, kPage * PER + PER);
    $("kCnt").textContent = `${num(list.length)} contact${list.length === 1 ? "" : "s"}`;
    $("kEmpty").hidden = !!rows.length; $("kEmpty").innerHTML = CONTACTS.length ? "No contacts match." : `<b>No contacts yet.</b><br>Import a CSV with an email column to get started.`;
    $("kRows").innerHTML = rows.map(c => `<tr data-k="${esc(c.key)}"><td class="ck"><input type="checkbox" data-ck${sel.has(c.key) ? " checked" : ""} aria-label="Select ${esc(c.email)}"></td><td><b>${esc(c.email)}</b></td><td>${esc([c.firstName, c.lastName].filter(Boolean).join(" "))}</td><td>${esc(c.company)}</td><td>${c.tags.map(t => `<span class="tg">${esc(t)}</span>`).join("")}</td><td>${chip(c.status).replace(/>(\w+)</, (m, s) => ">" + ({ subscribed: "Subscribed", unsubscribed: "Unsubscribed", bounced: "Bounced" }[c.status] || s) + "<")}</td><td class="muted" style="font-size:12px">${esc(fd(c.createdAt || c.unsubscribedAt))}</td></tr>`).join("");
    $("kAll").checked = rows.length > 0 && rows.every(c => sel.has(c.key));
    $("kPager").innerHTML = pages > 1 ? `<span>Page ${kPage + 1} of ${pages}</span><span style="display:flex;gap:6px"><button type="button" data-p="-1"${kPage ? "" : " disabled"}>Previous</button><button type="button" data-p="1"${kPage < pages - 1 ? "" : " disabled"}>Next</button></span>` : "";
    drawBulk(list);
  }
  function drawBulk(list) {
    $("bulk").hidden = !sel.size || BOOT.readOnly;
    const all = list || filtered();
    $("bulkN").innerHTML = `${num(sel.size)} selected${sel.size < all.length ? ` · <a href="#" id="selAll">select all ${num(all.length)}</a>` : ""}`;
    const sa = $("selAll"); if (sa) sa.onclick = e => { e.preventDefault(); all.forEach(c => sel.add(c.key)); drawContacts(); };
    $("bulk").querySelector('[data-b="delete"]').hidden = !BOOT.isManager;
  }
  $("lists").addEventListener("click", e => { const b = e.target.closest("button[data-t]"); if (!b) return; kTag = b.dataset.t; kPage = 0; drawLists(); drawContacts(); });
  $("kList").onchange = () => { kTag = $("kList").value; kPage = 0; drawLists(); drawContacts(); };
  $("kQ").oninput = () => { kPage = 0; drawContacts(); };
  $("kSt").onchange = () => { kPage = 0; drawContacts(); };
  $("kPager").addEventListener("click", e => { const b = e.target.closest("[data-p]"); if (!b) return; kPage += Number(b.dataset.p); drawContacts(); scrollTo({ top: 0, behavior: "smooth" }); });
  $("kAll").onchange = () => { const list = filtered().slice(kPage * PER, kPage * PER + PER); list.forEach(c => $("kAll").checked ? sel.add(c.key) : sel.delete(c.key)); drawContacts(); };
  $("kRows").addEventListener("click", e => {
    const tr = e.target.closest("tr[data-k]"); if (!tr) return;
    if (e.target.closest("[data-ck]")) { const k = tr.dataset.k; e.target.checked ? sel.add(k) : sel.delete(k); drawBulk(); return; }
    if (e.target.closest("td.ck")) return;
    editContact(CONTACTS.find(c => c.key === tr.dataset.k));
  });
  $("bulkX").onclick = () => { sel.clear(); drawContacts(); };
  $("bulk").addEventListener("click", async e => {
    const b = e.target.closest("[data-b]"); if (!b) return; const act = b.dataset.b; let tag = "";
    if (act === "addTag" || act === "removeTag") { tag = await ask(act === "addTag" ? "Add to a list" : "Remove from a list", "List name", act === "removeTag" && kTag && kTag !== "\u0000" ? kTag : ""); if (!tag) return; }
    if (act === "unsubscribe" && !confirm(`Unsubscribe ${num(sel.size)} contact(s)? They won't get any more campaigns.`)) return;
    if (act === "delete" && !confirm(`Delete ${num(sel.size)} contact(s) for good? To stop emailing someone, unsubscribe them instead so they can't be imported again.`)) return;
    busy(b, true, "Working…");
    try { const r = await api("POST", "contacts/bulk", { keys: [...sel], action: act, tag }); toast(`${num(r.changed)} contact(s) updated.`); sel.clear(); await showContacts(true); refreshBoot(); }
    catch (er) { toast(er.message, true); } finally { busy(b, false); }
  });

  let kEditing = null;
  function editContact(c) {
    kEditing = c;
    $("kTitle").textContent = c ? "Contact" : "Add a contact";
    $("k_email").value = c ? c.email : ""; $("k_email").disabled = !!c;
    $("k_first").value = c ? c.firstName : ""; $("k_last").value = c ? c.lastName : ""; $("k_co").value = c ? c.company : ""; $("k_tags").value = c ? c.tags.join(", ") : (kTag && kTag !== "\u0000" ? kTag : "");
    $("k_stWrap").hidden = !c; $("k_reasonWrap").hidden = true; $("k_reason").value = "";
    if (c) { $("k_st").value = c.status === "subscribed" ? "subscribed" : "unsubscribed"; $("k_stHint").textContent = c.status !== "subscribed" ? `Unsubscribed ${fd(c.unsubscribedAt)}${c.unsubVia ? " · " + c.unsubVia : ""}` : ""; }
    $("kMeta").textContent = c ? `Source: ${c.source || "unknown"}` : "";
    $("kErr").textContent = ""; $("kGo").disabled = BOOT.readOnly;
    $("kDlg").showModal();
  }
  $("k_st").onchange = () => { $("k_reasonWrap").hidden = !(kEditing && kEditing.status !== "subscribed" && $("k_st").value === "subscribed"); };
  $("kForm").onsubmit = async e => {
    e.preventDefault(); $("kErr").textContent = "";
    const body = { email: $("k_email").value.trim(), firstName: $("k_first").value, lastName: $("k_last").value, company: $("k_co").value, tags: $("k_tags").value };
    busy($("kGo"), true, "Saving…");
    try {
      if (kEditing) { const r = await api("PUT", "contacts/" + kEditing.key, { ...body, status: $("k_st").value, reason: $("k_reason").value }); Object.assign(kEditing, r); }
      else { const r = await api("POST", "contacts", body); CONTACTS.push(r); }
      $("kDlg").close(); drawLists(); drawContacts(); refreshBoot(); toast("Saved.");
    } catch (er) { $("kErr").textContent = er.message; } finally { busy($("kGo"), false); }
  };
  function exportCsv() {
    const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const rows = [["email", "first_name", "last_name", "company", "lists", "status", "unsubscribed_at", "source"]].concat(filtered().map(c => [c.email, c.firstName, c.lastName, c.company, c.tags.join("; "), c.status, c.unsubscribedAt, c.source]));
    const blob = new Blob(["﻿" + rows.map(r => r.map(q).join(",")).join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${BOOT.co}-contacts-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // CSV import
  function parseCsv(text) {
    text = text.replace(/^﻿/, "");
    const first = text.split(/\r?\n/, 1)[0] || "";
    const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(f); f = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.some(x => x.trim())) rows.push(row); row = []; }
      else f += ch;
    }
    row.push(f); if (row.some(x => x.trim())) rows.push(row);
    return rows;
  }
  let IMP = null;
  const MAP = [["email", "Email *", /^e-?mail|email address|work email|^mail$/i], ["firstName", "First name", /first|given|fname/i], ["lastName", "Last name", /last|surname|family|lname/i], ["fullName", "Full name", /^(full )?name$|contact name|^contact$/i], ["company", "Company", /company|organi[sz]ation|account( name)?$|employer/i], ["tags", "Lists", /^lists?$|tags?|segment|group/i]];
  function openImport() { IMP = null; $("impStep1").hidden = false; $("impStep2").hidden = true; $("impStep3").hidden = true; $("impErr").textContent = ""; $("impOk").checked = false; $("impProg").hidden = true; $("impDlg").showModal(); }
  $("impBack").onclick = openImport;
  $("impFile").onchange = async () => {
    const f = $("impFile").files[0]; $("impFile").value = ""; if (!f) return;
    if (f.size > 20 * 1048576) { toast("That file is over 20 MB. Split it into smaller files.", true); return; }
    const rows = parseCsv(await f.text());
    if (rows.length < 2) { toast("That file has no rows under the header.", true); return; }
    const head = rows[0].map(h => h.trim());
    IMP = { head, rows: rows.slice(1), name: f.name };
    const guess = {}; MAP.forEach(([k, , re]) => { const i = head.findIndex((h, n) => re.test(h) && !Object.values(guess).includes(n)); if (i >= 0) guess[k] = i; });
    if (guess.email == null) { const i = rows[1].findIndex(v => /@/.test(v)); if (i >= 0) guess.email = i; }
    $("impMap").innerHTML = MAP.map(([k, l]) => `<div><label class="lbl">${esc(l)}</label><select data-m="${k}"><option value="">(not in file)</option>${head.map((h, i) => `<option value="${i}"${guess[k] === i ? " selected" : ""}>${esc(h || "Column " + (i + 1))}</option>`).join("")}</select></div>`).join("");
    $("impMap").querySelectorAll("select").forEach(s => s.onchange = impPreview);
    $("impTag").value = f.name.replace(/\.(csv|txt)$/i, "").replace(/[_-]+/g, " ").slice(0, 40);
    $("impSrc").value = "";
    $("impInfo").textContent = `${f.name}: ${num(IMP.rows.length)} rows, ${head.length} columns. Check the columns below.`;
    $("impStep1").hidden = true; $("impStep2").hidden = false; impPreview();
  };
  function impMapping() { const m = {}; $("impMap").querySelectorAll("select").forEach(s => { if (s.value !== "") m[s.dataset.m] = Number(s.value); }); return m; }
  function impRow(r, m) {
    const g = k => m[k] == null ? "" : String(r[m[k]] || "").trim();
    let first = g("firstName"), last = g("lastName");
    if (!first && !last && g("fullName")) { const p = g("fullName").split(/\s+/); first = p.shift() || ""; last = p.join(" "); }
    return { email: g("email"), firstName: first, lastName: last, company: g("company"), tags: g("tags") };
  }
  function impPreview() {
    const m = impMapping();
    const sample = IMP.rows.slice(0, 5).map(r => impRow(r, m));
    $("impPrev").innerHTML = `<thead><tr><th>Email</th><th>First name</th><th>Last name</th><th>Company</th><th>Lists</th></tr></thead><tbody>${sample.map(s => `<tr><td>${esc(s.email)}</td><td>${esc(s.firstName)}</td><td>${esc(s.lastName)}</td><td>${esc(s.company)}</td><td>${esc(s.tags)}</td></tr>`).join("")}</tbody>`;
  }
  $("impGo").onclick = async () => {
    $("impErr").textContent = "";
    const m = impMapping();
    if (m.email == null) { $("impErr").textContent = "Choose which column holds the email address."; return; }
    if (!$("impOk").checked) { $("impErr").textContent = "Tick the box to confirm you may email these contacts."; return; }
    const all = IMP.rows.map(r => impRow(r, m));
    const tags = $("impTag").value.trim() ? [$("impTag").value.trim()] : [];
    const source = $("impSrc").value.trim() || `CSV import: ${IMP.name}`;
    const tot = { added: 0, updated: 0, unchanged: 0, suppressed: 0, invalid: [], duplicates: 0 };
    busy($("impGo"), true, "Importing…"); $("impProg").hidden = false;
    try {
      for (let i = 0; i < all.length; i += 1000) {
        const r = await api("POST", "contacts/import", { rows: all.slice(i, i + 1000), tags, source, offset: i });
        ["added", "updated", "unchanged", "suppressed", "duplicates"].forEach(k => { tot[k] += r[k] || 0; }); tot.invalid.push(...(r.invalid || []));
        $("impProg").firstElementChild.style.width = Math.round(Math.min(1, (i + 1000) / all.length) * 100) + "%";
      }
      $("impStep2").hidden = true; $("impStep3").hidden = false;
      $("impStep3").innerHTML = `<div class="result"><div><b>${num(tot.added)}</b><span>new contacts</span></div><div><b>${num(tot.updated)}</b><span>already here, details or lists updated</span></div><div><b>${num(tot.unchanged)}</b><span>already here, no change</span></div><div><b>${num(tot.suppressed)}</b><span>kept unsubscribed</span></div><div><b>${num(tot.invalid.length + tot.duplicates)}</b><span>skipped (no valid email or repeated)</span></div></div>
        ${tot.invalid.length ? `<details><summary>Rows without a valid email (${num(tot.invalid.length)})</summary><div class="flist">${tot.invalid.slice(0, 300).map(x => `<div>Row ${x.row}: ${esc(x.email || "(blank)")}</div>`).join("")}</div></details>` : ""}
        <div class="foot"><span></span><div class="r2"><button type="button" class="primary" data-close>Done</button></div></div>`;
      CONTACTS = null; await showContacts(true); refreshBoot();
    } catch (e) { $("impErr").textContent = e.message + (tot.added ? ` (${num(tot.added)} were added before the error.)` : ""); }
    finally { busy($("impGo"), false); }
  };

  // ---------- settings ----------
  async function showSettings() {
    const v = $("v-settings"); v.hidden = false; headActs("");
    $("pageSub").textContent = "How campaigns are sent, and what appears in every email's footer.";
    await refreshBoot();
    const s = BOOT.sending, st = BOOT.settings, mgr = BOOT.isManager && !BOOT.readOnly;
    const envName = BOOT.co === "techhub" ? "MK_SENDER_TECHHUB" : "MK_SENDER_BIFOLD";
    const li = (ok, html) => `<li><span class="d ${ok ? "ok" : ""}">${ok ? "✓" : "!"}</span><span>${html}</span></li>`;
    const soc = st.socials || {};
    v.innerHTML = `<div class="sgrid"><div style="display:grid;gap:16px">
      <div class="panel"><h3 class="ph">Sending</h3><ul class="chk">
        ${li(s.acs, s.acs ? "Azure Communication Services email is connected." : "Azure Communication Services is not connected. Add <code>ACS_CONNECTION</code> to the Static Web App settings and the GitHub secrets.")}
        ${li(!!s.sender, s.sender ? `Campaigns are sent from <b>${esc(s.sender)}</b>.` : `No sender address yet. Add <code>${envName}</code> (a verified address on your sending subdomain).`)}
        ${li(true, `Unsubscribe links and images use <b>${esc(s.publicUrl)}</b>.`)}
        ${li(s.perHour > 100, `Sending limit: <b>${num(s.perMinute)}</b> a minute, <b>${num(s.perHour)}</b> an hour (${num(s.usedLastHour)} used in the last hour).${s.perHour <= 100 ? " This is Azure's starting quota; ask Microsoft to raise it before big sends." : ""}`)}
        ${(() => {
          const runs = Object.values(s.scheduler || {}).map(r => r.at).filter(Boolean).sort();
          const last = runs[runs.length - 1]; const age = last ? (Date.now() - Date.parse(last)) / 60000 : Infinity;
          const t = s.scheduler && s.scheduler.tick && s.scheduler.tick.at;
          if (age <= 20) return li(true, `Scheduler is running: last check ${esc(rel(last))}${t ? " (site tick)" : ""}. Scheduled campaigns go out within a few minutes of their time.`);
          return li(false, `Scheduler ${last ? "last checked " + esc(rel(last)) : "has not run yet"}. ${s.tick ? "The tick address is set up but nothing is calling it." : "Add <code>MK_CRON_KEY</code> to the Static Web App settings"}, then have a scheduler (cron-job.org or an Azure Logic App) open <code>${esc(s.publicUrl)}/api/public/tick/&lt;MK_CRON_KEY&gt;</code> every 5 minutes. Without it, campaigns can go out hours late.`);
        })()}
      </ul></div>
      <div class="panel"><h3 class="ph">Claude drafting</h3><ul class="chk">${li(BOOT.ai, BOOT.ai ? "Claude is connected: Write it with Claude, subject suggestions and Improve are available." : "Not connected. Add <code>ANTHROPIC_API_KEY</code> to the Static Web App settings to turn it on.")}</ul></div>
      </div>
      <form class="panel" id="setForm" novalidate><h3 class="ph">Email footer and replies${mgr ? "" : ' <span class="muted">managers can change these</span>'}</h3>
        <div class="fields">
          <div class="full"><label class="lbl" for="s_reply">Replies go to</label><input id="s_reply" value="${esc(st.replyTo)}" placeholder="e.g. marketing@${BOOT.co === "techhub" ? "techhubrak.ae" : "bifoldtech.com"}"><div class="hint">A real mailbox someone reads. Without it, replies go to the sending address.</div></div>
          <div class="full"><label class="lbl" for="s_web">Website</label><input id="s_web" value="${esc(st.website)}"></div>
          <div class="full"><label class="lbl" for="s_addr">Postal address</label><input id="s_addr" value="${esc(st.address)}"></div>
          <div class="full"><label class="lbl" for="s_note">Why people get these emails</label><input id="s_note" value="${esc(st.footerNote)}" placeholder="You are receiving this email because you are a customer or business contact of ${esc(BOOT.brand.name)}."></div>
          ${["linkedin", "instagram", "facebook", "x", "tiktok", "youtube", "whatsapp"].map(k => `<div><label class="lbl" for="s_${k}">${esc(R.SOCIAL_NAMES[k])}</label><input id="s_${k}" value="${esc(soc[k] || "")}" placeholder="https://"></div>`).join("")}
        </div>
        <div class="err" id="sErr"></div>
        ${mgr ? `<div class="foot" style="display:flex;justify-content:flex-end;margin-top:12px"><button class="primary" type="submit" id="sGo">Save footer</button></div>` : ""}
      </form></div>`;
    if (!mgr) v.querySelectorAll("#setForm input").forEach(i => { i.disabled = true; });
    else $("setForm").onsubmit = async e => {
      e.preventDefault(); $("sErr").textContent = "";
      const socials = {}; ["linkedin", "instagram", "facebook", "x", "tiktok", "youtube", "whatsapp"].forEach(k => { socials[k] = $("s_" + k).value.trim(); });
      busy($("sGo"), true, "Saving…");
      try { await api("PUT", "settings", { replyTo: $("s_reply").value, website: $("s_web").value, address: $("s_addr").value, footerNote: $("s_note").value, socials }); await refreshBoot(); toast("Footer saved. It applies to every email from now on."); }
      catch (er) { $("sErr").textContent = er.message; } finally { busy($("sGo"), false); }
    };
  }
})();
