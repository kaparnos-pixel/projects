// Social image cards: a branded 1080 x 1080 JPEG for each post, drawn from an SVG with the company's own palette
// and logo (Bifold steel blue and red, Tech Hub navy and teal). Four layouts rotate so the feed doesn't repeat.
// JPEG because Instagram only accepts JPEG; the same image goes to Facebook, LinkedIn, X and Google.
const fs = require("fs");
const path = require("path");

const A = path.join(__dirname, "assets");
const FONTS = ["Poppins-Bold.ttf", "Poppins-Medium.ttf", "Poppins-Regular.ttf"].map(f => path.join(A, "fonts", f));
const LOGO = {};
const logo = co => LOGO[co] || (LOGO[co] = "data:image/png;base64," + fs.readFileSync(path.join(A, co === "techhub" ? "techhub.png" : "bifold.png")).toString("base64"));
const LOGO_RATIO = { bifold: 295 / 75, techhub: 440 / 120 };

const PAL = {
  bifold: { navy: "#1E5A8C", navy2: "#174A75", deep: "#123A5E", accent: "#D81F2A", soft: "#E2ECF5", onNavy: "#D6E4F1", kicker: "#FFC9CC", bold: "#C41A24" },
  techhub: { navy: "#003C50", navy2: "#0B4E63", deep: "#002A38", accent: "#28A08C", soft: "#E6F4F2", onNavy: "#BFDCE0", kicker: "#8FE0D0", bold: "#1E8573" },
};
const LAYOUTS = ["navy", "light", "split", "bold"];

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Rough Poppins widths (em) so text wraps without a layout engine.
function width(s, size, bold) {
  let w = 0;
  for (const ch of s) {
    if ("il.,:;'|!".includes(ch)) w += 0.27; else if (ch === " ") w += 0.28;
    else if ("mwMW".includes(ch)) w += 0.88; else if (/[A-Z]/.test(ch)) w += 0.68;
    else if (/[0-9]/.test(ch)) w += 0.62; else if ("frtj".includes(ch)) w += 0.38; else w += 0.58;
  }
  return w * size * (bold ? 1.04 : 1);
}
function wrap(text, size, max, bold) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ");
  const lines = []; let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (cur && width(t, size, bold) > max) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
// Largest size from the list at which the text fits in maxLines.
function fit(text, sizes, max, maxLines, bold) {
  for (const s of sizes) { const l = wrap(text, s, max, bold); if (l.length <= maxLines) return { size: s, lines: l }; }
  const s = sizes[sizes.length - 1]; const l = wrap(text, s, max, bold).slice(0, maxLines);
  l[l.length - 1] = l[l.length - 1].replace(/\s*\S*$/, "") + "…";
  return { size: s, lines: l };
}
const tspans = (lines, x, y, lh) => lines.map((l, i) => `<tspan x="${x}" y="${y + i * lh}">${esc(l)}</tspan>`).join("");

