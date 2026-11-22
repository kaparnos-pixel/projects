// One-off check of candidate vendor news feeds for Trend Radar: fetches each URL and reports
// whether it is a working RSS/Atom feed, how many items it has and how recent the newest is. Reads only.
const C = {
  cisco: ["https://newsroom.cisco.com/c/services/i/servlets/newsroom/rssfeed.json", "https://blogs.cisco.com/feed", "https://blogs.cisco.com/partner/feed", "https://blogs.cisco.com/security/feed"],
  microsoft: ["https://blogs.microsoft.com/feed/", "https://www.microsoft.com/en-us/microsoft-365/blog/feed/", "https://www.microsoft.com/en-us/security/blog/feed/", "https://azure.microsoft.com/en-us/blog/feed/", "https://news.microsoft.com/source/emea/feed/", "https://news.microsoft.com/source/feed/", "https://partner.microsoft.com/en-us/blog/rss"],
  hpe: ["https://www.hpe.com/us/en/newsroom/rss.xml", "https://blogs.arubanetworks.com/feed/", "https://www.hpe.com/us/en/newsroom/blog-post/rss.xml"],
  h3c: ["https://www.h3c.com/en/rss.xml", "https://www.h3c.com/en/About_Us/News___Events/News/rss.xml"],
  huawei: ["https://www.huawei.com/en/rss-feeds/huawei-updates/rss", "https://www.huawei.com/en/rss-feeds/news/rss", "https://e.huawei.com/en/rss"],
  veeam: ["https://www.veeam.com/blog/feed", "https://www.veeam.com/blog/feed/", "https://www.veeam.com/news/rss.xml", "https://www.veeam.com/company/press-release/rss.xml"],
  fortinet: ["https://feeds.fortinet.com/fortinet/blogs", "https://feeds.fortinet.com/fortinet/blog/business-and-technology", "https://feeds.fortinet.com/fortinet/blog/threat-research", "https://feeds.fortinet.com/fortinet/blog/partners", "https://feeds.fortinet.com/fortinet/pressreleases"],
  sonicwall: ["https://www.sonicwall.com/blog/feed", "https://blog.sonicwall.com/en-us/feed/", "https://www.sonicwall.com/news/feed"],
  dell: ["https://www.dell.com/en-us/blog/feed/", "https://www.dell.com/en-us/dt/corporate/newsroom/rss.xml", "https://investors.delltechnologies.com/rss/news-releases.xml"],
  mimosa: ["https://mimosa.co/feed", "https://mimosa.co/blog/feed", "https://blog.mimosa.co/feed/"],
  sophos: ["https://news.sophos.com/en-us/feed/", "https://www.sophos.com/en-us/blog/feed"],
  sangfor: ["https://www.sangfor.com/feed", "https://www.sangfor.com/blog/feed", "https://www.sangfor.com/rss.xml"],
  lenovo: ["https://news.lenovo.com/feed/", "https://news.lenovo.com/pressroom/feed/"],
  apc: ["https://blog.se.com/feed/", "https://www.se.com/ww/en/about-us/newsroom/news/press-releases/rss.xml"],
  antlabs: ["https://www.antlabs.com/feed/", "https://www.antlabs.com/blog/feed/", "https://www.antlabs.com/news/feed/"],
  hp: ["https://www.hp.com/us-en/newsroom/press-releases.rss", "https://press.hp.com/us/en/press-releases.rss", "https://www.hp.com/us-en/newsroom/rss.xml", "https://www.hp.com/us-en/newsroom/press-releases/rss.xml"],
};
// News-search fallbacks for vendors with no feed of their own.
for (const [k, q] of Object.entries({ h3c: '"H3C"', mimosa: '"Mimosa Networks"', antlabs: '"Antlabs"', sangfor: '"Sangfor"', huawei: '"Huawei Enterprise"' })) {
  C[k].push("https://www.bing.com/news/search?format=rss&q=" + encodeURIComponent(q));
  C[k].push("https://news.google.com/rss/search?hl=en-AE&gl=AE&ceid=AE:en&q=" + encodeURIComponent(q));
}

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
