(function(){
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const day=iso=>iso?new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"";
const KINDS=["Supplier","Vendor","Distributor","Manufacturer","Subcontractor","Service provider"];
const ST={active:"Active",preferred:"Preferred",onhold:"On hold",blocked:"Blocked"};
const CAT0=["Networking","Wireless","Firewall & Security","Servers & Storage","Computers & Laptops","Printers & Copiers","CCTV & Surveillance","Access Control","Telephony & PBX","Structured Cabling","Fiber Optics","Racks & Enclosures","UPS & Power","Software & Licensing","Microsoft 365 & Cloud","AV & Displays","Fire Alarm","Consumables & Toner","Accessories & Peripherals","Logistics & Freight","Subcontract labour","Civil & Electrical works"];
const BR0=["Cisco","Meraki","Aruba","HPE","Dell","Lenovo","HP","Fortinet","Sophos","Palo Alto","Juniper","Ubiquiti","MikroTik","TP-Link","Ruckus","Hikvision","Dahua","Axis","Hanwha","Milestone","ZKTeco","Yeastar","Grandstream","Yealink","Avaya","Panasonic","Commscope","Panduit","Legrand","Schneider APC","Eaton","Vertiv","Microsoft","VMware","Veeam","Synology","QNAP","Samsung","LG","Epson","Canon","Logitech","Poly","Kaspersky","ESET","Bitdefender"];
let ME=null,LIST=[],cur=null,VIEW="dir",BY="brands",CAN=false;

function toast(m,e){const t=document.createElement("div");t.className="toast"+(e?" err":"");t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),e?6000:2600)}
async function api(method,path,body){
  let r;try{r=await fetch("/api/"+path,{method,headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined,cache:"no-store"})}catch{throw new Error("Can't reach the server. Check your connection and try again.")}
  const ct=r.headers.get("content-type")||"";
  if(r.redirected||(r.ok&&r.status!==204&&!ct.includes("json")))throw new Error("Your session has ended. Reload the page to sign in again.");
  let j=null;if(r.status!==204){try{j=await r.json()}catch{}}
  if(!r.ok){const e=new Error((j&&j.error)||"The request failed.");e.status=r.status;e.data=j;throw e}return j;
}
const tel=v=>String(v||"").replace(/[^\d+]/g,"");
const wa=v=>{let d=String(v||"").replace(/\D/g,"");if(d.startsWith("00"))d=d.slice(2);else if(d.startsWith("0"))d="971"+d.slice(1);return d.length>=9?"https://wa.me/"+d:""};
const site=v=>!v?"":/^https?:\/\//i.test(v)?v:"https://"+v;
const primary=s=>s.contacts.find(c=>c.primary)||s.contacts[0]||null;
const uniq=a=>{const m=new Map();a.forEach(x=>{const k=String(x).toLowerCase();if(x&&!m.has(k))m.set(k,x)});return [...m.values()].sort((x,y)=>x.localeCompare(y))};
const hay=s=>[s.name,s.kind,s.supplies,s.categories.join(" "),s.brands.join(" "),s.email,s.phone,s.website,s.emirate,s.country,s.trn,s.notes,s.paymentTerms,...s.contacts.map(c=>[c.name,c.role,c.mobile,c.phone,c.email,c.handles,c.notes].join(" "))].join(" ").toLowerCase();
const words=()=>$("q").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
const IC={
  phone:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  mail:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  wa:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21l1.6-4.8A8.5 8.5 0 1 1 8 19.6z"/></svg>',
  copy:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
};
const stars=n=>n?`<span class="rate" title="${n} of 5">${"★".repeat(n)}${"☆".repeat(5-n)}</span>`:"";
const stc=s=>s==="active"?"":`<span class="stc ${s}">${ST[s]}</span>`;

/* ---------- filters ---------- */
function filtered(){
  const w=words(),cat=$("fCat").value,br=$("fBrand").value,k=$("fKind").value,st=$("fSt").value;
  return LIST.filter(s=>(!cat||s.categories.some(x=>x===cat))&&(!br||s.brands.some(x=>x===br))&&(!k||s.kind===k)&&(!st||s.status===st)&&(!w.length||(h=>w.every(x=>h.includes(x)))(hay(s))));
}
function fillFilters(){
  const keep=(id,vals,label)=>{const sel=$(id),v=sel.value;sel.innerHTML=`<option value="">${label}</option>`+vals.map(x=>`<option>${esc(x)}</option>`).join("");if(vals.includes(v))sel.value=v};
  keep("fCat",uniq(LIST.flatMap(s=>s.categories)),"All categories");
  keep("fBrand",uniq(LIST.flatMap(s=>s.brands)),"All brands");
  keep("fKind",KINDS.filter(k=>LIST.some(s=>s.kind===k)),"All types");
}
function kpis(){
  const cons=LIST.reduce((a,s)=>a+s.contacts.length,0),brands=uniq(LIST.flatMap(s=>s.brands)),cats=uniq(LIST.flatMap(s=>s.categories));
  const by={};LIST.forEach(s=>by[s.kind]=(by[s.kind]||0)+1);
  $("kSup").textContent=LIST.length;$("kSupS").textContent=Object.entries(by).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,n])=>`${n} ${k.toLowerCase()}${n===1?"":"s"}`).join(" · ")||"None yet";
  const pref=LIST.filter(s=>s.status==="preferred").length,held=LIST.filter(s=>s.status==="onhold"||s.status==="blocked").length;
  $("kPref").textContent=pref;$("kPrefS").textContent=held?`${held} on hold or blocked`:"None on hold";
  $("kCon").textContent=cons;$("kConS").textContent=LIST.filter(s=>!s.contacts.length).length?`${LIST.filter(s=>!s.contacts.length).length} supplier(s) with no contact yet`:"Every supplier has a contact";
  $("kBr").textContent=brands.length;$("kBrS").textContent=`${cats.length} categor${cats.length===1?"y":"ies"}`;
}

