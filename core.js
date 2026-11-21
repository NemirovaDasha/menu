import {initialState, categories} from './seed.js';
export const uid=()=>globalThis.crypto.randomUUID();
export const clone=x=>structuredClone(x);
export const norm=s=>s.trim().toLocaleLowerCase('ru').replaceAll('ё','е').replace(/\s+/g,' ');
export const round=n=>Math.round((n+Number.EPSILON)*10000)/10000;
export const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n);
export const units=['г','кг','мл','л','шт.','порц.','зуб.','стакан','стебель','головка','упак.','веточка','щепотка','ст. л.','ч. л.','по вкусу','по необходимости'];
export const meals=[['breakfast','Завтраки'],['lunch','Обеды'],['dinner','Ужины'],['extra','Дополнительно']];
export function quantity(amount,unit,max){
 if(amount==null||unit==='по вкусу'||unit==='по необходимости')return unit==='по вкусу'?'по вкусу':'по необходимости';
 let a=amount,b=max??amount,u=unit;
 if(unit==='г'&&a>=1000){a/=1000;b/=1000;u='кг';}if(unit==='мл'&&a>=1000){a/=1000;b/=1000;u='л';}
 return `${fmt(a)}${Math.abs(b-a)>.00001?`–${fmt(b)}`:''} ${u}`;
}
export function canonical(i){const m=i.unit==='кг'||i.unit==='л'?1000:1;return {...i,amount:i.amount==null?null:i.amount*m,amountMax:i.amountMax==null?undefined:i.amountMax*m,unit:i.unit==='кг'?'г':i.unit==='л'?'мл':i.unit};}
export const ingredientKey=i=>`${norm(i.name)}|${canonical(i).unit}`;
export const safeVideoUrl=s=>{if(!s)return '';try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)?u.href:null;}catch{return null;}};
export const allowedMeals=r=>r.category==='Завтраки'?['breakfast']:r.category==='Супы'?['lunch']:['Десерты','Салаты'].includes(r.category)?['extra']:['lunch','dinner'];
export const defaultMeal=r=>allowedMeals(r)[0];
export const defaultModes=r=>Object.fromEntries(r.preparations.map(l=>[l.prepId,l.waterAllowed?'water':'fresh']));
export function newEntry(r,meal=defaultMeal(r),servings=r.servings){return {id:uid(),recipeId:r.id,meal,servings,pinned:false,cooked:false,wholeMode:'fresh',prepModes:defaultModes(r)};}

