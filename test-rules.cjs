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
const collectRemaining = game => {
  for (let token = 1; token < game.round.stake; token++) {
    if (!game.round.pointTokens.includes(token)) assert.equal(game.collectPoint(token).ok, true);
  }
};
const finish = (game, hit = true, id = 'shot') => {
  const lit = game.round.litSlots[0];
  const dark = Array.from({ length: 10 }, (_, index) => index).find(index => !game.round.litSlots.includes(index));
  collectRemaining(game);
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
const lockedRandomCalls = randomCalls;
assert.ok(lockedRandomCalls > 0);
assert.equal(game.startRound(99).ok, false);
assert.equal(game.wallet, 989);
assert.equal(randomCalls, lockedRandomCalls);
assert.equal(game.clearRound(), false);
const fixedLanes = [...game.round.litSlots];
assert.equal(game.addStake(4).ok, true);
assert.equal(game.round.stake, 5);
assert.equal(game.wallet, 985);
assert.equal(game.drawMultiplier().ok, false);
assert.equal(game.round.phase, 'ready');
assert.equal(game.round.multiplier, 2);
assert.equal(randomCalls, lockedRandomCalls);

// Additional investments change principal, but never redraw lamps or grant shots.
assert.equal(game.addStake(10).ok, true);
assert.equal(game.round.stake, 15);
assert.equal(game.wallet, 975);
assert.equal(game.round.remaining, 1);
assert.equal(game.drawMultiplier().ok, false);
assert.equal(randomCalls, lockedRandomCalls);
assert.deepEqual(game.round.litSlots, fixedLanes);
for (const invalid of [undefined, null, '5', NaN, Infinity, -1, 0, 0.5, 85, 100]) assert.equal(game.addStake(invalid).ok, false);
assert.equal(game.wallet, 975);
assert.equal(game.round.stake, 15);
assert.equal(randomCalls, lockedRandomCalls);
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
assert.equal(game.launchBall('not-collected'), false);
collectRemaining(game);
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
const expectedLitCounts = { 2: 4, 3: 3, 4: 2, 5: 2, 6: 2, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1 };
assert.deepEqual(PinballRules.LIT_COUNTS, expectedLitCounts);
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

// Repeatable samples cover every lane and different layouts, with balanced gaps
// and no adjacent lamps. The wraparound gap prevents crowding at the two edges.
for (let multiplier = 2; multiplier <= 12; multiplier++) {
  const reached = new Set();
  const layouts = new Set();
  for (let seed = 1; seed <= 128; seed++) {
    let state = Math.imul(seed, 2654435761) >>> 0;
    let first = true;
    const sample = new PinballRules(undefined, () => {
      if (first) { first = false; return (multiplier - 2 + 0.5) / 11; }
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    });
    assert.equal(sample.startRound(1).ok, true);
    const lanes = sample.round.litSlots;
    assert.equal(sample.round.multiplier, multiplier);
    assert.equal(lanes.length, expectedLitCounts[multiplier]);
    assert.equal(new Set(lanes).size, lanes.length);
    assert.deepEqual(lanes, [...lanes].sort((a, b) => a - b));
    assert.ok(lanes.every(lane => Number.isInteger(lane) && lane >= 0 && lane < 10));
    const gaps = lanes.map((lane, index) => (index + 1 < lanes.length ? lanes[index + 1] : lanes[0] + 10) - lane);
    assert.ok(Math.min(...gaps) >= 2, `multiplier ${multiplier} has crowded lamps`);
    assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `multiplier ${multiplier} has unbalanced gaps`);
    lanes.forEach(lane => reached.add(lane));
    layouts.add(lanes.join(','));
  }
  assert.equal(reached.size, 10, `every lane must be eligible at ${multiplier}x`);
  assert.ok(layouts.size > 1, `layouts must vary at ${multiplier}x`);

  // Keep the gap order fixed and exhaust all ten equally likely rotations.
  // No lane should gain or lose eligibility because of the spacing rule.
  const coverage = Array(10).fill(0);
  const count = expectedLitCounts[multiplier];
  for (let start = 0; start < 10; start++) {
    const draws = [(multiplier - 2 + 0.5) / 11, ...Array(count - 1).fill(0.5), (start + 0.5) / 10];
    const sample = new PinballRules(undefined, () => draws.shift());
    assert.equal(sample.startRound(1).ok, true);
    sample.round.litSlots.forEach(lane => coverage[lane]++);
  }
  assert.deepEqual(coverage, Array(10).fill(count), `balanced layouts must treat lanes equally at ${multiplier}x`);
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
  if (phase === 'playing') { collectRemaining(interrupted); interrupted.launchBall('flying'); }
  assert.equal(interrupted.serialize().version, 3);
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

// One firing ball is reserved; only the other balls earn independent points,
// exactly when their individual collection events arrive.
const single = readyGame(1, 6);
assert.equal(single.points, 0);
assert.equal(single.round.pointsEarned, 0);
assert.deepEqual(single.collectPoint(1), { ok: false, pointsAdded: 0 });
assert.equal(single.launchBall('single'), true);
single.landBall('single', single.round.litSlots[0]);
assert.equal(single.points, 0);

const pointGame = readyGame(10, 6);
assert.equal(pointGame.wallet, 980);
assert.equal(pointGame.points, 0, 'debit happens at deposit, points wait for collection');
assert.equal(pointGame.cards, 0);
const pointLanes = [...pointGame.round.litSlots];
for (const invalid of [undefined, null, '1', 0, -1, 1.5, NaN, Infinity, 10, 99]) {
  assert.deepEqual(pointGame.collectPoint(invalid), { ok: false, pointsAdded: 0 });
}
for (let token = 1; token <= 9; token++) {
  assert.equal(pointGame.launchBall(`premature-${token}`), false);
  assert.deepEqual(pointGame.collectPoint(token), { ok: true, pointsAdded: 1 });
  assert.equal(pointGame.points, token);
  assert.equal(pointGame.round.pointsEarned, token);
  assert.equal(pointGame.collectPoint(token).ok, false);
}
assert.equal(pointGame.addStake(5).ok, true);
assert.equal(pointGame.points, 9, 'top-up does not credit until the new balls enter');
assert.equal(pointGame.wallet, 975);
assert.equal(pointGame.round.stake, 15);
assert.equal(pointGame.round.multiplier, 6);
assert.deepEqual(pointGame.round.litSlots, pointLanes);
assert.equal(pointGame.launchBall('topup-pending'), false);
for (let token = 10; token <= 14; token++) assert.equal(pointGame.collectPoint(token).ok, true);
assert.equal(pointGame.points, 14);
assert.equal(pointGame.round.pointTokens.length, 14);
assert.equal(pointGame.cards, 0, 'independent points never become cards');
assert.equal(pointGame.launchBall('points-shot'), true);
assert.equal(pointGame.collectPoint(15).ok, false);
const darkPointLane = Array.from({ length: 10 }, (_, index) => index).find(index => !pointLanes.includes(index));
pointGame.landBall('points-shot', darkPointLane);
assert.equal(pointGame.points, 14, 'a miss keeps legitimately collected points');
assert.equal(pointGame.cards, 0);
assert.equal(pointGame.round.pointsEarned, 14);
assert.equal(pointGame.collectPoint(1).ok, false);
const savedPoints = pointGame.serialize();
assert.equal(savedPoints.version, 3);
savedPoints.round.pointTokens.pop();
assert.equal(pointGame.round.pointTokens.length, 14, 'save snapshots do not share mutable token arrays');
const completedPoints = new PinballRules(pointGame.serialize());
assert.equal(completedPoints.points, 14);
assert.equal(completedPoints.wallet, 975);
assert.equal(completedPoints.recovered, null);
assert.equal(completedPoints.startRound(2).ok, true);
assert.deepEqual(completedPoints.collectPoint(1), { ok: true, pointsAdded: 1 });
assert.equal(completedPoints.points, 15, 'token IDs restart in the next round');

// Safe-integer saturation must not leave an otherwise collected round locked.
const cappedPoints = readyGame(5, 2, { version: 3, points: Number.MAX_SAFE_INTEGER - 2 });
for (const [token, added] of [[1, 1], [2, 1], [3, 0], [4, 0]]) {
  assert.deepEqual(cappedPoints.collectPoint(token), { ok: true, pointsAdded: added });
}
assert.equal(cappedPoints.points, Number.MAX_SAFE_INTEGER);
assert.equal(cappedPoints.round.pointsEarned, 2);
assert.equal(cappedPoints.round.pointTokens.length, 4);
assert.equal(finish(cappedPoints, false).settled, true);
assert.equal(new PinballRules(cappedPoints.serialize()).points, Number.MAX_SAFE_INTEGER);

// Internal cancellation and interrupted-round recovery roll back only this
// round's credited points together with its principal, including mid-animation.
for (const phase of ['partial', 'collected', 'playing']) {
  const interruptedPoints = readyGame(10, 6, { version: 3, points: 11 });
  for (let token = 1; token <= 3; token++) interruptedPoints.collectPoint(token);
  interruptedPoints.addStake(5);
  if (phase !== 'partial') collectRemaining(interruptedPoints);
  if (phase === 'playing') assert.equal(interruptedPoints.launchBall('in-flight'), true);
  const restored = new PinballRules(interruptedPoints.serialize());
  assert.equal(restored.wallet, 990);
  assert.equal(restored.points, 11);
  assert.equal(restored.cards, 0);
  assert.deepEqual(restored.recovered, { refunded: 15, cardsAwarded: 0 });
  const restoredAgain = new PinballRules(restored.serialize());
  assert.equal(restoredAgain.points, 11);
  assert.equal(restoredAgain.wallet, 990);
  assert.equal(restoredAgain.recovered, null);
}
const canceledPoints = readyGame(10, 6, { version: 3, points: 7 });
for (let token = 1; token <= 3; token++) canceledPoints.collectPoint(token);
assert.equal(canceledPoints.points, 10);
assert.equal(canceledPoints.refundUnlaunched().ok, true);
assert.equal(canceledPoints.points, 7);
assert.equal(canceledPoints.round.pointsEarned, 0);
assert.equal(canceledPoints.wallet, 990);
assert.equal(canceledPoints.collectPoint(4).ok, false);
assert.equal(canceledPoints.refundUnlaunched().ok, false);
assert.equal(new PinballRules(canceledPoints.serialize()).points, 7);

// Versions predating independent points migrate with zero points, including
// unresolved old single-shot saves that still need their principal returned.
const version2 = readyGame(10, 6).serialize();
version2.version = 2;
version2.points = 1234;
delete version2.round.pointTokens;
delete version2.round.pointsEarned;
const migratedV2 = new PinballRules(version2);
assert.equal(migratedV2.points, 0);
assert.equal(migratedV2.wallet, 990);
assert.deepEqual(migratedV2.recovered, { refunded: 10, cardsAwarded: 0 });
assert.equal(migrated.points, 0);

// Existing saves may have more lamps, including adjacent ones. Preserve their
// recovery and completed rewards when the difficulty configuration changes.
const originalLitCounts = { 2: 6, 3: 5, 4: 4, 5: 4, 6: 3, 7: 3, 8: 2, 9: 2, 10: 2, 11: 1, 12: 1 };
for (let multiplier = 2; multiplier <= 12; multiplier++) {
  const originalLanes = Array.from({ length: originalLitCounts[multiplier] }, (_, index) => index);
  for (const version of [2, 3]) {
    for (const phase of ['ready', 'playing', 'settled']) {
      const previous = readyGame(10, multiplier, { version: 3, points: 11 });
      previous.round.litSlots = [...originalLanes];
      if (phase === 'ready') {
        previous.collectPoint(1);
        previous.collectPoint(2);
      } else {
        collectRemaining(previous);
        assert.equal(previous.launchBall('old-layout'), true);
        if (phase === 'settled') previous.landBall('old-layout', originalLanes[0]);
      }
      const snapshot = previous.serialize();
      snapshot.version = version;
      if (version === 2) {
        delete snapshot.round.pointTokens;
        delete snapshot.round.pointsEarned;
      }
      const recovered = new PinballRules(snapshot);
      assert.equal(recovered.wallet, phase === 'settled' ? 980 + 10 * multiplier : 990);
      assert.equal(recovered.cards, phase === 'settled' ? Math.floor(10 * multiplier / 30) : 0);
      assert.equal(recovered.points, version === 2 ? 0 : phase === 'settled' ? 20 : 11);
      assert.deepEqual(recovered.recovered, phase === 'settled' ? null : { refunded: 10, cardsAwarded: 0 });
      const reloaded = new PinballRules(recovered.serialize());
      assert.equal(reloaded.wallet, recovered.wallet, 'old-layout recovery refunds only once');
      assert.equal(reloaded.points, recovered.points);
      assert.equal(reloaded.recovered, null);
    }
  }
  for (const phase of ['ready', 'playing', 'settled']) {
    const won = phase === 'ready' ? 0 : 5 * multiplier;
    const earnedCards = Math.floor(won / 30);
    const snapshot = {
      version: 1, wallet: 980 + won + (phase === 'settled' ? 4 : 0),
      cards: phase === 'settled' ? earnedCards : 0, bestWin: won,
      round: {
        stake: 10, multiplier, litSlots: [...originalLanes],
        remaining: phase === 'ready' ? 10 : phase === 'playing' ? 4 : 0,
        launched: phase === 'ready' ? 0 : 6, resolved: phase === 'ready' ? 0 : phase === 'playing' ? 5 : 6,
        hits: phase === 'ready' ? 0 : 5, won,
        refunded: phase === 'settled' ? 4 : 0, cardsAwarded: phase === 'settled' ? earnedCards : 0, phase
      }
    };
    const recovered = new PinballRules(snapshot);
    const refund = phase === 'ready' ? 10 : 5;
    assert.equal(recovered.wallet, snapshot.wallet + (phase === 'settled' ? 0 : refund));
    assert.equal(recovered.cards, earnedCards);
    assert.deepEqual(recovered.recovered, phase === 'settled' ? null : { refunded: refund, cardsAwarded: earnedCards });
  }
}
for (const version of [1, 2, 3]) {
  const corruptLayout = readyGame(10, 2).serialize();
  corruptLayout.version = version;
  corruptLayout.round.litSlots = [0, 1, 2, 3, 4]; // Neither the old six lamps nor the new four.
  if (version === 1) corruptLayout.round.remaining = corruptLayout.round.stake;
  const rejected = new PinballRules(corruptLayout);
  assert.equal(rejected.wallet, 980, 'unknown lamp counts cannot trigger a refund');
  assert.equal(rejected.recovered, null);
}

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
const pointSnapshot = readyGame(10, 6, { version: 3, points: 5 });
pointSnapshot.collectPoint(1);
for (const corrupt of [
  { pointTokens: [1, 1] }, { pointTokens: [0] }, { pointTokens: [10] }, { pointTokens: ['1'] },
  { pointTokens: [1.5] }, { pointTokens: null }, { pointsEarned: -1 },
  { pointsEarned: 2 }, { pointsEarned: 0 }, { pointsEarned: Number.MAX_SAFE_INTEGER }
]) {
  const saved = pointSnapshot.serialize();
  Object.assign(saved.round, corrupt);
  const restored = new PinballRules(saved);
  assert.equal(restored.recovered, null, 'corrupt point metadata cannot trigger refunds');
  assert.equal(restored.wallet, 980);
  assert.equal(restored.points, 6);
}
console.log('Rules passed: automatic multiplier, reduced lamp counts and balanced random layouts, locked top-ups, per-ball independent points and duplicate protection, collection-before-launch gate, 1–99 principal, single-shot/card settlement, safe-integer saturation, v1/v2/v3 old-layout migration and point rollback on interrupted rounds.');
