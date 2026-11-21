// Phase 1 agents: they read the tools' own records every morning and put drafts and alerts in the Agent Inbox
// (/agents/). Agents never send anything to a customer: a person reviews each draft and sends it from the inbox.
//
//   a1  AMC Renewal and Warranty   awarded AMCs nearing their end date (90 / 60 / 30 / 0 days), and signed completion
//                                  reports whose warranty ends within 90 days for a customer with no active AMC
//   a2  Pipeline Follow-up         deals quiet in Site survey, Proposal sent or Negotiation for too long
//   a3  Margin Guard               open quotations whose margin (sell price against the Books item cost) is under the
//                                  floor, or that sell a line below cost
//   a4  Collections and Cash       unpaid tax invoices 7 days before due, on the due date and 7 / 30 / 60 days late,
//                                  plus a Monday cash outlook (receivables due against cheques going out)
//
// Each finding has a fixed key (agent, record, milestone), so an item is created once. When the condition goes away
// (renewal started, deal moved on, invoice paid, quote fixed) the open item closes itself as "resolved".
//
// Used by .github/scripts/agents-run.cjs (daily job) and by src/agents.js (the inbox API, for settings).

const CO_NAMES = { bifold: "Bifold Technologies LLC", techhub: "Tech Hub Information Technology" };
const AGENTS = { a1: "AMC Renewal and Warranty", a2: "Pipeline Follow-up", a3: "Margin Guard", a4: "Collections and Cash" };
const DEFAULTS = { enabled: { a1: true, a2: true, a3: true, a4: true }, renewalDays: 90, warrantyDays: 90, followupDays: 7, surveyDays: 5,
  marginFloor: 15, financeEmail: "", monthlyDrafts: 300, digest: true, signature: "", sigLogo: true };
// Default email signatures; managers change them in Agent settings. {name} {title} {mobile} {email} come from each
// person's "My signature" details. A line (or a " | " part of it) whose placeholder is empty is left out.
const DEFAULT_SIGS = {
  bifold: "{name}\n{title}\nBifold Technologies LLC\nAl Garhoud, Dubai, UAE\nM: {mobile} | {email}\nwww.bifoldtech.com",
  techhub: "{name}\n{title}\nTech Hub Information Technology\nAl Nakheel, Ras Al Khaimah, UAE\nT: +971 7 258 1926 | M: {mobile} | {email}\nwww.techhubrak.ae",
};
const INBOX = "agentinbox", SETTINGS = "agentsettings", RUNS = "agentruns";

const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = n => Math.round(n * 100) / 100;
const clamp = (v, lo, hi, d) => { if (v === undefined || v === null || v === "") return d; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(Date.parse(s));
const dubaiToday = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
function addMonths(iso, n) {
  const [y, m, d] = iso.split("-").map(Number); const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}
const fdate = s => isDate(s) ? new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "-";
const aed = n => "AED " + num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nameOf = e => String(e || "").split("@")[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const emailLike = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ""));
// House rule: no em dashes anywhere.
const tidy = s => String(s == null ? "" : s).replace(/\s*\u2014\s*/g, ", ").replace(/\u2013/g, "-");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
function unpack(e) { let s = ""; for (let i = 0; i < (e.dataChunks || 0); i++) s += e["data" + i] || ""; return json(s, {}); }

