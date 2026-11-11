import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi,seedWorkspace} from '../server/api.mjs';

function client(){
 let workspace=seedWorkspace();
 const request=async(method,path,data)=>{
  const response=await handleApi(new Request('https://basket-api.test/api/dispatch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'basket-api-'+crypto.randomUUID(),workspace,method,path,...(data===undefined?{}:{data})})}));
  const result={status:response.status,...await response.json()};if(result.workspace)workspace=result.workspace;return result;
 };
 return {request,get workspace(){return workspace;}};
}

test('basket supplier edits preserve quantity and stock and reject invalid changes atomically',async()=>{
 const c=client();await c.request('POST','/api/basket',{productId:'p001',quantity:3});const stock=c.workspace.products.map(line=>[line.id,line.stock]);
 const changed=await c.request('PATCH','/api/basket/p001',{supplier:'AAH'});assert.equal(changed.status,200);assert.equal(changed.workspace.basket[0].quantity,3);assert.equal(changed.workspace.basket[0].supplier,'AAH');assert.deepEqual(changed.workspace.products.map(line=>[line.id,line.stock]),stock);
 const before=structuredClone(c.workspace);
 for(const body of [{},{quantity:0},{quantity:1.5},{quantity:'2'},{quantity:7,supplier:'Unknown'},{supplier:'Phoenix',price:0}]){
  const rejected=await c.request('PATCH','/api/basket/p001',body);assert.equal(rejected.status,400);assert.deepEqual(c.workspace,before);
 }
 const both=await c.request('PATCH','/api/basket/p001',{quantity:5,supplier:'Phoenix'});assert.equal(both.status,200);assert.equal(both.workspace.basket[0].quantity,5);assert.equal(both.workspace.basket[0].supplier,'Phoenix');
});

test('selected basket submission sends only selected packs and preserves every unselected line',async()=>{
 const c=client();await c.request('POST','/api/basket',{productId:'p001',quantity:2,supplier:'Phoenix'});await c.request('POST','/api/basket',{productId:'p003',quantity:4,supplier:'Alliance'});
 const unselected=structuredClone(c.workspace.basket.find(line=>line.id==='p003')),stock=c.workspace.products.map(line=>[line.id,line.stock]),orders=c.workspace.orders.length;
 const result=await c.request('POST','/api/orders/cascade',{allocations:[{productId:'p001',supplier:'AAH'}],notes:'Only the checked medicine'});
 assert.equal(result.status,201);assert.equal(result.data.orders.length,1);assert.equal(result.data.orders[0].supplier,'AAH');assert.equal(result.data.orders[0].items[0].supplier,'AAH');assert.equal(result.data.orders[0].items[0].id,'p001');assert.equal(result.data.orders[0].items[0].quantity,2);assert.equal(result.data.orders[0].notes,'Only the checked medicine');assert.equal(c.workspace.orders.length,orders+1);assert.deepEqual(c.workspace.basket,[unselected]);assert.deepEqual(c.workspace.products.map(line=>[line.id,line.stock]),stock);
 const rest=await c.request('POST','/api/orders/cascade',{allocations:[{productId:'p003',supplier:'Alliance'}]});assert.equal(rest.status,201);assert.deepEqual(c.workspace.basket,[]);
});

test('all selected allocations validate before any order or basket mutation',async()=>{
 const c=client();await c.request('POST','/api/basket',{productId:'p001',quantity:2});await c.request('POST','/api/basket',{productId:'p003',quantity:4});const before=structuredClone(c.workspace);
 for(const allocations of [[],[{productId:'p001',supplier:'AAH'},{productId:'p001',supplier:'Phoenix'}],[{productId:'p001',supplier:'AAH'},{productId:'missing',supplier:'Phoenix'}],[{productId:'p001',supplier:'AAH'},{productId:'p003',supplier:'Unknown'}]]){
  const result=await c.request('POST','/api/orders/cascade',{allocations});assert.equal(result.status,400);assert.deepEqual(c.workspace,before);
 }
 const result=await c.request('POST','/api/orders/cascade',{allocations:[{productId:'p001',supplier:'AAH'},{productId:'p003',supplier:'Phoenix'}]});assert.equal(result.status,201);assert.equal(result.data.orders.length,2);assert.deepEqual(c.workspace.basket,[]);
});
