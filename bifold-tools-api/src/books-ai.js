// Claude drafting for proposals in Books (needs ANTHROPIC_API_KEY on the Static Web App).
// The prompts are built here, so the page can't use the key for anything else. Prices never come from Claude:
// they come from the customer's BoQ or the salesperson, and Claude is told to leave them alone.
//
// Parts (the page runs them in parallel to stay inside the function time limit):
//   boqmap      which columns of a spreadsheet hold description, model, qty, unit, rate (the page then reads every row)
//   boqread     line items from pasted text, a PDF or a photo of a BoQ
//   story       title, executive summary, understanding of requirements, solution overview, product descriptions
//   commercial  payment terms, delivery timeline, warranty, terms, exclusions, responsibilities, why us
//   figure      the solution diagram drawn by Claude as SVG (FIGURE_MODEL picks a model for it; falls back to "diagram")
//   diagram     a simpler diagram as boxes and links, drawn by the page

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const ready = () => !!process.env.ANTHROPIC_API_KEY;

const CO = {
  techhub: { name: "Tech Hub Information Technology", base: "Ras Al Khaimah (Al Nakheel), delivering across all seven emirates",
    defaults: `Payment terms: equipment supply 100% upon Purchase Order; larger supply and install 50% on PO, 40% on delivery, 10% on commissioning and handover; services in advance.
Warranty: manufacturer hardware warranty (typically 1 year); 12 months on Tech Hub installation and workmanship; remote support Sun to Thu, 9 am to 6 pm UAE.
Terms: valid 30 days; prices in AED with 5% VAT; delivery subject to vendor lead times and site readiness; signed PO or LOI to start; client follows pre-installation requirements; equivalent substitutes only with client approval.
Why Tech Hub cards: Single-Source IT Partner; Certified Engineers (Cisco, Fortinet, HPE and more); RAK-Wide Delivery (all seven emirates); SLA-Backed Support (AMC programmes).` },
  bifold: { name: "Bifold Technologies LLC", base: "Dubai (Al Garhoud), enterprise ICT solutions and managed services",
    defaults: `Payment terms: 70% upon PO confirmation; 20% upon delivery of equipment to site; 10% upon commissioning and sign-off.
Terms (label: value): Warranty: 1-year hardware warranty, manufacturer subscriptions as listed; Proposal Validity: 15 days; Delivery Lead Time: 2 to 3 weeks from PO; VAT: 5% UAE VAT; Pricing Currency: AED; Exclusions: structured cabling, conduit and civil works unless quoted.
Project management: a dedicated Project Manager and certified engineers: site survey, delivery and staging, installation, configuration and integration, testing, remote management setup, handover training and as-built documents.
Exclusions: structured cabling and termination; racks and power distribution; electrical supply; internet and WAN provisioning; civil works; anything not quoted.` },
};

const RULES = `HOUSE RULES
- Never invent prices, part numbers, quantities, brands or models. Use only what the BoQ and the salesperson's notes give. Write "to be confirmed" when something is missing.
- Professional, confident, specific to this customer. UK/UAE English spelling (organisation, authorised). First-person plural ("we propose").
- Never use the em dash or en dash characters. Use a comma, colon, parentheses or a full stop. Hyphens inside part numbers and compound words are fine.
- Each bullet is one sentence. Paragraphs are 2 to 4 sentences.`;

const fmtLines = lines => (lines || []).slice(0, 200).map((l, i) => `${i + 1}. ${[l.section && "[" + l.section + "]", l.sub ? "(sub-item)" : "", l.name, l.description, l.model && "model " + l.model, (l.qty || "") + " " + (l.unit || ""), l.rate ? "AED " + l.rate : "price TBD"].filter(Boolean).join(" | ")}`).join("\n");

