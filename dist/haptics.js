(function (root) {
  'use strict';

  const clampPower = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const levelForPower = power => power < 0.35 ? 'light' : power < 0.75 ? 'medium' : 'heavy';
  const PULL_PATTERNS = Object.freeze({ light: 5, medium: 9, heavy: 14 });
  const LAUNCH_PATTERNS = Object.freeze({ light: 12, medium: 24, heavy: 40 });
  const IMPACT_PATTERNS = Object.freeze({ light: 8, medium: 18, heavy: Object.freeze([25, 12, 15]) });

  class PinballHaptics {
    constructor(options = {}) {
      this.enabled = options.enabled !== false;
      this._navigator = options.navigator === undefined ? root.navigator : options.navigator;
      this._document = options.document === undefined ? root.document : options.document;
      this._now = typeof options.now === 'function' ? options.now : () => root.performance?.now?.() ?? Date.now();
      // Native hosts may explicitly inject an amplitude-aware adapter. A web
      // page never assumes that the WeChat JS SDK exposes native haptic APIs.
      this._native = options.nativeHaptics || null;
      this._gestureUnlocked = false;
      this._charging = false;
      this._lastDetent = 0;
      this._lastPulseAt = -Infinity;
      this._lastImpactAt = -Infinity;
      this._lastResult = 'idle';
    }

    _backend() {
      if (typeof this._native?.impact === 'function') return 'native';
      if (typeof this._navigator?.vibrate === 'function') return 'web';
      return 'none';
    }

    isSupported() { return this._backend() !== 'none'; }

    getStatus() {
      return { enabled: this.enabled, supported: this.isSupported(), backend: this._backend(), lastResult: this._lastResult };
    }

    setEnabled(enabled) {
      this.enabled = !!enabled;
      if (!this.enabled) this.stop();
      return this.enabled;
    }

    _canRun() {
      if (!this.enabled || this._document?.hidden) return false;
      const activation = this._navigator?.userActivation;
      if (typeof activation?.hasBeenActive === 'boolean') return activation.hasBeenActive;
      return this._gestureUnlocked;
    }

    _pulse(strength, pattern) {
      if (!this._canRun()) { this._lastResult = 'suppressed'; return false; }
      const backend = this._backend();
      if (backend === 'none') { this._lastResult = 'unsupported'; return false; }
      const now = this._now();
      if (now - this._lastPulseAt < 60) { this._lastResult = 'throttled'; return false; }
      this._lastPulseAt = now;
      try {
        // Web vibration has no motor-amplitude control. Shorter/longer pulses
        // and the heavy double tap provide distinct tactile patterns instead.
        const result = backend === 'native'
          ? this._native.impact(strength)
          : this._navigator.vibrate(Array.isArray(pattern) ? [...pattern] : pattern);
        if (result === false) { this._lastResult = 'rejected'; return false; }
        if (typeof result?.catch === 'function') result.catch(() => { this._lastResult = 'rejected'; });
        this._lastResult = 'requested';
        return true;
      } catch {
        this._lastResult = 'rejected';
        return false;
      }
    }

    // These entry points belong in direct user gesture handlers.
    preview() {
      this._gestureUnlocked = true;
      return this._pulse('medium', 18);
    }

    beginCharge() {
      this._gestureUnlocked = true;
      this._charging = true;
      this._lastDetent = 0;
      return this._pulse('light', 5);
    }

    pull(value) {
      if (!this._charging) return false;
      const power = clampPower(value);
      const detent = Math.floor(power * 4 + 1e-8);
      if (detent <= this._lastDetent) return false;
      const strength = detent < 2 ? 'light' : detent < 4 ? 'medium' : 'heavy';
      const sent = this._pulse(strength, PULL_PATTERNS[strength]);
      // Retry a throttled crossing on a later frame, but never pulse repeatedly
      // while the handle remains at an already acknowledged detent.
      if (sent) this._lastDetent = detent;
      return sent;
    }

    launch(value) {
      this._charging = false;
      const strength = levelForPower(clampPower(value));
      return this._pulse(strength, LAUNCH_PATTERNS[strength]);
    }

    impact(speed) {
      if (!Number.isFinite(speed) || speed < 28) return false;
      const now = this._now();
      if (now - this._lastImpactAt < 85) return false;
      const strength = speed < 220 ? 'light' : speed < 480 ? 'medium' : 'heavy';
      const sent = this._pulse(strength, IMPACT_PATTERNS[strength]);
      if (sent) this._lastImpactAt = now;
      return sent;
    }

    stop() {
      this._charging = false;
      this._lastDetent = 0;
      // Explicit cancellation ends the previous gesture and lets its following
      // release/launch immediately start a new, stronger pulse.
      this._lastPulseAt = -Infinity;
      this._lastImpactAt = -Infinity;
      this._lastResult = 'stopped';
      try {
        if (this._backend() === 'native') {
          if (typeof this._native.stop === 'function') {
            const result = this._native.stop();
            if (typeof result?.catch === 'function') result.catch(() => {});
          }
        } else if (this._backend() === 'web') this._navigator.vibrate(0);
      } catch { /* Hardware feedback is optional and must never block play. */ }
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = PinballHaptics;
  root.PinballHaptics = PinballHaptics;
})(typeof window !== 'undefined' ? window : globalThis);
