// Vendor Partners: each company's vendor partner programmes (Cisco, Microsoft, HPE, Dell, Fortinet ...), the tier held,
// renewal dates, what it takes to keep the tier, channel contacts, rebates and MDF claims, partner documents, and the
// staff certifications that count toward each programme.
//
// Storage (Table Storage):
//   partners     PK "partner"  RowKey uuid   co, vendor, domain, supplierId, program, partnerNo, portal, tier, specs (JSON), status,
//                                           startDate, renewalDate, fee, currency, autoRenew, discount, dealReg, requirements (JSON),
//                                           contacts (JSON), benefits (JSON), files (JSON), notes, alertsSent (JSON), stamps
//   partnercerts PK "cert"     RowKey uuid   co, person, email, partnerRef, vendor, name, code, obtained, expiry, file (JSON), alertsSent, stamps
//   vendorlogos  PK <co>       RowKey key    upload (blob name), type, v (version), by, at          (logo uploaded by hand, per company)
//                PK "site"     RowKey domain ok, blob, type, at                                      (icon read from the vendor's own website)
// Blob containers: "partner-files" (documents, cert files), "vendor-logos" (uploaded logos and website icons).
//
// Logos: the page shows, in order, a logo uploaded by hand, the Brandfetch Logo API image (loaded by the browser in an
// <img> tag, as Brandfetch's terms require; the server never downloads or stores Brandfetch images), the icon from the
// vendor's own website (fetched once here and kept), then a lettermark. Setting: BRANDFETCH_CLIENT_ID (optional).
//
// Access: section "partners". Anyone with it can add and edit; only the person who added a record or a manager can delete it.
// Reminder emails 90, 30 and 7 days ahead: .github/scripts/partner-reminders.cjs.

const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const { BlobServiceClient } = require("@azure/storage-blob");

const STATUS = ["active", "renewal", "applied", "lapsed", "dropped"];
const REQ_KINDS = ["certs", "revenue", "other"];
const BEN_KINDS = ["rebate", "mdf", "other"];
const BEN_STATUS = ["open", "claimed", "paid", "lost"];
const FILE_KINDS = { certificate: "Partner certificate", agreement: "Partner agreement", maf: "Authorisation letter (MAF)", tier: "Tier letter", other: "Document" };
const FILE_MAX = 10 * 1048576, FILES_MAX = 40, LOGO_MAX = 1048576;
const IMG_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

