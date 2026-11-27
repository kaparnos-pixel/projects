(function(){
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fd=d=>d?new Date(d+"T00:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}):"";
const day=iso=>iso?new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"";
const ST={active:"Active",renewal:"In renewal",applied:"Applied",lapsed:"Lapsed",dropped:"Dropped"};
const BEN={rebate:"Rebate",mdf:"MDF",other:"Other"},BST={open:"Open",claimed:"Claimed",paid:"Paid",lost:"Lost"};
const FK={certificate:"Partner certificate",agreement:"Partner agreement",maf:"Authorisation letter (MAF)",tier:"Tier letter",other:"Document"};
const REQ={certs:"Certified staff",revenue:"Revenue / bookings",other:"Other condition"};
const CERTS0=["CCNA","CCNP Enterprise","CCNP Security","Cisco Certified Specialist","Microsoft 365 Certified: Administrator Expert","Azure Administrator Associate","Azure Solutions Architect Expert","Fortinet NSE 4","Fortinet NSE 7","HPE ATP","HPE ASE","Aruba Certified Switching Associate","Dell Technologies Certified","Sophos Certified Engineer","Palo Alto PCNSA","Palo Alto PCNSE","Hikvision HCSA","Hikvision HCSP","VMware VCP","Veeam VMCE","ITIL 4 Foundation","CompTIA Security+","Yeastar Certified Engineer"];
let ME=null,P=[],C=[],TODAY="",cur=null,curC=null,VIEW="grid",CAN=false,SUPS=[];

function toast(m,e){const t=document.createElement("div");t.className="toast"+(e?" err":"");t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),e?6000:2600)}
async function api(method,path,body){
  let r;try{r=await fetch("/api/"+path,{method,headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined,cache:"no-store"})}catch{throw new Error("Can't reach the server. Check your connection and try again.")}
  const ct=r.headers.get("content-type")||"";
  if(r.redirected||(r.ok&&r.status!==204&&!ct.includes("json")))throw new Error("Your session has ended. Reload the page to sign in again.");
  let j=null;if(r.status!==204){try{j=await r.json()}catch{}}
  if(!r.ok){const e=new Error((j&&j.error)||"The request failed.");e.status=r.status;e.data=j;throw e}return j;
}
const b64=f=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(",")[1]||"");r.onerror=()=>no(new Error("Couldn't read "+f.name));r.readAsDataURL(f)});
const days=d=>Math.round((Date.parse(d+"T00:00:00Z")-Date.parse(TODAY+"T00:00:00Z"))/864e5);
const tel=v=>String(v||"").replace(/[^\d+]/g,"");
const wa=v=>{let d=String(v||"").replace(/\D/g,"");if(d.startsWith("00"))d=d.slice(2);else if(d.startsWith("0"))d="971"+d.slice(1);return d.length>=9?"https://wa.me/"+d:""};
const amt=(c,v)=>`${c} ${Number(v||0).toLocaleString("en-US",{maximumFractionDigits:2})}`;
const kb=n=>n>1048576?(n/1048576).toFixed(1)+" MB":Math.max(1,Math.round(n/1024))+" KB";
const pname=p=>!p.program?p.vendor:p.program.toLowerCase().startsWith(p.vendor.toLowerCase())?p.program:p.vendor+" "+p.program;
const words=()=>$("q").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
const tierCls=t=>/gold|premier/i.test(t)?"gold":/silver/i.test(t)?"silver":/platinum|expert/i.test(t)?"plat":"";
const IC={
  phone:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  mail:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  wa:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21l1.6-4.8A8.5 8.5 0 1 1 8 19.6z"/></svg>',
  link:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
};

/* ---------- health and requirements ---------- */
const validCert=c=>!c.expiry||c.expiry>=TODAY;
const certsOf=p=>C.filter(c=>c.partnerRef===p.id);
const pOfCert=c=>P.find(x=>x.id===c.partnerRef)||P.find(x=>x.vendor.toLowerCase()===String(c.vendor).toLowerCase());
function reqStatus(p){
  const mine=certsOf(p),valid=mine.filter(validCert),people=new Set(valid.map(c=>c.person.toLowerCase()));
  const soon=new Set(valid.filter(c=>c.expiry&&days(c.expiry)<=60).map(c=>c.person.toLowerCase()));
  return p.requirements.map(r=>{
    if(r.kind==="certs"){const n=people.size,after=[...people].filter(x=>!soon.has(x)).length;return {...r,current:n,ok:n>=r.target,risk:n>=r.target&&after<r.target,text:`${n} of ${r.target||"?"}`}}
    if(r.kind==="revenue")return {...r,ok:!r.target||r.current>=r.target,text:r.target?`${Math.round(r.current/r.target*100)}%`:"",pct:r.target?Math.min(100,r.current/r.target*100):0};
    return {...r,ok:!!r.done,text:r.done?"Done":"Open"};
  });
}
function health(p){
  if(p.status==="dropped")return ["grey","Dropped"];
  if(p.status==="applied")return ["grey","Applied, awaiting approval"];
  if(p.status==="lapsed")return ["red","Lapsed"];
  const d=p.renewalDate?days(p.renewalDate):null,rs=reqStatus(p),short=rs.filter(r=>!r.ok),risk=rs.filter(r=>r.risk);
  if(d!==null&&d<0)return ["red",`Renewal overdue by ${-d} day${d===-1?"":"s"}`];
  if(d!==null&&d<=30&&short.length)return ["red",`Renews in ${d} days with ${short.length} requirement${short.length===1?"":"s"} short`];
  if(d!==null&&d<=60)return ["amber",d===0?"Renews today":`Renews in ${d} days`];
  if(short.length)return ["amber",`${short.length} requirement${short.length===1?"":"s"} short`];
  if(risk.length)return ["amber","Certified staff at risk: certs expiring"];
  return ["green","On track"];
}
const expBadge=e=>{if(!e)return '<span class="exp ok">No expiry</span>';const d=days(e);return `<span class="exp ${d<0?"bad":d<=60?"soon":"ok"}">${d<0?"Expired "+fd(e):d===0?"Expires today":fd(e)+(d<=90?` · ${d}d`:"")}</span>`};

