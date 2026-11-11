// Activity log: who did what, when and from where, across every tool. Written by the API for each change,
// upload, download, email, access change, sign-in and refused request; read by managers on the Activity log page.
// People can't change or delete entries: there is no API for it.
//
// Storage (Table Storage "audit"):
//   PartitionKey "<company>-<yyyymm>" (bifold / techhub; "security" for accounts outside both companies)
//   RowKey       reverse time + random, so a month lists newest first
//   at, email, co, area, action, target, detail, ok, status, ip, method, path

const crypto = require("crypto");

const SKIP_KEYS = new Set(["partitionKey", "rowKey", "etag", "timestamp", "odata.etag", "updatedAt", "updatedBy", "createdAt", "createdBy", "dataChunks", "acl", "files", "contacts",
  "reminderSentAt", "linkExpires", "signedAt", "alertsSent", "lastAlertAt", "proposalStatus", "proposalAt", "proposalStale", "proposalSource", "sentAt", "stageAt", "closedAt", "directCost", "netPct", "co", "company"]);
const LABELS = { contactName: "contact", poNo: "PO no.", poValue: "PO value", netProfit: "net profit", customerName: "customer", customerId: null, scheduledDate: "date",
  engineers: "engineer", trn: "TRN", amount: "amount", chequeNo: "cheque no.", clearanceDate: "clearance date", value: "value", status: "status", stage: "stage", title: "title", poRef: "PO ref", projectTitle: "project", completionDate: "completion date", preparedBy: "prepared by", docNo: "doc no." };

