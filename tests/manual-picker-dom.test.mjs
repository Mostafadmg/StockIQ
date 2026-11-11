import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountManualSearch} from '../src/manual-search.js';

const pack={id:'1477411000001105',type:'AMPP',name:'Amoxicillin 500mg capsules',pack:'100 capsule',source:'NHS dm+d'};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function setup({record=pack,packError=false,onQuote,onCompare,onClose,serial,request:requestOverride,onAdd=async()=>({}),onSend=async()=>({order:{id:'TEST-2000',status:'Awaiting',supplier:'AAH',items:[{quantity:1}],total:1},simulated:true})}={}){
 const {document,window}=parseHTML('<!doctype html><html><body><div id="app"><div id="host"></div></div></body></html>');
 // Linkedom omits selection setters and focus state; supply browser-like behavior
 // without replacing application event listeners or component code.
 Object.defineProperty(window.HTMLOptionElement.prototype,'selected',{configurable:true,get(){return this.hasAttribute('selected');},set(value){if(value)this.setAttribute('selected','');else this.removeAttribute('selected');}});
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return (this.querySelector('option[selected]')||this.querySelector('option'))?.value||'';},set(value){for(const option of this.querySelectorAll('option'))option.selected=option.value===String(value);}});
 let focused=document.body;Object.defineProperty(document,'activeElement',{configurable:true,get:()=>focused});
 window.HTMLElement.prototype.focus=function(){focused=this;this.dispatchEvent(new window.Event('focus'));};
 const request=async(...args)=>requestOverride?requestOverride(...args):args[0].startsWith('/api/dmd/packs')?{ok:!packError,error:packError?'Pack service unavailable':undefined,data:{packs:[pack]}}:{ok:true,data:{matches:[record],releaseDate:'2026-11-09'}};
 const cleanup=mountManualSearch({host:document.querySelector('#host'),request,onAdd,onSend,onQuote,onCompare,onClose,serial});
 const emit=(target,type,properties={})=>{const event=new window.Event(type,{bubbles:true,cancelable:true});for(const [name,value] of Object.entries(properties))Object.defineProperty(event,name,{value});target.dispatchEvent(event);return event;};
 return {document,window,cleanup,emit,setFocused:element=>focused=element,input:document.querySelector('.dmd-query')};
}
async function results(context){context.input.value='amoxicillin';context.input.focus();context.emit(context.input,'input');await pause(275);const option=context.document.querySelector('[data-dmd-index]');assert.ok(option,'Search returns a real mounted dropdown option');return option;}
function buttons(document){return [...document.querySelectorAll('[role="dialog"] button')].map(button=>button.textContent);}

test('touch tap opens the medicine modal even when input focus leaves before pointerup',async()=>{const c=setup();try{const option=await results(c);const down=c.emit(option,'pointerdown',{pointerType:'touch',pointerId:7,clientX:30,clientY:40});assert.equal(down.defaultPrevented,false,'Touch pointerdown keeps native tap behavior');c.setFocused(c.document.body);c.emit(c.input,'focusout');await Promise.resolve();assert.equal(c.document.querySelector('.dmd-popover').hidden,false,'The result remains visible throughout a touch gesture');c.emit(option,'pointerup',{pointerType:'touch',pointerId:7,clientX:31,clientY:42});await Promise.resolve();const dialog=c.document.querySelector('[role="dialog"]');assert.ok(dialog?.isConnected);assert.ok(buttons(c.document).includes('Send now'));assert.ok(buttons(c.document).includes('Add to basket'));const quantity=dialog.querySelector('input[name="quantity"]');quantity.value='3';c.emit(option,'click');assert.equal(c.document.querySelectorAll('[role="dialog"]').length,1);assert.equal(dialog.querySelector('input[name="quantity"]').value,'3','Synthetic click after pointerup does not reopen or reset the modal');dialog.querySelector('.manual-order-close').click();assert.equal(c.document.querySelector('[role="dialog"]'),null);assert.equal(c.document.body.style.overflow,'');}finally{c.cleanup();}});

test('pen tap opens the modal and a scrolling touch gesture does not select a result',async()=>{const c=setup();try{const option=await results(c);c.emit(option,'pointerdown',{pointerType:'touch',pointerId:8,clientX:30,clientY:40});c.emit(option,'pointermove',{pointerType:'touch',pointerId:8,clientX:30,clientY:80});c.emit(option,'pointerup',{pointerType:'touch',pointerId:8,clientX:30,clientY:80});c.emit(option,'click');assert.equal(c.document.querySelector('[role="dialog"]'),null);c.emit(option,'pointerdown',{pointerType:'pen',pointerId:9,clientX:30,clientY:40});c.emit(option,'pointerup',{pointerType:'pen',pointerId:9,clientX:30,clientY:40});assert.ok(c.document.querySelector('[role="dialog"]')?.isConnected);}finally{c.cleanup();}});

