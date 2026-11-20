// Agent Inbox API (/api/agents): the drafts and alerts the daily agents (src/agent-engine.js, run by
// .github/scripts/agents-run.cjs) leave for people to review.
//
// Who sees what: each item has an owner (the deal owner, AMC owner, quotation author, or the finance contact set in
// the agent settings). People see their own items; managers see every item in their company and can reassign them.
// Nothing reaches a customer until a person presses Send: the email goes from the company mailbox (MAIL_SENDER /
// TECHHUB_MAIL_SENDER), with the sender in copy and as reply-to, like proposals sent from the AMC Tracker.
//
// Storage (Table Storage): agentinbox  PK <co>  RowKey <item key>
//                          agentsettings PK "settings" RowKey <co>  data (JSON)
//                          agentruns  PK "run-<co>" (newest first) and PK "usage" RowKey "<co>-<YYYY-MM>"

const ENGINE = require("./agent-engine");
const { AGENTS, settingsIn, TABLES, tidy } = ENGINE;
const STATUSES = ["open", "snoozed", "sent", "done", "dismissed", "resolved"];

module.exports = function makeAgents(H) {
  const { table, getOrNull, fail, clean, CO, writeCo, mailReadyFor, sameCoEmail, emailOk, dealNote } = H;
  const coOf = user => user.co === "all" ? user.homeCo : user.co;
  const today = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  const now = () => new Date().toISOString();
  const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
  const visible = (e, user) => user.isManager || e.owner === user.email;

  function itemOut(e) {
    const snoozedOver = e.status === "snoozed" && e.snoozeUntil && e.snoozeUntil <= today();
    return {
      id: e.rowKey, co: e.partitionKey, agent: e.agent, agentName: AGENTS[e.agent] || e.agent, kind: e.kind, refId: e.refId || "",
      title: e.title || "", summary: e.summary || "", facts: json(e.facts, []), severity: e.severity || "low", owner: e.owner || "", href: e.href || "", due: e.due || "",
      status: snoozedOver ? "open" : e.status || "open", snoozeUntil: snoozedOver ? "" : e.snoozeUntil || "", draft: json(e.draft, null),
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

  async function list(user) {
    const co = coOf(user);
    const cutoff = new Date(Date.now() - 45 * 864e5).toISOString();
    const items = (await rows(co)).filter(e => visible(e, user)).map(itemOut)
      .filter(i => ["open", "snoozed"].includes(i.status) || String(i.decidedAt || i.updatedAt) >= cutoff);
    const runsT = await table(TABLES.RUNS);
    const runs = [];
    for await (const e of runsT.listEntities({ queryOptions: { filter: `PartitionKey eq 'run-${co}'` } })) { runs.push({ at: e.at, created: e.created, resolved: e.resolved, drafted: e.drafted, counts: json(e.counts, {}) }); if (runs.length >= 7) break; }
    const usage = await getOrNull(runsT, "usage", `${co}-${today().slice(0, 7)}`);
    return { items, agents: AGENTS, settings: await settings(co), runs, draftsThisMonth: usage ? Number(usage.drafts) || 0 : 0,
      isManager: user.isManager, me: user.email, mailReady: mailReadyFor(co), claudeReady: !!process.env.ANTHROPIC_API_KEY, company: CO[co].name };
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
    if (!mailReadyFor(co)) fail(501, "Email isn't set up for your company yet. Use Copy or Open in Outlook and send it yourself, then mark the item done.");
    const e = await load(user, id);
    if (!e.draft) fail(400, "This item has no email to send.");
    if (!["open", "snoozed"].includes(itemOut(e).status)) fail(409, "This item is already closed.");
    const to = addrs(b.to), cc = addrs(b.cc).filter(a => a !== user.email);
    const subject = tidy(clean(b.subject, 250)), body = tidy(String(b.body || "").slice(0, 8000));
    const bad = to.concat(cc).find(a => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));
    if (!to.length) fail(400, "Add the customer's email address."); if (bad) fail(400, `${bad} isn't a valid email address.`);
    if (!subject || body.trim().length < 20) fail(400, "Write a subject and a message before sending.");
    if (user.aud) { user.aud.name = e.title; user.aud.changes = [`Emailed ${to.join(", ")}: ${subject}`]; }
    const sender = co === "techhub" ? process.env.TECHHUB_MAIL_SENDER : process.env.MAIL_SENDER;
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST", headers: { Authorization: "Bearer " + await graphToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: toHtml(body) }, toRecipients: to.map(a => ({ emailAddress: { address: a } })),
        ccRecipients: cc.concat([user.email]).map(a => ({ emailAddress: { address: a } })), replyTo: [{ emailAddress: { address: user.email } }] }, saveToSentItems: true }),
    });
    if (!r.ok) fail(502, `Microsoft 365 didn't send the email (${r.status}). Try again, or copy the text and send it from Outlook.`);
    const d = { ...json(e.draft, {}), to: to.join(", "), cc: cc.join(", "), subject, body };
    await (await table(TABLES.INBOX)).updateEntity({ partitionKey: e.partitionKey, rowKey: e.rowKey, status: "sent", draft: JSON.stringify(d), sentTo: to.join(", "),
      decidedBy: user.email, decidedAt: now(), note: "", updatedAt: now() }, "Merge");
    // Keep the deal's activity complete.
    if (e.agent === "a2" && e.refId && dealNote) await dealNote(user, e.refId, { text: `Follow-up emailed to ${to.join(", ")} from the Agent Inbox: ${subject}` }).catch(() => {});
    return itemOut(await (await table(TABLES.INBOX)).getEntity(e.partitionKey, e.rowKey));
  }

  async function saveSettings(user, b) {
    if (!user.isManager) fail(403, "Only managers can change the agent settings.");
    const co = writeCo(user);
    const s = settingsIn(b);
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
    if (a === "items" && id) {
      if (!sub && method === "PUT") return saveDraft(user, id, body);
      if (sub === "send" && method === "POST") return send(user, id, body);
      if (sub === "status" && method === "POST") return setStatus(user, id, body);
      if (sub === "assign" && method === "POST") return assign(user, id, body);
    }
    fail(404, "Unknown request.");
  }
  return { route, alerts, STATUSES };
};
