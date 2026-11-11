import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi,seedWorkspace} from '../server/api.mjs';
const referenceRow={drug_name:'Metformin 850mg tablets',pack_size:'56',basic_price:170,category:'M',brand:null,tariff_month:'2026-11',source:'NHSBSA Drug Tariff Part VIIIA'};
function client(options={}){
  const id=`catalogue-test-${crypto.randomUUID()}`,calls=[];
  const env={MELLONS_SUPABASE_URL:`https://reference-${crypto.randomUUID()}.supabase.co`,MELLONS_SUPABASE_PUBLISHABLE_KEY:'test-reference-key',DMD_FETCH:async(url,init)=>{
    calls.push({url:String(url),method:init?.method||'GET',body:init?.body});
    return Response.json({success:true,results:[referenceRow]});
  },...options};
  const request=async(method,path,data,overrideEnv=env)=>{
    const response=await handleApi(new Request(`https://stockiq.test${path}`,{method,headers:{'content-type':'application/json','x-workspace-id':id},...(data===undefined?{}:{body:JSON.stringify(data)})}),overrideEnv);
    return {status:response.status,...await response.json()};
  };
  return {id,calls,env,request,init:workspace=>request('POST','/api/workspaces',{id,...(workspace?{workspace}:{})})};
}
async function reference(c){
  const r=await c.request('GET','/api/dmd/search?q=metformin%20850mg');assert.equal(r.status,200);
  const match=r.data.matches.find(m=>m.name===referenceRow.drug_name);assert.ok(match);return match;
}
test('reference search ignores too-short queries and bounds excessively long input',async()=>{
  const c=client();await c.init();
  const short=await c.request('GET','/api/dmd/search?q=m');assert.equal(short.status,200);assert.deepEqual(short.data.matches,[]);assert.equal(c.calls.length,0);
  assert.equal((await c.request('GET',`/api/dmd/search?q=${'a'.repeat(201)}`)).status,400);assert.equal(c.calls.length,0);
});
test('reference lookup returns tariff-pack identity and only calls the read-only catalogue function',async()=>{
  const c=client();await c.init();const p=await reference(c);
  assert.equal(p.type,'TARIFF');assert.match(p.id,/^[a-f0-9]{32}$/);assert.equal(p.pack,'56');assert.equal(p.referencePrice,1.7);
  const packs=await c.request('GET',`/api/dmd/packs?id=${p.id}&type=TARIFF&query=${encodeURIComponent(p.name)}`);
  assert.equal(packs.status,200);assert.equal(packs.data.packs[0].id,p.id);
  assert.ok(c.calls.every(call=>call.url===c.env.MELLONS_SUPABASE_URL+'/functions/v1/search-drug-tariff'&&call.method==='POST'));
  assert.ok(c.calls.every(call=>JSON.parse(call.body).autocomplete===true));
  assert.equal((await c.request('POST','/api/catalogue/import',{id:p.id,type:'AMPP'})).status,400);
  assert.equal((await c.request('POST','/api/catalogue/import',{id:'wrong',type:'TARIFF'})).status,400);
});
test('a reference pack can be imported, ordered and received without writing to the reference service',async()=>{
  const c=client(),other=client();await c.init();await other.init();const p=await reference(c);
  const imported=await c.request('POST','/api/catalogue/import',{id:p.id,type:p.type,query:p.name});
  assert.equal(imported.status,201);const product=imported.data;
  assert.equal(product.id,`catalogue-TARIFF-${p.id}`);assert.equal(product.catalogueId,p.id);assert.equal(product.catalogueType,'TARIFF');assert.equal(product.source,'NHS Drug Tariff');
  assert.equal(product.pip,'');assert.equal(product.price,1);assert.equal(product.priceSource,'simulation');assert.equal(product.referencePrice,1.7);assert.equal(product.stock,0);
  const before=c.calls.length;
  assert.equal((await c.request('POST','/api/basket',{productId:product.id,quantity:2})).status,201);
  const placed=await c.request('POST','/api/orders',{supplier:'Alliance'});assert.equal(placed.status,201);assert.equal(placed.data.total,2);
  const partial=await c.request('POST',`/api/orders/${placed.data.id}/receive`,{items:[{productId:product.id,quantity:1}]});
  assert.equal(partial.data.status,'Part received');assert.equal(partial.workspace.products.find(p=>p.id===product.id).stock,1);
  const received=await c.request('POST',`/api/orders/${placed.data.id}/receive`,{});assert.equal(received.data.status,'Received');assert.equal(received.workspace.products.find(p=>p.id===product.id).stock,2);
  assert.equal(c.calls.length,before,'Basket, submit and receive must not make reference or supplier requests');
  assert.equal((await other.request('POST','/api/basket',{productId:product.id,quantity:1})).status,404);
});
test('repeat imports preserve test stock and imported products support drafts and settings',async()=>{
  const c=client();await c.init();const p=await reference(c);
  const imported=await c.request('POST','/api/catalogue/import',{id:p.id,type:p.type,query:p.name}),key=imported.data.id;
  await c.request('POST',`/api/stock/${key}`,{quantity:7});
  const repeat=await c.request('POST','/api/catalogue/import',{id:p.id,type:p.type,query:p.name});assert.equal(repeat.status,200);assert.equal(repeat.data.stock,7);assert.equal(repeat.workspace.products.length,25);
  await c.request('POST','/api/basket',{productId:key,quantity:3});const draft=await c.request('POST','/api/drafts',{name:'Reference pack draft'});
  await c.request('DELETE',`/api/basket/${key}`);const restored=await c.request('POST',`/api/drafts/${draft.data.id}/restore`,{});assert.equal(restored.workspace.basket[0].id,key);assert.equal(restored.workspace.basket[0].quantity,3);
  const settings=await c.request('PATCH','/api/settings',{fastTargets:{[key]:12},surplusOffers:[{productId:key,quantity:2}]});assert.equal(settings.status,200);assert.equal(settings.data.fastTargets[key],12);
});
test('reference products survive a local snapshot restore with canonical simulation prices and validated identifiers',async()=>{
  const c=client();await c.init();const p=await reference(c);
  const imported=await c.request('POST','/api/catalogue/import',{id:p.id,type:p.type,query:p.name}),key=imported.data.id;
  const basket=await c.request('POST','/api/basket',{productId:key,quantity:4});const snapshot=structuredClone(basket.workspace);
  snapshot.products.find(p=>p.id===key).price=9000;snapshot.basket[0].price=9000;
  const fresh=client();const restored=await fresh.request('POST','/api/workspaces',{id:fresh.id,workspace:snapshot},{});
  assert.equal(restored.status,201);assert.equal(restored.workspace.basket[0].price,1);assert.equal(restored.workspace.basket[0].quantity,4);assert.equal(fresh.calls.length,0);
  const forged=structuredClone(restored.workspace);forged.products.find(p=>p.id===key).name='Invented medicine name';assert.equal((await client().init(forged)).status,400);
  snapshot.products.find(p=>p.id===key).catalogueId='b'.repeat(32);assert.equal((await client().init(snapshot)).status,400);
  const missing=structuredClone(restored.workspace);missing.products=missing.products.filter(p=>p.id!=='p001');assert.equal((await client().init(missing)).status,400);
});
test('unknown reference identity does not insert a fabricated product',async()=>{
  const c=client();await c.init();
  const r=await c.request('POST','/api/catalogue/import',{id:'f'.repeat(32),type:'TARIFF',query:'does-not-exist'});
  assert.ok([404,409].includes(r.status));assert.equal((await c.request('GET','/api/products')).data.length,24);
});