test('mouse/native click and keyboard Enter continue to open the selected medicine',async()=>{for(const mode of ['click','keyboard']){const c=setup();try{const option=await results(c);if(mode==='click'){c.emit(option,'pointerdown',{pointerType:'mouse',pointerId:1,clientX:30,clientY:40});c.emit(option,'click');}else{c.emit(c.input,'keydown',{key:'ArrowDown'});c.emit(c.input,'keydown',{key:'Enter'});}assert.ok(c.document.querySelector('[role="dialog"]')?.isConnected,mode);assert.ok(buttons(c.document).includes('Send now'));}finally{c.cleanup();}}});

test('grouped pack lookup errors are displayed inside the opened modal',async()=>{const c=setup({record:{id:'39732411000001106',type:'VMP',name:'Amoxicillin 500mg capsules'},packError:true});try{const option=await results(c);c.emit(option,'click');await Promise.resolve();await Promise.resolve();const dialog=c.document.querySelector('[role="dialog"]');assert.ok(dialog?.isConnected);assert.match(dialog.textContent,/Pack service unavailable/);assert.equal(c.document.querySelector('.manual-order-send'),null);}finally{c.cleanup();}});

const quoteFixture=(selection,extra={})=>({simulated:true,scenario:selection.scenario||'full',supplier:selection.supplier,sourceLabel:selection.supplier,status:'accepted',requestedQuantity:selection.quantity,acceptedQuantity:selection.quantity,outstandingQuantity:0,unitPrice:1.25,estimatedTotal:selection.quantity*1.25,delivery:{estimatedArrivalAt:'2026-11-12T09:00:00Z',orderBy:'2026-11-11T19:00:00Z',workingDays:1,serviceLabel:'Next working day',basis:'schedule_estimate',timezone:'Europe/London',note:'Estimated from the saved test schedule; supplier delivery is not confirmed.'},...extra});
async function waitFor(check){for(let i=0;i<70;i++){if(check())return;await pause(15);}throw new Error('Expected picker state did not appear');}

test('supplier estimates prevent sending while loading and show source, price, quantities and dated delivery',async()=>{
 let finish,sendCalls=0;const c=setup({onQuote:selection=>new Promise(resolve=>finish=()=>resolve(quoteFixture(selection))),onSend:async()=>{sendCalls++;return {};}});
 try{const option=await results(c);c.emit(option,'click');await waitFor(()=>finish);const form=c.document.querySelector('.manual-order-form');assert.equal(form.querySelector('.manual-order-send').disabled,true);c.emit(form,'submit');assert.equal(sendCalls,0);finish();await waitFor(()=>!form.querySelector('.manual-order-send').disabled);const quote=c.document.querySelector('.manual-order-quote');assert.match(quote.textContent,/Coming fromPhoenix/);assert.match(quote.textContent,/1 of 1 packs/);assert.match(quote.textContent,/£1.25/);assert.match(quote.textContent,/Next working day/);assert.match(quote.textContent,/12 Nov/);assert.match(quote.textContent,/not confirmed/);}finally{c.cleanup();}
});

test('edited supplier discards the stale quote and quotes are serialized before sending',async()=>{
 const pending=[],calls=[];const c=setup({onQuote:selection=>{calls.push(selection.supplier);return new Promise(resolve=>pending.push(()=>resolve(quoteFixture(selection))));}});
 try{const option=await results(c);c.emit(option,'click');await waitFor(()=>pending.length===1);const supplier=c.document.querySelector('select[name="supplier"]');supplier.value='AAH';c.emit(supplier,'change');await pause(200);assert.deepEqual(calls,['Phoenix']);pending[0]();await waitFor(()=>pending.length===2);assert.equal(c.document.querySelector('.manual-order-send').disabled,true);assert.doesNotMatch(c.document.querySelector('.manual-order-quote').textContent,/Coming fromPhoenix/);pending[1]();await waitFor(()=>!c.document.querySelector('.manual-order-send').disabled);assert.deepEqual(calls,['Phoenix','AAH']);assert.match(c.document.querySelector('.manual-order-quote').textContent,/Coming fromAAH/);}finally{c.cleanup();}
});

