// Agent Inbox API (/api/agents): the drafts and alerts the daily agents (src/agent-engine.js, run by
// .github/scripts/agents-run.cjs) leave for people to review.
//
// Who sees what: each item has an owner (the deal owner, AMC owner, quotation author, or the finance contact set in
// the agent settings). People see their own items; managers see every item in their company and can reassign them.
// Nothing reaches a customer until a person presses Send. The email goes from the sender's own Microsoft 365 mailbox
// (through the Entra app's Mail.Send permission, so it lands in their Sent Items and replies come back to them),
// with the company signature filled in from their "My signature" details. If Microsoft refuses that mailbox, the
// company mailbox (MAIL_SENDER / TECHHUB_MAIL_SENDER) is used instead, with the sender in copy and as reply-to.
//
// Storage (Table Storage): agentinbox  PK <co>  RowKey <item key>
//                          agentsettings PK "settings" RowKey <co>  data (JSON)
//                                        PK "person"   RowKey <email>  name, title, mobile (signature details)
//                          agentruns  PK "run-<co>" (newest first) and PK "usage" RowKey "<co>-<YYYY-MM>"

const ENGINE = require("./agent-engine");
const { AGENTS, settingsIn, TABLES, tidy, DEFAULT_SIGS, SIG_KEYS, SIG_LAYOUT, SIG_V, sigFor, noEm } = ENGINE;
const ICONS = require("./sig-icons");
const ACCENT = { bifold: "#2E6DA4", techhub: "#28A08C" };
const SOCIAL = [["linkedin", "LinkedIn"], ["x", "X"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["whatsapp", "WhatsApp"], ["tiktok", "TikTok"]];
const graphReady = () => ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET"].every(k => process.env[k]);
const nameOf = e => String(e || "").split("@")[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const STATUSES = ["open", "snoozed", "sent", "done", "dismissed", "resolved"];

module.exports = function makeAgents(H) {
  const { table, getOrNull, fail, clean, CO, writeCo, mailReadyFor, sameCoEmail, emailOk, dealNote, unpackJson, dealInfo, dealFileBuf } = H;
  const coOf = user => user.co === "all" ? user.homeCo : user.co;
  const today = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  const now = () => new Date().toISOString();
  const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
  const visible = (e, user) => user.isManager || e.owner === user.email;

  // Drafts written before signatures existed ended "Kind regards, <name>, <company>"; the signature now replaces that.
  function draftOut(e) {
    const d = json(e.draft, null);
    if (d && d.body && !["sent"].includes(e.status)) d.body = String(d.body).replace(/\n*Kind regards,\s*\n[^\n]*\n\s*(Bifold Technologies( LLC)?|Tech Hub Information Technology)\s*$/i, "\n\nKind regards,");
    return d;
  }
  function itemOut(e) {
    const snoozedOver = e.status === "snoozed" && e.snoozeUntil && e.snoozeUntil <= today();
    return {
      id: e.rowKey, co: e.partitionKey, agent: e.agent, agentName: AGENTS[e.agent] || e.agent, kind: e.kind, refId: e.refId || "",
      title: e.title || "", summary: e.summary || "", facts: json(e.facts, []), severity: e.severity || "low", owner: e.owner || "", href: e.href || "", due: e.due || "",
      status: snoozedOver ? "open" : e.status || "open", snoozeUntil: snoozedOver ? "" : e.snoozeUntil || "", draft: draftOut(e),
      decidedBy: e.decidedBy || "", decidedAt: e.decidedAt || "", note: e.note || "", sentTo: e.sentTo || "", createdAt: e.createdAt, updatedAt: e.updatedAt, etag: e.etag,
    };
  }
  async function rows(co) {
    const t = await table(TABLES.INBOX); const out = [];
    for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${co}'` } })) out.push(e);
    return out;
  }
  async function load(user, id) {
    const e = await getOrNull(await table(TABLES.INBOX), coOf(user), clean(id, 200));
    if (!e || !visible(e, user)) fail(404, "This item no longer exists, or it belongs to someone else.");
    return e;
  }
  async function settings(co) {
    const e = await getOrNull(await table(TABLES.SETTINGS), "settings", co);
    return settingsIn(e ? json(e.data, {}) : {});
  }

  /* -------- signatures --------
     Layout (as Tech Hub's Outlook signature): name, job title, COMPANY, tagline, brands, a rule, then phone (office |
     mobile), email, website and address each with an icon, a rule, the social bar, and the disclaimer. Icons go as
     inline attachments (cid:) in sent mail and as data: images in the page preview. */
  const sigTable = () => table(TABLES.SETTINGS);
  const profileCache = new Map();
  async function graphProfile(email) {
    if (!graphReady()) return {};
    if (profileCache.has(email)) return profileCache.get(email);
    let p = {};
    try {
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}?$select=displayName,jobTitle,mobilePhone,businessPhones`, { headers: { Authorization: "Bearer " + await graphToken() } });
      if (r.ok) { const j = await r.json(); p = { name: j.displayName || "", title: j.jobTitle || "", mobile: j.mobilePhone || "" }; profileCache.set(email, p); }
    } catch {}
    return p;
  }
  // The person's details: what they saved, else their Microsoft 365 profile, else a name from the email.
  async function person(email) {
    const e = await getOrNull(await sigTable(), "person", email);
    if (e) return { name: e.name || "", title: e.title || "", mobile: e.mobile || "", credential: e.credential || "", saved: true };
    const g = await graphProfile(email);
    return { name: g.name || nameOf(email), title: g.title || "", mobile: g.mobile || "", credential: "", saved: false };
  }
  const tel = v => "tel:" + String(v).replace(/[^\d+]/g, "");
  const href = v => /^https?:\/\//i.test(v) ? v : "https://" + String(v).replace(/^\/+/, "");
  function sigBuild(co, sig, p, email, mode) {
    if (SIG_LAYOUT[co] === "classic") return sigClassic(co, sig, p, email, mode);
    const acc = ACCENT[co], used = new Set();
    const img = (key, size) => { used.add(key); const src = mode === "cid" ? `cid:sig-${key}` : `data:image/png;base64,${ICONS[key]}`; return `<img src="${src}" width="${size}" height="${size}" alt="" style="display:block;width:${size}px;height:${size}px;border:0">`; };
    const font = "font-family:'Segoe UI',Arial,Helvetica,sans-serif;";
    const rule = `<tr><td style="padding:10px 0"><table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td style="border-top:1px solid ${acc};font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table></td></tr>`;
    const line = (text, st) => text ? `<tr><td style="${font}${st}">${esc(text)}</td></tr>` : "";
    const link = (u, text, color) => `<a href="${esc(u)}" style="color:${color || "#111111"};text-decoration:underline">${esc(text)}</a>`;
    const contact = (icon, inner) => `<tr><td style="padding:3px 0"><table cellpadding="0" cellspacing="0" role="presentation"><tr><td width="30" style="width:30px;vertical-align:middle">${img(`${co}-${icon}`, 18)}</td><td style="${font}font-size:14px;color:#111111;vertical-align:middle">${inner}</td></tr></table></td></tr>`;
    const phones = [sig.office, p.mobile].filter(v => String(v || "").trim());
    const socials = SOCIAL.filter(([k]) => String(sig[k] || "").trim());
    const rows = [
      line(p.name, "font-size:20px;font-weight:bold;color:#111111"),
      line(p.title, "font-size:16px;color:#111111"),
      line(sig.company, `font-size:15px;font-weight:bold;color:${acc};padding-top:2px`),
      line(sig.tagline, "font-size:14px;color:#111111"),
      line(sig.brands, `font-size:14px;font-weight:bold;color:${acc}`),
      rule,
      phones.length ? contact("phone", phones.map(v => link(tel(v), v)).join(' <span style="color:#111111">&nbsp;|&nbsp;</span> ')) : "",
      contact("mail", link("mailto:" + email, email, "#0563C1")),
      sig.website ? contact("globe", link(href(sig.website), sig.website)) : "",
      sig.address ? contact("map-pin", sig.address.split("\n").map(esc).join("<br>")) : "",
      rule,
      socials.length ? `<tr><td><table cellpadding="0" cellspacing="0" role="presentation" bgcolor="${acc}" style="background:${acc}"><tr>${socials.map(([k, n]) => `<td style="padding:5px 6px"><a href="${esc(href(sig[k]))}" title="${n}">${img("social-" + k, 18)}</a></td>`).join("")}</tr></table></td></tr>` : "",
      line(sig.disclaimer, "font-size:12px;color:#222222;padding-top:4px;line-height:1.4"),
    ].join("");
    const html = `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:620px;margin-top:6px;border-collapse:collapse">${rows}</table>`;
    const text = [p.name, p.title, sig.company, sig.tagline, sig.brands, phones.join(" | "), email, sig.website, sig.address].filter(v => String(v || "").trim()).join("\n");
    return { html, text, icons: [...used] };
  }
  // Bifold's Outlook signature: a red bar beside blue name and company, grey labelled lines, bold website, round LinkedIn.
  function sigClassic(co, sig, p, email, mode) {
    const RED = "#E31B23", BLUE = "#2F5496", GREY = "#7F7F7F", used = new Set();
    const base = `font-family:Calibri,Carlito,Arial,sans-serif;font-size:15px;line-height:1.35;color:${GREY}`;
    const strong = `font-family:Arial,Helvetica,sans-serif;font-weight:bold;color:${BLUE}`;
    const div = (inner, st = "") => inner ? `<div style="${st}">${inner}</div>` : "";
    const plain = (u, t) => `<a href="${esc(u)}" style="color:${GREY};text-decoration:none">${esc(t)}</a>`;
    const titleLine = p.title && sig.company ? `${esc(p.title)} at <span style="${strong}">${esc(sig.company)}</span>` : p.title ? esc(p.title) : sig.company ? `<span style="${strong}">${esc(sig.company)}</span>` : "";
    let li = "";
    if (String(sig.linkedin || "").trim()) { used.add("round-linkedin"); const src = mode === "cid" ? "cid:sig-round-linkedin" : `data:image/png;base64,${ICONS["round-linkedin"]}`;
      li = `<div style="padding-top:4px"><a href="${esc(href(sig.linkedin))}" title="LinkedIn"><img src="${src}" width="22" height="22" alt="LinkedIn" style="display:block;width:22px;height:22px;border:0"></a></div>`; }
    const inner = [
      div(esc(p.name), strong + ";font-size:15px"),
      div(titleLine),
      div(esc(p.credential), strong),
      sig.office ? div("Phone: " + plain(tel(sig.office), sig.office)) : "",
      p.mobile ? div("Mobile: " + plain(tel(p.mobile), p.mobile)) : "",
      div(`Email:&nbsp; <a href="mailto:${esc(email)}" style="color:#0563C1;text-decoration:underline">${esc(email)}</a>`),
      ...(sig.address ? sig.address.split("\n").map(l => div(esc(l))) : []),
      sig.website ? div(`<a href="${esc(href(sig.website))}" style="font-family:Arial,Helvetica,sans-serif;font-weight:bold;color:#1F2A5A;text-decoration:underline">${esc(sig.website)}</a>`) : "",
      li,
    ].join("");
    const html = `<table cellpadding="0" cellspacing="0" role="presentation" style="margin-top:6px;border-collapse:collapse;max-width:720px">`
      + `<tr><td style="border-left:5px solid ${RED};padding:2px 0 2px 9px;${base}">${inner}</td></tr>`
      + (sig.disclaimer ? `<tr><td style="padding-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.4;color:${GREY}">${esc(sig.disclaimer)}</td></tr>` : "")
      + `</table>`;
    const text = [p.name, [p.title, sig.company].filter(Boolean).join(" at "), p.credential, sig.office && "Phone: " + sig.office, p.mobile && "Mobile: " + p.mobile,
      "Email: " + email, sig.address, sig.website].filter(v => String(v || "").trim()).join("\n");
    return { html, text, icons: [...used] };
  }
  async function signature(co, user, S) {
    S = S || await settings(co);
    const p = await person(user.email);
    const b = sigBuild(co, sigFor(co, S.sig, S.sigV), p, user.email, "data");
    return { html: b.html, text: b.text, person: p };
  }
  const personIn = b => ({ name: noEm(clean(b.name, 80)), title: noEm(clean(b.title, 100)), mobile: noEm(clean(b.mobile, 40)), credential: noEm(clean(b.credential, 80)) });
  async function saveMe(user, b) {
    writeCo(user);
    const v = personIn(b);
    if (!v.name) fail(400, "Enter your name as it should appear in emails.");
    if (user.aud) user.aud.name = "Email signature details";
    await (await sigTable()).upsertEntity({ partitionKey: "person", rowKey: user.email, ...v, updatedAt: now() }, "Replace");
    return signature(coOf(user), user);
  }
  // Live preview while someone edits their details or (managers) the company signature. Saves nothing.
  async function preview(user, b) {
    const co = coOf(user);
    const p = b.person ? { ...personIn(b.person), saved: true } : await person(user.email);
    const S = await settings(co);
    const sig = b.sig && user.isManager ? sigFor(co, b.sig, SIG_V) : sigFor(co, S.sig, S.sigV);
    return { html: sigBuild(co, sig, p, user.email, "data").html };
  }

  /* -------- attachments: reference files for the email --------
     a2 follow-up: the deal's files (proposal, quotation, BoQ...) and Books quotations linked to the deal.
     a4 collection: the invoice itself (a Books document). a1 renewal: the AMC record's files.
     Books documents are listed here and turned into PDFs in the browser (the same builder as Books);
     deal and AMC files are read from storage by the server when the email is sent. */
  const MAX_EACH = 10 * 1048576, MAX_TOTAL = 20 * 1048576;
  const canAmc = user => user.isManager || (user.sections || []).includes("amc");
  const canBooks = user => user.isManager || (user.sections || []).some(x => ["books", "bk_sales", "quotes"].includes(x));
  let amcContainer;
  async function amcBlobs() {
    if (!amcContainer) { const { BlobServiceClient } = require("@azure/storage-blob"); amcContainer = BlobServiceClient.fromConnectionString(process.env.STORAGE_CONNECTION).getContainerClient("amc-files"); }
    return amcContainer;
  }
  async function amcFiles(user, amcId) {
    if (!amcId || !canAmc(user)) return [];
    const e = await getOrNull(await table("amc"), "amc", amcId);
    if (!e || (e.co || "bifold") !== coOf(user)) return [];
    return (unpackJson(e).files || []).filter(f => f && f.id);
  }
  async function booksDocs(user, co, pred) {
    if (!canBooks(user)) return [];
    const t = await table("books"), out = [];
    try { for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq 'doc-${co}'`, select: ["RowKey", "type", "number", "status", "contactName", "total", "dealId", "updatedAt", "date"] } })) if (pred(e)) out.push(e); }
    catch (err) { if (err.statusCode !== 404) throw err; }
    return out.sort((a, b) => String(b.updatedAt || b.date).localeCompare(String(a.updatedAt || a.date)));
  }
  const pdfName = (type, d) => `${type === "invoice" ? "Invoice" : "Quotation"} ${d.number || "draft"} ${d.contactName || ""}`.trim() + ".pdf";
  async function attachments(user, id) {
    const e = await load(user, id), co = e.partitionKey, out = [];
    if (e.agent === "a2" && e.refId) {
      let info = null; try { info = await dealInfo(user, e.refId); } catch {}
      const quotes = await booksDocs(user, co, d => d.type === "quote" && d.dealId === e.refId && d.status !== "void");
      quotes.forEach((q, i) => out.push({ source: "books", id: q.rowKey || q.RowKey, docType: "quote", name: pdfName("quote", q), label: `Quotation from Books (${q.status})`, suggested: i === 0 }));
      (info ? info.files : []).slice().reverse().forEach(f => {
        const isQuote = f.kind === "quote", isProp = f.kind === "proposal";
        out.push({ source: "deal", id: f.id, name: f.name, size: f.size, label: "Deal file: " + ({ proposal: "Proposal", quote: "Quotation", estimation: "Estimation", photo: "Site photo", survey: "Survey report", drawing: "BoQ / drawing", po: "Customer PO", customer: "Customer document" }[f.kind] || "Other"),
          suggested: isProp ? !out.some(x => x.suggested && x.source === "deal" && /^Deal file: Proposal/.test(x.label)) : isQuote && !quotes.length && !out.some(x => x.suggested) });
      });
    }
    if (e.agent === "a4" && e.refId) {
      const inv = await booksDocs(user, co, d => (d.rowKey || d.RowKey) === e.refId);
      inv.forEach(d => out.push({ source: "books", id: e.refId, docType: d.type, name: pdfName(d.type, d), label: "The invoice, from Books", suggested: true }));
    }
    if (e.agent === "a1" && e.kind === "renewal" && e.refId)
      (await amcFiles(user, e.refId)).forEach(f => out.push({ source: "amc", id: f.id, name: f.name, size: f.size, label: "AMC file", suggested: false }));
    return { items: out, booksAccess: canBooks(user), limitMb: MAX_TOTAL / 1048576 };
  }
  // Collects the chosen files as Graph file attachments; refuses anything this person can't see.
  async function gather(user, e, list) {
    const out = []; let total = 0;
    const allowed = list && list.length ? await attachments(user, e.rowKey) : { items: [] };
    for (const a of (Array.isArray(list) ? list : []).slice(0, 15)) {
      let name, type, buf;
      if (a.source === "deal" || a.source === "amc") {
        const ok = allowed.items.find(x => x.source === a.source && x.id === a.id);
        if (!ok) fail(400, "One of the chosen files is no longer available. Reopen the email and try again.");
        name = ok.name; type = /\.pdf$/i.test(name) ? "application/pdf" : "application/octet-stream";
        try { buf = a.source === "deal" ? await dealFileBuf(user, e.refId, a.id) : await (await amcBlobs()).getBlockBlobClient(a.id).downloadToBuffer(); }
        catch { fail(404, `${name} couldn't be read from storage.`); }
      } else {
        name = clean(a.name, 200) || "attachment"; type = clean(a.type, 120) || "application/octet-stream";
        buf = Buffer.from(String(a.data || ""), "base64");
        if (!buf.length) fail(400, `${name} is empty.`);
      }
      if (buf.length > MAX_EACH) fail(413, `${name} is larger than 10 MB. Send it from Outlook instead.`);
      total += buf.length;
      if (total > MAX_TOTAL) fail(413, "The attachments add up to more than 20 MB. Remove some, or send from Outlook.");
      out.push({ name, type, buf });
    }
    return out;
  }

  // Personalise the draft with Claude in the tools site (uses the site's ANTHROPIC_API_KEY), with more context than
  // the morning job had: the deal's notes, the quotation lines, and the files being attached. Saves nothing.
  async function rewrite(user, id, b) {
    const e = await load(user, id), co = e.partitionKey;
    if (!e.draft) fail(400, "This item has no email to write.");
    if (!process.env.ANTHROPIC_API_KEY) fail(501, "Claude isn't connected on the tools site. Add ANTHROPIC_API_KEY to the Static Web App settings.");
    // Internal facts (value, cost, margin, days quiet, notes) stay out of what Claude may write to the customer.
    const facts = json(e.facts, []).filter(([k]) => !/internal|cost|margin|value|quiet|last note|lpo|outstanding \(internal\)/i.test(k));
    if (e.agent === "a2" && e.refId) {
      try {
        const info = await dealInfo(user, e.refId);
        info.log.filter(l => l.kind === "note").slice(-3).forEach(l => facts.push(["Internal note (context only, do not quote)", String(l.text).slice(0, 300)]));
        const q = (await booksDocs(user, co, d => d.type === "quote" && d.dealId === e.refId && d.status !== "void"))[0];
        if (q) {
          const full = await getOrNull(await table("books"), "doc-" + co, q.rowKey || q.RowKey);
          const lines = full ? (unpackJson(full).lines || []) : [];
          facts.push(["Quotation", q.number || "draft"]);
          if (lines.length) facts.push(["What was quoted", lines.slice(0, 12).map(l => `${num(l.qty)} x ${l.name}`).join("; ")]);
        }
      } catch {}
    }
    const att = (Array.isArray(b.attachNames) ? b.attachNames : []).map(n => clean(n, 150)).filter(Boolean).slice(0, 10);
    if (att.length) facts.push(["Attached to this email", att.join(", ")]);
    const d = json(e.draft, {});
    const contact = (String(d.body || "").match(/^Dear ([^,\n]+),/) || [])[1] || "Sir / Madam";
    const p = await person(user.email);
    const out = await ENGINE.claudeDraft(e.kind, facts, { company: CO[co].name, signer: p.name, greeting: contact, instruction: clean(b.instruction, 500), log: () => {} });
    if (!out) fail(502, "Claude couldn't write the email just now. Try again in a minute.");
    return out;
  }
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  async function list(user) {
    const co = coOf(user);
    const cutoff = new Date(Date.now() - 45 * 864e5).toISOString();
    const items = (await rows(co)).filter(e => visible(e, user)).map(itemOut)
      .filter(i => ["open", "snoozed"].includes(i.status) || String(i.decidedAt || i.updatedAt) >= cutoff);
    const runsT = await table(TABLES.RUNS);
    const runs = [];
    for await (const e of runsT.listEntities({ queryOptions: { filter: `PartitionKey eq 'run-${co}'` } })) { runs.push({ at: e.at, created: e.created, resolved: e.resolved, drafted: e.drafted, counts: json(e.counts, {}) }); if (runs.length >= 7) break; }
    const usage = await getOrNull(runsT, "usage", `${co}-${today().slice(0, 7)}`);
    const S = await settings(co);
    return { items, agents: AGENTS, settings: { ...S, sig: sigFor(co, S.sig, S.sigV) }, defaultSig: DEFAULT_SIGS[co], sigLayout: SIG_LAYOUT[co], signature: await signature(co, user, S), runs, draftsThisMonth: usage ? Number(usage.drafts) || 0 : 0,
      isManager: user.isManager, me: user.email, mailReady: graphReady(), claudeReady: !!process.env.ANTHROPIC_API_KEY, company: CO[co].name };
  }

  // Save edits to a draft without sending.
  async function saveDraft(user, id, b) {
    writeCo(user);
    const e = await load(user, id);
    if (!e.draft) fail(400, "This item has no email to edit.");
    const d = json(e.draft, {});
    const next = { ...d, to: clean(b.to, 600), cc: clean(b.cc, 600), subject: tidy(clean(b.subject, 250)), body: tidy(String(b.body ?? "").slice(0, 8000)), edited: true };
    if (user.aud) { user.aud.name = e.title; user.aud.changes = ["Draft edited"]; }
    await (await table(TABLES.INBOX)).updateEntity({ partitionKey: e.partitionKey, rowKey: e.rowKey, draft: JSON.stringify(next), updatedAt: now() }, "Merge", { etag: b.etag || e.etag })
      .catch(err => { if (err.statusCode === 412) fail(409, "This item changed while you were editing it. Reload and try again."); throw err; });
    return itemOut(await (await table(TABLES.INBOX)).getEntity(e.partitionKey, e.rowKey));
  }

  async function setStatus(user, id, b) {
    writeCo(user);
    const e = await load(user, id);
    const want = String(b.status || "");
    if (!["open", "done", "dismissed", "snoozed"].includes(want)) fail(400, "Choose done, dismiss, snooze or reopen.");
    const patch = { partitionKey: e.partitionKey, rowKey: e.rowKey, status: want, updatedAt: now() };
    if (want === "snoozed") {
      const days = [1, 3, 7, 14, 30].includes(Number(b.days)) ? Number(b.days) : 3;
      patch.snoozeUntil = new Date(Date.parse(today() + "T00:00:00Z") + days * 864e5).toISOString().slice(0, 10);
      patch.note = `Snoozed for ${days} day${days === 1 ? "" : "s"}`;
    } else patch.snoozeUntil = "";
    if (want === "open") Object.assign(patch, { decidedBy: "", decidedAt: "", note: "" });
    if (want === "done" || want === "dismissed") Object.assign(patch, { decidedBy: user.email, decidedAt: now(), note: clean(b.reason, 300) });
    if (want === "dismissed" && !patch.note) fail(400, "Say briefly why this isn't needed. It helps tune the agents.");
    if (user.aud) { user.aud.name = e.title; user.aud.status = want; }
    await (await table(TABLES.INBOX)).updateEntity(patch, "Merge", { etag: e.etag }).catch(err => { if (err.statusCode === 412) fail(409, "This item changed a moment ago. Reload and try again."); throw err; });
    return itemOut(await (await table(TABLES.INBOX)).getEntity(e.partitionKey, e.rowKey));
  }

  async function assign(user, id, b) {
    if (!user.isManager) fail(403, "Only managers can reassign agent items.");
    writeCo(user);
    const e = await load(user, id);
    const owner = clean(b.owner, 150).toLowerCase();
    if (!emailOk(owner) || !sameCoEmail(owner, user)) fail(400, "Enter the email address of a colleague in your company.");
    if (user.aud) { user.aud.name = e.title; user.aud.changes = [`Owner ${e.owner || "none"} to ${owner}`]; }
    await (await table(TABLES.INBOX)).updateEntity({ partitionKey: e.partitionKey, rowKey: e.rowKey, owner, updatedAt: now() }, "Merge", { etag: e.etag });
    return itemOut(await (await table(TABLES.INBOX)).getEntity(e.partitionKey, e.rowKey));
  }

  /* -------- sending (Microsoft Graph, same Entra app and mailboxes as the AMC Tracker) -------- */
  let tok = { v: "", exp: 0 };
  async function graphToken() {
    if (tok.v && tok.exp > Date.now() + 60e3) return tok.v;
    const r = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.GRAPH_CLIENT_ID, client_secret: process.env.GRAPH_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }) });
    const j = await r.json(); if (!r.ok) fail(502, "Email sign-in to Microsoft 365 failed. Check the GRAPH settings of the Static Web App.");
    tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 }; return tok.v;
  }
  const addrs = v => String(v || "").split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 20);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toHtml = text => `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#15222e">${String(text).split(/\n{2,}/).map(p => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;

  async function send(user, id, b) {
    const co = writeCo(user);
    if (!graphReady()) fail(501, "Email sending isn't set up on the tools site yet. Use Copy or Open in Outlook and send it yourself, then mark the item done.");
    const e = await load(user, id);
    if (!e.draft) fail(400, "This item has no email to send.");
    if (!["open", "snoozed"].includes(itemOut(e).status)) fail(409, "This item is already closed.");
    const to = addrs(b.to), cc = addrs(b.cc).filter(a => a !== user.email);
    const subject = tidy(clean(b.subject, 250)), body = tidy(String(b.body || "").slice(0, 8000));
    const bad = to.concat(cc).find(a => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));
    if (!to.length) fail(400, "Add the customer's email address."); if (bad) fail(400, `${bad} isn't a valid email address.`);
    if (!subject || body.trim().length < 20) fail(400, "Write a subject and a message before sending.");
    if (user.aud) { user.aud.name = e.title; user.aud.changes = [`Emailed ${to.join(", ")}: ${subject}`]; }
    const sb = sigBuild(co, sigFor(co, (await settings(co)).sig, (await settings(co)).sigV), await person(user.email), user.email, "cid");
    const html = toHtml(body) + sb.html;
    const files = await gather(user, e, b.attach);
    const attachments = sb.icons.map(k => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: `${k}.png`, contentType: "image/png", contentBytes: ICONS[k], isInline: true, contentId: `sig-${k}` }))
      .concat(files.map(f => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: f.name, contentType: f.type, contentBytes: f.buf.toString("base64") })));
    const bigTotal = files.reduce((n, f) => n + f.buf.length, 0) > 2.8 * 1048576;
    // Over about 3 MB of files, Microsoft needs the email built as a draft with the files uploaded in parts, then sent.
    const postBig = async (mailbox, extraCc) => {
      const G = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}`, H2 = { Authorization: "Bearer " + tokenNow, "Content-Type": "application/json" };
      const small = attachments.filter(a => a.isInline);
      const r1 = await fetch(`${G}/messages`, { method: "POST", headers: H2, body: JSON.stringify({ subject, body: { contentType: "HTML", content: html }, attachments: small,
        toRecipients: to.map(a => ({ emailAddress: { address: a } })), ccRecipients: cc.concat(extraCc).map(a => ({ emailAddress: { address: a } })), replyTo: [{ emailAddress: { address: user.email } }] }) });
      if (!r1.ok) return r1;
      const msg = await r1.json();
      for (const f of files) {
        if (f.buf.length < 3 * 1048576) {
          const ra = await fetch(`${G}/messages/${msg.id}/attachments`, { method: "POST", headers: H2, body: JSON.stringify({ "@odata.type": "#microsoft.graph.fileAttachment", name: f.name, contentType: f.type, contentBytes: f.buf.toString("base64") }) });
          if (!ra.ok) return ra; continue;
        }
        const rs = await fetch(`${G}/messages/${msg.id}/attachments/createUploadSession`, { method: "POST", headers: H2, body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name: f.name, size: f.buf.length, contentType: f.type } }) });
        if (!rs.ok) return rs;
        const { uploadUrl } = await rs.json(); const CH = 320 * 1024 * 10;
        for (let i = 0; i < f.buf.length; i += CH) {
          const part = f.buf.subarray(i, Math.min(i + CH, f.buf.length));
          const ru = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Length": String(part.length), "Content-Range": `bytes ${i}-${i + part.length - 1}/${f.buf.length}` }, body: part });
          if (!ru.ok) return ru;
        }
      }
      return fetch(`${G}/messages/${msg.id}/send`, { method: "POST", headers: { Authorization: "Bearer " + tokenNow } });
    };
    const post = (mailbox, extraCc) => bigTotal ? postBig(mailbox, extraCc) : fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
      method: "POST", headers: { Authorization: "Bearer " + tokenNow, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, attachments, toRecipients: to.map(a => ({ emailAddress: { address: a } })),
        ccRecipients: cc.concat(extraCc).map(a => ({ emailAddress: { address: a } })), replyTo: [{ emailAddress: { address: user.email } }] }, saveToSentItems: true }),
    });
    const tokenNow = await graphToken();
    // First choice: the sender's own mailbox. Fallback: the company mailbox, with the sender copied.
    let via = user.email, r = await post(user.email, []);
    const fallback = co === "techhub" ? process.env.TECHHUB_MAIL_SENDER : process.env.MAIL_SENDER;
    if (!r.ok && [401, 403, 404].includes(r.status) && fallback && fallback.toLowerCase() !== user.email) { via = fallback; r = await post(fallback, [user.email]); }
    if (!r.ok) {
      const detail = await r.json().catch(() => ({}));
      const code = detail.error && detail.error.code || r.status;
      fail(502, (r.status === 403 || r.status === 404) && bigTotal
        ? `Attachments over 3 MB need one more Microsoft 365 permission for the tools app: Mail.ReadWrite (Application), with admin consent. Until then, attach smaller files or send from Outlook. (${code})`
        : r.status === 403 || r.status === 404
        ? `Microsoft 365 won't let the tools site send from ${user.email} (${code}). Ask your Microsoft 365 admin to allow it (the tools app needs Mail.Send), or use Copy or Open in Outlook for now.`
        : `Microsoft 365 didn't send the email (${code}). Try again, or copy the text and send it from Outlook.`);
    }
    const d = { ...json(e.draft, {}), to: to.join(", "), cc: cc.join(", "), subject, body, attached: files.map(f => f.name) };
    await (await table(TABLES.INBOX)).updateEntity({ partitionKey: e.partitionKey, rowKey: e.rowKey, status: "sent", draft: JSON.stringify(d), sentTo: to.join(", "),
      decidedBy: user.email, decidedAt: now(), note: via === user.email ? "" : `Sent from ${via}`, updatedAt: now() }, "Merge");
    // Keep the deal's activity complete.
    if (e.agent === "a2" && e.refId && dealNote) await dealNote(user, e.refId, { text: `Follow-up emailed to ${to.join(", ")} from the Agent Inbox: ${subject}${files.length ? ` (attached: ${files.map(f => f.name).join(", ")})` : ""}` }).catch(() => {});
    return itemOut(await (await table(TABLES.INBOX)).getEntity(e.partitionKey, e.rowKey));
  }

  async function saveSettings(user, b) {
    if (!user.isManager) fail(403, "Only managers can change the agent settings.");
    const co = writeCo(user);
    const s = settingsIn(b);
    s.sig = sigFor(co, s.sig, SIG_V); s.sigV = SIG_V;
    for (const k of ["linkedin", "x", "facebook", "instagram", "whatsapp", "tiktok"]) if (s.sig[k] && !/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(s.sig[k])) fail(400, `The ${k === "x" ? "X" : k[0].toUpperCase() + k.slice(1)} link doesn't look like a web address.`);
    if (b.financeEmail && !s.financeEmail) fail(400, "Enter a valid email address for collections, or leave it empty.");
    if (s.financeEmail && !sameCoEmail(s.financeEmail, user)) fail(400, "The collections contact must be someone in your company.");
    const prev = await settings(co);
    if (user.aud) user.aud.changes = Object.keys(s).filter(k => JSON.stringify(s[k]) !== JSON.stringify(prev[k])).map(k => `${k}: ${JSON.stringify(prev[k])} to ${JSON.stringify(s[k])}`);
    await (await table(TABLES.SETTINGS)).upsertEntity({ partitionKey: "settings", rowKey: co, data: JSON.stringify(s), updatedBy: user.email, updatedAt: now() }, "Replace");
    return s;
  }

  // For the top bar: the person's own open items.
  async function alerts(user) {
    if (user.co === "all") return [];
    const mine = (await rows(user.co)).filter(e => e.owner === user.email).map(itemOut).filter(i => i.status === "open");
    if (!mine.length) return [];
    const high = mine.filter(i => i.severity === "high").length;
    return [{ tool: "agents", severity: high ? "high" : "medium", when: today(), href: "/agents/", title: `${mine.length} item${mine.length === 1 ? "" : "s"} in your Agent Inbox`,
      text: high ? `${high} high priority` : "Drafts and alerts waiting for your review" }];
  }

  async function route(method, seg, user, body) {
    const [a, id, sub] = seg;
    if (!a && method === "GET") return list(user);
    if (a === "settings" && method === "PUT") return saveSettings(user, body);
    if (a === "me" && method === "PUT") return saveMe(user, body);
    if (a === "preview" && method === "POST") return preview(user, body);
    if (a === "items" && id) {
      if (!sub && method === "PUT") return saveDraft(user, id, body);
      if (sub === "send" && method === "POST") return send(user, id, body);
      if (sub === "status" && method === "POST") return setStatus(user, id, body);
      if (sub === "assign" && method === "POST") return assign(user, id, body);
      if (sub === "attachments" && method === "GET") return attachments(user, id);
      if (sub === "rewrite" && method === "POST") return rewrite(user, id, body);
    }
    fail(404, "Unknown request.");
  }
  return { route, alerts, STATUSES };
};
