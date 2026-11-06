/* Patch only the approved clinical cells inside the original XLSX package. */
window.ClinicalExcel = (() => {
  const S='http://schemas.openxmlformats.org/spreadsheetml/2006/main', R='http://schemas.openxmlformats.org/officeDocument/2006/relationships', P='http://schemas.openxmlformats.org/package/2006/relationships';
  const parse=s=>{const d=new DOMParser().parseFromString(s,'application/xml');if(d.getElementsByTagName('parsererror').length)throw Error('XML del Excel no válido.');return d;};
  const xml=d=>new XMLSerializer().serializeToString(d);
  const nodes=(d,name)=>Array.from(d.getElementsByTagNameNS(S,name));
  const make=(d,n)=>d.createElementNS(S,n);
  function putCell(d,row,col,value){const ref=XLSX.utils.encode_col(col)+row.getAttribute('r');let c=nodes(row,'c').find(x=>x.getAttribute('r')===ref);if(!c){c=make(d,'c');c.setAttribute('r',ref);const next=nodes(row,'c').find(x=>XLSX.utils.decode_cell(x.getAttribute('r')).c>col);row.insertBefore(c,next||null);}while(c.firstChild)c.removeChild(c.firstChild);if(typeof value==='number'){c.removeAttribute('t');const v=make(d,'v');v.textContent=value;c.append(v);}else{c.setAttribute('t','inlineStr');const is=make(d,'is'),t=make(d,'t');t.setAttribute('xml:space','preserve');t.textContent=String(value??'');is.append(t);c.append(is);}return c;}
  function rowAt(d,n){const data=nodes(d,'sheetData')[0];let row=nodes(data,'row').find(x=>Number(x.getAttribute('r'))===n);if(!row){row=make(d,'row');row.setAttribute('r',n);const next=nodes(data,'row').find(x=>Number(x.getAttribute('r'))>n);data.insertBefore(row,next||null);}return row;}
  async function build(buffer){
    const zip=await JSZip.loadAsync(buffer);const wb=XLSX.read(buffer,{type:'array',cellDates:true});
    const wd=parse(await zip.file('xl/workbook.xml').async('string')),rels=parse(await zip.file('xl/_rels/workbook.xml.rels').async('string'));
    const pathFor=name=>{const sh=nodes(wd,'sheet').find(x=>x.getAttribute('name')===name);if(!sh)return null;const id=sh.getAttributeNS(R,'id'),rel=Array.from(rels.documentElement.children).find(x=>x.getAttribute('Id')===id);if(!rel)throw Error('Relación de hoja no válida.');const t=rel.getAttribute('Target');if(t.includes('..'))throw Error('Ruta de hoja no compatible.');return t.startsWith('/')?t.slice(1):'xl/'+t;};
    let p=pathFor('Medicación Actual');if(p){const d=parse(await zip.file(p).async('string')),rows=XLSX.utils.sheet_to_json(wb.Sheets['Medicación Actual'],{header:1,defval:''}),h=rows[1],ti=h.indexOf('¿Tomando?'),fi=h.indexOf('Fecha Fin');if(ti<0||fi<0)throw Error('Columnas de medicación incompletas.');for(let i=2;i<rows.length;i++){if(!rows[i][0])continue;const m=Object.fromEntries(h.map((k,j)=>[k,rows[i][j]??''])),e=medEstado(m),r=rowAt(d,i+1);putCell(d,r,ti,e.tomando?'Sí':'No');putCell(d,r,fi,e.fin);}zip.file(p,xml(d));}
    const readings=Clinical.records();p=pathFor('Tensión arterial');let pressure;
    if(p)pressure=parse(await zip.file(p).async('string'));else{
      let number=1;while(zip.file('xl/worksheets/sheet'+number+'.xml'))number++;p='xl/worksheets/sheet'+number+'.xml';pressure=parse('<worksheet xmlns="'+S+'"><sheetData/></worksheet>');
      let id='rIdClinical';while(Array.from(rels.documentElement.children).some(x=>x.getAttribute('Id')===id))id+='X';
      const rel=rels.createElementNS(P,'Relationship');rel.setAttribute('Id',id);rel.setAttribute('Type',R+'/worksheet');rel.setAttribute('Target','worksheets/sheet'+number+'.xml');rels.documentElement.append(rel);
      const sheet=make(wd,'sheet');sheet.setAttribute('name','Tensión arterial');sheet.setAttribute('sheetId',Math.max(...nodes(wd,'sheet').map(x=>Number(x.getAttribute('sheetId'))))+1);sheet.setAttributeNS(R,'r:id',id);nodes(wd,'sheets')[0].append(sheet);
      const ct=parse(await zip.file('[Content_Types].xml').async('string'));const o=ct.createElementNS(ct.documentElement.namespaceURI,'Override');o.setAttribute('PartName','/'+p);o.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');ct.documentElement.append(o);
      zip.file('xl/workbook.xml',xml(wd));zip.file('xl/_rels/workbook.xml.rels',xml(rels));zip.file('[Content_Types].xml',xml(ct));
    }
    const sd=nodes(pressure,'sheetData')[0];for(const r of nodes(sd,'row'))if(Number(r.getAttribute('r'))>=3)r.remove();
    putCell(pressure,rowAt(pressure,1),0,'REGISTRO DE TENSIÓN ARTERIAL');
    ['Fecha','Hora','Sistólica (mmHg)','Diastólica (mmHg)','Pulso (lpm)','Observaciones','Fuente','ID'].forEach((v,c)=>putCell(pressure,rowAt(pressure,2),c,v));
    readings.forEach((r,i)=>[r.date.split('-').reverse().join('/'),r.time,r.sys,r.dia,r.pulse,r.note,r.source,r.id].forEach((v,c)=>putCell(pressure,rowAt(pressure,i+3),c,v)));
    const dim=nodes(pressure,'dimension')[0];if(dim)dim.setAttribute('ref','A1:H'+Math.max(2,readings.length+2));zip.file(p,xml(pressure));
    const ip=pathFor('Instrucciones');if(ip){const d=parse(await zip.file(ip).async('string'));const cell=nodes(d,'c').find(c=>c.getAttribute('r')==='B10');if(cell){putCell(d,cell.parentNode,1,new Date().toLocaleDateString('es-ES'));zip.file(ip,xml(d));}}
    const out=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});const check=XLSX.read(out,{type:'array',cellDates:true});
    if(Clinical.fromWorkbook(check).length!==readings.length)throw Error('No se pudo validar la exportación de tensión.');
    return out;
  }
  async function download(){if(MED_IMPORT_BUSY){mostrarToast('Espera a que termine el guardado.');return;}MED_IMPORT_BUSY=true;closeMenu();try{const b=await Clinical.excelBytes();if(!b)throw Error('Carga primero tu Excel.');const out=await build(b);Clinical.download(out,'Historial Médico '+Clinical.dated()+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');mostrarToast('Excel preparado con las tomas y la medicación aprobadas. Guarda la descarga en «Historiales médicos» de Drive.');}catch(e){mostrarToast('No se pudo descargar el Excel: '+e.message);}finally{MED_IMPORT_BUSY=false;}}
  return {build,download};
})();
