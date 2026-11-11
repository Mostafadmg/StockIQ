import test from 'node:test';
import assert from 'node:assert/strict';
import {renderView,renderManualItems} from '../src/views.js';
import {seedWorkspace} from '../server/api.mjs';
const all=['auto','manual','goods','history','usage','fast','delivery','stock','smart','analytics','surplus','attention','import','feedback','drafts','order-analytics','api'];
test('every observed main and menu page renders from the actual API seed',()=>{for(const view of all){const html=renderView(view,{state:seedWorkspace()});assert.ok(html.includes('<h1>'),view);assert.ok(!/undefined|NaN|\[object Object\]/.test(html),view);}});
test('subtabs render usable read models',()=>{for(const [view,tabs] of Object.entries({auto:['orders','fast','otc'],goods:['deliveries','claims'],history:['all','Received','Part received','Awaiting'],stock:['overview','to-count','count-history','count'],smart:['forecast','orders'],analytics:['overview','regret','waste','prices','slow','performance'],'order-analytics':['overview','scorecard','shadow']})){for(const subtab of tabs){const html=renderView(view,{state:seedWorkspace(),subtab});assert.ok(html.includes('<h1>'));assert.ok(!/undefined|NaN|\[object Object\]/.test(html),`${view}/${subtab}`);}}});
test('search and date filters select correct catalogue and history records',()=>{const state=seedWorkspace();const html=renderView('auto',{state,search:'amoxicillin'});assert.ok(html.includes('Amoxicillin'));const table=html.slice(html.indexOf('<tbody>'),html.indexOf('</tbody>'));assert.ok(!table.includes('Paracetamol'));assert.doesNotMatch(renderView('manual',{state}),/Workspace products|workspace-product|concessionSearch/);const history=renderView('history',{state,historyFrom:'2099-01-01'});assert.ok(history.includes('No orders match'));});
test('record content is escaped in views',()=>{const state=seedWorkspace();state.products[0].name='<script>alert(1)</script>';const html=renderView('auto',{state});assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));});
test('stock receipt and claim routes are actionable in Goods In',()=>{const html=renderView('goods',{state:seedWorkspace()});assert.ok(html.includes('data-action="receive"'));assert.ok(html.includes('data-action="claim"'));});

test('manual order items include basket packs and exclude catalogue imports without an order',async()=>{
 const {parseHTML}=await import('linkedom'),state=seedWorkspace(),sample={...state.products[0],quantity:2,price:1.5,supplier:'Sigma'};
 state.orders=[];state.basket=[];state.products[0].catalogueId='imported-for-a-quote';
 const empty=parseHTML(renderManualItems(state)).document;assert.equal(empty.querySelector('[data-manual-card]'),null);assert.match(empty.documentElement.textContent,/Items you add or order will appear here/);
 state.basket=[sample];const document=parseHTML(renderView('manual',{state})).document,row=document.querySelector(`[data-manual-basket="${sample.id}"]`);
 assert.ok(document.querySelector('#manual-catalogue + #manual-order-items'));assert.ok(row);assert.match(row.textContent,/In basket/);assert.match(row.textContent,/2 packs/);assert.match(row.querySelector('.manual-item-total').textContent,/£3.00/);assert.match(row.textContent,/Sigma/);assert.equal(row.querySelector('[data-manual-quantity]').value,'1','The reorder quantity is separate from the existing basket count');
});

