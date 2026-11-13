// Claude drafting for proposals in Books (needs ANTHROPIC_API_KEY on the Static Web App).
// The prompts are built here, so the page can't use the key for anything else. Prices never come from Claude:
// they come from the customer's BoQ or the salesperson, and Claude is told to leave them alone.
//
// Parts (the page runs them in parallel to stay inside the function time limit):
//   boqmap      which columns of a spreadsheet hold description, model, qty, unit, rate (the page then reads every row)
//   boqread     line items from pasted text, a PDF or a photo of a BoQ
//   story       title, executive summary, understanding of requirements, solution overview, product descriptions
//   commercial  payment terms, delivery timeline, warranty, terms, exclusions, responsibilities, why us
//   diagram     a solution diagram as nodes and links, drawn by the page

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

const SHAPES = {
  boqmap: `{"header": row index of the column headings (0-based, -1 if none), "cols": {"ref": col or -1, "description": col, "model": col or -1, "brand": col or -1, "qty": col or -1, "uom": col or -1, "rate": col or -1, "total": col or -1}}
Columns are 0-based. "rate" is the unit price, "total" the line amount. If description is split over two columns, give the main one.`,
  boqread: `{"items": [{"section": string or "", "description": string (as written, may be long), "model": string or "", "qty": number, "uom": string or "", "rate": number or null, "sub": true for accessories, licences, mounts, cables listed under a main item}]}
Keep every line item in order. Use the BoQ's unit prices exactly; if only a line total is given, rate = total / qty. Section headings are not items: put them in "section" of the items below them. Skip subtotal, VAT and total rows.`,
  story: `{"title": string (the solution name for the cover, e.g. "Campus Wi-Fi 7 Upgrade"), "tagline": string (3 to 5 domains separated by "  |  "),
 "summary": [3 paragraphs; the first states what we propose and the total investment including VAT given below],
 "background": [1 to 2 paragraphs about the customer's situation and need],
 "requirements": [4 to 7 bullets: key requirements this proposal meets],
 "assumptions": [2 to 3 short paragraphs: assumptions the offer relies on],
 "overview": [1 to 2 paragraphs describing the proposed solution and how the parts work together],
 "products": [for each MAJOR item (not accessories), at most 8: {"title": string, "code": part number from the BoQ or "", "description": 1 to 2 sentences, "specs": [["Spec", "Value"], 4 to 7 rows from the BoQ text and well-known public vendor specifications]}]}`,
  commercial: `{"payment": [["Label", "Value"], 1 to 3 rows that add up to 100%],
 "timeline": {"phases": [{"activity": string, "duration": string (e.g. "2 weeks"), "responsible": "COMPANY" or "Client" or "COMPANY and Client", "weeks": [week numbers this phase is active, 1-based]}], 5 to 7 phases, first is order confirmation and procurement, last is handover; "weeks": total weeks (integer), "total": string (e.g. "6 Weeks")},
 "warranty": [["Label", "Value"], 3 to 4 rows],
 "terms": [["Label", "Value"], 5 to 7 rows],
 "exclusions": [4 to 7 bullets fitting this scope],
 "responsibilities": [5 to 7 bullets: what our project team does],
 "why": [{"title": string, "body": one sentence}, exactly 4 cards]}`,
  diagram: `{"title": string (e.g. "Proposed network architecture"), "caption": string (one sentence),
 "nodes": [{"id": short id, "label": string (max 28 chars, include a count for grouped devices, e.g. "12 x Aruba AP-735"), "sub": string (model or role, max 40 chars, may be ""), "kind": one of cloud|isp|firewall|router|core|switch|wifi|ap|server|storage|nvr|camera|pbx|phone|pc|printer|ups|rack|access|display|other, "tier": 0-5}],
 "edges": [{"from": id, "to": id, "label": string (link type such as "10G uplink", "PoE", "SIP trunk", may be "")}]}
Diagram rules: 4 to 16 nodes. Group identical devices into ONE node with a count. Tier 0 is the outside world (internet, ISP, PSTN), then security, then core, then distribution or access, then end devices at the highest tier. At most 5 nodes on one tier. Every node is linked to something. Use equipment from the BoQ; existing customer systems (internet, existing LAN, users) may be added when the solution obviously connects to them. A UPS links to what it powers with the label "power".`,
};