const STYLE_TH = `STYLE (Tech Hub house style, follow closely):
- Executive summary, 3 paragraphs: (1) "Tech Hub Information Technology is pleased to present this proposal to <customer> for <what>: <the main components in one sentence>. Total investment is AED <total> including VAT." (2) the design: which brands and models do what, and how it is managed. (3) "Tech Hub will deliver the project end to end - <steps> - with an estimated completion of <duration> from Purchase Order."
- Background: the site, its areas or buildings, how many points or users each area has, and what the customer requires (name the required brands when the BoQ shows them).
- Key requirements: 6 to 10 specific bullets that name models, quantities, locations and services (one bullet each for security, switching, backbone, wireless, cabling, segmentation, services, as the BoQ supports).
- Assumptions: 2 to 3 paragraphs covering provisional quantities, what the client provides (ISP, PCs, power, racks), what is excluded (civil works, core drilling), and subscription terms.
- Solution overview: 2 paragraphs describing how the parts connect, location by location, and the headroom left for future growth.`;

const SHAPES = {
  boqmap: `{"header": row index of the column headings (0-based, -1 if none), "cols": {"ref": col or -1, "description": col, "model": col or -1, "brand": col or -1, "qty": col or -1, "uom": col or -1, "rate": col or -1, "total": col or -1}}
Columns are 0-based. "rate" is the unit price, "total" the line amount. If description is split over two columns, give the main one.`,
  boqread: `{"items": [{"section": string or "", "description": string (as written, may be long), "model": string or "", "qty": number, "uom": string or "", "rate": number or null, "sub": true for accessories, licences, mounts, cables listed under a main item}]}
Keep every line item in order. Use the BoQ's unit prices exactly; if only a line total is given, rate = total / qty. Section headings are not items: put them in "section" of the items below them. Skip subtotal, VAT and total rows.`,
  story: `{"title": string (the solution name for the cover, e.g. "Office Area Network & Wireless: Fortinet & Ubiquiti UniFi"), "site": string (the project or site in a few words, e.g. "Vehicle Impound, Office Area", or "" if unknown), "ref": string (2 to 4 short uppercase words joined by hyphens for the proposal number, customer first, e.g. "EGA-IMPOUND-NET"), "tagline": string (3 to 5 domains separated by "  |  "),
 "summary": [3 paragraphs], "background": [1 to 2 paragraphs], "requirements": [6 to 10 bullets], "assumptions": [2 to 3 paragraphs], "overview": [2 paragraphs]}`,
  scope: `{"items": [{"n": the line number given, "scope": string (1 to 2 sentences for the scope table: what is supplied or done, key specifications from the BoQ and public vendor data, and where it goes, e.g. "FortiGate-70G next-generation firewall, 10 x GE RJ45 ports (including 7 x internal ports, 2 x WAN ports, 1 x DMZ port) - installed at the MDF"), "label": string (short pricing label, max 70 characters, e.g. "FortiGate-70G firewall, 10 x GE RJ45 (7 internal, 2 WAN, 1 DMZ)"), "brand": string (the brand, e.g. "Fortinet", "Ubiquiti UniFi"; for cabling the cable type such as "Cat6 UTP"; for services "COMPANY"), "qtyUnit": string (e.g. "1 No", "3 Nos", "8 Pts", "1 Lot (100 m)")}]}
One entry for every line listed, same numbers. Never change quantities.`,
  specs: `{"specs": [3 to 6 paragraphs, each starting with a category and a colon, e.g. "Firewall: ...", "Switching: ...", "Wireless: ...", "Cabling: ...", "Backbone: ...", naming each model with its part number in brackets and its key specifications from the BoQ and public vendor data],
 "products": [for each MAJOR item (not accessories, cabling or services), at most 8: {"title": string, "code": part number from the BoQ or "", "description": 1 to 2 sentences, "specs": [["Spec", "Value"], 4 to 7 rows]}]}`,
  commercial: `{"payment": [["Label", "Value"], 1 to 3 rows that add up to 100% or state the credit terms],
 "timeline": {"phases": [{"activity": string, "duration": string (e.g. "2 days", "1-2 weeks"), "responsible": "COMPANY" or "Client" or "COMPANY & Client", "weeks": [week numbers this phase is active, 1-based]}], 5 to 8 phases fitting this scope (site survey, procurement, cabling, installation, configuration, testing, handover), "weeks": total weeks (integer), "total": string (e.g. "3-4 Weeks")},
 "warranty": [["Label", "Value"], 3 to 4 rows: hardware warranty naming the brands, installation warranty, AMC option, remote support],
 "terms": TERMS,
 "exclusions": EXCL,
 "responsibilities": [5 to 7 bullets: what our project team does]}`,
  diagram: `{"title": string (e.g. "Solution layout and network topology"), "caption": string (e.g. "Figure 1 - Solution layout traced from the site plan (left) and logical network topology (right)." or, without a site plan, "Figure 1 - Logical network topology."),
 "topology": {"tiers": [[{"id": short id, "label": string (max 34 chars, e.g. "MDF - UniFi Switch Pro 24 PoE"), "sub": string (max 40 chars, e.g. "400W | Cloud Key | 8 data pts"), "kind": one of cloud|isp|mgmt|firewall|router|core|switch|ap|apout|server|storage|nvr|camera|pbx|phone|pc|printer|ups|access|display|other, "dashed": true only for optional or remote items}], ... one array per tier, top (internet) to bottom (end devices), at most 3 boxes per tier, 4 to 8 tiers],
  "links": [{"from": id, "to": id, "label": string (e.g. "New 24C SM fibre (~100 m)", may be ""), "style": "cat6" | "outdoor" | "fibre" | "wan" | "mgmt"}]},
 "networks": [2 to 4 short lines, e.g. "Staff SSID / wired - Staff VLAN, WPA3/WPA2"],
 "site": SITE}
Rules: group identical devices into one box with a count ("3 x U7 Pro") unless they sit in different named locations, in which case give each its own box with the location in "sub" (e.g. "U7 Pro - Reception"). Use equipment from the BoQ; the internet or ISP may be added. Every box is linked to something.`,
};
const SITE_ON = `{"areas": [{"label": string (UPPERCASE room or building name as on the plan), "x": 0-100, "y": 0-100, "w": width 0-100, "h": height 0-100, "plain": true for other buildings shown only for context}],
  "devices": [{"id": short id, "label": string (e.g. "AP02"), "sub": string (e.g. "UniFi U7 Pro"), "kind": "ap" | "apout" | "switch" | "firewall" | "camera" | "server" | "other", "x": 0-100, "y": 0-100}],
  "links": [{"from": device id, "to": device id, "style": "cat6" | "outdoor" | "fibre"}],
  "notes": [{"title": string (e.g. "33 DATA POINTS"), "text": string (e.g. "Reception / Manager (prov.)"), "x": 0-100, "y": 0-100}]}
Trace the site plan: x and y are percentages of the plan's width and height (0,0 top left). Put each device where the BoQ or notes say it goes; label racks and switches by location (MDF, IDF).`;

