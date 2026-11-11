import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {renderBasketReview,renderBasketSupplierOptions} from '../src/basket-review.js';

const medicine=(id,name,price,quantity,supplier)=>({id,name,price,quantity,supplier,pack:'28 tablets',stock:7,target:12});
const state={products:[medicine('a','Amoxicillin',2,3,'Phoenix'),medicine('z','Zopiclone',4,2,'AAH')],basket:[medicine('a','Amoxicillin',2,3,'Phoenix'),medicine('z','Zopiclone',4,2,'AAH')],settings:{preferredSupplier:'Phoenix'}};
const offer=(supplier,unitPrice,quantity)=>({supplier,unitPrice,estimatedTotal:unitPrice*quantity,available:true,delivery:{estimatedArrivalAt:'2026-11-12T10:00:00Z',orderBy:'2026-11-11T17:00:00Z'}});
const review={simulated:true,lines:state.basket.map(item=>({productId:item.id,name:item.name,quantity:item.quantity,selectedSupplier:item.supplier,quotes:[offer('Phoenix',item.price,item.quantity),offer('AAH',item.price+.5,item.quantity)]}))};
const documentFor=options=>parseHTML('<html><body>'+renderBasketReview(state,{review,...options})+'</body></html>').document;

test('basket opens as an order-review page with original columns and working-control selectors',()=>{
 const doc=documentFor();assert.equal(doc.querySelector('[role="dialog"]'),null);assert.equal(doc.querySelector('h1').textContent,'Order review');assert.equal(doc.querySelector('#basket-ready-title').textContent,'Ready to order 2');assert.deepEqual([...doc.querySelector('.basket-column-header').children].map(node=>node.textContent),['','Product','Stock','Target','Price','Supplier','Order','Total','']);
 assert.equal(doc.querySelectorAll('[data-basket-item-id]').length,2);assert.equal(doc.querySelectorAll('[data-basket-qty]').length,2);assert.equal(doc.querySelectorAll('[data-basket-supplier]').length,2);assert.equal(doc.querySelectorAll('[data-review-select]').length,2);assert.equal(doc.querySelectorAll('[data-action="remove-basket"]').length,2);assert.equal(doc.querySelector('[data-basket-qty]').getAttribute('min'),'0');assert.ok(doc.querySelector('[data-action="basket-back"]'));assert.ok(doc.querySelector('[data-action="review-cascade"]'));assert.ok(doc.querySelector('[data-action="save-draft"]'));assert.ok(doc.querySelector('[data-action="cascade-submit"]'));assert.ok(doc.querySelector('[data-review-footer]'));assert.match(doc.body.textContent,/Test workspace.*simulated/);assert.match(doc.querySelector('.basket-cutoffs').textContent,/Cut-offs/);
});

test('original selection semantics submit all with no ticks and only selected lines otherwise',()=>{
 const all=documentFor({selected:new Set()});assert.equal(all.querySelectorAll('[data-review-select][checked]').length,0);assert.equal(all.querySelector('[data-action="basket-select-all"]').getAttribute('aria-pressed'),'false');assert.equal(all.querySelector('[data-action="cascade-submit"]').getAttribute('aria-label'),'Submit to wholesalers');assert.equal(all.querySelector('.basket-submit-desktop').textContent,'Submit to wholesalers →');assert.equal(all.querySelector('.basket-submit-mobile').textContent,'Submit →');assert.match(all.querySelector('.basket-footer-total').textContent,/£15\.00.*2 lines will be sent/);
 const one=documentFor({selected:new Set(['a'])});assert.equal(one.querySelectorAll('[data-review-select][checked]').length,1);assert.equal(one.querySelector('[data-action="cascade-submit"]').textContent,'Submit the 1 selected line only');assert.match(one.querySelector('.basket-footer-total').textContent,/£6\.00.*1 line will be sent/);
 const every=documentFor({selected:new Set(['a','z'])});assert.equal(every.querySelector('[data-action="basket-select-all"]').getAttribute('aria-pressed'),'true');assert.equal(every.querySelector('[data-action="cascade-submit"]').textContent,'Submit the 2 selected lines only');
});

