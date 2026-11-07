/* Local seven-segment OCR. Images never leave the device. Output is a draft. */
window.ClinicalOCR = (() => {
  'use strict';
  const base=new URL('./ocr-vendor/',document.currentScript.src),scriptURL=new URL('tesseract.min.js',base).href;
  const detectorURL=new URL('./bp-ocr-worker.js?v=20261107-20',document.currentScript.src).href;
  let library=null;
  function load(){if(window.Tesseract)return Promise.resolve();if(library)return library;library=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=scriptURL;s.onload=resolve;s.onerror=()=>{library=null;s.remove();reject(Error('No se pudo cargar el lector. Conecta a Internet y pulsa Actualizar.'));};document.head.append(s);});return library;}
  const unclear=()=>Error('No he podido leer las tres cifras con suficiente claridad. Haz otra foto de frente, con toda la pantalla y sin reflejos. También puedes introducirlas manualmente.');
  function gray(data){return Uint8Array.from({length:data.length/4},(_,i)=>Math.round(.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2]));}
  function otsu(a){const hist=new Uint32Array(256);let sum=0;for(const v of a){hist[v]++;sum+=v;}let part=0,n=0,best=0,t=0;for(let k=0;k<256;k++){n+=hist[k];if(!n)continue;const rest=a.length-n;if(!rest)break;part+=k*hist[k];const score=n*rest*(part/n-(sum-part)/rest)**2;if(score>best){best=score;t=k;}}return t;}
  function crop(canvas,row){const margin=3,x=Math.max(0,Math.floor(row.x0-margin)),y=Math.max(0,Math.floor(row.y0-margin)),w=Math.min(canvas.width-x,Math.ceil(row.x1-row.x0+margin*2)),h=Math.min(canvas.height-y,Math.ceil(row.y1-row.y0+margin*2));const c=document.createElement('canvas');c.width=w+40;c.height=h+40;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(canvas,x,y,w,h,20,20,w,h);const p=ctx.getImageData(20,20,w,h),g=gray(p.data),t=otsu(g);for(let k=0;k<g.length;k++)p.data[k*4]=p.data[k*4+1]=p.data[k*4+2]=g[k]<t?0:255;ctx.putImageData(p,20,20);return c;}
  async function read(data,{signal,onProgress=()=>{}}={}){
    let detector=null,worker=null,timer=null,stopped=false;
    const abortError=()=>Error('Lectura cancelada.');
    let rejectStop;const stop=new Promise((_,reject)=>{rejectStop=reject;});
    const abort=()=>{stopped=true;rejectStop(abortError());detector?.terminate();worker?.terminate();};
    if(signal?.aborted)throw abortError();signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{stopped=true;rejectStop(Error('La lectura está tardando demasiado. Prueba otra foto más cercana.'));detector?.terminate();worker?.terminate();},60000);
    const job=(async()=>{
      onProgress('Localizando las cifras en la foto…');
      const img=await createImageBitmap(data instanceof Blob?data:await (await fetch(data)).blob());const canvas=document.createElement('canvas'),scale=Math.min(1,1280/Math.max(img.width,img.height));canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);img.close();
      if(stopped)throw abortError();
      const pixels=gray(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data);
      const candidates=await new Promise((resolve,reject)=>{detector=new Worker(detectorURL);detector.onmessage=e=>e.data.error?reject(unclear()):resolve(e.data.rows);detector.onerror=()=>reject(Error('No se pudo iniciar el lector local. Pulsa Actualizar y vuelve a intentarlo.'));detector.postMessage({gray:pixels,width:canvas.width,height:canvas.height},[pixels.buffer]);});detector.terminate();detector=null;
      if(stopped)throw abortError();if(candidates.length<2||candidates.length>24)throw unclear();
      // Reject competing display regions rather than choosing a plausible set of values.
      const anchor=candidates[0].rows[0];if(candidates.some(c=>Math.abs(c.rows[0].y0-anchor.y0)>anchor.h*.3||Math.abs(c.rows[0].x1-anchor.x1)>anchor.h*.3))throw unclear();
      onProgress('Leyendo máxima, mínima y pulso en este dispositivo…');await load();if(stopped)throw abortError();
      worker=await Tesseract.createWorker('ssd_int',1,{workerPath:new URL('worker.min.js',base).href,corePath:new URL('tesseract-core-lstm.wasm.js',base).href,langPath:base.href,gzip:false,cacheMethod:'none'});
      if(stopped){worker.terminate();throw abortError();}await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'13'});
      const accepted=[];
      for(const c of candidates){const values=[];for(const row of c.rows){if(stopped)throw abortError();const {data:result}=await worker.recognize(crop(canvas,row));const text=result.text.trim();if(result.confidence<85||!/^\d{2,3}$/.test(text)||text.startsWith('0'))break;values.push(Number(text));}if(values.length===3&&values[0]>values[1])accepted.push(values);}
      if(accepted.length<2||accepted.some(v=>v.join()!==accepted[0].join()))throw unclear();
      return {sys:accepted[0][0],dia:accepted[0][1],pulse:accepted[0][2]};
    })();
    try{return await Promise.race([job,stop]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);stopped=true;detector?.terminate();worker?.terminate();}
  }
  return {read};
})();
