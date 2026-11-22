// Email Campaigns: what Claude knows about each company, the campaign layout it writes in, and the house rules.
// Shared by the Campaigns page (src/mk.js: "Write it with Claude", subject ideas, Improve) and Trend Radar
// (src/radar.js), so every Claude-written campaign follows the same profile, branding and rules.

const NAMES = { bifold: "Bifold Technologies L.L.C", techhub: "Tech Hub Information Technology" };
const WEBSITES = { bifold: "https://www.bifoldtech.com", techhub: "https://www.techhubrak.ae" };

// Vendor partners of each company. Both companies can also offer the other's portfolio (cross-selling).
const PARTNERS = {
  bifold: ["Cisco", "Microsoft", "HPE Aruba Networking", "H3C", "Huawei", "Veeam", "Fortinet", "SonicWall", "Dell Technologies", "Mimosa", "Sophos", "Sangfor", "Lenovo", "APC by Schneider Electric", "ANTlabs"],
  techhub: ["HP", "Lenovo", "Dell Technologies", "Veeam"],
};
const SECTORS = "Hospitality, Enterprise and Government, plus education, healthcare, aviation, retail and SMEs";

const PROFILES = {
  bifold: `Bifold Technologies L.L.C: an enterprise IT solutions and managed services company in Al Garhoud, Dubai, founded in 2018.
Vendor partners: ${PARTNERS.bifold.join(", ")}.
Can also deliver the portfolio of its sister company Tech Hub Information Technology (HP, Lenovo, Dell, Veeam) for enterprise projects.
Practice areas: enterprise networking, wireless and security; firewalls, ZTNA and endpoint security; unified communications including Microsoft Teams Direct Routing; data centre, servers, storage, hyperconverged infrastructure and backup; power protection; hospitality networks and guest internet gateways; CCTV and structured cabling; Annual Maintenance Contracts with SLA-backed support and preventive maintenance; AI readiness services (AI Readiness Assessment, AI-ready infrastructure, private LLM deployment, agentic workflow automation).
Target customers: ${SECTORS} across the UAE. Readers are IT directors, IT managers and procurement managers.
Voice: confident, expert, concise, consultative. UAE business English.`,
  techhub: `Tech Hub Information Technology: an IT retailer and enterprise solutions provider in Al Nakheel, Ras Al Khaimah (RAK), launched in January 2026.
Vendor partners: ${PARTNERS.techhub.join(", ")}, mainly for enterprise solutions (business PCs and laptops, workstations, servers, storage, printing and backup).
Can also deliver the portfolio of its sister company Bifold Technologies (Cisco, Microsoft, HPE Aruba, Fortinet, Huawei, Sophos and others) for networking, security and data centre projects.
Also offers: office IT setup, networking and Wi-Fi, CCTV, Microsoft 365, IT support and Annual Maintenance Contracts, plus retail laptops, desktops, gaming gear, printers and accessories.
Target customers: ${SECTORS}, with a focus on Ras Al Khaimah and the Northern Emirates. Readers are business owners, IT and office managers and procurement teams.
Voice: friendly, local, helpful, clear. UAE business English.`,
};

const BLOCK_SPEC = `Blocks (JSON objects, "t" is the type):
{"t":"hero","kicker":short label,"title":headline (max 9 words),"text":1-2 sentences,"btn":button label,"url":link}
{"t":"heading","kicker":optional short label,"text":heading}
{"t":"text","text":paragraphs separated by a blank line; "- " lines make bullets; **bold**; [label](url) links}
{"t":"split","title":..,"text":..,"btn":..,"url":..,"side":"left" or "right","alt":describe the photo that should go here}
{"t":"features","title":optional,"items":[{"title":..,"text":one sentence}] (exactly 3)}
{"t":"stats","items":[{"v":figure,"l":label}] (2-4) ONLY with figures given in the brief}
{"t":"quote","text":..,"by":..} ONLY if the brief gives a real quote
{"t":"cta","title":..,"text":..,"btn":..,"url":..}
{"t":"button","btn":..,"url":..}
{"t":"divider"}`;

const RULES = `Rules:
- Purpose is market awareness: inform and build trust, one clear call to action, not a hard sell.
- Never invent prices, discounts, statistics, customer names, partner tiers, certifications, awards or dates. Only use facts from the company profile or the brief.
- Only call a vendor a partner if the company profile lists it as a vendor partner. For the sister company's portfolio, say the company can supply or deliver it, never that it is a partner.
- Greet with the merge field {{first_name|there}} where a greeting fits (e.g. "Hi {{first_name|there}},").
- Links: use the URLs given in the brief; otherwise the company website. Never invent other URLs.
- Never use the em dash character (U+2014) or en dash as punctuation. Use a comma, colon or full stop.
- Subject lines under 60 characters, no ALL CAPS, no spammy words (free, guarantee, act now, !!!).`;

