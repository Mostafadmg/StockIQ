/** GS1 keyboard-scanner parsing. No network, storage, DOM or automatic ordering. */
const barcodeGroupSeparator='\x1d';
const barcodeGs1Prefixes=new Set([']d2',']C1',']Q3',']e0',']e1',']e2',']e3']);
const barcodePlainPrefixes=new Set([']E0',']E1',']E2',']E3',']E4',']C0',']d1',']Q1',']Q2']);
const barcodeFixedLengths={'01':14,'02':14,'17':6};
const barcodeVariableLengths={'10':20,'21':20,'37':8};
function barcodeError(message){const error=new Error(message);error.status=400;error.code='INVALID_BARCODE';return error;}

/** Preserve leading zeroes; validate GS1 modulo-10 before padding to GTIN-14. */
export function normalizeGtin(raw){
 if(typeof raw!=='string'||!/^\d+$/.test(raw)||/^0+$/.test(raw)||![8,12,13,14].includes(raw.length))throw barcodeError('Scan an EAN, UPC or GTIN containing 8, 12, 13 or 14 digits.');
 let sum=0,weight=3;for(let index=raw.length-2;index>=0;index--){sum+=Number(raw[index])*weight;weight=weight===3?1:3;}
 if((10-sum%10)%10!==Number(raw.at(-1)))throw barcodeError('The barcode check digit is invalid. Scan the pack again.');
 return raw.padStart(14,'0');
}

