'use strict';

const assert = require('node:assert/strict');
const PinballPhysics = require('./dist/physics.js');
const rail = PinballPhysics.LAUNCH_RAIL;
const gravity = 780;
const tick = 1 / 180;
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

// The requested original staggered field is part of the game design.
const originalPegs = [];
for (let row = 0; row < 8; row++) {
  for (let column = 0; column < (row % 2 === 0 ? 9 : 8); column++) {
    originalPegs.push({ id: originalPegs.length, x: (row % 2 === 0 ? 62 : 90) + column * 54, y: 170 + row * 60, radius: 6.2, row, column });
  }
}
assert.deepEqual(new PinballPhysics().pegs, originalPegs, 'preserve all 68 original obstacle positions and radii');

// The rendered rail and physical guide share one quarter-circle definition.
assert.ok(Object.isFrozen(rail));
near(rail.angle, Math.PI / 2, 1e-12, 'guide turns 90 degrees, not a U-turn');
near(rail.startX, rail.centerX + rail.radius, 1e-12, 'straight chute meets circle');
near(rail.startY, rail.centerY, 1e-12, 'entry tangent is vertical');
near(rail.exitX, rail.centerX, 1e-12, 'exit tangent is horizontal');
near(rail.exitY, rail.centerY - rail.radius, 1e-12, 'guide has the agreed outlet');
assert.ok(rail.halfWidth > 8.5, 'ball fits between the guide walls');
assert.ok(rail.exitX <= 520 - 8.5 && rail.exitY >= 30 + 8.5, 'outlet is inside the free-flight bounds');

const launchOrigins = [() => 704, () => 838, () => 848, power => 838 + 10 * power];
// Measure release speeds rather than duplicating the input-to-speed formula.
// Ten percent supplies exactly the gravitational climb energy; higher powers
// add evenly spaced speed gains instead of compressing the low/middle range.
for (const originForPower of launchOrigins) {
  const initialSpeeds = [];
  for (let percent = 0; percent <= 100; percent++) {
    const power = percent / 100;
    const physics = new PinballPhysics();
    assert.equal(physics.launch(power, { startY: originForPower(power) }), true);
    const ball = physics.balls[0];
    assert.equal(ball.vx, 0, 'release starts vertically in the existing chute');
    assert.ok(Number.isFinite(ball.vy) && ball.vy <= 0, 'release speed is finite and never starts downward');
    initialSpeeds.push(-ball.vy);
    if (percent > 0) assert.ok(initialSpeeds[percent] > initialSpeeds[percent - 1], 'each displayed percent increases actual release speed');
  }
  assert.equal(initialSpeeds[0], 0, 'zero power receives no hidden launch energy');
  const climbEnergy = power => 2 * gravity * (originForPower(power) - rail.exitY);
  assert.ok(initialSpeeds[9] ** 2 < climbEnergy(.09), 'nine percent cannot supply enough energy to exit');
  near(initialSpeeds[10] ** 2, climbEnergy(.1), 1e-8, 'ten percent has no spare exit energy');
  assert.ok(initialSpeeds[11] ** 2 > climbEnergy(.11), 'eleven percent has positive exit energy');
  const upperGains = [40, 70, 100].map(percent => initialSpeeds[percent] - initialSpeeds[percent - 30]);
  assert.ok(Math.max(...upperGains) / Math.min(...upperGains) < 1.05, 'equal intervals above the threshold produce similar release-speed gains');
  const fullToThresholdRatio = initialSpeeds[100] / initialSpeeds[10];
  assert.ok(fullToThresholdRatio >= 1.9 && fullToThresholdRatio <= 2.25, 'full power retains approximately twice the threshold release speed');
}

for (const originForPower of launchOrigins) for (const power of [.11, 0.25, 0.5, 0.75, 1]) {
  const startY = originForPower(power);
  const physics = new PinballPhysics();
  physics.launch(power, { startY });
  const ball = physics.balls[0];
  assert.equal(ball.y, startY, 'the actual ball starts in its visible waiting chamber');
  assert.equal(ball.x, rail.startX);
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
  assert.ok(sawEntry && sawExit, 'successful powers traverse both continuous transitions');
}