const RETURN_SHAPE = `Reply with ONLY one JSON object: {"name": internal campaign name, "subject": best subject line, "subjects": [3 alternative subject lines], "preheader": preview text under 100 characters, "edition": short label like "November 2026" or "", "blocks": [blocks]}. Leave image fields empty: staff add images.`;

const cut = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

// o: {brief, audience, url, length: "short"|"standard", tone}
function campaignPrompt(co, o) {
  return `You are the email marketing writer for ${NAMES[co]}.
COMPANY PROFILE:
${PROFILES[co]}
Website: ${WEBSITES[co]}

BRIEF FROM THE MARKETING TEAM:
${cut(o.brief, 6000)}
${o.audience ? "Audience: " + cut(o.audience, 300) : ""}
${o.url ? "Call-to-action link: " + cut(o.url, 300) : ""}
Length: ${o.length === "short" ? "short (hero, one text block, CTA; about 120 words)" : "standard (5 to 7 blocks, about 220 to 320 words)"}.
${o.tone ? "Tone: " + cut(o.tone, 100) : ""}

${BLOCK_SPEC}

${RULES}

${RETURN_SHAPE}`;
}

const parseJson = text => {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), z = t.lastIndexOf("}");
  if (a >= 0 && z > a) { try { return JSON.parse(t.slice(a, z + 1)); } catch {} }
  const a2 = t.indexOf("["), z2 = t.lastIndexOf("]");
  if (a2 >= 0 && z2 > a2) { try { return JSON.parse(t.slice(a2, z2 + 1)); } catch {} }
  return null;
};
const noDash = v => typeof v === "string" ? v.replace(/\s*[—–]\s*/g, ", ") : Array.isArray(v) ? v.map(noDash) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, noDash(x)])) : v;

const BLOCKS = ["hero", "heading", "text", "image", "button", "split", "features", "stats", "quote", "cta", "divider", "spacer", "html"];
function sanitizeBlocks(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 60).filter(b => b && BLOCKS.includes(b.t)).map(b => {
    const o = { t: b.t, id: cut(b.id, 20) || Math.random().toString(16).slice(2, 10) };
    for (const k of ["title", "kicker", "btn", "url", "img", "alt", "caption", "by", "align", "style", "side", "size", "w"]) if (b[k] != null && b[k] !== "") o[k] = cut(b[k], k === "url" || k === "img" ? 1000 : 300);
    if (b.text != null) o.text = cut(b.text, 6000);
    if (b.h != null) o.h = Math.max(8, Math.min(80, Number(b.h) || 24));
    if (b.t === "html") o.html = cut(b.html, 20000);
    if (Array.isArray(b.items)) o.items = b.items.slice(0, 4).map(i => ({ title: cut(i && i.title, 120), text: cut(i && i.text, 600), v: cut(i && i.v, 30), l: cut(i && i.l, 80) }));
    return o;
  });
}

// One Claude call. Resolves the parsed JSON, or throws an Error with .status and a readable message.
async function claudeJson(prompt, { maxTokens = 2600, timeoutMs = 42000, model } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) { const e = new Error("Claude isn't connected (the ANTHROPIC_API_KEY setting is missing)."); e.status = 501; throw e; }
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch((process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com") + "/v1/messages", { method: "POST", signal: ctl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: model || process.env.MK_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }) });
  } catch { const e = new Error("Claude took too long to answer. Try again."); e.status = 504; throw e; }
  finally { clearTimeout(timer); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error("Claude couldn't answer right now (" + ((j.error && (j.error.message || j.error.type)) || r.status) + ")."); e.status = 502; throw e; }
  const out = parseJson((j.content || []).filter(c => c.type === "text").map(c => c.text).join(""));
  if (out == null || typeof out !== "object") { const e = new Error("Claude's answer couldn't be read. Try again."); e.status = 502; throw e; }
  return noDash(out);
}

module.exports = { NAMES, WEBSITES, PARTNERS, SECTORS, PROFILES, BLOCK_SPEC, RULES, RETURN_SHAPE, BLOCKS, campaignPrompt, parseJson, noDash, sanitizeBlocks, claudeJson };
