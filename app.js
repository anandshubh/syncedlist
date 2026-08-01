import { h, render } from "https://esm.sh/preact@10.19.3";
import { useState, useEffect, useMemo } from "https://esm.sh/preact@10.19.3/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch, getDoc, getDocs, serverTimestamp, query, where, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref as sref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { shoppingListConfig, WORKER_URL } from "./config.js";

const html = htm.bind(h);
function textOn(hex){ if(!hex||hex[0]!=="#") return "#161d18"; let h=hex.slice(1); if(h.length===3)h=h.split("").map(c=>c+c).join(""); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16); const L=(0.299*r+0.587*g+0.114*b)/255; return L>0.62?"#161d18":"#fff"; }
const sqChar=n=>(((n||"?").trim()[0])||"?").toUpperCase();
const lsq=(color,name,cls)=>html`<i class=${"lsq"+(cls?" "+cls:"")} style=${"background:"+(color||"#ccc")+";color:"+textOn(color)}>${sqChar(name)}</i>`;

const appFb = initializeApp(shoppingListConfig);
const auth = getAuth(appFb);
const db = initializeFirestore(appFb, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
const storage = getStorage(appFb);

const CATS = ["Produce","Bakery","Dairy","Meat","Frozen","Spices","Staples","Household","Unsorted"];
const STORE_SWATCHES = ["#f2a7a1","#a8c8ec","#f2c79b","#a9d8b8","#c9b8e8","#9ad9d2","#f0b6d3","#e0cfa0"];

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,120) || "x";
const todayISO = () => new Date().toISOString().slice(0,10);
const daysUntil = iso => Math.ceil((new Date(iso+"T00:00:00") - new Date(new Date().toDateString())) / 86400000);

function normalizeName(raw){
  let s = raw.toLowerCase().trim();
  s = s.replace(/^[-*\d\).\s]+/,"");
  s = s.replace(/\b(\d+(\.\d+)?)\s*(lbs?|lb|kg|g|oz|gallons?|gal|dozen|packs?|pkt|bunch(es)?|cans?|bottles?|boxes?|bags?)\b/gi,"");
  s = s.replace(/\b(a|an|some|few|couple of|one|two|three|four|five)\b/gi,"");
  return s.replace(/\s+/g," ").trim();
}
const splitBlob = t => t.split(/\r?\n|,|;|\u2022|\band\b/i).map(x=>x.trim()).filter(Boolean).map(normalizeName).filter(Boolean);
function lookup(dict, name){
  if(dict[name]) return dict[name];
  for(const k of Object.keys(dict)){
    if(name===k) return dict[k];
    if(name.length>3 && (name.includes(k)||k.includes(name))) return dict[k];
  }
  return null;
}
async function routeUnknowns(names, stores, cats){
  const ctrl=new AbortController();
  const t=setTimeout(()=>ctrl.abort(), 20000);
  try{
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    const res = await fetch(WORKER_URL,{method:"POST",headers:{"Content-Type":"application/json",...(token?{"Authorization":"Bearer "+token}:{})},
      body:JSON.stringify({items:names,stores,categories:cats}),signal:ctrl.signal});
    if(!res.ok) throw new Error("worker "+res.status);
    const arr = await res.json();
    const out={}, ids=stores.map(s=>s.id);
    for(const r of (arr||[])){
      const nm=normalizeName(r.name||""); if(!nm) continue;
      out[nm]={stores:(r.stores||[]).filter(s=>ids.includes(s)),category:((Array.isArray(cats)&&cats.length?cats:CATS).includes(r.category))?r.category:"Unsorted"};
    }
    return out;
  } finally { clearTimeout(t); }
}

function Spin({g}){ return html`<span class=${"spin"+(g?" g":"")}></span>`; }
function Panel({title, count, color, open, onToggle, children}){
  return html`
    <div class="panel">
      <button class="phead" onClick=${onToggle}>
        <span class="ptitle">${color?html`<i class="pdot" style=${"background:"+color}></i>`:null}${title}</span>
        <span class="pright"><span class="pcount">${count}</span><span class=${"caret"+(open?" up":"")}>\u25be</span></span>
      </button>
      ${open?html`<div class="pbody">${children}</div>`:null}
    </div>`;
}
function Loader({label}){
  return html`<div class="loader"><span class="spin g big"></span><span>${label||"Loading\u2026"}</span></div>`;
}

