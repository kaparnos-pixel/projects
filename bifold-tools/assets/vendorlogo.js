// Vendor logos, shared by Vendor Partners and Suppliers & Vendors.
// VLogo.html(item, size) gives a logo tile; VLogo.wire(root) loads it. Each tile tries, in order:
//   1. a logo someone uploaded by hand (served by our API),
//   2. the Brandfetch Logo API, loaded straight into an <img> by the browser as Brandfetch's terms require
//      (only when BRANDFETCH_CLIENT_ID is set; the server never downloads Brandfetch images),
//   3. the icon from the vendor's own website, fetched once by our API and kept,
//   4. a lettermark tile with the vendor's initials, so a broken image is never shown.
// VLogo.domainFor(name) suggests the website domain for well-known vendors.
window.VLogo = (function () {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let BF = "";
  const KNOWN = {
    "cisco": "cisco.com", "cisco meraki": "meraki.com", "meraki": "meraki.com", "microsoft": "microsoft.com", "hpe": "hpe.com", "hewlett packard enterprise": "hpe.com",
    "hp": "hp.com", "hp inc": "hp.com", "aruba": "arubanetworks.com", "hpe aruba": "arubanetworks.com", "dell": "dell.com", "dell technologies": "dell.com", "lenovo": "lenovo.com",
    "fortinet": "fortinet.com", "sophos": "sophos.com", "palo alto": "paloaltonetworks.com", "palo alto networks": "paloaltonetworks.com", "juniper": "juniper.net",
    "ubiquiti": "ui.com", "mikrotik": "mikrotik.com", "tp-link": "tp-link.com", "ruckus": "ruckusnetworks.com", "hikvision": "hikvision.com", "dahua": "dahuasecurity.com",
    "axis": "axis.com", "axis communications": "axis.com", "hanwha": "hanwhavision.com", "milestone": "milestonesys.com", "zkteco": "zkteco.com", "yeastar": "yeastar.com",
    "grandstream": "grandstream.com", "yealink": "yealink.com", "avaya": "avaya.com", "panasonic": "panasonic.com", "commscope": "commscope.com", "panduit": "panduit.com",
    "legrand": "legrand.com", "schneider": "se.com", "schneider electric": "se.com", "apc": "apc.com", "schneider apc": "apc.com", "eaton": "eaton.com", "vertiv": "vertiv.com",
    "vmware": "vmware.com", "broadcom": "broadcom.com", "veeam": "veeam.com", "synology": "synology.com", "qnap": "qnap.com", "samsung": "samsung.com", "lg": "lg.com",
    "epson": "epson.com", "canon": "canon.com", "logitech": "logitech.com", "poly": "poly.com", "kaspersky": "kaspersky.com", "eset": "eset.com", "bitdefender": "bitdefender.com",
    "google": "google.com", "google cloud": "cloud.google.com", "aws": "aws.amazon.com", "amazon web services": "aws.amazon.com", "oracle": "oracle.com", "ibm": "ibm.com",
    "nutanix": "nutanix.com", "netapp": "netapp.com", "check point": "checkpoint.com", "checkpoint": "checkpoint.com", "trend micro": "trendmicro.com", "crowdstrike": "crowdstrike.com",
    "zoom": "zoom.us", "adobe": "adobe.com", "autodesk": "autodesk.com", "acronis": "acronis.com", "f5": "f5.com", "extreme networks": "extremenetworks.com", "cambium": "cambiumnetworks.com",
    "huawei": "huawei.com", "h3c": "h3c.com", "avtech": "avtech.com.tw", "sangfor": "sangfor.com", "sangfor technologies": "sangfor.com", "zebra": "zebra.com", "honeywell": "honeywell.com", "bosch": "boschsecurity.com", "siemon": "siemon.com", "belden": "belden.com", "draytek": "draytek.com",
    "sonicwall": "sonicwall.com", "watchguard": "watchguard.com", "barracuda": "barracuda.com", "seagate": "seagate.com", "western digital": "westerndigital.com", "kingston": "kingston.com",
    "asus": "asus.com", "acer": "acer.com", "apple": "apple.com", "brother": "brother.com", "xerox": "xerox.com", "ricoh": "ricoh.com", "kyocera": "kyoceradocumentsolutions.com",
  };
  const domainFor = name => KNOWN[String(name || "").trim().toLowerCase().replace(/\s+/g, " ")] || "";
  const domainOf = v => { const s = String(v || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:\s]/)[0]; return /^([a-z0-9-]+\.)+[a-z]{2,24}$/.test(s) ? s : ""; };
  const initials = n => { const w = String(n || "?").replace(/[^A-Za-z0-9 &]+/g, " ").trim().split(/\s+/).filter(x => x !== "&"); return ((w[0] || "?")[0] + (w[1] ? w[1][0] : (w[0] || "").slice(1, 2))).toUpperCase(); };
  const TONES = ["#38506a", "#4b5d6e", "#3f5f5a", "#5a4f6b", "#64553f", "#45566f", "#4f6250", "#5f4c55"];
  const tone = n => { let h = 0; for (const c of String(n || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TONES[h % TONES.length]; };
  const brandfetch = d => BF && d ? `https://cdn.brandfetch.io/domain/${encodeURIComponent(d)}/w/160/h/160/fallback/404/icon?c=${encodeURIComponent(BF)}` : "";

  // item: { vendor, logo: { upload, domain, site } } as the partners API returns it, or { vendor, domain } for anything else.
  function html(item, size, extra) {
    const lg = item.logo || {}, d = lg.domain || domainOf(item.domain) || domainFor(item.vendor);
    const srcs = [lg.upload, brandfetch(d), lg.site].filter(Boolean);
    return `<span class="vlogo ${extra || ""}" style="--vl:${size || 48}px;--vt:${tone(item.vendor)}" data-srcs="${esc(JSON.stringify(srcs))}" title="${esc(item.vendor || "")}" aria-hidden="true"><b>${esc(initials(item.vendor))}</b></span>`;
  }
  function wire(root) {
    (root || document).querySelectorAll(".vlogo[data-srcs]:not([data-w])").forEach(el => {
      el.dataset.w = "1";
      let srcs; try { srcs = JSON.parse(el.dataset.srcs); } catch { srcs = []; }
      const next = i => {
        if (i >= srcs.length) { el.classList.remove("has"); const im = el.querySelector("img"); if (im) im.remove(); return; }
        const img = new Image(); img.alt = ""; img.decoding = "async"; img.referrerPolicy = "strict-origin-when-cross-origin";
        img.onload = () => { if (img.naturalWidth < 8) return next(i + 1); const old = el.querySelector("img"); if (old) old.remove(); el.appendChild(img); el.classList.add("has"); };
        img.onerror = () => next(i + 1);
        img.src = srcs[i];
      };
      next(0);
    });
  }
  if (!document.getElementById("vlogo-css")) {
    const st = document.createElement("style"); st.id = "vlogo-css";
    st.textContent = `.vlogo{position:relative;flex:none;display:inline-grid;place-items:center;width:var(--vl);height:var(--vl);border-radius:calc(var(--vl) * .22);background:var(--vt);color:#fff;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}
.vlogo b{font-size:calc(var(--vl) * .36);font-weight:700;letter-spacing:.02em;font-family:inherit}
.vlogo.has{background:#fff;box-shadow:inset 0 0 0 1px var(--line,#d5dce3)}
.vlogo.has b{display:none}
.vlogo img{position:absolute;inset:12%;width:76%;height:76%;object-fit:contain}`;
    document.head.appendChild(st);
  }
  return { html, wire, domainFor, domainOf, setClientId: id => { BF = String(id || ""); } };
})();