test('manual order items preserve submitted snapshots, acceptance counts and repeated packs in newest-first order',async()=>{
 const {parseHTML}=await import('linkedom'),state=seedWorkspace(),item={...state.products[0],name:'Original medicine snapshot',pack:'28 tablets',quantity:4,requestedQuantity:4,acceptedQuantity:2,received:0,price:2};
 state.basket=[];state.products[0].name='Changed current catalogue name';state.products[0].price=99;
 const earlier={id:'TEST-2101',supplier:'Phoenix',createdAt:'2026-11-10T11:00:00Z',status:'Awaiting',items:[item],fulfilment:{status:'partial',sourceLabel:'Phoenix test depot',supplierReference:'SIM-2101',delivery:{estimatedArrivalAt:'2026-11-12T09:00:00Z'}}};
 const newer={id:'TEST-2102',supplier:'AAH',createdAt:'2026-11-11T11:00:00Z',status:'Received',items:[{...item,quantity:3,requestedQuantity:3,acceptedQuantity:3,received:3}],fulfilment:{status:'accepted'}};
 state.orders=[earlier,newer];const document=parseHTML(renderManualItems(state)).document,rows=[...document.querySelectorAll('[data-manual-order]')];
 assert.deepEqual(rows.map(row=>row.dataset.manualOrder),['TEST-2102','TEST-2101']);assert.match(rows[1].textContent,/Original medicine snapshot/);assert.doesNotMatch(document.documentElement.textContent,/Changed current catalogue name|£99/);assert.match(rows[1].querySelector('.manual-item-quantity').textContent,/2 of 4 accepted/);assert.match(rows[1].querySelector('.manual-item-total').textContent,/£4.00/);assert.match(rows[1].querySelector('.manual-item-status').textContent,/Part accepted/);assert.match(rows[1].textContent,/Phoenix test depot/);assert.match(rows[0].querySelector('.manual-item-status').textContent,/Received3 of 3 received/);
});

test('manual order items distinguish failed, unconfirmed and individually unavailable lines',async()=>{
 const {parseHTML}=await import('linkedom'),base={...seedWorkspace().products[0],quantity:3,price:2},state={basket:[],orders:[
  {id:'TEST-2201',supplier:'AAH',createdAt:'2026-11-11T12:00:00Z',status:'Failed',items:[base]},
  {id:'TEST-2202',supplier:'AAH',createdAt:'2026-11-11T11:00:00Z',status:'Pending',items:[base]},
  {id:'TEST-2203',supplier:'AAH',createdAt:'2026-11-11T10:00:00Z',status:'To follow',items:[base]},
  {id:'TEST-2204',supplier:'Phoenix',createdAt:'2026-11-11T09:00:00Z',status:'Awaiting',items:[{...base,acceptedQuantity:0},{...base,id:'other',acceptedQuantity:3}],fulfilment:{status:'partial',sourceLabel:'<img src=x>'}}
 ]};
 const document=parseHTML(renderManualItems(state)).document,failed=document.querySelector('[data-manual-order="TEST-2201"]'),pending=document.querySelector('[data-manual-order="TEST-2202"]'),follow=document.querySelector('[data-manual-order="TEST-2203"]'),unavailable=document.querySelector('[data-manual-order="TEST-2204"]');
 assert.match(failed.querySelector('.manual-item-status').textContent,/Failed/);assert.match(failed.querySelector('.manual-item-quantity').textContent,/0 of 3 accepted/);assert.match(failed.querySelector('.manual-item-total').textContent,/£0.00/);
 for(const row of [pending,follow]){assert.match(row.textContent,/Acceptance pending/);assert.equal(row.querySelector('.manual-item-total strong').textContent,'—');assert.doesNotMatch(row.querySelector('.manual-item-status').textContent,/Accepted|Est /);}
 assert.match(unavailable.querySelector('.manual-item-status').textContent,/Not accepted/);assert.ok(unavailable.querySelector('.badge.red'));assert.equal(document.querySelector('img'),null);assert.match(unavailable.textContent,/<img src=x>/);
});


