"use strict";
const peEl = id => document.getElementById(id);
let pePublished = null;
function clearOfferAdmin() {
  pePublished=null;
  for (const id of ["pe-status","pe-list"]) peEl(id).textContent="";
  peEl("pe-link").value="";
}
function offerPayload() {
  const items=[];
  for (const gm of selectedOrder) {
    const p=ALL_PRODUCTS.find(p=>p.gm===gm);
    if (!p) continue;
    const ex=productExtras.get(gm)||newExtras();
    const price=(ex.price || val("apreis-default")).trim().replace(/\s*€$/,"");
    if (!/^\d{1,5}(?:[,.]\d{1,2})?$/.test(price)) throw new Error("Bitte für alle Modelle einen Bruttopreis in EUR eingeben.");
    const [whole,part=""]=price.replace(",",".").split(".");
    const cents=Number(whole)*100+Number(part.padEnd(2,"0"));
    for (const v of (p.variants||[]).filter(v=>hasColor(v,ex.colorFilter))) {
      items.push({model:p.modelName,variant:[v.variantCode,transColor(v.colorName||"")].filter(Boolean).join(" · ")||"Standard",cents});
    }
  }
  return {title:val("aktion-titel").trim(),expiresAt:new Date(val("pe-expiry")).getTime(),items};
}
function offerLink() {
  if (!pePublished || pePublished.expiresAt<=Date.now()) return "";
  try { return JSON.stringify(offerPayload())===pePublished.snapshot ? pePublished.url : ""; }
  catch { return ""; }
}
async function offerAdmin(body) {
  const user=newsletterUser;
  if (!user) throw new Error("Bitte zuerst anmelden.");
  const response=await fetch(PE_CONFIG.offersEndpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+await user.getIdToken()},body:JSON.stringify(body)});
  if (newsletterUser!==user) throw new Error("Sitzung beendet.");
  if (!response.ok) throw new Error(response.status===400 ? "Bitte Titel, Gültigkeit und 1–200 Varianten mit gültigem Preis prüfen." : "Aktion fehlgeschlagen ("+response.status+").");
  return response.json();
}
for (const [id,action] of Object.entries({
  "pe-publish":async()=>{
    const data=offerPayload();
    if (!data.title || !Number.isFinite(data.expiresAt) || !data.items.length) throw new Error("Titel, Gültigkeit und Varianten sind erforderlich.");
    const out=await offerAdmin({action:"publish",...data});
    const url=new URL("./order.html",location.href); url.hash=out.offer;
    pePublished={token:out.offer,url:url.href,snapshot:JSON.stringify(data),expiresAt:data.expiresAt};
    peEl("pe-link").value=url.href;
    peEl("gueltig-bis").value=new Intl.DateTimeFormat("de-DE",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Berlin"}).format(data.expiresAt)+" (MEZ/MESZ)";
    refresh();
    return "Testlink erstellt. Geänderte Preise oder Varianten erfordern einen neuen Link.";
  },
  "pe-close":async()=>{
    if (!pePublished) throw new Error("In dieser Sitzung ist kein Testlink geöffnet.");
    await offerAdmin({action:"close",offer:pePublished.token});
    pePublished=null;peEl("pe-link").value="";refresh();
    return "Link geschlossen.";
  },
  "pe-orders":async()=>{
    const state = s => ({accepted:"von Microsoft angenommen",rejected:"abgelehnt",unknown:"unbekannt",
      sending:"Versandstatus offen",auth_failed:"Anmeldung fehlgeschlagen",wrong_mailbox:"Falsches Postfach",
      not_connected:"Nicht verbunden"})[s] || "Unbekannt";
    const mail = s => s && typeof s === "object"
      ? "Intern: "+state(s.internal)+" · Bestätigung: "+state(s.confirmation)
      : state(s);
    const out=await offerAdmin({action:"orders"});
    peEl("pe-list").textContent=out.orders.map(o=>o.reference+" · "+o.company+" · "+o.email+"\n"+o.items.map(x=>x.quantity+" × "+x.model+" / "+x.variant).join("\n")+"\nE-Mail: "+mail(o.mailStatus)).join("\n\n");
    return out.orders.length+" Testanfragen angezeigt.";
  }
})) peEl(id).addEventListener("click",async()=>{
  const button=peEl(id);button.disabled=true;
  const user=newsletterUser;
  try { peEl("pe-status").textContent=await action(); }
  catch(e){ if(newsletterUser===user) peEl("pe-status").textContent=e.message; }
  finally{button.disabled=false;}
});