module.exports = function makePartners(H) {
  const { table, getOrNull, all, fail, clean, num, isDate, CO, rowCo, inCo, writeCo, diff } = H;
  const T = "partners", PK = "partner", TC = "partnercerts", CPK = "cert", TL = "vendorlogos";
  const json = (s, d) => { try { const v = JSON.parse(s || ""); return v == null ? d : v; } catch { return d; } };
  const arr = (s) => { const v = json(s, []); return Array.isArray(v) ? v : []; };
  const emailRx = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const today = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  const id8 = () => crypto.randomUUID().slice(0, 8);
  const money = v => Math.max(0, Math.round(num(v) * 100) / 100);
  const pname = (v, prog) => !prog ? v : String(prog).toLowerCase().startsWith(String(v).toLowerCase()) ? prog : v + " " + prog;
  const date = (v, label) => { const s = clean(v, 10); if (s && !isDate(s)) fail(400, `${label} is not a valid date.`); return s; };

  // ---------- blob storage ----------
  const containers = {};
  async function box(name) {
    if (!containers[name]) {
      const cs = process.env.STORAGE_CONNECTION; if (!cs) fail(500, "Storage is not set up yet. Add the STORAGE_CONNECTION setting to the Static Web App.");
      const c = BlobServiceClient.fromConnectionString(cs).getContainerClient(name);
      await c.createIfNotExists();
      containers[name] = c;
    }
    return containers[name];
  }

  // ---------- domains ----------
  // "https://www.Cisco.com/partners" -> "cisco.com". Only plain public host names are kept.
  function domainOf(v) {
    let s = clean(v, 200).toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:\s]/)[0];
    return /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(s) ? s : "";
  }
  const keyOf = (domain, vendor) => domain || ("v-" + clean(vendor, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).slice(0, 90);

  // ---------- input ----------
  function tags(v) {
    const a = Array.isArray(v) ? v : String(v || "").split(/[,;\n]+/);
    const seen = new Set(), out = [];
    for (const x of a) { const t = clean(x, 80).replace(/\s+/g, " "); const k = t.toLowerCase(); if (t && !seen.has(k)) { seen.add(k); out.push(t); } if (out.length >= 30) break; }
    return out;
  }
  function list(v, max, label, map) {
    const a = (Array.isArray(v) ? v : []).map(map).filter(Boolean);
    if (a.length > max) fail(400, `A partnership can have at most ${max} ${label}.`);
    return a;
  }
  function partnerIn(b) {
    const f = {
      vendor: clean(b.vendor, 120), domain: domainOf(b.domain), supplierId: clean(b.supplierId, 60), program: clean(b.program, 150),
      partnerNo: clean(b.partnerNo, 80), portal: clean(b.portal, 300), tier: clean(b.tier, 60), status: clean(b.status, 20) || "active",
      startDate: date(b.startDate, "The start date"), renewalDate: date(b.renewalDate, "The renewal date"),
      fee: money(b.fee), currency: clean(b.currency, 5).toUpperCase() || "AED", autoRenew: b.autoRenew === true || b.autoRenew === "true",
      discount: clean(b.discount, 80), dealReg: b.dealReg === true || b.dealReg === "true", notes: clean(b.notes, 4000),
    };
    if (!f.vendor) fail(400, "Enter the vendor name.");
    if (!STATUS.includes(f.status)) fail(400, "Choose a valid status.");
    if (clean(b.domain, 200) && !f.domain) fail(400, "The vendor website should look like cisco.com.");
    if (f.portal && !/^https?:\/\//i.test(f.portal)) f.portal = "https://" + f.portal;
    if (f.fee > 1e9) fail(400, "The annual fee is too large.");
    if (f.startDate && f.renewalDate && f.renewalDate < f.startDate) fail(400, "The renewal date is before the start date.");
    const reqs = list(b.requirements, 20, "requirements", r => {
      r = r || {}; const o = { id: clean(r.id, 20) || id8(), label: clean(r.label, 200), kind: clean(r.kind, 10) || "other", target: Math.max(0, num(r.target)), current: Math.max(0, num(r.current)), done: !!r.done };
      if (!o.label && !o.target && !o.done) return null;
      if (!REQ_KINDS.includes(o.kind)) fail(400, "Choose a valid requirement type.");
      if (!o.label) o.label = o.kind === "certs" ? "Certified staff" : o.kind === "revenue" ? "Annual revenue" : "Requirement";
      return o;
    });
    const contacts = list(b.contacts, 20, "contacts", c => {
      c = c || {}; const o = { id: clean(c.id, 20) || id8(), name: clean(c.name, 100), role: clean(c.role, 80), org: clean(c.org, 120), mobile: clean(c.mobile, 40), phone: clean(c.phone, 40), email: clean(c.email, 150).toLowerCase() };
      if (!o.name && !o.email && !o.mobile && !o.phone) return null;
      if (!o.name) fail(400, "Every contact needs a name.");
      if (o.email && !emailRx.test(o.email)) fail(400, `The email for ${o.name} is not valid.`);
      return o;
    });
    const benefits = list(b.benefits, 50, "rebates and MDF claims", x => {
      x = x || {}; const o = { id: clean(x.id, 20) || id8(), kind: clean(x.kind, 10) || "rebate", title: clean(x.title, 200), amount: money(x.amount), currency: clean(x.currency, 5).toUpperCase() || "AED", deadline: date(x.deadline, "A claim deadline"), status: clean(x.status, 10) || "open", ref: clean(x.ref, 80) };
      if (!o.title && !o.amount) return null;
      if (!BEN_KINDS.includes(o.kind)) fail(400, "Choose rebate, MDF or other.");
      if (!BEN_STATUS.includes(o.status)) fail(400, "Choose a valid claim status.");
      if (!o.title) o.title = o.kind === "mdf" ? "MDF claim" : o.kind === "rebate" ? "Rebate" : "Claim";
      return o;
    });
    return { ...f, specs: JSON.stringify(tags(b.specs)), requirements: JSON.stringify(reqs), contacts: JSON.stringify(contacts), benefits: JSON.stringify(benefits) };
  }

  // ---------- output ----------
  const logoInfo = (logos, e) => {
    const domain = e.domain || "", key = keyOf(domain, e.vendor), up = logos.get(key), site = domain ? logos.get("site:" + domain) : null;
    return { key, domain, upload: up && up.upload ? `/api/partners/logo/up/${encodeURIComponent(key)}?v=${up.v || 1}` : "",
      site: domain && !(site && site.ok === false && Date.now() - Date.parse(site.at) < 7 * 864e5) ? `/api/partners/logo/site/${encodeURIComponent(domain)}?v=${site ? Date.parse(site.at) || 1 : 0}` : "" };
  };
  const partnerOut = (e, logos) => ({
    id: e.rowKey, co: rowCo(e), vendor: e.vendor, domain: e.domain || "", supplierId: e.supplierId || "", program: e.program || "", partnerNo: e.partnerNo || "",
    portal: e.portal || "", tier: e.tier || "", specs: arr(e.specs), status: e.status || "active", startDate: e.startDate || "", renewalDate: e.renewalDate || "",
    fee: num(e.fee), currency: e.currency || "AED", autoRenew: !!e.autoRenew, discount: e.discount || "", dealReg: !!e.dealReg,
    requirements: arr(e.requirements), contacts: arr(e.contacts), benefits: arr(e.benefits), files: arr(e.files), notes: e.notes || "",
    logo: logoInfo(logos || new Map(), e), createdBy: e.createdBy, createdAt: e.createdAt, updatedBy: e.updatedBy, updatedAt: e.updatedAt, etag: e.etag,
  });
  const certOut = e => ({
    id: e.rowKey, co: rowCo(e), person: e.person, email: e.email || "", partnerRef: e.partnerRef || "", vendor: e.vendor || "", name: e.name, code: e.code || "",
    obtained: e.obtained || "", expiry: e.expiry || "", file: json(e.file, null), notes: e.notes || "",
    createdBy: e.createdBy, createdAt: e.createdAt, updatedBy: e.updatedBy, updatedAt: e.updatedAt, etag: e.etag,
  });

  async function logosFor(co) {
    const m = new Map();
    try { (await all(await table(TL), co)).forEach(e => m.set(e.rowKey, e)); } catch {}
    try { (await all(await table(TL), "site")).forEach(e => m.set("site:" + e.rowKey, e)); } catch {}
    return m;
  }
  const coOf = user => user.co === "all" ? user.homeCo : user.co;

  async function bootstrap(user) {
    const [ps, cs, logos] = await Promise.all([all(await table(T), PK), all(await table(TC), CPK), logosFor(coOf(user))]);
    // In the Group view each company's logos are looked up under its own records.
    const other = user.co === "all" ? await logosFor(user.homeCo === "bifold" ? "techhub" : "bifold") : null;
    return {
      partners: ps.filter(e => inCo(e, user)).map(e => partnerOut(e, other && rowCo(e) !== coOf(user) ? other : logos)).sort((a, b) => a.vendor.localeCompare(b.vendor) || a.program.localeCompare(b.program)),
      certs: cs.filter(e => inCo(e, user)).map(certOut).sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999")),
      brandfetch: clean(process.env.BRANDFETCH_CLIENT_ID, 80), today: today(),
    };
  }
  async function loadP(user, id) {
    const e = await getOrNull(await table(T), PK, id);
    if (!e || !inCo(e, user)) fail(404, "This partnership no longer exists.");
    return e;
  }
  async function getP(user, id) { const e = await loadP(user, id); return partnerOut(e, await logosFor(rowCo(e))); }

  // The domain is the key to the logo. If none was typed, take it from the linked supplier's website.
  async function fillDomain(f, co) {
    if (f.domain || !f.supplierId) return;
    const s = await getOrNull(await table("suppliers"), "supplier", f.supplierId).catch(() => null);
    if (s && rowCo(s) === co) f.domain = domainOf(s.website);
  }
  async function create(user, b) {
    const co = writeCo(user);
    const f = partnerIn(b);
    await fillDomain(f, co);
    const dup = (await all(await table(T), PK, ["RowKey", "co", "vendor", "program", "status"])).find(e => rowCo(e) === co && String(e.vendor).toLowerCase() === f.vendor.toLowerCase() && String(e.program || "").toLowerCase() === f.program.toLowerCase() && e.status !== "dropped");
    if (dup) fail(409, `${f.vendor}${f.program ? " " + f.program : ""} is already in the partner list.`, { id: dup.rowKey || dup.RowKey });
    const now = new Date().toISOString();
    const e = { partitionKey: PK, rowKey: crypto.randomUUID(), co, ...f, files: "[]", alertsSent: "[]", createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now };
    await (await table(T)).createEntity(e);
    if (user.aud) user.aud.name = pname(f.vendor, f.program);
    return getP(user, e.rowKey);
  }
  async function update(user, id, b) {
    const cur = await loadP(user, id);
    const co = writeCo(user);
    const f = partnerIn(b);
    await fillDomain(f, co);
    const next = { partitionKey: PK, rowKey: id, co, ...f };
    if (user.aud) { user.aud.name = pname(f.vendor, f.program); user.aud.changes = diff(cur, next).concat(listChanges(cur, next)); }
    try { await (await table(T)).updateEntity({ ...next, updatedBy: user.email, updatedAt: new Date().toISOString() }, "Merge", { etag: b.etag || cur.etag }); }
    catch (err) { if (err.statusCode === 412) fail(409, "Someone else changed this partnership after you opened it. Reload to see their changes, then make yours again."); throw err; }
    return getP(user, id);
  }
  function listChanges(a, b) {
    const out = [];
    const cmp = (k, label, nm) => { const x = arr(a[k]), y = arr(b[k]); const ids = new Set(x.map(i => i.id)), yid = new Set(y.map(i => i.id));
      y.filter(i => !ids.has(i.id)).forEach(i => out.push(`added ${label} ${nm(i)}`)); x.filter(i => !yid.has(i.id)).forEach(i => out.push(`removed ${label} ${nm(i)}`));
      y.filter(i => ids.has(i.id)).forEach(i => { if (JSON.stringify(i) !== JSON.stringify(x.find(o => o.id === i.id))) out.push(`edited ${label} ${nm(i)}`); }); };
    cmp("contacts", "contact", i => i.name); cmp("benefits", "claim", i => i.title); cmp("requirements", "requirement", i => i.label);
    if (a.specs !== b.specs) out.push("changed specialisations");
    return out;
  }
  async function remove(user, id) {
    const t = await table(T);
    const cur = await getOrNull(t, PK, id);
    if (!cur || !inCo(cur, user)) return;
    writeCo(user);
    if (user.aud) user.aud.name = pname(cur.vendor, cur.program);
    if (!user.isManager && cur.createdBy !== user.email) fail(403, "Only the person who added this partnership or a manager can delete it. Set its status to Dropped instead.");
    await t.deleteEntity(PK, id).catch(e => { if (e.statusCode !== 404) throw e; });
    // Its certifications stay (they belong to the person), unlinked but still under the vendor's name.
    const tc = await table(TC);
    for (const e of (await all(tc, CPK, ["RowKey", "partnerRef"])).filter(e => e.partnerRef === id)) await tc.updateEntity({ partitionKey: CPK, rowKey: e.rowKey, partnerRef: "" }, "Merge").catch(() => {});
    const c = await box("partner-files");
    await Promise.all(arr(cur.files).map(f => c.deleteBlob("p/" + f.id).catch(() => {})));
  }

  // ---------- partner documents ----------
  async function changeFiles(user, id, fn) {
    const t = await table(T);
    for (let i = 0; i < 4; i++) {
      const e = await loadP(user, id);
      const files = fn(arr(e.files), e);
      try { await t.updateEntity({ partitionKey: PK, rowKey: id, files: JSON.stringify(files), updatedBy: user.email, updatedAt: new Date().toISOString() }, "Merge", { etag: e.etag }); return getP(user, id); }
      catch (err) { if (err.statusCode !== 412) throw err; }
    }
    fail(409, "The documents were changed by someone else at the same time. Try again.");
  }
  function fileFrom(b, max) {
    const name = clean(b.name, 200).replace(/[\\/\u0000-\u001f]/g, "_") || "file";
    const type = clean(b.type, 120) || "application/octet-stream";
    const buf = Buffer.from(String(b.data || ""), "base64");
    if (!buf.length) fail(400, `${name} is empty.`);
    if (buf.length > max) fail(413, `${name} is larger than ${Math.round(max / 1048576)} MB.`);
    return { name, type, buf };
  }
  async function addFile(user, id, b) {
    writeCo(user);
    const e = await loadP(user, id);
    if (arr(e.files).length >= FILES_MAX) fail(400, `A partnership can hold at most ${FILES_MAX} documents.`);
    const { name, type, buf } = fileFrom(b, FILE_MAX);
    const kind = FILE_KINDS[b.kind] ? b.kind : "other";
    const fid = crypto.randomUUID();
    await (await box("partner-files")).getBlockBlobClient("p/" + fid).uploadData(buf, { blobHTTPHeaders: { blobContentType: type }, metadata: { partner: id, co: rowCo(e) } });
    const f = { id: fid, kind, name, type, size: buf.length, by: user.email, at: new Date().toISOString() };
    if (user.aud) { user.aud.name = name; user.aud.changes = [`${e.vendor}: ${FILE_KINDS[kind]}`]; }
    try { return { ...(await changeFiles(user, id, l => { if (l.length >= FILES_MAX) fail(400, `A partnership can hold at most ${FILES_MAX} documents.`); return l.concat(f); })), file: f }; }
    catch (err) { await (await box("partner-files")).deleteBlob("p/" + fid).catch(() => {}); throw err; }
  }
  async function removeFile(user, id, fid) {
    writeCo(user);
    let gone = null;
    const out = await changeFiles(user, id, (l, e) => { gone = l.find(f => f.id === fid); if (!gone) fail(404, "That document is no longer attached."); if (user.aud) { user.aud.name = gone.name; user.aud.changes = [e.vendor]; } return l.filter(f => f.id !== fid); });
    await (await box("partner-files")).deleteBlob("p/" + fid).catch(() => {});
    return out;
  }
  async function sendBlob(blobName, f, download) {
    let buf;
    try { buf = await (await box("partner-files")).getBlockBlobClient(blobName).downloadToBuffer(); } catch (err) { if (err.statusCode === 404) fail(404, "That file is no longer available."); throw err; }
    const inline = !download && /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(f.type);
    return { __binary: buf, headers: { "Content-Type": inline ? f.type : "application/octet-stream", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } };
  }
  async function getFile(user, id, fid, download) {
    const e = await loadP(user, id);
    const f = arr(e.files).find(x => x.id === fid);
    if (!f) fail(404, "That document is no longer attached.");
    if (user.aud) { user.aud.name = f.name; user.aud.changes = [e.vendor]; }
    return sendBlob("p/" + fid, f, download);
  }

  // ---------- staff certifications ----------
  async function certIn(user, b, co) {
    const f = {
      person: clean(b.person, 100), email: clean(b.email, 150).toLowerCase(), partnerRef: clean(b.partnerRef, 60), vendor: clean(b.vendor, 120),
      name: clean(b.name, 200), code: clean(b.code, 60), obtained: date(b.obtained, "The date obtained"), expiry: date(b.expiry, "The expiry date"), notes: clean(b.notes, 1000),
    };
    if (!f.person) fail(400, "Enter who holds the certification.");
    if (!f.name) fail(400, "Enter the certification name.");
    if (f.email && !emailRx.test(f.email)) fail(400, "The email is not valid.");
    if (f.obtained && f.expiry && f.expiry < f.obtained) fail(400, "The expiry date is before the date obtained.");
    if (f.partnerRef) {
      const p = await getOrNull(await table(T), PK, f.partnerRef);
      if (!p || rowCo(p) !== co) fail(400, "That partnership no longer exists. Pick another one.");
      f.vendor = p.vendor;
    }
    if (!f.vendor) fail(400, "Pick the partnership or enter the vendor.");
    return f;
  }
  async function loadC(user, id) {
    const e = await getOrNull(await table(TC), CPK, id);
    if (!e || !inCo(e, user)) fail(404, "This certification no longer exists.");
    return e;
  }
  async function createCert(user, b) {
    const co = writeCo(user);
    const f = await certIn(user, b, co);
    const now = new Date().toISOString();
    const e = { partitionKey: CPK, rowKey: crypto.randomUUID(), co, ...f, file: "", alertsSent: "[]", createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now };
    await (await table(TC)).createEntity(e);
    if (user.aud) user.aud.name = `${f.person}: ${f.name}`;
    return certOut(await (await table(TC)).getEntity(CPK, e.rowKey));
  }
  async function updateCert(user, id, b) {
    const cur = await loadC(user, id);
    const co = writeCo(user);
    const f = await certIn(user, b, co);
    if (user.aud) { user.aud.name = `${f.person}: ${f.name}`; user.aud.changes = diff(cur, f); }
    const t = await table(TC);
    try { await t.updateEntity({ partitionKey: CPK, rowKey: id, co, ...f, updatedBy: user.email, updatedAt: new Date().toISOString() }, "Merge", { etag: b.etag || cur.etag }); }
    catch (err) { if (err.statusCode === 412) fail(409, "Someone else changed this certification after you opened it. Reload and try again."); throw err; }
    return certOut(await t.getEntity(CPK, id));
  }
  async function removeCert(user, id) {
    const t = await table(TC);
    const cur = await getOrNull(t, CPK, id);
    if (!cur || !inCo(cur, user)) return;
    writeCo(user);
    if (user.aud) user.aud.name = `${cur.person}: ${cur.name}`;
    if (!user.isManager && cur.createdBy !== user.email) fail(403, "Only the person who added this certification or a manager can delete it.");
    await t.deleteEntity(CPK, id).catch(e => { if (e.statusCode !== 404) throw e; });
    const f = json(cur.file, null); if (f && f.id) await (await box("partner-files")).deleteBlob("c/" + f.id).catch(() => {});
  }
  async function setCertFile(user, id, b) {
    writeCo(user);
    const cur = await loadC(user, id);
    const old = json(cur.file, null);
    let f = null;
    if (b && b.data) {
      const x = fileFrom(b, FILE_MAX);
      f = { id: crypto.randomUUID(), name: x.name, type: x.type, size: x.buf.length, by: user.email, at: new Date().toISOString() };
      await (await box("partner-files")).getBlockBlobClient("c/" + f.id).uploadData(x.buf, { blobHTTPHeaders: { blobContentType: x.type }, metadata: { cert: id, co: rowCo(cur) } });
    }
    const t = await table(TC);
    try { await t.updateEntity({ partitionKey: CPK, rowKey: id, file: f ? JSON.stringify(f) : "", updatedBy: user.email, updatedAt: new Date().toISOString() }, "Merge", { etag: cur.etag }); }
    catch (err) { if (f) await (await box("partner-files")).deleteBlob("c/" + f.id).catch(() => {}); if (err.statusCode === 412) fail(409, "This certification changed while you were uploading. Try again."); throw err; }
    if (old && old.id) await (await box("partner-files")).deleteBlob("c/" + old.id).catch(() => {});
    if (user.aud) { user.aud.name = f ? f.name : (old && old.name) || "certificate"; user.aud.changes = [`${cur.person}: ${cur.name}`]; }
    return certOut(await t.getEntity(CPK, id));
  }
  async function getCertFile(user, id, download) {
    const e = await loadC(user, id);
    const f = json(e.file, null);
    if (!f || !f.id) fail(404, "No certificate file is attached.");
    if (user.aud) { user.aud.name = f.name; user.aud.changes = [`${e.person}: ${e.name}`]; }
    return sendBlob("c/" + f.id, f, download);
  }

  // ---------- logos ----------
  // Magic bytes, so only real images are stored and served (never SVG or HTML).
  function sniff(buf) {
    if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
    if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
    if (buf.length > 6 && buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
    if (buf.length > 6 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return "image/x-icon";
    return "";
  }
  const imgHeaders = (type, v) => ({ "Content-Type": type, "Cache-Control": v ? "private, max-age=604800, immutable" : "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'", "Content-Disposition": "inline" });

  async function uploadLogo(user, id, b) {
    const co = writeCo(user);
    const e = await loadP(user, id);
    const x = fileFrom(b, LOGO_MAX);
    const type = sniff(x.buf);
    if (!IMG_TYPES.includes(type)) fail(400, "Upload the logo as a PNG, JPG, WebP or GIF image.");
    const key = keyOf(e.domain, e.vendor), blob = `up/${co}/${crypto.randomUUID()}`;
    await (await box("vendor-logos")).getBlockBlobClient(blob).uploadData(x.buf, { blobHTTPHeaders: { blobContentType: type } });
    const t = await table(TL), cur = await getOrNull(t, co, key);
    await t.upsertEntity({ partitionKey: co, rowKey: key, upload: blob, type, v: num(cur && cur.v) + 1, by: user.email, at: new Date().toISOString() }, "Replace");
    if (cur && cur.upload) await (await box("vendor-logos")).deleteBlob(cur.upload).catch(() => {});
    if (user.aud) { user.aud.name = e.vendor; user.aud.changes = ["uploaded logo"]; }
    return getP(user, id);
  }
  // Removing the uploaded logo, or asking for a fresh automatic one: the website icon is read again next time it is shown.
  async function resetLogo(user, id, refresh) {
    const co = writeCo(user);
    const e = await loadP(user, id);
    const key = keyOf(e.domain, e.vendor), t = await table(TL);
    if (!refresh) {
      const cur = await getOrNull(t, co, key);
      if (cur) { await t.deleteEntity(co, key).catch(() => {}); if (cur.upload) await (await box("vendor-logos")).deleteBlob(cur.upload).catch(() => {}); }
    }
    if (e.domain) {
      const s = await getOrNull(t, "site", e.domain);
      if (s) { await t.deleteEntity("site", e.domain).catch(() => {}); if (s.blob) await (await box("vendor-logos")).deleteBlob(s.blob).catch(() => {}); }
    }
    if (user.aud) { user.aud.name = e.vendor; user.aud.changes = [refresh ? "refreshed logo" : "removed uploaded logo"]; }
    return getP(user, id);
  }
  async function uploadedLogo(user, key) {
    const e = await getOrNull(await table(TL), coOf(user), key) || (user.co === "all" ? await getOrNull(await table(TL), user.homeCo === "bifold" ? "techhub" : "bifold", key) : null);
    if (!e || !e.upload) fail(404, "No logo uploaded.");
    try { return { __binary: await (await box("vendor-logos")).getBlockBlobClient(e.upload).downloadToBuffer(), headers: imgHeaders(e.type, true) }; }
    catch (err) { if (err.statusCode === 404) fail(404, "No logo uploaded."); throw err; }
  }

  // The vendor's own website icon: read once, kept in blob storage, and re-read only when someone asks for a refresh.
  // Only public https sites are contacted (no IP addresses, no private or local networks), with short timeouts and size caps.
  const PRIVATE4 = [["10.0.0.0", 8], ["127.0.0.0", 8], ["0.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["100.64.0.0", 10], ["192.0.0.0", 24], ["198.18.0.0", 15], ["224.0.0.0", 3]];
  const ip4n = ip => ip.split(".").reduce((a, x) => a * 256 + Number(x), 0);
  function privateIp(ip) {
    if (net.isIPv4(ip)) return PRIVATE4.some(([b, m]) => Math.floor(ip4n(ip) / 2 ** (32 - m)) === Math.floor(ip4n(b) / 2 ** (32 - m)));
    const s = ip.toLowerCase();
    if (s.startsWith("::ffff:")) return privateIp(s.slice(7));
    return s === "::1" || s === "::" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff");
  }
  async function publicHost(host) {
    if (!domainOf(host) || net.isIP(host)) return false;
    try { const a = await dns.lookup(host, { all: true }); return a.length > 0 && a.every(x => !privateIp(x.address)); } catch { return false; }
  }
  async function grab(url, max, accept) {
    for (let hop = 0; hop < 4; hop++) {
      let u; try { u = new URL(url); } catch { return null; }
      if (u.protocol !== "https:" || (u.port && u.port !== "443") || !(await publicHost(u.hostname))) return null;
      let r;
      try { r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0 (compatible; BifoldTools/1.0; vendor logo)", Accept: accept } }); } catch { return null; }
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { url = new URL(r.headers.get("location"), u).toString(); continue; }
      if (!r.ok || !r.body) return null;
      const chunks = []; let size = 0;
      try { for await (const c of r.body) { size += c.length; if (size > max) { return null; } chunks.push(c); } } catch { return null; }
      return { buf: Buffer.concat(chunks.map(c => Buffer.from(c))), url: u.toString(), type: r.headers.get("content-type") || "" };
    }
    return null;
  }
  // Icon links in the page head, best first: apple-touch-icon, then the largest declared size.
  function iconLinks(html, base) {
    const out = [];
    for (const m of String(html).slice(0, 300000).matchAll(/<link\b[^>]*>/gi)) {
      const tag = m[0], rel = (tag.match(/\brel\s*=\s*["']?([^"'>]+)/i) || [])[1] || "", href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || tag.match(/\bhref\s*=\s*([^\s>]+)/i) || [])[1];
      if (!href || !/\bicon\b|apple-touch-icon/i.test(rel) || /mask-icon/i.test(rel) || /\.svg(\?|$)/i.test(href)) continue;
      const sz = Math.max(0, ...((tag.match(/\bsizes\s*=\s*["']?([^"'>]+)/i) || [])[1] || "").split(/\s+/).map(s => parseInt(s, 10) || 0));
      let abs; try { abs = new URL(href.replace(/&amp;/g, "&"), base).toString(); } catch { continue; }
      out.push({ url: abs, score: (/apple-touch-icon/i.test(rel) ? 1000 : 0) + (sz || 32) });
    }
    return out.sort((a, b) => b.score - a.score).map(x => x.url);
  }
  async function fetchSiteIcon(domain) {
    const tries = [];
    for (const host of [domain, "www." + domain]) {
      const page = await grab(`https://${host}/`, 600000, "text/html");
      if (page) { tries.push(...iconLinks(page.buf.toString("utf8"), page.url)); break; }
    }
    tries.push(`https://${domain}/apple-touch-icon.png`, `https://www.${domain}/apple-touch-icon.png`, `https://${domain}/favicon.ico`, `https://www.${domain}/favicon.ico`);
    let best = null;
    for (const u of [...new Set(tries)].slice(0, 8)) {
      const r = await grab(u, 400000, "image/*");
      const type = r && sniff(r.buf);
      if (!type) continue;
      if (!best || r.buf.length > best.buf.length) best = { buf: r.buf, type };
      if (type !== "image/x-icon" && r.buf.length > 2500) break; // a real PNG/JPG icon: good enough
    }
    return best;
  }
  const inflight = new Map();
  async function siteLogo(user, domain) {
    domain = domainOf(domain);
    if (!domain) fail(404, "No logo.");
    const t = await table(TL);
    let e = await getOrNull(t, "site", domain);
    if (e && e.ok === false && Date.now() - Date.parse(e.at) < 7 * 864e5) fail(404, "No logo found on the vendor's website.");
    if (!e || !e.ok) {
      // Only domains used by one of the signed-in company's partnerships are fetched, so the endpoint can't be used to probe other sites.
      const used = (await all(await table(T), PK, ["co", "domain"])).some(p => (p.domain === domain) && (user.co === "all" || rowCo(p) === user.co));
      if (!used) fail(404, "No logo.");
      if (!inflight.has(domain)) inflight.set(domain, (async () => {
        const icon = await fetchSiteIcon(domain);
        const at = new Date().toISOString();
        if (!icon) { await t.upsertEntity({ partitionKey: "site", rowKey: domain, ok: false, at }, "Replace"); return null; }
        const blob = `site/${domain}`;
        await (await box("vendor-logos")).getBlockBlobClient(blob).uploadData(icon.buf, { blobHTTPHeaders: { blobContentType: icon.type } });
        await t.upsertEntity({ partitionKey: "site", rowKey: domain, ok: true, blob, type: icon.type, at }, "Replace");
        return { ok: true, blob, type: icon.type };
      })().finally(() => setTimeout(() => inflight.delete(domain), 1000)));
      e = await inflight.get(domain);
      if (!e) fail(404, "No logo found on the vendor's website.");
    }
    try { return { __binary: await (await box("vendor-logos")).getBlockBlobClient(e.blob).downloadToBuffer(), headers: imgHeaders(e.type, true) }; }
    catch (err) { if (err.statusCode === 404) { await t.deleteEntity("site", domain).catch(() => {}); fail(404, "No logo."); } throw err; }
  }

  // ---------- alerts bell ----------
  async function alerts(user) {
    const b = await bootstrap(user), now = today(), out = [];
    const days = d => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(now + "T00:00:00Z")) / 864e5);
    const fd = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    const names = new Map(b.partners.map(p => [p.id, p]));
    b.partners.filter(p => ["active", "renewal"].includes(p.status) && p.renewalDate).forEach(p => { const d = days(p.renewalDate);
      if (d <= 60) out.push({ tool: "partners", severity: d < 0 ? "high" : d <= 30 ? "medium" : "low", when: p.renewalDate, href: "/partners/#p=" + encodeURIComponent(p.id),
        title: `${p.vendor} partnership ${d < 0 ? "renewal overdue" : "renewal due"}`, text: `${[p.program, p.tier].filter(Boolean).join(" · ")}${p.program || p.tier ? " · " : ""}${d < 0 ? "was due " + fd(p.renewalDate) : d === 0 ? "due today" : d + " days left"}` }); });
    b.partners.filter(p => p.status !== "dropped").forEach(p => p.benefits.filter(x => x.status === "open" && x.deadline).forEach(x => { const d = days(x.deadline);
      if (d <= 30 && d >= -14) out.push({ tool: "partners", severity: d < 0 ? "high" : d <= 7 ? "medium" : "low", when: x.deadline, href: "/partners/#p=" + encodeURIComponent(p.id),
        title: `${p.vendor} ${x.kind === "mdf" ? "MDF" : "rebate"} claim: ${x.title}`, text: `${x.amount ? x.currency + " " + x.amount.toLocaleString("en-US") + " · " : ""}${d < 0 ? "deadline passed " + fd(x.deadline) : d === 0 ? "deadline today" : "deadline " + fd(x.deadline)}` }); }));
    b.certs.filter(c => c.expiry).forEach(c => { const d = days(c.expiry);
      if (d <= 60 && d >= -30) out.push({ tool: "partners", severity: d < 0 ? "medium" : d <= 14 ? "medium" : "low", when: c.expiry, href: "/partners/#certs",
        title: `${c.person}: ${c.name} ${d < 0 ? "expired" : "expiring"}`, text: `${(names.get(c.partnerRef) || {}).vendor || c.vendor} · ${d < 0 ? "expired " + fd(c.expiry) : d + " days left"}` }); });
    return out;
  }

  async function route(method, seg, user, body) {
    const [a, b, c, d] = seg;
    if (!a && method === "GET") return bootstrap(user);
    if (!a && method === "POST") return create(user, body);
    if (a === "logo" && method === "GET") {
      if (b === "site" && c) return siteLogo(user, c);
      if (b === "up" && c) return uploadedLogo(user, c);
      fail(404, "No logo.");
    }
    if (a === "certs") {
      if (!b && method === "GET") return (await bootstrap(user)).certs;
      if (!b && method === "POST") return createCert(user, body);
      if (b && c === "file") {
        if (method === "POST") return setCertFile(user, b, body);
        if (method === "DELETE") return setCertFile(user, b, {});
        if (method === "GET") return getCertFile(user, b, d === "download");
      }
      if (b && !c && method === "PUT") return updateCert(user, b, body);
      if (b && !c && method === "DELETE") return removeCert(user, b);
      fail(404, "Unknown request.");
    }
    if (a && b === "files") {
      if (!c && method === "POST") return addFile(user, a, body);
      if (c && method === "GET") return getFile(user, a, c, d === "download");
      if (c && method === "DELETE") return removeFile(user, a, c);
    }
    if (a && b === "logo") {
      if (!c && method === "POST") return uploadLogo(user, a, body);
      if (!c && method === "DELETE") return resetLogo(user, a, false);
      if (c === "refresh" && method === "POST") return resetLogo(user, a, true);
    }
    if (a && !b && method === "GET") return getP(user, a);
    if (a && !b && method === "PUT") return update(user, a, body);
    if (a && !b && method === "DELETE") return remove(user, a);
    fail(404, "Unknown request.");
  }
  return { route, alerts, bootstrap, FILE_KINDS, _test: { domainOf, iconLinks, privateIp, sniff, fetchSiteIcon } };
};
