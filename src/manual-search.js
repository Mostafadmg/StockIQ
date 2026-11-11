/** Accessible NHS dm+d medicine and pack picker. All requests stay on the draft origin. */
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
    return [{id,type,name,pack:typeof record.pack==='string'||typeof record.pack==='number'?String(record.pack).slice(0,200):'',unit:typeof record.unit==='string'?record.unit.slice(0,100):'',manufacturer:typeof record.manufacturer==='string'?record.manufacturer.slice(0,180):'',genericName:typeof record.genericName==='string'?record.genericName.slice(0,500):'',source:typeof record.source==='string'?record.source.slice(0,120):'',releaseDate:typeof record.releaseDate==='string'?record.releaseDate.slice(0,40):'',referencePriceSource:typeof record.referencePriceSource==='string'?record.referencePriceSource.slice(0,160):'',referencePrice:typeof record.referencePrice==='number'&&Number.isFinite(record.referencePrice)&&record.referencePrice>=0?record.referencePrice:null}];
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
 * onClose runs only after a user closes the owned modal, never during component cleanup.
 */
export function mountManualSearch({host,request,onAdd,onSend,onQuote,onCompare,onClose=()=>{},preferredSupplier='Phoenix',onError=()=>{}}={}) {
  if(!host||typeof request!=='function'||typeof onAdd!=='function')throw new TypeError('A host, request and onAdd callback are required.');
  const doc=host.ownerDocument,instance=++pickerCount,base=`dmd-picker-${instance}`;
  const abort=new AbortController();
  const listen=(target,type,callback,options={})=>target.addEventListener(type,callback,{...options,signal:abort.signal});
  const node=(tag,className,text)=>{const el=doc.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  const root=node('section','manual-dmd panel');
  const content=node('div','dmd-content');
  const provenanceBadge=node('span','dmd-provenance-badge','NHS dm+d · 9 Nov 2026');
  const sourceField=node('label','dmd-source-field');sourceField.htmlFor=`${base}-source`;sourceField.append(node('span','','Catalogue'));
  const sourceSelect=node('select','dmd-source-select');sourceSelect.id=`${base}-source`;sourceSelect.name='catalogue-source';for(const [value,text] of [['live','NHS dm+d catalogue'],['sample','Sample products']]){const option=node('option','',text);option.value=value;sourceSelect.append(option);}sourceSelect.value=rememberedSource;sourceField.append(sourceSelect);
  const scanPanel=node('section','manual-scan-panel');scanPanel.setAttribute('aria-label','Barcode scanner');
  const scanHeading=node('div','manual-scan-heading'),scanLabel=node('label','','Scan a pack');scanLabel.htmlFor=`${base}-barcode`;
  const scanFocus=node('button','btn btn-soft manual-scan-focus','Ready to scan');scanFocus.type='button';scanHeading.append(scanLabel,scanFocus);
  const scanControls=node('div','manual-scan-controls'),scanInput=node('input','manual-scan-input');scanInput.id=`${base}-barcode`;scanInput.type='text';scanInput.maxLength=1024;scanInput.autocomplete='off';scanInput.spellcheck=false;scanInput.placeholder='Scan or paste a 1D / 2D medicine barcode';scanInput.setAttribute('aria-describedby',`${base}-scan-help ${base}-scan-status`);
  const scanLookup=node('button','btn manual-scan-lookup','Find pack');scanLookup.type='button';scanControls.append(scanInput,scanLookup);
  const scanHelp=node('p','manual-scan-help','USB scanner in keyboard mode · Finish each scan with Enter or Tab. Scanning never sends an order.');scanHelp.id=`${base}-scan-help`;
  const scanStatus=node('p','manual-scan-status','Click Ready to scan, then scan the pack.');scanStatus.id=`${base}-scan-status`;scanStatus.setAttribute('role','status');scanStatus.setAttribute('aria-live','polite');
  const scanMatchesHost=node('div','manual-scan-matches');scanMatchesHost.hidden=true;scanPanel.append(scanHeading,scanControls,scanHelp,scanStatus,scanMatchesHost);
  const searchArea=node('div','dmd-search-area');
  const label=node('label','dmd-search-label','Find a medicine');label.htmlFor=`${base}-query`;
  const inputWrap=node('div','dmd-input-wrap');inputWrap.append(node('span','dmd-search-icon','⌕'));
  const input=node('input','dmd-query');input.id=`${base}-query`;input.type='search';input.maxLength=200;input.autocomplete='off';input.spellcheck=false;input.placeholder='Medicine name, strength or NHS code';input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','grid');input.setAttribute('aria-controls',`${base}-results`);input.setAttribute('aria-expanded','false');input.setAttribute('aria-describedby',`${base}-status`);inputWrap.append(input);
  const popover=node('div','dmd-popover');popover.hidden=true;
  const list=node('div','dmd-options');list.id=`${base}-results`;list.setAttribute('role','grid');list.setAttribute('aria-label','Matching medicines and basket actions');popover.append(list);
  const status=node('div','dmd-search-status','Type at least 2 characters.');status.id=`${base}-status`;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  searchArea.append(label,inputWrap,popover,status);
  const selection=node('div','dmd-selection');selection.hidden=true;
  const note=node('p','dmd-sandbox-note');
  const provenance=node('details','dmd-provenance-details');provenance.append(node('summary','','Catalogue details'),provenanceBadge,note);
  const meta=node('div','dmd-catalogue-meta');meta.append(sourceField,provenance);
  content.append(scanPanel,searchArea,selection,meta);root.append(content);host.replaceChildren(root);
  let alive=true,timer,searchSequence=0,packSequence=0,query='',matches=[],activeIndex=-1,selected=null,packs=[],selectedPack=null,isSearching=false,isLoadingPacks=false,isAdding=false,medicineModal=null,optionPointer=null,lastPointerInteraction=null,scanBusy=false,scanSequence=0,scanMatches=[],pendingScanMetadata=null;
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
  const closeMatches=()=>{popover.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');activeIndex=-1;};
  const updateActive=()=>{[...list.querySelectorAll('[data-dmd-index]')].forEach((option,index)=>{option.classList.toggle('is-active',index===activeIndex);option.closest('[role=row]')?.setAttribute('aria-selected',String(index===activeIndex));});if(activeIndex>=0){input.setAttribute('aria-activedescendant',`${base}-option-${activeIndex}`);list.querySelector(`#${base}-option-${activeIndex}`)?.scrollIntoView?.({block:'nearest'});}else input.removeAttribute('aria-activedescendant');};
  function showMatches(){
    list.replaceChildren();activeIndex=-1;input.removeAttribute('aria-activedescendant');
    if(!matches.length){closeMatches();return;}
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
    if(!alive||isAdding||medicineModal||scanBusy)return false;
    const prepared=prepareManualProductSelection(record,{quantity}),pack=prepared.record;
    if(!PACK_TYPES.has(pack.type))throw new Error('Choose a medicine pack before adding to the basket.');
    isAdding=true;const sequence=searchSequence,focused=doc.activeElement,controls=[input,sourceSelect,scanInput,scanLookup,scanFocus,...root.querySelectorAll('[data-dmd-add],[data-dmd-quantity]')],disabled=controls.map(control=>control.disabled);
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
  const setScanStatus=(text,error=false)=>{if(!alive)return;scanStatus.textContent=text;scanStatus.classList.toggle('is-error',error);};
  const clearScanChoices=()=>{scanMatches=[];pendingScanMetadata=null;scanMatchesHost.replaceChildren();scanMatchesHost.hidden=true;};
  const cancelScan=()=>{scanSequence++;scanBusy=false;scanInput.value='';scanInput.readOnly=false;scanLookup.disabled=scanFocus.disabled=false;clearScanChoices();};
  const safeScanMetadata=data=>({gtin:typeof data.gtin==='string'?data.gtin.slice(0,14):'',format:data.format==='gs1'?'gs1':'ean',batch:typeof data.batch==='string'?data.batch.slice(0,40):null,expiry:typeof data.expiry==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(data.expiry)?data.expiry:null,historical:data.historical===true,requiresPackConfirmation:data.requiresPackConfirmation===true,warnings:Array.isArray(data.warnings)?data.warnings.filter(value=>typeof value==='string').slice(0,8).map(value=>value.slice(0,300)):[]});
  function renderScanSummary(metadata){
    const summary=node('section','manual-scan-summary');summary.setAttribute('aria-label','Scanned pack details');summary.append(node('strong','','Scanned pack'));
    const details=node('dl','');for(const [name,value] of [['GTIN',metadata.gtin],['Batch',metadata.batch||'Not encoded in barcode'],['Expiry',metadata.expiry||'Not encoded in barcode']])if(value)details.append(node('dt','',name),node('dd','',value));summary.append(details);
    const dateParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),today=['year','month','day'].map(key=>dateParts.find(part=>part.type===key)?.value).join('-');
    if(metadata.expiry&&metadata.expiry<today){summary.classList.add('is-expired');summary.append(node('p','manual-scan-warning','The scanned pack has expired. Use this lookup to identify a replacement; do not treat the scan as a stock receipt.'));}
    if(metadata.historical)summary.append(node('p','manual-scan-warning','This is a historical NHS barcode association. Check the medicine and pack against the box before ordering.'));
    if(metadata.requiresPackConfirmation)summary.append(node('p','manual-scan-warning','Confirm the medicine, strength and pack against the box before ordering.'));
    for(const warning of metadata.warnings)summary.append(node('p','manual-scan-warning',warning));return summary;
  }
  async function lookupBarcode(){
    if(!alive||scanBusy||medicineModal||isAdding)return;
    const raw=scanInput.value;if(!raw.trim()){setScanStatus('Scan or paste a medicine barcode first.',true);scanInput.focus();return;}
    clearTimeout(timer);searchSequence++;matches=[];closeMatches();isSearching=false;input.removeAttribute('aria-busy');
    clearScanChoices();scanInput.value='';scanBusy=true;const sequence=++scanSequence;scanInput.readOnly=true;scanLookup.disabled=scanFocus.disabled=true;setScanStatus('Finding the exact NHS dm+d pack…');
    try{
      const result=await request('/api/dmd/barcode','POST',{barcode:raw});if(!alive||sequence!==scanSequence)return;
      if(!result?.ok)throw new Error(errorMessage(result,'Barcode lookup is unavailable. Try scanning again.'));
      const data=result.data||{},records=normaliseDmdRecords(data.matches).filter(record=>['AMPP','VMPP'].includes(record.type)),metadata=safeScanMetadata(data);
      if(!records.length){setScanStatus('No NHS dm+d pack matches this barcode. Check the barcode or search by medicine name below.',true);return;}
      if(records.length===1&&!metadata.requiresPackConfirmation){matches=records;setScanStatus('Pack identified. Review the medicine and supplier before ordering.');await chooseMatch(0,1,metadata);return;}
      scanMatches=records;pendingScanMetadata=metadata;scanMatchesHost.append(node('p','manual-scan-warning',records.length>1?'This barcode matches more than one NHS pack. Choose the pack printed on the box.':'Confirm the medicine, strength and pack against the box.'));
      records.forEach((record,index)=>{const choice=node('button','btn manual-scan-match');choice.type='button';choice.dataset.scanIndex=String(index);choice.append(node('strong','',record.name),node('small','',packLabel(record)));scanMatchesHost.append(choice);});scanMatchesHost.hidden=false;setScanStatus('Choose a pack to continue. No order has been sent.');
    }catch(error){if(alive&&sequence===scanSequence)setScanStatus(error?.message||'The barcode could not be read. Scan again or search by name.',true);}
    finally{if(alive&&sequence===scanSequence){scanBusy=false;scanInput.readOnly=false;scanInput.disabled=Boolean(medicineModal);scanLookup.disabled=scanFocus.disabled=Boolean(medicineModal);}}
  }
  const insertScanText=text=>{const start=Number.isInteger(scanInput.selectionStart)?scanInput.selectionStart:scanInput.value.length,end=Number.isInteger(scanInput.selectionEnd)?scanInput.selectionEnd:start;scanInput.value=(scanInput.value.slice(0,start)+text+scanInput.value.slice(end)).slice(0,1024);scanInput.setSelectionRange?.(start+text.length,start+text.length);};
  listen(scanFocus,'click',()=>{if(scanBusy||medicineModal)return;scanInput.focus();setScanStatus('Ready. Scan a pack, then press Enter or Tab if your scanner has no suffix.');});
  listen(scanLookup,'click',()=>void lookupBarcode());
  listen(scanInput,'input',()=>{if(!scanBusy)clearScanChoices();});
  listen(scanInput,'paste',event=>{const value=event.clipboardData?.getData('text');if(typeof value!=='string'||scanBusy)return;event.preventDefault();event.stopPropagation();insertScanText(value);clearScanChoices();});
  listen(scanInput,'keydown',event=>{if(event.key==='GroupSeparator'||event.ctrlKey&&event.key===']'){event.preventDefault();event.stopPropagation();if(!scanBusy)insertScanText('\u001d');return;}if(event.key==='Enter'||event.key==='Tab'&&(scanInput.value||scanBusy)){event.preventDefault();event.stopPropagation();void lookupBarcode();}});
  listen(scanMatchesHost,'click',event=>{const choice=event.target.closest('[data-scan-index]');if(!choice||scanBusy||medicineModal)return;const record=scanMatches[Number(choice.dataset.scanIndex)],metadata=pendingScanMetadata;if(!record||!metadata)return;matches=[record];clearScanChoices();void chooseMatch(0,1,metadata);});
  const money=value=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(value)||0);
  function closeMedicineModal({resetSearch=false,notify=true,force=false}={}) {
    if(!medicineModal||isAdding&&!force)return;
    const current=medicineModal;medicineModal=null;packSequence++;clearTimeout(current.quoteTimer);current.quoteSequence=(current.quoteSequence||0)+1;current.layer.remove();
    doc.body.style.overflow=current.previousOverflow;if(current.background)current.background.inert=current.previousInert;
    input.disabled=false;sourceSelect.disabled=false;scanInput.disabled=false;scanLookup.disabled=scanFocus.disabled=false;selected=null;selectedPack=null;packs=[];selection.hidden=true;
    if(resetSearch){input.value='';query='';matches=[];searchSequence++;closeMatches();}
    if(notify&&alive)onClose();
    if(current.scanMetadata)doc.querySelector('.manual-scan-input')?.focus();else if(alive&&input.isConnected!==false)input.focus();
  }
  function openMedicineModal(initialQuantity=1,scanMetadata=null) {
    closeMedicineModal({notify:false,force:true});
    const layer=node('div','manual-order-backdrop');layer.dataset.manualOrderModal='';
    const dialog=node('section','manual-order-dialog');dialog.tabIndex=-1;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby',`${base}-modal-title`);
    const header=node('div','manual-order-header'),title=node('h2','', 'Manual order');title.id=`${base}-modal-title`;
    const closeButton=node('button','manual-order-close','×');closeButton.type='button';closeButton.setAttribute('aria-label','Close manual order');header.append(title,closeButton);
    const body=node('div','manual-order-content');dialog.append(header,body);layer.append(dialog);
    const background=doc.getElementById('app'),previousOverflow=doc.body.style.overflow,previousInert=background?.inert;
    doc.body.style.overflow='hidden';if(background)background.inert=true;doc.body.append(layer);
    medicineModal={layer,dialog,body,closeButton,previousOverflow,background,previousInert,initialQuantity,scanMetadata,selectedSupplier:preferredSupplier,quoteSequence:0,quoteChain:Promise.resolve(),attempt:createManualOrderAttempt()};
    input.disabled=true;sourceSelect.disabled=true;scanInput.disabled=true;scanLookup.disabled=scanFocus.disabled=true;
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
  function deliveryCard(delivery,acceptedQuantity){
    const card=node('div','manual-order-delivery');
    if(!acceptedQuantity){card.append(node('strong','','No delivery expected'),node('p','','No packs were accepted. Unavailable packs are not backordered.'));return card;}
    const arrival=arrivalLabel(delivery?.estimatedArrivalAt);card.append(node('strong','',delivery?.serviceLabel||'Delivery estimate unavailable'));
    card.append(node('p','',arrival?'Estimated arrival · '+arrival:'No arrival estimate is available for this supplier.'));
    if(delivery?.orderBy&&arrivalLabel(delivery.orderBy))card.append(node('p','manual-order-cutoff','Order by '+arrivalLabel(delivery.orderBy)));
    card.append(node('small','',delivery?.note||'Schedule estimate only. Delivery has not been confirmed by a supplier.'));return card;
  }
  function renderModalResult(kind,result,count,pack) {
    const current=medicineModal;if(!current)return;clearTimeout(current.quoteTimer);current.quoteSequence++;const body=current.body;body.replaceChildren();
    const order=result?.order,fulfilment=order?.fulfilment,accepted=fulfilment?.acceptedQuantity??order?.items?.[0]?.acceptedQuantity??count,requested=fulfilment?.requestedQuantity??count,outstanding=fulfilment?.outstandingQuantity??Math.max(0,requested-accepted);
    const outcome=kind==='sent'?(fulfilment?.status||(order?.status==='Not accepted'?'unavailable':'accepted')):'added';
    const title=outcome==='unavailable'?'Test order not accepted':outcome==='partial'?'Part of your test order accepted':kind==='sent'?'Test order accepted':'Added to basket';
    const state=node('div',`manual-order-result ${outcome==='partial'?'is-partial':outcome==='unavailable'?'is-unavailable':kind==='sent'?'is-sent':'is-added'}`);state.setAttribute('role','status');state.setAttribute('aria-live','polite');
    state.append(node('span','manual-order-result-icon',outcome==='unavailable'?'—':outcome==='partial'?'!':'✓'),node('h3','',title),node('p','manual-order-result-name',pack.name));
    if(kind==='sent'){
      const details=node('dl','manual-order-result-details');
      const values=[['Order reference',order.id],['Coming from',fulfilment?.sourceLabel||order.supplier],['Supplier reference',fulfilment?.supplierReference||'Not provided'],['Pack',packLabel(pack)],['Requested',`${requested} packs`],['Accepted',`${accepted} packs`],['Unavailable',`${outstanding} packs`],['Order total',money(order.total)]];
      for(const [label,value] of values)details.append(node('dt','',label),node('dd','',String(value??'—')));
      state.append(details,deliveryCard(fulfilment?.delivery,accepted));
      if(outstanding)state.append(node('p','manual-order-shortage',`${outstanding} ${outstanding===1?'pack was':'packs were'} not accepted. These packs are not backordered. Review the remaining quantity before placing another order.`));
      state.append(node('p','manual-order-result-note','Simulated supplier response · No real supplier was contacted. Only accepted packs can be received in Goods In.'));
    }else state.append(node('p','',`${count} ${count===1?'pack is':'packs are'} ready in your basket. You can review and send the basket later.`));
    const actions=node('div','manual-order-result-actions'),another=node('button','btn','Continue searching'),done=node('button','btn btn-primary','Done');another.type=done.type='button';
    if(kind==='sent'&&outstanding){const remaining=node('button','btn btn-soft manual-order-remaining','Try remaining packs');remaining.type='button';actions.append(remaining);listen(remaining,'click',()=>{current.initialQuantity=outstanding;current.selectedSupplier=order.supplier;current.attempt=createManualOrderAttempt();renderSelection();current.body.querySelector('select[name="supplier"]')?.focus();});}
    actions.append(another,done);state.append(actions);body.append(state);
    listen(another,'click',()=>closeMedicineModal({resetSearch:true}));listen(done,'click',()=>closeMedicineModal());current.closeButton.disabled=false;done.focus();
  }
  function renderSelection(){
    selection.replaceChildren();selection.hidden=true;if(!selected)return;
    const current=medicineModal;if(!current)return;const body=current.body;body.replaceChildren();
    const summary=node('div','manual-order-product');summary.append(node('span','manual-order-product-label','Selected medicine'),node('strong','',selected.name));body.append(summary);if(current.scanMetadata)body.append(renderScanSummary(current.scanMetadata));
    if(isLoadingPacks){const loading=node('p','manual-order-loading','Loading available pack sizes…');loading.setAttribute('role','status');body.append(loading);return;}
    if(!packs.length){body.append(node('p','manual-order-error','No orderable packs were returned for this medicine. Try another match.'));return;}
    const form=node('form','manual-order-form');form.noValidate=true;
    const packField=node('label','field manual-order-pack');packField.htmlFor=`${base}-pack`;packField.append(node('span','','Pack size'));
    const packSelect=node('select','');packSelect.id=`${base}-pack`;packSelect.name='pack';
    packs.forEach((pack,index)=>{const option=node('option','',pack.pack?`${packLabel(pack)} · ${pack.name}`:pack.name);option.value=String(index);option.selected=selectedPack?.id===pack.id&&selectedPack?.type===pack.type;packSelect.append(option);});packField.append(packSelect);
    const row=node('div','manual-order-fields'),quantityField=node('label','field manual-order-quantity');quantityField.htmlFor=`${base}-quantity`;quantityField.append(node('span','','Number of packs'));
    const quantity=node('input','');quantity.id=`${base}-quantity`;quantity.name='quantity';quantity.type='number';quantity.min='1';quantity.max='999';quantity.step='1';quantity.required=true;quantity.value=String(current.initialQuantity);quantity.setAttribute('inputmode','numeric');quantityField.append(quantity);
    const supplierField=node('label','field manual-order-supplier');supplierField.htmlFor=`${base}-supplier`;supplierField.append(node('span','','Send to wholesaler'));
    const supplier=node('select','');supplier.id=`${base}-supplier`;supplier.name='supplier';for(const name of ['AAH','Phoenix','Alliance','BNS','Sigma','Trident','Warehouse']){const option=node('option','',name);option.value=name;option.selected=name===current.selectedSupplier;supplier.append(option);}supplierField.append(supplier);row.append(quantityField,supplierField);
    const simulation=node('details','manual-order-simulation');simulation.append(node('summary','','Test response'));const scenarioField=node('label','field');scenarioField.append(node('span','','Simulate supplier response'));const scenario=node('select','');scenario.name='scenario';for(const [value,text] of [['full','All packs accepted'],['partial','Some packs unavailable'],['unavailable','No packs available']]){const option=node('option','',text);option.value=value;scenario.append(option);}scenario.value='full';scenarioField.append(scenario);simulation.append(scenarioField,node('small','','For testing only. No supplier is contacted.'));
    const quotePanel=node('section','manual-order-quote');quotePanel.setAttribute('aria-label','Supplier quote');quotePanel.setAttribute('aria-live','polite');
    const comparisonPanel=node('section','manual-order-comparison');comparisonPanel.setAttribute('aria-label','Wholesaler price comparison');comparisonPanel.setAttribute('aria-live','polite');comparisonPanel.hidden=typeof onCompare!=='function';
    const notesField=node('label','field');notesField.htmlFor=`${base}-notes`;notesField.append(node('span','','Order note (optional)'));const notes=node('textarea','');notes.id=`${base}-notes`;notes.name='notes';notes.maxLength=500;notes.rows=2;notes.placeholder='Add a note for this test order';notesField.append(notes);
    const notesDetails=node('details','manual-order-notes');notesDetails.append(node('summary','','Add an order note'),notesField);
    const reference=node('p','manual-order-reference',packReference(selectedPack));
    const referenceDetails=node('details','manual-order-provenance');referenceDetails.append(node('summary','','Medicine details'),reference);
    const message=node('p','manual-order-status');message.setAttribute('role','status');message.setAttribute('aria-live','polite');message.tabIndex=-1;
    const actions=node('div','manual-order-actions'),add=node('button','btn manual-order-add','Add to basket'),send=node('button','btn btn-primary manual-order-send','Send now');add.type='button';send.type='submit';send.disabled=typeof onSend!=='function';actions.append(add,send);
    form.append(packField,row,quotePanel,comparisonPanel,notesDetails,simulation,referenceDetails,node('p','manual-order-info','Send now orders only this item. Your basket stays unchanged.'),message,actions);body.append(form);
    if(typeof onSend!=='function')message.textContent='Direct sending is unavailable. You can still add this item to the basket.';
    const controls=[packSelect,quantity,supplier,scenario,notes,add,send,current.closeButton];
    let quoteValue=null,quoteLoading=false,comparisonValue=null,comparisonKey=null;
    const updateActions=()=>{send.disabled=typeof onSend!=='function'||isAdding||(typeof onQuote==='function'&&(quoteLoading||!quoteValue));add.disabled=isAdding||quoteLoading;};
    const quotePayload=()=>({id:selectedPack.id,type:selectedPack.type,query:selectedPack.name.slice(0,200),quantity:Number(quantity.value),supplier:supplier.value,scenario:scenario.value});
    const renderQuote=quote=>{quotePanel.replaceChildren();const header=node('div','manual-order-quote-heading'),heading=node('h3','','Supplier estimate'),statusLabel=quote.status==='partial'?'Part available':quote.status==='unavailable'?'Unavailable':'Available';header.append(heading,node('span',`manual-order-quote-status is-${quote.status}`,statusLabel));const details=node('dl','manual-order-quote-details');for(const [label,value] of [['Coming from',quote.sourceLabel||quote.supplier],['Available',`${quote.acceptedQuantity} of ${quote.requestedQuantity} packs`],['Unavailable',`${quote.outstandingQuantity} packs`],['Test unit cost',money(quote.unitPrice)],['Accepted total',money(quote.estimatedTotal)]])details.append(node('dt','',label),node('dd','',String(value)));quotePanel.append(header,details,deliveryCard(quote.delivery,quote.acceptedQuantity),node('small','manual-order-compare-hint','Change wholesaler to compare its delivery estimate. Prices and availability are simulated.'));};
    const useSupplier=name=>{if(isAdding||medicineModal!==current||!form.isConnected||![...supplier.querySelectorAll('option')].some(option=>option.value===name))return;supplier.value=name;current.selectedSupplier=name;edit();loadQuote();};
    const renderComparison=result=>{
      if(!result||!Array.isArray(result.quotes)||!result.quotes.length)throw new Error('The comparison response was incomplete. Please retry.');
      const quotes=result.quotes.filter(quote=>quote&&typeof quote.supplier==='string'&&Number.isFinite(quote.unitPrice)&&Number.isFinite(quote.estimatedTotal)&&Number.isInteger(quote.acceptedQuantity)&&Number.isInteger(quote.requestedQuantity));
      if(quotes.length!==result.quotes.length)throw new Error('The comparison response was incomplete. Please retry.');
      const cheapest=Array.isArray(result.cheapestSuppliers)?result.cheapestSuppliers.filter(name=>quotes.some(quote=>quote.supplier===name&&quote.acceptedQuantity===quote.requestedQuantity)):[],recommended=cheapest.includes(result.recommendedSupplier)?result.recommendedSupplier:null,lowest=quotes.find(quote=>cheapest.includes(quote.supplier));
      comparisonPanel.replaceChildren();const heading=node('div','manual-comparison-heading');heading.append(node('h3','','Compare wholesalers'));
      heading.append(node('p','manual-comparison-note',lowest?cheapest.length>1?`Joint cheapest test total: ${money(lowest.estimatedTotal)} across ${cheapest.length} wholesalers.`:`Lowest test total: ${money(lowest.estimatedTotal)} from ${lowest.supplier}.`:'No wholesaler can supply all requested packs in this test response.'));comparisonPanel.append(heading);
      if(recommended){const suggestion=node('div','manual-comparison-recommendation');suggestion.append(node('p','',`Recommended: ${recommended}. Arrival estimates break ties between equal test prices.`));const use=node('button','btn btn-soft manual-comparison-use',recommended===supplier.value?'Recommended supplier selected':'Use recommended supplier');use.type='button';use.disabled=recommended===supplier.value;suggestion.append(use);listen(use,'click',()=>useSupplier(recommended));comparisonPanel.append(suggestion);}
      const options=node('details','manual-comparison-options');options.append(node('summary','',`Compare ${quotes.length} wholesaler estimates`));const list=node('div','manual-comparison-list');list.setAttribute('role','list');
      for(const quote of quotes){const isCheapest=cheapest.includes(quote.supplier),isRecommended=quote.supplier===recommended,row=node('article',`manual-comparison-row${isCheapest?' is-cheapest':''}${isRecommended?' is-recommended':''}`);row.setAttribute('role','listitem');
        const source=node('div','manual-comparison-supplier');source.append(node('strong','',quote.supplier),node('small','',`${quote.acceptedQuantity} of ${quote.requestedQuantity} packs available`));if(isCheapest)source.append(node('span','manual-comparison-badge',cheapest.length>1?'Joint cheapest test price':'Cheapest test price'));
        const price=node('div','manual-comparison-price');price.append(node('strong','',money(quote.estimatedTotal)),node('small','',`${money(quote.unitPrice)} per pack · accepted total`));
        const arrival=node('div','manual-comparison-arrival');arrival.append(node('strong','',quote.acceptedQuantity?arrivalLabel(quote.delivery?.estimatedArrivalAt)||'No arrival estimate':'No delivery expected'),node('small','',quote.acceptedQuantity?quote.delivery?.serviceLabel||'Schedule estimate':'Unavailable packs are not backordered'));
        const select=node('button','btn manual-comparison-use',quote.supplier===supplier.value?'Selected':'Select');select.type='button';select.disabled=quote.supplier===supplier.value;select.setAttribute('aria-label',`Choose ${quote.supplier} as wholesaler`);listen(select,'click',()=>useSupplier(quote.supplier));row.append(source,price,arrival,select);list.append(row);
      }
      options.append(list);comparisonPanel.append(options,node('p','manual-comparison-note',result.message||'Test prices and availability only. NHS dm+d reference prices are not supplier quotations. No supplier has been contacted.'));
    };
    const comparisonError=error=>{comparisonPanel.replaceChildren(node('p','manual-comparison-note',error?.message||'Could not compare wholesaler prices.'));const retry=node('button','btn btn-soft manual-comparison-retry','Retry price comparison');retry.type='button';listen(retry,'click',()=>{comparisonKey=null;comparisonValue=null;loadQuote();});comparisonPanel.append(retry);};
    const loadQuote=()=>{
      if(typeof onQuote!=='function'){quotePanel.hidden=true;return;}
      clearTimeout(current.quoteTimer);const sequence=++current.quoteSequence;quoteValue=null;quoteLoading=true;quotePanel.replaceChildren(node('p','manual-order-quote-loading','Checking packs, price and delivery…'));updateActions();const payload=quotePayload(),nextComparisonKey=JSON.stringify([payload.type,payload.id,payload.quantity,payload.scenario]);
      if(typeof onCompare==='function'){if(comparisonKey===nextComparisonKey&&comparisonValue)renderComparison(comparisonValue);else comparisonPanel.replaceChildren(node('p','manual-comparison-note','Comparing wholesaler test prices…'));}
      if(!Number.isInteger(payload.quantity)||payload.quantity<1||payload.quantity>999){quoteLoading=false;quotePanel.replaceChildren(node('p','manual-order-quote-error','Enter a whole number of packs between 1 and 999 to check delivery.'));comparisonValue=null;comparisonKey=null;comparisonPanel.replaceChildren();updateActions();return;}
      current.quoteTimer=setTimeout(()=>{current.quoteChain=current.quoteChain.catch(()=>{}).then(async()=>{
        if(!alive||medicineModal!==current||sequence!==current.quoteSequence||!form.isConnected)return;
        try{
          const quote=await onQuote(payload);if(!alive||medicineModal!==current||sequence!==current.quoteSequence||!form.isConnected)return;
          if(!quote||!['accepted','partial','unavailable'].includes(quote.status)||!Number.isInteger(quote.acceptedQuantity)||!Number.isInteger(quote.requestedQuantity))throw new Error('The quote response was incomplete. Please retry.');quoteValue=quote;renderQuote(quote);
          if(typeof onCompare==='function'){
            try{if(comparisonKey!==nextComparisonKey||!comparisonValue){const compared=await onCompare(payload);if(!alive||medicineModal!==current||sequence!==current.quoteSequence||!form.isConnected)return;renderComparison(compared);comparisonValue=compared;comparisonKey=nextComparisonKey;}else renderComparison(comparisonValue);}
            catch(error){if(alive&&medicineModal===current&&sequence===current.quoteSequence&&form.isConnected){comparisonValue=null;comparisonKey=null;comparisonError(error);}}
          }
        }catch(error){
          if(!alive||medicineModal!==current||sequence!==current.quoteSequence||!form.isConnected)return;quotePanel.replaceChildren(node('p','manual-order-quote-error',error?.message||'Could not check this supplier.'));const retry=node('button','btn btn-soft manual-order-quote-retry','Retry supplier check');retry.type='button';quotePanel.append(retry);listen(retry,'click',loadQuote);
        }finally{if(alive&&medicineModal===current&&sequence===current.quoteSequence&&form.isConnected){quoteLoading=false;updateActions();}}
      });},180);
    };
    const edit=()=>{current.attempt.invalidate();message.textContent='';message.classList.remove('is-error');};
    listen(packSelect,'change',()=>{selectedPack=packs[Number(packSelect.value)]||null;reference.textContent=packReference(selectedPack);edit();loadQuote();});
    listen(notes,'input',edit);listen(quantity,'input',()=>{edit();loadQuote();});
    listen(supplier,'change',()=>{current.selectedSupplier=supplier.value;edit();loadQuote();});listen(scenario,'change',()=>{edit();loadQuote();});
    const submit=async kind=>{
      if(isAdding||!selectedPack||medicineModal!==current)return;
      let payload;try{payload=current.attempt.prepare(selectedPack,{quantity:quantity.value,supplier:supplier.value,notes:notes.value,scenario:scenario.value});}catch(error){message.textContent=error.message;message.classList.add('is-error');quantity.focus();return;}
      if(kind==='sent'&&typeof onSend!=='function')return;
      if(quoteLoading||kind==='sent'&&typeof onQuote==='function'&&!quoteValue){message.textContent='Check the supplier estimate before sending. You can retry the supplier check above.';return;}
      const pack=selectedPack;isAdding=true;controls.forEach(control=>control.disabled=true);message.classList.remove('is-error');message.textContent=kind==='sent'?'Sending test order…':'Adding to basket…';message.focus();send.textContent=kind==='sent'?'Sending…':'Send now';add.textContent=kind==='added'?'Adding…':'Add to basket';
      try{
        const result=await (kind==='sent'?onSend(payload):onAdd(payload));
        if(kind==='sent'&&(!result?.order?.id||typeof result.order.id!=='string'))throw new Error('The order response was incomplete. Try again to check the same request.');
        current.attempt.complete();if(alive&&medicineModal===current){renderModalResult(kind,result,payload.quantity,pack);setStatus(kind==='sent'?`Test order ${result.order.id}: ${result.order.fulfilment?.status||'accepted'}.`:`${payload.quantity} packs added to the test basket.`);}
      }catch(error){if(alive&&medicineModal===current){message.textContent=error?.message||'The request could not be completed. Try again.';message.classList.add('is-error');onError(error);}}
      finally{isAdding=false;if(alive&&medicineModal===current&&form.isConnected){controls.forEach(control=>control.disabled=false);updateActions();send.textContent='Send now';add.textContent='Add to basket';if(message.classList.contains('is-error'))send.focus();}}
    };
    listen(add,'click',event=>{event.preventDefault();void submit('added');});
    listen(form,'submit',event=>{event.preventDefault();event.stopPropagation();void submit('sent');});
    loadQuote();
  }
  async function chooseMatch(index,initialQuantity=1,scanMetadata=null){
    const match=matches[index];if(!match||isAdding)return;if(!scanMetadata&&scanBusy)cancelScan();
    selected=match;selectedPack=null;packs=[];input.value=match.name;query=match.name;searchSequence++;clearTimeout(timer);closeMatches();openMedicineModal(initialQuantity,scanMetadata);selected=match;
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
    cancelScan();rememberedSource=sourceSelect.value;selected=null;packs=[];selectedPack=null;query='';matches=[];searchSequence++;packSequence++;clearTimeout(timer);isSearching=false;isLoadingPacks=false;input.value='';input.removeAttribute('aria-busy');closeMatches();renderSelection();updateSourceLabels();setStatus('Type at least 2 characters.');input.focus();
  });
  updateSourceLabels();
  listen(input,'input',()=>{
    cancelScan();query=input.value.trim();selected=null;packs=[];selectedPack=null;isLoadingPacks=false;packSequence++;renderSelection();clearTimeout(timer);matches=[];closeMatches();
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
  // Touch/pen taps must activate on pointerup: cancelling touch pointerdown can
  // suppress iOS's compatibility click. Keep the option visible while focus moves.
  listen(list,'pointerdown',event=>{
    const option=event.target.closest('[data-dmd-index]');if(!option)return;
    if(!event.pointerType||event.pointerType==='mouse'){optionPointer=null;lastPointerInteraction=null;event.preventDefault();return;}
    optionPointer={id:event.pointerId??0,option,index:Number(option.dataset.dmdIndex),sequence:searchSequence,x:event.clientX??0,y:event.clientY??0,moved:false};
  });
  listen(doc,'pointermove',event=>{if(!optionPointer||(event.pointerId??0)!==optionPointer.id)return;if(Math.hypot((event.clientX??0)-optionPointer.x,(event.clientY??0)-optionPointer.y)>10)optionPointer.moved=true;});
  listen(doc,'pointerup',event=>{
    if(!optionPointer||(event.pointerId??0)!==optionPointer.id)return;
    const gesture=optionPointer;optionPointer=null;
    const moved=gesture.moved||Math.hypot((event.clientX??0)-gesture.x,(event.clientY??0)-gesture.y)>10;
    const inside=gesture.option===event.target||gesture.option.contains(event.target);
    lastPointerInteraction={option:gesture.option,until:Date.now()+700};
    if(!alive||moved||!inside||!root.contains(gesture.option)||gesture.sequence!==searchSequence||medicineModal||isAdding)return;
    event.preventDefault();event.stopPropagation();chooseResult(gesture.index);
  });
  listen(doc,'pointercancel',event=>{if(optionPointer&&(event.pointerId??0)===optionPointer.id){lastPointerInteraction={option:optionPointer.option,until:Date.now()+700};optionPointer=null;}});
  listen(root,'click',event=>{
    const quickAdd=event.target.closest('[data-dmd-add]');if(quickAdd&&root.contains(quickAdd)){event.preventDefault();event.stopPropagation();const index=Number(quickAdd.dataset.dmdAdd),quantity=list.querySelector(`[data-dmd-quantity="${index}"]`);void addProduct(matches[index],{quantity:quantity?.value||''}).catch(error=>{if(alive){setStatus(error?.message||'Could not add this pack.',true);quantity?.focus();}});return;}
    const option=event.target.closest('[data-dmd-index]');if(option&&root.contains(option)){event.preventDefault();event.stopPropagation();if(medicineModal||isAdding||(lastPointerInteraction?.option===option&&lastPointerInteraction.until>Date.now()))return;chooseResult(Number(option.dataset.dmdIndex));return;}
    if(event.target.closest('[data-dmd-clear]')){event.preventDefault();event.stopPropagation();selected=null;packs=[];selectedPack=null;query='';matches=[];searchSequence++;packSequence++;clearTimeout(timer);isLoadingPacks=false;input.value='';renderSelection();setStatus('Type at least 2 characters.');input.focus();}
  });
  listen(doc,'pointerdown',event=>{if(!root.contains(event.target)){optionPointer=null;closeMatches();}});
  listen(root,'focusout',()=>{queueMicrotask(()=>{if(alive&&!medicineModal&&!isAdding&&!optionPointer&&!root.contains(doc.activeElement))closeMatches();});});
  const cleanup=()=>{if(!alive)return;alive=false;optionPointer=null;lastPointerInteraction=null;scanSequence++;scanInput.value='';clearScanChoices();searchSequence++;packSequence++;clearTimeout(timer);closeMedicineModal({notify:false,force:true});abort.abort();root.remove();};
  cleanup.openProduct=(record,options={})=>{
    if(!alive||isAdding)return false;
    const prepared=prepareManualProductSelection(record,options);matches=[prepared.record];
    void chooseMatch(0,prepared.quantity);return true;
  };
  cleanup.addProduct=addProduct;
  return cleanup;
}
