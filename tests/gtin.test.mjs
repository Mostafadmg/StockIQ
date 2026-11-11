import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lookupDmdGtin,gtinCatalogueStatus} from '../server/gtin.mjs';

test('an exact real EAN resolves to the NHS AMPP pack and preserves its leading zero',async()=>{
 const byEan=await lookupDmdGtin('5037563003235'),byGtin=await lookupDmdGtin('05037563003235');
 assert.deepEqual(byEan,byGtin);assert.equal(byEan.gtin,'05037563003235');assert.equal(byEan.historical,false);assert.equal(byEan.ambiguous,false);
 assert.equal(byEan.matches.length,1);assert.equal(byEan.matches[0].id,'1327911000001107');assert.equal(byEan.matches[0].type,'AMPP');
 assert.match(byEan.matches[0].name,/Verapamil 160mg/);assert.equal(byEan.matches[0].pack,'56 tablet');assert.equal(byEan.source,'NHS dm+d');
 assert.deepEqual(byEan.associations,[{amppId:'1327911000001107',startDate:'2019-03-13',endDate:null,historical:false}]);assert.deepEqual(byEan.warnings,[]);
});

test('ended GTINs identify old shelf packs only with explicit historical dates and warning',async()=>{
 const result=await lookupDmdGtin('00000050065653');assert.equal(result.historical,true);assert.equal(result.ambiguous,false);
 assert.equal(result.matches[0].id,'1482511000001101');assert.equal(result.associations[0].endDate,'2016-04-18');assert.ok(result.warnings.some(message=>message.includes('ended')));
 assert.match(result.matchPolicy,/current associations first/);
});

test('an ambiguous historical GTIN returns every active pack for an explicit choice',async()=>{
 const result=await lookupDmdGtin('00191778018073');assert.equal(result.historical,true);assert.equal(result.ambiguous,true);
 assert.deepEqual(result.matches.map(pack=>pack.id),['36579811000001108','38885911000001100']);assert.equal(result.associations.length,2);
 assert.ok(result.associations.every(association=>association.historical&&association.endDate));
});

test('unknown valid GTINs return no medicine and invalid inputs never produce approximate matches',async()=>{
 const result=await lookupDmdGtin('01234567890128');assert.deepEqual(result.matches,[]);assert.deepEqual(result.associations,[]);assert.equal(result.ambiguous,false);assert.equal(result.historical,false);
 for(const value of ['5037563003236','12345',' 5037563003235','5037563003235 ',5037563003235,null,'<script>'])await assert.rejects(()=>lookupDmdGtin(value),error=>error.status===400);
});

test('GTIN dataset provenance matches the checked-in deterministic data',async()=>{
 const raw=await readFile(new URL('../data/dmd-gtin.json',import.meta.url)),meta=JSON.parse(await readFile(new URL('../data/dmd-gtin-release.json',import.meta.url),'utf8'));
 assert.equal(createHash('sha256').update(raw).digest('hex'),meta.contentChecksum);assert.equal(meta.datasetBytes,raw.length);
 const status=gtinCatalogueStatus();assert.equal(status.releaseDate,'2026-11-09');assert.equal(status.gtinReleaseDate,'2026-11-05');assert.equal(status.counts.gtins,72882);assert.equal(status.counts.currentGtins,63228);assert.equal(status.counts.historicalGtins,9654);
 assert.match(meta.sourceFileSha256,/^[a-f0-9]{64}$/);assert.match(meta.lookupPolicy,/all ambiguous matches returned/);
});

test('the offline extractor prefers current mappings, excludes inactive/future records, and deduplicates EAN aliases',()=>{
 const script=new URL('../scripts/prepare-gtin.py',import.meta.url).pathname;
 const python=String.raw`import importlib.util,json,sys,xml.etree.ElementTree as ET
spec=importlib.util.spec_from_file_location('prepare_gtin',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
root=ET.fromstring('''<AMPPS>
<AMPP><AMPPID>1327911000001107</AMPPID><GTINDATA><GTIN>5037563003235</GTIN><STARTDT>2019-03-13</STARTDT></GTINDATA><GTINDATA><GTIN>05037563003235</GTIN><STARTDT>2020-01-01</STARTDT></GTINDATA></AMPP>
<AMPP><AMPPID>1328111000001105</AMPPID><GTINDATA><GTIN>5037563003235</GTIN><STARTDT>2010-01-01</STARTDT><ENDDT>2018-12-31</ENDDT></GTINDATA><GTINDATA><GTIN>5012617009784</GTIN><STARTDT>2027-01-01</STARTDT></GTINDATA></AMPP>
<AMPP><AMPPID>9999911000001105</AMPPID><GTINDATA><GTIN>5037563003235</GTIN><STARTDT>2020-01-01</STARTDT></GTINDATA></AMPP>
<AMPP><AMPPID>1482511000001101</AMPPID><GTINDATA><GTIN>00000050065653</GTIN><STARTDT>2013-07-11</STARTDT><ENDDT>2016-04-18</ENDDT></GTINDATA></AMPP>
</AMPPS>''')
index,counts=module.collect_associations(root.findall('AMPP'),{'1327911000001107','1328111000001105','1482511000001101'},'2026-11-09')
print(json.dumps({'index':index,'counts':counts}))`;
 const result=JSON.parse(execFileSync('python',['-c',python,script],{encoding:'utf8'}));
 assert.deepEqual(result.index['05037563003235'],[0,[['1327911000001107','2020-01-01',null]]]);
 assert.deepEqual(result.index['00000050065653'],[1,[['1482511000001101','2013-07-11','2016-04-18']]]);
 assert.equal(result.index['05012617009784'],undefined);assert.equal(result.counts.excludedInactivePackAssociations,1);assert.equal(result.counts.excludedFutureAssociations,1);assert.equal(result.counts.gtins,2);
});