test('quote errors retain Add to basket and require a successful retry before sending',async()=>{
 let fail=true;const c=setup({onQuote:async selection=>{if(fail)throw new Error('Supplier check unavailable');return quoteFixture(selection);}});
 try{const option=await results(c);c.emit(option,'click');await waitFor(()=>c.document.querySelector('.manual-order-quote-retry'));assert.equal(c.document.querySelector('.manual-order-send').disabled,true);assert.equal(c.document.querySelector('.manual-order-add').disabled,false);assert.match(c.document.querySelector('.manual-order-quote').textContent,/Supplier check unavailable/);fail=false;c.document.querySelector('.manual-order-quote-retry').click();await waitFor(()=>!c.document.querySelector('.manual-order-send').disabled);assert.match(c.document.querySelector('.manual-order-quote').textContent,/Available/);}finally{c.cleanup();}
});

test('partial and unavailable responses report actual accepted packs and only retry the remainder on request',async()=>{
 for(const outcome of ['partial','unavailable']){let sends=0;const responses=[];const c=setup({onQuote:async selection=>quoteFixture(selection),onSend:async selection=>{sends++;responses.push(selection);const accepted=outcome==='partial'?2:0;return {order:{id:'TEST-2001',supplier:selection.supplier,total:accepted*1.25,items:[{quantity:selection.quantity,acceptedQuantity:accepted}],fulfilment:quoteFixture(selection,{status:outcome,acceptedQuantity:accepted,outstandingQuantity:selection.quantity-accepted,supplierReference:'SIM-AAH-2001'})},simulated:true};}});
  try{c.cleanup.openProduct(pack,{quantity:5});await waitFor(()=>!c.document.querySelector('.manual-order-send').disabled);const scenario=c.document.querySelector('select[name="scenario"]');scenario.value=outcome;c.emit(scenario,'change');await waitFor(()=>!c.document.querySelector('.manual-order-send').disabled);c.emit(c.document.querySelector('.manual-order-form'),'submit');await waitFor(()=>c.document.querySelector('.manual-order-result'));const result=c.document.querySelector('.manual-order-result');assert.equal(sends,1);assert.equal(responses[0].scenario,outcome);assert.ok(result.classList.contains('is-'+outcome));assert.doesNotMatch(result.querySelector('h3').textContent,/^Test order accepted$/);assert.match(result.textContent,/SIM-AAH-2001/);assert.match(result.textContent,outcome==='partial'?/Accepted2 packs/:/Accepted0 packs/);assert.match(result.textContent,/not backordered/);if(outcome==='unavailable')assert.match(result.textContent,/No delivery expected/);result.querySelector('.manual-order-remaining').click();assert.equal(c.document.querySelector('input[name="quantity"]').value,outcome==='partial'?'3':'5');assert.equal(sends,1,'Reviewing the remainder never automatically sends an order');assert.equal(c.document.querySelector('.manual-order-result'),null);}finally{c.cleanup();}
 }
});


const barcodePack={id:'1327911000001107',type:'AMPP',name:'Verapamil 160mg tablets',pack:'56 tablet',source:'NHS dm+d'};
const barcodeResponse=(extra={})=>({ok:true,data:{gtin:'05037563003235',format:'gs1',batch:'LOT-5',expiry:'2025-01-31',expiryRaw:'250131',warnings:[],source:'NHS dm+d',matches:[barcodePack],...extra}});

function serialFixture({openError}={}){
 let streamController,requests=0,closed=0,opened;
 const readable=new ReadableStream({start(controller){streamController=controller;}});
 const port={readable,async open(options){opened=options;if(openError)throw openError;},async close(){closed++;}};
 return {serial:{requestPort(){requests++;return Promise.resolve(port);}},push:text=>streamController.enqueue(new TextEncoder().encode(text)),get requests(){return requests;},get closed(){return closed;},get opened(){return opened;}};
}

