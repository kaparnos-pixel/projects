// Project Completion Reports: completion reports and work completion certificates for both companies, with the
// customer's BoQ, equipment serial numbers, site pictures, a system diagram, testing, warranty, snags and customer sign-off.
//
// Who sees what: everyone in the company with the "completion" section sees and edits the company's reports.
// Deleting a report, or reopening one the customer has signed, is for the person who created it and managers.
// A signed report is locked: changing it means reopening it, which removes the customer's signature.
//
// Customer sign-off happens one of three ways: on the engineer's device (POST reports/:id/sign), through a signing
// link the customer opens without signing in (/sign/?k=<token>, served by publicRoute below), or on paper.
//
// Storage (Table Storage + Blob Storage, STORAGE_CONNECTION):
//   pcr        PK "pcr"   RowKey = id      summary columns + the report body as packed JSON
//   pcrlinks   PK "link"  RowKey = token   reportId, co, expires, revoked, usedAt
//   blob container "pcr-files"            site photos, signatures and uploaded diagrams
//
// Settings (all optional): ANTHROPIC_API_KEY / ANTHROPIC_MODEL (Claude drafting, see pcr-ai.js);
// GRAPH_* with MAIL_SENDER / TECHHUB_MAIL_SENDER (email to customers, same as the AMC Tracker);
// PCR_PUBLIC_URL / PCR_PUBLIC_URL_TECHHUB (address used in signing links; default MK_PUBLIC_URL or the request's site).

const crypto = require("crypto");
const { BlobServiceClient } = require("@azure/storage-blob");
const AI = require("./pcr-ai");

const T_PCR = "pcr", PK = "pcr", T_LINK = "pcrlinks", LPK = "link";
const STATUSES = ["draft", "awaiting", "signed"];
const MODES = ["report", "certificate"];
const MAX_FILE = 10 * 1048576, MAX_SIG = 400 * 1024;
const LINK_DAYS = 14;
const UUID = /^[0-9a-f-]{36}$/;