// Figure: Claude draws the whole solution diagram as SVG, the way it does in chat, inside a house style.
const FIGURE_STYLE = (co, site) => `Draw ONE professional solution diagram for this proposal as a standalone SVG, in the style of a consulting-grade network/solution drawing.

CANVAS: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 H" width="1000" height="H"> with H between 420 and 640. White background. font-family="Arial, Helvetica, sans-serif" on the root.
LAYOUT: ${site ? "TWO panels side by side: LEFT (about 610 wide) \"SITE LAYOUT\" traced from the attached site plan (buildings and rooms as light rectangles with UPPERCASE labels, devices placed where they go: access points as small circles with a Wi-Fi glyph, racks/switches as small dark rectangles, firewall in red; cable runs as coloured lines; callout boxes with device name and model; data-point count callouts). RIGHT (about 370 wide) \"LOGICAL TOPOLOGY\" as below. A small grey note under the left title: Traced from the site plan - not to scale." : "One wide panel. Lay the topology out LEFT TO RIGHT or top to bottom, whichever fits the solution best; use the full width, not a single narrow column."}
TOPOLOGY STYLE: rounded cards (rx 6) filled by role: firewall/router ${"#C8102E"}, core and access switches ${co === "bifold" ? "#1E5A8C" : "#003C50"}, indoor access points #2A9D8F, outdoor access points #E07B24, servers, recorders, controllers and platforms #4A6378, end devices (cameras, displays, players, phones, PCs) #5F7488, internet/ISP and existing or client-supplied items light grey #E9EEF1 with dark text, optional or to-be-confirmed items white with a dashed border. White bold model name 12.5 to 13px, a second line 10.5px (role, location, quantity). Put a simple white line icon (drawn with paths, about 16px) at the left of each card. Group related items inside light dashed zones with a small uppercase label (e.g. "CONTROL ROOM", "CLIENT LAN (EXISTING)", "SITE A"). Connectors: orthogonal lines, 2px; Cat6 #2A9D8F, outdoor cable #E07B24, fibre #6D4C9F dashed, HDMI/AV #8A6D3B, WAN/internet #5B6670, management/remote #8A97A3 dashed; label important links on a small white pill. Show quantities on cards (e.g. "14 x DS-D60E-B") and fan out to grouped end devices visually (stacked card effect or "x14" badge) instead of one plain box.
BOTTOM OR SIDE STRIP: "NETWORKS" (2 to 4 short lines, only if relevant) and "LEGEND" (only the colours and line types actually used).
TEXT: never let text overflow its box: allow about 6.8px per character at 12px and size cards to fit, or wrap with <tspan>. No text smaller than 9px. Title text in panels: 12px bold uppercase in ${co === "bifold" ? "#1E5A8C" : "#003C50"}.
RULES: only svg, g, defs, symbol, use (href="#id" only), rect, circle, ellipse, line, polyline, polygon, path, text, tspan, marker, linearGradient, stop, clipPath. No <image>, <script>, <style>, <foreignObject>, external links or web fonts. Define repeated icons once as <symbol> and reuse them with <use>. Keep the whole SVG under 10000 characters (use <symbol> and <use>, short ids, integer coordinates and no unnecessary attributes) so it can be drawn quickly. Use only equipment from the BoQ; the internet, existing client network or client-supplied items may be shown and marked as such. No em or en dash characters anywhere.`;

