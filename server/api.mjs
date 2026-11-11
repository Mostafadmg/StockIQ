/** StockIQ isolated ordering API. Only the reference catalogue is read remotely. */
import {searchDmd,getDmdPacks,getDmdPack,tariffPackId} from './dmd.mjs';
const sessions = new Map();
const MAX_SESSIONS = 160;
const MAX_BODY = 256 * 1024;
const MAX_RECORDS = 200;
const MAX_IMPORTED_PRODUCTS = 200;
const suppliers = ['Phoenix', 'Alliance', 'AAH', 'BNS', 'Sigma'];
const productRows = [
  ['Paracetamol 500mg tablets','32','1000011',0.74,4,6,'Phoenix','OTC',true,12],
  ['Amoxicillin 500mg capsules','21','1000029',1.48,2,4,'Alliance','Prescription',true,10],
  ['Amlodipine 5mg tablets','28','1000037',0.88,6,2,'AAH','Prescription',true,16],
  ['Atorvastatin 20mg tablets','28','1000045',0.93,3,5,'Phoenix','Prescription',true,14],
  ['Omeprazole 20mg capsules','28','1000052',1.12,8,3,'BNS','Prescription',true,18],
  ['Metformin 500mg tablets','56','1000060',1.34,5,7,'Alliance','Prescription',true,20],
  ['Ramipril 5mg capsules','28','1000078',0.89,2,3,'AAH','Prescription',false,8],
  ['Salbutamol 100micrograms/dose inhaler','200 doses','1000086',1.49,1,4,'Phoenix','Prescription',true,10],
  ['Cetirizine 10mg tablets','30','1000094',0.68,12,0,'Sigma','OTC',false,10],
  ['Ibuprofen 200mg tablets','24','1000102',0.82,3,2,'Phoenix','OTC',true,12],
  ['Lansoprazole 30mg capsules','28','1000110',1.04,0,4,'BNS','Prescription',false,8],
  ['Sertraline 50mg tablets','28','1000128',1.16,4,3,'AAH','Prescription',true,10],
  ['Bisoprolol 5mg tablets','28','1000136',0.92,7,1,'Alliance','Prescription',false,8],
  ['Levothyroxine 100microgram tablets','28','1000144',1.42,6,2,'AAH','Prescription',false,12],
  ['Losartan 50mg tablets','28','1000151',1.15,0,5,'BNS','Prescription',false,8],
  ['Folic acid 5mg tablets','28','1000169',0.86,8,0,'Sigma','Prescription',false,10],
  ['Gaviscon Advance suspension aniseed','500ml','1000177',4.36,2,1,'Phoenix','OTC',false,6],
  ['Cetraben emollient cream','500g','1000185',5.49,3,2,'Alliance','OTC',false,6],
  ['Clopidogrel 75mg tablets','28','1000193',1.21,5,2,'BNS','Prescription',false,10],
  ['Doxycycline 100mg capsules','8','1000201',0.89,0,3,'AAH','Prescription',false,6],
  ['Aspirin 75mg dispersible tablets','28','1000219',0.49,14,0,'Phoenix','Prescription',true,20],
  ['Colecalciferol 1,000unit capsules','30','1000227',1.83,6,1,'Sigma','Prescription',false,10],
  ['Loratadine 10mg tablets','30','1000235',0.79,11,0,'Phoenix','OTC',false,8],
  ['Chloramphenicol 0.5% eye drops','10ml','1000243',2.32,1,2,'Alliance','OTC',false,5]
];
export const PRODUCTS = productRows.map((r,i)=>({id:`p${String(i+1).padStart(3,'0')}`,name:r[0],pack:r[1],pip:r[2],price:r[3],stock:r[4],owed:r[5],supplier:r[6],category:r[7],fast:r[8],target:r[9]}));
const copy = value => JSON.parse(JSON.stringify(value));
const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
const total = items => money(items.reduce((n,p)=>n+p.price*p.quantity,0));
const iso = () => new Date().toISOString();
const dated = offset => new Date(Date.now() - offset*86400000).toISOString();
function line(products,index,quantity,received=0) { return {...copy(products[index]),quantity,received}; }
export function seedWorkspace() {
  const products = copy(PRODUCTS);
  const a = [line(products,0,6),line(products,3,5),line(products,7,4)];
  const b = [line(products,2,8,8),line(products,5,6,6)];
  const c = [line(products,11,5,2),line(products,14,3,0)];
  return {version:1,products,basket:[],orders:[
    {id:'TEST-1001',supplier:'Phoenix',items:a,total:total(a),status:'Awaiting',createdAt:dated(0),source:'auto',notes:'Sample test order · no supplier connection'},
    {id:'TEST-1002',supplier:'Alliance',items:b,total:total(b),status:'Received',createdAt:dated(2),receivedAt:dated(1),source:'manual',notes:'Completed sample delivery'},
    {id:'TEST-1003',supplier:'AAH',items:c,total:total(c),status:'Part received',createdAt:dated(1),source:'manual',notes:'Sample partial delivery'}
  ],drafts:[{id:'DRAFT-1001',name:'Weekly essentials',items:[line(products,0,6),line(products,9,3)],createdAt:dated(1)}],
  stockCounts:[],claims:[{id:'CLAIM-1001',orderId:'TEST-1003',reason:'Short delivery — sample claim',quantity:1,status:'Open',createdAt:dated(0)}],feedback:[],
  settings:{autoOrder:true,lowStockAlerts:true,smartOrdering:true,daysCover:7,preferredSupplier:'Phoenix',deliveryCutoff:'14:00',theme:'light',fontSize:'normal',deliveryTimes:{},fastTargets:{},surplusOffers:[]}};
}
function fail(message,status=400,code) { const err = new Error(message);err.status=status;err.code=code;throw err; }
function integer(value,min=1,max=999,label='Quantity') { if (!Number.isInteger(value)||value<min||value>max) fail(`${label} must be a whole number between ${min} and ${max}.`);return value; }
function string(value,max=500,label='Value') { if(typeof value!=='string'||!value.trim()||value.trim().length>max) fail(`${label} is required and must be at most ${max} characters.`);return value.trim(); }
function validDate(value){return typeof value==='string'&&value.length<50&&Number.isFinite(Date.parse(value));}
function product(w,id) { const p=w.products.find(p=>p.id===id);if(!p)fail('Product not found.',404);return p; }
function order(w,id) { const o=w.orders.find(o=>o.id===id);if(!o)fail('Order not found.',404);return o; }
function capacity(list,label){if(list.length>=MAX_RECORDS)fail(`${label} limit reached. Reset this test workspace to continue.`,409);}
function nextId(list,prefix,start=1000){return `${prefix}-${Math.max(start,...list.map(x=>Number(x.id?.split('-').pop())||start))+1}`;}
function catalogueIdentity(id,type) {
  if(type!=='TARIFF'||typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))fail('Choose a valid Drug Tariff pack from the reference search.');
  return {id,type};
}
function catalogueProduct(pack,supplier='Phoenix') {
  if(!pack||typeof pack!=='object')fail('Reference pack is unavailable.',502);
  const {id,type}=catalogueIdentity(pack.id,pack.type);
  const name=string(pack.name,500,'Product name'),size=string(String(pack.pack??''),120,'Pack size');
  const result={id:`catalogue-${type}-${id}`,catalogueId:id,catalogueType:type,name,pack:size,pip:'',price:1,priceSource:'simulation',stock:0,owed:0,supplier:suppliers.includes(supplier)?supplier:'Phoenix',category:'Prescription',fast:false,target:5,source:'NHS Drug Tariff'};
  if(typeof pack.referencePrice==='number'&&Number.isFinite(pack.referencePrice)&&pack.referencePrice>=0&&pack.referencePrice<=100000)result.referencePrice=money(pack.referencePrice);
  if(typeof pack.tariffMonth==='string'&&pack.tariffMonth.length<=40)result.tariffMonth=pack.tariffMonth;
  if(typeof pack.brand==='string'&&pack.brand.length<=200)result.brand=pack.brand;
  return result;
}
function checkSettings(data,defaults,products=PRODUCTS) {
  if(!data||typeof data!=='object'||Array.isArray(data))fail('Settings must be an object.');
  const result={...defaults};
  for(const [k,v] of Object.entries(data)) {
    if(!Object.hasOwn(defaults,k)) fail(`Unknown setting: ${k}.`);
    if(['autoOrder','lowStockAlerts','smartOrdering'].includes(k)&&typeof v!=='boolean')fail(`${k} must be true or false.`);
    if(k==='daysCover')integer(v,1,90,'Days cover');
    if(k==='preferredSupplier'&&!suppliers.includes(v))fail('Choose a known test supplier.');
    if(k==='deliveryCutoff'&&(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)))fail('Delivery cutoff must be HH:MM.');
    if(k==='theme'&&!['light','dark'].includes(v))fail('Theme must be light or dark.');
    if(k==='fontSize'&&!['normal','large'].includes(v))fail('Font size must be normal or large.');
    if(k==='deliveryTimes'){
      if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length>20)fail('Delivery times must be a bounded object.');
      for(const [name,time] of Object.entries(v)){
        if(!suppliers.includes(name)||!time||typeof time!=='object'||Array.isArray(time)||Object.keys(time).some(k=>!['cutoff','arrival'].includes(k)))fail('Invalid delivery schedule.');
        for(const field of ['cutoff','arrival'])if(typeof time[field]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time[field]))fail('Delivery schedule times must be HH:MM.');
      }
    }
    if(k==='fastTargets'){
      if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length>products.length)fail('Fast targets must be a bounded product map.');
      for(const [id,target] of Object.entries(v)){if(!products.some(p=>p.id===id))fail('Unknown fast target product.');integer(target,0,999,'Fast target');}
    }
    if(k==='surplusOffers'){
      if(!Array.isArray(v)||v.length>MAX_RECORDS)fail('Too many sample surplus offers.');
      for(const offer of v){
        if(!offer||typeof offer!=='object'||Array.isArray(offer)||Object.keys(offer).length>10)fail('Invalid sample surplus offer.');
        if(!products.some(p=>p.id===offer.productId))fail('Unknown surplus product.');integer(offer.quantity);
        if(JSON.stringify(offer).length>1000)fail('Sample surplus offer is too large.');
      }
    }
    result[k]=v;
  }
  return result;
}
async function restoreWorkspace(input) {
  if(!input||typeof input!=='object'||Array.isArray(input)||input.version!==1)fail('Invalid workspace snapshot.');
  const w=seedWorkspace();
  if(!Array.isArray(input.products)||input.products.length<PRODUCTS.length||input.products.length>PRODUCTS.length+MAX_IMPORTED_PRODUCTS)fail('Invalid snapshot products.');
  const seen=new Set();
  w.products=await Promise.all(input.products.map(async p=>{
    if(!p||seen.has(p.id))fail('Invalid snapshot products.');seen.add(p.id);
    let original=PRODUCTS.find(o=>o.id===p.id);
    if(!original){
      const identity=catalogueIdentity(p.catalogueId,p.catalogueType);
      if(p.id!==`catalogue-${identity.type}-${identity.id}`||p.source!=='NHS Drug Tariff')fail('Unknown snapshot product.');
      original=catalogueProduct({id:identity.id,type:identity.type,name:p.name,pack:p.pack,referencePrice:p.referencePrice,tariffMonth:p.tariffMonth,brand:p.brand},p.supplier);
      if(await tariffPackId(original.name,original.brand||'',original.pack)!==identity.id)fail('Snapshot reference product does not match its catalogue identity.');
    }
    return {...copy(original),stock:integer(p.stock,0,9999,'Stock'),owed:integer(p.owed,0,999,'Owed'),target:integer(p.target,0,999,'Target')};
  }));
  if(PRODUCTS.some(p=>!seen.has(p.id)))fail('Snapshot is missing sample products.');
  function items(input){
    if(!Array.isArray(input)||input.length>w.products.length)fail('Invalid snapshot items.');
    const ids=new Set();return input.map(i=>{if(!i||ids.has(i.id))fail('Duplicate snapshot item.');ids.add(i.id);const p=product(w,i.id);return {...copy(p),quantity:integer(i.quantity),received:integer(i.received??0,0,i.quantity,'Received')};});
  }
  function records(key){if(!Array.isArray(input[key])||input[key].length>MAX_RECORDS)fail(`Invalid snapshot ${key}.`);return input[key];}
  w.basket=items(input.basket);
  const orderIds=new Set();
  w.orders=records('orders').map(o=>{
    if(!o||!/^TEST-\d{4,9}$/.test(o.id)||orderIds.has(o.id))fail('Invalid snapshot order.');orderIds.add(o.id);
    const lines=items(o.items);if(!lines.length)fail('Snapshot orders need items.');
    const status=lines.every(i=>i.received===i.quantity)?'Received':lines.some(i=>i.received>0)?'Part received':'Awaiting';
    if(!validDate(o.createdAt))fail('Invalid snapshot order date.');
    return {id:o.id,items:lines,total:total(lines),status,supplier:suppliers.includes(o.supplier)?o.supplier:'Phoenix',createdAt:o.createdAt,source:o.source==='auto'?'auto':'manual',notes:typeof o.notes==='string'?o.notes.slice(0,500):'',...(validDate(o.receivedAt)?{receivedAt:o.receivedAt}:{})};
  });
  const draftIds=new Set();w.drafts=records('drafts').map(d=>{if(!d||!/^DRAFT-\d{4,9}$/.test(d.id)||draftIds.has(d.id)||!validDate(d.createdAt))fail('Invalid snapshot draft.');draftIds.add(d.id);return {id:d.id,name:string(d.name,80,'Draft name'),items:items(d.items),createdAt:d.createdAt};});
  const claimIds=new Set();w.claims=records('claims').map(c=>{if(!c||!/^CLAIM-\d{4,9}$/.test(c.id)||claimIds.has(c.id)||!orderIds.has(c.orderId)||!validDate(c.createdAt))fail('Invalid snapshot claim.');claimIds.add(c.id);return {id:c.id,orderId:c.orderId,reason:string(c.reason,500,'Claim reason'),quantity:integer(c.quantity),status:['Open','Resolved'].includes(c.status)?c.status:'Open',createdAt:c.createdAt};});
  w.feedback=records('feedback').map(f=>({id:string(f.id,40,'Feedback ID'),productId:product(w,f.productId).id,message:string(f.message,500,'Feedback'),createdAt:validDate(f.createdAt)?f.createdAt:iso()}));
  const stockCounts=input.stockCounts??[];if(!Array.isArray(stockCounts)||stockCounts.length>MAX_RECORDS)fail('Invalid snapshot stock counts.');
  w.stockCounts=stockCounts.map(c=>{if(!c||!validDate(c.createdAt))fail('Invalid stock count.');return {productId:product(w,c.productId).id,quantity:integer(c.quantity,0,9999,'Stock'),previous:integer(c.previous,0,9999,'Previous stock'),createdAt:c.createdAt};});
  w.settings=checkSettings(input.settings,w.settings,w.products);return w;
}
function reply(data,status=200,w){return Response.json({data,...(w?{workspace:copy(w)}:{}),production:false},{status,headers:{'cache-control':'no-store','x-stockiq-sandbox':'true','x-production':'false'}});}
async function body(request){
  const text=await request.text();if(text.length>MAX_BODY)fail('Request is too large.',413);
  if(!text)return {};
  try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))fail('Request body must be a JSON object.');return value;}catch(e){if(e.status)throw e;fail('Request body must be valid JSON.');}
}
function analytics(w){
  const orders=w.orders; const spend=total(orders.map(o=>({price:o.total,quantity:1})));
  const bySupplier=suppliers.map(name=>({name,total:money(orders.filter(o=>o.supplier===name).reduce((n,o)=>n+o.total,0)),orders:orders.filter(o=>o.supplier===name).length}));
  return {totalSpend:spend,totalOrders:orders.length,awaiting:orders.filter(o=>o.status!=='Received').length,received:orders.filter(o=>o.status==='Received').length,lowStock:w.products.filter(p=>p.stock<p.target).length,basketTotal:total(w.basket),savings:money(spend*.12),bySupplier,trend:[{day:'Mon',value:24.18},{day:'Tue',value:36.42},{day:'Wed',value:28.7},{day:'Thu',value:49.5},{day:'Fri',value:33.6},{day:'Sat',value:18.2},{day:'Sun',value:spend}],topProducts:w.products.filter(p=>p.fast).slice(0,5)};
}
/** All writes target the caller's isolated, synthetic workspace. */
export async function handleApi(request,env={}) {
  const url=new URL(request.url);const path=url.pathname.replace(/\/$/,'');const method=request.method.toUpperCase();
  if(!path.startsWith('/api/'))return null;
  try{
    if(path==='/api/health'&&method==='GET')return reply({status:'ok',mode:'sandbox',version:'1.0.0',supplierConnections:0});
    if(path==='/api/workspaces'&&method==='POST'){
      const data=await body(request);const id=string(data.id,80,'Workspace ID');if(!/^[\w-]{8,80}$/.test(id))fail('Workspace ID must contain 8–80 letters, numbers, underscores or hyphens.');
      const w=data.workspace?await restoreWorkspace(data.workspace):sessions.has(id)?sessions.get(id):seedWorkspace();
      if(!sessions.has(id)&&sessions.size>=MAX_SESSIONS)sessions.delete(sessions.keys().next().value);
      sessions.set(id,w);return reply({id},201,w);
    }
    const id=request.headers.get('x-workspace-id');const w=id&&sessions.get(id);
    if(!w)fail('Test workspace is not initialized. Restore or create it with POST /api/workspaces.',409,'SESSION_EXPIRED');
    if(path==='/api/dmd/search'&&method==='GET'){
      const query=(url.searchParams.get('q')||'').trim();if(query.length>200)fail('Search must be at most 200 characters.');
      return reply(query.length<2?{matches:[],source:'NHS Drug Tariff'}:await searchDmd(query,env),200,w);
    }
    if(path==='/api/dmd/packs'&&method==='GET'){
      const reference=url.searchParams.get('id'),type=url.searchParams.get('type');catalogueIdentity(reference,type);
      const hint=(url.searchParams.get('query')||'').trim();if(hint.length>200)fail('Search hint must be at most 200 characters.');
      return reply(await getDmdPacks(reference,type,env,hint),200,w);
    }
    if(path==='/api/catalogue/import'&&method==='POST'){
      const data=await body(request);const identity=catalogueIdentity(data.id,data.type),key=`catalogue-${identity.type}-${identity.id}`;
      if(data.query!=null&&(typeof data.query!=='string'||data.query.length>200))fail('Search hint must be at most 200 characters.');
      const existing=w.products.find(p=>p.id===key);if(existing)return reply(existing,200,w);
      if(w.products.length>=PRODUCTS.length+MAX_IMPORTED_PRODUCTS)fail('Reference product limit reached. Reset this test workspace to continue.',409);
      const pack=await getDmdPack(identity.id,identity.type,env,data.query?.trim());
      if(pack?.id!==identity.id||pack?.type!==identity.type)fail('Reference lookup returned a different product.',502);
      const p=catalogueProduct(pack,w.settings.preferredSupplier);w.products.push(p);return reply(p,201,w);
    }
    if(path==='/api/workspace'&&method==='GET')return reply(w,200,w);
    if(path==='/api/reset'&&method==='POST'){const reset=seedWorkspace();sessions.set(id,reset);return reply({reset:true},200,reset);}
    if(path==='/api/products'&&method==='GET'){
      const q=(url.searchParams.get('q')||'').toLowerCase();const category=url.searchParams.get('category');const fast=url.searchParams.get('fast');
      return reply(w.products.filter(p=>(!q||`${p.name} ${p.pip}`.toLowerCase().includes(q))&&(!category||p.category.toLowerCase()===category.toLowerCase())&&(fast!=='true'||p.fast)),200,w);
    }
    if(path==='/api/pending'&&method==='GET')return reply(w.products.filter(p=>p.stock<p.target||p.owed>0).map(p=>({...p,suggested:Math.max(1,p.target-p.stock,p.owed)})),200,w);
    if(path==='/api/basket'&&method==='GET')return reply({items:w.basket,total:total(w.basket),count:w.basket.reduce((n,i)=>n+i.quantity,0)},200,w);
    if(path==='/api/basket'&&method==='POST'){
      const data=await body(request);const p=product(w,data.productId);const quantity=integer(data.quantity);const current=w.basket.find(i=>i.id===p.id);
      const next=(current?.quantity||0)+quantity;integer(next);
      if(current)current.quantity=next;else w.basket.push({...copy(p),quantity,received:0});
      return reply({items:w.basket,total:total(w.basket),count:w.basket.reduce((n,i)=>n+i.quantity,0)},201,w);
    }
    const basketMatch=path.match(/^\/api\/basket\/([^/]+)$/);
    if(basketMatch&&['PATCH','DELETE'].includes(method)){
      const i=w.basket.find(i=>i.id===basketMatch[1]);if(!i)fail('Basket item not found.',404);
      if(method==='DELETE')w.basket=w.basket.filter(x=>x.id!==i.id);else i.quantity=integer((await body(request)).quantity);
      return reply({items:w.basket,total:total(w.basket),count:w.basket.reduce((n,i)=>n+i.quantity,0)},200,w);
    }
    if(path==='/api/orders'&&method==='GET')return reply(w.orders.filter(o=>!url.searchParams.get('status')||o.status===url.searchParams.get('status')),200,w);
    if(path==='/api/orders'&&method==='POST'){
      const data=await body(request);if(!w.basket.length)fail('Add at least one product to your test basket before placing an order.');capacity(w.orders,'Order');
      if(data.supplier&&!suppliers.includes(data.supplier))fail('Choose a known test supplier.');
      if(data.notes!=null&&(typeof data.notes!=='string'||data.notes.length>500))fail('Notes must be at most 500 characters.');
      const o={id:nextId(w.orders,'TEST'),supplier:data.supplier||w.settings.preferredSupplier,items:copy(w.basket).map(i=>({...i,received:0})),total:total(w.basket),status:'Awaiting',createdAt:iso(),source:data.source==='auto'?'auto':'manual',notes:data.notes?.trim()||''};
      w.orders.unshift(o);w.basket=[];return reply(o,201,w);
    }
    const receiveMatch=path.match(/^\/api\/orders\/([^/]+)\/receive$/);
    if(receiveMatch&&method==='POST'){
      const o=order(w,receiveMatch[1]);if(o.status==='Received')fail('This test order has already been received.',409);
      const data=await body(request);const lines=data.items===undefined?o.items.filter(i=>i.received<i.quantity).map(i=>({productId:i.id,quantity:i.quantity-i.received})):data.items;
      if(!Array.isArray(lines)||!lines.length||lines.length>o.items.length)fail('Provide at least one receipt item.');
      const seen=new Set();const validated=lines.map(l=>{
        if(!l||seen.has(l.productId))fail('Receipt items must be unique.');seen.add(l.productId);
        const item=o.items.find(i=>i.id===l.productId);if(!item)fail('Receipt product is not on this order.');
        integer(l.quantity,1,item.quantity-item.received,'Received quantity');const p=product(w,item.id);integer(p.stock+l.quantity,0,9999,'Stock');return {item,p,quantity:l.quantity};
      });
      for(const {item,p,quantity} of validated){item.received+=quantity;p.stock+=quantity;p.owed=Math.max(0,p.owed-quantity);}
      o.status=o.items.every(i=>i.received===i.quantity)?'Received':'Part received';if(o.status==='Received')o.receivedAt=iso();return reply(o,200,w);
    }
    const claimMatch=path.match(/^\/api\/orders\/([^/]+)\/claim$/);
    if(claimMatch&&method==='POST'){
      const o=order(w,claimMatch[1]);const data=await body(request);capacity(w.claims,'Claim');const reason=string(data.reason,500,'Claim reason');const quantity=integer(data.quantity??1,1,o.items.reduce((n,i)=>n+i.quantity,0),'Claim quantity');
      const c={id:nextId(w.claims,'CLAIM'),orderId:o.id,reason,quantity,status:'Open',createdAt:iso()};w.claims.unshift(c);return reply(c,201,w);
    }
    if(path==='/api/drafts'&&method==='GET')return reply(w.drafts,200,w);
    if(path==='/api/drafts'&&method==='POST'){
      const data=await body(request);const name=string(data.name,80,'Draft name');if(!w.basket.length)fail('Add products to your basket before saving a draft.');capacity(w.drafts,'Draft');const d={id:nextId(w.drafts,'DRAFT'),name,items:copy(w.basket),createdAt:iso()};w.drafts.unshift(d);return reply(d,201,w);
    }
    const draftMatch=path.match(/^\/api\/drafts\/([^/]+)(\/restore)?$/);
    if(draftMatch&&['POST','DELETE'].includes(method)){
      const d=w.drafts.find(d=>d.id===draftMatch[1]);if(!d)fail('Draft not found.',404);
      if(method==='POST'&&draftMatch[2])w.basket=copy(d.items).map(i=>({...copy(product(w,i.id)),quantity:i.quantity,received:0}));
      else if(method==='DELETE'&&!draftMatch[2])w.drafts=w.drafts.filter(x=>x.id!==d.id);else fail('Endpoint not found.',404);
      return reply(method==='DELETE'?{deleted:true}:d,200,w);
    }
    if(path==='/api/claims'&&method==='GET')return reply(w.claims,200,w);
    const resolveMatch=path.match(/^\/api\/claims\/([^/]+)\/resolve$/);
    if(resolveMatch&&method==='POST'){
      const c=w.claims.find(c=>c.id===resolveMatch[1]);if(!c)fail('Claim not found.',404);c.status='Resolved';return reply(c,200,w);
    }
    if(path==='/api/feedback'&&method==='GET')return reply(w.feedback,200,w);
    if(path==='/api/feedback'&&method==='POST'){
      const data=await body(request);const p=product(w,data.productId);const message=string(data.message,500,'Feedback');capacity(w.feedback,'Feedback');const f={id:nextId(w.feedback,'FEEDBACK'),productId:p.id,message,createdAt:iso()};w.feedback.unshift(f);return reply(f,201,w);
    }
    const stockMatch=path.match(/^\/api\/stock\/([^/]+)$/);
    if(stockMatch&&method==='POST'){const p=product(w,stockMatch[1]);const quantity=integer((await body(request)).quantity,0,9999,'Stock');capacity(w.stockCounts,'Stock count');w.stockCounts.unshift({productId:p.id,quantity,previous:p.stock,createdAt:iso()});p.stock=quantity;return reply(p,200,w);}
    if(path==='/api/analytics'&&method==='GET')return reply(analytics(w),200,w);
    if(path==='/api/settings'&&method==='GET')return reply(w.settings,200,w);
    if(path==='/api/settings'&&method==='PATCH'){const next=checkSettings(await body(request),w.settings,w.products);w.settings=next;return reply(next,200,w);}
    if(path==='/api/notifications'&&method==='GET')return reply([
      {id:'n1',type:'delivery',title:'Deliveries ready to receive',message:`${w.orders.filter(o=>o.status!=='Received').length} test orders are awaiting stock receipt.`,route:'goods-in'},
      {id:'n2',type:'stock',title:'Low stock review',message:`${w.products.filter(p=>p.stock<p.target).length} sample products are below target stock.`,route:'needs-attention'},
      {id:'n3',type:'sandbox',title:'Test workspace active',message:'Sample data only. Supplier connections are disabled.',route:'api'}
    ],200,w);
    if(path==='/api/ordering/counts'&&method==='GET')return reply({pending:w.products.filter(p=>p.stock<p.target).length,basket:w.basket.length,awaiting:w.orders.filter(o=>o.status!=='Received').length},200,w);
    if(path==='/api/auth/me'&&method==='GET')return reply({name:'Demo Pharmacist',branch:'St Mellons Pharmacy',role:'Test workspace user'},200,w);
    fail('Endpoint not found.',404);
  }catch(error){return Response.json({error:error.status?error.message:'Test API encountered an unexpected error.',...(error.code?{code:error.code}:{}),production:false},{status:error.status||500,headers:{'cache-control':'no-store','x-stockiq-sandbox':'true','x-production':'false'}});}
}