function App(){
  const [user,setUser]=useState(undefined);
  const [loading,setLoading]=useState(true);
  const [hid,setHid]=useState(null);
  const [role,setRole]=useState(null);
  const [access,setAccess]=useState(undefined); // undefined = checking, "ok", "none"
  const [houseName,setHouseName]=useState("");
  const [members,setMembers]=useState([]);
  const [invites,setInvites]=useState([]);
  const [houseModal,setHouseModal]=useState(false);
  const [codeInput,setCodeInput]=useState("");
  const [joining,setJoining]=useState(false);
  const [joinErr,setJoinErr]=useState("");
  const [nameDraft,setNameDraft]=useState("");
  const [isAdmin,setIsAdmin]=useState(false);
  const [adminModal,setAdminModal]=useState(false);
  const [newName,setNewName]=useState("");
  const [newCode,setNewCode]=useState("");
  const [stores,setStores]=useState([]);
  const [dict,setDict]=useState({});
  const [list,setList]=useState([]);
  const [purch,setPurch]=useState([]);
  const [page,setPage]=useState("list");
  const [checkedIn,setCheckedIn]=useState(null);
  const [draft,setDraft]=useState("");
  const [parsing,setParsing]=useState(false);
  const [review,setReview]=useState([]);
  const [assignList,setAssignList]=useState([]);
  const [collapsed,setCollapsed]=useState({});
  const [toast,setToast]=useState("");
  const [online,setOnline]=useState(navigator.onLine);
  const [busy,setBusy]=useState({});
  const [showAdd,setShowAdd]=useState(false);
  const [storeModal,setStoreModal]=useState(false);
  const [storeDraft,setStoreDraft]=useState([]);
  const [newStore,setNewStore]=useState({name:"",color:STORE_SWATCHES[3]});
  const [delStore,setDelStore]=useState(null);
  const [reassign,setReassign]=useState({});
  const [itemModal,setItemModal]=useState(null);
  const [editCat,setEditCat]=useState("Unsorted");
  const [editStores,setEditStores]=useState([]);
  const [editTags,setEditTags]=useState([]);
  const [tagDraft,setTagDraft]=useState("");
  const [exclTags,setExclTags]=useState(()=>new Set());
  const [exclStores,setExclStores]=useState(()=>new Set());
  const toggleExcl=(setter,val)=>setter(prev=>{const n=new Set(prev); n.has(val)?n.delete(val):n.add(val); return n;});
  const [openFilter,setOpenFilter]=useState(null);   // 'store' | 'tag' | null
  const [storeSearch,setStoreSearch]=useState("");
  const [tagSearch,setTagSearch]=useState("");
  const [retModal,setRetModal]=useState(null);
  const [retDate,setRetDate]=useState("");
  const [retFile,setRetFile]=useState(null);
  const [viewImg,setViewImg]=useState(null);
  const [pendingOnly,setPendingOnly]=useState(false);
  const [pFilterStore,setPFilterStore]=useState("all");
  const [pFilterRange,setPFilterRange]=useState("30");
  const [sortBy,setSortBy]=useState("date");
  const [cats,setCats]=useState(CATS);
  const [catModal,setCatModal]=useState(false);
  const [catDraft,setCatDraft]=useState([]);
  const [newCat,setNewCat]=useState("");
  const [staples,setStaples]=useState([]);
  const [staplesModal,setStaplesModal]=useState(false);
  const [stapleSel,setStapleSel]=useState({});
  const [newStaple,setNewStaple]=useState("");
  const [menu,setMenu]=useState(false);

  const flash=m=>{setToast(m);setTimeout(()=>setToast(""),1800);};
  const scolor=id=>(stores.find(s=>s.id===id)||{}).color||"#ccc";
  const sname=id=>(stores.find(s=>s.id===id)||{}).name||id;
  // all household data lives under households/{hid}/...
  const col=name=>collection(db,"households",hid,name);
  const dref=(name,id)=>doc(db,"households",hid,name,id);
  const newRef=name=>doc(collection(db,"households",hid,name));
  const cfgDoc=()=>doc(db,"households",hid,"config","app");
  const toggleCat=key=>setCollapsed(c=>({...c,[key]:!c[key]}));
  const isBusy=k=>!!busy[k];
  async function run(key, fn){ setBusy(b=>({...b,[key]:true}));
    try{ await fn(); } catch(e){ flash("Something went wrong"); }
    finally{ setBusy(b=>{const n={...b}; delete n[key]; return n;}); } }

  useEffect(()=>onAuthStateChanged(auth,u=>{
    setUser(u||null);
    if(!u){ setHid(null); setRole(null); setAccess(undefined); setLoading(true); setIsAdmin(false); }
  }),[]);
  // resolve which household this user belongs to (members/{uid})
  useEffect(()=>{
    if(!user) return;
    let cancel=false;
    (async()=>{
      try{
        try{ const a=await getDoc(doc(db,"admins",user.uid)); if(!cancel) setIsAdmin(a.exists()); }catch{}
        const m=await getDoc(doc(db,"members",user.uid));
        if(cancel) return;
        if(m.exists()){ const d=m.data(); setHid(d.hid); setRole(d.role||"member"); setAccess("ok"); }
        else { setHid(null); setRole(null); setAccess("none"); }
      }catch(e){ if(!cancel) setAccess("none"); }
    })();
    return()=>{cancel=true;};
  },[user]);
  useEffect(()=>{const on=()=>setOnline(true),off=()=>setOnline(false);
    addEventListener("online",on);addEventListener("offline",off);
    return()=>{removeEventListener("online",on);removeEventListener("offline",off);};},[]);

  // household data — resubscribes whenever the resolved household changes.
  // stores AND categories are head-managed, both live in config/app.
  useEffect(()=>{
    if(!hid) return;
    const u1=onSnapshot(cfgDoc(),d=>{ if(d.exists()){ const dd=d.data();
      if(dd.stores) setStores(dd.stores);
      if(dd.categories&&dd.categories.length) setCats(dd.categories.includes("Unsorted")?dd.categories:[...dd.categories,"Unsorted"]);
    }});
    const u2=onSnapshot(col("dictionary"),snap=>{const m={};snap.forEach(d=>{const x=d.data();m[x.name||d.id]={stores:x.stores||[],category:x.category||"Unsorted"};});setDict(m);});
    const u3=onSnapshot(col("list"),snap=>{const a=[];snap.forEach(d=>a.push({id:d.id,...d.data()}));setList(a);setLoading(false);});
    const u4=onSnapshot(col("purchased"),snap=>{const a=[];snap.forEach(d=>a.push({id:d.id,...d.data()}));setPurch(a);});
    const u5=onSnapshot(col("staples"),snap=>{const a=[];snap.forEach(d=>a.push({id:d.id,...d.data()}));setStaples(a);});
    return()=>{u1();u2();u3();u4();u5();};
  },[hid]);

  async function signIn(){try{await signInWithPopup(auth,new GoogleAuthProvider());}catch{flash("Sign-in failed");}}
  function randHid(){ return "h_"+randCode().toLowerCase(); }
  // admin: create a brand-new household + a head invite code to hand to its head (no uid needed)
  const createHouseholdInvite=()=>run("newhouse", async ()=>{
    const nm=newName.trim(); if(!nm) return;
    const hid=randHid(), code=randCode(), exp=new Date(Date.now()+30*86400000);
    const b=writeBatch(db);
    b.set(doc(db,"households",hid),{name:nm,createdBy:user.email,createdAt:serverTimestamp()});
    b.set(doc(db,"households",hid,"config","app"),{stores:[]});
    b.set(doc(db,"invites",code),{hid,role:"head",createdBy:user.email,createdAt:serverTimestamp(),expiresAt:exp,revoked:false});
    await b.commit();
    setNewCode(code); setNewName(""); copyCode(code);
  });
  // admin: create a household and make yourself its head
  const createHouseholdSelf=()=>run("newhouse", async ()=>{
    const nm=newName.trim(); if(!nm) return;
    const hid=randHid();
    const b=writeBatch(db);
    b.set(doc(db,"households",hid),{name:nm,createdBy:user.email,createdAt:serverTimestamp()});
    b.set(doc(db,"households",hid,"config","app"),{stores:[]});
    b.set(doc(db,"members",user.uid),{uid:user.uid,hid,role:"head",email:user.email});
    await b.commit();
    setNewName(""); setNewCode(""); setAdminModal(false);
    setHid(hid); setRole("head"); setAccess("ok");
  });

  // ---- households / invites (Stage 2) ----
  function randCode(){ const a="ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s=""; for(const n of crypto.getRandomValues(new Uint32Array(10))) s+=a[n%a.length]; return s; }
  const copyCode=code=>{ try{ navigator.clipboard.writeText(code); flash("Copied "+code); }catch{ flash(code); } };
  async function joinHousehold(){
    const code=codeInput.trim().toUpperCase(); if(!code) return;
    setJoinErr(""); setJoining(true);
    try{
      // atomic: read the code, create the membership, and consume the code in one transaction
      const res=await runTransaction(db, async (tx)=>{
        const ref=doc(db,"invites",code);
        const inv=await tx.get(ref);
        if(!inv.exists()) throw new Error("invalid");
        const d=inv.data();
        if(d.revoked) throw new Error("used");
        if(d.expiresAt && d.expiresAt.toMillis && d.expiresAt.toMillis()<Date.now()) throw new Error("expired");
        const r=d.role==="head"?"head":"member";
        tx.set(doc(db,"members",user.uid),{uid:user.uid,hid:d.hid,role:r,email:user.email,viaInvite:code});
        tx.update(ref,{revoked:true});
        return {hid:d.hid,role:r};
      });
      setHid(res.hid); setRole(res.role); setAccess("ok"); setCodeInput("");
    }catch(e){
      const m=e&&e.message;
      setJoinErr(m==="used"?"That code has already been claimed. Ask for a new one."
        :m==="expired"?"That code has expired. Ask for a new one."
        :m==="invalid"?"That code isn\u2019t valid \u2014 double-check it with whoever shared it."
        :"Couldn\u2019t join \u2014 check the code and your connection.");
    }
    setJoining(false);
  }
  async function openHouse(){
    setHouseModal(true);
    try{
      const hs=await getDoc(doc(db,"households",hid)); if(hs.exists()){ setHouseName(hs.data().name||""); setNameDraft(hs.data().name||""); }
      if(role==="head"){
        const ms=await getDocs(query(collection(db,"members"),where("hid","==",hid)));
        setMembers(ms.docs.map(d=>({id:d.id,...d.data()})));
        const iv=await getDocs(query(collection(db,"invites"),where("hid","==",hid)));
        setInvites(iv.docs.map(d=>({code:d.id,...d.data()})).filter(i=>!i.revoked));
      }
    }catch(e){ flash("Couldn\u2019t load household"); }
  }
  const generateInvite=(role="member")=>run("geninvite", async ()=>{
    const code=randCode(); const exp=new Date(Date.now()+30*86400000);
    await setDoc(doc(db,"invites",code),{hid,role,createdBy:user.email,createdAt:serverTimestamp(),expiresAt:exp,revoked:false});
    setInvites(v=>[{code,hid,role,createdBy:user.email},...v]);
    copyCode(code);
  });
  const revokeInvite=code=>run("revoke_"+code, async ()=>{ await setDoc(doc(db,"invites",code),{revoked:true},{merge:true}); setInvites(v=>v.filter(i=>i.code!==code)); });
  const removeMember=uid=>run("rmmem_"+uid, async ()=>{ await deleteDoc(doc(db,"members",uid)); setMembers(v=>v.filter(m=>m.id!==uid)); });
  async function leaveHousehold(){
    if(role==="head" && members.filter(m=>m.role==="head").length<=1){ flash("Promote another member to head before you leave"); return; }
    if(!confirm("Leave this household? You\u2019ll need a new invite code to rejoin.")) return;
    await run("leave", ()=>deleteDoc(doc(db,"members",user.uid)));
    setHouseModal(false); setHid(null); setRole(null); setAccess("none");
  }

  async function promoteMember(uid){
    const t=members.find(m=>m.id===uid);
    if(!confirm(`Make ${t?t.email:"this member"} the head? You\u2019ll step down to member.`)) return;
    await run("prom_"+uid, async ()=>{
      const b=writeBatch(db);
      b.set(doc(db,"members",uid),{role:"head"},{merge:true});
      b.set(doc(db,"members",user.uid),{role:"member"},{merge:true});
      await b.commit();
      setMembers(v=>v.map(m=> m.id===uid?{...m,role:"head"} : m.id===user.uid?{...m,role:"member"} : m));
      setRole("member"); flash("You\u2019re now a member");
    });
  }
  const renameHouse=()=>run("rename", async ()=>{
    const nm=nameDraft.trim(); if(!nm||nm===houseName) return;
    await setDoc(doc(db,"households",hid),{name:nm},{merge:true});
    setHouseName(nm);
  });
  async function addItems(){
    const names=splitBlob(draft); if(!names.length) return;
    const unknown=names.filter(n=>!lookup(dict,n));
    let learned={};
    if(unknown.length){
      setParsing(true);
      try{ learned=await routeUnknowns([...new Set(unknown)],stores,cats.filter(c=>c!=="Unsorted")); }
      catch{ learned={}; flash("Couldn't reach the parser \u2014 pick a store"); }
      setParsing(false);
    }
    const merged={...dict,...learned};
    const existing=new Set(list.map(i=>i.key));
    const toAdd=[], needAssign=[];
    for(const n of names){
      if(existing.has(n)) continue; existing.add(n);
      const meta=lookup(merged,n)||learned[n]||{stores:[],category:"Unsorted"};
      if((meta.stores||[]).length) toAdd.push({name:n,stores:meta.stores,category:meta.category||"Unsorted"});
      else needAssign.push({name:n,stores:[],category:meta.category||"Unsorted"});
    }
    if(toAdd.length){
      await run("additems", async ()=>{
        const b=writeBatch(db);
        for(const it of toAdd){
          b.set(dref("dictionary",slug(it.name)),{name:it.name,stores:it.stores,category:it.category});
          b.set(newRef("list"),{key:it.name,name:it.name,stores:[...it.stores],category:it.category,checked:false,addedBy:(user.email||"").split("@")[0],ts:serverTimestamp()});
        }
        await b.commit();
      });
      flash(toAdd.length===1 ? `"${toAdd[0].name}" added to ${toAdd[0].category}` : `${toAdd.length} items added`);
    }
    setDraft(""); setShowAdd(false);
    if(needAssign.length) setAssignList(needAssign);
  }
  const updateAssign=(idx,patch)=>setAssignList(a=>a.map((x,i)=>i===idx?{...x,...patch}:x));
  const toggleAssignStore=(idx,sid)=>setAssignList(a=>a.map((x,i)=>i===idx?{...x,stores:x.stores.includes(sid)?x.stores.filter(y=>y!==sid):[...x.stores,sid]}:x));
  async function commitAssign(){
    const items=assignList; if(!items.length){ setAssignList([]); return; }
    await run("assign", async ()=>{
      const b=writeBatch(db);
      for(const it of items){
        const st=it.stores||[];
        b.set(dref("dictionary",slug(it.name)),{name:it.name,stores:st,category:it.category||"Unsorted"});
        b.set(newRef("list"),{key:it.name,name:it.name,stores:[...st],category:it.category||"Unsorted",checked:false,addedBy:(user.email||"").split("@")[0],ts:serverTimestamp()});
      }
      await b.commit();
    });
    flash(items.length===1 ? `"${items[0].name}" added to ${items[0].category}` : `${items.length} items added`);
    setAssignList([]);
  }
  async function toggleReviewStore(key,sid){
    const cur=dict[key]||{stores:[],category:"Unsorted"};
    const st=cur.stores.includes(sid)?cur.stores.filter(x=>x!==sid):[...cur.stores,sid];
    await setDoc(dref("dictionary",slug(key)),{name:key,stores:st,category:cur.category},{merge:true});
    const b=writeBatch(db); list.filter(i=>i.key===key).forEach(i=>b.set(dref("list",i.id),{stores:st},{merge:true})); await b.commit();
  }
  const toggle=it=>setDoc(dref("list",it.id),{checked:!it.checked},{merge:true});

  // ---- item editor: remove, category (remembered), store mapping ----
  function openItem(it){ setItemModal(it); setEditCat(it.category||"Unsorted"); setEditStores([...(it.stores||[])]); setEditTags([...(it.tags||[])]); setTagDraft(""); }
  const toggleEditStore=sid=>setEditStores(es=>es.includes(sid)?es.filter(x=>x!==sid):[...es,sid]);
  function addTag(){ const t=tagDraft.trim(); if(!t) return; if(!editTags.some(x=>x.toLowerCase()===t.toLowerCase())) setEditTags(ts=>[...ts,t]); setTagDraft(""); }
  const removeTag=t=>setEditTags(ts=>ts.filter(x=>x!==t));
  async function saveItem(){
    await run("saveitem", async ()=>{
      const b=writeBatch(db);
      b.set(dref("list",itemModal.id),{category:editCat,stores:editStores,tags:editTags},{merge:true});
      b.set(dref("dictionary",slug(itemModal.key)),{name:itemModal.key,category:editCat,stores:editStores},{merge:true});
      await b.commit();
    });
    setItemModal(null);
  }
  async function removeCurrentItem(){ await run("removeitem", ()=>deleteDoc(dref("list",itemModal.id))); setItemModal(null); }
  const removeRow=it=>run("rm_"+it.id, ()=>deleteDoc(dref("list",it.id)));

  async function checkOut(){
    const store=checkedIn;
    const done=list.filter(i=>i.stores.includes(store)&&i.checked);
    if(done.length){
      await run("checkout", async ()=>{
        const b=writeBatch(db);
        for(const i of done){
          b.set(newRef("purchased"),{name:i.name,store,date:todayISO(),status:"purchased",ts:serverTimestamp()});
          b.delete(dref("list",i.id));
        }
        await b.commit();
      });
      flash(done.length+" bought at "+sname(store));
    }
    setCheckedIn(null);
  }

  // ---- stores: add / rename / recolor / delete ----
  function openStores(){ setStoreDraft(stores.map(s=>({...s}))); setStoreModal(true); }
  const editDraft=(id,patch)=>setStoreDraft(d=>d.map(s=>s.id===id?{...s,...patch}:s));
  const serStore=s=>({id:s.id,name:(s.name||"").trim()||s.id,color:s.color,canonicalStoreId:s.canonicalStoreId??null});
  async function saveStores(){
    await run("savestores", ()=>setDoc(cfgDoc(),{stores:storeDraft.map(serStore)},{merge:true}));
    flash("Stores updated");
  }
  async function addStore(){
    const nm=newStore.name.trim(); if(!nm) return;
    const id=slug(nm); if(storeDraft.some(s=>s.id===id)||stores.some(s=>s.id===id)){flash("Store already exists");return;}
    const next=[...storeDraft,{id,name:nm,color:newStore.color,canonicalStoreId:null}];
    setStoreDraft(next);
    await run("addstore", ()=>setDoc(cfgDoc(),{stores:next.map(serStore)},{merge:true}));
    setNewStore({name:"",color:STORE_SWATCHES[3]}); flash(nm+" added");
  }
  function orphansOf(sid){ return list.filter(i=>i.stores.includes(sid) && i.stores.filter(x=>x!==sid).length===0); }
  function deleteStore(s){
    if(orphansOf(s.id).length){ setDelStore(s); setReassign({}); return; }
    if(!confirm(`Delete ${s.name}?`)) return;
    commitDelete(s,{});
  }
  async function commitDelete(s, assign){
    await run("delstore_"+s.id, async ()=>{
      const b=writeBatch(db);
      b.set(cfgDoc(),{stores:storeDraft.filter(x=>x.id!==s.id).map(serStore)},{merge:true});
      list.filter(i=>i.stores.includes(s.id)).forEach(i=>{
        let ns=i.stores.filter(x=>x!==s.id);
        if(ns.length===0 && assign[i.id]) ns=[assign[i.id]];
        b.set(dref("list",i.id),{stores:ns},{merge:true});
        b.set(dref("dictionary",slug(i.key)),{name:i.key,stores:ns,category:i.category||"Unsorted"},{merge:true});
      });
      Object.entries(dict).forEach(([k,v])=>{ if((v.stores||[]).includes(s.id) && !list.some(i=>i.key===k)) b.set(dref("dictionary",slug(k)),{stores:v.stores.filter(x=>x!==s.id)},{merge:true}); });
      await b.commit();
    });
    setStoreDraft(d=>d.filter(x=>x.id!==s.id));
    if(checkedIn===s.id) setCheckedIn(null);
    setDelStore(null); setReassign({});
  }

  // ---- categories ----
  function openCats(){ setCatDraft(cats.filter(c=>c!=="Unsorted")); setNewCat(""); setCatModal(true); }
  async function addCat(){
    const c=newCat.trim(); if(!c) return;
    if(cats.some(x=>x.toLowerCase()===c.toLowerCase())){flash("Category exists");return;}
    const next=[...cats.filter(x=>x!=="Unsorted"),c,"Unsorted"];
    await run("addcat", ()=>setDoc(cfgDoc(),{categories:next},{merge:true}));
    setNewCat(""); flash(c+" added");
  }
  async function deleteCat(c){
    const affected=list.filter(i=>(i.category||"Unsorted")===c);
    if(!confirm(`Delete category "${c}"? ${affected.length} item(s) move to Unsorted.`)) return;
    await run("delcat_"+c, async ()=>{
      const b=writeBatch(db);
      b.set(cfgDoc(),{categories:[...cats.filter(x=>x!==c&&x!=="Unsorted"),"Unsorted"]},{merge:true});
      affected.forEach(i=>{ b.set(dref("list",i.id),{category:"Unsorted"},{merge:true}); b.set(dref("dictionary",slug(i.key)),{name:i.key,category:"Unsorted"},{merge:true}); });
      await b.commit();
    });
    setCatDraft(d=>d.filter(x=>x!==c));
  }

  // ---- staples ----
  const isStaple=name=>staples.some(s=>s.name===name);
  function toggleStaple(name,st,cat){
    const ref=dref("staples",slug(name));
    return run("star_"+slug(name), ()=> isStaple(name) ? deleteDoc(ref) : setDoc(ref,{name,stores:st||[],category:cat||"Unsorted"}));
  }
  async function addNewStaple(){
    const nm=normalizeName(newStaple); if(!nm) return;
    const meta=lookup(dict,nm)||{stores:[],category:"Unsorted"};
    await run("addstaple", ()=>setDoc(dref("staples",slug(nm)),{name:nm,stores:meta.stores||[],category:meta.category||"Unsorted"}));
    setNewStaple("");
  }
  async function addStaplesToList(){
    const existing=new Set(list.map(i=>i.key));
    const add=staples.filter(s=>stapleSel[s.id] && !existing.has(s.name));
    if(!add.length){ setStaplesModal(false); setStapleSel({}); return; }
    await run("addstaples", async ()=>{
      const b=writeBatch(db);
      add.forEach(s=>b.set(newRef("list"),{key:s.name,name:s.name,stores:[...(s.stores||[])],category:s.category||"Unsorted",checked:false,addedBy:(user.email||"").split("@")[0],ts:serverTimestamp()}));
      await b.commit();
    });
    setStaplesModal(false); setStapleSel({}); flash(add.length+" added to list");
  }

  async function uploadAttach(purchaseId, file){
    if(!file) return;
    const ok = (file.type||"").startsWith("image/") || file.type==="application/pdf";
    if(!ok){ flash("Only image or PDF"); return; }
    if(file.size > 15*1024*1024){ flash("File too large (max 15MB)"); return; }
    await run("attach_"+purchaseId, async ()=>{
      const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-60);
      const path=`households/${hid}/returns/${purchaseId}/${Date.now()}_${safe}`;
      const r=sref(storage,path);
      await uploadBytes(r,file);
      const url=await getDownloadURL(r);
      await setDoc(dref("purchased",purchaseId),{attachUrl:url,attachType:file.type,attachPath:path},{merge:true});
    });
    flash("Attached");
  }
  function openAttachment(p){
    if(!p.attachUrl) return;
    if((p.attachType||"").startsWith("image/")) setViewImg(p.attachUrl);
    else window.open(p.attachUrl,"_blank");
  }
  async function confirmReturn(){
    if(!retDate||!retModal) return;
    const id=retModal.id, file=retFile;
    await run("confirmret", ()=>setDoc(dref("purchased",id),{status:"returning",returnByDate:retDate},{merge:true}));
    setRetModal(null); setRetDate("");
    if(file){ await uploadAttach(id,file); setRetFile(null); }
  }
  const resolveReturn=(id,status,key)=>run(key, ()=>setDoc(dref("purchased",id),{status},{merge:true}));

  const returning=purch.filter(p=>p.status==="returning");
  const dueReturns=returning.filter(p=>p.returnByDate && daysUntil(p.returnByDate)<=5).sort((a,b)=>daysUntil(a.returnByDate)-daysUntil(b.returnByDate));
  const overdue=dueReturns.some(p=>daysUntil(p.returnByDate)<0);

  function groupByCat(items, keyPrefix){
    const byCat={}; for(const it of items){(byCat[it.category||"Unsorted"]||=[]).push(it);}
    const order=[...cats.filter(c=>byCat[c]), ...Object.keys(byCat).filter(c=>!cats.includes(c))];
    return order.map(c=>{
      const key=keyPrefix+":"+c;
      const its=byCat[c].slice().sort((a,b)=>((a.checked?1:0)-(b.checked?1:0))||a.name.localeCompare(b.name));
      return {cat:c,key,items:its,open:!collapsed[key]};
    });
  }
  const allTags=useMemo(()=>{const s=new Set(); list.forEach(i=>(i.tags||[]).forEach(t=>s.add(t))); return [...s].sort((a,b)=>a.localeCompare(b));},[list]);
  const listGroups=useMemo(()=>{
    const l=list.filter(i=>{
      const sp=(i.stores||[]).length===0 || (i.stores||[]).some(s=>!exclStores.has(s));
      const tp=(i.tags||[]).length===0 || (i.tags||[]).some(t=>!exclTags.has(t));
      return sp && tp;
    });
    return groupByCat(l,"list");
  },[list,collapsed,cats,exclTags,exclStores]);
  const shopItems=useMemo(()=>list.filter(i=>i.stores.includes(checkedIn)),[list,checkedIn]);
  const shopGroups=useMemo(()=>groupByCat(shopItems,"shop:"+checkedIn),[shopItems,collapsed,checkedIn,cats]);
  const shopChecked=shopItems.filter(i=>i.checked).length;

  const filteredPurch=useMemo(()=>{
    let ps=purch.slice();
    if(pendingOnly) ps=ps.filter(p=>p.status==="returning");
    if(pFilterStore!=="all") ps=ps.filter(p=>p.store===pFilterStore);
    if(pFilterRange!=="all"){const lim=parseInt(pFilterRange,10);
      ps=ps.filter(p=>{const d=(new Date()-new Date(p.date+"T00:00:00"))/86400000; return d<=lim;});}
    return ps.sort((a,b)=>{
      if(sortBy==="store"){const c=sname(a.store).localeCompare(sname(b.store)); if(c) return c;}
      return (b.date||"").localeCompare(a.date||"");
    });
  },[purch,pendingOnly,pFilterStore,pFilterRange,sortBy,stores]);

  const check=html`<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  if(user===undefined) return html`<div class="gate"><div class="brand">Sync List<span class="dot">.</span></div><${Loader} label="Starting\u2026"/></div>`;
  if(user===null) return html`<div class="gate">
    <img class="gatelogo" src="./icon-512.png" alt="Sync List" />
    <div class="brand">Sync List<span class="dot">.</span></div>
    <p>Your shared grocery list. Sign in with Google to continue.</p>
    <button class="primary" onClick=${signIn}>Sign in with Google</button></div>`;
  if(access===undefined) return html`<div class="gate"><div class="brand">Sync List<span class="dot">.</span></div><${Loader} label="Checking access\u2026"/></div>`;
  if(access==="none") return isAdmin ? html`<div class="gate">
    <img class="gatelogo" src="./icon-512.png" alt="Sync List" />
    <div class="brand">Sync List<span class="dot">.</span></div>
    <p>Signed in as ${user.email} (admin). Create a household and send its head an invite code \u2014 they redeem it, no uid needed.</p>
    <input class="tin" style="max-width:280px" placeholder="New household name" value=${newName} onInput=${e=>setNewName(e.target.value)} />
    <button class="primary" style="max-width:280px" disabled=${!newName.trim()||isBusy("newhouse")} onClick=${createHouseholdInvite}>${isBusy("newhouse")?html`<${Spin}/>Creating\u2026`:"Create + copy head invite"}</button>
    <button class="ghost sm" style="max-width:280px" disabled=${!newName.trim()||isBusy("newhouse")} onClick=${createHouseholdSelf}>Create one for myself (I'm the head)</button>
    ${newCode?html`<p style="max-width:280px;margin:6px 0 0">Head invite code (claim once): <b onClick=${()=>copyCode(newCode)} style="cursor:pointer;letter-spacing:.08em">${newCode}</b> \u2014 tap to copy, share it with the new head.</p>`:null}
    <button class="ghost" onClick=${()=>signOut(auth)}>Sign out</button></div>` : html`<div class="gate">
    <img class="gatelogo" src="./icon-512.png" alt="Sync List" />
    <div class="brand">Sync List<span class="dot">.</span></div>
    <p>Signed in as ${user.email}. Enter the invite code from your household to join.</p>
    <input class="tin" style="max-width:260px;text-align:center;text-transform:uppercase;letter-spacing:.12em" placeholder="INVITE CODE" value=${codeInput} onInput=${e=>{setCodeInput(e.target.value.toUpperCase());setJoinErr("");}} onKeyDown=${e=>{if(e.key==="Enter")joinHousehold();}} />
    ${joinErr?html`<p style="color:var(--red);max-width:280px;margin:4px 0 0;font-size:14px">${joinErr}</p>`:null}
    <button class="primary" style="max-width:260px" disabled=${!codeInput.trim()||joining} onClick=${joinHousehold}>${joining?html`<${Spin}/>Joining\u2026`:"Join household"}</button>
    <button class="ghost" onClick=${()=>signOut(auth)}>Sign out</button></div>`;

  return html`
    <div class="top">
      <div class="brand"><img class="brandicon" src="./icon-192.png" alt="" />Sync List<span class="dot">.</span></div>
      <button class="hbtn" onClick=${()=>setMenu(true)} aria-label="Menu">\u2630</button>
    </div>

    ${!online?html`<div class="banner offline">Offline \u2014 changes sync when you're back</div>`:null}
    ${dueReturns.length>0?html`
      <div class=${"banner ret"+(overdue?" over":"")}>
        <span>${overdue?"\u26a0 Return overdue":"\u23f3 "+dueReturns.length+" return"+(dueReturns.length>1?"s":"")+" due soon"}</span>
        <button onClick=${()=>{setPage("history");setPendingOnly(true);}}>Show</button>
      </div>`:null}

    <div class="tabs">
      <button class=${page==="list"?"on":""} onClick=${()=>setPage("list")}>List</button>
      <button class=${page==="shop"?"on":""} onClick=${()=>setPage("shop")}>Shop</button>
      <button class=${page==="history"?"on":""} onClick=${()=>setPage("history")}>History</button>
    </div>

    ${loading?html`<${Loader} label="Loading your list\u2026"/>`:html`
    ${page==="list"?html`
      <div class="pagehead">
        <button class="primary sm" style="flex:1" onClick=${()=>setShowAdd(true)}>+ Add items</button>
      </div>
      ${(stores.length>1||allTags.length>0)?html`
        <div class="filterrow">
          ${stores.length>1?html`
            <div class="msel">
              <button class=${"mselbtn"+(exclStores.size?" act":"")} onClick=${()=>setOpenFilter(openFilter==="store"?null:"store")}>
                ${exclStores.size===0?"All stores":(stores.length-exclStores.size)+" store"+((stores.length-exclStores.size)===1?"":"s")}
                <span class="caret">\u25be</span>
              </button>
              ${openFilter==="store"?html`
                <div class="mselscrim" onClick=${()=>{setOpenFilter(null);setStoreSearch("");}}></div>
                <div class="msellist">
                  <input class="mselsearch" placeholder="Search stores\u2026" value=${storeSearch} onInput=${e=>setStoreSearch(e.target.value)} />
                  <button class="mselopt" onClick=${()=>setExclStores(exclStores.size===0?new Set(stores.map(s=>s.id)):new Set())}><span class=${"ckbox"+(exclStores.size===0?" on":"")}></span>${exclStores.size===0?"Deselect all":"All stores"}</button>
                  ${stores.filter(s=>s.name.toLowerCase().includes(storeSearch.trim().toLowerCase())).map(s=>html`<button class="mselopt" onClick=${()=>toggleExcl(setExclStores,s.id)}><span class=${"ckbox"+(!exclStores.has(s.id)?" on":"")}></span>${lsq(s.color,s.name)}${s.name}</button>`)}
                </div>`:null}
            </div>`:null}
          ${allTags.length>0?html`
            <div class="msel">
              <button class=${"mselbtn"+(exclTags.size?" act":"")} onClick=${()=>setOpenFilter(openFilter==="tag"?null:"tag")}>
                ${exclTags.size===0?"All tags":(allTags.length-exclTags.size)+" tag"+((allTags.length-exclTags.size)===1?"":"s")}
                <span class="caret">\u25be</span>
              </button>
              ${openFilter==="tag"?html`
                <div class="mselscrim" onClick=${()=>{setOpenFilter(null);setTagSearch("");}}></div>
                <div class="msellist">
                  <input class="mselsearch" placeholder="Search tags\u2026" value=${tagSearch} onInput=${e=>setTagSearch(e.target.value)} />
                  <button class="mselopt" onClick=${()=>setExclTags(exclTags.size===0?new Set(allTags):new Set())}><span class=${"ckbox"+(exclTags.size===0?" on":"")}></span>${exclTags.size===0?"Deselect all":"All tags"}</button>
                  ${allTags.filter(t=>t.toLowerCase().includes(tagSearch.trim().toLowerCase())).map(t=>html`<button class="mselopt" onClick=${()=>toggleExcl(setExclTags,t)}><span class=${"ckbox"+(!exclTags.has(t)?" on":"")}></span>${t}</button>`)}
                </div>`:null}
            </div>`:null}
        </div>`:null}
      ${list.length>0?html`
        <div class="listcount">${(exclTags.size||exclStores.size)
          ? html`${listGroups.reduce((a,g)=>a+g.items.length,0)} <span class="lcmuted">of ${list.length} items</span>`
          : html`${list.length} item${list.length===1?"":"s"}`}</div>`:null}
      ${(exclTags.size||exclStores.size)&&listGroups.length===0
        ? html`<div class="empty"><div class="big">Nothing matches</div>No items for these filters \u2014 reset with \u201cAll\u201d.</div>`
        : list.length===0
        ? html`<div class="empty"><div class="big">List is empty</div>Tap \u201cAdd items\u201d or pull from \u2605 Staples.</div>`
        : listGroups.map(g=>html`
          <${Panel} title=${g.cat} count=${g.items.length} open=${g.open} onToggle=${()=>toggleCat(g.key)}>
            ${g.items.map(it=>html`
              <div class="lrow">
                <button class=${"rowstar lead-star"+(isStaple(it.name)?" on":"")} onClick=${()=>toggleStaple(it.name,it.stores,it.category)}>${isBusy("star_"+slug(it.name))?html`<${Spin} g=${true}/>`:(isStaple(it.name)?"\u2605":"\u2606")}</button>
                <button class="lmain" onClick=${()=>openItem(it)}>
                  <span class="lmid">
                    <span class="lname">${it.name}</span>
                    ${(it.tags&&it.tags.length)?html`<span class="ltags">${it.tags.map(t=>html`<span class="ltag">${t}</span>`)}</span>`:null}
                  </span>
                  <span class="lstores">${it.stores.length
                    ? it.stores.map(s=>lsq(scolor(s),sname(s)))
                    : html`<em class="uns">unsorted</em>`}</span>
                </button>
                <button class="rowx" onClick=${()=>removeRow(it)}>${isBusy("rm_"+it.id)?html`<${Spin} g=${true}/>`:"\u00d7"}</button>
              </div>`)}
          <//>`)}`:null}

    ${page==="shop"?( !checkedIn ? html`
      <div class="pickhead">Which store are you at?</div>
      <div class="picker">
        ${stores.map(s=>{const n=list.filter(i=>i.stores.includes(s.id)&&!i.checked).length;
          return html`<button class="storecard" style=${"--sc:"+s.color} onClick=${()=>setCheckedIn(s.id)}>
            <span class="scname">${s.name}</span>
            <span class="sccount">${n} item${n===1?"":"s"}</span>
          </button>`;})}
        <button class="storecard addtile" onClick=${openStores}><span class="addplus">+</span><span class="sccount">Add store</span></button>
      </div>`
    : html`
      <div class="checkin" style=${"--sc:"+scolor(checkedIn)}>
        <span class="cistore">${lsq(scolor(checkedIn),sname(checkedIn))}At ${sname(checkedIn)}</span>
        <button class="ghost ciout" onClick=${checkOut}>Check out</button>
      </div>
      ${shopGroups.length===0
        ? html`<div class="empty"><div class="big">Nothing left for ${sname(checkedIn)}</div>You're all done here \u2014 check out.</div>`
        : shopGroups.map(g=>{
            const open=g.open;
            return html`
            <${Panel} title=${g.cat} count=${g.items.filter(i=>!i.checked).length+"/"+g.items.length} color=${scolor(checkedIn)} open=${open} onToggle=${()=>toggleCat(g.key)}>
              ${g.items.map(it=>html`
                <div class=${"item"+(it.checked?" done":"")} style=${"--sc:"+scolor(checkedIn)} onClick=${()=>toggle(it)}>
                  <div class="box">${check}</div>
                  <div class="label">
                    <span class="lname">${it.name}</span>
                    ${(it.tags&&it.tags.length)?html`<span class="ltags">${it.tags.map(t=>html`<span class="ltag">${t}</span>`)}</span>`:null}
                  </div>
                  ${it.stores.length>1?html`<div class="also">${it.stores.filter(x=>x!==checkedIn).map(x=>lsq(scolor(x),sname(x)))}</div>`:null}
                </div>`)}
            <//>`;})}` ):null}

    ${page==="history"?html`
      <div class="pagetitle">Purchase History</div>
      <div class="filters">
        <button class=${"fbtn"+(pendingOnly?" on":"")} onClick=${()=>setPendingOnly(p=>!p)}>Pending returns</button>
        <select class="sel sm" value=${sortBy} onChange=${e=>setSortBy(e.target.value)}>
          <option value="date">Sort: Date</option><option value="store">Sort: Store</option>
        </select>
        <select class="sel sm" value=${pFilterStore} onChange=${e=>setPFilterStore(e.target.value)}>
          <option value="all">All stores</option>
          ${stores.map(s=>html`<option value=${s.id}>${s.name}</option>`)}
        </select>
        <select class="sel sm" value=${pFilterRange} onChange=${e=>setPFilterRange(e.target.value)}>
          <option value="7">7 days</option><option value="30">30 days</option>
          <option value="90">90 days</option><option value="all">All time</option>
        </select>
      </div>
      ${filteredPurch.length===0
        ? html`<div class="empty"><div class="big">No purchases</div>Items you mark bought show up here.</div>`
        : filteredPurch.map(p=>{
            const ret=p.status==="returning"; const d=ret?daysUntil(p.returnByDate):null;
            const rk="ret_"+p.id, kk="keep_"+p.id;
            return html`
            <div class=${"prow"+(ret?(d<0?" over":d<=5?" due":""):"")}>
              <button class=${"rowstar lead-star"+(isStaple(p.name)?" on":"")} onClick=${()=>toggleStaple(p.name,(dict[p.name]&&dict[p.name].stores)||[p.store],(dict[p.name]&&dict[p.name].category)||"Unsorted")}>${isStaple(p.name)?"\u2605":"\u2606"}</button>
              <div class="pinfo">
                <span class="pname">${p.name}</span>
                <span class="pmeta">${lsq(scolor(p.store),sname(p.store))}${sname(p.store)} \u00b7 ${p.date}
                  ${ret?html`\u00b7 <b>${d<0?"overdue":"return in "+d+"d"}</b>`:null}</span>
              </div>
              <div class="pact">
                ${(!ret && p.status!=="returned" && p.status!=="kept")?html`<button class="ghost" onClick=${()=>{setRetModal(p);setRetDate("");setRetFile(null);}}>Return</button>`:null}
                ${ret?html`
                  ${p.attachUrl?html`<button class="ghost" onClick=${()=>openAttachment(p)}>View</button>`
                    :html`<label class="ghost attachrow">${isBusy("attach_"+p.id)?html`<${Spin} g=${true}/>`:"Attach"}<input type="file" accept="image/*,application/pdf" onChange=${e=>{const f=e.target.files[0]; if(f) uploadAttach(p.id,f);}} /></label>`}
                  <button class="ghost" disabled=${isBusy(rk)} onClick=${()=>resolveReturn(p.id,"returned",rk)}>${isBusy(rk)?html`<${Spin} g=${true}/>`:"Returned"}</button>
                  <button class="ghost mut" disabled=${isBusy(kk)} onClick=${()=>resolveReturn(p.id,"kept",kk)}>${isBusy(kk)?html`<${Spin} g=${true}/>`:"Keeping"}</button>`:null}
                ${(p.status==="returned"||p.status==="kept")?html`<span class="tag">${p.status}</span>`:null}
              </div>
            </div>`;})}`:null}
    `}

    <!-- add items -->
    ${showAdd?html`
      <div class="scrim" onClick=${()=>setShowAdd(false)}></div>
      <div class="sheet">
        <div class="sheethead"><div class="lead">Paste your voice list</div><button class="sheetx" onClick=${()=>setShowAdd(false)} aria-label="Close">\u00d7</button></div>
        <div class="hint">Alexa, WhatsApp, Notes \u2014 one line or comma-separated. Sync List splits it and files each item to the right store.</div>
        <textarea placeholder=${"2 lbs onions\ncilantro\npaneer\nmilk\ntoor dal"} value=${draft} onInput=${e=>setDraft(e.target.value)}></textarea>
        <button class="primary" disabled=${parsing||!draft.trim()} onClick=${addItems}>${parsing?html`<${Spin}/>Routing\u2026`:"Add to list"}</button>
      </div>`:null}
    ${review.length>0?html`
      <div class="scrim" onClick=${()=>setReview([])}></div>
      <div class="sheet">
        <div class="lead">New items \u2014 fix any store</div>
        ${review.map(k=>{const meta=dict[k]||{stores:[],category:"Unsorted"};return html`
          <div class="rrow"><span class="rname">${k}</span><span class="rcat">${meta.category}</span>
            ${stores.map(s=>html`<button class=${"chip mini"+(meta.stores.includes(s.id)?" pick":"")} style=${"--sc:"+s.color} onClick=${()=>toggleReviewStore(k,s.id)}>
              ${lsq(s.color,s.name)}${s.name}</button>`)}
          </div>`;})}
        <button class="primary" onClick=${()=>setReview([])}>Done</button>
      </div>`:null}

    <!-- item editor -->
    ${itemModal?html`
      <div class="scrim" onClick=${()=>setItemModal(null)}></div>
      <div class="sheet">
        <div class="lead">${itemModal.name}</div>
        <div class="hint">Category</div>
        <select class="sel" value=${editCat} onChange=${e=>setEditCat(e.target.value)}>
          ${cats.map(c=>html`<option value=${c}>${c}</option>`)}
        </select>
        <div class="hint">Stores</div>
        <div class="chiprow">${stores.map(s=>html`<button class=${"chip mini"+(editStores.includes(s.id)?" pick":"")} style=${"--sc:"+s.color} onClick=${()=>toggleEditStore(s.id)}>
          ${lsq(s.color,s.name)}${s.name}</button>`)}</div>
        <div class="hint">Tags (for whom)</div>
        <div class="tagedit">
          ${editTags.map(t=>html`<span class="tagchip on">${t}<button class="tagx" onClick=${()=>removeTag(t)}>\u00d7</button></span>`)}
        </div>
        <input class="tin" placeholder="Add a tag (e.g. son) \u2014 Enter" value=${tagDraft} onInput=${e=>setTagDraft(e.target.value)} onKeyDown=${e=>{if(e.key==="Enter"){e.preventDefault();addTag();}}} />
        <button class="primary" disabled=${isBusy("saveitem")} onClick=${saveItem}>${isBusy("saveitem")?html`<${Spin}/>Saving\u2026`:"Save"}</button>
        <button class="danger" disabled=${isBusy("removeitem")} onClick=${removeCurrentItem}>${isBusy("removeitem")?html`<${Spin} g=${true}/>`:"Remove from list"}</button>
      </div>`:null}

    <!-- manage stores -->
    ${storeModal?html`
      <div class="scrim" onClick=${()=>setStoreModal(false)}></div>
      <div class="sheet tall">
        <div class="sheethead"><div class="lead">Stores</div><button class="sheetx" onClick=${()=>setStoreModal(false)} aria-label="Close">\u00d7</button></div>
        ${storeDraft.map(s=>html`
          <div class="serow">
            <input class="tin flex" value=${s.name} onInput=${e=>editDraft(s.id,{name:e.target.value})} />
            <input class="colorin" type="color" value=${s.color} onInput=${e=>editDraft(s.id,{color:e.target.value})} />
            <button class="rowx" disabled=${isBusy("delstore_"+s.id)} onClick=${()=>deleteStore(s)}>${isBusy("delstore_"+s.id)?html`<${Spin} g=${true}/>`:"\ud83d\uddd1"}</button>
          </div>`)}
        <button class="primary sm" disabled=${isBusy("savestores")} onClick=${saveStores}>${isBusy("savestores")?html`<${Spin}/>Saving\u2026`:"Save names & colors"}</button>
        <div class="lead" style="margin-top:10px">Add a store</div>
        <input class="tin" placeholder="Store name" value=${newStore.name} onInput=${e=>setNewStore(n=>({...n,name:e.target.value}))} />
        <div class="pickrow">
          <div class="swatches">${STORE_SWATCHES.map(c=>html`<button class=${"sw"+(newStore.color===c?" on":"")} style=${"background:"+c} onClick=${()=>setNewStore(n=>({...n,color:c}))}></button>`)}</div>
          <input class="colorin" type="color" value=${newStore.color} onInput=${e=>setNewStore(n=>({...n,color:e.target.value}))} />
        </div>
        <button class="primary" disabled=${!newStore.name.trim()||isBusy("addstore")} onClick=${addStore}>${isBusy("addstore")?html`<${Spin}/>Adding\u2026`:"Add store"}</button>
      </div>`:null}

    <!-- delete store: reassign orphans -->
    ${delStore?html`
      <div class="scrim" onClick=${()=>setDelStore(null)}></div>
      <div class="sheet tall">
        <div class="lead">Deleting ${delStore.name}</div>
        <div class="hint">These items are only at ${delStore.name}. Pick a new store for each, or leave blank to move it to Unsorted.</div>
        ${orphansOf(delStore.id).map(it=>html`
          <div class="orow">
            <span class="rname">${it.name}</span>
            <div class="chiprow">
              ${stores.filter(s=>s.id!==delStore.id).map(s=>html`
                <button class=${"chip mini"+((reassign[it.id]===s.id)?" pick":"")} style=${"--sc:"+s.color} onClick=${()=>setReassign(r=>({...r,[it.id]:r[it.id]===s.id?undefined:s.id}))}>
                  ${lsq(s.color,s.name)}${s.name}</button>`)}
            </div>
          </div>`)}
        <button class="danger" disabled=${isBusy("delstore_"+delStore.id)} onClick=${()=>commitDelete(delStore,reassign)}>${isBusy("delstore_"+delStore.id)?html`<${Spin} g=${true}/>`:"Delete store & apply"}</button>
        <button class="ghost" onClick=${()=>setDelStore(null)}>Cancel</button>
      </div>`:null}

    <!-- dropdown menu (anchored under the hamburger) -->
    ${menu?html`
      <div class="menuscrim" onClick=${()=>setMenu(false)}></div>
      <div class="dropdown">
        <div class="ddemail">${user.email}</div>
        <button class="ddm" onClick=${()=>{setMenu(false);setStapleSel({});setStaplesModal(true);}}>Staples</button>
        <button class="ddm" onClick=${()=>{setMenu(false);openHouse();}}>Household</button>
        ${isAdmin?html`<button class="ddm" onClick=${()=>{setMenu(false);setNewName("");setNewCode("");setAdminModal(true);}}>New household</button>`:null}
        ${role==="head"?html`<button class="ddm" onClick=${()=>{setMenu(false);openStores();}}>Manage stores</button>`:null}
        ${role==="head"?html`<button class="ddm" onClick=${()=>{setMenu(false);openCats();}}>Manage categories</button>`:null}
        <div class="ddsep"></div>
        <button class="ddm ddout" onClick=${()=>signOut(auth)}>Sign out</button>
      </div>`:null}

    <!-- categories -->
    ${catModal?html`
      <div class="scrim" onClick=${()=>setCatModal(false)}></div>
      <div class="sheet tall">
        <div class="lead">Categories</div>
        <div class="hint">This order is how items group on the List and Shop pages. \u201cUnsorted\u201d always stays last.</div>
        ${catDraft.map(c=>html`
          <div class="serow"><span class="flex">${c}</span>
            <button class="rowx" disabled=${isBusy("delcat_"+c)} onClick=${()=>deleteCat(c)}>${isBusy("delcat_"+c)?html`<${Spin} g=${true}/>`:"\ud83d\uddd1"}</button>
          </div>`)}
        <div class="lead" style="margin-top:10px">Add a category</div>
        <input class="tin" placeholder="e.g. Clothes" value=${newCat} onInput=${e=>setNewCat(e.target.value)} onKeyDown=${e=>{if(e.key==="Enter")addCat();}} />
        <button class="primary" disabled=${!newCat.trim()||isBusy("addcat")} onClick=${addCat}>${isBusy("addcat")?html`<${Spin}/>Adding\u2026`:"Add category"}</button>
      </div>`:null}

    <!-- household -->
    ${houseModal?html`
      <div class="scrim" onClick=${()=>setHouseModal(false)}></div>
      <div class="sheet tall">
        <div class="sheethead"><div class="lead">${houseName||"Household"}</div><button class="sheetx" onClick=${()=>setHouseModal(false)} aria-label="Close">\u00d7</button></div>
        ${role==="head"?html`
          <div class="serow"><input class="tin flex" value=${nameDraft} onInput=${e=>setNameDraft(e.target.value)} placeholder="Household name" /><button class="mini2" disabled=${!nameDraft.trim()||nameDraft.trim()===houseName||isBusy("rename")} onClick=${renameHouse}>${isBusy("rename")?html`<${Spin} g=${true}/>`:"Save"}</button></div>
          <div class="hint">Members</div>
          ${members.map(m=>html`
            <div class="serow">
              <span class="flex">${m.email}${m.role==="head"?html` <span class="tag">head</span>`:null}</span>
              ${m.role!=="head"?html`<button class="mini2" disabled=${isBusy("prom_"+m.id)} onClick=${()=>promoteMember(m.id)}>${isBusy("prom_"+m.id)?html`<${Spin} g=${true}/>`:"Make head"}</button>`:null}
              ${m.id!==user.uid?html`<button class="rowx" disabled=${isBusy("rmmem_"+m.id)} onClick=${()=>removeMember(m.id)}>${isBusy("rmmem_"+m.id)?html`<${Spin} g=${true}/>`:"\u00d7"}</button>`:null}
            </div>`)}
          <div class="lead" style="margin-top:12px">Invite codes</div>
          <div class="hint">Each code can be claimed <b>once</b> \u2014 generate a fresh one for each person. Codes expire after 30 days; you can revoke any you haven\u2019t shared.</div>
          ${invites.map(i=>html`
            <div class="serow">
              <button class="mini2" onClick=${()=>copyCode(i.code)}>${i.code} \u2398</button>
              <span class="flex">${i.role==="head"?html`<span class="tag">co-head</span>`:null}</span>
              <button class="rowx" disabled=${isBusy("revoke_"+i.code)} onClick=${()=>revokeInvite(i.code)}>${isBusy("revoke_"+i.code)?html`<${Spin} g=${true}/>`:"\ud83d\uddd1"}</button>
            </div>`)}
          <button class="primary sm" disabled=${isBusy("geninvite")} onClick=${()=>generateInvite("member")}>${isBusy("geninvite")?html`<${Spin}/>Generating\u2026`:"Invite member"}</button>
        `:html`<div class="hint">You\u2019re a member of this household.</div>`}
        <div class="ddsep" style="margin:14px 0 4px"></div>
        <button class="danger" disabled=${isBusy("leave")} onClick=${leaveHousehold}>Leave household</button>
      </div>`:null}

    <!-- admin: new household -->
    ${adminModal?html`
      <div class="scrim" onClick=${()=>setAdminModal(false)}></div>
      <div class="sheet">
        <div class="sheethead"><div class="lead">New household</div><button class="sheetx" onClick=${()=>setAdminModal(false)} aria-label="Close">\u00d7</button></div>
        <div class="hint">Creates an empty household and a one-time head invite code to send whoever will run it \u2014 they claim it once to become the head. No uid needed.</div>
        <input class="tin" placeholder="Household name" value=${newName} onInput=${e=>setNewName(e.target.value)} />
        <button class="primary" disabled=${!newName.trim()||isBusy("newhouse")} onClick=${createHouseholdInvite}>${isBusy("newhouse")?html`<${Spin}/>Creating\u2026`:"Create + copy head invite"}</button>
        ${newCode?html`<div class="serow" style="margin-top:8px"><span class="flex">Head code (claim once): <b style="letter-spacing:.08em">${newCode}</b></span><button class="mini2" onClick=${()=>copyCode(newCode)}>Copy</button></div>`:null}
      </div>`:null}

    <!-- staples palette -->
    ${staplesModal?html`
      <div class="scrim" onClick=${()=>setStaplesModal(false)}></div>
      <div class="sheet tall">
        <div class="lead">Staples</div>
        <div class="hint">Your regulars. Tick what you need this week and add them all at once. Items already on the list are greyed out.</div>
        <input class="tin" placeholder="Add a staple (e.g. milk)" value=${newStaple} onInput=${e=>setNewStaple(e.target.value)} onKeyDown=${e=>{if(e.key==="Enter")addNewStaple();}} />
        ${staples.length===0?html`<div class="hint">No staples yet \u2014 star items on the List or in Purchase History to keep them here.</div>`:null}
        ${staples.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(s=>{
          const onList=list.some(i=>i.key===s.name);
          return html`<div class=${"strow"+(onList?" off":"")} onClick=${()=>{ if(!onList) setStapleSel(v=>({...v,[s.id]:!v[s.id]})); }}>
            <div class=${"box sm"+((stapleSel[s.id]&&!onList)?" on":"")}>${(stapleSel[s.id]&&!onList)?check:null}</div>
            <span class="sname2">${s.name}</span>
            <span class="lstores">${(s.stores||[]).map(x=>lsq(scolor(x),sname(x)))}</span>
            ${onList?html`<span class="tag">on list</span>`:null}
            <button class="rowx" onClick=${e=>{e.stopPropagation();toggleStaple(s.name,s.stores,s.category);}}>${isBusy("star_"+s.id)?html`<${Spin} g=${true}/>`:"\u00d7"}</button>
          </div>`;})}
        <button class="primary" disabled=${isBusy("addstaples")||!Object.values(stapleSel).some(Boolean)} onClick=${addStaplesToList}>${isBusy("addstaples")?html`<${Spin}/>Adding\u2026`:"Add selected to list"}</button>
      </div>`:null}

    <!-- assign store for items the parser couldn't route -->
    ${assignList.length>0?html`
      <div class="scrim" onClick=${commitAssign}></div>
      <div class="sheet tall">
        <div class="lead">Which store${assignList.length>1?"s":""}?</div>
        <div class="hint">Couldn't auto-detect where to buy ${assignList.length>1?"these":"this"}. Pick a store (and category) \u2014 I'll remember for next time.</div>
        ${assignList.map((it,idx)=>html`
          <div class="arow">
            <div class="aname">${it.name}</div>
            <select class="sel sm" value=${it.category} onChange=${e=>updateAssign(idx,{category:e.target.value})}>
              ${cats.map(c=>html`<option value=${c}>${c}</option>`)}
            </select>
            <div class="chiprow">
              ${stores.map(s=>html`<button class=${"chip mini"+(it.stores.includes(s.id)?" pick":"")} style=${"--sc:"+s.color} onClick=${()=>toggleAssignStore(idx,s.id)}>
                ${lsq(s.color,s.name)}${s.name}</button>`)}
            </div>
          </div>`)}
        <button class="primary" disabled=${isBusy("assign")} onClick=${commitAssign}>${isBusy("assign")?html`<${Spin}/>Adding\u2026`:"Add to list"}</button>
      </div>`:null}

    <!-- return date -->
    ${retModal?html`
      <div class="scrim" onClick=${()=>setRetModal(null)}></div>
      <div class="sheet">
        <div class="lead">Return \u201c${retModal.name}\u201d</div>
        <div class="hint">Bought at ${sname(retModal.store)} on ${retModal.date}. Enter the return-by date \u2014 a red banner appears within 5 days of it.</div>
        <input class="tin" type="date" value=${retDate} min=${todayISO()} onInput=${e=>setRetDate(e.target.value)} />
        <label class="attachbtn">${retFile?("\u2713 "+retFile.name):"\ud83d\udcce Attach receipt / QR / label \u2014 image or PDF (optional)"}
          <input type="file" accept="image/*,application/pdf" onChange=${e=>setRetFile(e.target.files[0]||null)} />
        </label>
        <button class="primary" disabled=${!retDate||isBusy("confirmret")} onClick=${confirmReturn}>${isBusy("confirmret")?html`<${Spin}/>Saving\u2026`:"Mark for return"}</button>
      </div>`:null}

    <!-- image viewer -->
    ${viewImg?html`
      <div class="scrim dark" onClick=${()=>setViewImg(null)}></div>
      <div class="imgview" onClick=${()=>setViewImg(null)}><img src=${viewImg} alt="attachment" /></div>`:null}

    ${(page==="shop" && checkedIn)?html`
      <div class="submitbar"><div class="inner"><button class="primary" style="width:100%" disabled=${isBusy("checkout")} onClick=${checkOut}>${isBusy("checkout")?html`<${Spin}/>Saving\u2026`:(shopChecked>0?"Check out \u00b7 "+shopChecked+" bought":"Check out")}</button></div></div>`:null}
    ${toast?html`<div class="toast">${toast}</div>`:null}
  `;
}
render(html`<${App}/>`, document.getElementById("app"));
if("serviceWorker" in navigator) addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
