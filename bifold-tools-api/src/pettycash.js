// Petty cash (table "pettycash", files in Blob Storage "pettycash-files"). One set per company.
//
// Imprest floats: each person who holds cash (the custodian) has a float with a set amount (the imprest). They log
// what they spend, with the receipt; the spend counts against their float straight away (no approval step).
// Managers and people with full Books access ("admins" here) set up floats, top them up from the bank and take
// cash back, and post the entries into Books & VAT:
//   expense  -> Books "Expense" paid from the float's cash account, with the receipts attached (input VAT claimed
//               only when the receipt shows the supplier's TRN and number; otherwise the VAT is added to the cost)
//   top-up   -> Books "Transfer" from a bank account into the float's cash account
//   return   -> Books "Transfer" from the float's cash account back to a bank account
// Each float has its own Books cash account (for example 1001 Petty Cash: Khokan), so Books shows every custodian's
// cash. Once posted an entry is locked; to correct it, void the Books document and release the entry here.
//
// Storage (PartitionKey / RowKey):
//   fl-<co>   uuid   floats: name, custodian, account, limit, lowPct, status, opening, openingDate, notes, request (JSON)
//   tx-<co>   uuid   entries: floatId, kind (expense | topup | return | count), number, date, amount, ... books link
//   set-<co>  "ctr"  voucher counters
//
// Access: section "pettycash" lets a custodian see and log against their own floats. Admins see every float.

const crypto = require("crypto");
const { BlobServiceClient } = require("@azure/storage-blob");

const KINDS = { expense: "Expense", cashin: "Cash in", topup: "Top-up", return: "Cash returned", count: "Cash count" };
const IN_TYPES = ["income", "other_income", "current_liability", "equity"];
const invOf = s => { const m = /\bINV-?\d{2,4}-?\d{2,6}\b|\bINV-?\d{3,8}\b/i.exec(String(s || "")); return m ? m[0].toUpperCase() : ""; };
const METHODS = ["Cash withdrawal", "Bank transfer", "Cheque", "Cash from office"];
const CAT_TYPES = ["expense", "cogs", "other_expense", "fixed_asset", "current_asset"];
const FILE_MAX = 10 * 1048576, FILES_MAX = 10;

