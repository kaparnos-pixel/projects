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

const FIGURE_BIFOLD = site => `Draw ONE consulting-grade solution architecture drawing for this proposal as a standalone SVG, in the BIFOLD house style below. It is printed on its own landscape A4 page.

CANVAS: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 H" width="1400" height="H"> with H between 760 and 900, white background, font-family="Arial, Helvetica, sans-serif" on the root.
TITLE BANNER (top, full width, height 80): navy #1E5A8C with a 5px red #D81F2A rule under it. At the left leave EXACTLY <rect id="logo" x="24" y="14" width="190" height="52" rx="6" fill="#FFFFFF"/> empty (the company logo is placed there later). Next to it, white bold 22px "<Customer> | <Solution name>" and under it 12px light text describing the platform. At the right, white bold 12px document reference and 11px month and year.
BODY: 2 to 4 panels (rx 8, white body, 1.5px navy #1E5A8C border, a 34px navy header bar with a white bold 13px title on the left and a small light descriptor on the right), arranged by where things are (e.g. remote sites on the left, HQ or central system on the right, ${site ? "a site layout traced from the attached plan as one panel, " : ""}an INTERNET / VPN cloud between them when the solution crosses the internet). Inside panels: device drawings made from simple shapes (racks and servers as dark navy rounded rectangles with port dots, routers and SD-WAN boxes in their brand colour such as yellow #F2C200 for Peplink, cameras as small white camera shapes, screens as dark rectangles, the cloud as a white cloud with a navy outline), each with a bold 11px label and a 9.5px grey line of model or role underneath. Repeated sites drawn as a stacked card with "Typical ... site (x40)". Items supplied by Bifold are solid; items in the customer's scope sit in light grey hatched boxes (define a diagonal-line <pattern>) with a small dark rounded pill "CUSTOMER SCOPE". Encrypted tunnels as red #D81F2A dashed curves with small red pills (e.g. "VPN x40"); LAN as navy lines; labels on white pills.
KEY NUMBERS STRIP (near the bottom, full width, navy #1E5A8C, rx 8, height about 80): 4 to 5 columns separated by thin light lines, each with a large white bold 26px number (counts from the BoQ or notes, e.g. cameras, sites, routers, servers) and an 10px light caption.
LEGEND ROW under it (line and box styles actually used, including "Customer scope (by <customer short name>)"), then 2 grey 9.5px footnote lines on the left and "BIFOLD TECHNOLOGIES LLC | www.bifoldtech.com" in navy bold 10px on the right.
TEXT: never let text overflow its box (about 6.8px per character at 12px); nothing smaller than 9px.
RULES: only svg, g, defs, symbol, use (href="#id" only), pattern, rect, circle, ellipse, line, polyline, polygon, path, text, tspan, marker, linearGradient, stop, clipPath. No <image>, <script>, <style>, <foreignObject>, external links or web fonts. Define repeated drawings once as <symbol> and reuse them with <use>. Short ids, integer coordinates, no unnecessary attributes. Use only equipment from the BoQ; existing or customer-supplied items may be shown in customer scope. No em or en dash characters anywhere.`;

