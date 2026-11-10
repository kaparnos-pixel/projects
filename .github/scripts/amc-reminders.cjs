// Daily expiry alerts for the Bifold Tools AMC Tracker.
// For every active awarded contract, sends one alert at each milestone before its end date: the contract's own
// alert window (alertDays, default 60), then 30, 7 and 0 days. Alerts go to the contract's notifyEmail with
// AMC_REMINDER_CC in copy (one email per person), and the milestone is stamped in alertsSent so it is not repeated.
// Contracts already renewed are skipped. Changing the contract dates in the tracker re-arms the alerts.
//
// Settings (GitHub Actions secrets / env), shared with the PDC reminders:
//   STORAGE_CONNECTION, GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, MAIL_SENDER
//   AMC_REMINDER_CC   comma-separated copy list (default ranjan@bifoldtech.com)
//   TOOLS_URL         link to the tracker
//   DRY_RUN=1         print what would be sent, change nothing

const { TableClient } = require("@azure/data-tables");

const env = process.env;
const DRY = env.DRY_RUN === "1";
const CC = String(env.AMC_REMINDER_CC || "ranjan@bifoldtech.com").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const URL_ = env.TOOLS_URL || "https://yellow-dune-0607b0710.4.azurestaticapps.net/amc/#amcs";

const dubaiToday = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
const fdate = s => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const emailOk = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

function missing() {
  const need = ["STORAGE_CONNECTION"].concat(DRY ? [] : ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "MAIL_SENDER"]);
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
async function sendMail(token, to, cc, subject, html) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.MAIL_SENDER)}/sendMail`, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, toRecipients: to.map(a => ({ emailAddress: { address: a } })), ccRecipients: cc.map(a => ({ emailAddress: { address: a } })) }, saveToSentItems: true }),
  });
  if (!r.ok) throw new Error(`Sending to ${to.join(", ")} failed (${r.status}): ${await r.text()}`);
}

// The smallest milestone the contract has reached that hasn't been alerted yet, or null.
function dueMilestone(c, today) {
  const left = daysBetween(today, c.end);
  if (left < -30) return null;
  const windowDays = Number(c.alertDays) || 60;
  const sent = json(c.alertsSent, []).map(String);
  const reached = [windowDays, 30, 7, 0].filter(m => m <= windowDays && left <= m && !sent.includes(String(m)));
  return reached.length ? Math.min(...reached) : null;
}

function buildEmail(list, today) {
  const expired = list.every(x => daysBetween(today, x.c.end) < 0);
  const subject = `AMC renewal alert: ${list.length} contract${list.length === 1 ? "" : "s"} ${expired ? "expired" : "expiring"}`;
  const td = 'style="padding:6px 10px;border:1px solid #d5dce3"';
  const th = 'style="padding:6px 10px;border:1px solid #d5dce3;background:#1E5A8C;color:#ffffff;text-align:left"';
  const rows = list.map(({ c }) => { const left = daysBetween(today, c.end);
    return `<tr><td ${td}>${esc(c.customerName)}</td><td ${td}>${esc(c.ref)}</td><td ${td}>${fdate(c.end)}</td><td ${td}>${left < 0 ? `<b>Expired ${-left} day${left === -1 ? "" : "s"} ago</b>` : left === 0 ? "<b>Expires today</b>" : left + " days"}</td><td ${td}>${esc(c.lpo || "-")}</td><td ${td}>${c.renewalAmcId ? "Renewal draft started" : "Not started"}</td></tr>`; }).join("");
  const html = `<p>The following annual maintenance contracts are reaching the end of their term. Please start the renewal.</p>
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px"><thead><tr><th ${th}>Customer</th><th ${th}>Contract ref</th><th ${th}>End date</th><th ${th}>Days left</th><th ${th}>LPO</th><th ${th}>Renewal</th></tr></thead><tbody>${rows}</tbody></table>
<p>Open the AMC Tracker: <a href="${URL_}">${URL_}</a></p><p style="color:#5b6a78;font-size:12px">Automatic alert from Bifold Tools.</p>`;
  return { subject, html };
}

async function main() {
  const miss = missing();
  if (miss.length) { console.log(`::warning::AMC alerts are not set up yet. Missing settings: ${miss.join(", ")}. No emails sent.`); return; }
  const t = TableClient.fromConnectionString(env.STORAGE_CONNECTION, "amccontracts", { allowInsecureConnection: /127\.0\.0\.1|localhost|UseDevelopmentStorage/.test(env.STORAGE_CONNECTION) });
  const today = dubaiToday(); const due = [];
  try {
    for await (const c of t.listEntities({ queryOptions: { filter: `PartitionKey eq 'contract' and status eq 'active'` } })) {
      const m = dueMilestone(c, today); if (m !== null) due.push({ c, m });
    }
  } catch (e) { if (e.statusCode === 404) { console.log("No contracts awarded yet."); return; } throw e; }
  console.log(`${due.length} contract(s) due an alert.`);
  if (!due.length) return;
  const groups = {};
  for (const x of due) (groups[String(x.c.notifyEmail || "").toLowerCase()] ||= []).push(x);
  const token = DRY ? null : await graphToken();
  let sent = 0, failed = 0;
  for (const [who, list] of Object.entries(groups)) {
    list.sort((a, b) => a.c.end.localeCompare(b.c.end));
    const to = emailOk(who) ? [who] : CC.slice(0, 1);
    const cc = CC.filter(a => !to.includes(a));
    const { subject, html } = buildEmail(list, today);
    if (DRY) { console.log(`[dry run] to ${to.join(", ")} cc ${cc.join(", ")}: ${subject} (${list.map(x => x.c.ref + "@" + x.m).join(", ")})`); continue; }
    try {
      await sendMail(token, to, cc, subject, html); sent++;
      for (const { c, m } of list) {
        const sentList = json(c.alertsSent, []).map(String).concat([String(m)]);
        await t.updateEntity({ partitionKey: c.partitionKey, rowKey: c.rowKey, alertsSent: JSON.stringify(sentList), lastAlertAt: new Date().toISOString() }, "Merge", { etag: c.etag })
          .catch(err => console.log(`::warning::Contract ${c.ref} changed while sending; it will be checked again tomorrow (${err.statusCode}).`));
      }
      console.log(`Sent to ${to.join(", ")} (cc ${cc.join(", ") || "none"}): ${subject}`);
    } catch (err) { failed++; console.log(`::error::${err.message}`); }
  }
  console.log(`Done: ${sent} email(s) sent, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

if (require.main === module) main().catch(e => { console.log(`::error::${e.message}`); process.exit(1); });
module.exports = { dueMilestone };
