'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the actual application and its real physics/rules/feeder modules. The
// fixture supplies only browser surfaces; game callbacks are never replaced.
function createApp(savedStorage = new Map(), options = {}) {
  let now = 0, sequence = 0;
  const frames = new Map(), timers = new Map(), elements = new Map();
  const storage = new Map(savedStorage);
  const paint = new Proxy({}, {
    get: (target, name) => name in target ? target[name] : name === 'measureText'
      ? text => ({ width: String(text).length * 8 })
      : name === 'createLinearGradient' || name === 'createRadialGradient'
        ? () => ({ addColorStop() {} }) : () => {},
    set: (target, name, value) => { target[name] = value; return true; }
  });
  class Element {
    constructor(id = '') {
      this.id = id; this.value = ''; this.open = false; this.disabled = false;
      this.hidden = false; this.dataset = {}; this.listeners = new Map();
      this.style = { setProperty() {} }; this.attributes = new Map();
      this.classList = { add() {}, remove() {}, toggle() {} };
    }
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    }
    emit(type, values = {}) {
      const event = { target: this, preventDefault() {}, button: 0,
        isPrimary: true, pointerId: 1, clientY: 100, detail: 1, ...values };
      for (const handler of this.listeners.get(type) || []) handler(event);
    }
    getContext() { return paint; }
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 390, bottom: 744, width: 390, height: 600 }; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    appendChild(child) { child.parentElement = this; return child; }
    replaceChildren() {}
    setPointerCapture() {}
    focus() {}
    scrollIntoView() {}
    close() { this.open = false; }
    showModal() { this.open = true; }
    remove() {}
    closest() { return null; }
    matches() { return false; }
  }
  const html = fs.readFileSync(path.join(__dirname, 'dist/index.html'), 'utf8');
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) elements.set(match[1], new Element(match[1]));
  const element = id => {
    assert.ok(elements.has(id), `application requests a real element: ${id}`);
    return elements.get(id);
  };
  element('stakeInput').value = '5';
  element('stakeSlider').parentElement = new Element('range');
  const sections = new Map(['.machine-section', '.stake-section', '.session-score'].map(selector => [selector, new Element(selector)]));
  const helpPages = Array.from({ length: 3 }, () => new Element());
  const dialogs = [...elements.values()].filter(node => node.id.endsWith('Dialog'));
  const documentListeners = new Map();
  const document = {
    hidden: false, documentElement: new Element('html'),
    getElementById: element, createElement: () => new Element(),
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    querySelector(selector) {
      if (selector === 'dialog[open]') return dialogs.find(dialog => dialog.open) || null;
      assert.ok(sections.has(selector), `supported fixture selector: ${selector}`);
      return sections.get(selector);
    },
    querySelectorAll(selector) {
      if (selector === '.help-page') return helpPages;
      if (selector === 'dialog') return dialogs;
      assert.ok(['[data-stake]', '[data-dialog]', '.dialog-close'].includes(selector), `supported fixture list: ${selector}`);
      return [];
    }
  };
  const math = Object.create(Math); math.random = () => .4;
  const context = vm.createContext({
    console, document, Math: math,
    performance: { now: () => now }, navigator: {},
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    matchMedia: query => ({ matches: query.includes('prefers-reduced-motion')
      ? !!options.reducedMotion : query.includes('max-width'), addEventListener() {} }),
    requestAnimationFrame: callback => { const id = ++sequence; frames.set(id, callback); return id; },
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    ResizeObserver: class { observe() {} },
    Path2D: class { constructor() { return paint; } },
    addEventListener() {}, devicePixelRatio: 1, innerHeight: 744,
    visualViewport: { height: 744, addEventListener() {} }
  });
  context.window = context;
  for (const file of ['physics', 'rules', 'feeder', 'collector', 'haptics', 'audio', 'app']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `dist/${file}.js`), 'utf8'), context, { filename: `dist/${file}.js` });
  }
  const state = () => JSON.parse(JSON.stringify(context.PiggyGame.getState()));
  function step() {
    now += 1000 / 60;
    for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.callback(); }
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(now);
  }
  function until(predicate, seconds = 20) {
    for (let frame = 0; frame < seconds * 60 && !predicate(); frame++) step();
    assert.ok(predicate(), `application reaches expected state within ${seconds}s`);
  }
  function pull(percent) {
    const lever = element('leverHandle');
    lever.emit('pointerdown');
    lever.emit('pointermove', { clientY: 100 + percent * .7 });
    lever.emit('pointerup');
  }
  function setHidden(hidden) {
    document.hidden = hidden;
    for (const handler of documentListeners.get('visibilitychange') || []) handler({ target: document });
  }
  return { state, element, storage, step, until, pull, setHidden, engine: context.PiggyGame.engine };
}