test('every rendered action has an implemented core or feature handler',async()=>{const {parityActions}=await import('../src/parity-actions.js');const {readFile}=await import('node:fs/promises');const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');const supported=new Set([...parityActions,...[...app.matchAll(/name===['"]([^'"]+)['"]/g)].map(m=>m[1])]);const state=seedWorkspace();state.features.surplus.offers=[{id:'OFFER-1001',productId:'p009',quantity:2,available:1,unitPrice:.34,status:'active',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}];state.features.surplus.transfers=[{id:'TRANSFER-1001',offerId:'OFFER-1001',productId:'p009',quantity:1,unitPrice:.34,total:.34,branch:'Demo branch',status:'Requested',createdAt:new Date().toISOString()}];const subviews={goods:['deliveries','claims','analytics','settings'],surplus:['offers','sent','statement','past'],analytics:['overview','regret','waste','prices','slow','performance'],stock:['overview','to-count','count-history','count']};for(const view of all){for(const subtab of subviews[view]||['']){const html=renderView(view,{state,subtab});for(const match of html.matchAll(/data-action="([^"]+)"/g))assert.ok(supported.has(match[1]),view+'/'+subtab+': '+match[1]);}}});

function fulfilmentFixture(){
 const state=seedWorkspace(),base=state.products[0];
 const entry=(id,arrival,{requested=4,accepted=4,received=0,sourceLabel='Phoenix test depot',supplierReference='SIM-PHX-1000'}={})=>({id,supplier:'Phoenix',status:accepted?'Awaiting':'Not accepted',createdAt:'2026-11-13T10:00:00Z',total:accepted*base.price,items:[{...base,quantity:requested,requestedQuantity:requested,acceptedQuantity:accepted,outstandingQuantity:requested-accepted,received}],fulfilment:{simulated:true,supplier:'Phoenix',sourceLabel,supplierReference,status:!accepted?'unavailable':accepted<requested?'partial':'accepted',requestedQuantity:requested,acceptedQuantity:accepted,outstandingQuantity:requested-accepted,delivery:{estimatedArrivalAt:arrival,workingDays:arrival?'1':null,basis:'schedule_estimate',timezone:'Europe/London'}}});
 state.orders=[entry('TEST-9001','2026-11-13T17:30:00Z'),entry('TEST-9002','2026-11-16T09:00:00Z',{requested:5,accepted:2,received:1}),entry('TEST-9003','2026-11-18T10:00:00Z'),entry('TEST-9004',null),entry('TEST-9005','2026-11-12T09:00:00Z'),entry('TEST-9006',null,{requested:3,accepted:0})];return state;
}
test('Goods In groups arrival estimates and separates rejected packs from receipt quantities',async()=>{
 const {parseHTML}=await import('linkedom'),html=renderView('goods',{state:fulfilmentFixture(),now:new Date('2026-11-13T12:00:00Z')}),{document}=parseHTML(html);
 const groups=[...document.querySelectorAll('.delivery-arrival-group')].map(group=>({label:group.querySelector('h3').textContent,orders:[...group.querySelectorAll('[data-order-id]')].map(order=>order.dataset.orderId)}));
 assert.deepEqual(groups,[{label:'Past estimate · check arrival',orders:['TEST-9005']},{label:'Today',orders:['TEST-9001']},{label:'Next working day',orders:['TEST-9002']},{label:'Later',orders:['TEST-9003']},{label:'No estimate',orders:['TEST-9004']}]);
 const partial=document.querySelector('[data-order-id="TEST-9002"]');assert.match(partial.textContent,/2 accepted of 5 requested/);assert.match(partial.textContent,/3 not accepted/);assert.match(partial.textContent,/1 to receive/);assert.match(partial.textContent,/Supplier ref SIM-PHX-1000/);assert.match(partial.textContent,/schedule estimate/);
 assert.equal(document.querySelector('[data-action="receive"][data-id="TEST-9006"]'),null);assert.ok(!html.includes("Today's deliveries"));assert.match(html,/Not accepted · 6 packs/);
});
test('History shows acceptance, non-acceptance and receipt counts as separate facts',async()=>{
 const {parseHTML}=await import('linkedom'),{document}=parseHTML(renderView('history',{state:fulfilmentFixture()}));
 const partial=document.querySelector('[data-order-id="TEST-9002"]');assert.match(partial.textContent,/Part accepted/);assert.match(partial.textContent,/2\/5 accepted/);assert.match(partial.textContent,/1 checked in · 3 not accepted · 1 to receive/);assert.match(partial.textContent,/Phoenix test depot/);
 const unavailable=document.querySelector('[data-order-id="TEST-9006"]');assert.match(unavailable.textContent,/Not accepted/);assert.match(unavailable.textContent,/No delivery scheduled/);assert.ok(!unavailable.textContent.includes('Next working day'));
 const filtered=parseHTML(renderView('history',{state:fulfilmentFixture(),ui:{historyStatus:'Partial acceptance'}})).document;assert.equal(filtered.querySelectorAll('.history-order').length,1);assert.equal(filtered.querySelector('.history-order').dataset.orderId,'TEST-9002');
});
test('supplier provenance and reference values are escaped in delivery and history views',()=>{
 const state=fulfilmentFixture();state.orders[0].fulfilment.sourceLabel='<img src=x onerror=alert(1)>';state.orders[0].fulfilment.supplierReference='<script>bad()</script>';
 for(const view of ['goods','history','attention']){const html=renderView(view,{state});assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));}
});
test('delivery buckets share England and Wales bank-holiday working days with API estimates',async()=>{
 const {parseHTML}=await import('linkedom'),state=fulfilmentFixture();state.orders=[state.orders[0]];state.orders[0].fulfilment.delivery.estimatedArrivalAt='2026-04-07T08:00:00Z';
 const {document}=parseHTML(renderView('goods',{state,now:new Date('2026-04-02T17:00:00Z')}));assert.match(document.querySelector('.delivery-arrival-group h3').textContent,/Next working day/);
 state.features.deliveryVans={Phoenix:[{id:'phx-weekday',days:[1,2,3,4,5],cutoff:'14:00',arrival:'09:00',offset:1}]};
 const delivery=renderView('delivery',{state,now:new Date('2026-04-02T12:00:00Z')});assert.match(delivery,/Estimated next van: by Thu,? 02 Apr, 14:00 → Tue,? 07 Apr, 09:00/);assert.match(delivery,/next working day/);assert.match(delivery,/England\/Wales bank holidays/);
});