test('unavailable reference lookup reports an error instead of substituting the sample catalogue',async()=>{
  const c=client();await c.init();
  const failed=await c.request('GET','/api/dmd/search?q=network-failure',undefined,{...c.env,DMD_FETCH:async()=>{throw new Error('Network unreachable');}});assert.equal(failed.status,503);assert.equal(failed.code,'CATALOGUE_UNAVAILABLE');
  assert.equal((await c.request('GET','/api/products')).data.length,24);
});


test('stateless dispatch carries workspace state through add, submit and receive with no prior session',async()=>{
  const c=client();
  const first=await c.request('POST','/api/dispatch',{id:`dispatch-first-${crypto.randomUUID()}`,workspace:seedWorkspace(),method:'POST',path:'/api/basket',data:{productId:'p001',quantity:3}});
  assert.equal(first.status,201);assert.equal(first.workspace.basket[0].quantity,3);
  const second=await c.request('POST','/api/dispatch',{id:`dispatch-second-${crypto.randomUUID()}`,workspace:first.workspace,method:'POST',path:'/api/orders',data:{supplier:'AAH'}});
  assert.equal(second.status,201);assert.equal(second.data.total,2.22);assert.equal(second.workspace.basket.length,0);
  const third=await c.request('POST','/api/dispatch',{id:`dispatch-third-${crypto.randomUUID()}`,workspace:second.workspace,method:'POST',path:`/api/orders/${second.data.id}/receive`,data:{}});
  assert.equal(third.status,200);assert.equal(third.data.status,'Received');assert.equal(third.workspace.products[0].stock,seedWorkspace().products[0].stock+3);
  const history=await c.request('POST','/api/dispatch',{id:`dispatch-history-${crypto.randomUUID()}`,workspace:third.workspace,method:'GET',path:'/api/orders?status=Received'});
  assert.equal(history.status,200);assert.ok(history.data.some(order=>order.id===second.data.id));
  const health=await c.request('POST','/api/dispatch',{id:`dispatch-health-${crypto.randomUUID()}`,workspace:third.workspace,method:'GET',path:'/api/health'});assert.equal(health.status,200);assert.deepEqual(health.workspace.products,third.workspace.products);assert.equal(health.workspace.orders[0].id,third.workspace.orders[0].id);assert.equal(health.workspace.orders[0].status,'Received');
  const missing=await c.request('POST','/api/dispatch',{id:`dispatch-missing-${crypto.randomUUID()}`,workspace:third.workspace,method:'GET',path:'/api/no-such-endpoint'});assert.equal(missing.status,404);assert.deepEqual(missing.workspace.products,third.workspace.products);assert.equal(missing.workspace.orders[0].id,third.workspace.orders[0].id);
  assert.equal(c.calls.length,0);
});
test('stateless dispatch validates snapshots, method, data and same-origin paths before executing',async()=>{
  const c=client(),valid={id:`dispatch-invalid-${crypto.randomUUID()}`,workspace:seedWorkspace(),method:'GET',path:'/api/basket'};
  for(const extra of [{workspace:undefined},{workspace:{}},{id:'bad id'},{method:'OPTIONS'},{method:'HEAD'},{path:'https://other.test/api/basket'},{path:'//other.test/api/basket'},{path:'/api/../outside'},{path:'/api/dispatch'},{path:'/api/dispatch/'},{path:'/api/workspaces'},{path:'/api/workspaces/'},{path:'/api/\\other.test'},{data:[]},{data:'wrong'}]){
    const rejected=await c.request('POST','/api/dispatch',{...valid,...extra});assert.equal(rejected.status,400,JSON.stringify(extra));
  }
  assert.equal((await c.request('POST','/api/dispatch',{...valid,path:'/api/basket?q='+ 'x'.repeat(2050)})).status,400);
  const tooLarge=await c.request('POST','/api/dispatch',{...valid,data:{notes:'x'.repeat(270000)}});assert.equal(tooLarge.status,413);
  assert.equal(c.calls.length,0);
});

