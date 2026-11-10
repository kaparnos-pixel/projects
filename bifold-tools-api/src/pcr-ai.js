// Claude drafting for Project Completion Reports (needs ANTHROPIC_API_KEY on the Static Web App).
// The prompt is built here from the saved report, so the page can't use the key for anything else.
// A report is drafted in three small parts that the page runs in parallel to stay inside the function time limit:
//   text      letter, scope delivered, handover deliverables
//   closeout  testing and commissioning, warranty wording, snags (only what the engineer's notes support)
//   diagram   a system diagram as nodes and links, drawn by the page

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const ready = () => !!process.env.ANTHROPIC_API_KEY;
const NAMES = { bifold: "Bifold Technologies LLC", techhub: "Tech Hub Information Technology" };

const RULES = `HOUSE RULES
- A completion report is a record of fact the customer counter-signs. State only what the inputs support. Never invent serial numbers, models, quantities, sites, dates, test results or warranty periods.
- Plain, factual, first-person plural ("we are pleased to confirm"). No sales language and no adjectives about the quality of the work. UK/UAE English spelling (organisation, authorised, labelling).
- Never use the em dash or en dash characters. Use a comma, colon, parentheses or a full stop. Hyphens inside part numbers and compound words are fine.
- Each bullet is one sentence. Keep paragraphs short.`;

const PARTS = {
  text: `{"letter": {"subject": string (e.g. "Completion of customer PO# <PO ref>"), "salutation": string, "body": [2 paragraphs], "closing": string},
 "scope": {"intro": string, "streams": [{"heading": "A. ...", "bullets": [3-5 bullets]}, ... 2 to 6 streams grouped by system]},
 "handover": [5-8 handover deliverables; administrative credentials are always "handed over under separate confidential cover", never printed]}`,
  closeout: `{"testing": [{"test": string, "method": string, "result": "Pass" | "Fail" | "Open" | "", "remarks": string}, ... 5 to 12 rows relevant to the systems],
 "warranty": {"terms": [4-6 bullets using exactly the warranty months given], "exclusions": [4-6 bullets]},
 "snags": [{"item": string, "owner": string, "target": string}] (only items the notes say are outstanding; otherwise an empty array)}
Set "result" to "Pass" only when the engineer's notes say the test was done and passed (or say everything was tested and working); "Fail" or "Open" only when the notes say so; otherwise "".`,
  diagram: `{"title": string (e.g. "Network topology as installed"), "caption": string (one sentence),
 "nodes": [{"id": short id, "label": string (max 28 chars, include a count for grouped devices, e.g. "9 x Aruba AP22"), "sub": string (model or location, max 40 chars, may be ""), "kind": one of cloud|isp|firewall|router|core|switch|wifi|ap|server|storage|nvr|camera|pbx|phone|pc|printer|ups|rack|access|display|other, "tier": 0-5}],
 "edges": [{"from": id, "to": id, "label": string (link type such as "1G uplink", "PoE", "SIP trunk", may be "")}]}
Diagram rules: 4 to 16 nodes. Group identical devices into ONE node with a count instead of drawing each one. Tier 0 is the outside world (internet, ISP, PSTN), then security, then core, then distribution or access, then end devices at the highest tier. At most 5 nodes on one tier. Every node is linked to something. Use only equipment that appears in the BoQ, serial register or notes; an internet or ISP node is allowed when the network obviously connects to one. Power devices such as a UPS link to what they power with the label "power".`,
};

function fmtRows(rows, keys, max) {
  return (rows || []).slice(0, max).map((r, i) => `${i + 1}. ` + keys.map(k => r[k]).filter(Boolean).join(" | ")).join("\n");
}
function serialSummary(rows) {
  const g = new Map();
  (rows || []).forEach(r => { const k = [r.type, r.model].filter(Boolean).join(" | ") || "Item"; const v = g.get(k) || { n: 0, loc: new Set() }; v.n++; if (r.location) v.loc.add(r.location); g.set(k, v); });
  return [...g.entries()].slice(0, 60).map(([k, v]) => `- ${v.n} x ${k}${v.loc.size ? " (locations: " + [...v.loc].slice(0, 6).join(", ") + ")" : ""}`).join("\n");
}

function prompt(b, clean) {
  const part = String(b.part || "");
  if (!PARTS[part]) return null;
  const w = b.warranty || {};
  return `You are drafting part of a ${NAMES[b.company] || NAMES.bifold} ${b.mode === "certificate" ? "Work Completion Certificate" : "Project Completion Report"}.

CUSTOMER: ${clean(b.customerName, 150)}${b.attention ? " (attention: " + clean(b.attention, 100) + ")" : ""}
PROJECT: ${clean(b.projectTitle, 200) || "not given"}
CUSTOMER PO REFERENCE: ${clean(b.poRef, 80) || "not given"}
SITE: ${clean(b.site, 200) || "not given"}
DATES: ${b.startDate ? "started " + b.startDate + ", " : ""}completed ${b.completionDate || "not given"}
WARRANTY: hardware ${Number(w.hwMonths) || 0} months, workmanship ${Number(w.wkMonths) || 0} months, from ${w.start || "the completion date"}${w.hours ? "; support hours " + clean(w.hours, 120) : ""}

CUSTOMER BOQ (description | make/model | qty | unit | remarks):
${fmtRows(b.boq, ["desc", "model", "qty", "unit", "remarks"], 150) || "none given"}

EQUIPMENT INSTALLED WITH SERIAL NUMBERS (summary):
${serialSummary(b.serials) || "none given"}

ENGINEER'S SITE NOTES (the main source of facts about what was done and tested):
${clean(b.notes, 5000) || "none given"}
${b.instructions ? "\nINSTRUCTIONS FROM THE PERSON PREPARING THE REPORT: " + clean(b.instructions, 1500) + "\n" : ""}${part === "diagram" && b.diagram && (b.diagram.nodes || []).length ? "\nCURRENT DIAGRAM (improve it following the instructions):\n" + JSON.stringify({ nodes: b.diagram.nodes, edges: b.diagram.edges }).slice(0, 4000) + "\n" : ""}
${RULES}

Reply with ONLY one JSON object of this shape:
${PARTS[part]}`;
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

async function run(b, fail, clean) {
  if (!ready()) fail(501, "Claude drafting isn't set up on the tools site yet (ANTHROPIC_API_KEY). The standard wording was used instead.");
  const p = prompt(b, clean);
  if (!p) fail(400, "Unknown drafting request.");
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 40000);
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL(), max_tokens: b.part === "diagram" ? 1800 : 2600, messages: [{ role: "user", content: p }] }),
    });
  } catch { fail(504, "Claude took too long to answer. Try again in a moment."); }
  finally { clearTimeout(timer); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(502, "Claude couldn't draft this right now (" + ((j.error && j.error.type) || r.status) + ").");
  const out = parseJson((j.content || []).filter(c => c.type === "text").map(c => c.text).join(""));
  if (!out || typeof out !== "object") fail(502, "Claude's draft couldn't be read. Try again.");
  return noDash(out);
}

module.exports = { run, ready, prompt };
