/** Read-only adapter for the existing Mellons Drug Tariff edge function.
 * The upstream does not return dm+d/SNOMED ids. Internal TARIFF hashes identify
 * name/brand/pack combinations only. No supplier or reference-table writes.
 */
const catalogueRows=new Map(),queryCache=new Map();
const CACHE_TTL=120000,MAX_ROWS=1000,MAX_QUERIES=128;
function catalogueError(message,status=503,code='CATALOGUE_UNAVAILABLE'){const error=new Error(message);error.status=status;error.code=code;return error;}
function catalogueConfig(env={}){
  const raw=env.MELLONS_SUPABASE_URL,key=env.MELLONS_SUPABASE_PUBLISHABLE_KEY;
  if(!raw||!key)throw catalogueError('The Mellons medicine catalogue is not configured. Sample products are still available.',503,'CATALOGUE_NOT_CONFIGURED');
  let url;try{url=new URL(raw);}catch{throw catalogueError('The medicine catalogue configuration is invalid.');}
  if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.username||url.password||url.port||!['','/'].includes(url.pathname)||url.search||url.hash)throw catalogueError('The medicine catalogue configuration is invalid.');
  return {origin:url.origin,key:String(key)};
}
function catalogueHint(value){if(typeof value!=='string'||value.trim().length<2||value.trim().length>200)throw catalogueError('Enter 2–200 characters to search for a medicine.',400,'INVALID_CATALOGUE_QUERY');return value.trim();}
function boundedPut(map,key,value,max){if(map.has(key))map.delete(key);map.set(key,value);while(map.size>max)map.delete(map.keys().next().value);}
export async function tariffPackId(name,brand,pack){const input=JSON.stringify([name.trim(),brand?.trim()||'',pack.trim()]);const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);}
async function normalizeTariffRow(row){
  if(!row||typeof row.drug_name!=='string'||!row.drug_name.trim()||row.drug_name.length>500)return null;
  const name=row.drug_name.trim(),pack=String(row.pack_size??'').trim();if(!pack||pack.length>120)return null;
  const brand=typeof row.brand==='string'?row.brand.trim().slice(0,200):'';
  const referencePrice=Number.isFinite(Number(row.basic_price))&&row.basic_price!==null&&Number(row.basic_price)>=0&&Number(row.basic_price)<=100000000?Number(row.basic_price)/100:null;
  return {id:await tariffPackId(name,brand,pack),type:'TARIFF',name,pack,brand,referencePrice,tariffMonth:typeof row.tariff_month==='string'?row.tariff_month.slice(0,40):'',source:'NHS Drug Tariff'};
}
export async function searchDmd(query,env={}){
  const term=catalogueHint(query),config=catalogueConfig(env),cacheKey=config.origin+'|'+term.toLowerCase(),now=Date.now();
  const cached=queryCache.get(cacheKey);if(cached&&cached.expires>now)return structuredClone(cached.data);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  let response;
  try{
    const headers={'content-type':'application/json',apikey:config.key};
    if(!config.key.startsWith('sb_publishable_'))headers.authorization='Bearer '+config.key;
    response=await (env.DMD_FETCH||fetch)(config.origin+'/functions/v1/search-drug-tariff',{method:'POST',headers,body:JSON.stringify({query:term,autocomplete:true}),signal:controller.signal,redirect:'error'});
    if(!response.ok)throw catalogueError(response.status===401||response.status===403?'The Mellons catalogue rejected read access. Please check its published lookup credentials.':'The Mellons catalogue is unavailable. Try again shortly.');
    const text=await response.text();if(text.length>512000)throw catalogueError('The catalogue response was too large. Please narrow your search.');
    let data;try{data=JSON.parse(text);}catch{throw catalogueError('The catalogue returned an unreadable response.');}
    if(data.success!==true||!Array.isArray(data.results))throw catalogueError('The Mellons catalogue could not complete this search.');
    const matches=(await Promise.all(data.results.slice(0,100).map(normalizeTariffRow))).filter(Boolean);
    const unique=[...new Map(matches.map(row=>[row.id,row])).values()].slice(0,25);
    for(const row of unique)boundedPut(catalogueRows,config.origin+'|'+row.id,{pack:row,expires:now+CACHE_TTL},MAX_ROWS);
    const result={matches:unique,source:'NHS Drug Tariff',referenceOnly:true};
    boundedPut(queryCache,cacheKey,{data:result,expires:now+CACHE_TTL},MAX_QUERIES);return structuredClone(result);
  }catch(error){if(error.code&&error.status)throw error;throw catalogueError(controller.signal.aborted?'The catalogue search timed out. Try again.':'The medicine catalogue could not be reached. Try again shortly.');}
  finally{clearTimeout(timer);}
}
export async function getDmdPack(id,type,env={},queryHint){
  if(type!=='TARIFF'||typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw catalogueError('Choose a valid catalogue pack.',400,'INVALID_CATALOGUE_SELECTION');
  const config=catalogueConfig(env),key=config.origin+'|'+id,entry=catalogueRows.get(key);
  if(entry?.expires>Date.now())return structuredClone(entry.pack);
  if(queryHint){const result=await searchDmd(catalogueHint(queryHint),env);const row=result.matches.find(row=>row.id===id);if(row)return row;}
  throw catalogueError('This catalogue selection has expired. Search again and select its pack.',409,'CATALOGUE_SELECTION_EXPIRED');
}
export async function getDmdPacks(id,type,env={},queryHint){return {packs:[await getDmdPack(id,type,env,queryHint)],source:'NHS Drug Tariff',referenceOnly:true};}
