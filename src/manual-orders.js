/** Manual-order orchestration. Direct send never stages or submits basket lines. */
export function createManualOrderActions({call,runMutation=callback=>callback(),onUpdate=()=>{}}={}){
 if(typeof call!=='function')throw new TypeError('A workspace API callback is required.');
 const resolved=new Map();
 const resolve=async selection=>{if(selection.type==='SAMPLE')return {id:selection.id};const key=selection.type+':'+selection.id;if(!resolved.has(key)){const pending=call('/api/catalogue/import','POST',{id:selection.id,type:selection.type,query:selection.query}).catch(error=>{resolved.delete(key);throw error;});resolved.set(key,pending);}return resolved.get(key);};
 return {
  onCompare:selection=>runMutation(async()=>{const product=await resolve(selection);return call('/api/orders/compare','POST',{productId:product.id,quantity:selection.quantity,scenario:selection.scenario||'full'});}),
  onQuote:selection=>runMutation(async()=>{const product=await resolve(selection);return call('/api/orders/quote','POST',{productId:product.id,quantity:selection.quantity,supplier:selection.supplier,scenario:selection.scenario||'full'});}),
  onAdd:selection=>runMutation(async()=>{const product=await resolve(selection);const result=await call('/api/basket','POST',{productId:product.id,quantity:selection.quantity,...(selection.supplier?{supplier:selection.supplier}:{})});onUpdate();return result;}),
  onSend:selection=>runMutation(async()=>{if(!selection.requestId)throw new Error('Please select the medicine again before sending.');const product=await resolve(selection);const result=await call('/api/orders/direct','POST',{productId:product.id,quantity:selection.quantity,supplier:selection.supplier,notes:selection.notes||'',requestId:selection.requestId,...(selection.scenario?{scenario:selection.scenario}:{})});onUpdate();return result;})
 };
}
