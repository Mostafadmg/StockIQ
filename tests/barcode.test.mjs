import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGtin,parseMedicineBarcode} from '../src/barcode.js';
const gs='\x1d',gtin='05012617009784',now=new Date('2026-11-11T12:00:00Z');
const parse=raw=>parseMedicineBarcode(raw,{now});
const invalid=raw=>assert.throws(()=>parse(raw),error=>error.code==='INVALID_BARCODE'&&error.status===400);

test('EAN, UPC and GTIN check digits are validated and leading zeroes remain strings',()=>{
 assert.equal(normalizeGtin('5012617009784'),gtin);assert.equal(normalizeGtin(gtin),gtin);assert.equal(normalizeGtin('96385074'),'00000096385074');assert.equal(normalizeGtin('036000291452'),'00036000291452');
 for(const raw of ['5012617009785','501261700978','123456789','1477411000001105',5012617009784,'５０１２６１７００９７８４',' 5012617009784','00000000000001','00000000000000'])assert.throws(()=>normalizeGtin(raw),/barcode|GTIN|digits/i);
 const result=parse(']E05012617009784\r\n');assert.equal(result.gtin,gtin);assert.equal(result.format,'ean');assert.equal(result.expiry,null);assert.equal(result.batch,null);assert.ok(!Object.hasOwn(result,'raw'));
});

test('GS1 DataMatrix and Code128 extract GTIN, expiry, batch and serial with FNC1',()=>{
 for(const prefix of [']d2',']C1',']Q3','']){
  const result=parse(prefix+'01'+gtin+'1727022810LOT-42'+gs+'21SERIAL-009\r\n');
  assert.equal(result.gtin,gtin);assert.equal(result.format,'gs1');assert.equal(result.expiry,'2027-02-28');assert.equal(result.expiryRaw,'270228');assert.equal(result.batch,'LOT-42');assert.equal(result.serial,'SERIAL-009');assert.equal(result.requiresPackConfirmation,false);assert.deepEqual(result.warnings,[]);
 }
});

test('parenthesized and scanner-visible GS separator aliases preserve field boundaries',()=>{
 const hri=parse('(01)'+gtin+'(17)280200(10) LOT B (21)ABC');assert.equal(hri.expiry,'2028-02-29');assert.equal(hri.batch,'LOT B');assert.equal(hri.serial,'ABC');
 assert.equal(parse('(01)'+gtin+'(10)LOT'+gs+'(17)280200').expiry,'2028-02-29');
 for(const separator of ['<GS>','[GS]','{GS}','␝','↔']){const result=parse(']d201'+gtin+'10B123'+separator+'17260200');assert.equal(result.batch,'B123');assert.equal(result.expiry,'2026-02-28');}
});

test('expiry century follows Mellonsdaily rolling fifty-year window with strict leap-day checks',()=>{
 assert.equal(parse('(01)'+gtin+'(17)760100').expiry,'1976-01-31');assert.equal(parse('(01)'+gtin+'(17)750100').expiry,'2075-01-31');
 assert.equal(parseMedicineBarcode('(01)'+gtin+'(17)000200',{now:new Date('2090-01-01Z')}).expiry,'2100-02-28');
 assert.equal(parse('(01)'+gtin+'(17)280229').expiry,'2028-02-29');
 for(const expiry of ['270229','271301','270001','270232'])invalid('(01)'+gtin+'(17)'+expiry);
});

test('variable fields are never split by guessing application identifiers inside a batch or serial',()=>{
 const result=parse('01'+gtin+'10LOT17271231');assert.equal(result.batch,'LOT17271231');assert.equal(result.expiry,null);assert.deepEqual(result.warnings,['No expiry was separated from the batch or serial field. Check the pack; an expiry date was not inferred.']);assert.equal(result.requiresPackConfirmation,false);
 const serialExpiry=parse('01'+gtin+'21SER17271231');assert.equal(serialExpiry.serial,'SER17271231');assert.equal(serialExpiry.expiry,null);assert.equal(serialExpiry.warnings.length,1);
 const serial=parse('01'+gtin+'21SER171231');assert.equal(serial.serial,'SER171231');assert.equal(serial.expiry,null);
 invalid('01'+gtin+'10'+'A'.repeat(21)+'17271231');invalid('01'+gtin+'10LOT'+gs+gs+'17271231');
});

test('contained-item GTINs require explicit pack confirmation and never infer order quantities',()=>{
 const result=parse('(02)'+gtin+'(37)12(17)271200');assert.equal(result.gtin,gtin);assert.equal(result.containedCount,12);assert.equal(result.requiresPackConfirmation,true);assert.equal(result.warnings.length,2);
 const same=parse('(01)'+gtin+'(02)'+gtin);assert.equal(same.requiresPackConfirmation,false);
 invalid('(01)'+gtin+'(02)00036000291452');invalid('(01)'+gtin+'(37)2');invalid('(02)'+gtin+'(37)00000000');
});

test('unsupported, malformed and truncated scans fail without returning guessed identities',()=>{
 for(const raw of ['',null,123,'x'.repeat(1025),'https://example.test/01/'+gtin,']Z901'+gtin,']d2'+gtin,'01'+gtin.slice(1),'01'+gtin+'17'+ '2702','01'+gtin+'99ABC','(01)'+gtin+'(01)'+gtin,'(01)'+gtin+'(17)270200extra','(01)'+gtin+'(10)','(01)'+gtin+'(10)ABC(17','17'+'270200','01'+gtin+'10LOT\x00'])invalid(raw);
});
