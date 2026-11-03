(function (root) {
  'use strict';

  const WIDTH = 600;
  const HEIGHT = 760;
  const STEP = 1 / 180;
  const BALL_RADIUS = 8.5;
  const GRAVITY = 780;
  const EXIT_SPEED_MIN = 12;
  const EXIT_SPEED_RANGE = 928;
  const PEG_RESTITUTION = 0.15;
  const LIP_RESTITUTION = 0.05;
  const CONTACT_DAMPING = 0.15;
  const LAUNCH_RAIL = Object.freeze({
    centerX: 506, centerY: 112, radius: 56, halfWidth: 14,
    angle: Math.PI / 2, startX: 562, startY: 112, exitX: 506, exitY: 56
  });
  const VALUES = [10, 20, 50, 100, 200, 200, 100, 50, 20, 10];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  class PinballPhysics {
    constructor(callbacks = {}) {
      this.onPegHit = callbacks.onPegHit || function () {};
      this.onImpact = callbacks.onImpact || function () {};
      this.onScore = callbacks.onScore || function () {};
      this.onLaunch = callbacks.onLaunch || function () {};
      this.width = WIDTH;
      this.height = HEIGHT;
      this.radius = BALL_RADIUS;
      this.pegs = [];
      let id = 0;
      // Preserve the original staggered playfield, including pin positions,
      // spacing and radii. Repeatability comes from deterministic contacts.
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
      // Spring energy pays for the climb first. The remaining exit speed is
      // linear in the user's power; the rail still conserves that energy.
      const exitSpeed = EXIT_SPEED_MIN + force * EXIT_SPEED_RANGE;
      const ball = {
        id: this._nextId++, x: LAUNCH_RAIL.startX, y: 704, vx: 0,
        vy: -Math.sqrt(2 * GRAVITY * (704 - LAUNCH_RAIL.exitY) + exitSpeed * exitSpeed), radius: BALL_RADIUS,
        power: force, phase: 'launch', age: 0, trail: [],
        railAngle: 0, trailClock: 0, hitCooldown: new Map(),
        scored: false, fade: 1, slotIndex: -1
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

    _advanceLaunch(ball, dt) {
      const speed = -ball.vy;
      const distance = ball.y - LAUNCH_RAIL.startY;
      const entrySpeed = Math.sqrt(Math.max(0, speed * speed - 2 * GRAVITY * distance));
      const arrival = 2 * distance / (speed + entrySpeed);
      if (arrival > dt) {
        ball.y += ball.vy * dt + 0.5 * GRAVITY * dt * dt;
        ball.vy += GRAVITY * dt;
        return 0;
      }
      ball.x = LAUNCH_RAIL.startX;
      ball.y = LAUNCH_RAIL.startY;
      ball.vy = -entrySpeed;
      ball.railEntrySpeed = entrySpeed;
      ball.railAngle = 0;
      ball.phase = 'rail';
      return Math.max(0, dt - arrival);
    }

    _railSpeed(ball, angle) {
      // A guide only redirects velocity. Gravity trades kinetic energy for
      // height; no fixed animation speed or extra sideways kick is applied.
      return Math.sqrt(Math.max(0, ball.railEntrySpeed * ball.railEntrySpeed
        - 2 * GRAVITY * LAUNCH_RAIL.radius * Math.sin(angle)));
    }

    _railAngleAfter(ball, dt) {
      const angularSpeed = angle => this._railSpeed(ball, clamp(angle, 0, LAUNCH_RAIL.angle)) / LAUNCH_RAIL.radius;
      const angle = ball.railAngle;
      const k1 = angularSpeed(angle);
      const k2 = angularSpeed(angle + dt * k1 / 2);
      const k3 = angularSpeed(angle + dt * k2 / 2);
      const k4 = angularSpeed(angle + dt * k3);
      return angle + dt * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
    }

    _advanceRail(ball, dt) {
      let angle = this._railAngleAfter(ball, dt);
      let leftover = 0;
      if (angle >= LAUNCH_RAIL.angle) {
        // Resolve the exact exit time and give the remainder to free flight.
        let low = 0, high = dt;
        for (let i = 0; i < 30; i++) {
          const middle = (low + high) / 2;
          if (this._railAngleAfter(ball, middle) < LAUNCH_RAIL.angle) low = middle;
          else high = middle;
        }
        leftover = dt - high;
        angle = LAUNCH_RAIL.angle;
        ball.phase = 'board';
      }
      ball.railAngle = angle;
      const speed = this._railSpeed(ball, angle);
      ball.x = LAUNCH_RAIL.centerX + LAUNCH_RAIL.radius * Math.cos(angle);
      ball.y = LAUNCH_RAIL.centerY - LAUNCH_RAIL.radius * Math.sin(angle);
      ball.vx = -speed * Math.sin(angle);
      ball.vy = -speed * Math.cos(angle);
      return leftover;
    }

    _impact(ball, kind, speed, x = ball.x, y = ball.y) {
      if (Number.isFinite(speed) && speed > 28) {
        this.onImpact({ kind, ballId: ball.id, x, y, speed });
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
        let motionDt = dt;
        if (ball.phase === 'launch') {
          motionDt = this._advanceLaunch(ball, motionDt);
          if (ball.phase === 'launch') continue;
        }
        if (ball.phase === 'rail') {
          motionDt = this._advanceRail(ball, motionDt);
          if (ball.phase === 'rail') continue;
        }
        if (motionDt <= 0) continue;

        ball.vy += GRAVITY * motionDt;
        // Air resistance is deliberately small; impacts provide most damping.
        ball.vx *= Math.exp(-0.065 * motionDt);
        ball.x += ball.vx * motionDt;
        ball.y += ball.vy * motionDt;
        if (ball.x < 36 + BALL_RADIUS) {
          ball.x = 36 + BALL_RADIUS;
          const impactSpeed = -ball.vx;
          ball.vx = Math.abs(ball.vx) * 0.7;
          this._impact(ball, 'wall', impactSpeed);
        } else if (ball.x > 520 - BALL_RADIUS) {
          ball.x = 520 - BALL_RADIUS;
          const impactSpeed = ball.vx;
          ball.vx = -Math.abs(ball.vx) * 0.7;
          this._impact(ball, 'wall', impactSpeed);
        }
        if (ball.y < 30 + BALL_RADIUS) {
          ball.y = 30 + BALL_RADIUS;
          const impactSpeed = -ball.vy;
          ball.vy = Math.abs(ball.vy) * 0.65;
          this._impact(ball, 'wall', impactSpeed);
        }

        for (const peg of this.pegs) {
          const dx = ball.x - peg.x;
          const dy = ball.y - peg.y;
          const required = BALL_RADIUS + peg.radius;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared >= required * required) continue;
          const distance = Math.sqrt(distanceSquared);
          const speed = Math.hypot(ball.vx, ball.vy);
          const nx = distance > 0.0001 ? dx / distance : speed > 0.0001 ? -ball.vx / speed : 0;
          const ny = distance > 0.0001 ? dy / distance : speed > 0.0001 ? -ball.vy / speed : -1;
          ball.x = peg.x + nx * (required + 0.06);
          ball.y = peg.y + ny * (required + 0.06);
          const normalSpeed = ball.vx * nx + ball.vy * ny;
          if (normalSpeed < 0) {
            ball.vx -= (1 + PEG_RESTITUTION) * normalSpeed * nx;
            ball.vy -= (1 + PEG_RESTITUTION) * normalSpeed * ny;
            // Cushioned contact only removes energy. There are no random or
            // ball-ID-dependent impulses and no steering toward a target.
            ball.vx *= CONTACT_DAMPING;
            ball.vy *= CONTACT_DAMPING;
            const previousHit = ball.hitCooldown.get(peg.id) ?? -100;
            if (this.time - previousHit > 0.085 && -normalSpeed > 28) {
              ball.hitCooldown.set(peg.id, this.time);
              this.onPegHit({ peg, pegId: peg.id, ballId: ball.id, x: peg.x, y: peg.y, speed: -normalSpeed });
              this._impact(ball, 'peg', -normalSpeed, peg.x, peg.y);
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
                const length = Math.sqrt(dx * dx + dy * dy);
                const speed = Math.hypot(ball.vx, ball.vy);
                const nx = length > 0.0001 ? dx / length : speed > 0.0001 ? -ball.vx / speed : 0;
                const ny = length > 0.0001 ? dy / length : speed > 0.0001 ? -ball.vy / speed : -1;
                ball.x = x + nx * (radius + 0.05);
                ball.y = 649 + ny * (radius + 0.05);
                const dot = ball.vx * nx + ball.vy * ny;
                if (dot < 0) {
                  ball.vx -= (1 + LIP_RESTITUTION) * dot * nx;
                  ball.vy -= (1 + LIP_RESTITUTION) * dot * ny;
                  ball.vx *= CONTACT_DAMPING;
                  ball.vy *= CONTACT_DAMPING;
                  this._impact(ball, 'divider', -dot, x, 649);
                }
              }
            } else if (Math.abs(ball.x - x) < BALL_RADIUS + 3) {
              const side = ball.x < x ? -1 : 1;
              ball.x = x + side * (BALL_RADIUS + 3.05);
              if (ball.vx * side < 0) {
                const impactSpeed = Math.abs(ball.vx);
                ball.vx = -ball.vx * 0.42;
                this._impact(ball, 'divider', impactSpeed, x, ball.y);
              }
            }
          }
        }

        // A score requires physically crossing the collection line. A timeout
        // must never select a lane for a ball still on the board.
        if (ball.y >= 710) this._score(ball);
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
      this.onScore({ value: slot.value, slotIndex, ballId: ball.id, power: ball.power, x: ball.x, y: ball.y });
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

  PinballPhysics.LAUNCH_RAIL = LAUNCH_RAIL;
  if (typeof module !== 'undefined' && module.exports) module.exports = PinballPhysics;
  root.PinballPhysics = PinballPhysics;
})(typeof window !== 'undefined' ? window : globalThis);
