"use strict";
const el = id => document.getElementById(id);
const form = el("form"), status = el("status");
const offer=location.hash.slice(1);
const money=new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"});
let fields=[], lastBody="", requestId="";
async function call(body) {
  const response=await fetch(window.PE_CONFIG.offersEndpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,offer}),signal:AbortSignal.timeout(35000)});
  if (!response.ok) throw new Error(({400:"Bitte Eingaben prüfen.",404:"Dieses Angebot ist nicht mehr verfügbar.",409:"Die Anfrage wurde geändert. Bitte erneut prüfen.",429:"Das Testlimit wurde erreicht."})[response.status]||"Dienst derzeit nicht verfügbar.");
  return response.json();
}
async function initOrder(){
  if(!/^[a-f0-9]{40}$/.test(offer)) throw new Error("Der Angebotslink fehlt oder ist ungültig.");
  const data=await call({action:"get"});
  el("title").textContent=data.title;
  el("validity").textContent="Gültig bis "+new Intl.DateTimeFormat("de-DE",{dateStyle:"long",timeStyle:"short",timeZone:"Europe/Berlin"}).format(data.expiresAt)+" (MEZ/MESZ). Alle Preise inkl. MwSt.";
  fields=data.items.map(item=>{
    const row=document.createElement("div"), info=document.createElement("div"), label=document.createElement("label"), input=document.createElement("input");
    row.className="item";
    info.textContent=item.model+" · "+item.variant+" · "+money.format(item.cents/100);
    label.textContent="Stück";
    input.type="number";input.min="0";input.max="99";input.step="1";input.value="0";input.required=true;
    input.setAttribute("aria-label","Stück: "+item.model+" "+item.variant);
    label.append(input);row.append(info,label);el("items").append(row);
    input.addEventListener("input",total);
    return {item,input};
  });
  total();status.textContent="";form.hidden=false;
}
function total(){
  const cents=fields.reduce((sum,{item,input})=>sum+item.cents*(Number(input.value)||0),0);
  el("total").textContent="Gesamtsumme: "+money.format(cents/100)+" inkl. MwSt.";
}
form.addEventListener("submit",async e=>{
  e.preventDefault();
  const body={action:"order",...Object.fromEntries(new FormData(form)),items:fields.filter(({input})=>Number(input.value)>0).map(({item,input})=>({id:item.id,quantity:Number(input.value)}))};
  if (!body.items.length){status.textContent="Bitte mindestens eine Menge eingeben.";return;}
  const key=JSON.stringify(body);
  if (key!==lastBody){lastBody=key;requestId=crypto.randomUUID();}
  const button=form.querySelector("button");button.disabled=true;
  status.textContent="Anfrage wird gespeichert …";
  try{
    const out=await call({...body,requestId});
    form.hidden=true;
    status.textContent="Testanfrage gespeichert: "+out.reference+". Es wurde keine E-Mail versendet.";
  }catch(e){status.textContent=e.message+" Bei Verbindungsfehler bitte mit unveränderten Eingaben erneut versuchen.";}
  finally{button.disabled=false;}
});
initOrder().catch(e=>{status.textContent=e.message;});
