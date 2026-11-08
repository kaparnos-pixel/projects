// Daily reminders for the Bifold Tools PDC & Guarantees Log.
// Finds open entries (PDC cheques by clearance date; security deposits and advance payment guarantees by
// expiry / return date) due within 7 days (Dubai time) that have no reminder yet, emails the person
// who logged them with PDC_REMINDER_CC in copy (one email per person), then stamps reminderSentAt.
//
// Settings (GitHub Actions secrets / env):
//   STORAGE_CONNECTION   same storage account connection string as the Static Web App
//   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET   Entra app with Mail.Send (application) permission
//   MAIL_SENDER          mailbox the reminders are sent from, e.g. tools@bifoldtech.com
//   PDC_REMINDER_CC      comma-separated copy list (default ranjan@bifoldtech.com)
//   TOOLS_URL            link to the log (default the Bifold Tools site)
//   DRY_RUN=1            print what would be sent, change nothing

const { TableClient } = require("@azure/data-tables");

const env = process.env;
const DRY = env.DRY_RUN === "1";
const CC = String(env.PDC_REMINDER_CC || "ranjan@bifoldtech.com").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const URL_ = env.TOOLS_URL || "https://yellow-dune-0607b0710.4.azurestaticapps.net/pdc/";
const DAYS = 7;
const KIND = { pdc: "PDC cheque", deposit: "Security deposit", apg: "Advance payment guarantee" };

const dubaiToday = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
const addDays = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const fdate = s => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const aed = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const emailOk = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

function missing() {
  const need = ["STORAGE_CONNECTION"].concat(DRY ? [] : ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "MAIL_SENDER"]);
  return need.filter(k => !env[k]);
}

async function graphToken() {
  const r = await fetch(`https://login.microsoftonline.com/${env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GRAPH_CLIENT_ID, client_secret: env.GRAPH_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Microsoft sign-in for the reminder app failed: " + (j.error_description || j.error || r.status));
  return j.access_token;
}

async function sendMail(token, to, cc, subject, html) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.MAIL_SENDER)}/sendMail`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject, body: { contentType: "HTML", content: html },
        toRecipients: to.map(a => ({ emailAddress: { address: a } })),
        ccRecipients: cc.map(a => ({ emailAddress: { address: a } })),
      },
      saveToSentItems: true,
    }),
  });
  if (!r.ok) throw new Error(`Sending to ${to.join(", ")} failed (${r.status}): ${await r.text()}`);
}

