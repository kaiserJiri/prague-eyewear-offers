"use strict";
const {randomBytes, createHash} = require("node:crypto");
const ORIGIN = "https://kaiserjiri.github.io";
const {ALLOWED_UID} = require("./proxy");
const clean = (s, max) => typeof s === "string" && s.trim().length > 0 && s.trim().length <= max ? s.trim() : null;
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const digest = s => createHash("sha256").update(s).digest("hex");
const id = s => typeof s === "string" && /^[a-f0-9]{40}$/.test(s);
function campaign(b, now) {
  const title = clean(b.title,120);
  if (!title || !integer(b.expiresAt, now+60000, now+90*86400000) ||
      !Array.isArray(b.items) || !b.items.length || b.items.length > 200) return null;
  const items = b.items.map((p,i) => {
    if (!p || typeof p !== "object") return null;
    const model = clean(p.model,120), variant = clean(p.variant,120);
    if (!model || !variant || !integer(p.cents,1,1000000)) return null;
    let image = null;
    if (p.image != null && p.image !== "") {
      try {
        const u = new URL(p.image);
        if (typeof p.image !== "string" || p.image.length > 2048 || u.protocol !== "https:" || u.hostname !== "cz.mi-optics.cz" || u.port || u.username || u.password || !u.pathname.startsWith("/img-products/")) return null;
        image = u.href;
      } catch { return null; }
    }
    return {id: String(i),model,variant,cents:p.cents,...(image ? {image} : {})};
  });
  if (items.some(p=>!p)) return null;
  return {title,expiresAt:b.expiresAt,items};
}
function order(b, offer) {
  const company = clean(b.company,120), contact = clean(b.contact,120), email = clean(b.email,254);
  const number = clean(b.number,60);
  if (!company || !contact || !number || !email || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
      || !Array.isArray(b.items) || !b.items.length || b.items.length > offer.items.length) return null;
  const byId = new Map(offer.items.map(x=>[x.id,x])), seen = new Set();
  const items = [];
  for (const x of b.items) {
    if (!x || !byId.has(x.id) || seen.has(x.id) || !integer(x.quantity,1,99)) return null;
    seen.add(x.id);
    items.push({...byId.get(x.id),quantity:x.quantity});
  }
  return {company,contact,email,number,items,totalCents:items.reduce((n,x)=>n+x.cents*x.quantity,0)};
}
function handler(db, verify, sendMail) {
  return async (req,res) => {
    res.set("Cache-Control","no-store");
    res.set("Vary","Origin");
    res.set("X-Content-Type-Options","nosniff");
    const fail = (n,error)=>res.status(n).json({error});
    const origin=req.get("Origin");
    if (origin && origin!==ORIGIN) return fail(403,"origin");
    if (origin) res.set("Access-Control-Allow-Origin",ORIGIN);
    if (req.method==="OPTIONS") {
      res.set("Access-Control-Allow-Methods","POST");
      res.set("Access-Control-Allow-Headers","Content-Type, Authorization");
      return res.status(204).send("");
    }
    if (req.method!=="POST") return fail(405,"method");
    if (!req.is("application/json") || (req.rawBody?.length||0)>100000) return fail(400,"body");
    const b=req.body;
    if (!b || typeof b!=="object") return fail(400,"body");
    const now=Date.now();
    try {
      if (["publish","orders","close"].includes(b.action)) {
        const match=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(req.get("Authorization")||"");
        if (!match) return fail(401,"authentication");
        let user;
        try { user=await verify(match[1]); } catch { return fail(401,"authentication"); }
        if (user.uid!==ALLOWED_UID) return fail(403,"account");
        if (b.action==="orders") {
          const q=await db.collection("peOrders").orderBy("createdAt","desc").limit(50).get();
          return res.json({orders:q.docs.map(d=>d.data())});
        }
        if (b.action==="close") {
          if (!id(b.offer)) return fail(404,"unavailable");
          await db.collection("peOffers").doc(digest(b.offer)).update({closed:true});
          return res.json({ok:true});
        }
        const c=campaign(b,now);
        if (!c) return fail(400,"invalid_offer");
        const token=randomBytes(20).toString("hex");
        await db.collection("peOffers").doc(digest(token)).create({...c,createdAt:now,orderCount:0,closed:false});
        return res.json({offer:token});
      }
      if (!id(b.offer)) return fail(404,"unavailable");
      const key=digest(b.offer);
      const ref=db.collection("peOffers").doc(key);
      const available=o=>o && !o.closed && o.expiresAt>Date.now();
      if (b.action==="get") {
        const o=(await ref.get()).data();
        if (!available(o)) return fail(404,"unavailable");
        return res.json({title:o.title,expiresAt:o.expiresAt,items:o.items});
      }
      if (b.action!=="order" || typeof b.requestId!=="string" ||
          !/^[a-f0-9-]{36}$/.test(b.requestId)) return fail(400,"invalid_order");
      const result=await db.runTransaction(async tx=>{
        const o=(await tx.get(ref)).data();
        if (!o) return {error:"unavailable",status:404};
        const payload=order(b,o);
        if (!payload) return {error:"invalid_order",status:400};
        const request=db.collection("peOrders").doc(digest(key+":"+b.requestId));
        const old=(await tx.get(request)).data();
        const hash=digest(JSON.stringify(payload));
        if (old) return old.hash===hash ? {reference:old.reference} : {error:"conflict",status:409};
        if (!available(o)) return {error:"unavailable",status:404};
        // Internal pilot ceiling; raise only after public anti-abuse controls are configured.
        if (o.orderCount>=25) return {error:"limit",status:429};
        const reference="PE-"+request.id.slice(0,16).toUpperCase();
        const record={...payload,offerTitle:o.title,reference,hash,createdAt:now,mailStatus:sendMail?"sending":"not_connected"};
        tx.create(request,record);
        tx.update(ref,{orderCount:o.orderCount+1});
        return sendMail ? {reference,request,record} : {reference};
      });
      if (result.error) return fail(result.status,result.error);
      if (result.record) {
        let status;
        try { status = await sendMail(result.record); } catch { status = "unknown"; }
        try { await result.request.update({mailStatus:status}); } catch { console.error("pe_test_mail_status_write_failed"); }
      }
      return res.json({reference:result.reference});
    } catch {
      return fail(503,"service_unavailable");
    }
  };
}
module.exports={campaign,order,handler};