test('USB CDC serial scanning opens the existing review modal and Cancel releases its port without ordering',async()=>{
 const device=serialFixture(),lookups=[];let mutations=0;const c=setup({serial:device.serial,request:async(path,method,data)=>{lookups.push({path,method,data});return barcodeResponse();},onAdd:async()=>mutations++,onSend:async()=>mutations++});
 try{
  c.document.querySelector('.manual-serial-connect').click();assert.equal(device.requests,1,'The browser chooser starts in the original click stack');await waitFor(()=>device.opened&&c.document.querySelector('.manual-serial-status').textContent.includes('ready'));
  assert.equal(device.opened.baudRate,9600);assert.equal(c.document.querySelector('.manual-serial-baud').disabled,true);assert.equal(c.cleanup.hasSerialSession(),true);
  device.push(']d201050375630032351725013110LOT-5\u001d');device.push('21PRIVATE-SERIAL\r\n');await waitFor(()=>c.document.querySelector('[role="dialog"]'));
  assert.equal(lookups.length,1);assert.equal(lookups[0].path,'/api/dmd/barcode');assert.ok(lookups[0].data.barcode.includes('\u001d'));assert.equal(mutations,0);assert.doesNotMatch(c.document.body.textContent,/PRIVATE-SERIAL/);
  const release=c.document.querySelector('.manual-serial-release');assert.equal(release.hidden,false);release.click();await waitFor(()=>device.closed===1);assert.ok(c.document.querySelector('[role="dialog"]'),'Releasing hardware preserves the review modal');assert.equal(c.cleanup.hasSerialSession(),false);assert.match(c.document.querySelector('.manual-serial-modal-status').textContent,/Proscript may need/);assert.equal(mutations,0);
 }finally{c.cleanup();}
});

test('serial session remains ready after closing a review and drops input received while that review is open',async()=>{
 const device=serialFixture(),closes=[];let lookups=0;const c=setup({serial:device.serial,onClose:options=>closes.push(options),request:async()=>{lookups++;return barcodeResponse();}});
 try{
  c.document.querySelector('.manual-serial-connect').click();await waitFor(()=>device.opened);device.push('5037563003235\r');await waitFor(()=>c.document.querySelector('[role="dialog"]'));
  device.push('IGNORED-PARTIAL');await pause(15);c.document.querySelector('.manual-order-close').click();assert.deepEqual(closes,[{serialActive:true}]);assert.equal(device.closed,0);assert.equal(c.cleanup.hasSerialSession(),true);
  device.push('5037563003235\r');await pause(20);assert.equal(lookups,1,'A checksum-valid suffix of the ignored scan stays discarded until its terminator');assert.equal(c.document.querySelector('[role="dialog"]'),null);
  device.push('5037563003235\r');await waitFor(()=>lookups===2);assert.ok(c.document.querySelector('[role="dialog"]'));assert.equal(lookups,2);c.cleanup();await waitFor(()=>device.closed===1);assert.equal(c.document.querySelector('[role="dialog"]'),null);
 }finally{c.cleanup();}
});

test('serial data without a suffix waits for Find pack and never displays the raw serial payload',async()=>{
 const device=serialFixture();let scanned;const c=setup({serial:device.serial,request:async(path,method,data)=>{scanned=data.barcode;return barcodeResponse();}});
 try{
  c.document.querySelector('.manual-serial-connect').click();await waitFor(()=>device.opened);device.push('01050375630032351725013110LOT-5\u001d21PRIVATE-SERIAL');await waitFor(()=>c.document.querySelector('.manual-scan-status').textContent.includes('Receiving'));
  assert.equal(scanned,undefined);assert.equal(c.document.querySelector('.manual-scan-input').value,'');assert.doesNotMatch(c.document.body.textContent,/PRIVATE-SERIAL/);c.document.querySelector('.manual-scan-lookup').click();await waitFor(()=>c.document.querySelector('[role="dialog"]'));assert.equal(scanned,'01050375630032351725013110LOT-5\u001d21PRIVATE-SERIAL');
 }finally{c.cleanup();}
});

test('cancelling serial lookup prevents a late response from opening a modal and busy ports retain keyboard scanning',async()=>{
 const device=serialFixture();let resolveLookup;const c=setup({serial:device.serial,request:()=>new Promise(resolve=>resolveLookup=resolve)});
 try{
  c.document.querySelector('.manual-serial-connect').click();await waitFor(()=>device.opened);device.push('5037563003235\r');await waitFor(()=>resolveLookup);c.document.querySelector('.manual-serial-cancel').click();await waitFor(()=>device.closed===1);resolveLookup(barcodeResponse());await pause(15);assert.equal(c.document.querySelector('[role="dialog"]'),null);assert.equal(c.document.querySelector('.manual-scan-input').readOnly,false);
 }finally{c.cleanup();}
 const busy=serialFixture({openError:Object.assign(new Error('private operating system message'),{name:'NetworkError'})}),d=setup({serial:busy.serial});
 try{d.document.querySelector('.manual-serial-connect').click();await waitFor(()=>d.document.querySelector('.manual-serial-status').classList.contains('is-error'));assert.match(d.document.querySelector('.manual-serial-status').textContent,/ProScript or another application/);assert.doesNotMatch(d.document.body.textContent,/private operating system message/);assert.equal(d.document.querySelector('.manual-scan-focus').disabled,false);assert.equal(d.document.querySelector('.manual-serial-connect').disabled,false);}finally{d.cleanup();}
});