function settingsIn(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const en = s.enabled && typeof s.enabled === "object" ? s.enabled : {};
  return {
    enabled: Object.fromEntries(Object.keys(AGENTS).map(k => [k, en[k] === undefined ? true : !!en[k]])),
    renewalDays: [30, 45, 60, 90, 120].includes(num(s.renewalDays)) ? num(s.renewalDays) : DEFAULTS.renewalDays,
    warrantyDays: [30, 60, 90, 120].includes(num(s.warrantyDays)) ? num(s.warrantyDays) : DEFAULTS.warrantyDays,
    followupDays: clamp(s.followupDays, 2, 30, DEFAULTS.followupDays),
    surveyDays: clamp(s.surveyDays, 2, 30, DEFAULTS.surveyDays),
    marginFloor: Math.min(80, Math.max(0, r2(num(s.marginFloor === undefined || s.marginFloor === "" ? DEFAULTS.marginFloor : s.marginFloor)))),
    financeEmail: emailLike(s.financeEmail) ? String(s.financeEmail).trim().toLowerCase() : "",
    monthlyDrafts: clamp(s.monthlyDrafts, 0, 5000, DEFAULTS.monthlyDrafts),
    digest: s.digest === undefined ? true : !!s.digest,
    signature: tidy(String(s.signature || "")).replace(/\r/g, "").split("\n").map(l => l.trimEnd()).join("\n").trim().slice(0, 1500),
    sigLogo: s.sigLogo === undefined ? true : !!s.sigLogo,
  };
}

/* ------------------------------------------------------------------ Claude drafting */
const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const BRIEFS = {
  renewal: "Tell the customer their annual maintenance contract is coming up for renewal, that a renewal proposal will follow, and ask them to confirm any changes to the systems, sites or contacts covered. Warm, short, no prices.",
  warranty: "Tell the customer the warranty on the systems delivered under the named project ends soon, explain briefly what an annual maintenance contract adds (preventive maintenance, priority response, health checks), and offer to send a proposal. No prices.",
  followup: "Follow up politely on the proposal or next step named in the facts. Ask whether they have any questions and suggest a short call or meeting. Do not pressure, do not offer discounts.",
  collection: "Remind the customer about the unpaid tax invoice in the facts. Match the tone to the stage: a friendly heads-up before the due date, a polite reminder on or just after it, firmer but courteous when it is 30 or more days late. Ask them to share the payment date or remittance advice.",
};
async function claudeDraft(kind, facts, ctx) {
  if (!process.env.ANTHROPIC_API_KEY || !BRIEFS[kind]) return null;
  const prompt = `You write short business emails for ${ctx.company}, an IT solutions company in the UAE.

TASK: ${BRIEFS[kind]}

FACTS (the only facts you may use; never invent prices, dates, quantities, discounts or commitments):
${facts.map(([k, v]) => `- ${k}: ${v}`).join("\n")}

RULES:
- Professional UAE business English. 90 to 160 words in the body.
- Start with "Dear ${ctx.greeting}," and end with the line "Kind regards," and nothing after it (the sender's signature is added automatically).
- Plain text only. No markdown, no bullet symbols other than "-", no em dash character (use a comma, colon or full stop).

Reply with ONLY one JSON object: {"subject": string, "body": string}`;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: ctl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL(), max_tokens: 900, messages: [{ role: "user", content: prompt }] }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { ctx.log(`Claude drafting failed (${(j.error && j.error.type) || r.status}); using the template.`); return null; }
    const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    const a = text.indexOf("{"), z = text.lastIndexOf("}");
    const out = a >= 0 && z > a ? json(text.slice(a, z + 1), null) : null;
    if (!out || !out.subject || !out.body) return null;
    return { subject: tidy(out.subject).slice(0, 250), body: tidy(out.body).slice(0, 6000) };
  } catch (e) { ctx.log("Claude drafting failed (" + (e.name === "AbortError" ? "timeout" : e.message) + "); using the template."); return null; }
  finally { clearTimeout(timer); }
}

