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
 '/views.css':{type:'text/css; charset=utf-8',body:await read('src/views.css')},
 '/views.js':{type:'text/javascript; charset=utf-8',body:await read('src/views.js')},
 '/favicon.svg':{type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" rx="13" fill="#242231"/><path d="M13 28h7V16h7v16h7" stroke="#b69aff" stroke-width="5" fill="none"/><circle cx="32" cy="15" r="4" fill="#81dcc0"/></svg>'},
 '/api-reference.json':{type:'application/json',body:await read('docs/api-reference.json')}
};
const api=(await read('server/api.mjs')).replace(/export\s+(?=(?:async\s+)?function|const |let |class )/g,'');
const worker=`${api}\nconst ASSETS=${JSON.stringify(assets)};\nexport default {async fetch(request,env,ctx){const path=new URL(request.url).pathname;if(path.startsWith('/api/'))return await handleApi(request);const asset=ASSETS[path]||(path.includes('.')?null:ASSETS['/']);if(!asset)return new Response('Not found',{status:404});return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'\"}})}};\n`;
await writeFile(new URL('dist/server/index.js',root),worker);
await writeFile(new URL('dist/.openai/hosting.json',root),await read('.openai/hosting.json'));
console.log('Built StockIQ Worker and embedded assets; no production integrations.');