test('unsupported serial browsers explain desktop access while keyboard barcode entry remains available',()=>{
 const c=setup({serial:{}});try{assert.equal(c.document.querySelector('.manual-serial-connect').disabled,true);assert.match(c.document.querySelector('.manual-serial-status').textContent,/desktop Chrome or Edge/);assert.match(c.document.querySelector('.manual-serial-status').textContent,/directly/);assert.equal(c.document.querySelector('.manual-scan-focus').disabled,false);assert.equal(c.document.querySelector('.manual-serial-cancel').hidden,true);}finally{c.cleanup();}
});

test('scanner Enter and Tab identify an exact pack once and never add or send it automatically',async()=>{
 for(const suffix of ['Enter','Tab']){let lookups=0,mutations=0;const c=setup({request:async(path,method,data)=>{assert.equal(path,'/api/dmd/barcode');assert.equal(method,'POST');assert.equal(data.barcode,'5037563003235');lookups++;return barcodeResponse({serial:'DO-NOT-DISPLAY'});},onAdd:async()=>mutations++,onSend:async()=>mutations++});
  try{const input=c.document.querySelector('.manual-scan-input');c.document.querySelector('.manual-scan-focus').click();assert.equal(c.document.activeElement,input);input.value='5037563003235';const event=c.emit(input,'keydown',{key:suffix});assert.equal(event.defaultPrevented,true);c.emit(input,'keydown',{key:'Enter'});await waitFor(()=>c.document.querySelector('[role="dialog"]'));assert.equal(lookups,1);assert.equal(mutations,0);assert.equal(input.value,'');assert.equal(c.document.querySelector('[name="quantity"]').value,'1');const summary=c.document.querySelector('.manual-scan-summary');assert.match(summary.textContent,/05037563003235/);assert.match(summary.textContent,/LOT-5/);assert.match(summary.textContent,/2025-01-31/);assert.ok(summary.classList.contains('is-expired'));assert.doesNotMatch(c.document.body.textContent,/DO-NOT-DISPLAY/);c.document.querySelector('.manual-order-close').click();c.cleanup.openProduct(pack);assert.equal(c.document.querySelector('.manual-scan-summary'),null,'Scan metadata does not leak into the next manual selection');}finally{c.cleanup();}
 }
});

test('scanner Ctrl+] preserves the GS1 field separator and paste keeps raw control boundaries',async()=>{
 let scanned;const c=setup({request:async(path,method,data)=>{scanned=data.barcode;return barcodeResponse();}});
 try{const input=c.document.querySelector('.manual-scan-input');input.value='010503756300323510LOT-5';const separator=c.emit(input,'keydown',{key:']',ctrlKey:true});assert.equal(separator.defaultPrevented,true);assert.ok(input.value.endsWith('\u001d'));input.value+='1725013121EXAMPLE-SERIAL';c.emit(input,'keydown',{key:'Enter'});await waitFor(()=>scanned);assert.equal(scanned,'010503756300323510LOT-5\u001d1725013121EXAMPLE-SERIAL');assert.doesNotMatch(c.document.body.textContent,/EXAMPLE-SERIAL/);}finally{c.cleanup();}
 const d=setup({request:async(path,method,data)=>{scanned=data.barcode;return barcodeResponse();}});try{const input=d.document.querySelector('.manual-scan-input'),value=']d201050375630032351725013110LOT-5\u001d21EXAMPLE';const paste=d.emit(input,'paste',{clipboardData:{getData:()=>value}});assert.equal(paste.defaultPrevented,true);assert.equal(input.value,value);d.document.querySelector('.manual-scan-lookup').click();await waitFor(()=>d.document.querySelector('[role="dialog"]'));assert.equal(scanned,value);}finally{d.cleanup();}
});

