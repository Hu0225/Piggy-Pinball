(function (root) {
  'use strict';

  class PinballAudio {
    constructor(options = {}) {
      this.enabled = options.enabled !== false;
      this._AudioContext = options.AudioContext === undefined ? root.AudioContext || root.webkitAudioContext : options.AudioContext;
      this._navigator = options.navigator === undefined ? root.navigator : options.navigator;
      this._document = options.document === undefined ? root.document : options.document;
      this._now = options.now || (() => root.performance?.now?.() ?? Date.now());
      this._context = null;
      this._bus = null;
      this._output = null;
      this._primed = false;
      this._unlocked = false;
      this._paused = false;
      this._sessionOwned = false;
      this._epoch = 0;
      this._pending = null;
      this._active = new Set();
      this._lastTick = -Infinity;
      this._resumePromise = null;
      this._resumeAt = -Infinity;
    }

    getStatus() {
      return { enabled: this.enabled, supported: !!this._AudioContext, state: this._context?.state || 'idle', paused: this._paused, pending: !!this._pending };
    }

    _canPlay() { return this.enabled && !this._paused && !this._document?.hidden; }

    _session(playback) {
      try {
        const session = this._navigator?.audioSession;
        if (!session) return;
        if (playback && !this._sessionOwned) { session.type = 'playback'; this._sessionOwned = true; }
        else if (!playback && this._sessionOwned) { session.type = 'auto'; this._sessionOwned = false; }
      } catch { /* Older Safari and other browsers can omit or reject this API. */ }
    }

    _createContext() {
      if (this._context && this._context.state !== 'closed') return true;
      if (!this._AudioContext) return false;
      try {
        const context = new this._AudioContext();
        const bus = context.createDynamicsCompressor(), output = context.createGain();
        bus.threshold.value = -10; bus.knee.value = 12; bus.ratio.value = 8;
        bus.attack.value = .003; bus.release.value = .14;
        output.gain.value = .9;
        bus.connect(output); output.connect(context.destination);
        this._context = context; this._bus = bus; this._output = output;
        this._primed = false; this._pending = null; this._resumePromise = null;
        context.onstatechange = () => { if (context === this._context && context.state === 'running') this._flush(); };
        return true;
      } catch { return false; }
    }

    _volume(value) {
      if (!this._output) return;
      try {
        const time = this._context.currentTime;
        this._output.gain.cancelScheduledValues(time);
        this._output.gain.setTargetAtTime(value, time, .015);
      } catch { /* Optional audio must never stop gameplay. */ }
    }

    // Call directly from a trusted click/touchend/pointerup/keyboard handler.
    // resume() and the first short source start both happen in that same stack.
    unlock() {
      if (!this.enabled || this._document?.hidden) return Promise.resolve(false);
      this._paused = false; this._unlocked = true; this._session(true);
      if (!this._createContext()) { this._session(false); return Promise.resolve(false); }
      this._volume(.9);
      const resumed = this._resume(true);
      if (!this._primed) {
        try {
          const source = this._context.createBufferSource();
          source.buffer = this._context.createBuffer(1, 1, this._context.sampleRate || 44100);
          source.connect(this._output);
          source.onended = () => source.disconnect();
          source.start(0);
          this._primed = true;
        } catch { /* resume() still works if a browser cannot prime a source. */ }
      }
      return resumed;
    }

    _resume(fromGesture) {
      const context = this._context;
      if (!context || context.state === 'closed' || !this._canPlay()) return Promise.resolve(false);
      if (context.state === 'running') { this._flush(); return Promise.resolve(true); }
      // Do not let a pending, gesture-less Safari resume block a later real tap.
      if (!fromGesture && this._resumePromise && this._now() - this._resumeAt < 1000) return this._resumePromise;
      const epoch = this._epoch;
      this._resumeAt = this._now();
      try {
        const promise = Promise.resolve(context.resume()).then(() => {
          if (context !== this._context || epoch !== this._epoch || !this._canPlay() || context.state !== 'running') return false;
          this._flush();
          return true;
        }, () => false);
        this._resumePromise = promise;
        promise.then(() => { if (this._resumePromise === promise) this._resumePromise = null; });
        return promise;
      } catch { return Promise.resolve(false); }
    }

    recover() {
      if (!this.enabled || this._document?.hidden || !this._unlocked || !this._context || this._context.state === 'closed') return Promise.resolve(false);
      this._paused = false; this._session(true); this._volume(.9);
      return this._resume(false);
    }

    _silence() {
      this._epoch++; this._pending = null; this._resumePromise = null;
      this._volume(0);
      for (const source of this._active) {
        try { source.stop(); } catch { /* A completed source may already be stopped. */ }
      }
      this._active.clear();
      this._session(false);
    }

    setEnabled(enabled) {
      this.enabled = !!enabled;
      if (!this.enabled) this._silence();
      return this.enabled;
    }

    pause() {
      this._paused = true; this._silence();
      const context = this._context;
      if (!context || context.state === 'closed' || typeof context.suspend !== 'function') return;
      try {
        Promise.resolve(context.suspend()).then(() => {
          if (context === this._context && !this._paused && this._canPlay()) this.recover();
        }, () => {});
      } catch { /* Safari may have interrupted the audio context already. */ }
    }

    play(type, value = 0) {
      if (!this._canPlay() || !this._unlocked || !this._context || !['peg', 'bounce', 'launch', 'score'].includes(type)) return false;
      if (this._context.state !== 'running') {
        if (type === 'launch' || type === 'score') this._pending = { type, value, at: this._now(), epoch: this._epoch };
        this.recover();
        return false;
      }
      return this._render(type, value);
    }

    _flush() {
      if (!this._canPlay() || this._context?.state !== 'running') return;
      const pending = this._pending;
      this._pending = null;
      if (pending && pending.epoch === this._epoch && this._now() - pending.at <= 750) this._render(pending.type, pending.value);
    }

    _note(freq, duration, volume, delay = 0) {
      const context = this._context;
      try {
        const time = context.currentTime + delay;
        const oscillator = context.createOscillator(), gain = context.createGain();
        oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(freq, time);
        gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(volume, time + .005);
        gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
        oscillator.connect(gain); gain.connect(this._bus);
        this._active.add(oscillator);
        oscillator.onended = () => { this._active.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(time); oscillator.stop(time + duration + .02);
      } catch { /* An interrupted audio device must not interrupt the game. */ }
    }

    _render(type, value) {
      value = Number.isFinite(value) ? value : 0;
      if (type === 'peg' || type === 'bounce') {
        if (this._now() - this._lastTick < 40) return false;
        this._lastTick = this._now();
        this._note(type === 'peg' ? 780 + value * 95 : 440 + Math.min(value, 800) * .4, .12, type === 'peg' ? .14 : .11);
      }
      if (type === 'launch') { this._note(260, .13, .23); this._note(520, .17, .18, .05); }
      if (type === 'score') [523.25, 659.25, value >= 8 ? 1046.5 : 783.99].forEach((freq, index) => this._note(freq, .28, .2, index * .09));
      return true;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = PinballAudio;
  root.PinballAudio = PinballAudio;
})(typeof window !== 'undefined' ? window : globalThis);