function svg(co, o, layout) {
  const P = PAL[co] || PAL.bifold;
  const W = 1080, M = 88, TW = W - 2 * M;
  const k = String(o.kicker || "").toUpperCase().slice(0, 40);
  const site = String(o.website || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const lw = co === "techhub" ? 250 : 270, lh = Math.round(lw / LOGO_RATIO[co === "techhub" ? "techhub" : "bifold"]);
  const L = logo(co);
  const font = `font-family="Poppins"`;
  let body = "";
  if (layout === "light") {
    const h = fit(o.headline, [76, 70, 64, 58, 52], TW - 40, 5, true);
    const s = fit(o.sub, [34, 31, 28], TW - 40, 3);
    const hy = 420 - (h.lines.length - 3) * 30;
    body = `<rect width="1080" height="1080" fill="#ffffff"/>
<circle cx="1010" cy="120" r="260" fill="${P.soft}"/><circle cx="1010" cy="120" r="150" fill="none" stroke="${P.accent}" stroke-width="3" opacity=".5"/>
<image href="${L}" x="${M}" y="${M}" width="${lw}" height="${lh}"/>
<rect x="${M}" y="${hy - h.size - 70}" width="10" height="${h.lines.length * h.size * 1.16 + 70}" fill="${P.accent}"/>
${k ? `<text x="${M + 40}" y="${hy - h.size - 40}" ${font} font-weight="700" font-size="26" letter-spacing="4" fill="${P.accent}">${esc(k)}</text>` : ""}
<text ${font} font-weight="700" font-size="${h.size}" fill="${P.navy}">${tspans(h.lines, M + 40, hy, Math.round(h.size * 1.16))}</text>
<text ${font} font-weight="400" font-size="${s.size}" fill="#3C4B58">${tspans(s.lines, M + 40, hy + h.lines.length * h.size * 1.16 + 40, Math.round(s.size * 1.4))}</text>
<rect x="0" y="960" width="1080" height="120" fill="${P.navy}"/>
<text x="${M}" y="1030" ${font} font-weight="500" font-size="30" fill="#ffffff">${esc(site)}</text>
<rect x="${W - M - 120}" y="1014" width="120" height="8" fill="${P.accent}"/>`;
  } else if (layout === "split") {
    const h = fit(o.headline, [70, 64, 58, 52], TW, 4, true);
    const s = fit(o.sub, [32, 29, 27], TW - 280, 3);
    const kw = k ? width(k, 24, true) + 48 + k.length * 3 : 0;
    body = `<rect width="1080" height="1080" fill="${P.soft}"/>
<rect width="1080" height="680" fill="${P.navy}"/>
<path d="M0 680 L1080 600 L1080 680 Z" fill="${P.soft}"/>
<circle cx="980" cy="90" r="190" fill="${P.navy2}"/><circle cx="1040" cy="40" r="110" fill="${P.accent}" opacity=".85"/>
${k ? `<rect x="${M}" y="${150}" rx="28" width="${kw}" height="56" fill="${P.accent}"/><text x="${M + 24}" y="${187}" ${font} font-weight="700" font-size="24" letter-spacing="3" fill="#ffffff">${esc(k)}</text>` : ""}
<text ${font} font-weight="700" font-size="${h.size}" fill="#ffffff">${tspans(h.lines, M, 300, Math.round(h.size * 1.16))}</text>
<text ${font} font-weight="400" font-size="${s.size}" fill="${P.navy}">${tspans(s.lines, M, 790, Math.round(s.size * 1.4))}</text>
<rect x="${W - M - lw - 40}" y="${930 - lh / 2 - 26}" rx="18" width="${lw + 40}" height="${lh + 52}" fill="#ffffff"/>
<image href="${L}" x="${W - M - lw - 20}" y="${930 - lh / 2}" width="${lw}" height="${lh}"/>
<text x="${M}" y="990" ${font} font-weight="500" font-size="28" fill="${P.navy}">${esc(site)}</text>`;
  } else if (layout === "bold") {
    const h = fit(o.headline, [88, 80, 72, 64, 58], TW, 5, true);
    const s = fit(o.sub, [33, 30, 28], TW, 2);
    const hy = 330 + Math.max(0, 4 - h.lines.length) * 30;
    body = `<rect width="1080" height="1080" fill="${P.bold}"/>
<circle cx="900" cy="980" r="420" fill="none" stroke="#ffffff" stroke-width="2" opacity=".18"/><circle cx="900" cy="980" r="300" fill="none" stroke="#ffffff" stroke-width="2" opacity=".18"/>
<rect x="${M}" y="${M}" rx="16" width="${lw + 40}" height="${lh + 40}" fill="#ffffff"/>
<image href="${L}" x="${M + 20}" y="${M + 20}" width="${lw}" height="${lh}"/>
${k ? `<text x="${M}" y="${hy - h.size - 20}" ${font} font-weight="700" font-size="26" letter-spacing="4" fill="#ffffff" opacity=".85">${esc(k)}</text>` : ""}
<text ${font} font-weight="700" font-size="${h.size}" fill="#ffffff">${tspans(h.lines, M, hy, Math.round(h.size * 1.12))}</text>
<rect x="${M}" y="${hy + h.lines.length * h.size * 1.12 - 10}" width="90" height="8" fill="#ffffff"/>
<text ${font} font-weight="400" font-size="${s.size}" fill="#ffffff" opacity=".92">${tspans(s.lines, M, hy + h.lines.length * h.size * 1.12 + 60, Math.round(s.size * 1.4))}</text>
<text x="${M}" y="1000" ${font} font-weight="500" font-size="30" fill="#ffffff">${esc(site)}</text>`;
  } else {
    // navy
    const h = fit(o.headline, [80, 74, 68, 62, 56], TW, 5, true);
    const s = fit(o.sub, [34, 31, 28], TW, 3);
    const hy = 380 - Math.max(0, h.lines.length - 3) * 40;
    body = `<rect width="1080" height="1080" fill="${P.navy}"/>
<path d="M760 0 L1080 0 L1080 320 Z" fill="${P.navy2}"/><path d="M900 0 L1080 0 L1080 180 Z" fill="${P.accent}"/>
<rect x="0" y="0" width="14" height="1080" fill="${P.accent}"/>
${k ? `<text x="${M}" y="${hy - h.size - 30}" ${font} font-weight="700" font-size="26" letter-spacing="4" fill="${P.kicker}">${esc(k)}</text>` : ""}
<text ${font} font-weight="700" font-size="${h.size}" fill="#ffffff">${tspans(h.lines, M, hy, Math.round(h.size * 1.15))}</text>
<text ${font} font-weight="400" font-size="${s.size}" fill="${P.onNavy}">${tspans(s.lines, M, hy + h.lines.length * h.size * 1.15 + 36, Math.round(s.size * 1.4))}</text>
<rect x="0" y="900" width="1080" height="180" fill="#ffffff"/>
<image href="${L}" x="${M}" y="${990 - lh / 2}" width="${lw}" height="${lh}"/>
<text x="${W - M}" y="1000" text-anchor="end" ${font} font-weight="500" font-size="28" fill="${P.navy}">${esc(site)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">${body}</svg>`;
}

// o: {kicker, headline, sub, website}; layout: one of LAYOUTS (or a number to rotate). Returns a JPEG Buffer.
function render(co, o, layout) {
  const { Resvg } = require("@resvg/resvg-js");
  const jpeg = require("jpeg-js");
  if (typeof layout === "number") layout = LAYOUTS[Math.abs(layout) % LAYOUTS.length];
  if (!LAYOUTS.includes(layout)) layout = "navy";
  const r = new Resvg(svg(co, o, layout), { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Poppins" }, fitTo: { mode: "width", value: 1080 } });
  const img = r.render();
  return jpeg.encode({ data: img.pixels, width: img.width, height: img.height }, 88).data;
}

module.exports = { render, svg, LAYOUTS };
