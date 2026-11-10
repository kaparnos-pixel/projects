// AMC Tracker API: annual maintenance contracts, awarded contracts, maintenance visits, files,
// optional Claude drafting and email to customers.
//
// Who sees what:
//   - An AMC (proposal + commercial value) is visible to the person who created it and to managers
//     (BIFOLD_MANAGERS, default ranjan@bifoldtech.com). Only they can change it.
//   - Awarded contracts (no money) and maintenance visits are visible to everyone signed in, so engineers
//     can plan and report visits.
//   - Customers come from the shared customer list (lib.js).
//
// Extra settings (all optional):
//   ANTHROPIC_API_KEY, ANTHROPIC_MODEL   Claude drafting of proposals and visit write-ups (default model claude-sonnet-5-5)
//   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET   send proposals / reports to customers, from
//   MAIL_SENDER (Bifold) or TECHHUB_MAIL_SENDER (Tech Hub)
//                                                                        (same Entra app as the PDC reminders)

const crypto = require("crypto");
const { BlobServiceClient } = require("@azure/storage-blob");
const AI = require("./amc-ai");

const AMC = "amc", APK = "amc";
const CON = "amccontracts", KPK = "contract";
const VIS = "amcvisits", VPK = "visit";
const STATUSES = ["draft", "sent", "awarded", "lost"];
const VISIT_STATUS = ["scheduled", "in_progress", "completed", "cancelled"];
const VISIT_TYPES = ["pm", "corrective", "emergency", "survey"];
const MAX_FILE = 10 * 1048576;

