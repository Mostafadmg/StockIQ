import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {handleApi} from '../server/api.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<100;i++){if(check())return;await sleep(20);}throw new Error('Expected UI did not appear.');}
test('the mounted app opens a medicine result in the manual-order modal and keeps it mounted',async()=>{
 const {window}=parseHTML('<html><body><div id="app"></div><div id="toast"></div><div id="overlay"></div></body></html>');
 Object.defineProperty(window.HTMLOptionElement.prototype,'selected',{configurable:true,get(){return this.hasAttribute('selected');},set(value){this.toggleAttribute('selected',!!value);}});
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){const options=[...this.querySelectorAll('option')];const option=options.find(o=>o.selected||o.hasAttribute('selected'))||options[0];return option?.getAttribute('value')??option?.textContent??'';},set(value){for(const option of this.querySelectorAll('option')){option.selected=option.getAttribute('value')===String(value)||(!option.hasAttribute('value')&&option.textContent===String(value));option.toggleAttribute('selected',option.selected);}}});
 const doc=window.document,storage=new Map(),url=new URL('https://stockiq-ui.test/daily-orders');
 globalThis.window=window;globalThis.document=doc;globalThis.location=url;globalThis.history={pushState(_s,_t,path){url.href=new URL(path,url).href;},replaceState(_s,_t,path){url.href=new URL(path,url).href;}};
 globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))};globalThis.CSS={escape:value=>String(value)};window.scrollTo=()=>{};
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
 }finally{globalThis.fetch=originalFetch;globalThis.setInterval=originalInterval;}
});
