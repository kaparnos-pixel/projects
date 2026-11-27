// Daily reminders for Vendor Partners: partnership renewals, staff certification expiries and rebate / MDF claim deadlines.
// Each item gets one email at 90, then 30, then 7 days before its date (the smallest milestone reached that hasn't been sent).
// The milestone is stamped in the record's alertsSent with the date it was for, so changing a date re-arms the reminders.
// Emails go to the person who added the record (and, for a certification, the staff member's own work email), with the
// company's copy list in CC: Bifold from MAIL_SENDER with AMC_REMINDER_CC, Tech Hub from TECHHUB_MAIL_SENDER with TECHHUB_REMINDER_CC.
//
// Settings (GitHub Actions secrets / variables), shared with the AMC and PDC reminders:
//   STORAGE_CONNECTION, GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, MAIL_SENDER, TECHHUB_MAIL_SENDER
//   AMC_REMINDER_CC / TECHHUB_REMINDER_CC  copy lists;  TOOLS_URL / TECHHUB_TOOLS_URL  site address;  DRY_RUN=1  list only

const { TableClient } = require("@azure/data-tables");

const env = process.env;
const DRY = env.DRY_RUN === "1";
const MILESTONES = [90, 30, 7];
const ccList = v => String(v || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const base = u => String(u || "").replace(/\/(amc|pdc|partners)\/?.*$/, "").replace(/\/+$/, "");
const COS = {
  bifold: { name: "Bifold Technologies", sender: env.MAIL_SENDER, cc: ccList(env.AMC_REMINDER_CC || "ranjan@bifoldtech.com"), domains: ["bifoldtech.com"], url: (base(env.TOOLS_URL) || "https://yellow-dune-0607b0710.4.azurestaticapps.net") + "/partners/" },
  techhub: { name: "Tech Hub IT", sender: env.TECHHUB_MAIL_SENDER, cc: ccList(env.TECHHUB_REMINDER_CC || "ranjan@techhubrak.ae"), domains: ["techhubrak.ae"], url: (base(env.TECHHUB_TOOLS_URL || env.TOOLS_URL) || "https://yellow-dune-0607b0710.4.azurestaticapps.net") + "/partners/" },
};
const rowCo = e => e.co || "bifold";
const dubaiToday = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
const fdate = s => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const emailOk = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// The milestone due for an item dated `date`, or null. key identifies the item inside its record.
function due(sent, key, date, today) {
  if (!date) return null;
  const left = daysBetween(today, date);
  if (left < 0) return null;
  const reached = MILESTONES.filter(m => left <= m && !sent.includes(`${key}:${date}:${m}`));
  return reached.length ? Math.min(...reached) : null;
}

function missing() {
  const need = ["STORAGE_CONNECTION"].concat(DRY ? [] : ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET"]);
  return need.filter(k => !env[k]);
}
async function graphToken() {
  const r = await fetch(`https://login.microsoftonline.com/${env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GRAPH_CLIENT_ID, client_secret: env.GRAPH_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Microsoft sign-in for the reminder app failed: " + (j.error_description || j.error || r.status));
  return j.access_token;
}
async function sendMail(token, sender, to, cc, subject, html) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, toRecipients: to.map(a => ({ emailAddress: { address: a } })), ccRecipients: cc.map(a => ({ emailAddress: { address: a } })) }, saveToSentItems: true }),
  });
  if (!r.ok) throw new Error(`Sending to ${to.join(", ")} failed (${r.status}): ${await r.text()}`);
}

function buildEmail(items, today, C) {
  const n = items.length;
  const subject = `Vendor partner reminder: ${n} item${n === 1 ? "" : "s"} due${items.some(x => daysBetween(today, x.date) <= 7) ? " this week" : ""}`;
  const td = 'style="padding:6px 10px;border:1px solid #d5dce3;vertical-align:top"';
  const th = 'style="padding:6px 10px;border:1px solid #d5dce3;background:#1E5A8C;color:#ffffff;text-align:left"';
  const rows = items.sort((a, b) => a.date.localeCompare(b.date)).map(x => { const left = daysBetween(today, x.date);
    return `<tr><td ${td}>${esc(x.kind)}</td><td ${td}><b>${esc(x.title)}</b>${x.detail ? `<br><span style="color:#5b6a78">${esc(x.detail)}</span>` : ""}</td><td ${td}>${fdate(x.date)}</td><td ${td}>${left === 0 ? "<b>Today</b>" : left <= 7 ? `<b>${left} day${left === 1 ? "" : "s"}</b>` : left + " days"}</td><td ${td}>${esc(x.action)}</td></tr>`; }).join("");
  const html = `<p>These vendor partner dates for ${esc(C.name)} are coming up.</p>
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px"><thead><tr><th ${th}>What</th><th ${th}>Item</th><th ${th}>Date</th><th ${th}>Days left</th><th ${th}>To do</th></tr></thead><tbody>${rows}</tbody></table>
<p>Open Vendor Partners: <a href="${C.url}">${C.url}</a></p><p style="color:#5b6a78;font-size:12px">Automatic reminder from ${esc(C.name)} Tools, sent 90, 30 and 7 days before each date.</p>`;
  return { subject, html };
}

async function list(t, pk) {
  const out = [];
  try { for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${pk}'` } })) out.push(e); }
  catch (e) { if (e.statusCode !== 404) throw e; }
  return out;
}