/* ---------- filters and KPIs ---------- */
const hay=p=>[p.vendor,p.program,p.tier,p.partnerNo,p.domain,p.discount,p.notes,p.specs.join(" "),...p.contacts.map(c=>[c.name,c.role,c.org,c.email,c.mobile].join(" ")),...p.benefits.map(b=>b.title+" "+b.ref),...certsOf(p).map(c=>[c.person,c.name,c.code].join(" "))].join(" ").toLowerCase();
function filtered(){
  const w=words(),st=$("fSt").value,h=$("fHealth").value;
  return P.filter(p=>(!st||p.status===st)&&(!h||health(p)[0]===h||(h==="red"&&health(p)[0]==="red"))&&(!w.length||(x=>w.every(y=>x.includes(y)))(hay(p))));
}
function kpis(){
  const act=P.filter(p=>p.status==="active"||p.status==="renewal");
  const vend=new Set(act.map(p=>p.vendor.toLowerCase())).size;
  $("kAct").textContent=act.length;$("kActS").textContent=`${vend} vendor${vend===1?"":"s"}${P.filter(p=>p.status==="applied").length?` · ${P.filter(p=>p.status==="applied").length} applied`:""}`;
  const ren=act.filter(p=>p.renewalDate&&days(p.renewalDate)<=90).sort((a,b)=>a.renewalDate.localeCompare(b.renewalDate));
  $("kRen").textContent=ren.length;$("kRenS").textContent=ren.length?`Next: ${ren[0].vendor}, ${fd(ren[0].renewalDate)}`:"Nothing due";
  const ce=C.filter(c=>c.expiry&&days(c.expiry)<=90&&days(c.expiry)>=0),gone=C.filter(c=>c.expiry&&days(c.expiry)<0).length;
  $("kCert").textContent=ce.length;$("kCertS").textContent=`${C.length} cert${C.length===1?"":"s"} on file${gone?` · ${gone} expired`:""}`;
  const open=P.flatMap(p=>p.benefits.filter(b=>b.status==="open").map(b=>b)),tot={};open.forEach(b=>tot[b.currency]=(tot[b.currency]||0)+b.amount);
  const t=Object.entries(tot).sort((a,b)=>b[1]-a[1]);
  $("kBen").textContent=t.length?amt(t[0][0],t[0][1]):"–";$("kBenS").textContent=open.length?`${open.length} open claim${open.length===1?"":"s"}${t.length>1?" · "+t.slice(1).map(x=>amt(x[0],x[1])).join(", "):""}`:"No open claims";
}

