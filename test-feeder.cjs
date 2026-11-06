'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const PinballFeeder = require('./dist/feeder.js');
const near = (a, b, note) => assert.ok(Math.abs(a - b) < 1e-8, `${note}: ${a} vs ${b}`);

assert.equal(PinballFeeder.WIDTH, 600);
assert.equal(PinballFeeder.HEIGHT, 136);
assert.equal(PinballFeeder.LAUNCH_X, 562);
assert.equal(PinballFeeder.LAUNCH_Y, 78);
assert.equal(PinballFeeder.CHUTE.LEFT, 56);
assert.equal(PinballFeeder.CHUTE.RIGHT, 476);
assert.equal(PinballFeeder.CHUTE.floorAt(56), 43);
assert.equal(PinballFeeder.CHUTE.floorAt(476), 69);
assert.equal(PinballFeeder.TRAY.floorAt(32), 126);
assert.equal(PinballFeeder.TRAY.floorAt(526), 126);
assert.equal(PinballFeeder.CHUTE.floorAt(266), 62.5, 'the upper chute inherits the descending, flattening bowl curve');
assert.ok(PinballFeeder.CHUTE.slopeAt(56) > PinballFeeder.CHUTE.slopeAt(266));
assert.equal(PinballFeeder.CHUTE.slopeAt(476), 0, 'the outlet has a horizontal tangent');
assert.equal(PinballFeeder.CHUTE.floorAt(500), 69, 'the chute stays flat after the outlet');
assert.equal(PinballFeeder.CHUTE.slopeAt(500), 0);
assert.ok(PinballFeeder.CHUTE.floorAt(44) < 43, 'the inlet curve extends leftward for normal contact');
for (const x of [32, 56, 250, 476, 526]) {
  for (const radius of [8.5, 11, 12.5]) {
    const contact = PinballFeeder.TRAY.centerAt(x, radius);
    assert.equal(PinballFeeder.TRAY.floorAt(x), 126, 'storage floor is horizontal across the entire bowl');
    assert.equal(PinballFeeder.TRAY.slopeAt(x), 0);
    assert.equal(contact.y, 126 - radius);
    assert.equal(contact.contactX, x, 'a flat floor meets the bead vertically below its centre');
    assert.equal(contact.contactY, 126);
    assert.equal(contact.nx, 0);
    assert.equal(contact.ny, -1);
  }
}
for (const x of [56, 250, 476]) {
  const chute = PinballFeeder.CHUTE;
  near(chute.bottomAt(x), chute.floorAt(x) + 6, 'solid chute has a six-pixel underside');
  assert.ok(chute.bottomAt(x) < PinballFeeder.TRAY.floorAt(x), 'delivery chute stays above the storage bowl');
  for (const radius of [8.5, 11]) {
    const contact = chute.centerAt(x, radius);
    near(Math.hypot(x - contact.contactX, contact.y - contact.contactY), radius, 'chute surface touches the bead along its normal');
    near(contact.contactY, chute.floorAt(contact.contactX), 'bead contact remains on the drawn slope');
  }
}
for (const radius of [8.5, 11, 12.5]) {
  const chute = PinballFeeder.CHUTE;
  const inlet = chute.centerAt(chute.LEFT, radius);
  assert.ok(inlet.contactX < chute.LEFT, 'inlet normal touches the leftward continuation instead of clamping');
  const before = chute.centerAt(chute.LEFT - 1e-5, radius);
  const after = chute.centerAt(chute.LEFT + 1e-5, radius);
  assert.ok(before.y < inlet.y && inlet.y < after.y, 'the curved inlet contact remains continuous and downhill');
  assert.ok(after.y - before.y < 1e-4);
  const exit = chute.centerAt(chute.RIGHT, radius);
  assert.equal(exit.contactX, chute.RIGHT);
  assert.equal(exit.y, 69 - radius);
  assert.equal(exit.nx, 0);
  assert.equal(exit.ny, -1);
}
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
    assert.ok(state.duration > 1 && state.duration < 10);
    assert.equal(new Set(state.balls.map(b => b.id)).size, state.balls.length);
    for (const ball of state.balls) {
      assert.ok([ball.x, ball.y, ball.opacity, ball.scale].every(Number.isFinite));
      assert.ok(ball.opacity >= 0 && ball.opacity <= 1);
      assert.equal(ball.scale, 1, 'large stakes keep the same physical bead size');
      assert.ok(ball.x >= 48 && ball.x <= 562 && ball.y >= -12 && ball.y <= PinballFeeder.TRAY.FLOOR);
      if (ball.x >= 56 && ball.x <= PinballFeeder.INTAKE_X) {
        const radius = ball.kind === 'launch' ? 8.5 : 11;
        const contact = PinballFeeder.CHUTE.centerAt(ball.x, radius);
        near(ball.y, contact.y, 'travelling bead follows the separate elevated chute');
        near(Math.hypot(ball.x - contact.contactX, ball.y - contact.contactY), radius, 'contact lies exactly one radius from bead centre');
      }
      if (last.has(ball.id)) {
        assert.ok(ball.x >= last.get(ball.id).x - 1e-9, 'beads move forward');
        assert.ok(ball.y >= last.get(ball.id).y - 1e-9, 'both collection and launch routes remain downhill');
      }
      last.set(ball.id, ball);
    }
    const travelling = state.balls.filter(ball => ball.x >= PinballFeeder.CHUTE.LEFT && ball.x <= PinballFeeder.CHUTE.RIGHT);
    for (let i = 0; i < travelling.length; i++) for (let j = i + 1; j < travelling.length; j++) {
      const a = travelling[i], b = travelling[j];
      const minimum = (a.kind === 'launch' ? 8.5 : 11) + (b.kind === 'launch' ? 8.5 : 11);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= minimum, 'neighbouring beads stay separated on the single-file chute');
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
const routeTransfers = [];
const route = new PinballFeeder({ onDrop: ball => routeTransfers.push(ball) });
route.start({ count: 10, launchBall: true });
route.step(PinballFeeder.BRANCH_TIME);
const atGate = route.getSnapshot();
const first = atGate.balls.find(b => b.kind === 'launch');
near(first.x, PinballFeeder.INTAKE_X, 'first ball reaches right split x');
near(first.y, PinballFeeder.CHUTE.centerAt(PinballFeeder.INTAKE_X, 8.5).y, 'first ball follows its own radius into the elevated right split');
near(atGate.gate, 0, 'concealed diverter stays on launch as first ball enters');
route.step(.10);
const bridgeCleared = route.getSnapshot();
near(bridgeCleared.gate, 0, 'diverter waits until the whole first ball clears the mouth');
assert.ok(bridgeCleared.balls.find(b => b.kind === 'launch').x - 8.5 > PinballFeeder.INTAKE_X);
route.step(.08);
const bridgeOpen = route.getSnapshot();
near(bridgeOpen.gate, 1, 'collection opens before the next ball reaches it');
assert.ok(bridgeOpen.balls.filter(b => b.kind === 'point').every(b => b.x < PinballFeeder.INTAKE_X));
route.step(.08);
assert.equal(routeTransfers.length, 1);
near(routeTransfers[0].x, PinballFeeder.INTAKE_X, 'point transfers at the same right junction');
near(routeTransfers[0].y, PinballFeeder.INTAKE_Y, 'point enters the tray without a position jump');

