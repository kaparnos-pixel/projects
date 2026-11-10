// Claude drafting for the AMC Tracker (optional: needs ANTHROPIC_API_KEY on the Static Web App).
// Prompts are built here from structured fields, so the page can't use the key for anything else.
// A proposal is drafted in four small parts in parallel to stay inside the 45-second function limit;
// the page fills any part that fails from the standard template.

const EXAMPLE = require("./amc-example.json");
const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const ready = () => !!process.env.ANTHROPIC_API_KEY;

const PLAYBOOK = `AMC PLAYBOOK
- Subtitle names the engagement, e.g. "IP Telephony Support Plan", "IT Infrastructure Support Plan", "Network & Connectivity Support Plan", "CCTV & Security Support Plan". Mixed estates get a combined plan name.
- Scope streams lettered A, B, C… tailored to the systems. Telephony: PBX support, handsets, call routing & features (MAC), PSTN/trunk coordination, preventive maintenance & health checks, support coordination & reporting. IT: daily operations & support, network & systems management, server & application administration, cybersecurity & compliance (advisory), vendor & asset management, communication & stakeholder coordination. CCTV: NVR/DVR platform, cameras & field devices, storage/retention/playback, network coordination, PM & health checks, reporting.
- Service plan rows [Parameter, Coverage, Notes]: service plan, covered systems/endpoints/lines, preventive maintenance cadence, remote support hours, onsite support, moves/adds/changes, firmware updates, config backup, email/telephone support, named engineers, coverage hours (Mon–Sat 9 AM–6 PM unless told otherwise), hardware Excluded, vendor licences Excluded, service reports cadence.
- Sizing by annual value: small (< AED 15,000): remote-first, business hours, quarterly PM, on-call onsite, never 24x7. Medium (15,000–60,000): business-hours remote plus monthly onsite PM, 2–3 named engineers, monthly reports. Large (> 60,000): structured onsite days, extended or 24x7 remote, monthly PM and reporting.
- SLA rows [Priority, Description, Response, Action Plan, Restoration] for P1–P4 scaled to size. Small: P1 1 hour / 2 hours / 8 business hours; P2 2 hours / 4 hours / 1 business day; P3 4 hours / next business day / 2 business days; P4 1 business day / 2 business days / 3 business days. Large: P1 15 minutes / 30 minutes / 4 hours; P2 20 minutes / 1 hour / 8 hours; P3 30 minutes / 2 hours / next business day; P4 30 minutes / 4 hours / 2 business days.
- Payment: small → 100% annual advance on signing; larger → semi-annual 50/50 (signing and month 7), unless instructed otherwise.
- Exclusion groups always: Scope Exclusions, Future Purchases, Customer Obligations, Security & Responsibility Model (text), Disclaimers & Liability, Confidentiality, System Size Assumption (text naming the baseline footprint).
- Never invent quantities, models or sites that are not in the systems list. Professional UAE business English. Each bullet one sentence.
- Never use the em dash character (U+2014). Use a comma, colon or full stop instead.`;

const PARTS = {
  intro: `{"subtitle": string, "planName": string (e.g. "IP Telephony Support"), "letterSubjectTopic": string (e.g. "Avaya IP Office Telephony Support Services"), "letter": [3 paragraphs for the cover letter], "understanding": {"paragraphs": [2 paragraphs], "drivers": [4-6 bullets]}, "lineItemDesc": string (one line naming the plan, the systems and "12 Months"), "paymentTerms": [1-2 strings describing only the payment split]}`,
  scope: `{"scope": {"intro": string, "streams": [{"heading": "A. …", "bullets": [3-4 bullets]}, … 5 to 7 streams]}}`,
  service: `{"servicePlan": {"intro": string, "rows": [[parameter, coverage, notes], … 12 to 19 rows]}, "response": {"intro": string, "rows": [[priority, description, response, action plan, restoration] × 4 for P1–P4], "workflow": [5 bullets]}}`,
  terms: `{"documentation": {"intro": string, "groups": [{"heading": string, "bullets": [...]}, … 3-4 groups]}, "exclusions": {"groups": [{"heading": string, "bullets": [...]} or {"heading": string, "text": string}, … the 7 standard groups]}}`,
};

