'use strict';
const assert = require('node:assert/strict');
const PinballHaptics = require('./dist/haptics.js');

function fixture(overrides = {}) {
  let time = 0;
  const calls = [];
  const document = { hidden: false };
  const navigator = { userActivation: { hasBeenActive: true }, vibrate(pattern) { calls.push(pattern); return true; } };
  const feedback = new PinballHaptics({ navigator, document, now: () => time, ...overrides });
  return { feedback, calls, document, navigator, advance(ms = 100) { time += ms; } };
}

// Pulling crosses discrete detents; a stationary handle never buzzes forever.
const pull = fixture();
assert.equal(pull.feedback.beginCharge(), true);
assert.deepEqual(pull.calls, [5]);
assert.equal(pull.feedback.pull(0.25), false, 'one pulse at most every 60 ms');
pull.advance(60);
assert.equal(pull.feedback.pull(0.25), true);
pull.advance();
assert.equal(pull.feedback.pull(0.25), false);
assert.equal(pull.feedback.pull(0.5), true);
pull.advance();
assert.equal(pull.feedback.pull(1), true);
assert.deepEqual(pull.calls, [5, 5, 9, 14]);
pull.advance();
assert.equal(pull.feedback.pull(0.3), false);
assert.equal(pull.feedback.pull(1), false, 'jitter below a crossed notch does not retrigger it');
pull.feedback.stop();
assert.equal(pull.calls.at(-1), 0);
assert.equal(pull.feedback.pull(1), false);

// Release replaces the pull with a stronger pulse, scaled by launch power.
for (const [power, duration] of [[0, 12], [0.5, 24], [1, 40]]) {
  const sample = fixture();
  sample.feedback.beginCharge();
  sample.feedback.stop();
  assert.equal(sample.feedback.launch(power), true);
  assert.equal(sample.calls.at(-1), duration);
}

// Collision strength comes from incoming speed; contacts are rate-limited.
const hits = fixture();
assert.equal(hits.feedback.impact(27), false);
assert.equal(hits.feedback.impact(100), true);
hits.advance(60);
assert.equal(hits.feedback.impact(300), false, 'collision feedback waits 85 ms');
hits.advance(25);
assert.equal(hits.feedback.impact(300), true);
hits.advance(85);
assert.equal(hits.feedback.impact(700), true);
assert.deepEqual(hits.calls, [8, 18, [25, 12, 15]]);
assert.equal(hits.feedback.impact(NaN), false);

// Do not vibrate before real activation, while hidden, or after being disabled.
const gated = fixture();
gated.navigator.userActivation.hasBeenActive = false;
assert.equal(gated.feedback.beginCharge(), false);
assert.equal(gated.feedback.preview(), false);
assert.equal(gated.calls.length, 0);
gated.navigator.userActivation.hasBeenActive = true;
assert.equal(gated.feedback.beginCharge(), true);
gated.advance();
gated.document.hidden = true;
assert.equal(gated.feedback.impact(700), false);
gated.document.hidden = false;
gated.feedback.setEnabled(false);
assert.equal(gated.calls.at(-1), 0, 'turning off cancels any active pattern');
gated.advance();
const stoppedCount = gated.calls.length;
assert.equal(gated.feedback.beginCharge(), false);
assert.equal(gated.feedback.pull(1), false);
assert.equal(gated.feedback.launch(1), false);
assert.equal(gated.feedback.impact(700), false);
assert.equal(gated.calls.length, stoppedCount);
gated.feedback.setEnabled(true);
assert.equal(gated.feedback.preview(), true);

// Older browsers without activation metadata unlock only via a gesture entry.
const older = fixture({ navigator: { vibrate() { return true; } } });
assert.equal(older.feedback.impact(700), false);
assert.equal(older.feedback.beginCharge(), true);
older.advance();
assert.equal(older.feedback.impact(700), true);

// API support is not a promise of a physical motor, and failures stay harmless.
const unsupported = fixture({ navigator: {} });
assert.equal(unsupported.feedback.isSupported(), false);
assert.equal(unsupported.feedback.beginCharge(), false);
assert.equal(unsupported.feedback.getStatus().backend, 'none');
assert.equal(unsupported.feedback.getStatus().enabled, true);
assert.doesNotThrow(() => unsupported.feedback.stop());
const rejects = fixture({ navigator: { vibrate() { return false; } } });
assert.equal(rejects.feedback.preview(), false);
assert.equal(rejects.feedback.getStatus().lastResult, 'rejected');
const throws = fixture({ navigator: { vibrate() { throw Error('blocked'); } } });
assert.equal(throws.feedback.preview(), false);
assert.doesNotThrow(() => throws.feedback.stop());

// A native host may inject actual light/medium/heavy strength. Web pages do
// not infer that a wx global is a usable native mini-program vibration bridge.
const nativeCalls = [];
const native = fixture({ nativeHaptics: { impact(type) { nativeCalls.push(type); }, stop() { nativeCalls.push('stop'); } } });
assert.equal(native.feedback.getStatus().backend, 'native');
native.feedback.beginCharge();
native.advance(); native.feedback.impact(300);
native.advance(); native.feedback.impact(700);
native.feedback.stop();
assert.deepEqual(nativeCalls, ['light', 'medium', 'heavy', 'stop']);
assert.equal(native.calls.length, 0);

// Promise-based host adapters may reject asynchronously without interrupting
// gameplay or producing an unhandled rejection when vibration is cancelled.
(async () => {
  const asynchronous = fixture({ nativeHaptics: {
    impact() { return Promise.reject(Error('host declined vibration')); },
    stop() { return Promise.reject(Error('host cannot cancel')); }
  } });
  assert.equal(asynchronous.feedback.beginCharge(), true, 'a request is not proof of physical feedback');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(asynchronous.feedback.getStatus().lastResult, 'rejected');
  asynchronous.feedback.stop();
  await new Promise(resolve => setImmediate(resolve));
  console.log('Haptics passed: pull detents, three impact/launch levels, cooldowns, activation/visibility/settings gates, cancellation, unsupported APIs and explicit native adapter.');
})().catch(error => { console.error(error); process.exitCode = 1; });