const singleLaunch = new PinballFeeder();
singleLaunch.start({ count: 1, launchBall: true });
singleLaunch.step(singleLaunch.getSnapshot().duration - 1e-7);
const readyApproach = singleLaunch.getSnapshot().balls[0];
assert.ok(Math.abs(readyApproach.x - PinballFeeder.LAUNCH_X) < .001);
assert.ok(Math.abs(readyApproach.y - PinballFeeder.LAUNCH_Y) < .001, 'short right guide meets the unchanged firing position');

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

// Each collection bead transfers once, before its original credit event.
for (const frames of [[1 / 60], [.017, .05, .008], [10]]) {
  const transfers = [], credited = [];
  const handoff = new PinballFeeder({
    onDrop: ball => {
      assert.ok(!credited.includes(ball.id), 'physical handoff precedes credit');
      assert.equal(ball.opacity, 1);
      assert.equal(ball.x, PinballFeeder.INTAKE_X);
      assert.equal(ball.y, PinballFeeder.INTAKE_Y);
      assert.equal(ball.radius, 11, 'handoff size is independent of total stake');
      assert.equal(ball.vx, -180, 'diverter directs the outgoing bead toward the pile left shoulder');
      assert.equal(ball.vy, 220, 'diverter directs the outgoing bead downward');
      assert.ok(ball.y + ball.radius < PinballFeeder.TRAY.centerAt(ball.x, ball.radius).y - (Math.sqrt(3) + 1) * ball.radius,
        'collection starts above the upper layer instead of inside the floor-level pile');
      transfers.push(ball.id);
    },
    onCollect: id => {
      assert.ok(transfers.includes(id), 'collected ball has transferred to the box');
      credited.push(id);
    }
  });
  handoff.start({ count: 99, launchBall: true });
  let frame = 0;
  while (handoff.busy) handoff.step(frames[frame++ % frames.length]);
  assert.deepEqual(transfers, Array.from({ length: 98 }, (_, i) => i + 1));
  assert.deepEqual(credited, transfers);
  handoff.step(10);
  assert.equal(transfers.length, 98);
}
const dropReset = new PinballFeeder({ onDrop: () => dropReset.reset(), onCollect: () => assert.fail('reset handoff cannot credit a canceled arrival') });
dropReset.start({ count: 2 }); dropReset.step(10);
assert.equal(dropReset.busy, false);

