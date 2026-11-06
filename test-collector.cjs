'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Collector = require('./dist/collector.js');
const Feeder = require('./dist/feeder.js');

assert.equal(Collector.LEFT, 32);
assert.equal(Collector.RIGHT, 526);
assert.equal(Collector.TOP, Feeder.CHUTE.bottomAt(Collector.LEFT));
assert.equal(Collector.floorAt(Collector.LEFT), 126);
assert.equal(Collector.floorAt(Collector.RIGHT), 126);
assert.equal(Collector.floorAt((Collector.LEFT + Collector.RIGHT) / 2), 126);
assert.equal(Collector.floorAt, Feeder.TRAY.floorAt, 'the collector uses the shared rendered tray floor');
assert.equal(Collector.centerAt, Feeder.TRAY.centerAt, 'rolling and stored beads use the same contact offset');
assert.equal(Collector.INTAKE_Y, Feeder.CHUTE.centerAt(Feeder.INTAKE_X, 11).y);
assert.ok(Collector.INTAKE_Y < Collector.centerAt(Collector.INTAKE_X, 11).y - 40, 'the chute releases above the pile, not at the tray floor');

const browser = { window: {} };
vm.runInNewContext(fs.readFileSync('dist/feeder.js', 'utf8'), browser);
vm.runInNewContext(fs.readFileSync('dist/collector.js', 'utf8'), browser);
assert.equal(typeof browser.window.PinballCollector, 'function');

function inspect(collector) {
  const state = collector.getSnapshot();
  assert.equal(state.total, state.admitted + state.pending, 'every queued bead is admitted exactly once');
  assert.equal(state.admitted, state.stored + state.balls.length, 'stored beads leave the visible box exactly once');
  assert.equal(new Set(state.balls.map(ball => ball.id)).size, state.balls.length);
  for (let i = 0; i < state.balls.length; i++) {
    const ball = state.balls[i];
    assert.ok([ball.x, ball.y, ball.radius, ball.vx, ball.vy, ball.opacity].every(Number.isFinite));
    assert.ok(ball.x - ball.radius >= Collector.LEFT - .001, 'left wall contains the complete bead');
    assert.ok(ball.x + ball.radius <= Collector.RIGHT + .001, 'right wall contains the complete bead');
    if (!ball.draining) assert.ok(ball.y <= Collector.centerAt(ball.x, ball.radius).y + .001, 'only a concealed draining bead passes the horizontal floor');
    assert.ok(ball.y - ball.radius >= Collector.topAt(ball.x) - .001, 'the lower storage ceiling follows the independent upper chute');
    for (let j = i + 1; j < state.balls.length; j++) {
      const other = state.balls[j];
      const overlap = ball.radius + other.radius - Math.hypot(ball.x - other.x, ball.y - other.y);
      // A freshly inserted bead may need the following fixed steps to finish
      // relaxing contacts; this is under one third of a mobile screen pixel.
      assert.ok(overlap < .6, `round contacts do not penetrate visibly (${overlap})`);
    }
  }
  assert.deepEqual(collector.getSnapshot(), state, 'querying the state does not advance physics');
  return state;
}

function settle(collector, seconds = 20, frames = [1 / 60]) {
  let elapsed = 0, index = 0;
  while (elapsed < seconds - 1e-10) {
    const dt = Math.min(frames[index++ % frames.length], seconds - elapsed);
    collector.step(dt); elapsed += dt;
    inspect(collector);
  }
  return inspect(collector);
}

function assertResting(state) {
  assert.equal(state.pending, 0, 'the entire incoming queue drains within the animation window');
  assert.ok(state.balls.every(ball => !ball.draining), 'the final visible pile has stopped draining');
  for (const ball of state.balls) {
    const floor = ball.y >= Collector.centerAt(ball.x, ball.radius).y - .2;
    const supported = state.balls.some(other => other !== ball && other.y > ball.y + .2
      && Math.hypot(ball.x - other.x, ball.y - other.y) <= ball.radius + other.radius + .25);
    assert.ok(floor || supported, 'every resting bead is supported by the floor or a lower bead');
  }
  for (let i = 0; i < state.balls.length; i++) {
    for (let j = i + 1; j < state.balls.length; j++) {
      const a = state.balls[i], b = state.balls[j];
      assert.ok(a.radius + b.radius - Math.hypot(a.x - b.x, a.y - b.y) < .1, 'settled contacts keep the original strict tolerance');
    }
  }
}

function batch(count, radius = 11) {
  const collector = new Collector();
  for (let id = 1; id <= count; id++) assert.equal(collector.add({ id, radius }), true);
  return collector;
}

