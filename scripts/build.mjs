import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');
await rm(new URL('dist',root),{recursive:true,force:true});
await mkdir(new URL('dist/server',root),{recursive:true});
await mkdir(new URL('dist/.openai',root),{recursive:true});
const assets={
 '/':{type:'text/html; charset=utf-8',body:await read('src/index.html')},
 '/barcode.js':{type:'text/javascript; charset=utf-8',body:await read('src/barcode.js')},
 '/barcode.css':{type:'text/css; charset=utf-8',body:await read('src/barcode.css')},
 '/order-summary.js':{type:'text/javascript; charset=utf-8',body:await read('src/order-summary.js')},
 '/server/fulfilment.mjs':{type:'text/javascript; charset=utf-8',body:await read('server/fulfilment.mjs')},
 '/ui-polish.css':{type:'text/css; charset=utf-8',body:await read('src/ui-polish.css')},
 '/parity.css':{type:'text/css; charset=utf-8',body:await read('src/parity.css')},
 '/parity-views.css':{type:'text/css; charset=utf-8',body:await read('src/parity-views.css')},
 '/parity-actions.js':{type:'text/javascript; charset=utf-8',body:await read('src/parity-actions.js')},
 '/icons.js':{type:'text/javascript; charset=utf-8',body:await read('src/icons.js')},
 '/stockiq-logo.svg':{type:'image/svg+xml',body:await read('src/stockiq-logo.svg')},
 '/styles.css':{type:'text/css; charset=utf-8',body:await read('src/styles.css')},
 '/app.js':{type:'text/javascript; charset=utf-8',body:await read('src/app.js')},
 '/manual-orders.js':{type:'text/javascript; charset=utf-8',body:await read('src/manual-orders.js')},
 '/manual-order.css':{type:'text/css; charset=utf-8',body:await read('src/manual-order.css')},
 '/manual-search.js':{type:'text/javascript; charset=utf-8',body:await read('src/manual-search.js')},
 '/manual-search.css':{type:'text/css; charset=utf-8',body:await read('src/manual-search.css')},
 '/views.css':{type:'text/css; charset=utf-8',body:await read('src/views.css')},
 '/views.js':{type:'text/javascript; charset=utf-8',body:await read('src/views.js')},
 '/favicon.svg':{type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" rx="13" fill="#242231"/><path d="M13 28h7V16h7v16h7" stroke="#b69aff" stroke-width="5" fill="none"/><circle cx="32" cy="15" r="4" fill="#81dcc0"/></svg>'},
 '/api-reference.json':{type:'application/json',body:await read('docs/api-reference.json')}
};
// The source ZIP is generated on download. This keeps only one copy of the
// reference catalogue in the Worker rather than embedding another base64 ZIP.
const sourceFiles=['.gitignore','.openai/hosting.json','README.md','package.json','package-lock.json','scripts/build.mjs','scripts/prepare-dmd.py','scripts/prepare-gtin.py','.github/workflows/ci.yml','server/api.mjs','server/fulfilment.mjs','server/gtin.mjs','server/dmd.mjs','server/dmd-local.mjs','server/local.mjs','src/index.html','src/app.js','src/barcode.js','src/barcode.css','src/order-summary.js','src/icons.js','src/stockiq-logo.svg','src/parity.css','src/ui-polish.css','src/parity-views.css','src/parity-actions.js','src/manual-search.js','src/manual-orders.js','src/manual-order.css','src/manual-search.css','src/views.js','src/styles.css','src/views.css','docs/api-reference.json','docs/feature-coverage.md','docs/parity.md','docs/development.md','data/dmd-release.json','data/dmd-gtin-release.json','tests/api.test.mjs','tests/views.test.mjs','tests/worker.test.mjs','tests/catalogue.test.mjs','tests/manual-search.test.mjs','tests/dmd-local.test.mjs','tests/features.test.mjs','tests/parity-actions.test.mjs','tests/direct-order.test.mjs','tests/manual-orders.test.mjs','tests/manual-picker-dom.test.mjs','tests/app-manual-dom.test.mjs','tests/order-summary.test.mjs','tests/fulfilment.test.mjs','tests/barcode.test.mjs','tests/gtin.test.mjs','tests/barcode-api.test.mjs'];
const sourceEntries={};for(const file of sourceFiles)sourceEntries['stockiq/'+file]=await read(file);
const data=JSON.parse(await read('data/dmd-catalogue.json'));
const gtinData=JSON.parse(await read('data/dmd-gtin.json'));
const stripExports=s=>s.replace(/export\s+(?=(?:async\s+)?function|const |let |class )/g,'');
const embedIsolatedModule=source=>{const names=[...source.matchAll(/^export (?:async )?function (\w+)/gm)].map(match=>match[1]).join(',');return `const {${names}}=(()=>{${stripExports(source.replace(/^import .*?;\n/gm,''))};return {${names}};})();`;};
const barcode=embedIsolatedModule(await read('src/barcode.js'));
const gtin=embedIsolatedModule(await read('server/gtin.mjs'));
const local=stripExports((await read('server/dmd-local.mjs')).replace(/^import localCatalogue .*?;\n/m,''));
const provider=stripExports((await read('server/dmd.mjs')).replace(/^import .*?from '\.\/dmd-local\.mjs';\n/m,'').replace(/^export \{dmdCatalogueStatus\};?\n?/m,''));
const fulfilmentSource=await read('server/fulfilment.mjs');
const fulfilmentNames=[...fulfilmentSource.matchAll(/^export function (\w+)/gm)].map(match=>match[1]).join(',');
const fulfilment=`const {${fulfilmentNames}}=(()=>{${stripExports(fulfilmentSource)};return {${fulfilmentNames}};})();`;
const api=stripExports((await read('server/api.mjs')).replace(/^import .*?;\n/gm,''));
const zipHelper=String.raw`
function sourceZipBytes(){
 const entries={...SOURCE_ENTRIES,'stockiq/data/dmd-catalogue.json':JSON.stringify(localCatalogue),'stockiq/data/dmd-gtin.json':JSON.stringify(localGtinCatalogue)};
 const encoder=new TextEncoder(),parts=[],central=[];let offset=0,count=0;
 const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
 const record=size=>{const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)}};
 for(const [path,text] of Object.entries(entries)){const name=encoder.encode(path),bytes=encoder.encode(text),crc=crc32(bytes),local=record(30),dir=record(46);local.view.setUint32(0,0x04034b50,true);local.view.setUint16(4,20,true);local.view.setUint32(14,crc,true);local.view.setUint32(18,bytes.length,true);local.view.setUint32(22,bytes.length,true);local.view.setUint16(26,name.length,true);parts.push(local.bytes,name,bytes);dir.view.setUint32(0,0x02014b50,true);dir.view.setUint16(4,20,true);dir.view.setUint16(6,20,true);dir.view.setUint32(16,crc,true);dir.view.setUint32(20,bytes.length,true);dir.view.setUint32(24,bytes.length,true);dir.view.setUint16(28,name.length,true);dir.view.setUint32(42,offset,true);central.push(dir.bytes,name);offset+=30+name.length+bytes.length;count++;}
 const directorySize=central.reduce((n,b)=>n+b.length,0),end=record(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,count,true);end.view.setUint16(10,count,true);end.view.setUint32(12,directorySize,true);end.view.setUint32(16,offset,true);const output=new Uint8Array(offset+directorySize+22);let pos=0;for(const bytes of [...parts,...central,end.bytes]){output.set(bytes,pos);pos+=bytes.length;}return output;
}`;
const worker=`const localCatalogue=${JSON.stringify(data)};\nconst localGtinCatalogue=${JSON.stringify(gtinData)};\n${barcode}\n${local}\n${gtin}\n${provider}\n${fulfilment}\n${api}\nconst ASSETS=${JSON.stringify(assets)};\nconst SOURCE_ENTRIES=${JSON.stringify(sourceEntries)};\n${zipHelper}\nexport default {async fetch(request,env,ctx){const path=new URL(request.url).pathname;if(path.startsWith('/api/'))return await handleApi(request,env);if(path==='/source.zip')return new Response(request.method==='HEAD'?null:sourceZipBytes(),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename=stockiq-source.zip','Cache-Control':'no-store'}});const asset=ASSETS[path]||(path.includes('.')?null:ASSETS['/']);if(!asset)return new Response('Not found',{status:404});return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'\"}})}};\n`;
await writeFile(new URL('dist/server/index.js',root),worker);
await writeFile(new URL('dist/.openai/hosting.json',root),await read('.openai/hosting.json'));
console.log(`Built StockIQ Worker: ${(worker.length/1048576).toFixed(2)} MiB raw; ${(gzipSync(worker).length/1048576).toFixed(2)} MiB gzip. NHS dm+d ${data.releaseDate}; ${data.counts?.total||data.counts?.packs||''} packs. Orders remain simulated.`);