test('unknown barcodes show a clear lookup result without a fake match or order modal',async()=>{
 const c=setup({request:async()=>barcodeResponse({matches:[]})});try{const input=c.document.querySelector('.manual-scan-input');input.value='5037563003235';c.document.querySelector('.manual-scan-lookup').click();await waitFor(()=>c.document.querySelector('.manual-scan-status').classList.contains('is-error'));assert.match(c.document.querySelector('.manual-scan-status').textContent,/No NHS dm.d pack matches/);assert.equal(c.document.querySelector('[role="dialog"]'),null);assert.equal(c.document.querySelector('.dmd-options').children.length,0);}finally{c.cleanup();}
});

test('ambiguous and historical/container barcode matches require an explicit pack choice',async()=>{
 for(const response of [barcodeResponse({matches:[barcodePack,pack],ambiguous:true}),barcodeResponse({historical:true,requiresPackConfirmation:true}),barcodeResponse({requiresPackConfirmation:true})]){const c=setup({request:async()=>response});try{const input=c.document.querySelector('.manual-scan-input');input.value='5037563003235';c.emit(input,'keydown',{key:'Enter'});await waitFor(()=>c.document.querySelector('.manual-scan-match'));assert.equal(c.document.querySelector('[role="dialog"]'),null);const choices=c.document.querySelectorAll('.manual-scan-match');choices[choices.length-1].click();assert.ok(c.document.querySelector('[role="dialog"]'));assert.equal(c.document.querySelector('[name="quantity"]').value,'1');if(response.data.historical)assert.match(c.document.querySelector('.manual-scan-summary').textContent,/historical NHS barcode/);}finally{c.cleanup();}}
});

test('a late barcode response cannot interrupt a newer medicine-name search',async()=>{
 let finish;const c=setup({request:async path=>path==='/api/dmd/barcode'?new Promise(resolve=>finish=()=>resolve(barcodeResponse())):{ok:true,data:{matches:[pack]}}});try{const input=c.document.querySelector('.manual-scan-input');input.value='5037563003235';c.emit(input,'keydown',{key:'Enter'});await waitFor(()=>finish);c.input.value='amoxicillin';c.emit(c.input,'input');finish();await pause(300);assert.equal(c.document.querySelector('[role="dialog"]'),null);assert.match(c.document.querySelector('.dmd-options').textContent,/Amoxicillin/);}finally{c.cleanup();}
});

test('a newer unknown or ambiguous scan discards an older medicine search response',async()=>{
 for(const matches of [[],[barcodePack,pack]]){let finish;const c=setup({request:async path=>path==='/api/dmd/barcode'?barcodeResponse({matches}):new Promise(resolve=>finish=()=>resolve({ok:true,data:{matches:[pack]}}))});
  try{c.input.value='amoxicillin';c.emit(c.input,'input');await waitFor(()=>finish);const input=c.document.querySelector('.manual-scan-input');input.value='5037563003235';c.emit(input,'keydown',{key:'Enter'});await waitFor(()=>matches.length?c.document.querySelector('.manual-scan-match'):c.document.querySelector('.manual-scan-status').classList.contains('is-error'));finish();await pause(20);assert.equal(c.document.querySelector('.dmd-popover').hidden,true);assert.equal(c.document.querySelector('.dmd-options').children.length,0);assert.equal(c.document.querySelector('[role="dialog"]'),null);if(matches.length)assert.equal(c.document.querySelectorAll('.manual-scan-match').length,2);}finally{c.cleanup();}
 }
});

test('search results add the chosen pack quantity directly once while a request is pending',async()=>{
 let finish;const added=[];let sends=0;const c=setup({onAdd:selection=>{added.push(selection);return new Promise(resolve=>finish=resolve);},onSend:async()=>sends++});
 try{const option=await results(c),quantity=c.document.querySelector('[data-dmd-quantity]'),add=c.document.querySelector('[data-dmd-add]');assert.equal(option.contains(add),false,'The basket button is a sibling of the medicine button');quantity.value='4';c.emit(add,'pointerdown',{pointerType:'touch',pointerId:8});c.emit(add,'click');c.emit(add,'click');assert.equal(added.length,1);assert.deepEqual(added[0],{id:pack.id,type:'AMPP',query:pack.name,quantity:4});assert.equal(add.disabled,true);assert.equal(c.document.querySelector('[role="dialog"]'),null);assert.equal(sends,0);finish({});await waitFor(()=>!add.disabled);assert.match(c.document.querySelector('.dmd-search-status').textContent,/4 packs.*added to your basket/);assert.equal(quantity.value,'4');c.emit(option,'click');assert.ok(c.document.querySelector('[role="dialog"]'),'The same medicine retains its click-to-open modal route');assert.equal(sends,0);}finally{c.cleanup();}
});