test('supplier and price ordering reflect quoted test costs and preserve exact basket ids',()=>{
 const grouped=documentFor({sort:{key:'wholesaler',dir:'asc'}});assert.deepEqual([...grouped.querySelectorAll('[data-basket-item-id]')].map(node=>node.dataset.basketItemId),['z','a']);assert.match(grouped.querySelector('.basket-supplier-heading').textContent,/AAH.*1 line.*£9.00/);assert.equal(grouped.querySelector('[data-basket-supplier="z"]').value,'AAH');assert.match(grouped.querySelector('[data-action="basket-supplier-options"][data-id="z"]').textContent,/AAH/);
 const names=documentFor({sort:{key:'name',dir:'asc'}});assert.deepEqual([...names.querySelectorAll('[data-basket-item-id]')].map(node=>node.dataset.basketItemId),['a','z']);assert.equal(names.querySelector('.basket-supplier-heading'),null);
 const totals=documentFor({sort:{key:'lineTotal',dir:'desc'}});assert.deepEqual([...totals.querySelectorAll('[data-basket-item-id]')].map(node=>node.dataset.basketItemId),['z','a']);assert.match(totals.querySelector('[data-basket-item-id="z"] .basket-line-total').textContent,/£9.00/);
});

test('loading and failed review cannot submit, and an empty basket has the original Auto Orders route',()=>{
 for(const options of [{loading:true},{error:'Supplier preview unavailable'},{review:null}]){const doc=documentFor(options);assert.ok(doc.querySelector('[data-action="cascade-submit"]').hasAttribute('disabled'));if(options.error){assert.equal(doc.querySelector('[role="alert"] span').textContent,options.error);assert.equal(doc.querySelector('[role="alert"] [data-action="review-cascade"]').textContent,'Retry');}}
 const doc=parseHTML('<body>'+renderBasketReview({products:[],basket:[],settings:{}},{review:{lines:[]}})+'</body>').document;assert.equal(doc.querySelector('[data-nav="auto"]').textContent,'Go to Auto Orders');assert.ok(doc.querySelector('[data-action="save-draft"]').hasAttribute('disabled'));assert.ok(doc.querySelector('[data-action="cascade-submit"]').hasAttribute('disabled'));assert.equal(doc.querySelectorAll('[data-basket-item-id]').length,0);
});

test('medicine fields, supplier names, errors and order notes are escaped as text',()=>{
 const name='<img src=x onerror="alert(1)">',id='x" autofocus onfocus="alert(2)',supplier='<svg onload=alert(3)>',item=medicine(id,name,2,1,supplier),doc=parseHTML('<body>'+renderBasketReview({products:[item],basket:[item],settings:{}},{review:{lines:[]},notes:'</textarea><script>alert(4)</script>',error:'<iframe src=x></iframe>'})+'</body>').document;
 assert.equal(doc.querySelector('img,svg,script,iframe'),null);assert.equal(doc.querySelector('[data-basket-item-id]').dataset.basketItemId,id);assert.equal(doc.querySelector('.basket-line-product>strong').textContent,name);assert.match(doc.querySelector('[data-basket-notes]').textContent,/alert\(4\)/);assert.equal(doc.querySelector('[role="alert"] span').textContent,'<iframe src=x></iframe>');assert.equal(doc.querySelector('[autofocus],[onfocus]'),null);
});

test('supplier alternatives show all test offers in price order and require an explicit Use action',()=>{
 const product=state.products[0],line=state.basket[0],offers={productId:line.id,quotes:[offer('Phoenix',3,3),{...offer('Warehouse',1,3),available:false},offer('AAH',2,3)]};
 const doc=parseHTML('<body>'+renderBasketSupplierOptions(product,line,offers)+'</body>').document;
 assert.deepEqual([...doc.querySelectorAll('[name="basket-supplier-option"]')].map(input=>input.value),['Warehouse','AAH','Phoenix']);assert.ok(doc.querySelector('input[value="Warehouse"]').hasAttribute('disabled'));assert.equal(doc.querySelector('input[checked]').value,'Phoenix','The current supplier remains selected even when another test offer is cheaper');assert.match(doc.querySelector('.basket-supplier-use').textContent,/Use Phoenix.*£9\.00 total/);assert.equal(doc.querySelector('.basket-supplier-use').dataset.id,'a');assert.equal(doc.querySelectorAll('[data-action="basket-choose-supplier"]').length,1);assert.match(doc.querySelector('.basket-supplier-options').textContent,/Simulated supplier prices/);assert.match(doc.querySelector('.basket-supplier-options').textContent,/Available in test/);assert.match(doc.querySelector('.basket-supplier-options').textContent,/Test unit price/);
 const unavailable=parseHTML('<body>'+renderBasketSupplierOptions(product,line,{quotes:[{...offer('AAH',2,3),available:false}]})+'</body>').document;assert.ok(unavailable.querySelector('.basket-supplier-use').hasAttribute('disabled'));assert.equal(unavailable.querySelector('input[checked]'),null);
});