module.exports = function makeAudit(H) {
  const { table, fail, clean, CO } = H;
  const month = d => d.toISOString().slice(0, 7).replace("-", "");
  const short = v => { const s = typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v ?? ""); return s.length > 60 ? s.slice(0, 57) + "..." : s || "(blank)"; };

  // Field-by-field changes between two stored records (simple columns only), e.g. "PO value: 100,000 → 120,000".
  function diff(before, after) {
    const out = [];
    for (const k of Object.keys(after || {})) {
      if (SKIP_KEYS.has(k) || /^data\d+$/.test(k) || LABELS[k] === null) continue;
      const a = before ? before[k] : undefined, b = after[k];
      if (typeof b === "object" && b !== null) continue;
      if (String(a ?? "") === String(b ?? "")) continue;
      if (typeof b === "number" && Math.abs(Number(a || 0) - b) < 0.005) continue;
      out.push(`${LABELS[k] || k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${short(a)} → ${short(b)}`);
      if (out.length >= 10) break;
    }
    return out;
  }

  const KIND = { po: "customer PO", invoice: "supplier invoice", other: "document" };
  // Turns a request into words: area, action, target and detail.
  function describe(method, seg, body, out, aud) {
    const [a, b, c, d, e] = seg; body = body || {}; out = out || {}; aud = aud || {};
    const name = aud.name || "";
    const ch = (aud.changes || []).join("; ");
    if (a === "customers") {
      if (b === "import") return ["Customers", "Imported customers", "", `${out.added || 0} added, ${out.updated || 0} updated, ${(out.skipped || []).length + (out.invalid || []).length} skipped`];
      if (method === "POST") return ["Customers", "Added customer", out.name, ""];
      if (method === "PUT") return ["Customers", "Edited customer", out.name || name, ch];
      if (method === "DELETE") return ["Customers", "Deleted customer", name || b, ""];
    }
    if (a === "pnl") {
      const ref = out.id || b;
      if (c === "files") {
        if (method === "POST") return ["PnL Calculator", "Uploaded " + (KIND[body.kind] || "document"), clean(body.name, 200), `PnL ${b}${out.file && out.file.amount ? ", AED " + short(out.file.amount) : ""}`];
        if (method === "GET") return ["PnL Calculator", e === "download" ? "Downloaded document" : "Opened document", name, `PnL ${b}`];
        if (method === "PUT") return ["PnL Calculator", "Edited document details", name, `PnL ${b}${ch ? "; " + ch : ""}`];
        if (method === "DELETE") return ["PnL Calculator", "Deleted document", name, `PnL ${b}`];
      }
      if (c === "access") return ["PnL Calculator", "Changed who can see a PnL", b, Object.entries(body.access || body.acl || {}).map(([k, v]) => `${k}: ${v}`).join(", ") || "Shared with no one"];
      if (method === "POST") return ["PnL Calculator", "Created PnL", ref, [out.customerName, out.poNo, out.poValue ? "AED " + short(out.poValue) : ""].filter(Boolean).join(", ")];
      if (method === "PUT") return ["PnL Calculator", "Edited PnL", ref, ch || "Cost lines or allowances changed"];
      if (method === "DELETE") return ["PnL Calculator", "Deleted PnL", b, name];
    }
    if (a === "deals") {
      if (c === "notes") return ["Sales Pipeline", "Added a note", out.title || name || b, clean(body.text, 120)];
      if (method === "POST") return ["Sales Pipeline", "Created deal", out.title || out.customerName, [out.customerName, out.value ? "AED " + short(out.value) : ""].filter(Boolean).join(", ")];
      if (method === "PUT") return ["Sales Pipeline", "Edited deal", out.title || name || b, ch];
      if (method === "DELETE") return ["Sales Pipeline", "Deleted deal", name || b, ""];
    }
    if (a === "cheques") {
      const lbl = x => [x.type, x.chequeNo || x.ref, x.party || x.customerName].filter(Boolean).join(" ");
      if (method === "POST") return ["PDC & Guarantees", "Logged entry", lbl(out), out.amount ? "AED " + short(out.amount) : ""];
      if (method === "PUT") return ["PDC & Guarantees", "Edited entry", lbl(out) || name, ch];
      if (method === "DELETE") return ["PDC & Guarantees", "Deleted entry", name || b, ""];
    }
    if (a === "amc") {
      if (b === "amcs") {
        if (method === "POST" && !c) return ["AMC Tracker", "Created AMC", out.ref, [out.customerName, out.value ? "AED " + short(out.value) : ""].filter(Boolean).join(", ")];
        if (d === "award" || c && seg[3] === "award") return ["AMC Tracker", "Marked AMC awarded", name || c, [body.start && "start " + body.start, body.lpo && "LPO " + clean(body.lpo, 40)].filter(Boolean).join(", ")];
        if (seg[3] === "renew") return ["AMC Tracker", "Started AMC renewal", name || c, out.ref ? "New draft " + out.ref : ""];
        if (method === "PUT") return ["AMC Tracker", body.proposal ? "Saved proposal" : "Edited AMC", out.ref || name || c, ch];
        if (method === "DELETE") return ["AMC Tracker", "Deleted AMC", name || c, ""];
      }
      if (b === "visits") {
        if (method === "POST") return ["Maintenance visits", "Scheduled visit", out.ref || out.customerName, [out.customerName, out.scheduledDate].filter(Boolean).join(", ")];
        if (method === "PUT") return ["Maintenance visits", out.status === "completed" && (aud.changes || []).some(x => x.startsWith("status")) ? "Completed visit" : "Edited visit", out.reportNo || out.ref || name || c, ch];
        if (method === "DELETE") return ["Maintenance visits", "Deleted visit", name || c, ""];
      }
      if (b === "files") {
        if (method === "POST") return ["AMC Tracker", "Uploaded file", out.name || clean(body.name, 200), out.size ? Math.max(1, Math.round(out.size / 1024)) + " KB" : ""];
        if (method === "GET") return ["AMC Tracker", d === "download" ? "Downloaded file" : "Opened file", name || c, ""];
      }
      if (b === "share") return ["AMC Tracker", body.kind === "visit" ? "Emailed visit report" : "Emailed AMC proposal", name || clean(body.id, 60), "To " + [].concat(body.to || []).join(", ").slice(0, 200)];
      if (b === "ai") return ["AMC Tracker", body.kind === "visit" ? "Drafted visit findings with Claude" : "Drafted proposal with Claude", clean(body.customerName, 150), ""];
    }
    if (a === "mk") {
      const A = "Email Campaigns", det = aud.detail || "";
      if (b === "public-unsub") return [A, "Unsubscribed using the email link", name, body.campaign && body.campaign !== "-" ? "Campaign " + body.campaign : ""];
      if (b === "public-resub") return [A, "Re-subscribed on the unsubscribe page", name, ""];
      if (b === "contacts") {
        if (c === "import") return [A, "Imported contacts", clean(body.source, 120), `${out.added || 0} added, ${out.updated || 0} updated, ${(out.invalid || []).length} invalid, ${out.suppressed || 0} kept unsubscribed${(body.tags || []).length ? "; lists: " + [].concat(body.tags).join(", ") : ""}`];
        if (c === "bulk") return [A, { addTag: "Added contacts to a list", removeTag: "Removed contacts from a list", unsubscribe: "Unsubscribed contacts", delete: "Deleted contacts" }[body.action] || "Changed contacts", name, clean(body.tag, 40)];
        if (method === "POST") return [A, "Added contact", out.email, ""];
        if (method === "PUT") return [A, body.status === "subscribed" ? "Re-subscribed contact" : body.status === "unsubscribed" ? "Unsubscribed contact" : "Edited contact", name, clean(body.reason, 200)];
      }
      if (b === "campaigns") {
        const sub = d;
        if (!c && method === "POST") return [A, "Created campaign", out.name, out.id];
        if (sub === "test") return [A, "Sent a test email", name, det];
        if (sub === "duplicate") return [A, "Duplicated campaign", out.name, ""];
        if (sub === "schedule") return [A, "Scheduled campaign", name, det];
        if (sub === "unschedule") return [A, "Moved campaign back to draft", name, ""];
        if (sub === "pause") return [A, "Paused sending", name, ""];
        if (sub === "resume") return [A, "Resumed sending", name, ""];
        if (sub === "cancel") return [A, "Cancelled campaign", name, ""];
        if (method === "PUT") return [A, "Edited campaign", name || c, ""];
        if (method === "DELETE") return [A, "Deleted campaign", name || c, ""];
      }
      if (b === "templates") return [A, method === "DELETE" ? "Deleted saved design" : "Saved a design", name, ""];
      if (b === "media") return [A, method === "DELETE" ? "Deleted image" : "Uploaded image", name, ""];
      if (b === "settings") return [A, "Changed campaign settings", "", ""];
      if (b === "ai") return [A, "Drafted with Claude", name, ""];
    }
    if (a === "pcr") {
      const A = "Completion Reports";
      if (b === "public-sign") return [A, "Customer signed using the signing link", name, ""];
      if (b === "files") {
        if (method === "POST") return [A, "Uploaded picture", out.name || clean(body.name, 200), out.size ? Math.max(1, Math.round(out.size / 1024)) + " KB" : ""];
        if (method === "GET") return [A, d === "download" ? "Downloaded file" : "Opened file", name || c, ""];
      }
      if (b === "ai") return [A, "Drafted with Claude", name || clean(body.id, 60), { text: "report text", closeout: "testing, warranty and snags", diagram: "system diagram" }[aud.detail] || ""];
      if (b === "reports") {
        if (!c && method === "POST") return [A, "Created report", out.docNo, [out.customerName, out.poRef && "PO " + out.poRef].filter(Boolean).join(", ")];
        if (d === "sign") return [A, "Customer signed on site", name || c, [clean(body.name, 100), clean(body.designation, 100)].filter(Boolean).join(", ")];
        if (d === "company-sign") return [A, body.clear ? "Removed company signature" : "Signed for the company", name || c, ""];
        if (d === "reopen") return [A, "Reopened signed report", name || c, "Customer signature removed"];
        if (d === "link") return [A, method === "DELETE" ? "Cancelled signing link" : "Created customer signing link", name || c, ""];
        if (d === "share") return [A, "Emailed report", name || c, "To " + [].concat(body.to || []).join(", ").slice(0, 200)];
        if (method === "PUT") return [A, "Edited report", out.docNo || name || c, ch];
        if (method === "DELETE") return [A, "Deleted report", name || c, ""];
      }
    }
    if (a === "suppliers") {
      const A = "Suppliers & Vendors";
      if (b === "import") return [A, "Imported suppliers", "", `${out.added || 0} added, ${out.updated || 0} updated, ${out.contactsAdded || 0} contacts added, ${(out.skipped || []).length + (out.invalid || []).length} skipped`];
      if (method === "POST") return [A, "Added supplier", out.name, [out.kind, (out.contacts || []).length + " contact" + ((out.contacts || []).length === 1 ? "" : "s")].join(", ")];
      if (method === "PUT") return [A, "Edited supplier", out.name || name, ch];
      if (method === "DELETE") return [A, "Deleted supplier", name || b, ""];
    }
    if (a === "access") {
      if (b === "users" && method === "PUT") return ["Team access", "Changed access", c, (out.sections || []).join(", ") || "No sections"];
      if (b === "users" && method === "DELETE") return ["Team access", "Removed access", c, ""];
    }
    const AREA = { customers: "Customers", pnl: "PnL Calculator", deals: "Sales Pipeline", cheques: "PDC & Guarantees", amc: "AMC Tracker", mk: "Email Campaigns", pcr: "Completion Reports", suppliers: "Suppliers & Vendors", access: "Team access", alerts: "Alerts" };
    if (method === "GET") return [AREA[a] || "Other", b ? "Opened a record" : "Opened the list", b || "", ""];
    return [AREA[a] || "Other", method + " /" + seg.join("/"), "", ""];
  }

  async function write(entry) {
    try {
      const at = new Date();
      const pk = `${entry.co || "security"}-${month(at)}`;
      const rk = String(9e15 - at.getTime()).padStart(16, "0") + "-" + crypto.randomBytes(3).toString("hex");
      await (await table("audit")).createEntity({ partitionKey: pk, rowKey: rk, at: at.toISOString(), ...entry });
    } catch (e) { console.error("audit write failed", e.message); }
  }

  // Called by the API after every request it decides to record.
  function record({ user, email, co, method, seg, body, out, status, error, ip, aud }) {
    const ok = status < 400;
    let area, action, target, detail;
    if (seg[0] === "me") [area, action, target, detail] = ["Sign-in", aud && aud.noAccess ? "Signed in (no access yet)" : "Signed in", "", ""];
    else if (seg[0] === "outsider") [area, action, target, detail] = ["Sign-in", "Refused sign-in: account outside both companies", email, ""];
    else if (!ok) {
      const [a0, act] = describe(method, seg, body, out, aud);
      [area, action, target, detail] = [a0, status === 401 || status === 403 ? "Refused: " + act.toLowerCase() : "Failed: " + act.toLowerCase(), (aud && aud.name) || "", clean(error, 200)];
    } else [area, action, target, detail] = describe(method, seg, body, out, aud);
    return write({ email: email || (user && user.email) || "", co: co || (user && (user.co === "all" ? user.homeCo : user.co)) || "security",
      area: clean(area, 60), action: clean(action, 120), target: clean(target, 200), detail: clean(detail, 1000), ok, status,
      ip: clean(ip, 64), method, path: clean("/" + seg.join("/"), 200) });
  }

  // GET /api/audit/<yyyy-mm>: one month for the manager's company (managers only; group admins see both).
  async function list(user, ym) {
    if (!user.isManager) fail(403, "Only managers can see the activity log.");
    const m = /^\d{4}-\d{2}$/.test(ym || "") ? ym.replace("-", "") : month(new Date());
    const cos = user.co === "all" ? Object.keys(CO) : [user.co];
    const t = await table("audit");
    const rows = [];
    for (const co of cos.concat(["security"])) {
      for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${co}-${m}'` } })) {
        if (co === "security" && !String(e.email).length) continue;
        rows.push({ id: e.rowKey, at: e.at, email: e.email, co: co === "security" ? "" : e.co, area: e.area, action: e.action, target: e.target, detail: e.detail, ok: e.ok, ip: e.ip });
        if (rows.length >= 20000) break;
      }
    }
    rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return { month: m.slice(0, 4) + "-" + m.slice(4), rows };
  }

  return { record, list, diff };
};
