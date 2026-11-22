// One-off check of candidate vendor news feeds for Trend Radar: fetches each URL and reports
// whether it is a working RSS/Atom feed, how many items it has and how recent the newest is. Reads only.
const C = {
  hp: ["https://investor.hp.com/rss/news-releases.xml", "https://investor.hp.com/news-releases/rss", "https://www.hp.com/us-en/newsroom/press-releases.html"],
  sonicwall: ["https://www.sonicwall.com/blog/rss.xml", "https://www.sonicwall.com/news/rss.xml", "https://www.sonicwall.com/rss"],
  apc: ["https://www.se.com/ww/en/about-us/newsroom/rss.xml", "https://www.se.com/ww/en/about-us/newsroom/news/rss.xml"],
  aruba: ["https://www.hpe.com/us/en/newsroom/rss.xml?tag=networking"],
};
const G = q => "https://news.google.com/rss/search?hl=en-AE&gl=AE&ceid=AE:en&q=" + encodeURIComponent(q + " when:30d");
const NEWS = { hp: '"HP Inc" OR "HP Wolf" OR "HP EliteBook"', sonicwall: '"SonicWall"', h3c: '"H3C" (network OR switch OR wireless OR "data center") -Bambu -printer', mimosa: '"Mimosa Networks" OR "Mimosa by Airspan"', sangfor: '"Sangfor" (security OR HCI OR cloud OR firewall) -stock -shares', apc: '"APC by Schneider Electric" OR ("Schneider Electric" UPS)', aruba: '"HPE Aruba Networking"', antlabs: '"ANTlabs"' };
for (const [k, q] of Object.entries(NEWS)) (C[k] ||= []).push(G(q));

async function check(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; BifoldTrendRadar/1.0; +https://www.bifoldtech.com)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } });
    const body = await r.text();
    const items = (body.match(/<item[\s>]/g) || []).length + (body.match(/<entry[\s>]/g) || []).length;
    const dates = [...body.matchAll(/<(pubDate|updated|published|dc:date)>([^<]+)</g)].map(m => Date.parse(m[2].trim())).filter(n => !isNaN(n));
    const newest = dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : "-";
    const title = ((body.match(/<item[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || body.match(/<entry[\s\S]*?<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "").trim().slice(0, 70);
    return `${r.status} ${items ? "FEED" : "----"} items=${items} newest=${newest} | ${title} | ${url}`;
  } catch (e) { return `ERR ${e.name === "AbortError" ? "timeout" : e.message} | ${url}`; }
  finally { clearTimeout(t); }
}
(async () => {
  for (const [v, urls] of Object.entries(C)) {
    console.log(`== ${v}`);
    for (const u of urls) console.log("  " + await check(u));
  }
})();
