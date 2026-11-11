/** Deterministic test-supplier acceptance and London delivery estimates; no network access. */
const fulfilmentZone='Europe/London';
const fulfilmentFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:fulfilmentZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const fulfilmentHolidayCache=new Map();
function fulfilmentError(message){const error=new Error(message);error.status=400;throw error;}
function fulfilmentCivil(value){const parts=Object.fromEntries(fulfilmentFormatter.formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));return {year:parts.year,month:parts.month,day:parts.day,hour:parts.hour,minute:parts.minute};}
function fulfilmentDayNumber(day){return Date.UTC(day.year,day.month-1,day.day)/86400000;}
function fulfilmentAddDays(day,offset){const date=new Date((fulfilmentDayNumber(day)+offset)*86400000);return {year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()};}
function fulfilmentDayKey(day){return `${day.year}-${String(day.month).padStart(2,'0')}-${String(day.day).padStart(2,'0')}`;}
function fulfilmentWeekday(day){return new Date(fulfilmentDayNumber(day)*86400000).getUTCDay()||7;}
function fulfilmentHolidays(year){
 if(fulfilmentHolidayCache.has(year))return fulfilmentHolidayCache.get(year);
 const holidays=new Set(),add=day=>holidays.add(fulfilmentDayKey(day));
 const substitute=day=>{let date=day;while(fulfilmentWeekday(date)>5||holidays.has(fulfilmentDayKey(date)))date=fulfilmentAddDays(date,1);add(date);};
 substitute({year,month:1,day:1});
 // Gregorian Easter, then Good Friday and Easter Monday (England and Wales).
 const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1,easter={year,month,day};
 add(fulfilmentAddDays(easter,-2));add(fulfilmentAddDays(easter,1));
 const firstMonday=month=>{let day={year,month,day:1};while(fulfilmentWeekday(day)!==1)day=fulfilmentAddDays(day,1);return day;};
 const lastMonday=month=>{let day=fulfilmentAddDays({year,month:month+1,day:1},-1);while(fulfilmentWeekday(day)!==1)day=fulfilmentAddDays(day,-1);return day;};
 add(year===2020?{year,month:5,day:8}:firstMonday(5));
 if(year===2022){add({year,month:6,day:2});add({year,month:6,day:3});add({year,month:9,day:19});}else add(lastMonday(5));
 if(year===2023)add({year,month:5,day:8});
 add(lastMonday(8));
 // Reserve weekday Christmas/Boxing Day before allocating substitute holidays.
 for(const date of [{year,month:12,day:25},{year,month:12,day:26}])if(fulfilmentWeekday(date)<=5)add(date);
 for(const date of [{year,month:12,day:25},{year,month:12,day:26}])if(fulfilmentWeekday(date)>5)substitute(date);
 fulfilmentHolidayCache.set(year,holidays);return holidays;
}
function fulfilmentWorkingDay(day){return fulfilmentWeekday(day)<=5&&!fulfilmentHolidays(day.year).has(fulfilmentDayKey(day));}
function fulfilmentAddWorkingDays(day,count){let next={...day};while(count>0){next=fulfilmentAddDays(next,1);if(fulfilmentWorkingDay(next))count--;}return next;}
function fulfilmentWorkingDaysBetween(from,to){let count=0;for(let day=fulfilmentAddDays(from,1);fulfilmentDayNumber(day)<=fulfilmentDayNumber(to);day=fulfilmentAddDays(day,1))if(fulfilmentWorkingDay(day))count++;return count;}
function fulfilmentInstant(day,time){
 const [hour,minute]=time.split(':').map(Number),base=Date.UTC(day.year,day.month-1,day.day,hour,minute);
 // UK uses GMT/BST. Match civil time explicitly to avoid DST-gap ambiguity.
 const matches=[base-3600000,base].filter(value=>{const p=fulfilmentCivil(value);return p.year===day.year&&p.month===day.month&&p.day===day.day&&p.hour===hour&&p.minute===minute;});
 return matches.length?Math.min(...matches):null;
}
function fulfilmentServiceLabel(days){return days===0?'Same day':days===1?'Next working day':`${days} working days`;}
function fulfilmentNoDelivery(note,serviceLabel='Delivery not configured'){return {estimatedArrivalAt:null,orderBy:null,workingDays:null,serviceLabel,basis:'schedule_estimate',timezone:fulfilmentZone,scheduleId:null,note};}
/** The next England/Wales working date in London, for delivery grouping. */
export function nextWorkingDayKey(from=new Date().toISOString()){if(!Number.isFinite(Date.parse(from)))fulfilmentError('Delivery date is invalid.');return fulfilmentDayKey(fulfilmentAddWorkingDays(fulfilmentCivil(from),1));}
/** Configured van offset is measured in working days, skipping England/Wales bank holidays. */
export function nextDeliveryEstimate(supplier,schedules={},from=new Date().toISOString()){
 if(!Number.isFinite(Date.parse(from)))fulfilmentError('Delivery estimate time is invalid.');
 const local=fulfilmentCivil(from),explicit=Object.hasOwn(schedules,supplier),vans=explicit?schedules[supplier]:[{id:'default-weekday',days:[1,2,3,4,5],cutoff:'14:00',arrival:'09:00',offset:1}];
 let best=null;
 for(const van of vans||[])for(let offset=0;offset<32;offset++){
  const day=fulfilmentAddDays(local,offset);if(!van.days?.includes(fulfilmentWeekday(day))||fulfilmentHolidays(day.year).has(fulfilmentDayKey(day)))continue;
  const cutoff=fulfilmentInstant(day,van.cutoff);if(cutoff===null||cutoff<Date.parse(from))continue;
  const arrivalDay=fulfilmentAddWorkingDays(day,Number(van.offset||0)),arrival=fulfilmentInstant(arrivalDay,van.arrival);if(arrival===null||arrival<cutoff)continue;
  if(!best||arrival<best.arrival||(arrival===best.arrival&&cutoff<best.cutoff))best={arrival,cutoff,van,arrivalDay};
 }
 if(!best)return fulfilmentNoDelivery('No upcoming delivery run is configured. Check Delivery Times before relying on an arrival date.');
 const workingDays=fulfilmentWorkingDaysBetween(local,best.arrivalDay);
 return {estimatedArrivalAt:new Date(best.arrival).toISOString(),orderBy:new Date(best.cutoff).toISOString(),workingDays,serviceLabel:fulfilmentServiceLabel(workingDays),basis:'schedule_estimate',timezone:fulfilmentZone,scheduleId:best.van.id,note:`Estimated from ${explicit?'your configured delivery runs':'a default weekday delivery run'} in UK time; weekends and England/Wales bank holidays are skipped for day offsets. No supplier delivery promise was received.`};
}
export function normaliseFulfilmentScenario(value='full'){if(!['full','partial','unavailable'].includes(value))fulfilmentError('Test response must be full, partial or unavailable.');return value;}
export function scenarioAcceptedQuantity(quantity,scenario='full'){normaliseFulfilmentScenario(scenario);return scenario==='full'?quantity:scenario==='partial'?Math.max(0,quantity-1):0;}
export function createOrderFulfilment({supplier,items,scenario='full',createdAt=new Date().toISOString(),orderId=null,schedules={}}){
 normaliseFulfilmentScenario(scenario);
 const requestedQuantity=items.reduce((sum,item)=>sum+item.quantity,0),acceptedQuantity=items.reduce((sum,item)=>sum+scenarioAcceptedQuantity(item.quantity,scenario),0),outstandingQuantity=requestedQuantity-acceptedQuantity;
 return {simulated:true,scenario,supplier,sourceLabel:`${supplier} · simulated supply`,status:acceptedQuantity===0?'unavailable':outstandingQuantity?'partial':'accepted',requestedQuantity,acceptedQuantity,outstandingQuantity,supplierReference:orderId?`SIM-${supplier.toUpperCase().replace(/[^A-Z0-9]/g,'')}-${orderId}`:null,acceptedAt:orderId&&acceptedQuantity?createdAt:null,delivery:acceptedQuantity?nextDeliveryEstimate(supplier,schedules,createdAt):fulfilmentNoDelivery('No packs were accepted, so no delivery is scheduled. The remaining packs were not backordered.','No packs accepted')};
}
/** Receipt progress concerns accepted packs; unavailable packs are never receivable. */
export function fulfilmentReceiptStatus(items){const accepted=items.reduce((sum,item)=>sum+(item.acceptedQuantity??item.quantity),0);return accepted===0?'Not accepted':items.every(item=>item.received===(item.acceptedQuantity??item.quantity))?'Received':items.some(item=>item.received>0)?'Part received':'Awaiting';}
/** Persist the original acceptance/ETA snapshot while rejecting forged or malformed fields. */
export function restoreOrderFulfilment(value,{supplier,items,createdAt,orderId}){
 if(!value||typeof value!=='object'||Array.isArray(value))fulfilmentError('Invalid order fulfilment snapshot.');
 const allowed=['simulated','scenario','supplier','sourceLabel','status','requestedQuantity','acceptedQuantity','outstandingQuantity','supplierReference','acceptedAt','delivery'];if(Object.keys(value).some(key=>!allowed.includes(key)))fulfilmentError('Unknown order fulfilment field.');
 const expected=createOrderFulfilment({supplier,items,scenario:normaliseFulfilmentScenario(value.scenario),createdAt,orderId,schedules:{[supplier]:[]}});
 for(const key of allowed.filter(key=>!['delivery','supplierReference'].includes(key)))if(value[key]!==expected[key])fulfilmentError('Order fulfilment does not match accepted quantities.');
 if(typeof value.supplierReference!=='string'||value.supplierReference.length>100||!value.supplierReference.startsWith(`SIM-${supplier.toUpperCase().replace(/[^A-Z0-9]/g,'')}-TEST-`)||!/^SIM-[A-Z0-9]+-TEST-\d{4,9}$/.test(value.supplierReference))fulfilmentError('Invalid test supplier reference.');
 for(const item of items){if(item.requestedQuantity!==item.quantity||item.acceptedQuantity!==scenarioAcceptedQuantity(item.quantity,value.scenario)||item.outstandingQuantity!==item.quantity-item.acceptedQuantity||item.received>item.acceptedQuantity)fulfilmentError('Order line acceptance is invalid.');}
 const d=value.delivery,keys=['estimatedArrivalAt','orderBy','workingDays','serviceLabel','basis','timezone','scheduleId','note'];
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(key=>!keys.includes(key))||d.basis!=='schedule_estimate'||d.timezone!==fulfilmentZone||typeof d.note!=='string'||d.note.length>800)fulfilmentError('Invalid delivery estimate snapshot.');
 if(d.estimatedArrivalAt===null){if(d.orderBy!==null||d.workingDays!==null||d.scheduleId!==null||!['Delivery not configured','No packs accepted'].includes(d.serviceLabel)||(!expected.acceptedQuantity&&d.serviceLabel!=='No packs accepted'))fulfilmentError('Invalid empty delivery estimate.');}
 else{
  if(!expected.acceptedQuantity||typeof d.estimatedArrivalAt!=='string'||typeof d.orderBy!=='string'||!Number.isFinite(Date.parse(d.estimatedArrivalAt))||!Number.isFinite(Date.parse(d.orderBy))||Date.parse(d.orderBy)<Date.parse(createdAt)||Date.parse(d.estimatedArrivalAt)<Date.parse(d.orderBy)||!Number.isInteger(d.workingDays)||d.workingDays<0||d.workingDays>60||d.serviceLabel!==fulfilmentServiceLabel(d.workingDays)||typeof d.scheduleId!=='string'||!/^[-\w]{1,60}$/.test(d.scheduleId))fulfilmentError('Invalid dated delivery estimate.');
  if(d.workingDays!==fulfilmentWorkingDaysBetween(fulfilmentCivil(createdAt),fulfilmentCivil(d.estimatedArrivalAt)))fulfilmentError('Delivery working days do not match its arrival.');
 }
 return {...expected,supplierReference:value.supplierReference,delivery:Object.fromEntries(keys.map(key=>[key,d[key]]))};
}
