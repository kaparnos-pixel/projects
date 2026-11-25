// Targets & Commission (single-page app; the API is /api/sales/*).
// Performance against monthly / quarterly / yearly targets, invoice credit, commission statements and plans.
(function () {
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const r2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const aed = (n, d = 0) => (num(n) < 0 ? "-" : "") + Math.abs(num(n)).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const aedK = n => { const a = Math.abs(n); return (n < 0 ? "-" : "") + (a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M" : a >= 1e4 ? Math.round(a / 1e3) + "K" : aed(a)); };
const fd = d => d ? new Date(String(d).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const monthName = ym => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const addMonths = (ym, n) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
const pctOf = (a, t) => t > 0 ? Math.round(a / t * 1000) / 10 : null;
const cls = p => p == null ? "" : p >= 100 ? "good" : p >= 70 ? "" : p >= 50 ? "warn" : "bad";
const SRC = { deal: "From deal", account: "Account manager", manual: "Assigned", house: "House account", none: "Needs a salesperson" };
const COST = { items: "Item prices", manual: "Entered", missing: "Cost needed" };

let B = null, PERF = null, PEOPLE = null;
const st = { year: null, period: "q", m: null, q: null, credFilter: "attention", credQ: "" };

/* ---------- plumbing ---------- */
function toast(m, e) { const t = document.createElement("div"); t.className = "toast" + (e ? " err" : ""); t.setAttribute("role", "status"); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), e ? 7000 : 2600); }
async function api(method, path, body) {
  let r; try { r = await fetch("/api/" + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, cache: "no-store" }); }
  catch { throw new Error("Can't reach the server. Check your connection and try again."); }
  const ct = r.headers.get("content-type") || "";
  if (r.redirected || (r.ok && r.status !== 204 && !ct.includes("json"))) throw new Error("Your session has ended. Reload the page to sign in again.");
  let j = null; if (r.status !== 204) { try { j = await r.json(); } catch {} }
  if (!r.ok) { const e = new Error((j && j.error) || "The request failed."); e.status = r.status; throw e; }
  return j;
}
const busy = (btn, on) => { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.t = btn.textContent; btn.textContent = "Working…"; } else if (btn.dataset.t) btn.textContent = btn.dataset.t; };
async function act(btn, fn, ok) { busy(btn, true); try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message, true); return undefined; } finally { busy(btn, false); } }
function go(h) { if (location.hash === h) route(); else location.hash = h; }
function dialog(html, { wide, onOpen } = {}) {
  return new Promise(resolve => {
    const d = document.createElement("dialog"); if (wide) d.className = "wide";
    d.innerHTML = html; document.body.appendChild(d);
    const done = v => { d.close(); d.remove(); resolve(v); };
    d.addEventListener("cancel", e => { e.preventDefault(); done(null); });
    d.querySelectorAll("[data-x]").forEach(b => b.onclick = () => done(null));
    if (onOpen) onOpen(d, done);
    d.showModal();
  });
}
const confirmBox = (title, text, okLabel = "Confirm", danger) => dialog(`<form method="dialog"><h3>${esc(title)}</h3><p style="margin:0">${text}</p><div class="foot"><button type="button" data-x>Cancel</button><button type="submit" class="${danger ? "danger" : "primary"}">${esc(okLabel)}</button></div></form>`,
  { onOpen: (d, done) => { d.querySelector("form").onsubmit = e => { e.preventDefault(); done(true); }; } });

/* ---------- layout ---------- */
const SECTION = { performance: "Performance", person: "Performance", statements: "Commission statements", statement: "Commission statements", credits: "Invoice credits", plans: "Targets & plans", accounts: "Account managers" };
function nav(key, extra) {
  const BX = window.BX; if (!BX) return;
  const k = key === "person" ? "performance" : key === "statement" ? "statements" : key;
  BX.markSub("#/" + k);
  BX.crumb([["Targets & Commission", "#/performance"], [SECTION[k], k === key ? null : "#/" + k]].concat(extra ? [[extra]] : []).filter(x => x[0]));
  if (PERF && PERF.attention) BX.subCount("#/credits", PERF.attention.unassigned + PERF.attention.costMissing, "Invoices needing a salesperson or a cost");
}
function page(title, tag, acts, body, key, extra) {
  nav(key, extra);
  $("app").innerHTML = `<header class="top"><div><h1><span class="tag">${esc(tag)}</span>${esc(title)}</h1></div><div class="acts">${acts || ""}</div></header>${body}`;
  window.scrollTo(0, 0);
}
const yearSel = (years, y, id = "yearSel") => `<select id="${id}" aria-label="Year">${years.map(v => `<option${v === y ? " selected" : ""}>${v}</option>`).join("")}</select>`;
function meter(p, ticks) {
  const w = p == null ? 0 : Math.max(0, Math.min(100, p / 1.5));
  return `<span class="att2"><span class="meter ${cls(p)}"><i style="width:${w}%"></i>${(ticks || [100]).map(t => `<span class="tick" style="left:${t / 1.5}%"></span>`).join("")}</span><span class="pct ${cls(p)}">${p == null ? "–" : Math.round(p) + "%"}</span></span>`;
}
function srcChip(s) { return `<span class="chipx ${s}">${esc(SRC[s] || s)}</span>`; }