function buildEmail(list, today) {
  const latest = list.reduce((m, c) => (c.clearanceDate > m ? c.clearanceDate : m), "");
  const kinds = new Set(list.map(c => c.kind || "pdc"));
  const what = kinds.size === 1 && kinds.has("pdc") ? `${list.length} cheque${list.length === 1 ? "" : "s"} clearing`
    : !kinds.has("pdc") ? `${list.length} deposit${list.length === 1 ? "" : "s"} / guarantee${list.length === 1 ? "" : "s"} expiring`
    : `${list.length} item${list.length === 1 ? "" : "s"} due`;
  const subject = `PDC & guarantees reminder: ${what} by ${fdate(latest)}`;
  const td = 'style="padding:6px 10px;border:1px solid #d5dce3"';
  const rows = list.map(c => `<tr>
<td ${td}>${fdate(c.clearanceDate)}${c.clearanceDate < today ? " <b>OVERDUE</b>" : ""}</td>
<td ${td}>${esc(KIND[c.kind || "pdc"])}${c.kind && c.kind !== "pdc" && c.form ? " (" + esc(c.form) + ")" : ""}</td>
<td ${td}>${esc(c.company)}</td><td ${td}>${esc(c.payee)}</td><td ${td}>${esc(c.chequeNo)}</td>
<td ${td}>${esc(c.bank)}</td><td ${td} align="right">${aed(c.amount)}</td><td ${td}>${esc(c.reference)}</td></tr>`).join("");
  const totals = ["Bifold Technologies", "Tech Hub IT"].map(co => {
    const s = list.filter(c => c.company === co).reduce((a, c) => a + Number(c.amount || 0), 0);
    return s ? `<tr><td ${td} colspan="6"><b>Total ${esc(co)}</b></td><td ${td} align="right"><b>${aed(s)}</b></td><td ${td}></td></tr>` : "";
  }).join("");
  const th = 'style="padding:6px 10px;border:1px solid #d5dce3;background:#1E5A8C;color:#ffffff;text-align:left"';
  const lines = [];
  if (kinds.has("pdc")) lines.push("PDC cheques due to clear: please make sure the account is funded.");
  if (kinds.has("deposit")) lines.push("Security deposits reaching their expiry / return date: follow up with the customer for return, or extend.");
  if (kinds.has("apg")) lines.push("Advance payment guarantees reaching expiry: arrange release from the customer, or extend with the bank.");
  const html = `<p>The following items are due within the next ${DAYS} days.</p><ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul>
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">
<thead><tr><th ${th}>Due date</th><th ${th}>Type</th><th ${th}>Company</th><th ${th}>Payee / given to</th><th ${th}>Number</th><th ${th}>Bank</th><th ${th}>Amount (AED)</th><th ${th}>PO / reference</th></tr></thead>
<tbody>${rows}${totals}</tbody></table>
<p>Update the status in the PDC &amp; Guarantees Log: <a href="${URL_}">${URL_}</a></p>
<p style="color:#5b6a78;font-size:12px">Automatic reminder from Bifold Tools.</p>`;
  return { subject, html };
}

async function main() {
  const miss = missing();
  if (miss.length) {
    console.log(`::warning::PDC reminders are not set up yet. Missing settings: ${miss.join(", ")}. No emails sent.`);
    return;
  }
  const t = TableClient.fromConnectionString(env.STORAGE_CONNECTION, "pdc", { allowInsecureConnection: /127\.0\.0\.1|localhost/.test(env.STORAGE_CONNECTION) });
  const today = dubaiToday(), cutoff = addDays(today, DAYS);
  const due = [];
  try {
    for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq 'cheque' and status eq 'pending' and clearanceDate le '${cutoff}'` } })) {
      if (!e.reminderSentAt) due.push(e);
    }
  } catch (e) { if (e.statusCode === 404) { console.log("No cheques logged yet."); return; } throw e; }
  console.log(`${due.length} item(s) due a reminder (due on or before ${cutoff}).`);
  if (!due.length) return;

  const groups = {};
  for (const c of due) (groups[String(c.createdBy || "").toLowerCase()] ||= []).push(c);
  const token = DRY ? null : await graphToken();
  let sent = 0, failed = 0;
  for (const [who, list] of Object.entries(groups)) {
    list.sort((a, b) => a.clearanceDate.localeCompare(b.clearanceDate));
    const to = emailOk(who) ? [who] : CC.slice(0, 1);
    const cc = CC.filter(a => !to.includes(a));
    const { subject, html } = buildEmail(list, today);
    if (DRY) { console.log(`[dry run] to ${to.join(", ")} cc ${cc.join(", ")}: ${subject}`); continue; }
    try {
      await sendMail(token, to, cc, subject, html);
      sent++;
      const stamp = new Date().toISOString();
      for (const c of list) {
        await t.updateEntity({ partitionKey: c.partitionKey, rowKey: c.rowKey, reminderSentAt: stamp }, "Merge", { etag: c.etag })
          .catch(err => console.log(`::warning::Cheque ${c.chequeNo} changed while sending; it will be checked again tomorrow (${err.statusCode}).`));
      }
      console.log(`Sent to ${to.join(", ")} (cc ${cc.join(", ") || "none"}): ${subject}`);
    } catch (err) { failed++; console.log(`::error::${err.message}`); }
  }
  console.log(`Done: ${sent} email(s) sent, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.log(`::error::${e.message}`); process.exit(1); });