test('a delivery estimated earlier today appears in the past-estimate queue',async()=>{
 const {parseHTML}=await import('linkedom'),state=fulfilmentFixture();state.orders=[state.orders[0]];state.orders[0].fulfilment.delivery.estimatedArrivalAt='2026-11-13T09:00:00Z';
 const {document}=parseHTML(renderView('goods',{state,now:new Date('2026-11-13T12:00:00Z')}));assert.match(document.querySelector('.delivery-arrival-group h3').textContent,/Past estimate/);
});

test('History groups each London date once and sorts dates and orders newest first',async()=>{
 const {parseHTML}=await import('linkedom'),state=seedWorkspace(),base=state.orders[0];
 state.orders=[['TEST-9101','2026-11-09T10:00:00Z'],['TEST-9102','2026-11-11T09:00:00Z'],['TEST-9103','2026-11-10T11:00:00Z'],['TEST-9104','2026-11-11T14:00:00Z']].map(([id,createdAt])=>({...structuredClone(base),id,createdAt}));
 const {document}=parseHTML(renderView('history',{state})),groups=[...document.querySelectorAll('[data-history-day]')];
 assert.deepEqual(groups.map(group=>group.dataset.historyDay),['2026-11-11','2026-11-10','2026-11-09']);
 assert.deepEqual(groups.map(group=>[...group.querySelectorAll('.history-order')].map(order=>order.dataset.orderId)),[['TEST-9104','TEST-9102'],['TEST-9103'],['TEST-9101']]);
 assert.equal(document.querySelectorAll('.history-day').length,3);
});

test('History date filters and group headings agree at a London summer-time date boundary',async()=>{
 const {parseHTML}=await import('linkedom'),state=seedWorkspace(),base=state.orders[0];
 state.orders=[['TEST-9201','2026-06-10T23:30:00Z'],['TEST-9202','2026-06-10T22:30:00Z']].map(([id,createdAt])=>({...structuredClone(base),id,createdAt}));
 const {document}=parseHTML(renderView('history',{state,historyFrom:'2026-06-11',historyTo:'2026-06-11'}));
 assert.deepEqual([...document.querySelectorAll('.history-order')].map(order=>order.dataset.orderId),['TEST-9201']);
 assert.equal(document.querySelector('[data-history-day]').dataset.historyDay,'2026-06-11');
 assert.match(document.querySelector('.history-order-head').textContent,/00:30/);
});
