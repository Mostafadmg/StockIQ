import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryStatus} from '../src/delivery-status.js';

const estimate={estimatedArrivalAt:'2026-11-12T09:00:00Z',workingDays:1};

test('same-day and next-working-day dated estimates are green',()=>{
  assert.equal(deliveryStatus(estimate).tone,'green');
  assert.equal(deliveryStatus(estimate).label,'Next working day');
  assert.equal(deliveryStatus({...estimate,workingDays:0}).label,'Same day');
  assert.equal(deliveryStatus({...estimate,workingDays:0}).tone,'green');
  assert.equal(deliveryStatus({...estimate,depot:'Cardiff'}).label,'Cardiff · next working day');
  assert.equal(deliveryStatus(estimate).isEstimate,true);
});

test('longer routes are yellow and explicit Birmingham depot takes priority',()=>{
  assert.equal(deliveryStatus({...estimate,workingDays:2}).tone,'yellow');
  assert.equal(deliveryStatus({...estimate,workingDays:3}).label,'3 working days');
  const birmingham=deliveryStatus({...estimate,depot:'  Birmingham  '});
  assert.equal(birmingham.tone,'yellow');assert.equal(birmingham.label,'Birmingham · next working day');assert.equal(birmingham.depot,'Birmingham');
  assert.equal(deliveryStatus({...estimate,depot:'bIRmiNGHam',workingDays:2}).tone,'yellow');
  assert.equal(deliveryStatus({...estimate,depot:'Birmingham',workingDays:2}).label,'Birmingham · 2 working days');
  for(const depot of ['Birmingham depot','Birmingham DC'])assert.equal(deliveryStatus({...estimate,depot}).tone,'yellow');
  assert.equal(deliveryStatus({...estimate,depot:'Birminghamshire'}).tone,'green');
  assert.equal(deliveryStatus({...estimate,sourceLabel:'Birmingham',supplier:'Birmingham'}).tone,'green','Supplier names are not depot evidence');
});

test('unknown working days and missing or invalid arrival times stay neutral',()=>{
  for(const workingDays of [null,undefined,'',false,'1',-1,1.5,NaN,Infinity])assert.equal(deliveryStatus({...estimate,workingDays}).tone,'neutral');
  for(const estimatedArrivalAt of [null,undefined,'',0,'tomorrow','2026-11-12','2026-02-30T09:00:00Z','2026-11-12T24:00:00Z','2026-11-12T09:00:00+99:00'])assert.equal(deliveryStatus({...estimate,estimatedArrivalAt}).tone,'neutral');
  assert.equal(deliveryStatus({...estimate,estimatedArrivalAt:null,depot:'Birmingham'}).tone,'neutral','A depot cannot turn a missing ETA into a dated estimate');
  assert.equal(deliveryStatus({...estimate,workingDays:null,depot:'Birmingham'}).label,'Birmingham · estimate unavailable');
  assert.equal(deliveryStatus(null).tone,'neutral');
});

test('zero accepted packs never advertise delivery or a depot',()=>{
  assert.deepEqual(deliveryStatus({...estimate,depot:'Birmingham'},{acceptedQuantity:0}),{tone:'neutral',label:'No delivery',isEstimate:false});
  for(const acceptedQuantity of [null,'0',-1,0.5,NaN])assert.equal(deliveryStatus(estimate,{acceptedQuantity}).tone,'neutral');
});
