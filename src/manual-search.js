/** Accessible NHS dm+d medicine and pack picker. All requests stay on the draft origin. */
import {deliveryStatus} from './delivery-status.js';
let pickerCount=0;
// Remember only an explicit source choice during this page session; the initial choice is live.
let rememberedSource='live';
const MEDICINE_TYPES=new Set(['AMP','VMP','TARIFF_MEDICINE']);
const PACK_TYPES=new Set(['AMPP','VMPP','TARIFF','TARIFF_PACK','SAMPLE']);
const KNOWN_TYPES=new Set([...MEDICINE_TYPES,...PACK_TYPES]);
const packLabel=record=>record.pack?`${record.pack}${record.unit&&!record.pack.toLowerCase().endsWith(record.unit.toLowerCase())?` ${record.unit}`:''}`:'';

/** Keep display records small and require an explicit catalogue identifier and type. */
export function normaliseDmdRecords(records) {
  if(!Array.isArray(records))return [];
  const seen=new Set();
  return records.flatMap(record=>{
    if(!record||typeof record!=='object')return [];
    const id=String(record.id??'').trim(),type=String(record.type??'').toUpperCase();
    const name=typeof record.name==='string'?record.name.trim():'';
    if(!id||id.length>80||!KNOWN_TYPES.has(type)||!name||name.length>700)return [];
    const key=type+':'+id;if(seen.has(key))return [];seen.add(key);
    return [{id,type,name,pack:typeof record.pack==='string'||typeof record.pack==='number'?String(record.pack).slice(0,200):'',unit:typeof record.unit==='string'?record.unit.slice(0,100):'',manufacturer:typeof record.manufacturer==='string'?record.manufacturer.slice(0,180):'',brand:typeof record.brand==='string'?record.brand.slice(0,180):'',genericName:typeof record.genericName==='string'?record.genericName.slice(0,500):'',source:typeof record.source==='string'?record.source.slice(0,120):'',releaseDate:typeof record.releaseDate==='string'?record.releaseDate.slice(0,40):'',referencePriceSource:typeof record.referencePriceSource==='string'?record.referencePriceSource.slice(0,160):'',referencePrice:typeof record.referencePrice==='number'&&Number.isFinite(record.referencePrice)&&record.referencePrice>=0?record.referencePrice:null}];
  }).slice(0,60);
}

/** Validate a workspace-card selection before opening the shared medicine modal. */
export function prepareManualProductSelection(record,{quantity=1}={}) {
  const product=normaliseDmdRecords([record])[0],count=Number(quantity);
  if(!product)throw new Error('Choose a valid medicine.');
  if((typeof quantity!=='number'&&typeof quantity!=='string')||!Number.isInteger(count)||count<1||count>999)throw new Error('Enter a whole number of packs between 1 and 999.');
  return {record:product,quantity:count};
}

/** Retain one retry key for a pending direct order; edited inputs start a new attempt. */
export function createManualOrderAttempt(makeId=()=>crypto.randomUUID()) {
  let signature=null,requestId=null,completed=false;
  return {
    prepare(pack,{quantity,supplier,notes='',scenario='full'}) {
      if(completed)throw new Error('This item has already been submitted. Choose another item to create a new order.');
      const count=Number(quantity);
      if(typeof quantity!=='number'&&typeof quantity!=='string')throw new Error('Enter a whole number of packs between 1 and 999.');
      if(!pack||!PACK_TYPES.has(pack.type)||!pack.id)throw new Error('Choose a valid medicine pack.');
      if(!Number.isInteger(count)||count<1||count>999)throw new Error('Enter a whole number of packs between 1 and 999.');
      if(!['AAH','Phoenix','Alliance','BNS','Sigma','Trident','Warehouse'].includes(supplier))throw new Error('Choose a wholesaler.');
      if(!['full','partial','unavailable'].includes(scenario))throw new Error('Choose a valid test response.');
      if(typeof notes!=='string'||notes.length>500)throw new Error('Order notes must be at most 500 characters.');
      const values={id:pack.id,type:pack.type,query:pack.name.slice(0,200),quantity:count,supplier,notes:notes.trim(),scenario};
      const next=JSON.stringify(values);if(next!==signature||!requestId){signature=next;requestId=makeId();}
      return {...values,requestId};
    },
    invalidate(){if(!completed){signature=null;requestId=null;}},
    complete(){completed=true;}
  };
}

/**
 * request(path) returns {ok,status,data}; data.matches/data.packs contain catalogue records.
 * onAdd(payload) imports the pack into the basket; onSend(payload) creates only its direct test order.
 * mode:'basket' uses onSave(payload) to edit an existing line and locks its medicine identity.
 * onClose runs only after a user closes the owned modal, never during component cleanup.
 */