/* ---------- views ---------- */
function render(){
  ["dir","what","people"].forEach(v=>$({dir:"vDir",what:"vWhat",people:"vPeople"}[v]).hidden=v!==VIEW);
  document.querySelectorAll("#viewSeg button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.view===VIEW));
  const rows=filtered(),w=words();
  const hit=t=>w.some(x=>t.toLowerCase().includes(x));
  $("cnt").textContent=rows.length===LIST.length?`${LIST.length} supplier${LIST.length===1?"":"s"}`:`${rows.length} of ${LIST.length}`;
  if(VIEW==="dir"){
    $("rows").innerHTML=rows.map(s=>{const p=primary(s);return `<tr data-id="${esc(s.id)}" tabindex="0" class="${s.status}">
      <td><div class="t">${esc(s.name)}</div><div class="s"><span class="badge">${esc(s.kind)}</span> ${stc(s.status)} ${stars(s.rating)}</div><div class="s">${esc([s.emirate,s.country!=="UAE"?s.country:""].filter(Boolean).join(", "))}</div></td>
      <td class="sw"><div class="chips">${s.brands.slice(0,8).map(b=>`<span class="chip2${w.length&&hit(b)?" hit":""}">${esc(b)}</span>`).join("")}${s.brands.length>8?`<span class="chip2">+${s.brands.length-8}</span>`:""}${s.categories.slice(0,4).map(c=>`<span class="chip2 cat${w.length&&hit(c)?" hit":""}">${esc(c)}</span>`).join("")}</div>${s.supplies?`<div class="s" style="margin-top:4px">${esc(s.supplies.length>110?s.supplies.slice(0,107)+"...":s.supplies)}</div>`:""}</td>
      <td>${p?`<div class="t">${esc(p.name)}</div><div class="s">${esc(p.role)}</div>`:`<span class="s">No contact yet</span>`}${s.contacts.length>1?`<div class="s">+${s.contacts.length-1} more</div>`:""}</td>
      <td><div class="reach">${p&&(p.mobile||p.phone)?`<a href="tel:${esc(tel(p.mobile||p.phone))}">${IC.phone}${esc(p.mobile||p.phone)}</a>`:s.phone?`<a href="tel:${esc(tel(s.phone))}">${IC.phone}${esc(s.phone)}</a>`:""}${p&&p.email?`<a href="mailto:${esc(p.email)}">${IC.mail}${esc(p.email)}</a>`:s.email?`<a href="mailto:${esc(s.email)}">${IC.mail}${esc(s.email)}</a>`:""}</div></td>
      <td><div class="s">${esc(s.paymentTerms||(s.creditDays?s.creditDays+" days":""))}</div>${s.creditLimit?`<div class="s">Limit ${esc(s.currency)} ${s.creditLimit.toLocaleString("en-US")}</div>`:""}</td></tr>`}).join("");
    $("rows").querySelectorAll("tr").forEach(tr=>{tr.onclick=e=>{if(!e.target.closest("a"))show(tr.dataset.id)};tr.onkeydown=e=>{if(e.key==="Enter")show(tr.dataset.id)}});
    $("empty").hidden=rows.length>0;
    $("empty").textContent=LIST.length?"No suppliers match. Try another brand, product or name.":CAN?"No suppliers yet. Add the first one with + New supplier, or import your existing list from Excel.":"No suppliers yet.";
  }
  if(VIEW==="what"){
    document.querySelectorAll("#bySeg button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.by===BY));
    const groups=new Map();
    rows.forEach(s=>{const keys=s[BY].length?s[BY]:[null];keys.forEach(k=>{const g=k||"";if(!groups.has(g))groups.set(g,[]);groups.get(g).push(s)})});
    let keys=[...groups.keys()].filter(Boolean).sort((a,b)=>a.localeCompare(b));
    const narrowed=w.length&&keys.some(hit);if(narrowed)keys=keys.filter(hit);
    if(groups.has("")&&!narrowed)keys.push("");
    $("whatHint").textContent=keys.filter(Boolean).length?`${keys.filter(Boolean).length} ${BY==="brands"?"brand":"categor"}${keys.filter(Boolean).length===1?(BY==="brands"?"":"y"):(BY==="brands"?"s":"ies")}. Click a supplier for all its contacts.`:"";
    $("what").innerHTML=keys.map(k=>{const l=groups.get(k).sort((a,b)=>(b.status==="preferred")-(a.status==="preferred")||a.name.localeCompare(b.name));
      return `<div class="wcard${k?"":" none"}"><h4>${esc(k||(BY==="brands"?"No brand listed":"No category listed"))}<span>${l.length} supplier${l.length===1?"":"s"}</span></h4>${l.map(s=>{const p=primary(s);return `<div class="wi" data-id="${esc(s.id)}" tabindex="0"><b>${esc(s.name)}</b><span>${stc(s.status)}</span><div class="c">${p?`${esc(p.name)}${p.role?", "+esc(p.role):""}${p.mobile||p.phone?` · <a href="tel:${esc(tel(p.mobile||p.phone))}">${esc(p.mobile||p.phone)}</a>`:""}${p.email?` · <a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`:""}`:"No contact yet"}</div></div>`}).join("")}</div>`}).join("")
      ||`<div class="panel empty">${LIST.length?"Nothing matches your search.":"No suppliers yet."}</div>`;
    $("what").querySelectorAll(".wi").forEach(d=>{d.onclick=e=>{if(!e.target.closest("a"))show(d.dataset.id)};d.onkeydown=e=>{if(e.key==="Enter")show(d.dataset.id)}});
  }
  if(VIEW==="people"){
    const ppl=[];rows.forEach(s=>s.contacts.forEach(c=>ppl.push([c,s])));
    const shown=w.length?ppl.filter(([c,s])=>(h=>w.every(x=>h.includes(x)))([c.name,c.role,c.mobile,c.phone,c.email,c.handles,c.notes,s.name,s.brands.join(" "),s.categories.join(" ")].join(" ").toLowerCase())):ppl;
    shown.sort((a,b)=>a[0].name.localeCompare(b[0].name));
    $("prow").innerHTML=shown.map(([c,s])=>`<tr data-id="${esc(s.id)}"><td class="t">${esc(c.name)}${c.primary?' <span class="badge">Main</span>':""}</td><td>${esc(c.role)}</td><td>${esc(s.name)}</td><td>${c.mobile?`<a href="tel:${esc(tel(c.mobile))}">${esc(c.mobile)}</a>`:""}</td><td>${c.phone?`<a href="tel:${esc(tel(c.phone))}">${esc(c.phone)}</a>`:""}</td><td>${c.email?`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`:""}</td><td class="s">${esc(c.handles)}</td></tr>`).join("");
    $("prow").querySelectorAll("tr").forEach(tr=>tr.onclick=e=>{if(!e.target.closest("a"))show(tr.dataset.id)});
    $("pempty").hidden=shown.length>0;$("pempty").textContent=ppl.length?"No contacts match your search.":"No contacts yet.";
    $("cnt").textContent=`${shown.length} contact${shown.length===1?"":"s"}`;
  }
}

/* ---------- supplier card ---------- */
function show(id){
  const s=LIST.find(x=>x.id===id);if(!s)return;cur=s;
  history.replaceState(null,"","#s="+encodeURIComponent(id));
  $("vKind").textContent=s.kind+(s.emirate?" · "+s.emirate:"");$("vName").textContent=s.name;
  $("vBadges").innerHTML=[stc(s.status),stars(s.rating)].filter(Boolean).join(" ");
  const kv=[["Office phone",s.phone&&`<a href="tel:${esc(tel(s.phone))}">${esc(s.phone)}</a>`],["Email",s.email&&`<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>`],["Website",s.website&&`<a href="${esc(site(s.website))}" target="_blank" rel="noopener">${esc(s.website)}</a>`],
    ["Address",esc([s.address,s.emirate,s.country].filter(Boolean).join(", "))],["TRN",s.trn&&`<span class="mono">${esc(s.trn)}</span>`],["Trade licence",esc(s.licenceNo)],
    ["Payment terms",esc(s.paymentTerms)],["Credit days",s.creditDays?String(s.creditDays):""],["Credit limit",s.creditLimit?`${esc(s.currency)} ${s.creditLimit.toLocaleString("en-US")}`:""]].filter(x=>x[1]);
  $("vBody").innerHTML=`
    <div class="vsec"><h5>Supplies</h5>${s.brands.length||s.categories.length?`<div class="chips">${s.brands.map(b=>`<span class="chip2">${esc(b)}</span>`).join("")}${s.categories.map(c=>`<span class="chip2 cat">${esc(c)}</span>`).join("")}</div>`:""}${s.supplies?`<p class="pre" style="margin-top:8px">${esc(s.supplies)}</p>`:""}${!s.brands.length&&!s.categories.length&&!s.supplies?`<span class="hint">Nothing listed yet.</span>`:""}</div>
    <div class="vsec"><h5>Contacts (${s.contacts.length})</h5>${s.contacts.map(c=>`<div class="ccard"><div class="top"><span><b>${esc(c.name)}</b> ${c.primary?'<span class="pr">Main contact</span>':""}</span></div>${c.role||c.handles?`<div class="role">${esc([c.role,c.handles&&"Handles: "+c.handles].filter(Boolean).join(" · "))}</div>`:""}
      <div class="acts">${c.mobile?`<a href="tel:${esc(tel(c.mobile))}">${IC.phone}${esc(c.mobile)}</a>`:""}${c.mobile&&wa(c.mobile)?`<a href="${esc(wa(c.mobile))}" target="_blank" rel="noopener">${IC.wa}WhatsApp</a>`:""}${c.phone?`<a href="tel:${esc(tel(c.phone))}">${IC.phone}${esc(c.phone)}</a>`:""}${c.email?`<a href="mailto:${esc(c.email)}">${IC.mail}${esc(c.email)}</a>`:""}<button type="button" data-copy="${esc(c.id)}">${IC.copy}Copy</button></div>${c.notes?`<div class="nt">${esc(c.notes)}</div>`:""}</div>`).join("")||`<span class="hint">No contacts yet.${CAN?" Use Edit to add the people you deal with.":""}</span>`}</div>
    ${kv.length?`<div class="vsec"><h5>Company</h5><dl class="kv">${kv.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>`:""}
    ${s.notes?`<div class="vsec"><h5>Notes</h5><p class="pre">${esc(s.notes)}</p></div>`:""}
    <p class="hint" style="margin:0">Added by ${esc(s.createdBy)} on ${esc(day(s.createdAt))}${s.updatedAt!==s.createdAt?` · last changed by ${esc(s.updatedBy)} on ${esc(day(s.updatedAt))}`:""}</p>`;
  $("vBody").querySelectorAll("[data-copy]").forEach(b=>b.onclick=()=>{const c=s.contacts.find(x=>x.id===b.dataset.copy);copy(cardText(s,[c]),"Contact copied")});
  $("vEdit").hidden=!CAN;
  $("vDel").hidden=!(CAN&&(ME.isManager||s.createdBy===ME.email));$("vDel").textContent="Delete";$("vDel").classList.remove("armed");
  if(!$("view").open)$("view").showModal();
}
const cardText=(s,cs)=>[s.name,...cs.map(c=>[c.name+(c.role?" ("+c.role+")":""),c.mobile&&"Mobile: "+c.mobile,c.phone&&"Phone: "+c.phone,c.email&&"Email: "+c.email].filter(Boolean).join("\n"))].join("\n\n");
function copy(t,msg){(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(()=>toast(msg)).catch(()=>toast("Couldn't copy. Select the text and copy it instead.",1))}
$("vX").onclick=()=>$("view").close();
$("view").addEventListener("close",()=>{if(/^#s=/.test(location.hash))history.replaceState(null,"",location.pathname+location.search)});
$("view").addEventListener("click",e=>{if(e.target===$("view"))$("view").close()});
$("vCopy").onclick=()=>cur&&copy(cardText(cur,cur.contacts),cur.contacts.length?"Contacts copied":"Copied");
$("vEdit").onclick=()=>{$("view").close();edit(cur)};
$("vDel").onclick=async()=>{
  const b=$("vDel");if(!b.classList.contains("armed")){b.classList.add("armed");b.textContent="Click again to delete";setTimeout(()=>{b.classList.remove("armed");b.textContent="Delete"},4000);return}
  try{await api("DELETE","suppliers/"+encodeURIComponent(cur.id));LIST=LIST.filter(x=>x.id!==cur.id);$("view").close();refresh();toast("Supplier deleted")}catch(e){toast(e.message,1)}
};

/* ---------- tag input ---------- */
function tagBox(el,listId,sugg){
  let vals=[];const inp=document.createElement("input");inp.setAttribute("list",listId);inp.placeholder="Type and press Enter";inp.setAttribute("aria-label",el.closest("label").querySelector(".lbl").textContent);
  let dl=document.getElementById(listId);if(!dl){dl=document.createElement("datalist");dl.id=listId;document.body.appendChild(dl)}
  const draw=()=>{el.querySelectorAll(".tg").forEach(x=>x.remove());vals.forEach((v,i)=>{const t=document.createElement("span");t.className="tg";t.innerHTML=`${esc(v)}<button type="button" aria-label="Remove ${esc(v)}">×</button>`;t.querySelector("button").onclick=()=>{vals.splice(i,1);draw()};el.insertBefore(t,inp)});
    const have=new Set(vals.map(v=>v.toLowerCase()));dl.innerHTML=uniq(sugg().concat()).filter(x=>!have.has(x.toLowerCase())).map(x=>`<option value="${esc(x)}">`).join("")};
  const add=raw=>{String(raw).split(/[,;]+/).map(x=>x.trim().replace(/\s+/g," ")).filter(Boolean).forEach(v=>{if(!vals.some(x=>x.toLowerCase()===v.toLowerCase())){const known=sugg().find(x=>x.toLowerCase()===v.toLowerCase());vals.push(known||v)}});inp.value="";draw()};
  inp.onkeydown=e=>{if((e.key==="Enter"||e.key===",")&&inp.value.trim()){e.preventDefault();add(inp.value)}else if(e.key==="Enter")e.preventDefault();else if(e.key==="Backspace"&&!inp.value&&vals.length){vals.pop();draw()}};
  inp.onchange=()=>{if(inp.value.trim()&&sugg().some(x=>x.toLowerCase()===inp.value.trim().toLowerCase()))add(inp.value)};
  inp.onblur=()=>{if(inp.value.trim())add(inp.value)};
  el.appendChild(inp);el.onclick=e=>{if(e.target===el)inp.focus()};
  return{get:()=>{if(inp.value.trim())add(inp.value);return vals.slice()},set:v=>{vals=(v||[]).slice();inp.value="";draw()}};
}
const TB={categories:tagBox($("t_categories"),"catList",()=>CAT0.concat(LIST.flatMap(s=>s.categories))),brands:tagBox($("t_brands"),"brList",()=>BR0.concat(LIST.flatMap(s=>s.brands)))};

/* ---------- edit form ---------- */
$("f_kind").innerHTML=KINDS.map(k=>`<option>${k}</option>`).join("");
let RATING=0;
function drawStars(){$("f_rating").innerHTML=[1,2,3,4,5].map(n=>`<button type="button" role="radio" aria-checked="${n===RATING}" aria-label="${n} star${n>1?"s":""}" class="${n<=RATING?"on":""}" data-n="${n}">★</button>`).join("");$("f_rating").querySelectorAll("button").forEach(b=>b.onclick=()=>{RATING=+b.dataset.n===RATING?0:+b.dataset.n;drawStars()})}
const FIELDS=["name","kind","status","supplies","phone","email","website","trn","address","emirate","country","licenceNo","paymentTerms","creditDays","creditLimit","currency","notes"];
function conRow(c){
  c=c||{};const d=document.createElement("div");d.className="con";d.dataset.id=c.id||"";
  d.innerHTML=`<div class="chd"><label><input type="radio" name="primary"${c.primary?" checked":""}> Main contact</label><button type="button" class="rm danger">Remove</button></div>
    <div class="fields"><label><span class="lbl">Name *</span><input data-k="name" maxlength="100" value="${esc(c.name)}"></label><label><span class="lbl">Role</span><input data-k="role" maxlength="80" list="roleList" value="${esc(c.role)}"></label></div>
    <div class="fields three"><label><span class="lbl">Mobile</span><input data-k="mobile" maxlength="40" inputmode="tel" value="${esc(c.mobile)}"></label><label><span class="lbl">Direct / office line</span><input data-k="phone" maxlength="40" inputmode="tel" value="${esc(c.phone)}"></label><label><span class="lbl">Email</span><input data-k="email" type="email" maxlength="150" value="${esc(c.email)}"></label></div>
    <div class="fields"><label><span class="lbl">Handles (brands, products, area)</span><input data-k="handles" maxlength="200" placeholder="e.g. Cisco and Meraki, Dubai accounts" value="${esc(c.handles)}"></label><label><span class="lbl">Notes</span><input data-k="notes" maxlength="400" value="${esc(c.notes)}"></label></div>`;
  d.querySelector(".rm").onclick=()=>{d.remove();noCons()};
  $("cons").appendChild(d);noCons();return d;
}
function noCons(){const has=$("cons").querySelector(".con");let n=$("cons").querySelector(".noCons");if(!has&&!n){n=document.createElement("div");n.className="noCons";n.textContent="No contacts yet. Add the people you call for quotes, accounts, support and deliveries.";$("cons").appendChild(n)}else if(has&&n)n.remove()}
function readCons(){return [...$("cons").querySelectorAll(".con")].map(d=>{const o={id:d.dataset.id||undefined,primary:d.querySelector("input[type=radio]").checked};d.querySelectorAll("[data-k]").forEach(i=>o[i.dataset.k]=i.value.trim());return o}).filter(c=>c.name||c.email||c.mobile||c.phone)}
$("addCon").onclick=()=>{const d=conRow({primary:!$("cons").querySelector(".con")});d.querySelector("[data-k=name]").focus()};
function edit(s){
  cur=s||null;$("form").reset();$("err").textContent="";$("cons").innerHTML="";
  $("dTitle").textContent=s?"Edit "+s.name:"New supplier";$("saveBtn").textContent=s?"Save changes":"Add supplier";
  FIELDS.forEach(k=>{const v=s?s[k]:"";$("f_"+k).value=k==="creditDays"||k==="creditLimit"?(v||""):(v??"")});
  if(!s){$("f_kind").value="Supplier";$("f_status").value="active";$("f_country").value="UAE";$("f_currency").value="AED"}
  TB.categories.set(s?s.categories:[]);TB.brands.set(s?s.brands:[]);
  RATING=s?s.rating:0;drawStars();
  (s?s.contacts:[]).forEach(conRow);if(!s)conRow({primary:true});noCons();
  $("meta").textContent=s?`Added by ${s.createdBy} on ${day(s.createdAt)}`:"";
  $("dlg").showModal();$("f_name").focus();
}
$("addBtn").onclick=()=>edit(null);$("cancel").onclick=$("dX").onclick=()=>$("dlg").close();
$("form").onsubmit=async e=>{
  e.preventDefault();$("err").textContent="";
  const body={};FIELDS.forEach(k=>body[k]=$("f_"+k).value);
  body.categories=TB.categories.get();body.brands=TB.brands.get();body.rating=RATING;body.contacts=readCons();
  if(!body.name.trim()){$("err").textContent="Enter the supplier name.";$("f_name").focus();return}
  if(body.contacts.some(c=>!c.name)){$("err").textContent="Every contact needs a name.";return}
  if(cur)body.etag=cur.etag;
  $("saveBtn").disabled=true;
  try{
    const s=cur?await api("PUT","suppliers/"+encodeURIComponent(cur.id),body):await api("POST","suppliers",body);
    LIST=LIST.filter(x=>x.id!==s.id).concat(s).sort((a,b)=>a.name.localeCompare(b.name));refresh();$("dlg").close();toast(cur?"Supplier updated":`${s.name} added`);show(s.id);
  }catch(err){$("err").textContent=err.message;if(err.status===409&&err.data&&err.data.id&&!cur){$("err").innerHTML=esc(err.message)+` <a href="#" id="openDup">Open it</a>`;$("openDup").onclick=ev=>{ev.preventDefault();$("dlg").close();show(err.data.id)}}}
  finally{$("saveBtn").disabled=false}
};

/* ---------- export ---------- */
const XLSX_URL="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
function loadX(){return window.XLSX?Promise.resolve(window.XLSX):new Promise((ok,no)=>{const s=document.createElement("script");s.src=XLSX_URL;s.onload=()=>ok(window.XLSX);s.onerror=()=>no(new Error("Couldn't load the spreadsheet tool. Check your connection and try again."));document.head.appendChild(s)})}
$("expBtn").onclick=async()=>{
  try{
    const X=await loadX(),rows=[];
    filtered().forEach(s=>{const base={"Supplier":s.name,"Type":s.kind,"Status":ST[s.status],"Brands":s.brands.join(", "),"Categories":s.categories.join(", "),"Supplies":s.supplies,"Office phone":s.phone,"Company email":s.email,"Website":s.website,"Address":s.address,"Emirate / city":s.emirate,"Country":s.country,"TRN":s.trn,"Payment terms":s.paymentTerms,"Credit days":s.creditDays||"","Rating":s.rating||""};
      const cs=s.contacts.length?s.contacts:[{}];cs.forEach(c=>rows.push({...base,"Contact name":c.name||"","Role":c.role||"","Main contact":c.primary?"Yes":"","Mobile":c.mobile||"","Direct line":c.phone||"","Contact email":c.email||"","Handles":c.handles||""}))});
    const ws=X.utils.json_to_sheet(rows);ws["!cols"]=Object.keys(rows[0]||{Supplier:1}).map(k=>({wch:Math.min(40,Math.max(10,k.length+2))}));
    const wb=X.utils.book_new();X.utils.book_append_sheet(wb,ws,"Suppliers");
    X.writeFile(wb,`${ME.co==="techhub"?"TechHub":"Bifold"}-suppliers-${new Date().toISOString().slice(0,10)}.xlsx`);
  }catch(e){toast(e.message,1)}
};

/* ---------- import ---------- */
const IMP_FIELDS=[["name","Supplier name *",["supplier","supplier name","vendor","vendor name","company","company name","name","distributor"]],
  ["kind","Type",["type","supplier type","vendor type"]],
  ["brands","Brands",["brand","brands","make","makes","principal","principals","oem"]],
  ["categories","Categories",["category","categories","product category","segment","line of business"]],
  ["supplies","Products / services",["products","product","supplies","services","items","what they supply","description"]],
  ["contactName","Contact name",["contact","contact name","contact person","person","sales person","salesperson","attention","attn"]],
  ["contactRole","Contact role",["role","designation","title","position","job title"]],
  ["contactMobile","Mobile",["mobile","mobile number","cell","gsm","whatsapp"]],
  ["contactPhone","Direct line",["direct line","direct","landline","extension"]],
  ["contactEmail","Contact email",["contact email","email","e-mail","email address","mail"]],
  ["phone","Office phone",["office phone","phone","telephone","tel","company phone"]],
  ["email","Company email",["company email","general email","info email","sales email"]],
  ["website","Website",["website","web","url","site"]],
  ["address","Address",["address","location","street"]],
  ["emirate","Emirate / city",["emirate","city","state","region"]],
  ["country","Country",["country"]],
  ["trn","TRN",["trn","vat","trn number","vat number","tax registration number"]],
  ["paymentTerms","Payment terms",["payment terms","terms","payment"]],
  ["creditDays","Credit days",["credit days","credit period","days"]]];
let IMP={book:null,head:[],rows:[],map:{}};
const norm=h=>String(h??"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();
function guessMap(head){const m={},used=new Set();IMP_FIELDS.forEach(([k,,syn])=>{let i=head.findIndex((h,j)=>!used.has(j)&&syn.includes(norm(h)));if(i<0)i=head.findIndex((h,j)=>!used.has(j)&&syn.some(x=>x.length>4&&norm(h).includes(x)));if(i>=0){m[k]=i;used.add(i)}});return m}
function readSheet(name){
  const X=window.XLSX,ws=IMP.book.Sheets[name];
  const allr=X.utils.sheet_to_json(ws,{header:1,raw:false,defval:"",blankrows:false}).map(r=>r.map(v=>String(v??"").trim()));
  const hi=Math.max(0,allr.findIndex(r=>r.filter(Boolean).length>=2));
  IMP.head=(allr[hi]||[]).map((h,i)=>h||"Column "+(i+1));IMP.rows=allr.slice(hi+1).filter(r=>r.some(Boolean));IMP.map=guessMap(IMP.head);
  $("impMap").innerHTML=IMP_FIELDS.map(([k,l])=>`<label><span class="lbl">${esc(l)}</span><select data-k="${k}"><option value="">Not in file</option>${IMP.head.map((h,i)=>`<option value="${i}"${IMP.map[k]===i?" selected":""}>${esc(h)}</option>`).join("")}</select></label>`).join("");
  $("impMap").querySelectorAll("select").forEach(s=>s.onchange=()=>{if(s.value==="")delete IMP.map[s.dataset.k];else IMP.map[s.dataset.k]=+s.value;preview()});
  preview();
}
function impRecords(){return IMP.rows.map(r=>{const o={};IMP_FIELDS.forEach(([k])=>{o[k]=IMP.map[k]!=null?String(r[IMP.map[k]]||"").trim():""});return o})}
const SHOW=["name","brands","contactName","contactMobile","contactEmail","phone"];
function preview(){
  const recs=impRecords(),have=new Set(LIST.map(s=>s.name.toLowerCase())),names=new Set(),nw=new Set();let bad=0,cons=0;
  recs.forEach(o=>{if(!o.name){bad++;return}const k=o.name.toLowerCase();names.add(k);if(!have.has(k))nw.add(k);if(o.contactName||o.contactEmail)cons++});
  const ex=[...names].filter(k=>have.has(k)).length,upd=$("impUpd").checked;
  $("impStats").innerHTML=`<span>${nw.size} new supplier${nw.size===1?"":"s"}</span><span>${cons} contact row${cons===1?"":"s"}</span>${ex?`<span class="w">${ex} already in the list${upd?", details will be added":", will be skipped"}</span>`:""}${bad?`<span class="x">${bad} row${bad===1?"":"s"} without a supplier name, skipped</span>`:""}`;
  $("impHead").innerHTML="<tr><th></th>"+SHOW.map(k=>`<th>${esc(IMP_FIELDS.find(f=>f[0]===k)[1].replace(" *",""))}</th>`).join("")+"</tr>";
  $("impRows").innerHTML=recs.slice(0,200).map(o=>{const s=!o.name?"bad":have.has(o.name.toLowerCase())?"dup":"new";return `<tr class="${s}"><td>${s==="new"?"New":s==="dup"?"Exists":"No name"}</td>${SHOW.map(k=>`<td>${esc(o[k])}</td>`).join("")}</tr>`}).join("")+(recs.length>200?`<tr><td colspan="7">and ${recs.length-200} more rows</td></tr>`:"");
  const n=nw.size+(upd?ex:0);
  $("impGo").disabled=IMP.map.name==null||!n;
  $("impGo").textContent=IMP.map.name==null?"Choose the supplier name column":`Import ${n} supplier${n===1?"":"s"}`;
}
async function impFile(f){
  $("impErr").textContent="";if(!f)return;
  if(f.size>10e6){$("impErr").textContent="That file is larger than 10 MB.";return}
  try{
    const X=await loadX(),buf=await f.arrayBuffer();
    IMP.book=/\.csv$/i.test(f.name)?X.read(new TextDecoder("utf-8").decode(buf),{type:"string",raw:true}):X.read(buf,{type:"array"});
    const names=IMP.book.SheetNames;$("impSheet").innerHTML=names.map(n=>`<option>${esc(n)}</option>`).join("");$("sheetWrap").hidden=names.length<2;
    $("impName").textContent=f.name;$("impBody").hidden=false;readSheet(names[0]);
  }catch(e){$("impErr").textContent=/spreadsheet tool/.test(e.message)?e.message:"That file couldn't be read. Save it as .xlsx or .csv and try again."}
}
$("impBtn").onclick=()=>{IMP={book:null,head:[],rows:[],map:{}};$("impForm").reset();$("impUpd").checked=true;$("impBody").hidden=true;$("impErr").textContent="";$("impGo").disabled=true;$("impGo").textContent="Import";$("imp").showModal()};
$("impCancel").onclick=()=>$("imp").close();
$("impFile").onchange=e=>impFile(e.target.files[0]);
$("impSheet").onchange=()=>readSheet($("impSheet").value);
$("impUpd").onchange=preview;
const dz=$("impDrop");dz.ondragover=e=>{e.preventDefault();dz.classList.add("over")};dz.ondragleave=()=>dz.classList.remove("over");dz.ondrop=e=>{e.preventDefault();dz.classList.remove("over");impFile(e.dataTransfer.files[0])};
$("tplLink").onclick=e=>{e.preventDefault();const csv="Supplier name,Type,Brands,Categories,Products / services,Contact name,Role,Mobile,Direct line,Contact email,Office phone,Website,Emirate,Payment terms,Credit days\r\nExample Distribution FZE,Distributor,\"Cisco, Dell\",\"Networking, Servers & Storage\",Switches and servers,Ahmed Ali,Account Manager,+971 50 000 0000,+971 4 000 0000,ahmed@example.ae,+971 4 000 0001,www.example.ae,Dubai,30 days PDC,30\r\nExample Distribution FZE,Distributor,,,,Priya Nair,Accounts,+971 55 000 0000,,accounts@example.ae,,,,,\r\n";const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv"}));a.download="supplier-import-template.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)};
$("impForm").onsubmit=async e=>{
  e.preventDefault();$("impErr").textContent="";$("impGo").disabled=true;const label=$("impGo").textContent;$("impGo").textContent="Importing…";
  try{
    const rows=impRecords().filter(o=>o.name);
    // keep every row of one supplier in the same request so its contacts merge together
    const batches=[];let b=[],seen=new Set();rows.sort((x,y)=>x.name.toLowerCase().localeCompare(y.name.toLowerCase())).forEach(r=>{const k=r.name.toLowerCase();if(b.length>=1800&&!seen.has(k)){batches.push(b);b=[];seen=new Set()}b.push(r);seen.add(k)});if(b.length)batches.push(b);
    let added=0,updated=0,cons=0,skipped=0;
    for(const part of batches){const r=await api("POST","suppliers/import",{rows:part,update:$("impUpd").checked});added+=r.added;updated+=r.updated;cons+=r.contactsAdded;skipped+=r.skipped.length+r.invalid.length}
    LIST=await api("GET","suppliers");refresh();$("imp").close();
    toast(`${added} supplier${added===1?"":"s"} added${updated?`, ${updated} updated`:""}, ${cons} contact${cons===1?"":"s"} added${skipped?`, ${skipped} skipped`:""}`);
  }catch(err){$("impErr").textContent=err.message;$("impGo").disabled=false;$("impGo").textContent=label}
};

/* ---------- wiring ---------- */
document.querySelectorAll("#viewSeg button").forEach(b=>b.onclick=()=>{location.hash=b.dataset.view});
const hashView=()=>{const v=location.hash.slice(1);if(["dir","what","people"].includes(v)&&v!==VIEW){VIEW=v;if(ME)render()}};
addEventListener("hashchange",()=>{hashView();const h=location.hash.match(/^#s=(.+)$/);if(h&&ME)show(decodeURIComponent(h[1]))});
document.querySelectorAll("#bySeg button").forEach(b=>b.onclick=()=>{BY=b.dataset.by;render()});
["q","fCat","fBrand","fKind","fSt"].forEach(id=>$(id).addEventListener(id==="q"?"input":"change",render));
function refresh(){fillFilters();kpis();render()}
async function start(m){
  ME=m;$("who").textContent=m.email;
  CAN=m.isManager||(m.sections||[]).includes("suppliers");
  if(m.co==="all")CAN=false;
  document.querySelectorAll("[data-edit]").forEach(el=>el.hidden=!CAN);
  try{LIST=await api("GET","suppliers")}catch(e){$("empty").textContent=e.message;return}
  const p=new URLSearchParams(location.search);if(p.get("q"))$("q").value=p.get("q");hashView();
  refresh();
  const h=location.hash.match(/^#s=(.+)$/);if(h)show(decodeURIComponent(h[1]));
}
if(window.BIFOLD_ME)start(window.BIFOLD_ME);else document.addEventListener("bifold:me",e=>start(e.detail),{once:true});
})();