// Tech Hub's house defaults (from its AMC playbook) take precedence over the shared playbook.
const TECHHUB = `TECH HUB HOUSE DEFAULTS (these override the playbook above where they differ):
- The company is Tech Hub Information Technology, an IT solutions provider in Ras Al Khaimah (Al Nakheel), serving RAK and the wider UAE.
- Business hours are Sun-Thu, 9 AM - 6 PM UAE. Out-of-hours and 24x7 cover are a priced upgrade.
- SLA priorities are named Critical, High, Medium and Low: Critical (system down) 1-hour remote and 4-hour on-site target; High (major function impaired) 2-hour remote and next-business-day on-site; Medium (degraded / single user) 4-hour remote; Low (request / advisory) next business day.
- Preventive maintenance defaults to 4 visits a year (quarterly); 2 a year for small estates. Each visit ends with a written visit report.
- Offer Comprehensive (parts and labour) or Standard (labour only, parts billed on approval) cover, and say which applies or that both are available.
- Payment defaults to 100% annual in advance, with a quarterly option by prior agreement.`;
const NAMES = { bifold: "Bifold Technologies LLC", techhub: "Tech Hub Information Technology" };

function proposalPrompt(b, clean) {
  const part = String(b.part || "");
  if (!PARTS[part]) return null;
  const v = Number(b.value) || 0;
  const size = v < 15000 ? "small" : v <= 60000 ? "medium" : "large";
  return `You are drafting part of a ${NAMES[b.company] || NAMES.bifold} Annual Maintenance Contract (AMC) proposal.

CUSTOMER: ${clean(b.customerName, 150)}${b.location ? " (" + clean(b.location, 100) + ")" : ""}
SYSTEMS COVERED (verbatim from the account manager):
${clean(b.systems, 6000)}
ANNUAL AMC VALUE: AED ${v.toLocaleString("en-US")} excluding VAT (size band: ${size}). Do not restate figures; the commercial table is filled separately.
TERM: ${Number(b.termMonths) || 12} months.${b.renewal ? "\nThis is a renewal of an existing Bifold AMC; mention continuity of service where natural." : ""}
${b.notes ? "ACCOUNT MANAGER'S INSTRUCTIONS: " + clean(b.notes, 1500) + "\n" : ""}
${PLAYBOOK}
${b.company === "techhub" ? "\n" + TECHHUB + "\n" : ""}
Reply with ONLY one JSON object of this shape:
${PARTS[part]}

WORKED EXAMPLE of a finished telephony AMC (match its depth and tone, not its content):
${JSON.stringify(EXAMPLE)}`;
}

function visitPrompt(b, clean) {
  return `You are writing the findings section of a ${NAMES[b.company] || NAMES.bifold} maintenance visit report for the customer ${clean(b.customerName, 150)}.
Visit type: ${clean(b.visitType, 60)}. Systems under contract: ${clean(b.systems, 3000) || "not listed"}.
Checklist items marked as issues: ${clean(b.issues, 2000) || "none"}.
Engineer's rough notes (the only source of facts; add nothing the notes don't support):
${clean(b.notes, 4000)}

Write clear, professional, customer-facing English. Never use the em dash character (U+2014); use a comma, colon or full stop. Reply with ONLY JSON: {"findings": [short sentences], "actions": [short sentences], "recommendations": [short sentences]}. Each array may be empty.`;
}

function parseJson(text) {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = t.indexOf("{"), z = t.lastIndexOf("}");
  if (a >= 0 && z > a) { try { return JSON.parse(t.slice(a, z + 1)); } catch {} }
  return null;
}

async function run(b, fail, clean) {
  if (!ready()) fail(501, "Claude drafting isn't set up on the tools site. The standard template was used instead.");
  const prompt = b.kind === "proposal" ? proposalPrompt(b, clean) : b.kind === "visit" ? visitPrompt(b, clean) : null;
  if (!prompt) fail(400, "Unknown drafting request.");
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 40000);
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL(), max_tokens: b.kind === "visit" ? 1200 : 2500, messages: [{ role: "user", content: prompt }] }),
    });
  } catch (e) { fail(504, "Claude took too long to answer. The standard template was used instead."); }
  finally { clearTimeout(timer); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(502, "Claude couldn't draft this right now (" + ((j.error && j.error.type) || r.status) + ").");
  const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  const out = parseJson(text);
  if (!out || typeof out !== "object") fail(502, "Claude's draft couldn't be read. The standard template was used instead.");
  return out;
}

module.exports = { run, ready };