const creditTimes = [];
const promptCredit = new PinballFeeder({
  onDrop: () => creditTimes.push(promptCredit.getSnapshot().elapsed),
  onCollect: () => creditTimes.push(promptCredit.getSnapshot().elapsed)
});
promptCredit.start({ count: 1 });
while (promptCredit.busy) promptCredit.step(.001);
assert.equal(creditTimes.length, 2);
assert.ok(creditTimes[1] - creditTimes[0] <= .021, 'point credits immediately after entering the right intake');

// A blocked outlet pauses every travelling bead instead of hiding a queued
// bead or allowing the next ones to catch up with the occupied outlet.
let outletOpen = false, dropAttempts = 0;
const acceptedDrops = [], blockedCredits = [], blockedCompletions = [];
const blocked = new PinballFeeder({
  onDrop: ball => {
    dropAttempts++;
    if (!outletOpen) return false;
    acceptedDrops.push(ball.id);
    return true;
  },
  onCollect: id => blockedCredits.push(id),
  onComplete: () => blockedCompletions.push('complete')
});
blocked.start({ count: 5, pointOffset: 10 });
blocked.step(10);
const held = blocked.getSnapshot();
near(held.elapsed, PinballFeeder.BRANCH_TIME, 'rejection stops time exactly at the occupied outlet');
assert.equal(held.busy, true);
assert.equal(held.balls.length, 5, 'the rejected bead and the rest of the line remain visible');
near(held.balls[0].x, PinballFeeder.INTAKE_X, 'rejected bead remains at the outlet x');
near(held.balls[0].y, PinballFeeder.INTAKE_Y, 'rejected bead remains at the outlet y');
for (let i = 1; i < held.balls.length; i++) {
  const ahead = held.balls[i - 1], behind = held.balls[i];
  assert.ok(Math.hypot(ahead.x - behind.x, ahead.y - behind.y) >= 22, 'backpressure preserves the original bead spacing');
}
for (const dt of [1 / 60, .2, 10]) {
  blocked.step(dt);
  assert.deepEqual(blocked.getSnapshot(), held, 'all feeder positions stay fixed while the outlet refuses the bead');
  assert.deepEqual(acceptedDrops, []);
  assert.deepEqual(blockedCredits, [], 'a rejected bead never credits points');
  assert.deepEqual(blockedCompletions, [], 'a blocked line cannot complete');
}
assert.equal(dropAttempts, 4, 'each later frame retries the same held bead');
outletOpen = true;
blocked.step(.01);
assert.deepEqual(acceptedDrops, [11], 'the held bead transfers exactly once after the outlet opens');
assert.deepEqual(blockedCredits, [], 'credit still waits for the arrival event after accepted handoff');
blocked.step(.011);
assert.deepEqual(acceptedDrops, [11]);
assert.deepEqual(blockedCredits, [11]);
blocked.step(10);
assert.deepEqual(acceptedDrops, [11, 12, 13, 14, 15]);
assert.deepEqual(blockedCredits, acceptedDrops, 'every accepted bead credits once after a blocked period');
assert.deepEqual(blockedCompletions, ['complete']);
blocked.step(10);
assert.deepEqual(acceptedDrops, [11, 12, 13, 14, 15]);
assert.deepEqual(blockedCredits, acceptedDrops);
assert.deepEqual(blockedCompletions, ['complete']);

console.log('Feeder passed: curved delivery chute with continuous inlet and flat outlet, horizontal storage floor, non-overlapping constant-size beads, continuous downhill launch route and elevated drop, exact 1/10/99-ball arrivals, prompt intake credit, top-ups, frame rates, cancellation, duplicate prevention and outlet backpressure; nominal unblocked batch duration stays under 10 seconds.');
