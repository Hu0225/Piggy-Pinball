'use strict';
const assert = require('node:assert/strict');
const PinballAudio = require('./dist/audio.js');

function fixture(options = {}) {
  let time = 0;
  const contexts = [], sessionTypes = [];
  const document = { hidden: false };
  const navigator = { audioSession: { set type(value) { sessionTypes.push(value); } } };
  const param = () => ({ value: 0, calls: [], setValueAtTime(...args) { this.calls.push(['value', ...args]); }, linearRampToValueAtTime(...args) { this.calls.push(['linear', ...args]); }, exponentialRampToValueAtTime(...args) { this.calls.push(['exponential', ...args]); }, cancelScheduledValues(...args) { this.calls.push(['cancel', ...args]); }, setTargetAtTime(...args) { this.calls.push(['target', ...args]); } });
  const node = () => ({ connections: [], disconnected: false, connect(target) { this.connections.push(target); }, disconnect() { this.disconnected = true; } });
  class AudioContext {
    constructor() {
      this.state = 'suspended'; this.currentTime = 3; this.sampleRate = 48000; this.destination = {};
      this.resumes = []; this.buffers = []; this.oscillators = []; this.gains = [];
      contexts.push(this);
    }
    createDynamicsCompressor() { return this.compressor = { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }; }
    createGain() { const gain = { ...node(), gain: param() }; this.gains.push(gain); return gain; }
    createBuffer(channels, frames, rate) { return { channels, frames, rate }; }
    createBufferSource() { const source = { ...node(), start(time) { this.started = time; } }; this.buffers.push(source); return source; }
    createOscillator() {
      const source = { ...node(), frequency: param(), stops: [], start(time) { this.started = time; }, stop(time) { this.stops.push(time); } };
      this.oscillators.push(source); return source;
    }
    resume() { return new Promise((resolve, reject) => this.resumes.push({ resolve: () => { this.state = 'running'; this.onstatechange?.(); resolve(); }, reject })); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  const audio = new PinballAudio({ AudioContext, navigator, document, now: () => time, ...options });
  return { audio, contexts, sessionTypes, document, advance(ms) { time += ms; } };
}

(async () => {
  const first = fixture();
  assert.equal(first.audio.play('launch'), false, 'no unsolicited audio before a gesture');
  const ready = first.audio.unlock(), context = first.contexts[0];
  assert.equal(context.resumes.length, 1, 'resume is invoked synchronously inside unlock');
  assert.equal(context.buffers[0].started, 0, 'a short silent source starts in the same gesture');
  assert.deepEqual(context.buffers[0].buffer, { channels: 1, frames: 1, rate: 48000 });
  assert.equal(first.audio.play('launch'), false);
  first.audio.play('peg', 3);
  assert.equal(context.resumes.length, 1, 'background play does not spam resume requests');
  context.resumes[0].resolve();
  assert.equal(await ready, true);
  assert.equal(context.oscillators.length, 2, 'launch survives asynchronous resume and is played once');
  assert.equal(first.audio.getStatus().pending, false);
  assert.deepEqual(context.oscillators.map(item => item.frequency.calls[0][1]), [260, 520]);
  assert.equal(context.compressor.threshold.value, -10);
  assert.equal(context.gains[0].gain.value, .9);
  assert.equal(context.compressor.connections[0], context.gains[0]);
  assert.equal(context.gains[0].connections[0], context.destination);
  assert.deepEqual(first.sessionTypes, ['playback']);
  await first.audio.unlock();
  assert.equal(context.buffers.length, 1, 'repeated gesture events do not prime repeatedly');
  assert.equal(context.oscillators.length, 2, 'unlock does not play an extra notification');
  context.oscillators[0].onended();
  assert.equal(context.oscillators[0].disconnected, true);
  context.buffers[0].onended();
  assert.equal(context.buffers[0].disconnected, true);

  const retry = fixture();
  const blocked = retry.audio.unlock(), retryContext = retry.contexts[0];
  const tapped = retry.audio.unlock();
  assert.equal(retryContext.resumes.length, 2, 'a pending resume never blocks a new real gesture');
  retryContext.resumes[0].reject(new Error('gesture required'));
  assert.equal(await blocked, false);
  retry.audio.play('score', 10);
  retryContext.resumes[1].resolve();
  assert.equal(await tapped, true);
  assert.equal(retryContext.oscillators.length, 3);
  retryContext.state = 'interrupted';
  retry.audio.play('launch');
  assert.equal(retryContext.resumes.length, 3, 'an interrupted context is recovered');
  retryContext.resumes[2].resolve();
  await Promise.resolve();
  assert.equal(retryContext.oscillators.length, 5);

  for (const action of ['mute', 'hide', 'expire']) {
    const test = fixture();
    const promise = test.audio.unlock(), ctx = test.contexts[0];
    test.audio.play('score', 10);
    if (action === 'mute') test.audio.setEnabled(false);
    if (action === 'hide') { test.document.hidden = true; test.audio.pause(); }
    if (action === 'expire') test.advance(751);
    ctx.resumes[0].resolve();
    await promise;
    assert.equal(ctx.oscillators.length, 0, `${action} discards stale queued sounds`);
    if (action !== 'expire') assert.equal(test.sessionTypes.at(-1), 'auto');
  }

  const mute = fixture();
  const muteReady = mute.audio.unlock(), muteContext = mute.contexts[0];
  muteContext.resumes[0].resolve(); await muteReady;
  mute.audio.play('score', 12);
  mute.audio.setEnabled(false);
  assert(muteContext.oscillators.every(item => item.stops.length === 2), 'muting stops scheduled tails');
  assert.equal(mute.audio.play('launch'), false);
  await mute.audio.unlock();
  assert.equal(muteContext.resumes.length, 1, 'disabled sound cannot be unlocked accidentally');
  mute.audio.setEnabled(true);
  await mute.audio.unlock();
  mute.document.hidden = true; mute.audio.pause();
  assert.equal(await mute.audio.recover(), false, 'background events never restart audio');
  mute.document.hidden = false;
  const foreground = mute.audio.recover();
  muteContext.resumes.at(-1).resolve(); await foreground;
  assert.equal(mute.audio.getStatus().state, 'running');
  assert.equal(muteContext.oscillators.length, 3, 'returning to the app does not replay old sounds');

  const replace = fixture();
  const original = replace.audio.unlock(); replace.contexts[0].resumes[0].resolve(); await original;
  replace.contexts[0].state = 'closed';
  assert.equal(await replace.audio.recover(), false, 'only a gesture creates a replacement context');
  const replacement = replace.audio.unlock();
  assert.equal(replace.contexts.length, 2);
  replace.contexts[1].resumes[0].resolve(); assert.equal(await replacement, true);

  for (const navigator of [{}, { get audioSession() { throw new Error('not allowed'); } }, { audioSession: { set type(value) { throw new Error('unsupported'); } } }]) {
    const test = fixture({ navigator });
    const promise = test.audio.unlock();
    test.contexts[0].resumes[0].resolve();
    assert.equal(await promise, true, 'optional AudioSession failures do not break Web Audio');
    test.audio.setEnabled(false);
  }
  const unsupported = fixture({ AudioContext: null });
  assert.equal(await unsupported.audio.unlock(), false);
  assert.equal(unsupported.audio.getStatus().supported, false);
  assert.equal(unsupported.sessionTypes.at(-1), 'auto');
  console.log('Audio passed: synchronous gesture unlock, async first sounds, retry/interruption recovery, mute/hidden races, stale-cue expiry, node cleanup and optional Safari AudioSession.');
})().catch(error => { console.error(error); process.exitCode = 1; });