// A horizontal storage floor supports the same bead height at every x and
// does not invent sideways acceleration for a bead placed at rest.
for (const x of [Collector.LEFT + 20, (Collector.LEFT + Collector.RIGHT) / 2, Collector.RIGHT - 20]) {
  const collector = new Collector(), radius = 11;
  assert.equal(Collector.slopeAt(x), 0);
  assert.equal(collector.add({ id: 1, x, y: Collector.centerAt(x, radius).y, radius, vx: 0, vy: 50 }), true);
  collector.step(1 / 240);
  const ball = inspect(collector).balls[0];
  const contact = Collector.centerAt(ball.x, radius);
  assert.equal(contact.y, 126 - radius);
  assert.equal(contact.contactX, x);
  assert.equal(contact.contactY, 126);
  assert.ok(Math.abs(ball.y - contact.y) < .001, 'left, middle and right beads remain supported at the same floor height');
  assert.ok(Math.abs(Math.hypot(ball.x - contact.contactX, ball.y - contact.contactY) - radius) < .001,
    'the bead edge touches the floor along its normal, without a visible gap');
  assert.equal(ball.x, x);
  assert.equal(ball.vx, 0, 'vertical floor contact does not create sideways speed');
  const resting = settle(collector, 3).balls[0];
  assert.equal(resting.x, x, 'a stationary bead stays at its original place on the level floor');
  assert.equal(resting.vx, 0);
  assert.equal(resting.y, 126 - radius);
}

// Beads dropped over separated parts of the pan share the same vertical
// landing and retain their x positions when no sideways momentum was supplied.
const levelDrops = new Collector();
for (const [index, x] of [80, 280, 500].entries()) {
  assert.equal(levelDrops.add({ id: index + 1, x, y: 96, vx: 0, vy: 50 }), true);
}
const levelState = settle(levelDrops, 3);
assert.deepEqual(levelState.balls.map(ball => ball.x), [80, 280, 500]);
assert.ok(levelState.balls.every(ball => ball.y === 115 && ball.vx === 0), 'all separated drops rest on the horizontal floor without drifting');
assertResting(levelState);

for (const count of [1, 5, 10, 99]) {
  const collector = batch(count);
  const state = settle(collector);
  assert.equal(state.admitted, count);
  assertResting(state);
  if (count <= 10) {
    assert.equal(state.stored, 0, 'a small batch remains visibly in the box');
    assert.equal(state.balls.length, count);
  } else {
    assert.ok(state.stored > 0, 'large batches use the concealed storage below the lip');
    if (count === 99) {
      assert.ok(state.balls.length >= 8 && state.balls.length <= 28, 'the physical outlet may drain early while keeping a visible pile within capacity');
      assert.ok(state.balls.every(ball => ball.radius === 11), 'large batches never shrink the visible beads');
    }
  }
}

// Fixed-step contacts and queued intake agree at different display frame rates,
// including a single long step used for reduced motion/background completion.
const reference = settle(batch(99));
for (const frames of [[1 / 30], [1 / 120], [.013, .05, .008, .021], [20]]) {
  const state = settle(batch(99), 20, frames);
  assert.deepEqual(state, reference, 'the same elapsed time produces the same pile');
}

// Live feeder integration: handoff conserves every incoming scoring bead.
function feed(collector, count, launchBall, pointOffset = 0, frames = [1 / 60]) {
  let points = 0;
  const previous = collector.getSnapshot();
  const expectedTotal = previous.total + count - Number(launchBall);
  const seen = new Set(previous.balls.map(ball => ball.id));
  const feeder = new Feeder({
    onDrop: ball => {
      const accepted = collector.tryAdd(ball);
      if (accepted) {
        const entered = collector.getSnapshot().balls.find(item => item.id === ball.id);
        assert.equal(entered.x, ball.x, 'handoff preserves the exact outlet x');
        assert.equal(entered.y, ball.y, 'handoff preserves the exact outlet height');
        assert.equal(entered.vx, ball.vx, 'handoff preserves the guide velocity');
        assert.equal(entered.vy, ball.vy);
      }
      return accepted;
    },
    onCollect: () => points++
  });
  assert.equal(feeder.start({ count, launchBall, pointOffset }), true);
  for (let frame = 0; frame < 3600; frame++) {
    const wasFeeding = feeder.busy;
    const dt = frames[frame % frames.length];
    feeder.step(dt); collector.step(dt);
    const state = inspect(collector);
    for (const ball of state.balls) {
      if (!seen.has(ball.id)) {
        assert.ok(Math.abs(ball.x - Collector.INTAKE_X) < 34, 'new beads enter locally at the right mouth without jumping across the tray');
        seen.add(ball.id);
      }
    }
    if (wasFeeding && !feeder.busy) {
      assert.equal(state.admitted, expectedTotal, 'every bead has physically entered when the visible feeder finishes');
      assert.equal(state.pending, 0, 'no hidden intake backlog remains after collection completes');
      settle(collector, 3);
      break;
    }
  }
  assert.equal(feeder.busy, false);
  assert.equal(points, count - Number(launchBall));
}
const toppedUp = new Collector();
feed(toppedUp, 5, true);
assert.equal(toppedUp.getSnapshot().total, 4);
assert.equal(toppedUp.getSnapshot().balls.length, 4);
feed(toppedUp, 5, false, 4);
assert.equal(toppedUp.getSnapshot().total, 9, 'top-ups retain the previous collection');
assertResting(settle(toppedUp));
feed(toppedUp, 89, false, 9);
assert.equal(toppedUp.getSnapshot().total, 98, 'a full principal reached through top-ups retains every scoring identity');
assert.equal(toppedUp.getSnapshot().pending, 0);
assertResting(settle(toppedUp, 3));
const largeFeed = new Collector();
feed(largeFeed, 99, true);
const largeFeedState = settle(largeFeed);
assert.equal(largeFeedState.total, 98);
assert.equal(largeFeedState.admitted, 98);
assert.ok(largeFeedState.balls.length >= 8 && largeFeedState.balls.length <= 28, 'full runs retain a natural pile, not a forced count');
assertResting(largeFeedState);