async function main() {
  const miss = missing();
  if (miss.length) { console.log(`::warning::Vendor partner reminders are not set up yet. Missing settings: ${miss.join(", ")}. No emails sent.`); return; }
  const opt = { allowInsecureConnection: /127\.0\.0\.1|localhost|UseDevelopmentStorage/.test(env.STORAGE_CONNECTION) };
  const tp = TableClient.fromConnectionString(env.STORAGE_CONNECTION, "partners", opt);
  const tc = TableClient.fromConnectionString(env.STORAGE_CONNECTION, "partnercerts", opt);
  const today = dubaiToday();
  const [ps, cs] = await Promise.all([list(tp, "partner"), list(tc, "cert")]);
  const pmap = new Map(ps.map(p => [p.rowKey, p]));
  // One entry per record to stamp, with the reminder lines it produced.
  const hits = [];
  for (const p of ps) {
    if (p.status === "dropped") continue;
    const sent = json(p.alertsSent, []).map(String), keys = [], lines = [];
    const prog = [p.program, p.tier].filter(Boolean).join(" · ");
    if (["active", "renewal"].includes(p.status)) { const m = due(sent, "ren", p.renewalDate, today);
      if (m !== null) { keys.push(`ren:${p.renewalDate}:${m}`); lines.push({ kind: "Partnership renewal", title: `${p.vendor}${p.program ? " " + p.program : ""}`, detail: [p.tier, p.partnerNo && "ID " + p.partnerNo].filter(Boolean).join(" · "), date: p.renewalDate, action: p.autoRenew ? "Check the auto-renewal and requirements" : "Renew the partnership" }); } }
    for (const b of json(p.benefits, [])) { if (b.status !== "open") continue; const m = due(sent, "ben:" + b.id, b.deadline, today);
      if (m !== null) { keys.push(`ben:${b.id}:${b.deadline}:${m}`); lines.push({ kind: b.kind === "mdf" ? "MDF claim" : b.kind === "rebate" ? "Rebate claim" : "Claim", title: `${p.vendor}: ${b.title}`, detail: [b.amount ? `${b.currency} ${Number(b.amount).toLocaleString("en-US")}` : "", prog].filter(Boolean).join(" · "), date: b.deadline, action: "Submit the claim before the deadline" }); } }
    if (lines.length) hits.push({ t: tp, e: p, keys, lines, co: rowCo(p), to: [String(p.createdBy || "").toLowerCase()] });
  }
  for (const c of cs) {
    const p = pmap.get(c.partnerRef);
    if (p && p.status === "dropped") continue;
    const sent = json(c.alertsSent, []).map(String), m = due(sent, "exp", c.expiry, today);
    if (m === null) continue;
    const co = rowCo(c), own = String(c.email || "").toLowerCase();
    hits.push({ t: tc, e: c, keys: [`exp:${c.expiry}:${m}`], co, to: [String(c.createdBy || "").toLowerCase()].concat(COS[co] && COS[co].domains.some(d => own.endsWith("@" + d)) ? [own] : []),
      lines: [{ kind: "Certification expiry", title: `${c.person}: ${c.name}`, detail: [p ? p.vendor + (p.program ? " " + p.program : "") : c.vendor, c.code].filter(Boolean).join(" · "), date: c.expiry, action: "Renew or recertify" }] });
  }
  console.log(`${hits.length} record(s) due a reminder.`);
  if (!hits.length) return;
  // Group by company and recipient set, so each person gets one email a day.
  const groups = {};
  for (const h of hits) { const C = COS[h.co] || COS.bifold; let to = [...new Set(h.to.filter(emailOk))]; if (!to.length) to = C.cc.slice(0, 1); (groups[h.co + "|" + to.sort().join(",")] ||= []).push(h); }
  const token = DRY ? null : await graphToken();
  let sentN = 0, failed = 0;
  for (const [key, list_] of Object.entries(groups)) {
    const [co, toS] = key.split("|"); const C = COS[co] || COS.bifold; const to = toS.split(",").filter(Boolean);
    if (!to.length) { console.log(`::warning::No recipient for ${list_.length} ${co} reminder(s).`); continue; }
    if (!C.sender && !DRY) { console.log(`::warning::No mailbox set for ${co} (${co === "techhub" ? "TECHHUB_MAIL_SENDER" : "MAIL_SENDER"}); ${list_.length} reminder(s) not sent.`); continue; }
    const cc = C.cc.filter(a => !to.includes(a));
    const { subject, html } = buildEmail(list_.flatMap(h => h.lines), today, C);
    if (DRY) { console.log(`[dry run] ${co}: to ${to.join(", ")} cc ${cc.join(", ")}: ${subject} (${list_.flatMap(h => h.keys).join(", ")})`); continue; }
    try {
      await sendMail(token, C.sender, to, cc, subject, html); sentN++;
      for (const h of list_) {
        const stamped = json(h.e.alertsSent, []).map(String).concat(h.keys).slice(-200);
        await h.t.updateEntity({ partitionKey: h.e.partitionKey, rowKey: h.e.rowKey, alertsSent: JSON.stringify(stamped), lastAlertAt: new Date().toISOString() }, "Merge", { etag: h.e.etag })
          .catch(err => console.log(`::warning::A record changed while sending; it will be checked again tomorrow (${err.statusCode}).`));
      }
      console.log(`Sent to ${to.join(", ")} (cc ${cc.join(", ") || "none"}): ${subject}`);
    } catch (err) { failed++; console.log(`::error::${err.message}`); }
  }
  console.log(`Done: ${sentN} email(s) sent, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

if (require.main === module) main().catch(e => { console.log(`::error::${e.message}`); process.exit(1); });
module.exports = { due };
