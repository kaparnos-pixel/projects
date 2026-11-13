/* ===== Proposal figure: site layout traced from the customer's plan (optional) and the logical network topology =====
 * Data (from Claude, editable by redrawing):
 *   { title, caption, topology: { tiers: [[{ id, label, sub, kind, dashed }]], links: [{ from, to, label, style }] },
 *     networks: [string], site: null | { areas: [{ label, x, y, w, h, plain }], devices: [{ id, label, sub, kind, x, y }],
 *     links: [{ from, to, style }], notes: [{ title, text, x, y }] } }   (site coordinates are 0-100 percentages)
 * Older drafts with { nodes, edges } are converted to tiers. Draws an SVG for the page and a PNG for Word.
 */
const PROPDIAG = (function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fit = (s, n) => { s = String(s || "").replace(/\s*[—–]\s*/g, ", "); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const FONT = "Arial, Helvetica, sans-serif";
  const LINK = { cat6: { c: "#2A9D8F", d: "" }, outdoor: { c: "#E07B24", d: "" }, fibre: { c: "#6D4C9F", d: "5 4" }, wan: { c: "#5B6670", d: "" }, mgmt: { c: "#8A97A3", d: "4 3" } };
  const LINK_NAME = { cat6: "Cat6 cabling", outdoor: "Outdoor Cat6 cabling", fibre: "Fibre backbone", wan: "Internet / WAN", mgmt: "Management / remote access" };

  function palette(c) {
    const P = c.primary || "#003C50";
    return {
      firewall: ["#C8102E", "#fff"], router: ["#C8102E", "#fff"], core: [P, "#fff"], switch: [P, "#fff"],
      ap: [c.accent2 || "#2A9D8F", "#fff"], apout: ["#E07B24", "#fff"], cloud: ["#E9EEF1", "#22313F"], isp: ["#E9EEF1", "#22313F"], mgmt: ["#FFFFFF", "#22313F"],
      server: ["#4A6378", "#fff"], storage: ["#4A6378", "#fff"], nvr: ["#4A6378", "#fff"], pbx: ["#4A6378", "#fff"], ups: ["#8A6D3B", "#fff"],
      camera: ["#6B7C8F", "#fff"], phone: ["#6B7C8F", "#fff"], pc: ["#6B7C8F", "#fff"], printer: ["#6B7C8F", "#fff"], access: ["#6B7C8F", "#fff"], display: ["#6B7C8F", "#fff"], other: ["#6B7C8F", "#fff"],
    };
  }
  const KIND_NAME = { firewall: "Firewall", router: "Router", core: "Core switch", switch: "Switch", ap: "Indoor access point", apout: "Outdoor access point", cloud: "Internet / cloud", isp: "Internet / ISP", mgmt: "Management (optional)", server: "Server", storage: "Storage", nvr: "Recorder", pbx: "PBX", ups: "UPS", camera: "Camera", phone: "Phone", pc: "Workstation", printer: "Printer", access: "Access control", display: "Display", other: "Device" };

  // Old { nodes, edges } drafts become tiers.
  function normalise(d) {
    if (!d) return null;
    if (d.topology && Array.isArray(d.topology.tiers)) return d;
    if (!Array.isArray(d.nodes)) return null;
    const by = new Map(); d.nodes.forEach(n => { const t = Number(n.tier) || 0; if (!by.has(t)) by.set(t, []); by.get(t).push({ id: n.id, label: n.label, sub: n.sub, kind: n.kind === "wifi" ? "switch" : n.kind }); });
    return { title: d.title, caption: d.caption, networks: d.networks || [], site: null,
      topology: { tiers: [...by.keys()].sort((a, b) => a - b).map(k => by.get(k)), links: (d.edges || []).map(e => ({ from: e.from, to: e.to, label: e.label, style: /power/i.test(e.label || "") ? "mgmt" : /fib/i.test(e.label || "") ? "fibre" : "cat6" })) } };
  }

  /* ---------- logical topology panel ---------- */
  function topology(d, c, x0, y0, W) {
    const pal = palette(c), out = [], T = d.topology, tiers = (T.tiers || []).filter(t => t && t.length).slice(0, 9);
    const BH = 40, GAP = 36, pad = 14; let y = y0 + 34;
    const pos = new Map();
    out.push(`<text x="${x0 + pad}" y="${y0 + 20}" font-size="11.5" font-weight="700" fill="${c.primary}" letter-spacing=".5">LOGICAL TOPOLOGY</text>`);
    tiers.forEach(row => {
      row = row.slice(0, 3); const n = row.length, inner = W - 2 * pad, gap = 10;
      const bw = n === 1 ? Math.min(250, inner) : (inner - gap * (n - 1)) / n;
      const start = x0 + pad + (inner - (bw * n + gap * (n - 1))) / 2;
      row.forEach((b, i) => pos.set(b.id, { x: start + i * (bw + gap), y, w: bw, h: BH, b }));
      y += BH + GAP;
    });
    const H = y - GAP + 10 - y0;
    // links first, under the boxes
    const used = new Set();
    (T.links || []).forEach(l => {
      const a = pos.get(l.from), b = pos.get(l.to); if (!a || !b) return;
      const st = LINK[l.style] ? l.style : "cat6"; used.add(st); const s = LINK[st];
      let path, lx, ly;
      if (Math.abs(a.y - b.y) < 1) { const [p, q] = a.x < b.x ? [a, b] : [b, a]; path = `M${p.x + p.w},${p.y + BH / 2} L${q.x},${q.y + BH / 2}`; lx = (p.x + p.w + q.x) / 2; ly = p.y + BH / 2 - 5; }
      else { const [t, u] = a.y < b.y ? [a, b] : [b, a]; const x1 = t.x + t.w / 2, x2 = u.x + u.w / 2, y1 = t.y + BH, y2 = u.y, my = (y1 + y2) / 2;
        path = Math.abs(x1 - x2) < 1 ? `M${x1},${y1} L${x2},${y2}` : `M${x1},${y1} L${x1},${my} L${x2},${my} L${x2},${y2}`; lx = x2 + 6; ly = my + (Math.abs(x1 - x2) < 1 ? 4 : 13); }
      out.push(`<path d="${path}" fill="none" stroke="${s.c}" stroke-width="1.8"${s.d ? ` stroke-dasharray="${s.d}"` : ""}/>`);
      if (l.label) out.push(`<text x="${lx}" y="${ly}" font-size="8.5" fill="#5B6670">${esc(fit(l.label, 34))}</text>`);
    });
    const kinds = new Set();
    pos.forEach(p => {
      const k = pal[p.b.kind] ? p.b.kind : "other"; kinds.add(k); const [bg, fg] = pal[k]; const dash = p.b.dashed || k === "mgmt";
      const fill = dash ? "#fff" : bg, txt = dash ? "#22313F" : fg, stroke = dash ? (c.accent || "#28A08C") : bg;
      const chars = Math.max(8, Math.floor(p.w / 6.4));
      out.push(`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${BH}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.2"${dash ? ' stroke-dasharray="4 3"' : ""}/>`);
      out.push(`<text x="${p.x + p.w / 2}" y="${p.y + (p.b.sub ? 16 : 24)}" font-size="10.5" font-weight="700" fill="${txt}" text-anchor="middle">${esc(fit(p.b.label, chars))}</text>`);
      if (p.b.sub) out.push(`<text x="${p.x + p.w / 2}" y="${p.y + 30}" font-size="8.8" fill="${txt}" opacity=".9" text-anchor="middle">${esc(fit(p.b.sub, Math.floor(p.w / 5.2)))}</text>`);
    });
    return { svg: out.join(""), h: H, kinds, used };
  }

  function legendBlock(d, c, kinds, used, x0, y0, W) {
    const pal = palette(c), out = []; let y = y0;
    if ((d.networks || []).length) {
      out.push(`<text x="${x0}" y="${y}" font-size="10.5" font-weight="700" fill="${c.primary}">NETWORKS</text>`); y += 14;
      d.networks.slice(0, 5).forEach(n => { out.push(`<text x="${x0}" y="${y}" font-size="9" fill="#33414E">${esc(fit(n, Math.floor(W / 5)))}</text>`); y += 12.5; });
      y += 10;
    }
    out.push(`<text x="${x0}" y="${y}" font-size="10.5" font-weight="700" fill="${c.primary}">LEGEND</text>`); y += 14;
    [...kinds].filter(k => k !== "cloud" && k !== "isp").forEach(k => { const [bg] = pal[k]; const dash = k === "mgmt";
      out.push(k === "ap" || k === "apout" ? `<circle cx="${x0 + 5}" cy="${y - 3.5}" r="4.5" fill="${bg}"/>` : `<rect x="${x0}" y="${y - 8}" width="10" height="9" rx="1.5" fill="${dash ? "#fff" : bg}" stroke="${dash ? c.accent : bg}"${dash ? ' stroke-dasharray="2 2"' : ""}/>`);
      out.push(`<text x="${x0 + 16}" y="${y}" font-size="9" fill="#33414E">${esc(KIND_NAME[k] || k)}</text>`); y += 13; });
    [...used].forEach(st => { const s = LINK[st]; out.push(`<line x1="${x0}" y1="${y - 3.5}" x2="${x0 + 11}" y2="${y - 3.5}" stroke="${s.c}" stroke-width="2"${s.d ? ` stroke-dasharray="3 2"` : ""}/>`, `<text x="${x0 + 16}" y="${y}" font-size="9" fill="#33414E">${esc(LINK_NAME[st])}</text>`); y += 13; });
    return { svg: out.join(""), h: y - y0 };
  }

  /* ---------- site layout panel ---------- */
  function site(S, c, x0, y0, W, H) {
    const pal = palette(c), out = [];
    const px = x => x0 + 18 + Math.max(0, Math.min(100, Number(x) || 0)) / 100 * (W - 36), py = y => y0 + 44 + Math.max(0, Math.min(100, Number(y) || 0)) / 100 * (H - 60);
    out.push(`<text x="${x0 + 14}" y="${y0 + 20}" font-size="11.5" font-weight="700" fill="${c.primary}" letter-spacing=".5">SITE LAYOUT</text>`, `<text x="${x0 + 14}" y="${y0 + 32}" font-size="8.5" fill="#8A97A3">Traced from the site plan - not to scale</text>`);
    (S.areas || []).slice(0, 30).forEach(a => { const x = px(a.x), y = py(a.y), w = Math.max(14, (Number(a.w) || 10) / 100 * (W - 36)), h = Math.max(12, (Number(a.h) || 10) / 100 * (H - 60));
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${a.plain ? "#F3F4F5" : "#EEF3F6"}" stroke="${a.plain ? "#C9CED3" : c.primary}" stroke-width="${a.plain ? 1 : 1.3}"/>`);
      if (a.label && !a.plain) out.push(`<text x="${x + w / 2}" y="${y + h - 8}" font-size="8.8" font-weight="700" fill="${c.primary}" text-anchor="middle">${esc(fit(a.label, Math.floor(w / 5.6)))}</text>`); });
    const dev = new Map((S.devices || []).slice(0, 40).map(d => [d.id, { ...d, X: px(d.x), Y: py(d.y) }]));
    (S.links || []).slice(0, 60).forEach(l => { const a = dev.get(l.from), b = dev.get(l.to); if (!a || !b) return; const s = LINK[l.style] || LINK.cat6;
      out.push(`<path d="M${a.X},${a.Y} L${b.X},${a.Y} L${b.X},${b.Y}" fill="none" stroke="${s.c}" stroke-width="2"${s.d ? ` stroke-dasharray="${s.d}"` : ""}/>`); });
    (S.notes || []).slice(0, 10).forEach(n => { const x = px(n.x), y = py(n.y), w = Math.max(90, Math.max(String(n.title || "").length * 6.4, String(n.text || "").length * 5) + 14);
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${n.text ? 26 : 16}" rx="3" fill="#fff" stroke="#C9CED3"/>`, `<text x="${x + 6}" y="${y + 11}" font-size="9" font-weight="700" fill="${c.primary}">${esc(fit(n.title, 30))}</text>`);
      if (n.text) out.push(`<text x="${x + 6}" y="${y + 21}" font-size="8" fill="#5B6670">${esc(fit(n.text, 36))}</text>`); });
    // Device symbols first, then their callouts, placed where they don't cover another symbol or callout.
    const boxes = []; dev.forEach(d => boxes.push({ x: d.X - 12, y: d.Y - 10, w: 24, h: 20 }));
    (S.notes || []).slice(0, 10).forEach(n => boxes.push({ x: px(n.x), y: py(n.y), w: 120, h: 26 }));
    const hit = r => boxes.some(b => r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y);
    dev.forEach(d => {
      const k = pal[d.kind] ? d.kind : "other", [bg] = pal[k];
      if (k === "ap" || k === "apout" || k === "camera") out.push(`<circle cx="${d.X}" cy="${d.Y}" r="8.5" fill="${bg}"/><path d="M${d.X - 4},${d.Y - 0.5} a5.5 5.5 0 0 1 8 0 M${d.X - 2},${d.Y + 1.8} a2.8 2.8 0 0 1 4 0" fill="none" stroke="#fff" stroke-width="1.3"/><circle cx="${d.X}" cy="${d.Y + 4}" r="1.1" fill="#fff"/>`);
      else if (k === "firewall" || k === "router") out.push(`<rect x="${d.X - 11}" y="${d.Y - 7}" width="22" height="14" rx="2" fill="${bg}"/><text x="${d.X}" y="${d.Y + 3.5}" font-size="8" font-weight="700" fill="#fff" text-anchor="middle">FW</text>`);
      else out.push(`<rect x="${d.X - 11}" y="${d.Y - 7}" width="22" height="14" rx="2" fill="${bg}"/>${[-6, -2, 2, 6].map(o => `<rect x="${d.X + o - 1.2}" y="${d.Y - 1.2}" width="2.4" height="2.4" fill="#fff"/>`).join("")}`);
    });
    dev.forEach(d => {
      if (!d.label && !d.sub) return;
      const lw = Math.max(String(d.label || "").length * 6.6, String(d.sub || "").length * 5) + 12, lh = d.sub ? 25 : 15;
      const tries = [[d.X + 13, d.Y + 6], [d.X + 13, d.Y - 6 - lh], [d.X - 13 - lw, d.Y + 6], [d.X - 13 - lw, d.Y - 6 - lh], [d.X - lw / 2, d.Y + 12], [d.X - lw / 2, d.Y - 12 - lh]]
        .map(([x, y]) => ({ x: Math.max(x0 + 4, Math.min(x, x0 + W - lw - 4)), y: Math.max(y0 + 38, Math.min(y, y0 + H - lh - 4)), w: lw, h: lh }));
      const r = tries.find(t => !hit(t)) || tries[0]; boxes.push(r);
      out.push(`<rect x="${r.x}" y="${r.y}" width="${lw}" height="${lh}" rx="3" fill="#fff" stroke="#C9CED3"/>`, `<text x="${r.x + 6}" y="${r.y + 11}" font-size="9.5" font-weight="700" fill="${c.primary}">${esc(fit(d.label, 26))}</text>`);
      if (d.sub) out.push(`<text x="${r.x + 6}" y="${r.y + 21}" font-size="8" fill="#5B6670">${esc(fit(d.sub, 34))}</text>`);
    });
    return out.join("");
  }

  function svg(raw, c) {
    const d = normalise(raw); if (!d || !d.topology || !(d.topology.tiers || []).some(t => t && t.length)) return null;
    c = Object.assign({ primary: "#003C50", accent: "#28A08C" }, c || {});
    const hasSite = d.site && (d.site.areas || []).length + (d.site.devices || []).length > 0;
    const TW = hasSite ? 300 : 360, SW = hasSite ? 600 : 0, G = hasSite ? 14 : 0;
    const top = topology(d, c, SW + G, 0, TW);
    const leg = legendBlock(d, c, top.kinds, top.used, SW + G + 14, top.h + 18, TW - 28);
    const PH = top.h + leg.h + 30;
    const H = Math.max(PH, hasSite ? 470 : 0), W = SW + G + TW;
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">`, `<rect width="${W}" height="${H}" fill="#fff"/>`];
    if (hasSite) out.push(`<rect x="0.5" y="0.5" width="${SW - 1}" height="${H - 1}" rx="6" fill="#FAFBFC" stroke="#D5DBE0"/>`, site(d.site, c, 0, 0, SW, H));
    out.push(`<rect x="${SW + G + 0.5}" y="0.5" width="${TW - 1}" height="${H - 1}" rx="6" fill="#fff" stroke="#D5DBE0"/>`, top.svg, leg.svg, `</svg>`);
    return { svg: out.join(""), w: W, h: H };
  }

  async function png(d, c, scale = 2.5) {
    const r = svg(d, c); if (!r) return null;
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(r.svg);
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("The diagram couldn't be drawn.")); i.src = url; });
    const cv = document.createElement("canvas"); cv.width = Math.round(r.w * scale); cv.height = Math.round(r.h * scale);
    const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
    const blob = await new Promise(res => cv.toBlob(res, "image/png"));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), w: r.w, h: r.h };
  }
  return { svg, png, normalise };
})();
