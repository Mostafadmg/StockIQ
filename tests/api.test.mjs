import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi,seedWorkspace} from '../server/api.mjs';
let serial=0;
function client() {
  const id=`test-${Date.now()}-${++serial}`;
  async function request(method,path,data,options={}){
    const response=await handleApi(new Request(`https://stockiq.test${path}`,{method,headers:{'content-type':'application/json',...(!options.noSession?{'x-workspace-id':id}:{}),...options.headers},...(data===undefined?{}:{body:typeof data==='string'?data:JSON.stringify(data)})}));
    return {status:response.status,headers:response.headers,...await response.json()};
  }
  return {id,request,init:workspace=>request('POST','/api/workspaces',{id,...(workspace?{workspace}:{})})};
}

test('health declares isolation and needs no test workspace',async()=>{
  const c=client(),r=await c.request('GET','/api/health',undefined,{noSession:true});
  assert.equal(r.status,200);assert.equal(r.production,false);assert.equal(r.data.supplierConnections,0);assert.equal(r.headers.get('x-stockiq-sandbox'),'true');
});
test('uninitialized workspace returns a recoverable session error',async()=>{
  const c=client(),r=await c.request('GET','/api/orders');
  assert.equal(r.status,409);assert.equal(r.code,'SESSION_EXPIRED');
});
test('seed has synthetic order, claim and draft workflows',async()=>{
  const c=client(),r=await c.init();assert.equal(r.status,201);assert.equal(r.workspace.products.length,24);
  assert.deepEqual(new Set(r.workspace.orders.map(o=>o.status)),new Set(['Awaiting','Received','Part received']));
  assert.equal(r.workspace.basket.length,0);assert.equal(r.workspace.claims.length,1);assert.equal(r.workspace.drafts.length,1);
});
test('product name/PIP search and category filtering use seeded catalog',async()=>{
  const c=client();await c.init();
  const byName=await c.request('GET','/api/products?q=paracetamol');assert.equal(byName.data.length,1);assert.equal(byName.data[0].id,'p001');
  const byPip=await c.request('GET','/api/products?q=1000029');assert.equal(byPip.data[0].id,'p002');
  const otc=await c.request('GET','/api/products?category=OTC');assert.ok(otc.data.length>3);assert.ok(otc.data.every(p=>p.category==='OTC'));
});
test('basket merges quantities and totals in integer pennies',async()=>{
  const c=client();await c.init();
  await c.request('POST','/api/basket',{productId:'p001',quantity:3});
  const r=await c.request('POST','/api/basket',{productId:'p001',quantity:2});
  assert.equal(r.data.items.length,1);assert.equal(r.data.items[0].quantity,5);assert.equal(r.data.total,3.70);
  const updated=await c.request('PATCH','/api/basket/p001',{quantity:7});assert.equal(updated.data.total,5.18);
  const removed=await c.request('DELETE','/api/basket/p001');assert.equal(removed.data.items.length,0);
});
test('basket rejects invalid quantities, unknown products and overflowing merge without mutation',async()=>{
  const c=client();await c.init();
  for(const quantity of [0,-1,1.5,1000,'2',null])assert.equal((await c.request('POST','/api/basket',{productId:'p001',quantity})).status,400);
  assert.equal((await c.request('POST','/api/basket',{productId:'unknown',quantity:1})).status,404);
  await c.request('POST','/api/basket',{productId:'p001',quantity:999});
  assert.equal((await c.request('POST','/api/basket',{productId:'p001',quantity:1})).status,400);
  assert.equal((await c.request('GET','/api/basket')).data.items[0].quantity,999);
});
test('order placement creates a test ID, captures prices and clears basket',async()=>{
  const c=client();await c.init();assert.equal((await c.request('POST','/api/orders',{})).status,400);
  await c.request('POST','/api/basket',{productId:'p001',quantity:3});await c.request('POST','/api/basket',{productId:'p002',quantity:2});
  const r=await c.request('POST','/api/orders',{supplier:'AAH',notes:'Test only'});
  assert.equal(r.status,201);assert.match(r.data.id,/^TEST-\d+$/);assert.equal(r.data.status,'Awaiting');assert.equal(r.data.total,5.18);assert.equal(r.data.supplier,'AAH');assert.equal(r.workspace.basket.length,0);
  const again=await c.request('POST','/api/orders',{});assert.equal(again.status,400);
});
test('partial and full delivery receipts update stock and owing exactly once',async()=>{
  const c=client();const initial=await c.init();const originalStock=initial.workspace.products[0].stock;
  await c.request('POST','/api/basket',{productId:'p001',quantity:4});const placed=await c.request('POST','/api/orders',{}),id=placed.data.id;
  const partial=await c.request('POST',`/api/orders/${id}/receive`,{items:[{productId:'p001',quantity:2}]});
  assert.equal(partial.data.status,'Part received');assert.equal(partial.workspace.products[0].stock,originalStock+2);assert.equal(partial.workspace.products[0].owed,4);
  const full=await c.request('POST',`/api/orders/${id}/receive`,{});assert.equal(full.data.status,'Received');assert.equal(full.workspace.products[0].stock,originalStock+4);
  const duplicate=await c.request('POST',`/api/orders/${id}/receive`,{});assert.equal(duplicate.status,409);
  assert.equal((await c.request('GET','/api/workspace')).data.products[0].stock,originalStock+4);
});
test('receipt validates all lines before changing any stock',async()=>{
  const c=client();const initial=await c.init();const r=await c.request('POST','/api/orders/TEST-1001/receive',{items:[{productId:'p001',quantity:2},{productId:'p004',quantity:999}]});
  assert.equal(r.status,400);const after=await c.request('GET','/api/workspace');
  assert.deepEqual(after.data.products,initial.workspace.products);assert.equal(after.data.orders[0].items[0].received,0);
  assert.equal((await c.request('POST','/api/orders/TEST-1001/receive',{items:[{productId:'p001',quantity:1},{productId:'p001',quantity:1}]})).status,400);
});
test('drafts snapshot quantities and restore independently of later basket changes',async()=>{
  const c=client();await c.init();await c.request('POST','/api/basket',{productId:'p003',quantity:3});
  const saved=await c.request('POST','/api/drafts',{name:'Test refill'});assert.equal(saved.status,201);
  await c.request('PATCH','/api/basket/p003',{quantity:8});
  const restored=await c.request('POST',`/api/drafts/${saved.data.id}/restore`,{});assert.equal(restored.workspace.basket[0].quantity,3);
  await c.request('DELETE',`/api/drafts/${saved.data.id}`);assert.equal((await c.request('POST',`/api/drafts/${saved.data.id}/restore`,{})).status,404);
});
test('claims and stock feedback are validated isolated records',async()=>{
  const c=client();await c.init();
  assert.equal((await c.request('POST','/api/orders/TEST-1001/claim',{reason:''})).status,400);
  const claim=await c.request('POST','/api/orders/TEST-1001/claim',{reason:'Damaged pack',quantity:1});assert.equal(claim.data.status,'Open');
  const resolved=await c.request('POST',`/api/claims/${claim.data.id}/resolve`,{});assert.equal(resolved.data.status,'Resolved');
  assert.equal((await c.request('POST','/api/feedback',{productId:'p001',message:'Check stock count'})).status,201);
  assert.equal((await c.request('POST','/api/feedback',{productId:'none',message:'x'})).status,404);
});
test('settings reject unknown keys and invalid nested values atomically',async()=>{
  const c=client();await c.init();
  const saved=await c.request('PATCH','/api/settings',{daysCover:14,lowStockAlerts:false,fastTargets:{p001:20},deliveryTimes:{Phoenix:{cutoff:'14:30',arrival:'09:00'}},surplusOffers:[{productId:'p009',quantity:2}]});
  assert.equal(saved.data.daysCover,14);assert.equal(saved.data.fastTargets.p001,20);
  for(const data of [{daysCover:0},{lowStockAlerts:'yes'},{production:true},{fastTargets:{wrong:3}},{surplusOffers:[{productId:'p009',quantity:-1}]}])assert.equal((await c.request('PATCH','/api/settings',data)).status,400);
  assert.equal((await c.request('GET','/api/settings')).data.daysCover,14);
});
test('stock counts allow zero and reject invalid counts',async()=>{
  const c=client();const init=await c.init();const counted=await c.request('POST','/api/stock/p001',{quantity:0});assert.equal(counted.data.stock,0);assert.deepEqual(counted.workspace.stockCounts[0],{productId:'p001',quantity:0,previous:init.workspace.products[0].stock,createdAt:counted.workspace.stockCounts[0].createdAt});
  assert.equal((await c.request('POST','/api/stock/p001',{quantity:-1})).status,400);
});
test('two workspaces cannot see each other’s writes and reset is scoped',async()=>{
  const a=client(),b=client();await a.init();await b.init();await a.request('POST','/api/basket',{productId:'p001',quantity:3});
  assert.equal((await b.request('GET','/api/basket')).data.items.length,0);
  await b.request('POST','/api/basket',{productId:'p002',quantity:2});await a.request('POST','/api/reset',{});
  assert.equal((await a.request('GET','/api/basket')).data.items.length,0);assert.equal((await b.request('GET','/api/basket')).data.items[0].id,'p002');
});
test('snapshot restore preserves workflow state, canonicalizes prices and rejects invalid quantities',async()=>{
  const a=client();await a.init();const changed=await a.request('POST','/api/basket',{productId:'p001',quantity:4});
  const snapshot=structuredClone(changed.workspace);snapshot.products[0].price=9999;snapshot.basket[0].price=9999;
  const b=client(),restored=await b.init(snapshot);assert.equal(restored.status,201);assert.equal(restored.workspace.basket[0].price,0.74);assert.equal(restored.workspace.basket[0].quantity,4);
  snapshot.basket[0].quantity=-1;assert.equal((await client().init(snapshot)).status,400);
  const duplicate=seedWorkspace();duplicate.products[1].id=duplicate.products[0].id;assert.equal((await client().init(duplicate)).status,400);
});
test('analytics totals reflect newly created test orders',async()=>{
  const c=client();await c.init();const before=(await c.request('GET','/api/analytics')).data;
  await c.request('POST','/api/basket',{productId:'p001',quantity:2});await c.request('POST','/api/orders',{});
  const after=(await c.request('GET','/api/analytics')).data;
  assert.equal(after.totalOrders,before.totalOrders+1);assert.equal(after.totalSpend,Math.round((before.totalSpend+1.48)*100)/100);
  assert.equal(Math.round(after.bySupplier.reduce((n,s)=>n+s.total,0)*100),Math.round(after.totalSpend*100));
});
test('malformed JSON, oversized requests and unknown endpoints produce bounded errors',async()=>{
  const c=client();await c.init();assert.equal((await c.request('POST','/api/basket','{')).status,400);
  assert.equal((await c.request('POST','/api/feedback',{message:'x'.repeat(270000)})).status,413);
  assert.equal((await c.request('GET','/api/no-such-endpoint')).status,404);
  assert.equal(await handleApi(new Request('https://stockiq.test/auto-orders')),null);
});