// Plain templates, used when Claude isn't set up, the monthly cap is reached, or Claude fails.
function templateDraft(kind, f, ctx) {
  const sign = "\n\nKind regards,";
  const hi = `Dear ${ctx.greeting},\n\n`;
  if (kind === "renewal") return { subject: `Renewal of your maintenance contract ${f.ref}`,
    body: hi + `Your annual maintenance contract with us (${f.ref}) ${f.left < 0 ? "ended on" : "runs until"} ${fdate(f.end)}. We would like to continue looking after your systems without any break in cover, and we will send you the renewal proposal shortly.\n\nIf anything has changed since the contract started, such as new equipment, additional sites or a different contact person, please let us know so the renewal reflects it.` + sign };
  if (kind === "warranty") return { subject: `Warranty ending soon: ${f.project}`,
    body: hi + `The warranty on the systems we delivered for ${f.project} ${f.left < 0 ? "ended on" : "ends on"} ${fdate(f.end)}.\n\nTo keep them running reliably after that, we offer an annual maintenance contract covering preventive maintenance visits, priority response to faults and regular health checks. We would be happy to prepare a proposal based on the equipment installed.\n\nPlease let us know a convenient time to discuss.` + sign };
  if (kind === "followup") return { subject: `Following up: ${f.title}`,
    body: hi + `I wanted to follow up on ${f.stage === "survey" ? "the site survey" : "our proposal"} for ${f.title}. Please let me know if you have any questions or if there is anything you would like us to adjust.\n\nWould a short call this week be convenient to discuss the next steps?` + sign };
  if (kind === "collection") {
    const late = f.late;
    const lead = late < 0 ? `This is a friendly reminder that invoice ${f.number} for ${aed(f.balance)} falls due on ${fdate(f.due)}.`
      : late === 0 ? `Invoice ${f.number} for ${aed(f.balance)} is due for payment today, ${fdate(f.due)}.`
      : late < 30 ? `Our records show that invoice ${f.number}, due on ${fdate(f.due)}, still has ${aed(f.balance)} outstanding.`
      : `Invoice ${f.number}, due on ${fdate(f.due)}, is now ${late} days overdue with ${aed(f.balance)} outstanding. We would appreciate your urgent attention to this.`;
    return { subject: `${late < 0 ? "Upcoming payment" : late >= 30 ? "Overdue payment" : "Payment reminder"}: invoice ${f.number}`,
      body: hi + lead + `\n\nCould you please share the expected payment date, or the remittance advice if payment has already been made? A copy of the invoice can be sent again on request.` + sign };
  }
  return null;
}

