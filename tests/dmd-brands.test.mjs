import test from 'node:test';
import assert from 'node:assert/strict';
import {getDmdBrands,getDmdPacks} from '../server/dmd.mjs';
import {handleApi,seedWorkspace} from '../server/api.mjs';

const generic={id:'200001',type:'VMPP',name:'Example 10mg tablets 28 tablet',pack:'28 tablet',quantity:28,unit:'tablet',parentId:'300001',genericId:'300001',genericMedicineId:'300001',genericName:'Example 10mg tablets',releaseDate:'2026-11-09'};
const selected={...generic,id:'100001',type:'AMPP',name:'Example 10mg tablets (First Manufacturer) 28 tablet',parentId:'400001',genericId:generic.id,manufacturer:'First Manufacturer'};
const other={...selected,id:'100002',parentId:'400002',name:'Brand Example tablets (Other Manufacturer) 28 tablet',brand:'Brand Example',manufacturer:'Other Manufacturer'};
const fixtures=[selected,generic,other,
 {...other,id:'100003',genericId:'200002',name:'Example 20mg tablets 28 tablet',genericName:'Example 20mg tablets'},
 {...other,id:'100004',genericId:'200003',name:'Example 10mg tablets 56 tablet',pack:'56 tablet',quantity:56},
 {...other,id:'100005',genericId:'200004',name:'Example 10mg capsules 28 capsule',genericName:'Example 10mg capsules',pack:'28 capsule',unit:'capsule'},
 {...other,id:'100006',genericId:'200005',genericMedicineId:'300002',name:'Unrelated medicine 10mg tablets 28 tablet'},
 {...other,id:'100007',genericId:generic.genericId,name:'Medicine-level relation is not a pack-level relation'},
];

test('brand families use only the exact VMPP relation and preserve the selected actual or generic pack first',async()=>{
 const env={DMD_DATA:fixtures},before=structuredClone(fixtures);
 const actual=await getDmdBrands(selected.id,'AMPP',env),virtual=await getDmdBrands(generic.id,'VMPP',env);
 assert.deepEqual(actual.packs.map(pack=>pack.id),[selected.id,generic.id,other.id]);
 assert.deepEqual(virtual.packs.map(pack=>pack.id),[generic.id,other.id,selected.id]);
 for(const result of [actual,virtual]){
  assert.equal(result.total,3);assert.equal(result.truncated,false);assert.equal(result.selectionPolicy,'same-vmpp');assert.equal(result.source,'NHS dm+d');assert.equal(result.releaseDate,'2026-11-09');
  assert.ok(result.packs.every(pack=>pack.id===generic.id||pack.genericId===generic.id));
 }
 const branded=actual.packs.find(pack=>pack.id===other.id);assert.equal(branded.brand,other.brand);assert.equal(branded.manufacturer,other.manufacturer);assert.equal(branded.genericMedicineId,generic.genericMedicineId);assert.equal(branded.parentId,other.parentId);
 assert.deepEqual(fixtures,before,'Reference lookup cannot mutate its fixture catalogue');
 assert.deepEqual((await getDmdPacks(selected.id,'AMPP',env)).packs,[{...selected,source:'NHS dm+d'}],'The original pack lookup remains a single selected pack');
});

test('missing pack relations never fall back to medicine identity or similar names',async()=>{
 const unrelated={...selected,genericId:undefined},env={DMD_DATA:[unrelated,generic,other]},result=await getDmdBrands(unrelated.id,'AMPP',env);
 assert.deepEqual(result.packs.map(pack=>pack.id),[unrelated.id]);assert.equal(result.total,1);assert.equal(result.truncated,false);
 const withoutVirtual={DMD_DATA:[selected,other]};assert.deepEqual((await getDmdBrands(selected.id,'AMPP',withoutVirtual)).packs.map(pack=>pack.id),[selected.id,other.id]);
});