module.exports = function makeAmc(H) {
  const { table, getOrNull, all, packJson, unpackJson, fail, clean, num, isDate, emailOk, CUST, CPK, CO, rowCo, inCo, writeCo, sameCoEmail, mailReadyFor } = H;
  // Reference prefixes per company: BFT for Bifold, TH for Tech Hub.
  const PFX = { bifold: "BFT", techhub: "TH" };
  const now = () => new Date().toISOString();
  const gulfDay = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
  const etagFail = what => err => { if (err.statusCode === 412) fail(409, `Someone else changed this ${what} after you opened it. Reload to see their changes, then make yours again.`); throw err; };

  /* ---------------- AMCs ---------------- */
  const visible = (e, user) => inCo(e, user) && (user.isManager || e.owner === user.email);
  function amcSummary(e) {
    return {
      id: e.rowKey, co: rowCo(e), ref: e.ref, customerId: e.customerId, customerName: e.customerName, systems: e.systems || "", value: num(e.value),
      status: e.status, owner: e.owner, planName: e.planName || "", subtitle: e.subtitle || "", proposalStatus: e.proposalStatus || "",
      proposalSource: e.proposalSource || "", proposalAt: e.proposalAt || "", proposalStale: !!e.proposalStale, sentAt: e.sentAt || "",
      termMonths: num(e.termMonths) || 12, proposedStart: e.proposedStart || "", renewalOf: e.renewalOf || "", award: json(e.award, null),
      createdAt: e.createdAt, updatedAt: e.updatedAt, updatedBy: e.updatedBy,
    };
  }
  function amcFull(e, user) {
    const d = unpackJson(e);
    return { ...amcSummary(e), proposal: d.proposal || null, terms: d.terms || {}, files: d.files || [], history: d.history || [], shares: d.shares || [], etag: e.etag, canDelete: user.isManager || e.owner === user.email };
  }
  async function loadAmc(user, id) {
    const e = await getOrNull(await table(AMC), APK, id);
    if (!e || !visible(e, user)) fail(404, "This AMC doesn't exist, was deleted, or belongs to someone else.");
    return e;
  }
  const log = (user, text) => ({ at: now(), by: user.email, text: clean(text, 300) });
  async function customerName(id, co) {
    const c0 = await getOrNull(await table(CUST), CPK, id);
    const c = c0 && rowCo(c0) === co ? c0 : null;
    if (!c) fail(400, "That customer is no longer in the customer list. Choose another.");
    return c;
  }
  function filesIn(arr) {
    return (Array.isArray(arr) ? arr : []).slice(0, 60).map(f => ({ id: clean(f.id, 60), name: clean(f.name, 200), type: clean(f.type, 120), size: num(f.size), by: clean(f.by, 150), at: clean(f.at, 40) })).filter(f => /^[0-9a-f-]{36}$/.test(f.id));
  }
  // Contract details the creator can set before drafting (all optional; the proposal falls back to template defaults).
  const PAY = ["annual", "semi", "quarterly", "monthly"], PM = ["monthly", "quarterly", "semiannual", "annual", "none"];
  function termsIn(t) {
    t = t && typeof t === "object" ? t : {};
    const out = {
      endDate: isDate(clean(t.endDate, 10)) ? clean(t.endDate, 10) : "", attention: clean(t.attention, 120), location: clean(t.location, 120),
      payment: PAY.includes(t.payment) ? t.payment : "", pm: PM.includes(t.pm) ? t.pm : "", coverage: clean(t.coverage, 80),
      validDays: [15, 30, 45, 60, 90].includes(num(t.validDays)) ? num(t.validDays) : 30,
    };
    return out;
  }
  function startIn(s, termMonths, endDate) {
    const start = clean(s, 10);
    if (start && !isDate(start)) fail(400, "The contract start date is not valid.");
    if (start && endDate && endDate <= start) fail(400, "The contract end date must be after the start date.");
    if (start && endDate && Date.parse(endDate) - Date.parse(start) > 5.1 * 365 * 864e5) fail(400, "A contract term can't be longer than 5 years.");
    return start;
  }
  const monthsIn = v => [6, 12, 24, 36].includes(num(v)) ? num(v) : 12;
  async function nextRef(custName, co) {
    const code = String(custName).replace(/\b(LLC|L\.L\.C\.?|FZE|FZ-LLC|FZCO|Co\.?|Company|Limited|Ltd\.?|Est\.?|Establishment|Trading)\b/gi, "").trim()
      .split(/\s+/).filter(Boolean).map((w, i, a) => a.length > 1 ? w.slice(0, i < 2 ? 4 : 1) : w.slice(0, 8)).join("").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "CUST";
    const yr = gulfDay().slice(0, 4);
    const rows = await all(await table(AMC), APK, ["RowKey", "ref"]);
    const prefix = `${PFX[co]}-AMC-${yr}-${code}-`;
    const n = rows.filter(r => String(r.ref || "").startsWith(prefix)).length + 1;
    return prefix + String(n).padStart(3, "0");
  }
  async function listAmcs(user) {
    const rows = await all(await table(AMC), APK, ["RowKey", "co", "ref", "customerId", "customerName", "systems", "value", "status", "owner", "planName", "subtitle", "proposalStatus", "proposalSource", "proposalAt", "proposalStale", "sentAt", "termMonths", "proposedStart", "renewalOf", "award", "createdAt", "updatedAt", "updatedBy"]);
    return rows.map(e => { e.rowKey = e.rowKey || e.RowKey; return e; }).filter(e => visible(e, user)).map(amcSummary);
  }
  async function createAmc(user, b, extra = {}) {
    const customerId = clean(b.customerId, 60); if (!customerId) fail(400, "Choose a customer.");
    const systems = clean(b.systems, 6000); if (!systems) fail(400, "Describe the systems the AMC covers.");
    const value = Math.round(num(b.value) * 100) / 100; if (!(value > 0) || value > 1e9) fail(400, "Enter the annual AMC value in AED, excluding VAT.");
    const co = writeCo(user);
    const c = await customerName(customerId, co);
    const terms = termsIn(b.terms), termMonths = monthsIn(b.termMonths);
    const proposedStart = startIn(b.proposedStart || extra.proposedStart, termMonths, terms.endDate);
    const id = crypto.randomUUID();
    const t = now();
    const e = {
      partitionKey: APK, rowKey: id, co, ref: await nextRef(c.name, co), customerId, customerName: c.name, systems, value, status: "draft", owner: user.email,
      planName: "", subtitle: "", proposalStatus: "pending", proposalSource: "", proposalAt: "", proposalStale: false, sentAt: "", termMonths,
      proposedStart, renewalOf: clean(extra.renewalOf, 60), award: "", createdAt: t, updatedAt: t, updatedBy: user.email,
      ...packJson({ proposal: null, terms, files: filesIn(b.files), history: [log(user, extra.logText || "Created AMC")], shares: [] }),
    };
    await (await table(AMC)).createEntity(e);
    return amcFull(await (await table(AMC)).getEntity(APK, id), user);
  }
  // Partial update: only the fields sent change. Everything is checked here, not trusted from the page.
  async function updateAmc(user, id, b) {
    const t = await table(AMC);
    const e = await loadAmc(user, id);
    const co = writeCo(user);
    const d = unpackJson(e);
    const next = { ...e, co };
    const hist = d.history || [];
    if (b.customerId !== undefined || b.systems !== undefined || b.value !== undefined) {
      const customerId = clean(b.customerId ?? e.customerId, 60), systems = clean(b.systems ?? e.systems, 6000), value = Math.round(num(b.value ?? e.value) * 100) / 100;
      if (!systems) fail(400, "Describe the systems the AMC covers.");
      if (!(value > 0) || value > 1e9) fail(400, "Enter the annual AMC value in AED, excluding VAT.");
      const c = customerId !== e.customerId ? await customerName(customerId, co) : { name: e.customerName };
      const changed = customerId !== e.customerId || systems !== e.systems || value !== num(e.value);
      Object.assign(next, { customerId, customerName: c.name, systems, value, proposalStale: changed && !!d.proposal ? true : !!e.proposalStale });
    }
    if (b.terms !== undefined || b.proposedStart !== undefined || b.termMonths !== undefined) {
      const terms = b.terms !== undefined ? termsIn(b.terms) : (d.terms || {});
      const termMonths = b.termMonths !== undefined ? monthsIn(b.termMonths) : num(e.termMonths) || 12;
      next.proposedStart = startIn(b.proposedStart !== undefined ? b.proposedStart : e.proposedStart, termMonths, terms.endDate);
      next.termMonths = termMonths; d.terms = terms;
    }
    if (b.status !== undefined) {
      const s = String(b.status);
      if (!["draft", "sent", "lost"].includes(s)) fail(400, "Use Mark awarded to award an AMC.");
      if (e.status === "awarded") fail(400, "This AMC is awarded. Its status follows the contract.");
      next.status = s; if (s === "sent" && !e.sentAt) next.sentAt = now();
    }
    if (b.proposal !== undefined) {
      const p = b.proposal; if (!p || typeof p !== "object" || !p.meta || !p.commercial) fail(400, "The proposal is incomplete.");
      d.proposal = p; next.proposalStatus = "ready"; next.proposalSource = clean(b.proposalSource, 20) || "template"; next.proposalAt = now(); next.proposalStale = false;
      next.subtitle = clean(p.meta.subtitle, 120); next.planName = clean(p.signoff && p.signoff.plan, 120);
    }
    if (b.proposalStatus !== undefined) next.proposalStatus = ["pending", "generating", "ready"].includes(b.proposalStatus) ? b.proposalStatus : e.proposalStatus;
    if (b.files !== undefined) d.files = filesIn(b.files);
    if (b.log) hist.push(log(user, b.log));
    d.history = hist.slice(-80);
    Object.assign(next, packJson(d), { updatedAt: now(), updatedBy: user.email });
    delete next.etag; delete next.timestamp;
    await t.updateEntity(next, "Replace", { etag: b.etag || e.etag }).catch(etagFail("AMC"));
    return amcFull(await t.getEntity(APK, id), user);
  }
  async function deleteAmc(user, id) {
    const e = await loadAmc(user, id);
    writeCo(user);
    if (e.status === "awarded" && !user.isManager) fail(403, "Only a manager can delete an awarded AMC.");
    await (await table(AMC)).deleteEntity(APK, id);
    try { await (await table(CON)).deleteEntity(KPK, id); } catch (err) { if (err.statusCode !== 404) throw err; }
  }

  /* ---------------- contracts (awarded AMCs) ---------------- */
  function conOut(e) {
    return {
      amcId: e.rowKey, co: rowCo(e), ref: e.ref, owner: e.owner, customerId: e.customerId, customerName: e.customerName, site: e.site || "", contactName: e.contactName || "",
      contactEmail: e.contactEmail || "", systems: e.systems || "", plan: e.plan || "", awardDate: e.awardDate, start: e.start, end: e.end, months: num(e.months),
      pmMonths: num(e.pmMonths), lpo: e.lpo || "", alertDays: num(e.alertDays) || 60, notifyEmail: e.notifyEmail || "", status: e.status || "active",
      alertsSent: json(e.alertsSent, []), renewalAmcId: e.renewalAmcId || "", createdAt: e.createdAt, updatedAt: e.updatedAt,
    };
  }
  const listContracts = async user => (await all(await table(CON), KPK)).filter(e => inCo(e, user)).map(conOut);
  function addMonths(iso, n) {
    const [y, m, d] = iso.split("-").map(Number); const first = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
  }
  const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  async function award(user, id, b) {
    const e = await loadAmc(user, id);
    const co = writeCo(user);
    const awardDate = clean(b.awardDate, 10), start = clean(b.start, 10);
    if (!isDate(awardDate) || !isDate(start)) fail(400, "Enter the award date and contract start date.");
    const months = [6, 12, 24, 36].includes(num(b.months)) ? num(b.months) : 12;
    const pmMonths = [0, 1, 3, 6, 12].includes(num(b.pmMonths)) ? num(b.pmMonths) : 3;
    const alertDays = [30, 45, 60, 90].includes(num(b.alertDays)) ? num(b.alertDays) : 60;
    const notifyEmail = clean(b.notifyEmail, 150).toLowerCase();
    if (!emailOk(notifyEmail) || !sameCoEmail(notifyEmail, user)) fail(400, "Enter a colleague's email address in your company for the expiry alerts.");
    let end = addDays(addMonths(start, months), -1);
    const wantEnd = clean(b.end, 10);
    if (wantEnd) {
      if (!isDate(wantEnd) || wantEnd <= start) fail(400, "The contract end date must be after the start date.");
      if (Date.parse(wantEnd) - Date.parse(start) > 5.1 * 365 * 864e5) fail(400, "A contract term can't be longer than 5 years.");
      end = wantEnd;
    }
    const ct = await table(CON);
    const prev = await getOrNull(ct, KPK, id);
    const cust = await getOrNull(await table(CUST), CPK, e.customerId) || {};
    const t = now();
    const c = {
      partitionKey: KPK, rowKey: id, co, ref: e.ref, owner: e.owner, customerId: e.customerId, customerName: e.customerName,
      site: [cust.address, cust.emirate].filter(Boolean).join(", "), contactName: cust.contactName || "", contactEmail: cust.email || "",
      systems: e.systems, plan: e.planName || "", awardDate, start, end, months, pmMonths, lpo: clean(b.lpo, 60), alertDays, notifyEmail,
      status: prev ? prev.status : "active", alertsSent: prev && prev.end === end ? prev.alertsSent : "[]", renewalAmcId: prev ? prev.renewalAmcId || "" : "",
      createdAt: prev ? prev.createdAt : t, updatedAt: t,
    };
    await ct.upsertEntity(c, "Replace");
    // A renewal that is awarded closes out the contract it renews.
    if (e.renewalOf) { const old = await getOrNull(ct, KPK, e.renewalOf); if (old) await ct.updateEntity({ partitionKey: KPK, rowKey: e.renewalOf, status: "renewed", updatedAt: t }, "Merge"); }
    const d = unpackJson(e);
    d.history = (d.history || []).concat([log(user, prev ? "Updated award details" : `Marked as awarded (${start} to ${end})`)]).slice(-80);
    const next = { ...e, status: "awarded", termMonths: months, award: JSON.stringify({ date: awardDate, start, end, months, lpo: c.lpo, alertDays }), ...packJson(d), updatedAt: t, updatedBy: user.email };
    delete next.etag; delete next.timestamp;
    await (await table(AMC)).updateEntity(next, "Replace", { etag: e.etag }).catch(etagFail("AMC"));
    const visits = [];
    if (!prev && b.schedule && pmMonths > 0) {
      // One PM visit per cycle across the whole contract period (start to end), two weeks into each cycle.
      const dates = [];
      for (let k = 0; k < 120; k++) { const date = addDays(addMonths(start, k * pmMonths), 14); if (date > end) break; dates.push(date); }
      for (let k = 0; k < dates.length; k++)
        visits.push(await createVisit(user, { amcId: id, type: "pm", scheduledDate: dates[k], notes: `Planned preventive maintenance ${k + 1} of ${dates.length}`, checklist: b.checklist }));
    }
    return { amc: amcFull(await (await table(AMC)).getEntity(APK, id), user), contract: conOut(await ct.getEntity(KPK, id)), visits };
  }
  async function renew(user, id) {
    const e = await loadAmc(user, id);
    writeCo(user);
    const ct = await table(CON); const c = await getOrNull(ct, KPK, id);
    if (!c) fail(400, "Only an awarded AMC can be renewed.");
    if (c.renewalAmcId) fail(409, "A renewal has already been started for this contract.");
    const prevTerms = unpackJson(e).terms || {};
    const n = await createAmc(user, { customerId: e.customerId, systems: e.systems, value: e.value, files: [], termMonths: e.termMonths, terms: { ...prevTerms, endDate: "" } }, { proposedStart: addDays(c.end, 1), renewalOf: id, logText: "Created as renewal of " + e.ref });
    await ct.updateEntity({ partitionKey: KPK, rowKey: id, renewalAmcId: n.id, updatedAt: now() }, "Merge");
    return { amc: n, contract: conOut(await ct.getEntity(KPK, id)) };
  }

  /* ---------------- visits ---------------- */
  function visitOut(e) {
    const d = unpackJson(e);
    return {
      id: e.rowKey, co: rowCo(e), amcId: e.amcId, ref: e.ref, customerName: e.customerName, site: e.site || "", type: e.type, scheduledDate: e.scheduledDate, time: e.time || "",
      engineers: e.engineers || "", status: e.status, reportNo: e.reportNo || "", completedDate: e.completedDate || "", arrival: e.arrival || "", departure: e.departure || "",
      customerRep: e.customerRep || "", notes: e.notes || "", checklist: d.checklist || [], findings: d.findings || "", actions: d.actions || "", recommendations: d.recommendations || "",
      photos: d.photos || [], files: d.files || [], shares: d.shares || [], createdBy: e.createdBy, createdAt: e.createdAt, updatedAt: e.updatedAt, updatedBy: e.updatedBy, etag: e.etag,
    };
  }
  const listVisits = async user => (await all(await table(VIS), VPK)).filter(e => inCo(e, user)).map(visitOut);
  function checklistIn(arr) { return (Array.isArray(arr) ? arr : []).slice(0, 80).map(c => ({ item: clean(c.item, 200), result: ["ok", "issue", "na"].includes(c.result) ? c.result : "", note: clean(c.note, 400) })).filter(c => c.item); }
  function photosIn(arr) { return (Array.isArray(arr) ? arr : []).slice(0, 60).map(p => ({ id: clean(p.id, 60), caption: clean(p.caption, 200), w: num(p.w), h: num(p.h), by: clean(p.by, 150), at: clean(p.at, 40) })).filter(p => /^[0-9a-f-]{36}$/.test(p.id)); }
  async function createVisit(user, b) {
    const co = writeCo(user);
    const c0 = await getOrNull(await table(CON), KPK, clean(b.amcId, 60));
    const c = c0 && rowCo(c0) === co ? c0 : null;
    if (!c) fail(400, "Choose an awarded contract for this visit.");
    const scheduledDate = clean(b.scheduledDate, 10); if (!isDate(scheduledDate)) fail(400, "Choose the visit date.");
    const type = VISIT_TYPES.includes(b.type) ? b.type : "pm";
    const existing = (await all(await table(VIS), VPK, ["RowKey", "amcId"])).filter(v => v.amcId === c.rowKey).length;
    const code = String(c.ref || "").split("-").slice(3, 4)[0] || "AMC";
    const id = crypto.randomUUID(); const t = now();
    const e = {
      partitionKey: VPK, rowKey: id, co, amcId: c.rowKey, ref: c.ref, customerName: c.customerName, site: c.site || "", type, scheduledDate, time: clean(b.time, 5),
      engineers: clean(b.engineers, 200), status: "scheduled", reportNo: `${PFX[co]}-MR-${scheduledDate.slice(0, 4)}-${code}-${String(existing + 1).padStart(2, "0")}`, completedDate: "",
      arrival: "", departure: "", customerRep: c.contactName || "", notes: clean(b.notes, 1000), createdBy: user.email, createdAt: t, updatedAt: t, updatedBy: user.email,
      ...packJson({ checklist: checklistIn(b.checklist), findings: "", actions: "", recommendations: "", photos: [], files: [], shares: [] }),
    };
    await (await table(VIS)).createEntity(e);
    return visitOut(await (await table(VIS)).getEntity(VPK, id));
  }
  async function updateVisit(user, id, b) {
    const t = await table(VIS); const e0 = await getOrNull(t, VPK, id); const e = e0 && inCo(e0, user) ? e0 : null; if (!e) fail(404, "This visit no longer exists.");
    const co = writeCo(user);
    const d = unpackJson(e);
    const scheduledDate = b.scheduledDate !== undefined ? clean(b.scheduledDate, 10) : e.scheduledDate; if (!isDate(scheduledDate)) fail(400, "Choose the visit date.");
    const status = b.status !== undefined ? String(b.status) : e.status; if (!VISIT_STATUS.includes(status)) fail(400, "Choose a valid visit status.");
    const type = b.type !== undefined ? String(b.type) : e.type; if (!VISIT_TYPES.includes(type)) fail(400, "Choose a valid visit type.");
    const engineers = b.engineers !== undefined ? clean(b.engineers, 200) : e.engineers;
    if (status === "completed" && !engineers) fail(400, "Add the engineer name before completing the visit.");
    const pick = (k, max) => b[k] !== undefined ? clean(b[k], max) : (e[k] || "");
    const next = {
      partitionKey: VPK, rowKey: id, co, amcId: e.amcId, ref: e.ref, customerName: e.customerName, site: pick("site", 300), type, scheduledDate, time: pick("time", 5), engineers, status,
      reportNo: e.reportNo, completedDate: status === "completed" ? (e.completedDate || gulfDay()) : "", arrival: pick("arrival", 5), departure: pick("departure", 5),
      customerRep: pick("customerRep", 150), notes: pick("notes", 1000), createdBy: e.createdBy, createdAt: e.createdAt, updatedAt: now(), updatedBy: user.email,
      ...packJson({
        checklist: b.checklist !== undefined ? checklistIn(b.checklist) : d.checklist || [],
        findings: b.findings !== undefined ? clean(b.findings, 8000) : d.findings || "", actions: b.actions !== undefined ? clean(b.actions, 8000) : d.actions || "",
        recommendations: b.recommendations !== undefined ? clean(b.recommendations, 8000) : d.recommendations || "",
        photos: b.photos !== undefined ? photosIn(b.photos) : d.photos || [], files: b.files !== undefined ? filesIn(b.files) : d.files || [], shares: d.shares || [],
      }),
    };
    await t.updateEntity(next, "Replace", { etag: b.etag || e.etag }).catch(etagFail("visit"));
    return visitOut(await t.getEntity(VPK, id));
  }
  async function deleteVisit(user, id) {
    const t = await table(VIS); const e = await getOrNull(t, VPK, id); if (!e || !inCo(e, user)) return;
    writeCo(user);
    if (!user.isManager && e.createdBy !== user.email && e.status === "completed") fail(403, "Only a manager can delete a completed visit.");
    await t.deleteEntity(VPK, id);
  }

  /* ---------------- files (Blob Storage) ---------------- */
  let container;
  async function blobs() {
    if (!container) {
      const cs = process.env.STORAGE_CONNECTION; if (!cs) fail(500, "Storage is not set up yet. Add the STORAGE_CONNECTION setting to the Static Web App.");
      container = BlobServiceClient.fromConnectionString(cs).getContainerClient("amc-files");
      await container.createIfNotExists();
    }
    return container;
  }
  async function uploadFile(user, b) {
    const name = clean(b.name, 200) || "file"; const type = clean(b.type, 120) || "application/octet-stream";
    const buf = Buffer.from(String(b.data || ""), "base64");
    if (!buf.length) fail(400, "The file is empty.");
    if (buf.length > MAX_FILE) fail(413, `${name} is larger than 10 MB.`);
    const id = crypto.randomUUID();
    await (await blobs()).getBlockBlobClient(id).uploadData(buf, { blobHTTPHeaders: { blobContentType: type }, metadata: { name: encodeURIComponent(name), by: encodeURIComponent(user.email), co: writeCo(user) } });
    return { id, name, type, size: buf.length, by: user.email, at: now() };
  }
  async function getFile(user, id, download) {
    if (!/^[0-9a-f-]{36}$/.test(id)) fail(404, "File not found.");
    const bc = (await blobs()).getBlockBlobClient(id);
    let buf, props;
    try { [buf, props] = await Promise.all([bc.downloadToBuffer(), bc.getProperties()]); } catch (e) { if (e.statusCode === 404) fail(404, "That file is no longer available."); throw e; }
    // Files belong to the company that uploaded them (files from before companies existed are Bifold's).
    if (user.co !== "all" && ((props.metadata || {}).co || "bifold") !== user.co) fail(404, "File not found.");
    const name = decodeURIComponent((props.metadata || {}).name || id);
    const type = props.contentType || "application/octet-stream";
    const inline = !download && /^image\//.test(type);
    return { __binary: buf, headers: { "Content-Type": type, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, max-age=86400" } };
  }

  /* ---------------- email (Microsoft Graph, app permission Mail.Send) ---------------- */
  // Each company sends from its own mailbox: MAIL_SENDER for Bifold, TECHHUB_MAIL_SENDER for Tech Hub.
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
  async function share(user, b) {
    const co = writeCo(user);
    if (!mailReadyFor(co)) fail(501, "Email isn't set up for your company yet. Download the PDF and send it from Outlook.");
    const to = addrs(b.to, 20), cc = addrs(b.cc, 20).filter(a => a !== user.email);
    const bad = to.concat(cc).find(a => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));
    if (!to.length) fail(400, "Add the customer's email address."); if (bad) fail(400, `${bad} isn't a valid email address.`);
    const subject = clean(b.subject, 250) || CO[co].name;
    const html = String(b.html || "").slice(0, 400000);
    const att = b.attachment && b.attachment.data ? { "@odata.type": "#microsoft.graph.fileAttachment", name: clean(b.attachment.name, 200), contentType: clean(b.attachment.type, 100) || "application/pdf", contentBytes: String(b.attachment.data) } : null;
    if (att && att.contentBytes.length > 4.3e6) fail(413, "The attachment is too large to email (over 3 MB). Download it and share a link instead.");
    // Record the share on the AMC or visit first so access is checked before anything is sent.
    let rec;
    if (b.kind === "amc") rec = await loadAmc(user, clean(b.id, 60));
    else if (b.kind === "visit") { rec = await getOrNull(await table(VIS), VPK, clean(b.id, 60)); if (!rec || !inCo(rec, user)) fail(404, "This visit no longer exists."); }
    else fail(400, "Unknown share.");
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderFor(co))}/sendMail`, {
      method: "POST", headers: { Authorization: "Bearer " + await graphToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, toRecipients: to.map(a => ({ emailAddress: { address: a } })),
        ccRecipients: cc.concat([user.email]).map(a => ({ emailAddress: { address: a } })), replyTo: [{ emailAddress: { address: user.email } }], attachments: att ? [att] : [] }, saveToSentItems: true }),
    });
    if (!r.ok) fail(502, `Microsoft 365 didn't send the email (${r.status}). Try again, or download the PDF and send it from Outlook.`);
    const entry = { at: now(), by: user.email, to: to.join(", "), mode: "sent" };
    for (let i = 0; i < 3; i++) {
      const t = await table(b.kind === "amc" ? AMC : VIS);
      const e = await t.getEntity(b.kind === "amc" ? APK : VPK, rec.rowKey);
      const d = unpackJson(e); d.shares = (d.shares || []).concat([entry]).slice(-30);
      const patch = { partitionKey: e.partitionKey, rowKey: e.rowKey, ...packJson(d), updatedAt: now() };
      if (b.kind === "amc") { d.history = (d.history || []).concat([log(user, "Emailed proposal to " + entry.to)]).slice(-80); Object.assign(patch, packJson(d)); if (e.status === "draft") { patch.status = "sent"; patch.sentAt = now(); } }
      try { await t.updateEntity(patch, "Merge", { etag: e.etag }); break; } catch (err) { if (err.statusCode !== 412) throw err; }
    }
    return { sent: true, to };
  }

  /* ---------------- routing: /api/amc/... ---------------- */
  return async function route(method, seg, user, body) {
    const [a, id, sub] = seg;
    if (a === "bootstrap" && method === "GET") {
      // Without the AMC section the commercial records stay hidden; contracts and visits are still shown for planning.
      const canAmc = user.isManager || (user.sections || []).includes("amc");
      const [amcs, contracts, visits] = await Promise.all([canAmc ? listAmcs(user) : [], listContracts(user), listVisits(user)]);
      return { co: user.co, amcs, contracts, visits, features: { ai: AI.ready(), mail: user.co !== "all" && mailReadyFor(user.co) }, can: { amc: canAmc, visits: user.isManager || (user.sections || []).includes("visits") } };
    }
    if (a === "amcs") {
      if (!id && method === "POST") return createAmc(user, body);
      if (id && !sub && method === "GET") return amcFull(await loadAmc(user, id), user);
      if (id && !sub && method === "PUT") return updateAmc(user, id, body);
      if (id && !sub && method === "DELETE") return deleteAmc(user, id);
      if (id && sub === "award" && method === "POST") return award(user, id, body);
      if (id && sub === "renew" && method === "POST") return renew(user, id);
    }
    if (a === "visits") {
      if (!id && method === "POST") return createVisit(user, body);
      if (id && method === "PUT") return updateVisit(user, id, body);
      if (id && method === "DELETE") return deleteVisit(user, id);
    }
    if (a === "files") {
      if (!id && method === "POST") return uploadFile(user, body);
      if (id && method === "GET") return getFile(user, id, sub === "download");
    }
    if (a === "ai" && method === "POST") { writeCo(user); return AI.run(Object.assign({}, body, { company: user.co }), fail, clean); }
    if (a === "share" && method === "POST") return share(user, body);
    fail(404, "Unknown request.");
  };
};
