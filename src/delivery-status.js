/** Derive a delivery badge from a saved schedule estimate, never from supplier names. */
export function deliveryStatus(delivery,{acceptedQuantity=1}={}) {
  if(acceptedQuantity===0)return {tone:'neutral',label:'No delivery',isEstimate:false};
  if(!Number.isSafeInteger(acceptedQuantity)||acceptedQuantity<1)return {tone:'neutral',label:'Estimate unavailable',isEstimate:true};
  const depot=typeof delivery?.depot==='string'?delivery.depot.trim().replace(/\s+/g,' ').slice(0,80):'';
  const workingDays=Number.isSafeInteger(delivery?.workingDays)&&delivery.workingDays>=0?delivery.workingDays:null;
  const estimatedArrivalAt=validArrival(delivery?.estimatedArrivalAt);
  const details={isEstimate:true,...(depot?{depot}:{}),...(workingDays!==null?{workingDays}:{}),...(estimatedArrivalAt?{estimatedArrivalAt}:{})};
  if(!estimatedArrivalAt||workingDays===null)return {tone:'neutral',label:depot?`${depot} · estimate unavailable`:'Estimate unavailable',...details};
  const service=workingDays===0?'Same day':workingDays===1?'Next working day':`${workingDays} working days`;
  const birmingham=/\bbirmingham\b/i.test(depot);
  return {tone:birmingham||workingDays>=2?'yellow':'green',label:depot?`${depot} · ${service.toLowerCase()}`:service,...details};
}

function validArrival(value) {
  if(typeof value!=='string')return null;
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if(!match)return null;
  const [year,month,day,hour,minute,second]=match.slice(1).map(part=>Number(part||0));
  const daysInMonth=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
  if(!daysInMonth||day<1||day>daysInMonth||hour>23||minute>59||second>59||!Number.isFinite(Date.parse(value)))return null;
  return value;
}