/* ------------------------------------------------------------------ the engine */
module.exports = function makeEngine({ tableFor, log = console.log, now = () => new Date() }) {
  const all = async (name, pk, select) => {
    const t = await tableFor(name); const out = [];
    const queryOptions = { filter: `PartitionKey eq '${pk}'` }; if (select) queryOptions.select = select;
    try { for await (const e of t.listEntities({ queryOptions })) out.push(e); } catch (e) { if (e.statusCode !== 404) throw e; }
    return out;
  };
  const rowCo = e => e.co || (e.company === "Tech Hub IT" ? "techhub" : "bifold");

  async function loadSettings(co) {
    const t = await tableFor(SETTINGS);
    try { const e = await t.getEntity("settings", co); return settingsIn(json(e.data, {})); } catch (e) { if (e.statusCode === 404) return settingsIn({}); throw e; }
  }

  /* -------- a1: AMC renewals and warranty expiry -------- */
  async function a1(co, S, today, data) {
    const out = [];
    const amcs = new Map((await all("amc", "amc", ["RowKey", "co", "value", "planName", "owner"])).map(e => [e.rowKey || e.RowKey, e]));
    for (const c of data.contracts) {
      if (rowCo(c) !== co || (c.status || "active") !== "active" || !isDate(c.end) || c.renewalAmcId) continue;
      const left = daysBetween(today, c.end);
      if (left > S.renewalDays || left < -30) continue;
      const m = Math.min(...[S.renewalDays, 60, 30, 0].filter(x => x <= S.renewalDays && left <= x));
      const a = amcs.get(c.rowKey) || {};
      const cust = data.customers.get(c.customerId) || {};
      const owner = c.owner || c.notifyEmail;
      out.push({ key: `a1-renew-${c.rowKey}-${m}`, agent: "a1", kind: "renewal", refId: c.rowKey, owner,
        severity: left < 0 ? "high" : left <= 30 ? "medium" : "low", due: c.end, href: "/amc/#amcs",
        title: `${left < 0 ? "AMC expired" : "Renew AMC"}: ${c.customerName}`,
        summary: `${c.ref} ${left < 0 ? `ended ${-left} days ago` : left === 0 ? "ends today" : `ends in ${left} days`} and no renewal has been started. Start the renewal in the AMC Tracker (Renew), then send the customer this note.`,
        facts: [["Contract", c.ref], ["Customer", c.customerName], ["Systems covered", String(c.systems || "").slice(0, 500)], ["Ends", fdate(c.end)],
          ["Annual value (internal)", a.value ? aed(a.value) : "-"], ["LPO", c.lpo || "-"]],
        email: { kind: "renewal", to: c.contactEmail || cust.email || "", contact: c.contactName || cust.contactName || "",
          facts: [["Customer", c.customerName], ["Contract reference", c.ref], ["Plan", c.plan || a.planName || "Annual maintenance"], ["Systems covered", String(c.systems || "").slice(0, 800)], [left < 0 ? "Ended on" : "Ends on", fdate(c.end)]],
          tpl: { ref: c.ref, end: c.end, left } } });
    }
    // Warranty ending on delivered projects for customers without an active AMC.
    const covered = new Set(data.contracts.filter(c => rowCo(c) === co && (c.status || "active") === "active" && isDate(c.end) && c.end >= today).map(c => c.customerId));
    for (const r of data.reports) {
      if (rowCo(r) !== co || !(r.status === "signed" || r.completedAt) || covered.has(r.customerId)) continue;
      const b = unpack(r); const w = b.warranty || {};
      const months = Math.max(num(w.hwMonths), num(w.wkMonths));
      const start = isDate(w.start) ? w.start : r.completionDate;
      if (!months || !isDate(start)) continue;
      const end = addDays(addMonths(start, months), -1);
      const left = daysBetween(today, end);
      if (left > S.warrantyDays || left < -30) continue;
      const m = left <= 30 ? 30 : S.warrantyDays;
      const cust = data.customers.get(r.customerId) || {};
      const groups = {};
      (b.serials || []).forEach(s => { const k = [s.type, s.model].filter(Boolean).join(" ") || "Equipment"; groups[k] = (groups[k] || 0) + 1; });
      let systems = Object.entries(groups).map(([k, n]) => `${n} x ${k}`).join(", ");
      if (!systems) systems = (b.boq || []).slice(0, 15).map(x => [x.qty, x.item || x.desc].filter(Boolean).join(" x ")).join(", ");
      const project = r.projectTitle || r.docNo;
      out.push({ key: `a1-warranty-${r.rowKey}-${m}`, agent: "a1", kind: "warranty", refId: r.rowKey, owner: r.owner,
        severity: left <= 30 ? "medium" : "low", due: end, href: "/completion/",
        title: `Offer an AMC: ${r.customerName}`,
        summary: `Warranty on ${project} ${left < 0 ? `ended ${-left} days ago` : `ends in ${left} days`} and ${r.customerName} has no active AMC. Create an AMC in the tracker with the systems below and send this note.`,
        facts: [["Project", project], ["Report", r.docNo], ["Completed", fdate(r.completionDate)], ["Warranty ends", fdate(end)], ["Systems (for the AMC)", systems.slice(0, 600) || "-"], ["Customer PO", r.poRef || "-"]],
        email: { kind: "warranty", to: cust.email || "", contact: r.attention || cust.contactName || "",
          facts: [["Customer", r.customerName], ["Project", project], ["Warranty ends", fdate(end)], ["Systems installed", systems.slice(0, 800) || "as delivered under the project"]],
          tpl: { project, end, left } } });
    }
    return out;
  }

  /* -------- a2: quiet deals -------- */
  async function a2(co, S, today, data) {
    const out = [];
    const WATCH = { survey: S.surveyDays, proposal: S.followupDays, negotiation: S.followupDays };
    const NAMES = { survey: "Site survey", proposal: "Proposal sent", negotiation: "Negotiation" };
    for (const d of data.deals) {
      if (rowCo(d) !== co || !WATCH[d.stage]) continue;
      if (isDate(d.nextActionDate) && d.nextActionDate > today) continue; // the owner has planned the next step
      const log = unpack(d).log || [];
      const lastAt = [d.stageAt, d.updatedAt, ...log.map(l => l.at)].filter(Boolean).sort().pop() || d.createdAt;
      const quiet = daysBetween(String(lastAt).slice(0, 10), today);
      if (quiet < WATCH[d.stage]) continue;
      const round = Math.floor(quiet / WATCH[d.stage]);
      const cust = data.customers.get(d.customerId) || {};
      const lastNote = [...log].reverse().find(l => l.kind === "note");
      out.push({ key: `a2-${d.rowKey}-${d.stage}-${round}`, agent: "a2", kind: "followup", refId: d.rowKey, owner: d.owner,
        severity: quiet >= WATCH[d.stage] * 3 ? "high" : quiet >= WATCH[d.stage] * 2 ? "medium" : "low", due: today, href: "/pipeline/",
        title: `Follow up: ${d.title}`,
        summary: `${d.customerName} has been in ${NAMES[d.stage]} for ${quiet} days with no activity logged. Send a follow-up, set a next action, or mark the deal lost if it has gone cold.`,
        facts: [["Customer", d.customerName], ["Deal", d.title], ["Stage", NAMES[d.stage]], ["Value", aed(d.value)], ["Quiet for", plural(quiet, "day")], ["Last note", lastNote ? `${String(lastNote.at).slice(0, 10)}: ${lastNote.text}`.slice(0, 300) : "-"]],
        email: { kind: "followup", to: cust.email || "", contact: cust.contactName || "",
          facts: [["Customer", d.customerName], ["What the deal is for", d.title], ["Where it stands", d.stage === "survey" ? "site survey done or planned, proposal to follow" : d.stage === "proposal" ? "proposal sent, awaiting feedback" : "in negotiation"], ...(lastNote ? [["Last internal note (context only, do not quote)", String(lastNote.text).slice(0, 300)]] : [])],
          tpl: { title: d.title, stage: d.stage } } });
    }
    return out;
  }

  /* -------- a3: margin guard on open quotations -------- */
  async function a3(co, S, today, data) {
    const out = [];
    const items = new Map((await all("books", "item-" + co, ["RowKey", "name", "purchasePrice"])).map(e => [e.rowKey || e.RowKey, e]));
    const byName = new Map([...items.values()].map(i => [String(i.name || "").toLowerCase(), i]));
    const quotes = data.docs.filter(e => e.type === "quote" && ["draft", "sent", "accepted"].includes(e.status) && !(isDate(e.dueDate) && e.dueDate < today));
    for (const q of quotes) {
      const lines = unpack(q).lines || [];
      let sell = 0, cost = 0, known = 0, unknown = 0; const below = [];
      for (const l of lines) {
        const it = items.get(l.itemId) || byName.get(String(l.name || "").toLowerCase());
        const pp = it ? num(it.purchasePrice) : 0;
        const net = num(l.net);
        if (!(pp > 0)) { unknown++; continue; }
        known++; sell += net; cost += pp * num(l.qty);
        if (net < pp * num(l.qty) - 0.005) below.push(`${l.name} (sell ${aed(net)}, cost ${aed(pp * num(l.qty))})`);
      }
      if (!known || sell <= 0) continue;
      const pct = r2((sell - cost) / sell * 100);
      if (pct >= S.marginFloor && !below.length) continue;
      const qid = q.rowKey || q.RowKey;
      out.push({ key: `a3-${qid}-${String(q.updatedAt || "").replace(/[^0-9]/g, "").slice(0, 14)}`, agent: "a3", kind: "margin", refId: qid, owner: q.createdBy,
        severity: below.length || pct < S.marginFloor / 2 ? "high" : "medium", due: today, href: `/books/#/doc/${qid}`,
        title: `Margin below ${S.marginFloor}%: quotation ${q.number || "(draft)"}`,
        summary: `${q.contactName}: margin on the costed lines is ${pct}% against a floor of ${S.marginFloor}%.${below.length ? ` ${plural(below.length, "line")} ${below.length === 1 ? "is" : "are"} priced below cost.` : ""} Check the pricing or get sign-off from a manager before it goes out.`,
        facts: [["Customer", q.contactName || "-"], ["Quotation", q.number || "Draft"], ["Status", q.status], ["Costed sell value", aed(sell)], ["Cost (Books item purchase price)", aed(cost)],
          ["Margin", `${pct}%`], ["Lines without a cost", unknown ? `${unknown} of ${lines.length} (not counted)` : "none"], ...(below.length ? [["Below cost", below.slice(0, 5).join("; ")]] : [])] });
    }
    return out;
  }

  /* -------- a4: collections and the Monday cash outlook -------- */
  async function a4(co, S, today, data) {
    const out = [];
    const docs = data.docs;
    const paid = new Map();
    docs.forEach(d => { if (d.status !== "posted" || !["receipt", "creditnote"].includes(d.type)) return; json(d.allocs, []).forEach(a => paid.set(a.id, r2((paid.get(a.id) || 0) + num(a.amt)))); });
    const open = docs.filter(d => d.type === "invoice" && d.status === "posted").map(d => ({ d, balance: r2(num(d.total) - (paid.get(d.rowKey || d.RowKey) || 0)) })).filter(x => x.balance > 0.004 && isDate(x.d.dueDate));
    for (const { d, balance } of open) {
      const late = daysBetween(d.dueDate, today);
      const m = [60, 30, 7, 0, -7].find(x => late >= x);
      if (m === undefined || late < -7) continue;
      const id = d.rowKey || d.RowKey;
      const body = unpack(d);
      const cust = data.customers.get(d.contactId) || {};
      out.push({ key: `a4-${id}-${m}`, agent: "a4", kind: "collection", refId: id, owner: S.financeEmail || d.createdBy,
        severity: late >= 30 ? "high" : late >= 7 ? "medium" : "low", due: d.dueDate, href: `/books/#/doc/${id}`,
        title: `${late < 0 ? "Due soon" : late === 0 ? "Due today" : `${late} days overdue`}: ${d.number}, ${d.contactName}`,
        summary: `${aed(balance)} outstanding on ${d.number}, due ${fdate(d.dueDate)}. Send the reminder below${late >= 60 ? ", and consider asking for advance payment on new orders from this customer" : ""}.`,
        facts: [["Customer", d.contactName], ["Invoice", d.number], ["Invoice date", fdate(d.date)], ["Total", aed(d.total)], ["Outstanding", aed(balance)], ["Due", fdate(d.dueDate)]],
        email: { kind: "collection", to: body.contactEmail || cust.email || "", contact: body.attention || cust.contactName || "",
          facts: [["Customer", d.contactName], ["Invoice number", d.number], ["Invoice date", fdate(d.date)], ["Amount outstanding", aed(balance)], ["Due date", fdate(d.dueDate)],
            ["Stage", late < 0 ? `due in ${-late} days` : late === 0 ? "due today" : `${late} days overdue`]],
          tpl: { number: d.number, balance, due: d.dueDate, late } } });
    }
    // Monday: the cash outlook for the next 30 days.
    if (new Date(today + "T00:00:00Z").getUTCDay() === 1) {
      const in30 = addDays(today, 30);
      const overdue = open.filter(x => x.d.dueDate < today), coming = open.filter(x => x.d.dueDate >= today && x.d.dueDate <= in30);
      const cheques = data.cheques.filter(c => rowCo(c) === co && (c.kind || "pdc") === "pdc" && (c.status || "pending") === "pending" && isDate(c.clearanceDate) && c.clearanceDate <= in30);
      const sum = a => r2(a.reduce((s, x) => s + num(x.balance !== undefined ? x.balance : x.amount), 0));
      const weeks = [0, 1, 2, 3].map(w => { const a = addDays(today, w * 7), b = addDays(today, w * 7 + 6);
        return [`Week of ${fdate(a)}`, `in ${aed(sum(coming.filter(x => x.d.dueDate >= a && x.d.dueDate <= b)))} / out ${aed(sum(cheques.filter(c => c.clearanceDate >= a && c.clearanceDate <= b)))}`]; });
      const worst = {}; overdue.filter(x => daysBetween(x.d.dueDate, today) >= 60).forEach(x => { worst[x.d.contactName] = r2((worst[x.d.contactName] || 0) + x.balance); });
      const net = r2(sum(coming) - sum(cheques));
      out.push({ key: `a4-outlook-${co}-${today}`, agent: "a4", kind: "outlook", refId: "outlook", owner: S.financeEmail || "", severity: net < 0 ? "high" : "low", due: today, href: "/books/#/invoices?view=unpaid",
        title: `Cash outlook, next 30 days: ${net < 0 ? "short by " + aed(-net) : aed(net) + " net in"}`,
        summary: `${aed(sum(coming))} of invoices fall due in the next 30 days against ${aed(sum(cheques))} of post-dated cheques clearing. ${aed(sum(overdue))} is already overdue across ${plural(overdue.length, "invoice")}.`,
        facts: [...weeks, ["Overdue now", `${aed(sum(overdue))} (${plural(overdue.length, "invoice")})`],
          ["60+ days overdue (consider advance terms)", Object.entries(worst).map(([k, v]) => `${k} ${aed(v)}`).join("; ") || "none"]] });
    }
    return out;
  }

  /* -------- run -------- */
  // Supersedable kinds: one open item per record at a time; the newest milestone replaces the older one.
  const RESOLVABLE = new Set(["renewal", "warranty", "followup", "margin", "collection"]);
  async function runCompany(co, opts) {
    const today = opts.today || dubaiToday();
    const S = await loadSettings(co);
    const inbox = await tableFor(INBOX);
    const existing = new Map((await all(INBOX, co)).map(e => [e.rowKey, e]));
    const only = opts.only && opts.only.length ? new Set(opts.only) : null;
    const want = k => S.enabled[k] && (!only || only.has(k));
    const data = {
      customers: new Map((await all("customers", "customer")).filter(e => rowCo(e) === co).map(e => [e.rowKey, e])),
      contracts: want("a1") ? await all("amccontracts", "contract") : [],
      reports: want("a1") ? await all("pcr", "pcr") : [],
      deals: want("a2") ? await all("deals", "deal") : [],
      cheques: want("a4") ? await all("pdc", "cheque") : [],
      docs: want("a3") || want("a4") ? (await all("books", "doc-" + co)).map(e => Object.assign(e, { rowKey: e.rowKey || e.RowKey })) : [],
    };
    const found = [];
    for (const [k, fn] of [["a1", a1], ["a2", a2], ["a3", a3], ["a4", a4]]) {
      if (!want(k)) continue;
      try { found.push(...await fn(co, S, today, data)); } catch (e) { log(`::warning::${AGENTS[k]} (${co}) failed: ${e.message}`); }
    }
    // Drafting budget for the month.
    const month = today.slice(0, 7);
    const runs = await tableFor(RUNS);
    let used = 0; try { used = num((await runs.getEntity("usage", `${co}-${month}`)).drafts); } catch {}
    const signerFor = owner => nameOf(owner) || CO_NAMES[co];
    const created = [], resolved = [];
    const live = new Set(found.map(f => f.kind + "|" + f.refId));
    let drafted = 0;
    for (const f of found) {
      if (existing.has(f.key)) continue;
      let draft = null;
      if (f.email) {
        const ctx = { company: CO_NAMES[co], signer: signerFor(f.owner), greeting: f.email.contact || "Sir / Madam", log };
        let d = null, source = "template";
        if (!opts.dry && used + drafted < S.monthlyDrafts) { d = await claudeDraft(f.email.kind, f.email.facts, ctx); if (d) { source = "claude"; drafted++; } }
        d = d || templateDraft(f.email.kind, f.email.tpl, ctx);
        draft = { to: f.email.to, cc: "", subject: tidy(d.subject), body: tidy(d.body), source };
      }
      const t = new Date(now()).toISOString();
      const e = { partitionKey: co, rowKey: f.key, agent: f.agent, kind: f.kind, refId: f.refId, title: tidy(f.title).slice(0, 250), summary: tidy(f.summary).slice(0, 1500),
        facts: JSON.stringify(f.facts.map(([k, v]) => [tidy(k), tidy(v).slice(0, 800)])), severity: f.severity, owner: String(f.owner || "").toLowerCase(), href: f.href, due: f.due || "",
        status: "open", draft: draft ? JSON.stringify(draft) : "", createdAt: t, updatedAt: t };
      if (opts.dry) log(`[dry run] ${co} ${f.agent} ${f.key}: ${e.title} -> ${e.owner || "(no owner)"}${draft ? ` | draft to ${draft.to || "(no address)"}: ${draft.subject}` : ""}`);
      else await inbox.createEntity(e).catch(err => { if (err.statusCode !== 409) throw err; });
      created.push(e);
    }
    // Close open items whose condition has gone, or that a newer milestone replaced.
    for (const e of existing.values()) {
      if (!["open", "snoozed"].includes(e.status) || !RESOLVABLE.has(e.kind) || (only && !only.has(e.agent)) || !S.enabled[e.agent]) continue;
      const stillLive = live.has(e.kind + "|" + e.refId);
      const replaced = stillLive && !found.some(f => f.key === e.rowKey);
      if (stillLive && !replaced) continue;
      const patch = { partitionKey: co, rowKey: e.rowKey, status: "resolved", decidedBy: "agent", decidedAt: new Date(now()).toISOString(),
        note: replaced ? "Replaced by a newer reminder for the same record." : "Closed automatically: the record no longer needs this.", updatedAt: new Date(now()).toISOString() };
      if (opts.dry) log(`[dry run] ${co} resolve ${e.rowKey}: ${patch.note}`);
      else await inbox.updateEntity(patch, "Merge", { etag: e.etag }).catch(() => {});
      resolved.push(e.rowKey);
    }
    // Snoozed items whose time is up come back.
    for (const e of existing.values()) if (e.status === "snoozed" && isDate(e.snoozeUntil) && e.snoozeUntil <= today && !resolved.includes(e.rowKey) && !opts.dry)
      await inbox.updateEntity({ partitionKey: co, rowKey: e.rowKey, status: "open", snoozeUntil: "", updatedAt: new Date(now()).toISOString() }, "Merge", { etag: e.etag }).catch(() => {});
    if (!opts.dry) {
      await runs.upsertEntity({ partitionKey: "usage", rowKey: `${co}-${month}`, drafts: used + drafted }, "Merge");
      const at = new Date(now()).toISOString();
      const counts = {}; created.forEach(c => { counts[c.agent] = (counts[c.agent] || 0) + 1; });
      await runs.upsertEntity({ partitionKey: "run-" + co, rowKey: String(9e15 - Date.parse(at)), at, created: created.length, resolved: resolved.length, drafted, counts: JSON.stringify(counts), only: only ? [...only].join(",") : "" }, "Replace");
    }
    return { co, settings: S, created, resolved, drafted };
  }

  return { runCompany, loadSettings };
};
module.exports.AGENTS = AGENTS;
module.exports.DEFAULTS = DEFAULTS;
module.exports.DEFAULT_SIGS = DEFAULT_SIGS;
module.exports.settingsIn = settingsIn;
module.exports.TABLES = { INBOX, SETTINGS, RUNS };
module.exports.tidy = tidy;
