let db;
const name='na-nedelyu';
export async function openStorage(){
 db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('library');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 return readStorage('state');
}
export function readStorage(key){return new Promise((resolve,reject)=>{const r=db.transaction('library').objectStore('library').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export function saveStorage(value,checkpoint){return new Promise((resolve,reject)=>{const tx=db.transaction('library','readwrite'),store=tx.objectStore('library');if(checkpoint)store.put(checkpoint,'previous');store.put(value,'state');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Сохранение прервано'));});}
