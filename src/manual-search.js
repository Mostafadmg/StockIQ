/** Accessible Mellons medicine and pack picker. All requests stay on the draft origin. */
let pickerCount=0;
// Remember only an explicit source choice during this page session; the initial choice is live.
let rememberedSource='live';
const MEDICINE_TYPES=new Set(['AMP','VMP','TARIFF_MEDICINE']);
const PACK_TYPES=new Set(['AMPP','VMPP','TARIFF','TARIFF_PACK','SAMPLE']);
const KNOWN_TYPES=new Set([...MEDICINE_TYPES,...PACK_TYPES]);

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
    return [{id,type,name,pack:typeof record.pack==='string'||typeof record.pack==='number'?String(record.pack).slice(0,200):'',unit:typeof record.unit==='string'?record.unit.slice(0,100):'',manufacturer:typeof record.manufacturer==='string'?record.manufacturer.slice(0,180):'',referencePrice:typeof record.referencePrice==='number'&&Number.isFinite(record.referencePrice)&&record.referencePrice>=0?record.referencePrice:null}];
  }).slice(0,60);
}

/**
 * request(path) returns {ok,status,data}; data.matches/data.packs contain catalogue records.
 * onAdd({id,type,quantity,query}) verifies/imports the selected pack into the sandbox basket.
 */