module.exports = function makePcr(H) {
  const { table, getOrNull, all, packJson, unpackJson, fail, clean, num, isDate, CUST, CPK, CO, rowCo, inCo, writeCo, mailReadyFor, diff, record } = H;
  const PFX = { bifold: "BFT", techhub: "TH" };
  const now = () => new Date().toISOString();
  const gulfDay = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  // House rule: no em or en dashes anywhere in the tools or the documents.
  const nd = s => String(s ?? "").replace(/\s*[—–]\s*/g, ", ");
  const txt = (v, max = 200) => nd(clean(v, max));
  const etagFail = err => { if (err.statusCode === 412) fail(409, "Someone else changed this report after you opened it. Reload to see their changes, then make yours again."); throw err; };
  const nameOf = e => String(e || "").split("@")[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

  /* ---------------- shape of a report ---------------- */
  const INCLUDE = ["boq", "serials", "diagram", "testing", "photos", "warranty", "snags", "signoff", "stamp"];
  function includeIn(v) {
    const d = { boq: true, serials: true, diagram: true, testing: true, photos: true, warranty: true, snags: false, signoff: true, stamp: false };
    v = v && typeof v === "object" ? v : {};
    return Object.fromEntries(INCLUDE.map(k => [k, v[k] === undefined ? d[k] : !!v[k]]));
  }
  const arr = (v, max) => (Array.isArray(v) ? v : []).slice(0, max);
  const lines = (v, max, len = 400) => arr(v, max).map(x => txt(x, len)).filter(Boolean);
  const rowsIn = (v, max, keys, len = 300) => arr(v, max).map(r => Object.fromEntries(keys.map(k => [k, txt(r && r[k], len)]))).filter(r => keys.some(k => r[k]));
  const NODE_KINDS = ["cloud", "isp", "firewall", "router", "switch", "core", "wifi", "ap", "server", "storage", "nvr", "camera", "pbx", "phone", "pc", "printer", "ups", "rack", "access", "display", "other"];
  function diagramIn(v) {
    v = v && typeof v === "object" ? v : {};
    const nodes = arr(v.nodes, 40).map(n => ({ id: clean(n && n.id, 30).replace(/[^\w-]/g, ""), label: txt(n.label, 60), sub: txt(n.sub, 80), kind: NODE_KINDS.includes(n.kind) ? n.kind : "other", tier: Math.max(0, Math.min(6, Math.round(num(n.tier)))) })).filter(n => n.id && n.label);
    const ids = new Set(nodes.map(n => n.id));
    const edges = arr(v.edges, 80).map(e => ({ from: clean(e && e.from, 30), to: clean(e && e.to, 30), label: txt(e && e.label, 40) })).filter(e => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
    const imageId = UUID.test(clean(v.imageId, 60)) ? clean(v.imageId, 60) : "";
    return { title: txt(v.title, 120), caption: txt(v.caption, 300), nodes, edges, imageId, imageW: num(v.imageW), imageH: num(v.imageH), source: ["claude", "manual", "upload"].includes(v.source) ? v.source : "" };
  }
  function bodyIn(b, cur) {
    cur = cur || {};
    const pick = (k, fn) => b[k] !== undefined ? fn(b[k]) : cur[k];
    const letter = v => ({ subject: txt(v && v.subject, 250), salutation: txt(v && v.salutation, 120), body: lines(v && v.body, 6, 1500), closing: txt(v && v.closing, 600) });
    const scope = v => ({ intro: txt(v && v.intro, 800), streams: arr(v && v.streams, 10).map(s => ({ heading: txt(s && s.heading, 120), bullets: lines(s && s.bullets, 12, 400) })).filter(s => s.heading || s.bullets.length) });
    const warranty = v => ({
      hwMonths: Math.max(0, Math.min(120, Math.round(num(v && v.hwMonths)))), wkMonths: Math.max(0, Math.min(120, Math.round(num(v && v.wkMonths)))),
      start: isDate(clean(v && v.start, 10)) ? clean(v.start, 10) : "", hours: txt(v && v.hours, 120), terms: lines(v && v.terms, 15), exclusions: lines(v && v.exclusions, 15),
    });
    const photos = v => arr(v, 60).map(p => ({ id: clean(p && p.id, 60), caption: txt(p.caption, 200), w: num(p.w), h: num(p.h), by: clean(p.by, 150), at: clean(p.at, 40) })).filter(p => UUID.test(p.id));
    return {
      include: pick("include", includeIn) || includeIn(),
      notes: pick("notes", v => clean(v, 6000)) || "",
      instructions: pick("instructions", v => clean(v, 1500)) || "",
      letter: pick("letter", letter) || letter({}),
      scope: pick("scope", scope) || scope({}),
      boq: pick("boq", v => rowsIn(v, 400, ["item", "desc", "model", "qty", "unit", "remarks"], 400)) || [],
      serials: pick("serials", v => rowsIn(v, 1000, ["type", "model", "serial", "location"], 200)) || [],
      testing: pick("testing", v => rowsIn(v, 60, ["test", "method", "result", "remarks"], 300).map(r => ({ ...r, result: ["Pass", "Fail", "Open", "N/A"].includes(r.result) ? r.result : "" }))) || [],
      handover: pick("handover", v => lines(v, 20)) || [],
      warranty: pick("warranty", warranty) || warranty({ hwMonths: 12, wkMonths: 12 }),
      snags: pick("snags", v => rowsIn(v, 40, ["item", "owner", "target"], 300)) || [],
      diagram: pick("diagram", diagramIn) || diagramIn({}),
      photos: pick("photos", photos) || [],
      company: pick("company", v => ({ fileId: UUID.test(clean(v && v.fileId, 60)) ? clean(v.fileId, 60) : "", at: clean(v && v.at, 40) })) || { fileId: "", at: "" },
      textSource: pick("textSource", v => ["claude", "template", "manual"].includes(v) ? v : "") || "",
    };
  }

  /* ---------------- reports ---------------- */
  const SUM = ["RowKey", "co", "docNo", "mode", "status", "customerId", "customerName", "poRef", "projectTitle", "site", "completionDate", "preparedBy", "owner", "signedAt", "signerName", "linkExpires", "createdAt", "updatedAt", "updatedBy"];
  function summary(e) {
    return {
      id: e.rowKey || e.RowKey, co: rowCo(e), docNo: e.docNo, mode: e.mode || "report", status: e.status || "draft", customerId: e.customerId, customerName: e.customerName,
      poRef: e.poRef || "", projectTitle: e.projectTitle || "", site: e.site || "", completionDate: e.completionDate || "", preparedBy: e.preparedBy || "", owner: e.owner,
      signedAt: e.signedAt || "", signerName: e.signerName || "", linkExpires: e.linkExpires || "", createdAt: e.createdAt, updatedAt: e.updatedAt, updatedBy: e.updatedBy,
    };
  }
  function full(e, user) {
    const d = unpackJson(e);
    const link = d.link && d.link.expires > now() && !d.link.revoked ? d.link : null;
    return {
      ...summary(e), poDate: e.poDate || "", startDate: e.startDate || "", preparedTitle: e.preparedTitle || "", attention: e.attention || "",
      customer: d.customer || {}, ...bodyIn({}, d), signature: d.signature || null, link: link ? { token: link.token, expires: link.expires, sentTo: link.sentTo || "" } : null,
      history: d.history || [], shares: d.shares || [], etag: e.etag,
      canDelete: user.isManager || e.owner === user.email, canReopen: user.isManager || e.owner === user.email,
    };
  }
  async function load(user, id) {
    const e = await getOrNull(await table(T_PCR), PK, clean(id, 60));
    if (!e || !inCo(e, user)) fail(404, "This report doesn't exist or was deleted.");
    return e;
  }
  const log = (who, text) => ({ at: now(), by: who, text: clean(nd(text), 300) });
  async function customerOf(id, co) {
    const c = await getOrNull(await table(CUST), CPK, clean(id, 60));
    if (!c || rowCo(c) !== co) fail(400, "That customer is no longer in the customer list. Choose another.");
    return c;
  }
  const custSnap = c => ({ name: c.name, contactName: c.contactName || "", email: c.email || "", phone: c.phone || "", trn: c.trn || "", emirate: c.emirate || "", address: c.address || "" });
  async function nextDocNo(custName, co, mode) {
    const code = String(custName).replace(/\b(LLC|L\.L\.C\.?|FZE|FZ-LLC|FZCO|Co\.?|Company|Limited|Ltd\.?|Est\.?|Establishment|Trading)\b/gi, "").trim()
      .split(/\s+/).filter(Boolean).map((w, i, a) => a.length > 1 ? w.slice(0, i < 2 ? 4 : 1) : w.slice(0, 8)).join("").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "CUST";
    const prefix = `${PFX[co]}-${mode === "certificate" ? "WCC" : "PCR"}-${gulfDay().slice(0, 4)}-${code}-`;
    const rows = await all(await table(T_PCR), PK, ["RowKey", "docNo"]);
    const n = rows.filter(r => String(r.docNo || "").startsWith(prefix)).length + 1;
    return prefix + String(n).padStart(3, "0");
  }
  function headIn(b, cur) {
    const out = {};
    const s = (k, max) => { if (b[k] !== undefined) out[k] = txt(b[k], max); };
    s("poRef", 80); s("projectTitle", 200); s("site", 200); s("preparedBy", 100); s("preparedTitle", 100); s("attention", 120);
    for (const k of ["poDate", "startDate", "completionDate"]) if (b[k] !== undefined) {
      const v = clean(b[k], 10); if (v && !isDate(v)) fail(400, "One of the dates is not valid."); out[k] = v;
    }
    const comp = out.completionDate !== undefined ? out.completionDate : cur.completionDate;
    const start = out.startDate !== undefined ? out.startDate : cur.startDate;
    if (start && comp && start > comp) fail(400, "The start date must be on or before the completion date.");
    if (b.mode !== undefined) out.mode = MODES.includes(b.mode) ? b.mode : cur.mode || "report";
    return out;
  }
  async function list(user) {
    const rows = await all(await table(T_PCR), PK, SUM);
    return rows.filter(e => inCo(e, user)).map(summary).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  async function create(user, b) {
    const co = writeCo(user);
    const c = await customerOf(b.customerId, co);
    const head = headIn(b, {});
    const mode = head.mode || "report";
    const completionDate = head.completionDate || gulfDay();
    const t = now(), id = crypto.randomUUID();
    const body = bodyIn({ ...b, warranty: b.warranty || { hwMonths: 12, wkMonths: 12, start: "" } }, {});
    const e = {
      partitionKey: PK, rowKey: id, co, docNo: await nextDocNo(c.name, co, mode), mode, status: "draft", customerId: c.rowKey, customerName: c.name,
      poRef: head.poRef || "", poDate: head.poDate || "", projectTitle: head.projectTitle || "", site: head.site || [c.address, c.emirate].filter(Boolean).join(", ").slice(0, 200),
      startDate: head.startDate || "", completionDate, preparedBy: head.preparedBy || nameOf(user.email), preparedTitle: head.preparedTitle || "", attention: head.attention || c.contactName || "",
      owner: user.email, signedAt: "", signerName: "", linkExpires: "", createdAt: t, updatedAt: t, updatedBy: user.email,
      ...packJson({ ...body, customer: custSnap(c), signature: null, link: null, history: [log(user.email, "Created report")], shares: [] }),
    };
    await (await table(T_PCR)).createEntity(e);
    return full(await (await table(T_PCR)).getEntity(PK, id), user);
  }
  async function update(user, id, b) {
    const t = await table(T_PCR);
    const e = await load(user, id);
    const co = writeCo(user);
    if (e.status === "signed") fail(409, "The customer has signed this report, so it's locked. Reopen it to make changes; the signature will be removed.");
    const d = unpackJson(e);
    const next = { ...e, co, ...headIn(b, e) };
    if (b.customerId !== undefined && clean(b.customerId, 60) !== e.customerId) {
      const c = await customerOf(b.customerId, co);
      Object.assign(next, { customerId: c.rowKey, customerName: c.name }); d.customer = custSnap(c);
    } else if (b.refreshCustomer) {
      const c = await customerOf(e.customerId, co); next.customerName = c.name; d.customer = custSnap(c);
    }
    if (next.mode !== e.mode && e.docNo) next.docNo = e.docNo.replace(/-(PCR|WCC)-/, next.mode === "certificate" ? "-WCC-" : "-PCR-");
    const body = bodyIn(b, bodyIn({}, d));
    Object.assign(d, body);
    if (b.log) d.history = (d.history || []).concat([log(user.email, b.log)]).slice(-80);
    Object.assign(next, packJson(d), { updatedAt: now(), updatedBy: user.email });
    delete next.etag; delete next.timestamp;
    if (user.aud) { user.aud.name = [e.docNo, e.customerName].filter(Boolean).join(", "); user.aud.changes = diff(e, next); }
    await t.updateEntity(next, "Replace", { etag: b.etag || e.etag }).catch(etagFail);
    return full(await t.getEntity(PK, id), user);
  }
  async function remove(user, id) {
    const e = await load(user, id);
    writeCo(user);
    if (user.aud) user.aud.name = [e.docNo, e.customerName].filter(Boolean).join(", ");
    if (!user.isManager && e.owner !== user.email) fail(403, "Only the person who created this report or a manager can delete it.");
    if (e.status === "signed" && !user.isManager) fail(403, "Only a manager can delete a signed report.");
    const d = unpackJson(e);
    await (await table(T_PCR)).deleteEntity(PK, e.rowKey);
    if (d.link && d.link.token) await (await table(T_LINK)).updateEntity({ partitionKey: LPK, rowKey: d.link.token, revoked: true }, "Merge").catch(() => {});
  }

  /* ---------------- signatures ---------------- */
  function pngIn(data) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ""));
    if (!m) fail(400, "Draw the signature in the box first.");
    const buf = Buffer.from(m[1], "base64");
    if (buf.length < 200 || buf.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") fail(400, "The signature couldn't be read. Clear it and sign again.");
    if (buf.length > MAX_SIG) fail(413, "The signature image is too large. Clear it and sign again.");
    return buf;
  }
  async function storeBlob(buf, type, name, co, by) {
    const id = crypto.randomUUID();
    await (await blobs()).getBlockBlobClient(id).uploadData(buf, { blobHTTPHeaders: { blobContentType: type }, metadata: { name: encodeURIComponent(name), by: encodeURIComponent(by), co } });
    return id;
  }
  // Writes the customer's signature onto a report. Used by on-device signing and by the public signing link.
  async function applySignature(e, s, who, method, ip) {
    const t = await table(T_PCR);
    for (let i = 0; i < 3; i++) {
      const cur = i ? await t.getEntity(PK, e.rowKey) : e;
      if (cur.status === "signed") fail(409, "This report has already been signed.");
      const d = unpackJson(cur);
      d.signature = s;
      if (d.link) d.link = { ...d.link, revoked: true };
      d.history = (d.history || []).concat([log(who, `Signed by ${s.name}${s.designation ? " (" + s.designation + ")" : ""} ${method === "link" ? "using the signing link" : "on site"}`)]).slice(-80);
      const next = { ...cur, status: "signed", signedAt: s.at, signerName: s.name, linkExpires: "", ...packJson(d), updatedAt: now(), updatedBy: who };
      delete next.etag; delete next.timestamp;
      try { await t.updateEntity(next, "Replace", { etag: cur.etag }); break; } catch (err) { if (err.statusCode !== 412 || i === 2) throw err; }
    }
    const d0 = unpackJson(e);
    if (d0.link && d0.link.token) await (await table(T_LINK)).updateEntity({ partitionKey: LPK, rowKey: d0.link.token, revoked: true, usedAt: now() }, "Merge").catch(() => {});
    void ip;
  }
  function signerIn(b) {
    const name = txt(b.name, 100); if (!name) fail(400, "Enter the name of the person signing.");
    if (!b.agree) fail(400, "Tick the box to confirm the works are accepted.");
    return { name, designation: txt(b.designation, 100), company: txt(b.company, 150), remarks: txt(b.remarks, 600) };
  }
  async function signOnSite(user, id, b) {
    const e = await load(user, id);
    const co = writeCo(user);
    if (user.aud) user.aud.name = [e.docNo, e.customerName].filter(Boolean).join(", ");
    const who = signerIn(b);
    const fileId = await storeBlob(pngIn(b.image), "image/png", `Signature ${who.name}.png`, co, user.email);
    const s = { ...who, fileId, at: now(), method: "onsite", witness: user.email };
    await applySignature(e, s, user.email, "onsite");
    return full(await (await table(T_PCR)).getEntity(PK, e.rowKey), user);
  }
  async function companySign(user, id, b) {
    const e = await load(user, id);
    const co = writeCo(user);
    if (e.status === "signed") fail(409, "The customer has signed this report, so it's locked. Reopen it to change the company signature.");
    const d = unpackJson(e);
    if (b.clear) d.company = { fileId: "", at: "" };
    else d.company = { fileId: await storeBlob(pngIn(b.image), "image/png", `Signature ${e.preparedBy || user.email}.png`, co, user.email), at: now() };
    d.history = (d.history || []).concat([log(user.email, b.clear ? "Removed the company signature" : "Signed for the company")]).slice(-80);
    const next = { ...e, ...packJson(d), updatedAt: now(), updatedBy: user.email }; delete next.etag; delete next.timestamp;
    if (user.aud) user.aud.name = [e.docNo, e.customerName].filter(Boolean).join(", ");
    await (await table(T_PCR)).updateEntity(next, "Replace", { etag: e.etag }).catch(etagFail);
    return full(await (await table(T_PCR)).getEntity(PK, e.rowKey), user);
  }
  async function reopen(user, id) {
    const e = await load(user, id);
    writeCo(user);
    if (!user.isManager && e.owner !== user.email) fail(403, "Only the person who created this report or a manager can reopen it.");
    if (e.status !== "signed") fail(400, "This report isn't signed.");
    const d = unpackJson(e);
    d.previousSignatures = (d.previousSignatures || []).concat(d.signature ? [d.signature] : []).slice(-10);
    d.signature = null;
    d.history = (d.history || []).concat([log(user.email, "Reopened the report. The customer's signature was removed.")]).slice(-80);
    const next = { ...e, status: "draft", signedAt: "", signerName: "", ...packJson(d), updatedAt: now(), updatedBy: user.email }; delete next.etag; delete next.timestamp;
    if (user.aud) user.aud.name = [e.docNo, e.customerName].filter(Boolean).join(", ");
    await (await table(T_PCR)).updateEntity(next, "Replace", { etag: e.etag }).catch(etagFail);
    return full(await (await table(T_PCR)).getEntity(PK, e.rowKey), user);
  }

  /* ---------------- signing links ---------------- */
  const publicBase = (co, origin) => {
    const v = co === "techhub" ? process.env.PCR_PUBLIC_URL_TECHHUB || process.env.MK_PUBLIC_URL_TECHHUB : process.env.PCR_PUBLIC_URL || process.env.MK_PUBLIC_URL;
    return String(v || origin || "").replace(/\/+$/, "");
  };
  async function makeLink(user, id, b) {
    const e = await load(user, id);
    const co = writeCo(user);
    if (e.status === "signed") fail(409, "This report has already been signed.");
    if (user.aud) user.aud.name = [e.docNo, e.customerName].filter(Boolean).join(", ");
    const lt = await table(T_LINK);
    const d = unpackJson(e);
    if (d.link && d.link.token) await lt.updateEntity({ partitionKey: LPK, rowKey: d.link.token, revoked: true }, "Merge").catch(() => {});
    const token = crypto.randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + LINK_DAYS * 864e5).toISOString();
    await lt.createEntity({ partitionKey: LPK, rowKey: token, reportId: e.rowKey, co, expires, revoked: false, createdBy: user.email, createdAt: now() });
    d.link = { token, expires, by: user.email, at: now(), revoked: false };
    d.history = (d.history || []).concat([log(user.email, "Created a customer signing link")]).slice(-80);
    const next = { ...e, status: "awaiting", linkExpires: expires, ...packJson(d), updatedAt: now(), updatedBy: user.email }; delete next.etag; delete next.timestamp;
    await (await table(T_PCR)).updateEntity(next, "Replace", { etag: b.etag || e.etag }).catch(etagFail);
    const url = `${publicBase(co, b.origin)}/sign/?k=${token}`;
    return { report: full(await (await table(T_PCR)).getEntity(PK, e.rowKey), user), url };
  }
  async function revokeLink(user, id) {
    const e = await load(user, id);
    writeCo(user);
    if (user.aud) user.aud.name = [e.docNo, e.customerName].filter(Boolean).join(", ");
    const d = unpackJson(e);
    if (d.link && d.link.token) await (await table(T_LINK)).updateEntity({ partitionKey: LPK, rowKey: d.link.token, revoked: true }, "Merge").catch(() => {});
    d.link = null;
    d.history = (d.history || []).concat([log(user.email, "Cancelled the customer signing link")]).slice(-80);
    const next = { ...e, status: e.status === "awaiting" ? "draft" : e.status, linkExpires: "", ...packJson(d), updatedAt: now(), updatedBy: user.email }; delete next.etag; delete next.timestamp;
    await (await table(T_PCR)).updateEntity(next, "Replace", { etag: e.etag }).catch(etagFail);
    return full(await (await table(T_PCR)).getEntity(PK, e.rowKey), user);
  }

  /* ---------------- public signing page (no sign-in) ---------------- */
  const tries = new Map();
  function throttle(ip) {
    const k = ip || "?", t = Date.now(), w = (tries.get(k) || []).filter(x => t - x < 600e3);
    w.push(t); tries.set(k, w);
    if (w.length > 60) fail(429, "Too many attempts. Wait a few minutes and try again.");
  }
  async function byToken(token) {
    if (!/^[A-Za-z0-9_-]{30,40}$/.test(String(token || ""))) fail(404, "This signing link isn't valid. Check you copied the whole link, or ask for a new one.");
    const l = await getOrNull(await table(T_LINK), LPK, token);
    if (!l) fail(404, "This signing link isn't valid. Check you copied the whole link, or ask for a new one.");
    const e = await getOrNull(await table(T_PCR), PK, l.reportId);
    if (!e) fail(404, "This report is no longer available.");
    if (e.status === "signed") return { l, e, done: true };
    if (l.revoked) fail(410, "This signing link has been replaced or cancelled. Ask for a new one.");
    if (l.expires < now()) fail(410, "This signing link has expired. Ask for a new one.");
    return { l, e, done: false };
  }
  // What the customer sees: the report content, without internal notes, history or file ids.
  function publicView(e) {
    const d = unpackJson(e), b = bodyIn({}, d), inc = b.include;
    const sig = d.signature;
    return {
      co: rowCo(e), company: CO[rowCo(e)].name, docNo: e.docNo, mode: e.mode, status: e.status, customerName: e.customerName, customer: { trn: (d.customer || {}).trn || "", address: (d.customer || {}).address || "", emirate: (d.customer || {}).emirate || "" },
      poRef: e.poRef || "", poDate: e.poDate || "", projectTitle: e.projectTitle || "", site: e.site || "", startDate: e.startDate || "", completionDate: e.completionDate || "",
      preparedBy: e.preparedBy || "", preparedTitle: e.preparedTitle || "", attention: e.attention || "",
      letter: b.letter, scope: b.scope, handover: b.handover,
      boq: inc.boq ? b.boq : [], serials: inc.serials ? b.serials : [], testing: inc.testing ? b.testing : [], warranty: inc.warranty ? b.warranty : null, snags: inc.snags ? b.snags : [],
      photoCount: inc.photos ? b.photos.length : 0, hasDiagram: inc.diagram && (b.diagram.nodes.length > 0 || !!b.diagram.imageId),
      signed: sig ? { name: sig.name, designation: sig.designation, at: sig.at } : null,
    };
  }
  async function publicRoute(method, seg, ip, readBody) {
    const [token] = seg;
    throttle(ip);
    const { e, done } = await byToken(token);
    if (method === "GET") return publicView(e);
    if (method !== "POST") fail(405, "Not allowed.");
    if (done) fail(409, "This report has already been signed. Thank you.");
    let b = {}; try { b = (await readBody()) || {}; } catch { fail(400, "The request could not be read."); }
    const who = signerIn(b);
    const co = rowCo(e);
    const fileId = await storeBlob(pngIn(b.image), "image/png", `Signature ${who.name}.png`, co, "customer link");
    const s = { ...who, fileId, at: now(), method: "link", ip: clean(ip, 64) };
    await applySignature(e, s, "Customer (signing link)", "link", ip);
    await record({ email: `customer: ${who.name}`.slice(0, 150), co, method: "POST", seg: ["pcr", "public-sign"], body: {}, out: {}, status: 200, error: "", ip,
      aud: { name: [e.docNo, e.customerName].filter(Boolean).join(", ") } }).catch(() => {});
    return publicView(await (await table(T_PCR)).getEntity(PK, e.rowKey));
  }

  /* ---------------- files (Blob Storage) ---------------- */
  let container;
  async function blobs() {
    if (!container) {
      const cs = process.env.STORAGE_CONNECTION; if (!cs) fail(500, "Storage is not set up yet. Add the STORAGE_CONNECTION setting to the Static Web App.");
      container = BlobServiceClient.fromConnectionString(cs).getContainerClient("pcr-files");
      await container.createIfNotExists();
    }
    return container;
  }
  async function upload(user, b) {
    const co = writeCo(user);
    const name = clean(b.name, 200) || "file"; const type = clean(b.type, 120) || "application/octet-stream";
    if (!/^image\/(jpeg|png|webp)$/.test(type)) fail(400, "Upload photos and drawings as JPG or PNG images.");
    const buf = Buffer.from(String(b.data || ""), "base64");
    if (!buf.length) fail(400, "The file is empty.");
    if (buf.length > MAX_FILE) fail(413, `${name} is larger than 10 MB.`);
    const id = await storeBlob(buf, type, name, co, user.email);
    return { id, name, type, size: buf.length, by: user.email, at: now() };
  }
  async function getFile(user, id, download) {
    if (!UUID.test(id)) fail(404, "File not found.");
    const bc = (await blobs()).getBlockBlobClient(id);
    let buf, props;
    try { [buf, props] = await Promise.all([bc.downloadToBuffer(), bc.getProperties()]); } catch (e) { if (e.statusCode === 404) fail(404, "That file is no longer available."); throw e; }
    if (user.co !== "all" && (props.metadata || {}).co !== user.co) fail(404, "File not found.");
    const name = decodeURIComponent((props.metadata || {}).name || id);
    if (user.aud) user.aud.name = name;
    const type = props.contentType || "application/octet-stream";
    return { __binary: buf, headers: { "Content-Type": type, "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, max-age=86400" } };
  }

  /* ---------------- Claude drafting ---------------- */
  async function draft(user, b) {
    const e = await load(user, b.id);
    const co = writeCo(user);
    if (user.aud) { user.aud.name = [e.docNo, e.customerName].filter(Boolean).join(", "); user.aud.detail = clean(b.part, 20); }
    const d = unpackJson(e), body = bodyIn({}, d);
    return AI.run({ part: clean(b.part, 20), company: co, mode: e.mode, customerName: e.customerName, projectTitle: e.projectTitle, site: e.site, poRef: e.poRef,
      startDate: e.startDate, completionDate: e.completionDate, preparedBy: e.preparedBy, attention: e.attention, include: body.include,
      boq: body.boq, serials: body.serials, notes: body.notes, instructions: clean(b.instructions, 1500) || body.instructions, warranty: body.warranty, diagram: body.diagram }, fail, clean);
  }

  /* ---------------- email (Microsoft Graph, app permission Mail.Send) ---------------- */
  const senderFor = co => co === "techhub" ? process.env.TECHHUB_MAIL_SENDER : process.env.MAIL_SENDER;
  let tok = { v: "", exp: 0 };
  async function graphToken() {
    if (tok.v && tok.exp > Date.now() + 60e3) return tok.v;
    const r = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.GRAPH_CLIENT_ID, client_secret: process.env.GRAPH_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }) });
    const j = await r.json(); if (!r.ok) fail(502, "Email sign-in to Microsoft 365 failed. Check the GRAPH settings of the Static Web App.");
    tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 }; return tok.v;
  }
  const addrs = (v, max) => (Array.isArray(v) ? v : String(v || "").split(/[,;\s]+/)).map(s => String(s).trim().toLowerCase()).filter(Boolean).slice(0, max);
  async function share(user, id, b) {
    const e = await load(user, id);
    const co = writeCo(user);
    if (user.aud) user.aud.name = [e.docNo, e.customerName].filter(Boolean).join(", ");
    if (!mailReadyFor(co)) fail(501, "Email isn't set up for your company yet. Download the PDF and send it from Outlook.");
    const to = addrs(b.to, 20), cc = addrs(b.cc, 20).filter(a => a !== user.email);
    if (!to.length) fail(400, "Add the customer's email address.");
    const bad = to.concat(cc).find(a => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)); if (bad) fail(400, `${bad} isn't a valid email address.`);
    const att = b.attachment && b.attachment.data ? { "@odata.type": "#microsoft.graph.fileAttachment", name: clean(b.attachment.name, 200), contentType: "application/pdf", contentBytes: String(b.attachment.data) } : null;
    if (att && att.contentBytes.length > 4.3e6) fail(413, "The PDF is too large to email (over 3 MB). Remove some site pictures, or download it and share it another way.");
    const html = String(b.html || "").slice(0, 200000);
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderFor(co))}/sendMail`, {
      method: "POST", headers: { Authorization: "Bearer " + await graphToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject: txt(b.subject, 250) || `${e.docNo} ${e.projectTitle || "Completion report"}`, body: { contentType: "HTML", content: html },
        toRecipients: to.map(a => ({ emailAddress: { address: a } })), ccRecipients: cc.concat([user.email]).map(a => ({ emailAddress: { address: a } })),
        replyTo: [{ emailAddress: { address: user.email } }], attachments: att ? [att] : [] }, saveToSentItems: true }),
    });
    if (!r.ok) fail(502, `Microsoft 365 didn't send the email (${r.status}). Try again, or download the PDF and send it from Outlook.`);
    const t = await table(T_PCR);
    for (let i = 0; i < 3; i++) {
      const cur = await t.getEntity(PK, e.rowKey); const d = unpackJson(cur);
      d.shares = (d.shares || []).concat([{ at: now(), by: user.email, to: to.join(", "), link: !!b.withLink }]).slice(-30);
      if (b.withLink && d.link) d.link.sentTo = to.join(", ");
      d.history = (d.history || []).concat([log(user.email, `Emailed the report${b.withLink ? " and signing link" : ""} to ${to.join(", ")}`)]).slice(-80);
      try { await t.updateEntity({ partitionKey: PK, rowKey: cur.rowKey, ...packJson(d), updatedAt: now() }, "Merge", { etag: cur.etag }); break; } catch (err) { if (err.statusCode !== 412) throw err; }
    }
    return { sent: true, to };
  }

  /* ---------------- routing: /api/pcr/... ---------------- */
  async function route(method, seg, user, body) {
    const [a, id, sub] = seg;
    if (a === "bootstrap" && method === "GET") {
      return { co: user.co, reports: await list(user), features: { ai: AI.ready(), mail: user.co !== "all" && mailReadyFor(user.co) }, me: { email: user.email, name: nameOf(user.email), isManager: user.isManager } };
    }
    if (a === "reports") {
      if (!id && method === "GET") return list(user);
      if (!id && method === "POST") return create(user, body);
      if (id && !sub && method === "GET") return full(await load(user, id), user);
      if (id && !sub && method === "PUT") return update(user, id, body);
      if (id && !sub && method === "DELETE") return remove(user, id);
      if (id && sub === "sign" && method === "POST") return signOnSite(user, id, body);
      if (id && sub === "company-sign" && method === "POST") return companySign(user, id, body);
      if (id && sub === "reopen" && method === "POST") return reopen(user, id);
      if (id && sub === "link" && method === "POST") return makeLink(user, id, body);
      if (id && sub === "link" && method === "DELETE") return revokeLink(user, id);
      if (id && sub === "share" && method === "POST") return share(user, id, body);
    }
    if (a === "files") {
      if (!id && method === "POST") return upload(user, body);
      if (id && method === "GET") return getFile(user, id, sub === "download");
    }
    if (a === "ai" && method === "POST") return draft(user, body);
    fail(404, "Unknown request.");
  }
  return { route, publicRoute, list };
};
