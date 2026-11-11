import test from 'node:test';
import assert from 'node:assert/strict';
import {createSerialScanner} from '../src/serial-scanner.js';

const encoder = new TextEncoder();
const namedError = (name, message = 'private scanner detail') => Object.assign(new Error(message), {name});
const deferred = () => {
 let resolve, reject;
 const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
 return {promise, resolve, reject};
};
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) {
 for (let tries = 0; tries < 100; tries++) { if (check()) return; await tick(); }
 assert.ok(check(), 'condition did not settle');
}
function fakePort({openError, openGate} = {}) {
 let source;
 const port = {
  openCalls: [], closeCalls: 0, cancelCalls: 0, isOpen: false,
  readable: new ReadableStream({start(controller) { source = controller; }, cancel() { port.cancelCalls++; }}),
  async open(options) {
   port.openCalls.push(options);
   if (openGate) await openGate.promise;
   if (openError) throw openError;
   port.isOpen = true;
  },
  async close() { assert.equal(port.readable.locked, false, 'reader lock released before close'); port.closeCalls++; port.isOpen = false; },
  push(value) { source.enqueue(typeof value === 'string' ? encoder.encode(value) : value); },
  end() { source.close(); },
  fail() { source.error(namedError('NetworkError')); },
 };
 return port;
}
class FakeSerial extends EventTarget {
 constructor(select) { super(); this.select = select; this.requests = 0; }
 requestPort(...args) { this.requests++; this.requestArgs = args; return this.select(); }
 disconnect(port) { const event = new Event('disconnect'); Object.defineProperty(event, 'port', {value: port}); this.dispatchEvent(event); }
}
function createHarness(port = fakePort(), options = {}) {
 const frames = [], partials = [], states = [], errors = [];
 const serial = options.serial || new FakeSerial(() => Promise.resolve(port));
 const scanner = createSerialScanner({serial, onFrame: value => frames.push(value), onPartial: value => partials.push(value), onState: value => states.push(value), onError: value => errors.push(value), ...options});
 return {port, frames, partials, states, errors, serial, scanner};
}

