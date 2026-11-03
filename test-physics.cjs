'use strict';

const assert = require('node:assert/strict');
const PinballPhysics = require('./dist/physics.js');
const rail = PinballPhysics.LAUNCH_RAIL;
const gravity = 780;
const tick = 1 / 180;
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

// The rendered rail and physical guide share one quarter-circle definition.
assert.ok(Object.isFrozen(rail));
near(rail.angle, Math.PI / 2, 1e-12, 'guide turns 90 degrees, not a U-turn');
near(rail.startX, rail.centerX + rail.radius, 1e-12, 'straight chute meets circle');
near(rail.startY, rail.centerY, 1e-12, 'entry tangent is vertical');
near(rail.exitX, rail.centerX, 1e-12, 'exit tangent is horizontal');
near(rail.exitY, rail.centerY - rail.radius, 1e-12, 'guide has the agreed outlet');
assert.ok(rail.halfWidth > 8.5, 'ball fits between the guide walls');
assert.ok(rail.exitX <= 520 - 8.5 && rail.exitY >= 30 + 8.5, 'outlet is inside the free-flight bounds');

for (const power of [0, 0.25, 0.5, 0.75, 1]) {
  const physics = new PinballPhysics();
  physics.launch(power);
  const ball = physics.balls[0];
  const initialSpeed = -ball.vy;
  const conservedEnergy = initialSpeed * initialSpeed - 2 * gravity * ball.y;
  const expectedExitSpeed = Math.sqrt(initialSpeed * initialSpeed - 2 * gravity * (ball.y - rail.exitY));
  let sawEntry = false, sawExit = false;
  for (let frame = 0; frame < 500 && ball.phase !== 'board'; frame++) {
    const previous = { x: ball.x, y: ball.y, phase: ball.phase, speed: Math.hypot(ball.vx, ball.vy) };
    physics.step(tick);
    const speed = Math.hypot(ball.vx, ball.vy);
    assert.ok(Math.hypot(ball.x - previous.x, ball.y - previous.y) <= previous.speed * tick + 0.02, 'no teleport at guide boundaries');
    if (ball.phase === 'launch' || ball.phase === 'rail') {
      near(speed * speed - 2 * gravity * ball.y, conservedEnergy, 1e-5, 'guide does not create or destroy kinetic energy');
      assert.ok(speed <= previous.speed + 1e-6, 'uphill motion slows under gravity');
    }
    if (ball.phase === 'rail') {
      const rx = ball.x - rail.centerX, ry = ball.y - rail.centerY;
      near(Math.hypot(rx, ry), rail.radius, 1e-9, 'ball follows the drawn circular centerline');
      near(ball.vx * rx + ball.vy * ry, 0, 1e-7, 'velocity stays tangent to the guide');
      assert.ok(ball.vx <= 0 && ball.vy <= 0, 'guide never turns the ball back downward');
      if (previous.phase === 'launch') sawEntry = true;
    }
    if (ball.phase === 'board') {
      sawExit = true;
      assert.ok(ball.x <= rail.exitX && ball.y >= rail.exitY, 'free flight begins at the outlet');
      assert.ok(ball.vx < 0 && ball.vy >= -1e-9 && ball.vy <= gravity * tick, 'outlet tangent is leftward; only remaining tick adds downward gravity');
      near(-ball.vx, expectedExitSpeed, expectedExitSpeed * 0.065 * tick + 1e-6, 'exit retains rail speed instead of receiving an arbitrary kick');
    }
  }
  assert.ok(sawEntry && sawExit, 'all launch powers traverse both continuous transitions');
}

const visitedSlots = new Set();
let maximumSeconds = 0;
let impacts = 0;

