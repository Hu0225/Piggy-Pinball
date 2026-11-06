(function (root) {
  'use strict';

  const LIT_COUNTS = Object.freeze({ 2: 4, 3: 3, 4: 2, 5: 2, 6: 2, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1 });
  const LEGACY_LIT_COUNTS = Object.freeze({ 2: 6, 3: 5, 4: 4, 5: 4, 6: 3, 7: 3, 8: 2, 9: 2, 10: 2, 11: 1, 12: 1 });
  const PRIZES = Object.freeze([
    Object.freeze({ id: 'sticker', name: '小猪贴纸', cost: 1, icon: '✿' }),
    Object.freeze({ id: 'charm', name: '好运挂件', cost: 3, icon: '✦' }),
    Object.freeze({ id: 'piggy', name: '小猪公仔', cost: 6, icon: '♧' }),
    Object.freeze({ id: 'trophy', name: '潮弹达人奖杯', cost: 12, icon: '★' })
  ]);
  const integer = (value, fallback = 0) => Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  const add = (left, right) => Math.min(Number.MAX_SAFE_INTEGER, left + right);
  const rejectedLanding = () => ({ accepted: false, hit: false, reward: 0, settled: false, cardsAwarded: 0 });

  class PinballRules {
    constructor(savedState, randomFn = Math.random) {
      this._randomFn = typeof randomFn === 'function' ? randomFn : Math.random;
      this._launchedIds = new Set();
      this._resolvedIds = new Set();
      this.wallet = 990;
      this.cards = 0;
      this.points = 0;
      this.bestWin = 0;
      this.roundNumber = 0;
      this.round = null;
      this.inventory = Object.fromEntries(PRIZES.map(prize => [prize.id, 0]));
      this.recovered = null;
      this._restore(savedState);
    }

    _random() {
      let value;
      try { value = Number(this._randomFn()); } catch { value = 0.5; }
      return Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0.5;
    }

    _ballKey(ballId) {
      if (typeof ballId === 'number' && Number.isSafeInteger(ballId) && ballId >= 0) return String(ballId);
      if (typeof ballId === 'string' && ballId.trim().length > 0 && ballId.length <= 128) return ballId.trim();
      return null;
    }

    startRound(stake) {
      if (!Number.isInteger(stake) || stake < 1 || stake > 99) return { ok: false, error: '每局本金为 1 到 99 颗整数弹珠' };
      if (this.round && this.round.phase !== 'settled') return { ok: false, error: '请先完成当前回合' };
      if (this.wallet < stake) return { ok: false, error: '口袋里的弹珠不足' };

      this.wallet -= stake;
      this.roundNumber = add(this.roundNumber, 1);
      this._launchedIds.clear();
      this._resolvedIds.clear();
      this.round = {
        stake, multiplier: null, litSlots: [],
        remaining: 1, launched: 0, resolved: 0, hits: 0, won: 0,
        cardsAwarded: 0, refunded: 0, pointsEarned: 0, pointTokens: [], phase: 'activated'
      };
      this.recovered = null;
      // The first deposit activates the round and locks its targets immediately.
      // Later deposits only increase the same round's principal.
      return this.drawMultiplier();
    }

    addStake(amount) {
      const round = this.round;
      if (!round || !['activated', 'ready'].includes(round.phase)) return { ok: false, error: '只能在发射前加注' };
      if (!Number.isInteger(amount) || amount < 1 || amount > 99) return { ok: false, error: '请投入 1 到 99 颗整数弹珠' };
      if (round.stake + amount > 99) return { ok: false, error: `本局最多还能投入 ${99 - round.stake} 颗` };
      if (this.wallet < amount) return { ok: false, error: '口袋里的弹珠不足' };
      this.wallet -= amount;
      round.stake += amount;
      return { ok: true, round };
    }

    drawMultiplier() {
      const round = this.round;
      if (!round || round.phase !== 'activated') return { ok: false, error: '先投入弹珠激活游戏，每局只能抽取一次倍率' };
      const multiplier = 2 + Math.floor(this._random() * 11);
      const count = LIT_COUNTS[multiplier];
      // Balanced circular gaps prevent clusters; a random rotation gives every
      // lane the same chance of lighting without fixing the two edge lanes.
      const gaps = Array.from({ length: count }, (_, index) => Math.floor(10 / count) + (index < 10 % count ? 1 : 0));
      for (let index = gaps.length - 1; index > 0; index--) {
        const other = Math.floor(this._random() * (index + 1));
        [gaps[index], gaps[other]] = [gaps[other], gaps[index]];
      }
      let lane = Math.floor(this._random() * 10);
      const lanes = gaps.map(gap => {
        const current = lane;
        lane = (lane + gap) % 10;
        return current;
      });
      round.multiplier = multiplier;
      round.litSlots = lanes.sort((a, b) => a - b);
      round.phase = 'ready';
      return { ok: true, round };
    }

    collectPoint(tokenIndex) {
      const round = this.round;
      if (!round || round.phase !== 'ready' || !Number.isInteger(tokenIndex)
          || tokenIndex < 1 || tokenIndex >= round.stake || round.pointTokens.includes(tokenIndex)) {
        return { ok: false, pointsAdded: 0 };
      }
      // Credit only when a particular deposited ball crosses the collection
      // opening. A duplicate animation callback can never award it twice.
      round.pointTokens.push(tokenIndex);
      const previous = this.points;
      this.points = add(this.points, 1);
      const pointsAdded = this.points - previous;
      round.pointsEarned += pointsAdded;
      return { ok: true, pointsAdded };
    }

    launchBall(ballId) {
      const round = this.round;
      const key = this._ballKey(ballId);
      if (!round || round.phase !== 'ready' || round.remaining !== 1 || round.launched !== 0 || key === null || this._launchedIds.has(key)) return false;
      if (round.pointTokens.length !== round.stake - 1) return false;
      this._launchedIds.add(key);
      round.remaining--;
      round.launched++;
      round.phase = 'playing';
      return true;
    }

    landBall(ballId, slotIndex) {
      const round = this.round;
      const key = this._ballKey(ballId);
      if (!round || round.phase !== 'playing' || key === null || !this._launchedIds.has(key) || this._resolvedIds.has(key) || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 9) return rejectedLanding();
      this._resolvedIds.add(key);
      round.resolved++;
      const hit = round.litSlots.includes(slotIndex);
      const reward = hit ? round.stake * round.multiplier : 0;
      if (hit) {
        round.hits++;
        round.won += reward;
        this.wallet = add(this.wallet, reward);
        this.bestWin = Math.max(this.bestWin, round.won);
      }
      const settled = round.remaining === 0 && round.resolved === round.launched;
      const cardsAwarded = settled ? this._settle() : 0;
      return { accepted: true, hit, reward, settled, cardsAwarded };
    }

    _settle() {
      const round = this.round;
      if (!round || round.phase === 'settled') return 0;
      const earned = Math.floor(round.won / 30);
      const additional = Math.max(0, earned - round.cardsAwarded);
      this.cards = add(this.cards, additional);
      round.cardsAwarded = earned;
      round.phase = 'settled';
      this.bestWin = Math.max(this.bestWin, round.won);
      return additional;
    }

    clearRound() {
      if (this.round && this.round.phase !== 'settled') return false;
      this.round = null;
      this._launchedIds.clear();
      this._resolvedIds.clear();
      return true;
    }

    newRound() { return this.clearRound(); }

    refundUnlaunched() {
      const round = this.round;
      if (!round || round.phase === 'settled') return { ok: false, refunded: 0, cardsAwarded: 0, error: '没有可以结束的回合' };
      if (!['activated', 'ready'].includes(round.phase) || round.launched !== 0) return { ok: false, refunded: 0, cardsAwarded: 0, error: '已经发射，请等待本局结算' };
      const refunded = round.stake;
      this.wallet = add(this.wallet, refunded);
      this.points -= round.pointsEarned;
      round.pointsEarned = 0;
      round.refunded = refunded;
      round.remaining = 0;
      const cardsAwarded = this._settle();
      return { ok: true, refunded, cardsAwarded };
    }

    redeem(prizeId) {
      const prize = PRIZES.find(item => item.id === prizeId);
      if (!prize) return { ok: false, error: '没有找到这件礼品' };
      if (this.cards < prize.cost) return { ok: false, error: `还差 ${prize.cost - this.cards} 张积分卡` };
      this.cards -= prize.cost;
      this.inventory[prize.id] = add(this.inventory[prize.id], 1);
      return { ok: true, prize: { ...prize }, count: this.inventory[prize.id] };
    }

    getRescue() {
      if (this.round && this.round.phase !== 'settled') return { ok: false, amount: 0, error: '请先完成当前回合' };
      if (this.wallet >= 1) return { ok: false, amount: 0, error: '还有足够的弹珠可以开始游戏' };
      this.wallet = add(this.wallet, 50);
      return { ok: true, amount: 50 };
    }

    serialize() {
      return {
        version: 3,
        wallet: this.wallet, cards: this.cards, points: this.points, bestWin: this.bestWin,
        roundNumber: this.roundNumber, inventory: { ...this.inventory },
        round: this.round ? { ...this.round, litSlots: [...this.round.litSlots], pointTokens: [...this.round.pointTokens] } : null
      };
    }

    _restore(savedState) {
      let saved = savedState;
      if (typeof saved === 'string') {
        try { saved = JSON.parse(saved); } catch { return; }
      }
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
      if (saved.version !== undefined && saved.version !== 1 && saved.version !== 2 && saved.version !== 3) return;
      this.wallet = integer(saved.wallet, 990);
      this.cards = integer(saved.cards);
      this.points = saved.version === 3 ? integer(saved.points) : 0;
      this.bestWin = integer(saved.bestWin);
      this.roundNumber = integer(saved.roundNumber);
      if (saved.inventory && typeof saved.inventory === 'object') {
        for (const prize of PRIZES) this.inventory[prize.id] = integer(saved.inventory[prize.id]);
      }
      const round = saved.round;
      const legacy = saved.version !== 2 && saved.version !== 3;
      if (!(legacy ? this._validLegacyRound(round) : this._validSavedRound(round))) return;
      if (saved.version === 3 && !this._validPointRound(round)) return;
      this.bestWin = Math.max(this.bestWin, round.won);
      // A settled round's rewards are already in the saved balances.
      if (round.phase === 'settled') return;
      // Physics cannot resume after a reload. Refund the entire unresolved
      // single-shot principal; old multi-ball saves retain their partial wins.
      const refunded = legacy ? round.stake - round.resolved : round.stake;
      const cardsAwarded = legacy ? Math.max(0, Math.floor(round.won / 30) - round.cardsAwarded) : 0;
      this.wallet = add(this.wallet, refunded);
      this.cards = add(this.cards, cardsAwarded);
      // Keep completed rounds' independent points, but roll back the points of
      // an unresolved round whose principal is being returned on recovery.
      if (saved.version === 3) this.points -= round.pointsEarned;
      this.recovered = { refunded, cardsAwarded };
    }

    _validPointRound(round) {
      const tokens = round.pointTokens;
      if (!Array.isArray(tokens) || tokens.length > round.stake - 1
          || new Set(tokens).size !== tokens.length
          || !tokens.every(token => Number.isInteger(token) && token >= 1 && token < round.stake)) return false;
      if (!Number.isSafeInteger(round.pointsEarned) || round.pointsEarned < 0
          || round.pointsEarned > tokens.length || round.pointsEarned > this.points) return false;
      if (round.refunded > 0) return round.pointsEarned === 0;
      if (round.phase === 'activated' && tokens.length !== 0) return false;
      if (round.launched === 1 && tokens.length !== round.stake - 1) return false;
      return this.points === Number.MAX_SAFE_INTEGER || round.pointsEarned === tokens.length;
    }

    _validSavedRound(round) {
      if (!round || typeof round !== 'object' || Array.isArray(round)) return false;
      if (!['activated', 'ready', 'playing', 'settled'].includes(round.phase)) return false;
      const fields = ['stake', 'remaining', 'launched', 'resolved', 'hits', 'won', 'cardsAwarded', 'refunded'];
      if (!fields.every(field => Number.isSafeInteger(round[field]) && round[field] >= 0)) return false;
      if (round.stake < 1 || round.stake > 99 || round.launched > 1 || round.resolved > round.launched || round.hits > round.resolved) return false;
      const undrawn = round.multiplier === null;
      if (!Array.isArray(round.litSlots)) return false;
      if (undrawn) {
        if (round.litSlots.length !== 0 || !['activated', 'settled'].includes(round.phase) || round.launched !== 0) return false;
      } else if (!Number.isInteger(round.multiplier) || round.multiplier < 2 || round.multiplier > 12 || !this._validLanes(round)) return false;
      if (round.won !== round.hits * round.stake * (round.multiplier || 0)) return false;
      if (round.phase === 'settled') {
        const canceled = round.refunded === round.stake && round.launched === 0;
        const landed = round.refunded === 0 && round.launched === 1 && round.resolved === 1;
        return (canceled || landed) && round.remaining === 0 && round.resolved === round.launched && round.cardsAwarded === Math.floor(round.won / 30);
      }
      if (round.refunded !== 0 || round.cardsAwarded !== 0 || round.resolved !== 0 || round.won !== 0) return false;
      if (round.phase === 'activated') return undrawn && round.remaining === 1 && round.launched === 0;
      if (round.phase === 'ready') return !undrawn && round.remaining === 1 && round.launched === 0;
      return !undrawn && round.remaining === 0 && round.launched === 1;
    }

    _validLanes(round) {
      // Old layouts remain valid for recovery, including their original counts
      // and adjacent lamps. An interrupted saved round must still be refunded.
      return Array.isArray(round.litSlots)
        && [LIT_COUNTS[round.multiplier], LEGACY_LIT_COUNTS[round.multiplier]].includes(round.litSlots.length)
        && new Set(round.litSlots).size === round.litSlots.length
        && round.litSlots.every(slot => Number.isInteger(slot) && slot >= 0 && slot < 10);
    }

    _validLegacyRound(round) {
      if (!round || typeof round !== 'object' || Array.isArray(round)) return false;
      if (!['ready', 'playing', 'settled'].includes(round.phase)) return false;
      const fields = ['stake', 'multiplier', 'remaining', 'launched', 'resolved', 'hits', 'won', 'cardsAwarded'];
      if (!fields.every(field => Number.isSafeInteger(round[field]) && round[field] >= 0)) return false;
      const refunded = round.refunded === undefined ? 0 : round.refunded;
      if (!Number.isInteger(refunded) || refunded < 0 || refunded > round.stake) return false;
      if (round.stake < 5 || round.stake > 99 || round.multiplier < 2 || round.multiplier > 12) return false;
      if (round.launched > round.stake || round.resolved > round.launched || round.hits > round.resolved) return false;
      if (round.remaining !== round.stake - round.launched - refunded || round.won !== round.hits * round.multiplier) return false;
      if (!this._validLanes(round)) return false;
      if (round.phase === 'settled') return round.remaining === 0 && round.resolved === round.launched && round.cardsAwarded === Math.floor(round.won / 30);
      if (refunded !== 0 || round.cardsAwarded !== 0) return false;
      if (round.phase === 'ready' && (round.launched !== 0 || round.resolved !== 0)) return false;
      return true;
    }
  }

  PinballRules.PRIZES = PRIZES;
  PinballRules.LIT_COUNTS = LIT_COUNTS;
  if (typeof module !== 'undefined' && module.exports) module.exports = PinballRules;
  root.PinballRules = PinballRules;
})(typeof window !== 'undefined' ? window : globalThis);