export function allocate(state, menu=state.menu, prepPlans=state.prepPlans){
 const lots=state.stock.map(x=>({...x,remaining:x.amount})).sort((a,b)=>a.date.localeCompare(b.date));
 const entries=[],productions=[],totals=new Map();
 function reserve(prepId,needed){let rest=needed;const consumes=[];for(const lot of lots){if(lot.prepId!==prepId||lot.remaining<=0||rest<=0)continue;const amount=round(Math.min(rest,lot.remaining));lot.remaining=round(lot.remaining-amount);rest=round(rest-amount);consumes.push({lotId:lot.id,amount});}return {prepId,needed,used:round(needed-rest),consumes};}
 function add(original,scale,source){
  if(scale<=.00001)return;const i=canonical(original);if(norm(i.name)==='вода')return;
  const amount=i.amount==null?null:round(i.amount*scale);const amountMax=i.amountMax==null?undefined:round(i.amountMax*scale);
  const key=ingredientKey(i);const prev=totals.get(key)||{...i,key,amount:0,amountMax:0,unquantified:false,optionalOnly:true,sources:[]};
  if(amount==null)prev.unquantified=true;else{prev.amount=round(prev.amount+amount);prev.amountMax=round(prev.amountMax+(amountMax??amount));}
  prev.optionalOnly=prev.optionalOnly&&!!i.optional;
  const label=[source.title,source.prepTitle?`для заготовки «${source.prepTitle}»`:'',source.forFreezer?'в морозилку':''].filter(Boolean).join(' · ');
  const existing=prev.sources.find(x=>x.label===label&&x.optional===!!i.optional&&x.note===(i.note||''));
  if(existing){if(amount==null)existing.unquantified=true;else{existing.amount=round(existing.amount+amount);existing.amountMax=round(existing.amountMax+(amountMax??amount));}}
  else prev.sources.push({label,title:source.title,prepTitle:source.prepTitle||'',forFreezer:!!source.forFreezer,optional:!!i.optional,note:i.note||'',amount:amount??0,amountMax:amountMax??amount??0,unquantified:amount==null});
  totals.set(key,prev);
 }
 function expandPrep(p,scale,source){for(const i of p.ingredients)add(i,scale,source);}
 function processRecipe(r,servings,modes,wholeMode,source){
  let scale=servings/r.servings;const allocations=[];
  if(wholeMode==='stock'&&r.freezePrepId){const whole=reserve(r.freezePrepId,servings);whole.whole=true;allocations.push(whole);scale=round((servings-whole.used)/r.servings);}
  const covered=new Map();
  for(const link of r.preparations){
   const p=state.prepTypes.find(p=>p.id===link.prepId);if(!p||scale<=0)continue;
   const mode=modes?.[link.prepId]||(link.waterAllowed?'water':'fresh');
   const max=link.amountMax??link.amount;const needed=round(max*scale);
   const a=mode==='stock'?reserve(p.id,needed):{prepId:p.id,needed,used:0,consumes:[]};a.mode=mode;allocations.push(a);
   const ratio=needed?Math.max(0,1-a.used/needed):0;
   for(const id of link.covers)covered.set(id,{ratio:mode==='water'?0:ratio,prepTitle:p.title,replace:link.strategy==='replace'});
   if(link.strategy==='replace'&&mode!=='water'&&ratio>0)expandPrep(p,needed*ratio/p.yield,{...source,prepTitle:p.title});
  }
  for(const i of r.ingredients){const c=covered.get(i.id);if(c?.replace)continue;add(i,scale*(c?.ratio??1),{...source,prepTitle:c?.prepTitle||source.prepTitle});}
  return {recipe:r,allocations,servings};
 }
 for(const e of menu){if(e.cooked)continue;const r=state.recipes.find(r=>r.id===e.recipeId);if(!r)continue;entries.push({entryId:e.id,...processRecipe(r,e.servings,e.prepModes,e.wholeMode,{title:r.title})});}
 for(const plan of prepPlans){if(plan.cooked)continue;const p=state.prepTypes.find(p=>p.id===plan.prepId);if(!p)continue;
  const r=p.sourceRecipeId&&state.recipes.find(r=>r.id===p.sourceRecipeId);let allocations=[];
  if(r){const result=processRecipe(r,plan.amount,plan.prepModes,'fresh',{title:p.title,forFreezer:true});allocations=result.allocations;}
  else expandPrep(p,plan.amount/p.yield,{title:p.title,prepTitle:p.title,forFreezer:true});
  productions.push({planId:plan.id,prep:p,amount:plan.amount,allocations});
 }
 const shopping=[...totals.values()].map(i=>({...i,amount:i.amount===0&&i.unquantified?null:i.amount,amountMax:i.amountMax===0&&i.unquantified?undefined:i.amountMax})).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
 return {entries,productions,shopping,lots};
}
export function availability(state,r,servings=r.servings){
 const stocks=Object.fromEntries(state.prepTypes.map(p=>[p.id,state.stock.filter(l=>l.prepId===p.id).reduce((s,l)=>s+l.amount,0)]));
 const list=r.preparations.filter(l=>stocks[l.prepId]>0).map(l=>({prepId:l.prepId,amount:stocks[l.prepId],servings:stocks[l.prepId]/(l.amountMax??l.amount)*r.servings}));
 if(r.freezePrepId&&stocks[r.freezePrepId]>0)list.unshift({prepId:r.freezePrepId,amount:stocks[r.freezePrepId],servings:stocks[r.freezePrepId],whole:true});
 return {has:!!list.length,list,complete:list.some(l=>l.servings>=servings)};
}
export function remainingState(state,menu=state.menu,plans=state.prepPlans){return {...state,stock:allocate(state,menu,plans).lots.map(l=>({...l,amount:l.remaining}))};}
function consume(next,allocations){const used=[];for(const a of allocations)for(const c of a.consumes){const lot=next.stock.find(l=>l.id===c.lotId);if(!lot||lot.amount+1e-8<c.amount)throw new Error('Запас изменился. Перепроверь количество.');used.push({lot:clone(lot),amount:c.amount});lot.amount=round(lot.amount-c.amount);}return used;}
function restore(next,consumed){for(const c of consumed||[]){const lot=next.stock.find(l=>l.id===c.lot.id);if(lot)lot.amount=round(lot.amount+c.amount);else next.stock.push({...c.lot,amount:c.amount});}}
export function finishCooking(state,id){const next=clone(state),entry=next.menu.find(e=>e.id===id);if(!entry||entry.cooked)throw new Error('Блюдо уже отмечено готовым.');const a=allocate(next).entries.find(e=>e.entryId===id);entry.consumed=consume(next,a.allocations);entry.cooked=true;entry.cookedAt=new Date().toISOString();return next;}
export function undoCooking(state,id){const next=clone(state),entry=next.menu.find(e=>e.id===id);if(!entry?.cooked)return next;restore(next,entry.consumed);entry.cooked=false;delete entry.consumed;delete entry.cookedAt;return next;}
export function finishProduction(state,id,actualAmount,date){const next=clone(state),p=next.prepPlans.find(x=>x.id===id);if(!p||p.cooked)throw new Error('Заготовка уже отмечена готовой.');if(!Number.isFinite(actualAmount)||actualAmount<=0)throw new Error('Укажи фактический выход заготовки.');const a=allocate(next).productions.find(x=>x.planId===id);p.consumed=consume(next,a.allocations);p.cooked=true;p.producedLotId=uid();p.producedAmount=actualAmount;next.stock.push({id:p.producedLotId,prepId:p.prepId,amount:actualAmount,date,note:'',productionId:id});return next;}
export function undoProduction(state,id){const next=clone(state),p=next.prepPlans.find(x=>x.id===id);if(!p?.cooked)return next;const lot=next.stock.find(l=>l.id===p.producedLotId);if(!lot||Math.abs(lot.amount-p.producedAmount)>.0001)throw new Error('Часть этой партии уже использована или изменена. Сначала верни использованный запас.');next.stock=next.stock.filter(l=>l.id!==p.producedLotId);restore(next,p.consumed);p.cooked=false;delete p.consumed;delete p.producedLotId;delete p.producedAmount;return next;}
export function generateMenu(state,options={},random=Math.random){
 const kept=state.menu.filter(e=>e.pinned||e.cooked||e.meal==='extra');const picked=[...kept],shortfalls={};
 const base=state.recipes.filter(r=>(!options.maxTime||(r.time!=null&&r.time<=options.maxTime))&&(!options.exclude?.some(x=>r.ingredients.some(i=>norm(i.name).includes(norm(x))))));
 for(const [meal] of meals.slice(0,3)){
  const counts={};for(const e of picked.filter(e=>e.meal===meal))counts[e.recipeId]=(counts[e.recipeId]||0)+1;
  while(picked.filter(e=>e.meal===meal).length<state.days){
   let candidates=base.filter(r=>allowedMeals(r).includes(meal));
   const free=remainingState(state,picked,state.prepPlans);
   if(options.freezer)candidates=candidates.filter(r=>availability(free,r).has);
   if(!candidates.length)break;
   // Exhaust alternatives before repeating; prefer desired ingredients among equally used recipes.
   const least=Math.min(...candidates.map(r=>counts[r.id]||0));candidates=candidates.filter(r=>(counts[r.id]||0)===least);
   const ranked=candidates.map(r=>({r,score:random()+(options.prefer?.some(x=>r.ingredients.some(i=>norm(i.name).includes(norm(x))))?2:0)})).sort((a,b)=>b.score-a.score);
   const r=ranked[0].r,e=newEntry(r,meal,options.servings||r.servings);
   if(options.freezer){const a=availability(free,r);if(a.list.some(l=>l.whole))e.wholeMode='stock';else for(const l of a.list)e.prepModes[l.prepId]='stock';}
   picked.push(e);counts[r.id]=(counts[r.id]||0)+1;
  }
  shortfalls[meal]=Math.max(0,state.days-picked.filter(e=>e.meal===meal).length);
 }
 return {menu:picked,shortfalls};
}

