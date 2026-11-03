(function (root) {
  'use strict';

  const LIT_COUNTS = Object.freeze({ 2: 6, 3: 5, 4: 4, 5: 4, 6: 3, 7: 3, 8: 2, 9: 2, 10: 2, 11: 1, 12: 1 });
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
      if (!Number.isInteger(stake) || stake < 5 || stake > 99) return { ok: false, error: '每局请投入 5 到 99 颗整数弹珠' };
      if (this.round && this.round.phase !== 'settled') return { ok: false, error: '请先完成当前回合' };
      if (this.wallet < stake) return { ok: false, error: '口袋里的弹珠不足' };

      const multiplier = 2 + Math.floor(this._random() * 11);
      const lanes = Array.from({ length: 10 }, (_, index) => index);
      for (let index = lanes.length - 1; index > 0; index--) {
        const other = Math.floor(this._random() * (index + 1));
        [lanes[index], lanes[other]] = [lanes[other], lanes[index]];
      }
      this.wallet -= stake;
      this.roundNumber = add(this.roundNumber, 1);
      this._launchedIds.clear();
      this._resolvedIds.clear();
      this.round = {
        stake, multiplier,
        litSlots: lanes.slice(0, LIT_COUNTS[multiplier]).sort((a, b) => a - b),
        remaining: stake, launched: 0, resolved: 0, hits: 0, won: 0,
        cardsAwarded: 0, refunded: 0, phase: 'ready'
      };
      this.recovered = null;
      return { ok: true, round: this.round };
    }

    launchBall(ballId) {
      const round = this.round;
      const key = this._ballKey(ballId);
      if (!round || round.phase === 'settled' || round.remaining <= 0 || key === null || this._launchedIds.has(key)) return false;
      this._launchedIds.add(key);
      round.remaining--;
      round.launched++;
      round.phase = 'playing';
      return true;
    }

    landBall(ballId, slotIndex) {
      const round = this.round;
      const key = this._ballKey(ballId);
      if (!round || round.phase === 'settled' || key === null || !this._launchedIds.has(key) || this._resolvedIds.has(key) || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 9) return rejectedLanding();
      this._resolvedIds.add(key);
      round.resolved++;
      const hit = round.litSlots.includes(slotIndex);
      const reward = hit ? round.multiplier : 0;
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
      if (round.launched !== round.resolved) return { ok: false, refunded: 0, cardsAwarded: 0, error: '请等待台面上的弹珠全部落袋' };
      const refunded = round.remaining;
      this.wallet = add(this.wallet, refunded);
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
      if (this.wallet >= 5) return { ok: false, amount: 0, error: '还有足够的弹珠可以开始游戏' };
      this.wallet = add(this.wallet, 50);
      return { ok: true, amount: 50 };
    }

    serialize() {
      return {
        version: 1,
        wallet: this.wallet, cards: this.cards, bestWin: this.bestWin,
        roundNumber: this.roundNumber, inventory: { ...this.inventory },
        round: this.round ? { ...this.round, litSlots: [...this.round.litSlots] } : null
      };
    }

    _restore(savedState) {
      let saved = savedState;
      if (typeof saved === 'string') {
        try { saved = JSON.parse(saved); } catch { return; }
      }
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
      if (saved.version !== undefined && saved.version !== 1) return;
      this.wallet = integer(saved.wallet, 990);
      this.cards = integer(saved.cards);
      this.bestWin = integer(saved.bestWin);
      this.roundNumber = integer(saved.roundNumber);
      if (saved.inventory && typeof saved.inventory === 'object') {
        for (const prize of PRIZES) this.inventory[prize.id] = integer(saved.inventory[prize.id]);
      }
      const round = saved.round;
      if (!this._validSavedRound(round)) return;
      this.bestWin = Math.max(this.bestWin, round.won);
      // A settled round's rewards are already in the saved balances.
      if (round.phase === 'settled') return;
      // A refresh cannot restore physics. Return all balls which have not landed,
      // while retaining landed rewards and awarding their cards exactly once.
      const refunded = round.stake - round.resolved;
      const cardsAwarded = Math.max(0, Math.floor(round.won / 30) - round.cardsAwarded);
      this.wallet = add(this.wallet, refunded);
      this.cards = add(this.cards, cardsAwarded);
      this.recovered = { refunded, cardsAwarded };
    }

    _validSavedRound(round) {
      if (!round || typeof round !== 'object' || Array.isArray(round)) return false;
      if (!['ready', 'playing', 'settled'].includes(round.phase)) return false;
      const fields = ['stake', 'multiplier', 'remaining', 'launched', 'resolved', 'hits', 'won', 'cardsAwarded'];
      if (!fields.every(field => Number.isSafeInteger(round[field]) && round[field] >= 0)) return false;
      const refunded = round.refunded === undefined ? 0 : round.refunded;
      if (!Number.isInteger(refunded) || refunded < 0 || refunded > round.stake) return false;
      if (round.stake < 5 || round.stake > 99 || round.multiplier < 2 || round.multiplier > 12) return false;
      if (round.launched > round.stake || round.resolved > round.launched || round.hits > round.resolved) return false;
      if (round.remaining !== round.stake - round.launched - refunded || round.won !== round.hits * round.multiplier) return false;
      if (!Array.isArray(round.litSlots) || round.litSlots.length !== LIT_COUNTS[round.multiplier]) return false;
      if (new Set(round.litSlots).size !== round.litSlots.length || !round.litSlots.every(slot => Number.isInteger(slot) && slot >= 0 && slot < 10)) return false;
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