test('touch and pen quick-add taps survive input blur and suppress the following compatibility click',async()=>{
 for(const pointerType of ['touch','pen']){const added=[];let sends=0;const c=setup({onAdd:async selection=>{added.push(selection);return {};},onSend:async()=>sends++});
  try{await results(c);const quantity=c.document.querySelector('[data-dmd-quantity]'),add=c.document.querySelector('[data-dmd-add]');quantity.value='4';const properties={pointerType,pointerId:17,clientX:30,clientY:40};
   const down=c.emit(add,'pointerdown',properties);assert.equal(down.defaultPrevented,false);c.setFocused(c.document.body);c.emit(c.input,'focusout');await Promise.resolve();assert.equal(c.document.querySelector('.dmd-popover').hidden,false,'Blur cannot hide a result during a quick-add tap');
   c.emit(add,'pointerup',properties);await waitFor(()=>!add.disabled);assert.equal(added.length,1);assert.equal(added[0].quantity,4);c.emit(add,'click');assert.equal(added.length,1,'Compatibility click must not add twice after the request finishes');assert.equal(c.document.querySelector('[role="dialog"]'),null);assert.equal(sends,0);
   c.emit(c.document.body,'pointerdown',{pointerType:'touch',pointerId:18});assert.equal(c.document.querySelector('.dmd-popover').hidden,true,'Outside interaction still closes the dropdown');
  }finally{c.cleanup();}
 }
});

test('scrolling, cancelled and stale quick-add gestures do not add a pack',async()=>{
 for(const mode of ['scroll','cancel','stale']){const added=[];const c=setup({onAdd:async selection=>{added.push(selection);return {};}});
  try{await results(c);const add=c.document.querySelector('[data-dmd-add]'),properties={pointerType:'touch',pointerId:21,clientX:30,clientY:40};c.emit(add,'pointerdown',properties);c.setFocused(c.document.body);c.emit(c.input,'focusout');await Promise.resolve();
   if(mode==='scroll')c.emit(add,'pointermove',{...properties,clientY:80});
   if(mode==='cancel')c.emit(add,'pointercancel',properties);
   if(mode==='stale'){c.input.value='new medicine';c.emit(c.input,'input');}
   c.emit(add,'pointerup',mode==='scroll'?{...properties,clientY:80}:properties);c.emit(add,'click');await Promise.resolve();assert.equal(added.length,0,mode);assert.equal(c.document.querySelector('[role="dialog"]'),null,mode);
  }finally{c.cleanup();}
 }
});

test('touching a quick quantity field keeps the dropdown open and native editing intact',async()=>{
 let additions=0;const c=setup({onAdd:async()=>additions++});try{await results(c);const quantity=c.document.querySelector('[data-dmd-quantity]'),properties={pointerType:'touch',pointerId:25,clientX:30,clientY:40};const down=c.emit(quantity,'pointerdown',properties);assert.equal(down.defaultPrevented,false);c.setFocused(c.document.body);c.emit(c.input,'focusout');await Promise.resolve();assert.equal(c.document.querySelector('.dmd-popover').hidden,false);c.setFocused(quantity);const up=c.emit(quantity,'pointerup',properties);assert.equal(up.defaultPrevented,false);c.emit(quantity,'click');quantity.value='6';c.emit(quantity,'input');assert.equal(quantity.disabled,false);assert.equal(quantity.value,'6');assert.equal(c.document.querySelector('.dmd-popover').hidden,false);assert.equal(c.document.querySelector('[role="dialog"]'),null);assert.equal(additions,0);
  const add=c.document.querySelector('[data-dmd-add]');c.emit(add,'pointerdown',{pointerType:'mouse',pointerId:26});c.emit(add,'click');await waitFor(()=>additions===1);assert.equal(c.document.querySelector('[role="dialog"]'),null);
 }finally{c.cleanup();}
});

