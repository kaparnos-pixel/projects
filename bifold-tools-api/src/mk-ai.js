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

// How each design style wants the content shaped, so a Trend Radar email differs in structure as well as looks.
const LAYOUTS = {
  signature: "Classic update: hero (kicker, title, one line, button); a text block that opens with the greeting; a heading; features with 3 items; a cta.",
  editorial: "Short magazine article: hero with the topic as kicker, an informative headline and NO button; two text blocks that tell the story in plain prose; a heading such as \"What to know\"; features with 3 numbered points; a quote block ONLY if the source contains a real quote with a named speaker (never invent one); a cta.",
  impact: "Launch announcement: hero with a punchy 4 to 8 word title and a button; a short text block; a stats block with 3 short figures taken ONLY from the news (if the news has no real figures, skip stats); a heading; features with 3 benefits with 1 to 3 word titles; a cta.",
  advisory: "Customer notice: hero kicker like \"Security advisory\", \"End of support notice\" or \"Important update\" and a plain factual title; a text block explaining what happened; a heading \"Who is affected\" with a text block of bullet points; a heading \"What to do now\"; features with 3 action steps whose titles start with a verb; a cta offering a check or review.",
  minimal: "Personal note from the account team: hero with a short title and no button; 2 or 3 text paragraphs written as \"we\" with one bullet list of 3 points; a cta with one sentence and a button. No features, stats or quote. 150 to 200 words.",
  spotlight: "Product spotlight: hero kicker is the vendor or product name; a text block; a heading \"What it does\"; features with 3 capabilities; a heading \"Where it fits\" with a text block naming the sectors; a cta.",
  briefing: "News briefing: hero; a text block \"The news in brief\" of 2 or 3 sentences; a heading \"Why it matters\"; a text block with one bullet per relevant sector; features with 3 recommendations; a divider; a cta.",
};

// o: {brief, audience, url, length: "short"|"standard", tone, layout}
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
${o.layout ? "STRUCTURE FOR THIS EMAIL (follow it):\n" + cut(o.layout, 800) : ""}

${BLOCK_SPEC}

${RULES}

${RETURN_SHAPE}`;
}

// Claude sometimes puts real line breaks or tabs inside long JSON strings, or leaves a trailing comma.
// Escape control characters inside strings and drop trailing commas, then try again.
function repairJson(t) {
  let out = "", inStr = false, esc = false;
  for (const ch of t) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") continue;
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
    } else { if (ch === '"') inStr = true; out += ch; }
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}
const parseJson = text => {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const tryAll = t => {
    try { return JSON.parse(t); } catch {}
    const a = t.indexOf("{"), z = t.lastIndexOf("}");
    if (a >= 0 && z > a) { try { return JSON.parse(t.slice(a, z + 1)); } catch {} }
    const a2 = t.indexOf("["), z2 = t.lastIndexOf("]");
    if (a2 >= 0 && z2 > a2) { try { return JSON.parse(t.slice(a2, z2 + 1)); } catch {} }
    return null;
  };
  const r = tryAll(raw); if (r != null) return r;
  return tryAll(repairJson(raw));
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

// One Claude call returning the raw text and why it stopped ("end_turn", "max_tokens").
async function claudeText(prompt, { maxTokens = 2600, timeoutMs = 42000, model } = {}) {
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
  return { text: (j.content || []).filter(c => c.type === "text").map(c => c.text).join(""), stop: j.stop_reason || "" };
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
  if (out == null || typeof out !== "object") { const e = new Error(j.stop_reason === "max_tokens" ? "Claude's answer was too long and got cut off. Try again, or ask for a shorter version." : "Claude's answer couldn't be read. Try again."); e.status = 502; console.log("Claude answer not JSON (" + j.stop_reason + "): " + String((j.content || []).map(c => c.text || "").join("")).slice(0, 600)); throw e; }
  return noDash(out);
}

module.exports = { LAYOUTS, NAMES, WEBSITES, PARTNERS, SECTORS, PROFILES, BLOCK_SPEC, RULES, RETURN_SHAPE, BLOCKS, campaignPrompt, parseJson, repairJson, noDash, sanitizeBlocks, claudeJson, claudeText };
