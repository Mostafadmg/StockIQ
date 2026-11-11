/** Manual-order orchestration. Direct send never stages or submits basket lines. */
export function createManualOrderActions({call,runMutation=callback=>callback(),onUpdate=()=>{}}={}){
 if(typeof call!=='function')throw new TypeError('A workspace API callback is required.');
 const resolve=async selection=>selection.type==='SAMPLE'?{id:selection.id}:call('/api/catalogue/import','POST',{id:selection.id,type:selection.type,query:selection.query});
 return {
  onAdd:selection=>runMutation(async()=>{const product=await resolve(selection);const result=await call('/api/basket','POST',{productId:product.id,quantity:selection.quantity});onUpdate();return result;}),
  onSend:selection=>runMutation(async()=>{if(!selection.requestId)throw new Error('Please select the medicine again before sending.');const product=await resolve(selection);const result=await call('/api/orders/direct','POST',{productId:product.id,quantity:selection.quantity,supplier:selection.supplier,notes:selection.notes||'',requestId:selection.requestId});onUpdate();return result;})
 };
}
