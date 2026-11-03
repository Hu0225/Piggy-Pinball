'use strict';
const assert = require('node:assert/strict');
const PinballRules = require('./dist/rules.js');
const forMultiplier = multiplier => () => (multiplier - 2 + 0.01) / 11;
const readyGame = (stake, multiplier = 2, saved) => {
  const game = new PinballRules(saved, forMultiplier(multiplier));
  assert.equal(game.startRound(stake).ok, true);
  assert.equal(game.round.phase, 'ready');
  return game;
};
const finish = (game, hit = true, id = 'shot') => {
  const lit = game.round.litSlots[0];
  const dark = Array.from({ length: 10 }, (_, index) => index).find(index => !game.round.litSlots.includes(index));
  assert.equal(game.launchBall(id), true);
  return game.landBall(id, hit ? lit : dark);
};

// The first investment immediately activates the round and locks its multiplier.
// Invalid investments cannot spend the wallet or consume randomness.
let randomCalls = 0;
const game = new PinballRules(undefined, () => { randomCalls++; return 0; });
assert.equal(game.drawMultiplier().ok, false);
assert.equal(game.addStake(1).ok, false);
assert.equal(game.launchBall('too-early'), false);
for (const invalid of [undefined, null, '5', NaN, Infinity, -1, 0, 1.5, 100]) assert.equal(game.startRound(invalid).ok, false);
assert.equal(game.wallet, 990);
assert.equal(randomCalls, 0);
assert.equal(game.round, null);
const activated = game.startRound(1);
assert.equal(activated.ok, true);
assert.equal(activated.round, game.round);
assert.equal(game.wallet, 989);
assert.equal(game.round.phase, 'ready');
assert.equal(game.round.multiplier, 2);
assert.equal(game.round.litSlots.length, PinballRules.LIT_COUNTS[2]);
assert.equal(game.round.remaining, 1);
assert.equal(game.round.launched, 0);
assert.equal(randomCalls, 10);
assert.equal(game.startRound(99).ok, false);
assert.equal(game.wallet, 989);
assert.equal(randomCalls, 10);
assert.equal(game.clearRound(), false);
const fixedLanes = [...game.round.litSlots];
assert.equal(game.addStake(4).ok, true);
assert.equal(game.round.stake, 5);
assert.equal(game.wallet, 985);
assert.equal(game.drawMultiplier().ok, false);
assert.equal(game.round.phase, 'ready');
assert.equal(game.round.multiplier, 2);
assert.equal(randomCalls, 10);

// Additional investments change principal, but never redraw lamps or grant shots.
assert.equal(game.addStake(10).ok, true);
assert.equal(game.round.stake, 15);
assert.equal(game.wallet, 975);
assert.equal(game.round.remaining, 1);
assert.equal(game.drawMultiplier().ok, false);
assert.equal(randomCalls, 10);
assert.deepEqual(game.round.litSlots, fixedLanes);
for (const invalid of [undefined, null, '5', NaN, Infinity, -1, 0, 0.5, 85, 100]) assert.equal(game.addStake(invalid).ok, false);
assert.equal(game.wallet, 975);
assert.equal(game.round.stake, 15);
assert.equal(randomCalls, 10);
assert.deepEqual(game.round.litSlots, fixedLanes);

let poorRandomCalls = 0;
const rejectedFirstStake = new PinballRules({ wallet: 2 }, () => { poorRandomCalls++; return 0; });
assert.equal(rejectedFirstStake.startRound(3).ok, false);
assert.equal(rejectedFirstStake.wallet, 2);
assert.equal(rejectedFirstStake.round, null);
assert.equal(rejectedFirstStake.roundNumber, 0);
assert.equal(poorRandomCalls, 0);

// Exactly one valid ball may launch. Invalid or duplicate landing events cannot pay.
assert.equal(game.landBall('missing', 0).accepted, false);
for (const invalid of [undefined, null, '', ' ', -1, NaN, {}, 'x'.repeat(129)]) assert.equal(game.launchBall(invalid), false);
assert.equal(game.launchBall('a'), true);
assert.equal(game.round.remaining, 0);
assert.equal(game.round.phase, 'playing');
assert.equal(game.launchBall('a'), false);
assert.equal(game.launchBall('b'), false);
assert.equal(game.addStake(1).ok, false);
assert.equal(game.drawMultiplier().ok, false);
assert.equal(game.refundUnlaunched().ok, false);
assert.equal(game.startRound(1).ok, false);
for (const slot of [-1, 10, 0.5, NaN, '0']) assert.equal(game.landBall('a', slot).accepted, false);
assert.equal(game.landBall('b', game.round.litSlots[0]).accepted, false);
assert.deepEqual(game.landBall('a', game.round.litSlots[0]), { accepted: true, hit: true, reward: 30, settled: true, cardsAwarded: 1 });
assert.equal(game.wallet, 1005);
assert.equal(game.cards, 1);
assert.equal(game.round.launched, 1);
assert.equal(game.round.resolved, 1);
assert.equal(game.round.phase, 'settled');
assert.equal(game.landBall('a', game.round.litSlots[0]).accepted, false);
assert.equal(game.launchBall('c'), false);
assert.equal(game.addStake(1).ok, false);
assert.equal(game.refundUnlaunched().ok, false);
assert.equal(game.wallet, 1005);
assert.equal(game.cards, 1);
assert.equal(game.newRound(), true);
assert.equal(game.round, null);

