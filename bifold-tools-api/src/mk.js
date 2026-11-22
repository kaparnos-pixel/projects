// Email Campaigns (section "campaigns"): contacts imported from CSV, branded campaigns built from blocks,
// images, Claude drafting, test sends, scheduling, and the public unsubscribe and image routes.
// Each company only ever sees and sends its own contacts and campaigns, in its own branding.
//
// Storage (Table Storage, PartitionKey = company "bifold" / "techhub" unless noted):
//   mkcontacts   RowKey = hash of the email   email, firstName, lastName, company, tags (comma list),
//                status subscribed | unsubscribed | bounced, source, unsubscribedAt, unsubVia, unsubCampaign
//   mkcampaigns  RowKey = CMP-…              name, subject, preheader, status, audience (JSON), scheduledAt,
//                total/sent/failed/skipped, blocks in data0… (see mk-render.js)
//   mksends      PartitionKey = campaign id   one row per recipient once sending starts (see mk-send.js)
//   mktemplates  RowKey = TPL-…              saved designs
//   mksettings   PK "settings", RowKey = company   reply-to, website, address, socials, footer note
// Blob Storage "mk-media": <company>/<id>.<ext>, served publicly at /api/public/m/<company>/<file> for use in emails.
// Claude drafting needs ANTHROPIC_API_KEY (MK_MODEL or ANTHROPIC_MODEL picks the model).

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { BlobServiceClient } = require("@azure/storage-blob");
const makeSender = require("./mk-send");

const MEDIA_MAX = 5 * 1048576;
const MEDIA_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
// "approval": a team member scheduled it and it waits for a manager. Only "scheduled" and "sending" campaigns are ever
// sent (mk-send.js), so nothing reaches customers until a manager has approved it (or scheduled it themselves).
const STATUSES = ["draft", "approval", "scheduled", "sending", "paused", "sent", "cancelled", "failed"];
const BLOCKS = ["hero", "heading", "text", "image", "button", "split", "features", "stats", "quote", "cta", "divider", "spacer", "html"];
const emailRe = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[a-z]{2,}$/i;