test('direct basket add rejects invalid quantities and a failed request can be retried',async()=>{
 let fail=true;const added=[];const c=setup({onAdd:async selection=>{added.push(selection);if(fail)throw new Error('Basket temporarily unavailable');return {};}});
 try{await results(c);const quantity=c.document.querySelector('[data-dmd-quantity]'),add=c.document.querySelector('[data-dmd-add]');for(const value of ['','0','1.5','1000']){quantity.value=value;c.emit(add,'click');await pause(0);assert.equal(added.length,0);assert.match(c.document.querySelector('.dmd-search-status').textContent,/whole number/);}quantity.value='3';c.emit(add,'click');await waitFor(()=>c.document.querySelector('.dmd-search-status').textContent==='Basket temporarily unavailable');assert.equal(add.disabled,false);assert.equal(quantity.value,'3');assert.equal(c.document.querySelector('[role="dialog"]'),null);fail=false;c.emit(add,'click');await waitFor(()=>c.document.querySelector('.dmd-search-status').textContent.includes('added to your basket'));assert.equal(added.length,2);assert.equal(added[1].quantity,3);assert.equal(c.document.querySelector('[role="dialog"]'),null);}finally{c.cleanup();}
});

test('grouped medicine results require pack selection before direct basket add',async()=>{
 const c=setup({record:{id:'39732411000001106',type:'VMP',name:'Amoxicillin 500mg capsules'}});try{const option=await results(c);assert.equal(c.document.querySelector('[data-dmd-add]'),null);assert.match(c.document.querySelector('.dmd-result-actions').textContent,/Choose a pack first/);c.emit(option,'click');await waitFor(()=>c.document.querySelector('.manual-order-form'));assert.ok(c.document.querySelector('.manual-order-add'));}finally{c.cleanup();}
});

test('joint-cheapest comparison recommends explicitly and refreshes after quantity changes',async()=>{
 const quotes=[],compares=[];let mutations=0;const c=setup({onQuote:async selection=>{quotes.push(selection.supplier);return quoteFixture(selection);},onCompare:async selection=>{compares.push(selection.quantity);return {quotes:['AAH','Phoenix'].map(supplier=>quoteFixture({...selection,supplier})),cheapestSuppliers:['AAH','Phoenix'],recommendedSupplier:'AAH',simulated:true,priceBasis:'test_prices',message:'Prices are simulated; reference prices are not supplier quotes.'};},onSend:async()=>mutations++});
 try{c.cleanup.openProduct(pack,{quantity:2});await waitFor(()=>c.document.querySelector('.manual-comparison-recommendation'));assert.match(c.document.querySelector('.manual-order-comparison').textContent,/Joint cheapest test total: £2.50 across 2 wholesalers/);assert.equal(c.document.querySelector('[name="supplier"]').value,'Phoenix','A recommendation does not silently change the chosen supplier');assert.equal(mutations,0);c.document.querySelector('.manual-comparison-recommendation .manual-comparison-use').click();await waitFor(()=>!c.document.querySelector('.manual-order-send').disabled);assert.equal(c.document.querySelector('[name="supplier"]').value,'AAH');assert.deepEqual(quotes,['Phoenix','AAH']);assert.deepEqual(compares,[2],'Changing supplier reuses the same quantity comparison');const quantity=c.document.querySelector('[name="quantity"]');quantity.value='3';c.emit(quantity,'input');await waitFor(()=>compares.length===2&&!c.document.querySelector('.manual-order-send').disabled);assert.deepEqual(compares,[2,3]);assert.match(c.document.querySelector('.manual-order-comparison').textContent,/£3.75/);assert.equal(mutations,0);}finally{c.cleanup();}
});

test('partial availability has no cheapest-full-order recommendation and comparison errors do not fake one',async()=>{
 let fail=true;const c=setup({onQuote:async selection=>quoteFixture(selection,{status:'partial',acceptedQuantity:1,outstandingQuantity:1}),onCompare:async selection=>{if(fail)throw new Error('Price comparison unavailable');return {quotes:[quoteFixture(selection,{status:'partial',acceptedQuantity:1,outstandingQuantity:1})],cheapestSuppliers:[],recommendedSupplier:null,simulated:true,priceBasis:'test_prices'};}});try{c.cleanup.openProduct(pack,{quantity:2});await waitFor(()=>c.document.querySelector('.manual-comparison-retry'));assert.equal(c.document.querySelector('.manual-order-send').disabled,false,'A successful selected-supplier quote still permits an explicit send');assert.equal(c.document.querySelector('.manual-comparison-recommendation'),null);fail=false;c.document.querySelector('.manual-comparison-retry').click();await waitFor(()=>c.document.querySelector('.manual-comparison-options'));assert.match(c.document.querySelector('.manual-order-comparison').textContent,/No wholesaler can supply all requested packs/);assert.equal(c.document.querySelector('.manual-comparison-recommendation'),null);}finally{c.cleanup();}
});