// All multipliers are reachable, with increasingly fewer illuminated lanes.
let previousLitCount = 10;
for (let multiplier = 2; multiplier <= 12; multiplier++) {
  const sample = readyGame(1, multiplier);
  assert.equal(sample.round.multiplier, multiplier);
  assert.equal(sample.round.litSlots.length, PinballRules.LIT_COUNTS[multiplier]);
  assert.ok(sample.round.litSlots.length <= previousLitCount);
  assert.equal(new Set(sample.round.litSlots).size, sample.round.litSlots.length);
  assert.ok(sample.round.litSlots.every(slot => slot >= 0 && slot <= 9));
  previousLitCount = sample.round.litSlots.length;
}
for (const [random, expected] of [[() => 1, 12], [() => 0, 2], [() => NaN, 7], [() => { throw Error(); }, 7]]) {
  const sample = new PinballRules(undefined, random);
  sample.startRound(1);
  assert.equal(sample.round.multiplier, expected);
}

// The total stake is bounded, independently of how many investments were made.
const full = readyGame(1, 12);
assert.equal(full.addStake(98).ok, true);
assert.equal(full.round.stake, 99);
assert.equal(full.addStake(1).ok, false);
assert.equal(full.round.remaining, 1);
assert.equal(finish(full).reward, 1188);
assert.equal(full.round.resolved, 1);
assert.equal(full.cards, 39);
assert.equal(full.wallet, 2079);
assert.equal(full.launchBall('extra'), false);
const poorStake = readyGame(1, 2, { wallet: 2 });
assert.equal(poorStake.addStake(2).ok, false);
assert.equal(poorStake.wallet, 1);
assert.equal(poorStake.addStake(1).ok, true);
assert.equal(poorStake.wallet, 0);
assert.equal(poorStake.addStake(1).ok, false);
assert.equal(poorStake.getRescue().ok, false);

// One miss loses the committed principal; no refund or extra shots are available.
const miss = readyGame(25, 9);
assert.deepEqual(finish(miss, false), { accepted: true, hit: false, reward: 0, settled: true, cardsAwarded: 0 });
assert.equal(miss.wallet, 965);
assert.equal(miss.round.won, 0);
assert.equal(miss.cards, 0);
assert.equal(miss.refundUnlaunched().ok, false);

// Cards use the single-shot return, in full groups of 30, with no cross-round carry.
for (const [multiplier, stake, cards] of [[2,14,0],[6,5,1],[12,5,2],[10,9,3],[12,10,4]]) {
  const sample = readyGame(stake, multiplier);
  assert.equal(finish(sample).cardsAwarded, cards);
  assert.equal(sample.cards, cards);
  assert.equal(sample.wallet, 990 - stake + stake * multiplier);
  assert.equal(sample.bestWin, stake * multiplier);
}
const remainder = readyGame(5);
finish(remainder);
for (let i = 0; i < 2; i++) { remainder.startRound(5); finish(remainder); }
assert.equal(remainder.cards, 0);

// Before firing, cancellation returns every investment once, including top-ups.
for (const oldUndrawnRound of [false, true]) {
  const canceled = new PinballRules();
  canceled.startRound(3);
  // A pre-change activated round remains refundable for backward compatibility.
  if (oldUndrawnRound) Object.assign(canceled.round, { phase: 'activated', multiplier: null, litSlots: [] });
  canceled.addStake(7);
  assert.deepEqual(canceled.refundUnlaunched(), { ok: true, refunded: 10, cardsAwarded: 0 });
  assert.equal(canceled.wallet, 990);
  assert.equal(canceled.round.phase, 'settled');
  assert.equal(canceled.refundUnlaunched().ok, false);
  assert.equal(canceled.launchBall('after-cancel'), false);
  assert.equal(new PinballRules(canceled.serialize()).wallet, 990);
}

// Prizes and settled balances survive without duplicated settlement or refunds.
assert.equal(new PinballRules().redeem('sticker').ok, false);
assert.equal(full.redeem('unknown').ok, false);
assert.equal(full.redeem('trophy').ok, true);
assert.equal(full.redeem('trophy').ok, true);
const collected = new PinballRules(JSON.stringify(full.serialize()));
assert.equal(collected.cards, 15);
assert.equal(collected.wallet, 2079);
assert.equal(collected.inventory.trophy, 2);
assert.equal(collected.round, null);
assert.equal(collected.recovered, null);