for (const frames of [[1 / 30], [1 / 120], [.013, .05, .008, .021]]) {
  const collector = new Collector();
  feed(collector, 99, true, 0, frames);
  const state = settle(collector, 3);
  assert.equal(state.total, 98);
  assert.equal(state.admitted, 98);
  assert.equal(state.pending, 0);
  assertResting(state);
}

// Refusing a crowded mouth is a visible feeder pause, not a queued/credited
// bead. A retry uses the same identity and enters from exactly the same mouth.
const throat = new Collector();
assert.equal(throat.tryAdd({ id: 1 }), true);
const entered = throat.getSnapshot().balls[0];
assert.equal(entered.x, Feeder.INTAKE_X);
assert.equal(entered.y, Feeder.INTAKE_Y);
assert.equal(entered.vx, -180);
assert.equal(entered.vy, 220);
assert.equal(throat.tryAdd({ id: 2 }), false);
assert.equal(throat.getSnapshot().total, 1);
assert.equal(throat.getSnapshot().pending, 0);
assert.equal(throat.tryAdd({ id: 3, y: -1000 }), false, 'clamped inputs use the same blocked mouth before registering an identity');
assert.equal(throat.getSnapshot().total, 1);
throat.step(1 / 240);
const falling = throat.getSnapshot().balls[0];
assert.ok(falling.y > entered.y && falling.y < entered.y + 2, 'the first physical step falls continuously from the outlet without a downward jump');
assert.ok(falling.x < entered.x, 'the mechanical guide points the fall down and left');
for (let frame = 0; frame < 240 && throat.getSnapshot().total < 2; frame++) {
  throat.step(1 / 240);
  throat.tryAdd({ id: 2 });
}
assert.equal(throat.getSnapshot().total, 2);
assert.equal(throat.getSnapshot().admitted, 2);
assert.equal(throat.tryAdd({ id: 2 }), false, 'accepted identities cannot be retried twice');
assertResting(settle(throat, 5));

const mixed = batch(5);
settle(mixed, 1);
for (let id = 6; id <= 30; id++) mixed.add({ id, radius: id <= 16 ? 9.9 : 7.92 });
assertResting(settle(mixed));
assert.equal(mixed.getSnapshot().total, 30, 'mixed-size top-ups preserve all identities');

const invalid = new Collector();
for (const args of [{}, { id: NaN }, { id: 1, radius: 0 }, { id: 1, x: Infinity }]) assert.equal(invalid.add(args), false);
assert.equal(invalid.add({ id: 1 }), true);
assert.equal(invalid.add({ id: 1 }), false, 'duplicate handoffs cannot duplicate a bead');
const beforeInvalidStep = invalid.getSnapshot();
for (const dt of [0, -1, NaN, Infinity]) invalid.step(dt);
assert.deepEqual(invalid.getSnapshot(), beforeInvalidStep);
invalid.step(.1); invalid.reset(); invalid.step(10);
assert.deepEqual(invalid.getSnapshot(), { balls: [], pending: 0, admitted: 0, stored: 0, total: 0 });
assert.equal(invalid.add({ id: 1 }), true, 'new rounds can reuse their token identities');

console.log('Collector: separate curved chute/level storage pan, equal-height vertical support without sideways acceleration, continuous falling handoff, exact-mouth backpressure, real contacts and roof clearance, bounded natural piles, concealed pressure relief, feeder/top-up conservation, frame rates and reset passed.');
