import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');
await rm(new URL('dist',root),{recursive:true,force:true});
await mkdir(new URL('dist/server',root),{recursive:true});
await mkdir(new URL('dist/.openai',root),{recursive:true});
const assets={
 '/':{type:'text/html; charset=utf-8',body:await read('src/index.html')},
 '/styles.css':{type:'text/css; charset=utf-8',body:await read('src/styles.css')},
 '/app.js':{type:'text/javascript; charset=utf-8',body:await read('src/app.js')},
 '/manual-search.js':{type:'text/javascript; charset=utf-8',body:await read('src/manual-search.js')},
 '/manual-search.css':{type:'text/css; charset=utf-8',body:await read('src/manual-search.css')},
 '/views.css':{type:'text/css; charset=utf-8',body:await read('src/views.css')},
 '/views.js':{type:'text/javascript; charset=utf-8',body:await read('src/views.js')},
 '/favicon.svg':{type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" rx="13" fill="#242231"/><path d="M13 28h7V16h7v16h7" stroke="#b69aff" stroke-width="5" fill="none"/><circle cx="32" cy="15" r="4" fill="#81dcc0"/></svg>'},
 '/api-reference.json':{type:'application/json',body:await read('docs/api-reference.json')}
};
// A portable ZIP download containing authored source only (no browser state or credentials).
const sourceFiles=['.gitignore','.openai/hosting.json','README.md','package.json','scripts/build.mjs','server/api.mjs','server/dmd.mjs','server/local.mjs','src/index.html','src/app.js','src/manual-search.js','src/manual-search.css','src/views.js','src/styles.css','src/views.css','docs/api-reference.json','docs/feature-coverage.md','tests/api.test.mjs','tests/views.test.mjs','tests/worker.test.mjs','tests/catalogue.test.mjs','tests/manual-search.test.mjs'];
const localParts=[],centralParts=[];let offset=0;
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
for(const file of sourceFiles){const name=Buffer.from('stockiq/'+file),data=Buffer.from(await read(file)),crc=crc32(data);const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);localParts.push(local,name,data);const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);centralParts.push(central,name);offset+=local.length+name.length+data.length;}
const central=Buffer.concat(centralParts),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(sourceFiles.length,8);end.writeUInt16LE(sourceFiles.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
assets['/source.zip']={type:'application/zip',base64:Buffer.concat([...localParts,central,end]).toString('base64')};
const provider=(await read('server/dmd.mjs')).replace(/export\s+(?=(?:async\s+)?function|const |let |class )/g,'');
const api=(await read('server/api.mjs')).replace(/^import .*from '\.\/dmd\.mjs';\n/m,'').replace(/export\s+(?=(?:async\s+)?function|const |let |class )/g,'');
const worker=`${provider}\n${api}\nconst ASSETS=${JSON.stringify(assets)};\nexport default {async fetch(request,env,ctx){const path=new URL(request.url).pathname;if(path.startsWith('/api/'))return await handleApi(request,env);const asset=ASSETS[path]||(path.includes('.')?null:ASSETS['/']);if(!asset)return new Response('Not found',{status:404});return new Response(request.method==='HEAD'?null:asset.base64?Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0)):asset.body,{headers:{'Content-Type':asset.type,...(asset.base64?{'Content-Disposition':'attachment; filename=stockiq-source.zip'}:{}),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'\"}})}};\n`;
await writeFile(new URL('dist/server/index.js',root),worker);
await writeFile(new URL('dist/.openai/hosting.json',root),await read('.openai/hosting.json'));
console.log('Built StockIQ Worker and embedded assets; read-only catalogue adapter; ordering stays simulated.');
