/* ===== System diagram for completion reports: lays out nodes in tiers and draws an SVG (screen, Word and PDF) ===== */
const PCRDIAGRAM = (function () {
  const KINDS = {
    cloud: "Internet", isp: "ISP / WAN", firewall: "Firewall", router: "Router", core: "Core switch", switch: "Switch", wifi: "Wireless controller", ap: "Access point",
    server: "Server", storage: "Storage", nvr: "NVR / recorder", camera: "Camera", pbx: "PBX", phone: "Phone", pc: "Workstation", printer: "Printer",
    ups: "UPS", rack: "Rack", access: "Access control", display: "Display", other: "Device",
  };
  // 24 x 24 line icons, drawn in the brand colour.
  const ICON = {
    cloud: '<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.5 4.3 4.3 0 0 0 7 18z"/>',
    isp: '<path d="M4 20h16M7 20l5-14 5 14M9.5 13h5M12 6V3M8.5 4.5a5 5 0 0 1 7 0"/>',
    firewall: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 10h18M3 15h18M9 5v5M15 10v5M9 15v4"/>',
    router: '<rect x="3" y="12" width="18" height="7" rx="2"/><path d="M7 15.5h.01M11 15.5h.01M8 12V9M16 12V9M6 6a8 8 0 0 1 12 0"/>',
    core: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M6 7.5h6M6 16.5h6M16 7.5h2M16 16.5h2"/>',
    switch: '<rect x="2.5" y="8" width="19" height="8" rx="1.5"/><path d="M5.5 12h1M8.5 12h1M11.5 12h1M14.5 12h1M17.5 12h1"/>',
    wifi: '<rect x="5" y="13" width="14" height="7" rx="1.5"/><path d="M8 16.5h.01M5 9a10 10 0 0 1 14 0M8 11a6 6 0 0 1 8 0"/>',
    ap: '<circle cx="12" cy="14" r="5"/><path d="M12 14h.01M6 6.5a9 9 0 0 1 12 0M8.5 9a5.5 5.5 0 0 1 7 0"/>',
    server: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 9h16M4 15h16M7.5 6h.01M7.5 12h.01M7.5 18h.01M11 6h6M11 12h6M11 18h6"/>',
    storage: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    nvr: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><circle cx="8" cy="12" r="2"/><path d="M13 10.5h5M13 13.5h3"/>',
    camera: '<path d="M3 8l12-3 2 6-12 3z"/><path d="M10 13l1.5 4.5M7 20h8M17 9l4-1"/>',
    pbx: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M7 8h10M7 12h.01M10 12h.01M13 12h.01M16 12h.01M7 16h.01M10 16h.01M13 16h.01M16 16h.01"/>',
    phone: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8v4H8zM8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 17.5h.01M12 17.5h.01M15.5 17.5h.01"/>',
    pc: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/>',
    printer: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/>',
    ups: '<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M13 7l-3 5h4l-3 5"/>',
    rack: '<rect x="5" y="2.5" width="14" height="19" rx="1"/><path d="M5 7h14M5 11.5h14M5 16h14M8 4.75h.01M8 9.25h.01M8 13.75h.01M8 18.75h.01"/>',
    access: '<rect x="7" y="3" width="10" height="18" rx="1.5"/><circle cx="12" cy="9" r="2"/><path d="M10 15h4M10 18h4"/>',
    display: '<rect x="2.5" y="4" width="19" height="12" rx="1"/><path d="M8 20h8M12 16v4"/>',
    other: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 12h8"/>',
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fit = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  // Positions every node: one row per tier (empty tiers removed), nodes centred in their row,
  // ordered so that nodes sit under the parents they link to (fewer crossing lines).
  function layout(d) {
    const NW = 176, NH = 64, GX = 60, GY = 92, PAD = 28, TOPPAD = 24;
    const nodes = (d.nodes || []).map(n => ({ ...n }));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const tiers = [...new Set(nodes.map(n => n.tier || 0))].sort((a, b) => a - b);
    const rows = tiers.map(t => nodes.filter(n => (n.tier || 0) === t));
    const parents = id => (d.edges || []).filter(e => e.to === id && byId.has(e.from)).map(e => byId.get(e.from)).concat((d.edges || []).filter(e => e.from === id && byId.has(e.to)).map(e => byId.get(e.to)));
    const maxN = Math.max(1, ...rows.map(r => r.length));
    const W = Math.max(720, PAD * 2 + maxN * NW + (maxN - 1) * GX);
    rows.forEach((row, ri) => {
      if (ri > 0) {
        // Barycentre ordering against the row above.
        const above = rows[ri - 1];
        row.forEach(n => { const ps = parents(n.id).filter(p => above.includes(p)); n._k = ps.length ? ps.reduce((a, p) => a + p.x, 0) / ps.length : W / 2; });
        row.sort((a, b) => a._k - b._k);
      }
      const total = row.length * NW + (row.length - 1) * GX;
      let x = (W - total) / 2;
      row.forEach(n => { n.x = x + NW / 2; n.y = TOPPAD + ri * (NH + GY) + NH / 2; x += NW + GX; });
    });
    const H = TOPPAD * 2 + rows.length * NH + Math.max(0, rows.length - 1) * GY + 18;
    return { nodes, byId, W, H, NW, NH };
  }

  // c: colours { primary, accent, soft, line, text, muted, bg }
  function svg(d, c) {
    c = Object.assign({ primary: "#1E5A8C", accent: "#D81F2A", soft: "#E8F0F7", line: "#8FA6BC", text: "#1F2733", muted: "#5E6B7A", bg: "#FFFFFF" }, c || {});
    if (!d || !(d.nodes || []).length) return null;
    const L = layout(d);
    const { W, H, NW, NH } = L;
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Arial, Helvetica, sans-serif">`);
    out.push(`<rect width="${W}" height="${H}" fill="${c.bg}"/>`);
    const labels = [];
    (d.edges || []).forEach(e => {
      const a = L.byId.get(e.from), b = L.byId.get(e.to); if (!a || !b) return;
      const power = /power/i.test(e.label || "");
      const dash = power ? ' stroke-dasharray="5 4"' : "";
      let path, lx, ly;
      if (Math.abs(a.y - b.y) < 1) {
        const [l, r] = a.x < b.x ? [a, b] : [b, a];
        path = `M${l.x + NW / 2},${l.y} L${r.x - NW / 2},${r.y}`; lx = (l.x + r.x) / 2; ly = l.y - 8;
      } else {
        const [t, u] = a.y < b.y ? [a, b] : [b, a];
        const y1 = t.y + NH / 2, y2 = u.y - NH / 2, my = (y1 + y2) / 2;
        path = Math.abs(t.x - u.x) < 1 ? `M${t.x},${y1} L${u.x},${y2}` : `M${t.x},${y1} L${t.x},${my} L${u.x},${my} L${u.x},${y2}`;
        lx = u.x; ly = my + (y2 - my) / 2 + 4;
      }
      out.push(`<path d="${path}" fill="none" stroke="${power ? c.accent : c.line}" stroke-width="2"${dash} stroke-linejoin="round"/>`);
      if (e.label) labels.push({ x: lx, y: ly, t: fit(e.label, 22) });
    });
    labels.forEach(l => {
      const w = Math.max(28, l.t.length * 6.2 + 12);
      out.push(`<rect x="${l.x - w / 2}" y="${l.y - 11}" width="${w}" height="16" rx="8" fill="${c.bg}" stroke="${c.line}" stroke-width="1"/>`);
      out.push(`<text x="${l.x}" y="${l.y + 1}" font-size="10.5" fill="${c.muted}" text-anchor="middle">${esc(l.t)}</text>`);
    });
    L.nodes.forEach(n => {
      const x = n.x - NW / 2, y = n.y - NH / 2;
      out.push(`<g><rect x="${x}" y="${y}" width="${NW}" height="${NH}" rx="10" fill="${c.bg}" stroke="${c.primary}" stroke-width="1.6"/>`);
      out.push(`<rect x="${x}" y="${y}" width="5" height="${NH}" rx="2.5" fill="${c.accent}"/>`);
      out.push(`<rect x="${x + 14}" y="${n.y - 18}" width="36" height="36" rx="9" fill="${c.soft}"/>`);
      out.push(`<g transform="translate(${x + 20},${n.y - 12})" fill="none" stroke="${c.primary}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[n.kind] || ICON.other}</g>`);
      const sub = n.sub || KINDS[n.kind] || "";
      out.push(`<text x="${x + 60}" y="${n.y - (sub ? 3 : -4)}" font-size="12.5" font-weight="700" fill="${c.text}">${esc(fit(n.label, 19))}</text>`);
      if (sub) out.push(`<text x="${x + 60}" y="${n.y + 13}" font-size="10.5" fill="${c.muted}">${esc(fit(sub, 22))}</text>`);
      out.push(`</g>`);
    });
    out.push(`</svg>`);
    return { svg: out.join(""), w: W, h: H };
  }

  // Draws the SVG onto a canvas and returns PNG bytes for Word and PDF.
  async function png(d, c, scale = 2) {
    const r = svg(d, c); if (!r) return null;
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(r.svg);
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("The diagram couldn't be drawn.")); i.src = url; });
    const cv = document.createElement("canvas"); cv.width = Math.round(r.w * scale); cv.height = Math.round(r.h * scale);
    const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
    const blob = await new Promise(res => cv.toBlob(res, "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { bytes, w: r.w, h: r.h, dataUrl: cv.toDataURL("image/png"), fmt: "PNG", type: "png" };
  }

  return { KINDS, svg, png, layout };
})();
if (typeof module !== "undefined") module.exports = PCRDIAGRAM;
