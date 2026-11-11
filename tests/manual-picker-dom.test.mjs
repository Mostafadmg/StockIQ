import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountManualSearch} from '../src/manual-search.js';

const pack={id:'1477411000001105',type:'AMPP',name:'Amoxicillin 500mg capsules',pack:'100 capsule',source:'NHS dm+d'};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function setup({record=pack,packError=false}={}){
 const {document,window}=parseHTML('<!doctype html><html><body><div id="app"><div id="host"></div></div></body></html>');
 // Linkedom omits selection setters and focus state; supply browser-like behavior
 // without replacing application event listeners or component code.
 Object.defineProperty(window.HTMLOptionElement.prototype,'selected',{configurable:true,get(){return this.hasAttribute('selected');},set(value){if(value)this.setAttribute('selected','');else this.removeAttribute('selected');}});
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return (this.querySelector('option[selected]')||this.querySelector('option'))?.value||'';},set(value){for(const option of this.querySelectorAll('option'))option.selected=option.value===String(value);}});
 let focused=document.body;Object.defineProperty(document,'activeElement',{configurable:true,get:()=>focused});
 window.HTMLElement.prototype.focus=function(){focused=this;this.dispatchEvent(new window.Event('focus'));};
 const request=async path=>path.startsWith('/api/dmd/packs')?{ok:!packError,error:packError?'Pack service unavailable':undefined,data:{packs:[pack]}}:{ok:true,data:{matches:[record],releaseDate:'2026-11-09'}};
 const cleanup=mountManualSearch({host:document.querySelector('#host'),request,onAdd:async()=>({}),onSend:async()=>({order:{id:'TEST-2000',status:'Awaiting',supplier:'AAH',items:[{quantity:1}],total:1},simulated:true})});
 const emit=(target,type,properties={})=>{const event=new window.Event(type,{bubbles:true,cancelable:true});for(const [name,value] of Object.entries(properties))Object.defineProperty(event,name,{value});target.dispatchEvent(event);return event;};
 return {document,window,cleanup,emit,setFocused:element=>focused=element,input:document.querySelector('.dmd-query')};
}
async function results(context){context.input.value='amoxicillin';context.input.focus();context.emit(context.input,'input');await pause(275);const option=context.document.querySelector('[data-dmd-index]');assert.ok(option,'Search returns a real mounted dropdown option');return option;}
function buttons(document){return [...document.querySelectorAll('[role="dialog"] button')].map(button=>button.textContent);}

test('touch tap opens the medicine modal even when input focus leaves before pointerup',async()=>{const c=setup();try{const option=await results(c);const down=c.emit(option,'pointerdown',{pointerType:'touch',pointerId:7,clientX:30,clientY:40});assert.equal(down.defaultPrevented,false,'Touch pointerdown keeps native tap behavior');c.setFocused(c.document.body);c.emit(c.input,'focusout');await Promise.resolve();assert.equal(c.document.querySelector('.dmd-popover').hidden,false,'The result remains visible throughout a touch gesture');c.emit(option,'pointerup',{pointerType:'touch',pointerId:7,clientX:31,clientY:42});await Promise.resolve();const dialog=c.document.querySelector('[role="dialog"]');assert.ok(dialog?.isConnected);assert.ok(buttons(c.document).includes('Send now'));assert.ok(buttons(c.document).includes('Add to basket'));const quantity=dialog.querySelector('input[name="quantity"]');quantity.value='3';c.emit(option,'click');assert.equal(c.document.querySelectorAll('[role="dialog"]').length,1);assert.equal(dialog.querySelector('input[name="quantity"]').value,'3','Synthetic click after pointerup does not reopen or reset the modal');dialog.querySelector('.manual-order-close').click();assert.equal(c.document.querySelector('[role="dialog"]'),null);assert.equal(c.document.body.style.overflow,'');}finally{c.cleanup();}});

test('pen tap opens the modal and a scrolling touch gesture does not select a result',async()=>{const c=setup();try{const option=await results(c);c.emit(option,'pointerdown',{pointerType:'touch',pointerId:8,clientX:30,clientY:40});c.emit(option,'pointermove',{pointerType:'touch',pointerId:8,clientX:30,clientY:80});c.emit(option,'pointerup',{pointerType:'touch',pointerId:8,clientX:30,clientY:80});c.emit(option,'click');assert.equal(c.document.querySelector('[role="dialog"]'),null);c.emit(option,'pointerdown',{pointerType:'pen',pointerId:9,clientX:30,clientY:40});c.emit(option,'pointerup',{pointerType:'pen',pointerId:9,clientX:30,clientY:40});assert.ok(c.document.querySelector('[role="dialog"]')?.isConnected);}finally{c.cleanup();}});

test('mouse/native click and keyboard Enter continue to open the selected medicine',async()=>{for(const mode of ['click','keyboard']){const c=setup();try{const option=await results(c);if(mode==='click'){c.emit(option,'pointerdown',{pointerType:'mouse',pointerId:1,clientX:30,clientY:40});c.emit(option,'click');}else{c.emit(c.input,'keydown',{key:'ArrowDown'});c.emit(c.input,'keydown',{key:'Enter'});}assert.ok(c.document.querySelector('[role="dialog"]')?.isConnected,mode);assert.ok(buttons(c.document).includes('Send now'));}finally{c.cleanup();}}});

test('grouped pack lookup errors are displayed inside the opened modal',async()=>{const c=setup({record:{id:'39732411000001106',type:'VMP',name:'Amoxicillin 500mg capsules'},packError:true});try{const option=await results(c);c.emit(option,'click');await Promise.resolve();await Promise.resolve();const dialog=c.document.querySelector('[role="dialog"]');assert.ok(dialog?.isConnected);assert.match(dialog.textContent,/Pack service unavailable/);assert.equal(c.document.querySelector('.manual-order-send'),null);}finally{c.cleanup();}});
