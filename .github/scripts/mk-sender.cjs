// Scheduled sender for Email Campaigns (Bifold Tools / Tech Hub Tools).
// Runs every 10 minutes from .github/workflows/mk-sender.yml: starts campaigns whose scheduled time has come,
// then sends to their recipients at the rate the Azure Communication Services resource allows, for up to
// about 8 minutes per run. Big campaigns simply continue on the next run.
//
// Settings (GitHub Actions secrets): STORAGE_CONNECTION, ACS_CONNECTION, MK_SENDER_BIFOLD, MK_SENDER_TECHHUB,
// and optionally MK_PUBLIC_URL, MK_PUBLIC_URL_TECHHUB, MK_PER_MINUTE, MK_PER_HOUR, MK_SECRET (see bifold-tools-api/src/mk-send.js).
// DRY_RUN=1 lists what would happen and changes nothing.

const path = require("path");
const { TableClient } = require("@azure/data-tables");
const makeSender = require(path.join(__dirname, "../../bifold-tools-api/src/mk-send.js"));

const env = process.env;
if (!env.STORAGE_CONNECTION) { console.log("::warning::STORAGE_CONNECTION is not set; nothing to do."); process.exit(0); }

const clients = {};
async function table(name) {
  if (!clients[name]) {
    const c = TableClient.fromConnectionString(env.STORAGE_CONNECTION, name, { allowInsecureConnection: /127\.0\.0\.1|localhost/.test(env.STORAGE_CONNECTION) });
    try { await c.createTable(); } catch (e) { if (e.statusCode !== 409) throw e; }
    clients[name] = c;
  }
  return clients[name];
}
async function getOrNull(t, pk, rk) { try { return await t.getEntity(pk, rk); } catch (e) { if (e.statusCode === 404) return null; throw e; } }

const minutes = Math.max(1, Number(env.MK_RUN_MINUTES) || 8);
makeSender({ table, getOrNull, log: console })
  .pump({ deadline: Date.now() + minutes * 60000, dryRun: env.DRY_RUN === "1" })
  .then(r => { console.log(`Run finished: ${r.campaigns} campaign(s), ${r.sent} sent, ${r.failed} failed, ${r.skipped} skipped${r.stoppedBy ? "; stopped by " + r.stoppedBy : ""}.`); })
  .catch(e => { console.log(`::error::${e.message}`); process.exit(1); });
