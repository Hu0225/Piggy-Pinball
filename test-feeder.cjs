'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const PinballFeeder = require('./dist/feeder.js');
const near = (a, b, note) => assert.ok(Math.abs(a - b) < 1e-8, `${note}: ${a} vs ${b}`);

assert.equal(PinballFeeder.WIDTH, 600);
assert.equal(PinballFeeder.HEIGHT, 112);
assert.equal(PinballFeeder.LAUNCH_X, 562);
assert.equal(PinballFeeder.LAUNCH_Y, 78);
const browser = { window: {} };
vm.runInNewContext(fs.readFileSync('dist/feeder.js', 'utf8'), browser);
assert.equal(typeof browser.window.PinballFeeder, 'function');

function run(count, launchBall, pointOffset, frameTimes) {
  const events = [];
  const feeder = new PinballFeeder({
    onReady: () => events.push('ready'),
    onCollect: token => events.push(token),
    onComplete: () => events.push('complete')
  });
  assert.equal(feeder.start({ count, launchBall, pointOffset }), true);
  const initial = feeder.getSnapshot();
  assert.equal(initial.balls.length, 1);
  assert.equal(initial.balls[0].x, 48);
  assert.equal(initial.balls[0].y, -12);
  assert.equal(initial.balls[0].opacity, 0, 'first ball starts inside the occluded inlet');
  assert.equal(initial.inletOpen, true);
  assert.equal(feeder.start({ count: 1 }), false, 'busy input cannot replace a batch');
  assert.deepEqual(feeder.getSnapshot(), initial);
  assert.deepEqual(events, [], 'snapshot queries have no side effects');
  let frames = 0;
  const last = new Map();
  while (feeder.busy && frames < 10000) {
    feeder.step(frameTimes[frames++ % frameTimes.length]);
    const state = feeder.getSnapshot();
    assert.ok(state.gate >= 0 && state.gate <= 1);
    assert.ok(state.duration > .6 && state.duration <= 2.3);
    assert.equal(new Set(state.balls.map(b => b.id)).size, state.balls.length);
    for (const ball of state.balls) {
      assert.ok([ball.x, ball.y, ball.opacity, ball.scale].every(Number.isFinite));
      assert.ok(ball.opacity >= 0 && ball.opacity <= 1 && ball.scale > 0 && ball.scale <= 1);
      assert.ok(ball.x >= 48 && ball.x <= 562 && ball.y >= -12 && ball.y <= 95);
      if (last.has(ball.id)) {
        assert.ok(ball.x >= last.get(ball.id).x - 1e-9, 'beads move forward');
        assert.ok(ball.y >= last.get(ball.id).y - 1e-9, 'beads roll downhill');
      }
      last.set(ball.id, ball);
    }
    assert.deepEqual(feeder.getSnapshot(), state);
  }
  assert.equal(feeder.busy, false);
  const points = events.filter(Number.isInteger);
  const expected = Array.from({ length: count - Number(launchBall) }, (_, i) => pointOffset + i + 1);
  assert.deepEqual(points, expected);
  assert.equal(events.filter(v => v === 'ready').length, Number(launchBall));
  assert.equal(events.at(-1), 'complete');
  assert.equal(events.filter(v => v === 'complete').length, 1);
  if (launchBall && count > 1) assert.equal(events[0], 'ready', 'first ball arrives before point balls disappear');
  assert.deepEqual(feeder.getSnapshot().balls, []);
  assert.equal(feeder.getSnapshot().inletOpen, false);
  const settledEvents = [...events];
  feeder.step(100);
  feeder.getSnapshot();
  assert.deepEqual(events, settledEvents, 'finished frames cannot credit twice');
  return { events, duration: feeder.getSnapshot().duration };
}

for (const count of [1, 10, 99]) {
  for (const first of [true, false]) {
    const baseline = run(count, first, first ? 0 : 9, [1 / 60]);
    for (const timing of [[1 / 30], [1 / 120], [.013, .05, .008, .021], [10]]) {
      const repeated = run(count, first, first ? 0 : 9, timing);
      assert.deepEqual(repeated.events, baseline.events, 'callback sequence is frame-rate independent');
      near(repeated.duration, baseline.duration, 'batch duration is frame-rate independent');
    }
  }
}

// Gate and routes meet at the same physical junction without a jump.
const route = new PinballFeeder();
route.start({ count: 10, launchBall: true });
route.step(.48);
const atGate = route.getSnapshot();
const first = atGate.balls.find(b => b.kind === 'launch');
near(first.x, 260, 'first ball reaches split x');
near(first.y, 56, 'first ball reaches split y');
near(atGate.gate, 0, 'bridge stays closed as first ball enters');
route.step(.11);
const bridgeCleared = route.getSnapshot();
near(bridgeCleared.gate, 0, 'bridge stays closed until the whole first ball crosses');
assert.ok(bridgeCleared.balls.find(b => b.kind === 'launch').x - 8.5 > 336);
route.step(.12);
const bridgeOpen = route.getSnapshot();
near(bridgeOpen.gate, 1, 'gate opens before the next ball reaches it');
assert.ok(bridgeOpen.balls.filter(b => b.kind === 'point').every(b => b.x < 260));
route.step(.03);
const firstPoint = route.getSnapshot().balls.find(b => b.kind === 'point');
near(firstPoint.x, 260, 'first point reaches split after the bridge opens');
near(firstPoint.y, 56, 'first point starts the collection path without a jump');

let calls = 0;
const canceled = new PinballFeeder({ onCollect: () => calls++, onReady: () => calls++, onComplete: () => calls++ });
for (const invalid of [0, -1, 100, 1.5, NaN, Infinity, '5', undefined]) assert.equal(canceled.start({ count: invalid }), false);
for (const offset of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.equal(canceled.start({ count: 10, pointOffset: offset }), false);
assert.equal(canceled.start({ count: 1, launchBall: 'yes' }), false);
canceled.start({ count: 10, launchBall: true });
const unchanged = canceled.getSnapshot();
for (const dt of [0, -1, NaN, Infinity, undefined]) canceled.step(dt);
assert.deepEqual(canceled.getSnapshot(), unchanged);
canceled.step(.3);
canceled.reset();
canceled.step(10);
assert.equal(calls, 0, 'reset cancels pending arrivals and completion');
assert.equal(canceled.busy, false);
assert.deepEqual(canceled.getSnapshot().balls, []);
assert.equal(canceled.start({ count: 1, launchBall: true }), true);
canceled.step(10);
assert.equal(calls, 2, 'reset permits a fresh batch');

// A callback-triggered reset must prevent all remaining old-batch callbacks.
const interruptedEvents = [];
const interrupted = new PinballFeeder({
  onReady: () => { interruptedEvents.push('ready'); interrupted.reset(); },
  onCollect: n => interruptedEvents.push(n), onComplete: () => interruptedEvents.push('complete')
});
interrupted.start({ count: 99, launchBall: true });
interrupted.step(10);
assert.deepEqual(interruptedEvents, ['ready']);

console.log('Feeder passed: visible inlet, downhill routes, first-shot diversion, exact 1/10/99-ball arrivals, top-ups, gate timing, frame-rate independence, cancellation and duplicate prevention; batches finish within 2 seconds.');
