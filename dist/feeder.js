(function (root) {
  'use strict';

  const WIDTH = 600, HEIGHT = 136;
  const LAUNCH_X = 562, LAUNCH_Y = 78;
  const DROP_TIME = .16, ROLL_TIME = .95;
  const BRANCH_TIME = DROP_TIME + ROLL_TIME;
  const POINT_LIFE = BRANCH_TIME + .02;
  const POINT_HANDOFF = BRANCH_TIME;
  const LAUNCH_LIFE = BRANCH_TIME + .22;
  const FIRST_POINT_DELAY = .26;
  const GATE_DELAY = .10, GATE_TURN_TIME = .08;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  // The flat storage floor is separate from the elevated curved chute.
  const LEFT = 32, RIGHT = 526, FLOOR = 126;
  const floorAt = () => FLOOR;
  const slopeAt = () => 0;
  const centerAt = (x, radius) => ({ x, y: FLOOR - radius,
    contactX: x, contactY: FLOOR, nx: 0, ny: -1 });
  const CHUTE_LEFT = 56, CHUTE_RIGHT = 476, CHUTE_SPAN = CHUTE_RIGHT - CHUTE_LEFT;
  const chuteFloorAt = x => {
    // Continue the curve to the left for normal contact at the inlet. The
    // outlet is flat, so neither side introduces a discontinuous contact.
    const t = Math.min(1, (x - CHUTE_LEFT) / CHUTE_SPAN);
    return 43 + 26 * (2 * t - t * t);
  };
  const chuteSlopeAt = x => x >= CHUTE_RIGHT ? 0 : 52 * (1 - (x - CHUTE_LEFT) / CHUTE_SPAN) / CHUTE_SPAN;
  const chuteCenterAt = (x, radius) => {
    // Invert the normal offset because x denotes the bead centre rather than
    // its contact point on the curved surface.
    let contactX = x;
    for (let i = 0; i < 6; i++) {
      const slope = chuteSlopeAt(contactX);
      contactX = x - radius * slope / Math.hypot(1, slope);
    }
    const slope = chuteSlopeAt(contactX), length = Math.hypot(1, slope);
    const contactY = chuteFloorAt(contactX);
    return { x, y: contactY - radius / length, contactX, contactY,
      nx: slope / length, ny: -1 / length };
  };
  const CHUTE = Object.freeze({ LEFT: CHUTE_LEFT, RIGHT: CHUTE_RIGHT,
    floorAt: chuteFloorAt, slopeAt: chuteSlopeAt, centerAt: chuteCenterAt,
    bottomAt: x => chuteFloorAt(x) + 6 });
  const INTAKE_X = CHUTE.RIGHT, INTAKE_Y = CHUTE.centerAt(INTAKE_X, 11).y;
  const TRAY = Object.freeze({ LEFT, RIGHT, FLOOR, INTAKE_X, floorAt, slopeAt, centerAt, topAt: x => floorAt(x) - 54 });
  const launchPoint = progress => {
    const t = clamp(progress, 0, 1), start = CHUTE.centerAt(INTAKE_X, 8.5);
    const span = LAUNCH_X - INTAKE_X, tangent = CHUTE.slopeAt(start.contactX) * span;
    const t2 = t * t, t3 = t2 * t;
    return { x: INTAKE_X + span * t,
      y: (2 * t3 - 3 * t2 + 1) * start.y + (t3 - 2 * t2 + t) * tangent + (-2 * t3 + 3 * t2) * LAUNCH_Y };
  };

  class PinballFeeder {
    constructor(callbacks = {}) {
      this.onCollect = typeof callbacks.onCollect === 'function' ? callbacks.onCollect : function () {};
      this.onDrop = typeof callbacks.onDrop === 'function' ? callbacks.onDrop : function () {};
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
      // Keep the physical bead size at every stake. A full handful takes a
      // little longer instead of becoming a stream of miniature beads.
      const interval = pointCount > 1 ? .085 : 0;
      for (let index = 0; index < count; index++) {
        const kind = launchBall && index === 0 ? 'launch' : 'point';
        const pointIndex = index - Number(launchBall);
        const born = kind === 'launch' ? 0 : (launchBall ? FIRST_POINT_DELAY : 0) + pointIndex * interval;
        const life = kind === 'launch' ? LAUNCH_LIFE : POINT_LIFE;
        const ball = {
          id: index + 1, kind, born, life, done: false,
          tokenIndex: kind === 'point' ? pointOffset + index + Number(!launchBall) : null,
          lane: kind === 'point' ? (pointIndex % 3) - 1 : 0,
          scale: 1
        };
        this._balls.push(ball);
        if (kind === 'point') this._events.push({ due: born + POINT_HANDOFF, ball, type: 'drop' });
        this._events.push({ due: born + life, ball, type: 'arrival' });
      }
      this._events.sort((a, b) => a.due - b.due || a.ball.id - b.ball.id);
      this._duration = this._events[this._events.length - 1].due;
      this._lastEntry = Math.max(...this._balls.map(ball => ball.born)) + DROP_TIME;
      return true;
    }

    step(dt) {
      if (!this._busy || !Number.isFinite(dt) || dt <= 0) return;
      const run = this._run;
      const target = Math.min(this._duration, this._elapsed + dt);
      while (this._eventIndex < this._events.length && this._events[this._eventIndex].due <= target + 1e-10) {
        const { ball, type, due } = this._events[this._eventIndex];
        this._elapsed = due;
        if (type === 'drop') {
          // The right diverter slows the bead and directs it down through the
          // open chute outlet; the storage simulation owns the fall from here.
          const accepted = this.onDrop({ ...this._position(ball, POINT_HANDOFF), id: ball.tokenIndex,
            radius: 11, vx: -180, vy: 220 });
          if (run !== this._run) return;
          // A full outlet holds the entire feed line at this instant. The
          // collector keeps moving independently until it accepts this bead.
          // Undefined remains acceptance for existing notification callbacks.
          if (accepted === false) return;
          ball.handedOff = true;
          this._eventIndex++;
          continue;
        }
        // Mark before calling out, so repeated frames or a callback-triggered
        // reset can never credit this arrival for a second time.
        this._eventIndex++;
        ball.done = true;
        if (ball.kind === 'launch') this.onReady();
        else this.onCollect(ball.tokenIndex);
        if (run !== this._run) return;
      }
      this._elapsed = target;
      if (this._eventIndex === this._events.length) {
        this._busy = false;
        this.onComplete();
      }
    }

    _position(ball, age = clamp(this._elapsed - ball.born, 0, ball.life)) {
      let x, y, opacity = 1;
      const radius = ball.kind === 'launch' ? 8.5 : 11;
      if (age < DROP_TIME) {
        const fall = (age / DROP_TIME) ** 2;
        x = 48 + 8 * fall;
        y = -12 + (CHUTE.centerAt(CHUTE.LEFT, radius).y + 12) * fall;
        // The ball becomes visible as it emerges from the dark inlet, instead
        // of materializing halfway along the trough.
        opacity = clamp((y + 10) / 18, 0, 1);
      } else if (age < BRANCH_TIME) {
        const t = (age - DROP_TIME) / ROLL_TIME;
        const roll = .65 * t + .35 * t * t;
        x = CHUTE.LEFT + (INTAKE_X - CHUTE.LEFT) * roll;
        y = CHUTE.centerAt(x, radius).y;
      } else if (ball.kind === 'launch') {
        const t = (age - BRANCH_TIME) / (LAUNCH_LIFE - BRANCH_TIME);
        ({ x, y } = launchPoint(t));
      } else {
        x = INTAKE_X;
        y = INTAKE_Y;
      }
      return { id: ball.id, kind: ball.kind, x, y, opacity, scale: ball.scale };
    }

    getSnapshot() {
      return {
        busy: this._busy,
        balls: this._balls.filter(ball => !ball.done && !ball.handedOff && this._elapsed >= ball.born).map(ball => this._position(ball)),
        // The right-hand diverter clears the first bead before switching to
        // the downward outlet above the stored pile.
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
  Object.assign(PinballFeeder, { INTAKE_X, INTAKE_Y, BRANCH_TIME, TRAY, CHUTE, launchPoint });
  if (typeof module !== 'undefined' && module.exports) module.exports = PinballFeeder;
  root.PinballFeeder = PinballFeeder;
})(typeof window !== 'undefined' ? window : globalThis);
