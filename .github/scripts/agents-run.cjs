// Daily run of the Phase 1 agents (bifold-tools-api/src/agent-engine.js) for both companies, then one digest email
// per person listing the new items waiting for them in the Agent Inbox. Nothing is ever sent to a customer here.
//
// Settings (GitHub Actions secrets / variables, shared with the AMC and PDC reminders):
//   STORAGE_CONNECTION                                       required
//   ANTHROPIC_API_KEY, ANTHROPIC_MODEL                       optional: Claude writes the email drafts (else templates)
//   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET    digest emails, from MAIL_SENDER / TECHHUB_MAIL_SENDER
//   AGENTS_URL / TECHHUB_AGENTS_URL                          link to the inbox (default: the tools site + /agents/)
//   AGENTS_ONLY=a1,a3   run only these agents     DRY_RUN=1   print what would happen, change nothing     NO_DIGEST=1

const path = require("path");
const { TableClient } = require(require.resolve("@azure/data-tables", { paths: [path.join(__dirname, "../../bifold-tools-api")] }));
const makeEngine = require("../../bifold-tools-api/src/agent-engine.js");

const env = process.env;
const DRY = env.DRY_RUN === "1";
const ONLY = String(env.AGENTS_ONLY || "").split(",").map(s => s.trim().toLowerCase()).filter(s => /^a[1-4]$/.test(s));
const SITE = "https://yellow-dune-0607b0710.4.azurestaticapps.net";
const COS = {
  bifold: { color: "#1E5A8C", name: "Bifold Tools", sender: env.MAIL_SENDER, url: env.AGENTS_URL || SITE + "/agents/" },
  techhub: { color: "#003C50", name: "Tech Hub Tools", sender: env.TECHHUB_MAIL_SENDER, url: env.TECHHUB_AGENTS_URL || env.AGENTS_URL || SITE + "/agents/" },
};
const MANAGERS = { bifold: (env.BIFOLD_MANAGERS || "ranjan@bifoldtech.com"), techhub: (env.TECHHUB_MANAGERS || "ranjan@techhubrak.ae") };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const clients = {};
async function tableFor(name) {
  if (!clients[name]) {
    const c = TableClient.fromConnectionString(env.STORAGE_CONNECTION, name, { allowInsecureConnection: /127\.0\.0\.1|localhost|UseDevelopmentStorage/.test(env.STORAGE_CONNECTION) });
    if (!DRY) { try { await c.createTable(); } catch (e) { if (e.statusCode !== 409) throw e; } }
    clients[name] = c;
  }
  return clients[name];
}

async function graphToken() {
  const r = await fetch(`https://login.microsoftonline.com/${env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GRAPH_CLIENT_ID, client_secret: env.GRAPH_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }) });
  const j = await r.json(); if (!r.ok) throw new Error("Microsoft sign-in for the digest failed: " + (j.error_description || j.error || r.status));
  return j.access_token;
}
async function sendMail(token, sender, to, subject, html) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: false }) });
  if (!r.ok) throw new Error(`Digest to ${to} failed (${r.status}): ${await r.text()}`);
}
function digest(items, C) {
  const rank = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const td = 'style="padding:7px 10px;border-bottom:1px solid #e3e8ee;vertical-align:top"';
  const dot = s => `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${s === "high" ? "#D81F2A" : s === "medium" ? "#D68910" : C.color}"></span>`;
  const rows = items.map(i => `<tr><td ${td}>${dot(i.severity)}</td><td ${td}><b>${esc(i.title)}</b><br><span style="color:#5b6a78">${esc(i.summary)}</span></td></tr>`).join("");
  const drafts = items.filter(i => i.draft).length;
  return { subject: `Agent Inbox: ${items.length} new item${items.length === 1 ? "" : "s"} for you${items.some(i => i.severity === "high") ? " (high priority)" : ""}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:13px;color:#15222e"><p>Good morning. The agents found ${items.length} thing${items.length === 1 ? "" : "s"} for you today${drafts ? `, with ${drafts} email draft${drafts === 1 ? "" : "s"} ready to review` : ""}. Nothing has been sent to any customer.</p>
<table style="border-collapse:collapse;width:100%;max-width:720px">${rows}</table>
<p><a href="${C.url}" style="display:inline-block;background:${C.color};color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;font-weight:bold">Open the Agent Inbox</a></p>
<p style="color:#5b6a78;font-size:12px">Daily digest from ${esc(C.name)}. Managers can switch agents or this digest off in the Agent Inbox settings.</p></div>` };
}

async function main() {
  if (!env.STORAGE_CONNECTION) { console.log("::warning::STORAGE_CONNECTION is not set; the agents can't run."); return; }
  if (!env.ANTHROPIC_API_KEY) console.log("::notice::ANTHROPIC_API_KEY is not set, so drafts use the standard templates.");
  const engine = makeEngine({ tableFor, log: m => console.log(m) });
  const results = [];
  for (const co of ["bifold", "techhub"]) {
    const r = await engine.runCompany(co, { dry: DRY, only: ONLY });
    console.log(`${co}: ${r.created.length} new, ${r.resolved.length} closed automatically, ${r.drafted} drafted by Claude.`);
    results.push(r);
  }
  if (DRY || env.NO_DIGEST === "1") return;
  const mailOk = ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET"].every(k => env[k]);
  if (!mailOk) { console.log("::notice::Graph settings missing; no digest emails sent."); return; }
  let token = null, failed = 0;
  for (const r of results) {
    const C = COS[r.co];
    if (!r.settings.digest || !r.created.length) continue;
    if (!C.sender) { console.log(`::warning::No mailbox for ${r.co}; digest not sent.`); continue; }
    const byOwner = {};
    // Items with no owner (e.g. the cash outlook before a collections contact is set) go to the managers.
    for (const e of r.created) {
      const item = { title: e.title, summary: e.summary, severity: e.severity, draft: !!e.draft };
      const to = e.owner ? [e.owner] : MANAGERS[r.co].split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      to.forEach(o => (byOwner[o] ||= []).push(item));
    }
    token = token || await graphToken();
    for (const [owner, items] of Object.entries(byOwner)) {
      const { subject, html } = digest(items, C);
      try { await sendMail(token, C.sender, owner, subject, html); console.log(`Digest sent to ${owner} (${items.length}).`); }
      catch (e) { failed++; console.log(`::error::${e.message}`); }
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.log(`::error::${e.stack || e.message}`); process.exit(1); });
