// Email Campaigns: turns a campaign's blocks into a branded, responsive HTML email (and a plain-text part).
// One source for both sides: the API sends with it, and the Campaigns page loads the same file from
// /api/mk/render.js for its live preview, so what people see is exactly what goes out.
//
// The HTML is table-based with inline styles so it holds up in Outlook, Gmail and Apple Mail, 600px wide,
// stacking to one column on phones. Merge fields stay as tokens ({{first_name|there}}) until personalize().
(function (root) {
  "use strict";

  const THEMES = {
    bifold: { navy: "#1B2A4A", navy2: "#23365C", accent: "#C0392B", accent2: "#2E6DA4", soft: "#EEF3F9", page: "#EDF0F5", ink: "#1D2733", muted: "#5E6B7A", line: "#DCE3EC", onNavy: "#C9D6E6" },
    techhub: { navy: "#003C50", navy2: "#0B4E63", accent: "#28A08C", accent2: "#00566E", soft: "#E6F4F2", page: "#ECF2F3", ink: "#14262D", muted: "#57707A", line: "#D6E3E5", onNavy: "#BFDCE0" },
  };
  const FONT = "Arial,'Helvetica Neue',Helvetica,sans-serif";
  const SOCIAL_NAMES = { linkedin: "LinkedIn", instagram: "Instagram", facebook: "Facebook", x: "X", tiktok: "TikTok", youtube: "YouTube", whatsapp: "WhatsApp" };

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

  // Light markup for text: blank line = new paragraph, "- " lines = bullets, **bold**, *italic*, [label](url).
  function inline(s, T, base) {
    let h = esc(s);
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const u = safeUrl(url.replace(/&amp;/g, "&"), base);
      return u ? `<a href="${attr(u)}" style="color:${T.accent2};text-decoration:underline">${label}</a>` : label;
    });
    return h.replace(/\n/g, "<br>");
  }
  function rich(s, T, base, color, size) {
    const style = `margin:0 0 14px;font-family:${FONT};font-size:${size || 15}px;line-height:1.65;color:${color || T.ink}`;
    return String(s || "").replace(/\r/g, "").split(/\n\s*\n/).map(p => {
      const lines = p.split("\n");
      if (lines.every(l => /^\s*[-•]\s+/.test(l))) {
        return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 14px">${lines.map(l =>
          `<tr><td valign="top" style="padding:0 10px 6px 2px;font-family:${FONT};font-size:${size || 15}px;line-height:1.6;color:${T.accent}">&#9632;</td><td style="padding:0 0 6px;font-family:${FONT};font-size:${size || 15}px;line-height:1.6;color:${color || T.ink}">${inline(l.replace(/^\s*[-•]\s+/, ""), T, base)}</td></tr>`).join("")}</table>`;
      }
      return `<p style="${style}">${inline(p.trim(), T, base)}</p>`;
    }).join("");
  }

  function button(b, T, base, onDark, align) {
    const url = safeUrl(b.url, base);
    if (!b.btn || !url) return "";
    const outline = b.style === "outline";
    const bg = outline ? "transparent" : T.accent;
    const fg = outline ? (onDark ? "#ffffff" : T.navy) : "#ffffff";
    const border = outline ? (onDark ? "#ffffff" : T.navy) : T.accent;
    return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="${align || "left"}" style="margin:${align === "center" ? "0 auto" : "0"}"><tr>
<td bgcolor="${outline ? "" : bg}" style="border-radius:6px;background:${bg};border:2px solid ${border}">
<a href="${attr(url)}" target="_blank" style="display:inline-block;padding:12px 26px;font-family:${FONT};font-size:15px;font-weight:bold;line-height:1.2;color:${fg};text-decoration:none;border-radius:6px">${esc(b.btn)}&nbsp;&rarr;</a>
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

  const BLOCKS = {
    hero(b, T, base) {
      const pic = b.img ? `<tr><td bgcolor="${T.navy}" style="background:${T.navy};padding:0">${linked(img(b.img, b.alt || b.title, base, "", T), b.url, base)}</td></tr>` : "";
      const kicker = b.kicker ? `<p style="margin:0 0 12px;font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${T.accent === "#C0392B" ? "#F2A39A" : "#8FE0D0"}">${esc(b.kicker)}</p>` : "";
      const al = b.align === "left" ? "left" : "center";
      return pic + row(`${kicker}<h1 class="h1" style="margin:0 0 14px;font-family:${FONT};font-size:32px;line-height:1.2;font-weight:bold;color:#ffffff">${esc(b.title)}</h1>
${b.text ? rich(b.text, T, base, T.onNavy, 16) : ""}${b.btn ? `<div style="padding-top:8px">${button(b, T, base, true, al)}</div>` : ""}`, T.navy, `40px 44px ${b.btn ? "40px" : "26px"};text-align:${al}`);
    },
    heading(b, T) {
      const lg = b.size !== "md";
      return row(`${b.kicker ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${T.accent}">${esc(b.kicker)}</p>` : ""}<h2 style="margin:0;font-family:${FONT};font-size:${lg ? 24 : 19}px;line-height:1.3;font-weight:bold;color:${T.navy}">${esc(b.text)}</h2>`, "#ffffff", `30px 44px 6px;text-align:${b.align === "center" ? "center" : "left"}`);
    },
    text(b, T, base) { return row(rich(b.text, T, base), "#ffffff", `14px 44px 4px;text-align:${b.align === "center" ? "center" : "left"}`); },
    image(b, T, base) {
      const pic = linked(img(b.img, b.alt, base, b.w === "full" ? "" : "border-radius:8px", T), b.url, base);
      if (!pic) return "";
      const cap = b.caption ? `<p style="margin:8px 0 0;font-family:${FONT};font-size:12px;color:${T.muted};text-align:center">${esc(b.caption)}</p>` : "";
      return b.w === "full" ? `<tr><td bgcolor="#ffffff" style="background:#ffffff;padding:8px 0">${pic}${cap ? `<div class="px" style="padding:0 44px">${cap}</div>` : ""}</td></tr>` : row(pic + cap, "#ffffff", "16px 44px");
    },
    button(b, T, base) { const al = b.align === "left" ? "left" : "center"; return row(button(b, T, base, false, al), "#ffffff", `14px 44px 22px;text-align:${al}`); },
    split(b, T, base) {
      const pic = `<td class="stack" width="50%" valign="middle" style="width:50%;padding:0 ${b.side === "right" ? "0 0 12px" : "12px 0 0"}">${linked(img(b.img, b.alt || b.title, base, "border-radius:8px", T), b.url, base)}</td>`;
      const txt = `<td class="stack" width="50%" valign="middle" style="width:50%;padding:0 ${b.side === "right" ? "12px 0 0" : "0 0 12px"}">
${b.title ? `<h3 style="margin:0 0 10px;font-family:${FONT};font-size:20px;line-height:1.3;color:${T.navy}">${esc(b.title)}</h3>` : ""}${rich(b.text, T, base, T.ink, 14)}${button(b, T, base, false)}</td>`;
      return row(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${b.side === "right" ? txt + pic : pic + txt}</tr></table>`, "#ffffff", "22px 44px");
    },
    features(b, T, base) {
      const items = (b.items || []).filter(i => i && (i.title || i.text)).slice(0, 3);
      if (!items.length) return "";
      const w = Math.floor(100 / items.length);
      const cells = items.map((i, n) => `<td class="stack" width="${w}%" valign="top" style="width:${w}%;padding:0 ${n < items.length - 1 ? 8 : 0}px 14px ${n ? 8 : 0}px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${T.soft}" style="background:${T.soft};border-top:3px solid ${n % 2 ? T.accent2 : T.accent};border-radius:0 0 8px 8px;padding:18px 16px">
<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:bold;color:${T.accent}">0${n + 1}</p>
<h3 style="margin:0 0 8px;font-family:${FONT};font-size:16px;line-height:1.3;color:${T.navy}">${esc(i.title)}</h3>
<p style="margin:0;font-family:${FONT};font-size:13.5px;line-height:1.6;color:${T.muted}">${inline(i.text, T, base)}</p></td></tr></table></td>`).join("");
      return row(`${b.title ? `<h2 style="margin:0 0 16px;font-family:${FONT};font-size:20px;color:${T.navy}">${esc(b.title)}</h2>` : ""}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${cells}</tr></table>`, "#ffffff", "20px 44px 10px");
    },
    stats(b, T) {
      const items = (b.items || []).filter(i => i && (i.v || i.l)).slice(0, 4);
      if (!items.length) return "";
      const w = Math.floor(100 / items.length);
      return row(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${items.map((i, n) => `<td class="stack" width="${w}%" align="center" valign="top" style="width:${w}%;padding:12px 6px;${n ? `border-left:1px solid ${T.line}` : ""}">
<p style="margin:0;font-family:${FONT};font-size:30px;font-weight:bold;line-height:1.1;color:${T.accent2}">${esc(i.v)}</p><p style="margin:6px 0 0;font-family:${FONT};font-size:12.5px;line-height:1.4;color:${T.muted}">${esc(i.l)}</p></td>`).join("")}</tr></table>`, "#ffffff", "18px 44px");
    },
    quote(b, T, base) {
      return row(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-left:4px solid ${T.accent};padding:4px 0 4px 20px">
<p style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:18px;font-style:italic;line-height:1.55;color:${T.navy}">${inline(b.text, T, base)}</p>${b.by ? `<p style="margin:0;font-family:${FONT};font-size:13px;font-weight:bold;color:${T.muted}">${esc(b.by)}</p>` : ""}</td></tr></table>`, "#ffffff", "22px 44px");
    },
    cta(b, T, base) {
      return `<tr><td class="px" bgcolor="#ffffff" style="background:#ffffff;padding:18px 44px 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${T.soft}" align="center" style="background:${T.soft};border-radius:10px;padding:30px 28px;text-align:center">
${b.title ? `<h2 style="margin:0 0 10px;font-family:${FONT};font-size:22px;line-height:1.3;color:${T.navy}">${esc(b.title)}</h2>` : ""}${b.text ? rich(b.text, T, base, T.ink, 15) : ""}${button(b, T, base, false, "center")}</td></tr></table></td></tr>`;
    },
    divider(b, T) { return row(`<div style="height:1px;line-height:1px;font-size:1px;background:${T.line}">&nbsp;</div>`, "#ffffff", "14px 44px"); },
    spacer(b) { const h = Math.max(8, Math.min(80, Number(b.h) || 24)); return `<tr><td bgcolor="#ffffff" style="background:#ffffff;height:${h}px;line-height:${h}px;font-size:1px">&nbsp;</td></tr>`; },
    html(b) { return row(String(b.html || ""), "#ffffff", "14px 44px"); },
  };

  function footer(brand, T, base) {
    const socials = Object.entries(brand.socials || {}).filter(([k, u]) => SOCIAL_NAMES[k] && safeUrl(u)).map(([k, u]) =>
      `<a href="${attr(safeUrl(u))}" target="_blank" style="color:#ffffff;text-decoration:none;font-weight:bold">${SOCIAL_NAMES[k]}</a>`).join(`<span style="color:${T.onNavy}">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>`);
    const web = safeUrl(brand.website);
    return `<tr><td class="px" bgcolor="${T.navy}" style="background:${T.navy};padding:30px 44px;text-align:center;border-radius:0 0 10px 10px">
${socials ? `<p style="margin:0 0 16px;font-family:${FONT};font-size:13px">${socials}</p>` : ""}
<p style="margin:0 0 4px;font-family:${FONT};font-size:13px;font-weight:bold;color:#ffffff">${esc(brand.name)}</p>
<p style="margin:0 0 4px;font-family:${FONT};font-size:12px;line-height:1.6;color:${T.onNavy}">${esc(brand.address)}${web ? ` &middot; <a href="${attr(web)}" style="color:${T.onNavy};text-decoration:underline">${esc(web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>` : ""}</p>
<p style="margin:14px 0 0;font-family:${FONT};font-size:11.5px;line-height:1.6;color:${T.onNavy}">${esc(brand.footerNote || `You are receiving this email because you are a customer or business contact of ${brand.name}.`)}<br>
<a href="{{unsubscribe_url}}" style="color:#ffffff;text-decoration:underline">Unsubscribe</a> from these emails at any time.</p></td></tr>`;
  }

  // brand: {key, name, logo (absolute or site path), address, website, socials, footerNote}
  function renderEmail(c, brand, opts) {
    opts = opts || {};
    const base = opts.base || "";
    const T = Object.assign({}, THEMES[brand.key] || THEMES.bifold, { ph: !!opts.placeholders });
    const blocks = (Array.isArray(c.blocks) ? c.blocks : []).map(b => (BLOCKS[b && b.t] ? BLOCKS[b.t](b, T, base) : "")).join("\n");
    const logo = safeUrl(brand.logo, base);
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
<body style="margin:0;padding:0;background:${T.page}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${T.page}">${pre}${"&#8199;&#65279;&#847; ".repeat(60)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${T.page}" style="background:${T.page}">
<tr><td align="center" style="padding:28px 12px">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="w" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px">
<tr><td class="px" bgcolor="#ffffff" style="background:#ffffff;padding:24px 44px 20px;border-radius:10px 10px 0 0;border-bottom:4px solid ${T.accent}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
<td valign="middle">${logo ? `<a href="${attr(safeUrl(brand.website) || logo)}" target="_blank"><img src="${attr(logo)}" alt="${attr(brand.name)}" height="${brand.key === "techhub" ? 38 : 46}" style="display:block;height:${brand.key === "techhub" ? 38 : 46}px;width:auto;border:0"></a>` : `<b style="font-family:${FONT};font-size:18px;color:${T.navy}">${esc(brand.name)}</b>`}</td>
${c.edition ? `<td valign="middle" align="right" style="font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${T.muted}">${esc(c.edition)}</td>` : ""}
</tr></table></td></tr>
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

  const api = { renderEmail, renderText, personalize, THEMES, SOCIAL_NAMES, BLOCK_TYPES: Object.keys(BLOCKS) };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MkRender = api;
})(typeof window !== "undefined" ? window : this);