module.exports = function makeMk(H) {
  const { table, getOrNull, packJson, unpackJson, fail, clean, CO, writeCo, record } = H;
  const S = makeSender({ table, getOrNull });
  const cos = user => user.co === "all" ? Object.keys(CO) : [user.co];
  const now = () => new Date().toISOString();
  const json = (s, d) => { try { return JSON.parse(s || ""); } catch { return d; } };
  const tagList = v => [...new Set((Array.isArray(v) ? v : String(v || "").split(/[,;]/)).map(s => clean(s, 40).replace(/,/g, " ")).filter(Boolean))].slice(0, 20);

  // ---------- contacts ----------
  const contactOut = e => ({ key: e.rowKey, co: e.partitionKey, email: e.email, firstName: e.firstName || "", lastName: e.lastName || "", company: e.company || "",
    tags: tagList(e.tags), status: e.status || "subscribed", source: e.source || "", createdAt: e.createdAt || "", unsubscribedAt: e.unsubscribedAt || "", unsubVia: e.unsubVia || "" });
  async function listContacts(user) {
    const t = await table("mkcontacts"); const out = [];
    for (const co of cos(user)) for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${co}'` } })) out.push(contactOut(e));
    return out.sort((a, b) => a.email.localeCompare(b.email));
  }
  function contactIn(r) {
    const email = clean(r.email, 200).toLowerCase().replace(/^mailto:/, "");
    return { email, ok: emailRe.test(email), firstName: clean(r.firstName, 80), lastName: clean(r.lastName, 80), company: clean(r.company, 150) };
  }
  async function addContact(user, b) {
    const co = writeCo(user);
    const f = contactIn(b);
    if (!f.ok) fail(400, "Enter a valid email address.");
    const t = await table("mkcontacts"); const key = S.contactKey(f.email);
    const cur = await getOrNull(t, co, key);
    if (cur) fail(409, `${f.email} is already in your contacts${cur.status === "unsubscribed" ? " and has unsubscribed" : ""}.`);
    const e = { partitionKey: co, rowKey: key, email: f.email, firstName: f.firstName, lastName: f.lastName, company: f.company, tags: tagList(b.tags).join(","), status: "subscribed", source: "Added by " + user.email, createdBy: user.email, createdAt: now(), updatedAt: now() };
    await t.createEntity(e);
    return contactOut(e);
  }
  // CSV import (parsed in the browser), up to 1,000 rows per request. People already in the list keep their
  // subscription status: an import never re-subscribes someone who unsubscribed.
  async function importContacts(user, b) {
    const co = writeCo(user);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) fail(400, "The file has no rows.");
    if (rows.length > 1000) fail(400, "Send at most 1,000 rows per request.");
    const addTags = tagList(b.tags);
    const source = clean(b.source, 120) || "CSV import";
    const t = await table("mkcontacts");
    const existing = new Map();
    for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${co}'`, select: ["RowKey", "status", "tags", "firstName", "lastName", "company"] } })) existing.set(e.rowKey, e);
    const seen = new Set(); const actions = [];
    const res = { added: 0, updated: 0, unchanged: 0, suppressed: 0, invalid: [], duplicates: 0 };
    rows.forEach((r, i) => {
      const f = contactIn(r || {});
      if (!f.ok) { if (f.email || Object.values(r || {}).some(Boolean)) res.invalid.push({ row: (Number(b.offset) || 0) + i + 2, email: f.email }); return; }
      const key = S.contactKey(f.email);
      if (seen.has(key)) { res.duplicates++; return; }
      seen.add(key);
      const tags = tagList([...tagList(r.tags), ...addTags]);
      const cur = existing.get(key);
      if (!cur) {
        actions.push(["create", { partitionKey: co, rowKey: key, email: f.email, firstName: f.firstName, lastName: f.lastName, company: f.company, tags: tags.join(","), status: "subscribed", source, createdBy: user.email, createdAt: now(), updatedAt: now() }]);
        res.added++; return;
      }
      if (cur.status && cur.status !== "subscribed") res.suppressed++;
      const merged = tagList([...tagList(cur.tags), ...tags]);
      const ch = {};
      if (merged.join(",") !== tagList(cur.tags).join(",")) ch.tags = merged.join(",");
      for (const k of ["firstName", "lastName", "company"]) if (f[k] && !cur[k]) ch[k] = f[k];
      if (!Object.keys(ch).length) { res.unchanged++; return; }
      actions.push(["update", { partitionKey: co, rowKey: key, ...ch, updatedAt: now() }, "Merge"]);
      res.updated++;
    });
    for (let i = 0; i < actions.length; i += 100) await t.submitTransaction(actions.slice(i, i + 100));
    return res;
  }
  async function editContact(user, key, b) {
    const co = writeCo(user);
    const t = await table("mkcontacts");
    const cur = await getOrNull(t, co, key);
    if (!cur) fail(404, "This contact no longer exists.");
    const f = { firstName: clean(b.firstName, 80), lastName: clean(b.lastName, 80), company: clean(b.company, 150), tags: tagList(b.tags).join(",") };
    const st = String(b.status || cur.status);
    if (st !== cur.status) {
      if (st === "unsubscribed") Object.assign(f, { status: "unsubscribed", unsubscribedAt: now(), unsubVia: "Marked by " + user.email });
      else if (st === "subscribed") {
        // Re-subscribing someone who opted out needs a manager and a reason, so the opt-out is respected by default.
        if (!user.isManager) fail(403, "Only a manager can re-subscribe someone who unsubscribed.");
        if (!clean(b.reason, 200)) fail(400, "Say why this person is being re-subscribed (for example: asked us by email on 12 Nov).");
        Object.assign(f, { status: "subscribed", unsubVia: "Re-subscribed by " + user.email + ": " + clean(b.reason, 200), unsubscribedAt: "" });
      } else fail(400, "Unknown status.");
    }
    if (user.aud) user.aud.name = cur.email;
    await t.updateEntity({ partitionKey: co, rowKey: key, ...f, updatedAt: now() }, "Merge");
    return contactOut({ ...cur, ...f });
  }
  async function bulkContacts(user, b) {
    const co = writeCo(user);
    const keys = (Array.isArray(b.keys) ? b.keys : []).map(k => clean(k, 40)).filter(Boolean).slice(0, 10000);
    const act = String(b.action || "");
    if (!keys.length) fail(400, "Select contacts first.");
    if (act === "delete" && !user.isManager) fail(403, "Only managers can delete contacts. Unsubscribe them instead.");
    if (!["addTag", "removeTag", "unsubscribe", "delete"].includes(act)) fail(400, "Unknown action.");
    const tag = clean(b.tag, 40);
    if ((act === "addTag" || act === "removeTag") && !tag) fail(400, "Enter a list name.");
    const t = await table("mkcontacts"); const want = new Set(keys); const actions = [];
    for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${co}'`, select: ["RowKey", "tags", "status"] } })) {
      if (!want.has(e.rowKey)) continue;
      if (act === "delete") actions.push(["delete", { partitionKey: co, rowKey: e.rowKey }]);
      else if (act === "unsubscribe") { if (e.status === "subscribed") actions.push(["update", { partitionKey: co, rowKey: e.rowKey, status: "unsubscribed", unsubscribedAt: now(), unsubVia: "Marked by " + user.email }, "Merge"]); }
      else {
        const cur = tagList(e.tags); const next = act === "addTag" ? tagList([...cur, tag]) : cur.filter(x => x.toLowerCase() !== tag.toLowerCase());
        if (next.join(",") !== cur.join(",")) actions.push(["update", { partitionKey: co, rowKey: e.rowKey, tags: next.join(",") }, "Merge"]);
      }
    }
    for (let i = 0; i < actions.length; i += 100) await t.submitTransaction(actions.slice(i, i + 100));
    if (user.aud) user.aud.name = `${actions.length} contact(s)`;
    return { changed: actions.length };
  }

  // ---------- campaigns ----------
  const SUM = ["RowKey", "PartitionKey", "name", "subject", "status", "audience", "scheduledAt", "startedAt", "completedAt", "total", "sent", "failed", "skipped", "lastNote", "createdBy", "createdAt", "updatedBy", "updatedAt", "requestedBy", "requestedAt", "approvedBy", "approvedAt"];
  const campOut = e => ({ id: e.rowKey || e.RowKey, co: e.partitionKey || e.PartitionKey, name: e.name || "", subject: e.subject || "", status: e.status || "draft", audience: json(e.audience, { mode: "all", tags: [] }),
    scheduledAt: e.scheduledAt || "", startedAt: e.startedAt || "", completedAt: e.completedAt || "", total: e.total || 0, sent: e.sent || 0, failed: e.failed || 0, skipped: e.skipped || 0,
    lastNote: e.lastNote || "", createdBy: e.createdBy, createdAt: e.createdAt, updatedBy: e.updatedBy, updatedAt: e.updatedAt,
    requestedBy: e.requestedBy || "", requestedAt: e.requestedAt || "", approvedBy: e.approvedBy || "", approvedAt: e.approvedAt || "" });
  const campFull = e => ({ ...campOut(e), preheader: e.preheader || "", ...unpackJson(e), etag: e.etag });
  async function listCampaigns(user) {
    const t = await table("mkcampaigns"); const out = [];
    for (const co of cos(user)) for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${co}'`, select: SUM } })) out.push(campOut(e));
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  // Top bar: managers see campaigns waiting for their approval.
  async function approvals(user) {
    if (!user.isManager) return [];
    const t = await table("mkcampaigns"); const out = [];
    for (const co of cos(user)) for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${co}' and status eq 'approval'`, select: SUM } })) {
      const c = campOut(e);
      out.push({ tool: "campaigns", severity: "high", when: (c.scheduledAt || c.requestedAt || "").slice(0, 10), href: `/campaigns/#edit/${c.id}`,
        title: `Campaign waiting for your approval: ${c.name}`, text: `From ${c.requestedBy || c.createdBy}${c.total ? `, ${c.total} recipients` : ""}` });
    }
    return out;
  }
  async function loadCamp(user, id) {
    const t = await table("mkcampaigns");
    for (const co of cos(user)) { const e = await getOrNull(t, co, id); if (e) return e; }
    fail(404, "This campaign doesn't exist or was deleted.");
  }
  function sanitizeBlocks(list) {
    if (!Array.isArray(list)) return [];
    const s = (v, n) => clean(v, n);
    return list.slice(0, 60).filter(b => b && BLOCKS.includes(b.t)).map(b => {
      const o = { t: b.t, id: s(b.id, 20) || crypto.randomBytes(4).toString("hex") };
      for (const k of ["title", "kicker", "btn", "url", "img", "alt", "caption", "by", "align", "style", "side", "size", "w"]) if (b[k] != null && b[k] !== "") o[k] = s(b[k], k === "url" || k === "img" ? 1000 : 300);
      if (b.text != null) o.text = s(b.text, 6000);
      if (b.h != null) o.h = Math.max(8, Math.min(80, Number(b.h) || 24));
      if (b.t === "html") o.html = s(b.html, 20000);
      if (Array.isArray(b.items)) o.items = b.items.slice(0, 4).map(i => ({ title: s(i && i.title, 120), text: s(i && i.text, 600), v: s(i && i.v, 30), l: s(i && i.l, 80) }));
      return o;
    });
  }
  function campFields(b, extra) {
    const audience = b.audience && typeof b.audience === "object" ? { mode: b.audience.mode === "tags" ? "tags" : "all", tags: tagList(b.audience.tags) } : { mode: "all", tags: [] };
    return { name: clean(b.name, 150) || "Untitled campaign", subject: clean(b.subject, 200), preheader: clean(b.preheader, 250), audience: JSON.stringify(audience),
      ...packJson({ blocks: sanitizeBlocks(b.blocks), edition: clean(b.edition, 60), style: styleOf(b.style), ...(extra || {}) }) };
  }
  // Design style (see mk-render STYLES); unknown values fall back to the house look.
  function styleOf(v) { return require("./mk-render").STYLE_KEYS.includes(v) ? v : "signature"; }
  const newId = p => { const t = new Date(Date.now() + 4 * 3600e3).toISOString(); return `${p}-${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`; };
  async function createCamp(user, b) {
    const co = writeCo(user);
    const e = { partitionKey: co, rowKey: newId("CMP"), ...campFields(b), status: "draft", createdBy: user.email, createdAt: now(), updatedBy: user.email, updatedAt: now() };
    await (await table("mkcampaigns")).createEntity(e);
    return campFull(await (await table("mkcampaigns")).getEntity(co, e.rowKey));
  }
  async function saveCamp(user, id, b) {
    const cur = await loadCamp(user, id); writeCo(user);
    if (!["draft", "approval", "scheduled"].includes(cur.status)) fail(409, `This campaign is ${cur.status}, so its content can't be changed. Duplicate it to make a new version.`);
    // Keep what Trend Radar recorded (the source news and Claude's subject ideas) through edits.
    const prev = unpackJson(cur), keep = {};
    if (prev.trend) keep.trend = prev.trend;
    if (prev.subjectIdeas) keep.subjectIdeas = prev.subjectIdeas;
    const next = { partitionKey: cur.partitionKey, rowKey: id, ...campFields(b, keep), updatedBy: user.email, updatedAt: now() };
    // A team member changing an approved campaign sends it back to a manager.
    if (cur.status === "scheduled" && !user.isManager) Object.assign(next, { status: "approval", requestedBy: user.email, requestedAt: now(), approvedBy: "", approvedAt: "", lastNote: "Changed after approval, so it needs approving again." });
    for (let i = 0; i < 20; i++) if (cur["data" + i] != null && next["data" + i] == null) next["data" + i] = "";
    if (user.aud) user.aud.name = next.name;
    try { await (await table("mkcampaigns")).updateEntity(next, "Merge", { etag: b.etag || cur.etag }); }
    catch (err) { if (err.statusCode === 412) fail(409, "Someone else saved this campaign after you opened it. Reload to see their version."); throw err; }
    return campFull(await (await table("mkcampaigns")).getEntity(cur.partitionKey, id));
  }
  async function audienceCount(co, audience) {
    const want = (audience.tags || []).map(s => s.toLowerCase()); let n = 0;
    for await (const e of (await table("mkcontacts")).listEntities({ queryOptions: { filter: `PartitionKey eq '${co}' and status eq 'subscribed'`, select: ["tags"] } })) {
      if (audience.mode === "tags" && !want.some(t => tagList(e.tags).map(x => x.toLowerCase()).includes(t))) continue; n++;
    }
    return n;
  }
  async function setState(user, id, action, b) {
    const cur = await loadCamp(user, id); const co = writeCo(user);
    const t = await table("mkcampaigns"); const st = cur.status;
    const patch = { partitionKey: co, rowKey: id, updatedBy: user.email, updatedAt: now() };
    if (user.aud) user.aud.name = cur.name;
    if (action === "schedule") {
      if (!["draft", "scheduled"].includes(st)) fail(409, `This campaign is ${st} and can't be scheduled.`);
      const c = campFull(cur);
      if (!c.subject) fail(400, "Add a subject line first.");
      if (!(c.blocks || []).length) fail(400, "Add some content first.");
      const at = b.at ? new Date(b.at) : new Date();
      if (isNaN(at)) fail(400, "Pick a valid date and time.");
      if (at.getTime() < Date.now() - 5 * 60000) fail(400, "That time has already passed. Pick a time in the future, or Send now.");
      const n = await audienceCount(co, c.audience);
      if (!n) fail(400, "Nobody in this audience is subscribed. Choose a different audience or import contacts.");
      // Managers' scheduling is the approval; anyone else's waits for a manager.
      if (user.isManager) Object.assign(patch, { status: "scheduled", scheduledAt: at.toISOString(), scheduledBy: user.email, approvedBy: user.email, approvedAt: now(), total: n, lastNote: "" });
      else Object.assign(patch, { status: "approval", scheduledAt: at.toISOString(), scheduledBy: user.email, requestedBy: user.email, requestedAt: now(), approvedBy: "", approvedAt: "", total: n, lastNote: "" });
      if (user.aud) user.aud.detail = `${n} recipient(s), ${at.toISOString()}${user.isManager ? "" : ", sent for approval"}`;
    } else if (action === "approve") {
      if (!user.isManager) fail(403, "Only a manager can approve a campaign.");
      if (st !== "approval") fail(409, "This campaign isn't waiting for approval.");
      const c = campFull(cur); const n = await audienceCount(co, c.audience);
      if (!n) fail(400, "Nobody in this audience is subscribed any more. Return it to draft instead.");
      // A requested time that has passed while it waited means "send now".
      const at = cur.scheduledAt && Date.parse(cur.scheduledAt) > Date.now() ? cur.scheduledAt : new Date().toISOString();
      Object.assign(patch, { status: "scheduled", scheduledAt: at, approvedBy: user.email, approvedAt: now(), total: n, lastNote: "" });
      if (user.aud) user.aud.detail = `Approved; ${n} recipient(s), ${at}`;
    } else if (action === "reject") {
      if (!user.isManager) fail(403, "Only a manager can return a campaign.");
      if (st !== "approval") fail(409, "This campaign isn't waiting for approval.");
      const why = clean(b && b.reason, 300);
      Object.assign(patch, { status: "draft", scheduledAt: "", approvedBy: "", approvedAt: "", lastNote: `Returned to draft by ${user.email}${why ? ": " + why : ""}` });
    } else if (action === "unschedule") { if (!["scheduled", "approval"].includes(st)) fail(409, "Only a scheduled campaign can be moved back to draft."); Object.assign(patch, { status: "draft", scheduledAt: "", approvedBy: "", approvedAt: "" }); }
    else if (action === "pause") { if (st !== "sending") fail(409, "Only a campaign that is sending can be paused."); patch.status = "paused"; }
    else if (action === "resume") { if (st !== "paused") fail(409, "Only a paused campaign can be resumed."); patch.status = "sending"; }
    else if (action === "cancel") { if (!["approval", "scheduled", "sending", "paused"].includes(st)) fail(409, "This campaign isn't waiting to send."); patch.status = "cancelled"; }
    else fail(404, "Unknown request.");
    try { await t.updateEntity(patch, "Merge", { etag: cur.etag }); }
    catch (err) { if (err.statusCode === 412) fail(409, "The campaign changed while you were doing this (the sender may have just started it). Reload and try again."); throw err; }
    return campFull(await t.getEntity(co, id));
  }
  async function deleteCamp(user, id) {
    const cur = await loadCamp(user, id); writeCo(user);
    if (!user.isManager && cur.createdBy !== user.email) fail(403, "Only the person who created this campaign or a manager can delete it.");
    if (["sending", "paused"].includes(cur.status)) fail(409, "Cancel this campaign before deleting it.");
    if (user.aud) user.aud.name = cur.name;
    await (await table("mkcampaigns")).deleteEntity(cur.partitionKey, id);
  }
  async function duplicateCamp(user, id) {
    const c = campFull(await loadCamp(user, id));
    return createCamp(user, { ...c, name: c.name.replace(/( \(copy( \d+)?\))?$/, "") + " (copy)" });
  }
  async function testSend(user, id, b) {
    const cur = await loadCamp(user, id); const co = writeCo(user);
    const c = { ...campFull(cur), co, id };
    // Test what's on screen: the page sends its unsaved content along.
    if (b && b.draft) Object.assign(c, { subject: clean(b.draft.subject, 200), preheader: clean(b.draft.preheader, 250), blocks: sanitizeBlocks(b.draft.blocks), edition: clean(b.draft.edition, 60), style: styleOf(b.draft.style) });
    const to = [...new Set((Array.isArray(b.to) ? b.to : String(b.to || "").split(/[,;\s]+/)).map(x => clean(x, 200).toLowerCase()).filter(Boolean))];
    if (!to.length) fail(400, "Enter an email address to send the test to.");
    if (to.length > 5) fail(400, "Send a test to at most 5 addresses.");
    const bad = to.find(x => !emailRe.test(x)); if (bad) fail(400, `${bad} isn't a valid email address.`);
    if (!c.subject) fail(400, "Add a subject line first.");
    const brand = await S.brand(co);
    const R = require("./mk-render");
    const rendered = R.renderEmail(c, brand, { base: S.publicUrl(co) });
    const nm = String(user.email).split("@")[0].split(/[._-]/)[0];
    const p = { email: to[0], first_name: nm.charAt(0).toUpperCase() + nm.slice(1), name: "", company: "" };
    let sent = 0;
    for (const addr of to) {
      const m = S.compose(c, brand, rendered, { ...p, email: addr });
      try { await S.sendOne({ co, to: addr, name: "", subject: "[Test] " + m.subject, html: m.html, text: m.text, replyTo: brand.replyTo, campaignId: id }); sent++; }
      catch (err) { if (err.status === 429) fail(429, "Azure's sending limit was reached. Try the test again in a few minutes."); fail(err.status === 501 ? 501 : 502, err.message); }
    }
    await S.countSends(sent);
    if (user.aud) { user.aud.name = cur.name; user.aud.detail = "To " + to.join(", "); }
    return { sent, to };
  }
  async function report(user, id) {
    const cur = await loadCamp(user, id);
    const out = { ...(await S.counts(id)), failedList: [], unsubscribed: 0 };
    for await (const e of (await table("mksends")).listEntities({ queryOptions: { filter: `PartitionKey eq '${id}' and status eq 'failed'` } })) { out.failedList.push({ email: e.email, error: e.error || "" }); if (out.failedList.length >= 200) break; }
    for await (const e of (await table("mkcontacts")).listEntities({ queryOptions: { filter: `PartitionKey eq '${cur.partitionKey}' and unsubCampaign eq '${id}'`, select: ["RowKey"] } })) out.unsubscribed++;
    return out;
  }

  // ---------- saved templates ----------
  async function listTemplates(user) {
    const t = await table("mktemplates"); const out = [];
    for (const co of cos(user)) for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${co}'` } })) out.push({ id: e.rowKey, co, name: e.name, createdBy: e.createdBy, createdAt: e.createdAt, ...unpackJson(e) });
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  async function saveTemplate(user, b) {
    const co = writeCo(user);
    const e = { partitionKey: co, rowKey: newId("TPL"), name: clean(b.name, 120) || "Saved design", ...packJson({ subject: clean(b.subject, 200), preheader: clean(b.preheader, 250), edition: clean(b.edition, 60), style: styleOf(b.style), blocks: sanitizeBlocks(b.blocks) }), createdBy: user.email, createdAt: now() };
    await (await table("mktemplates")).createEntity(e);
    if (user.aud) user.aud.name = e.name;
    return { id: e.rowKey, name: e.name };
  }
  async function deleteTemplate(user, id) {
    const co = writeCo(user); const t = await table("mktemplates");
    const cur = await getOrNull(t, co, id); if (!cur) return;
    if (!user.isManager && cur.createdBy !== user.email) fail(403, "Only the person who saved this design or a manager can delete it.");
    if (user.aud) user.aud.name = cur.name;
    await t.deleteEntity(co, id);
  }

  // ---------- media library ----------
  let media;
  async function mediaBox() {
    if (!media) {
      const cs = process.env.STORAGE_CONNECTION; if (!cs) fail(500, "Storage is not set up yet. Add the STORAGE_CONNECTION setting to the Static Web App.");
      media = BlobServiceClient.fromConnectionString(cs).getContainerClient("mk-media");
      await media.createIfNotExists();
    }
    return media;
  }
  async function listMedia(user) {
    const c = await mediaBox(); const out = [];
    for (const co of cos(user)) for await (const b of c.listBlobsFlat({ prefix: co + "/", includeMetadata: true })) {
      const m = b.metadata || {};
      out.push({ id: b.name.split("/")[1], co, url: `/api/public/m/${b.name}`, name: decodeURIComponent(m.name || b.name), by: m.by || "", at: m.at || (b.properties.createdOn && b.properties.createdOn.toISOString()) || "", size: b.properties.contentLength || 0, w: Number(m.w) || 0, h: Number(m.h) || 0 });
    }
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }
  async function uploadMedia(user, b) {
    const co = writeCo(user);
    const ext = MEDIA_TYPES[String(b.type || "").toLowerCase()];
    if (!ext) fail(400, "Upload a JPG, PNG, GIF or WebP image.");
    const buf = Buffer.from(String(b.data || ""), "base64");
    if (!buf.length) fail(400, "The file is empty.");
    if (buf.length > MEDIA_MAX) fail(413, "Images can be at most 5 MB. Large images also load slowly in email; aim for under 500 KB.");
    const name = clean(b.name, 150) || "image." + ext;
    const id = crypto.randomBytes(8).toString("hex") + "." + ext;
    await (await mediaBox()).getBlockBlobClient(`${co}/${id}`).uploadData(buf, { blobHTTPHeaders: { blobContentType: b.type, blobCacheControl: "public, max-age=31536000, immutable" },
      metadata: { name: encodeURIComponent(name), by: user.email, at: now(), w: String(Number(b.w) || 0), h: String(Number(b.h) || 0) } });
    if (user.aud) user.aud.name = name;
    return { id, co, url: `/api/public/m/${co}/${id}`, name, by: user.email, at: now(), size: buf.length, w: Number(b.w) || 0, h: Number(b.h) || 0 };
  }
  async function deleteMedia(user, id) {
    const co = writeCo(user); const blob = (await mediaBox()).getBlockBlobClient(`${co}/${clean(id, 40)}`);
    let props; try { props = await blob.getProperties(); } catch (e) { if (e.statusCode === 404) return; throw e; }
    const by = (props.metadata || {}).by;
    if (!user.isManager && by !== user.email) fail(403, "Only the person who uploaded this image or a manager can delete it.");
    if (user.aud) user.aud.name = decodeURIComponent((props.metadata || {}).name || id);
    await blob.deleteIfExists();
  }

  // ---------- settings (managers) ----------
  async function saveSettings(user, b) {
    if (!user.isManager) fail(403, "Only managers can change the campaign settings.");
    const co = writeCo(user);
    const replyTo = clean(b.replyTo, 150).toLowerCase();
    if (replyTo && !emailRe.test(replyTo)) fail(400, "The reply-to address isn't valid.");
    const socials = {};
    for (const k of ["linkedin", "instagram", "facebook", "x", "tiktok", "youtube", "whatsapp"]) { const v = clean(b.socials && b.socials[k], 300); if (v) socials[k] = v; }
    await (await table("mksettings")).upsertEntity({ partitionKey: "settings", rowKey: co, replyTo, website: clean(b.website, 200), address: clean(b.address, 300), footerNote: clean(b.footerNote, 400), socials: JSON.stringify(socials), updatedBy: user.email, updatedAt: now() }, "Replace");
    return S.settings(co);
  }

  async function bootstrap(user) {
    const co = user.co === "all" ? user.homeCo : user.co;
    const [settings, brand] = await Promise.all([S.settings(co), S.brand(co)]);
    let used = 0; try { used = await S.usedLastHour(); } catch {}
    let sched = {}; try { sched = await S.scheduler(); } catch {}
    // Contact totals and list sizes, for the KPIs and the audience picker.
    const stats = { subscribed: 0, unsubscribed: 0, total: 0 }; const tags = {};
    for await (const e of (await table("mkcontacts")).listEntities({ queryOptions: { filter: `PartitionKey eq '${co}'`, select: ["status", "tags"] } })) {
      stats.total++; if ((e.status || "subscribed") === "subscribed") { stats.subscribed++; tagList(e.tags).forEach(t => { tags[t] = (tags[t] || 0) + 1; }); } else stats.unsubscribed++;
    }
    return { co, readOnly: user.co === "all", isManager: user.isManager, me: user.email, sending: { ...S.status(co), usedLastHour: used, scheduler: sched, tick: String(process.env.MK_CRON_KEY || "").length >= 16 }, ai: !!process.env.ANTHROPIC_API_KEY, settings, brand,
      contacts: stats, tags: Object.entries(tags).map(([name, n]) => ({ name, n })).sort((a, b) => a.name.localeCompare(b.name)) };
  }

  // ---------- Claude drafting (profiles, layout and rules live in mk-ai.js, shared with Trend Radar) ----------
  const AI = require("./mk-ai");
  function aiPrompt(co, b) {
    if (b.kind === "campaign") return AI.campaignPrompt(co, { brief: clean(b.brief, 3000), audience: b.audience, url: b.url, length: b.length, tone: b.tone });
    if (b.kind === "subjects") return `You write email subject lines for ${AI.NAMES[co]}.\n${AI.PROFILES[co]}\nEmail summary:\n${clean(b.summary, 3000)}\nCurrent subject: ${clean(b.subject, 200) || "none"}\n${AI.RULES}\nReply with ONLY JSON: {"subjects": [5 subject lines, varied styles], "preheader": one preview text under 100 characters}.`;
    if (b.kind === "rewrite") return `You edit marketing email copy for ${AI.NAMES[co]}.\n${AI.PROFILES[co]}\nInstruction: ${clean(b.instruction, 300) || "Make it clearer and more engaging"}\nText to rewrite (keep the same light markup: blank lines between paragraphs, "- " bullets, **bold**, [label](url)):\n${clean(b.text, 4000)}\n${AI.RULES}\nReply with ONLY JSON: {"text": rewritten text}.`;
    return null;
  }
  async function ai(user, b) {
    const co = writeCo(user);
    if (!process.env.ANTHROPIC_API_KEY) fail(501, "Claude drafting isn't set up on the tools site yet (the ANTHROPIC_API_KEY setting is missing).");
    const prompt = aiPrompt(co, b || {});
    if (!prompt) fail(400, "Unknown drafting request.");
    if (b.kind === "campaign" && !clean(b.brief, 3000)) fail(400, "Describe what the email should be about.");
    let out;
    try { out = await AI.claudeJson(prompt, { maxTokens: b.kind === "campaign" ? 2600 : 900 }); }
    catch (e) { fail(e.status || 502, e.message); }
    if (out.blocks) out.blocks = sanitizeBlocks(out.blocks);
    if (user.aud) user.aud.name = b.kind === "campaign" ? clean(b.brief, 80) : b.kind;
    return out;
  }

  // ---------- Trend Radar (src/radar.js): vendor news scored by Claude, campaigns drafted from it ----------
  let radarMod;
  const RD = () => radarMod || (radarMod = require("./radar")({ table }));
  async function radarRoute(method, seg, user, body) {
    const [, id, itemId, act] = seg;
    const co = user.co === "all" ? user.homeCo : user.co;
    if (!id && method === "GET") return { ...(await RD().list(co)), isManager: user.isManager, ai: !!process.env.ANTHROPIC_API_KEY };
    if (id === "settings" && method === "PUT") {
      if (!user.isManager) fail(403, "Only managers can change the Trend Radar settings.");
      writeCo(user);
      const owner = clean(body.owner, 150).toLowerCase();
      if (owner && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner)) fail(400, "Enter a valid email address for who gets the trend drafts, or leave it empty for the managers.");
      if (owner && !owner.endsWith("@" + (co === "techhub" ? "techhubrak.ae" : "bifoldtech.com"))) fail(400, "The person who gets the trend drafts must be in your company.");
      const s = await RD().saveSettings(co, { ...body, owner }, user.email);
      if (user.aud) user.aud.detail = `${Object.values(s.vendors).filter(Boolean).length} vendors, score ${s.minScore}+, ${s.maxDrafts} drafts a day`;
      return s;
    }
    if (id === "items" && itemId && method === "POST") {
      writeCo(user);
      const row = await RD().item(co, clean(itemId, 40));
      if (!row) fail(404, "This news item is no longer on the radar.");
      if (user.aud) user.aud.name = row.title;
      if (act === "dismiss") { await RD().dismiss(co, row.rowKey, user.email); return { ok: true }; }
      if (act === "draft") {
        if (row.campaignId) { const c = await getOrNull(await table("mkcampaigns"), co, row.campaignId); if (c) return { id: row.campaignId, existing: true }; }
        if (!process.env.ANTHROPIC_API_KEY) fail(501, "Claude drafting isn't set up on the tools site yet (the ANTHROPIC_API_KEY setting is missing).");
        try { return await RD().draftCampaign(co, row, user.email, { timeoutMs: 34000, articleMs: 6000 }); }
        catch (e) { fail(e.status || 502, e.message); }
      }
    }
    fail(404, "Unknown request.");
  }

  // ---------- routes (signed in, section "campaigns") ----------
  let renderSrc;
  async function route(method, seg, user, body) {
    const [a, id, sub] = seg;
    if (a === "render.js" && method === "GET") {
      renderSrc = renderSrc || fs.readFileSync(path.join(__dirname, "mk-render.js"));
      return { __binary: renderSrc, headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "private, max-age=300" } };
    }
    if (a === "bootstrap" && method === "GET") return bootstrap(user);
    if (a === "contacts") {
      if (!id && method === "GET") return listContacts(user);
      if (!id && method === "POST") return addContact(user, body);
      if (id === "import" && method === "POST") return importContacts(user, body);
      if (id === "bulk" && method === "POST") return bulkContacts(user, body);
      if (id && method === "PUT") return editContact(user, id, body);
    }
    if (a === "campaigns") {
      if (!id && method === "GET") return listCampaigns(user);
      if (!id && method === "POST") return createCamp(user, body);
      if (id && !sub && method === "GET") return campFull(await loadCamp(user, id));
      if (id && !sub && method === "PUT") return saveCamp(user, id, body);
      if (id && !sub && method === "DELETE") return deleteCamp(user, id);
      if (id && sub === "test" && method === "POST") return testSend(user, id, body);
      if (id && sub === "duplicate" && method === "POST") return duplicateCamp(user, id);
      if (id && sub === "report" && method === "GET") return report(user, id);
      if (id && ["schedule", "unschedule", "approve", "reject", "pause", "resume", "cancel"].includes(sub) && method === "POST") return setState(user, id, sub, body);
    }
    if (a === "audience" && method === "POST") { const co = writeCo(user); return { count: await audienceCount(co, { mode: body.mode === "tags" ? "tags" : "all", tags: tagList(body.tags) }) }; }
    if (a === "templates") {
      if (!id && method === "GET") return listTemplates(user);
      if (!id && method === "POST") return saveTemplate(user, body);
      if (id && method === "DELETE") return deleteTemplate(user, id);
    }
    if (a === "media") {
      if (!id && method === "GET") return listMedia(user);
      if (!id && method === "POST") return uploadMedia(user, body);
      if (id && method === "DELETE") return deleteMedia(user, id);
    }
    if (a === "settings" && method === "PUT") return saveSettings(user, body);
    if (a === "ai" && method === "POST") return ai(user, body);
    if (a === "radar") return radarRoute(method, seg, user, body);
    fail(404, "Unknown request.");
  }

  // ---------- public routes (no sign-in): unsubscribe and email images ----------
  async function publicRoute(method, seg, ip) {
    const [a] = seg;
    // Scheduler tick: an outside scheduler (cron-job.org, an Azure Logic App) calls
    // /api/public/tick/<MK_CRON_KEY> every few minutes so scheduled campaigns go out on time.
    if (a === "tick") {
      const want = String(process.env.MK_CRON_KEY || ""), got = String(seg[1] || "");
      if (want.length < 16) fail(404, "Not found.");
      if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) fail(403, "Not allowed.");
      const r = await S.pump({ source: "tick", deadline: Date.now() + 30000 });
      return { ok: true, ...r, at: now() };
    }
    if (a === "m" && method === "GET") {
      const [, co, file] = seg;
      if (!/^(bifold|techhub)$/.test(co) || !/^[a-f0-9]{16}\.(png|jpg|gif|webp)$/.test(file || "")) fail(404, "Not found.");
      let buf, type;
      try { const blob = (await mediaBox()).getBlockBlobClient(`${co}/${file}`); const p = await blob.getProperties(); type = p.contentType; buf = await blob.downloadToBuffer(); }
      catch (e) { if (e.statusCode === 404) fail(404, "Not found."); throw e; }
      return { __binary: buf, headers: { "Content-Type": type || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } };
    }
    if (a === "unsub") {
      const [, co, e64, sig, cid, act] = seg;
      const email = S.checkToken(co, e64, sig);
      if (!email) fail(400, "This unsubscribe link isn't valid. Copy the full link from the email, or reply to the email and ask to be removed.");
      const t = await table("mkcontacts"); const key = S.contactKey(email);
      const cur = await getOrNull(t, co, key);
      const masked = email.replace(/^(.)(.*)(@.*)$/, (m, f, mid, d) => f + "*".repeat(Math.min(6, Math.max(2, mid.length))) + d);
      const out = st => ({ company: S.NAMES[co], co, email: masked, status: st });
      if (method === "GET") return out(cur ? cur.status : "unknown");
      if (method !== "POST") fail(405, "Not allowed.");
      if (act === "resubscribe") {
        if (cur && cur.status === "unsubscribed") {
          await t.updateEntity({ partitionKey: co, rowKey: key, status: "subscribed", unsubscribedAt: "", unsubVia: "Re-subscribed from the unsubscribe page", updatedAt: now() }, "Merge");
          await record({ email, co, method: "POST", seg: ["mk", "public-resub"], body: {}, out: {}, status: 200, error: "", ip, aud: { name: email } });
        }
        return out(cur ? "subscribed" : "unknown");
      }
      if (!cur) {
        // Not in the list (deleted, or never imported): keep a suppression row so a later import can't add them back as subscribed.
        await t.upsertEntity({ partitionKey: co, rowKey: key, email, status: "unsubscribed", unsubscribedAt: now(), unsubVia: "Email link", unsubCampaign: clean(cid, 40), source: "Unsubscribe link", createdAt: now() }, "Merge");
      } else if (cur.status !== "unsubscribed") {
        await t.updateEntity({ partitionKey: co, rowKey: key, status: "unsubscribed", unsubscribedAt: now(), unsubVia: "Email link", unsubCampaign: cid && cid !== "-" ? clean(cid, 40) : "", updatedAt: now() }, "Merge");
      } else return out("unsubscribed");
      await record({ email, co, method: "POST", seg: ["mk", "public-unsub"], body: { campaign: cid }, out: {}, status: 200, error: "", ip, aud: { name: email } });
      return out("unsubscribed");
    }
    fail(404, "Not found.");
  }

  return { route, publicRoute, approvals };
};
