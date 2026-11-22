// Email Campaigns: turns a campaign's blocks into a branded, responsive HTML email (and a plain-text part).
// One source for both sides: the API sends with it, and the Campaigns page loads the same file from
// /api/mk/render.js for its live preview, so what people see is exactly what goes out.
//
// The HTML is table-based with inline styles so it holds up in Outlook, Gmail and Apple Mail, 600px wide,
// stacking to one column on phones. Merge fields stay as tokens ({{first_name|there}}) until personalize().
(function (root) {
  "use strict";

  // Brand palettes. Every design style below draws only from its company's palette, so a Bifold email always
  // reads as Bifold (steel blue and red) and a Tech Hub email as Tech Hub (navy and teal), whatever the layout.
  const THEMES = {
    bifold: { navy: "#1E5A8C", navy2: "#174A75", accent: "#D81F2A", accent2: "#1E5A8C", soft: "#E2ECF5", page: "#ECF1F6", ink: "#15222E", muted: "#5B6A78", line: "#D7E1EB", onNavy: "#D6E4F1", kicker: "#FFC9CC", bold: "#C41A24", onBold: "#FFE3E5" },
    techhub: { kicker: "#8FE0D0", navy: "#003C50", navy2: "#0B4E63", accent: "#28A08C", accent2: "#00566E", soft: "#E6F4F2", page: "#ECF2F3", ink: "#14262D", muted: "#57707A", line: "#D6E3E5", onNavy: "#BFDCE0", bold: "#1E8573", onBold: "#DDF4EF" },
  };
  const FONT = "Arial,'Helvetica Neue',Helvetica,sans-serif";
  const SERIF = "Georgia,'Times New Roman',Times,serif";
  const SOCIAL_NAMES = { linkedin: "LinkedIn", instagram: "Instagram", facebook: "Facebook", x: "X", tiktok: "TikTok", youtube: "YouTube", whatsapp: "WhatsApp" };

  // Design styles: the same blocks drawn seven different ways. Each one changes the header, hero, headings,
  // bullets, feature layout, buttons, call to action, dividers and footer, so consecutive campaigns look new.
  const STYLES = {
    signature: { label: "Signature", desc: "Brand colour hero, feature cards, the house look.", header: "bar", hero: "navy", heading: "plain", bullet: "square", features: "cards", stats: "plain", quote: "bar", cta: "soft", divider: "line", footer: "navy", btn: "solid", radius: 10 },
    editorial: { label: "Editorial", desc: "Magazine feel: serif headlines on white, numbered rows, light footer.", header: "center", hero: "serif", heading: "serif", bullet: "chev", features: "rows", stats: "plain", quote: "serif", cta: "ruled", divider: "dots", footer: "light", btn: "dark", radius: 0, serif: true, heroAlign: "left", page: "#F6F7F9" },
    impact: { label: "Impact", desc: "Big, bold launch look: strong colour hero, pill buttons, numbered circles.", header: "compact", hero: "bold", heading: "big", bullet: "arrow", features: "circles", stats: "big", quote: "card", cta: "navy", divider: "short", footer: "navy", btn: "pill", radius: 16, heroAlign: "center" },
    advisory: { label: "Advisory", desc: "For security notices and end of life news: alert strip, checklist, step by step.", header: "banner", hero: "marker", heading: "bar", bullet: "check", features: "steps", stats: "cards", quote: "bar", cta: "navy", divider: "line", footer: "navy", btn: "solid", radius: 4, heroAlign: "left" },
    minimal: { label: "Minimal", desc: "Reads like a personal note: plain white, small logo, no heavy colour.", header: "compact", hero: "plain", heading: "plain", bullet: "dot", features: "list", stats: "plain", quote: "bar", cta: "plain", divider: "line", footer: "plain", btn: "outline", radius: 0, heroAlign: "left", page: "#FFFFFF", small: true },
    spotlight: { label: "Spotlight", desc: "Tinted page, pill label hero, dark feature tiles, colour band to finish.", header: "bar", hero: "chip", heading: "rule", bullet: "arrow", features: "tiles", stats: "cards", quote: "card", cta: "band", divider: "short", footer: "navy", btn: "solid", radius: 12, heroAlign: "left", page: "soft" },
    briefing: { label: "Briefing", desc: "Newsletter masthead, soft hero, bordered cards, side by side call to action.", header: "masthead", hero: "soft", heading: "rule", bullet: "square", features: "bordered", stats: "cards", quote: "serif", cta: "split", divider: "line", footer: "navy", btn: "solid", radius: 6, heroAlign: "left" },
  };
  const STYLE_KEYS = Object.keys(STYLES);

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const attr = esc;
  const safeUrl = (u, base) => {
    u = String(u || "").trim();
    if (!u) return "";
    if (/^\{\{[a-z_]+(\|[^}]*)?\}\}$/.test(u)) return u;
    if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
    if (u.startsWith("/")) return (base || "") + u;
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return "https://" + u;
    return "";
  };
  const TBL = `role="presentation" cellspacing="0" cellpadding="0" border="0"`;
  const hf = T => (T.s.serif ? SERIF : FONT); // headline font

  // Light markup for text: blank line = new paragraph, "- " lines = bullets, **bold**, *italic*, [label](url).
  function inline(s, T, base, linkColor) {
    let h = esc(s);
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const u = safeUrl(url.replace(/&amp;/g, "&"), base);
      return u ? `<a href="${attr(u)}" style="color:${linkColor || T.accent2};text-decoration:underline">${label}</a>` : label;
    });
    return h.replace(/\n/g, "<br>");
  }
  const BULLETS = { square: "&#9632;", chev: "&#8250;", arrow: "&#8594;", check: "&#10003;", dot: "&#9679;" };
  function rich(s, T, base, color, size, onDark) {
    size = size || 15;
    const style = `margin:0 0 14px;font-family:${FONT};font-size:${size}px;line-height:1.65;color:${color || T.ink}`;
    const mark = BULLETS[T.s.bullet] || BULLETS.square;
    const mc = onDark ? "#ffffff" : T.accent;
    const lc = onDark ? "#ffffff" : null;
    return String(s || "").replace(/\r/g, "").split(/\n\s*\n/).map(p => {
      const lines = p.split("\n");
      if (lines.every(l => /^\s*[-•]\s+/.test(l))) {
        const ms = T.s.bullet === "check" ? `font-weight:bold;font-size:${size}px` : T.s.bullet === "dot" ? "font-size:9px" : T.s.bullet === "chev" ? `font-size:${size + 4}px;font-weight:bold` : `font-size:${size}px;font-weight:bold`;
        return `<table ${TBL} style="margin:0 0 14px">${lines.map(l =>
          `<tr><td valign="top" style="padding:0 10px 6px 2px;font-family:${FONT};${ms};line-height:${T.s.bullet === "dot" ? "2.6" : "1.6"};color:${mc}">${mark}</td><td style="padding:0 0 6px;font-family:${FONT};font-size:${size}px;line-height:1.6;color:${color || T.ink}">${inline(l.replace(/^\s*[-•]\s+/, ""), T, base, lc)}</td></tr>`).join("")}</table>`;
      }
      return `<p style="${style}">${inline(p.trim(), T, base, lc)}</p>`;
    }).join("");
  }

  // kind: solid (accent), dark (brand colour), outline, pill, invert (white on a coloured band).
  function button(b, T, base, onDark, align, kind) {
    const url = safeUrl(b.url, base);
    if (!b.btn || !url) return "";
    kind = b.style === "outline" ? "outline" : kind || T.s.btn;
    let bg = T.accent, fg = "#ffffff", border = T.accent;
    let r = kind === "pill" ? 40 : Math.min(T.s.radius, 8);
    if (kind === "dark") { if (onDark) { bg = border = T.accent; } else { bg = border = T.navy; } }
    if (kind === "outline") { bg = "transparent"; fg = border = onDark ? "#ffffff" : T.navy; }
    if (kind === "invert") { bg = border = "#ffffff"; fg = onDark && onDark !== true ? onDark : T.navy; r = T.s.btn === "pill" ? 40 : Math.min(T.s.radius, 8); }
    const pad = T.s.small ? "10px 20px" : kind === "pill" ? "14px 30px" : "12px 26px";
    const up = kind === "dark" && T.s.serif;
    return `<table ${TBL} align="${align || "left"}" style="margin:${align === "center" ? "0 auto" : "0"}"><tr>
<td bgcolor="${bg === "transparent" ? "" : bg}" style="border-radius:${r}px;background:${bg}">
<a href="${attr(url)}" target="_blank" style="display:inline-block;white-space:nowrap;border:2px solid ${border};padding:${pad};font-family:${FONT};font-size:${up ? 13 : T.s.small ? 14 : 15}px;font-weight:bold;line-height:1.2;${up ? "letter-spacing:1.5px;text-transform:uppercase;" : ""}color:${fg};text-decoration:none;border-radius:${r}px">${esc(b.btn)}&nbsp;&rarr;</a>
</td></tr></table>`;
  }
  const img = (src, alt, base, style, T) => {
    const u = safeUrl(src, base);
    if (u) return `<img src="${attr(u)}" alt="${attr(alt || "")}" width="600" style="display:block;width:100%;max-width:100%;height:auto;border:0;${style || ""}">`;
    // In the editor's preview an empty image shows where it goes; in a real email it's left out.
    return T && T.ph ? `<div style="background:repeating-linear-gradient(135deg,#e7ecf2 0 12px,#f2f5f8 12px 24px);border:2px dashed #b9c4d0;border-radius:8px;padding:72px 16px;font:bold 13px/1.4 Arial,sans-serif;color:#6b7a8a;text-align:center">Add an image${alt ? "<br><span style=\"font-weight:normal\">" + esc(alt) + "</span>" : ""}</div>` : "";
  };
  const linked = (html, url, base) => { const u = safeUrl(url, base); return u && html ? `<a href="${attr(u)}" target="_blank" style="text-decoration:none">${html}</a>` : html; };
  const row = (inner, bg, pad) => `<tr><td class="px" bgcolor="${bg}" style="background:${bg};padding:${pad}">${inner}</td></tr>`;
  const kick = (text, color, extra) => text ? `<p style="margin:0 0 12px;font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${color};${extra || ""}">${esc(text)}</p>` : "";
  const pill = (text, bg, fg) => text ? `<table ${TBL} style="margin:0 0 16px"><tr><td bgcolor="${bg}" style="background:${bg};border-radius:20px;padding:6px 14px;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${fg}">${esc(text)}</td></tr></table>` : "";
  const bar = (w, h, color, center) => `<table ${TBL} ${center ? `align="center" style="margin:0 auto 14px"` : `style="margin:0 0 14px"`}><tr><td bgcolor="${color}" style="background:${color};width:${w}px;height:${h}px;line-height:${h}px;font-size:1px">&nbsp;</td></tr></table>`;

  const BLOCKS = {
    hero(b, T, base) {
      const v = T.s.hero;
      const al = T.s.heroAlign || (b.align === "left" ? "left" : "center");
      const dark = { navy: T.navy, bold: T.bold, chip: T.navy }[v];
      const bg = dark || (v === "soft" ? T.soft : "#ffffff");
      const pic = b.img ? `<tr><td bgcolor="${bg}" style="background:${bg};padding:0">${linked(img(b.img, b.alt || b.title, base, "", T), b.url, base)}</td></tr>` : "";
      const btn = (onDark, kind) => b.btn ? `<div style="padding-top:8px">${button(b, T, base, onDark, al, kind)}</div>` : "";
      const pb = b.btn ? "40px" : "26px";
      if (v === "bold") {
        return pic + row(`${pill(b.kicker, "#ffffff", T.bold).replace('style="margin:0 0 16px"', al === "center" ? 'align="center" style="margin:0 auto 18px"' : 'style="margin:0 0 18px"')}<h1 class="h1" style="margin:0 0 16px;font-family:${FONT};font-size:38px;line-height:1.12;font-weight:bold;letter-spacing:-0.5px;color:#ffffff">${esc(b.title)}</h1>
${b.text ? rich(b.text, T, base, T.onBold, 17, true) : ""}${btn(T.bold, "invert")}`, T.bold, `52px 44px ${b.btn ? "48px" : "32px"};text-align:${al}`);
      }
      if (v === "chip") {
        return pic + row(`${pill(b.kicker, T.accent, "#ffffff")}<h1 class="h1" style="margin:0 0 14px;font-family:${FONT};font-size:30px;line-height:1.2;font-weight:bold;color:#ffffff">${esc(b.title)}</h1>
${b.text ? rich(b.text, T, base, T.onNavy, 16, true) : ""}${btn(true)}`, T.navy, `40px 44px ${pb};text-align:${al}`);
      }
      if (v === "serif") {
        return pic + row(`${bar(48, 3, T.accent)}${kick(b.kicker, T.accent, "letter-spacing:2.5px")}<h1 class="h1" style="margin:0 0 16px;font-family:${SERIF};font-size:36px;line-height:1.18;font-weight:normal;color:${T.navy}">${esc(b.title)}</h1>
${b.text ? rich(b.text, T, base, T.ink, 17) : ""}${btn(false)}`, "#ffffff", `${b.img ? 34 : 44}px 44px ${b.btn ? "34px" : "14px"};text-align:${al};border-bottom:1px solid ${T.line}`);
      }
      if (v === "marker") {
        return pic + row(`<table ${TBL} width="100%"><tr><td style="border-left:6px solid ${T.accent};padding:4px 0 4px 22px">${kick(b.kicker, T.accent)}<h1 class="h1" style="margin:0 0 12px;font-family:${FONT};font-size:28px;line-height:1.22;font-weight:bold;color:${T.navy}">${esc(b.title)}</h1>
${b.text ? rich(b.text, T, base, T.ink, 16) : ""}${btn(false)}</td></tr></table>`, "#ffffff", `34px 44px ${b.btn ? "30px" : "14px"}`);
      }
      if (v === "plain") {
        return pic + row(`${kick(b.kicker, T.muted, "font-size:11px;letter-spacing:1.5px")}<h1 class="h1" style="margin:0 0 14px;font-family:${FONT};font-size:26px;line-height:1.25;font-weight:bold;color:${T.navy}">${esc(b.title)}</h1>
${b.text ? rich(b.text, T, base, T.ink, 16) : ""}${btn(false)}`, "#ffffff", `30px 44px ${b.btn ? "28px" : "8px"};text-align:${al}`);
      }
      if (v === "soft") {
        return pic + row(`${b.kicker ? `<p style="margin:0 0 14px;font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${T.accent2}"><span style="border-bottom:3px solid ${T.accent};padding-bottom:4px">${esc(b.kicker)}</span></p>` : ""}<h1 class="h1" style="margin:0 0 14px;font-family:${FONT};font-size:29px;line-height:1.2;font-weight:bold;color:${T.navy}">${esc(b.title)}</h1>
${b.text ? rich(b.text, T, base, T.ink, 16) : ""}${btn(false)}`, T.soft, `38px 44px ${pb};text-align:${al}`);
      }
      // navy (signature)
      return pic + row(`${kick(b.kicker, T.kicker || "#ffffff")}<h1 class="h1" style="margin:0 0 14px;font-family:${FONT};font-size:32px;line-height:1.2;font-weight:bold;color:#ffffff">${esc(b.title)}</h1>
${b.text ? rich(b.text, T, base, T.onNavy, 16, true) : ""}${btn(true)}`, T.navy, `40px 44px ${pb};text-align:${al}`);
    },
    heading(b, T) {
      const v = T.s.heading, lg = b.size !== "md", center = b.align === "center";
      const k = b.kicker ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${T.accent}">${esc(b.kicker)}</p>` : "";
      const pad = `30px 44px 6px;text-align:${center ? "center" : "left"}`;
      if (v === "serif") return row(`${k}<h2 style="margin:0;font-family:${SERIF};font-size:${lg ? 27 : 21}px;line-height:1.28;font-weight:normal;color:${T.navy}">${esc(b.text)}</h2>`, "#ffffff", pad);
      if (v === "bar") return row(`<table ${TBL} ${center ? 'align="center"' : ""}><tr><td style="border-left:4px solid ${T.accent};padding:2px 0 2px 14px">${k}<h2 style="margin:0;font-family:${FONT};font-size:${lg ? 22 : 18}px;line-height:1.3;font-weight:bold;color:${T.navy}">${esc(b.text)}</h2></td></tr></table>`, "#ffffff", pad);
      if (v === "rule") return row(`${k}<h2 style="margin:0 0 10px;font-family:${FONT};font-size:${lg ? 21 : 17}px;line-height:1.3;font-weight:bold;color:${T.navy}">${esc(b.text)}</h2><div style="height:2px;line-height:2px;font-size:1px;background:${T.line}"><div style="width:56px;height:2px;background:${T.accent};${center ? "margin:0 auto" : ""}">&nbsp;</div></div>`, "#ffffff", pad);
      if (v === "big") return row(`${k}<h2 style="margin:0 0 12px;font-family:${FONT};font-size:${lg ? 28 : 21}px;line-height:1.2;font-weight:bold;letter-spacing:-0.3px;color:${T.navy}">${esc(b.text)}</h2>${bar(56, 4, T.accent, center)}`, "#ffffff", `34px 44px 0;text-align:${center ? "center" : "left"}`);
      return row(`${k}<h2 style="margin:0;font-family:${FONT};font-size:${lg ? 24 : 19}px;line-height:1.3;font-weight:bold;color:${T.navy}">${esc(b.text)}</h2>`, "#ffffff", pad);
    },
    text(b, T, base) { return row(rich(b.text, T, base, T.ink, T.s.serif ? 16 : 15), "#ffffff", `14px 44px 4px;text-align:${b.align === "center" ? "center" : "left"}`); },
    image(b, T, base) {
      const pic = linked(img(b.img, b.alt, base, b.w === "full" ? "" : `border-radius:${Math.min(T.s.radius, 8)}px`, T), b.url, base);
      if (!pic) return "";
      const cap = b.caption ? `<p style="margin:8px 0 0;font-family:${T.s.serif ? SERIF : FONT};font-size:12px;${T.s.serif ? "font-style:italic;" : ""}color:${T.muted};text-align:center">${esc(b.caption)}</p>` : "";
      return b.w === "full" ? `<tr><td bgcolor="#ffffff" style="background:#ffffff;padding:8px 0">${pic}${cap ? `<div class="px" style="padding:0 44px">${cap}</div>` : ""}</td></tr>` : row(pic + cap, "#ffffff", "16px 44px");
    },
    button(b, T, base) { const al = b.align === "left" ? "left" : "center"; return row(button(b, T, base, false, al), "#ffffff", `14px 44px 22px;text-align:${al}`); },
    split(b, T, base) {
      const r = Math.min(T.s.radius, 8);
      const pic = `<td class="stack" width="50%" valign="middle" style="width:50%;padding:0 ${b.side === "right" ? "0 0 12px" : "12px 0 0"}">${linked(img(b.img, b.alt || b.title, base, `border-radius:${r}px`, T), b.url, base)}</td>`;
      const txt = `<td class="stack" width="50%" valign="middle" style="width:50%;padding:0 ${b.side === "right" ? "12px 0 0" : "0 0 12px"}">
${b.title ? `<h3 style="margin:0 0 10px;font-family:${hf(T)};font-size:20px;line-height:1.3;${T.s.serif ? "font-weight:normal;" : ""}color:${T.navy}">${esc(b.title)}</h3>` : ""}${rich(b.text, T, base, T.ink, 14)}${button(b, T, base, false)}</td>`;
      return row(`<table ${TBL} width="100%"><tr>${b.side === "right" ? txt + pic : pic + txt}</tr></table>`, "#ffffff", "22px 44px");
    },
    features(b, T, base) {
      const items = (b.items || []).filter(i => i && (i.title || i.text)).slice(0, 3);
      if (!items.length) return "";
      const v = T.s.features;
      const title = b.title ? (T.s.heading === "rule"
        ? `<h2 style="margin:0 0 10px;font-family:${FONT};font-size:19px;color:${T.navy}">${esc(b.title)}</h2><div style="height:2px;line-height:2px;font-size:1px;background:${T.line};margin:0 0 18px"><div style="width:56px;height:2px;background:${T.accent}">&nbsp;</div></div>`
        : `<h2 style="margin:0 0 16px;font-family:${hf(T)};font-size:${T.s.serif ? 23 : 20}px;${T.s.serif ? "font-weight:normal;" : ""}color:${T.navy}">${esc(b.title)}</h2>`) : "";
      const n2 = n => (n + 1 < 10 ? "0" : "") + (n + 1);
      const w = Math.floor(100 / items.length);
      const cols = cell => `<table ${TBL} width="100%"><tr>${items.map((i, n) => `<td class="stack" width="${w}%" valign="top" style="width:${w}%;padding:0 ${n < items.length - 1 ? 8 : 0}px 14px ${n ? 8 : 0}px">${cell(i, n)}</td>`).join("")}</tr></table>`;
      const stack = (cell, gap) => items.map((i, n) => cell(i, n) + (n < items.length - 1 ? (gap || "") : "")).join("");
      let body;
      if (v === "rows") {
        body = stack((i, n) => `<table ${TBL} width="100%"><tr><td valign="top" width="64" style="width:64px;padding:14px 0;font-family:${SERIF};font-size:34px;line-height:1;color:${T.accent}">${n2(n)}</td><td valign="top" style="padding:14px 0">
<h3 style="margin:0 0 6px;font-family:${hf(T)};font-size:18px;line-height:1.3;${T.s.serif ? "font-weight:normal;" : ""}color:${T.navy}">${esc(i.title)}</h3><p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${T.muted}">${inline(i.text, T, base)}</p></td></tr></table>`,
          `<div style="height:1px;line-height:1px;font-size:1px;background:${T.line}">&nbsp;</div>`);
      } else if (v === "circles") {
        body = cols((i, n) => `<table ${TBL} width="100%"><tr><td align="center" style="text-align:center;padding:4px 4px 0">
<table ${TBL} align="center" style="margin:0 auto 12px"><tr><td width="48" height="48" align="center" valign="middle" bgcolor="${n === 1 ? T.navy : T.accent}" style="width:48px;height:48px;border-radius:24px;background:${n === 1 ? T.navy : T.accent};font-family:${FONT};font-size:19px;font-weight:bold;color:#ffffff;text-align:center">${n + 1}</td></tr></table>
<h3 style="margin:0 0 8px;font-family:${FONT};font-size:17px;line-height:1.3;color:${T.navy}">${esc(i.title)}</h3><p style="margin:0;font-family:${FONT};font-size:13.5px;line-height:1.6;color:${T.muted}">${inline(i.text, T, base)}</p></td></tr></table>`);
      } else if (v === "steps") {
        body = stack((i, n) => `<table ${TBL} width="100%"><tr><td bgcolor="${T.soft}" style="background:${T.soft};border-left:4px solid ${T.accent};border-radius:0 ${T.s.radius}px ${T.s.radius}px 0;padding:16px 18px">
<table ${TBL} style="margin:0 0 8px"><tr><td bgcolor="${T.navy}" style="background:${T.navy};border-radius:3px;padding:3px 8px;font-family:${FONT};font-size:10.5px;font-weight:bold;letter-spacing:1.5px;color:#ffffff">STEP ${n + 1}</td></tr></table>
<h3 style="margin:0 0 6px;font-family:${FONT};font-size:16px;line-height:1.3;color:${T.navy}">${esc(i.title)}</h3><p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${T.ink}">${inline(i.text, T, base)}</p></td></tr></table>`,
          `<div style="height:10px;line-height:10px;font-size:1px">&nbsp;</div>`);
      } else if (v === "list") {
        body = stack((i, n) => `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.6;color:${T.ink}"><strong style="color:${T.navy}">${esc(i.title)}</strong>${i.title && i.text ? `<br>` : ""}<span style="color:${T.muted}">${inline(i.text, T, base)}</span></p>`);
      } else if (v === "tiles") {
        body = cols((i, n) => `<table ${TBL} width="100%"><tr><td bgcolor="${n === 1 ? T.navy2 : T.navy}" style="background:${n === 1 ? T.navy2 : T.navy};border-radius:${T.s.radius}px;padding:22px 18px">
<p style="margin:0 0 10px;font-family:${FONT};font-size:22px;font-weight:bold;line-height:1;color:${T.kicker}">${n2(n)}</p>
<h3 style="margin:0 0 8px;font-family:${FONT};font-size:16px;line-height:1.3;color:#ffffff">${esc(i.title)}</h3><p style="margin:0;font-family:${FONT};font-size:13.5px;line-height:1.6;color:${T.onNavy}">${inline(i.text, T, base, "#ffffff")}</p></td></tr></table>`);
      } else if (v === "bordered") {
        body = stack((i, n) => `<table ${TBL} width="100%"><tr><td style="border:1px solid ${T.line};border-left:4px solid ${n % 2 ? T.accent2 : T.accent};border-radius:${T.s.radius}px;padding:16px 18px">
<p style="margin:0 0 4px;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:1.5px;color:${T.accent}">${n2(n)}</p>
<h3 style="margin:0 0 6px;font-family:${FONT};font-size:16px;line-height:1.3;color:${T.navy}">${esc(i.title)}</h3><p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${T.muted}">${inline(i.text, T, base)}</p></td></tr></table>`,
          `<div style="height:10px;line-height:10px;font-size:1px">&nbsp;</div>`);
      } else {
        body = cols((i, n) => `<table ${TBL} width="100%"><tr><td bgcolor="${T.soft}" style="background:${T.soft};border-top:3px solid ${n % 2 ? T.accent2 : T.accent};border-radius:0 0 8px 8px;padding:18px 16px">
<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:bold;color:${T.accent}">${n2(n)}</p>
<h3 style="margin:0 0 8px;font-family:${FONT};font-size:16px;line-height:1.3;color:${T.navy}">${esc(i.title)}</h3>
<p style="margin:0;font-family:${FONT};font-size:13.5px;line-height:1.6;color:${T.muted}">${inline(i.text, T, base)}</p></td></tr></table>`);
      }
      return row(title + body, "#ffffff", v === "list" ? "16px 44px 4px" : "20px 44px 10px");
    },
    stats(b, T) {
      const items = (b.items || []).filter(i => i && (i.v || i.l)).slice(0, 4);
      if (!items.length) return "";
      const v = T.s.stats, w = Math.floor(100 / items.length);
      if (v === "cards") {
        return row(`<table ${TBL} width="100%"><tr>${items.map((i, n) => `<td class="stack" width="${w}%" valign="top" style="width:${w}%;padding:0 ${n < items.length - 1 ? 5 : 0}px 10px ${n ? 5 : 0}px"><table ${TBL} width="100%"><tr><td align="center" bgcolor="${T.soft}" style="background:${T.soft};border-radius:${Math.min(T.s.radius, 10)}px;padding:18px 8px;text-align:center">
<p style="margin:0;font-family:${FONT};font-size:28px;font-weight:bold;line-height:1.1;color:${T.navy}">${esc(i.v)}</p><p style="margin:6px 0 0;font-family:${FONT};font-size:12px;line-height:1.4;color:${T.muted}">${esc(i.l)}</p></td></tr></table></td>`).join("")}</tr></table>`, "#ffffff", "18px 44px 8px");
      }
      const big = v === "big";
      return row(`<table ${TBL} width="100%"><tr>${items.map((i, n) => `<td class="stack" width="${w}%" align="center" valign="top" style="width:${w}%;padding:12px 6px;${n && !big ? `border-left:1px solid ${T.line}` : ""}">
<p style="margin:0;font-family:${T.s.serif ? SERIF : FONT};font-size:${big ? 40 : 30}px;font-weight:bold;line-height:1.05;letter-spacing:${big ? "-1px" : "0"};color:${big ? T.accent : T.accent2}">${esc(i.v)}</p><p style="margin:6px 0 0;font-family:${FONT};font-size:12.5px;line-height:1.4;${big ? "font-weight:bold;text-transform:uppercase;letter-spacing:1px;font-size:11px;" : ""}color:${T.muted}">${esc(i.l)}</p></td>`).join("")}</tr></table>`, "#ffffff", "18px 44px");
    },
    quote(b, T, base) {
      const v = T.s.quote;
      const by = b.by ? `<p style="margin:0;font-family:${FONT};font-size:13px;font-weight:bold;color:${T.muted}">${esc(b.by)}</p>` : "";
      if (v === "serif") return row(`<p style="margin:0;font-family:${SERIF};font-size:54px;line-height:0.8;color:${T.accent}">&ldquo;</p><p style="margin:0 0 12px;font-family:${SERIF};font-size:21px;font-style:italic;line-height:1.5;color:${T.navy}">${inline(b.text, T, base)}</p>${by}`, "#ffffff", "26px 60px;text-align:center");
      if (v === "card") return row(`<table ${TBL} width="100%"><tr><td bgcolor="${T.soft}" style="background:${T.soft};border-radius:${Math.min(T.s.radius, 12)}px;padding:24px 26px">
<p style="margin:0 0 10px;font-family:${FONT};font-size:17px;font-weight:bold;line-height:1.5;color:${T.navy}">&ldquo;${inline(b.text, T, base)}&rdquo;</p>${by}</td></tr></table>`, "#ffffff", "20px 44px");
      return row(`<table ${TBL} width="100%"><tr><td style="border-left:4px solid ${T.accent};padding:4px 0 4px 20px">
<p style="margin:0 0 10px;font-family:${SERIF};font-size:18px;font-style:italic;line-height:1.55;color:${T.navy}">${inline(b.text, T, base)}</p>${by}</td></tr></table>`, "#ffffff", "22px 44px");
    },
    cta(b, T, base) {
      const v = T.s.cta, r = Math.min(T.s.radius, 12);
      const box = (inner, bg, extra) => `<tr><td class="px" bgcolor="#ffffff" style="background:#ffffff;padding:18px 44px 26px"><table ${TBL} width="100%"><tr><td bgcolor="${bg}" align="center" style="background:${bg};border-radius:${r}px;padding:30px 28px;text-align:center;${extra || ""}">${inner}</td></tr></table></td></tr>`;
      const h = (color, font, size) => b.title ? `<h2 style="margin:0 0 10px;font-family:${font || FONT};font-size:${size || 22}px;line-height:1.3;${font === SERIF ? "font-weight:normal;" : ""}color:${color}">${esc(b.title)}</h2>` : "";
      if (v === "navy") return box(`${h("#ffffff")}${b.text ? rich(b.text, T, base, T.onNavy, 15, true) : ""}${button(b, T, base, true, "center")}`, T.navy);
      if (v === "band") return `<tr><td class="px" bgcolor="${T.bold}" style="background:${T.bold};padding:38px 44px;text-align:center">${h("#ffffff", FONT, 24)}${b.text ? rich(b.text, T, base, T.onBold, 15, true) : ""}${button(b, T, base, T.bold, "center", "invert")}</td></tr>`;
      if (v === "ruled") return `<tr><td class="px" bgcolor="#ffffff" style="background:#ffffff;padding:22px 44px 30px"><table ${TBL} width="100%"><tr><td align="center" style="border-top:2px solid ${T.navy};border-bottom:2px solid ${T.navy};padding:28px 16px;text-align:center">${h(T.navy, SERIF, 25)}${b.text ? rich(b.text, T, base, T.ink, 15) : ""}${button(b, T, base, false, "center")}</td></tr></table></td></tr>`;
      if (v === "plain") return row(`<div style="height:1px;line-height:1px;font-size:1px;background:${T.line};margin:0 0 22px">&nbsp;</div>${h(T.navy, FONT, 19)}${b.text ? rich(b.text, T, base, T.ink, 15) : ""}${button(b, T, base, false, "left")}`, "#ffffff", "16px 44px 30px");
      if (v === "split") {
        const btn = button(b, T, base, false, "right");
        return `<tr><td class="px" bgcolor="#ffffff" style="background:#ffffff;padding:18px 44px 26px"><table ${TBL} width="100%"><tr><td bgcolor="${T.soft}" style="background:${T.soft};border-radius:${r}px;padding:24px 26px"><table ${TBL} width="100%"><tr>
<td class="stack" valign="middle" style="padding:0 16px 0 0">${h(T.navy, FONT, 19)}${b.text ? rich(b.text, T, base, T.ink, 14).replace(/margin:0 0 14px/g, "margin:0 0 6px") : ""}</td>
${btn ? `<td class="stack" valign="middle" align="right" width="230" style="width:230px;padding:8px 0 0">${btn}</td>` : ""}</tr></table></td></tr></table></td></tr>`;
      }
      return box(`${h(T.navy)}${b.text ? rich(b.text, T, base, T.ink, 15) : ""}${button(b, T, base, false, "center")}`, T.soft);
    },
    divider(b, T) {
      if (T.s.divider === "dots") return row(`<p style="margin:0;font-family:${FONT};font-size:14px;letter-spacing:10px;color:${T.accent};text-align:center">&#9679;&#9679;&#9679;</p>`, "#ffffff", "14px 44px");
      if (T.s.divider === "short") return row(bar(64, 4, T.accent, true), "#ffffff", "16px 44px 4px");
      return row(`<div style="height:1px;line-height:1px;font-size:1px;background:${T.line}">&nbsp;</div>`, "#ffffff", "14px 44px");
    },
    spacer(b) { const h = Math.max(8, Math.min(80, Number(b.h) || 24)); return `<tr><td bgcolor="#ffffff" style="background:#ffffff;height:${h}px;line-height:${h}px;font-size:1px">&nbsp;</td></tr>`; },
    html(b) { return row(String(b.html || ""), "#ffffff", "14px 44px"); },
  };

  function header(c, brand, T, base) {
    const v = T.s.header, R = T.s.radius;
    const logoH = (brand.key === "techhub" ? 38 : 46) - (v === "compact" ? 8 : 0);
    const logoUrl = safeUrl(brand.logo, base);
    const logo = (align) => logoUrl ? `<a href="${attr(safeUrl(brand.website) || logoUrl)}" target="_blank"><img src="${attr(logoUrl)}" alt="${attr(brand.name)}" height="${logoH}" ${align ? `align="${align}"` : ""} style="display:${align === "center" ? "inline-block" : "block"};height:${logoH}px;width:auto;border:0"></a>` : `<b style="font-family:${FONT};font-size:18px;color:${T.navy}">${esc(brand.name)}</b>`;
    const ed = c.edition ? esc(c.edition) : "";
    const edCell = color => ed ? `<td valign="middle" align="right" style="font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${color}">${ed}</td>` : "";
    const top = `border-radius:${R}px ${R}px 0 0`;
    if (v === "center") {
      return `<tr><td class="px" align="center" bgcolor="#ffffff" style="background:#ffffff;padding:30px 44px 20px;text-align:center;${top};border-bottom:1px solid ${T.line}">${logo("center")}
${ed ? `<p style="margin:14px 0 0;font-family:${SERIF};font-size:13px;font-style:italic;color:${T.muted}">${ed}</p>` : ""}</td></tr>`;
    }
    const strip = (bg, left, color) => `<tr><td class="px" bgcolor="${bg}" style="background:${bg};padding:10px 44px"><table ${TBL} width="100%"><tr><td valign="middle" style="font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#ffffff">${left}</td>${edCell(color)}</tr></table></td></tr>`;
    const logoRow = (pad, border) => `<tr><td class="px" bgcolor="#ffffff" style="background:#ffffff;padding:${pad};${top};${border || ""}"><table ${TBL} width="100%"><tr><td valign="middle">${logo()}</td>${v === "compact" ? edCell(T.muted) : ""}</tr></table></td></tr>`;
    if (v === "masthead") return logoRow("22px 44px 18px") + strip(T.navy2, esc(c.mast || (brand.key === "techhub" ? "Tech Hub briefing" : "Bifold briefing")), T.onNavy);
    if (v === "banner") {
      const label = esc(c.mast || "Important update");
      return logoRow("22px 44px 18px") + strip(T.bold, `<span style="color:#ffffff">&#9679;</span>&nbsp;&nbsp;${label}`, T.onBold);
    }
    if (v === "compact") return logoRow("20px 44px 16px", `border-bottom:1px solid ${T.line}`);
    return `<tr><td class="px" bgcolor="#ffffff" style="background:#ffffff;padding:24px 44px 20px;${top};border-bottom:4px solid ${T.accent}">
<table ${TBL} width="100%"><tr><td valign="middle">${logo()}</td>${edCell(T.muted)}</tr></table></td></tr>`;
  }

  function footer(brand, T, base) {
    const v = T.s.footer, R = T.s.radius;
    const light = v !== "navy";
    const bg = v === "light" ? T.soft : v === "plain" ? "#ffffff" : T.navy;
    const strong = light ? T.navy : "#ffffff", soft = light ? T.muted : T.onNavy, link = light ? T.accent2 : "#ffffff";
    const socials = Object.entries(brand.socials || {}).filter(([k, u]) => SOCIAL_NAMES[k] && safeUrl(u)).map(([k, u]) =>
      `<a href="${attr(safeUrl(u))}" target="_blank" style="color:${link};text-decoration:none;font-weight:bold">${SOCIAL_NAMES[k]}</a>`).join(`<span style="color:${soft}">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>`);
    const web = safeUrl(brand.website);
    const al = v === "plain" ? "left" : "center";
    return `<tr><td class="px" bgcolor="${bg}" style="background:${bg};padding:${v === "plain" ? "22px 44px 30px" : "30px 44px"};text-align:${al};border-radius:0 0 ${R}px ${R}px;${v === "plain" ? `border-top:1px solid ${T.line}` : ""}">
${socials ? `<p style="margin:0 0 16px;font-family:${FONT};font-size:13px">${socials}</p>` : ""}
<p style="margin:0 0 4px;font-family:${FONT};font-size:13px;font-weight:bold;color:${strong}">${esc(brand.name)}</p>
<p style="margin:0 0 4px;font-family:${FONT};font-size:12px;line-height:1.6;color:${soft}">${esc(brand.address)}${web ? ` &middot; <a href="${attr(web)}" style="color:${soft};text-decoration:underline">${esc(web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>` : ""}</p>
<p style="margin:14px 0 0;font-family:${FONT};font-size:11.5px;line-height:1.6;color:${soft}">${esc(brand.footerNote || `You are receiving this email because you are a customer or business contact of ${brand.name}.`)}<br>
<a href="{{unsubscribe_url}}" style="color:${link};text-decoration:underline">Unsubscribe</a> from these emails at any time.</p></td></tr>`;
  }

  // brand: {key, name, logo (absolute or site path), address, website, socials, footerNote}
  // c.style picks the design (see STYLES); anything unknown falls back to the house "signature" look.
  function renderEmail(c, brand, opts) {
    opts = opts || {};
    const base = opts.base || "";
    const s = STYLES[c.style] || STYLES.signature;
    const T = Object.assign({}, THEMES[brand.key] || THEMES.bifold, { ph: !!opts.placeholders });
    T.s = s;
    const page = s.page === "soft" ? T.soft : s.page || T.page;
    const blocks = (Array.isArray(c.blocks) ? c.blocks : []).map(b => (BLOCKS[b && b.t] ? BLOCKS[b.t](b, T, base) : "")).join("\n");
    const pre = esc(c.preheader || "");
    const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(c.subject || "")}</title>
<!--[if mso]><style>table,td,h1,h2,h3,p,a{font-family:Arial,sans-serif!important}</style><![endif]-->
<style>
body{margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}
img{-ms-interpolation-mode:bicubic}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
@media screen and (max-width:620px){
  .w{width:100%!important;max-width:100%!important}
  .px{padding-left:22px!important;padding-right:22px!important}
  .stack{display:block!important;width:100%!important;max-width:100%!important;padding-left:0!important;padding-right:0!important}
  .h1{font-size:26px!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${page}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${page}">${pre}${"&#8199;&#65279;&#847; ".repeat(60)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${page}" style="background:${page}">
<tr><td align="center" style="padding:${s.page === "#FFFFFF" ? "12px 12px" : "28px 12px"}">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="w" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px">
${header(c, brand, T, base)}
${blocks}
${footer(brand, T, base)}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
    return { html, text: renderText(c, brand, base) };
  }

  function renderText(c, brand, base) {
    const strip = s => String(s || "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, l, u) => `${l} (${safeUrl(u, base) || u})`);
    const out = [];
    for (const b of c.blocks || []) {
      if (!b) continue;
      if (b.title) out.push(String(b.title).toUpperCase());
      if (b.t === "heading") out.push(String(b.text || "").toUpperCase());
      else if (b.text && b.t !== "html") out.push(strip(b.text));
      if (b.items) b.items.forEach(i => out.push(i.v ? `${i.v}: ${i.l || ""}` : `- ${i.title || ""}${i.text ? ": " + strip(i.text) : ""}`));
      if (b.by) out.push("- " + b.by);
      if (b.btn && safeUrl(b.url, base)) out.push(`${b.btn}: ${safeUrl(b.url, base)}`);
      out.push("");
    }
    out.push("--", brand.name, brand.address || "", safeUrl(brand.website) || "", "", "Unsubscribe: {{unsubscribe_url}}");
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // Fills merge fields: {{first_name|there}}, {{last_name}}, {{name}}, {{company}}, {{email}}, {{unsubscribe_url}}.
  function personalize(s, contact, extra, isHtml) {
    const v = Object.assign({}, contact || {}, extra || {});
    const first = v.first_name || v.firstName || String(v.name || "").split(/\s+/)[0] || "";
    const map = { first_name: first, last_name: v.last_name || v.lastName || "", name: v.name || [first, v.lastName].filter(Boolean).join(" "), company: v.company || "", email: v.email || "", unsubscribe_url: v.unsubscribe_url || "#" };
    return String(s || "").replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/g, (m, k, fb) => {
      if (!(k in map)) return m;
      const val = map[k];
      if (!val) return fb != null ? fb : ""; // the fallback is already escaped inside HTML
      return isHtml && k !== "unsubscribe_url" ? esc(val) : val;
    });
  }

  const STYLE_LIST = STYLE_KEYS.map(k => ({ key: k, label: STYLES[k].label, desc: STYLES[k].desc }));
  const api = { renderEmail, renderText, personalize, THEMES, SOCIAL_NAMES, BLOCK_TYPES: Object.keys(BLOCKS), STYLES: STYLE_LIST, STYLE_KEYS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MkRender = api;
})(typeof window !== "undefined" ? window : this);
