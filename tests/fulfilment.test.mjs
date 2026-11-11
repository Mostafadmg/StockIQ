import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi,seedWorkspace} from '../server/api.mjs';
import {nextDeliveryEstimate,nextWorkingDayKey} from '../server/fulfilment.mjs';
const origin='https://fulfilment.test';
const vans={AAH:[{id:'weekday',days:[1,2,3,4,5],cutoff:'14:00',arrival:'09:00',offset:1}]};
function client(){const id='fulfilment-'+crypto.randomUUID();let workspace;const request=async(method,path,data)=>{const r=await handleApi(new Request(origin+path,{method,headers:{'content-type':'application/json','x-workspace-id':id},...(data===undefined?{}:{body:JSON.stringify(data)})}));const result={status:r.status,...await r.json()};if(result.workspace)workspace=result.workspace;return result;};return {request,get workspace(){return workspace;},init:snapshot=>request('POST','/api/workspaces',{id,...(snapshot?{workspace:snapshot}:{})})};}
async function dispatch(workspace,method,path,data){const r=await handleApi(new Request(origin+'/api/dispatch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'fulfilment-'+crypto.randomUUID(),workspace,method,path,...(data===undefined?{}:{data})})}));return {status:r.status,...await r.json()};}
const payload=(extra={})=>({productId:'p001',quantity:4,supplier:'AAH',requestId:crypto.randomUUID(),...extra});

test('London cutoff estimates distinguish next working day from later arrival across a weekend',()=>{
 const before=nextDeliveryEstimate('AAH',vans,'2026-11-13T13:59:00Z');assert.equal(before.estimatedArrivalAt,'2026-11-16T09:00:00.000Z');assert.equal(before.workingDays,1);assert.equal(before.serviceLabel,'Next working day');
 const after=nextDeliveryEstimate('AAH',vans,'2026-11-13T14:00:01Z');assert.equal(after.estimatedArrivalAt,'2026-11-17T09:00:00.000Z');assert.equal(after.workingDays,2);assert.equal(after.orderBy,'2026-11-16T14:00:00.000Z');assert.equal(after.serviceLabel,'2 working days');assert.equal(after.basis,'schedule_estimate');assert.match(after.note,/No supplier delivery promise/);
 assert.equal(nextDeliveryEstimate('AAH',vans,'2026-11-14T12:00:00Z').estimatedArrivalAt,after.estimatedArrivalAt);
});

test('delivery times use UK civil time through BST and GMT changes rather than server timezone',()=>{
 const summer=nextDeliveryEstimate('AAH',vans,'2026-06-05T12:59:00Z');assert.equal(summer.orderBy,'2026-06-05T13:00:00.000Z');assert.equal(summer.estimatedArrivalAt,'2026-06-08T08:00:00.000Z');
 const spring=nextDeliveryEstimate('AAH',vans,'2026-03-27T14:01:00Z');assert.equal(spring.orderBy,'2026-03-30T13:00:00.000Z');assert.equal(spring.estimatedArrivalAt,'2026-03-31T08:00:00.000Z');
 const autumn=nextDeliveryEstimate('AAH',vans,'2026-10-23T12:59:00Z');assert.equal(autumn.estimatedArrivalAt,'2026-10-26T09:00:00.000Z');assert.equal(autumn.timezone,'Europe/London');
});

test('England/Wales holidays, substitute days, multiple vans and missing schedules are explicit',()=>{
 assert.equal(nextWorkingDayKey('2026-04-02T12:00:00Z'),'2026-04-07');assert.equal(nextWorkingDayKey('2026-12-24T12:00:00Z'),'2026-12-29');assert.equal(nextWorkingDayKey('2026-08-28T12:00:00Z'),'2026-09-01');
 assert.equal(nextDeliveryEstimate('AAH',vans,'2026-12-24T13:59:00Z').estimatedArrivalAt,'2026-12-29T09:00:00.000Z');
 const twice={AAH:[...vans.AAH,{id:'afternoon',days:[1,2,3,4,5],cutoff:'11:00',arrival:'15:00',offset:0}]};const today=nextDeliveryEstimate('AAH',twice,'2026-11-11T10:00:00Z');assert.equal(today.scheduleId,'afternoon');assert.equal(today.serviceLabel,'Same day');assert.equal(today.estimatedArrivalAt,'2026-11-11T15:00:00.000Z');
 const missing=nextDeliveryEstimate('AAH',{AAH:[]},'2026-11-11T10:00:00Z');assert.equal(missing.estimatedArrivalAt,null);assert.equal(missing.serviceLabel,'Delivery not configured');assert.match(nextDeliveryEstimate('Sigma',{},'2026-11-11T10:00:00Z').note,/default weekday/);
});

test('read-only order quotes expose accepted packs, canonical cost and supplier ETA without workspace mutation',async()=>{
 const c=client();await c.init();await c.request('POST','/api/basket',{productId:'p003',quantity:2});const before=structuredClone(c.workspace);
 for(const [scenario,accepted,status] of [['full',4,'accepted'],['partial',3,'partial'],['unavailable',0,'unavailable']]){const result=await c.request('POST','/api/orders/quote',{productId:'p001',quantity:4,supplier:'AAH',scenario});assert.equal(result.status,200);assert.equal(result.data.acceptedQuantity,accepted);assert.equal(result.data.requestedQuantity,4);assert.equal(result.data.outstandingQuantity,4-accepted);assert.equal(result.data.status,status);assert.equal(result.data.unitPrice,.74);assert.equal(result.data.estimatedTotal,Math.round(accepted*.74*100)/100);assert.equal(result.data.simulated,true);assert.equal(result.data.supplierReference,null);assert.equal(result.data.delivery.estimatedArrivalAt===null,accepted===0);assert.deepEqual(result.workspace,before);}
});

test('partial acceptance is an immutable supplier result and only accepted packs can enter shelf stock',async()=>{
 const c=client();await c.init();await c.request('POST','/api/basket',{productId:'p003',quantity:2});const before=structuredClone(c.workspace),body=payload({scenario:'partial'}),created=await c.request('POST','/api/orders/direct',body),o=created.data.order;
 assert.equal(created.status,201);assert.equal(o.status,'Awaiting');assert.equal(o.fulfilment.status,'partial');assert.equal(o.fulfilment.acceptedQuantity,3);assert.equal(o.fulfilment.outstandingQuantity,1);assert.equal(o.total,2.22);assert.match(o.fulfilment.supplierReference,/^SIM-AAH-TEST-/);assert.match(o.fulfilment.sourceLabel,/AAH/);assert.deepEqual(created.workspace.basket,before.basket);assert.deepEqual(created.workspace.products,before.products);
 const invalid=await c.request('POST',`/api/orders/${o.id}/receive`,{items:[{productId:'p001',quantity:4}]});assert.equal(invalid.status,400);assert.deepEqual(c.workspace.products,before.products);
 assert.equal((await c.request('POST',`/api/orders/${o.id}/claim`,{reason:'Missing delivery',quantity:4})).status,400);
 const first=await c.request('POST',`/api/orders/${o.id}/receive`,{items:[{productId:'p001',quantity:1}]});assert.equal(first.data.status,'Part received');
 const receipt=await dispatch(first.workspace,'POST',`/api/orders/${o.id}/receive`,{});assert.equal(receipt.status,200);assert.equal(receipt.data.status,'Received');assert.equal(receipt.data.items[0].received,3);assert.equal(receipt.workspace.products[0].stock,before.products[0].stock+3);assert.equal(receipt.data.items[0].outstandingQuantity,1);assert.deepEqual(receipt.data.fulfilment,o.fulfilment);
 assert.equal((await dispatch(receipt.workspace,'POST',`/api/orders/${o.id}/receive`,{})).status,409);
 const replay=await dispatch(receipt.workspace,'POST','/api/orders/direct',body);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.order.id,o.id);assert.deepEqual(replay.data.order.fulfilment,o.fulfilment);
});

test('unavailable attempts have no delivery or charge and cannot be received, claimed, or double submitted',async()=>{
 const c=client();await c.init();const before=structuredClone(c.workspace),body=payload({scenario:'unavailable'}),first=await c.request('POST','/api/orders/direct',body),o=first.data.order;
 assert.equal(first.status,201);assert.equal(o.status,'Not accepted');assert.equal(o.total,0);assert.equal(o.fulfilment.acceptedQuantity,0);assert.equal(o.fulfilment.outstandingQuantity,4);assert.equal(o.fulfilment.acceptedAt,null);assert.equal(o.fulfilment.delivery.estimatedArrivalAt,null);assert.match(o.fulfilment.delivery.note,/not backordered/);assert.deepEqual(first.workspace.products,before.products);
 assert.equal((await c.request('POST',`/api/orders/${o.id}/receive`,{})).status,409);assert.equal((await c.request('POST',`/api/orders/${o.id}/claim`,{reason:'No delivery'})).status,409);
 const replay=await dispatch(first.workspace,'POST','/api/orders/direct',body);assert.equal(replay.status,200);assert.deepEqual(replay.data.order,o);assert.equal(replay.workspace.orders.length,before.orders.length+1);
 assert.equal((await dispatch(replay.workspace,'POST','/api/orders/direct',{...body,scenario:'full'})).status,409);
 const analytics=await c.request('GET','/api/analytics');assert.equal(analytics.data.awaiting,before.orders.filter(x=>x.status!=='Received').length);
});

test('acceptance and ETA survive later delivery configuration changes, session restoration and key replay',async()=>{
 const c=client();await c.init();const body=payload(),first=await c.request('POST','/api/orders/direct',body);await c.request('PUT','/api/delivery-vans/AAH',{vans:[]});const after=await dispatch(c.workspace,'POST','/api/orders/direct',body);assert.equal(after.status,200);assert.deepEqual(after.data.order.fulfilment,first.data.order.fulfilment);
 const next=await dispatch(after.workspace,'POST','/api/orders/direct',payload());assert.equal(next.status,201);assert.equal(next.data.order.fulfilment.delivery.estimatedArrivalAt,null);assert.equal(next.data.order.fulfilment.delivery.serviceLabel,'Delivery not configured');
});

test('snapshots reject altered acceptance, received excess and malformed promised delivery metadata',async()=>{
 const c=client();await c.init();const result=await c.request('POST','/api/orders/direct',payload({scenario:'partial'}));
 const mutations=[w=>w.orders[0].items[0].acceptedQuantity=4,w=>w.orders[0].items[0].received=4,w=>w.orders[0].fulfilment.acceptedQuantity=4,w=>w.orders[0].fulfilment.simulated=false,w=>w.orders[0].fulfilment.delivery.basis='supplier_confirmed',w=>w.orders[0].fulfilment.delivery.estimatedArrivalAt='garbage',w=>w.orders[0].fulfilment.delivery.workingDays=59,w=>w.orders[0].fulfilment.supplier='Phoenix',w=>w.orders[0].fulfilment.delivery.orderBy='2000-01-01T00:00:00Z'];
 for(const mutate of mutations){const workspace=structuredClone(result.workspace);mutate(workspace);assert.equal((await client().init(workspace)).status,400);}
});

test('selected basket supplier survives snapshots/drafts and cascade quotes match submitted costs and metadata',async()=>{
 const c=client();await c.init();await c.request('POST','/api/basket',{productId:'p001',quantity:3,supplier:'AAH'});const restored=await dispatch(c.workspace,'GET','/api/basket');assert.equal(restored.data.items[0].supplier,'AAH');
 const draft=await c.request('POST','/api/drafts',{name:'Selected supplier'});await c.request('POST','/api/basket',{productId:'p001',quantity:1,supplier:'Phoenix'});const resumed=await c.request('POST',`/api/drafts/${draft.data.id}/restore`,{});assert.equal(resumed.workspace.basket[0].supplier,'AAH');
 const preview=await dispatch(resumed.workspace,'POST','/api/basket/cascade',{}),line=preview.data.lines[0];assert.equal(line.selectedSupplier,'AAH');assert.ok(line.quotes.every(q=>q.unitPrice===.74&&q.estimatedTotal===2.22&&q.acceptedQuantity===3&&q.delivery.basis==='schedule_estimate'));
 const placed=await dispatch(preview.workspace,'POST','/api/orders/cascade',{allocations:[{productId:'p001',supplier:'AAH'}]});assert.equal(placed.status,201);assert.equal(placed.data.total,line.lineTotal);assert.equal(placed.data.orders[0].fulfilment.acceptedQuantity,3);assert.equal(placed.data.orders[0].items[0].supplier,'AAH');
 const again=await dispatch(placed.workspace,'GET','/api/orders');assert.deepEqual(again.data.find(o=>o.id===placed.data.orders[0].id),placed.data.orders[0]);
});

test('invalid preview/scenario/supplier input fails atomically; legacy orders get full acceptance metadata',async()=>{
 const c=client();await c.init();const before=structuredClone(c.workspace);
 for(const extra of [{scenario:'real'},{scenario:null},{supplier:'Unknown'},{quantity:0},{quantity:'2'},{productId:'missing'},{confirmedQuantity:5}]){const result=await c.request('POST','/api/orders/quote',{productId:'p001',quantity:4,supplier:'AAH',...extra});assert.ok([400,404].includes(result.status));}
 for(const extra of [{scenario:'real'},{scenario:null},{supplier:'Unknown'}])assert.equal((await c.request('POST','/api/orders/direct',payload(extra))).status,400);
 assert.deepEqual((await c.request('GET','/api/workspace')).workspace,before);
 const legacy=seedWorkspace();for(const order of legacy.orders){delete order.fulfilment;for(const item of order.items){delete item.requestedQuantity;delete item.acceptedQuantity;delete item.outstandingQuantity;}}
 const upgraded=await client().init(legacy);assert.equal(upgraded.status,201);assert.ok(upgraded.workspace.orders.every(o=>o.fulfilment.status==='accepted'&&o.items.every(i=>i.acceptedQuantity===i.quantity)));
});

test('optional depot follows the chosen delivery run while old estimates keep their exact shape',()=>{
 const old=nextDeliveryEstimate('AAH',vans,'2026-11-11T10:00:00Z');assert.equal(Object.hasOwn(old,'depot'),false);
 const routed={AAH:[{...vans.AAH[0],id:'later',offset:2,depot:' Birmingham '},{...vans.AAH[0],id:'earlier',depot:'Cardiff'}]};
 const earlier=nextDeliveryEstimate('AAH',routed,'2026-11-11T10:00:00Z');assert.equal(earlier.scheduleId,'earlier');assert.equal(earlier.depot,'Cardiff');assert.equal(earlier.workingDays,1);
 routed.AAH.pop();const birmingham=nextDeliveryEstimate('AAH',routed,'2026-11-11T10:00:00Z');assert.equal(birmingham.depot,'Birmingham');assert.equal(birmingham.workingDays,2);assert.equal(birmingham.estimatedArrivalAt,'2026-11-13T09:00:00.000Z');
 const blank=nextDeliveryEstimate('AAH',{AAH:[{...vans.AAH[0],depot:'   '}]},'2026-11-11T10:00:00Z');assert.equal(Object.hasOwn(blank,'depot'),false);
 const none=nextDeliveryEstimate('AAH',{AAH:[{...vans.AAH[0],days:[],depot:'Birmingham'}]},'2026-11-11T10:00:00Z');assert.equal(none.estimatedArrivalAt,null);assert.equal(Object.hasOwn(none,'depot'),false);
});

test('configured depot flows through read-only quotes, comparisons, submissions and historical restoration',async()=>{
 const c=client();await c.init();const route={id:'birmingham',days:[1,2,3,4,5,6,7],cutoff:'23:59',arrival:'09:00',offset:2,depot:' Birmingham '};
 const saved=await c.request('PUT','/api/delivery-vans/AAH',{vans:[route]});assert.equal(saved.status,200);assert.equal(saved.data.vans[0].depot,'Birmingham');
 await c.request('POST','/api/basket',{productId:'p001',quantity:2,supplier:'AAH'});const before=structuredClone(c.workspace);
 const quote=await c.request('POST','/api/orders/quote',{productId:'p001',quantity:2,supplier:'AAH'});assert.equal(quote.data.delivery.depot,'Birmingham');assert.equal(quote.data.delivery.workingDays,2);assert.deepEqual(quote.workspace,before);
 const comparison=await c.request('POST','/api/orders/compare',{productId:'p001',quantity:2});assert.equal(comparison.data.quotes.find(item=>item.supplier==='AAH').delivery.depot,'Birmingham');assert.deepEqual(comparison.workspace,before);
 const preview=await c.request('POST','/api/basket/cascade',{});assert.equal(preview.data.lines[0].quotes.find(item=>item.supplier==='AAH').delivery.depot,'Birmingham');assert.deepEqual(preview.workspace,before);
 const body=payload(),direct=await c.request('POST','/api/orders/direct',body);assert.equal(direct.status,201);assert.equal(direct.data.order.fulfilment.delivery.depot,'Birmingham');
 const cascade=await c.request('POST','/api/orders/cascade',{allocations:[{productId:'p001',supplier:'AAH'}]});assert.equal(cascade.status,201);assert.equal(cascade.data.orders[0].fulfilment.delivery.depot,'Birmingham');
 await c.request('PUT','/api/delivery-vans/AAH',{vans:[{...route,depot:'Cardiff',offset:1}]});
 const restored=await dispatch(c.workspace,'GET','/api/orders');assert.equal(restored.status,200);assert.equal(restored.workspace.features.deliveryVans.AAH[0].depot,'Cardiff');
 for(const original of [direct.data.order,cascade.data.orders[0]])assert.deepEqual(restored.data.find(order=>order.id===original.id).fulfilment,original.fulfilment);
 const replay=await dispatch(restored.workspace,'POST','/api/orders/direct',body);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.deepEqual(replay.data.order.fulfilment,direct.data.order.fulfilment);
 const next=await dispatch(replay.workspace,'POST','/api/orders/direct',payload());assert.equal(next.status,201);assert.equal(next.data.order.fulfilment.delivery.depot,'Cardiff');
});

test('depots are omitted for unavailable or undated deliveries and invalid route data is rejected atomically',async()=>{
 const c=client();await c.init();const route={...vans.AAH[0],depot:'Birmingham'},saved=await c.request('PUT','/api/delivery-vans/AAH',{vans:[route]});assert.equal(saved.status,200);
 const unavailable=await c.request('POST','/api/orders/quote',{productId:'p001',quantity:2,supplier:'AAH',scenario:'unavailable'});assert.equal(unavailable.data.delivery.estimatedArrivalAt,null);assert.equal(Object.hasOwn(unavailable.data.delivery,'depot'),false);
 const before=structuredClone(c.workspace);
 for(const depot of [null,5,{},[],true,'x'.repeat(81)]){assert.equal((await c.request('PUT','/api/delivery-vans/AAH',{vans:[{...route,depot}]})).status,400);assert.deepEqual(c.workspace,before);}
 assert.equal((await c.request('PUT','/api/delivery-vans/AAH',{vans:[{...route,depotCode:'BHM'}]})).status,400);assert.deepEqual(c.workspace,before);
 const blank=await c.request('PUT','/api/delivery-vans/AAH',{vans:[{...route,depot:'   '}]});assert.equal(blank.status,200);assert.equal(Object.hasOwn(blank.data.vans[0],'depot'),false);
 const noRun=await c.request('PUT','/api/delivery-vans/AAH',{vans:[{...route,days:[]}]});assert.equal(noRun.status,200);const quote=await c.request('POST','/api/orders/quote',{productId:'p001',quantity:2,supplier:'AAH'});assert.equal(quote.data.delivery.estimatedArrivalAt,null);assert.equal(Object.hasOwn(quote.data.delivery,'depot'),false);
});

test('historical depot validation is bounded and old snapshots do not acquire a depot during restore',async()=>{
 const c=client();await c.init();const original=await c.request('POST','/api/orders/direct',payload());assert.equal(Object.hasOwn(original.data.order.fulfilment.delivery,'depot'),false);
 const old=await dispatch(c.workspace,'GET','/api/orders');assert.deepEqual(old.data.find(order=>order.id===original.data.order.id).fulfilment,original.data.order.fulfilment);
 for(const depot of [null,42,'','   ',' Birmingham ','x'.repeat(81)]){const invalid=structuredClone(c.workspace);invalid.orders[0].fulfilment.delivery.depot=depot;assert.equal((await client().init(invalid)).status,400);}
 const unknown=structuredClone(c.workspace);unknown.orders[0].fulfilment.delivery.depotCode='BHM';assert.equal((await client().init(unknown)).status,400);
 const unavailable=await c.request('POST','/api/orders/direct',payload({scenario:'unavailable'}));const badUnavailable=structuredClone(unavailable.workspace);badUnavailable.orders[0].fulfilment.delivery.depot='Birmingham';assert.equal((await client().init(badUnavailable)).status,400);
});
