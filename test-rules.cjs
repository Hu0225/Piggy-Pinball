'use strict';

const assert = require('node:assert/strict');
const PinballRules = require('./dist/rules.js');
const forMultiplier = multiplier => () => (multiplier - 2 + 0.01) / 11;
const complete = (game, hitCount = game.round.stake) => {
  const lit = game.round.litSlots[0];
  const dark = Array.from({ length: 10 }, (_, index) => index).find(index => !game.round.litSlots.includes(index));
  let last;
  for (let index = 0; index < game.round.stake; index++) {
    assert.equal(game.launchBall(index), true);
    last = game.landBall(index, index < hitCount ? lit : dark);
  }
  return last;
};

// Deposits are integer bounded, deducted once, and locked while playing.
const game = new PinballRules(undefined, forMultiplier(2));
for (const invalid of [undefined, null, '5', NaN, Infinity, -1, 0, 4, 5.5, 100]) assert.equal(game.startRound(invalid).ok, false);
assert.equal(game.wallet, 990);
assert.equal(game.startRound(5).ok, true);
assert.equal(game.wallet, 985);
assert.equal(game.startRound(99).ok, false);
assert.equal(game.clearRound(), false);
assert.equal(game.round.remaining, 5);
assert.equal(game.wallet, 985);
const untouchedMultiplier = game.round.multiplier;
const untouchedLanes = [...game.round.litSlots];
assert.equal(game.startRound(5).ok, false);
assert.equal(game.round.multiplier, untouchedMultiplier);
assert.deepEqual(game.round.litSlots, untouchedLanes);

// Every supported multiplier is reachable; lower multipliers have more lit lanes.
let previousLitCount = 10;
for (let multiplier = 2; multiplier <= 12; multiplier++) {
  const sample = new PinballRules(undefined, forMultiplier(multiplier));
  assert.equal(sample.startRound(99).ok, true);
  assert.equal(sample.round.multiplier, multiplier);
  assert.equal(sample.round.litSlots.length, PinballRules.LIT_COUNTS[multiplier]);
  assert.ok(sample.round.litSlots.length <= previousLitCount);
  assert.equal(new Set(sample.round.litSlots).size, sample.round.litSlots.length);
  assert.ok(sample.round.litSlots.every(slot => slot >= 0 && slot <= 9));
  previousLitCount = sample.round.litSlots.length;
}
assert.equal(new PinballRules(undefined, () => 1).startRound(5).round.multiplier, 12);
assert.equal(new PinballRules(undefined, () => 0).startRound(5).round.multiplier, 2);

// Only launched balls may land, exactly once; unlit lanes pay nothing.
const unknown = game.landBall('missing', 0);
assert.equal(unknown.accepted, false);
assert.equal(game.launchBall('a'), true);
assert.equal(game.launchBall('a'), false);
assert.equal(game.landBall('a', 10).accepted, false);
const hit = game.landBall('a', game.round.litSlots[0]);
assert.equal(hit.reward, 2);
assert.equal(game.wallet, 987);
assert.equal(game.landBall('a', game.round.litSlots[0]).accepted, false);
const dark = Array.from({ length: 10 }, (_, index) => index).find(index => !game.round.litSlots.includes(index));
assert.equal(game.launchBall('b'), true);
assert.equal(game.landBall('b', dark).reward, 0);
assert.equal(game.wallet, 987);

// Cancellation returns only unlaunched balls; it cannot erase flying balls.
assert.equal(game.launchBall('c'), true);
assert.equal(game.refundUnlaunched().ok, false);
game.landBall('c', dark);
const returned = game.refundUnlaunched();
assert.deepEqual(returned, { ok: true, refunded: 2, cardsAwarded: 0 });
assert.equal(game.wallet, 989);
assert.equal(game.round.phase, 'settled');
assert.equal(game.refundUnlaunched().ok, false);
assert.equal(game.newRound(), true);
assert.equal(game.round, null);

// Cards count complete groups of 30 winning balls in this round only.
for (const [multiplier, stake, hits, expectedCards] of [[6,5,4,0],[6,5,5,1],[12,5,5,2],[10,9,9,3],[12,10,10,4]]) {
  const sample = new PinballRules(undefined, forMultiplier(multiplier));
  sample.startRound(stake);
  const end = complete(sample, hits);
  assert.equal(end.settled, true);
  assert.equal(end.cardsAwarded, expectedCards);
  assert.equal(sample.cards, expectedCards);
  assert.equal(sample.wallet, 990 - stake + hits * multiplier);
  assert.equal(sample.round.won, hits * multiplier);
  assert.equal(sample.bestWin, hits * multiplier);
  const savedCards = sample.cards;
  sample.landBall(0, sample.round.litSlots[0]);
  assert.equal(sample.cards, savedCards);
  assert.equal(sample.launchBall('extra'), false);
}
const remainder = new PinballRules(undefined, forMultiplier(2));
remainder.startRound(5); complete(remainder);
remainder.startRound(5); complete(remainder);
remainder.startRound(5); complete(remainder);
assert.equal(remainder.cards, 0, 'ten winnings in each of three rounds must not combine into a card');

