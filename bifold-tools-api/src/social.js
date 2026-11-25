// Social posts (inside Email Campaigns): Claude drafts one update per news item or brief, written separately for
// LinkedIn, Facebook, Instagram, X and Google Business, with a branded image card. A manager approves it, and the
// scheduler tick publishes it straight to each network (no Buffer). Each company posts only to its own accounts.
//
// Storage (Table Storage, PartitionKey = company unless noted):
//   socialposts  RowKey SP-…        status draft | approval | scheduled | posting | posted | partial | failed | cancelled,
//                                   nets (JSON list), texts (JSON per network), link, image (site path), card (JSON),
//                                   scheduledAt, results (JSON per network: status, id, url, error, at), source, trend
//   socialacct   RowKey <network>   connected account: name, extId, extra (JSON), tok / ref (AES-GCM), exp, by, at
//                PK "oauth"         RowKey <nonce> sign-in in progress; RowKey "pick-<co>-<app>" pages to choose from
//   mksettings   PK "social", RowKey <co>   posting slots, default networks, CTA link, WhatsApp, hashtags, auto drafts
// Images: Blob "mk-media" <co>/<hex>.jpg, public at /api/public/m/<co>/<file> (Instagram fetches it from there).
//
// Network apps (Static Web App settings): META_APP_ID + META_APP_SECRET (Facebook Page and Instagram),
// LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET (needs LinkedIn's Community Management API), X_CLIENT_ID +
// X_CLIENT_SECRET, GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (needs Business Profile API access). Optional SOCIAL_KEY
// encrypts the stored tokens (otherwise a key derived from the other secrets is used).
const crypto = require("crypto");
const AI = require("./mk-ai");
const Card = require("./social-card");