/* ---------- data ---------- */
async function loadPerf(year) { PERF = await api("GET", "sales/performance?year=" + (year || "")); st.year = PERF.year; return PERF; }
async function people() {
  if (PEOPLE) return PEOPLE;
  const set = new Map();
  (PERF ? PERF.people : []).forEach(p => set.set(p.email, p.name));
  if (B.isManager) { try { const a = await api("GET", "access"); a.users.filter(u => u.isManager || (u.sections || []).includes("pipeline")).forEach(u => { if (!set.has(u.email)) set.set(u.email, u.email.split("@")[0].split(/[._-]/).map(w => w ? w[0].toUpperCase() + w.slice(1) : "").join(" ")); }); } catch {} }
  PEOPLE = [...set.entries()].map(([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name));
  return PEOPLE;
}
function periodIdx() {
  const nowM = +PERF.month.slice(5, 7) - 1, nowY = +PERF.month.slice(0, 4);
  if (st.m == null) st.m = PERF.year === nowY ? nowM : 11;
  if (st.q == null) st.q = Math.floor(st.m / 3);
  if (st.period === "m") return [st.m];
  if (st.period === "q") return [st.q * 3, st.q * 3 + 1, st.q * 3 + 2];
  return [...Array(12).keys()];
}
function periodLabel() { return st.period === "m" ? `${MON[st.m]} ${PERF.year}` : st.period === "q" ? `Q${st.q + 1} ${PERF.year}` : `${PERF.year}`; }
const sumM = (months, idx, k) => r2(idx.reduce((a, i) => a + months[i][k], 0));

/* ---------- performance (team leaderboard) ---------- */
async function performance() {
  if (!PERF || (st.year && PERF.year !== st.year)) await loadPerf(st.year);
  if (!PERF.isManager) return person(PERF.me);
  const idx = periodIdx();
  const rows = PERF.people.map(p => {
    const t = sumM(p.months, idx, "tSales"), s = sumM(p.months, idx, "sales"), tg = sumM(p.months, idx, "tGp"), g = sumM(p.months, idx, "gp");
    const basis = p.plan ? p.plan.basis : "gp";
    return { p, t, s, tg, g, ps: pctOf(s, t), pg: pctOf(g, tg), pb: basis === "gp" ? pctOf(g, tg) : pctOf(s, t), booked: sumM(p.months, idx, "booked"), coll: sumM(p.months, idx, "collected"), com: sumM(p.months, idx, "commission"),
      rate: st.period === "q" ? p.quarters[st.q].rate : null };
  }).sort((a, b) => (b.pb ?? -1) - (a.pb ?? -1) || b.s - a.s);
  const T = k => r2(rows.reduce((a, r) => a + r[k], 0));
  const team = { t: T("t"), s: T("s"), tg: T("tg"), g: T("g"), booked: T("booked"), coll: T("coll"), com: T("com") };
  const out = r2(PERF.people.reduce((a, p) => a + p.receivables.outstanding, 0)), od = r2(PERF.people.reduce((a, p) => a + p.receivables.overdue, 0));
  const weighted = r2(PERF.people.reduce((a, p) => a + p.pipeline.weighted, 0)), remaining = r2(PERF.people.reduce((a, p) => a + p.pipeline.remaining, 0));
  const due = r2(PERF.people.reduce((a, p) => a + Math.max(0, p.commission.dueNow), 0));
  const att = PERF.attention;
  page("Sales performance", PERF.company, `${yearSel(PERF.years, PERF.year)}
    <div class="seg" role="group" aria-label="Period" id="perSeg">${[["m", "Month"], ["q", "Quarter"], ["y", "Year"]].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${st.period === v}">${l}</button>`).join("")}</div>
    ${st.period === "m" ? `<select id="mSel" aria-label="Month">${MON.map((m, i) => `<option value="${i}"${i === st.m ? " selected" : ""}>${m}</option>`).join("")}</select>` : st.period === "q" ? `<select id="qSel" aria-label="Quarter">${[0, 1, 2, 3].map(i => `<option value="${i}"${i === st.q ? " selected" : ""}>Q${i + 1}</option>`).join("")}</select>` : ""}`, `
    ${att && (att.unassigned || att.costMissing) ? `<div class="note warn" style="margin-bottom:14px"><b>Invoices need attention</b>${[att.unassigned ? `${att.unassigned} invoice${att.unassigned > 1 ? "s" : ""} (AED ${aed(att.unassignedSales)}) not credited to anyone, so they count toward no target` : "", att.costMissing ? `${att.costMissing} with lines that have no known cost: GP commission waits until you enter it` : ""].filter(Boolean).join("; ")}. <a href="#/credits">Review invoice credits →</a></div>` : ""}
    <div class="kpis">
      <div class="kpi" style="--c:var(--accent)"><div class="k">Sales · ${esc(periodLabel())}</div><div class="v"><small>AED</small>${aed(team.s)}</div><div class="s">${team.t ? `${Math.round(team.s / team.t * 100)}% of AED ${aed(team.t)} target` : "No targets set"}</div></div>
      <div class="kpi" style="--c:var(--good)"><div class="k">Gross profit</div><div class="v"><small>AED</small>${aed(team.g)}</div><div class="s">${team.s ? `${Math.round(team.g / team.s * 100)}% margin` : ""}${team.tg ? ` · ${Math.round(team.g / team.tg * 100)}% of target` : ""}</div></div>
      <div class="kpi" style="--c:var(--warn)"><div class="k">Receivables on credited invoices</div><div class="v"><small>AED</small>${aed(out)}</div><div class="s">${od ? `AED ${aed(od)} overdue` : "nothing overdue"} · commission waits on these</div></div>
      <a class="kpi" href="#/statements" style="--c:var(--red)"><div class="k">Commission due now</div><div class="v"><small>AED</small>${aed(due)}</div><div class="s">collected, not yet on an approved statement</div></a>
    </div>
    <section class="card listpanel"><header><h2>Leaderboard<span>${esc(periodLabel())} · ranked by attainment on each person's commission basis</span></h2>${PERF.year === +PERF.month.slice(0, 4) ? `<span class="muted" style="font-size:12px">Weighted pipeline covers ${remaining > 0 ? (weighted / remaining).toFixed(1) + "× the sales target still to go this year (3× is healthy)" : "the rest of the year: targets met"}</span>` : ""}</header>
      <div class="tblwrap"><table class="list lead">
        <thead><tr><th>Salesperson</th><th class="r">Sales</th><th>vs target</th><th class="r">Gross profit</th><th>vs target</th><th class="r">Booked</th><th class="r">Collected</th><th class="r">Commission earned</th>${st.period === "q" ? `<th class="r">Rate now</th>` : ""}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr data-p="${esc(r.p.email)}" tabindex="0" class="${i === 0 && (r.pb || 0) > 0 ? "top1" : ""}">
          <td class="who"><span class="rank">${i + 1}</span><b>${esc(r.p.name)}</b>${r.p.plan ? `<div class="s">${r.p.plan.basis === "gp" ? "Paid on GP" : "Paid on sales"}</div>` : `<div class="s" style="color:var(--warn)">No ${PERF.year} plan</div>`}</td>
          <td class="r mono">${aed(r.s)}<div class="s">of ${aed(r.t)}</div></td><td>${meter(r.ps)}</td>
          <td class="r mono">${aed(r.g)}<div class="s">${r.s ? Math.round(r.g / r.s * 100) + "% margin" : ""}</div></td><td>${meter(r.pg)}</td>
          <td class="r mono">${aed(r.booked)}</td><td class="r mono">${aed(r.coll)}</td><td class="r mono">${aed(r.com)}</td>
          ${st.period === "q" ? `<td class="r mono">${r.rate == null ? "–" : r.rate + "%"}</td>` : ""}</tr>`).join("") || `<tr><td colspan="9"><div class="empty">No salespeople yet. <a href="#/plans">Set targets</a> for your team, or credit invoices to them.</div></td></tr>`}</tbody>
        ${rows.length > 1 ? `<tfoot><tr><td>Team</td><td class="r mono">${aed(team.s)}</td><td>${meter(pctOf(team.s, team.t))}</td><td class="r mono">${aed(team.g)}</td><td>${meter(pctOf(team.g, team.tg))}</td><td class="r mono">${aed(team.booked)}</td><td class="r mono">${aed(team.coll)}</td><td class="r mono">${aed(team.com)}</td>${st.period === "q" ? "<td></td>" : ""}</tr></tfoot>` : ""}
      </table></div>
    </section>
    ${chartCard(PERF.team.months, "Team: sales against target", "sales")}`, "performance");
  $("yearSel").onchange = async e => { st.year = +e.target.value; st.m = null; st.q = null; await loadPerf(st.year); route(); };
  $("perSeg").querySelectorAll("button").forEach(b => b.onclick = () => { st.period = b.dataset.v; route(); });
  if ($("mSel")) $("mSel").onchange = e => { st.m = +e.target.value; route(); };
  if ($("qSel")) $("qSel").onchange = e => { st.q = +e.target.value; route(); };
  document.querySelectorAll("tr[data-p]").forEach(tr => { tr.onclick = () => go("#/person/" + encodeURIComponent(tr.dataset.p)); tr.onkeydown = e => { if (e.key === "Enter") tr.onclick(); }; });
}

/* monthly chart: target (outline) against achieved (filled), with the running % of the year-to-date target */
function chartCard(months, title, basis) {
  const tk = basis === "gp" ? "tGp" : "tSales", ak = basis === "gp" ? "gp" : "sales";
  const max = Math.max(1, ...months.map(m => Math.max(m[tk], m[ak]))) * 1.12;
  const W = 760, H = 210, L = 46, R = 40, Tp = 12, Bt = 26, cw = (W - L - R) / 12, ih = H - Tp - Bt;
  const y = v => Tp + ih - Math.max(0, v) / max * ih;
  let cumT = 0, cumA = 0; const pts = [];
  const nowM = PERF.year === +PERF.month.slice(0, 4) ? +PERF.month.slice(5, 7) : 12;
  const bars = months.map((m, i) => {
    cumT += m[tk]; cumA += m[ak];
    if (i < nowM && cumT > 0) pts.push([L + cw * i + cw / 2, cumA / cumT]);
    const x = L + cw * i, bw = Math.min(26, cw * 0.62), bx = x + (cw - bw) / 2;
    return `<rect class="tg" x="${bx}" y="${y(m[tk])}" width="${bw}" height="${Tp + ih - y(m[tk])}" rx="3"><title>${MON[i]} target: AED ${aed(m[tk])}</title></rect>
      <rect class="ac${m[tk] > 0 && m[ak] >= m[tk] ? " over" : ""}" x="${bx + bw * 0.18}" y="${y(m[ak])}" width="${bw * 0.64}" height="${Tp + ih - y(m[ak])}" rx="2"><title>${MON[i]}: AED ${aed(m[ak])}${m[tk] ? ` (${Math.round(m[ak] / m[tk] * 100)}% of target)` : ""}</title></rect>
      <text class="ax" x="${x + cw / 2}" y="${H - 8}" text-anchor="middle">${MON[i]}</text>`;
  }).join("");
  const grid = [0, 0.5, 1].map(f => `<text class="ax" x="${L - 6}" y="${y(max / 1.12 * f) + 3}" text-anchor="end">${aedK(max / 1.12 * f)}</text><line x1="${L}" x2="${W - R}" y1="${y(max / 1.12 * f)}" y2="${y(max / 1.12 * f)}" stroke="var(--line)"/>`).join("");
  const ytd = pts.length ? pts[pts.length - 1][1] : null;
  return `<section class="card" style="margin-top:16px"><header><h2>${esc(title)}<span>${basis === "gp" ? "gross profit" : "sales before VAT"} by invoice date</span></h2>${ytd != null ? `<span class="pct ${cls(ytd * 100)}" style="font-size:13px">Year to date: ${Math.round(ytd * 100)}% of target</span>` : ""}</header>
    <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${bars}</svg></div>
    <div class="legend"><span><i class="t"></i>Target</span><span><i></i>Achieved</span><span><i class="g"></i>Month on target</span></div></section>`;
}

