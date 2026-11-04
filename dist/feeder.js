(function (root) {
  'use strict';

  const WIDTH = 600, HEIGHT = 136;
  const LAUNCH_X = 562, LAUNCH_Y = 78;
  const DROP_TIME = .16, ROLL_TIME = .32;
  const BRANCH_TIME = DROP_TIME + ROLL_TIME;
  const POINT_LIFE = BRANCH_TIME + .22;
  const LAUNCH_LIFE = BRANCH_TIME + .36;
  const FIRST_POINT_DELAY = .26;
  const GATE_DELAY = .11, GATE_TURN_TIME = .12;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  class PinballFeeder {
    constructor(callbacks = {}) {
      this.onCollect = typeof callbacks.onCollect === 'function' ? callbacks.onCollect : function () {};
      this.onReady = typeof callbacks.onReady === 'function' ? callbacks.onReady : function () {};
      this.onComplete = typeof callbacks.onComplete === 'function' ? callbacks.onComplete : function () {};
      this._run = 0;
      this.reset();
    }

    get busy() { return this._busy; }

    start({ count, launchBall = false, pointOffset = 0 } = {}) {
      if (this._busy || !Number.isInteger(count) || count < 1 || count > 99
          || typeof launchBall !== 'boolean' || !Number.isSafeInteger(pointOffset)
          || pointOffset < 0 || pointOffset > Number.MAX_SAFE_INTEGER - count) return false;
      this.reset();
      this._busy = true;
      this._hasLaunch = launchBall;
      const pointCount = count - Number(launchBall);
      // Small batches remain individually readable. Large batches overlap in
      // a continuous stream, but every ball still has its own arrival event.
      const interval = pointCount > 1 ? Math.min(.085, 1 / (pointCount - 1)) : 0;
      for (let index = 0; index < count; index++) {
        const kind = launchBall && index === 0 ? 'launch' : 'point';
        const pointIndex = index - Number(launchBall);
        const born = kind === 'launch' ? 0 : (launchBall ? FIRST_POINT_DELAY : 0) + pointIndex * interval;
        const life = kind === 'launch' ? LAUNCH_LIFE : POINT_LIFE;
        const ball = {
          id: index + 1, kind, born, life, done: false,
          tokenIndex: kind === 'point' ? pointOffset + index + Number(!launchBall) : null,
          lane: kind === 'point' ? (pointIndex % 3) - 1 : 0,
          scale: kind === 'launch' ? 1 : count >= 40 ? .72 : count > 16 ? .9 : 1
        };
        this._balls.push(ball);
        this._events.push({ due: born + life, ball });
      }
      this._events.sort((a, b) => a.due - b.due || a.ball.id - b.ball.id);
      this._duration = this._events[this._events.length - 1].due;
      this._lastEntry = Math.max(...this._balls.map(ball => ball.born)) + DROP_TIME;
      return true;
    }

    step(dt) {
      if (!this._busy || !Number.isFinite(dt) || dt <= 0) return;
      const run = this._run;
      this._elapsed = Math.min(this._duration, this._elapsed + dt);
      while (this._eventIndex < this._events.length && this._events[this._eventIndex].due <= this._elapsed + 1e-10) {
        const { ball } = this._events[this._eventIndex++];
        // Mark before calling out, so repeated frames or a callback-triggered
        // reset can never credit this arrival for a second time.
        ball.done = true;
        if (ball.kind === 'launch') this.onReady();
        else this.onCollect(ball.tokenIndex);
        if (run !== this._run) return;
      }
      if (this._eventIndex === this._events.length) {
        this._busy = false;
        this.onComplete();
      }
    }

    _position(ball) {
      const age = clamp(this._elapsed - ball.born, 0, ball.life);
      let x, y, opacity = 1;
      if (age < DROP_TIME) {
        const fall = (age / DROP_TIME) ** 2;
        x = 48 + 8 * fall;
        y = -12 + 68 * fall;
        // The ball becomes visible as it emerges from the dark inlet, instead
        // of materializing halfway along the trough.
        opacity = clamp((y + 10) / 18, 0, 1);
      } else if (age < BRANCH_TIME) {
        const t = (age - DROP_TIME) / ROLL_TIME;
        const roll = .65 * t + .35 * t * t;
        x = 56 + 204 * roll;
        y = 56 + 14 * roll + ball.lane * 1.9 * Math.sin(Math.PI * roll);
      } else if (ball.kind === 'launch') {
        const t = (age - BRANCH_TIME) / (LAUNCH_LIFE - BRANCH_TIME);
        x = 260 + (LAUNCH_X - 260) * t;
        y = 70 + (LAUNCH_Y - 70) * (2 * t - t * t);
      } else {
        const t = (age - BRANCH_TIME) / (POINT_LIFE - BRANCH_TIME);
        x = 260 + 40 * Math.sin(t * Math.PI / 2);
        y = 70 + 44 * t * t;
        opacity = 1 - clamp((y - 94) / 20, 0, 1);
      }
      return { id: ball.id, kind: ball.kind, x, y, opacity, scale: ball.scale };
    }

    getSnapshot() {
      return {
        busy: this._busy,
        balls: this._balls.filter(ball => !ball.done && this._elapsed >= ball.born).map(ball => this._position(ball)),
        // 0 bridges the hole for the first ball; 1 opens the collection route.
        // Wait until the whole launch ball clears the bridge at x=336, then
        // open it completely before the first point ball reaches the split.
        gate: this._hasLaunch ? clamp((this._elapsed - BRANCH_TIME - GATE_DELAY) / GATE_TURN_TIME, 0, 1) : 1,
        inletOpen: this._busy && this._elapsed <= this._lastEntry,
        elapsed: this._elapsed,
        duration: this._duration
      };
    }

    reset() {
      this._run++;
      this._busy = false;
      this._elapsed = 0;
      this._duration = 0;
      this._lastEntry = 0;
      this._hasLaunch = false;
      this._balls = [];
      this._events = [];
      this._eventIndex = 0;
    }
  }

  PinballFeeder.WIDTH = WIDTH;
  PinballFeeder.HEIGHT = HEIGHT;
  PinballFeeder.LAUNCH_X = LAUNCH_X;
  PinballFeeder.LAUNCH_Y = LAUNCH_Y;
  if (typeof module !== 'undefined' && module.exports) module.exports = PinballFeeder;
  root.PinballFeeder = PinballFeeder;
})(typeof window !== 'undefined' ? window : globalThis);