test('large exact families are bounded, disclose the complete count and always retain the selected pack',async()=>{
 const alternatives=Array.from({length:70},(_,index)=>({...other,id:String(110000+index),name:`Example ${index} (Manufacturer) 28 tablet`}));
 const chosen=alternatives.at(-1),result=await getDmdBrands(chosen.id,'AMPP',{DMD_DATA:[generic,...alternatives]});
 assert.equal(result.packs.length,60);assert.equal(result.total,71);assert.equal(result.truncated,true);assert.equal(result.packs[0].id,chosen.id);assert.equal(new Set(result.packs.map(pack=>pack.type+':'+pack.id)).size,60);
});

test('real branded and generic pack families resolve across shards without upstream requests',async()=>{
 const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Brand-family lookup attempted an upstream request');};
 try{
  const branded=await getDmdBrands('43647111000001105','AMPP');
  assert.equal(branded.packs[0].brand,'Augmentin 125/31 oral suspension');assert.equal(branded.total,9);assert.equal(branded.truncated,false);
  assert.ok(branded.packs.every(pack=>pack.type==='VMPP'?pack.id==='7320011000001105':pack.genericId==='7320011000001105'));
  assert.ok(branded.packs.some(pack=>pack.name.startsWith('Co-amoxiclav')&&pack.manufacturer==='Sandoz Ltd'));
  assert.ok(branded.packs.every(pack=>pack.pack==='100 ml'&&pack.quantity===100&&pack.unit==='ml'));assert.ok(branded.packs.every(pack=>!Object.hasOwn(pack,'unitPrice')&&!Object.hasOwn(pack,'supplier')));
  const actual=await getDmdBrands('1477411000001105','AMPP'),virtual=await getDmdBrands('1049611000001109','VMPP');
  assert.equal(actual.packs[0].id,'1477411000001105');assert.equal(virtual.packs[0].id,'1049611000001109');assert.equal(actual.total,6);assert.deepEqual(new Set(actual.packs.map(pack=>pack.id)),new Set(virtual.packs.map(pack=>pack.id)));
  assert.ok(actual.packs.every(pack=>pack.pack==='100 capsule'&&pack.quantity===100&&pack.genericMedicineId==='39732411000001106'));
 }finally{globalThis.fetch=originalFetch;}
});

test('brand API is read-only in direct and stateless sessions and rejects invalid selections',async()=>{
 const id='brands-'+crypto.randomUUID(),env={DMD_DATA:fixtures},base='https://brands.test';
 const request=async(method,path,data)=>{const response=await handleApi(new Request(base+path,{method,headers:{'content-type':'application/json','x-workspace-id':id},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);return {status:response.status,...await response.json()};};
 const initialized=await request('POST','/api/workspaces',{id,workspace:seedWorkspace()}),before=structuredClone(initialized.workspace);
 const direct=await request('GET',`/api/dmd/brands?id=${selected.id}&type=AMPP`);assert.equal(direct.status,200);assert.equal(direct.data.packs[0].id,selected.id);assert.deepEqual(direct.workspace,before);
 const stateless=await request('POST','/api/dispatch',{id:'brands-stateless-'+crypto.randomUUID(),workspace:before,method:'GET',path:`/api/dmd/brands?id=${generic.id}&type=VMPP`});assert.equal(stateless.status,200);assert.equal(stateless.data.packs[0].id,generic.id);assert.deepEqual(stateless.workspace,before);
 for(const query of ['id=100001&type=AMP','id=100001&type=SAMPLE','id=000001&type=AMPP','id=bad&type=AMPP','id=100001','type=AMPP',`id=${'a'.repeat(32)}&type=TARIFF`])assert.equal((await request('GET','/api/dmd/brands?'+query)).status,400,query);
 assert.equal((await request('GET','/api/dmd/brands?id=999999&type=AMPP')).status,404);assert.deepEqual((await request('GET','/api/workspace')).workspace,before);
});
