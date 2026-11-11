import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi,seedWorkspace} from '../server/api.mjs';

const origin='https://barcode-api.test';
const gtin='05037563003235';
function client(){
 const id='barcode-api-'+crypto.randomUUID();let workspace;
 const request=async(method,path,data)=>{const response=await handleApi(new Request(origin+path,{method,headers:{'content-type':'application/json','x-workspace-id':id},...(data===undefined?{}:{body:JSON.stringify(data)})}));const result={status:response.status,...await response.json()};if(result.workspace)workspace=result.workspace;return result;};
 return {request,get workspace(){return workspace;},init:snapshot=>request('POST','/api/workspaces',{id,...(snapshot?{workspace:snapshot}:{})})};
}
async function dispatch(workspace,path,data){const response=await handleApi(new Request(origin+'/api/dispatch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'scan-dispatch-'+crypto.randomUUID(),workspace,method:'POST',path,data})}));return {status:response.status,...await response.json()};}

test('EAN scanning identifies the exact NHS pack without importing it or changing the workspace',async()=>{
 const c=client();await c.init();await c.request('POST','/api/basket',{productId:'p003',quantity:2});const before=structuredClone(c.workspace);
 const result=await c.request('POST','/api/dmd/barcode',{barcode:'5037563003235\r\n'});
 assert.equal(result.status,200);assert.equal(result.production,false);assert.equal(result.data.gtin,gtin);assert.equal(result.data.format,'ean');assert.equal(result.data.matches.length,1);assert.equal(result.data.matches[0].id,'1327911000001107');assert.equal(result.data.matches[0].type,'AMPP');assert.match(result.data.matches[0].name,/Verapamil 160mg/);assert.equal(result.data.source,'NHS dm+d');assert.equal(result.data.releaseDate,'2026-11-09');assert.equal(result.data.gtinReleaseDate,'2026-11-05');assert.equal(result.data.historical,false);assert.deepEqual(result.workspace,before);
});

test('GS1 expiry and batch metadata are returned but raw scans and serials are not returned or saved',async()=>{
 const c=client();await c.init(seedWorkspace());const before=structuredClone(c.workspace),barcode=`]d2(01)${gtin}(17)281200(10)LOT42(21)UNIQUE-SERIAL`;
 const result=await dispatch(before,'/api/dmd/barcode',{barcode});assert.equal(result.status,200);assert.equal(result.data.format,'gs1');assert.equal(result.data.batch,'LOT42');assert.equal(result.data.expiry,'2028-12-31');assert.equal(result.data.expiryRaw,'281200');assert.equal(result.data.matches[0].id,'1327911000001107');assert.ok(!('serial' in result.data));assert.ok(!('barcode' in result.data));assert.ok(!('raw' in result.data));assert.ok(!JSON.stringify(result).includes('UNIQUE-SERIAL'));assert.deepEqual(result.workspace,before);
 const container=await dispatch(before,'/api/dmd/barcode',{barcode:`(02)${gtin}(37)12`});assert.equal(container.status,200);assert.equal(container.data.requiresPackConfirmation,true);assert.ok(!('containedCount' in container.data));assert.ok(!('quantity' in container.data));assert.deepEqual(container.workspace,before);
});

test('unknown GTINs give an explicit empty match while invalid payloads return safe errors',async()=>{
 const c=client();await c.init();const before=structuredClone(c.workspace);
 const missing=await c.request('POST','/api/dmd/barcode',{barcode:'99999999999997'});assert.equal(missing.status,200);assert.deepEqual(missing.data.matches,[]);assert.match(missing.data.message,/No matching active medicine pack/);
 for(const body of [{},{barcode:12345678},{barcode:''},{barcode:'5037563003236'},{barcode:'PRIVATE-SERIAL-DO-NOT-ECHO'},{barcode:'x'.repeat(1025)},{barcode:gtin,serial:'PRIVATE-SERIAL-DO-NOT-ECHO'}]){const result=await c.request('POST','/api/dmd/barcode',body);assert.equal(result.status,400);assert.ok(!JSON.stringify(result).includes('PRIVATE-SERIAL-DO-NOT-ECHO'));}
 const current=await c.request('GET','/api/workspace');assert.deepEqual(current.workspace,before);
});

test('supplier comparison returns all joint cheapest test prices and leaves all workspace state unchanged',async()=>{
 const c=client();await c.init();await c.request('POST','/api/basket',{productId:'p003',quantity:2});const before=structuredClone(c.workspace);
 const result=await c.request('POST','/api/orders/compare',{productId:'p001',quantity:3});assert.equal(result.status,200);assert.equal(result.data.simulated,true);assert.equal(result.data.priceBasis,'test_prices');assert.equal(result.data.quotes.length,7);assert.equal(result.data.cheapestSuppliers.length,7);assert.match(result.data.message,/same test price/);
 for(const quote of result.data.quotes){assert.equal(quote.unitPrice,.74);assert.equal(quote.estimatedTotal,2.22);assert.equal(quote.acceptedQuantity,3);assert.equal(quote.requestedQuantity,3);assert.equal(quote.supplierReference,null);assert.equal(quote.delivery.basis,'schedule_estimate');const single=await c.request('POST','/api/orders/quote',{productId:'p001',quantity:3,supplier:quote.supplier});assert.equal(single.data.estimatedTotal,quote.estimatedTotal);assert.equal(single.data.acceptedQuantity,quote.acceptedQuantity);assert.equal(single.data.delivery.basis,quote.delivery.basis);assert.equal(single.data.delivery.timezone,quote.delivery.timezone);}
 const known=result.data.quotes.filter(q=>q.delivery.estimatedArrivalAt).sort((a,b)=>Date.parse(a.delivery.estimatedArrivalAt)-Date.parse(b.delivery.estimatedArrivalAt));if(known.length)assert.equal(Date.parse(result.data.quotes.find(q=>q.supplier===result.data.recommendedSupplier).delivery.estimatedArrivalAt),Date.parse(known[0].delivery.estimatedArrivalAt));assert.deepEqual(c.workspace,before);
});

test('comparison uses stable supplier order for unknown arrival ties and never recommends incomplete supply',async()=>{
 const snapshot=seedWorkspace();snapshot.features.deliveryVans=Object.fromEntries(['Phoenix','Alliance','AAH','BNS','Sigma','Trident','Warehouse'].map(supplier=>[supplier,[]]));
 const c=client();await c.init(snapshot);const canonical=structuredClone(c.workspace);
 const same=await dispatch(canonical,'/api/orders/compare',{productId:'p001',quantity:3});assert.equal(same.status,200);assert.equal(same.data.recommendedSupplier,'Phoenix');assert.equal(same.data.quotes.every(quote=>quote.delivery.estimatedArrivalAt===null),true);assert.deepEqual(same.workspace,canonical);
 for(const scenario of ['partial','unavailable']){const result=await dispatch(canonical,'/api/orders/compare',{productId:'p001',quantity:3,scenario});assert.equal(result.status,200);assert.equal(result.data.recommendedSupplier,null);assert.deepEqual(result.data.cheapestSuppliers,[]);assert.match(result.data.message,/No supplier can supply the full requested quantity/);assert.equal(result.data.quotes.every(q=>q.acceptedQuantity<3),true);assert.deepEqual(result.workspace,canonical);}
});

test('comparison rejects malformed selections before changing the workspace',async()=>{
 const c=client();await c.init();const before=structuredClone(c.workspace);
 for(const extra of [{productId:'missing'},{quantity:0},{quantity:1.5},{quantity:'2'},{quantity:1000},{scenario:'invented'},{supplier:'AAH'},{price:0}]){const result=await c.request('POST','/api/orders/compare',{productId:'p001',quantity:3,...extra});assert.ok([400,404].includes(result.status));}
 const current=await c.request('GET','/api/workspace');assert.deepEqual(current.workspace,before);
});