/* ---------- views ---------- */
function card(p){
  const [hc,ht]=health(p),rs=reqStatus(p),d=p.renewalDate?days(p.renewalDate):null;
  const bars=rs.slice(0,3).map(r=>`<div class="bar${r.ok?"":" short"}"><span class="t">${esc(r.label)}</span><span class="v">${esc(r.text)}</span>${r.kind!=="other"?`<span class="tr"><span style="width:${r.kind==="certs"?(r.target?Math.min(100,r.current/r.target*100):100):r.pct||0}%"></span></span>`:""}</div>`).join("");
  const open=p.benefits.filter(b=>b.status==="open").length,nc=certsOf(p).filter(validCert).length;
  return `<div class="pcard ${hc}${p.status==="dropped"?" dim":""}" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(pname(p))}">
    <div class="hd">${VLogo.html(p,52)}<div class="nm"><h4>${esc(p.vendor)}</h4><div class="pg">${esc(p.program||"Partner programme")}</div></div></div>
    <div class="mid"><div class="cd">${d===null?`<span class="n">–</span><span class="l">No renewal date</span>`:d<0?`<span class="n" style="color:var(--bad)">${-d}<small>days</small></span><span class="l">overdue, was ${fd(p.renewalDate)}</span>`:`<span class="n">${d}<small>day${d===1?"":"s"}</small></span><span class="l">to renewal, ${fd(p.renewalDate)}</span>`}</div>
      <div style="display:grid;gap:6px;justify-items:end">${p.tier?`<span class="tierb ${tierCls(p.tier)}">${esc(p.tier)}</span>`:""}<span class="hflag ${hc}"><i></i>${esc(ht)}</span></div></div>
    ${bars?`<div class="bars">${bars}</div>`:""}
    <div class="ft"><span>${esc(ST[p.status])}</span>${p.partnerNo?`<span>ID ${esc(p.partnerNo)}</span>`:""}<span>${nc} certified</span>${open?`<span>${open} open claim${open===1?"":"s"}</span>`:""}${p.files.length?`<span>${p.files.length} doc${p.files.length===1?"":"s"}</span>`:""}</div></div>`;
}
function render(){
  const M={grid:"vGrid",certs:"vCerts",claims:"vClaims",cal:"vCal"};
  Object.entries(M).forEach(([k,id])=>$(id).hidden=k!==VIEW);
  document.querySelectorAll("#viewSeg button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.view===VIEW));
  $("fSt").hidden=$("fHealth").hidden=VIEW!=="grid";
  const w=words();
  if(VIEW==="grid"){
    const rows=filtered().sort((a,b)=>{const r={red:0,amber:1,green:2,grey:3};return r[health(a)[0]]-r[health(b)[0]]||(a.renewalDate||"9999").localeCompare(b.renewalDate||"9999")||a.vendor.localeCompare(b.vendor)});
    $("grid").innerHTML=rows.map(card).join("")+(CAN&&!w.length&&P.length?`<button type="button" class="addcard" id="addCard">+ Add a partnership</button>`:"");
    $("gEmpty").hidden=rows.length>0;$("gEmpty").textContent=P.length?"No partnerships match your search.":CAN?"No partnerships yet. Add the first one with + New partnership. The vendor logo appears by itself.":"No partnerships yet.";
    $("cnt").textContent=rows.length===P.length?`${P.length} partnership${P.length===1?"":"s"}`:`${rows.length} of ${P.length}`;
    $("grid").querySelectorAll(".pcard").forEach(el=>{el.onclick=()=>show(el.dataset.id);el.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();show(el.dataset.id)}}});
    if($("addCard"))$("addCard").onclick=()=>edit(null);
    VLogo.wire($("grid"));
  }
  if(VIEW==="certs"){
    const pm=new Map(P.map(p=>[p.id,p]));
    const rows=C.filter(c=>!w.length||(h=>w.every(x=>h.includes(x)))([c.person,c.email,c.name,c.code,c.vendor,(pm.get(c.partnerRef)||{}).program].join(" ").toLowerCase()));
    const lg=c=>pm.get(c.partnerRef)||pOfCert(c)||{vendor:c.vendor};
    $("crows").innerHTML=rows.map(c=>{const p=pm.get(c.partnerRef);return `<tr data-id="${esc(c.id)}" tabindex="0"><td><div class="t">${esc(c.person)}</div><div class="s">${esc(c.email)}</div></td><td><div class="t">${esc(c.name)}</div><div class="s mono">${esc(c.code)}</div></td>
      <td><div class="lgcell">${VLogo.html(lg(c),28)}<div><div>${esc(c.vendor)}</div><div class="s">${esc(p?[p.program,p.tier].filter(Boolean).join(" · "):"Not linked")}</div></div></div></td><td>${esc(fd(c.obtained))}</td><td>${expBadge(c.expiry)}</td>
      <td>${c.file?`<button type="button" class="mini" data-cpv="${esc(c.id)}">${/pdf/.test(c.file.type)?"Preview":"View"}</button> <a class="btn mini" href="/api/partners/certs/${encodeURIComponent(c.id)}/file/download">Download</a>`:'<span class="s">None</span>'}</td></tr>`}).join("");
    $("cEmpty").hidden=rows.length>0;$("cEmpty").textContent=C.length?"No certifications match your search.":CAN?"No certifications yet. Add each person's vendor certifications with + Certification so tier requirements count them.":"No certifications yet.";
    $("cnt").textContent=`${rows.length} certification${rows.length===1?"":"s"}`;
    $("crows").querySelectorAll("tr").forEach(tr=>{tr.onclick=e=>{if(e.target.closest("a,button"))return;if(CAN)editCert(C.find(x=>x.id===tr.dataset.id))};tr.onkeydown=e=>{if(e.key==="Enter"&&CAN)editCert(C.find(x=>x.id===tr.dataset.id))}});
    $("crows").querySelectorAll("[data-cpv]").forEach(b=>b.onclick=()=>certFile(C.find(x=>x.id===b.dataset.cpv)));
    VLogo.wire($("crows"));
  }
  if(VIEW==="claims"){
    const rows=[];P.forEach(p=>p.benefits.forEach(b=>rows.push([p,b])));
    const shown=rows.filter(([p,b])=>!w.length||(h=>w.every(x=>h.includes(x)))([p.vendor,p.program,b.title,b.ref,BEN[b.kind]].join(" ").toLowerCase()))
      .sort((x,y)=>(x[1].status==="open"?0:1)-(y[1].status==="open"?0:1)||(x[1].deadline||"9999").localeCompare(y[1].deadline||"9999"));
    $("brows").innerHTML=shown.map(([p,b])=>{const d=b.deadline?days(b.deadline):null;return `<tr data-id="${esc(p.id)}"><td><div class="lgcell">${VLogo.html(p,28)}<b>${esc(p.vendor)}</b></div></td><td><div class="t">${esc(b.title)}</div><div class="s">${esc(b.ref)}</div></td><td>${esc(BEN[b.kind])}</td><td class="r mono">${esc(amt(b.currency,b.amount))}</td>
      <td>${b.deadline?`<span class="exp ${b.status!=="open"?"":d<0?"bad":d<=30?"soon":"ok"}">${fd(b.deadline)}${b.status==="open"&&d>=0&&d<=30?` · ${d}d`:""}</span>`:""}</td><td><span class="stc ${b.status==="open"?"onhold":b.status==="lost"?"blocked":"preferred"}">${esc(BST[b.status])}</span></td></tr>`}).join("");
    $("bEmpty").hidden=shown.length>0;$("bEmpty").textContent=rows.length?"No claims match your search.":"No rebate or MDF claims yet. Add them on a partnership with Edit.";
    $("cnt").textContent=`${shown.length} claim${shown.length===1?"":"s"}`;
    $("brows").querySelectorAll("tr").forEach(tr=>tr.onclick=()=>show(tr.dataset.id));
    VLogo.wire($("brows"));
  }
  if(VIEW==="cal"){
    const end=new Date(Date.parse(TODAY+"T00:00:00Z")+366*864e5).toISOString().slice(0,10),start=new Date(Date.parse(TODAY+"T00:00:00Z")-30*864e5).toISOString().slice(0,10);
    const ev=[];const pm=new Map(P.map(p=>[p.id,p]));
    P.filter(p=>p.status!=="dropped").forEach(p=>{if(p.renewalDate)ev.push({d:p.renewalDate,k:"ren",t:`${p.vendor} partnership renewal`,s:[p.program,p.tier].filter(Boolean).join(" · "),p,go:()=>show(p.id)});
      p.benefits.filter(b=>b.status==="open"&&b.deadline).forEach(b=>ev.push({d:b.deadline,k:"claim",t:`${p.vendor}: ${b.title}`,s:`${BEN[b.kind]} claim deadline · ${amt(b.currency,b.amount)}`,p,go:()=>show(p.id)}))});
    C.filter(c=>c.expiry).forEach(c=>{const p=pOfCert(c);ev.push({d:c.expiry,k:"cert",t:`${c.person}: ${c.name}`,s:`${c.vendor} certification expires`,p:p||{vendor:c.vendor},go:()=>CAN?editCert(c):null})});
    const list=ev.filter(e=>e.d>=start&&e.d<=end&&(!w.length||w.every(x=>(e.t+" "+e.s).toLowerCase().includes(x)))).sort((a,b)=>a.d.localeCompare(b.d));
    const by=new Map();list.forEach(e=>{const m=e.d.slice(0,7);if(!by.has(m))by.set(m,[]);by.get(m).push(e)});
    $("cal").innerHTML=[...by.entries()].map(([m,l],gi)=>`<section class="mon"><h4>${new Date(m+"-01T00:00:00Z").toLocaleDateString("en-GB",{month:"long",year:"numeric",timeZone:"UTC"})}<span>${l.length} item${l.length===1?"":"s"}</span></h4>${l.map((e,i)=>{const d=days(e.d);return `<div class="ev" data-g="${gi}" data-i="${i}" tabindex="0"><div class="dt">${new Date(e.d+"T00:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short",timeZone:"UTC"})}<small>${d<0?-d+"d ago":d===0?"today":"in "+d+"d"}</small></div>${VLogo.html(e.p,30)}<div class="tx"><b>${esc(e.t)}</b><div>${esc(e.s)}</div></div><span class="evk ${e.k}">${e.k==="ren"?"Renewal":e.k==="cert"?"Cert expiry":"Claim"}</span></div>`}).join("")}</section>`).join("")||`<div class="panel empty">Nothing due in the next 12 months.</div>`;
    const groups=[...by.values()];$("cal").querySelectorAll(".ev").forEach(el=>{el.onclick=()=>groups[+el.dataset.g][+el.dataset.i].go()});
    $("cnt").textContent=`${list.length} date${list.length===1?"":"s"} in the next 12 months`;
    VLogo.wire($("cal"));
  }
}