// Representative pack records from the user's TRUD dm+d release, 2026-11-09.
const realDmdRecords=[
  {id:'41105411000001107',type:'AMPP',name:'#AOne Foam dressing (adhesive) 10cm x 10cm square (Regen Medical Ltd) 1 dressing',parentId:'41105111000001102',genericId:'1156011000001100',genericMedicineId:'3130311000001105',pack:'1 dressing',quantity:1,unit:'dressing',manufacturer:'Regen Medical Ltd',brand:'#AOne Foam dressing (adhesive) 10cm x 10cm square',referencePrice:0.61,priceSource:'dm+d list price',source:'NHS dm+d',releaseDate:'2026-11-09'},
  {id:'1156011000001100',type:'VMPP',name:'Polyurethane foam film dressing sterile with adhesive border 10cm x 10cm square 1 dressing',parentId:'3130311000001105',genericId:'3130311000001105',pack:'1 dressing',quantity:1,unit:'dressing',source:'NHS dm+d',releaseDate:'2026-11-09'}
];
test('actual dm+d pack codes remain strings through import, test order and stock receipt',async()=>{
  const c=client({DMD_DATA:realDmdRecords});await c.init();const row=realDmdRecords[0];
  const imported=await c.request('POST','/api/catalogue/import',{id:row.id,type:row.type});assert.equal(imported.status,201);
  const product=imported.data,key=`catalogue-AMPP-${row.id}`;assert.equal(product.id,key);assert.equal(product.catalogueId,row.id);assert.equal(product.dmdId,row.id);assert.equal(typeof product.dmdId,'string');assert.equal(product.dmdType,'AMPP');assert.equal(product.source,'NHS dm+d');
  assert.equal(product.parentId,row.parentId);assert.equal(product.genericId,row.genericId);assert.equal(product.genericMedicineId,row.genericMedicineId);assert.equal(product.manufacturer,row.manufacturer);assert.equal(product.quantity,1);assert.equal(product.unit,'dressing');assert.equal(product.releaseDate,'2026-11-09');
  assert.equal(product.referencePrice,.61);assert.equal(product.referencePriceSource,'dm+d list price');assert.equal(product.price,1);assert.equal(product.priceSource,'simulation');assert.equal(product.stock,0);
  const byCode=await c.request('GET',`/api/products?q=${row.id}`);assert.equal(byCode.data[0].id,key);
  await c.request('POST','/api/basket',{productId:key,quantity:3});const order=await c.request('POST','/api/orders',{notes:'Real dm+d identity, simulated ordering'});assert.equal(order.status,201);assert.equal(order.data.items[0].dmdId,row.id);assert.equal(order.data.total,3);
  const received=await c.request('POST',`/api/orders/${order.data.id}/receive`,{});assert.equal(received.status,200);assert.equal(received.data.status,'Received');assert.equal(received.workspace.products.find(p=>p.id===key).stock,3);
  const snapshot=structuredClone(received.workspace);snapshot.products.find(p=>p.id===key).price=999;snapshot.products.find(p=>p.id===key).priceSource='untrusted';
  const fresh=client();const restored=await fresh.request('POST','/api/workspaces',{id:fresh.id,workspace:snapshot},{});assert.equal(restored.status,201);const p=restored.workspace.products.find(p=>p.id===key);assert.equal(p.price,1);assert.equal(p.priceSource,'simulation');assert.equal(p.referencePrice,.61);assert.equal(p.dmdId,row.id);assert.equal(p.stock,3);assert.equal(p.parentId,row.parentId);assert.equal(p.genericMedicineId,row.genericMedicineId);assert.equal(p.releaseDate,'2026-11-09');assert.equal(fresh.calls.length,0);
  const generic=await c.request('POST','/api/catalogue/import',{id:realDmdRecords[1].id,type:'VMPP'});assert.equal(generic.status,201);assert.equal(generic.data.dmdType,'VMPP');assert.equal(generic.data.id,`catalogue-VMPP-${realDmdRecords[1].id}`);
  assert.equal(c.calls.length,0,'The embedded dm+d catalogue and order workflow do not need upstream calls');
});
test('dm+d identities and restored relationship metadata reject malformed or lossy codes',async()=>{
  const c=client({DMD_DATA:realDmdRecords});await c.init();
  for(const data of [{id:41105411000001107,type:'AMPP'},{id:'41105',type:'AMPP'},{id:'1'.repeat(19),type:'AMPP'},{id:'000000',type:'AMPP'},{id:'41105411000001107',type:'AMP'},{id:'4e15',type:'VMPP'}])assert.equal((await c.request('POST','/api/catalogue/import',data)).status,400);
  const imported=await c.request('POST','/api/catalogue/import',{id:realDmdRecords[0].id,type:'AMPP'});assert.equal(imported.status,201);const key=imported.data.id;
  for(const changes of [{dmdId:'41105411000001108'},{dmdType:'VMPP'},{parentId:41105111000001102},{genericId:'not-a-code'},{genericMedicineId:'1'.repeat(19)},{quantity:0},{quantity:1e10},{releaseDate:'2026-99-99'},{unit:'x'.repeat(81)},{source:'NHS Drug Tariff'}]){
    const snapshot=structuredClone(imported.workspace);Object.assign(snapshot.products.find(p=>p.id===key),changes);const fresh=client();const result=await fresh.request('POST','/api/workspaces',{id:fresh.id,workspace:snapshot},{});assert.equal(result.status,400,JSON.stringify(changes));
  }
});


test('catalogue status identifies the loaded TRUD release without claiming supplier stock',async()=>{const c=client();await c.init();const status=await c.request('GET','/api/catalogue/status');assert.equal(status.status,200);assert.equal(status.data.source,'NHS dm+d');assert.equal(status.data.loaded,true);assert.equal(status.data.releaseDate,'2026-11-09');assert.equal(status.data.realSupplierStock,false);assert.ok(status.data.counts);});