const NETS = {
  linkedin: { label: "LinkedIn", max: 3000, app: "linkedin" },
  facebook: { label: "Facebook", max: 5000, app: "meta" },
  instagram: { label: "Instagram", max: 2200, app: "meta", needsImage: true },
  x: { label: "X", max: 280, app: "x" },
  google: { label: "Google Business", max: 1500, app: "google" },
};
const NET_KEYS = Object.keys(NETS);
const APPS = {
  meta: { label: "Facebook and Instagram", id: "META_APP_ID", secret: "META_APP_SECRET", nets: ["facebook", "instagram"] },
  linkedin: { label: "LinkedIn", id: "LINKEDIN_CLIENT_ID", secret: "LINKEDIN_CLIENT_SECRET", nets: ["linkedin"] },
  x: { label: "X", id: "X_CLIENT_ID", secret: "X_CLIENT_SECRET", nets: ["x"] },
  google: { label: "Google Business", id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET", nets: ["google"] },
};
const GV = () => process.env.META_GRAPH_VERSION || "v23.0";
// LinkedIn retires each monthly API version after about a year, so default to the version from two months ago.
const LIV = () => process.env.LINKEDIN_VERSION || (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 2); return d.toISOString().slice(0, 7).replace("-", ""); })();
const STATUSES = ["draft", "approval", "scheduled", "posting", "posted", "partial", "failed", "cancelled"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DUBAI = 4 * 3600e3; // UTC+4 all year

const DEFAULTS = {
  bifold: { cta: "https://www.bifoldtech.com", whatsapp: "", hashtags: "#BifoldTechnologies #UAE #Dubai", website: "https://www.bifoldtech.com" },
  techhub: { cta: "https://bookings.cloud.microsoft/book/TechHubSales@bifoldtech.com/", whatsapp: "+971 7 258 1926", hashtags: "#TechHubRAK #RasAlKhaimah #RAK", website: "https://www.techhubrak.ae" },
};
const SLOTS = [{ d: "Mon", t: "09:30" }, { d: "Wed", t: "09:30" }, { d: "Thu", t: "09:30" }];

const iso = () => new Date().toISOString();
const cut = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const noDash = s => String(s == null ? "" : s).replace(/\s*—\s*/g, ", ").replace(/–/g, "-");
class SocialError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (status, msg) => { throw new SocialError(status, msg); };

// ---------- token encryption ----------
const KEY = () => crypto.createHash("sha256").update("social|" + (process.env.SOCIAL_KEY || process.env.MK_CRON_KEY || "") + "|" + (process.env.STORAGE_CONNECTION || "")).digest();
function seal(s) {
  if (!s) return "";
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", KEY(), iv);
  const enc = Buffer.concat([c.update(String(s), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
function open(s) {
  if (!s) return "";
  try { const b = Buffer.from(s, "base64"); const d = crypto.createDecipheriv("aes-256-gcm", KEY(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"); }
  catch { return ""; }
}

// ---------- HTTP ----------
async function http(url, { method = "GET", headers = {}, body, form, json: j, ms = 20000, raw } = {}) {
  const h = { ...headers };
  let b = body;
  if (form) { h["Content-Type"] = "application/x-www-form-urlencoded"; b = new URLSearchParams(form).toString(); }
  if (j !== undefined) { h["Content-Type"] = "application/json"; b = JSON.stringify(j); }
  const r = await fetch(url, { method, headers: h, body: b, signal: AbortSignal.timeout(ms) });
  if (raw) return r;
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
  if (!r.ok) {
    const m = (data.error && (data.error.message || data.error_description || (typeof data.error === "string" ? data.error : ""))) || data.message || data.detail || data.title || (data.errors && data.errors[0] && (data.errors[0].message || data.errors[0].detail)) || text.slice(0, 200) || r.statusText;
    const e = new Error(`${r.status}: ${m}`); e.status = r.status; e.data = data; throw e;
  }
  return { data, headers: r.headers };
}

module.exports = function makeSocial({ table, getOrNull, publicUrl, log = console.log }) {
  getOrNull = getOrNull || (async (t, pk, rk) => { try { return await t.getEntity(pk, rk); } catch (e) { if (e.statusCode === 404) return null; throw e; } });
  const base = co => (publicUrl ? publicUrl(co) : (co === "techhub" ? process.env.MK_PUBLIC_URL_TECHHUB : process.env.MK_PUBLIC_URL) || "").replace(/\/$/, "");
  const abs = (co, p) => /^https?:/i.test(p || "") ? p : p ? base(co) + p : "";
  const appReady = k => !!(process.env[APPS[k].id] && process.env[APPS[k].secret]);
  const redirectUri = (co, app) => `${base(co)}/api/mk/social/callback/${app}`;

  // ---------- media ----------
  let media;
  async function mediaBox() {
    if (!media) {
      const { BlobServiceClient } = require("@azure/storage-blob");
      media = BlobServiceClient.fromConnectionString(process.env.STORAGE_CONNECTION).getContainerClient("mk-media");
      await media.createIfNotExists();
    }
    return media;
  }
  async function putImage(co, buf, name, by) {
    const id = crypto.randomBytes(8).toString("hex") + ".jpg";
    await (await mediaBox()).getBlockBlobClient(`${co}/${id}`).uploadData(buf, { blobHTTPHeaders: { blobContentType: "image/jpeg", blobCacheControl: "public, max-age=31536000, immutable" },
      metadata: { name: encodeURIComponent(name || "Social card"), by: by || "", at: iso(), w: "1080", h: "1080" } });
    return `/api/public/m/${co}/${id}`;
  }
  async function getImage(co, p) {
    const m = /^\/api\/public\/m\/(bifold|techhub)\/([a-f0-9]{16}\.(?:png|jpg|gif|webp))$/.exec(p || "");
    if (m) { const b = (await mediaBox()).getBlockBlobClient(`${m[1]}/${m[2]}`); const pr = await b.getProperties(); return { buf: await b.downloadToBuffer(), type: pr.contentType || "image/jpeg" }; }
    const r = await http(abs(co, p), { raw: true }); if (!r.ok) throw new Error("Couldn't load the image (" + r.status + ")");
    return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") || "image/jpeg" };
  }

  // ---------- settings ----------
  async function settings(co) {
    const e = await getOrNull(await table("mksettings"), "social", co);
    const s = json(e && e.data, {});
    const d = DEFAULTS[co] || DEFAULTS.bifold;
    return {
      slots: Array.isArray(s.slots) && s.slots.length ? s.slots : SLOTS,
      nets: Array.isArray(s.nets) ? s.nets.filter(n => NETS[n]) : NET_KEYS.slice(),
      cta: s.cta || d.cta, whatsapp: s.whatsapp != null ? s.whatsapp : d.whatsapp, hashtags: s.hashtags != null ? s.hashtags : d.hashtags,
      autoDraft: s.autoDraft !== false, perDay: Number.isFinite(s.perDay) ? s.perDay : 1, cardN: Number(s.cardN) || 0,
    };
  }
  async function saveSettings(co, b, by) {
    const cur = await settings(co);
    const slots = (Array.isArray(b.slots) ? b.slots : []).map(x => ({ d: DAYS.includes(x && x.d) ? x.d : "", t: /^([01]\d|2[0-3]):[0-5]\d$/.test(x && x.t) ? x.t : "" })).filter(x => x.d && x.t).slice(0, 14);
    if (!slots.length) bad(400, "Add at least one posting time.");
    const cta = cut(b.cta, 300);
    if (cta && !/^https:\/\//i.test(cta)) bad(400, "The call-to-action link must start with https://");
    const s = { slots, nets: (Array.isArray(b.nets) ? b.nets : []).filter(n => NETS[n]), cta, whatsapp: cut(b.whatsapp, 40), hashtags: cut(b.hashtags, 200),
      autoDraft: b.autoDraft !== false, perDay: Math.max(0, Math.min(3, Number(b.perDay) || 0)), cardN: cur.cardN };
    await (await table("mksettings")).upsertEntity({ partitionKey: "social", rowKey: co, data: JSON.stringify(s), updatedBy: by, updatedAt: iso() }, "Replace");
    return settings(co);
  }
  async function nextLayout(co) {
    const s = await settings(co);
    const t = await table("mksettings"); const e = await getOrNull(t, "social", co);
    const data = json(e && e.data, {}); data.cardN = (Number(data.cardN) || 0) + 1;
    await t.upsertEntity({ partitionKey: "social", rowKey: co, data: JSON.stringify(data), updatedAt: iso() }, "Merge").catch(() => {});
    return Card.LAYOUTS[s.cardN % Card.LAYOUTS.length];
  }

  // Next free posting slot (Dubai time) at least 30 minutes away and not already taken.
  async function nextSlot(co, after) {
    const S = await settings(co);
    const taken = new Set();
    for await (const e of (await table("socialposts")).listEntities({ queryOptions: { filter: `PartitionKey eq '${co}' and (status eq 'scheduled' or status eq 'approval')`, select: ["scheduledAt"] } }))
      if (e.scheduledAt) taken.add(String(e.scheduledAt).slice(0, 13));
    const from = Math.max(Date.now() + 30 * 60e3, after ? Date.parse(after) || 0 : 0);
    for (let day = 0; day < 60; day++) {
      const local = new Date(from + DUBAI + day * 864e5);
      const dname = DAYS[local.getUTCDay()];
      const slots = S.slots.filter(s => s.d === dname).map(s => s.t).sort();
      for (const t of slots) {
        const [hh, mm] = t.split(":").map(Number);
        const at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm) - DUBAI;
        if (at < from) continue;
        const k = new Date(at).toISOString().slice(0, 13);
        if (!taken.has(k)) return new Date(at).toISOString();
      }
    }
    return new Date(from).toISOString();
  }

  // ---------- accounts ----------
  async function accounts(co) {
    const out = {};
    for await (const e of (await table("socialacct")).listEntities({ queryOptions: { filter: `PartitionKey eq '${co}'` } }))
      if (NETS[e.rowKey]) out[e.rowKey] = { net: e.rowKey, name: e.name || "", extId: e.extId || "", by: e.by || "", at: e.at || "", exp: e.exp || "", status: e.status || "ok", error: e.lastError || "" };
    const picks = {};
    for (const app of Object.keys(APPS)) { const p = await getOrNull(await table("socialacct"), "oauth", `pick-${co}-${app}`); if (p && Date.now() - Date.parse(p.at) < 30 * 60e3) picks[app] = json(p.list, []).map(x => ({ id: x.id, name: x.name, extra: x.extraName || "" })); }
    return { connected: out, picks, apps: Object.fromEntries(Object.entries(APPS).map(([k, a]) => [k, { label: a.label, ready: appReady(k), nets: a.nets, redirect: redirectUri(co, k) }])) };
  }
  async function account(co, net) {
    const e = await getOrNull(await table("socialacct"), co, net);
    if (!e) return null;
    return { ...e, token: open(e.tok), refresh: open(e.ref), extra: json(e.extra, {}) };
  }
  async function saveAccount(co, net, a) {
    await (await table("socialacct")).upsertEntity({ partitionKey: co, rowKey: net, name: cut(a.name, 200), extId: cut(a.extId, 300), extra: JSON.stringify(a.extra || {}),
      tok: seal(a.token), ref: seal(a.refresh || ""), exp: a.exp || "", by: a.by || "", at: a.at || iso(), status: "ok", lastError: "" }, "Replace");
  }
  async function disconnect(co, net) { await (await table("socialacct")).deleteEntity(co, net).catch(e => { if (e.statusCode !== 404) throw e; }); }

  // Start a sign-in: returns the network's consent URL. The person approves there; the network sends them back to callback().
  async function connectUrl(co, app, by) {
    if (!APPS[app]) bad(404, "Unknown network.");
    if (!appReady(app)) bad(501, `${APPS[app].label} isn't set up yet: add ${APPS[app].id} and ${APPS[app].secret} to the Static Web App settings.`);
    if (!base(co)) bad(501, "The tools site address (MK_PUBLIC_URL) isn't set.");
    const nonce = crypto.randomBytes(18).toString("base64url");
    const verifier = crypto.randomBytes(32).toString("base64url");
    await (await table("socialacct")).upsertEntity({ partitionKey: "oauth", rowKey: nonce, co, app, by, verifier: seal(verifier), at: iso() }, "Replace");
    const id = process.env[APPS[app].id], ru = redirectUri(co, app);
    const q = o => new URLSearchParams(o).toString();
    // Apps set up with "Facebook Login for Business" use a configuration (META_CONFIG_ID) instead of a scope list.
    if (app === "meta") return `https://www.facebook.com/${GV()}/dialog/oauth?` + q({ client_id: id, redirect_uri: ru, state: nonce, response_type: "code",
      ...(process.env.META_CONFIG_ID ? { config_id: process.env.META_CONFIG_ID } : { scope: "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management" }) });
    if (app === "linkedin") return "https://www.linkedin.com/oauth/v2/authorization?" + q({ response_type: "code", client_id: id, redirect_uri: ru, state: nonce, scope: "w_organization_social rw_organization_admin" });
    if (app === "x") return "https://x.com/i/oauth2/authorize?" + q({ response_type: "code", client_id: id, redirect_uri: ru, state: nonce, scope: "tweet.read tweet.write users.read media.write offline.access", code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
    return "https://accounts.google.com/o/oauth2/v2/auth?" + q({ client_id: id, redirect_uri: ru, response_type: "code", scope: "https://www.googleapis.com/auth/business.manage", access_type: "offline", prompt: "consent", state: nonce });
  }

  const nameMatch = (co, s) => (co === "techhub" ? /tech\s*hub/i : /bifold/i).test(String(s || ""));
  // Several pages / organisations / locations: keep the list for 30 minutes so a manager can pick the right one.
  async function offer(co, app, list, by) {
    const m = list.filter(x => nameMatch(co, x.name));
    const one = list.length === 1 ? list[0] : m.length === 1 ? m[0] : null;
    if (one) { await connectChoice(co, app, one, by); return { ok: true, name: one.name }; }
    if (!list.length) bad(404, app === "meta" ? "No Facebook Pages came back. Make sure you're an admin of the company's Page and allowed access to it." : app === "linkedin" ? "No LinkedIn company pages came back. You need to be an admin of the company page." : "No Business Profile locations came back for this Google account.");
    await (await table("socialacct")).upsertEntity({ partitionKey: "oauth", rowKey: `pick-${co}-${app}`, list: JSON.stringify(list), by, at: iso() }, "Replace");
    return { pick: true };
  }
  async function connectChoice(co, app, x, by) {
    if (app === "meta") {
      await saveAccount(co, "facebook", { name: x.name, extId: x.id, token: x.token, by });
      if (x.ig) await saveAccount(co, "instagram", { name: "@" + x.igName, extId: x.ig, token: x.token, extra: { page: x.id }, by });
      else await disconnect(co, "instagram");
    } else if (app === "linkedin") await saveAccount(co, "linkedin", { name: x.name, extId: x.id, token: x.token, refresh: x.refresh, exp: x.exp, by });
    else if (app === "google") await saveAccount(co, "google", { name: x.name, extId: x.id, token: x.token, refresh: x.refresh, exp: x.exp, by });
  }
  async function pick(co, app, id, by) {
    const t = await table("socialacct"); const p = await getOrNull(t, "oauth", `pick-${co}-${app}`);
    if (!p || Date.now() - Date.parse(p.at) > 30 * 60e3) bad(410, "That choice has expired. Connect again.");
    const x = json(p.list, []).find(i => i.id === id); if (!x) bad(404, "Choose one of the listed pages.");
    await connectChoice(co, app, { ...x, token: open(x.tok), refresh: open(x.ref) }, by);
    await t.deleteEntity("oauth", `pick-${co}-${app}`).catch(() => {});
    return { ok: true, name: x.name };
  }

  // The network sent the person back with ?code=…&state=…
  async function callback(app, q, by) {
    const t = await table("socialacct");
    const st = await getOrNull(t, "oauth", String(q.get("state") || "").slice(0, 60) || "-");
    if (!st || st.app !== app || Date.now() - Date.parse(st.at) > 15 * 60e3) bad(400, "This sign-in link has expired. Start again from Settings.");
    await t.deleteEntity("oauth", st.rowKey).catch(() => {});
    if (st.by !== by) bad(403, "Finish the connection in the same account that started it.");
    if (q.get("error")) bad(400, `${APPS[app].label} said: ${q.get("error_description") || q.get("error")}`);
    const code = q.get("code"); if (!code) bad(400, "No approval code came back. Try again.");
    const co = st.co, id = process.env[APPS[app].id], secret = process.env[APPS[app].secret], ru = redirectUri(co, app);
    const seal2 = x => ({ ...x, tok: seal(x.token), ref: seal(x.refresh || ""), token: undefined, refresh: undefined });
    if (app === "meta") {
      const g = `https://graph.facebook.com/${GV()}`;
      const s1 = (await http(`${g}/oauth/access_token?` + new URLSearchParams({ client_id: id, client_secret: secret, redirect_uri: ru, code }))).data;
      const s2 = (await http(`${g}/oauth/access_token?` + new URLSearchParams({ grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: s1.access_token }))).data;
      const pages = (await http(`${g}/me/accounts?` + new URLSearchParams({ fields: "id,name,access_token,instagram_business_account{id,username}", limit: "50", access_token: s2.access_token }))).data.data || [];
      const list = pages.map(p => ({ id: p.id, name: p.name, token: p.access_token, ig: p.instagram_business_account && p.instagram_business_account.id, igName: p.instagram_business_account && p.instagram_business_account.username, extraName: p.instagram_business_account ? "Instagram @" + p.instagram_business_account.username : "No Instagram linked" }));
      const r = await offerSealed(co, app, list, by, seal2);
      return { co, app, ...r };
    }
    if (app === "linkedin") {
      const tok = (await http("https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", form: { grant_type: "authorization_code", code, redirect_uri: ru, client_id: id, client_secret: secret } })).data;
      const H = liHeaders(tok.access_token);
      // Super admins and content admins can both post for a page.
      const all = (await http("https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&state=APPROVED&count=100", { headers: H })).data.elements || [];
      const acls = all.filter(a => ["ADMINISTRATOR", "CONTENT_ADMINISTRATOR", "DIRECT_SPONSORED_CONTENT_POSTER"].includes(a.role));
      const seenOrg = new Set(); for (let i = acls.length - 1; i >= 0; i--) { const o = acls[i].organization || acls[i].organizationTarget; if (seenOrg.has(o)) acls.splice(i, 1); else seenOrg.add(o); }
      const list = [];
      for (const a of acls.slice(0, 20)) {
        const urn = a.organization || a.organizationTarget; const oid = String(urn || "").split(":").pop();
        let name = urn; try { name = (await http(`https://api.linkedin.com/rest/organizations/${oid}`, { headers: H })).data.localizedName || urn; } catch {}
        list.push({ id: urn, name, token: tok.access_token, refresh: tok.refresh_token || "", exp: new Date(Date.now() + (tok.expires_in || 5184000) * 1000).toISOString() });
      }
      return { co, app, ...(await offerSealed(co, app, list, by, seal2)) };
    }
    if (app === "x") {
      const tok = (await http("https://api.x.com/2/oauth2/token", { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") }, form: { grant_type: "authorization_code", code, redirect_uri: ru, code_verifier: open(st.verifier), client_id: id } })).data;
      const me = (await http("https://api.x.com/2/users/me", { headers: { Authorization: "Bearer " + tok.access_token } })).data.data || {};
      await saveAccount(co, "x", { name: "@" + me.username, extId: me.id, token: tok.access_token, refresh: tok.refresh_token, exp: new Date(Date.now() + (tok.expires_in || 7200) * 1000).toISOString(), by });
      return { co, app, ok: true, name: "@" + me.username };
    }
    // google
    const tok = (await http("https://oauth2.googleapis.com/token", { method: "POST", form: { code, client_id: id, client_secret: secret, redirect_uri: ru, grant_type: "authorization_code" } })).data;
    const H = { Authorization: "Bearer " + tok.access_token };
    const accs = (await http("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", { headers: H })).data.accounts || [];
    const list = [];
    for (const a of accs.slice(0, 10)) {
      const locs = (await http(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title&pageSize=100`, { headers: H })).data.locations || [];
      locs.forEach(l => list.push({ id: `${a.name}/${l.name}`, name: l.title, extraName: a.accountName || "", token: tok.access_token, refresh: tok.refresh_token || "", exp: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString() }));
    }
    return { co, app, ...(await offerSealed(co, app, list, by, seal2)) };
  }
  async function offerSealed(co, app, list, by, seal2) {
    const m = list.filter(x => nameMatch(co, x.name));
    const one = list.length === 1 ? list[0] : m.length === 1 ? m[0] : null;
    if (one) { await connectChoice(co, app, one, by); return { ok: true, name: one.name }; }
    return offer(co, app, list.map(seal2), by);
  }
  const liHeaders = tok => ({ Authorization: "Bearer " + tok, "LinkedIn-Version": LIV(), "X-Restli-Protocol-Version": "2.0.0" });

  // Fresh access token for networks whose tokens expire (X every 2 hours, Google every hour, LinkedIn every 60 days).
  async function token(co, net) {
    const a = await account(co, net);
    if (!a || !a.token) bad(409, `${NETS[net].label} isn't connected for this company.`);
    const soon = a.exp && Date.parse(a.exp) - Date.now() < 5 * 60e3;
    if (!soon) return a;
    const app = NETS[net].app, id = process.env[APPS[app].id], secret = process.env[APPS[app].secret];
    if (!a.refresh) bad(401, `The ${NETS[net].label} connection has expired. A manager needs to connect it again in Settings.`);
    let t;
    if (net === "x") t = (await http("https://api.x.com/2/oauth2/token", { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") }, form: { grant_type: "refresh_token", refresh_token: a.refresh, client_id: id } })).data;
    else if (net === "google") t = (await http("https://oauth2.googleapis.com/token", { method: "POST", form: { grant_type: "refresh_token", refresh_token: a.refresh, client_id: id, client_secret: secret } })).data;
    else t = (await http("https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", form: { grant_type: "refresh_token", refresh_token: a.refresh, client_id: id, client_secret: secret } })).data;
    const next = { name: a.name, extId: a.extId, extra: a.extra, token: t.access_token, refresh: t.refresh_token || a.refresh, exp: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(), by: a.by, at: a.at };
    await saveAccount(co, net, next);
    return { ...a, ...next };
  }

  // ---------- publishing, one network at a time ----------
  // LinkedIn "little text": reserved characters need a backslash; hashtags become {hashtag|\#|tag}.
  const liEsc = s => String(s).replace(/[\\|{}@[\]()<>#*_~]/g, m => "\\" + m);
  const liText = s => String(s).split(/((?:^|(?<=\s))#\w+)/).map(part => /^#\w+$/.test(part) ? `{hashtag|\\#|${liEsc(part.slice(1))}}` : liEsc(part)).join("");
  async function publishNet(co, p, net, prev) {
    const text = String(p.texts[net] || "").trim();
    if (!text) bad(400, "No text for this network.");
    const imgPath = p.image || "";
    if (net === "facebook") {
      const a = await token(co, net); const g = `https://graph.facebook.com/${GV()}`;
      if (imgPath) { const r = (await http(`${g}/${a.extId}/photos`, { method: "POST", form: { url: abs(co, imgPath), caption: text, published: "true", access_token: a.token } })).data; const pid = r.post_id || r.id; return { id: pid, url: `https://www.facebook.com/${pid}` }; }
      const r = (await http(`${g}/${a.extId}/feed`, { method: "POST", form: { message: text, ...(p.link ? { link: p.link } : {}), access_token: a.token } })).data;
      return { id: r.id, url: `https://www.facebook.com/${r.id}` };
    }
    if (net === "instagram") {
      if (!imgPath) bad(400, "Instagram needs an image.");
      const a = await token(co, net); const g = `https://graph.facebook.com/${GV()}`;
      let cid = prev && prev.container;
      if (!cid) {
        if (!/\.jpe?g$/i.test(imgPath)) bad(400, "Instagram only accepts JPG images. Use the generated card or upload a JPG.");
        cid = (await http(`${g}/${a.extId}/media`, { method: "POST", form: { image_url: abs(co, imgPath), caption: text, access_token: a.token } })).data.id;
      }
      for (let i = 0; i < 4; i++) {
        const s = (await http(`${g}/${cid}?` + new URLSearchParams({ fields: "status_code", access_token: a.token }))).data.status_code;
        if (s === "FINISHED") break;
        if (s === "ERROR" || s === "EXPIRED") bad(502, "Instagram couldn't process the image (" + s + ").");
        if (i === 3) return { pending: true, container: cid };
        await new Promise(r => setTimeout(r, 2500));
      }
      const mid = (await http(`${g}/${a.extId}/media_publish`, { method: "POST", form: { creation_id: cid, access_token: a.token } })).data.id;
      let url = ""; try { url = (await http(`${g}/${mid}?` + new URLSearchParams({ fields: "permalink", access_token: a.token }))).data.permalink || ""; } catch {}
      return { id: mid, url };
    }
    if (net === "linkedin") {
      const a = await token(co, net); const H = liHeaders(a.token);
      let content;
      if (imgPath) {
        const init = (await http("https://api.linkedin.com/rest/images?action=initializeUpload", { method: "POST", headers: H, json: { initializeUploadRequest: { owner: a.extId } } })).data.value;
        const img = await getImage(co, imgPath);
        const up = await http(init.uploadUrl, { method: "PUT", headers: { Authorization: "Bearer " + a.token, "Content-Type": img.type }, body: img.buf, raw: true, ms: 30000 });
        if (!up.ok) bad(502, "LinkedIn didn't accept the image upload (" + up.status + ").");
        content = { media: { id: init.image, altText: cut(p.card && p.card.headline, 120) } };
      } else if (p.link) content = { article: { source: p.link, title: cut(p.card && p.card.headline, 200) || "Read more" } };
      const r = await http("https://api.linkedin.com/rest/posts", { method: "POST", headers: H, json: { author: a.extId, commentary: liText(text), visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, ...(content ? { content } : {}), lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false } });
      const urn = r.headers.get("x-restli-id") || r.headers.get("x-linkedin-id") || "";
      return { id: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}` : "" };
    }
    if (net === "x") {
      const a = await token(co, net); const H = { Authorization: "Bearer " + a.token };
      let mediaIds, note = "";
      if (imgPath) {
        try {
          const img = await getImage(co, imgPath);
          const fd = new FormData(); fd.append("media", new Blob([img.buf], { type: img.type }), "card.jpg"); fd.append("media_category", "tweet_image"); fd.append("media_type", img.type);
          const r = await fetch("https://api.x.com/2/media/upload", { method: "POST", headers: H, body: fd, signal: AbortSignal.timeout(30000) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error((d.detail || d.title || r.status) + "");
          mediaIds = [String((d.data && d.data.id) || d.media_id_string || d.id)];
        } catch (e) { note = "Posted without the image (X: " + e.message + ")."; }
      }
      const r = (await http("https://api.x.com/2/tweets", { method: "POST", headers: H, json: { text, ...(mediaIds ? { media: { media_ids: mediaIds } } : {}) } })).data.data;
      return { id: r.id, url: `https://x.com/i/web/status/${r.id}`, note };
    }
    // google
    const a = await token(co, net);
    const body = { languageCode: "en", topicType: "STANDARD", summary: text.slice(0, 1500), ...(p.link ? { callToAction: { actionType: "LEARN_MORE", url: p.link } } : {}), ...(imgPath ? { media: [{ mediaFormat: "PHOTO", sourceUrl: abs(co, imgPath) }] } : {}) };
    const r = (await http(`https://mybusiness.googleapis.com/v4/${a.extId}/localPosts`, { method: "POST", headers: { Authorization: "Bearer " + a.token }, json: body })).data;
    return { id: r.name, url: r.searchUrl || "" };
  }

  // Publishes every network of one post that hasn't gone yet. Safe to call again: finished networks are skipped.
  async function publish(co, id, deadline) {
    const t = await table("socialposts");
    let e = await t.getEntity(co, id);
    if (!["scheduled", "posting"].includes(e.status)) return out(e);
    try { await t.updateEntity({ partitionKey: co, rowKey: id, status: "posting", postingAt: iso() }, "Merge", { etag: e.etag }); }
    catch (err) { if (err.statusCode === 412) return null; throw err; }
    const p = out(e); const results = p.results;
    let pending = false;
    for (const net of p.nets) {
      const prev = results[net];
      if (prev && prev.status === "posted") continue;
      if (deadline && Date.now() > deadline - 8000) { pending = true; break; }
      try {
        const r = await publishNet(co, p, net, prev);
        results[net] = r.pending ? { status: "pending", container: r.container, at: iso() } : { status: "posted", id: cut(r.id, 300), url: cut(r.url, 500), note: r.note || "", at: iso() };
        if (r.pending) pending = true;
      } catch (err) {
        results[net] = { status: "failed", error: cut(err.message, 400), at: iso() };
        log(`Social (${co}) ${id} ${net}: ${err.message}`);
        if (/\b(401|190)\b|expired|invalid.*token|OAuthException/i.test(err.message)) await (await table("socialacct")).updateEntity({ partitionKey: co, rowKey: net, status: "error", lastError: cut(err.message, 300) }, "Merge").catch(() => {});
      }
    }
    const vals = p.nets.map(n => results[n] && results[n].status);
    const status = pending ? "posting" : vals.every(v => v === "posted") ? "posted" : vals.some(v => v === "posted") ? "partial" : "failed";
    await t.updateEntity({ partitionKey: co, rowKey: id, status, results: JSON.stringify(results), ...(status !== "posting" ? { postedAt: iso() } : {}) }, "Merge");
    return out(await t.getEntity(co, id));
  }

  // Scheduler tick: publish what's due (and finish posts an earlier tick couldn't complete).
  async function pump({ deadline } = {}) {
    deadline = deadline || Date.now() + 25000;
    const t = await table("socialposts"); const due = [];
    const nowIso = iso(), stale = new Date(Date.now() - 3 * 60e3).toISOString();
    for await (const e of t.listEntities({ queryOptions: { filter: `(status eq 'scheduled' and scheduledAt le '${nowIso}') or (status eq 'posting' and postingAt le '${stale}')`, select: ["PartitionKey", "RowKey"] } })) due.push([e.partitionKey, e.rowKey]);
    const res = { due: due.length, posted: 0 };
    for (const [co, id] of due) {
      if (Date.now() > deadline - 10000) break;
      try { const r = await publish(co, id, deadline); if (r && ["posted", "partial"].includes(r.status)) res.posted++; } catch (e) { log(`Social pump ${co}/${id}: ${e.message}`); }
    }
    return res;
  }

  // ---------- posts ----------
  function out(e) {
    return { id: e.rowKey, co: e.partitionKey, title: e.title || "", status: e.status || "draft", nets: json(e.nets, []), texts: json(e.texts, {}), link: e.link || "", image: e.image || "", card: json(e.card, {}),
      scheduledAt: e.scheduledAt || "", results: json(e.results, {}), source: e.source || "", trend: json(e.trend, null), lastNote: e.lastNote || "",
      createdBy: e.createdBy || "", createdAt: e.createdAt || "", updatedBy: e.updatedBy || "", updatedAt: e.updatedAt || "", requestedBy: e.requestedBy || "", approvedBy: e.approvedBy || "", approvedAt: e.approvedAt || "", postedAt: e.postedAt || "", etag: e.etag };
  }
  const newId = () => { const t = new Date(Date.now() + DUBAI).toISOString(); return `SP-${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`; };
  function cleanTexts(t) {
    const o = {};
    for (const n of NET_KEYS) if (t && t[n] != null) o[n] = noDash(String(t[n]).replace(/\r/g, "")).slice(0, NETS[n].max);
    return o;
  }
  async function list(co) {
    const since = new Date(Date.now() - 120 * 864e5).toISOString(); const outl = [];
    for await (const e of (await table("socialposts")).listEntities({ queryOptions: { filter: `PartitionKey eq '${co}' and createdAt ge '${since}'` } })) outl.push(out(e));
    return outl.sort((a, b) => String(b.scheduledAt || b.createdAt).localeCompare(String(a.scheduledAt || a.createdAt)));
  }
  async function get(co, id) { const e = await getOrNull(await table("socialposts"), co, id); if (!e) bad(404, "This post doesn't exist any more."); return out(e); }

  async function create(co, d, by) {
    const S = await settings(co);
    const e = { partitionKey: co, rowKey: newId(), title: cut(d.title, 150) || "Social post", status: d.status || "draft", nets: JSON.stringify((d.nets || S.nets).filter(n => NETS[n])),
      texts: JSON.stringify(cleanTexts(d.texts || {})), link: cut(d.link || S.cta, 500), image: cut(d.image, 300), card: JSON.stringify(d.card || {}), scheduledAt: d.scheduledAt || "", results: "{}",
      source: d.source || "manual", trend: d.trend ? JSON.stringify(d.trend) : "", createdBy: by, createdAt: iso(), updatedBy: by, updatedAt: iso() };
    await (await table("socialposts")).createEntity(e);
    return get(co, e.rowKey);
  }
  async function save(co, id, b, user) {
    const t = await table("socialposts"); const cur = await t.getEntity(co, id);
    if (!["draft", "approval", "scheduled"].includes(cur.status)) bad(409, `This post is ${cur.status}, so it can't be changed. Duplicate it instead.`);
    const nets = (Array.isArray(b.nets) ? b.nets : json(cur.nets, [])).filter(n => NETS[n]);
    const link = cut(b.link, 500); if (link && !/^https?:\/\//i.test(link)) bad(400, "The link must start with https://");
    const next = { partitionKey: co, rowKey: id, title: cut(b.title, 150) || cur.title, nets: JSON.stringify(nets), texts: JSON.stringify(cleanTexts(b.texts || json(cur.texts, {}))), link, image: cut(b.image, 300), updatedBy: user.email, updatedAt: iso() };
    if (b.card) next.card = JSON.stringify({ kicker: cut(b.card.kicker, 40), headline: cut(b.card.headline, 120), sub: cut(b.card.sub, 200), layout: Card.LAYOUTS.includes(b.card.layout) ? b.card.layout : "navy" });
    if (cur.status === "scheduled" && !user.isManager) Object.assign(next, { status: "approval", approvedBy: "", approvedAt: "", lastNote: "Changed after approval, so it needs approving again." });
    try { await t.updateEntity(next, "Merge", { etag: b.etag || cur.etag }); }
    catch (err) { if (err.statusCode === 412) bad(409, "Someone else saved this post after you opened it. Reload to see their version."); throw err; }
    return get(co, id);
  }
  async function makeCard(co, id, b, by) {
    const t = await table("socialposts"); const cur = out(await t.getEntity(co, id));
    if (!["draft", "approval", "scheduled"].includes(cur.status)) bad(409, "This post can't be changed any more.");
    const S = await settings(co);
    const card = { kicker: cut(b.kicker != null ? b.kicker : cur.card.kicker, 40), headline: cut(b.headline != null ? b.headline : cur.card.headline, 120) || cur.title, sub: cut(b.sub != null ? b.sub : cur.card.sub, 200),
      layout: Card.LAYOUTS.includes(b.layout) ? b.layout : await nextLayout(co) };
    const buf = Card.render(co, { ...card, website: (DEFAULTS[co] || DEFAULTS.bifold).website }, card.layout);
    const image = await putImage(co, buf, "Social card: " + card.headline.slice(0, 60), by);
    await t.updateEntity({ partitionKey: co, rowKey: id, card: JSON.stringify(card), image, updatedBy: by, updatedAt: iso() }, "Merge");
    void S;
    return get(co, id);
  }

  // Status changes. Only a manager's click lets a post reach the networks.
  async function act(co, id, action, b, user) {
    const t = await table("socialposts"); const e = await t.getEntity(co, id); const p = out(e); const st = p.status;
    const patch = { partitionKey: co, rowKey: id, updatedBy: user.email, updatedAt: iso() };
    const check = () => {
      if (!p.nets.length) bad(400, "Choose at least one network.");
      for (const n of p.nets) { if (!String(p.texts[n] || "").trim()) bad(400, `Write the ${NETS[n].label} text first.`); if (NETS[n].needsImage && !p.image) bad(400, "Instagram needs an image. Make a card or pick an image."); }
    };
    if (action === "submit" || action === "schedule") {
      if (!["draft", "approval", "scheduled"].includes(st)) bad(409, `This post is ${st}.`);
      check();
      const at = b && b.at ? new Date(b.at) : new Date(await nextSlot(co));
      if (isNaN(at)) bad(400, "Pick a valid date and time.");
      if (at.getTime() < Date.now() - 5 * 60e3) bad(400, "That time has passed. Pick a time in the future, or Post now.");
      if (user.isManager) Object.assign(patch, { status: "scheduled", scheduledAt: at.toISOString(), approvedBy: user.email, approvedAt: iso(), lastNote: "" });
      else Object.assign(patch, { status: "approval", scheduledAt: at.toISOString(), requestedBy: user.email, approvedBy: "", approvedAt: "", lastNote: "" });
    } else if (action === "approve") {
      if (!user.isManager) bad(403, "Only a manager can approve a post.");
      if (st !== "approval") bad(409, "This post isn't waiting for approval.");
      check();
      const at = p.scheduledAt && Date.parse(p.scheduledAt) > Date.now() ? p.scheduledAt : await nextSlot(co);
      Object.assign(patch, { status: "scheduled", scheduledAt: at, approvedBy: user.email, approvedAt: iso(), lastNote: "" });
    } else if (action === "reject") {
      if (!user.isManager) bad(403, "Only a manager can return a post.");
      if (st !== "approval") bad(409, "This post isn't waiting for approval.");
      Object.assign(patch, { status: "draft", approvedBy: "", lastNote: `Returned to draft by ${user.email}${b && b.reason ? ": " + cut(b.reason, 300) : ""}` });
    } else if (action === "unschedule") {
      if (!["scheduled", "approval"].includes(st)) bad(409, "Only a scheduled post can go back to draft.");
      Object.assign(patch, { status: "draft", approvedBy: "", approvedAt: "" });
    } else if (action === "postnow") {
      if (!user.isManager) bad(403, "Only a manager can post straight away.");
      if (!["draft", "approval", "scheduled", "failed", "partial"].includes(st)) bad(409, `This post is ${st}.`);
      check();
      await t.updateEntity({ ...patch, status: "scheduled", scheduledAt: iso(), approvedBy: user.email, approvedAt: iso(), lastNote: "" }, "Merge", { etag: e.etag });
      return (await publish(co, id, Date.now() + 38000)) || get(co, id);
    } else if (action === "retry") {
      if (!user.isManager) bad(403, "Only a manager can retry a post.");
      if (!["failed", "partial"].includes(st)) bad(409, "Only a post that failed somewhere can be retried.");
      await t.updateEntity({ ...patch, status: "scheduled", scheduledAt: iso() }, "Merge", { etag: e.etag });
      return (await publish(co, id, Date.now() + 38000)) || get(co, id);
    } else if (action === "cancel") {
      if (!["approval", "scheduled"].includes(st)) bad(409, "This post isn't waiting to go out.");
      patch.status = "cancelled";
    } else bad(404, "Unknown request.");
    try { await t.updateEntity(patch, "Merge", { etag: e.etag }); }
    catch (err) { if (err.statusCode === 412) bad(409, "The post changed while you were doing this. Reload and try again."); throw err; }
    return get(co, id);
  }
  async function remove(co, id, user) {
    const p = await get(co, id);
    if (!user.isManager && p.createdBy !== user.email) bad(403, "Only the person who made this post or a manager can delete it.");
    if (p.status === "posting") bad(409, "This post is being published right now.");
    await (await table("socialposts")).deleteEntity(co, id);
  }

  // ---------- Claude ----------
  async function draftText(co, { brief, row, link }) {
    const S = await settings(co);
    const vn = row ? row.vendorName : "";
    const src = row ? `NEWS: ${row.title}\nPublished: ${row.date ? String(row.date).slice(0, 10) : "recent"}${row.source ? " by " + row.source : ""}\nSource link: ${row.link}\nSummary: ${row.summary || "(none)"}\n${row.excerpt ? "Article text (use only what is relevant):\n" + String(row.excerpt).slice(0, 5000) : ""}\nWhy it matters (our analyst): ${row.why || "-"}\nSuggested angle: ${row.angle || "-"}\nVendor relationship: ${row.own ? `${vn} is one of our vendor partners.` : `${vn} is in our sister company's portfolio: we can supply and deliver it, but never call ourselves a ${vn} partner.`}`
      : `BRIEF FROM THE MARKETING TEAM:\n${cut(brief, 3000)}`;
    const prompt = `You are the social media writer for ${AI.NAMES[co]}.
COMPANY PROFILE:
${AI.PROFILES[co]}
Website: ${(DEFAULTS[co] || DEFAULTS.bifold).website}
Call-to-action link: ${link || S.cta}
${S.whatsapp ? "WhatsApp: " + S.whatsapp : ""}
Brand hashtags (always include): ${S.hashtags || "-"}

${src}

Write ONE social update about this, adapted for each network. Summarise in our own words; do not copy sentences from the source. Only state facts that appear above: no invented figures, prices, customers or partner tiers. UK English, plain and practical, no hype words, no emojis except at most one in the Instagram caption. Never use em dashes or en dashes.

House style per network (follow it):
- linkedin: 700 to 1300 characters. A one-line hook, 2 or 3 short paragraphs, then 3 to 6 bullet lines starting with "• ", a sentence on how ${AI.NAMES[co]} helps, a one-line call to action, then 5 to 7 hashtags on the last line.
- facebook: 250 to 500 characters. Hook line, one short paragraph, call to action with the link written out in full, then 4 to 6 hashtags.
- instagram: 300 to 600 characters. Short punchy hook, 2 to 3 lines, call to action ending "link in bio"${S.whatsapp ? ` / WhatsApp ${S.whatsapp}` : ""} (no web links, they don't work in captions), then 6 to 8 hashtags.
- x: at most 240 characters including hashtags. One or two punchy sentences and 2 or 3 hashtags. No link.
- google: 400 to 900 characters for a Google Business Profile update. No hashtags, no phone numbers, no links in the text (a "Learn more" button carries the link).
- card: text for the square image: "kicker" up to 24 characters (topic or vendor), "headline" up to 65 characters (strong, specific), "sub" up to 100 characters (what to do or why it matters).

Reply in exactly this format and nothing else: each section starts with its marker line, and the text follows on the next lines as plain text (no JSON, no quotes around it, no markdown).
=== TITLE ===
(short internal name)
=== KICKER ===
=== HEADLINE ===
=== SUB ===
=== LINKEDIN ===
=== FACEBOOK ===
=== INSTAGRAM ===
=== X ===
=== GOOGLE ===`;
    const r = await AI.claudeText(prompt, { maxTokens: 4000, timeoutMs: 36000 });
    const o = sections(r.text);
    if (!o.linkedin && !o.facebook && !o.instagram && !o.x) {
      log(`Social draft unreadable (${r.stop}): ${String(r.text).slice(0, 500)}`);
      bad(502, r.stop === "max_tokens" ? "Claude's answer was too long and got cut off. Try again." : "Claude's answer couldn't be read. Try again.");
    }
    o.card = { kicker: o.kicker, headline: o.headline, sub: o.sub };
    // Any network Claude left out is adapted from the others, so a post never goes for approval with an empty caption.
    const base = o.facebook || o.linkedin || o.instagram || o.google || "";
    const noLinks = s => String(s).replace(/\s*https?:\/\/\S+/g, "").trim();
    const tags = s => (String(s).match(/#\w+/g) || []).slice(0, 8).join(" ");
    const body = s => noLinks(String(s).replace(/(\s*#\w+)+\s*$/g, ""));
    if (!o.facebook) o.facebook = o.linkedin || base;
    if (!o.linkedin) o.linkedin = base;
    if (!o.instagram && base) o.instagram = `${body(base).split(/\n\s*\n/).slice(0, 2).join("\n\n")}\n\nLink in bio${S.whatsapp ? " / WhatsApp " + S.whatsapp : ""}\n\n${tags(base + " " + S.hashtags)}`.trim();
    if (!o.x && base) { const first = body(base).split(/(?<=[.!?])\s+/)[0] || ""; o.x = (first.slice(0, 220) + " " + tags(S.hashtags).split(" ").slice(0, 2).join(" ")).trim(); }
    if (!o.google && base) o.google = body(base);
    const texts = cleanTexts({ linkedin: o.linkedin, facebook: o.facebook, instagram: o.instagram, x: o.x, google: String(o.google || "").split(/(?<=[.!?])\s+/).filter(x => !/\+?\d[\d\s-]{7,}\d/.test(x)).join(" ").replace(/\s*#\w+/g, "").trim() });
    if (texts.x && texts.x.length > 280) texts.x = texts.x.slice(0, 277).replace(/\s+\S*$/, "") + "…";
    const card = o.card || {};
    return { title: cut(noDash(o.title), 150), texts, card: { kicker: cut(noDash(card.kicker), 30), headline: cut(noDash(card.headline), 90), sub: cut(noDash(card.sub), 140) } };
  }
  // "=== NAME ===" sections → {name: text}. Also accepts a JSON answer, in case the model replies that way.
  function sections(text) {
    const t = String(text || "");
    // Markers in any case, with or without markdown (**, #) or extra words ("Instagram caption", "X / Twitter").
    const KEYS = [["title", /title|name/], ["kicker", /kicker|label/], ["headline", /headline/], ["sub", /^sub|line/], ["linkedin", /linked\s*in/], ["facebook", /facebook/], ["instagram", /insta/], ["google", /google|business/], ["x", /^x\b|twitter|^x\s*\/|\(x\)/]];
    const keyOf = h => { h = h.toLowerCase().replace(/[*#_`]/g, "").trim(); const k = KEYS.find(([, re]) => re.test(h)); return k ? k[0] : h; };
    const o = {}; const re = /^[\s*#_`]*={2,}\s*([^=\n]+?)\s*={2,}[\s*#_`]*$/gm; let m, last = null, from = 0;
    while ((m = re.exec(t))) { if (last) o[last] = o[last] || t.slice(from, m.index).trim(); last = keyOf(m[1]); from = re.lastIndex; }
    if (last) o[last] = t.slice(from).trim();
    if (!Object.keys(o).length) { const j = AI.parseJson(t); if (j && typeof j === "object") { Object.assign(o, j); if (j.card) Object.assign(o, j.card); } }
    for (const k of Object.keys(o)) if (typeof o[k] === "string") o[k] = o[k].replace(/^\(.*?\)$/s, "").replace(/^["']|["']$/g, "").trim();
    return o;
  }
  async function draftNew(co, b, by) {
    if (!process.env.ANTHROPIC_API_KEY) bad(501, "Claude drafting isn't set up on the tools site yet.");
    if (!cut(b.brief, 3000)) bad(400, "Describe what the post should be about.");
    let d; try { d = await draftText(co, { brief: b.brief, link: cut(b.link, 500) }); } catch (e) { bad(e.status || 502, e.message); }
    const p = await create(co, { title: d.title || cut(b.brief, 80), texts: d.texts, card: d.card, link: cut(b.link, 500) || undefined, source: "claude" }, by);
    try { return await makeCard(co, p.id, d.card, by); } catch (e) { log("Social card: " + e.message); return p; }
  }
  // Trend Radar: a social post for a scored news item. row: a radaritems row plus vendorName and own.
  async function fromRadar(co, row, by, opts = {}) {
    const d = await draftText(co, { row });
    const p = await create(co, { title: d.title || row.title, texts: d.texts, card: d.card, source: "radar", status: opts.status || "approval",
      trend: { id: row.rowKey, vendor: row.vendor, vendorName: row.vendorName, title: row.title, link: row.link, score: row.score } }, by);
    try { await makeCard(co, p.id, d.card, by); } catch (e) { log("Social card: " + e.message); }
    if (opts.status !== "draft") await (await table("socialposts")).updateEntity({ partitionKey: co, rowKey: p.id, scheduledAt: await nextSlot(co), requestedBy: by }, "Merge");
    await (await table("radaritems")).updateEntity({ partitionKey: co, rowKey: row.rowKey, socialId: p.id }, "Merge").catch(() => {});
    return get(co, p.id);
  }
  async function approvals(co) {
    const outl = [];
    for await (const e of (await table("socialposts")).listEntities({ queryOptions: { filter: `PartitionKey eq '${co}' and status eq 'approval'` } })) outl.push(out(e));
    return outl;
  }

  return { NETS, APPS, settings, saveSettings, accounts, disconnect, connectUrl, callback, pick, list, get, create, save, makeCard, act, remove, draftNew, fromRadar, publish, pump, nextSlot, approvals, SocialError };
};
module.exports.NETS = NETS;
module.exports.SocialError = SocialError;