/* ---------- one salesperson ---------- */
async function person(email) {
  if (!PERF || (st.year && PERF.year !== st.year)) await loadPerf(st.year);
  const p = PERF.people.find(x => x.email === email);
  if (!p) { page("Sales performance", PERF.company, "", `<div class="empty">No figures for ${esc(email)} in ${PERF.year}.</div>`, "person"); return; }
  const mine = p.email === PERF.me && !PERF.isManager;
  const basis = p.plan ? p.plan.basis : "gp";
  const curQ = PERF.year === +PERF.month.slice(0, 4) ? Math.floor((+PERF.month.slice(5, 7) - 1) / 3) : 3;
  const q = p.quarters[curQ];
  const bands = p.plan ? p.plan.bands.slice().sort((a, b) => a.from - b.from) : [];
  const scale = Math.max(150, ...(bands.map(b => b.from + 25)), q.pct || 0);
  const fill = q.pct == null ? 0 : Math.min(100, q.pct / scale * 100);
  const Y = p.year;
  const ytdS = pctOf(p.months.slice(0, PERF.year === +PERF.month.slice(0, 4) ? +PERF.month.slice(5, 7) : 12).reduce((a, m) => a + m.sales, 0), Y.ytdTargetSales);
  page(mine ? "My performance" : p.name, mine ? `${PERF.company} · ${p.name}` : `Sales performance · ${PERF.company}`, `${yearSel(PERF.years, PERF.year)}
<button type="button" id="toSt">Commission statements</button>`, `
    ${!p.plan ? `<div class="note warn" style="margin-bottom:14px"><b>No ${PERF.year} plan</b>${mine ? "Your manager hasn't set your targets and commission plan for this year yet, so no commission is worked out." : `Set ${esc(p.name)}'s targets and commission plan to work out commission. <a href="#/plans">Targets & plans →</a>`}</div>` : ""}
    <div class="kpis">
      <div class="kpi"><div class="k">Sales ${Y.tSales ? "vs target" : ""} · ${PERF.year}</div><div class="v"><small>AED</small>${aed(Y.sales)}</div><div class="s">${Y.tSales ? `${Math.round(Y.sales / Y.tSales * 100)}% of AED ${aed(Y.tSales)}${ytdS != null ? ` · ${Math.round(ytdS)}% of target to date` : ""}` : "no sales target"}</div></div>
      <div class="kpi" style="--c:var(--good)"><div class="k">Gross profit</div><div class="v"><small>AED</small>${aed(Y.gp)}</div><div class="s">${Y.sales ? Math.round(Y.gp / Y.sales * 100) + "% margin" : ""}${Y.tGp ? ` · ${Math.round(Y.gp / Y.tGp * 100)}% of AED ${aed(Y.tGp)}` : ""}</div></div>
      <div class="kpi" style="--c:var(--red)"><div class="k">Commission earned · ${PERF.year}</div><div class="v"><small>AED</small>${aed(p.commission.earnedYear)}</div><div class="s">AED ${aed(p.commission.dueNow)} due now · ${p.plan ? `on-target AED ${aed(p.plan.onTarget)}` : ""}</div></div>
      <div class="kpi" style="--c:var(--warn)"><div class="k">Waiting on customers</div><div class="v"><small>AED</small>${aed(p.commission.waitingPayment)}</div><div class="s">commission paid when they pay${p.commission.waitingCost ? ` · AED ${aed(p.commission.waitingCost)} waiting for cost` : ""}</div></div>
    </div>
    <div class="grid2">
      <section class="card"><header><h2>Q${curQ + 1} ${PERF.year}<span>${basis === "gp" ? "gross profit" : "sales"} against the quarter target</span></h2>${q.rate != null ? `<span class="chipx deal">Earning ${q.rate}% now</span>` : ""}</header>
        <div class="focus">
          <div class="big"><b>AED ${aed(q.achieved)}</b><span>of AED ${aed(q.target)}${q.pct != null ? ` · ${q.pct}%` : ""}</span></div>
          ${p.plan && q.target > 0 ? `<div><div class="bandbar"><i style="width:${fill}%"></i>${bands.filter(b => b.from > 0).map(b => `<span class="bm" style="left:${b.from / scale * 100}%"></span>`).join("")}</div>
            <div class="bandlbl">${bands.map((b, i) => { const nxt = bands[i + 1]; const mid = ((b.from + (nxt ? nxt.from : scale)) / 2) / scale * 100; return `<span style="left:${mid}%"><b>${b.rate}%</b>${nxt ? `${b.from}–${nxt.from}%` : `over ${b.from}%`}</span>`; }).join("")}</div></div>
            ${q.next ? `<div class="nextup">Another <b>AED ${aed(q.next.need)}</b> of ${basis === "gp" ? "gross profit" : "sales"} this quarter reaches ${q.next.from}% of target. Everything above that earns <b>${q.next.rate}%</b>.</div>` : `<div class="nextup">Top band reached: everything else this quarter earns <b>${q.rate}%</b>.</div>`}` : `<p class="muted" style="margin:0">${p.plan ? "No target set for this quarter." : "No plan, so no commission bands."}</p>`}
          <div class="qgrid">${p.quarters.map((x, i) => `<div class="qc${i === curQ ? " now" : ""}"><div class="h"><span>Q${x.q}</span><span>${x.pct == null ? "" : x.pct + "%"}</span></div><span class="n">AED ${aedK(x.achieved)}</span><span class="s">target ${aedK(x.target)} · commission ${aedK(x.commission)}</span></div>`).join("")}</div>
        </div></section>
      <section class="card"><header><h2>Pipeline and collections</h2><a href="/pipeline/">Sales Pipeline →</a></header>
        <a class="mi" href="/pipeline/"><span><b>Open pipeline</b><span class="t">${p.pipeline.deals} open deal${p.pipeline.deals === 1 ? "" : "s"} · weighted AED ${aed(p.pipeline.weighted)}</span></span><span class="amt">AED ${aed(p.pipeline.open)}</span></a>
        <div class="mi"><span><b>Coverage</b><span class="t">weighted pipeline against the ${PERF.year} sales target still to go (AED ${aed(p.pipeline.remaining)}). 3× is healthy.</span></span><span class="amt">${p.pipeline.coverage == null ? "target met" : p.pipeline.coverage.toFixed(1) + "×"}</span></div>
        <div class="mi"><span><b>Booked this year</b><span class="t">deals marked PO received or won</span></span><span class="amt">AED ${aed(Y.booked)}</span></div>
        <div class="mi"><span><b>Outstanding on my invoices</b><span class="t">${p.receivables.overdue ? `AED ${aed(p.receivables.overdue)} overdue: chase these to release commission` : "nothing overdue"}</span></span><span class="amt">AED ${aed(p.receivables.outstanding)}</span></div>
        <div class="mi"><span><b>Collected this year</b><span class="t">payments received on credited invoices, with VAT</span></span><span class="amt">AED ${aed(Y.collected)}</span></div>
        ${p.plan ? `<div class="mi"><span><b>Plan</b><span class="t">${basis === "gp" ? "Gross profit" : "Sales"}: ${bands.map((b, i) => `${b.rate}% ${bands[i + 1] ? `from ${b.from}%` : `above ${b.from}%`}`).join(", ")} of the quarter target</span></span><span class="amt"><a href="#/plans">Details</a></span></div>` : ""}
      </section>
    </div>
    ${chartCard(p.months, "Month by month", basis)}
    <section class="card listpanel" style="margin-top:16px"><header><h2>Months<span>${PERF.year}</span></h2></header><div class="tblwrap"><table class="list compact nohover">
      <thead><tr><th>Month</th><th class="r">Sales target</th><th class="r">Sales</th><th>%</th><th class="r">GP target</th><th class="r">GP</th><th>%</th><th class="r">Booked</th><th class="r">Collected</th><th class="r">Commission</th></tr></thead>
      <tbody>${p.months.map((m, i) => `<tr><td>${MON[i]}</td><td class="r mono">${aed(m.tSales)}</td><td class="r mono">${aed(m.sales)}</td><td>${meter(pctOf(m.sales, m.tSales))}</td><td class="r mono">${aed(m.tGp)}</td><td class="r mono">${aed(m.gp)}</td><td>${meter(pctOf(m.gp, m.tGp))}</td><td class="r mono">${aed(m.booked)}</td><td class="r mono">${aed(m.collected)}</td><td class="r mono">${aed(m.commission)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>${PERF.year}</td><td class="r mono">${aed(Y.tSales)}</td><td class="r mono">${aed(Y.sales)}</td><td>${meter(pctOf(Y.sales, Y.tSales))}</td><td class="r mono">${aed(Y.tGp)}</td><td class="r mono">${aed(Y.gp)}</td><td>${meter(pctOf(Y.gp, Y.tGp))}</td><td class="r mono">${aed(Y.booked)}</td><td class="r mono">${aed(Y.collected)}</td><td class="r mono">${aed(Y.commission)}</td></tr></tfoot>
    </table></div></section>
    <section class="card listpanel" style="margin-top:16px"><header><h2>Invoices credited<span>${p.invoices.length}</span></h2>${PERF.isManager ? `<a href="#/credits">Invoice credits →</a>` : ""}</header><div class="tblwrap"><table class="list compact nohover">
      <thead><tr><th>Invoice</th><th>Customer</th><th class="r">Share</th><th class="r">Sales</th><th class="r">GP</th><th class="r">Commission</th><th class="r">Collected</th><th class="r">Payable now</th><th class="r">Paid out</th><th>Credited</th></tr></thead>
      <tbody>${p.invoices.map(i => `<tr><td><b>${esc(i.number)}</b><div class="s">${fd(i.date)}</div></td><td>${esc(i.customer)}${i.title ? `<div class="s">${esc(i.title)}</div>` : ""}</td><td class="r mono">${i.share}%</td><td class="r mono">${aed(i.sales)}</td>
        <td class="r mono">${aed(i.gp)}${i.costSrc === "missing" ? `<div class="s"><span class="chipx missing">${COST.missing}</span></div>` : ""}</td>
        <td class="r mono">${aed(i.commission, 2)}${i.rate != null && !i.noPlan ? `<div class="s">up to ${i.rate}%</div>` : ""}${i.held ? `<div class="s"><span class="chipx held">Waiting for cost</span></div>` : ""}</td>
        <td class="r mono">${i.collectedPct}%${i.overdue ? `<div class="s"><span class="st overdue">Overdue</span></div>` : ""}</td><td class="r mono">${aed(i.payableNow, 2)}</td><td class="r mono">${aed(i.paidOut, 2)}</td><td>${srcChip(i.src)}</td></tr>`).join("") || `<tr><td colspan="10"><div class="empty">No invoices credited in ${PERF.year} yet.</div></td></tr>`}</tbody>
    </table></div></section>`, "person", mine ? null : p.name);
  $("yearSel").onchange = async e => { st.year = +e.target.value; await loadPerf(st.year); route(); };
  $("toSt").onclick = () => go(PERF.isManager ? `#/statement/${B.month}/${encodeURIComponent(p.email)}` : "#/statements");
}

/* ---------- statements ---------- */
async function statements(ym) {
  ym = ym || addMonths(B.month, B.isManager ? -1 : 0);
  const d = await api("GET", "sales/statements/" + ym);
  const STL = { draft: "Ready to approve", approved: "Approved", paid: "Paid", none: "Nothing", closed: "Included later" };
  const total = r2(d.people.filter(p => ["draft", "approved", "paid"].includes(p.status)).reduce((a, p) => a + Math.max(0, p.total), 0));
  page("Commission statements", B.company.name, `<span class="monthnav"><button type="button" id="prevM" aria-label="Previous month">‹</button><b>${esc(monthName(ym))}</b><button type="button" id="nextM" aria-label="Next month"${ym >= B.month ? " disabled" : ""}>›</button></span>`, `
    <div class="note" style="margin-bottom:14px"><b>How a statement works</b>Commission is paid on the part of each invoice the customer has paid by the end of the month, less anything paid before. Credit notes and corrections come off the next statement. ${B.isManager ? "Approve each person's statement to put it into a payroll run (or pay it separately). Months are approved in order." : "Your manager approves it and it is paid with your salary."}</div>
    <section class="card listpanel"><header><h2>${esc(monthName(ym))}<span>collections up to ${fd(ym + "-" + new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate())}</span></h2>${total ? `<span class="mono" style="font-weight:700">AED ${aed(total, 2)}</span>` : ""}</header>
      <div class="tblwrap"><table class="list"><thead><tr><th>Salesperson</th><th>Status</th><th class="r">Invoices</th><th class="r">Amount</th><th></th></tr></thead>
      <tbody>${d.people.map(p => `<tr data-o="${esc(p.email)}" tabindex="0"><td><b>${esc(p.name)}</b><div class="s">${esc(p.email)}</div></td><td><span class="st ${p.status === "draft" ? "open" : p.status === "approved" ? "partial" : p.status === "paid" ? "paid" : "draft"}">${esc(STL[p.status] || p.status)}</span>${p.statusLabel !== STL[p.status] ? `<div class="s">${esc(p.statusLabel)}</div>` : ""}</td>
        <td class="r mono">${p.count || ""}</td><td class="r mono">${p.count || p.total ? aed(p.total, 2) : "–"}</td><td class="r"><button type="button">Open</button></td></tr>`).join("") || `<tr><td colspan="5"><div class="empty">No one has commission for this month.</div></td></tr>`}</tbody></table></div></section>`, "statements", monthName(ym));
  $("prevM").onclick = () => go("#/statements/" + addMonths(ym, -1));
  $("nextM").onclick = () => go("#/statements/" + addMonths(ym, 1));
  document.querySelectorAll("tr[data-o]").forEach(tr => { tr.onclick = () => go(`#/statement/${ym}/${encodeURIComponent(tr.dataset.o)}`); tr.onkeydown = e => { if (e.key === "Enter") tr.onclick(); }; });
}
async function statement(ym, email) {
  const s = await api("GET", `sales/statements/${ym}/${encodeURIComponent(email)}`);
  const ST = { draft: "open", approved: "partial", paid: "paid", none: "draft", closed: "draft" };
  const lines = s.lines || [];
  const acts = [`<button type="button" id="prt">Print / save PDF</button>`];
  if (B.isManager && s.status === "draft" && s.total > 0) acts.push(`<button type="button" class="primary" id="apv">Approve AED ${aed(s.total, 2)}</button>`);
  if (B.isManager && s.status === "approved") acts.push(`<button type="button" id="reo">Reopen</button>`);
  if (B.isManager && s.status === "approved" && s.pay === "separate") acts.push(`<button type="button" class="primary" id="pd">Mark paid</button>`);
  page(`${s.name}: ${s.monthName}`, `Commission statement · ${s.company}`, acts.join(""), `
    <section class="card"><div class="stmthead"><div><div class="printonly" style="font-weight:700;font-size:18px">${esc(s.company)}: commission statement</div><b style="font-size:16px">${esc(s.name)}</b><div class="muted">${esc(s.email)} · ${esc(s.monthName)}</div>
      <div style="margin-top:8px"><span class="st ${ST[s.status] || "draft"}">${esc(s.status === "draft" ? "Draft" : s.status === "none" ? "Nothing to pay" : s.status === "closed" ? "Closed" : s.status)}</span> <span class="muted" style="font-size:13px">${esc(s.statusLabel)}</span></div>
      ${s.approvedBy ? `<div class="muted" style="font-size:12px;margin-top:4px">Approved by ${esc(s.approvedBy)} on ${fd(s.approvedAt)}${s.note ? ` · ${esc(s.note)}` : ""}</div>` : ""}
      ${s.payrollNote ? `<div class="note warn" style="margin-top:8px">${esc(s.payrollNote)}</div>` : ""}</div>
      <div style="text-align:right"><div class="muted" style="font-size:12px">${s.total < 0 ? "Clawback (carried to next month)" : "Commission this statement"}</div><div class="amt">AED ${aed(s.total, 2)}</div>
      ${s.waiting && (s.waiting.unpaid || s.waiting.held) ? `<div class="muted" style="font-size:12px">AED ${aed(s.waiting.unpaid, 2)} more when customers pay${s.waiting.held ? ` · AED ${aed(s.waiting.held, 2)} waiting for cost` : ""}</div>` : ""}</div></div>
      <div class="tblwrap"><table class="list compact nohover"><thead><tr><th>Invoice</th><th>Customer</th><th class="r">Share</th><th class="r">Basis</th><th class="r">Commission on invoice</th><th class="r">Collected</th><th class="r">Payable to date</th><th class="r">Paid before</th><th class="r">This statement</th></tr></thead>
      <tbody>${lines.map(l => `<tr><td><b>${esc(l.number)}</b><div class="s">${fd(l.date)}</div></td><td>${esc(l.customer)}${l.why ? `<div class="s">${esc(l.why)}</div>` : ""}</td><td class="r mono">${l.share != null ? l.share + "%" : ""}</td>
        <td class="r mono">${l.basisAmt != null ? aed(l.basisAmt, 2) : ""}</td><td class="r mono">${l.commission != null ? aed(l.commission, 2) : ""}${l.rate != null ? `<div class="s">up to ${l.rate}%</div>` : ""}</td><td class="r mono">${l.collectedPct != null ? l.collectedPct + "%" : ""}</td>
        <td class="r mono">${l.payable != null ? aed(l.payable, 2) : ""}</td><td class="r mono">${l.before != null ? aed(l.before, 2) : ""}</td><td class="r mono" style="font-weight:700">${aed(l.amt, 2)}</td></tr>`).join("") || `<tr><td colspan="9"><div class="empty">${esc(s.statusLabel)}.</div></td></tr>`}</tbody>
      ${lines.length ? `<tfoot><tr><td colspan="8">Total</td><td class="r mono">${aed(s.total, 2)}</td></tr></tfoot>` : ""}</table></div></section>
    <p class="muted noprint" style="font-size:12px">Basis is the gross profit (or sales) credited to ${esc(s.name)} on each invoice. Commission on the invoice follows the quarter's bands; it is paid in step with what the customer has paid.</p>`, "statement", `${s.name}, ${s.monthName}`);
  $("prt").onclick = () => window.print();
  if ($("apv")) $("apv").onclick = () => approveDlg(s);
  if ($("reo")) $("reo").onclick = async () => { if (await confirmBox("Reopen statement", `This removes AED ${aed(s.total, 2)} from ${esc(s.payrollMonth ? monthName(s.payrollMonth) + " payroll" : "approved commission")} and puts the statement back to draft.`, "Reopen")) { const r = await act($("reo"), () => api("POST", `sales/statements/${ym}/${encodeURIComponent(email)}/reopen`), "Statement reopened"); if (r) { PERF = null; route(); } } };
  if ($("pd")) $("pd").onclick = () => dialog(`<form><h3>Mark commission paid</h3><label><span class="lbl">Paid on</span><input type="date" name="d" value="${B.today}" required></label><label><span class="lbl">How (optional)</span><input name="n" maxlength="200" placeholder="e.g. Bank transfer ref 4471"></label><div class="foot"><button type="button" data-x>Cancel</button><button class="primary">Mark paid</button></div></form>`, { onOpen: (d, done) => { d.querySelector("form").onsubmit = async e => { e.preventDefault(); const f = e.target; const r = await act(f.querySelector(".primary"), () => api("POST", `sales/statements/${ym}/${encodeURIComponent(email)}/paid`, { date: f.d.value, note: f.n.value }), "Marked paid"); if (r) { done(true); route(); } }; } });
}
function approveDlg(s) {
  const opts = [0, 1, 2].map(n => addMonths(s.month, n));
  return dialog(`<form><h3>Approve ${esc(s.name)}'s commission</h3>
    <div class="ex">AED <b>${aed(s.total, 2)}</b> for ${esc(s.monthName)}, ${s.lines.length} invoice line${s.lines.length === 1 ? "" : "s"}.</div>
    <label><span class="lbl">Pay it</span><select name="pay"><option value="payroll">With salary (payroll)</option><option value="separate">Separately (bank transfer or cash)</option></select></label>
    <label id="pmw"><span class="lbl">Payroll month</span><select name="pm">${opts.map((m, i) => `<option value="${m}"${i === 1 ? " selected" : ""}>${monthName(m)}</option>`).join("")}</select><span class="hint">Added to the commission column of that payroll run (or when it is created). The salesperson must be in HR & Payroll with the same email.</span></label>
    <label><span class="lbl">Note (optional)</span><input name="note" maxlength="300"></label>
    <div class="foot"><button type="button" data-x>Cancel</button><button class="primary">Approve</button></div></form>`, { onOpen: (d, done) => {
    const f = d.querySelector("form"); f.pay.onchange = () => { $("pmw").hidden = f.pay.value !== "payroll"; };
    f.onsubmit = async e => { e.preventDefault(); const r = await act(f.querySelector(".primary"), () => api("POST", `sales/statements/${s.month}/${encodeURIComponent(s.email)}/approve`, { pay: f.pay.value, payrollMonth: f.pm.value, note: f.note.value, expectTotal: s.total }), "Statement approved");
      if (r) { done(true); PERF = null; route(); if (r.payrollNote) toast(r.payrollNote, true); } };
  } });
}

/* ---------- invoice credits (managers) ---------- */
let CRED = null;
async function credits() {
  if (!B.isManager) return go("#/performance");
  const year = st.year || +B.today.slice(0, 4);
  CRED = await api("GET", "sales/credits?year=" + year);
  if (!PERF || PERF.year !== year) await loadPerf(year);
  const ppl = await people();
  const F = { attention: i => i.src === "none" || (i.costSrc === "missing" && i.src !== "house"), none: i => i.src === "none", cost: i => i.costSrc === "missing", shared: i => i.splits.length > 1, all: () => true };
  const draw = () => {
    const q = st.credQ.trim().toLowerCase();
    const rows = CRED.invoices.filter(F[st.credFilter]).filter(i => !q || [i.number, i.customer, i.title, i.splits.map(s => s.name + " " + s.email).join(" ")].join(" ").toLowerCase().includes(q));
    $("cnt").textContent = `${rows.length} of ${CRED.invoices.length} invoices`;
    $("crows").innerHTML = rows.map(i => `<tr data-i="${esc(i.id)}" tabindex="0"><td><b>${esc(i.number)}</b><div class="s">${fd(i.date)}</div></td><td>${esc(i.customer)}${i.title ? `<div class="s">${esc(i.title)}</div>` : ""}</td>
      <td class="r mono">${aed(i.sales)}${i.credits.length ? `<div class="s">after credit notes</div>` : ""}</td><td class="r mono">${aed(i.cost)}<div class="s"><span class="chipx ${i.costSrc}">${COST[i.costSrc]}</span></div></td>
      <td class="r mono">${aed(i.gp)}<div class="s">${i.gpPct == null ? "" : i.gpPct + "%"}</div></td>
      <td>${i.splits.length ? i.splits.map(s => `<div>${esc(s.name)}${i.splits.length > 1 ? ` <span class="muted">${s.pct}%</span>` : ""}</div>`).join("") : `<span class="muted">${i.src === "house" ? "No one" : "–"}</span>`}<div class="s">${srcChip(i.src)}</div></td>
      <td class="r mono">${i.collectedPct}%${i.overdue ? `<div class="s"><span class="st overdue">Overdue</span></div>` : ""}</td></tr>`).join("") || `<tr><td colspan="7"><div class="empty">${st.credFilter === "attention" ? "Nothing needs attention. Every invoice has a salesperson and a cost." : "No invoices match."}</div></td></tr>`;
    document.querySelectorAll("tr[data-i]").forEach(tr => { tr.onclick = () => creditDlg(CRED.invoices.find(x => x.id === tr.dataset.i), ppl); tr.onkeydown = e => { if (e.key === "Enter") tr.onclick(); }; });
  };
  const counts = k => CRED.invoices.filter(F[k]).length;
  page("Invoice credits", B.company.name, yearSel(PERF.years, year), `
    <div class="note" style="margin-bottom:14px"><b>Who gets credit for each invoice</b>Invoices are credited automatically: to the owner of the deal the quotation came from, otherwise to the customer's account manager. Assign the rest, split shared deals (up to three people), or mark house accounts. Gross profit uses Books item purchase prices; enter the cost where a line has none.</div>
    <div class="tools"><div class="seg" role="group" aria-label="Show" id="cf">${[["attention", "Needs attention"], ["none", "No salesperson"], ["cost", "Cost needed"], ["shared", "Shared"], ["all", "All"]].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${st.credFilter === v}">${l}${v !== "all" ? ` (${counts(v)})` : ""}</button>`).join("")}</div>
      <input type="search" id="cq" placeholder="Search invoice, customer or salesperson" value="${esc(st.credQ)}" aria-label="Search invoices"><span class="cnt" id="cnt"></span></div>
    <section class="card listpanel"><div class="tblwrap"><table class="list"><thead><tr><th>Invoice</th><th>Customer</th><th class="r">Sales</th><th class="r">Cost</th><th class="r">GP</th><th>Credited to</th><th class="r">Collected</th></tr></thead><tbody id="crows"></tbody></table></div></section>`, "credits");
  $("yearSel").onchange = async e => { st.year = +e.target.value; route(); };
  $("cf").querySelectorAll("button").forEach(b => b.onclick = () => { st.credFilter = b.dataset.v; $("cf").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); draw(); });
  $("cq").oninput = e => { st.credQ = e.target.value; draw(); };
  draw();
}
function creditDlg(i, ppl) {
  const opt = sel => `<option value="">Choose…</option>` + ppl.map(p => `<option value="${esc(p.email)}"${p.email === sel ? " selected" : ""}>${esc(p.name)} (${esc(p.email)})</option>`).join("");
  const auto = i.deal ? `the deal "${i.deal.title}" (owner ${i.deal.owner})` : i.account ? `the account manager (${i.account})` : "";
  const splits = i.src === "house" ? [] : i.splits.length ? i.splits : [{ email: "", pct: 100 }];
  return dialog(`<form><h3>${esc(i.number)} · ${esc(i.customer)}</h3>
    <div class="ex">Sales AED <b>${aed(i.sales, 2)}</b>${i.credits.length ? ` (after credit note${i.credits.length > 1 ? "s" : ""} ${i.credits.map(c => esc(c.ref)).join(", ")})` : ""} · collected ${i.collectedPct}%${i.locked ? ` · <b style="font-family:inherit">commission already paid on this invoice: changes come off or onto the next statement</b>` : ""}<br>
      ${i.src === "deal" || i.src === "account" ? `Credited automatically from ${esc(auto)}.` : i.src === "manual" ? `Assigned by ${esc(i.by)} on ${fd(i.at)}.${auto ? ` Automatic credit would be ${esc(auto)}.` : ""}` : i.src === "house" ? "House account: counts toward no one's target." : `No deal or account manager found.${i.salesperson ? ` The invoice names "${esc(i.salesperson)}" as salesperson.` : ""}`}</div>
    <label class="check"><input type="checkbox" name="house"${i.src === "house" ? " checked" : ""}> House account (no salesperson, no commission)</label>
    <div id="splits" class="bandrows"></div>
    <div><button type="button" id="addS">+ Share with another person</button></div>
    <label><span class="lbl">Cost of sale (AED, before VAT)</span><input name="cost" inputmode="decimal" value="${i.costSrc === "manual" ? i.cost : ""}" placeholder="Automatic: AED ${aed(i.itemCost, 2)} from item prices">
      <span class="hint">${i.unknown.length ? `These lines have no purchase price in Books, so the automatic cost leaves them out:` : "Leave empty to use the item purchase prices from Books. Enter the real cost if you know it (supplier bills, subcontractors)."}</span>
      ${i.unknown.length ? `<ul class="unk">${i.unknown.map(u => `<li>${esc(u.name)} (sold for AED ${aed(u.net, 2)})</li>`).join("")}</ul>` : ""}</label>
    <label><span class="lbl">Note (optional)</span><input name="note" maxlength="300" value="${esc(i.note)}" placeholder="e.g. Maya did the survey and design"></label>
    <label class="check" id="remW"><input type="checkbox" name="remember"${i.account ? "" : " checked"}> Make this person the account manager for ${esc(i.customer)} (future invoices are credited to them)</label>
    <div class="err" id="ce"></div>
    <div class="foot">${i.src === "manual" || i.src === "house" ? `<button type="button" id="rst" style="margin-right:auto">Reset to automatic</button>` : ""}<button type="button" data-x>Cancel</button><button class="primary">Save</button></div></form>`, { onOpen: (d, done) => {
    const f = d.querySelector("form"); let rows = splits.map(s => ({ ...s }));
    const drawS = () => {
      const h = f.house.checked;
      d.querySelector("#splits").innerHTML = h ? "" : rows.map((s, k) => `<div class="split"><select data-k="${k}" aria-label="Salesperson ${k + 1}">${opt(s.email)}</select><input data-p="${k}" inputmode="decimal" value="${s.pct}" aria-label="Share %" ${rows.length === 1 ? "disabled" : ""}><span>%${rows.length > 1 ? ` <button type="button" data-r="${k}" aria-label="Remove">✕</button>` : ""}</span></div>`).join("");
      d.querySelector("#addS").hidden = h || rows.length >= 3;
      d.querySelector("#remW").hidden = h || rows.length !== 1;
      d.querySelectorAll("select[data-k]").forEach(x => x.onchange = () => { rows[+x.dataset.k].email = x.value; });
      d.querySelectorAll("input[data-p]").forEach(x => x.oninput = () => { rows[+x.dataset.p].pct = num(x.value); });
      d.querySelectorAll("[data-r]").forEach(x => x.onclick = () => { rows.splice(+x.dataset.r, 1); if (rows.length === 1) rows[0].pct = 100; drawS(); });
    };
    drawS();
    f.house.onchange = drawS;
    d.querySelector("#addS").onclick = () => { const each = Math.floor(100 / (rows.length + 1)); rows = rows.map(r => ({ ...r, pct: each })).concat({ email: "", pct: 100 - each * rows.length }); drawS(); };
    if (d.querySelector("#rst")) d.querySelector("#rst").onclick = async () => { const r = await act(d.querySelector("#rst"), () => api("DELETE", "sales/credits/" + i.id), "Back to automatic credit"); if (r !== undefined) { done(true); PERF = null; route(); } };
    f.onsubmit = async e => {
      e.preventDefault(); d.querySelector("#ce").textContent = "";
      const body = { house: f.house.checked, splits: f.house.checked ? [] : rows, cost: f.cost.value.trim() === "" ? "" : num(f.cost.value), note: f.note.value, remember: !f.house.checked && rows.length === 1 && f.remember.checked };
      if (!body.house && rows.some(r => !r.email)) { d.querySelector("#ce").textContent = "Choose the salesperson for each share."; return; }
      try { busy(f.querySelector(".primary"), true); await api("PUT", "sales/credits/" + i.id, body); toast("Invoice credit saved"); done(true); PERF = null; route(); }
      catch (err) { d.querySelector("#ce").textContent = err.message; } finally { busy(f.querySelector(".primary"), false); }
    };
  } });
}

/* ---------- plans ---------- */
async function plans() {
  const year = st.year || +B.today.slice(0, 4);
  const d = await api("GET", "sales/plans/" + year);
  const years = [...new Set([year - 1, year, year + 1, +B.today.slice(0, 4), +B.today.slice(0, 4) + 1])].sort((a, b) => b - a);
  const band = p => p.bands.map((b, i) => `${b.rate}% ${p.bands[i + 1] ? `from ${b.from}%` : `above ${b.from}%`}`).join(" · ");
  page("Targets & plans", B.company.name, `${yearSel(years, year)}${B.isManager ? `${d.previousYearPlans && d.plans.length < d.previousYearPlans ? `<button type="button" id="cpy">Copy ${year - 1} plans</button>` : ""}<button type="button" class="primary" id="addP">+ Plan</button>` : ""}`, `
    <section class="card listpanel"><header><h2>${year} plans<span>${d.plans.length}</span></h2></header><div class="tblwrap"><table class="list">
      <thead><tr><th>Salesperson</th><th>Paid on</th><th class="r">Sales target</th><th class="r">GP target</th><th>Commission bands (of the quarter's target)</th><th class="r">On-target commission</th></tr></thead>
      <tbody>${d.plans.map(p => `<tr data-e="${esc(p.email)}" tabindex="0"><td><b>${esc(p.name || p.email)}</b><div class="s">${esc(p.email)}</div></td><td>${p.basis === "gp" ? "Gross profit" : "Sales"}</td><td class="r mono">${aed(p.targetSales)}</td><td class="r mono">${aed(p.targetGp)}</td><td>${esc(band(p))}</td><td class="r mono">${aed(p.onTarget)}<div class="s">a year at 100%</div></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">${B.isManager ? `No plans for ${year} yet. Add one for each salesperson.` : `Your ${year} plan hasn't been set yet.`}</div></td></tr>`}</tbody>
    </table></div></section>
    <section class="card" style="margin-top:16px"><header><h2>How commission works</h2></header><div class="bd how">
      <ol>
        <li><b>Targets</b> are set per month for sales (before VAT) and gross profit. Quarters and the year are the sum of their months.</li>
        <li><b>Credit.</b> Every issued tax invoice counts for one salesperson: the owner of the deal its quotation came from, else the customer's account manager, else whoever a manager assigns. Shared deals can be split.</li>
        <li><b>Gross profit</b> = sales less credit notes, less the cost of sale (Books item purchase prices, or the cost a manager enters).</li>
        <li><b>Bands</b> work like tax bands within each quarter: each slice of the quarter's target earns its own rate, so reaching a higher band never lowers what was already earned.</li>
        <li><b>Paid when the customer pays.</b> Commission on an invoice is released in step with payment (an advance of 40% releases 40%). Credit notes take back what they reduce.</li>
        <li><b>Monthly statement</b>: a manager approves it and it goes into the payroll run's commission column.</li>
      </ol>
      ${d.plans[0] ? exampleFor(d.plans[0]) : ""}
    </div></section>`, "plans");
  $("yearSel").onchange = e => { st.year = +e.target.value; route(); };
  if (B.isManager) {
    $("addP").onclick = () => planDlg(year, null);
    if ($("cpy")) $("cpy").onclick = () => dialog(`<form><h3>Copy ${year - 1} plans to ${year}</h3><p style="margin:0">Each ${year - 1} plan without a ${year} plan is copied with the same bands and month pattern.</p><label><span class="lbl">Change targets by (%)</span><input name="g" inputmode="decimal" value="10"><span class="hint">e.g. 10 for 10% growth, 0 to keep them, -5 to lower them.</span></label><div class="foot"><button type="button" data-x>Cancel</button><button class="primary">Copy plans</button></div></form>`, { onOpen: (dd, done) => { dd.querySelector("form").onsubmit = async e => { e.preventDefault(); const r = await act(e.target.querySelector(".primary"), () => api("POST", `sales/plans/${year}/copy`, { growth: num(e.target.g.value) }), "Plans copied"); if (r) { done(true); PERF = null; route(); } }; } });
    document.querySelectorAll("tr[data-e]").forEach(tr => { tr.onclick = () => planDlg(year, d.plans.find(p => p.email === tr.dataset.e)); tr.onkeydown = e => { if (e.key === "Enter") tr.onclick(); }; });
  }
}
// A worked example from a real plan, so everyone can check their own statement.
function exampleFor(p) {
  const qt = p.targets[p.basis].slice(0, 3).reduce((a, x) => a + x, 0) || p.targets[p.basis].reduce((a, x) => a + x, 0) / 4;
  if (!qt) return "";
  const b = p.bands.slice().sort((x, y) => x.from - y.from);
  const reach = qt * 1.2;
  let txt = [], total = 0;
  b.forEach((k, i) => { const lo = k.from / 100 * qt, hi = b[i + 1] ? b[i + 1].from / 100 * qt : reach; if (reach <= lo) return; const amt = Math.min(reach, hi) - lo; total += amt * k.rate / 100; txt.push(`AED ${aed(amt)} × ${k.rate}% = AED ${aed(amt * k.rate / 100)}`); });
  return `<div class="ex"><b style="font-family:inherit">Example (${esc(p.name || p.email)}):</b> quarter target AED ${aed(qt)} of ${p.basis === "gp" ? "gross profit" : "sales"}. Reaching 120% (AED ${aed(reach)}) earns ${txt.join(" + ")} = <b>AED ${aed(total)}</b>, paid as the customers pay.</div>`;
}
async function planDlg(year, p) {
  const ppl = await people();
  const isNew = !p;
  p = p || { email: "", name: "", basis: "gp", bands: B.defaults.gp.map(x => ({ ...x })), targets: { sales: Array(12).fill(0), gp: Array(12).fill(0) }, note: "" };
  const T = { sales: p.targets.sales.slice(), gp: p.targets.gp.slice() };
  let bands = p.bands.map(x => ({ ...x }));
  const row = (k, lbl) => `<span class="rl">${lbl}</span>${T[k].map((v, i) => `<input data-t="${k}" data-i="${i}" inputmode="decimal" value="${v || ""}" aria-label="${lbl} ${MON[i]}">`).join("")}<span class="tot" id="tot_${k}"></span>`;
  return dialog(`<form><h3>${isNew ? `New ${year} plan` : `${esc(p.name || p.email)}: ${year} plan`}</h3>
    <div class="fields">
      <label><span class="lbl">Salesperson</span>${isNew ? `<input name="email" list="pl" required placeholder="name@company" autocomplete="off"><datalist id="pl">${ppl.map(x => `<option value="${esc(x.email)}">${esc(x.name)}</option>`).join("")}</datalist>` : `<input value="${esc(p.email)}" disabled>`}</label>
      <label><span class="lbl">Name shown</span><input name="name" maxlength="100" value="${esc(p.name)}" placeholder="e.g. Anil Kumar"></label>
      <label><span class="lbl">Commission paid on</span><select name="basis"><option value="gp"${p.basis === "gp" ? " selected" : ""}>Gross profit (recommended)</option><option value="sales"${p.basis === "sales" ? " selected" : ""}>Sales (before VAT)</option></select></label>
    </div>
    <div><span class="lbl">Targets, AED before VAT</span>
      <div class="tools" style="margin:6px 0"><label style="display:flex;gap:6px;align-items:center">Annual sales <input id="ys" inputmode="decimal" style="width:130px"></label><label style="display:flex;gap:6px;align-items:center">Annual GP <input id="yg" inputmode="decimal" style="width:130px"></label><button type="button" id="spread">Spread evenly over 12 months</button><span class="hint">Then adjust any month (e.g. lower in summer, or zero before a start date).</span></div>
      <div class="mgridwrap"><div class="mgrid"><span></span>${MON.map(m => `<span class="h">${m}</span>`).join("")}<span class="h">Year</span>${row("sales", "Sales")}${row("gp", "Gross profit")}</div></div></div>
    <div><span class="lbl">Commission bands: rate on each slice of the quarter's target</span><div class="bandrows" id="bands"></div><button type="button" id="addB" style="margin-top:6px">+ Band</button></div>
    <div class="ex" id="ote"></div>
    <label><span class="lbl">Note (optional)</span><input name="note" maxlength="500" value="${esc(p.note)}" placeholder="e.g. Joined in March; excludes Microsoft licence renewals"></label>
    <div class="err" id="pe"></div>
    <div class="foot">${isNew ? "" : `<button type="button" class="danger" id="delP" style="margin-right:auto">Delete plan</button>`}<button type="button" data-x>Cancel</button><button class="primary">Save plan</button></div></form>`, { wide: true, onOpen: (d, done) => {
    const f = d.querySelector("form");
    const tot = k => T[k].reduce((a, x) => a + num(x), 0);
    const ote = () => {
      const basis = f.basis.value, b = bands.slice().sort((x, y) => x.from - y.from); let total = 0;
      for (let q = 0; q < 4; q++) { const t = T[basis].slice(q * 3, q * 3 + 3).reduce((a, x) => a + num(x), 0); b.forEach((k, i) => { const lo = k.from / 100 * t, hi = b[i + 1] ? b[i + 1].from / 100 * t : t; if (hi > lo) total += (Math.min(t, hi) - lo) * k.rate / 100; }); }
      d.querySelector("#ote").innerHTML = tot(basis) ? `At exactly 100% of target every quarter this plan pays <b>AED ${aed(total)}</b> a year in commission (${(total / tot(basis) * 100).toFixed(1)}% of the ${basis === "gp" ? "GP" : "sales"} target). Above target the top band applies.` : `Set a ${basis === "gp" ? "gross profit" : "sales"} target: the bands are measured against it.`;
    };
    const totals = () => { ["sales", "gp"].forEach(k => { d.querySelector("#tot_" + k).textContent = aed(tot(k)); }); ote(); };
    const drawB = () => {
      d.querySelector("#bands").innerHTML = bands.map((b, i) => `<div class="bandrow"><span>From</span><input data-bf="${i}" inputmode="decimal" value="${b.from}" ${i === 0 ? "disabled" : ""} aria-label="Band ${i + 1} starts at % of target"><span>% of target, pay</span><input data-br="${i}" inputmode="decimal" value="${b.rate}" aria-label="Band ${i + 1} rate"><span>%</span><span class="muted">${i === 0 ? "from the first dirham" : ""}</span>${i > 0 ? `<button type="button" data-bx="${i}" aria-label="Remove band">✕</button>` : "<span></span>"}</div>`).join("");
      d.querySelector("#addB").hidden = bands.length >= 4;
      d.querySelectorAll("[data-bf]").forEach(x => x.oninput = () => { bands[+x.dataset.bf].from = num(x.value); ote(); });
      d.querySelectorAll("[data-br]").forEach(x => x.oninput = () => { bands[+x.dataset.br].rate = num(x.value); ote(); });
      d.querySelectorAll("[data-bx]").forEach(x => x.onclick = () => { bands.splice(+x.dataset.bx, 1); drawB(); ote(); });
    };
    d.querySelectorAll("input[data-t]").forEach(x => x.oninput = () => { T[x.dataset.t][+x.dataset.i] = num(x.value); totals(); });
    d.querySelector("#spread").onclick = () => {
      [["sales", "ys"], ["gp", "yg"]].forEach(([k, id]) => { const v = num(d.querySelector("#" + id).value); if (!v) return; const each = Math.floor(v / 12 * 100) / 100; T[k] = T[k].map((_, i) => i < 11 ? each : r2(v - each * 11)); d.querySelectorAll(`input[data-t="${k}"]`).forEach(x => { x.value = T[k][+x.dataset.i]; }); });
      totals();
    };
    d.querySelector("#ys").value = tot("sales") || ""; d.querySelector("#yg").value = tot("gp") || "";
    f.basis.onchange = () => { if (isNew && bands.every((b, i) => B.defaults[f.basis.value === "gp" ? "sales" : "gp"][i] && b.rate === B.defaults[f.basis.value === "gp" ? "sales" : "gp"][i].rate)) bands = B.defaults[f.basis.value].map(x => ({ ...x })); drawB(); ote(); };
    d.querySelector("#addB").onclick = () => { const last = bands[bands.length - 1]; bands.push({ from: last.from + 50, rate: r2(last.rate * 1.5) }); drawB(); ote(); };
    drawB(); totals();
    if (d.querySelector("#delP")) d.querySelector("#delP").onclick = async () => { if (!(await confirmBox("Delete plan", `Delete ${esc(p.name || p.email)}'s ${year} plan? Their commission for ${year} stops being worked out.`, "Delete", true))) return; const r = await act(d.querySelector("#delP"), () => api("DELETE", `sales/plans/${year}/${encodeURIComponent(p.email)}`), "Plan deleted"); if (r !== undefined) { done(true); PERF = null; PEOPLE = null; route(); } };
    f.onsubmit = async e => {
      e.preventDefault(); d.querySelector("#pe").textContent = "";
      const email = isNew ? f.email.value.trim().toLowerCase() : p.email;
      const pl = ppl.find(x => x.email === email);
      try { busy(f.querySelector(".primary"), true);
        await api("PUT", `sales/plans/${year}/${encodeURIComponent(email)}`, { name: f.name.value.trim() || (pl ? pl.name : ""), basis: f.basis.value, bands, targets: T, note: f.note.value });
        toast("Plan saved"); done(true); PERF = null; PEOPLE = null; route();
      } catch (err) { d.querySelector("#pe").textContent = err.message; } finally { busy(f.querySelector(".primary"), false); }
    };
  } });
}

/* ---------- account managers ---------- */
async function accounts() {
  if (!B.isManager) return go("#/performance");
  const [list, ppl, custs] = await Promise.all([api("GET", "sales/accounts"), people(), api("GET", "customers").catch(() => [])]);
  const mineCo = (Array.isArray(custs) ? custs : custs.customers || []).filter(c => !c.co || c.co === B.company.key);
  const opt = sel => ppl.map(p => `<option value="${esc(p.email)}"${p.email === sel ? " selected" : ""}>${esc(p.name)}</option>`).join("");
  const taken = new Set(list.map(a => a.customerId));
  page("Account managers", B.company.name, `<button type="button" class="primary" id="addA">+ Account manager</button>`, `
    <div class="note" style="margin-bottom:14px"><b>Named accounts</b>Invoices for these customers are credited to their account manager unless the invoice came from someone else's deal, or a manager assigns it differently.</div>
    <section class="card listpanel"><div class="tblwrap"><table class="list nohover"><thead><tr><th>Customer</th><th>Account manager</th><th></th></tr></thead>
      <tbody>${list.map(a => `<tr><td><b>${esc(a.customer || a.customerId)}</b></td><td><select data-c="${esc(a.customerId)}" data-n="${esc(a.customer)}" aria-label="Account manager for ${esc(a.customer)}">${opt(a.email)}${ppl.some(p => p.email === a.email) ? "" : `<option selected value="${esc(a.email)}">${esc(a.email)}</option>`}</select></td><td class="r"><button type="button" data-rm="${esc(a.customerId)}">Remove</button></td></tr>`).join("") || `<tr><td colspan="3"><div class="empty">No account managers yet. They are also set when you credit an invoice and tick "Make this person the account manager".</div></td></tr>`}</tbody></table></div></section>`, "accounts");
  document.querySelectorAll("select[data-c]").forEach(s => s.onchange = () => act(s, () => api("PUT", "sales/accounts/" + s.dataset.c, { email: s.value, customer: s.dataset.n }), "Account manager changed"));
  document.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => { const r = await act(b, () => api("DELETE", "sales/accounts/" + b.dataset.rm), "Removed"); if (r) route(); });
  $("addA").onclick = () => dialog(`<form><h3>Add an account manager</h3>
    <label><span class="lbl">Customer</span><input name="c" list="cl" required placeholder="Start typing a customer" autocomplete="off"><datalist id="cl">${mineCo.filter(c => !taken.has(c.id)).map(c => `<option value="${esc(c.name)}"></option>`).join("")}</datalist></label>
    <label><span class="lbl">Account manager</span><select name="e" required><option value="">Choose…</option>${opt("")}</select></label>
    <div class="err" id="ae"></div><div class="foot"><button type="button" data-x>Cancel</button><button class="primary">Save</button></div></form>`, { onOpen: (d, done) => {
    d.querySelector("form").onsubmit = async e => { e.preventDefault(); const f = e.target; const c = mineCo.find(x => x.name.toLowerCase() === f.c.value.trim().toLowerCase());
      if (!c) { d.querySelector("#ae").textContent = "Choose a customer from the list."; return; }
      try { await api("PUT", "sales/accounts/" + c.id, { email: f.e.value, customer: c.name }); toast("Account manager set"); done(true); route(); } catch (err) { d.querySelector("#ae").textContent = err.message; } };
  } });
}

/* ---------- router ---------- */
async function route() {
  if (!B) return;
  const [a, b, c] = location.hash.replace(/^#\/?/, "").split("?")[0].split("/").map(x => { try { return decodeURIComponent(x); } catch { return x; } });
  try {
    if (!a || a === "performance") return await performance();
    if (a === "person" && b) return await person(b);
    if (a === "statements") return await statements(b);
    if (a === "statement" && b && c) return await statement(b, c);
    if (a === "credits") return await credits();
    if (a === "plans") return await plans();
    if (a === "accounts") return await accounts();
    go("#/performance");
  } catch (e) { console.error(e); $("app").innerHTML = `<div class="empty"><strong>Couldn't load this page</strong>${esc(e.message)}</div>`; }
}
async function boot() {
  try { B = await api("GET", "sales/bootstrap"); }
  catch (e) { $("app").innerHTML = `<div class="empty"><strong>${e.status === 403 ? "No access" : e.status === 400 ? "Choose a company" : "Couldn't load Targets & Commission"}</strong>${esc(e.message)}</div>`; return; }
  route();
}
window.addEventListener("hashchange", route);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
