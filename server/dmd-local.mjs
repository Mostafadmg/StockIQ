/** NHS TRUD dm+d snapshot: compressed shards, bounded in-memory decoding. */
import localCatalogue from '../data/dmd-catalogue.json' with {type:'json'};
const decodedDmdShards=new Map();
const dmdNormalise=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function localDmdError(message,status=404,code='DMD_PACK_NOT_FOUND'){const e=new Error(message);e.status=status;e.code=code;return e;}
function localDmdRow(row){const out={};for(let i=0;i<localCatalogue.columns.length;i++)if(row[i]!==null&&row[i]!==undefined&&row[i]!=='')out[localCatalogue.columns[i]]=row[i];out.id=String(out.id);out.source='NHS dm+d';out.releaseDate=localCatalogue.releaseDate;return out;}
async function dmdShard(key){
  if(decodedDmdShards.has(key)){const rows=decodedDmdShards.get(key);decodedDmdShards.delete(key);decodedDmdShards.set(key,rows);return rows;}
  const raw=localCatalogue.shards[key];if(!raw)return [];
  const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
  const text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const rows=JSON.parse(text);decodedDmdShards.set(key,rows);while(decodedDmdShards.size>2)decodedDmdShards.delete(decodedDmdShards.keys().next().value);return rows;
}
export function dmdCatalogueStatus(){return {source:'NHS dm+d',releaseDate:localCatalogue.releaseDate,counts:localCatalogue.counts,loaded:true,realSupplierStock:false};}
export async function getLocalDmdPack(id,type,env={}){
  if(typeof id!=='string'||!/^[1-9][0-9]{5,17}$/.test(id)||!['AMPP','VMPP'].includes(type))throw localDmdError('Choose a valid dm+d pack identifier.',400,'INVALID_DMD_PACK');
  if(Array.isArray(env.DMD_DATA)){const row=env.DMD_DATA.find(row=>row.id===id&&row.type===type);if(row)return {...structuredClone(row),source:'NHS dm+d'};throw localDmdError('This dm+d pack is not in the current catalogue.');}
  const key=localCatalogue.idIndex[type+':'+id];if(!key)throw localDmdError('This dm+d pack is not in the current catalogue.');
  const idPosition=localCatalogue.columns.indexOf('id'),typePosition=localCatalogue.columns.indexOf('type');
  const row=(await dmdShard(key)).find(row=>row[idPosition]===id&&row[typePosition]===type);if(!row)throw localDmdError('This dm+d pack is unavailable.');return localDmdRow(row);
}
/** Exact same-VMPP alternatives; a name prefix narrows shards, never selects a pack. */
export async function getLocalDmdBrands(id,type,env={}){
  const selected=await getLocalDmdPack(id,type,env),limit=60,seen=new Set(),packs=[];let total=0;
  const add=pack=>{const key=pack.type+':'+pack.id;if(seen.has(key))return;seen.add(key);total++;if(packs.length<limit)packs.push(pack);};
  const result=()=>({packs,total,truncated:total>packs.length,source:'NHS dm+d',releaseDate:selected.releaseDate||env.DMD_DATA?.[0]?.releaseDate||localCatalogue.releaseDate,selectionPolicy:'same-vmpp'});
  add(selected);
  const familyId=type==='VMPP'?selected.id:selected.genericId;
  if(typeof familyId!=='string'||!/^[1-9][0-9]{5,17}$/.test(familyId))return result();
  let family=type==='VMPP'?selected:null;
  if(!family){try{family=await getLocalDmdPack(familyId,'VMPP',env);}catch(error){if(error.status!==404)throw error;}}
  if(family)add(family);
  if(Array.isArray(env.DMD_DATA)){
    for(const row of env.DMD_DATA)if(row.type==='AMPP'&&row.genericId===familyId)add({...structuredClone(row),id:String(row.id),source:'NHS dm+d'});
  }else{
    // Every real AMPP indexes its canonical generic medicine name. The rarest
    // prefix therefore contains all possible family shards without a full scan.
    const canonical=dmdNormalise(family?.genericName||selected.genericName),tokens=canonical.split(/\s+/).filter(token=>token.length>=2);
    const candidates=tokens.map(token=>localCatalogue.prefixIndex[token.slice(0,Math.min(4,token.length))]||localCatalogue.prefixIndex[token.slice(0,2)]||[]).sort((a,b)=>a.length-b.length);
    const t=localCatalogue.columns.indexOf('type'),g=localCatalogue.columns.indexOf('genericId');
    for(const key of candidates[0]||[])for(const row of await dmdShard(key))if(row[t]==='AMPP'&&row[g]===familyId)add(localDmdRow(row));
  }
  // Keep the chosen pack first; remaining generic/actual packs have stable names.
  packs.splice(1,packs.length-1,...packs.slice(1).sort((a,b)=>Number(b.type==='VMPP')-Number(a.type==='VMPP')||a.name.localeCompare(b.name)||a.id.localeCompare(b.id)));
  return result();
}
export async function searchLocalDmd(query,env={}){
  const term=dmdNormalise(query),tokens=term.split(/\s+/).filter(Boolean);if(!term||term.length<2)return {matches:[],...dmdCatalogueStatus()};
  if(Array.isArray(env.DMD_DATA)){return {matches:env.DMD_DATA.filter(row=>tokens.every(token=>dmdNormalise([row.name,row.genericName,row.brand,row.manufacturer].filter(Boolean).join(' ')).includes(token))).slice(0,25).map(row=>({...structuredClone(row),source:'NHS dm+d'})),source:'NHS dm+d',releaseDate:env.DMD_DATA[0]?.releaseDate||localCatalogue.releaseDate};}
  if(/^[1-9][0-9]{5,17}$/.test(term)){for(const type of ['AMPP','VMPP'])if(localCatalogue.idIndex[type+':'+term])return {matches:[await getLocalDmdPack(term,type,env)],...dmdCatalogueStatus()};}
  const candidates=tokens.filter(token=>token.length>=2).map(token=>localCatalogue.prefixIndex[token.slice(0,Math.min(4,token.length))]||localCatalogue.prefixIndex[token.slice(0,2)]||[]).sort((a,b)=>a.length-b.length);if(!candidates.length||!candidates[0].length)return {matches:[],...dmdCatalogueStatus()};
  const n=localCatalogue.columns.indexOf('name'),g=localCatalogue.columns.indexOf('genericName'),b=localCatalogue.columns.indexOf('brand'),m=localCatalogue.columns.indexOf('manufacturer');
  const direct=tokens[0]?.slice(0,2),keys=[...candidates[0]].sort((a,b)=>Number(b===direct)-Number(a===direct));const matches=[];for(const key of keys){for(const row of await dmdShard(key)){const searchable=dmdNormalise([row[n],row[g],row[b],row[m]].filter(Boolean).join(' '));if(tokens.every(token=>searchable.includes(token))){const item=localDmdRow(row);const name=dmdNormalise(item.name);const rank=(name.startsWith(term)?0:name.startsWith(tokens[0])?1:2)+(item.type==='VMPP'?0:0.1);matches.push({item,rank});}}if(matches.length>=100)break;}
  matches.sort((a,b)=>a.rank-b.rank||a.item.name.localeCompare(b.item.name));return {matches:matches.slice(0,25).map(row=>row.item),...dmdCatalogueStatus()};
}