export function mountManualSearch({host,request,onAdd,onError=()=>{}}={}) {
  if(!host||typeof request!=='function'||typeof onAdd!=='function')throw new TypeError('A host, request and onAdd callback are required.');
  const doc=host.ownerDocument,instance=++pickerCount,base=`dmd-picker-${instance}`;
  const abort=new AbortController();
  const listen=(target,type,callback,options={})=>target.addEventListener(type,callback,{...options,signal:abort.signal});
  const node=(tag,className,text)=>{const el=doc.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  const root=node('section','manual-dmd panel');
  const top=node('div','dmd-heading');
  const heading=node('div',''),headingTitle=node('h2','','Mellons medicine catalogue'),headingDescription=node('p','','Find a medicine, choose its pack, then add it to your test basket.');heading.append(headingTitle,headingDescription);
  const provenanceBadge=node('span','badge purple','NHS Drug Tariff reference data');top.append(heading,provenanceBadge);
  const content=node('div','dmd-content');
  const sourceField=node('label','dmd-source-field');sourceField.htmlFor=`${base}-source`;sourceField.append(node('span','','Lookup source'));
  const sourceSelect=node('select','dmd-source-select');sourceSelect.id=`${base}-source`;sourceSelect.name='catalogue-source';for(const [value,text] of [['live','Mellons live catalogue'],['sample','Sample products']]){const option=node('option','',text);option.value=value;sourceSelect.append(option);}sourceSelect.value=rememberedSource;sourceField.append(sourceSelect);
  const searchArea=node('div','dmd-search-area');
  const label=node('label','dmd-search-label','Medicine name');label.htmlFor=`${base}-query`;
  const inputWrap=node('div','dmd-input-wrap');inputWrap.append(node('span','dmd-search-icon','⌕'));
  const input=node('input','dmd-query');input.id=`${base}-query`;input.type='search';input.maxLength=200;input.autocomplete='off';input.spellcheck=false;input.placeholder='Start typing a medicine, e.g. amoxicillin 500mg';input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','listbox');input.setAttribute('aria-controls',`${base}-results`);input.setAttribute('aria-expanded','false');input.setAttribute('aria-describedby',`${base}-status`);inputWrap.append(input);
  const popover=node('div','dmd-popover');popover.hidden=true;
  const list=node('div','dmd-options');list.id=`${base}-results`;list.setAttribute('role','listbox');list.setAttribute('aria-label','Matching medicines');popover.append(list);
  const status=node('div','dmd-search-status','Type at least 2 characters to search the medicine catalogue.');status.id=`${base}-status`;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  searchArea.append(label,inputWrap,popover,status);
  const selection=node('div','dmd-selection');selection.hidden=true;
  const note=node('p','dmd-sandbox-note','Medicine and pack matches come from the Mellons catalogue. Tariff reference prices are separate from simulated supplier prices, orders and shelf stock.');
  content.append(sourceField,searchArea,selection,note);root.append(top,content);host.replaceChildren(root);
  let alive=true,timer,searchSequence=0,packSequence=0,query='',matches=[],activeIndex=-1,selected=null,packs=[],selectedPack=null,isSearching=false,isLoadingPacks=false,isAdding=false;
  const errorMessage=(result,fallback)=>typeof result?.error==='string'?result.error:typeof result?.error?.message==='string'?result.error.message:fallback;
  const packReference=pack=>pack.type==='SAMPLE'?'Sample product · Simulated stock and supplier price':pack.type.startsWith('TARIFF')?`NHS Drug Tariff pack${pack.referencePrice!==null?` · Tariff reference: ${new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(pack.referencePrice)}`:''}`:`${pack.type} · ${pack.id}`;
  const setStatus=(text,error=false)=>{if(!alive)return;status.textContent=text;status.classList.toggle('is-error',error);};
  const closeMatches=()=>{popover.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');activeIndex=-1;};
  const updateActive=()=>{[...list.querySelectorAll('[role=option]')].forEach((option,index)=>{option.classList.toggle('is-active',index===activeIndex);option.setAttribute('aria-selected',String(index===activeIndex));});if(activeIndex>=0){input.setAttribute('aria-activedescendant',`${base}-option-${activeIndex}`);list.querySelector(`#${base}-option-${activeIndex}`)?.scrollIntoView?.({block:'nearest'});}else input.removeAttribute('aria-activedescendant');};
  function showMatches(){
    list.replaceChildren();activeIndex=-1;input.removeAttribute('aria-activedescendant');
    if(!matches.length){closeMatches();return;}
    matches.forEach((match,index)=>{
      const option=node('button','dmd-option');option.type='button';option.id=`${base}-option-${index}`;option.dataset.dmdIndex=String(index);option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.tabIndex=-1;
      const description=node('span','dmd-option-description');description.append(node('strong','',match.name));
      const meta=[match.pack,match.manufacturer].filter(Boolean).join(' · ');if(meta)description.append(node('small','',meta));
      option.append(description,node('span','dmd-type',match.type==='SAMPLE'?'Sample product':match.type.startsWith('TARIFF')?'Tariff pack':match.type));list.append(option);
    });
    popover.hidden=false;input.setAttribute('aria-expanded','true');
  }
  function renderSelection(){
    selection.replaceChildren();selection.hidden=!selected;if(!selected)return;
    const summary=node('div','dmd-selected-summary');
    const text=node('div','');text.append(node('span','dmd-selected-label','Selected medicine'),node('strong','',selected.name));
    const clear=node('button','dmd-clear','Change medicine');clear.type='button';clear.dataset.dmdClear='';clear.disabled=isAdding;
    summary.append(text,clear);selection.append(summary);
    if(isLoadingPacks){selection.append(node('p','dmd-pack-status','Loading available pack sizes…'));return;}
    if(!packs.length){selection.append(node('p','dmd-pack-status','No orderable packs were returned for this medicine. Try another match.'));return;}
    const form=node('form','dmd-pack-form');
    const packField=node('label','field dmd-pack-field');packField.htmlFor=`${base}-pack`;packField.append(node('span','','Pack size'));
    const packSelect=node('select','');packSelect.id=`${base}-pack`;packSelect.name='pack';packSelect.disabled=isAdding;
    packs.forEach((pack,index)=>{const option=node('option','',pack.pack?`${pack.pack}${pack.unit?` ${pack.unit}`:''} · ${pack.name}`:pack.name);option.value=String(index);option.selected=selectedPack?.id===pack.id&&selectedPack?.type===pack.type;packSelect.append(option);});
    packField.append(packSelect);
    const quantityField=node('label','field dmd-quantity-field');quantityField.htmlFor=`${base}-quantity`;quantityField.append(node('span','','Packs'));
    const quantity=node('input','');quantity.id=`${base}-quantity`;quantity.name='quantity';quantity.type='number';quantity.min='1';quantity.max='999';quantity.step='1';quantity.required=true;quantity.value='1';quantity.disabled=isAdding;quantity.setAttribute('inputmode','numeric');quantityField.append(quantity);
    const add=node('button','btn btn-primary dmd-add-button',isAdding?'Adding…':'Add to test basket');add.type='submit';add.disabled=isAdding;
    form.append(packField,quantityField,add);selection.append(form);
    if(selectedPack)selection.append(node('p','dmd-pack-reference',packReference(selectedPack)));
    listen(packSelect,'change',()=>{selectedPack=packs[Number(packSelect.value)]||null;const reference=selection.querySelector('.dmd-pack-reference');if(reference&&selectedPack)reference.textContent=packReference(selectedPack);});
    listen(form,'submit',async event=>{
      event.preventDefault();event.stopPropagation();if(isAdding||!selectedPack)return;
      const count=Number(quantity.value);if(!Number.isInteger(count)||count<1||count>999){setStatus('Enter a whole number of packs between 1 and 999.',true);quantity.focus();return;}
      isAdding=true;add.disabled=true;add.textContent='Adding…';packSelect.disabled=true;quantity.disabled=true;clear.disabled=true;input.disabled=true;sourceSelect.disabled=true;
      try{await onAdd({id:selectedPack.id,type:selectedPack.type,quantity:count,query:selectedPack.name.slice(0,200)});if(alive)setStatus(`${count} ${count===1?'pack':'packs'} added to the test basket.`);}
      catch(error){if(alive){setStatus(error?.message||'Could not add this pack to the test basket.',true);onError(error);}}
      finally{isAdding=false;if(alive){add.disabled=false;add.textContent='Add to test basket';packSelect.disabled=false;quantity.disabled=false;clear.disabled=false;input.disabled=false;sourceSelect.disabled=false;}}
    });
  }
  async function chooseMatch(index){
    const match=matches[index];if(!match||isAdding)return;
    selected=match;selectedPack=null;packs=[];input.value=match.name;query=match.name;searchSequence++;clearTimeout(timer);closeMatches();
    const sequence=++packSequence;
    if(PACK_TYPES.has(match.type)){packs=[match];selectedPack=match;isLoadingPacks=false;renderSelection();setStatus('Choose a quantity of packs, then add to the test basket.');return;}
    isLoadingPacks=true;renderSelection();setStatus('Loading available pack sizes…');
    try{
      const result=await request(`/api/dmd/packs?id=${encodeURIComponent(match.id)}&type=${encodeURIComponent(match.type)}&query=${encodeURIComponent(match.name)}`);
      if(!alive||sequence!==packSequence)return;
      if(!result?.ok)throw new Error(errorMessage(result,'Pack lookup is unavailable. Please try again.'));
      packs=normaliseDmdRecords(result.data?.packs).filter(pack=>PACK_TYPES.has(pack.type));selectedPack=packs[0]||null;isLoadingPacks=false;renderSelection();
      setStatus(packs.length?`${packs.length} ${packs.length===1?'pack option':'pack options'} available. Choose a pack and quantity.`:'No orderable packs were found for this medicine. Choose another match.');
    }catch(error){if(!alive||sequence!==packSequence)return;isLoadingPacks=false;renderSelection();setStatus(error?.message||'Could not load pack sizes.',true);onError(error);}
  }
  async function lookup(text,sequence){
    if(!alive||sequence!==searchSequence)return;const isLive=sourceSelect.value==='live';isSearching=true;setStatus(isLive?'Searching the Mellons live catalogue…':'Searching sample products…');input.setAttribute('aria-busy','true');
    try{
      const result=await request(isLive?`/api/dmd/search?q=${encodeURIComponent(text)}`:`/api/products?q=${encodeURIComponent(text)}`);
      if(!alive||sequence!==searchSequence)return;
      if(!result?.ok)throw new Error(errorMessage(result,'Medicine lookup is unavailable. Please try again.'));
      matches=normaliseDmdRecords(isLive?result.data?.matches:Array.isArray(result.data)?result.data.map(product=>({...product,type:'SAMPLE',referencePrice:null})):[]);showMatches();setStatus(matches.length?`${matches.length} matching ${matches.length===1?'medicine':'medicines'}. Use the arrow keys to choose a match.`:`No catalogue matches for “${text}”. Try another medicine name or strength.`);
    }catch(error){if(!alive||sequence!==searchSequence)return;matches=[];closeMatches();setStatus(`${error?.message||'Could not search the catalogue.'}${isLive?' Choose Sample products above to test the workflow while the live catalogue is unavailable.':''}`,true);onError(error);}
    finally{if(alive&&sequence===searchSequence){isSearching=false;input.removeAttribute('aria-busy');}}
  }
  function updateSourceLabels(){
    const isLive=sourceSelect.value==='live';
    headingTitle.textContent=isLive?'Mellons medicine catalogue':'Sample product catalogue';
    headingDescription.textContent=isLive?'Find a medicine, choose its pack, then add it to your test basket.':'Choose a sample product to test ordering, receiving and shelf stock.';
    provenanceBadge.textContent=isLive?'NHS Drug Tariff reference data':'Sample data only';
    note.textContent=isLive?'Medicine and pack matches come from the Mellons catalogue. Tariff reference prices are separate from simulated supplier prices, orders and shelf stock.':'Sample products are test fixtures. Names, prices and stock shown here are not live catalogue or supplier data.';
    input.placeholder=isLive?'Start typing a medicine, e.g. amoxicillin 500mg':'Search sample products, e.g. amoxicillin';
  }
  listen(sourceSelect,'change',()=>{
    rememberedSource=sourceSelect.value;selected=null;packs=[];selectedPack=null;query='';matches=[];searchSequence++;packSequence++;clearTimeout(timer);isSearching=false;isLoadingPacks=false;input.value='';input.removeAttribute('aria-busy');closeMatches();renderSelection();updateSourceLabels();setStatus(sourceSelect.value==='live'?'Type at least 2 characters to search the Mellons live catalogue.':'Type at least 2 characters to search sample products.');input.focus();
  });
  updateSourceLabels();
  listen(input,'input',()=>{
    query=input.value.trim();selected=null;packs=[];selectedPack=null;isLoadingPacks=false;packSequence++;renderSelection();clearTimeout(timer);matches=[];closeMatches();
    const sequence=++searchSequence;input.removeAttribute('aria-busy');isSearching=false;
    if(query.length<2){setStatus('Type at least 2 characters to search the medicine catalogue.');return;}
    setStatus('Looking for matching medicines…');timer=setTimeout(()=>lookup(query,sequence),250);
  });
  listen(input,'focus',()=>{if(matches.length&&!selected)showMatches();});
  listen(input,'keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMatches();return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      if(!matches.length)return;event.preventDefault();event.stopPropagation();if(popover.hidden)showMatches();
      activeIndex=event.key==='ArrowDown'?(activeIndex+1)%matches.length:(activeIndex<0?matches.length-1:(activeIndex-1+matches.length)%matches.length);updateActive();
    }else if(event.key==='Enter'&&!popover.hidden&&activeIndex>=0){event.preventDefault();event.stopPropagation();void chooseMatch(activeIndex);}
  });
  listen(list,'pointerdown',event=>{if(event.target.closest('[data-dmd-index]'))event.preventDefault();});
  listen(root,'click',event=>{
    const option=event.target.closest('[data-dmd-index]');if(option&&root.contains(option)){event.preventDefault();event.stopPropagation();void chooseMatch(Number(option.dataset.dmdIndex));return;}
    if(event.target.closest('[data-dmd-clear]')){event.preventDefault();event.stopPropagation();selected=null;packs=[];selectedPack=null;query='';matches=[];searchSequence++;packSequence++;clearTimeout(timer);isLoadingPacks=false;input.value='';renderSelection();setStatus('Type at least 2 characters to search the medicine catalogue.');input.focus();}
  });
  listen(doc,'pointerdown',event=>{if(!root.contains(event.target))closeMatches();});
  listen(root,'focusout',()=>{queueMicrotask(()=>{if(alive&&!root.contains(doc.activeElement))closeMatches();});});
  return ()=>{if(!alive)return;alive=false;searchSequence++;packSequence++;clearTimeout(timer);abort.abort();root.remove();};
}