// Failed attempts must travel back down the same physical guide, never enter
// the board, score, or rely on a timeout teleport to become launchable again.
function returnToChamber(physics, power, frameTimes = [tick], startY = 838 + 10 * power) {
  const launches = [], exits = [], returns = [], scores = [];
  physics.onLaunch = event => launches.push(event);
  physics.onExit = event => exits.push(event);
  physics.onReturn = event => returns.push(event);
  physics.onScore = event => scores.push(event);
  assert.equal(physics.launch(power, { startY }), true);
  const ball = physics.balls.at(-1), initialEnergy = ball.vy ** 2 - 2 * gravity * ball.y;
  let minimumY = ball.y, sawDescent = false, frame = 0;
  while (physics.balls.length && frame < 3600) {
    const previous = { x: ball.x, y: ball.y, speed: Math.hypot(ball.vx, ball.vy) };
    const dt = frameTimes[frame++ % frameTimes.length];
    physics.step(dt);
    assert.ok([ball.x, ball.y, ball.vx, ball.vy].every(Number.isFinite), 'weak attempts retain finite state');
    assert.notEqual(ball.phase, 'board', 'insufficient energy cannot enter the playfield');
    assert.ok(ball.y <= startY + 1e-9, 'the waiting chamber supports returning balls');
    minimumY = Math.min(minimumY, ball.y);
    if (ball.vy > 0) sawDescent = true;
    if (frameTimes.length === 1 && dt === tick) {
      assert.ok(Math.hypot(ball.x - previous.x, ball.y - previous.y) <= previous.speed * tick + .025, 'return motion does not teleport at turns or guide boundaries');
    }
    if (!returns.length) {
      const energy = ball.vx ** 2 + ball.vy ** 2 - 2 * gravity * ball.y;
      assert.ok(energy <= initialEnergy + 1e-5, 'the guide cannot add energy to a weak attempt');
      assert.ok(initialEnergy - energy < .05, 'top turnaround dissipates only a tiny amount of energy');
    }
    if (ball.phase === 'rail') {
      const rx = ball.x - rail.centerX, ry = ball.y - rail.centerY;
      near(Math.hypot(rx, ry), rail.radius, 1e-9, 'both directions remain on the drawn circular guide');
      near(ball.vx * rx + ball.vy * ry, 0, 1e-7, 'return velocity remains tangent to the guide');
    }
  }
  assert.equal(physics.balls.length, 0, 'returned balls leave the active simulation');
  assert.ok(ball.age < 20, 'the critical top turnaround does not stall indefinitely');
  assert.equal(launches.length, 1, 'each pull reports one attempt');
  assert.equal(exits.length, 0, 'failed attempts never report a real launch');
  assert.equal(scores.length, 0, 'failed attempts never fabricate a lane or reward');
  assert.equal(returns.length, 1, 'each failed attempt reports exactly one return');
  assert.equal(returns[0].ballId, ball.id);
  assert.equal(returns[0].power, power);
  near(returns[0].x, rail.startX, 1e-9, 'return event is at the original chute');
  near(returns[0].y, startY, 1e-9, 'return event occurs only at the waiting chamber');
  if (power >= .001) {
    assert.ok(minimumY < startY, 'nonzero attempts visibly rise before returning');
    assert.ok(sawDescent, 'nonzero attempts reverse and fall under gravity');
  }
  physics.step(.1);
  assert.equal(returns.length, 1, 'removed attempts cannot fire return twice');
  return { minimumY, seconds: ball.age, event: returns[0] };
}

const weakPowers = [0, .000001, .001, .01, .02, .03, .04, .05, .06, .07, .08, .09, .099, .0999, .0999999, .1];
for (const originForPower of launchOrigins) {
  let previousRise = -Infinity;
  for (const power of weakPowers) {
    const startY = originForPower(power);
    const result = returnToChamber(new PinballPhysics(), power, [tick], startY);
    const rise = startY - result.minimumY;
    assert.ok(rise >= previousRise, 'more sub-threshold energy produces at least as much climb');
    previousRise = rise;
    if (power === .1) {
      assert.ok(result.minimumY > rail.exitY && result.minimumY - rail.exitY < .01, 'ten percent reaches visually the top without crossing the outlet');
    }
  }
}
// Reusing the same engine after failed pulls must retain deterministic motion
// across frame rates and ball IDs, without consuming capacity or future shots.
const retryPhysics = new PinballPhysics();
for (const power of [.000001, .09, .0999, .1]) {
  const first = returnToChamber(retryPhysics, power);
  for (const frames of [[1 / 30], [1 / 120], [.013, .021, .008, .05, .016]]) {
    const later = new PinballPhysics(); later._nextId = 901;
    const repeated = returnToChamber(later, power, frames);
    near(repeated.seconds, first.seconds, 1e-9, 'return time is independent of rendering and ball IDs');
    assert.equal(repeated.event.power, first.event.power);
  }
}
assert.equal(retryPhysics.launch(.11), true, 'repeated weak attempts leave the engine ready for a real shot');
retryPhysics.reset();