const COMMERCIAL_CO = {
  techhub: { TERMS: `[7 to 9 sentences, e.g. "This proposal is valid for 30 days from the date of issue.", "Prices are in UAE Dirhams (AED). VAT at 5% is applicable on all items.", plus scope-specific ones such as provisional quantities, subscription start dates, variation orders and substitution with client approval]`, EXCL: `[] (exclusions go in the assumptions instead)` },
  bifold: { TERMS: `[["Label", "Value"], 5 to 7 rows such as Warranty, Proposal Validity, Delivery Lead Time, VAT, Pricing Currency, Exclusions]`, EXCL: `[4 to 7 bullets fitting this scope]` },
};

function prompt(b, clean) {
  const part = String(b.part || "");
  if (!SHAPES[part] && part !== "figure") return null;
  const coKey = CO[b.company] ? b.company : "techhub", co = CO[coKey];
  if (part === "boqmap") return `These are the first rows of a customer's Bill of Quantities spreadsheet, one row per line, cells separated by " | " (empty cells shown as "").\n\n${clean(b.sample, 12000)}\n\nWork out which columns hold what. Reply with ONLY one JSON object of this shape:\n${SHAPES.boqmap}`;
  if (part === "figure") {
    const co = CO[b.company] ? b.company : "techhub", hasSite = !!(b.file && b.file.data);
    const t = `You are the solution architect at ${CO[co].name} preparing Figure 1 of a commercial proposal.

CUSTOMER: ${clean(b.customer, 150)}
PROPOSAL SUBJECT: ${clean(b.title, 200) || "infer it from the BoQ"}

BILL OF QUANTITIES (section | item | details | model | qty unit):
${(b.lines || []).slice(0, 200).map((l, i) => `${i + 1}. ${[l.section && "[" + l.section + "]", l.sub ? "(sub-item)" : "", l.name, l.description, l.model && "model " + l.model, (l.qty || "") + " " + (l.unit || "")].filter(Boolean).join(" | ")}`).join("\n") || "none"}

SALESPERSON'S NOTES ABOUT THE SITE AND REQUIREMENT:
${clean(b.notes, 5000) || "none given"}
${b.instructions ? "\nCHANGES REQUESTED: " + clean(b.instructions, 1500) + "\n" : ""}${b.svg ? "\nCURRENT DRAWING (apply the requested changes, keep everything else):\n" + clean(b.svg, 16000) + "\n" : ""}
${FIGURE_STYLE(co, hasSite)}

Reply with ONLY one JSON object: {"title": string, "caption": string (e.g. "${hasSite ? "Figure 1 - Solution layout traced from the site plan (left) and logical network topology (right)." : "Figure 1 - Solution architecture."}"), "svg": the complete SVG markup as one string}`;
    return hasSite ? [t] : t;
  }
  if (part === "boqread") return [`Read the line items from this customer Bill of Quantities${b.text ? " (text below)" : " (attached)"}.${b.text ? "\n\n" + clean(b.text, 30000) : ""}\n\nReply with ONLY one JSON object of this shape:\n${SHAPES.boqread}`];
  const total = Number(b.total) || 0, short = co.name.split(" ").slice(0, 2).join(" ");
  let shape = SHAPES[part].replace(/COMPANY/g, short);
  if (part === "commercial") shape = shape.replace("TERMS", COMMERCIAL_CO[coKey].TERMS).replace("EXCL", COMMERCIAL_CO[coKey].EXCL);
  if (part === "diagram") shape = shape.replace("SITE", b.file && b.file.data ? SITE_ON : "null (no site plan was given)");
  const lines = part === "scope" ? (b.lines || []).map((l, i) => ({ ...l, _n: Number(l.n) || i + 1 })) : b.lines;
  const text = `You are drafting part of a ${co.name} commercial proposal (${co.base}).

CUSTOMER: ${clean(b.customer, 150)}${b.attention ? " (attention: " + clean(b.attention, 100) + ")" : ""}
PROPOSAL SUBJECT: ${clean(b.title, 200) || "not given, infer it from the BoQ"}
TOTAL INVESTMENT: ${total ? "AED " + total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " including 5% VAT (AED " + (Number(b.subtotal) || 0).toLocaleString("en-US", { minimumFractionDigits: 2 }) + " before VAT)" : "prices to be confirmed"}
VALIDITY: ${Number(b.validDays) || 30} days

BILL OF QUANTITIES (line number. section | item | details | model | qty unit | unit price):
${part === "scope" ? lines.map(l => `${l._n}. ${[l.section && "[" + l.section + "]", l.sub ? "(sub-item)" : "", l.name, l.description, l.model && "model " + l.model, (l.qty || "") + " " + (l.unit || "")].filter(Boolean).join(" | ")}`).join("\n") : fmtLines(lines) || "none given"}

SALESPERSON'S NOTES ABOUT THE CUSTOMER, THE SITE AND THE REQUIREMENT:
${clean(b.notes, 5000) || "none given"}
${b.instructions ? "\nINSTRUCTIONS FOR THIS DRAFT: " + clean(b.instructions, 1500) + "\n" : ""}${part === "diagram" && b.diagram && b.diagram.topology ? "\nCURRENT DIAGRAM (improve it following the instructions):\n" + JSON.stringify(b.diagram).slice(0, 6000) + "\n" : ""}${part === "diagram" && b.file && b.file.data ? "\nThe customer's site plan is attached. Trace it for the site layout.\n" : ""}
COMPANY STANDARDS (start from these and adapt to the scope):
${co.defaults}
${coKey === "techhub" && part === "story" ? "\n" + STYLE_TH + "\n" : ""}
${RULES}

Reply with ONLY one JSON object of this shape (${short} is the company name to use):
${shape}`;
  return part === "diagram" && b.file && b.file.data ? [text] : text;
}

