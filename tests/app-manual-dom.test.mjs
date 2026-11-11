import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {handleApi} from '../server/api.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<100;i++){if(check())return;await sleep(20);}throw new Error('Expected UI did not appear.');}
function mockSerialDevices(){
 const serial=new EventTarget(),ports=[];let requests=0;
 serial.requestPort=async()=>{
  requests++;
  const port=new EventTarget();port.opened=false;port.closed=0;port.cancelled=0;port.readable=null;
  port.open=async()=>{port.opened=true;port.readable=new ReadableStream({start(controller){port.controller=controller;},cancel(){port.cancelled++;}});};
  port.close=async()=>{assert.equal(port.readable?.locked,false,'Release the stream lock before closing the device');port.closed++;port.readable=null;};
  ports.push(port);return port;
 };
 return {serial,ports,get requests(){return requests;}};
}
test('the mounted app opens a medicine result in the manual-order modal and keeps it mounted',async()=>{
 const {window}=parseHTML('<html><body><div id="app"></div><div id="toast"></div><div id="overlay"></div></body></html>');
 Object.defineProperty(window.HTMLOptionElement.prototype,'selected',{configurable:true,get(){return this.hasAttribute('selected');},set(value){this.toggleAttribute('selected',!!value);}});
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){const options=[...this.querySelectorAll('option')];const option=options.find(o=>o.selected||o.hasAttribute('selected'))||options[0];return option?.getAttribute('value')??option?.textContent??'';},set(value){for(const option of this.querySelectorAll('option')){option.selected=option.getAttribute('value')===String(value)||(!option.hasAttribute('value')&&option.textContent===String(value));option.toggleAttribute('selected',option.selected);}}});
 const doc=window.document,storage=new Map(),url=new URL('https://stockiq-ui.test/daily-orders');
 globalThis.window=window;globalThis.document=doc;globalThis.location=url;globalThis.history={pushState(_s,_t,path){url.href=new URL(path,url).href;},replaceState(_s,_t,path){url.href=new URL(path,url).href;}};
 globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))};globalThis.CSS={escape:value=>String(value)};window.scrollTo=()=>{};
 const serialDevices=mockSerialDevices(),originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serial:serialDevices.serial}});
 const originalFetch=globalThis.fetch,originalInterval=globalThis.setInterval;globalThis.setInterval=(...args)=>{const timer=originalInterval(...args);timer.unref();return timer;};
 globalThis.fetch=(path,options={})=>handleApi(new Request(new URL(path,url),options));
 try{
  await import('../src/app.js?manual-dom-regression');try{await until(()=>doc.querySelector('.dmd-query'));}catch(error){throw new Error(error.message+' '+doc.body.textContent);}
  const initial=JSON.parse(storage.get('stockiq.test-workspace.v1')).workspace;
  const scan=doc.querySelector('.manual-scan-input');assert.ok(scan);
  scan.value=']d201050375630032351727123110BATCH42'+String.fromCharCode(29)+'21SERIAL-ROOT-TEST';
  const enter=new window.Event('keydown',{bubbles:true,cancelable:true});Object.defineProperty(enter,'key',{value:'Enter'});scan.dispatchEvent(enter);
  await until(()=>doc.querySelector('.manual-scan-summary')&&doc.querySelectorAll('.manual-comparison-row').length===7);
  const scanDialog=doc.querySelector('[role="dialog"]');assert.match(scanDialog.textContent,/Verapamil 160mg/);assert.match(scanDialog.textContent,/BATCH42/);assert.match(scanDialog.textContent,/2027-12-31/);assert.match(scanDialog.textContent,/Joint cheapest test total/);assert.equal(doc.querySelectorAll('[role="dialog"]').length,1);
  const scanned=JSON.parse(storage.get('stockiq.test-workspace.v1')).workspace;assert.equal(scanned.orders.length,initial.orders.length,'Scanning must not send an order');assert.deepEqual(scanned.basket,initial.basket);assert.equal(JSON.stringify(scanned).includes('SERIAL-ROOT-TEST'),false);assert.equal(doc.body.textContent.includes('SERIAL-ROOT-TEST'),false);assert.equal(scan.value,'');
  doc.querySelector('.manual-order-close').dispatchEvent(new window.Event('click',{bubbles:true}));await sleep(10);
  const input=doc.querySelector('.dmd-query');input.value='amoxicillin 500';input.dispatchEvent(new window.Event('input',{bubbles:true}));await until(()=>doc.querySelector('[data-dmd-index]'));
  const option=doc.querySelector('[data-dmd-index] strong');option.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));await sleep(10);
  const dialog=doc.querySelector('[role="dialog"]');assert.ok(dialog,'Choosing a result should mount the item modal');assert.match(dialog.textContent,/Amoxicillin/);assert.match(dialog.textContent,/Send now/);assert.match(dialog.textContent,/Add to basket/);assert.equal(doc.querySelectorAll('[role="dialog"]').length,1);
  await until(()=>doc.querySelector('.manual-order-quote-details')&&!doc.querySelector('.manual-order-send').disabled);
  const quantity=dialog.querySelector('[name="quantity"]');quantity.value='3';quantity.dispatchEvent(new window.Event('input',{bubbles:true}));
  const scenario=dialog.querySelector('[name="scenario"]');scenario.value='partial';scenario.dispatchEvent(new window.Event('change',{bubbles:true}));
  await until(()=>doc.querySelector('.manual-order-quote-status.is-partial')&&!doc.querySelector('.manual-order-send').disabled);
  dialog.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>doc.querySelector('.manual-order-result.is-partial'));
  const result=doc.querySelector('.manual-order-result');assert.match(result.textContent,/Requested3 packsAccepted2 packsUnavailable1 packs/);assert.match(result.textContent,/SIM-/);assert.match(result.textContent,/Estimated arrival/);assert.match(result.textContent,/Try remaining packs/);
  doc.querySelector('.manual-order-close').dispatchEvent(new window.Event('click',{bubbles:true}));await sleep(10);assert.equal(doc.querySelector('[role="dialog"]'),null);assert.ok(doc.querySelector('.dmd-query'));
  const workspace=JSON.parse(storage.get('stockiq.test-workspace.v1')).workspace;const sent=workspace.orders[0];assert.equal(sent.fulfilment.acceptedQuantity,2);assert.equal(sent.fulfilment.outstandingQuantity,1);assert.equal(workspace.basket.length,0);assert.equal(sent.items[0].received,0);
  const stockBefore=workspace.products.find(p=>p.id===sent.items[0].id).stock;
  doc.querySelector('[data-nav="goods"]').dispatchEvent(new window.Event('click',{bubbles:true}));
  const receive=doc.querySelector(`[data-action="receive"][data-id="${sent.id}"]`);assert.ok(receive);receive.dispatchEvent(new window.Event('click',{bubbles:true}));
  const receiptInput=doc.querySelector('[data-receive-id]');assert.equal(receiptInput.value,'2');assert.equal(receiptInput.getAttribute('max'),'2');
  doc.querySelector('[data-action="confirm-receive"]').dispatchEvent(new window.Event('click',{bubbles:true}));
  await until(()=>!doc.querySelector('#overlay [role="dialog"]'));
  const received=JSON.parse(storage.get('stockiq.test-workspace.v1')).workspace;assert.equal(received.orders[0].status,'Received');assert.equal(received.orders[0].items[0].received,2);assert.equal(received.products.find(p=>p.id===sent.items[0].id).stock,stockBefore+2);assert.equal(received.orders[0].fulfilment.outstandingQuantity,1);
  doc.querySelector('[data-action="account"]').dispatchEvent(new window.Event('click',{bubbles:true}));doc.querySelector('[data-nav="api"]').dispatchEvent(new window.Event('click',{bubbles:true}));
  doc.querySelector('[data-action="run-suite"]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>doc.querySelector('#toast').textContent.includes('15/15 API checks passed'));
  assert.equal(JSON.parse(storage.get('stockiq.test-workspace.v1')).workspace.orders.length,received.orders.length,'API console checks use a separate workspace');
  doc.querySelector('[data-nav="manual"]').dispatchEvent(new window.Event('click',{bubbles:true}));
  const addedRow=doc.querySelector('tr[data-manual-card]'),addedQuantity=addedRow.querySelector('[data-manual-quantity]'),addedId=addedRow.querySelector('[data-action="quick-add-manual-product"]').dataset.id;
  addedQuantity.value='2';const addedButton=addedRow.querySelector('[data-action="quick-add-manual-product"]');addedButton.dispatchEvent(new window.Event('click',{bubbles:true}));addedButton.dispatchEvent(new window.Event('click',{bubbles:true}));
  await until(()=>JSON.parse(storage.get('stockiq.test-workspace.v1')).workspace.basket.some(line=>line.id===addedId&&line.quantity===2));assert.equal(doc.querySelector('[role="dialog"]'),null,'An added medicine has a direct basket route');
  const workspaceCard=doc.querySelector('.workspace-product-entry'),workspaceQuantity=workspaceCard.querySelector('[data-manual-quantity]'),workspaceId=workspaceCard.querySelector('[data-action="choose-manual-product"]').dataset.id;
  workspaceQuantity.value='4';workspaceCard.querySelector('[data-action="choose-manual-product"]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>doc.querySelector('.manual-order-form'));assert.equal(doc.querySelector('[name="quantity"]').value,'4','The original card still opens the ordering modal with its own quantity');doc.querySelector('.manual-order-close').dispatchEvent(new window.Event('click',{bubbles:true}));
  const refreshedCard=doc.querySelector('.workspace-product-entry');refreshedCard.querySelector('[data-manual-quantity]').value='3';const workspaceButton=refreshedCard.querySelector('[data-action="quick-add-manual-product"]');workspaceButton.dispatchEvent(new window.Event('click',{bubbles:true}));workspaceButton.dispatchEvent(new window.Event('click',{bubbles:true}));
  await until(()=>JSON.parse(storage.get('stockiq.test-workspace.v1')).workspace.basket.some(line=>line.id===workspaceId&&line.quantity===3));const afterQuickAdd=JSON.parse(storage.get('stockiq.test-workspace.v1')).workspace;assert.equal(afterQuickAdd.orders.length,received.orders.length,'Quick add never submits an order');assert.equal(afterQuickAdd.basket.find(line=>line.id===addedId).quantity,2,'Separate row quantities are preserved');assert.equal(doc.querySelector('[role="dialog"]'),null);assert.equal(doc.querySelector('.continue-button').disabled,false);
  // A CDC scanner stays owned by this page between item modals, until Cancel or navigation.
  const beforeSerial=JSON.parse(storage.get('stockiq.test-workspace.v1')).workspace;
  const serialInput=doc.querySelector('.manual-scan-input');
  doc.querySelector('.manual-serial-connect').dispatchEvent(new window.Event('click',{bubbles:true}));
  assert.equal(serialDevices.requests,1,'Request a port directly from the explicit Connect click');
  await until(()=>serialDevices.ports[0]?.opened&&serialDevices.ports[0]?.readable?.locked);
  const port=serialDevices.ports[0],encoder=new TextEncoder();
  const code=']d201050375630032351727123110SERIAL-BATCH'+String.fromCharCode(29)+'21PRIVATE-SERIAL-APP';
  port.controller.enqueue(encoder.encode(code.slice(0,25)));port.controller.enqueue(encoder.encode(code.slice(25)+'\r\n'));
  await until(()=>doc.querySelector('.manual-scan-summary')&&doc.querySelectorAll('.manual-comparison-row').length===7);
  assert.match(doc.querySelector('[role="dialog"]').textContent,/Verapamil 160mg/);assert.match(doc.querySelector('.manual-scan-summary').textContent,/SERIAL-BATCH/);
  const afterSerial=JSON.parse(storage.get('stockiq.test-workspace.v1')).workspace;
  assert.deepEqual(afterSerial.basket,beforeSerial.basket,'Receiving a serial frame never adds to the basket');assert.equal(afterSerial.orders.length,beforeSerial.orders.length,'Receiving a serial frame never sends an order');
  assert.equal(JSON.stringify(afterSerial).includes('PRIVATE-SERIAL-APP'),false);assert.equal(doc.body.textContent.includes('PRIVATE-SERIAL-APP'),false);
  doc.querySelector('.manual-order-close').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!doc.querySelector('[role="dialog"]'));
  assert.equal(doc.querySelector('.manual-scan-input'),serialInput,'Closing an item modal retains the active serial picker');assert.equal(port.closed,0,'The active session is not released between packs');
  port.controller.enqueue(encoder.encode('5037563003235\r\n'));
  await until(()=>doc.querySelector('.manual-scan-summary'));assert.match(doc.querySelector('[role="dialog"]').textContent,/Verapamil 160mg/);
  doc.querySelector('.manual-serial-release').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>port.closed===1);
  assert.ok(doc.querySelector('[role="dialog"]'),'Cancel scanner releases the device without dismissing the item');assert.equal(port.cancelled,1);
  doc.querySelector('.manual-order-close').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>!doc.querySelector('[role="dialog"]'));
  doc.querySelector('.manual-serial-connect').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>serialDevices.ports[1]?.readable?.locked);
  doc.querySelector('[data-nav="history"]').dispatchEvent(new window.Event('click',{bubbles:true}));await until(()=>serialDevices.ports[1].closed===1);
  assert.equal(serialDevices.ports[1].cancelled,1,'Leaving Manual Orders releases the serial reader');assert.equal(doc.querySelector('.manual-serial-connect'),null);
 }finally{globalThis.fetch=originalFetch;globalThis.setInterval=originalInterval;if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;}
});
