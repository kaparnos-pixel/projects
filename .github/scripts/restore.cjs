// Restore Tools site tables from a nightly backup (see backup.cjs).
//
// Inputs (env):
//   RESTORE_DAY     the backup date, YYYY-MM-DD (Dubai date of the backup)
//   RESTORE_TABLES  comma-separated table names, or "all"
//   RESTORE_MODE    "merge" (default): put every row from the backup back as it was, keep rows added since
//                   "exact": also delete rows that were not in the backup, so the table matches it exactly
//   DRY_RUN=1       (default) only report what would change
//   STORAGE_CONNECTION, BACKUP_CONNECTION as for the backup
//
// Files are not restored automatically: they are in the backups container under files/<container>/<name>
// and can be copied back with Azure Storage Explorer.

const zlib = require("zlib");
const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");

const env = process.env;
const SRC = env.STORAGE_CONNECTION, DST = env.BACKUP_CONNECTION || SRC;
const DAY = String(env.RESTORE_DAY || "").trim();
const MODE = env.RESTORE_MODE === "exact" ? "exact" : "merge";
const DRY = env.DRY_RUN !== "0";
const opts = /UseDevelopmentStorage|127\.0\.0\.1|localhost/.test(SRC) ? { allowInsecureConnection: true } : {};
if (!/^\d{4}-\d{2}-\d{2}$/.test(DAY)) { console.error("Give the backup date as YYYY-MM-DD."); process.exit(1); }

async function main() {
  const bc = BlobServiceClient.fromConnectionString(DST).getContainerClient("backups");
  const avail = [];
  for await (const b of bc.listBlobsFlat({ prefix: `${DAY}/tables/` })) avail.push(b.name.slice(`${DAY}/tables/`.length).replace(/\.ndjson\.gz$/, ""));
  if (!avail.length) { console.error(`There is no backup for ${DAY}.`); process.exit(1); }
  const want = String(env.RESTORE_TABLES || "").trim().toLowerCase() === "all" ? avail : String(env.RESTORE_TABLES || "").split(",").map(s => s.trim()).filter(Boolean);
  const missing = want.filter(t => !avail.includes(t));
  if (!want.length || missing.length) { console.error(`Unknown table(s): ${missing.join(", ") || "(none given)"}. In this backup: ${avail.join(", ")}`); process.exit(1); }
  console.log(`${DRY ? "DRY RUN: " : ""}restoring ${want.join(", ")} from ${DAY} (${MODE})`);

  for (const name of want) {
    const buf = Buffer.concat(await (async () => { const p = []; for await (const c of (await bc.getBlobClient(`${DAY}/tables/${name}.ndjson.gz`).download()).readableStreamBody) p.push(c); return p; })());
    const rows = zlib.gunzipSync(buf).toString("utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    const tc = TableClient.fromConnectionString(SRC, name, opts);
    await tc.createTable().catch(() => {});
    const now = new Map();
    for await (const e of tc.listEntities({ disableTypeConversion: true })) now.set(e.partitionKey + "\u0000" + e.rowKey, e);
    const keep = new Set(rows.map(r => r.partitionKey + "\u0000" + r.rowKey));
    const changed = rows.filter(r => { const c = now.get(r.partitionKey + "\u0000" + r.rowKey); if (!c) return true; const { etag, timestamp, "odata.etag": _o, ...rest } = c; return JSON.stringify(rest, Object.keys(rest).sort()) !== JSON.stringify(r, Object.keys(r).sort()); });
    const extra = MODE === "exact" ? [...now.values()].filter(e => !keep.has(e.partitionKey + "\u0000" + e.rowKey)) : [];
    console.log(`${name}: ${rows.length} rows in backup, ${changed.length} to put back, ${extra.length} to delete`);
    if (DRY) continue;
    for (const r of changed) await tc.upsertEntity(r, "Replace");
    for (const e of extra) await tc.deleteEntity(e.partitionKey, e.rowKey);
  }
  console.log(DRY ? "Nothing was changed. Run again with dry run switched off to restore." : "Restore finished.");
}

main().catch(err => { console.error("Restore failed:", err.message); process.exit(1); });