function readyApp() {
  const app = createApp();
  app.element('depositButton').emit('click');
  app.until(() => app.state().launchReady && !app.state().feeding);
  assert.equal(app.state().round.stake, 5);
  assert.equal(app.state().points, 4, 'the real feeder credits each non-launch ball once');
  return app;
}
const app = readyApp();
const ready = app.state();
app.pull(0);
assert.equal(app.state().activeBalls, 0, 'releasing an unmoved lever creates no attempt');

for (const percent of [9, 10, 9, 10]) {
  app.pull(percent);
  assert.equal(app.state().guideBusy, true);
  assert.equal(app.state().round.launched, 0, 'tube motion does not consume the formal shot');
  assert.equal(app.element('leverHandle').disabled, true);
  assert.equal(app.element('depositButton').disabled, true);
  app.element('depositButton').emit('click');
  app.pull(80);
  assert.equal(app.state().activeBalls, 1, 'repeated input cannot create a second tube ball');
  assert.equal(app.state().wallet, ready.wallet, 'tube input cannot top up principal');
  app.until(() => app.state().launchReady && !app.state().guideBusy);
  const returned = app.state();
  assert.equal(returned.activeBalls, 0);
  assert.deepEqual(returned.round, ready.round, 'failed attempts preserve chance, principal, targets and point tokens');
  assert.equal(returned.wallet, ready.wallet);
  assert.equal(returned.points, ready.points);
  assert.equal(app.element('leverHandle').disabled, false);
  assert.equal(app.element('depositButton').disabled, false);
  assert.equal(app.element('endDialog').open, false, 'a tube return never settles the round');
  assert.equal(app.storage.has('piggyPracticeThresholdV3'), false, 'returns never write fake landing history');
}

app.pull(11);
assert.equal(app.state().round.phase, 'ready', 'even a successful attempt waits for the physical exit');
app.until(() => app.state().round.phase === 'playing');
assert.equal(app.state().guideBusy, false);
assert.equal(app.state().round.launched, 1);
assert.equal(app.state().round.remaining, 0);
assert.equal(app.state().launchReady, false);
app.element('depositButton').emit('click'); app.pull(100);
assert.equal(app.state().round.stake, 5);
assert.equal(app.state().activeBalls, 1, 'after exit there is still only one formal shot');
app.until(() => app.state().round.phase === 'settled');
assert.equal(app.state().round.resolved, 1);
assert.equal(app.state().points, ready.points);
const history = JSON.parse(app.storage.get('piggyPracticeThresholdV3'));
assert.equal(history.length, 1);
assert.equal(history[0].power, .11);
assert.ok(history[0].slot >= 1 && history[0].slot <= 10);
const afterLanding = createApp(app.storage);
assert.equal(afterLanding.state().wallet, app.state().wallet, 'settled balances survive refresh');
assert.ok(afterLanding.element('shotMemory').textContent.includes('11%'), 'new mapping history survives refresh');
const oldHistory = JSON.stringify([{ power: .65, slot: 4, hit: false, reward: 0 }]);
const oldPractice = createApp(new Map([
  ['piggyPracticeLaunchV2', oldHistory], ['piggyPracticeFeederV1', oldHistory]
]));
assert.equal(oldPractice.element('shotMemory').textContent, '落袋后记录力度与轨道', 'old mapping records do not become new aiming hints');

