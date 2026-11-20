export const uid=()=>globalThis.crypto.randomUUID();
export const clone=x=>structuredClone(x);
export const norm=s=>s.trim().toLocaleLowerCase('ru').replaceAll('ё','е').replace(/\s+/g,' ');
export const round=n=>Math.round((n+Number.EPSILON)*1000)/1000;
export const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(round(n));
export function quantity(amount,unit){if(unit==='по вкусу')return 'по вкусу';if(unit==='г'&&amount>=1000)return `${fmt(amount/1000)} кг`;if(unit==='мл'&&amount>=1000)return `${fmt(amount/1000)} л`;return `${fmt(amount)} ${unit}`;}
export function canonical(i){const mult=i.unit==='кг'||i.unit==='л'?1000:1;return {...i,amount:i.amount*mult,unit:i.unit==='кг'?'г':i.unit==='л'?'мл':i.unit};}
export const ingredientKey=i=>`${norm(i.name)}|${canonical(i).unit}`;
export function allocate(state,menu=state.menu){
 const lots=state.stock.map(x=>({...x,remaining:x.amount})).sort((a,b)=>a.date.localeCompare(b.date));
 const entries=[];const totals=new Map();
 for(const entry of menu){
  const recipe=state.recipes.find(x=>x.id===entry.recipeId);if(!recipe||entry.cooked)continue;
  const scale=entry.servings/recipe.servings;const allocations=[];const covered=new Map();
  if(entry.usePrep)for(const link of recipe.preparations){
   const needed=link.amount*scale;let remaining=needed;const consumes=[];
   for(const lot of lots){if(lot.prepId!==link.prepId||lot.remaining<=0||remaining<=0)continue;const amount=round(Math.min(lot.remaining,remaining));lot.remaining=round(lot.remaining-amount);remaining=round(remaining-amount);consumes.push({lotId:lot.id,amount});}
   const used=round(needed-remaining);allocations.push({prepId:link.prepId,needed,used,consumes});
   for(const name of link.covers)covered.set(norm(name),Math.max(covered.get(norm(name))||0,used/needed));
  }
  const ingredients=[];
  for(const original of recipe.ingredients){
   const i=canonical(original);const ratio=1-(covered.get(norm(i.name))||0);if(ratio<0.00001)continue;
   const amount=round(i.amount*scale*ratio);if(i.unit!=='по вкусу'&&amount<=0)continue;
   const value={...i,amount,recipeTitle:recipe.title};ingredients.push(value);
   if(norm(i.name)==='вода')continue;
   const key=ingredientKey(i);const prev=totals.get(key)||{...i,key,amount:0,recipes:[]};prev.amount=round(prev.amount+amount);if(!prev.recipes.includes(recipe.title))prev.recipes.push(recipe.title);totals.set(key,prev);
  }
  entries.push({entryId:entry.id,recipe,allocations,ingredients});
 }
 return {entries,shopping:[...totals.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru')),lots};
}
export function availability(state,recipe,servings=recipe.servings){
 const a=allocate(state,[{id:'preview',recipeId:recipe.id,servings,usePrep:true}]).entries[0];
 const list=a?.allocations.filter(x=>x.used>0)||[];
 return {list,has:list.length>0,complete:!!list.length&&a.allocations.every(x=>x.used>=x.needed),allocated:a};
}
export function finishCooking(state,entryId){
 const next=clone(state);const entry=next.menu.find(x=>x.id===entryId);if(!entry||entry.cooked)throw new Error('Блюдо уже приготовлено или удалено.');
 const allocation=allocate(next).entries.find(x=>x.entryId===entryId);
 entry.consumed=[];
 for(const a of allocation.allocations)for(const c of a.consumes){const lot=next.stock.find(x=>x.id===c.lotId);if(!lot||lot.amount<c.amount)throw new Error('Запас изменился. Проверь количество ещё раз.');entry.consumed.push({lot:clone(lot),amount:c.amount});lot.amount=round(lot.amount-c.amount);}
 entry.cooked=true;entry.cookedAt=new Date().toISOString();return next;
}
export function undoCooking(state,entryId){
 const next=clone(state);const entry=next.menu.find(x=>x.id===entryId);if(!entry?.cooked)return next;
 for(const c of entry.consumed||[]){const lot=next.stock.find(x=>x.id===c.lot.id);if(lot)lot.amount=round(lot.amount+c.amount);else next.stock.push({...c.lot,amount:c.amount});}
 entry.cooked=false;delete entry.consumed;delete entry.cookedAt;return next;
}
export function generateMenu(state,options={},random=Math.random){
 const kept=state.menu.filter(e=>e.pinned||e.cooked);const used=new Set(kept.map(e=>e.recipeId));let candidates=state.recipes.filter(r=>!used.has(r.id));
 if(options.category)candidates=candidates.filter(r=>r.category===options.category);
 if(options.maxTime)candidates=candidates.filter(r=>r.time<=options.maxTime);
 if(options.exclude?.length)candidates=candidates.filter(r=>!r.ingredients.some(i=>options.exclude.some(x=>norm(i.name).includes(norm(x)))));
 const target=state.target;const picked=[...kept];const counts={};kept.forEach(e=>{const c=state.recipes.find(r=>r.id===e.recipeId)?.category;counts[c]=(counts[c]||0)+1;});
 while(picked.length<target&&candidates.length){
  if(options.freezer){const remaining={...state,stock:allocate(state,picked).lots.map(l=>({...l,amount:l.remaining}))};candidates=candidates.filter(r=>availability(remaining,r).has);if(!candidates.length)break;}
  candidates.sort((a,b)=>a.id.localeCompare(b.id));
  const ranked=candidates.map(r=>({r,score:random()*3-(counts[r.category]||0)*1.4+(options.prefer?.some(x=>r.ingredients.some(i=>norm(i.name).includes(norm(x))))?5:0)})).sort((a,b)=>b.score-a.score);
  const r=ranked[0].r;picked.push({id:uid(),recipeId:r.id,servings:options.servings||r.servings,usePrep:true,pinned:false,cooked:false});counts[r.category]=(counts[r.category]||0)+1;candidates=candidates.filter(x=>x.id!==r.id);
 }
 return {menu:picked,shortfall:Math.max(0,target-picked.length)};
}
const units=['г','кг','мл','л','шт.','порц.','зуб.','ст. л.','ч. л.','по вкусу'];
export {units};
export function validateBackup(x){
 const fail=()=>{throw new Error('Файл не похож на полную копию «На неделю» или содержит некорректные данные.');};
 const str=(v,max=20000)=>typeof v==='string'&&v.length<=max;
 const id=v=>str(v,150)&&v.length>0;
 const num=(v,max=1e7)=>Number.isFinite(v)&&v>=0&&v<=max;
 const positive=(v,max=1e7)=>num(v,max)&&v>0;
 const array=(v,max)=>Array.isArray(v)&&v.length<=max;
 const unique=(a)=>new Set(a.map(z=>z.id)).size===a.length;
 if(!x||x.schemaVersion!==1||!array(x.recipes,5000)||!array(x.prepTypes,5000)||!array(x.stock,20000)||!array(x.menu,50)||!positive(x.target,30)||!Number.isInteger(x.target))fail();
 if(!unique(x.recipes)||!unique(x.prepTypes)||!unique(x.stock)||!unique(x.menu))fail();
 for(const p of x.prepTypes)if(!id(p.id)||!str(p.title,200)||!p.title.trim()||!units.includes(p.unit)||p.unit==='по вкусу'||!str(p.emoji,16)||!str(p.note||''))fail();
 const prepIds=new Set(x.prepTypes.map(p=>p.id));
 const validLot=s=>s&&id(s.id)&&prepIds.has(s.prepId)&&num(s.amount)&&str(s.date,10)&&/^\d{4}-\d{2}-\d{2}$/.test(s.date)&&str(s.note||'');
 for(const r of x.recipes){
  if(!id(r.id)||!str(r.title,200)||!r.title.trim()||!str(r.category,80)||!str(r.emoji,16)||!positive(r.servings,1000)||!positive(r.time,10000)||!str(r.notes||'')||!array(r.ingredients,200)||!array(r.steps,100)||!array(r.preparations,30))fail();
  if(r.photo&&(!str(r.photo,5000000)||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.photo)))fail();
  for(const i of r.ingredients)if(!str(i.name,200)||!i.name.trim()||!num(i.amount)||!units.includes(i.unit)||!str(i.group,80)||(i.unit!=='по вкусу'&&i.amount===0))fail();
  if(new Set(r.ingredients.map(ingredientKey)).size!==r.ingredients.length)fail();
  for(const s of r.steps)if(!str(s))fail();
  const covered=new Set();
  for(const p of r.preparations){if(!prepIds.has(p.prepId)||!positive(p.amount)||!array(p.covers,200)||p.covers.length===0)fail();for(const c of p.covers){if(!r.ingredients.some(i=>i.name===c)||covered.has(norm(c)))fail();covered.add(norm(c));}}
 }
 for(const s of x.stock)if(!validLot(s))fail();
 for(const e of x.menu){if(!id(e.id)||!x.recipes.some(r=>r.id===e.recipeId)||!positive(e.servings,1000)||typeof e.usePrep!=='boolean'||typeof e.cooked!=='boolean'||typeof e.pinned!=='boolean')fail();if(e.consumed){if(!array(e.consumed,1000))fail();for(const c of e.consumed)if(!validLot(c.lot)||!positive(c.amount))fail();}}
 if(!x.shoppingStatus||typeof x.shoppingStatus!=='object'||Array.isArray(x.shoppingStatus))fail();
 for(const [key,v] of Object.entries(x.shoppingStatus)){if(!str(key,500)||!v||typeof v.bought!=='boolean'||typeof v.home!=='boolean'||!num(v.amount))fail();}
 if(!array(x.history,100))fail();for(const h of x.history)if(!str(h.date,80)||!array(h.dishes,50)||!h.dishes.every(z=>str(z,200)))fail();
 return clone(x);
}
