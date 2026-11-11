import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi,seedWorkspace} from '../server/api.mjs';
const origin='https://stockiq-direct.test';
function client(){const id='direct-'+crypto.randomUUID();let workspace;const request=async(method,path,data)=>{const r=await handleApi(new Request(origin+path,{method,headers:{'content-type':'application/json','x-workspace-id':id},...(data===undefined?{}:{body:JSON.stringify(data)})}));const result={status:r.status,...await r.json()};if(result.workspace)workspace=result.workspace;return result;};return {id,request,get workspace(){return workspace;},init:async snapshot=>request('POST','/api/workspaces',{id,...(snapshot?{workspace:snapshot}:{})})};}
const payload=(extra={})=>({productId:'p001',quantity:3,supplier:'AAH',requestId:crypto.randomUUID(),...extra});
async function dispatch(workspace,data,path='/api/orders/direct',method='POST'){
 const r=await handleApi(new Request(origin+'/api/dispatch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'fresh-'+crypto.randomUUID(),workspace,method,path,...(data===undefined?{}:{data})})}));return {status:r.status,...await r.json()};
}
test('Send now creates only the selected line and leaves the basket and shelf stock untouched',async()=>{
 const c=client();await c.init();await c.request('POST','/api/basket',{productId:'p001',quantity:8});await c.request('POST','/api/basket',{productId:'p003',quantity:2});
 const before=structuredClone(c.workspace),body=payload();const result=await c.request('POST','/api/orders/direct',body);
 assert.equal(result.status,201);assert.equal(result.production,false);assert.equal(result.data.simulated,true);assert.equal(result.data.replayed,false);assert.match(result.data.message,/Test order accepted/);
 const order=result.data.order;assert.match(order.id,/^TEST-/);assert.equal(order.items.length,1);assert.equal(order.items[0].id,body.productId);assert.equal(order.items[0].quantity,3);assert.equal(order.items[0].received,0);assert.equal(order.total,2.22);assert.equal(order.supplier,'AAH');assert.equal(order.status,'Awaiting');assert.equal(order.requestId,body.requestId);assert.equal(order.source,'manual');
 assert.deepEqual(result.workspace.basket,before.basket);assert.deepEqual(result.workspace.products,before.products);assert.equal(result.workspace.orders.length,before.orders.length+1);
});
test('direct-order retry replays the same order and conflicting reuse creates no order',async()=>{
 const c=client();await c.init();const body=payload({notes:'  Morning order  '});const first=await c.request('POST','/api/orders/direct',body);const before=structuredClone(c.workspace);
 const again=await c.request('POST','/api/orders/direct',{...body,notes:'Morning order'});assert.equal(again.status,200);assert.equal(again.data.replayed,true);assert.equal(again.data.order.id,first.data.order.id);assert.equal(again.data.order.notes,'Morning order');assert.deepEqual(again.workspace,before);
 for(const extra of [{quantity:4},{productId:'p003'},{supplier:'Phoenix'},{notes:'Another note'}]){const bad=await c.request('POST','/api/orders/direct',{...body,...extra});assert.equal(bad.status,409);assert.equal(bad.code,'DIRECT_ORDER_CONFLICT');}
 const current=await c.request('GET','/api/workspace');assert.deepEqual(current.workspace,before);
});
test('direct-order request identity survives stateless restoration, receiving and later retry',async()=>{
 const initial=seedWorkspace(),body=payload();initial.basket=[{...initial.products[2],quantity:2,received:0}];
 const first=await dispatch(initial,body);assert.equal(first.status,201);assert.equal(first.data.order.requestId,body.requestId);
 const replay=await dispatch(first.workspace,body);assert.equal(replay.status,200);assert.equal(replay.data.order.id,first.data.order.id);assert.equal(replay.workspace.orders.length,initial.orders.length+1);assert.deepEqual(replay.workspace.basket,initial.basket);
 const history=await dispatch(replay.workspace,undefined,'/api/orders','GET');assert.ok(history.data.some(o=>o.id===first.data.order.id&&o.requestId===body.requestId));
 const before=history.workspace.products.find(p=>p.id==='p001').stock;const receipt=await dispatch(history.workspace,{},`/api/orders/${first.data.order.id}/receive`);assert.equal(receipt.status,200);assert.equal(receipt.data.status,'Received');assert.equal(receipt.workspace.products.find(p=>p.id==='p001').stock,before+3);
 const afterReceipt=await dispatch(receipt.workspace,body);assert.equal(afterReceipt.status,200);assert.equal(afterReceipt.data.replayed,true);assert.equal(afterReceipt.data.order.status,'Received');assert.equal(afterReceipt.workspace.products.find(p=>p.id==='p001').stock,before+3);
});
test('direct-order validation failures do not change orders, basket or stock',async()=>{
 const c=client();await c.init();await c.request('POST','/api/basket',{productId:'p003',quantity:4});const before=structuredClone(c.workspace);
 for(const extra of [{productId:'missing'},{quantity:0},{quantity:-1},{quantity:1.5},{quantity:'2'},{quantity:1000},{supplier:'Unknown'},{supplier:undefined},{notes:'x'.repeat(501)},{notes:2},{requestId:''},{requestId:'short'},{requestId:'bad request id'},{requestId:'x'.repeat(81)},{requestId:12345678},{price:0.01}]){const result=await c.request('POST','/api/orders/direct',payload(extra));assert.ok([400,404].includes(result.status),JSON.stringify(extra));}
 const current=await c.request('GET','/api/workspace');assert.deepEqual(current.workspace,before);
});
test('direct-order capacity failure is atomic while an existing key can still replay at capacity',async()=>{
 const c=client();await c.init();const body=payload(),created=await c.request('POST','/api/orders/direct',body);const full=structuredClone(c.workspace),template=full.orders[1];let next=2000;
 while(full.orders.length<200){const order=structuredClone(template);order.id='TEST-'+next++;delete order.requestId;full.orders.push(order);}
 const restored=client();await restored.init(full);const before=structuredClone(restored.workspace);const rejected=await restored.request('POST','/api/orders/direct',payload());assert.equal(rejected.status,409);
 const current=await restored.request('GET','/api/workspace');assert.deepEqual(current.workspace,before);const replay=await restored.request('POST','/api/orders/direct',body);assert.equal(replay.status,200);assert.equal(replay.data.order.id,created.data.order.id);assert.equal(replay.workspace.orders.length,200);
});
test('snapshots reject malformed or duplicate direct-order request identifiers',async()=>{
 const c=client();await c.init();const created=await c.request('POST','/api/orders/direct',payload());
 for(const requestId of ['bad request id',17,'x'.repeat(81)]){const snapshot=structuredClone(created.workspace);snapshot.orders[0].requestId=requestId;assert.equal((await client().init(snapshot)).status,400);}
 const duplicate=structuredClone(created.workspace);duplicate.orders[1].requestId=duplicate.orders[0].requestId;assert.equal((await client().init(duplicate)).status,400);
});