export function migrateState(old){
 if(old?.schemaVersion===2)return clone(old);
 if(old?.schemaVersion!==1||!Array.isArray(old.recipes)||!Array.isArray(old.stock)||!Array.isArray(old.prepTypes)||!Array.isArray(old.menu))throw new Error('Неподдерживаемая версия данных.');
 const next=initialState();next.days=Number.isInteger(old.target)?Math.min(30,Math.max(1,old.target)):7;
 for(const r of next.recipes){const prev=old.recipes.find(p=>p.id===r.id);if(prev?.photo)r.photo=prev.photo;}
 const mapId=id=>id==='pumpkin-frozen'?'pumpkin-soup-frozen':id;
 const adaptLot=lot=>{const s={...clone(lot),prepId:mapId(lot.prepId)};if(s.prepId==='meat-sauce')s.amount=round(s.amount/150);delete s.demo;return s;};
 const preserved=old.stock.filter(l=>!l.demo).map(adaptLot);
 for(const p of old.prepTypes){const id=mapId(p.id);if(!next.prepTypes.some(t=>t.id===id))next.prepTypes.push({...p,id,yield:1,ingredients:[],steps:[],sourceRecipeId:null});}
 next.stock=preserved;
 next.menu=old.menu.filter(e=>next.recipes.some(r=>r.id===e.recipeId)).map(e=>{const r=next.recipes.find(r=>r.id===e.recipeId);const entry={...newEntry(r,defaultMeal(r),e.servings),id:e.id,pinned:!!e.pinned,cooked:!!e.cooked};if(e.usePrep)for(const l of r.preparations)entry.prepModes[l.prepId]='stock';if(e.consumed)entry.consumed=e.consumed.map(c=>({lot:adaptLot(c.lot),amount:c.lot.prepId==='meat-sauce'?round(c.amount/150):c.amount}));if(e.cookedAt)entry.cookedAt=e.cookedAt;return entry;});
 next.history=Array.isArray(old.history)?clone(old.history):[];return next;
}
export function validateBackup(value){
 const x=clone(value);const fail=message=>{throw new Error(message||'Некорректная резервная копия.');};
 const str=(v,max=20000)=>typeof v==='string'&&v.length<=max;
 const id=v=>str(v,150)&&v.length>0;
 const num=(v,max=1e7)=>Number.isFinite(v)&&v>=0&&v<=max;
 const positive=(v,max=1e7)=>num(v,max)&&v>0;
 const arr=(v,max)=>Array.isArray(v)&&v.length<=max;
 const unique=a=>new Set(a.map(i=>i.id)).size===a.length;
 if(!x||x.schemaVersion!==2||!arr(x.recipes,5000)||!arr(x.prepTypes,5000)||!arr(x.stock,20000)||!arr(x.menu,300)||!arr(x.prepPlans,1000)||!Number.isInteger(x.days)||!positive(x.days,30))fail();
 if(![x.recipes,x.prepTypes,x.stock,x.menu,x.prepPlans].every(unique))fail('В копии есть повторяющиеся идентификаторы.');
 const prepIds=new Set(x.prepTypes.map(p=>p.id));
 function ingredients(a){if(!arr(a,300)||!unique(a))fail();for(const i of a){if(!id(i.id)||!str(i.name,200)||!i.name.trim()||!units.includes(i.unit)||!str(i.group,80)||!str(i.section||'',200)||!str(i.note||'')||typeof i.optional!=='boolean')fail();if(i.amount!==null&&!positive(i.amount))fail();if(i.amountMax!=null&&(!positive(i.amountMax)||i.amount==null||i.amountMax<i.amount))fail();}}
 for(const r of x.recipes){
  if(!id(r.id)||!str(r.title,200)||!r.title.trim()||!categories.includes(r.category)||!str(r.emoji,16)||!positive(r.servings,1000)||(r.time!==null&&!positive(r.time,10000))||!str(r.notes||'')||!arr(r.steps,100)||!arr(r.preparations,30)||!str(r.videoUrl||'',3000)||safeVideoUrl(r.videoUrl)===null)fail();
  if(r.photo&&(!str(r.photo,5000000)||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.photo)))fail();
  ingredients(r.ingredients);if(!r.steps.every(s=>str(s)))fail();const covered=new Set(),linked=new Set();
  for(const l of r.preparations){if(!prepIds.has(l.prepId)||!positive(l.amount)||!['embedded','replace'].includes(l.strategy)||typeof l.waterAllowed!=='boolean'||!arr(l.covers,300)||!l.covers.length||linked.has(l.prepId))fail();linked.add(l.prepId);if(l.amountMax!=null&&(!positive(l.amountMax)||l.amountMax<l.amount))fail();for(const c of l.covers){if(!r.ingredients.some(i=>i.id===c)||covered.has(c))fail();covered.add(c);}}
  if(r.freezePrepId!=null&&!prepIds.has(r.freezePrepId))fail();
 }
 for(const p of x.prepTypes){if(!id(p.id)||!str(p.title,200)||!p.title.trim()||!units.includes(p.unit)||['по вкусу','по необходимости'].includes(p.unit)||!str(p.emoji,16)||!str(p.note||'')||!positive(p.yield)||!arr(p.steps,100)||!p.steps.every(s=>str(s)))fail();ingredients(p.ingredients);if(p.sourceRecipeId!=null&&!x.recipes.some(r=>r.id===p.sourceRecipeId))fail();}
 // Replacement components must be a simple preparation, avoiding recursive expansion.
 for(const r of x.recipes)for(const l of r.preparations)if(l.strategy==='replace'&&x.prepTypes.find(p=>p.id===l.prepId).sourceRecipeId)fail();
 const validLot=l=>l&&id(l.id)&&prepIds.has(l.prepId)&&num(l.amount)&&str(l.date,10)&&/^\d{4}-\d{2}-\d{2}$/.test(l.date)&&Number.isFinite(Date.parse(l.date+'T12:00:00'))&&str(l.note||'');
 const validConsumed=c=>arr(c,1000)&&c.every(i=>validLot(i.lot)&&positive(i.amount));
 const validModes=m=>m&&typeof m==='object'&&!Array.isArray(m)&&Object.entries(m).every(([k,v])=>prepIds.has(k)&&['fresh','stock','water'].includes(v));
 for(const l of x.stock)if(!validLot(l))fail();
 for(const e of x.menu){const r=x.recipes.find(r=>r.id===e.recipeId);if(!id(e.id)||!r||!allowedMeals(r).includes(e.meal)||!positive(e.servings,1000)||typeof e.pinned!=='boolean'||typeof e.cooked!=='boolean'||!['fresh','stock'].includes(e.wholeMode)||!validModes(e.prepModes)||(e.consumed&&!validConsumed(e.consumed)))fail();}
 for(const p of x.prepPlans){if(!id(p.id)||!prepIds.has(p.prepId)||!positive(p.amount)||typeof p.cooked!=='boolean'||!validModes(p.prepModes)||(p.consumed&&!validConsumed(p.consumed)))fail();if(p.cooked&&(!id(p.producedLotId)||!positive(p.producedAmount)))fail();}
 if(!x.shoppingStatus||typeof x.shoppingStatus!=='object'||Array.isArray(x.shoppingStatus))fail();for(const [k,v]of Object.entries(x.shoppingStatus))if(!str(k,500)||!v||typeof v.bought!=='boolean'||typeof v.home!=='boolean'||!str(v.signature,1000))fail();
 if(!arr(x.history,100)||!x.history.every(h=>str(h.date,80)&&arr(h.dishes,300)&&h.dishes.every(s=>str(s,200))))fail();
 return x;
}
