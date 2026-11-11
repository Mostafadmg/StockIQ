import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {default as worker} from '../dist/server/index.js';
const origin='https://stockiq-draft.test';
const fetchDraft=(path,options={})=>worker.fetch(new Request(origin+path,options),{},{});

test('built Worker serves the app shell and every linked first-party asset',async()=>{
  const response=await fetchDraft('/');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/html/);
  const html=await response.text();assert.match(html,/<title>StockIQ/);assert.match(html,/id="app"/);assert.match(html,/id="overlay"/);assert.match(html,/id="toast"/);
  const assets=[...html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)].map(m=>m[1]);assert.ok(assets.includes('/app.js'));assert.ok(assets.includes('/styles.css'));
  for(const asset of assets){const r=await fetchDraft(asset);assert.equal(r.status,200,`${asset} must be bundled`);assert.ok((await r.text()).length>10);}
  const script=await fetchDraft('/app.js');assert.match(script.headers.get('content-type'),/javascript/);const source=await script.text();
  for(const title of ['Auto Orders','Manual Orders','Goods In','History','Advanced','Tools'])assert.ok(source.includes(title),`Main shell includes ${title}`);
  const views=await fetchDraft('/views.js');assert.equal(views.status,200);assert.match(views.headers.get('content-type'),/javascript/);assert.match(await views.text(),/export function renderView/);
  const review=await fetchDraft('/basket-review.js');assert.equal(review.status,200);assert.match(review.headers.get('content-type'),/javascript/);assert.match(await review.text(),/export function renderBasketReview/);assert.ok(assets.includes('/basket-review.css'));
});
test('deep links serve the same shell; missing assets remain 404 and HEAD omits bodies',async()=>{
  const base=await (await fetchDraft('/')).text();
  for(const path of ['/daily-orders','/review','/goods-in/queue','/history','/advanced/analytics'])assert.equal(await (await fetchDraft(path)).text(),base);
  assert.equal((await fetchDraft('/missing.js')).status,404);
  const head=await fetchDraft('/styles.css',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});
test('hosted page policy permits same-origin APIs and excludes external connections',async()=>{
  const r=await fetchDraft('/');const policy=r.headers.get('content-security-policy');
  assert.equal(r.headers.get('permissions-policy'),'serial=(self)');
  assert.ok(policy);assert.match(policy,/(?:^|;)\s*connect-src 'self'(?:;|$)/);assert.match(policy,/(?:^|;)\s*script-src 'self'(?:;|$)/);
  assert.match(policy,/object-src 'none'/);assert.match(policy,/base-uri 'self'/);assert.match(policy,/form-action 'self'/);
  assert.doesNotMatch(policy,/https?:|\*|'unsafe-eval'/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');
});
test('the serial transport is served as a first-party module with no scanner output commands',async()=>{
  const transport=await fetchDraft('/serial-scanner.js');assert.equal(transport.status,200);assert.match(transport.headers.get('content-type'),/javascript/);
  const source=await transport.text();assert.match(source,/export function createSerialScanner/);assert.doesNotMatch(source,/getWriter\s*\(|setSignals\s*\(/);
  const picker=await (await fetchDraft('/manual-search.js')).text();assert.match(picker,/from ['"]\.\/serial-scanner\.js['"]/);
});
test('deployed API artifact supports create, submit, receive and restored snapshots without network calls',async()=>{
  const id=`worker-test-${crypto.randomUUID()}`;
  const request=async(method,path,data)=>{const r=await fetchDraft(path,{method,headers:{'content-type':'application/json','x-workspace-id':id},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,...await r.json()};};
  const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Sandbox Worker attempted an outbound network call');};
  try{
    const health=await request('GET','/api/health');assert.equal(health.status,200);assert.equal(health.data.supplierConnections,0);assert.equal(health.production,false);
    const created=await request('POST','/api/workspaces',{id});assert.equal(created.status,201);assert.equal(created.workspace.products.length,24);
    const beforeStock=created.workspace.products[0].stock;
    assert.equal((await request('POST','/api/basket',{productId:'p001',quantity:2})).status,201);
    const placed=await request('POST','/api/orders',{notes:'Built artifact integration test'});assert.equal(placed.status,201);assert.equal(placed.data.total,1.48);assert.equal(placed.workspace.basket.length,0);
    const receipt=await request('POST',`/api/orders/${placed.data.id}/receive`,{});assert.equal(receipt.status,200);assert.equal(receipt.data.status,'Received');assert.equal(receipt.workspace.products[0].stock,beforeStock+2);
    assert.equal((await request('POST',`/api/orders/${placed.data.id}/receive`,{})).status,409);
    const restored=await request('POST','/api/workspaces',{id,workspace:receipt.workspace});assert.equal(restored.status,201);assert.equal(restored.workspace.orders[0].status,'Received');
    const history=await request('GET','/api/orders?status=Received');assert.ok(history.data.some(o=>o.id===placed.data.id));
  }finally{globalThis.fetch=originalFetch;}
});
test('compiled client assets and server contain no production domains, account email or embedded secret values',async()=>{
  const compiled=await readFile(new URL('../dist/server/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(compiled,/(?:ordering|api)\.stockiq\.uk/i);assert.doesNotMatch(compiled,/@alliedpharmacies\.com/i);
  assert.doesNotMatch(compiled,/art_v2_[a-z0-9_]+|gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sk-proj-[A-Za-z0-9_-]+/);
  const app=await (await fetchDraft('/app.js')).text();assert.match(app,/fetch\('\/api\/workspaces'/);assert.match(app,/fetch\('\/api\/dispatch'/);assert.doesNotMatch(app,/fetch\(['"`]https?:/);
  const reference=await fetchDraft('/api-reference.json');assert.equal(reference.status,200);const doc=await reference.json();assert.ok(doc&&typeof doc==='object');
  const manifest=JSON.parse(await readFile(new URL('../dist/.openai/hosting.json',import.meta.url),'utf8'));
  assert.match(manifest.project_id,/^appgprj_/);assert.equal(manifest.static,undefined);
});



test('downloadable source is a ZIP of authored code without runtime state',async()=>{const response=await worker.fetch(new Request('https://sandbox.test/source.zip'),{},{});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(String.fromCharCode(...bytes.slice(0,2)),'PK');const text=new TextDecoder().decode(bytes);assert.ok(text.includes('stockiq/src/app.js'));assert.ok(text.includes('stockiq/README.md'));const names=[];let offset=0;const buffer=Buffer.from(bytes);while(buffer.readUInt32LE(offset)===0x04034b50){const size=buffer.readUInt32LE(offset+18),length=buffer.readUInt16LE(offset+26),extra=buffer.readUInt16LE(offset+28);names.push(buffer.subarray(offset+30,offset+30+length).toString());offset+=30+length+extra+size;}assert.ok(names.length>=17);assert.ok(names.every(name=>name.startsWith('stockiq/')));assert.ok(!names.some(name=>/browser-profile|localStorage|\.env|\.git\//.test(name)));});