function parseJson(text) {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = t.indexOf("{"), z = t.lastIndexOf("}");
  if (a >= 0 && z > a) { try { return JSON.parse(t.slice(a, z + 1)); } catch {} }
  return null;
}
const noDash = o => typeof o === "string" ? o.replace(/\s*[—–]\s*/g, ", ") : Array.isArray(o) ? o.map(noDash) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, noDash(v)])) : o;
const FILE_TYPES = { "application/pdf": "document", "image/png": "image", "image/jpeg": "image", "image/webp": "image", "image/gif": "image" };

async function run(b, fail, clean) {
  if (!ready()) fail(501, "Claude drafting isn't set up on the tools site yet (the ANTHROPIC_API_KEY setting is missing).");
  const p = prompt(b, clean);
  if (!p) fail(400, "Unknown drafting request.");
  let content;
  if (Array.isArray(p)) {
    content = [];
    if (b.file && b.file.data) {
      const kind = FILE_TYPES[b.file.type]; if (!kind) fail(400, "Upload the BoQ as Excel, CSV, PDF or a photo (PNG or JPG).");
      if (String(b.file.data).length > 7_000_000) fail(413, "That file is too large for Claude to read here. Use a file under 5 MB.");
      content.push({ type: kind, source: { type: "base64", media_type: b.file.type, data: String(b.file.data) } });
    } else if (b.part === "boqread" && !b.text) fail(400, "Paste the BoQ or choose a file.");
    content.push({ type: "text", text: p[0] });
  } else content = p;
  const max = { boqmap: 400, boqread: 6000, story: 3200, scope: 3500, specs: 3000, commercial: 2600, diagram: 3000, figure: 4800 }[b.part];
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 43000);
  let r;
  try {
    r = await fetch((process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com") + "/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: b.part === "figure" ? process.env.FIGURE_MODEL || MODEL() : MODEL(), max_tokens: max, messages: [{ role: "user", content }] }),
    });
  } catch { fail(504, "Claude took too long to answer. Try again, or split a long BoQ into smaller parts."); }
  finally { clearTimeout(timer); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(502, "Claude couldn't draft this right now (" + ((j.error && j.error.type) || r.status) + ").");
  const out = parseJson((j.content || []).filter(c => c.type === "text").map(c => c.text).join(""));
  if (!out || typeof out !== "object") fail(502, "Claude's answer couldn't be read. Try again.");
  if (b.part === "figure") { const svg = cleanSvg(out.svg); if (!svg) fail(502, "Claude's drawing couldn't be used. Try again."); return { title: noDash(String(out.title || "")), caption: noDash(String(out.caption || "")), svg }; }
  return noDash(out);
}