export function mountManualSearch({host,request,onAdd,onSend,onSave,onQuote,onCompare,mode='manual',onClose=()=>{},preferredSupplier='Phoenix',onError=()=>{}}={}) {
  const basketMode=mode==='basket';
  if(!host||typeof request!=='function'||typeof (basketMode?onSave:onAdd)!=='function')throw new TypeError('A host, request and '+(basketMode?'onSave':'onAdd')+' callback are required.');
  const doc=host.ownerDocument,instance=++pickerCount,base=`dmd-picker-${instance}`;
  const abort=new AbortController();
  const listen=(target,type,callback,options={})=>target.addEventListener(type,callback,{...options,signal:abort.signal});
  const node=(tag,className,text)=>{const el=doc.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  const root=node('section','manual-dmd panel');root.hidden=basketMode;
  const content=node('div','dmd-content');
  const provenanceBadge=node('span','dmd-provenance-badge','NHS dm+d · 9 Nov 2026');
  const sourceField=node('label','dmd-source-field');sourceField.htmlFor=`${base}-source`;sourceField.append(node('span','','Catalogue'));
  const sourceSelect=node('select','dmd-source-select');sourceSelect.id=`${base}-source`;sourceSelect.name='catalogue-source';for(const [value,text] of [['live','NHS dm+d catalogue'],['sample','Sample products']]){const option=node('option','',text);option.value=value;sourceSelect.append(option);}sourceSelect.value=rememberedSource;sourceField.append(sourceSelect);
  const heading=node('div','dmd-search-heading'),headingTitle=node('h2','','Find a medicine');headingTitle.id=`${base}-title`;heading.append(headingTitle,node('p','','Search by medicine name, strength or NHS code.'));root.setAttribute('aria-labelledby',headingTitle.id);
  const searchArea=node('div','dmd-search-area');
  const label=node('label','dmd-search-label','Medicine name or NHS code');label.htmlFor=`${base}-query`;
  const inputWrap=node('div','dmd-input-wrap'),searchIcon=node('span','dmd-search-icon');searchIcon.setAttribute('aria-hidden','true');
  const icon=doc.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('width','18');icon.setAttribute('height','18');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.8');icon.setAttribute('focusable','false');
  const circle=doc.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('cx','10.5');circle.setAttribute('cy','10.5');circle.setAttribute('r','6.5');
  const handle=doc.createElementNS('http://www.w3.org/2000/svg','path');handle.setAttribute('d','M15.5 15.5 21 21');handle.setAttribute('stroke-linecap','round');icon.append(circle,handle);searchIcon.append(icon);inputWrap.append(searchIcon);
  const input=node('input','dmd-query');input.id=`${base}-query`;input.type='search';input.maxLength=200;input.autocomplete='off';input.spellcheck=false;input.placeholder='Medicine name, strength or NHS code';input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','grid');input.setAttribute('aria-controls',`${base}-results`);input.setAttribute('aria-expanded','false');input.setAttribute('aria-describedby',`${base}-status`);inputWrap.append(input);
  const popover=node('div','dmd-popover');popover.hidden=true;
  const list=node('div','dmd-options');list.id=`${base}-results`;list.setAttribute('role','grid');list.setAttribute('aria-label','Matching medicines and basket actions');popover.append(list);
  const status=node('div','dmd-search-status','Type at least 2 characters.');status.id=`${base}-status`;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  inputWrap.append(popover);searchArea.append(label,inputWrap,status);
  const selection=node('div','dmd-selection');selection.hidden=true;
  const note=node('p','dmd-sandbox-note');
  const provenance=node('details','dmd-provenance-details');provenance.append(node('summary','','Catalogue details'),provenanceBadge,note);
  const meta=node('div','dmd-catalogue-meta');meta.append(sourceField,provenance);
  content.append(heading,searchArea,selection,meta);root.append(content);host.replaceChildren(root);
  let alive=true,timer,focusTimer,searchSequence=0,packSequence=0,query='',matches=[],renderedMatches=null,activeIndex=-1,selected=null,packs=[],selectedPack=null,isSearching=false,isLoadingPacks=false,isAdding=false,medicineModal=null,optionPointer=null,lastPointerInteraction=null;
  const errorMessage=(result,fallback)=>typeof result?.error==='string'?result.error:typeof result?.error?.message==='string'?result.error.message:fallback;
  const releaseLabel=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))?new Date(value+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'';
  const packReference=pack=>{
    if(pack.type==='SAMPLE')return 'Sample product · Simulated stock and supplier price';
    const parts=pack.type.startsWith('TARIFF')?['NHS Drug Tariff pack']:[pack.type,`SNOMED CT ${pack.id}`];
    const release=releaseLabel(pack.releaseDate);if(release)parts.push(`Release ${release}`);
    if(pack.referencePrice!==null){const priceLabel=/tariff/i.test(pack.referencePriceSource)||pack.type.startsWith('TARIFF')?'Drug Tariff reference':/dm.?d|list|ampp/i.test(pack.referencePriceSource)?'dm+d list price reference':'Reference price';parts.push(`${priceLabel}: ${new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(pack.referencePrice)}`);}
    return parts.join(' · ');
  };
  const setStatus=(text,error=false)=>{if(!alive)return;status.textContent=text;status.classList.toggle('is-error',error);};
  const cancelFocusClose=()=>{clearTimeout(focusTimer);focusTimer=null;};
  const closeMatches=()=>{cancelFocusClose();popover.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');activeIndex=-1;};
  const deferFocusClose=()=>{cancelFocusClose();focusTimer=setTimeout(()=>{focusTimer=null;if(alive&&!medicineModal&&!isAdding&&!optionPointer&&!root.contains(doc.activeElement))closeMatches();},0);};
  const updateActive=()=>{[...list.querySelectorAll('[data-dmd-index]')].forEach((option,index)=>{option.classList.toggle('is-active',index===activeIndex);option.closest('[role=row]')?.setAttribute('aria-selected',String(index===activeIndex));});if(activeIndex>=0){input.setAttribute('aria-activedescendant',`${base}-option-${activeIndex}`);list.querySelector(`#${base}-option-${activeIndex}`)?.scrollIntoView?.({block:'nearest'});}else input.removeAttribute('aria-activedescendant');};
  function showMatches(){
    if(renderedMatches===matches&&matches.length){popover.hidden=false;input.setAttribute('aria-expanded','true');updateActive();return;}
    list.replaceChildren();activeIndex=-1;input.removeAttribute('aria-activedescendant');
    if(!matches.length){closeMatches();return;}
    renderedMatches=matches;
    matches.forEach((match,index)=>{
      const row=node('div','dmd-result-row');row.setAttribute('role','row');row.setAttribute('aria-selected','false');
      const medicineCell=node('div','dmd-result-medicine');medicineCell.setAttribute('role','gridcell');medicineCell.id=`${base}-option-${index}`;
      const option=node('button','dmd-option');option.type='button';option.dataset.dmdIndex=String(index);option.tabIndex=-1;option.setAttribute('aria-label',`Ordering options for ${match.name}`);
      const description=node('span','dmd-option-description');description.append(node('strong','',match.name));
      const metaParts=[packLabel(match)];if(match.manufacturer&&!match.name.toLowerCase().includes(match.manufacturer.toLowerCase()))metaParts.push(match.manufacturer);if(match.genericName&&!match.name.toLowerCase().includes(match.genericName.toLowerCase()))metaParts.push(`Generic: ${match.genericName}`);const meta=metaParts.filter(Boolean).join(' · ');if(meta)description.append(node('small','',meta));
      option.append(description,node('span','dmd-type',match.type==='SAMPLE'?'Sample product':match.type.startsWith('TARIFF')?'Tariff pack':match.type));medicineCell.append(option);row.append(medicineCell);
      const actionCell=node('div','dmd-result-actions');actionCell.setAttribute('role','gridcell');
      if(PACK_TYPES.has(match.type)){
        const quantity=node('input','dmd-quick-quantity');quantity.type='number';quantity.min='1';quantity.max='999';quantity.step='1';quantity.value='1';quantity.dataset.dmdQuantity=String(index);quantity.setAttribute('inputmode','numeric');quantity.setAttribute('aria-label',`Packs to add for ${match.name}`);
        const add=node('button','btn btn-soft dmd-quick-add','Add to basket');add.type='button';add.dataset.dmdAdd=String(index);add.setAttribute('aria-label',`Add ${match.name} to basket`);actionCell.append(quantity,add);
      }else actionCell.append(node('span','dmd-quick-pack-hint','Choose a pack first'));
      row.append(actionCell);list.append(row);
    });
    popover.hidden=false;input.setAttribute('aria-expanded','true');
  }
  async function addProduct(record,{quantity=1}={}){
    if(!alive||isAdding||medicineModal)return false;
    if(basketMode)throw new Error('Save the existing basket line from its supplier modal.');
    const prepared=prepareManualProductSelection(record,{quantity}),pack=prepared.record;
    if(!PACK_TYPES.has(pack.type))throw new Error('Choose a medicine pack before adding to the basket.');
    isAdding=true;const sequence=searchSequence,focused=doc.activeElement,controls=[input,sourceSelect,...root.querySelectorAll('[data-dmd-add],[data-dmd-quantity]')],disabled=controls.map(control=>control.disabled);
    controls.forEach(control=>control.disabled=true);setStatus(`Adding ${prepared.quantity} ${prepared.quantity===1?'pack':'packs'} to basket…`);
    try{await onAdd({id:pack.id,type:pack.type,query:pack.name.slice(0,200),quantity:prepared.quantity});if(alive&&sequence===searchSequence)setStatus(`${prepared.quantity} ${prepared.quantity===1?'pack':'packs'} of ${pack.name} added to your basket. Review the basket before sending.`);return true;}
    catch(error){if(alive&&sequence===searchSequence)setStatus(error?.message||'Could not add this pack. Try again.',true);onError(error);throw error;}
    finally{isAdding=false;if(alive){controls.forEach((control,index)=>control.disabled=disabled[index]);if(doc.activeElement===doc.body&&root.contains(focused)&&focused.isConnected!==false)focused.focus();}}
  }
  function chooseResult(index){
    const quantity=list.querySelector(`[data-dmd-quantity="${index}"]`),count=quantity?Number(quantity.value):1;
    if(!Number.isInteger(count)||count<1||count>999){setStatus('Enter a whole number of packs between 1 and 999.',true);quantity?.focus();return;}
    void chooseMatch(index,count);
  }
  const money=value=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(value)||0);
  function closeMedicineModal({resetSearch=false,notify=true,force=false}={}) {
    if(!medicineModal||isAdding&&!force)return;
    const current=medicineModal;medicineModal=null;packSequence++;clearTimeout(current.quoteTimer);current.quoteSequence=(current.quoteSequence||0)+1;current.brandSequence=(current.brandSequence||0)+1;current.layer.remove();
    doc.body.style.overflow=current.previousOverflow;if(current.background)current.background.inert=current.previousInert;
    input.disabled=false;sourceSelect.disabled=false;selected=null;selectedPack=null;packs=[];selection.hidden=true;
    if(resetSearch){input.value='';query='';matches=[];searchSequence++;closeMatches();}
    if(notify&&alive)onClose();
    if(alive&&basketMode){if(current.previousFocus?.isConnected&&(doc.activeElement===doc.body||current.dialog.contains(doc.activeElement)))current.previousFocus.focus();}else if(alive&&input.isConnected!==false)input.focus();
  }
  function openMedicineModal(initialQuantity=1,initialSupplier=preferredSupplier) {
    closeMedicineModal({notify:false,force:true});
    const layer=node('div','manual-order-backdrop');layer.dataset.manualOrderModal='';
    const dialog=node('section','manual-order-dialog manual-order-compact');dialog.tabIndex=-1;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby',`${base}-modal-title`);
    const header=node('div','manual-order-header'),title=node('h2','',selected?.genericName||selected?.name||'Manual order');title.id=`${base}-modal-title`;
    const closeButton=node('button','manual-order-close','×');closeButton.type='button';closeButton.setAttribute('aria-label',basketMode?'Close basket supplier options':'Close manual order');
    const headerActions=node('div','manual-order-header-actions'),optionsButton=node('button','btn btn-soft manual-order-options-toggle','More options');optionsButton.type='button';optionsButton.disabled=true;optionsButton.setAttribute('aria-expanded','false');headerActions.append(optionsButton,closeButton);header.append(title,headerActions);
    const body=node('div','manual-order-content');dialog.append(header,body);layer.append(dialog);
    const background=doc.getElementById('app'),previousOverflow=doc.body.style.overflow,previousInert=background?.inert,previousFocus=doc.activeElement;
    doc.body.style.overflow='hidden';if(background)background.inert=true;doc.body.append(layer);
    medicineModal={layer,dialog,body,title,optionsButton,closeButton,previousOverflow,background,previousInert,previousFocus,initialQuantity,selectedSupplier:initialSupplier,quoteSequence:0,quoteChain:Promise.resolve(),attempt:createManualOrderAttempt()};
    input.disabled=true;sourceSelect.disabled=true;
    listen(closeButton,'click',()=>closeMedicineModal());
    listen(layer,'click',event=>{event.stopPropagation();if(event.target===layer)closeMedicineModal();});
    listen(layer,'keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMedicineModal();return;}
      if(event.key==='Tab'){
        const focusable=[...dialog.querySelectorAll('button,input,select,textarea,[tabindex]')].filter(el=>!el.disabled&&el.tabIndex!==-1&&!el.hidden&&(el.getClientRects?.().length??1)>0);
        const first=focusable[0],last=focusable.at(-1);
        if(!first){event.preventDefault();dialog.focus();return;}
        if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===dialog)){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&(doc.activeElement===last||!dialog.contains(doc.activeElement))){event.preventDefault();first.focus();}
      }
    });
    queueMicrotask(()=>{if(medicineModal?.dialog===dialog)dialog.focus();});
  }
  const arrivalLabel=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'}).format(new Date(value))+' (UK time)':'';
  function deliveryBadge(delivery,acceptedQuantity=1){
    const status=deliveryStatus(delivery,{acceptedQuantity}),badge=node('span',`delivery-status is-${status.tone}`,status.label);
    const explanation=status.isEstimate?'Schedule estimate only. Delivery has not been confirmed by a supplier.':'No packs were accepted for delivery.';badge.title=explanation;badge.setAttribute('aria-label',`${status.label}. ${explanation}`);
    if(status.isEstimate)badge.append(node('small','delivery-status-estimate','Est.'));return badge;
  }
  const supplierSource=(supplier,delivery,acceptedQuantity=1)=>{const status=deliveryStatus(delivery,{acceptedQuantity});return [supplier,status.depot].filter(Boolean).join(' · ');};
  function renderModalResult(kind,result,count,pack) {
    const current=medicineModal;if(!current)return;clearTimeout(current.quoteTimer);current.quoteSequence++;current.brandSequence=(current.brandSequence||0)+1;current.optionsButton.hidden=true;doc.activeElement?.blur?.();const body=current.body;body.replaceChildren();
    const order=result?.order,fulfilment=order?.fulfilment,accepted=fulfilment?.acceptedQuantity??order?.items?.[0]?.acceptedQuantity??count,requested=fulfilment?.requestedQuantity??count,outstanding=fulfilment?.outstandingQuantity??Math.max(0,requested-accepted);
    const outcome=kind==='sent'?(fulfilment?.status||(order?.status==='Not accepted'?'unavailable':'accepted')):'added';
    const title=outcome==='unavailable'?'Test order not accepted':outcome==='partial'?'Part of your test order accepted':kind==='sent'?'Test order accepted':'Added to basket';
    const state=node('div',`manual-order-result ${outcome==='partial'?'is-partial':outcome==='unavailable'?'is-unavailable':kind==='sent'?'is-sent':'is-added'}`);state.setAttribute('role','status');state.setAttribute('aria-live','polite');
    state.append(node('h3','',title),node('p','manual-order-result-name',pack.name));
    if(kind==='sent'){
      const counts=node('div','manual-order-result-counts');for(const [label,value] of [['Requested',requested],['Accepted',accepted],['Unavailable',outstanding]]){const item=node('span','');item.append(node('small','',label),node('strong','',`${value} packs`));counts.append(item);}state.append(counts);
      state.append(node('p','manual-order-result-source',`Coming from ${supplierSource(fulfilment?.sourceLabel||order.supplier,fulfilment?.delivery,accepted)}`),node('p','manual-order-result-ref',`Order ${order.id} · Supplier reference ${fulfilment?.supplierReference||'Not provided'}`));
      const delivery=node('div','manual-order-result-delivery');delivery.append(deliveryBadge(fulfilment?.delivery,accepted));const status=deliveryStatus(fulfilment?.delivery,{acceptedQuantity:accepted}),arrival=arrivalLabel(status.estimatedArrivalAt);delivery.append(node('small','',arrival?'Estimated arrival · '+arrival:accepted?'Arrival estimate unavailable':'No delivery expected'));state.append(delivery,node('p','manual-order-result-total','Order total '+money(order.total)));
      if(outstanding)state.append(node('p','manual-order-shortage',`${outstanding} ${outstanding===1?'pack was':'packs were'} not accepted. These packs are not backordered.`));
      state.append(node('small','manual-order-result-note','Simulated response · No real supplier contacted. Only accepted packs can be received.'));
    }else state.append(node('p','',`${count} ${count===1?'pack is':'packs are'} ready in your basket. Review and send the basket later.`));
    const actions=node('div','manual-order-result-actions'),another=node('button','btn','Continue searching'),done=node('button','btn btn-primary','Done');another.type=done.type='button';
    if(kind==='sent'&&outstanding){const remaining=node('button','btn btn-soft manual-order-remaining','Try remaining packs');remaining.type='button';actions.append(remaining);listen(remaining,'click',()=>{current.initialQuantity=outstanding;current.selectedSupplier=order.supplier;current.attempt=createManualOrderAttempt();renderSelection();current.body.querySelector('[name="quantity"]')?.focus();});}
    actions.append(another,done);state.append(actions);body.append(state);
    listen(another,'click',()=>closeMedicineModal({resetSearch:true}));listen(done,'click',()=>closeMedicineModal());current.closeButton.disabled=false;done.focus();
  }
  function renderSelection(){
    selection.replaceChildren();selection.hidden=true;if(!selected)return;
    const current=medicineModal;if(!current)return;const body=current.body;body.replaceChildren();current.optionsButton.hidden=false;current.optionsButton.disabled=true;
    const titleFor=pack=>{const name=pack?.genericName||selected.genericName||selected.name,label=packLabel(pack||selected);return name+(label?' · '+label:'');};
    current.title.textContent=titleFor(selectedPack);current.title.title=current.title.textContent;
    if(isLoadingPacks){const loading=node('p','manual-order-loading','Loading available pack sizes…');loading.setAttribute('role','status');body.append(loading);return;}
    if(!packs.length){body.append(node('p','manual-order-error','No orderable packs were returned for this medicine. Try another match.'));return;}
    const suppliers=['AAH','Phoenix','Alliance','BNS','Sigma','Trident','Warehouse'],form=node('form','manual-order-form');form.noValidate=true;
    const toolbar=node('div','manual-order-toolbar');toolbar.classList.toggle('has-pack',packs.length>1);
    const brandField=node('label','field manual-order-brand');brandField.htmlFor=`${base}-brand`;brandField.append(node('span','','Brand / manufacturer'));
    const brand=node('select','');brand.id=`${base}-brand`;brand.name='brand';brandField.append(brand);
    const quantityField=node('label','field manual-order-quantity');quantityField.htmlFor=`${base}-quantity`;quantityField.append(node('span','','Packs'));
    const quantity=node('input','');quantity.id=`${base}-quantity`;quantity.name='quantity';quantity.type='number';quantity.min='1';quantity.max='999';quantity.step='1';quantity.required=true;quantity.value=String(current.initialQuantity);quantity.setAttribute('inputmode','numeric');quantityField.append(quantity);
    const packField=node('label','field manual-order-pack');packField.htmlFor=`${base}-pack`;packField.append(node('span','','Pack size'));packField.hidden=packs.length<2;
    const packSelect=node('select','');packSelect.id=`${base}-pack`;packSelect.name='pack';packs.forEach((pack,index)=>{const option=node('option','',packLabel(pack)||pack.name);option.value=String(index);option.selected=selectedPack?.id===pack.id&&selectedPack?.type===pack.type;packSelect.append(option);});packField.append(packSelect);toolbar.append(brandField,quantityField,packField);
    const supplier=node('select','manual-supplier-source');supplier.name='supplier';supplier.hidden=true;supplier.setAttribute('aria-label','Wholesaler');supplier.tabIndex=-1;for(const name of suppliers){const option=node('option','',name);option.value=name;option.selected=name===current.selectedSupplier;supplier.append(option);}
    const brandStatus=node('p','manual-brand-status');brandStatus.setAttribute('role','status');brandStatus.setAttribute('aria-live','polite');brandStatus.hidden=true;
    const quotePanel=node('section','manual-order-quote');quotePanel.setAttribute('aria-label','Selected supplier estimate');quotePanel.setAttribute('aria-live','polite');
    const comparisonPanel=node('section','manual-order-comparison');comparisonPanel.setAttribute('aria-label','Wholesaler offers');
    const offerTable=node('div','manual-offer-table');offerTable.setAttribute('role','radiogroup');offerTable.setAttribute('aria-label','Supplier offers');
    const offerColumns=node('div','manual-offer-columns');offerColumns.setAttribute('aria-hidden','true');for(const label of ['Supplier / brand','Pack price / total','Available','Delivery estimate'])offerColumns.append(node('span','',label));
    const offerRows=node('div','manual-offer-rows');offerTable.append(offerColumns,offerRows);
    const pagination=node('div','manual-offer-pagination'),previous=node('button','btn manual-offer-prev','Previous'),pageLabel=node('span','manual-offer-page'),next=node('button','btn manual-offer-next','Next');previous.type=next.type='button';pageLabel.setAttribute('aria-live','polite');pagination.append(previous,pageLabel,next);comparisonPanel.append(offerTable,pagination);
    const optionsView=node('section','manual-order-options-view');optionsView.hidden=true;optionsView.setAttribute('aria-label','Order options');const tabs=node('div','manual-options-tabs');tabs.setAttribute('role','tablist');
    const notesSection=node('div','manual-options-section'),scenarioSection=node('div','manual-options-section'),medicineSection=node('div','manual-options-section');
    const notesField=node('label','field');notesField.htmlFor=`${base}-notes`;notesField.append(node('span','','Order note (optional)'));const notes=node('textarea','');notes.id=`${base}-notes`;notes.name='notes';notes.maxLength=500;notes.rows=2;notes.placeholder='Note for this test order';notesField.append(notes);notesSection.append(notesField);
    const scenarioField=node('label','field');scenarioField.htmlFor=`${base}-scenario`;scenarioField.append(node('span','','Test response'));const scenario=node('select','');scenario.id=`${base}-scenario`;scenario.name='scenario';for(const [value,text] of [['full','All packs accepted'],['partial','Some packs unavailable'],['unavailable','No packs available']]){const option=node('option','',text);option.value=value;scenario.append(option);}scenario.value='full';scenarioField.append(scenario);scenarioSection.append(scenarioField,node('small','','For testing only. No supplier is contacted.'));
    const reference=node('p','manual-order-reference',packReference(selectedPack));reference.title=reference.textContent;medicineSection.append(reference);
    const optionSections=basketMode?[['Medicine details',medicineSection]]:[['Notes',notesSection],['Test response',scenarioSection],['Medicine details',medicineSection]];optionSections.forEach(([name,section],index)=>{const tab=node('button','manual-options-tab',name);tab.type='button';tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(index===0));tab.id=`${base}-option-tab-${index}`;tab.setAttribute('aria-controls',`${base}-option-panel-${index}`);section.id=`${base}-option-panel-${index}`;section.setAttribute('role','tabpanel');section.setAttribute('aria-labelledby',tab.id);section.hidden=index!==0;listen(tab,'click',()=>{optionSections.forEach(([,panel],panelIndex)=>panel.hidden=panelIndex!==index);for(const button of tabs.children)button.setAttribute('aria-selected',String(button===tab));});tabs.append(tab);});optionsView.append(tabs,...optionSections.map(([,section])=>section));
    const footer=node('div','manual-order-footer'),chosen=node('div','manual-order-chosen'),chosenTotal=node('strong','','Select a supplier'),chosenInfo=node('small','');chosen.append(chosenTotal,chosenInfo);
    const message=node('p','manual-order-status');message.setAttribute('role','status');message.setAttribute('aria-live','polite');message.tabIndex=-1;
    const actions=node('div','manual-order-actions'),add=node('button',basketMode?'btn manual-order-cancel':'btn manual-order-add',basketMode?'Cancel':'Add to basket'),send=node('button',basketMode?'btn btn-primary manual-order-save':'btn btn-primary manual-order-send',basketMode?'Save basket changes':'Send now');add.type='button';send.type='submit';actions.append(add,send);footer.append(chosen,message,actions);
    form.append(toolbar,supplier,brandStatus,quotePanel,comparisonPanel,optionsView,footer);body.append(form);current.optionsButton.disabled=false;current.optionsButton.setAttribute('aria-expanded','false');current.optionsButton.textContent='More options';
    let quoteValue=null,quoteLoading=false,comparisonValue=null,comparisonKey=null,brandOptions=[selectedPack],basePack=selectedPack,brandLoading=false,offerPage=0,optionsOpen=false;
    const active=()=>alive&&medicineModal===current&&form.isConnected;
    const controls=[packSelect,brand,quantity,supplier,scenario,notes,add,send,current.closeButton,current.optionsButton];
    const brandLabel=pack=>[pack.brand||pack.name,pack.manufacturer].filter(Boolean).join(' · ');
    const updateTitle=()=>{current.title.textContent=titleFor(selectedPack);current.title.title=current.title.textContent;reference.textContent=packReference(selectedPack);reference.title=reference.textContent;};
    const renderBrands=()=>{brand.replaceChildren();brandOptions.forEach((pack,index)=>{const option=node('option','',brandLabel(pack));option.value=String(index);option.dataset.packId=pack.id;option.dataset.packType=pack.type;option.selected=pack.id===selectedPack.id&&pack.type===selectedPack.type;brand.append(option);});brand.title=brandLabel(selectedPack);};renderBrands();
    const updateActions=()=>{send.disabled=typeof (basketMode?onSave:onSend)!=='function'||isAdding||(typeof onQuote==='function'&&(quoteLoading||!quoteValue));add.disabled=isAdding||(!basketMode&&quoteLoading);brand.disabled=basketMode||isAdding||brandLoading;};
    const quotePayload=()=>({id:selectedPack.id,type:selectedPack.type,query:selectedPack.name.slice(0,200),quantity:Number(quantity.value),supplier:supplier.value,scenario:scenario.value});
    const updateChosen=()=>{const count=Number(quantity.value);chosenTotal.textContent=quoteValue?money(quoteValue.estimatedTotal):quoteLoading?'Checking price…':'Price unavailable';chosenInfo.textContent=quoteValue?`${supplier.value} · ${quoteValue.acceptedQuantity} of ${quoteValue.requestedQuantity} packs`:`${supplier.value} · ${Number.isInteger(count)?count:'—'} ${count===1?'pack':'packs'}`;};
    const quoteFor=name=>quoteValue?.supplier===name?quoteValue:comparisonValue?.quotes.find(quote=>quote.supplier===name);
    const pageSize=()=>{const view=doc.defaultView,height=Number(view?.visualViewport?.height)||Number(view?.innerHeight)||800,width=Number(view?.visualViewport?.width)||Number(view?.innerWidth)||1200;current.dialog.style.setProperty('--manual-viewport-height',height+'px');current.layer.style.setProperty('--manual-viewport-height',height+'px');current.layer.style.height=height+'px';current.layer.style.top=(Number(view?.visualViewport?.offsetTop)||0)+'px';current.layer.style.bottom='auto';current.dialog.classList.toggle('is-short-viewport',height<=600);current.dialog.classList.toggle('is-tiny-viewport',height<=400);if(width<=680)return Math.max(1,Math.min(7,Math.floor((height-340-(packs.length>1?44:0))/64)));return height>=700?7:height>=640?5:height>600?4:height>500?3:height>440?2:1;};
    function renderOffers(){
      if(!active())return;const focusedSupplier=offerRows.contains(doc.activeElement)?doc.activeElement.closest('[data-supplier]')?.dataset.supplier:null;offerRows.replaceChildren();const size=pageSize(),pages=Math.ceil(suppliers.length/size);offerPage=Math.max(0,Math.min(offerPage,pages-1));
      for(const name of suppliers.slice(offerPage*size,(offerPage+1)*size)){
        const quote=quoteFor(name),selectedSupplier=name===supplier.value,row=node('button',`manual-offer-row manual-comparison-row${selectedSupplier?' is-selected':''}${comparisonValue?.cheapestSuppliers.includes(name)?' is-cheapest':''}${comparisonValue?.recommendedSupplier===name?' is-recommended':''}`);row.type='button';row.dataset.supplier=name;row.setAttribute('role','radio');row.setAttribute('aria-checked',String(selectedSupplier));row.disabled=isAdding;row.tabIndex=selectedSupplier?0:-1;
        const source=node('span','manual-offer-supplier');source.append(node('strong',`supplier-tag ${name.toLowerCase()}`,name));const description=brandLabel(selectedPack);source.title=description;
        if(comparisonValue?.recommendedSupplier===name||comparisonValue?.cheapestSuppliers.includes(name)){const recommended=comparisonValue.recommendedSupplier===name,marker=node('span','manual-offer-recommended',recommended?'Recommended':'Cheapest');marker.dataset.shortLabel=recommended?'Best':'Low';marker.title=marker.textContent;marker.setAttribute('aria-label',marker.textContent);source.append(marker);}
        source.append(node('small','',description));
        const price=node('span','manual-offer-price');price.append(node('strong','',quote?money(quote.unitPrice):'—'),node('small','',quote?money(quote.estimatedTotal)+' total':'Price unavailable'));
        const availability=node('span','manual-offer-availability');availability.append(node('strong','',quote?`${quote.acceptedQuantity} / ${quote.requestedQuantity}`:'—'),node('small','','packs'));
        const delivery=node('span','manual-offer-delivery'),status=deliveryStatus(quote?.delivery,{acceptedQuantity:quote?.acceptedQuantity??1}),arrival=arrivalLabel(status.estimatedArrivalAt);delivery.append(deliveryBadge(quote?.delivery,quote?.acceptedQuantity??1),node('small','',arrival|| (quote?.acceptedQuantity===0?'No delivery':'No arrival estimate')));delivery.title=arrival||status.label;
        row.setAttribute('aria-label',`${name}, ${description}, ${quote?money(quote.unitPrice)+' per pack, '+money(quote.estimatedTotal)+' total, '+quote.acceptedQuantity+' of '+quote.requestedQuantity+' packs available':'price and availability unavailable'}, ${status.label}${arrival?', '+arrival:''}. Schedule estimate only.${comparisonValue?.recommendedSupplier===name?' Recommended among the cheapest offers.':comparisonValue?.cheapestSuppliers.includes(name)?' Cheapest offer.':''}`);row.title=row.getAttribute('aria-label');row.append(source,price,availability,delivery);listen(row,'click',()=>useSupplier(name));
        listen(row,'keydown',event=>{if(!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;event.preventDefault();const index=suppliers.indexOf(name),target=event.key==='Home'?0:event.key==='End'?suppliers.length-1:(index+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)+suppliers.length)%suppliers.length;offerPage=Math.floor(target/pageSize());useSupplier(suppliers[target]);offerRows.querySelector(`[data-supplier="${suppliers[target]}"]`)?.focus();});offerRows.append(row);
      }
      if(!offerRows.querySelector('[tabindex="0"]'))offerRows.firstElementChild?.setAttribute('tabindex','0');pagination.hidden=pages===1;previous.disabled=offerPage===0;next.disabled=offerPage===pages-1;pageLabel.textContent=`${offerPage+1} / ${pages} · ${suppliers.length} suppliers`;offerTable.dataset.pageSize=String(size);if(focusedSupplier)offerRows.querySelector(`[data-supplier="${focusedSupplier}"]`)?.focus();
    }
    function renderQuote(quote){
      quotePanel.replaceChildren();const label=quote.status==='partial'?'Part available':quote.status==='unavailable'?'Unavailable':'Available';quotePanel.append(node('span',`manual-order-quote-status is-${quote.status}`,label),node('span','manual-order-selected-source',`${supplierSource(quote.sourceLabel||quote.supplier,quote.delivery,quote.acceptedQuantity)} · ${quote.acceptedQuantity} of ${quote.requestedQuantity} packs`));updateChosen();
    }
    function renderComparison(result){
      if(!result||!Array.isArray(result.quotes)||!result.quotes.length)throw new Error('The comparison response was incomplete. Please retry.');
      const quotes=result.quotes.filter(quote=>quote&&suppliers.includes(quote.supplier)&&Number.isFinite(quote.unitPrice)&&Number.isFinite(quote.estimatedTotal)&&Number.isInteger(quote.acceptedQuantity)&&Number.isInteger(quote.requestedQuantity));if(quotes.length!==result.quotes.length)throw new Error('The comparison response was incomplete. Please retry.');
      const cheapest=Array.isArray(result.cheapestSuppliers)?result.cheapestSuppliers.filter(name=>quotes.some(quote=>quote.supplier===name&&quote.acceptedQuantity===quote.requestedQuantity)):[];comparisonValue={...result,quotes,cheapestSuppliers:cheapest,recommendedSupplier:cheapest.includes(result.recommendedSupplier)?result.recommendedSupplier:null};renderOffers();
    }
    function comparisonError(error){renderOffers();const retry=node('button','btn btn-soft manual-comparison-retry','Retry prices');retry.type='button';retry.title=error?.message||'Could not compare supplier prices.';listen(retry,'click',()=>{comparisonKey=null;comparisonValue=null;loadQuote();});quotePanel.append(retry);}
    function useSupplier(name){if(isAdding||!active()||!suppliers.includes(name))return;supplier.value=name;current.selectedSupplier=name;edit();loadQuote();}
    function loadQuote(){
      if(!active())return;clearTimeout(current.quoteTimer);const sequence=++current.quoteSequence;quoteValue=null;quoteLoading=typeof onQuote==='function';quotePanel.replaceChildren(node('span','manual-order-quote-loading',quoteLoading?'Checking price and availability…':'Select a supplier to continue.'));updateActions();updateChosen();const payload=quotePayload(),nextComparisonKey=JSON.stringify([payload.type,payload.id,payload.quantity,payload.scenario]);
      if(comparisonKey!==nextComparisonKey){comparisonValue=null;offerPage=0;}renderOffers();
      if(!Number.isInteger(payload.quantity)||payload.quantity<1||payload.quantity>999){quoteLoading=false;quotePanel.replaceChildren(node('span','manual-order-quote-error','Enter 1–999 whole packs.'));comparisonValue=null;comparisonKey=null;renderOffers();updateActions();return;}
      if(typeof onQuote!=='function'){updateActions();return;}
      current.quoteTimer=setTimeout(()=>{current.quoteChain=current.quoteChain.catch(()=>{}).then(async()=>{
        if(!active()||sequence!==current.quoteSequence)return;
        try{
          const quote=await onQuote(payload);if(!active()||sequence!==current.quoteSequence)return;
          if(!quote||!['accepted','partial','unavailable'].includes(quote.status)||!Number.isInteger(quote.acceptedQuantity)||!Number.isInteger(quote.requestedQuantity))throw new Error('The quote response was incomplete. Please retry.');quoteValue=quote;renderQuote(quote);renderOffers();
          if(typeof onCompare==='function'){
            try{if(comparisonKey!==nextComparisonKey||!comparisonValue){const compared=await onCompare(payload);if(!active()||sequence!==current.quoteSequence)return;renderComparison(compared);comparisonKey=nextComparisonKey;}else renderOffers();}
            catch(error){if(active()&&sequence===current.quoteSequence){comparisonValue=null;comparisonKey=null;comparisonError(error);}}
          }
        }catch(error){
          if(!active()||sequence!==current.quoteSequence)return;quotePanel.replaceChildren(node('span','manual-order-quote-error',error?.message||'Could not check this supplier.'));const retry=node('button','btn btn-soft manual-order-quote-retry','Retry supplier check');retry.type='button';quotePanel.append(retry);listen(retry,'click',loadQuote);
        }finally{if(active()&&sequence===current.quoteSequence){quoteLoading=false;updateActions();updateChosen();renderOffers();}}
      });},180);
    }
    function loadBrands(pack){
      const sequence=current.brandSequence=(current.brandSequence||0)+1,key=pack.type+':'+pack.id;brandOptions=[pack];renderBrands();brandLoading=false;brand.disabled=false;brandStatus.hidden=true;if(basketMode){brand.disabled=true;brand.title=brandLabel(pack)+' · Current basket medicine';return;}if(!['AMPP','VMPP'].includes(pack.type))return;
      brandLoading=true;brand.disabled=true;void (async()=>{try{const response=await request(`/api/dmd/brands?id=${encodeURIComponent(pack.id)}&type=${encodeURIComponent(pack.type)}`);if(!active()||sequence!==current.brandSequence||basePack.type+':'+basePack.id!==key||selectedPack.type+':'+selectedPack.id!==key)return;
        if(!response?.ok)throw new Error('Brand alternatives unavailable. The selected pack is unchanged.');const options=normaliseDmdRecords(response.data?.packs).filter(record=>['AMPP','VMPP'].includes(record.type));if(!options.some(record=>record.id===pack.id&&record.type===pack.type))throw new Error('Brand alternatives unavailable. The selected pack is unchanged.');
        selectedPack={...pack,...options.find(record=>record.id===pack.id&&record.type===pack.type),name:pack.name};brandOptions=[selectedPack,...options.filter(record=>record.id!==pack.id||record.type!==pack.type)];renderBrands();updateTitle();renderOffers();if(response.data?.truncated){brandStatus.textContent=`Showing ${brandOptions.length} exact-pack brand options.`;brandStatus.title=brandStatus.textContent;brandStatus.hidden=false;}
      }catch(error){if(active()&&sequence===current.brandSequence){brandStatus.textContent=error?.message||'Brand alternatives unavailable. The selected pack is unchanged.';brandStatus.hidden=false;}}
      finally{if(active()&&sequence===current.brandSequence){brandLoading=false;brand.disabled=isAdding;}}})();
    }
    function edit(){current.attempt.invalidate();message.textContent='';message.classList.remove('is-error');}
    listen(brand,'change',()=>{if(basketMode||isAdding||!active())return;const pack=brandOptions[Number(brand.value)];if(!pack)return;selectedPack=pack;brand.title=brandLabel(pack);updateTitle();edit();loadQuote();});
    listen(packSelect,'change',()=>{const pack=packs[Number(packSelect.value)];if(basketMode||!pack||isAdding)return;basePack=selectedPack=pack;updateTitle();edit();loadQuote();loadBrands(pack);});
    listen(quantity,'input',()=>{edit();loadQuote();});listen(notes,'input',edit);listen(supplier,'change',()=>useSupplier(supplier.value));listen(scenario,'change',()=>{edit();loadQuote();});
    listen(previous,'click',()=>{if(offerPage>0){offerPage--;renderOffers();}});listen(next,'click',()=>{if((offerPage+1)*pageSize()<suppliers.length){offerPage++;renderOffers();}});
    const resize=()=>{if(!alive||medicineModal!==current)return;const size=pageSize();if(active()){offerPage=Math.min(offerPage,Math.ceil(suppliers.length/size)-1);renderOffers();}};if(doc.defaultView){listen(doc.defaultView,'resize',resize);if(doc.defaultView.visualViewport)listen(doc.defaultView.visualViewport,'resize',resize);}
    listen(current.optionsButton,'click',()=>{if(!active())return;optionsOpen=!optionsOpen;current.optionsButton.textContent=optionsOpen?'Back to offers':'More options';current.optionsButton.setAttribute('aria-expanded',String(optionsOpen));toolbar.hidden=quotePanel.hidden=comparisonPanel.hidden=optionsOpen;optionsView.hidden=!optionsOpen;if(optionsOpen)tabs.querySelector('[aria-selected="true"]')?.focus();});
    const submit=async kind=>{
      if(isAdding||!selectedPack||!active())return;let payload;try{payload=current.attempt.prepare(selectedPack,{quantity:quantity.value,supplier:supplier.value,notes:notes.value,scenario:scenario.value});}catch(error){message.textContent=error.message;message.classList.add('is-error');quantity.focus();return;}
      if(typeof (basketMode?onSave:kind==='sent'?onSend:onAdd)!=='function')return;if(quoteLoading||(basketMode||kind==='sent')&&typeof onQuote==='function'&&!quoteValue){message.textContent=basketMode?'Check the supplier estimate before saving. Retry the supplier check above.':'Check the supplier estimate before sending. Retry the supplier check above.';return;}
      const pack=selectedPack;isAdding=true;controls.forEach(control=>control.disabled=true);renderOffers();message.classList.remove('is-error');message.textContent=basketMode?'Saving basket changes…':kind==='sent'?'Sending test order…':'Adding to basket…';send.textContent=basketMode?'Saving…':kind==='sent'?'Sending…':'Send now';add.textContent=basketMode?'Cancel':kind==='added'?'Adding…':'Add to basket';
      try{if(basketMode){await onSave({id:payload.id,type:payload.type,quantity:payload.quantity,supplier:payload.supplier});current.attempt.complete();if(active()){setStatus('Basket updated.');closeMedicineModal({force:true});}return;}const result=await (kind==='sent'?onSend(payload):onAdd(payload));if(kind==='sent'&&(!result?.order?.id||typeof result.order.id!=='string'))throw new Error('The order response was incomplete. Try again to check the same request.');current.attempt.complete();if(active()){renderModalResult(kind,result,payload.quantity,pack);setStatus(kind==='sent'?`Test order ${result.order.id}: ${result.order.fulfilment?.status||'accepted'}.`:`${payload.quantity} packs added to the test basket.`);}}
      catch(error){if(active()){message.textContent=error?.message||'The request could not be completed. Try again.';message.classList.add('is-error');onError(error);}}
      finally{isAdding=false;if(active()){controls.forEach(control=>control.disabled=false);updateActions();renderOffers();send.textContent=basketMode?'Save basket changes':'Send now';add.textContent=basketMode?'Cancel':'Add to basket';}}
    };
    listen(add,'click',event=>{event.preventDefault();if(basketMode)closeMedicineModal();else void submit('added');});listen(form,'submit',event=>{event.preventDefault();event.stopPropagation();void submit('sent');});
    loadQuote();loadBrands(basePack);
  }
  async function chooseMatch(index,initialQuantity=1,initialSupplier=preferredSupplier){
    const match=matches[index];if(!match||isAdding)return;
    selected=match;selectedPack=null;packs=[];input.value=match.name;query=match.name;searchSequence++;clearTimeout(timer);closeMatches();openMedicineModal(initialQuantity,initialSupplier);selected=match;
    const sequence=++packSequence;
    if(PACK_TYPES.has(match.type)){packs=[match];selectedPack=match;isLoadingPacks=false;renderSelection();setStatus('Medicine selected.');return;}
    isLoadingPacks=true;renderSelection();setStatus('Loading available pack sizes…');
    try{
      const result=await request(`/api/dmd/packs?id=${encodeURIComponent(match.id)}&type=${encodeURIComponent(match.type)}&query=${encodeURIComponent(match.name)}`);
      if(!alive||sequence!==packSequence||!medicineModal)return;
      if(!result?.ok)throw new Error(errorMessage(result,'Pack lookup is unavailable. Please try again.'));
      packs=normaliseDmdRecords(result.data?.packs).filter(pack=>PACK_TYPES.has(pack.type));selectedPack=packs[0]||null;isLoadingPacks=false;renderSelection();
      setStatus(packs.length?`${packs.length} ${packs.length===1?'pack option':'pack options'} available.`:'No packs found. Choose another medicine.');
    }catch(error){if(!alive||sequence!==packSequence||!medicineModal)return;isLoadingPacks=false;renderSelection();const errorText=error?.message||'Could not load pack sizes.';const errorNode=medicineModal.body.querySelector('.manual-order-error');if(errorNode)errorNode.textContent=errorText;setStatus(errorText,true);onError(error);}
  }
  async function lookup(text,sequence){
    if(!alive||sequence!==searchSequence)return;const isLive=sourceSelect.value==='live';isSearching=true;setStatus(isLive?'Searching NHS dm+d…':'Searching sample products…');input.setAttribute('aria-busy','true');
    try{
      const result=await request(isLive?`/api/dmd/search?q=${encodeURIComponent(text)}`:`/api/products?q=${encodeURIComponent(text)}`);
      if(!alive||sequence!==searchSequence)return;
      if(!result?.ok)throw new Error(errorMessage(result,'Medicine lookup is unavailable. Please try again.'));
      matches=normaliseDmdRecords(isLive?result.data?.matches:Array.isArray(result.data)?result.data.map(product=>({...product,type:'SAMPLE',referencePrice:null})):[]);const release=isLive?releaseLabel(result.data?.releaseDate||matches[0]?.releaseDate):'';if(release)provenanceBadge.textContent=`NHS dm+d · ${release}`;showMatches();setStatus(matches.length?`${matches.length} matching ${matches.length===1?'pack':'packs'}.`:'No matches. Try a medicine name, strength or NHS code.');
    }catch(error){if(!alive||sequence!==searchSequence)return;matches=[];closeMatches();setStatus(`${error?.message||'Could not search the catalogue.'}${isLive?' Choose Sample products above to continue testing while catalogue search is unavailable.':''}`,true);onError(error);}
    finally{if(alive&&sequence===searchSequence){isSearching=false;input.removeAttribute('aria-busy');}}
  }
  function updateSourceLabels(){
    const isLive=sourceSelect.value==='live';
    provenanceBadge.textContent=isLive?'NHS dm+d · 9 Nov 2026':'Sample data only';
    note.textContent=isLive?'145,806 current medicine packs from the NHS dm+d release. Reference prices are not live supplier quotes. Orders and shelf stock are simulated.':'Sample products are test fixtures. Prices and stock are simulated.';
    input.placeholder=isLive?'Medicine name, strength or NHS code':'Search workspace sample products';
  }
  listen(sourceSelect,'change',()=>{
    rememberedSource=sourceSelect.value;selected=null;packs=[];selectedPack=null;query='';matches=[];searchSequence++;packSequence++;clearTimeout(timer);isSearching=false;isLoadingPacks=false;input.value='';input.removeAttribute('aria-busy');closeMatches();renderSelection();updateSourceLabels();setStatus('Type at least 2 characters.');input.focus();
  });
  updateSourceLabels();
  listen(input,'input',()=>{
    query=input.value.trim();selected=null;packs=[];selectedPack=null;isLoadingPacks=false;packSequence++;renderSelection();clearTimeout(timer);matches=[];closeMatches();
    const sequence=++searchSequence;input.removeAttribute('aria-busy');isSearching=false;
    if(query.length<2){setStatus('Type at least 2 characters.');return;}
    setStatus('Looking for matching medicines…');timer=setTimeout(()=>lookup(query,sequence),250);
  });
  listen(input,'focus',()=>{if(matches.length&&!selected)showMatches();});
  listen(input,'keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMatches();return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      if(!matches.length)return;event.preventDefault();event.stopPropagation();if(popover.hidden)showMatches();
      activeIndex=event.key==='ArrowDown'?(activeIndex+1)%matches.length:(activeIndex<0?matches.length-1:(activeIndex-1+matches.length)%matches.length);updateActive();
    }else if(event.key==='Enter'&&!popover.hidden&&activeIndex>=0){event.preventDefault();event.stopPropagation();chooseResult(activeIndex);}
  });
  // Keep native quantity inputs visible while pointer or keyboard focus moves.
  // Touch buttons activate on release; quantity controls keep browser behavior.
  const quickAddResult=index=>{const quantity=list.querySelector(`[data-dmd-quantity="${index}"]`);void addProduct(matches[index],{quantity:quantity?.value||''}).catch(error=>{if(alive){setStatus(error?.message||'Could not add this pack.',true);quantity?.focus();}});};
  listen(list,'pointerdown',event=>{
    const option=event.target.closest('[data-dmd-index],[data-dmd-add],[data-dmd-quantity]');if(!option)return;
    const kind=option.hasAttribute('data-dmd-add')?'add':option.hasAttribute('data-dmd-quantity')?'quantity':'modal';
    if((!event.pointerType||event.pointerType==='mouse')&&kind!=='quantity'){optionPointer=null;lastPointerInteraction=null;event.preventDefault();return;}
    const index=Number(kind==='add'?option.dataset.dmdAdd:kind==='quantity'?option.dataset.dmdQuantity:option.dataset.dmdIndex);
    optionPointer={id:event.pointerId??0,option,kind,index,sequence:searchSequence,x:event.clientX??0,y:event.clientY??0,moved:false};
  });
  listen(doc,'pointermove',event=>{if(!optionPointer||(event.pointerId??0)!==optionPointer.id)return;if(Math.hypot((event.clientX??0)-optionPointer.x,(event.clientY??0)-optionPointer.y)>10)optionPointer.moved=true;});
  listen(doc,'pointerup',event=>{
    if(!optionPointer||(event.pointerId??0)!==optionPointer.id)return;
    const gesture=optionPointer;optionPointer=null;
    if(gesture.kind==='quantity'){deferFocusClose();return;}
    const moved=gesture.moved||Math.hypot((event.clientX??0)-gesture.x,(event.clientY??0)-gesture.y)>10;
    const inside=gesture.option===event.target||gesture.option.contains(event.target);
    lastPointerInteraction={option:gesture.option,until:Date.now()+700};
    if(!alive||moved||!inside||!root.contains(gesture.option)||gesture.sequence!==searchSequence||medicineModal||isAdding)return;
    event.preventDefault();event.stopPropagation();if(gesture.kind==='add')quickAddResult(gesture.index);else chooseResult(gesture.index);
  });
  listen(doc,'pointercancel',event=>{if(optionPointer&&(event.pointerId??0)===optionPointer.id){const quantity=optionPointer.kind==='quantity';if(!quantity)lastPointerInteraction={option:optionPointer.option,until:Date.now()+700};optionPointer=null;if(quantity)deferFocusClose();}});
  listen(root,'click',event=>{
    const quickAdd=event.target.closest('[data-dmd-add]');if(quickAdd&&root.contains(quickAdd)){event.preventDefault();event.stopPropagation();if(medicineModal||isAdding||(lastPointerInteraction?.option===quickAdd&&lastPointerInteraction.until>Date.now()))return;quickAddResult(Number(quickAdd.dataset.dmdAdd));return;}
    const option=event.target.closest('[data-dmd-index]');if(option&&root.contains(option)){event.preventDefault();event.stopPropagation();if(medicineModal||isAdding||(lastPointerInteraction?.option===option&&lastPointerInteraction.until>Date.now()))return;chooseResult(Number(option.dataset.dmdIndex));return;}
    if(event.target.closest('[data-dmd-clear]')){event.preventDefault();event.stopPropagation();selected=null;packs=[];selectedPack=null;query='';matches=[];searchSequence++;packSequence++;clearTimeout(timer);isLoadingPacks=false;input.value='';renderSelection();setStatus('Type at least 2 characters.');input.focus();}
  });
  listen(doc,'pointerdown',event=>{if(!root.contains(event.target)){optionPointer=null;closeMatches();}});
  listen(root,'focusin',cancelFocusClose);
  listen(root,'focusout',event=>{if(root.contains(event.relatedTarget)){cancelFocusClose();return;}deferFocusClose();});
  listen(root,'keydown',event=>{if(event.key==='Escape'&&!popover.hidden){event.preventDefault();event.stopPropagation();optionPointer=null;input.focus();closeMatches();}});
  const cleanup=()=>{if(!alive)return;alive=false;cancelFocusClose();optionPointer=null;lastPointerInteraction=null;searchSequence++;packSequence++;clearTimeout(timer);closeMedicineModal({notify:false,force:true});abort.abort();root.remove();};
  cleanup.openProduct=(record,options={})=>{
    if(!alive||isAdding)return false;
    const prepared=prepareManualProductSelection(record,options);if(basketMode&&!PACK_TYPES.has(prepared.record.type))throw new Error('Choose a medicine pack already in your basket.');
    const supplier=options.supplier??preferredSupplier;if(!['AAH','Phoenix','Alliance','BNS','Sigma','Trident','Warehouse'].includes(supplier))throw new Error('Choose a wholesaler.');matches=[prepared.record];
    void chooseMatch(0,prepared.quantity,supplier);return true;
  };
  cleanup.addProduct=addProduct;
  return cleanup;
}