module.exports = function makePettyCash(H) {
  const { table, getOrNull, all, fail, clean, num, isDate, CO, sameCoEmail, books, diff } = H;
  const T = "pettycash";
  const r2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
  const j = (s, d) => { try { const v = JSON.parse(s || ""); return v == null ? d : v; } catch { return d; } };
  const today = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  const nowIso = () => new Date().toISOString();
  const coOf = user => { if (user.co === "all") fail(400, "Petty cash works one company at a time. Switch to Bifold or Tech Hub in the top bar."); return user.co; };
  const isAdmin = user => !!user.isManager || (user.sections || []).includes("books");
  const needAdmin = user => { if (!isAdmin(user)) fail(403, "Only managers and people with full Books access can do this."); };
  const trnOk = t => /^\d{15}$/.test(String(t || ""));
  const quietly = async (user, fn) => { const keep = user.aud; user.aud = {}; try { return await fn(); } finally { user.aud = keep; } };
  const fmt = n => "AED " + r2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ---------- loading ---------- */
  const floatOut = e => ({ id: e.rowKey, name: e.name, custodian: e.custodian, account: e.account, limit: num(e.limit), lowPct: e.lowPct == null ? 20 : num(e.lowPct),
    status: e.status || "active", opening: num(e.opening), openingDate: e.openingDate || "", notes: e.notes || "", request: j(e.request, null),
    createdBy: e.createdBy, createdAt: e.createdAt, updatedBy: e.updatedBy, updatedAt: e.updatedAt, etag: e.etag });
  const txOut = e => ({ id: e.rowKey, floatId: e.floatId, kind: e.kind, number: e.number || "", date: e.date, amount: num(e.amount),
    payee: e.payee || "", payeeTrn: e.payeeTrn || "", receiptNo: e.receiptNo || "", category: e.category || "", description: e.description || "",
    vatAmt: num(e.vatAmt), project: e.project || "", bankAccount: e.bankAccount || "", method: e.method || "", ref: e.ref || "",
    expected: num(e.expected), note: e.note || "", files: j(e.files, []), invoiceNo: e.invoiceNo || "",
    booksId: e.booksId || "", booksNo: e.booksNo || "", postedAt: e.postedAt || "", postedBy: e.postedBy || "", vatClaimed: !!e.vatClaimed,
    createdBy: e.createdBy, createdAt: e.createdAt, updatedBy: e.updatedBy, updatedAt: e.updatedAt, etag: e.etag });

  async function loadAll(co) {
    const t = await table(T);
    const [fl, tx] = await Promise.all([all(t, "fl-" + co), all(t, "tx-" + co)]);
    return { floats: fl.map(floatOut), entries: tx.map(txOut) };
  }
  // Cash in each float: opening + top-ups - expenses - cash returned. Cash counts don't move the balance.
  const effect = x => x.kind === "topup" || x.kind === "cashin" ? x.amount : x.kind === "expense" || x.kind === "return" ? -x.amount : 0;
  function withBalances(floats, entries) {
    return floats.map(f => {
      const mine = entries.filter(x => x.floatId === f.id);
      const bal = r2(f.opening + mine.reduce((a, x) => a + effect(x), 0));
      const spentM = r2(mine.filter(x => x.kind === "expense" && x.date.slice(0, 7) === today().slice(0, 7)).reduce((a, x) => a + x.amount, 0));
      const counts = mine.filter(x => x.kind === "count").sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
      return { ...f, balance: bal, spentThisMonth: spentM, unposted: mine.filter(x => x.kind !== "count" && !x.booksId).length,
        lastCount: counts[0] ? { date: counts[0].date, amount: counts[0].amount, diff: r2(counts[0].amount - counts[0].expected) } : null,
        low: f.status === "active" && f.limit > 0 && bal <= f.limit * f.lowPct / 100 };
    });
  }
  // What this person may see: admins every float; others only the floats they hold.
  function scope(user, D) {
    if (isAdmin(user)) return D;
    const floats = D.floats.filter(f => f.custodian === user.email);
    const ids = new Set(floats.map(f => f.id));
    return { floats, entries: D.entries.filter(x => ids.has(x.floatId)) };
  }
  async function info(co) { return books().pcInfo(co); }

  async function bootstrap(user) {
    const co = coOf(user);
    const [D0, bi] = await Promise.all([loadAll(co), info(co)]);
    const D = scope(user, D0);
    const acct = bi.accounts.filter(a => a.active);
    return {
      company: { key: co, name: CO[co].name }, me: user.email, admin: isAdmin(user), today: today(),
      floats: withBalances(D.floats, D0.entries).sort((a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1) || a.name.localeCompare(b.name)),
      entries: D.entries.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)),
      categories: acct.filter(a => CAT_TYPES.includes(a.type) && !["1400", "1200"].includes(a.code)).map(a => ({ code: a.code, name: a.name, type: a.type })),
      banks: acct.filter(a => a.type === "bank" || a.type === "cash").map(a => ({ code: a.code, name: a.name, type: a.type })),
      cashAccounts: acct.filter(a => a.type === "cash").map(a => ({ code: a.code, name: a.name, usedBy: (D0.floats.find(f => f.account === a.code && f.status === "active") || {}).name || "" })),
      incomeAccounts: acct.filter(a => IN_TYPES.includes(a.type)).map(a => ({ code: a.code, name: a.name, type: a.type })),
      invoices: D.entries.some(x => x.kind === "cashin") || isAdmin(user) ? (await books().pcInvoices(co).catch(() => [])).filter(i => i.balance > 0.004 || D.entries.some(x => x.invoiceNo === i.number)).map(i => ({ number: i.number, customer: i.contactName, total: i.total, balance: i.balance, date: i.date })) : [],
      vatRegistered: bi.vatRegistered, lockDate: bi.lockDate, cashVatThreshold: bi.cashVatThreshold, kinds: KINDS, methods: METHODS,
    };
  }

  /* ---------- floats ---------- */
  async function nextFreeCode(co) {
    const used = new Set((await info(co)).accounts.map(a => a.code));
    for (let c = 1001; c <= 1099; c++) if (c !== 1010 && !used.has(String(c))) return String(c);
    fail(400, "No free account code between 1001 and 1099. Choose an existing cash account instead.");
  }
  async function floatIn(user, co, b, cur) {
    const f = { name: clean(b.name, 80), custodian: clean(b.custodian, 150).toLowerCase(), limit: r2(Math.max(0, num(b.limit))), lowPct: Math.max(0, Math.min(90, Math.round(num(b.lowPct === undefined ? 20 : b.lowPct)))),
      notes: clean(b.notes, 1000), opening: r2(Math.max(0, num(b.opening))), openingDate: clean(b.openingDate, 10) };
    if (!f.custodian || !sameCoEmail(f.custodian, user)) fail(400, `Enter the work email of the person holding the cash (someone in ${CO[co].name}).`);
    if (!f.name) f.name = "Petty cash: " + f.custodian.split("@")[0].split(/[._-]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
    if (!(f.limit > 0) || f.limit > 1e7) fail(400, "Enter the float amount (the cash this person should hold when fully topped up).");
    if (f.opening && !isDate(f.openingDate)) fail(400, "Enter the date of the opening cash.");
    if (!f.opening) f.openingDate = "";
    // Books account: an existing cash account, or a new one made for this float.
    const bi = await info(co);
    let account = clean(b.account, 10) || (cur ? cur.account : "");
    if (cur && account === cur.account) return { ...f, account };
    if (account === "new" || !account) {
      account = await nextFreeCode(co);
      await quietly(user, () => books().route("POST", ["accounts"], user, { code: account, name: ("Petty Cash: " + f.name.replace(/^petty cash:?\s*/i, "")).slice(0, 100), type: "cash", description: `Petty cash float held by ${f.custodian}` }));
    } else {
      const a = bi.accounts.find(x => x.code === account);
      if (!a || a.type !== "cash") fail(400, "Choose a cash account from the chart of accounts, or let the tool create one.");
    }
    const clash = (await all(await table(T), "fl-" + co)).find(x => x.account === account && x.status !== "closed" && (!cur || x.rowKey !== cur.rowKey));
    if (clash) fail(409, `Account ${account} is already used by ${clash.name}. Each float needs its own cash account.`);
    return { ...f, account };
  }
  async function createFloat(user, b) {
    needAdmin(user); const co = coOf(user);
    const f = await floatIn(user, co, b);
    const e = { partitionKey: "fl-" + co, rowKey: crypto.randomUUID(), ...f, status: "active", request: "", createdBy: user.email, createdAt: nowIso(), updatedBy: user.email, updatedAt: nowIso() };
    await (await table(T)).createEntity(e);
    if (user.aud) { user.aud.name = f.name; user.aud.detail = `${f.custodian}, float ${fmt(f.limit)}, account ${f.account}`; }
    return floatOne(user, co, e.rowKey);
  }
  async function loadFloat(user, co, id) {
    const e = await getOrNull(await table(T), "fl-" + co, id);
    if (!e || (!isAdmin(user) && e.custodian !== user.email)) fail(404, "This float doesn't exist or isn't yours.");
    return e;
  }
  async function floatOne(user, co, id) {
    const D = await loadAll(co);
    const f = D.floats.find(x => x.id === id); if (!f) fail(404, "This float doesn't exist.");
    return withBalances([f], D.entries)[0];
  }
  async function updateFloat(user, id, b) {
    needAdmin(user); const co = coOf(user);
    const cur = await loadFloat(user, co, id);
    if (cur.status === "closed") fail(400, "This float is closed. Reopen it first.");
    const f = await floatIn(user, co, b, floatOut(cur));
    const next = { partitionKey: "fl-" + co, rowKey: id, ...f, updatedBy: user.email, updatedAt: nowIso() };
    if (cur.account !== f.account && (await all(await table(T), "tx-" + co)).some(x => x.floatId === id && x.booksId)) fail(400, "Entries from this float are already in Books under its cash account, so the account can't change.");
    if (user.aud) { user.aud.name = cur.name; user.aud.changes = diff(cur, next); }
    try { await (await table(T)).updateEntity(next, "Merge", { etag: b.etag || cur.etag }); }
    catch (err) { if (err.statusCode === 412) fail(409, "Someone else changed this float after you opened it. Reload and try again."); throw err; }
    return floatOne(user, co, id);
  }
  async function setFloatStatus(user, id, b) {
    needAdmin(user); const co = coOf(user);
    const cur = await loadFloat(user, co, id);
    const f = await floatOne(user, co, id);
    const st = b.status === "closed" ? "closed" : "active";
    if (user.aud) { user.aud.name = cur.name; user.aud.detail = st; }
    if (st === "closed" && Math.abs(f.balance) > 0.004) fail(400, `${cur.name} still holds ${fmt(f.balance)}. Record the cash returned (or the last expenses) so the balance is zero, then close it.`);
    if (st === "closed" && f.unposted) fail(400, `${f.unposted} entr${f.unposted === 1 ? "y is" : "ies are"} not in Books yet. Post them before closing the float.`);
    if (st === "active" && cur.status === "closed") { const clash = (await all(await table(T), "fl-" + co)).find(x => x.account === cur.account && x.status !== "closed" && x.rowKey !== id); if (clash) fail(409, `Account ${cur.account} is now used by ${clash.name}.`); }
    await (await table(T)).updateEntity({ partitionKey: "fl-" + co, rowKey: id, status: st, updatedBy: user.email, updatedAt: nowIso() }, "Merge");
    return floatOne(user, co, id);
  }
  // A custodian asks for cash; admins see it in their alerts until the top-up is recorded.
  async function requestTopup(user, id, b) {
    const co = coOf(user);
    const cur = await loadFloat(user, co, id);
    if (cur.status !== "active") fail(400, "This float is closed.");
    if (cur.custodian !== user.email && !isAdmin(user)) fail(403, "Only the person holding this float can ask for a top-up.");
    const req = b.cancel ? "" : JSON.stringify({ amount: r2(Math.max(0, num(b.amount))), note: clean(b.note, 300), by: user.email, at: nowIso() });
    if (!b.cancel && !(num(b.amount) > 0)) fail(400, "Enter the amount you need.");
    await (await table(T)).updateEntity({ partitionKey: "fl-" + co, rowKey: id, request: req }, "Merge");
    if (user.aud) { user.aud.name = cur.name; user.aud.detail = b.cancel ? "cancelled" : fmt(b.amount); }
    return floatOne(user, co, id);
  }

  /* ---------- entries ---------- */
  const numberFor = (co, kind) => kind === "expense" ? nextNo(co, "PCV") : kind === "cashin" ? nextNo(co, "PCI") : kind === "count" ? "" : nextNo(co, "PCT");
  async function nextNo(co, prefix) {
    const t = await table(T);
    for (let i = 0; i < 8; i++) {
      const cur = await getOrNull(t, "set-" + co, "ctr");
      const c = j(cur && cur.counters, {}); const n = (num(c[prefix]) || 0) + 1; c[prefix] = n;
      try {
        if (cur) await t.updateEntity({ partitionKey: "set-" + co, rowKey: "ctr", counters: JSON.stringify(c) }, "Merge", { etag: cur.etag });
        else await t.createEntity({ partitionKey: "set-" + co, rowKey: "ctr", counters: JSON.stringify(c) });
        return prefix + "-" + String(n).padStart(5, "0");
      } catch (err) { if (err.statusCode !== 412 && err.statusCode !== 409) throw err; }
    }
    fail(409, "Couldn't take the next voucher number. Try again.");
  }
  // Splits a receipt into the part VAT was charged on and the rest, so Books' 5% works out to the VAT on the receipt.
  function vatSplit(amount, vatAmt) {
    if (!(vatAmt > 0)) return { taxable: 0, other: amount };
    let n = r2(vatAmt / 0.05);
    for (const d of [0, -0.01, 0.01, -0.02, 0.02]) { if (r2(r2(n + d) * 0.05) === vatAmt) { n = r2(n + d); break; } }
    const other = r2(amount - n - vatAmt);
    if (other < -0.05) fail(400, `The VAT (${fmt(vatAmt)}) is more than 5% of the amount paid. Check the receipt: enter the total paid including VAT, and the VAT shown on it.`);
    return { taxable: other < 0 ? r2(n + other) : n, other: Math.max(0, other) };
  }
  async function entryIn(user, co, b, cur, floats) {
    const kind = cur ? cur.kind : String(b.kind || "");
    if (!KINDS[kind]) fail(400, "Unknown entry type.");
    if ((kind === "topup" || kind === "return") && !isAdmin(user)) fail(403, "Only managers and people with full Books access record top-ups and cash returned. Use Request top-up instead.");
    const fl = floats.find(f => f.rowKey === clean(b.floatId, 60));
    if (!fl) fail(400, "Choose the petty cash float.");
    if (!isAdmin(user) && fl.custodian !== user.email) fail(403, "You can only log against a float you hold.");
    if (fl.status !== "active") fail(400, `${fl.name} is closed.`);
    const date = clean(b.date, 10) || today();
    if (!isDate(date)) fail(400, "The date is not valid.");
    if (date > today()) fail(400, "The date can't be in the future.");
    if (fl.openingDate && date < fl.openingDate) fail(400, `This float started on ${fl.openingDate}. Use a date on or after that.`);
    const f = { kind, floatId: fl.rowKey, date, amount: r2(num(b.amount)), note: clean(b.note, 1000) };
    if (kind === "count") { if (!(f.amount >= 0) || b.amount === "" || b.amount == null) fail(400, "Enter the cash you counted."); }
    else if (!(f.amount > 0) || f.amount > 1e6) fail(400, "Enter the amount.");
    if (kind === "expense") {
      Object.assign(f, { payee: clean(b.payee, 150), receiptNo: clean(b.receiptNo, 60), category: clean(b.category, 10), description: clean(b.description, 500),
        vatAmt: r2(Math.max(0, num(b.vatAmt))), payeeTrn: clean(b.payeeTrn, 20).replace(/\s+/g, ""), project: clean(b.project, 150) });
      if (!f.description) fail(400, "Say what the money was spent on.");
      if (f.category) { const cat = (await info(co)).accounts.find(a => a.code === f.category && CAT_TYPES.includes(a.type)); if (!cat) fail(400, "Choose the expense category."); }
      if (f.vatAmt) vatSplit(f.amount, f.vatAmt);
      if (f.payeeTrn && !trnOk(f.payeeTrn)) fail(400, "A TRN is 15 digits. Check the receipt, or leave it blank.");
    }
    if (kind === "cashin") {
      Object.assign(f, { description: clean(b.description, 500), category: clean(b.category, 10), project: clean(b.project, 150) });
      f.invoiceNo = clean(b.invoiceNo, 40).toUpperCase() || invOf(f.description);
      if (!f.description) fail(400, "Say where the cash came from (for example: Cash sales INV-2026-00068).");
      if (f.category) { const a = (await info(co)).accounts.find(x => x.code === f.category && IN_TYPES.includes(x.type)); if (!a) fail(400, "Choose an income account."); }
    }
    if (kind === "topup" || kind === "return") {
      Object.assign(f, { bankAccount: clean(b.bankAccount, 10), method: METHODS.includes(b.method) ? b.method : METHODS[0], ref: clean(b.ref, 80) });
      const a = (await info(co)).accounts.find(x => x.code === f.bankAccount);
      if (!a || !["bank", "cash"].includes(a.type) || f.bankAccount === fl.account) fail(400, kind === "topup" ? "Choose the bank or cash account the money came from." : "Choose the bank or cash account the money went back to.");
    }
    return { f, fl };
  }
  async function balanceOf(co, floatId, exceptId) {
    const D = await loadAll(co);
    const f = D.floats.find(x => x.id === floatId);
    return r2(f.opening + D.entries.filter(x => x.floatId === floatId && x.id !== exceptId).reduce((a, x) => a + effect(x), 0));
  }
  async function createEntry(user, b) {
    const co = coOf(user); const t = await table(T);
    const floats = await all(t, "fl-" + co);
    const { f, fl } = await entryIn(user, co, b, null, floats);
    const bal = await balanceOf(co, fl.rowKey);
    // Spending may take the book below zero for a while (cash sales logged later, as in a paper cash book); cash can't be returned beyond what is there.
    if (f.kind === "return" && f.amount > bal + 0.004) fail(400, `${fl.name} only holds ${fmt(bal)}. Check the amount.`);
    if (f.kind === "count") f.expected = bal;
    f.number = await numberFor(co, f.kind);
    const files = [];
    const e = { partitionKey: "tx-" + co, rowKey: crypto.randomUUID(), ...f, files: "[]", booksId: "", booksNo: "", createdBy: user.email, createdAt: nowIso(), updatedBy: user.email, updatedAt: nowIso() };
    await t.createEntity(e);
    // Receipts sent with the entry.
    for (const x of (Array.isArray(b.files) ? b.files : []).slice(0, FILES_MAX)) files.push(await putFile(co, e.rowKey, x, user));
    if (files.length) await t.updateEntity({ partitionKey: "tx-" + co, rowKey: e.rowKey, files: JSON.stringify(files) }, "Merge");
    // A top-up answers the custodian's request.
    if (f.kind === "topup" && fl.request) await t.updateEntity({ partitionKey: "fl-" + co, rowKey: fl.rowKey, request: "" }, "Merge");
    if (user.aud) { user.aud.name = [f.number, fl.name].filter(Boolean).join(" "); user.aud.detail = [fmt(f.amount), f.payee, f.description].filter(Boolean).join(", "); }
    const out = txOut(await t.getEntity("tx-" + co, e.rowKey));
    if (b.post && isAdmin(user) && f.kind !== "count") { try { return { ...(await postOne(user, co, out.id)), posted: true }; } catch (err) { return { ...out, postError: err.message }; } }
    return out;
  }
  // Simple cash-book posting: many rows of date, description, amount in or out, saved together (for example pasted from
  // Excel). The book may dip below zero part-way through the period, but the float can't end up below zero.
  async function bulkCreate(user, b) {
    const co = coOf(user); const t = await table(T);
    const floats = await all(t, "fl-" + co);
    const fl = floats.find(f => f.rowKey === clean(b.floatId, 60));
    if (!fl) fail(400, "Choose the petty cash float.");
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 500);
    if (!rows.length) fail(400, "There are no rows to save.");
    const opening = r2(num(b.opening));
    const D = await loadAll(co);
    const hasEntries = D.entries.some(x => x.floatId === fl.rowKey);
    if (opening) {
      if (!isAdmin(user)) fail(403, "Only managers and full Books users can set the opening cash. Leave out the cash-in-hand row, or ask them.");
      if (hasEntries || num(fl.opening)) fail(400, "This float already has entries, so the opening cash can't be set. Remove the cash-in-hand row.");
      if (!isDate(b.openingDate)) fail(400, "Enter the date of the opening cash.");
    }
    const out = [];
    for (const [i, r] of rows.entries()) {
      const inA = r2(num(r.in)), outA = r2(num(r.out));
      if ((inA > 0) === (outA > 0)) fail(400, `Row ${i + 1} (${clean(r.description, 60) || "no description"}): enter an amount in or an amount out, not both.`);
      try {
        const kind = r.kind === "topup" && inA > 0 ? "topup" : inA > 0 ? "cashin" : "expense";
        const { f } = await entryIn(user, co, { kind, floatId: fl.rowKey, date: r.date, amount: inA || outA, description: r.description, category: r.category, note: r.note || (kind === "topup" ? r.description : ""), bankAccount: r.bankAccount, method: "Cash from office" }, null, floats.map(x => x.rowKey === fl.rowKey && opening ? { ...x, openingDate: "" } : x));
        out.push(f);
      } catch (err) { fail(err.status || 400, `Row ${i + 1} (${clean(r.description, 60) || "no description"}): ${err.message}`); }
    }
    const start = opening || r2(num(fl.opening) + D.entries.filter(x => x.floatId === fl.rowKey).reduce((a, x) => a + effect(x), 0));
    const end = r2(start + out.reduce((a, f) => a + (f.kind === "cashin" ? f.amount : -f.amount), 0));
    if (opening) await t.updateEntity({ partitionKey: "fl-" + co, rowKey: fl.rowKey, opening, openingDate: b.openingDate, updatedBy: user.email, updatedAt: nowIso() }, "Merge");
    out.sort((a, c) => a.date.localeCompare(c.date) || (a.kind === "topup" ? -1 : c.kind === "topup" ? 1 : 0));
    const made = [];
    for (const f of out) {
      f.number = await numberFor(co, f.kind);
      const e = { partitionKey: "tx-" + co, rowKey: crypto.randomUUID(), ...f, files: "[]", booksId: "", booksNo: "", createdBy: user.email, createdAt: nowIso(), updatedBy: user.email, updatedAt: nowIso() };
      await t.createEntity(e); made.push(e.rowKey);
    }
    if (user.aud) { user.aud.name = `${made.length} row${made.length === 1 ? "" : "s"} into ${fl.name}`; user.aud.detail = `${out.filter(f => f.kind !== "expense").length} in, ${out.filter(f => f.kind === "expense").length} out${opening ? `, opening cash ${fmt(opening)}` : ""}`; }
    return { count: made.length, ids: made };
  }
  async function loadEntry(user, co, id) {
    const e = await getOrNull(await table(T), "tx-" + co, id);
    if (!e) fail(404, "This entry no longer exists.");
    if (!isAdmin(user)) { const fl = await getOrNull(await table(T), "fl-" + co, e.floatId); if (!fl || fl.custodian !== user.email) fail(404, "This entry no longer exists."); }
    return e;
  }
  const lockedMsg = e => `${e.number || "This entry"} is in Books as ${e.booksNo}, so it can't change here. To correct it, void ${e.booksNo} in Books, then release the entry.`;
  async function updateEntry(user, id, b) {
    const co = coOf(user); const t = await table(T);
    const cur = await loadEntry(user, co, id);
    if (cur.booksId) fail(400, lockedMsg(cur));
    if (!isAdmin(user) && cur.createdBy !== user.email) fail(403, "Only the person who logged this or a manager can change it.");
    const floats = await all(t, "fl-" + co);
    const { f, fl } = await entryIn(user, co, { ...b, floatId: b.floatId || cur.floatId }, cur, floats);
    const bal = await balanceOf(co, fl.rowKey, id);
    if (f.kind === "return" && f.amount > bal + 0.004) fail(400, `${fl.name} only holds ${fmt(bal)} without this entry. Check the amount.`);
    if (f.kind === "count") f.expected = bal;
    const next = { partitionKey: "tx-" + co, rowKey: id, ...f, updatedBy: user.email, updatedAt: nowIso() };
    if (user.aud) { user.aud.name = cur.number || KINDS[cur.kind]; user.aud.changes = diff(cur, next); }
    try { await t.updateEntity(next, "Merge", { etag: b.etag || cur.etag }); }
    catch (err) { if (err.statusCode === 412) fail(409, "Someone else changed this entry after you opened it. Reload and try again."); throw err; }
    return txOut(await t.getEntity("tx-" + co, id));
  }
  async function deleteEntry(user, id) {
    const co = coOf(user); const t = await table(T);
    const cur = await loadEntry(user, co, id);
    if (user.aud) { user.aud.name = cur.number || KINDS[cur.kind]; user.aud.detail = [fmt(cur.amount), cur.payee, cur.description].filter(Boolean).join(", "); }
    if (cur.booksId) fail(400, lockedMsg(cur));
    if (!isAdmin(user) && cur.createdBy !== user.email) fail(403, "Only the person who logged this or a manager can delete it.");
    await t.deleteEntity("tx-" + co, id);
    const c = await blobs(); await Promise.all(j(cur.files, []).map(x => c.deleteBlob(x.id).catch(() => {})));
  }

  /* ---------- receipts ---------- */
  let container;
  async function blobs() {
    if (!container) {
      const cs = process.env.STORAGE_CONNECTION; if (!cs) fail(500, "Storage is not set up yet.");
      container = BlobServiceClient.fromConnectionString(cs).getContainerClient("pettycash-files");
      await container.createIfNotExists();
    }
    return container;
  }
  async function putFile(co, txId, x, user) {
    const name = clean(x && x.name, 200) || "receipt"; const type = clean(x && x.type, 120) || "application/octet-stream";
    if (!/^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf)$/.test(type)) fail(400, `${name}: attach a photo or a PDF of the receipt.`);
    const buf = Buffer.from(String((x && x.data) || ""), "base64");
    if (!buf.length) fail(400, `${name} is empty.`);
    if (buf.length > FILE_MAX) fail(413, `${name} is larger than 10 MB.`);
    const id = crypto.randomUUID();
    await (await blobs()).getBlockBlobClient(id).uploadData(buf, { blobHTTPHeaders: { blobContentType: type }, metadata: { co, tx: txId } });
    return { id, name, type, size: buf.length, by: user.email, at: nowIso() };
  }
  async function addFile(user, id, b) {
    const co = coOf(user); const t = await table(T);
    const cur = await loadEntry(user, co, id);
    if (cur.booksId) fail(400, `${cur.number} is already in Books. Add the file to ${cur.booksNo} in Books instead.`);
    const files = j(cur.files, []);
    if (files.length >= FILES_MAX) fail(400, `An entry can hold at most ${FILES_MAX} files.`);
    const f = await putFile(co, id, b, user);
    if (user.aud) { user.aud.name = f.name; user.aud.detail = cur.number; }
    await t.updateEntity({ partitionKey: "tx-" + co, rowKey: id, files: JSON.stringify(files.concat(f)) }, "Merge");
    return txOut(await t.getEntity("tx-" + co, id));
  }
  async function removeFile(user, id, fid) {
    const co = coOf(user); const t = await table(T);
    const cur = await loadEntry(user, co, id);
    if (cur.booksId) fail(400, lockedMsg(cur));
    const files = j(cur.files, []); const f = files.find(x => x.id === fid);
    if (!f) fail(404, "That file is no longer attached.");
    if (user.aud) { user.aud.name = f.name; user.aud.detail = cur.number; }
    if (!isAdmin(user) && f.by !== user.email) fail(403, "Only the person who attached this file or a manager can remove it.");
    await t.updateEntity({ partitionKey: "tx-" + co, rowKey: id, files: JSON.stringify(files.filter(x => x.id !== fid)) }, "Merge");
    await (await blobs()).deleteBlob(fid).catch(() => {});
    return txOut(await t.getEntity("tx-" + co, id));
  }
  async function getFile(user, id, fid, download) {
    const co = coOf(user);
    const cur = await loadEntry(user, co, id);
    const f = j(cur.files, []).find(x => x.id === fid);
    if (!f) fail(404, "That file is no longer attached.");
    if (user.aud) { user.aud.name = f.name; user.aud.detail = cur.number; }
    let buf; try { buf = await (await blobs()).getBlockBlobClient(fid).downloadToBuffer(); } catch (err) { if (err.statusCode === 404) fail(404, "That file is no longer available."); throw err; }
    const inline = !download && /^(image\/|application\/pdf$)/.test(f.type);
    return { __binary: buf, headers: { "Content-Type": inline ? f.type : "application/octet-stream", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } };
  }

  /* ---------- posting to Books ---------- */
  async function postOne(user, co, id) {
    needAdmin(user);
    const t = await table(T);
    const e = await getOrNull(t, "tx-" + co, id);
    if (!e) fail(404, "This entry no longer exists.");
    if (e.booksId) return txOut(e);
    if (e.kind === "count") fail(400, "Cash counts aren't posted to Books.");
    const fl = await getOrNull(t, "fl-" + co, e.floatId);
    if (!fl) fail(400, "The float for this entry no longer exists.");
    const x = txOut(e), bi = await info(co);
    const notes = `Petty cash ${x.number}, ${fl.name} (held by ${fl.custodian}). Logged by ${x.createdBy}.${x.project ? " Project / customer: " + x.project + "." : ""}${x.note ? " " + x.note : ""}`.slice(0, 3000);
    let body, claimed = false;
    if (x.kind === "expense" && !x.category) fail(400, `Choose the Books category for ${x.number} (${x.description}).`);
    if (x.kind === "cashin") {
      const inv = x.invoiceNo ? (await books().pcInvoices(co)).find(i => i.number.toUpperCase() === x.invoiceNo) : null;
      if (x.invoiceNo && !inv) fail(400, `${x.invoiceNo} isn't an issued invoice in Books. Correct the invoice number, or clear it and choose an income account.`);
      if (inv) {
        const amt = Math.min(x.amount, Math.max(0, inv.balance));
        body = { type: "receipt", date: x.date, contactId: inv.contactId, amount: x.amount, account: fl.account, method: "Cash", bankRef: x.number, notes, allocs: amt > 0.004 ? [{ id: inv.id, amt: r2(amt) }] : [] };
      } else if (x.category) body = { type: "journal", date: x.date, notes: `Cash received into petty cash: ${x.description}. ${notes}`.slice(0, 3000), lines: [{ account: fl.account, debit: x.amount, memo: x.description.slice(0, 200) }, { account: x.category, credit: x.amount, memo: x.description.slice(0, 200) }] };
      else fail(400, `${x.number} (${x.description}): enter the Books invoice number it pays, or choose an income account.`);
    } else if (x.kind === "expense") {
      const lines = [];
      if (x.vatAmt > 0 && bi.vatRegistered) {
        const { taxable, other } = vatSplit(x.amount, x.vatAmt);
        claimed = trnOk(x.payeeTrn) && !!x.receiptNo;
        lines.push({ name: x.description, qty: 1, rate: taxable, vat: "SR", account: x.category, blocked: !claimed });
        if (other > 0.004) lines.push({ name: x.description + " (no VAT)", qty: 1, rate: other, vat: "OS", account: x.category });
      } else lines.push({ name: x.description, qty: 1, rate: x.amount, vat: "OS", account: x.category });
      body = { type: "expense", date: x.date, account: fl.account, payee: x.payee || x.description.slice(0, 150), payeeTrn: claimed ? x.payeeTrn : "", ref: x.receiptNo || x.number, notes, lines };
    } else if (x.kind === "topup") body = { type: "transfer", date: x.date, amount: x.amount, account: x.bankAccount, toAccount: fl.account, ref: x.ref || x.number, notes: `${x.method} to ${notes}` };
    else body = { type: "transfer", date: x.date, amount: x.amount, account: fl.account, toAccount: x.bankAccount, ref: x.ref || x.number, notes: `Cash returned: ${notes}` };
    // Claim the entry first, so two people posting at once can't make two Books documents.
    try { await t.updateEntity({ partitionKey: "tx-" + co, rowKey: id, booksId: "pending", postedBy: user.email, postedAt: nowIso() }, "Merge", { etag: e.etag }); }
    catch (err) { if (err.statusCode === 412) fail(409, `${x.number} changed or is being posted by someone else. Reload and try again.`); throw err; }
    let doc;
    try { doc = await quietly(user, () => books().route("POST", ["docs"], user, body)); }
    catch (err) { await t.updateEntity({ partitionKey: "tx-" + co, rowKey: id, booksId: "", postedBy: "", postedAt: "" }, "Merge").catch(() => {}); throw err; }
    // Books may have added the VAT to the cost (cash payments above the threshold).
    if (claimed && doc.cashBlocked) claimed = false;
    await t.updateEntity({ partitionKey: "tx-" + co, rowKey: id, booksId: doc.id, booksNo: doc.number || "", vatClaimed: claimed }, "Merge");
    // Receipts go with the Books document, which is the tax record.
    if (x.kind === "expense" && x.files.length) {
      const c = await blobs();
      for (const f of x.files) {
        try { const buf = await c.getBlockBlobClient(f.id).downloadToBuffer(); await quietly(user, () => books().route("POST", ["docs", doc.id, "files"], user, { kind: "receipt", name: f.name, type: f.type, data: buf.toString("base64") })); }
        catch { /* the receipt stays here; the Books document notes the voucher number */ }
      }
    }
    return txOut(await t.getEntity("tx-" + co, id));
  }
  async function post(user, b) {
    needAdmin(user); const co = coOf(user);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(x => clean(x, 60)).filter(Boolean).slice(0, 200);
    if (!ids.length) fail(400, "Choose the entries to post.");
    // Categories, income accounts and invoice numbers chosen in the posting window.
    const asg = b.assign && typeof b.assign === "object" ? b.assign : {};
    const t = await table(T), bi = await info(co);
    for (const id of ids) {
      const v = asg[id]; if (!v || typeof v !== "object") continue;
      const e = await getOrNull(t, "tx-" + co, id); if (!e || e.booksId) continue;
      const upd = {};
      if (v.category !== undefined) {
        const c = clean(v.category, 10), a = bi.accounts.find(x => x.code === c);
        if (c && (!a || !(e.kind === "cashin" ? IN_TYPES : CAT_TYPES).includes(a.type))) fail(400, `${e.number}: choose a valid account.`);
        upd.category = c;
      }
      if (v.invoiceNo !== undefined && e.kind === "cashin") upd.invoiceNo = clean(v.invoiceNo, 40).toUpperCase();
      if (Object.keys(upd).length) await t.updateEntity({ partitionKey: "tx-" + co, rowKey: id, ...upd, updatedBy: user.email, updatedAt: nowIso() }, "Merge");
    }
    const D = await loadAll(co);
    // Oldest first, top-ups before expenses on the same day, so the cash account never dips below zero in Books.
    const order = { topup: 0, cashin: 1, expense: 2, return: 3 };
    const list = D.entries.filter(x => ids.includes(x.id) && !x.booksId && x.kind !== "count").sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || a.createdAt.localeCompare(b.createdAt));
    const done = [], failed = [];
    for (const x of list) {
      try { const r = await postOne(user, co, x.id); done.push({ id: x.id, number: x.number, booksNo: r.booksNo }); }
      catch (err) { failed.push({ id: x.id, number: x.number, reason: err.message }); }
    }
    if (user.aud) { user.aud.name = `${done.length} entr${done.length === 1 ? "y" : "ies"}`; user.aud.detail = [done.map(d => `${d.number} as ${d.booksNo}`).join(", "), failed.length ? `${failed.length} failed` : ""].filter(Boolean).join("; ").slice(0, 900); }
    return { done, failed };
  }
  // After the Books document is voided, the entry can be changed and posted again.
  async function release(user, id) {
    needAdmin(user); const co = coOf(user); const t = await table(T);
    const e = await loadEntry(user, co, id);
    if (!e.booksId) return txOut(e);
    if (user.aud) { user.aud.name = e.number; user.aud.detail = e.booksNo; }
    const st = e.booksId === "pending" ? (Date.now() - Date.parse(e.postedAt || 0) > 5 * 60e3 ? null : "pending") : await books().docStatus(co, e.booksId);
    if (st === "pending") fail(409, `${e.number} is being posted right now. Wait a minute and reload.`);
    if (st && st !== "void") fail(400, `${e.booksNo} is still posted in Books. Void it in Books first (that keeps the record the FTA requires), then release this entry.`);
    await t.updateEntity({ partitionKey: "tx-" + co, rowKey: id, booksId: "", booksNo: "", postedAt: "", postedBy: "", vatClaimed: false }, "Merge");
    return txOut(await t.getEntity("tx-" + co, id));
  }

  /* ---------- alerts ---------- */
  async function alerts(user) {
    if (user.co === "all") return [];
    const co = user.co;
    let D; try { D = await loadAll(co); } catch { return []; }
    const admin = isAdmin(user), out = [];
    const fl = withBalances(D.floats.filter(f => f.status === "active"), D.entries);
    fl.filter(f => f.low && (admin || f.custodian === user.email)).forEach(f => out.push({ tool: "pettycash", severity: f.balance <= 0 ? "high" : "medium", when: today(), href: "/pettycash/#/float/" + f.id,
      title: `Petty cash low: ${f.name}`, text: `${fmt(f.balance)} left of ${fmt(f.limit)}${f.request ? " · top-up requested" : ""}` }));
    if (admin) {
      fl.filter(f => f.request && !f.low).forEach(f => out.push({ tool: "pettycash", severity: "medium", when: f.request.at.slice(0, 10), href: "/pettycash/#/float/" + f.id,
        title: `Top-up requested: ${f.name}`, text: `${fmt(f.request.amount)}${f.request.note ? " · " + f.request.note : ""}` }));
      const old = D.entries.filter(x => x.kind !== "count" && !x.booksId && x.date <= new Date(Date.parse(today()) - 7 * 864e5).toISOString().slice(0, 10));
      if (old.length) out.push({ tool: "pettycash", severity: "low", when: old.map(x => x.date).sort()[0], href: "/pettycash/#/entries?show=unposted",
        title: `${old.length} petty cash entr${old.length === 1 ? "y" : "ies"} not in Books`, text: "Logged over a week ago. Post them to Books." });
    }
    const mine = new Set(D.floats.filter(f => f.custodian === user.email).map(f => f.id));
    const noRcpt = D.entries.filter(x => x.kind === "expense" && !x.booksId && !x.files.length && mine.has(x.floatId));
    if (noRcpt.length) out.push({ tool: "pettycash", severity: "low", when: noRcpt.map(x => x.date).sort()[0], href: "/pettycash/#/entries?show=noreceipt",
      title: `${noRcpt.length} petty cash expense${noRcpt.length === 1 ? "" : "s"} without a receipt`, text: "Attach a photo of the receipt." });
    return out;
  }

  async function route(method, seg, user, body) {
    const [a, id, sub, fid] = seg;
    if (a === "bootstrap" && method === "GET") return bootstrap(user);
    if (a === "floats") {
      if (!id && method === "POST") return createFloat(user, body);
      if (id && !sub && method === "PUT") return updateFloat(user, id, body);
      if (id && sub === "status" && method === "PUT") return setFloatStatus(user, id, body);
      if (id && sub === "request" && method === "PUT") return requestTopup(user, id, body);
    }
    if (a === "entries") {
      if (!id && method === "POST") return createEntry(user, body);
      if (id === "bulk" && !sub && method === "POST") return bulkCreate(user, body);
      if (id && !sub && method === "PUT") return updateEntry(user, id, body);
      if (id && !sub && method === "DELETE") return deleteEntry(user, id);
      if (id && sub === "release" && method === "POST") return release(user, id);
      if (id && sub === "files") {
        if (!fid && method === "POST") return addFile(user, id, body);
        if (fid && method === "GET") return getFile(user, id, fid, seg[4] === "download");
        if (fid && method === "DELETE") return removeFile(user, id, fid);
      }
    }
    if (a === "post" && method === "POST") return post(user, body);
    fail(404, "Unknown request.");
  }
  return { route, alerts, KINDS };
};