// The drawing is shown as an image (scripts never run there), but it is still reduced to plain drawing elements.
const SVG_TAGS = new Set(["svg", "g", "defs", "symbol", "use", "rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "tspan", "title", "desc", "marker", "lineargradient", "radialgradient", "stop", "clippath"]);
function cleanSvg(raw) {
  let s = String(raw || "").trim(); const a = s.indexOf("<svg"), z = s.lastIndexOf("</svg>");
  if (a < 0 || z < a || s.length > 60000) return null;
  s = s.slice(a, z + 6).replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<(script|style|foreignObject|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, "");
  let bad = false;
  s = s.replace(/<(\/?)([a-zA-Z:]+)([^>]*)>/g, (m, close, tag, attrs) => {
    if (!SVG_TAGS.has(tag.toLowerCase())) { bad = bad || /^(script|foreignobject|iframe|object|embed)$/i.test(tag); return ""; }
    if (close) return `</${tag}>`;
    const kept = attrs.replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/\s((?:xlink:)?href)\s*=\s*("([^"]*)"|'([^']*)')/gi, (h, n, v, d1, d2) => (d1 || d2 || "").startsWith("#") ? ` href="${d1 || d2}"` : "")
      .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, "none");
    return `<${tag}${kept}>`;
  });
  s = s.replace(/[\u2014\u2013]/g, "-");
  if (!/viewBox="[\d.\s-]+"/.test(s)) return null;
  return s;
}

module.exports = { run, ready, prompt, cleanSvg };
