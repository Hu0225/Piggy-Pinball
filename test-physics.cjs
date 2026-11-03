'use strict';

const assert = require('node:assert/strict');
const PinballPhysics = require('./dist/physics.js');
const visitedSlots = new Set();
let maximumSeconds = 0;
let impacts = 0;

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

console.log(`Physics passed: 101 power levels, all 10 slots, ${impacts} peg impacts, 10 simultaneous balls; longest flight ${maximumSeconds.toFixed(2)}s.`);
