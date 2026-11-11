/** Read-only Web Serial transport for a scanner selected by the user. */
export function createSerialScanner({
 serial = globalThis.navigator?.serial,
 onFrame = () => {},
 onPartial = () => {},
 onState = () => {},
 onError = () => {},
 maxLength = 1024,
 stxEtx = true,
} = {}) {
 const limit = Number.isInteger(maxLength) && maxLength > 0 ? Math.min(maxLength, 1024) : 1024;
 let current = null;
 let state = 'idle';
 const supported = Boolean(serial && typeof serial.requestPort === 'function');
 const call = (callback, value) => {
  // Consumer callbacks must not interrupt reader cleanup or create unhandled rejections.
  try { const result = callback(value); if (result?.then) Promise.resolve(result).catch(() => {}); } catch {}
 };
 const changeState = (next, message) => { state = next; call(onState, {state: next, message}); };
 const error = (code, message) => Object.assign(new Error(message), {code});
 const live = session => current === session && !session.cancelled;
 const decoder = () => new TextDecoder('utf-8', {fatal: true});
 const clearPending = (session, notify = false) => {
  const changed = session.pending.length > 0 || session.dropping;
  session.pending = '';
  session.dropping = false;
  if (notify && changed && live(session)) call(onPartial, '');
 };
 const selectedError = cause => {
  if (cause?.name === 'NotFoundError' || cause?.name === 'AbortError') return error('CANCELLED', 'No scanner was selected. You can try connecting again.');
  if (cause?.name === 'NotAllowedError' || cause?.name === 'SecurityError') return error('PERMISSION_DENIED', 'Scanner access was not allowed. Allow access in the browser and try again.');
  return error('SELECT_FAILED', 'The browser could not select a scanner. Check its connection and try again.');
 };
 const openError = cause => {
  if (cause?.name === 'NotAllowedError' || cause?.name === 'SecurityError') return error('PERMISSION_DENIED', 'Scanner access was not allowed. Allow access in the browser and try again.');
  return error('PORT_BUSY', 'The scanner port could not be opened. ProScript or another application may be using it. Release it there, then try again.');
 };
 const emitFrame = session => {
  if (!live(session) || session.dropping || !session.pending) return false;
  const value = session.pending;
  session.pending = '';
  call(onPartial, '');
  if (!live(session)) return false;
  call(onFrame, value);
  return true;
 };
 const receive = (session, text) => {
  for (const character of text) {
   if (!live(session)) return;
   const terminator = character === '\r' || character === '\n' || character === '\t' || (stxEtx && character === '\x03');
   if (terminator) {
    if (session.dropping) clearPending(session, true);
    else emitFrame(session);
    continue;
   }
   if (session.dropping) continue;
   if (stxEtx && character === '\x02') { clearPending(session, true); continue; }
   if (session.pending.length + character.length > limit) {
    session.pending = '';
    session.dropping = true;
    call(onPartial, '');
    if (live(session)) call(onError, error('FRAME_TOO_LONG', 'The scanned barcode was too long. Scan the medicine pack again.'));
    continue;
   }
   // GS (ASCII 29) is part of GS1 data, not a frame separator.
   session.pending += character;
  }
  if (live(session) && session.pending) call(onPartial, session.pending);
 };
 const cleanup = session => {
  if (!session.cleanupPromise) session.cleanupPromise = (async () => {
   await session.setupPromise;
   const reader = session.reader;
   if (reader) { try { await reader.cancel(); } catch {} }
   if (session.readPromise) await session.readPromise;
   // stop() may run from onState before the read loop has started.
   if (reader) { try { reader.releaseLock(); } catch {} }
   if (session.disconnectListener && typeof serial?.removeEventListener === 'function') serial.removeEventListener('disconnect', session.disconnectListener);
   clearPending(session);
   session.decoder = decoder();
   if (session.opened) {
    try { await session.port.close(); }
    catch (cause) {
     // A physically disconnected port may already have been closed by the browser.
     if (!session.disconnected) return error('CLOSE_FAILED', 'The browser could not confirm the scanner port closed. Close this browser tab before reconnecting.');
    }
    session.opened = false;
   }
   return null;
  })();
  return session.cleanupPromise;
 };
 const finish = session => {
  if (!session.finishPromise) session.finishPromise = (async () => {
   const closeError = await cleanup(session);
   if (current !== session) return;
   current = null;
   const failure = closeError || session.failure;
   if (failure) {
    changeState(failure.code === 'CANCELLED' ? 'idle' : 'error', failure.message);
    call(onError, failure);
   } else changeState('idle', 'Scanner disconnected. The port is released for another application.');
  })();
  return session.finishPromise;
 };
 const read = async session => {
  try {
   while (live(session)) {
    const {value, done} = await session.reader.read();
    if (!live(session)) break;
    if (done) {
     session.failure = error('DISCONNECTED', 'The scanner connection ended. Reconnect when the scanner is available.');
     break;
    }
    if (value?.byteLength) receive(session, session.decoder.decode(value, {stream: true}));
   }
  } catch {
   if (live(session)) session.failure = error('READ_FAILED', 'The scanner connection was interrupted. Reconnect when the scanner is available.');
  }
 };
 const optionsFor = options => {
  const value = {baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', ...options};
  if (!Number.isInteger(value.baudRate) || value.baudRate <= 0 || ![7, 8].includes(value.dataBits) || ![1, 2].includes(value.stopBits) || !['none', 'even', 'odd'].includes(value.parity) || !['none', 'hardware'].includes(value.flowControl)) return null;
  return {baudRate: value.baudRate, dataBits: value.dataBits, stopBits: value.stopBits, parity: value.parity, flowControl: value.flowControl};
 };
 function connect(options = {}) {
  if (current) return current.cancelled ? Promise.resolve(false) : current.connectPromise;
  if (!supported) {
   const failure = error('UNSUPPORTED', 'USB scanner connection needs desktop Chrome or Edge over HTTPS. Use keyboard scanning if your scanner supports it.');
   changeState('error', failure.message); call(onError, failure); return Promise.resolve(false);
  }
  const settings = optionsFor(options);
  if (!settings) {
   const failure = error('INVALID_SETTINGS', 'Choose valid serial connection settings, then try again.');
   changeState('error', failure.message); call(onError, failure); return Promise.resolve(false);
  }
  let resolveSetup, resolveConnect;
  const session = {cancelled: false, pending: '', dropping: false, decoder: decoder(), port: null, opened: false, reader: null, failure: null};
  session.setupPromise = new Promise(resolve => { resolveSetup = resolve; });
  session.connectPromise = new Promise(resolve => { resolveConnect = resolve; });
  current = session;
  changeState('connecting', 'Choose the Newland scanner in the browser connection window.');
  let selection;
  if (!session.cancelled) {
   // Keep the chooser in the original click's call stack. Do not await before this call.
   try { selection = serial.requestPort(); }
   catch (cause) { selection = Promise.reject(cause); }
  }
  const setup = async () => {
   let phase = 'select';
   try {
    if (session.cancelled) return false;
    session.port = await selection;
    if (!live(session)) return false;
    if (!session.port || typeof session.port.open !== 'function') {
     session.failure = error('NO_PORT', 'No usable scanner port was selected. Reconnect the scanner and try again.');
     return false;
    }
    phase = 'open';
    if (typeof serial.addEventListener === 'function') {
     session.disconnectListener = event => {
      if (!live(session) || (event.target !== session.port && event.port !== session.port)) return;
      session.disconnected = true;
      session.failure = error('DISCONNECTED', 'The scanner was disconnected. Reconnect it and choose the scanner again.');
      session.cancelled = true;
      void finish(session);
     };
     serial.addEventListener('disconnect', session.disconnectListener);
    }
    await session.port.open(settings);
    session.opened = true;
    if (!live(session)) return false;
    if (!session.port.readable) {
     session.failure = error('NO_READABLE_PORT', 'This port cannot provide scanner data. Select the scanner port and try again.');
     return false;
    }
    session.reader = session.port.readable.getReader();
    changeState('connected', 'Ready to scan. Cancel releases the browser connection.');
    if (!live(session)) return false;
    session.readPromise = read(session);
    session.readPromise.then(() => {
     if (live(session)) session.cancelled = true;
     void finish(session);
    });
    return true;
   } catch (cause) {
    if (!session.cancelled) session.failure = phase === 'select' ? selectedError(cause) : openError(cause);
    return false;
   } finally { resolveSetup(); }
  };
  void setup().then(async connected => {
   if (!connected || !live(session)) { await finish(session); resolveConnect(false); }
   else resolveConnect(true);
  });
  return session.connectPromise;
 }
 function stop() {
  const session = current;
  if (!session) {
   if (state !== 'idle') changeState('idle', 'Scanner disconnected.');
   return Promise.resolve();
  }
  session.cancelled = true;
  session.failure = null;
  clearPending(session);
  changeState('stopping', 'Releasing the scanner connection.');
  return finish(session);
 }
 return {
  connect,
  stop,
  flushPending() { return current && live(current) && state === 'connected' ? emitFrame(current) : false; },
  discardPending({untilTerminator = false} = {}) {
   if (!current || !live(current)) return;
   const changed = current.pending.length > 0;
   const dropping = current.dropping;
   current.decoder = decoder();
   current.pending = '';
   current.dropping = Boolean(untilTerminator && (changed || dropping));
   if (changed) call(onPartial, '');
  },
  get state() { return state; },
  get supported() { return supported; },
 };
}
