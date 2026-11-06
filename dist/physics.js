(function (root) {
  'use strict';

  const WIDTH = 600;
  const HEIGHT = 760;
  const STEP = 1 / 180;
  const BALL_RADIUS = 8.5;
  const GRAVITY = 780;
  const EXIT_POWER_THRESHOLD = 0.1;
  const LAUNCH_SPEED_RANGE = 1100;
  // The exact zero-speed top of an ideal quarter-circle is approached only
  // asymptotically. Stop a critical attempt 0.056px before it, dissipating at
  // most 0.022 units of energy per unit mass, so gravity can roll it back.
  const RAIL_RETURN_MARGIN = 0.001;
  const PEG_RESTITUTION = 0.74;
  const LIP_RESTITUTION = 0.4;
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
      this.onExit = callbacks.onExit || function () {};
      this.onReturn = callbacks.onReturn || function () {};
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

    launch(power = 0.65, { startY = 704 } = {}) {
      if (this.balls.filter(ball => ball.phase !== 'scored').length >= 10) return false;
      const force = clamp(Number(power) || 0, 0, 1);
      const originY = Number.isFinite(startY) && startY >= 704 && startY <= 900 ? startY : 704;
      // Ten percent supplies exactly the gravitational climb energy. Lower
      // attempts turn inside the chute; only powers above it can leave.
      const criticalSpeed = Math.sqrt(2 * GRAVITY * (originY - LAUNCH_RAIL.exitY));
      const launchSpeed = force <= EXIT_POWER_THRESHOLD
        ? criticalSpeed * force / EXIT_POWER_THRESHOLD
        : criticalSpeed + LAUNCH_SPEED_RANGE * (force - EXIT_POWER_THRESHOLD) / (1 - EXIT_POWER_THRESHOLD);
      const ball = {
        id: this._nextId++, x: LAUNCH_RAIL.startX, y: originY, vx: 0,
        vy: -launchSpeed, radius: BALL_RADIUS,
        power: force, originY, returning: false, phase: 'launch', age: 0, trail: [],
        railAngle: 0, railVelocity: 0, trailClock: 0, hitCooldown: new Map(),
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
      const bottomDistance = Math.max(0, ball.originY - ball.y);
      const bottomSpeed = Math.sqrt(ball.vy * ball.vy + 2 * GRAVITY * bottomDistance);
      const returnTime = ball.vy < 0
        ? (bottomSpeed - ball.vy) / GRAVITY
        : bottomDistance === 0 ? 0 : 2 * bottomDistance / (bottomSpeed + ball.vy);
      if (returnTime <= dt) {
        ball.x = LAUNCH_RAIL.startX;
        ball.y = ball.originY;
        ball.vx = ball.vy = 0;
        ball.returning = true;
        ball.phase = 'returned';
        ball.fade = 0;
        this.onReturn({ ballId: ball.id, power: ball.power, x: ball.x, y: ball.y });
        return 0;
      }
      const distance = ball.y - LAUNCH_RAIL.startY;
      const entryEnergy = ball.vy * ball.vy - 2 * GRAVITY * distance;
      if (ball.vy < 0 && entryEnergy >= 0) {
        const entrySpeed = Math.sqrt(entryEnergy);
        const arrival = 2 * distance / (-ball.vy + entrySpeed);
        if (arrival <= dt) {
          ball.x = LAUNCH_RAIL.startX;
          ball.y = LAUNCH_RAIL.startY;
          ball.vy = -entrySpeed;
          ball.railEntrySpeed = entrySpeed;
          ball.railVelocity = entrySpeed;
          ball.railAngle = 0;
          ball.phase = 'rail';
          return Math.max(0, dt - arrival);
        }
      }
      ball.y += ball.vy * dt + 0.5 * GRAVITY * dt * dt;
      ball.vy += GRAVITY * dt;
      if (ball.vy >= 0) ball.returning = true;
      return 0;
    }

    _railSpeed(ball, angle) {
      // A guide only redirects velocity. Gravity trades kinetic energy for
      // height; no fixed animation speed or extra sideways kick is applied.
      return Math.sqrt(Math.max(0, ball.railEntrySpeed * ball.railEntrySpeed
        - 2 * GRAVITY * LAUNCH_RAIL.radius * Math.sin(angle)));
    }

    _railMotionAfter(ball, dt) {
      // Integrate a signed tangential velocity so gravity can reverse motion
      // at a turning point instead of clamping the ball motionless there.
      const radius = LAUNCH_RAIL.radius;
      const acceleration = angle => -GRAVITY * Math.cos(clamp(angle, 0, LAUNCH_RAIL.angle));
      const angle = ball.railAngle, velocity = ball.railVelocity;
      const a1 = velocity / radius, v1 = acceleration(angle);
      const a2 = (velocity + dt * v1 / 2) / radius, v2 = acceleration(angle + dt * a1 / 2);
      const a3 = (velocity + dt * v2 / 2) / radius, v3 = acceleration(angle + dt * a2 / 2);
      const a4 = (velocity + dt * v3) / radius, v4 = acceleration(angle + dt * a3);
      return {
        angle: angle + dt * (a1 + 2 * a2 + 2 * a3 + a4) / 6,
        velocity: velocity + dt * (v1 + 2 * v2 + 2 * v3 + v4) / 6
      };
    }

    _setRailState(ball, angle, direction) {
      ball.railAngle = angle;
      // Reconstruct speed from the conserved energy to avoid numerical
      // integration injecting energy over a long, near-critical turnaround.
      const speed = direction * this._railSpeed(ball, angle);
      ball.railVelocity = speed;
      ball.x = LAUNCH_RAIL.centerX + LAUNCH_RAIL.radius * Math.cos(angle);
      ball.y = LAUNCH_RAIL.centerY - LAUNCH_RAIL.radius * Math.sin(angle);
      ball.vx = -speed * Math.sin(angle);
      ball.vy = -speed * Math.cos(angle);
      if (speed <= 0) ball.returning = true;
    }

    _advanceRail(ball, dt) {
      const motion = this._railMotionAfter(ball, dt);
      const canExit = ball.power > EXIT_POWER_THRESHOLD;
      const upperAngle = LAUNCH_RAIL.angle - (canExit ? 0 : RAIL_RETURN_MARGIN);
      const crossesBottom = motion.angle <= 0 && motion.velocity < 0;
      const crossesTop = motion.angle >= upperAngle && motion.velocity > 0;
      if (crossesBottom || crossesTop) {
        const boundary = crossesBottom ? 0 : upperAngle;
        let low = 0, high = dt;
        for (let i = 0; i < 30; i++) {
          const middle = (low + high) / 2;
          const nextAngle = this._railMotionAfter(ball, middle).angle;
          if (crossesBottom ? nextAngle > boundary : nextAngle < boundary) low = middle;
          else high = middle;
        }
        if (crossesBottom) {
          this._setRailState(ball, 0, -1);
          ball.phase = 'launch';
        } else if (canExit) {
          this._setRailState(ball, LAUNCH_RAIL.angle, 1);
          ball.phase = 'board';
          this.onExit({ ballId: ball.id, power: ball.power, x: ball.x, y: ball.y });
        } else {
          // Remove only the vanishing kinetic remainder; the position stays
          // below the summit, where gravity supplies the return acceleration.
          ball.railEntrySpeed = Math.sqrt(2 * GRAVITY * LAUNCH_RAIL.radius * Math.sin(upperAngle));
          this._setRailState(ball, upperAngle, 0);
        }
        return Math.max(0, dt - high);
      }
      const energyFraction = ball.railEntrySpeed * ball.railEntrySpeed / (2 * GRAVITY * LAUNCH_RAIL.radius);
      const turningAngle = energyFraction < 1 ? Math.asin(energyFraction) : LAUNCH_RAIL.angle;
      const angle = clamp(motion.angle, 0, turningAngle);
      this._setRailState(ball, angle, motion.velocity > 0 ? 1 : -1);
      return 0;
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
        for (let transition = 0; motionDt > 0 && transition < 4 && (ball.phase === 'launch' || ball.phase === 'rail'); transition++) {
          motionDt = ball.phase === 'launch' ? this._advanceLaunch(ball, motionDt) : this._advanceRail(ball, motionDt);
        }
        if (motionDt <= 0 || ball.phase === 'launch' || ball.phase === 'rail' || ball.phase === 'returned') continue;

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
            // Match the original lively rebound: retain tangential velocity
            // and reflect the normal component without extra contact damping.
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
        balls: this.balls.map(({ id, x, y, vx, vy, radius, phase, power, originY, returning, age, fade, slotIndex, trail }) => ({ id, x, y, vx, vy, radius, phase, power, originY, returning, age, fade, slotIndex, trail: trail.map(point => ({ ...point })) })),
        pegs: this.pegs.map(peg => ({ ...peg })),
        slots: this.slots.map(slot => ({ ...slot }))
      };
    }
  }

  PinballPhysics.LAUNCH_RAIL = LAUNCH_RAIL;
  if (typeof module !== 'undefined' && module.exports) module.exports = PinballPhysics;
  root.PinballPhysics = PinballPhysics;
})(typeof window !== 'undefined' ? window : globalThis);