// Interrupted new rounds refund the entire unjudged principal once on reload.
for (const phase of ['activated', 'ready', 'playing']) {
  const interrupted = new PinballRules(undefined, forMultiplier(12));
  interrupted.startRound(10);
  if (phase === 'activated') Object.assign(interrupted.round, { phase, multiplier: null, litSlots: [] });
  interrupted.addStake(15);
  if (phase === 'playing') interrupted.launchBall('flying');
  assert.equal(interrupted.serialize().version, 2);
  const restored = new PinballRules(interrupted.serialize());
  assert.deepEqual(restored.recovered, { refunded: 25, cardsAwarded: 0 });
  assert.equal(restored.wallet, 990);
  assert.equal(restored.cards, 0);
  assert.equal(restored.round, null);
  const again = new PinballRules(restored.serialize());
  assert.equal(again.wallet, 990);
  assert.equal(again.recovered, null);
}

// Version 1 migration honors already-paid individual-ball rewards and old refunds.
const legacy = {
  version: 1, wallet: 1040, cards: 0, bestWin: 60, roundNumber: 4, inventory: { sticker: 2 },
  round: { stake: 10, multiplier: 12, litSlots: [0], remaining: 4, launched: 6, resolved: 5, hits: 5, won: 60, cardsAwarded: 0, refunded: 0, phase: 'playing' }
};
const migrated = new PinballRules(legacy);
assert.deepEqual(migrated.recovered, { refunded: 5, cardsAwarded: 2 });
assert.equal(migrated.wallet, 1045);
assert.equal(migrated.cards, 2);
assert.equal(migrated.inventory.sticker, 2);
assert.equal(migrated.bestWin, 60);
assert.equal(migrated.roundNumber, 4);
assert.equal(new PinballRules(migrated.serialize()).wallet, 1045);
assert.equal(new PinballRules(migrated.serialize()).cards, 2);
const oldReady = structuredClone(legacy);
Object.assign(oldReady, { wallet: 980, bestWin: 0 });
Object.assign(oldReady.round, { remaining: 10, launched: 0, resolved: 0, hits: 0, won: 0, phase: 'ready' });
assert.equal(new PinballRules(oldReady).wallet, 990);
const oldSettled = structuredClone(legacy);
Object.assign(oldSettled, { wallet: 1044, cards: 2 });
Object.assign(oldSettled.round, { remaining: 0, launched: 5, resolved: 5, cardsAwarded: 2, refunded: 5, phase: 'settled' });
assert.equal(new PinballRules(oldSettled).wallet, 1044);
assert.equal(new PinballRules(oldSettled).cards, 2);
assert.equal(new PinballRules(oldSettled).recovered, null);

// Rescue is needed only when not even one ball remains, and never during a round.
const empty = new PinballRules({ wallet: 0 });
assert.equal(empty.startRound(1).ok, false);
assert.deepEqual(empty.getRescue(), { ok: true, amount: 50 });
assert.equal(empty.getRescue().ok, false);
empty.startRound(50);
assert.equal(empty.getRescue().ok, false);
assert.equal(new PinballRules({ wallet: 1 }).getRescue().ok, false);

// Damaged saves do not create invalid balances or refund corrupt round metadata.
for (const damaged of ['not json', '[]', null, { wallet: NaN, cards: -3, bestWin: Infinity }, { version: 200, wallet: 3 }]) {
  const sample = new PinballRules(damaged);
  assert.equal(sample.wallet, 990);
  assert.equal(sample.cards, 0);
}
const validSnapshot = readyGame(10, 12).serialize();
for (const corrupt of [
  { stake: 100 }, { stake: 0 }, { multiplier: null }, { multiplier: 13 }, { litSlots: [0, 0] },
  { won: 100000 }, { hits: 1 }, { cardsAwarded: 1 }, { refunded: 10 }, { remaining: 10 },
  { launched: 1 }, { resolved: 1 }, { phase: 'activated' }, { phase: 'playing' }, { phase: 'settled' }
]) {
  const saved = structuredClone(validSnapshot);
  Object.assign(saved.round, corrupt);
  const sample = new PinballRules(saved);
  assert.equal(sample.recovered, null);
  assert.equal(sample.wallet, 980);
  assert.equal(sample.cards, 0);
}
console.log('Rules passed: automatic first-deposit multiplier, locked targets on top-ups, rejected-deposit atomicity, 1–99 total principal, single-shot settlement, cards, gifts, v1/undrawn-round migration, recovery and duplicate protection.');