/* ---------- partnership card ---------- */
function show(id){
  const p=P.find(x=>x.id===id);if(!p)return;cur=p;
  history.replaceState(null,"","#p="+encodeURIComponent(id));
  const [hc,ht]=health(p);
  $("vLogo").innerHTML=VLogo.html(p,64);
  $("vKind").textContent=[ST[p.status],p.partnerNo&&"ID "+p.partnerNo].filter(Boolean).join(" · ");
  $("vName").textContent=pname(p);
  $("vBadges").innerHTML=`${p.tier?`<span class="tierb ${tierCls(p.tier)}">${esc(p.tier)}</span> `:""}<span class="hflag ${hc}"><i></i>${esc(ht)}</span>`;
  const rs=reqStatus(p),mine=certsOf(p);
  const kv=[["Renewal",p.renewalDate&&`${fd(p.renewalDate)}${p.autoRenew?" (renews automatically)":""}`],["Start",fd(p.startDate)],["Annual fee",p.fee?amt(p.currency,p.fee):""],["Discount",esc(p.discount)],["Deal registration",p.dealReg?"Available":""],
    ["Portal",p.portal&&`<a href="${esc(p.portal)}" target="_blank" rel="noopener">${esc(p.portal.replace(/^https?:\/\//,"").slice(0,60))}</a>`],["Website",p.domain&&`<a href="https://${esc(p.domain)}" target="_blank" rel="noopener">${esc(p.domain)}</a>`],["Specialisations",esc(p.specs.join(", "))]].filter(x=>x[1]);
  $("vBody").innerHTML=`
    ${kv.length?`<div class="vsec"><h5>Programme</h5><dl class="kv">${kv.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>`:""}
    <div class="vsec"><h5>To keep the tier</h5>${rs.length?`<div class="bars">${rs.map(r=>`<div class="bar${r.ok?"":" short"}"><span class="t">${esc(r.label)}${r.kind==="revenue"&&r.target?` (${esc(amt(p.currency,r.current))} of ${esc(amt(p.currency,r.target))})`:""}${r.risk?" · certs expiring soon":""}</span><span class="v">${esc(r.text)}</span>${r.kind!=="other"?`<span class="tr"><span style="width:${r.kind==="certs"?(r.target?Math.min(100,r.current/r.target*100):100):r.pct||0}%"></span></span>`:""}</div>`).join("")}</div>`:`<span class="hint">No requirements listed.${CAN?" Add them with Edit.":""}</span>`}</div>
    <div class="vsec"><h5>Certified staff (${mine.filter(validCert).length})</h5>${mine.map(c=>`<div class="cert"><span><b>${esc(c.person)}</b> · ${esc(c.name)}</span>${expBadge(c.expiry)}<span class="s">${esc([c.code,c.obtained&&"obtained "+fd(c.obtained)].filter(Boolean).join(" · "))}</span>${c.file?`<span><button type="button" class="mini" data-cpv="${esc(c.id)}">${/pdf/.test(c.file.type)?"Preview":"View"}</button></span>`:"<span></span>"}</div>`).join("")||`<span class="hint">No certifications linked yet.</span>`}</div>
    <div class="vsec"><h5>Contacts (${p.contacts.length})</h5>${p.contacts.map(c=>`<div class="ccard"><div class="top"><span><b>${esc(c.name)}</b></span></div>${c.role||c.org?`<div class="role">${esc([c.role,c.org].filter(Boolean).join(" · "))}</div>`:""}<div class="acts">${c.mobile?`<a href="tel:${esc(tel(c.mobile))}">${IC.phone}${esc(c.mobile)}</a>`:""}${c.mobile&&wa(c.mobile)?`<a href="${esc(wa(c.mobile))}" target="_blank" rel="noopener">${IC.wa}WhatsApp</a>`:""}${c.phone?`<a href="tel:${esc(tel(c.phone))}">${IC.phone}${esc(c.phone)}</a>`:""}${c.email?`<a href="mailto:${esc(c.email)}">${IC.mail}${esc(c.email)}</a>`:""}</div></div>`).join("")||`<span class="hint">No contacts yet.</span>`}</div>
    <div class="vsec"><h5>Rebates and MDF (${p.benefits.length})</h5>${p.benefits.map(b=>`<div class="cert"><span><b>${esc(b.title)}</b> · ${esc(BEN[b.kind])}</span><span class="stc ${b.status==="open"?"onhold":b.status==="lost"?"blocked":"preferred"}">${esc(BST[b.status])}</span><span class="s">${esc([amt(b.currency,b.amount),b.deadline&&"deadline "+fd(b.deadline),b.ref].filter(Boolean).join(" · "))}</span><span></span></div>`).join("")||`<span class="hint">No claims.</span>`}</div>
    <div class="vsec"><h5>Documents (${p.files.length}) ${CAN?`<button type="button" class="mini" id="vUp" style="float:right">+ Upload</button>`:""}</h5>${CAN?`<label style="margin:0 0 8px"><span class="lbl">Upload as</span><select id="vUpKind">${Object.entries(FK).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select></label>`:""}
      ${p.files.map(f=>`<div class="doc"><div class="dn"><b>${esc(f.name)}</b><span>${esc(FK[f.kind]||"Document")} · ${kb(f.size)} · ${esc(day(f.at))}</span></div>${/pdf/.test(f.type)?`<button type="button" data-fpv="${esc(f.id)}">Preview</button>`:/^image\//.test(f.type)?`<a class="btn" href="/api/partners/${encodeURIComponent(p.id)}/files/${encodeURIComponent(f.id)}" target="_blank" rel="noopener">View</a>`:""}<a class="btn" href="/api/partners/${encodeURIComponent(p.id)}/files/${encodeURIComponent(f.id)}/download">Download</a>${CAN?`<button type="button" class="danger" data-frm="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">×</button>`:""}</div>`).join("")||`<span class="hint">No documents. Keep the partner certificate, agreement and MAF letters here.</span>`}</div>
    <div class="vsec"><h5>Logo</h5><p class="hint" style="margin:0">${p.logo.upload?"Using a logo uploaded by hand.":p.domain?`Picked up automatically from ${esc(p.domain)}.`:"No website set, so initials are shown. Add the vendor website with Edit to get the logo."}</p>${CAN?`<div class="logoacts"><button type="button" id="lUp">Upload logo</button>${p.logo.upload?`<button type="button" id="lRm">Use automatic logo</button>`:p.domain?`<button type="button" id="lRf">Refresh logo</button>`:""}</div>`:""}</div>
    ${p.notes?`<div class="vsec"><h5>Notes</h5><p class="pre">${esc(p.notes)}</p></div>`:""}
    <p class="hint" style="margin:0">Added by ${esc(p.createdBy)} on ${esc(day(p.createdAt))}${p.updatedAt!==p.createdAt?` · last changed by ${esc(p.updatedBy)} on ${esc(day(p.updatedAt))}`:""}</p>`;
  const B=$("vBody");
  B.querySelectorAll("[data-cpv]").forEach(b=>b.onclick=()=>certFile(C.find(x=>x.id===b.dataset.cpv)));
  B.querySelectorAll("[data-fpv]").forEach(b=>b.onclick=()=>{const f=p.files.find(x=>x.id===b.dataset.fpv);BXPdf.preview(()=>fetch(`/api/partners/${encodeURIComponent(p.id)}/files/${encodeURIComponent(f.id)}`,{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error("That document couldn't be opened.");return r.blob()}),f.name)});
  B.querySelectorAll("[data-frm]").forEach(b=>b.onclick=async()=>{if(!b.classList.contains("armed")){b.classList.add("armed");b.textContent="Remove?";setTimeout(()=>{b.classList.remove("armed");b.textContent="×"},3500);return}
    try{put(await api("DELETE",`partners/${encodeURIComponent(p.id)}/files/${encodeURIComponent(b.dataset.frm)}`));toast("Document removed")}catch(e){toast(e.message,1)}});
  if($("vUp"))$("vUp").onclick=()=>{$("docFile").value="";$("docFile").click()};
  if($("lUp"))$("lUp").onclick=()=>{$("logoFile").value="";$("logoFile").click()};
  if($("lRm"))$("lRm").onclick=async()=>{try{put(await api("DELETE",`partners/${encodeURIComponent(p.id)}/logo`));toast("Back to the automatic logo")}catch(e){toast(e.message,1)}};
  if($("lRf"))$("lRf").onclick=async()=>{try{put(await api("POST",`partners/${encodeURIComponent(p.id)}/logo/refresh`));toast("Logo refreshed")}catch(e){toast(e.message,1)}};
  document.querySelectorAll("#view [data-edit]").forEach(el=>el.hidden=!CAN);
  $("vDel").hidden=!(CAN&&(ME.isManager||p.createdBy===ME.email));$("vDel").textContent="Delete";$("vDel").classList.remove("armed");
  VLogo.wire($("view"));
  if(!$("view").open)$("view").showModal();
}
// Replace one partnership in the list (after a save, upload or logo change) and redraw.
function put(p){P=P.filter(x=>x.id!==p.id).concat(p);refresh();if($("view").open&&cur&&cur.id===p.id)show(p.id)}
$("docFile").onchange=async e=>{
  const f=e.target.files[0];if(!f||!cur)return;
  if(f.size>10*1048576){toast(`${f.name} is larger than 10 MB.`,1);return}
  const kind=($("vUpKind")||{}).value||"other";
  try{toast("Uploading "+f.name+" …");const r=await api("POST",`partners/${encodeURIComponent(cur.id)}/files`,{name:f.name,type:f.type||"application/octet-stream",kind,data:await b64(f)});put(r);toast("Document uploaded")}catch(err){toast(err.message,1)}
};
$("logoFile").onchange=async e=>{
  const f=e.target.files[0];if(!f||!cur)return;
  if(f.size>1048576){toast("The logo must be smaller than 1 MB.",1);return}
  try{put(await api("POST",`partners/${encodeURIComponent(cur.id)}/logo`,{name:f.name,type:f.type,data:await b64(f)}));toast("Logo uploaded")}catch(err){toast(err.message,1)}
};
function certFile(c){
  if(!c||!c.file)return;
  const u=`/api/partners/certs/${encodeURIComponent(c.id)}/file`;
  if(/pdf/.test(c.file.type))BXPdf.preview(()=>fetch(u,{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error("That file couldn't be opened.");return r.blob()}),c.file.name);
  else window.open(u,"_blank","noopener");
}
$("vX").onclick=()=>$("view").close();
$("view").addEventListener("close",()=>{if(/^#p=/.test(location.hash))history.replaceState(null,"",location.pathname+location.search)});
$("view").addEventListener("click",e=>{if(e.target===$("view"))$("view").close()});
$("vEdit").onclick=()=>{$("view").close();edit(cur)};
$("vCert").onclick=()=>{const p=cur;$("view").close();editCert(null,p)};
$("vDel").onclick=async()=>{
  const b=$("vDel");if(!b.classList.contains("armed")){b.classList.add("armed");b.textContent="Click again to delete";setTimeout(()=>{b.classList.remove("armed");b.textContent="Delete"},4000);return}
  try{await api("DELETE","partners/"+encodeURIComponent(cur.id));P=P.filter(x=>x.id!==cur.id);$("view").close();refresh();toast("Partnership deleted")}catch(e){toast(e.message,1)}
};

/* ---------- edit partnership ---------- */
const FIELDS=["vendor","domain","supplierId","program","partnerNo","tier","status","portal","startDate","renewalDate","currency","fee","discount","notes"];
function row(box,html,cls){const d=document.createElement("div");d.className="con "+(cls||"");d.innerHTML=html;d.querySelector(".rm").onclick=()=>d.remove();$(box).appendChild(d);return d}
const sel=(k,opts,v)=>`<select data-k="${k}">${Object.entries(opts).map(([a,b])=>`<option value="${a}"${a===v?" selected":""}>${b}</option>`).join("")}</select>`;
function reqRow(r){r=r||{kind:"certs"};const d=row("reqs",`<div class="chd"><span>Requirement</span><button type="button" class="rm danger">Remove</button></div>
  <div class="row4"><label><span class="lbl">Description</span><input data-k="label" maxlength="200" value="${esc(r.label)}" placeholder="e.g. CCNA engineers"></label><label><span class="lbl">Type</span>${sel("kind",REQ,r.kind)}</label>
  <label><span class="lbl">Target</span><input data-k="target" type="number" min="0" step="any" value="${r.target||""}"></label><label class="cur"><span class="lbl">Achieved so far</span><input data-k="current" type="number" min="0" step="any" value="${r.current||""}"></label></div>
  <label class="chk dn" style="padding:0"><input type="checkbox" data-k="done"${r.done?" checked":""}> Met</label>`);d.dataset.id=r.id||"";
  const sync=()=>{const k=d.querySelector("[data-k=kind]").value;d.querySelector(".cur").hidden=k!=="revenue";d.querySelector(".dn").hidden=k!=="other";d.querySelector("[data-k=target]").closest("label").hidden=k==="other"};
  d.querySelector("[data-k=kind]").onchange=sync;sync();return d}
function conRow(c){c=c||{};const d=row("cons",`<div class="chd"><span>Contact</span><button type="button" class="rm danger">Remove</button></div>
  <div class="row3"><label><span class="lbl">Name *</span><input data-k="name" maxlength="100" value="${esc(c.name)}"></label><label><span class="lbl">Role</span><input data-k="role" maxlength="80" list="roleList2" value="${esc(c.role)}" placeholder="e.g. Partner Account Manager"></label><label><span class="lbl">Company</span><input data-k="org" maxlength="120" value="${esc(c.org)}" placeholder="vendor or distributor"></label></div>
  <div class="row3"><label><span class="lbl">Mobile</span><input data-k="mobile" maxlength="40" inputmode="tel" value="${esc(c.mobile)}"></label><label><span class="lbl">Direct line</span><input data-k="phone" maxlength="40" inputmode="tel" value="${esc(c.phone)}"></label><label><span class="lbl">Email</span><input data-k="email" type="email" maxlength="150" value="${esc(c.email)}"></label></div>`);d.dataset.id=c.id||"";return d}
function benRow(b){b=b||{kind:"mdf",status:"open",currency:"AED"};const d=row("bens",`<div class="chd"><span>Claim</span><button type="button" class="rm danger">Remove</button></div>
  <div class="row4"><label><span class="lbl">What</span><input data-k="title" maxlength="200" value="${esc(b.title)}" placeholder="e.g. Q1 MDF, back-end rebate"></label><label><span class="lbl">Type</span>${sel("kind",BEN,b.kind)}</label><label><span class="lbl">Amount</span><span class="money"><select data-k="currency">${["AED","USD","EUR","GBP"].map(x=>`<option${x===b.currency?" selected":""}>${x}</option>`).join("")}</select><input data-k="amount" type="number" min="0" step="0.01" value="${b.amount||""}"></span></label><label><span class="lbl">Claim deadline</span><input data-k="deadline" type="date" value="${esc(b.deadline)}"></label></div>
  <div class="row3"><label><span class="lbl">Status</span>${sel("status",BST,b.status)}</label><label><span class="lbl">Claim / PO reference</span><input data-k="ref" maxlength="80" value="${esc(b.ref)}"></label></div>`);d.dataset.id=b.id||"";return d}
const readRows=box=>[...$(box).querySelectorAll(".con")].map(d=>{const o={id:d.dataset.id||undefined};d.querySelectorAll("[data-k]").forEach(i=>o[i.dataset.k]=i.type==="checkbox"?i.checked:i.value.trim());return o});
$("addReq").onclick=()=>reqRow().querySelector("input").focus();
$("addCon").onclick=()=>conRow().querySelector("input").focus();
$("addBen").onclick=()=>benRow().querySelector("input").focus();
if(!$("roleList2")){const dl=document.createElement("datalist");dl.id="roleList2";dl.innerHTML=["Partner Account Manager","Channel Account Manager","Partner Development Manager","Distributor Account Manager","Pre-sales Engineer","Partner Programme Support","Marketing / MDF contact"].map(x=>`<option>${x}</option>`).join("");document.body.appendChild(dl)}

// Live logo preview while typing: known vendor names fill the website by themselves.
let autoDomain=true,logoT=0;
function logoPreview(){
  const v=$("f_vendor").value.trim(),d=VLogo.domainOf($("f_domain").value);
  const same=cur&&cur.vendor===v&&(cur.domain||"")===d;
  $("fLogo").innerHTML=VLogo.html({vendor:v||"?",logo:same?cur.logo:{domain:d}},56);VLogo.wire($("fLogo"));
  $("logoHint").textContent=same&&cur.logo.upload?"Using the logo uploaded for this vendor.":d?`The logo is picked up from ${d} when you save.`:v?"Add the vendor website to pick up the logo automatically.":"";
}
$("f_vendor").addEventListener("input",()=>{const k=VLogo.domainFor($("f_vendor").value);if(autoDomain&&k)$("f_domain").value=k;else if(autoDomain&&!k)$("f_domain").value="";clearTimeout(logoT);logoT=setTimeout(logoPreview,350)});
$("f_domain").addEventListener("input",()=>{autoDomain=!$("f_domain").value.trim();clearTimeout(logoT);logoT=setTimeout(logoPreview,500)});
$("f_supplierId").onchange=()=>{const s=SUPS.find(x=>x.id===$("f_supplierId").value);if(!s)return;if(!$("f_vendor").value.trim())$("f_vendor").value=s.name;if(!$("f_domain").value.trim()&&s.website){$("f_domain").value=VLogo.domainOf(s.website);autoDomain=false}logoPreview()};
function edit(p){
  cur=p||null;$("form").reset();$("err").textContent="";["reqs","cons","bens"].forEach(b=>$(b).innerHTML="");
  $("dTitle").textContent=p?"Edit "+pname(p):"New partnership";$("saveBtn").textContent=p?"Save changes":"Add partnership";
  FIELDS.forEach(k=>{$("f_"+k).value=p?(k==="fee"?(p.fee||""):p[k]??""):""});
  if(!p){$("f_status").value="active";$("f_currency").value="AED"}
  $("f_specs").value=p?p.specs.join(", "):"";$("f_autoRenew").checked=!!(p&&p.autoRenew);$("f_dealReg").checked=!!(p&&p.dealReg);
  (p?p.requirements:[{kind:"certs"}]).forEach(reqRow);(p?p.contacts:[{}]).forEach(conRow);(p?p.benefits:[]).forEach(benRow);
  autoDomain=!(p&&p.domain);
  $("meta").textContent=p?`Added by ${p.createdBy} on ${day(p.createdAt)}`:"";
  logoPreview();$("dlg").showModal();$("f_vendor").focus();
}
$("addBtn").onclick=()=>edit(null);$("cancel").onclick=$("dX").onclick=()=>$("dlg").close();
$("form").onsubmit=async e=>{
  e.preventDefault();$("err").textContent="";
  const body={};FIELDS.forEach(k=>body[k]=$("f_"+k).value);
  body.specs=$("f_specs").value;body.autoRenew=$("f_autoRenew").checked;body.dealReg=$("f_dealReg").checked;
  body.requirements=readRows("reqs").filter(r=>r.label||Number(r.target)>0||r.done);body.contacts=readRows("cons").filter(c=>c.name||c.email||c.mobile||c.phone);body.benefits=readRows("bens").filter(b=>b.title||b.amount);
  if(!body.vendor.trim()){$("err").textContent="Enter the vendor name.";$("f_vendor").focus();return}
  if(body.contacts.some(c=>!c.name)){$("err").textContent="Every contact needs a name.";return}
  if(cur)body.etag=cur.etag;
  $("saveBtn").disabled=true;
  try{
    const p=cur?await api("PUT","partners/"+encodeURIComponent(cur.id),body):await api("POST","partners",body);
    const was=!!cur;cur=p;$("dlg").close();put(p);toast(was?"Partnership updated":`${p.vendor} added`);show(p.id);
  }catch(err){$("err").textContent=err.message;if(err.status===409&&err.data&&err.data.id&&!cur){$("err").innerHTML=esc(err.message)+` <a href="#" id="openDup">Open it</a>`;$("openDup").onclick=ev=>{ev.preventDefault();$("dlg").close();show(err.data.id)}}}
  finally{$("saveBtn").disabled=false}
};

/* ---------- certifications ---------- */
function editCert(c,p){
  curC=c||null;$("cform").reset();$("cErr").textContent="";
  $("cTitle").textContent=c?"Edit certification":"New certification";$("cSave").textContent=c?"Save changes":"Add certification";
  const opts=P.filter(x=>x.status!=="dropped"||(c&&c.partnerRef===x.id)).sort((a,b)=>pname(a).localeCompare(pname(b)));
  $("c_partnerRef").innerHTML=opts.map(x=>`<option value="${esc(x.id)}">${esc(pname(x))}${x.tier?" ("+esc(x.tier)+")":""}</option>`).join("")+`<option value="">Not linked to a partnership</option>`;
  ["person","email","name","code","obtained","expiry","notes","vendor"].forEach(k=>$("c_"+k).value=c?c[k]||"":"");
  $("c_partnerRef").value=c?c.partnerRef:(p?p.id:(opts[0]||{}).id||"");
  $("cVendWrap").hidden=!!$("c_partnerRef").value;
  $("cFileNow").textContent=c&&c.file?`Attached: ${c.file.name}. Choose a new file to replace it.`:"";
  $("cDel").hidden=!(c&&(ME.isManager||c.createdBy===ME.email));$("cDel").textContent="Delete";$("cDel").classList.remove("armed");
  $("peopleList").innerHTML=[...new Set(C.map(x=>x.person))].sort().map(x=>`<option>${esc(x)}</option>`).join("");
  $("certList").innerHTML=[...new Set(CERTS0.concat(C.map(x=>x.name)))].sort().map(x=>`<option>${esc(x)}</option>`).join("");
  $("cdlg").showModal();$("c_person").focus();
}
$("c_partnerRef").onchange=()=>{$("cVendWrap").hidden=!!$("c_partnerRef").value};
$("c_person").onchange=()=>{const k=$("c_person").value.trim().toLowerCase();const o=C.find(x=>x.person.toLowerCase()===k&&x.email);if(o&&!$("c_email").value)$("c_email").value=o.email};
$("addCertBtn").onclick=()=>editCert(null);$("cCancel").onclick=$("cX").onclick=()=>$("cdlg").close();
$("cDel").onclick=async()=>{
  const b=$("cDel");if(!b.classList.contains("armed")){b.classList.add("armed");b.textContent="Click again to delete";setTimeout(()=>{b.classList.remove("armed");b.textContent="Delete"},4000);return}
  try{await api("DELETE","partners/certs/"+encodeURIComponent(curC.id));C=C.filter(x=>x.id!==curC.id);$("cdlg").close();refresh();toast("Certification deleted")}catch(e){toast(e.message,1)}
};
$("cform").onsubmit=async e=>{
  e.preventDefault();$("cErr").textContent="";
  const body={};["person","email","partnerRef","vendor","name","code","obtained","expiry","notes"].forEach(k=>body[k]=$("c_"+k).value.trim());
  if(!body.person){$("cErr").textContent="Enter who holds the certification.";return}
  if(!body.name){$("cErr").textContent="Enter the certification name.";return}
  const f=$("c_file").files[0];if(f&&f.size>10*1048576){$("cErr").textContent=`${f.name} is larger than 10 MB.`;return}
  if(curC)body.etag=curC.etag;
  $("cSave").disabled=true;
  try{
    let c=curC?await api("PUT","partners/certs/"+encodeURIComponent(curC.id),body):await api("POST","partners/certs",body);
    if(f)c=await api("POST",`partners/certs/${encodeURIComponent(c.id)}/file`,{name:f.name,type:f.type||"application/octet-stream",data:await b64(f)});
    C=C.filter(x=>x.id!==c.id).concat(c).sort((a,b)=>(a.expiry||"9999").localeCompare(b.expiry||"9999"));
    $("cdlg").close();refresh();toast(curC?"Certification updated":"Certification added");
  }catch(err){$("cErr").textContent=err.message}
  finally{$("cSave").disabled=false}
};

/* ---------- export ---------- */
const XLSX_URL="/assets/vendor/xlsx-0.18.5.full.min.js";
function loadX(){return window.XLSX?Promise.resolve(window.XLSX):new Promise((ok,no)=>{const s=document.createElement("script");s.src=XLSX_URL;s.onload=()=>ok(window.XLSX);s.onerror=()=>no(new Error("Couldn't load the spreadsheet tool. Check your connection and try again."));document.head.appendChild(s)})}
$("expBtn").onclick=async()=>{
  try{
    const X=await loadX(),wb=X.utils.book_new();
    const sheet=(rows,name)=>{const ws=X.utils.json_to_sheet(rows.length?rows:[{"":"Nothing yet"}]);ws["!cols"]=Object.keys(rows[0]||{a:1}).map(k=>({wch:Math.min(40,Math.max(10,k.length+2))}));X.utils.book_append_sheet(wb,ws,name)};
    sheet(P.map(p=>{const rs=reqStatus(p);return {"Vendor":p.vendor,"Programme":p.program,"Tier":p.tier,"Status":ST[p.status],"Health":health(p)[1],"Partner ID":p.partnerNo,"Start":p.startDate,"Renewal":p.renewalDate,"Auto renew":p.autoRenew?"Yes":"","Annual fee":p.fee||"","Currency":p.currency,"Discount":p.discount,"Deal registration":p.dealReg?"Yes":"","Specialisations":p.specs.join(", "),"Requirements":rs.map(r=>`${r.label}: ${r.text}`).join("; "),"Contacts":p.contacts.map(c=>[c.name,c.role,c.email,c.mobile].filter(Boolean).join(" / ")).join("; "),"Portal":p.portal,"Website":p.domain,"Notes":p.notes}}),"Partnerships");
    const pm=new Map(P.map(p=>[p.id,p]));
    sheet(C.map(c=>({"Person":c.person,"Email":c.email,"Vendor":c.vendor,"Partnership":(pm.get(c.partnerRef)||{}).program||"","Certification":c.name,"Code":c.code,"Obtained":c.obtained,"Expires":c.expiry,"File":c.file?c.file.name:""})),"Certifications");
    sheet(P.flatMap(p=>p.benefits.map(b=>({"Vendor":p.vendor,"Claim":b.title,"Type":BEN[b.kind],"Amount":b.amount,"Currency":b.currency,"Deadline":b.deadline,"Status":BST[b.status],"Reference":b.ref}))),"Rebates & MDF");
    X.writeFile(wb,`${ME.co==="techhub"?"TechHub":"Bifold"}-vendor-partners-${TODAY}.xlsx`);
  }catch(e){toast(e.message,1)}
};

/* ---------- wiring ---------- */
document.querySelectorAll("#viewSeg button").forEach(b=>b.onclick=()=>{location.hash=b.dataset.view});
const hashView=()=>{const v=location.hash.slice(1);if(["grid","certs","claims","cal"].includes(v)&&v!==VIEW){VIEW=v;if(ME)render()}};
addEventListener("hashchange",()=>{hashView();const h=location.hash.match(/^#p=(.+)$/);if(h&&ME)show(decodeURIComponent(h[1]))});
["q","fSt","fHealth"].forEach(id=>$(id).addEventListener(id==="q"?"input":"change",render));
function refresh(){
  $("vendList").innerHTML=[...new Set(["Cisco","Microsoft","HPE","HPE Aruba","Dell","Lenovo","HP","Fortinet","Sophos","Palo Alto Networks","Hikvision","Dahua","Ubiquiti","Yeastar","Grandstream","Yealink","Veeam","VMware","Synology","Schneider APC","Axis","Juniper"].concat(SUPS.map(s=>s.name),P.map(p=>p.vendor)))].map(x=>`<option>${esc(x)}</option>`).join("");
  kpis();render();
}
async function start(m){
  ME=m;$("who").textContent=m.email;
  CAN=(m.isManager||(m.sections||[]).includes("partners"))&&m.co!=="all";
  document.querySelectorAll("[data-edit]").forEach(el=>el.hidden=!CAN);
  try{const b=await api("GET","partners");P=b.partners;C=b.certs;TODAY=b.today;VLogo.setClientId(b.brandfetch)}catch(e){$("gEmpty").hidden=false;$("gEmpty").textContent=e.message;return}
  if(CAN)api("GET","suppliers").then(l=>{SUPS=l;$("f_supplierId").innerHTML=`<option value="">Not linked</option>`+l.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");refresh()}).catch(()=>{$("supWrap").hidden=true});
  hashView();refresh();
  const h=location.hash.match(/^#p=(.+)$/);if(h)show(decodeURIComponent(h[1]));
}
if(window.BIFOLD_ME)start(window.BIFOLD_ME);else document.addEventListener("bifold:me",e=>start(e.detail),{once:true});
})();
