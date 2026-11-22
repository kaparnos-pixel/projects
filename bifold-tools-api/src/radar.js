// Trend Radar (agent A5): watches vendor news, has Claude pick the items worth a campaign for each company, and
// drafts a branded campaign around the best ones. Nothing is sent: drafts wait in Email Campaigns for a person to
// review, and a manager approves before anything reaches customers.
//
// Runs once a day inside the agents job (.github/scripts/agents-run.cjs). The Campaigns page's "Trend Radar" tab
// lists what was found and can draft a campaign from any item on request (src/mk.js routes "radar/...").
//
// Sources: the vendors' own news and blog feeds where they publish one; for vendors without a public feed
// (HP, SonicWall, H3C, Mimosa, Sangfor, APC) a filtered Google News search. Managers turn vendors on and off.
//
// Storage (Table Storage):
//   radaritems  PK <co>  RowKey <hash of the link>  one row per news item and company: vendor, title, link, date,
//               summary, score, why, angle, sectors, status new | scored | drafted | dismissed, campaignId
//   mksettings  PK "radar" RowKey <co>  data (JSON settings);  PK "radar-run" RowKey <co>  last run report
//   agentinbox  PK <co>  RowKey a5-<id>  the item people see in the Agent Inbox and the morning digest

const crypto = require("crypto");
const AI = require("./mk-ai");

const GN = q => "https://news.google.com/rss/search?hl=en-AE&gl=AE&ceid=AE:en&q=" + encodeURIComponent(q + " when:14d");
const VENDORS = {
  cisco: { name: "Cisco", feeds: ["https://newsroom.cisco.com/c/services/i/servlets/newsroom/rssfeed.json", "https://blogs.cisco.com/feed", "https://blogs.cisco.com/partner/feed", "https://blogs.cisco.com/security/feed"] },
  microsoft: { name: "Microsoft", feeds: ["https://blogs.microsoft.com/feed/", "https://www.microsoft.com/en-us/microsoft-365/blog/feed/", "https://www.microsoft.com/en-us/security/blog/feed/", "https://azure.microsoft.com/en-us/blog/feed/", "https://news.microsoft.com/source/emea/feed/"] },
  hpe: { name: "HPE / Aruba", feeds: ["https://www.hpe.com/us/en/newsroom/rss.xml"] },
  h3c: { name: "H3C", news: '"H3C" (network OR switch OR wireless OR "data center" OR cloud) -Bambu -printer' },
  huawei: { name: "Huawei", feeds: ["https://www.huawei.com/en/rss-feeds/huawei-updates/rss"] },
  veeam: { name: "Veeam", feeds: ["https://www.veeam.com/blog/feed"] },
  fortinet: { name: "Fortinet", feeds: ["https://feeds.fortinet.com/fortinet/blogs", "https://feeds.fortinet.com/fortinet/blog/threat-research"] },
  sonicwall: { name: "SonicWall", news: '"SonicWall"' },
  dell: { name: "Dell Technologies", feeds: ["https://www.dell.com/en-us/blog/feed/", "https://investors.delltechnologies.com/rss/news-releases.xml"] },
  mimosa: { name: "Mimosa", news: '"Mimosa Networks" OR "Mimosa by Airspan"' },
  sophos: { name: "Sophos", feeds: ["https://www.sophos.com/en-us/blog/feed"] },
  sangfor: { name: "Sangfor", news: '"Sangfor" (security OR HCI OR cloud OR firewall OR endpoint) -stock -shares' },
  lenovo: { name: "Lenovo", feeds: ["https://news.lenovo.com/feed/"] },
  apc: { name: "APC / Schneider Electric", news: '"APC by Schneider Electric" OR ("Schneider Electric" (UPS OR "data center" OR "data centre"))' },
  antlabs: { name: "ANTlabs", feeds: ["https://www.antlabs.com/feed/"] },
  hp: { name: "HP", news: '"HP Inc" OR "HP Wolf" OR "HP EliteBook" OR "HP Z workstation"' },
};
// Each company's own partners; every other vendor is the sister company's portfolio (cross-selling).
const OWN = {
  bifold: ["cisco", "microsoft", "hpe", "h3c", "huawei", "veeam", "fortinet", "sonicwall", "dell", "mimosa", "sophos", "sangfor", "lenovo", "apc", "antlabs"],
  techhub: ["hp", "lenovo", "dell", "veeam"],
};
const SECTOR_LIST = ["Hospitality", "Enterprise", "Government", "Education", "Healthcare", "Aviation", "Retail", "SME"];
const DEFAULTS = { minScore: 7, maxDrafts: 2, owner: "", news: true, sectors: ["Hospitality", "Enterprise", "Government"] };
const MAX_AGE_DAYS = 14;

