// Email Campaigns: sending through Azure Communication Services (ACS) Email, the one-click unsubscribe
// links, and the "pump" that works through scheduled campaigns. Used by the API (test sends) and by the
// scheduled sender job (.github/scripts/mk-sender.cjs), so both follow the same rules.
//
// Settings (Static Web App settings and GitHub Actions secrets):
//   ACS_CONNECTION        connection string of the Communication Services resource (endpoint=...;accesskey=...)
//   MK_SENDER_BIFOLD      verified sender address for Bifold campaigns, e.g. news@mail.bifoldtech.com
//   MK_SENDER_TECHHUB     verified sender address for Tech Hub campaigns, e.g. news@mail.techhubrak.ae
//   MK_PUBLIC_URL         public address of the tools site, used for unsubscribe links and images
//                         (MK_PUBLIC_URL_TECHHUB overrides it for Tech Hub, e.g. https://tools.techhubrak.ae)
//   MK_PER_MINUTE / MK_PER_HOUR   sending limits of the ACS resource (default 30 / 100, Microsoft's starting quota)
//   MK_SECRET             optional key for signing unsubscribe links (derived from STORAGE_CONNECTION when not set)

const crypto = require("crypto");
const R = require("./mk-render");

const DEFAULT_URL = "https://yellow-dune-0607b0710.4.azurestaticapps.net";
const NAMES = { bifold: "Bifold Technologies L.L.C", techhub: "Tech Hub Information Technology" };
const ADDRESSES = { bifold: "Office A306, Saraya Avenue, Al Garhoud, Dubai, United Arab Emirates", techhub: "Blue Building, Injaz Road, Al Nakheel, Ras Al Khaimah, United Arab Emirates" };
const WEBSITES = { bifold: "https://www.bifoldtech.com", techhub: "https://www.techhubrak.ae" };
const SOCIALS = {
  bifold: {},
  techhub: { linkedin: "https://www.linkedin.com/company/techhub-rak", instagram: "https://instagram.com/techhubrak", facebook: "https://facebook.com/techhubrak", x: "https://x.com/techhubrak", tiktok: "https://tiktok.com/@tech.hub302", whatsapp: "https://wa.me/97172581926" },
};