// Feedback reports incoming normal speed only for genuine reflections.
// Isolated fixtures distinguish side walls, top walls, divider lips and pegs.
function impactFixture(state, includePegs = false) {
  const events = [], pegEvents = [];
  const physics = new PinballPhysics({ onImpact: event => events.push(event), onPegHit: event => pegEvents.push(event) });
  physics.launch(0);
  if (!includePegs) physics.pegs = [];
  Object.assign(physics.balls[0], { phase: 'board', x: 300, y: 100, vx: 0, vy: 0 }, state);
  physics.step(tick);
  for (const event of events) {
    assert.equal(event.ballId, physics.balls[0].id);
    assert.ok([event.x, event.y, event.speed].every(Number.isFinite));
    assert.ok(event.speed > 28 && event.speed < 1500);
  }
  return { physics, events, pegEvents };
}
for (const [state, incomingSpeed] of [
  [{ x: 44.6, vx: -200 }, 200 * Math.exp(-0.065 * tick)],
  [{ x: 511.4, vx: 200 }, 200 * Math.exp(-0.065 * tick)],
  [{ y: 39, vy: -200 }, 200 - gravity * tick]
]) {
  const { events } = impactFixture(state);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'wall');
  near(events[0].speed, incomingSpeed, 1e-9, 'wall feedback uses incoming normal speed');
}
const lip = impactFixture({ x: 88, y: 637, vy: 100 });
assert.equal(lip.events.length, 1);
assert.equal(lip.events[0].kind, 'divider');
near(lip.events[0].speed, 100 + gravity * tick, 1e-9, 'rounded lip feedback uses incoming normal speed');
const divider = impactFixture({ x: 78, y: 670, vx: 100 });
assert.equal(divider.events.length, 1);
assert.equal(divider.events[0].kind, 'divider');
near(divider.events[0].speed, 100 * Math.exp(-0.065 * tick), 1e-9, 'divider feedback uses incoming normal speed');
const peg = impactFixture({ x: 62, y: 155, vy: 100 }, true);
assert.equal(peg.events.length, 1);
assert.equal(peg.events[0].kind, 'peg');
assert.equal(peg.pegEvents.length, 1, 'legacy peg animation/audio callback is retained');
assert.equal(peg.events[0].speed, peg.pegEvents[0].speed);
assert.equal(impactFixture({ x: 40, vx: 50 }).events.length, 0, 'position correction while moving away is not an impact');
assert.equal(impactFixture({ x: 44.5, vx: -20 }).events.length, 0, 'imperceptible wall contacts are suppressed');

// Registering feedback cannot change positions, scoring or elapsed time.
for (const power of [0, 0.5, 1]) {
  const reported = [], callbackScores = [], plainScores = [];
  const withFeedback = new PinballPhysics({ onImpact: event => reported.push(event), onScore: event => callbackScores.push(event) });
  const plain = new PinballPhysics({ onScore: event => plainScores.push(event) });
  withFeedback.launch(power); plain.launch(power);
  for (let frame = 0; frame < 2400 && (withFeedback.balls.length || plain.balls.length); frame++) {
    withFeedback.step(1 / 120); plain.step(1 / 120);
    assert.deepEqual(withFeedback.getSnapshot().balls, plain.getSnapshot().balls);
  }
  assert.ok(reported.some(event => event.kind === 'peg'));
  assert.equal(callbackScores.length, 1);
  assert.deepEqual(callbackScores, plainScores);
}

for (let powerStep = 0; powerStep <= 100; powerStep++) {
  const scores = [];
  const physics = new PinballPhysics({
    onScore: event => scores.push(event),
    onPegHit: () => impacts++
  });
  assert.equal(physics.launch(powerStep / 100), true);
  let frames = 0;
  while (physics.balls.length > 0 && frames < 3600) {
    physics.step(1 / 120);
    for (const ball of physics.balls) {
      assert.ok([ball.x, ball.y, ball.vx, ball.vy].every(Number.isFinite));
    }
    frames++;
  }
  assert.equal(scores.length, 1, 'each ball must score exactly once');
  assert.equal(physics.balls.length, 0, 'scored balls must leave the simulation');
  assert.ok(frames / 120 < 20, 'normal launches must settle without the lifetime failsafe');
  assert.equal(scores[0].value, physics.slots[scores[0].slotIndex].value);
  visitedSlots.add(scores[0].slotIndex);
  maximumSeconds = Math.max(maximumSeconds, frames / 120);
}

const scores = [];
const multiball = new PinballPhysics({ onScore: event => scores.push(event) });
for (let index = 0; index < 10; index++) assert.equal(multiball.launch(index / 9), true);
assert.equal(multiball.launch(0.5), false);
for (let frame = 0; frame < 1800; frame++) multiball.step(frame % 3 === 0 ? 1 / 30 : 1 / 60);
assert.equal(scores.length, 10);
assert.equal(new Set(scores.map(event => event.ballId)).size, 10);
assert.equal(multiball.balls.length, 0);
assert.equal(multiball.launch(0.65), true);
multiball.reset();
assert.equal(multiball.balls.length, 0);
multiball.step(NaN);
multiball.step(-1);
assert.equal(visitedSlots.size, 10);

console.log(`Physics passed: 90-degree guide, continuous tangent/energy transitions, wall/peg/divider impact feedback, 101 power levels, all 10 slots, ${impacts} peg impacts, 10 simultaneous balls; longest flight ${maximumSeconds.toFixed(2)}s.`);