const STORY_BIFOLD = `{"title": string (the solution name, e.g. "Centralised CCTV Monitoring Solution"), "tagline": string (the main products separated by "  |  ", e.g. "Dahua DSS Pro V8 CMS  |  HPE Servers  |  Peplink SD-WAN  |  Video Wall  |  AMC"), "subtitle": string (e.g. "Supply, Installation, Commissioning & Annual Maintenance"), "ref": string (TYPE-CLIENT in capitals for the document reference, e.g. "CCTV-AZIZI"),
 "letter": [4 paragraphs for the covering letter after "Dear Sir / Madam,": (1) thanks for the opportunity and what the solution does for the customer; (2) the platform and the main components with quantities; (3) "The total investment for ... is AED <total> inclusive of VAT, as detailed in the Bill of Quantities." and the validity; (4) "Should you require any clarification ... using the details below."],
 "overview": [3 paragraphs: the customer's current situation; what BIFOLD TECHNOLOGIES LLC proposes and what users get; how it is connected, delivered and supported],
 "briefIntro": string (e.g. "The proposed solution is made up of five building blocks:"),
 "pillars": [4 to 6 bullets, each "Block name: what it includes, with models and quantities"],
 "summary": [["Label", "Value"], 6 to 9 rows such as Platform, Server, Sites, Network, Monitoring Room, Professional Services, AMC; do NOT include totals],
 "diagramIntro": string (one or two sentences introducing the architecture drawing, saying which items are in Bifold scope (solid) and which are the customer's (hatched boxes marked CUSTOMER SCOPE))}`;

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
${co === "bifold" ? FIGURE_BIFOLD(hasSite) : FIGURE_STYLE(co, hasSite)}
${b.docRef ? "DOCUMENT REFERENCE: " + clean(b.docRef, 40) + "\n" : ""}${b.month ? "MONTH: " + clean(b.month, 30) + "\n" : ""}
Reply in EXACTLY this plain-text format, nothing before or after:
TITLE: <short title>
CAPTION: <one line, e.g. "${co === "bifold" ? "Figure 1: <Customer> <Solution>, high-level architecture" : hasSite ? "Figure 1 - Solution layout traced from the site plan (left) and logical network topology (right)." : "Figure 1 - Solution architecture."}">
<svg ...complete drawing...</svg>`;
    return hasSite ? [t] : t;
  }
  if (part === "boqread") return [`Read the line items from this customer Bill of Quantities${b.text ? " (text below)" : " (attached)"}.${b.text ? "\n\n" + clean(b.text, 30000) : ""}\n\nReply with ONLY one JSON object of this shape:\n${SHAPES.boqread}`];
  const total = Number(b.total) || 0, short = co.name.split(" ").slice(0, 2).join(" ");
  let shape = (part === "story" && coKey === "bifold" ? STORY_BIFOLD : SHAPES[part]).replace(/COMPANY/g, short);
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

// Streams Claude's answer and stops before the hosting time limit (Azure Static Web Apps cuts requests at 45 s).
// Returns the text so far and whether Claude finished; the page then asks again to carry on from there.
async function streamText(body, deadlineMs, fail) {
  const ctl = new AbortController(); const t0 = Date.now(); let text = "", done = false, stop = "";
  const hard = setTimeout(() => ctl.abort(), deadlineMs + 1500);
  let r;
  try {
    r = await fetch((process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com") + "/v1/messages", { method: "POST", signal: ctl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ ...body, stream: true }) });
  } catch { clearTimeout(hard); fail(504, "Claude didn't respond in time. Try again."); }
  if (!r.ok) { clearTimeout(hard); const j = await r.json().catch(() => ({})); const e = new Error("Claude couldn't draw this right now (" + ((j.error && j.error.type) || r.status) + ")."); e.status = r.status; e.detail = (j.error && j.error.message) || ""; throw e; }
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "";
  try {
    for (;;) {
      if (Date.now() - t0 > deadlineMs) { ctl.abort(); break; }
      const { value, done: end } = await reader.read(); if (end) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line.startsWith("data:")) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") text += ev.delta.text;
        if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
        if (ev.type === "message_stop") done = true;
        if (ev.type === "error") { const e = new Error("Claude stopped with an error (" + ((ev.error && ev.error.type) || "unknown") + ")."); e.status = 502; throw e; } }
    }
  } catch (e) { if (e.status) throw e; }
  finally { clearTimeout(hard); }
  return { text, done: done && stop !== "max_tokens", stop };
}
function parseFigure(text) {
  const t = String(text || ""); const a = t.indexOf("<svg"), z = t.lastIndexOf("</svg>");
  const head = a > 0 ? t.slice(0, a) : "";
  const title = (head.match(/TITLE:\s*(.+)/) || [])[1] || "", caption = (head.match(/CAPTION:\s*(.+)/) || [])[1] || "";
  return { title: noDash(title.trim()), caption: noDash(caption.trim()), svg: a >= 0 && z > a ? cleanSvg(t.slice(a, z + 6)) : null };
}
async function runFigure(b, fail, clean, content) {
  const partial = typeof b.partial === "string" ? b.partial.slice(0, 60000) : "";
  const round = Math.max(0, Math.min(6, Number(b.round) || 0));
  if (round >= 6) fail(502, "Claude's drawing didn't finish. Try again.");
  const deadline = Number(process.env.FIGURE_DEADLINE_MS) || 38000;
  const base = { model: process.env.FIGURE_MODEL || MODEL(), max_tokens: 9000 };
  let res;
  if (!partial) res = await streamText({ ...base, messages: [{ role: "user", content }] }, deadline, fail);
  else {
    // Carry on from where the last request stopped: as a continued answer, or (for models that don't allow that) by asking for the rest.
    try { res = await streamText({ ...base, messages: [{ role: "user", content }, { role: "assistant", content: partial.replace(/\s+$/, "") }] }, deadline, fail); res.text = partial.replace(/\s+$/, "") + res.text; }
    catch (e) {
      if (e.status !== 400) throw e;
      const tail = Array.isArray(content) ? content.slice() : [{ type: "text", text: content }];
      tail.push({ type: "text", text: "\n\nYOU ALREADY WROTE THE START OF THE ANSWER (below). Output ONLY the rest, continuing exactly after its last character, without repeating anything:\n" + partial });
      res = await streamText({ ...base, messages: [{ role: "user", content: tail }] }, deadline, fail); res.text = partial + res.text;
    }
  }
  if (!res.done) { if (res.stop === "max_tokens") fail(502, "Claude's drawing was too long. Redraw with a simpler instruction."); return { partial: res.text, round: round + 1 }; }
  const f = parseFigure(res.text); if (!f.svg) fail(502, "Claude's drawing couldn't be used. Try again.");
  return f;
}

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
  if (b.part === "figure") return runFigure(b, fail, clean, content);
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
  return noDash(out);
}

// The drawing is shown as an image (scripts never run there), but it is still reduced to plain drawing elements.
const SVG_TAGS = new Set(["svg", "g", "defs", "symbol", "use", "rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "tspan", "title", "desc", "marker", "lineargradient", "radialgradient", "stop", "clippath", "pattern"]);
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