const sha = s => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 24);
const cut = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const emailOk = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ""));
const tidy = s => String(s == null ? "" : s).replace(/\s*—\s*/g, ", ").replace(/–/g, "-");
function packJson(obj) {
  const s = JSON.stringify(obj), CHUNK = 30000;
  const out = { dataChunks: Math.max(1, Math.ceil(s.length / CHUNK)) };
  for (let i = 0; i < out.dataChunks; i++) out["data" + i] = s.slice(i * CHUNK, (i + 1) * CHUNK);
  return out;
}

/* ---------------- feed reading ---------------- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: "...", ndash: "-", mdash: ", ", trade: "", reg: "", copy: "" };
const decode = s => String(s || "").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const untag = s => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
// Feeds often escape their HTML (&lt;p&gt;), so strip tags, decode, and strip again.
const strip = s => decode(untag(decode(untag(s)))).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (x, name) => { const m = x.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i")); return m ? m[1] : ""; };
function parseFeed(xml) {
  const out = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, 25)) {
    const title = strip(tag(b, "title"));
    let link = strip(tag(b, "link"));
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i); link = m ? decode(m[1]) : ""; }
    const date = Date.parse(strip(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date")));
    const summary = strip(tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded") || tag(b, "content")).slice(0, 600);
    const src = (b.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1];
    if (title && /^https?:\/\//.test(link)) out.push({ title, link, date: isNaN(date) ? null : new Date(date).toISOString(), summary, source: src ? strip(src) : "" });
  }
  return out;
}
async function get(url, ms = 15000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; BifoldTrendRadar/1.0; +https://www.bifoldtech.com)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5" } });
    return { status: r.status, body: r.ok ? await r.text() : "" };
  } catch (e) { return { status: 0, body: "", error: e.name === "AbortError" ? "timeout" : e.message }; }
  finally { clearTimeout(t); }
}

module.exports = function makeRadar({ table, log = console.log, now = () => new Date() }) {
  const getOrNull = async (t, pk, rk) => { try { return await t.getEntity(pk, rk); } catch (e) { if (e.statusCode === 404) return null; throw e; } };
  const iso = () => new Date(now()).toISOString();

  async function settings(co) {
    const e = await getOrNull(await table("mksettings"), "radar", co);
    return settingsIn(co, e ? json(e.data, {}) : {});
  }
  function settingsIn(co, s) {
    s = s && typeof s === "object" ? s : {};
    const v = s.vendors && typeof s.vendors === "object" ? s.vendors : {};
    const n = (x, lo, hi, d) => { const k = Math.round(Number(x)); return Number.isFinite(k) && k >= lo && k <= hi ? k : d; };
    const sectors = Array.isArray(s.sectors) ? s.sectors.filter(x => SECTOR_LIST.includes(x)) : DEFAULTS.sectors;
    return {
      vendors: Object.fromEntries(Object.keys(VENDORS).map(k => [k, v[k] === undefined ? true : !!v[k]])),
      sectors: sectors.length ? sectors : DEFAULTS.sectors,
      minScore: n(s.minScore, 5, 10, DEFAULTS.minScore),
      maxDrafts: n(s.maxDrafts, 0, 5, DEFAULTS.maxDrafts),
      owner: emailOk(s.owner) ? String(s.owner).trim().toLowerCase() : "",
      news: s.news === undefined ? DEFAULTS.news : !!s.news,
    };
  }
  async function saveSettings(co, raw, by) {
    const s = settingsIn(co, raw);
    await (await table("mksettings")).upsertEntity({ partitionKey: "radar", rowKey: co, data: JSON.stringify(s), updatedBy: by, updatedAt: iso() }, "Replace");
    return s;
  }

  // Reads every source once. Returns [{vendor, official, title, link, date, summary, source}] from the last two weeks.
  async function fetchAll(vendorKeys, { news = true } = {}) {
    const keys = vendorKeys || Object.keys(VENDORS);
    const out = [], report = {};
    const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
    const add = (vendor, official, list) => list.filter(i => !i.date || Date.parse(i.date) >= cutoff).forEach(i => out.push({ ...i, vendor, official }));
    for (const k of keys) {
      const V = VENDORS[k]; if (!V) continue;
      report[k] = { ok: 0, failed: 0, items: 0 };
      for (const url of V.feeds || []) {
        const r = await get(url);
        const list = r.body ? parseFeed(r.body) : [];
        if (list.length) { report[k].ok++; report[k].items += list.length; add(k, true, list); }
        else { report[k].failed++; log(`::notice::Trend Radar: ${V.name} feed gave nothing (${r.status || r.error}): ${url}`); }
      }
      if (V.news && news) {
        // Google News answers 429 to quick bursts: space the searches out and retry once.
        let r = await get(GN(V.news)); if (r.status === 429) { await sleep(12000); r = await get(GN(V.news)); }
        const list = r.body ? parseFeed(r.body) : [];
        if (list.length) { report[k].ok++; report[k].items += list.length; add(k, false, list); }
        else { report[k].failed++; log(`::notice::Trend Radar: no news results for ${V.name} (${r.status || r.error}).`); }
        await sleep(3000);
      }
    }
    // The same story can appear in two feeds of one vendor.
    const seen = new Set();
    return { items: out.filter(i => { const id = sha(i.link); if (seen.has(id)) return false; seen.add(id); return true; }), report };
  }

  /* ---------------- scoring ---------------- */
  function triagePrompt(co, S, items, recent) {
    const own = new Set(OWN[co]);
    return `You help the marketing team of ${AI.NAMES[co]} spot vendor news that is worth an awareness email campaign to the company's customers.
COMPANY PROFILE:
${AI.PROFILES[co]}
Priority sectors set by the company: ${S.sectors.join(", ")}.

Score every news item from 0 to 10 for how good a basis it is for a campaign email to this company's customers in the UAE.
Score high (8 to 10): a new product, feature or solution customers can buy from us; a security threat or advisory that creates a clear, urgent need; an end-of-life or licensing change that drives an upgrade; a major technology shift (AI infrastructure, Wi-Fi 7, zero trust, ransomware recovery, hybrid work) with a clear angle for our customers and sectors.
Score low (0 to 4): financial results, investor news, executive appointments, awards, sponsorships, events in other countries, careers and culture stories, consumer-only products, items that are not really about the vendor, anything our customers can't act on.
Prefer vendors that are the company's own partners; the sister company's portfolio is fine for cross-selling when the story is strong.
Several sources often report the same story. Set "dup": true on an item when it covers the same story as an earlier item in this list${recent.length ? " or as one of the stories we already made campaigns for" : ""}; give the duplicate the same score.
${recent.length ? `STORIES WE ALREADY MADE CAMPAIGNS FOR RECENTLY:\n${recent.map(t => "- " + cut(t, 200)).join("\n")}\n` : ""}
NEWS ITEMS:
${items.map((it, i) => `[${i}] ${VENDORS[it.vendor].name} (${own.has(it.vendor) ? "our partner" : "sister company portfolio"}${it.official ? "" : ", news coverage"}) | ${it.date ? it.date.slice(0, 10) : "date unknown"} | ${cut(it.title, 200)} | ${cut(it.summary, 280)}`).join("\n")}

Reply with ONLY a JSON array covering every item: [{"i": number, "score": 0-10, "dup": true or false, "why": one short sentence on why it matters (or not) to our customers, "angle": one sentence campaign idea for our customers (empty if score under 5), "sectors": [best-fit sectors from: ${SECTOR_LIST.join(", ")}]}]. Never use the em dash.`;
  }

  // Reads the article page (official sources only) so the campaign has real detail to work from.
  async function article(link, ms) {
    if (/news\.google\.com/.test(link)) return "";
    const r = await get(link, ms || 10000);
    if (!r.body) return "";
    let text = strip(r.body.replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " "));
    return text.slice(0, 6000);
  }

  function briefFor(co, row) {
    const vn = VENDORS[row.vendor] ? VENDORS[row.vendor].name : row.vendor;
    const own = OWN[co].includes(row.vendor);
    return `Write an awareness email built around this ${vn} news for our customers. Explain in plain, practical terms what it means for them, then how ${AI.NAMES[co]} can help (assess, advise, supply, deploy and support). Summarise in our own words: do not copy sentences from the article. Only state facts about the news that appear below; if a detail is missing, leave it out.
Vendor relationship: ${own ? `${vn} is one of our vendor partners.` : `${vn} is in our sister company's portfolio: say we can supply and deliver it, do not claim to be a ${vn} partner.`}
NEWS: ${row.title}
Date: ${row.date ? row.date.slice(0, 10) : "recent"}${row.source ? `\nPublished by: ${row.source}` : ""}
Source link: ${row.link}
Summary: ${row.summary || "(none)"}
${row.excerpt ? `Article text (may include page clutter, use only what is relevant):\n${row.excerpt}` : ""}
Suggested angle: ${row.angle || "(none)"}
Best-fit sectors: ${json(row.sectors, []).join(", ") || "general"}
You may add one text link to the source: [${row.official ? `Read ${vn}'s announcement` : "Read the full story"}](${row.link}). The main call to action goes to ${AI.WEBSITES[co]}.`;
  }

  // Builds the campaign draft for one radar item. by: who asked ("Trend Radar" for the daily run, or a person).
  async function draftCampaign(co, row, by, { timeoutMs = 60000, articleMs = 10000 } = {}) {
    if (!row.excerpt && row.official) row.excerpt = await article(row.link, articleMs);
    const sectors = json(row.sectors, []);
    const out = await AI.claudeJson(AI.campaignPrompt(co, { brief: briefFor(co, row), audience: sectors.length ? sectors.join(", ") + " decision makers" : "", url: AI.WEBSITES[co] }), { maxTokens: 2600, timeoutMs });
    const blocks = AI.sanitizeBlocks(out.blocks);
    if (!blocks.length || !out.subject) throw Object.assign(new Error("Claude's campaign draft was empty."), { status: 502 });
    const t = new Date(Date.now() + 4 * 3600e3).toISOString();
    const id = `CMP-${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const vn = VENDORS[row.vendor] ? VENDORS[row.vendor].name : row.vendor;
    const trend = { id: row.rowKey, vendor: row.vendor, vendorName: vn, title: row.title, link: row.link, score: row.score };
    const e = { partitionKey: co, rowKey: id, name: cut(tidy(out.name || `${vn}: ${row.title}`), 140) || "Trend campaign", subject: cut(tidy(out.subject), 200), preheader: cut(tidy(out.preheader), 250),
      audience: JSON.stringify({ mode: "all", tags: [] }), ...packJson({ blocks, edition: cut(out.edition, 60), trend, subjectIdeas: (out.subjects || []).slice(0, 3).map(x => cut(tidy(x), 200)) }),
      status: "draft", source: "radar", trendId: row.rowKey, createdBy: by, createdAt: iso(), updatedBy: by, updatedAt: iso() };
    await (await table("mkcampaigns")).createEntity(e);
    await (await table("radaritems")).updateEntity({ partitionKey: co, rowKey: row.rowKey, status: "drafted", campaignId: id, draftedBy: by, draftedAt: iso() }, "Merge");
    return { id, name: e.name, subject: e.subject };
  }

  /* ---------------- the daily run for one company ---------------- */
  async function run(co, { dry = false, items } = {}) {
    const S = await settings(co);
    const res = { co, fetched: 0, fresh: 0, scored: 0, drafted: 0, created: [], errors: [] };
    const want = items.filter(i => S.vendors[i.vendor] && (S.news || i.official));
    res.fetched = want.length;
    const t = await table("radaritems");
    const fresh = [];
    for (const it of want) { const id = sha(it.link); if (!(await getOrNull(t, co, id))) fresh.push({ ...it, id }); }
    // Items saved without a score (Claude was unavailable last time) get scored now.
    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 864e5).toISOString();
    for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${co}' and status eq 'new' and foundAt ge '${cutoff}'` } }))
      if (!fresh.some(f => f.id === e.rowKey)) fresh.push({ id: e.rowKey, vendor: e.vendor, official: !!e.official, title: e.title, link: e.link, date: e.date || null, summary: e.summary || "", source: e.source || "", foundAt: e.foundAt });
    fresh.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const batch = fresh.slice(0, 120);
    // Stories already turned into campaigns in the last two weeks, so the same story isn't drafted twice.
    const recent = [];
    for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${co}' and status eq 'drafted' and draftedAt ge '${cutoff}'`, select: ["title"] } })) recent.push(e.title);
    res.fresh = batch.length;
    if (!batch.length) { await report(co, res, dry); return res; }

    let scores = [];
    if (process.env.ANTHROPIC_API_KEY) {
      for (let i = 0; i < batch.length; i += 40) {
        const part = batch.slice(i, i + 40);
        try {
          const out = await AI.claudeJson(triagePrompt(co, S, part, recent.concat(batch.slice(0, i).map(b => b.title))), { maxTokens: 6000, timeoutMs: 150000 });
          (Array.isArray(out) ? out : out.items || []).forEach(x => { if (part[x.i]) scores[i + x.i] = x; });
        } catch (e) { res.errors.push("Scoring: " + e.message); log(`::warning::Trend Radar (${co}) scoring failed: ${e.message}`); }
      }
    } else log(`::notice::Trend Radar (${co}): ANTHROPIC_API_KEY is not set, so news is saved without scores.`);

    const rows = batch.map((it, i) => {
      const s = scores[i];
      const score = s && Number.isFinite(Number(s.score)) ? Math.max(0, Math.min(10, Math.round(Number(s.score)))) : null;
      return { partitionKey: co, rowKey: it.id, vendor: it.vendor, official: !!it.official, title: cut(it.title, 400), link: cut(it.link, 1500), date: it.date || "", summary: cut(it.summary, 1200), source: cut(it.source, 120),
        score: score == null ? -1 : score, why: cut(tidy(s && s.why), 400), angle: cut(tidy(s && s.angle), 400), sectors: JSON.stringify((s && Array.isArray(s.sectors) ? s.sectors : []).filter(x => SECTOR_LIST.includes(x))),
        dup: !!(s && s.dup === true), status: score == null ? "new" : "scored", foundAt: it.foundAt || iso() };
    });
    res.scored = rows.filter(r => r.score >= 0).length;
    if (dry) { rows.filter(r => r.score >= S.minScore).forEach(r => log(`[dry run] ${co} ${r.score}/10 ${VENDORS[r.vendor].name}: ${r.title}`)); return res; }
    for (const r of rows) await t.upsertEntity(r, "Replace");

    // Draft the strongest few: one per vendor per morning, never a repeat of a story already drafted. Own partners win ties.
    const own = new Set(OWN[co]);
    const top = [], usedVendors = new Set();
    for (const r of rows.filter(r => r.score >= S.minScore && !r.dup).sort((a, b) => b.score - a.score || (own.has(b.vendor) - own.has(a.vendor)) || String(b.date).localeCompare(String(a.date)))) {
      if (top.length >= S.maxDrafts) break;
      if (usedVendors.has(r.vendor)) continue;
      usedVendors.add(r.vendor); top.push(r);
    }
    const inbox = await table("agentinbox");
    for (const r of top) {
      try {
        const c = await draftCampaign(co, r, "Trend Radar", { timeoutMs: 120000, articleMs: 15000 });
        res.drafted++;
        const vn = VENDORS[r.vendor].name;
        const e = { partitionKey: co, rowKey: "a5-" + r.rowKey, agent: "a5", kind: "trend", refId: c.id, title: cut(tidy(`${vn}: ${r.title}`), 250),
          summary: cut(tidy(`${r.why} A campaign draft is ready to review: "${c.subject}".`), 1500),
          facts: JSON.stringify([["Vendor", `${vn} (${own.has(r.vendor) ? "our partner" : "sister company portfolio"})`], ["Relevance", `${r.score}/10`], ["Campaign idea", r.angle || "-"], ["Sectors", json(r.sectors, []).join(", ") || "-"], ["Source", r.link], ["Campaign draft", c.name]].map(([k, v]) => [k, cut(tidy(v), 800)])),
          severity: r.score >= 9 ? "medium" : "low", owner: S.owner, href: `/campaigns/#edit/${c.id}`, due: "", status: "open", draft: "", createdAt: iso(), updatedAt: iso() };
        await inbox.createEntity(e).catch(err => { if (err.statusCode !== 409) throw err; });
        res.created.push(e);
        log(`Trend Radar (${co}): drafted "${c.subject}" from ${vn} (${r.score}/10).`);
      } catch (err) { res.errors.push(`Draft for "${r.title}": ${err.message}`); log(`::warning::Trend Radar (${co}) couldn't draft "${r.title}": ${err.message}`); }
    }
    await report(co, res, dry);
    return res;
  }
  async function report(co, res, dry) {
    if (dry) return;
    await (await table("mksettings")).upsertEntity({ partitionKey: "radar-run", rowKey: co, at: iso(), fetched: res.fetched, fresh: res.fresh, scored: res.scored, drafted: res.drafted, errors: JSON.stringify(res.errors.slice(0, 10)) }, "Replace");
  }

  /* ---------------- for the Campaigns page ---------------- */
  const itemOut = e => ({ id: e.rowKey, vendor: e.vendor, vendorName: VENDORS[e.vendor] ? VENDORS[e.vendor].name : e.vendor, official: !!e.official, title: e.title, link: e.link, date: e.date || e.foundAt,
    summary: e.summary || "", source: e.source || "", dup: !!e.dup, score: e.score == null ? -1 : Number(e.score), why: e.why || "", angle: e.angle || "", sectors: json(e.sectors, []), status: e.status || "new",
    campaignId: e.campaignId || "", foundAt: e.foundAt || "", draftedBy: e.draftedBy || "" });
  async function list(co) {
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
    const out = [];
    for await (const e of (await table("radaritems")).listEntities({ queryOptions: { filter: `PartitionKey eq '${co}' and foundAt ge '${cutoff}'` } })) out.push(itemOut(e));
    out.sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)));
    const last = await getOrNull(await table("mksettings"), "radar-run", co);
    return { items: out, settings: await settings(co), lastRun: last ? { at: last.at, fetched: last.fetched, fresh: last.fresh, scored: last.scored, drafted: last.drafted, errors: json(last.errors, []) } : null,
      vendors: Object.entries(VENDORS).map(([k, v]) => ({ key: k, name: v.name, own: OWN[co].includes(k), source: v.feeds ? "Official feed" : "News search" })), sectors: SECTOR_LIST };
  }
  async function item(co, id) { const e = await getOrNull(await table("radaritems"), co, id); return e; }
  async function dismiss(co, id, by) { await (await table("radaritems")).updateEntity({ partitionKey: co, rowKey: id, status: "dismissed", draftedBy: by, draftedAt: iso() }, "Merge"); }

  return { VENDORS, OWN, SECTOR_LIST, settings, saveSettings, fetchAll, run, draftCampaign, list, item, dismiss, itemOut };
};
module.exports.VENDORS = VENDORS;
module.exports.OWN = OWN;
module.exports.parseFeed = parseFeed;
