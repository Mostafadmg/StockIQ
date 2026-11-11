import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {handleApi} from '../server/api.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<100;i++){if(check())return;await sleep(20);}throw new Error('Expected UI did not appear.');}
test('the mounted app opens a medicine result in the manual-order modal and keeps it mounted',async()=>{
 const {window}=parseHTML('<html><body><div id="app"></div><div id="toast"></div><div id="overlay"></div></body></html>');
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){const options=[...this.querySelectorAll('option')];const option=options.find(o=>o.selected||o.hasAttribute('selected'))||options[0];return option?.getAttribute('value')??option?.textContent??'';},set(value){for(const option of this.querySelectorAll('option')){option.selected=option.getAttribute('value')===String(value)||(!option.hasAttribute('value')&&option.textContent===String(value));option.toggleAttribute('selected',option.selected);}}});
 const doc=window.document,storage=new Map(),url=new URL('https://stockiq-ui.test/daily-orders');
 globalThis.window=window;globalThis.document=doc;globalThis.location=url;globalThis.history={pushState(_s,_t,path){url.href=new URL(path,url).href;},replaceState(_s,_t,path){url.href=new URL(path,url).href;}};
 globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))};globalThis.CSS={escape:value=>String(value)};window.scrollTo=()=>{};
 const originalFetch=globalThis.fetch,originalInterval=globalThis.setInterval;globalThis.setInterval=(...args)=>{const timer=originalInterval(...args);timer.unref();return timer;};
 globalThis.fetch=(path,options={})=>handleApi(new Request(new URL(path,url),options));
 try{
  await import('../src/app.js?manual-dom-regression');try{await until(()=>doc.querySelector('.dmd-query'));}catch(error){throw new Error(error.message+' '+doc.body.textContent);}
  const input=doc.querySelector('.dmd-query');input.value='amoxicillin 500';input.dispatchEvent(new window.Event('input',{bubbles:true}));await until(()=>doc.querySelector('[data-dmd-index]'));
  const option=doc.querySelector('[data-dmd-index] strong');option.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));await sleep(10);
  const dialog=doc.querySelector('[role="dialog"]');assert.ok(dialog,'Choosing a result should mount the item modal');assert.match(dialog.textContent,/Amoxicillin/);assert.match(dialog.textContent,/Send now/);assert.match(dialog.textContent,/Add to basket/);assert.equal(doc.querySelectorAll('[role="dialog"]').length,1);
  doc.querySelector('.manual-order-close').dispatchEvent(new window.Event('click',{bubbles:true}));await sleep(10);assert.equal(doc.querySelector('[role="dialog"]'),null);assert.ok(doc.querySelector('.dmd-query'));
 }finally{globalThis.fetch=originalFetch;globalThis.setInterval=originalInterval;}
});