// All 99 deposits can be in flight, then resolve out of order without duplication.
const full = new PinballRules(undefined, forMultiplier(12));
full.startRound(99);
for (let index = 1; index <= 99; index++) assert.equal(full.launchBall(index), true);
assert.equal(full.launchBall(100), false);
assert.equal(full.round.remaining, 0);
for (let index = 99; index >= 1; index--) {
  const outcome = full.landBall(index, full.round.litSlots[0]);
  assert.equal(outcome.settled, index === 1);
}
assert.equal(full.round.resolved, 99);
assert.equal(full.round.won, 1188);
assert.equal(full.cards, 39);
assert.equal(full.wallet, 2079);

// Card spending is atomic and bounded; all prizes are persistent game collectibles.
const poor = new PinballRules();
assert.equal(poor.redeem('sticker').ok, false);
assert.equal(poor.redeem('unknown').ok, false);
assert.equal(full.redeem('trophy').ok, true);
assert.equal(full.cards, 27);
assert.equal(full.inventory.trophy, 1);
assert.equal(full.redeem('trophy').ok, true);
assert.equal(full.inventory.trophy, 2);
const collected = new PinballRules(JSON.stringify(full.serialize()));
assert.equal(collected.cards, 15);
assert.equal(collected.inventory.trophy, 2);
assert.equal(collected.round, null);
assert.equal(collected.recovered, null);

// A refresh returns unresolved and unlaunched deposits, retains paid winnings,
// and settles cards only for landed winnings. Re-saving prevents duplicate recovery.
const interrupted = new PinballRules(undefined, forMultiplier(12));
interrupted.startRound(10);
for (let index = 0; index < 6; index++) interrupted.launchBall(index);
for (let index = 0; index < 5; index++) interrupted.landBall(index, interrupted.round.litSlots[0]);
assert.equal(interrupted.wallet, 1040);
assert.equal(interrupted.cards, 0);
const recovered = new PinballRules(interrupted.serialize());
assert.deepEqual(recovered.recovered, { refunded: 5, cardsAwarded: 2 });
assert.equal(recovered.wallet, 1045);
assert.equal(recovered.cards, 2);
assert.equal(recovered.round, null);
const recoveredAgain = new PinballRules(recovered.serialize());
assert.equal(recoveredAgain.wallet, 1045);
assert.equal(recoveredAgain.cards, 2);
assert.equal(recoveredAgain.recovered, null);

const ready = new PinballRules();
ready.startRound(99);
assert.equal(new PinballRules(ready.serialize()).wallet, 990);
const canceled = new PinballRules(undefined, forMultiplier(6));
canceled.startRound(10);
for (let id = 0; id < 5; id++) { canceled.launchBall(id); canceled.landBall(id, canceled.round.litSlots[0]); }
canceled.refundUnlaunched();
const canceledRestored = new PinballRules(canceled.serialize());
assert.equal(canceledRestored.wallet, 1015);
assert.equal(canceledRestored.cards, 1);

// Exhausted wallets have a small free recovery, but cannot repeatedly claim it.
const empty = new PinballRules({ wallet: 4, cards: 0 });
assert.equal(empty.startRound(5).ok, false);
assert.deepEqual(empty.getRescue(), { ok: true, amount: 50 });
assert.equal(empty.wallet, 54);
assert.equal(empty.getRescue().ok, false);
empty.startRound(54);
assert.equal(empty.getRescue().ok, false);

// Damaged local saves safely fall back to finite integer balances.
for (const damaged of ['not json', '[]', null, { wallet: NaN, cards: -3, bestWin: Infinity }, { version: 200, wallet: 3 }]) {
  const sample = new PinballRules(damaged);
  assert.equal(sample.wallet, 990);
  assert.equal(sample.cards, 0);
}
const corruptedRound = interrupted.serialize();
corruptedRound.round.won = 100000;
const bad = new PinballRules(corruptedRound);
assert.equal(bad.recovered, null);
assert.equal(bad.wallet, interrupted.wallet);
assert.equal(bad.cards, 0);

console.log('Rules passed: deposits 5–99, multipliers 2–12, lit-lane rewards, 30-ball cards, 99-ball settlement, gifts, recovery and duplicate protection.');