for (const invalidY of [null, '838', NaN, Infinity, -1, 703, 901]) {
  const physics = new PinballPhysics();
  physics.launch(.5, { startY: invalidY });
  assert.equal(physics.balls[0].y, 704, 'invalid origins retain the original launch position');
}
for (const boundaryY of [704, 900]) {
  const physics = new PinballPhysics();
  physics.launch(.5, { startY: boundaryY });
  assert.equal(physics.balls[0].y, boundaryY);
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
// Preserve the old pinball feel at different speeds and contact angles.
// Normal speed bounces back at 74% (pins) / 40% (rounded lane mouths),
// while tangential speed must not be crushed by an extra damping factor.
for (const state of [
  { x: 62, y: 155, vx: 0, vy: 100 },
  { x: 62, y: 155, vx: 0, vy: 300 },
  { x: 62, y: 155, vx: 0, vy: 700 },
  { x: 49, y: 162, vx: 100, vy: 100 }
]) {
  const { physics, events } = impactFixture(state, true);
  assert.equal(events.length, 1);
  const ball = physics.balls[0];
  const distance = Math.hypot(ball.x - 62, ball.y - 170);
  const nx = (ball.x - 62) / distance, ny = (ball.y - 170) / distance;
  const incomingX = state.vx * Math.exp(-0.065 * tick), incomingY = state.vy + gravity * tick;
  const normal = incomingX * nx + incomingY * ny;
  const tangent = -incomingX * ny + incomingY * nx;
  near(ball.vx * nx + ball.vy * ny, -normal * .74, 1e-9, 'original pin rebound strength');
  near(-ball.vx * ny + ball.vy * nx, tangent, 1e-9, 'pin contact retains tangential motion');
  assert.ok(Math.hypot(ball.vx, ball.vy) <= Math.hypot(incomingX, incomingY), 'contact never adds energy');
}
near(lip.physics.balls[0].vy, -(100 + gravity * tick) * .4, 1e-9, 'original lane-mouth rebound strength');
assert.equal(impactFixture({ x: 40, vx: 50 }).events.length, 0, 'position correction while moving away is not an impact');
assert.equal(impactFixture({ x: 44.5, vx: -20 }).events.length, 0, 'imperceptible wall contacts are suppressed');

// Registering feedback cannot change positions, scoring or elapsed time.
for (const power of [0, .1, 0.5, 1]) {
  const reported = [], callbackScores = [], plainScores = [];
  const withFeedback = new PinballPhysics({ onImpact: event => reported.push(event), onScore: event => callbackScores.push(event) });
  const plain = new PinballPhysics({ onScore: event => plainScores.push(event) });
  withFeedback.launch(power); plain.launch(power);
  for (let frame = 0; frame < 2400 && (withFeedback.balls.length || plain.balls.length); frame++) {
    withFeedback.step(1 / 120); plain.step(1 / 120);
    assert.deepEqual(withFeedback.getSnapshot().balls, plain.getSnapshot().balls);
  }
  assert.equal(callbackScores.length, Number(power > .1));
  assert.deepEqual(callbackScores, plainScores);
}

for (let powerStep = 11; powerStep <= 100; powerStep++) {
  const scores = [], exits = [], returns = [];
  const physics = new PinballPhysics({
    onScore: event => scores.push(event),
    onExit: event => exits.push(event),
    onReturn: event => returns.push(event),
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
  assert.equal(exits.length, 1, 'each successful shot reports its real outlet crossing exactly once');
  assert.equal(returns.length, 0, 'successful shots cannot also return to the launch chamber');
  assert.equal(exits[0].ballId, scores[0].ballId);
  assert.equal(exits[0].power, powerStep / 100);
  near(exits[0].x, rail.exitX, 1e-9, 'exit callback occurs at the real guide outlet');
  near(exits[0].y, rail.exitY, 1e-9, 'exit callback occurs at the real guide outlet');
  assert.equal(physics.balls.length, 0, 'scored balls must leave the simulation');
  assert.ok(frames / 120 < 20, 'normal launches must physically settle within a reasonable time');
  assert.equal(scores[0].power, powerStep / 100, 'history receives the exact launch power');
  assert.equal(scores[0].value, physics.slots[scores[0].slotIndex].value);
  visitedSlots.add(scores[0].slotIndex);
  maximumSeconds = Math.max(maximumSeconds, frames / 120);
}

const scores = [];
const multiball = new PinballPhysics({ onScore: event => scores.push(event) });
for (let index = 0; index < 10; index++) assert.equal(multiball.launch(.11 + index * .89 / 9), true);
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

// A ball still on the playfield cannot score simply because time has elapsed.
const timeoutScores = [];
const timeoutPhysics = new PinballPhysics({ onScore: event => timeoutScores.push(event) });
timeoutPhysics.launch(.5);
Object.assign(timeoutPhysics.balls[0], { phase: 'board', x: 300, y: 100, vx: 0, vy: 0, age: 25 });
timeoutPhysics.step(tick);
assert.equal(timeoutScores.length, 0);
assert.ok(timeoutPhysics.balls[0].y < 710);

function settle(physics, power, frameTimes = [1 / 60], startY = 704) {
  let result;
  const exits = [], returns = [];
  physics.reset();
  physics.onScore = event => { result = event; };
  physics.onExit = event => exits.push(event);
  physics.onReturn = event => returns.push(event);
  physics.launch(power, { startY });
  const ball = physics.balls[0];
  let frame = 0;
  while (!result && ball.age < 20) physics.step(frameTimes[frame++ % frameTimes.length]);
  assert.ok(result, `power ${power} must physically reach a lane`);
  assert.equal(result.y, 710);
  assert.equal(exits.length, 1, 'real shots cross the outlet exactly once before scoring');
  assert.equal(returns.length, 0, 'real shots never report a failed return');
  return { ...result, seconds: ball.age };
}

// Feeding extends the existing launch chute below the board. It changes only
// the climb length: powers above ten percent leave the guide and settle.
let feederMaximumSeconds = 0;
for (const originForPower of [() => 838, () => 848, power => 838 + 10 * power]) {
  const feederSlots = new Set();
  for (let percent = 11; percent <= 100; percent++) {
    const power = percent / 100, startY = originForPower(power);
    const first = settle(new PinballPhysics(), power, [1 / 60], startY);
    feederSlots.add(first.slotIndex);
    feederMaximumSeconds = Math.max(feederMaximumSeconds, first.seconds);
    for (const frames of [[1 / 30], [1 / 120], [.013, .021, .008, .05, .016]]) {
      const later = new PinballPhysics(); later._nextId = 901;
      const repeated = settle(later, power, frames, startY);
      assert.equal(repeated.slotIndex, first.slotIndex, 'extended chute retains a lane across ball IDs and frame rates');
      near(repeated.x, first.x, 1e-9, 'extended chute retains its landing coordinate');
    }
  }
  assert.equal(feederSlots.size, 10, 'the extended launch chute can still reach every lane');
}

// The UI exposes exact one-percent increments. Every step must be repeatable,
// independent of ball ID, previous rounds, and browser render timing.
const repeatPhysics = new PinballPhysics();
for (const power of [.01, .1, .11, .25, .5, .75, 1]) {
  const first = new PinballPhysics(), later = new PinballPhysics();
  later._nextId = 901;
  first.launch(power); later.launch(power);
  for (let frame = 0; first.balls.length && frame < 3600; frame++) {
    first.step(tick); later.step(tick);
    const withoutId = physics => physics.getSnapshot().balls.map(({ id, ...state }) => state);
    assert.deepEqual(withoutId(first), withoutId(later), 'full trajectory is independent of the ball number');
  }
  assert.equal(first.balls.length, 0);
  assert.equal(later.balls.length, 0);
}
for (let percent = 11; percent <= 100; percent++) {
  const power = percent / 100;
  const first = settle(new PinballPhysics(), power);
  for (const frames of [[1 / 30], [1 / 60], [1 / 120], [.013, .021, .008, .05, .016]]) {
    const repeated = settle(repeatPhysics, power, frames);
    assert.equal(repeated.slotIndex, first.slotIndex, 'same power retains its lane across IDs and frame rates');
    near(repeated.x, first.x, 1e-9, 'same power retains its physical landing position');
    assert.equal(repeated.power, power);
  }
}

// The restored lively rebounds amplify small aim changes on dense pins.
// Neighboring powers need not produce neighboring lanes; identical powers do.
console.log(`Physics passed: original 68-pin layout and rebound strength, continuous 90-degree guide, 0–10% physical returns with a dissipative critical turnaround, 11–100% real outlet crossings, real-contact feedback, all 10 slots, ${impacts} peg impacts, ID/frame-rate repeatability, repeated weak attempts, 10 simultaneous balls; longest flight ${maximumSeconds.toFixed(2)}s; extended feeder origins 838–848 cover every lane and settle within ${feederMaximumSeconds.toFixed(2)}s.`);
