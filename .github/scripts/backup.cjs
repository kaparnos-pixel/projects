// Nightly backup of the Tools site data (Bifold and Tech Hub).
//
// Tables: every table in the storage account is exported, every row with its exact data types, to
//   backups/<YYYY-MM-DD>/tables/<table>.ndjson.gz   (one JSON row per line, gzip)
// Files: every blob in every other container is mirrored to
//   backups/files/<container>/<name>
// A file is copied only when it is new or has changed. When a file changes, the copy it replaces is
// kept under backups/files-history/<YYYY-MM-DD>/...; a file deleted from the site stays in the mirror.
// A manifest (row and file counts) is written to backups/<YYYY-MM-DD>/manifest.json.
// Daily table snapshots and file history older than KEEP_DAYS are removed.
//
// Settings (GitHub Actions secrets / env):
//   STORAGE_CONNECTION   storage account of the Static Web App (the data being backed up)
//   BACKUP_CONNECTION    optional: a different storage account to hold the backups (recommended).
//                        If not set, backups go to a "backups" container in the same account.
//   KEEP_DAYS            how many daily snapshots to keep (default 35)

const zlib = require("zlib");
const { TableServiceClient, TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");

const env = process.env;
const SRC = env.STORAGE_CONNECTION;
const DST = env.BACKUP_CONNECTION || SRC;
const KEEP = Math.max(7, Number(env.KEEP_DAYS) || 35);
const CONTAINER = "backups";
if (!SRC) { console.error("No backup was made: the STORAGE_CONNECTION secret is not set. In GitHub open Settings > Secrets and variables > Actions > New repository secret, name it STORAGE_CONNECTION and paste the storage account connection string (Azure portal > the storage account > Access keys > Connection string)."); process.exit(1); }

const day = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10); // Dubai date
const opts = /UseDevelopmentStorage|127\.0\.0\.1|localhost/.test(SRC) ? { allowInsecureConnection: true } : {};

async function streamToBuffer(s) { const parts = []; for await (const c of s) parts.push(c); return Buffer.concat(parts); }

async function main() {
  const t0 = Date.now();
  const dst = BlobServiceClient.fromConnectionString(DST).getContainerClient(CONTAINER);
  await dst.createIfNotExists();
  const manifest = { day, startedAt: new Date().toISOString(), separateAccount: DST !== SRC, tables: {}, files: { containers: {}, copied: 0, unchanged: 0, bytesCopied: 0 } };

  // ---- tables ----
  const svc = TableServiceClient.fromConnectionString(SRC, opts);
  for await (const t of svc.listTables()) {
    const name = t.name;
    const tc = TableClient.fromConnectionString(SRC, name, opts);
    const lines = [];
    // disableTypeConversion keeps Int64 / DateTime / Binary etc. as { value, type } so a restore is exact.
    for await (const e of tc.listEntities({ disableTypeConversion: true })) {
      const row = {};
      for (const [k, v] of Object.entries(e)) if (k !== "etag" && k !== "timestamp" && k !== "odata.etag") row[k] = v;
      lines.push(JSON.stringify(row));
    }
    const gz = zlib.gzipSync(Buffer.from(lines.join("\n"), "utf8"));
    await dst.getBlockBlobClient(`${day}/tables/${name}.ndjson.gz`).uploadData(gz, { blobHTTPHeaders: { blobContentType: "application/gzip" } });
    manifest.tables[name] = lines.length;
    console.log(`table ${name}: ${lines.length} rows`);
  }

  // ---- files ----
  const srcBlobs = BlobServiceClient.fromConnectionString(SRC);
  for await (const c of srcBlobs.listContainers()) {
    if (c.name === CONTAINER || c.name.startsWith("$") || c.name.startsWith("azure-webjobs")) continue;
    const cc = srcBlobs.getContainerClient(c.name);
    let n = 0;
    for await (const b of cc.listBlobsFlat({ includeMetadata: true })) {
      n++;
      const mirror = dst.getBlockBlobClient(`files/${c.name}/${b.name}`);
      const srcTag = String(b.properties.etag || "");
      let current = null;
      try { current = await mirror.getProperties(); } catch (err) { if (err.statusCode !== 404) throw err; }
      if (current && current.metadata && current.metadata.srcetag === srcTag) { manifest.files.unchanged++; continue; }
      if (current) {
        // Keep the version being replaced.
        const old = await streamToBuffer((await mirror.download()).readableStreamBody);
        await dst.getBlockBlobClient(`files-history/${day}/${c.name}/${b.name}`).uploadData(old, { blobHTTPHeaders: { blobContentType: current.contentType }, metadata: current.metadata });
      }
      const data = await streamToBuffer((await cc.getBlobClient(b.name).download()).readableStreamBody);
      await mirror.uploadData(data, { blobHTTPHeaders: { blobContentType: b.properties.contentType || "application/octet-stream" }, metadata: { ...(b.metadata || {}), srcetag: srcTag } });
      manifest.files.copied++; manifest.files.bytesCopied += data.length;
    }
    manifest.files.containers[c.name] = n;
    console.log(`files ${c.name}: ${n}`);
  }

  // ---- retention ----
  const cutoff = new Date(Date.parse(day + "T00:00:00Z") - KEEP * 864e5).toISOString().slice(0, 10);
  let removed = 0;
  for await (const b of dst.listBlobsFlat()) {
    const m = /^(?:files-history\/)?(\d{4}-\d{2}-\d{2})\//.exec(b.name);
    if (m && m[1] < cutoff) { await dst.deleteBlob(b.name).catch(() => {}); removed++; }
  }
  manifest.removedOld = removed;
  manifest.finishedAt = new Date().toISOString();
  manifest.seconds = Math.round((Date.now() - t0) / 1000);
  await dst.getBlockBlobClient(`${day}/manifest.json`).uploadData(Buffer.from(JSON.stringify(manifest, null, 2)), { blobHTTPHeaders: { blobContentType: "application/json" } });
  const rows = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
  console.log(`Backup ${day} done in ${manifest.seconds}s: ${Object.keys(manifest.tables).length} tables, ${rows} rows; files ${manifest.files.copied} copied, ${manifest.files.unchanged} unchanged; ${removed} old backup files removed.${DST === SRC ? " NOTE: backups are in the same storage account. Set BACKUP_CONNECTION to keep them in a separate one." : ""}`);
  if (env.GITHUB_STEP_SUMMARY) require("fs").appendFileSync(env.GITHUB_STEP_SUMMARY, `### Backup ${day}\n\n| | |\n|---|---|\n| Tables | ${Object.keys(manifest.tables).length} |\n| Rows | ${rows} |\n| Files copied / unchanged | ${manifest.files.copied} / ${manifest.files.unchanged} |\n| Separate storage account | ${DST !== SRC ? "Yes" : "No"} |\n| Took | ${manifest.seconds}s |\n`);
}

main().catch(err => { console.error("Backup failed:", err.message); process.exit(1); });
