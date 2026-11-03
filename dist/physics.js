(function (root) {
  'use strict';

  const WIDTH = 600;
  const HEIGHT = 760;
  const STEP = 1 / 180;
  const BALL_RADIUS = 8.5;
  const GRAVITY = 780;
  const VALUES = [10, 20, 50, 100, 200, 200, 100, 50, 20, 10];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  class PinballPhysics {
    constructor(callbacks = {}) {
      this.onPegHit = callbacks.onPegHit || function () {};
      this.onScore = callbacks.onScore || function () {};
      this.onLaunch = callbacks.onLaunch || function () {};
      this.width = WIDTH;
      this.height = HEIGHT;
      this.radius = BALL_RADIUS;
      this.pegs = [];
      let id = 0;
      for (let row = 0; row < 8; row++) {
        const count = row % 2 === 0 ? 9 : 8;
        const start = row % 2 === 0 ? 62 : 90;
        for (let column = 0; column < count; column++) {
          this.pegs.push({ id: id++, x: start + column * 54, y: 170 + row * 60, radius: 6.2, row, column });
        }
      }
      this.slots = VALUES.map((value, index) => ({ x: 40 + index * 48, y: 650, width: 48, height: 80, value, index }));
      this.balls = [];
      this._nextId = 1;
      this._accumulator = 0;
      this.time = 0;
    }

    launch(power = 0.65) {
      if (this.balls.filter(ball => ball.phase !== 'scored').length >= 10) return false;
      const force = clamp(Number(power) || 0, 0, 1);
      const ball = {
        id: this._nextId++, x: 562, y: 704, vx: 0,
        vy: -(980 + force * 340), radius: BALL_RADIUS,
        power: force, phase: 'launch', age: 0, trail: [],
        railProgress: 0, trailClock: 0, hitCooldown: new Map(),
        scored: false, fade: 1, slotIndex: -1, stallTime: 0
      };
      this.balls.push(ball);
      this.onLaunch({ ballId: ball.id, power: force, x: ball.x, y: ball.y });
      return true;
    }

    step(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      this._accumulator += Math.min(dt, 0.12);
      while (this._accumulator >= STEP) {
        this._tick(STEP);
        this._accumulator -= STEP;
      }
    }

    _tick(dt) {
      this.time += dt;
      for (const ball of this.balls) {
        ball.age += dt;
        ball.trailClock += dt;
        if (ball.trailClock >= 1 / 45) {
          ball.trailClock = 0;
          ball.trail.unshift({ x: ball.x, y: ball.y });
          if (ball.trail.length > 12) ball.trail.pop();
        }
        if (ball.phase === 'scored') {
          ball.fade -= dt * 2.5;
          ball.y += 28 * dt;
          continue;
        }
        if (ball.phase === 'launch') {
          ball.vy += GRAVITY * 0.6 * dt;
          ball.y += ball.vy * dt;
          if (ball.y <= 62) {
            ball.y = 62;
            ball.phase = 'rail';
            ball.railSpeed = 2.4 + ball.power * 1.4;
          }
          continue;
        }
        if (ball.phase === 'rail') {
          ball.railProgress = Math.min(1, ball.railProgress + ball.railSpeed * dt);
          const t = ball.railProgress;
          const u = 1 - t;
          // A short guided arch connects the launch chute to the playfield.
          ball.x = u * u * u * 562 + 3 * u * u * t * 562 + 3 * u * t * t * 486 + t * t * t * 486;
          ball.y = u * u * u * 62 + 3 * u * u * t * 9 + 3 * u * t * t * 9 + t * t * t * 66;
          if (t === 1) {
            ball.phase = 'board';
            ball.vx = -(140 + ball.power * 370);
            ball.vy = 62 + ball.power * 32;
          }
          continue;
        }

        ball.vy += GRAVITY * dt;
        // Air resistance is deliberately small; impacts provide most damping.
        ball.vx *= Math.exp(-0.065 * dt);
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
        if (ball.x < 36 + BALL_RADIUS) {
          ball.x = 36 + BALL_RADIUS;
          ball.vx = Math.abs(ball.vx) * 0.7;
        } else if (ball.x > 520 - BALL_RADIUS) {
          ball.x = 520 - BALL_RADIUS;
          ball.vx = -Math.abs(ball.vx) * 0.7;
        }
        if (ball.y < 30 + BALL_RADIUS) {
          ball.y = 30 + BALL_RADIUS;
          ball.vy = Math.abs(ball.vy) * 0.65;
        }

        for (const peg of this.pegs) {
          const dx = ball.x - peg.x;
          const dy = ball.y - peg.y;
          const required = BALL_RADIUS + peg.radius;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared >= required * required) continue;
          const distance = Math.sqrt(distanceSquared);
          const nx = distance > 0.0001 ? dx / distance : 0.7;
          const ny = distance > 0.0001 ? dy / distance : -0.714142;
          ball.x = peg.x + nx * (required + 0.06);
          ball.y = peg.y + ny * (required + 0.06);
          const normalSpeed = ball.vx * nx + ball.vy * ny;
          if (normalSpeed < 0) {
            ball.vx -= (1 + 0.74) * normalSpeed * nx;
            ball.vy -= (1 + 0.74) * normalSpeed * ny;
            // Tiny asymmetric surface impulses prevent balancing on a peg.
            if (Math.abs(nx) < 0.11) ball.vx += Math.sin(ball.id * 9.17 + peg.id * 3.11) * 23 + (ball.id % 2 ? 9 : -9);
            const previousHit = ball.hitCooldown.get(peg.id) ?? -100;
            if (this.time - previousHit > 0.085 && -normalSpeed > 28) {
              ball.hitCooldown.set(peg.id, this.time);
              this.onPegHit({ peg, pegId: peg.id, ballId: ball.id, x: peg.x, y: peg.y, speed: -normalSpeed });
            }
          }
        }

        // Rounded mouths guide the ball into ten separate scoring lanes.
        if (ball.y > 630) {
          for (let divider = 1; divider < 10; divider++) {
            const x = 40 + divider * 48;
            if (ball.y < 649) {
              const dx = ball.x - x;
              const dy = ball.y - 649;
              const radius = BALL_RADIUS + 3;
              if (dx * dx + dy * dy < radius * radius) {
                const length = Math.sqrt(dx * dx + dy * dy) || 1;
                const nx = dx / length;
                const ny = dy / length;
                ball.x = x + nx * (radius + 0.05);
                ball.y = 649 + ny * (radius + 0.05);
                const dot = ball.vx * nx + ball.vy * ny;
                if (dot < 0) {
                  ball.vx -= 1.4 * dot * nx;
                  ball.vy -= 1.4 * dot * ny;
                }
                if (Math.abs(dx) < 0.3) ball.vx += ball.id % 2 ? 17 : -17;
              }
            } else if (Math.abs(ball.x - x) < BALL_RADIUS + 3) {
              const side = ball.x < x ? -1 : 1;
              ball.x = x + side * (BALL_RADIUS + 3.05);
              if (ball.vx * side < 0) ball.vx = -ball.vx * 0.42;
            }
          }
        }

        if (Math.abs(ball.vx) + Math.abs(ball.vy) < 36) ball.stallTime += dt;
        else ball.stallTime = 0;
        if (ball.stallTime > 0.8) {
          ball.vx += ball.id % 2 ? 58 : -58;
          ball.vy = Math.max(ball.vy, 34);
          ball.stallTime = 0;
        }
        if (ball.y >= 710 || ball.age > 20) this._score(ball);
      }
      this.balls = this.balls.filter(ball => ball.fade > 0);
    }

    _score(ball) {
      if (ball.scored) return;
      const slotIndex = clamp(Math.floor((ball.x - 40) / 48), 0, 9);
      const slot = this.slots[slotIndex];
      ball.scored = true;
      ball.phase = 'scored';
      ball.slotIndex = slotIndex;
      ball.x = clamp(ball.x, slot.x + 12, slot.x + slot.width - 12);
      ball.y = 710;
      ball.vx = 0;
      ball.vy = 0;
      this.onScore({ value: slot.value, slotIndex, ballId: ball.id, x: ball.x, y: ball.y });
    }

    reset() {
      this.balls.length = 0;
      this._accumulator = 0;
      this.time = 0;
    }

    getSnapshot() {
      return {
        width: WIDTH, height: HEIGHT, time: this.time,
        balls: this.balls.map(({ id, x, y, vx, vy, radius, phase, power, age, fade, slotIndex, trail }) => ({ id, x, y, vx, vy, radius, phase, power, age, fade, slotIndex, trail: trail.map(point => ({ ...point })) })),
        pegs: this.pegs.map(peg => ({ ...peg })),
        slots: this.slots.map(slot => ({ ...slot }))
      };
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = PinballPhysics;
  root.PinballPhysics = PinballPhysics;
})(typeof window !== 'undefined' ? window : globalThis);