const interrupted = readyApp();
interrupted.pull(10); interrupted.step();
assert.equal(interrupted.state().guideBusy, true);
const restored = createApp(interrupted.storage).state();
assert.equal(restored.wallet, 990, 'refresh during a tube attempt refunds the single unresolved principal');
assert.equal(restored.points, 0, 'refresh rolls back that round\'s independent points');
assert.equal(restored.round, null);
assert.equal(restored.activeBalls, 0);

// Skipping motion must advance the actual feeder and collector together. A
// single large feeder step alone would stall at the occupied physical outlet.
function assertFullBatchFinished(skipped, label) {
  const completed = skipped.state();
  assert.equal(completed.round.stake, 99, `${label}: principal remains 99`);
  assert.equal(completed.wallet, 891, `${label}: only the 99 deposited beads are debited`);
  assert.equal(completed.points, 98, `${label}: all non-launch beads credit synchronously`);
  assert.equal(completed.round.pointsEarned, 98);
  assert.deepEqual(completed.round.pointTokens, Array.from({ length: 98 }, (_, index) => index + 1),
    `${label}: each actual collection token appears exactly once`);
  assert.equal(completed.feeding, false, `${label}: no blocked feeder remains after skipping motion`);
  assert.equal(completed.launchReady, true, `${label}: the first bead stays ready to launch`);
  assert.equal(completed.guideBusy, false);
  assert.equal(completed.activeBalls, 0);
}
function verifyFullBatchCanLaunch(skipped, label) {
  skipped.until(() => !skipped.element('leverHandle').disabled);
  skipped.element('stakeInput').value = '1';
  skipped.element('stakeInput').emit('input');
  assert.equal(skipped.element('depositButton').disabled, true, `${label}: a full 99-bead round disables further deposits`);
  skipped.element('depositButton').emit('click');
  assert.equal(skipped.state().round.stake, 99, `${label}: forced additional input cannot exceed the principal cap`);
  assert.equal(skipped.state().wallet, 891);
  assert.equal(skipped.state().points, 98);
  assert.equal(skipped.state().feeding, false);
  skipped.pull(11);
  assert.equal(skipped.state().guideBusy, true, `${label}: the normal launch interaction still works`);
  skipped.until(() => skipped.state().round.phase === 'playing');
  assert.equal(skipped.state().round.launched, 1);
  assert.equal(skipped.state().round.remaining, 0);
  assert.equal(skipped.state().points, 98, `${label}: launching cannot credit the skipped collection again`);
}

const reducedBatch = createApp(new Map(), { reducedMotion: true });
reducedBatch.element('stakeInput').value = '99';
reducedBatch.element('stakeInput').emit('input');
reducedBatch.element('depositButton').emit('click');
assertFullBatchFinished(reducedBatch, 'reduced motion');
verifyFullBatchCanLaunch(reducedBatch, 'reduced motion');

const hiddenBatch = createApp();
hiddenBatch.element('stakeInput').value = '99';
hiddenBatch.element('stakeInput').emit('input');
hiddenBatch.element('depositButton').emit('click');
assert.equal(hiddenBatch.state().feeding, true, 'normal motion starts the full batch asynchronously');
hiddenBatch.until(() => hiddenBatch.state().points > 0);
assert.ok(hiddenBatch.state().points < 98, 'the page is hidden during an unfinished collection');
assert.equal(hiddenBatch.state().feeding, true);
hiddenBatch.setHidden(true);
assertFullBatchFinished(hiddenBatch, 'background completion');
hiddenBatch.setHidden(false);
verifyFullBatchCanLaunch(hiddenBatch, 'background completion');

console.log('Launch flow passed: real app/physics/rules/feeder integration, repeated 9%/10% returns, guarded inputs, physical 11% exit consumes one shot, versioned landing history, interrupted-attempt recovery, and reduced-motion/background 99-bead completion with exact points and principal cap.');
