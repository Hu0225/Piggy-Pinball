(function (root) {
  'use strict';

  const Feeder = typeof module !== 'undefined' && module.exports ? require('./feeder.js') : root.PinballFeeder;
  const TRAY = Feeder.TRAY;
  const { LEFT, RIGHT, FLOOR, INTAKE_X, floorAt, slopeAt, centerAt } = TRAY;
  const CHUTE = Feeder.CHUTE, INTAKE_Y = Feeder.INTAKE_Y;
  // The feed chute is a real roof over the storage bowl. Its terminal section
  // opens into the diverter, leaving room for a bead to fall from the outlet.
  const ROOF_END = INTAKE_X - 36;
  const GATE_TOP = CHUTE.centerAt(INTAKE_X, 12.5).y - 12.5;
  const topAt = x => x <= ROOF_END ? CHUTE.bottomAt(x) : GATE_TOP;
  const TOP = topAt(LEFT);
  const STEP = 1 / 240, GRAVITY = 1480;
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

  // This independent simulation is only the shallow, open collection tray.
  // Feeder arrival callbacks remain the authority for points and readiness.
  class PinballCollector {
    constructor() { this.reset(); }

    reset() {
      this._balls = [];
      this._queue = [];
      this._ids = new Set();
      this._remainder = 0;
      this._drainWait = 0;
      this._blockedFor = 0;
      this._admitted = 0;
      this._stored = 0;
      this._admitWait = 0;
      this._feedingFor = 0;
      this._drainX = INTAKE_X;
    }

    add({ id, x = INTAKE_X, y = INTAKE_Y, radius = 11, vx = -180, vy = 220 } = {}) {
      if ((typeof id !== 'number' && typeof id !== 'string') || (typeof id === 'number' && !Number.isFinite(id)) || this._ids.has(id)
          || ![x, y, radius, vx, vy].every(Number.isFinite)
          || radius < 4 || radius > 12.5) return false;
      this._ids.add(id);
      this._feedingFor = .3;
      const entryX = clamp(x, LEFT + radius, RIGHT - radius);
      const dropHeight = Math.max(0, centerAt(entryX, radius).y - y);
      const fallTime = (Math.sqrt(vy * vy + 2 * GRAVITY * dropHeight) - vy) / GRAVITY;
      this._drainX = clamp(entryX + vx * fallTime, LEFT + radius, RIGHT - radius);
      this._queue.push({
        id, radius, x: entryX,
        y: clamp(y, topAt(entryX) + radius, centerAt(entryX, radius).y),
        vx: clamp(vx, -220, 220), vy: clamp(vy, 50, 400)
      });
      return true;
    }

    tryAdd(ball = {}) {
      const { id, x = INTAKE_X, y = INTAKE_Y, radius = 11, vx = -180, vy = 220 } = ball;
      if ((typeof id !== 'number' && typeof id !== 'string') || (typeof id === 'number' && !Number.isFinite(id)) || this._ids.has(id)
          || ![x, y, radius, vx, vy].every(Number.isFinite) || radius < 4 || radius > 12.5) return false;
      const entryX = clamp(x, LEFT + radius, RIGHT - radius);
      const entryY = clamp(y, topAt(entryX) + radius, centerAt(entryX, radius).y);
      // The feeder holds this visible bead at the diverter when the throat
      // backs up. A refusal never consumes its identity or hides it in a queue.
      this._feedingFor = .3;
      if (this._queue.length || this._admitWait > 0
          || this._balls.filter(item => !item.draining).length >= this._targetCount() + 2
          || this._balls.some(item => Math.hypot(entryX - item.x, entryY - item.y) < radius + item.radius + .2)) return false;
      if (!this.add(ball)) return false;
      const accepted = this._admit();
      if (accepted) this._feedingFor = 0;
      return accepted;
    }

    step(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      this._remainder += Math.min(dt, 60);
      const steps = Math.floor((this._remainder + 1e-10) / STEP);
      this._remainder = Math.max(0, this._remainder - steps * STEP);
      for (let n = 0; n < steps; n++) this._step();
    }

    _targetCount() {
      const active = this._balls.filter(b => !b.draining);
      const samples = active.length ? active : this._queue;
      const radius = samples.length ? samples.reduce((sum, b) => sum + b.radius, 0) / samples.length : 11;
      // This is an upper capacity, not a target filled by relocating beads.
      // A crowded outlet may open the drain before the full capacity is used.
      // Stake size never shrinks the balls or changes this limit.
      return Math.min(28, Math.max(8, Math.floor((RIGHT - LEFT) / (2 * radius) * 1.27)));
    }

    _admit() {
      if (this._admitWait > 0) return false;
      while (this._queue.length) {
        const next = this._queue[0], r = next.radius;
        const active = this._balls.filter(ball => !ball.draining).length;
        if (active >= this._targetCount() + 2) break;
        // Transfer at exactly the chute outlet, including its velocity. Wait
        // for a clear throat rather than inserting a bead into the pile.
        if (this._balls.some(ball => Math.hypot(next.x - ball.x, next.y - ball.y) < r + ball.radius + .2)) break;
        this._balls.push({ ...next, draining: false });
        this._queue.shift();
        this._admitted++;
        // Background completion may enqueue a whole handful at once. Meter
        // these insertions so contacts have time to move the existing pile.
        this._admitWait = .08;
        return true;
      }
    }

    _startDrain() {
      if (this._drainWait > 0) return;
      const active = this._balls.filter(b => !b.draining);
      const target = this._targetCount();
      // Backpressure in the fixed outlet also opens the concealed bottom
      // drain. This lets the existing pile settle before another bead enters.
      const pressure = (this._queue.length || this._feedingFor > 0) && active.length > 12
        && active.some(ball => Math.hypot(ball.x - INTAKE_X, ball.y - INTAKE_Y) < ball.radius + 28);
      const blocked = this._queue.length && this._blockedFor > .28 && active.length > 12;
      if (active.length <= target && !pressure && !blocked) return;
      const lowest = active.filter(b => b.y >= centerAt(b.x, b.radius).y - .8)
        .sort((a, b) => Math.abs(a.x - this._drainX) - Math.abs(b.x - this._drainX) || b.y - a.y)[0];
      if (!lowest) return;
      // It keeps colliding while sinking. The front lip conceals the exit.
      lowest.draining = true;
      lowest.vy = Math.max(400, lowest.vy);
      this._drainWait = .04;
    }

    _bounds(ball, bounce) {
      const r = ball.radius;
      if (ball.x < LEFT + r) { ball.x = LEFT + r; if (bounce && ball.vx < 0) ball.vx *= -.13; }
      if (ball.x > RIGHT - r) { ball.x = RIGHT - r; if (bounce && ball.vx > 0) ball.vx *= -.13; }
      const top = topAt(ball.x) + r;
      if (ball.y < top) { ball.y = top; if (bounce && ball.vy < 0) ball.vy = 0; }
      // A round contact at the end of the solid chute roof prevents lower
      // beads from clipping its corner while the open throat remains clear.
      if (ball.x > ROOF_END && ball.x < ROOF_END + r) {
        const dx = ball.x - ROOF_END, dy = ball.y - CHUTE.bottomAt(ROOF_END);
        const distance = Math.hypot(dx, dy);
        if (distance < r) {
          const nx = distance > 1e-8 ? dx / distance : 1, ny = distance > 1e-8 ? dy / distance : 0;
          ball.x = ROOF_END + nx * r; ball.y = CHUTE.bottomAt(ROOF_END) + ny * r;
          const normal = ball.vx * nx + ball.vy * ny;
          if (bounce && normal < 0) { ball.vx -= normal * nx; ball.vy -= normal * ny; }
        }
      }
      const contact = centerAt(ball.x, r), floor = contact.y;
      if (!ball.draining && ball.y > floor) {
        ball.y = floor;
        const { nx, ny } = contact;
        const normal = ball.vx * nx + ball.vy * ny;
        if (bounce && normal < 0) {
          const impulse = -(normal < -30 ? 1.13 : 1) * normal;
          ball.vx += impulse * nx; ball.vy += impulse * ny;
        }
      }
    }

    _contacts(velocity) {
      for (let i = 0; i < this._balls.length; i++) {
        const a = this._balls[i];
        for (let j = i + 1; j < this._balls.length; j++) {
          const b = this._balls[j];
          const dx = b.x - a.x, dy = b.y - a.y, minimum = a.radius + b.radius;
          const distance = Math.hypot(dx, dy);
          if (distance >= minimum) continue;
          const nx = distance > 1e-8 ? dx / distance : 1;
          const ny = distance > 1e-8 ? dy / distance : 0;
          const invA = 1 / (a.radius * a.radius), invB = 1 / (b.radius * b.radius), invSum = invA + invB;
          const correction = (minimum - distance) / invSum;
          a.x -= nx * correction * invA; a.y -= ny * correction * invA;
          b.x += nx * correction * invB; b.y += ny * correction * invB;
          if (!velocity) continue;
          const normal = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (normal >= 0) continue;
          const impulse = -(1 + (normal < -30 ? .12 : 0)) * normal / invSum;
          a.vx -= impulse * nx * invA; a.vy -= impulse * ny * invA;
          b.vx += impulse * nx * invB; b.vy += impulse * ny * invB;
          const tangent = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;
          const friction = clamp(-tangent / invSum, -impulse * .28, impulse * .28);
          a.vx -= friction * -ny * invA; a.vy -= friction * nx * invA;
          b.vx += friction * -ny * invB; b.vy += friction * nx * invB;
        }
      }
    }

    _step() {
      this._drainWait = Math.max(0, this._drainWait - STEP);
      this._admitWait = Math.max(0, this._admitWait - STEP);
      this._feedingFor = Math.max(0, this._feedingFor - STEP);
      const entered = this._admit();
      this._blockedFor = this._queue.length && !entered ? this._blockedFor + STEP : 0;
      this._startDrain();
      const drag = Math.exp(-.7 * STEP);
      for (const ball of this._balls) {
        ball.vx *= drag;
        ball.vy = ball.vy * drag + GRAVITY * STEP;
        ball.x += ball.vx * STEP; ball.y += ball.vy * STEP;
        this._bounds(ball, true);
      }
      // Extra position recovery is needed only when a bead enters a crowded
      // mouth; ordinary frames retain the lightweight contact budget.
      for (let pass = 0; pass < (entered ? 256 : 48); pass++) {
        this._contacts(pass < 3);
        for (const ball of this._balls) this._bounds(ball, pass < 3);
      }
      this._balls = this._balls.filter(ball => {
        if (ball.draining && ball.y - ball.radius > floorAt(ball.x) + 1) { this._stored++; return false; }
        return true;
      });
    }

    getSnapshot() {
      return {
        balls: this._balls.map(ball => ({ ...ball, opacity: 1 })),
        pending: this._queue.length, admitted: this._admitted, stored: this._stored,
        total: this._ids.size
      };
    }
  }

  Object.assign(PinballCollector, { LEFT, RIGHT, TOP, FLOOR, INTAKE_X, INTAKE_Y, MOUTH_LEFT: ROOF_END, floorAt, slopeAt, centerAt, topAt });
  if (typeof module !== 'undefined' && module.exports) module.exports = PinballCollector;
  root.PinballCollector = PinballCollector;
})(typeof window !== 'undefined' ? window : globalThis);