function prompt(b, clean) {
  const part = String(b.part || "");
  if (!SHAPES[part]) return null;
  const co = CO[b.company] || CO.techhub;
  if (part === "boqmap") return `These are the first rows of a customer's Bill of Quantities spreadsheet, one row per line, cells separated by " | " (empty cells shown as "").\n\n${clean(b.sample, 12000)}\n\nWork out which columns hold what. Reply with ONLY one JSON object of this shape:\n${SHAPES.boqmap}`;
  if (part === "boqread") return [`Read the line items from this customer Bill of Quantities${b.text ? " (text below)" : " (attached)"}.${b.text ? "\n\n" + clean(b.text, 30000) : ""}\n\nReply with ONLY one JSON object of this shape:\n${SHAPES.boqread}`];
  const total = Number(b.total) || 0;
  return `You are drafting part of a ${co.name} commercial proposal (${co.base}).

CUSTOMER: ${clean(b.customer, 150)}${b.attention ? " (attention: " + clean(b.attention, 100) + ")" : ""}
PROPOSAL SUBJECT: ${clean(b.title, 200) || "not given, infer it from the BoQ"}
TOTAL INVESTMENT: ${total ? "AED " + total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " including 5% VAT (AED " + (Number(b.subtotal) || 0).toLocaleString("en-US", { minimumFractionDigits: 2 }) + " before VAT)" : "prices to be confirmed"}
VALIDITY: ${Number(b.validDays) || 30} days

BILL OF QUANTITIES (section | item | details | model | qty unit | unit price):
${fmtLines(b.lines) || "none given"}

SALESPERSON'S NOTES ABOUT THE CUSTOMER AND THE REQUIREMENT:
${clean(b.notes, 5000) || "none given"}
${b.instructions ? "\nINSTRUCTIONS FOR THIS DRAFT: " + clean(b.instructions, 1500) + "\n" : ""}${part === "diagram" && b.diagram && (b.diagram.nodes || []).length ? "\nCURRENT DIAGRAM (improve it following the instructions):\n" + JSON.stringify({ nodes: b.diagram.nodes, edges: b.diagram.edges }).slice(0, 4000) + "\n" : ""}
COMPANY STANDARDS (start from these and adapt to the scope):
${co.defaults}

${RULES}

Reply with ONLY one JSON object of this shape (COMPANY means ${co.name.split(" ").slice(0, 2).join(" ")}):
${SHAPES[part]}`;
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
      if (String(b.file.data).length > 7_000_000) fail(413, "That file is too large for Claude to read here. Use a file under 5 MB, or export the BoQ to Excel.");
      content.push({ type: kind, source: { type: "base64", media_type: b.file.type, data: String(b.file.data) } });
    } else if (!b.text) fail(400, "Paste the BoQ or choose a file.");
    content.push({ type: "text", text: p[0] });
  } else content = p;
  const max = { boqmap: 400, boqread: 6000, story: 3500, commercial: 2600, diagram: 1800 }[b.part];
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 43000);
  let r;
  try {
    r = await fetch((process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com") + "/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL(), max_tokens: max, messages: [{ role: "user", content }] }),
    });
  } catch { fail(504, "Claude took too long to answer. Try again, or split a long BoQ into smaller parts."); }
  finally { clearTimeout(timer); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(502, "Claude couldn't draft this right now (" + ((j.error && j.error.type) || r.status) + ").");
  const out = parseJson((j.content || []).filter(c => c.type === "text").map(c => c.text).join(""));
  if (!out || typeof out !== "object") fail(502, "Claude's answer couldn't be read. Try again.");
  return noDash(out);
}

module.exports = { run, ready, prompt };