test('chooser runs synchronously with no filters and duplicate connect shares ownership', async () => {
 const chosen = deferred(), port = fakePort();
 const h = createHarness(port, {serial: new FakeSerial(() => chosen.promise)});
 const first = h.scanner.connect({baudRate: 115200});
 assert.equal(h.serial.requests, 1, 'requestPort runs before connect returns');
 assert.deepEqual(h.serial.requestArgs, [], 'all ports available for explicit user selection');
 assert.equal(h.scanner.connect(), first);
 assert.equal(h.scanner.state, 'connecting');
 chosen.resolve(port);
 assert.equal(await first, true);
 assert.deepEqual(port.openCalls, [{baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none'}]);
 assert.equal(await h.scanner.connect(), true);
 assert.equal(h.serial.requests, 1);
 await h.scanner.stop();
 assert.equal(port.closeCalls, 1);
 assert.equal(port.cancelCalls, 1);
 assert.equal(h.scanner.state, 'idle');
});

test('split UTF-8, GS1 separators and CR/LF/Tab frames are preserved without duplicates', async () => {
 const h = createHarness(); await h.scanner.connect();
 const gs1 = ']d201050126170097841727022810LOT\x1d21SERIAL';
 h.port.push(gs1.slice(0, 19)); h.port.push(gs1.slice(19)); h.port.push('\r'); h.port.push('\n\t');
 const unicode = encoder.encode('LOT-é\n');
 h.port.push(unicode.slice(0, 5)); h.port.push(unicode.slice(5, 6)); h.port.push(unicode.slice(6));
 h.port.push('123\t456\r\n');
 await until(() => h.frames.length === 4);
 assert.deepEqual(h.frames, [gs1, 'LOT-é', '123', '456']);
 assert.ok(h.frames[0].includes('\x1d'));
 assert.ok(h.partials.includes(''));
 await h.scanner.stop();
});

test('STX starts a fresh frame and ETX terminates without needing newline', async () => {
 const h = createHarness(); await h.scanner.connect();
 h.port.push('stale\x02one\x03\r\n\x02two\x03');
 await until(() => h.frames.length === 2);
 assert.deepEqual(h.frames, ['one', 'two']);
 await h.scanner.stop();
});

test('a partial scan requires explicit flush and discard clears pending data', async () => {
 const h = createHarness(); await h.scanner.connect();
 h.port.push('partial'); await until(() => h.partials.includes('partial'));
 await tick(); assert.deepEqual(h.frames, []);
 assert.equal(h.scanner.flushPending(), true);
 assert.equal(h.scanner.flushPending(), false);
 h.port.push('discard-me'); await until(() => h.partials.includes('discard-me'));
 h.scanner.discardPending();
 assert.equal(h.partials.at(-1), '');
 assert.equal(h.scanner.flushPending(), false);
 h.port.push('complete\n'); await until(() => h.frames.length === 2);
 assert.deepEqual(h.frames, ['partial', 'complete']);
 await h.scanner.stop();
 assert.equal(h.scanner.flushPending(), false);
});

test('overflow drops the whole frame until a terminator and never emits a suffix', async () => {
 const h = createHarness(); await h.scanner.connect();
 h.port.push('A'.repeat(1024)); h.port.push('Bunsafe-suffix');
 await until(() => h.errors.length === 1);
 assert.equal(h.scanner.flushPending(), false);
 h.port.push('more-suffix\r\nvalid\n');
 await until(() => h.frames.length === 1);
 assert.deepEqual(h.frames, ['valid']);
 assert.equal(h.errors[0].code, 'FRAME_TOO_LONG');
 assert.equal(h.scanner.state, 'connected');
 assert.ok(!h.errors[0].message.includes('unsafe'));
 await h.scanner.stop();
});

test('discard until terminator prevents a blocked scan suffix from becoming a new frame', async () => {
 const h = createHarness(); await h.scanner.connect();
 h.port.push('blocked-prefix'); await until(() => h.partials.includes('blocked-prefix'));
 h.scanner.discardPending({untilTerminator: true});
 // Opening and closing another UI must preserve the unfinished-frame boundary.
 h.scanner.discardPending({untilTerminator: true});
 h.port.push('valid-looking-suffix\r\nnext-clean-scan\n');
 await until(() => h.frames.length === 1);
 assert.deepEqual(h.frames, ['next-clean-scan']);
 h.scanner.discardPending({untilTerminator: true});
 h.port.push('another-clean-scan\n');
 await until(() => h.frames.length === 2);
 assert.deepEqual(h.frames, ['next-clean-scan', 'another-clean-scan']);
 await h.scanner.stop();
});

test('stop invalidates queued frames immediately and releases the active reader and port', async () => {
 const h = createHarness(); await h.scanner.connect();
 h.port.push('not-delivered\n');
 const stopping = h.scanner.stop();
 assert.equal(h.scanner.state, 'stopping');
 await stopping;
 assert.deepEqual(h.frames, []);
 assert.equal(h.port.readable.locked, false);
 assert.equal(h.port.closeCalls, 1);
 assert.equal(h.port.cancelCalls, 1);
 await h.scanner.stop(); assert.equal(h.port.closeCalls, 1);
});

test('stop while picker is open prevents any late open and ignores picker rejection', async () => {
 for (const reject of [false, true]) {
  const chosen = deferred(), port = fakePort();
  const h = createHarness(port, {serial: new FakeSerial(() => chosen.promise)});
  const connecting = h.scanner.connect(), stopping = h.scanner.stop();
  assert.equal(await h.scanner.connect(), false, 'cannot start a second chooser while stopping');
  if (reject) chosen.reject(namedError('NotAllowedError')); else chosen.resolve(port);
  await stopping;
  assert.equal(await connecting, false);
  assert.equal(port.openCalls.length, 0); assert.equal(port.closeCalls, 0);
  assert.deepEqual(h.errors, []); assert.equal(h.scanner.state, 'idle');
 }
});

test('stop during pending open closes the port after open finishes without reading', async () => {
 const openGate = deferred(), port = fakePort({openGate});
 const h = createHarness(port), connecting = h.scanner.connect();
 await until(() => port.openCalls.length === 1);
 const stopping = h.scanner.stop();
 openGate.resolve(); await stopping;
 assert.equal(await connecting, false);
 assert.equal(port.isOpen, false); assert.equal(port.closeCalls, 1);
 assert.deepEqual(h.frames, []); assert.equal(port.readable.locked, false);
});

test('stop in connected state callback still cancels and releases a reader not yet reading', async () => {
 const port = fakePort(); let scanner;
 scanner = createSerialScanner({serial: new FakeSerial(() => Promise.resolve(port)), onState: event => { if (event.state === 'connected') void scanner.stop(); }});
 assert.equal(await scanner.connect(), false);
 assert.equal(port.closeCalls, 1); assert.equal(port.cancelCalls, 1);
 assert.equal(port.readable.locked, false);
});

test('permission, chooser cancellation, invalid selection and busy port errors are sanitized', async () => {
 for (const [cause, code, state] of [
  [namedError('NotFoundError'), 'CANCELLED', 'idle'],
  [namedError('AbortError'), 'CANCELLED', 'idle'],
  [namedError('NotAllowedError'), 'PERMISSION_DENIED', 'error'],
  [namedError('SecurityError'), 'PERMISSION_DENIED', 'error'],
 ]) {
  const h = createHarness(undefined, {serial: new FakeSerial(() => Promise.reject(cause))});
  assert.equal(await h.scanner.connect(), false); assert.equal(h.scanner.state, state);
  assert.equal(h.errors[0].code, code); assert.ok(!h.errors[0].message.includes('private'));
 }
 const invalid = createHarness(undefined, {serial: new FakeSerial(() => Promise.resolve(null))});
 assert.equal(await invalid.scanner.connect(), false); assert.equal(invalid.errors[0].code, 'NO_PORT');
 const busy = createHarness(fakePort({openError: namedError('NetworkError')}));
 assert.equal(await busy.scanner.connect(), false); assert.equal(busy.errors[0].code, 'PORT_BUSY');
 assert.match(busy.errors[0].message, /ProScript/); assert.equal(busy.port.closeCalls, 0);
});

test('unsupported browsers and invalid settings do not invoke a chooser', async () => {
 const unsupported = createHarness(undefined, {serial: {}});
 assert.equal(unsupported.scanner.supported, false); assert.equal(await unsupported.scanner.connect(), false);
 assert.equal(unsupported.errors[0].code, 'UNSUPPORTED');
 const h = createHarness();
 assert.equal(await h.scanner.connect({baudRate: -1}), false);
 assert.equal(h.serial.requests, 0); assert.equal(h.errors[0].code, 'INVALID_SETTINGS');
});

test('disconnect only affects the selected port, cancels reading and closes resources', async () => {
 const h = createHarness(); await h.scanner.connect();
 h.serial.disconnect(fakePort()); await tick(); assert.equal(h.scanner.state, 'connected');
 h.serial.disconnect(h.port);
 h.port.push('should-not-read\n');
 await until(() => h.scanner.state === 'error');
 assert.equal(h.errors[0].code, 'DISCONNECTED'); assert.deepEqual(h.frames, []);
 assert.equal(h.port.closeCalls, 1); assert.equal(h.port.readable.locked, false);
});

test('read errors and EOF close resources without emitting incomplete frames', async () => {
 for (const fail of [true, false]) {
  const h = createHarness(); await h.scanner.connect();
  h.port.push('incomplete'); await until(() => h.partials.includes('incomplete'));
  if (fail) h.port.fail(); else h.port.end();
  await until(() => h.scanner.state === 'error');
  assert.equal(h.errors[0].code, fail ? 'READ_FAILED' : 'DISCONNECTED');
  assert.deepEqual(h.frames, []); assert.equal(h.port.closeCalls, 1); assert.equal(h.port.readable.locked, false);
  assert.ok(!h.errors[0].message.includes('private'));
 }
});

test('callbacks may stop or throw without delivering later frames or leaking locks', async () => {
 const port = fakePort(), frames = []; let scanner;
 scanner = createSerialScanner({serial: new FakeSerial(() => Promise.resolve(port)), onFrame(value) { frames.push(value); void scanner.stop(); throw new Error('consumer failure'); }});
 await scanner.connect(); port.push('one\ntwo\n');
 await until(() => scanner.state === 'idle');
 assert.deepEqual(frames, ['one']); assert.equal(port.closeCalls, 1); assert.equal(port.readable.locked, false);
});

test('new sessions cannot inherit pending text or a split UTF-8 decoder from a stopped session', async () => {
 const one = fakePort(), two = fakePort(); let count = 0;
 const h = createHarness(one, {serial: new FakeSerial(() => Promise.resolve(count++ ? two : one))});
 await h.scanner.connect(); one.push('old'); one.push(new Uint8Array([0xc3]));
 await until(() => h.partials.includes('old')); await tick(); await h.scanner.stop();
 await h.scanner.connect(); two.push('new\n');
 await until(() => h.frames.length === 1);
 assert.deepEqual(h.frames, ['new']); assert.deepEqual(h.errors, []);
 await h.scanner.stop(); assert.equal(one.closeCalls, 1); assert.equal(two.closeCalls, 1);
});

test('a failed close never claims an in-use scanner port was released', async () => {
 const h = createHarness();
 h.port.close = async () => { throw namedError('InvalidStateError'); };
 await h.scanner.connect(); await h.scanner.stop();
 assert.equal(h.scanner.state, 'error'); assert.equal(h.errors[0].code, 'CLOSE_FAILED');
 assert.match(h.errors[0].message, /could not confirm/);
 assert.equal(h.port.readable.locked, false);
});