const b64u = s => Buffer.from(String(s), "utf8").toString("base64url");
const unb64u = s => { try { return Buffer.from(String(s), "base64url").toString("utf8"); } catch { return ""; } };
const contactKey = email => crypto.createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex").slice(0, 32);
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = function makeSender(H) {
  const { table, getOrNull, env = process.env, log = console } = H;
  const secret = () => env.MK_SECRET || crypto.createHash("sha256").update("mk-unsub|" + (env.STORAGE_CONNECTION || "")).digest("hex");
  const publicUrl = co => String((co === "techhub" && env.MK_PUBLIC_URL_TECHHUB) || env.MK_PUBLIC_URL || DEFAULT_URL).replace(/\/+$/, "");
  const senderFor = co => String(co === "techhub" ? env.MK_SENDER_TECHHUB || "" : env.MK_SENDER_BIFOLD || "").trim();
  const perMinute = () => Math.max(1, Number(env.MK_PER_MINUTE) || 30);
  const perHour = () => Math.max(1, Number(env.MK_PER_HOUR) || 100);

  function acs() {
    const cs = String(env.ACS_CONNECTION || "");
    const endpoint = (cs.match(/endpoint=([^;]+)/i) || [])[1];
    const key = (cs.match(/accesskey=([^;]+)/i) || [])[1];
    return endpoint && key ? { endpoint: endpoint.replace(/\/+$/, ""), key } : null;
  }
  const status = co => ({ acs: !!acs(), sender: senderFor(co), ready: !!acs() && !!senderFor(co), publicUrl: publicUrl(co), perMinute: perMinute(), perHour: perHour() });

  // ---------- unsubscribe links ----------
  const sign = (co, email) => crypto.createHmac("sha256", secret()).update(co + "|" + String(email).toLowerCase()).digest("base64url").slice(0, 24);
  function unsubLinks(co, email, campaignId) {
    const parts = [co, b64u(String(email).toLowerCase()), sign(co, email), campaignId || "-"].map(encodeURIComponent).join("/");
    return { page: `${publicUrl(co)}/u/?k=${parts}`, post: `${publicUrl(co)}/api/public/unsub/${parts}` };
  }
  function checkToken(co, e64, sig) {
    const email = unb64u(e64).toLowerCase();
    if (!/^(bifold|techhub)$/.test(co) || !email || !sig) return null;
    const want = sign(co, email);
    return want.length === String(sig).length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(sig))) ? email : null;
  }

  // ---------- brand used in the email footer ----------
  async function settings(co) {
    const e = await getOrNull(await table("mksettings"), "settings", co);
    let socials = SOCIALS[co] || {};
    try { if (e && e.socials) socials = JSON.parse(e.socials); } catch {}
    return {
      replyTo: (e && e.replyTo) || "", website: (e && e.website) || WEBSITES[co], address: (e && e.address) || ADDRESSES[co],
      footerNote: (e && e.footerNote) || "", socials, updatedBy: (e && e.updatedBy) || "", updatedAt: (e && e.updatedAt) || "",
    };
  }
  async function brand(co, s) {
    s = s || await settings(co);
    return { key: co, name: NAMES[co], logo: `${publicUrl(co)}/email/${co}.png`, address: s.address, website: s.website, socials: s.socials, footerNote: s.footerNote, replyTo: s.replyTo };
  }

  // ---------- rate limit (shared by both companies: ACS limits are per resource) ----------
  // One row keeps a count per minute for the last hour, so test sends from the site and the scheduled job share it.
  async function rateRow() { return getOrNull(await table("mkmeta"), "rate", "acs"); }
  const minutesOf = e => { try { return JSON.parse((e && e.mins) || "{}"); } catch { return {}; } };
  async function usedLastHour() {
    const now = Math.floor(Date.now() / 60000);
    const m = minutesOf(await rateRow());
    return Object.entries(m).reduce((a, [k, v]) => a + (now - Number(k) < 60 ? Number(v) || 0 : 0), 0);
  }
  async function countSends(n) {
    if (!n) return;
    const t = await table("mkmeta");
    for (let i = 0; i < 4; i++) {
      const e = await rateRow();
      const now = Math.floor(Date.now() / 60000);
      const m = minutesOf(e);
      for (const k of Object.keys(m)) if (now - Number(k) >= 60) delete m[k];
      m[now] = (Number(m[now]) || 0) + n;
      try {
        if (e) await t.updateEntity({ partitionKey: "rate", rowKey: "acs", mins: JSON.stringify(m) }, "Merge", { etag: e.etag });
        else await t.createEntity({ partitionKey: "rate", rowKey: "acs", mins: JSON.stringify(m) });
        return;
      } catch (err) { if (err.statusCode !== 412 && err.statusCode !== 409) throw err; }
    }
  }

  // ---------- ACS Email REST call (HMAC-signed; no SDK needed) ----------
  let headersRefused = false;
  async function acsCall(msg) {
    const a = acs();
    const url = new URL("/emails:send?api-version=2023-03-31", a.endpoint);
    const body = JSON.stringify(msg);
    const date = new Date().toUTCString();
    const hash = crypto.createHash("sha256").update(body, "utf8").digest("base64");
    const toSign = `POST\n${url.pathname}${url.search}\n${date};${url.host};${hash}`;
    const sig = crypto.createHmac("sha256", Buffer.from(a.key, "base64")).update(toSign, "utf8").digest("base64");
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(url, { method: "POST", signal: ctl.signal, body, headers: {
        "Content-Type": "application/json", "x-ms-date": date, "x-ms-content-sha256": hash, "Operation-Id": crypto.randomUUID(),
        Authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${sig}` } });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return { id: j.id || r.headers.get("operation-location") || "" };
      const err = new Error((j.error && j.error.message) || `Azure Email answered ${r.status}`);
      err.status = r.status; err.code = j.error && j.error.code; err.retryAfter = Number(r.headers.get("retry-after")) || 0;
      throw err;
    } catch (e) {
      if (e.name === "AbortError") { const err = new Error("Azure Email did not answer in time."); err.status = 504; throw err; }
      throw e;
    } finally { clearTimeout(timer); }
  }
  async function sendOne({ co, to, name, subject, html, text, replyTo, campaignId }) {
    if (!acs()) { const e = new Error("Sending isn't set up yet: the ACS_CONNECTION setting is missing."); e.status = 501; throw e; }
    const from = senderFor(co);
    if (!from) { const e = new Error(`Sending isn't set up for ${NAMES[co]} yet: the ${co === "techhub" ? "MK_SENDER_TECHHUB" : "MK_SENDER_BIFOLD"} setting is missing.`); e.status = 501; throw e; }
    const links = unsubLinks(co, to, campaignId);
    const msg = {
      senderAddress: from,
      recipients: { to: [{ address: to, displayName: String(name || "").slice(0, 100) || undefined }] },
      content: { subject, html, plainText: text },
      userEngagementTrackingDisabled: true,
    };
    if (replyTo) msg.replyTo = [{ address: replyTo }];
    if (!headersRefused) msg.headers = { "List-Unsubscribe": `<${links.post}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    try { return await acsCall(msg); }
    catch (e) {
      // If this ACS resource won't take the one-click headers, send without them (the footer link still works).
      if (e.status === 400 && msg.headers && /header/i.test(e.message)) { headersRefused = true; delete msg.headers; log.warn && log.warn("ACS refused List-Unsubscribe headers; sending without them."); return acsCall(msg); }
      throw e;
    }
  }

  // Builds the personalised message for one person.
  function compose(c, b, rendered, p) {
    const links = unsubLinks(c.co, p.email, c.id);
    const extra = { unsubscribe_url: links.page };
    return {
      subject: R.personalize(c.subject, p, extra, false).slice(0, 250),
      html: R.personalize(rendered.html, p, extra, true),
      text: R.personalize(rendered.text, p, extra, false),
    };
  }

  // ---------- the pump: works through due campaigns within a time budget ----------
  // Campaign states: draft → scheduled → sending → sent (or paused / cancelled / failed).
  // When a scheduled campaign comes due, its audience is frozen into the "mksends" table (one row per person),
  // then rows are sent at the allowed rate. Anyone who unsubscribes in the meantime is skipped.
  async function snapshot(c) {
    const audience = c.audience || { mode: "all", tags: [] };
    const contacts = (await table("mkcontacts"));
    const want = (audience.tags || []).map(s => String(s).toLowerCase());
    const people = [];
    for await (const e of contacts.listEntities({ queryOptions: { filter: `PartitionKey eq '${c.co}' and status eq 'subscribed'` } })) {
      const tags = String(e.tags || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
      if (audience.mode === "tags" && !want.some(t => tags.includes(t))) continue;
      people.push(e);
    }
    const t = await table("mksends");
    const rows = people.map(e => ["upsert", { partitionKey: c.id, rowKey: e.rowKey, email: e.email, firstName: e.firstName || "", lastName: e.lastName || "", company: e.company || "", status: "queued", attempts: 0 }, "Replace"]);
    for (let i = 0; i < rows.length; i += 100) await t.submitTransaction(rows.slice(i, i + 100));
    return people.length;
  }
  async function counts(id) {
    const out = { total: 0, queued: 0, sent: 0, failed: 0, skipped: 0 };
    for await (const e of (await table("mksends")).listEntities({ queryOptions: { filter: `PartitionKey eq '${id}'`, select: ["status"] } })) { out.total++; out[e.status] = (out[e.status] || 0) + 1; }
    return out;
  }

  async function pump({ deadline, dryRun } = {}) {
    deadline = deadline || Date.now() + 8 * 60000;
    const report = { campaigns: 0, sent: 0, failed: 0, skipped: 0, stoppedBy: "" };
    const ct = await table("mkcampaigns");
    const nowIso = new Date().toISOString();
    const due = [];
    for await (const e of ct.listEntities({ queryOptions: { filter: `(status eq 'scheduled' or status eq 'sending') and scheduledAt le '${nowIso}'` } })) due.push(e);
    due.sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
    if (!due.length) { log.log("No campaigns due."); return report; }
    if (!acs()) { log.log("::warning::Campaigns are due but ACS_CONNECTION is not set. Nothing sent."); report.stoppedBy = "not set up"; return report; }

    let budget = perHour() - await usedLastHour();
    const gap = Math.ceil(60000 / perMinute());
    let pending = 0;
    const flush = async () => { const n = pending; pending = 0; await countSends(n); };

    for (const e of due) {
      const c = { ...JSON.parse(chunks(e) || "{}"), id: e.rowKey, co: e.partitionKey, subject: e.subject, preheader: e.preheader, audience: safeJson(e.audience, { mode: "all", tags: [] }) };
      if (!senderFor(c.co)) { log.log(`::warning::${NAMES[c.co]} campaign "${e.name}" is due but ${c.co === "techhub" ? "MK_SENDER_TECHHUB" : "MK_SENDER_BIFOLD"} is not set.`); continue; }
      report.campaigns++;
      if (e.status === "scheduled") {
        if (dryRun) { log.log(`[dry run] would start "${e.name}"`); continue; }
        const n = await snapshot(c);
        await ct.updateEntity({ partitionKey: e.partitionKey, rowKey: e.rowKey, status: "sending", startedAt: new Date().toISOString(), total: n, lastRunAt: new Date().toISOString() }, "Merge");
        log.log(`Started "${e.name}" (${NAMES[c.co]}): ${n} recipient(s).`);
      }
      const b = await brand(c.co);
      const rendered = R.renderEmail(c, b, { base: publicUrl(c.co) });
      // People who unsubscribed (or bounced) since the audience was frozen.
      const blocked = new Set();
      for await (const x of (await table("mkcontacts")).listEntities({ queryOptions: { filter: `PartitionKey eq '${c.co}' and status ne 'subscribed'`, select: ["RowKey"] } })) blocked.add(x.rowKey);
      const st = await table("mksends");
      const queue = [];
      for await (const r of st.listEntities({ queryOptions: { filter: `PartitionKey eq '${c.id}' and status eq 'queued'` } })) queue.push(r);
      let stop = "";
      for (const r of queue) {
        if (Date.now() + gap > deadline) { stop = "time"; break; }
        if (budget <= 0) { stop = "hourly limit"; break; }
        if (blocked.has(r.rowKey)) { await st.updateEntity({ partitionKey: r.partitionKey, rowKey: r.rowKey, status: "skipped", note: "Unsubscribed before sending" }, "Merge"); report.skipped++; continue; }
        if (dryRun) { log.log(`[dry run] would send "${e.name}" to ${r.email}`); continue; }
        const p = { email: r.email, first_name: r.firstName, last_name: r.lastName, name: [r.firstName, r.lastName].filter(Boolean).join(" "), company: r.company };
        const m = compose(c, b, rendered, p);
        const started = Date.now();
        try {
          const res = await sendOne({ co: c.co, to: r.email, name: p.name, ...m, replyTo: b.replyTo, campaignId: c.id });
          budget--; pending++; report.sent++;
          await st.updateEntity({ partitionKey: r.partitionKey, rowKey: r.rowKey, status: "sent", sentAt: new Date().toISOString(), msgId: String(res.id).slice(0, 200) }, "Merge");
        } catch (err) {
          if (err.status === 429) { stop = "rate limited by Azure"; break; }
          if (err.status === 501) { stop = err.message; break; }
          const attempts = (Number(r.attempts) || 0) + 1;
          const permanent = err.status >= 400 && err.status < 500;
          await st.updateEntity({ partitionKey: r.partitionKey, rowKey: r.rowKey, status: permanent || attempts >= 3 ? "failed" : "queued", attempts, error: String(err.message).slice(0, 500) }, "Merge");
          if (permanent || attempts >= 3) report.failed++;
          log.log(`::warning::${r.email}: ${err.message}`);
          if (err.status >= 500 && attempts >= 1) { /* back off a little on server errors */ await sleep(5000); }
        }
        if (pending >= 10) await flush();
        const wait = gap - (Date.now() - started);
        if (wait > 0) await sleep(wait);
      }
      await flush();
      if (dryRun) continue;
      const n = await counts(c.id);
      const done = n.queued === 0;
      await ct.updateEntity({ partitionKey: e.partitionKey, rowKey: e.rowKey, total: n.total, sent: n.sent, failed: n.failed, skipped: n.skipped,
        ...(done ? { status: "sent", completedAt: new Date().toISOString() } : {}), lastRunAt: new Date().toISOString(), lastNote: stop }, "Merge");
      log.log(`"${e.name}": ${n.sent} sent, ${n.failed} failed, ${n.skipped} skipped, ${n.queued} still queued${stop ? " (paused: " + stop + ")" : ""}.`);
      if (stop) { report.stoppedBy = stop; break; }
    }
    return report;
  }
  const chunks = e => { let s = ""; for (let i = 0; i < (e.dataChunks || 0); i++) s += e["data" + i] || ""; return s; };
  const safeJson = (s, d) => { try { return JSON.parse(s || ""); } catch { return d; } };

  return { status, senderFor, publicUrl, unsubLinks, checkToken, settings, brand, sendOne, compose, countSends, usedLastHour, pump, counts, contactKey, NAMES, ADDRESSES, WEBSITES, SOCIALS, perHour, perMinute };
};
module.exports.contactKey = contactKey;
