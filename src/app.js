import {renderView,renderManualItems} from './views.js';
import {renderBasketSupplierOptions} from './basket-review.js';
import {mountManualSearch} from './manual-search.js';
import {createManualOrderActions} from './manual-orders.js';
import {icon} from './icons.js';
import {orderDetailsHTML,submittedOrdersHTML,quotePreviewHTML} from './order-summary.js';
import {handleParityAction,parityActions} from './parity-actions.js';
let manualSearchCleanup=null;
const testWorkspaceSnapshots=new Map();
let ui={},mobileMenu=false;
const basketReview={review:null,notes:'',loading:false,error:'',sourceView:'auto',selected:new Set(),sort:{key:'name',dir:'asc'},draftSaved:false};
let basketReviewSequence=0,supplierSheetState=null;
const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(v)||0);
const KEY='stockiq.test-workspace.v1';
const paths={auto:'/',manual:'/daily-orders',review:'/review',goods:'/goods-in/queue',history:'/history',usage:'/weekly-review',fast:'/fast-lines-config',delivery:'/delivery-times',stock:'/inventory',smart:'/smart-ordering',analytics:'/analytics-dashboard',surplus:'/surplus',attention:'/needs-attention',import:'/screenshot-import',feedback:'/stock-feedback',drafts:'/drafts','order-analytics':'/order-analytics',api:'/api-lab'};
let saved;try{saved=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}
let workspaceId=saved?.id||crypto.randomUUID(),state=saved?.workspace,view=location.hash.slice(1)||Object.entries(paths).find(([key,path])=>path===location.pathname)?.[0]||'auto',search='',filter='',subtab='',selected=new Set(),apiResults=[],historyFrom='',historyTo='',menu='',busy=false,hiddenPending=new Set();
const advanced=[['usage','Branch Usage'],['fast','Fast Lines'],['delivery','Delivery Times'],['stock','Stock Count'],['smart','Smart Orders'],['analytics','Analytics'],['surplus','Surplus']];
const tools=[['attention','Needs Attention'],['import','Screenshot Import'],['feedback','Stock Feedback'],['drafts','Saved Drafts'],['order-analytics','Order Analytics']];
const titles=Object.fromEntries([['auto','Auto Orders'],['manual','Manual Orders'],['review','Order review'],['goods','Goods In'],['history','History'],['settings','Workspace Settings'],['api','API Test Console'],...advanced,...tools]);
const icons={auto:'▤',manual:'⊕',goods:'▧',history:'◷'};
function persist(){try{localStorage.setItem(KEY,JSON.stringify({id:workspaceId,workspace:state}));}catch{toast('Browser storage is full. Export your workspace to keep a copy.');}}
async function restore(){const response=await fetch('/api/workspaces',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:workspaceId,...(state?{workspace:state}:{})})});const result=await response.json();if(!response.ok)throw new Error(result.error?.message||result.error||'Could not prepare workspace');state=result.workspace;persist();}
async function request(path,method='GET',body,retry=true,id=workspaceId){if(!/^\/api\/(?!\/)/.test(path)||path.includes('://')||path.includes('..'))throw new Error('Choose a relative /api/ path in this test workspace.');const response=await fetch('/api/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,workspace:id===workspaceId?state:testWorkspaceSnapshots.get(id),method,path,...(body===undefined?{}:{data:body})})});const result=await response.json();if(result.code==='SESSION_EXPIRED'&&retry&&id===workspaceId){await restore();return request(path,method,body,false,id);}if(result.workspace&&method!=='GET'&&!['/api/orders/quote','/api/basket/cascade','/api/orders/compare','/api/dmd/barcode'].includes(path)){if(id===workspaceId){state=result.workspace;persist();}else testWorkspaceSnapshots.set(id,result.workspace);}return {status:response.status,ok:response.ok,...result};}
async function call(path,method='GET',body){const r=await request(path,method,body);if(!r.ok)throw new Error(typeof r.error==='object'?r.error.message:r.error||'Request failed');return r.data;}
let toastTimer;function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
function menuHTML(name,items){return `<div class="nav-dropdown"><button class="nav-item ${items.some(([v])=>v===view)?'active':''}" data-menu="${name}" aria-expanded="${menu===name}">${name}${icon('chevron','nav-chevron')}</button>${menu===name?`<div class="dropdown-menu">${items.map(([v,t])=>`<button data-nav="${v}" class="${v===view?'chosen':''}">${escape(t)}${v==='api'?'<span class="badge purple">DEV</span>':''}</button>`).join('')}</div>`:''}</div>`;}
function render(){if(!state)return;manualSearchCleanup?.();manualSearchCleanup=null;const basketCount=state.basket.reduce((n,p)=>n+p.quantity,0),low=state.products.filter(p=>p.stock<(state.settings.fastTargets?.[p.id]??p.target)).length;document.title=`${titles[view]||'StockIQ'} · StockIQ Ordering`;
if(ui.demoLogin){renderLogin();return;}
$('#app').innerHTML=`<header class="app-header"><button class="brand" data-nav="auto" aria-label="Go to Auto Orders"><img src="/stockiq-logo.svg" alt="StockIQ" width="40" height="40"></button><button class="icon-button mobile-menu-button" data-action="mobile-menu" aria-label="Open menu" aria-expanded="${mobileMenu}">${icon('menu')}</button><span class="mobile-page-title">${escape(titles[view]||'StockIQ')}</span><nav class="main-nav ${mobileMenu?'mobile-menu-open':''}" aria-label="Main navigation">${[['auto','Auto Orders'],['manual','Manual Orders'],['goods','Goods In'],['history','History']].map(([v,t])=>`<button class="nav-item ${view===v?'active':''}" data-nav="${v}">${t}${v==='auto'?`<span class="count-pill">${low}</span>`:''}</button>`).join('')}${menuHTML('Advanced',advanced)}${menuHTML('Tools',tools)}</nav><div class="header-actions"><span class="clock" id="header-clock">${new Date().toLocaleTimeString('en-GB')}</span><button class="icon-button support-button" data-action="support-chat" aria-label="Open support chat">${icon('chat')}</button><span class="branch-name">St Mellons Pharmacy</span><button class="icon-button surplus-button" data-nav="surplus" aria-label="Surplus to send to other branches">${icon('truck')}</button><button class="icon-button notification" data-action="alerts" aria-label="Alerts">${icon('bell')}<b>${ui.alertsRead||!low?'':low}</b></button><button class="icon-button text-button" data-action="text-size" aria-label="Switch text size">A</button><button class="icon-button" data-action="theme" aria-label="Switch colour theme">${icon(document.body.classList.contains('dark')?'sun':'moon')}</button><button class="icon-button basket-trigger ${basketCount?'has-items':''} ${view==='review'?'active':''}" data-action="basket" aria-label="Basket" ${view==='review'?'aria-current="page" data-basket-active':''}>${icon('basket')}<b>${basketCount}</b></button><button class="avatar" data-action="account" aria-label="Branch account">B</button></div></header><main id="main-content" class="view-${view}">${view==='settings'?settingsView():renderView(view,{state:{...state,products:state.products.filter(p=>!hiddenPending.has(p.id)||view!=='auto')},search,filter,selected,subtab,apiResults,historyFrom,historyTo,ui,basketReview,escape,money})}</main>`;
if(view==='manual'){const host=document.querySelector('#manual-catalogue');if(host)manualSearchCleanup=mountManualSearch({host,request,preferredSupplier:state.settings.preferredSupplier,onError:()=>{},onClose:()=>{render();document.querySelector('.dmd-query')?.focus();},...createManualOrderActions({call,onUpdate:updateManualTotals,runMutation:async callback=>{if(busy)throw new Error('Please wait for the current change to finish.');busy=true;try{return await callback();}finally{busy=false;}}})});}
}
const manualItemTabs=['ordered','rejected','basket'];
function refreshManualItems(focusTab=false){
 const host=document.querySelector('#manual-order-items');if(!host)return;
 const tab=manualItemTabs.includes(ui.manualTab)?ui.manualTab:'ordered';
 host.innerHTML=renderManualItems(state,{escape,money,tab,busy:Boolean(ui.manualItemsBusy),error:ui.manualItemsError||'',notice:ui.manualItemsNotice||'',needsReview:Boolean(ui.manualBasketNeedsReview)});
 if(focusTab)host.querySelector(`[data-manual-tab="${tab}"]`)?.focus();
}
function switchManualItemsTab(tab){if(view!=='manual'||!manualItemTabs.includes(tab))return;ui.manualTab=tab;refreshManualItems(true);}
function updateManualTotals(){refreshManualItems();const count=state.basket.reduce((n,p)=>n+p.quantity,0),total=state.basket.reduce((n,p)=>n+p.quantity*p.price,0);const badge=document.querySelector('.basket-trigger b');if(badge)badge.textContent=String(count);document.querySelector('.basket-trigger')?.classList.toggle('has-items',count>0);const summary=document.querySelector('.manual-total strong');if(summary)summary.textContent=money(total);const next=document.querySelector('.continue-button');if(next){next.disabled=!state.basket.length;next.setAttribute('aria-disabled',String(next.disabled));}const tags=document.querySelector('.basket-supplier-tags');if(tags)tags.innerHTML=[...new Set(state.basket.map(p=>p.supplier))].map(name=>`<span class="supplier-tag ${escape(name.toLowerCase())}">${escape(name)}<b>${money(state.basket.filter(p=>p.supplier===name).reduce((n,p)=>n+p.quantity*p.price,0))}</b></span>`).join('');}
function renderLogin(){$('#app').innerHTML=`<div class="login-screen"><form id="demo-login" class="login-card"><img src="/stockiq-logo.svg" alt="StockIQ" width="56" height="56"><h1>StockIQ Branch</h1><p>Sign in to continue</p><label class="field">Email Address<input id="login-email" type="email" value="demo@stockiq.test" required autocomplete="username"></label><label class="field">Password<input type="password" placeholder="Demo password" autocomplete="off"></label><p class="demo-login-note">Test workspace · This form does not sign in to the original site.</p><button class="btn btn-primary full" type="submit">Sign In</button><small>StockIQ © ${new Date().getFullYear()}</small></form></div>`;}
function settingsView(){return `<div class="page-head"><div><div class="eyebrow">WORKSPACE</div><h1>Test workspace settings</h1><p>Preferences for your sandbox. Changes do not reach the original site.</p></div></div><div class="panel settings-panel"><h2>Ordering preferences</h2>${[['autoOrder','Show automatic order suggestions'],['lowStockAlerts','Low stock notifications']].map(([key,label])=>`<label class="settings-row"><span>${label}</span><input type="checkbox" data-setting="${key}" ${state.settings[key]?'checked':''}></label>`).join('')}<div class="settings-row"><span>Data storage</span><span class="muted">Saved in this browser; session API state is temporary</span></div><button class="btn" data-action="export-workspace">Export workspace JSON</button><button class="btn danger" data-action="reset">Reset sample data</button></div>`;}
function navigate(v,tab=''){if(!titles[v])v='auto';if(v==='review'&&view!=='review'){basketReview.sourceView=view;basketReview.selected.clear();}else if(v!=='review'){basketReviewSequence++;basketReview.loading=false;}view=v;search='';filter='';subtab=tab;historyFrom='';historyTo='';selected.clear();menu='';mobileMenu=false;ui={};history.pushState({},'',paths[v]||'/');render();if(v==='review')void refreshBasketReview();window.scrollTo(0,0);}
function modal(title,body,wide=false){if(supplierSheetState)close();$('#overlay').innerHTML=`<div class="modal-backdrop"><section class="modal ${wide?'modal-wide':''}" role="dialog" aria-modal="true" aria-label="${escape(title)}"><div class="modal-header"><h2>${escape(title)}</h2><button class="icon-button" data-action="close" aria-label="Close dialog">${icon('close')}</button></div>${body}</section></div>`;$('#overlay').querySelector('button,input,textarea')?.focus();}
function close(){const sheet=supplierSheetState;supplierSheetState=null;$('#overlay').innerHTML='';if(sheet){sheet.background.inert=sheet.previousInert;if(sheet.previousFocus?.isConnected)sheet.previousFocus.focus();else document.querySelector(`[data-action="basket-supplier-options"][data-id="${CSS.escape(sheet.id)}"]`)?.focus();}}
function syncBasketSelection(){const ids=new Set(state.basket.map(line=>line.id));basketReview.selected=new Set([...basketReview.selected].filter(id=>ids.has(id)));}
async function refreshBasketReview(){
 const sequence=++basketReviewSequence;syncBasketSelection();basketReview.loading=true;basketReview.error='';if(view==='review')render();
 try{const result=await call('/api/basket/cascade','POST',{});if(sequence!==basketReviewSequence)return;basketReview.review=result;}
 catch(error){if(sequence===basketReviewSequence){basketReview.review=null;basketReview.error=error.message||'Could not refresh stock. Try again.';}}
 finally{if(sequence===basketReviewSequence){basketReview.loading=false;if(view==='review')render();}}
}
function basket(){close();if(view==='review'){render();return;}navigate('review');}
async function updateBasketLine(id,values){
 if(busy||basketReview.loading)return;busy=true;basketReview.error='';basketReview.draftSaved=false;basketReview.loading=true;basketReviewSequence++;if(view==='review')render();
 try{
  let method='PATCH',data=values;
  if(values.remove){method='DELETE';data=undefined;}
  else if(Object.hasOwn(values,'quantity')){
   const raw=values.quantity,count=Number(raw);
   if(typeof raw!=='string'||!raw.trim()||!Number.isInteger(count)||count<0||count>999)throw new Error('Enter a whole number of packs between 0 and 999.');
   if(count===0){method='DELETE';data=undefined;}else data={quantity:count};
  }
  await call('/api/basket/'+encodeURIComponent(id),method,data);basketReview.review=null;syncBasketSelection();await refreshBasketReview();
 }catch(error){basketReview.loading=false;basketReview.error=error.message||'Could not update this basket line.';if(view==='review')render();}
 finally{busy=false;}
}
async function submitBasketReview(){
 if(basketReview.loading||!basketReview.review||basketReview.error)return;
 const items=state.basket.filter(line=>!basketReview.selected.size||basketReview.selected.has(line.id));
 if(!items.length){basketReview.error='Add a medicine before submitting an order.';render();return;}
 basketReview.loading=true;basketReview.error='';render();
 try{
  const result=await call('/api/orders/cascade','POST',{allocations:items.map(line=>({productId:line.id,supplier:line.supplier})),notes:basketReview.notes});
  basketReview.notes='';basketReview.selected.clear();basketReview.review=null;basketReview.draftSaved=false;close();navigate('goods');modal('Test order results',submittedOrdersHTML(result.orders,escape,money),true);
 }catch(error){basketReview.error=error.message||'Could not submit the selected test orders.';}
 finally{basketReview.loading=false;if(view==='review')render();}
}
async function changeManualBasket(id,values){
 if(view!=='manual'||busy||ui.manualItemsBusy)return;
 const context=ui,previousFocus=document.activeElement,focusKind=previousFocus?.matches?.('[data-manual-basket-quantity]')?'quantity':previousFocus?.matches?.('[data-manual-basket-supplier]')?'supplier':previousFocus?.dataset?.action==='manual-basket-remove'?'tab':null;busy=true;context.manualItemsBusy=true;context.manualItemsError='';context.manualItemsNotice='';context.manualBasketNeedsReview=false;refreshManualItems();
 try{
  if(!state.basket.some(line=>line.id===id))throw new Error('This medicine is no longer in your basket.');
  let method='PATCH',payload=values;
  if(values.remove){method='DELETE';payload=undefined;}
  else if(Object.hasOwn(values,'quantity')){
   const raw=values.quantity,count=Number(raw);
   if(typeof raw!=='string'||!raw.trim()||!Number.isInteger(count)||count<0||count>999)throw new Error('Enter a whole number of packs between 0 and 999. The saved quantity is shown.');
   if(count===0){method='DELETE';payload=undefined;}else payload={quantity:count};
  }else if(!['AAH','Phoenix','Alliance','BNS','Sigma','Trident','Warehouse'].includes(values.supplier))throw new Error('Choose a listed wholesaler.');
  await call('/api/basket/'+encodeURIComponent(id),method,payload);
  basketReviewSequence++;basketReview.review=null;syncBasketSelection();
  context.manualItemsNotice=method==='DELETE'?'Item removed from your basket.':'Basket updated.';
 }catch(error){context.manualBasketNeedsReview=true;context.manualItemsError=error.message||'Could not save this basket change. The saved values are shown.';}
 finally{
  context.manualItemsBusy=false;busy=false;
  const restoreFocus=focusKind&&view==='manual'&&ui===context&&context.manualTab==='basket'&&(document.activeElement===document.body||document.activeElement===previousFocus&&!previousFocus.isConnected);
  updateManualTotals();
  if(restoreFocus){const field=focusKind==='tab'?null:document.querySelector(`[data-manual-basket-${focusKind}="${CSS.escape(id)}"]`);(field||document.querySelector('[data-manual-tab="basket"]'))?.focus();}
 }
}
async function sendManualBasket(){
 if(view!=='manual'||busy||ui.manualItemsBusy||ui.manualBasketNeedsReview)return;
 const context=ui,lines=state.basket.map(line=>({id:line.id,quantity:line.quantity,supplier:line.supplier}));
 context.manualItemsError='';context.manualItemsNotice='';
 if(!lines.length){context.manualItemsError='Add a medicine to your basket before sending.';refreshManualItems();return;}
 // A focused field may not have emitted change yet. Require its displayed value to match the saved basket.
 for(const line of lines){
  const row=document.querySelector(`[data-manual-basket="${CSS.escape(line.id)}"]`),quantity=row?.querySelector('[data-manual-basket-quantity]'),supplier=row?.querySelector('[data-manual-basket-supplier]');
  if(quantity&&(!quantity.value.trim()||!Number.isInteger(Number(quantity.value))||Number(quantity.value)!==line.quantity)||supplier&&supplier.value!==line.supplier){context.manualBasketNeedsReview=true;context.manualItemsError='Save the quantity and wholesaler changes before sending your basket.';refreshManualItems();return;}
 }
 busy=true;context.manualItemsBusy=true;refreshManualItems();
 try{
  const result=await call('/api/orders/cascade','POST',{allocations:lines.map(line=>({productId:line.id,supplier:line.supplier})),notes:''});
  basketReviewSequence++;basketReview.review=null;syncBasketSelection();
  const orders=result.orders||[],accepted=orders.some(order=>(order.items||[]).some(line=>Number(line.acceptedQuantity??line.quantity)>0));
  context.manualItemsNotice=`${orders.length} test ${orders.length===1?'order':'orders'} submitted. Supplier results are shown below.`;
  if(ui===context&&context.manualTab==='basket')context.manualTab=accepted?'ordered':'rejected';
 }catch(error){context.manualItemsError=error.message||'Could not send your test basket. Review the saved lines and try again.';}
 finally{context.manualItemsBusy=false;busy=false;updateManualTotals();}
}
const qty=id=>Number(document.querySelector(`[data-quantity="${CSS.escape(id)}"]`)?.value||1);
async function add(id,quantity=qty(id)){await call('/api/basket','POST',{productId:id,quantity});}
function download(content,name,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function runSuite(){
 apiResults=[];render();const id=crypto.randomUUID();let pass=0;
 const run=async(label,path,method,body,expected,verify=()=>true)=>{const start=performance.now(),r=await request(path,method,body,false,id),ok=r.status===expected&&verify(r.data);apiResults.push({name:label,path,method,status:r.status,ok,pass:ok,passed:ok,duration:Math.round(performance.now()-start),body:r.data||r.error});pass+=Number(ok);render();return r;};
 const suiteStart=await fetch('/api/workspaces',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}),suiteWorkspace=await suiteStart.json();if(!suiteStart.ok)throw new Error('Could not initialize the test suite.');testWorkspaceSnapshots.set(id,suiteWorkspace.workspace);
 try{
  await run('Health check','/api/health','GET',undefined,200);
  await run('Search catalogue','/api/products?q=amox','GET',undefined,200);
  const first='p001';
  await run('Compare full-quantity supplier test totals','/api/orders/compare','POST',{productId:first,quantity:3},200,data=>data.quotes.length===7&&data.cheapestSuppliers.length===7&&typeof data.recommendedSupplier==='string');
  await run('Reject invalid quantity','/api/basket','POST',{productId:first,quantity:-1},400);
  await run('Add test basket line','/api/basket','POST',{productId:first,quantity:2},201);
  await run('Preview supplier quantity and arrival','/api/orders/quote','POST',{productId:first,quantity:3,supplier:'AAH'},200,data=>data.acceptedQuantity===3&&data.delivery?.basis==='schedule_estimate');
  const order=await run('Submit isolated basket order','/api/orders','POST',{},201,data=>data.fulfilment?.acceptedQuantity===2);
  if(order.data?.id)await run('Receive accepted basket packs',`/api/orders/${order.data.id}/receive`,'POST',{},200,data=>data.status==='Received');
  const body={productId:first,quantity:3,supplier:'AAH',scenario:'partial',requestId:crypto.randomUUID()};
  const partial=await run('Partial response: 2 of 3 accepted','/api/orders/direct','POST',body,201,data=>data.order.fulfilment.acceptedQuantity===2&&data.order.fulfilment.outstandingQuantity===1);
  await run('Retry keeps the same supplier response','/api/orders/direct','POST',body,200,data=>data.replayed&&data.order.id===partial.data?.order.id);
  if(partial.data?.order.id)await run('Only accepted packs can be received',`/api/orders/${partial.data.order.id}/receive`,'POST',{},200,data=>data.items[0].received===2);
  const rejected=await run('Unavailable response has no delivery','/api/orders/direct','POST',{...body,scenario:'unavailable',requestId:crypto.randomUUID()},201,data=>data.order.fulfilment.acceptedQuantity===0&&data.order.fulfilment.delivery.estimatedArrivalAt===null);
  if(rejected.data?.order.id)await run('Unavailable packs cannot be checked in',`/api/orders/${rejected.data.order.id}/receive`,'POST',{},409);
  await run('Order history','/api/orders','GET',undefined,200);
 }finally{testWorkspaceSnapshots.delete(id);}
 toast(`${pass}/${apiResults.length} API checks passed in a separate test workspace.`);
}
async function action(name,id,el){
if(name==='basket-supplier-options'){if(busy||basketReview.loading)return;const line=state.basket.find(item=>item.id===id);if(!line)return;const product=state.products.find(item=>item.id===id)||line,reviewLine=basketReview.review?.lines.find(item=>item.productId===id);const previousFocus=document.activeElement;modal('Switch supplier',renderBasketSupplierOptions(product,line,reviewLine));$('#overlay .modal')?.classList.add('basket-supplier-sheet');const background=$('#app');supplierSheetState={previousFocus,background,previousInert:background.inert,id};background.inert=true;return;}
if(name==='basket-choose-supplier'){if(busy||basketReview.loading)return;const supplier=$('#overlay [name="basket-supplier-option"]:checked')?.value||el?.dataset.supplier;if(!supplier){toast('Choose a supplier first.');return;}close();await updateBasketLine(id,{supplier});if(view==='review')document.querySelector(`[data-action="basket-supplier-options"][data-id="${CSS.escape(id)}"]`)?.focus();return;}
if(name==='basket-back'){close();navigate(titles[basketReview.sourceView]&&basketReview.sourceView!=='review'?basketReview.sourceView:'manual');return;}
if(name==='basket-sort'){const key=el?.dataset.sort;if(!['wholesaler','lineTotal','name','unitPrice'].includes(key))return;basketReview.sort={key,dir:basketReview.sort.key===key?(basketReview.sort.dir==='asc'?'desc':'asc'):['lineTotal','unitPrice'].includes(key)?'desc':'asc'};render();return;}
if(name==='basket-select-all'){const ids=state.basket.map(line=>line.id);basketReview.selected=ids.length&&ids.every(id=>basketReview.selected.has(id))?new Set():new Set(ids);render();return;}
if(name==='basket-clear-selection'){basketReview.selected.clear();render();return;}
if(name==='remove-basket'&&view==='review'){await updateBasketLine(id,{remove:true});return;}

if(name==='manual-basket-view'){switchManualItemsTab('basket');document.querySelector('#manual-order-items')?.scrollIntoView?.({behavior:'smooth',block:'start'});return;}if(name==='manual-basket-restore'){if(view!=='manual'||busy||ui.manualItemsBusy)return;ui.manualBasketNeedsReview=false;ui.manualItemsError='';ui.manualItemsNotice='Saved basket values restored.';updateManualTotals();return;}if(name==='manual-basket-remove'){await changeManualBasket(id,{remove:true});return;}if(name==='manual-basket-submit'){await sendManualBasket();return;}if(name==='choose-manual-product'||name==='quick-add-manual-product'){if(busy)return;const product=state.products.find(p=>p.id===id);if(!product)return;const quantity=el?.closest('[data-manual-card]')?.querySelector('[data-manual-quantity]')?.value??qty(id),record={...product,id:product.dmdId||product.catalogueId||product.id,type:product.dmdType||product.catalogueType||'SAMPLE'};if(name==='choose-manual-product')manualSearchCleanup?.openProduct?.(record,{quantity});else{const label=el.textContent;el.disabled=true;el.textContent='Adding…';try{if(await manualSearchCleanup?.addProduct?.(record,{quantity}))toast('Product added to your test basket.');}finally{if(el.isConnected){el.disabled=false;el.textContent=label;}}}return;}if(name==='load-earlier'){const from=new Date(historyFrom||Date.now());from.setDate(from.getDate()-15);historyFrom=from.toISOString().slice(0,10);render();toast('Showing earlier matching test history.');return;}if(name==='dismiss-product'){hiddenPending.add(id);render();return;}if(name==='mobile-menu'){mobileMenu=!mobileMenu;render();return;}if(parityActions.has(name)){if(busy)return;busy=true;try{await handleParityAction(name,id,el,{get state(){return state;},ui,call,request,render,navigate,modal,close,toast,money,escape,basket,reviewBasket:refreshBasketReview,submitBasket:submitBasketReview,download,add,icon,act:action});}finally{busy=false;}return;}if(name==='reload'){location.reload();return;}if(name==='nav-history'){navigate('history');return;}if(name==='close'){close();return;}if(name==='basket'){basket();return;}
if(name==='help'){modal('Explore your StockIQ draft',`<div class="modal-content"><p>This workspace uses the NHS dm+d catalogue and a separate test ordering API.</p><ol class="help-steps"><li>Add a product in <b>Auto Orders</b> or <b>Manual Orders</b>.</li><li>Open the basket and submit a <b>test order</b>.</li><li>Receive it in <b>Goods In</b> and check <b>History</b>.</li><li>Open <b>Tools → API Test Console</b> to run API checks.</li></ol><p class="muted">Supplier connections, live pricing, PMR, OCR and AI are not connected in this draft.</p></div>`);return;}
if(name==='alerts'){ui.alertsRead=true;const badge=document.querySelector('.notification b');if(badge)badge.textContent='';modal('Workspace alerts',`<div class="modal-content">${state.products.filter(p=>p.stock<p.target).slice(0,8).map(p=>`<div class="alert-row"><span class="alert-dot"></span><div><strong>${escape(p.name)}</strong><p>${p.stock} packs on shelf · target ${p.target}</p></div></div>`).join('')}</div>`);return;}
if(name==='demo-signout'){close();ui.demoLogin=true;history.pushState({},'','/login');render();return;}if(name==='account'){modal('St Mellons Pharmacy',`<div class="modal-content"><div class="account-card"><span class="avatar">SM</span><div><strong>Test workspace</strong><p class="muted">No production account connected</p></div></div><div class="account-menu"><button class="btn full" data-action="open-settings">Workspace settings</button><button class="btn full" data-action="theme">Toggle light / dark mode</button><button class="btn full" data-action="text-size">Change text size</button><button class="btn full" data-action="support-chat">Support notes</button><button class="btn full" data-nav="surplus">Surplus transfers</button><button class="btn full" data-action="export-workspace">Export workspace</button><a class="btn full" href="/source.zip" download="stockiq-source.zip">Download source</a><button class="btn full" data-nav="api">API Test Console</button><button class="btn full" data-action="demo-signout">Sign out of test workspace</button></div></div>`);return;}
if(name==='open-settings'){close();navigate('settings');return;}
if(name==='theme'){document.body.classList.toggle('dark');localStorage.setItem('stockiq.theme',document.body.classList.contains('dark')?'dark':'light');render();return;}
if(name==='text-size'){document.body.classList.toggle('large-text');localStorage.setItem('stockiq.fontSize',document.body.classList.contains('large-text')?'large':'normal');return;}
if(name==='details'){const o=state.orders.find(o=>o.id===id);if(o)modal(o.id,orderDetailsHTML(o,escape,money),true);return;}
if(name==='retry-unavailable'){if(busy)return;const o=state.orders.find(o=>o.id===id);if(!o)return;busy=true;try{for(const p of o.items){const quantity=Math.max(0,p.quantity-(p.acceptedQuantity??p.quantity));if(quantity)await call('/api/basket','POST',{productId:p.id,quantity});}close();render();basket();toast('Only the packs not accepted were added. Review a different supplier before sending.');}finally{busy=false;}return;}
if(name==='claim'){modal('Raise a test claim',`<div class="modal-content"><label class="field">Reason<textarea id="claim-reason" placeholder="Describe the issue" maxlength="500"></textarea></label><div class="modal-footer"><button class="btn btn-primary" data-action="confirm-claim" data-id="${escape(id)}">Create test claim</button></div></div>`);return;}
if(name==='receive'){const o=state.orders.find(o=>o.id===id);if(!o)return;const pending=o.items.filter(p=>(p.received||0)<(p.acceptedQuantity??p.quantity));if(!pending.length){toast('There are no accepted packs left to receive.');return;}modal('Check in delivery',`<div class="modal-content"><p class="muted">${escape(id)} · ${escape(o.supplier)} · Enter accepted packs received today. Packs not accepted are excluded.</p><label class="field">Invoice or delivery note<input id="receipt-invoice" maxlength="80" placeholder="e.g. TEST-INV-1001"></label>${pending.map(p=>{const remaining=(p.acceptedQuantity??p.quantity)-(p.received||0);return `<label class="receipt-line"><span>${escape(p.name)}<small>${remaining} accepted packs still to receive · ${p.received||0} already checked in</small></span><input type="number" class="qty-input" min="0" max="${remaining}" value="${remaining}" data-receive-id="${escape(p.id)}" aria-label="Received ${escape(p.name)}"></label>`;}).join('')}<div class="modal-footer"><button class="btn btn-primary" data-action="confirm-receive" data-id="${escape(id)}">Confirm test receipt</button></div></div>`,true);return;}
if(name==='save-draft'&&view==='review'){
 if(busy||basketReview.loading)return;if(!state.basket.length){basketReview.error='Add at least one medicine before saving a draft.';render();return;}
 const suggestion='Draft '+new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}),answer=window.prompt('Name this draft',suggestion);if(answer===null)return;
 busy=true;basketReview.loading=true;basketReview.error='';render();
 try{await call('/api/drafts','POST',{name:answer.trim()||suggestion});basketReview.draftSaved=true;toast('Draft saved.');}
 catch(error){basketReview.error=error.message||'Could not save this draft.';}
 finally{busy=false;basketReview.loading=false;if(view==='review')render();}return;
}
if(name==='save-draft'){if(!state.basket.length)throw new Error('Add at least one product to save a draft.');modal('Save test draft',`<div class="modal-content"><label class="field">Draft name<input id="draft-name" maxlength="80" value="Morning order"></label><div class="modal-footer"><button class="btn btn-primary" data-action="confirm-draft">Save draft</button></div></div>`);return;}
if(name==='reset'){modal('Reset sample workspace?',`<div class="modal-content"><p>This resets only the sample data in this browser workspace.</p><div class="modal-footer"><button class="btn" data-action="close">Cancel</button><button class="btn danger" data-action="confirm-reset">Reset sample data</button></div></div>`);return;}
if(name==='export-workspace'){download(JSON.stringify(state,null,2),'stockiq-test-workspace.json');return;}
if(name==='export'){const lines=[['Order','Supplier','Status','Total','Date'],...state.orders.map(o=>[o.id,o.supplier,o.status,o.total,o.createdAt])];download(lines.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n'),'stockiq-test-orders.csv','text/csv');return;}
if(name==='select-all'){document.querySelectorAll('[data-select]').forEach(input=>selected.add(input.dataset.select));render();return;}
if(name==='remove-selected'){selected.forEach(p=>hiddenPending.add(p));selected.clear();render();toast('Selected sample suggestions dismissed.');return;}
if(name==='import-file'){$('#import-file')?.click();return;}
if(name==='run-api'){const method=$('#api-method').value,path=$('#api-path').value;let body;try{body=$('#api-body').value.trim()?JSON.parse($('#api-body').value):undefined;}catch{throw new Error('Request body must be valid JSON.');}const start=performance.now();const r=await request(path,method,body);apiResults.unshift({name:`${method} ${path}`,method,path,status:r.status,ok:r.ok,passed:r.ok,duration:Math.round(performance.now()-start),body:r.data||r.error});render();toast(`API responded ${r.status}`);return;}
if(name==='run-suite'){await runSuite();return;}
if(busy)return;busy=true;document.body.classList.add('working');
try{
if(name==='add'){await add(id,el?.classList.contains('concession-card')?1:qty(id));toast('Product added to your test basket.');}
else if(name==='add-selected'){if(!selected.size)throw new Error('Select at least one product.');for(const p of selected)await add(p);selected.clear();toast('Selected products added to test basket.');}
else if(name==='remove-basket'){await call(`/api/basket/${id}`,'DELETE');render();basket();return;}
else if(name==='submit-order'){const order=await call('/api/orders','POST',{notes:$('#order-notes')?.value||'',supplier:$('#order-supplier')?.value||state.settings.preferredSupplier});render();modal('Test order result',submittedOrdersHTML([order],escape,money),true);return;}
else if(name==='confirm-receive'){const items=[...document.querySelectorAll('[data-receive-id]')].map(input=>({productId:input.dataset.receiveId,quantity:Number(input.value)})).filter(i=>i.quantity>0);if(!items.length)throw new Error('Enter at least one received pack.');await call(`/api/orders/${id}/receive`,'POST',{items,invoice:$('#receipt-invoice')?.value||''});close();toast('Test delivery received. Sample stock updated.');}
else if(name==='confirm-claim'){await call(`/api/orders/${id}/claim`,'POST',{reason:$('#claim-reason').value});close();subtab='claims';toast('Test claim created.');}
else if(name==='confirm-draft'){await call('/api/drafts','POST',{name:$('#draft-name').value});basketReview.draftSaved=true;close();toast('Test draft saved.');}
else if(name==='restore-draft'){await call(`/api/drafts/${id}/restore`,'POST',{});basketReview.draftSaved=true;basket();toast('Draft restored to test basket.');return;}
else if(name==='delete-draft'){await call(`/api/drafts/${id}`,'DELETE');toast('Test draft deleted.');}
else if(name==='stock'){await call(`/api/stock/${id}`,'POST',{quantity:Number(document.querySelector(`[data-stock="${CSS.escape(id)}"]`).value)});toast('Sample stock count saved.');}
else if(name==='submit-feedback'){await call('/api/feedback','POST',{productId:$('#feedback-product').value,message:$('#feedback-message').value});toast('Feedback saved in this test workspace.');}
else if(name==='smart-add'){const products=state.products.filter(p=>p.stock<(state.settings.fastTargets?.[p.id]??p.target));for(const p of products)await add(p.id,Math.max(1,(state.settings.fastTargets?.[p.id]??p.target)-p.stock));toast(`${products.length} sample suggestions added to basket.`);}
else if(name==='save-delivery'){const deliveryTimes={};document.querySelectorAll('[data-cutoff]').forEach(i=>{const supplier=i.dataset.cutoff||i.dataset.id;deliveryTimes[supplier]={cutoff:i.value,arrival:document.querySelector(`[data-arrival="${CSS.escape(supplier)}"]`)?.value||'Next day'};});await call('/api/settings','PATCH',{deliveryTimes});toast('Sandbox delivery preferences saved.');}
else if(name==='save-fast'){const fastTargets={};document.querySelectorAll('[data-target]').forEach(i=>{fastTargets[i.dataset.target]=Number(i.value);});await call('/api/settings','PATCH',{fastTargets});toast('Sample fast line targets saved.');}
else if(name==='share'){const quantity=Number(document.querySelector(`[data-share="${CSS.escape(id)}"]`)?.value||1);if(!Number.isInteger(quantity)||quantity<1||quantity>(state.products.find(p=>p.id===id)?.stock||0))throw new Error('Choose an available quantity.');await call('/api/surplus/offers','POST',{productId:id,quantity});toast('Test surplus offer saved.');}
else if(name==='submit-import'){const raw=$('#import-text')?.value||'';const rows=raw.split('\n').filter(row=>row.trim());if(!rows.length)throw new Error('Enter at least one product line.');const parsed=rows.map((row,index)=>{const [term,n]=row.split(',');const matches=state.products.filter(p=>p.name.toLowerCase()===term.trim().toLowerCase()||p.pip===term.trim());const product=matches[0]||state.products.find(p=>p.name.toLowerCase().includes(term.trim().toLowerCase()));const quantity=Number(n?.trim()||1);if(!term.trim()||!product)throw new Error(`Line ${index+1}: product not found in sample catalogue.`);if(!Number.isInteger(quantity)||quantity<1||quantity>999)throw new Error(`Line ${index+1}: quantity must be 1–999 whole packs.`);return {id:product.id,quantity};});for(const row of parsed)await add(row.id,row.quantity);toast(`${parsed.length} imported sample lines added to basket.`);}
else if(name==='confirm-reset'){await call('/api/reset','POST',{});hiddenPending.clear();close();toast('Sample data reset.');}
else{toast('This integration is represented with sample data in the draft.');}
render();
}finally{busy=false;document.body.classList.remove('working');}
}
document.addEventListener('click',e=>{const el=e.target.closest('button,[data-nav]');if(!el)return;if(el.dataset.manualTab){switchManualItemsTab(el.dataset.manualTab);return;}if(el.dataset.nav){close();navigate(el.dataset.nav);return;}if(el.dataset.menu){menu=menu===el.dataset.menu?'':el.dataset.menu;render();return;}if(el.dataset.subtab!==undefined){subtab=el.dataset.subtab;filter='';if(view==='goods'){const route={deliveries:'/goods-in/queue',claims:'/goods-in/claims',analytics:'/goods-in/analytics',settings:'/goods-in/settings','goods-analytics':'/goods-in/analytics','goods-settings':'/goods-in/settings'}[subtab];if(route)history.replaceState({},'',route);}render();return;}if(el.dataset.action)action(el.dataset.action,el.dataset.id,el).catch(e=>toast(e.message));});
document.addEventListener('input',e=>{if(e.target.matches('[data-basket-notes],#cascade-notes')&&view==='review'){basketReview.notes=e.target.value;basketReview.draftSaved=false;return;}if(e.target.matches('[data-ui]')&&['search','text'].includes(e.target.type)){const key=e.target.dataset.ui,pos=e.target.selectionStart;ui[key]=e.target.value;render();const input=document.querySelector(`[data-ui="${CSS.escape(key)}"]`);input?.focus();input?.setSelectionRange(pos,pos);return;}if(e.target.matches('[data-search]')){search=e.target.value;const pos=e.target.selectionStart;render();const input=$('[data-search]');input?.focus();input?.setSelectionRange(pos,pos);}});
document.addEventListener('change',async e=>{const el=e.target;try{if(el.hasAttribute('data-manual-basket-quantity')){await changeManualBasket(el.dataset.manualBasketQuantity,{quantity:el.value});return;}if(el.hasAttribute('data-manual-basket-supplier')){await changeManualBasket(el.dataset.manualBasketSupplier,{supplier:el.value});return;}if(el.matches('[name="basket-supplier-option"]')){const button=$('#overlay .basket-supplier-use');if(button)button.textContent='Use '+el.value+' · '+money(Number(el.dataset.basketOfferTotal))+' total';return;}if(el.matches('[data-review-sort]')){const key=el.value;if(['wholesaler','lineTotal','name','unitPrice'].includes(key)){basketReview.sort={key,dir:['lineTotal','unitPrice'].includes(key)?'desc':'asc'};render();}return;}if(el.dataset.reviewSelect){el.checked?basketReview.selected.add(el.dataset.reviewSelect):basketReview.selected.delete(el.dataset.reviewSelect);render();return;}if(el.dataset.basketSupplier){await updateBasketLine(el.dataset.basketSupplier,{supplier:el.value});return;}if(el.dataset.cascadeProduct){const line=ui.cascade?.lines.find(line=>line.productId===el.dataset.cascadeProduct),quote=line?.quotes.find(quote=>quote.supplier===el.value),preview=document.querySelector(`[data-cascade-estimate="${CSS.escape(el.dataset.cascadeProduct)}"]`);if(preview)preview.innerHTML=quotePreviewHTML(quote,escape);return;}if(el.dataset.ui){ui[el.dataset.ui]=el.type==='checkbox'?el.checked:el.value;render();}else if(el.dataset.autoShelf){await call(`/api/stock/${el.dataset.autoShelf}`,'POST',{quantity:Number(el.value)});render();}else if(el.matches('[data-history-from]')){historyFrom=el.value;render();}else if(el.matches('[data-history-to]')){historyTo=el.value;render();}else if(el.dataset.select){el.checked?selected.add(el.dataset.select):selected.delete(el.dataset.select);render();}else if(el.matches('[data-filter]')){filter=el.value;render();}else if(el.dataset.basketQty){if(view==='review')await updateBasketLine(el.dataset.basketQty,{quantity:el.value});else{await call(`/api/basket/${el.dataset.basketQty}`,'PATCH',{quantity:Number(el.value)});render();basket();}}else if(el.dataset.setting){await call('/api/settings','PATCH',{[el.dataset.setting]:el.checked});toast('Sandbox preference saved.');}else if(el.id==='import-file'&&el.files[0]){const file=el.files[0];if(/^image\/(jpeg|png|webp)$/.test(file.type)){if(file.size>10000000)throw new Error('Choose an image smaller than 10 MB.');const url=URL.createObjectURL(file);const image=new Image();image.src=url;image.alt='Reference screenshot — review products manually';image.onload=()=>URL.revokeObjectURL(url);$('#import-preview')?.replaceChildren(image);toast('Reference image loaded. Enter reviewed product lines alongside it.');}else{if(file.size>1000000)throw new Error('Choose a text file smaller than 1 MB.');if(!/\.(csv|txt)$/i.test(file.name))throw new Error('Choose a JPEG, PNG, WebP, CSV or text file.');$('#import-text').value=await file.text();toast('File loaded. Review the lines before adding to the test basket.');}}}catch(err){toast(err.message);}});
document.addEventListener('keydown',e=>{
 const manualTab=e.target.closest?.('[data-manual-tab]');
 if(manualTab&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
  e.preventDefault();e.stopPropagation();const index=manualItemTabs.indexOf(manualTab.dataset.manualTab),next=e.key==='Home'?0:e.key==='End'?manualItemTabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+manualItemTabs.length)%manualItemTabs.length;switchManualItemsTab(manualItemTabs[next]);return;
 }
 if(supplierSheetState){
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
  if(e.key==='Tab'){
   const dialog=$('#overlay .basket-supplier-sheet'),controls=[...dialog.querySelectorAll('button,input,select,textarea,[tabindex]')].filter(control=>!control.disabled&&!control.hidden&&control.type!=='hidden'&&(!control.hasAttribute('tabindex')||control.tabIndex!==-1)),first=controls[0],last=controls.at(-1),active=document.activeElement;
   if(!first){e.preventDefault();dialog.focus();return;}
   if(e.shiftKey&&(active===first||!dialog.contains(active))){e.preventDefault();last.focus();}
   else if(!e.shiftKey&&(active===last||!dialog.contains(active))){e.preventDefault();first.focus();}
   return;
  }
 }
 if(e.key==='Escape'){close();menu='';render();}
});
window.addEventListener('hashchange',()=>{const v=location.hash.slice(1);if(v!==view&&titles[v])navigate(v);});
window.addEventListener('popstate',()=>{const alias=routeState();view=alias.view;subtab=alias.subtab||'';ui=location.pathname==='/login'?{demoLogin:true}:{};render();if(view==='review')void refreshBasketReview();else{basketReviewSequence++;basketReview.loading=false;}});
function routeState(){const aliases={'/goods-in/claims':{view:'goods',subtab:'claims'},'/goods-in/analytics':{view:'goods',subtab:'goods-analytics'},'/goods-in/settings':{view:'goods',subtab:'goods-settings'}},hash=location.hash.slice(1);return aliases[location.pathname]||{view:titles[hash]?hash:Object.entries(paths).find(([key,path])=>path===location.pathname)?.[0]||'auto'};}
document.addEventListener('submit',e=>{if(e.target.id==='demo-login'){e.preventDefault();ui.demoLogin=false;navigate('auto');}});
setInterval(()=>{const clock=$('#header-clock');if(clock)clock.textContent=new Date().toLocaleTimeString('en-GB');},1000);
if(localStorage.getItem('stockiq.fontSize')==='large')document.body.classList.add('large-text');
if(localStorage.getItem('stockiq.theme')==='dark')document.body.classList.add('dark');
restore().then(()=>{const route=routeState();view=titles[route.view]?route.view:'auto';subtab=route.subtab||'';if(location.pathname==='/login')ui.demoLogin=true;render();if(view==='review')void refreshBasketReview();}).catch(e=>{$('#app').innerHTML=`<div class="initial-loading"><strong>Unable to load workspace</strong><p>${escape(e.message)}</p><button class="btn" data-action="reload">Reload</button></div>`;});
