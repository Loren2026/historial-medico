(function(scope){
'use strict';
const DB='HistorialMedicoAvisos',STORE='binding';
function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('No se puede abrir el almacén de conexión.'));r.onblocked=()=>reject(Error('El almacén de conexión está ocupado.'));});}
async function read(key){const db=await open();try{return await new Promise((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}}
async function write(key,value){const db=await open();try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('No se pudo guardar la conexión.'));});}finally{db.close();}}
async function credential(token){if(!/^[\w-]{40,100}$/.test(token))throw Error('Credencial inválida.');await write('credential',{token,at:Date.now()});}
scope.BindingStore={read,write,credential};
})(globalThis);