function barcodeExpiry(raw,now){
 if(!/^\d{6}$/.test(raw))throw barcodeError('The encoded expiry date must contain six digits.');
 const currentYear=new Date(now).getUTCFullYear();if(!Number.isFinite(currentYear))throw barcodeError('The reference date is invalid.');
 // Match Mellonsdaily: infer the unique year in [currentYear-50,currentYear+49].
 const low=currentYear-50,year=low+((Number(raw.slice(0,2))-low%100+100)%100),month=Number(raw.slice(2,4)),encodedDay=Number(raw.slice(4,6));
 if(month<1||month>12)throw barcodeError('The encoded expiry month is invalid.');
 const lastDay=new Date(Date.UTC(year,month,0)).getUTCDate(),day=encodedDay===0?lastDay:encodedDay;
 if(day<1||day>lastDay)throw barcodeError('The encoded expiry day is invalid.');
 return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function barcodeAddField(fields,ai,value){
 if(!(ai in barcodeFixedLengths)&&!(ai in barcodeVariableLengths))throw barcodeError(`Application identifier ${ai} is not supported. Use a medicine pack barcode.`);
 if(Object.hasOwn(fields,ai))throw barcodeError(`Application identifier ${ai} occurs more than once. Scan the pack again.`);
 if(ai in barcodeFixedLengths){if(value.length!==barcodeFixedLengths[ai]||!/^\d+$/.test(value))throw barcodeError(`Application identifier ${ai} has an invalid length or value.`);}
 else if(!value||value.length>barcodeVariableLengths[ai]||/[^\x20-\x7e]/.test(value))throw barcodeError(`Application identifier ${ai} has an invalid length or value. Preserve the scanner's field separators.`);
 if(ai==='37'&&(!/^\d+$/.test(value)||Number(value)<1))throw barcodeError('The contained-item count is invalid.');
 fields[ai]=value;
}

function barcodeParenthesized(text){
 const fields={},matches=[...text.matchAll(/\((\d{2,4})\)/g)];
 if(!matches.length||matches[0].index!==0)throw barcodeError('The parenthesized barcode format is invalid.');
 for(let index=0;index<matches.length;index++){
  const match=matches[index],end=matches[index+1]?.index??text.length,value=text.slice(match.index+match[0].length,end).trim().replace(/\x1d$/,'').trim();
  if(value.includes(barcodeGroupSeparator)||/[()]/.test(value))throw barcodeError('The barcode contains an incomplete or ambiguous application identifier.');
  barcodeAddField(fields,match[1],value);
 }
 return fields;
}

function barcodeGs1(text){
 const fields={};let index=0;
 while(index<text.length){
  const ai=text.slice(index,index+2);index+=2;
  if(ai in barcodeFixedLengths){const length=barcodeFixedLengths[ai],value=text.slice(index,index+length);barcodeAddField(fields,ai,value);index+=length;}
  else if(ai in barcodeVariableLengths){
   const separator=text.indexOf(barcodeGroupSeparator,index),end=separator<0?text.length:separator;
   // A variable field ends only at FNC1 or end of data. Never guess an AI from
   // digits inside a lot/serial; scanners must preserve FNC1 between fields.
   barcodeAddField(fields,ai,text.slice(index,end));index=end;
  }else throw barcodeError(`Application identifier ${ai||'missing'} is not supported. Preserve the scanner's field separators.`);
  if(text[index]===barcodeGroupSeparator){index++;if(text[index]===barcodeGroupSeparator)throw barcodeError('The barcode contains an empty field.');}
 }
 return fields;
}

/**
 * Parse an EAN/UPC/GTIN or GS1 pack scan. Callers must discard raw/serial data
 * after lookup; serial is exposed only for interoperability, never persisted.
 * AI02 identifies contained trade items, so explicit pack confirmation is needed.
 */
export function parseMedicineBarcode(raw,{now=new Date()}={}){
 if(typeof raw!=='string'||!raw.length||raw.length>1024)throw barcodeError('Scan or paste a barcode of at most 1,024 characters.');
 let text=raw.replace(/<GS>|\[GS\]|\{GS\}|␝|↔/gi,barcodeGroupSeparator).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g,''),prefix='';
 if(text.startsWith(']')){prefix=text.slice(0,3);if(!barcodeGs1Prefixes.has(prefix)&&!barcodePlainPrefixes.has(prefix))throw barcodeError('This scanner barcode prefix is not supported. Use a medicine pack barcode.');text=text.slice(3);}
 text=text.replace(/^\x1d/,'').replace(/\x1d$/,'');
 if(!text||/[^\x20-\x7e\x1d]/.test(text))throw barcodeError('The barcode contains unsupported control characters.');
 if(/^\d+$/.test(text)&&[8,12,13,14].includes(text.length)&&(!barcodeGs1Prefixes.has(prefix)||prefix.startsWith(']e'))){
  return {gtin:normalizeGtin(text),format:'ean',batch:null,expiry:null,expiryRaw:null,serial:null,containedCount:null,requiresPackConfirmation:false,warnings:[]};
 }
 const fields=text.startsWith('(')?barcodeParenthesized(text):barcodeGs1(text);
 if(!fields['01']&&!fields['02'])throw barcodeError('The GS1 barcode does not contain a product GTIN (01 or 02).');
 const gtin=normalizeGtin(fields['01']||fields['02']);
 if(fields['01']&&fields['02']&&normalizeGtin(fields['02'])!==gtin)throw barcodeError('The barcode contains conflicting product and contained-item GTINs. Confirm the pack manually.');
 if(fields['37']&&!fields['02'])throw barcodeError('A contained-item count requires application identifier 02.');
 const requiresPackConfirmation=!fields['01']&&!!fields['02'],warnings=[];
 if(requiresPackConfirmation)warnings.push('This is a contained-item GTIN (02), not proof of the scanned outer pack. Confirm the medicine and pack size before ordering.');
 if(fields['37'])warnings.push('The contained-item count does not set the order quantity. Choose the number of packs yourself.');
 if(!text.startsWith('(')&&!fields['17']){
  const possibleExpiry=[fields['10'],fields['21']].filter(Boolean).some(value=>[...value.matchAll(/17(\d{6})$/g)].some(match=>{try{barcodeExpiry(match[1],now);return true;}catch{return false;}}));
  if(possibleExpiry)warnings.push('No expiry was separated from the batch or serial field. Check the pack; an expiry date was not inferred.');
 }
 return {gtin,format:'gs1',batch:fields['10']??null,expiry:fields['17']?barcodeExpiry(fields['17'],now):null,expiryRaw:fields['17']??null,serial:fields['21']??null,containedCount:fields['37']?Number(fields['37']):null,requiresPackConfirmation,warnings};
}
