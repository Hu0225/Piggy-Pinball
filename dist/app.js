(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  const W = 600, H = 760;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  const background = document.createElement('canvas');
  background.width = W * dpr;
  background.height = H * dpr;
  const bg = background.getContext('2d');
  bg.scale(dpr, dpr);
  const launchButton = $('launchButton');
  const powerFill = $('powerFill');
  const powerLabel = $('powerLabel');
  let savedGame;
  try { savedGame = JSON.parse(readStorage('piggyArcadeV2', 'null')); } catch { savedGame = null; }
  const game = new PinballRules(savedGame);
  let sound = readStorage('piggySound', 'true') !== 'false';
  let charging = false, chargeStart = 0, power = 0, chargeSource = '', activePointer = null;
  let lastFrame = performance.now(), toastTimer, endTimer, roundAnnounced = false;
  let rollingUntil = 0, lastRollDigit = -1, autoFire = false, nextAutoFire = 0, lastPower = .65, dragStartY = 0;
  let audioContext, lastTick = 0;
  const hits = new Map(), slotFlashes = new Map(), particles = [], recent = [];
  const engine = new PinballPhysics({ onPegHit: onPegHit, onScore: onScore, onLaunch: () => playSound('launch') });

  function readStorage(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
  function saveStorage(key, value) { try { localStorage.setItem(key, String(value)); } catch { /* Game remains playable without storage. */ } }
  function saveProgress() { saveStorage('piggyArcadeV2', JSON.stringify(game.serialize())); }
  function rounded(c, x, y, w, h, r, fill, stroke, width = 1) {
    c.beginPath(); c.roundRect(x, y, w, h, r);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
  }
  function line(c, x1, y1, x2, y2, color, width = 1) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = width; c.stroke(); }
  function ellipse(c, x, y, rx, ry, color, stroke, width = 2) {
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
  }
  function text(c, value, x, y, size, color, font = 'sans-serif', weight = 'bold') {
    c.fillStyle = color; c.font = `${weight} ${size}px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(value, x, y);
  }
  function drawPig(c) {
    c.save(); c.translate(282, 428); c.rotate(-0.11); c.scale(1.08, 1.08);
    const outline = '#a74e3d', pink = '#edaa89', darkPink = '#cf7d68';
    c.lineJoin = 'round'; c.lineCap = 'round';
    // Boots, a curly tail, and a small lucky waistcoat.
    c.beginPath(); c.moveTo(79, 20); c.bezierCurveTo(126, -13, 131, 39, 107, 34); c.bezierCurveTo(88, 30, 111, 6, 125, 21); c.strokeStyle = outline; c.lineWidth = 7; c.stroke();
    rounded(c, -66, 111, 42, 46, 12, darkPink, outline, 4);
    rounded(c, 25, 111, 42, 46, 12, darkPink, outline, 4);
    rounded(c, -71, 141, 48, 22, 7, '#674b3b', outline, 3);
    rounded(c, 25, 141, 48, 22, 7, '#674b3b', outline, 3);
    ellipse(c, 0, 57, 94, 89, pink, outline, 4);
    c.beginPath(); c.moveTo(-87, 48); c.quadraticCurveTo(-34, 81, 0, 59); c.quadraticCurveTo(40, 86, 89, 46); c.lineTo(79, 106); c.quadraticCurveTo(4, 149, -76, 109); c.closePath(); c.fillStyle = '#cc684b'; c.fill(); c.strokeStyle = outline; c.lineWidth = 4; c.stroke();
    line(c, 0, 62, 0, 133, outline, 3); ellipse(c, 8, 93, 3, 3, '#ffda86');
    c.save(); c.rotate(.5); ellipse(c, -84, 18, 22, 47, pink, outline, 4); c.restore();
    c.save(); c.rotate(-.6); ellipse(c, 91, 23, 22, 42, pink, outline, 4); c.restore();
    // Ears are drawn behind the large face.
    c.beginPath(); c.moveTo(-61, -71); c.quadraticCurveTo(-96, -153, -28, -119); c.lineTo(-17, -73); c.closePath(); c.fillStyle = pink; c.fill(); c.strokeStyle = outline; c.lineWidth = 4; c.stroke();
    c.beginPath(); c.moveTo(45, -88); c.quadraticCurveTo(84, -143, 107, -114); c.quadraticCurveTo(101, -80, 68, -57); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-61, -92); c.lineTo(-62, -121); c.lineTo(-38, -102); c.fillStyle = '#d98273'; c.fill();
    c.beginPath(); c.moveTo(66, -96); c.lineTo(93, -116); c.lineTo(80, -88); c.fill();
    ellipse(c, 0, -35, 104, 87, pink, outline, 4);
    ellipse(c, -54, -17, 21, 11, '#e3917b'); ellipse(c, 67, -21, 19, 11, '#e3917b');
    c.beginPath(); c.arc(-36, -56, 10, Math.PI * 1.1, Math.PI * 1.9); c.strokeStyle = outline; c.lineWidth = 4; c.stroke();
    c.beginPath(); c.arc(41, -56, 10, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
    ellipse(c, -6, -14, 42, 30, '#e29179', outline, 3.5);
    ellipse(c, -21, -14, 5, 10, outline); ellipse(c, 8, -14, 5, 10, outline);
    c.beginPath(); c.arc(28, 7, 19, .2, Math.PI * .8); c.strokeStyle = outline; c.lineWidth = 3; c.stroke();
    line(c, -41, -89, -30, -94, outline, 3); line(c, 31, -94, 42, -91, outline, 3);
    // Lucky four-point star.
    c.save(); c.translate(-92, -128); c.rotate(-.2); c.beginPath(); c.moveTo(0, -20); c.quadraticCurveTo(1, -2, 17, 0); c.quadraticCurveTo(1, 2, 0, 20); c.quadraticCurveTo(-1, 2, -17, 0); c.quadraticCurveTo(-1, -2, 0, -20); c.fillStyle = '#fff1b4'; c.fill(); c.restore();
    c.restore();
  }

  function drawBackground() {
    const gradient = bg.createLinearGradient(0, 0, 520, 760);
    gradient.addColorStop(0, '#ed9750'); gradient.addColorStop(.5, '#e9a143'); gradient.addColorStop(1, '#e38b3c');
    bg.fillStyle = gradient; bg.fillRect(0, 0, W, H);
    bg.save(); bg.beginPath(); bg.rect(30, 15, 492, 721); bg.clip();
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      bg.beginPath(); bg.moveTo(278, 430); bg.lineTo(278 + Math.cos(a) * 900, 430 + Math.sin(a) * 900); bg.lineTo(278 + Math.cos(a + .095) * 900, 430 + Math.sin(a + .095) * 900); bg.closePath(); bg.fillStyle = '#b65c3023'; bg.fill();
    }
    bg.restore();
    // Painted edge stripes, bolts, and raised metal rails.
    rounded(bg, 11, 10, 523, 737, 28, null, '#ac5735', 18);
    rounded(bg, 11, 10, 523, 737, 28, null, '#f9d39a', 3);
    for (let y = 65; y < 628; y += 35) {
      bg.beginPath(); bg.moveTo(12, y); bg.lineTo(25, y + 11); bg.lineTo(25, y + 21); bg.lineTo(12, y + 10); bg.fillStyle = '#f8ca88'; bg.fill();
      bg.beginPath(); bg.moveTo(519, y); bg.lineTo(532, y - 11); bg.lineTo(532, y - 1); bg.lineTo(519, y + 10); bg.fill();
    }
    rounded(bg, 33, 20, 489, 715, 25, null, '#994c2e', 4);
    rounded(bg, 36, 23, 483, 710, 23, null, '#ffe1a1', 3);
    rounded(bg, 542, 21, 42, 714, 19, '#a55f35', '#7e4a2c', 3);
    const chute = bg.createLinearGradient(544, 0, 584, 0);
    chute.addColorStop(0, '#725d40'); chute.addColorStop(.16, '#dfcf9c'); chute.addColorStop(.28, '#b8a473'); chute.addColorStop(.7, '#d0b47d'); chute.addColorStop(1, '#7c603d');
    rounded(bg, 550, 49, 25, 680, 10, chute);
    bg.beginPath(); bg.moveTo(579, 681); bg.lineTo(579, 62); bg.bezierCurveTo(579, -8, 468, -8, 468, 66); bg.strokeStyle = '#775131'; bg.lineWidth = 4; bg.stroke();
    bg.beginPath(); bg.moveTo(547, 680); bg.lineTo(547, 62); bg.bezierCurveTo(547, 29, 504, 29, 504, 66); bg.strokeStyle = '#ffdf9f'; bg.lineWidth = 4; bg.stroke();
    for (let y = 258; y < 615; y += 100) {
      bg.beginPath(); bg.moveTo(555, y + 10); bg.lineTo(562, y); bg.lineTo(569, y + 10); bg.strokeStyle = '#fff0bc99'; bg.lineWidth = 3; bg.lineCap = 'round'; bg.stroke();
    }
    bg.save(); bg.translate(562, 155); bg.rotate(Math.PI / 2); text(bg, 'LAUNCH LANE', 0, 0, 9, '#78512e', 'monospace'); bg.restore();
    // The playfield's printed artwork.
    text(bg, 'LET THE GOOD', 279, 84, 18, '#fff0be', 'Arial Black, sans-serif', '900');
    bg.save(); bg.translate(279, 120); bg.rotate(-.035); text(bg, 'TIMES ROLL', 0, 0, 45, '#fff1c7', 'Impact, Arial Black, sans-serif', '900'); bg.restore();
    line(bg, 152, 148, 403, 148, '#a9522f55', 1);
    text(bg, game.round ? `${game.round.multiplier} 倍好运 · ${game.round.litSlots.length} 条亮灯轨道` : '投 入 弹 珠  ·  抽 取 倍 率', 279, 151, 11, '#9b472b', 'Microsoft YaHei, sans-serif');
    bg.save(); bg.globalAlpha = .82; drawPig(bg); bg.restore();
    text(bg, 'GOOD LUCK!', 279, 606, 17, '#ffdb9b', 'Arial Black, sans-serif', '900');
    // Every round has a fixed, clearly illuminated set of winning lanes.
    engine.slots.forEach((slot, i) => {
      const gold = !!game.round?.litSlots.includes(i);
      const dark = bg.createLinearGradient(slot.x, 0, slot.x + slot.width, 0);
      dark.addColorStop(0, gold ? '#95622e' : '#695338'); dark.addColorStop(.3, gold ? '#bf8d3c' : '#977646'); dark.addColorStop(.5, gold ? '#d4a54e' : '#b18d54'); dark.addColorStop(1, gold ? '#9a6d2b' : '#705538');
      rounded(bg, slot.x + 4, 653, slot.width - 8, 72, 13, dark, '#67482e', 2);
      rounded(bg, slot.x + 12, 660, slot.width - 24, 40, 7, '#443e2d', '#c1a570', 1.3);
      line(bg, slot.x + 16, 665, slot.x + 16, 692, '#e1d2a681', 2);
      text(bg, gold ? `×${game.round.multiplier}` : String(i + 1).padStart(2, '0'), slot.x + 24, 713, 12, gold ? '#fff1ac' : '#c5b082', 'monospace');
      if (gold) text(bg, '★', slot.x + 24, 678, 15, '#d9b657', 'sans-serif');
      ellipse(bg, slot.x + 24, 638, 11, 8, '#75442d', '#b66c3c', 2);
      ellipse(bg, slot.x + 24, 636, 7.5, 5, gold ? '#de7e36' : '#b67142');
    });
    for (let i = 0; i <= 10; i++) {
      const x = 40 + i * 48;
      line(bg, x + 2, 653, x + 2, 723, '#703f29', 7);
      line(bg, x, 650, x, 720, '#e4d3ad', 6);
      line(bg, x - 1, 651, x - 1, 720, '#fff0cc', 2);
      ellipse(bg, x, 649, 3.3, 4, '#fce5bd');
    }
    engine.pegs.forEach(peg => {
      ellipse(bg, peg.x + 2, peg.y + 6, 9, 5, '#783c2944');
      ellipse(bg, peg.x, peg.y + 2, 9, 5, '#d6b17b', '#8a5c38', 1.5);
      const metal = bg.createRadialGradient(peg.x - 2, peg.y - 4, 0, peg.x, peg.y, 7.5);
      metal.addColorStop(0, '#fffde7'); metal.addColorStop(.25, '#f3edcc'); metal.addColorStop(.5, '#a8a798'); metal.addColorStop(.75, '#646d62'); metal.addColorStop(1, '#e9d8ac');
      ellipse(bg, peg.x, peg.y - 1, 6.2, 7, metal, '#777459', .8);
      ellipse(bg, peg.x - 1.5, peg.y - 3.5, 1.7, 2, '#fffde9');
    });
    [ [22, 37], [519, 37], [21, 721], [523, 722] ].forEach(([x, y]) => {
      ellipse(bg, x, y, 5, 5, '#cfbd90', '#795331', 1.5); line(bg, x - 2, y + 2, x + 2, y - 2, '#715332', 1);
    });
    text(bg, 'PIGGY PINBALL CLUB', 278, 746, 8, '#98512d', 'monospace');
  }

  function drawBall(c, x, y, radius, alpha = 1) {
    c.save(); c.globalAlpha = alpha;
    ellipse(c, x + 3, y + 6, radius + 1, radius * .65, '#5a442b55');
    const metal = c.createRadialGradient(x - 3, y - 4, .5, x, y, radius);
    metal.addColorStop(0, '#fff'); metal.addColorStop(.25, '#f9fff6'); metal.addColorStop(.5, '#b2c9c2'); metal.addColorStop(.7, '#6e8880'); metal.addColorStop(.85, '#d5e1ce'); metal.addColorStop(1, '#4e675c');
    ellipse(c, x, y, radius, radius, metal, '#faf3d4', .8);
    ellipse(c, x - 2.3, y - 3.3, 2.2, 1.5, '#fff'); c.restore();
  }

  function draw(now, dt) {
    ctx.clearRect(0, 0, W, H); ctx.drawImage(background, 0, 0, W, H);
    // The plunger spring compresses as power builds.
    const springTop = 725 + power * 13;
    ctx.beginPath(); ctx.moveTo(553, springTop);
    for (let i = 0; i < 9; i++) ctx.lineTo(i % 2 ? 553 : 572, springTop + i * (751 - springTop) / 9);
    ctx.strokeStyle = '#4f5340'; ctx.lineWidth = 3; ctx.stroke();
    line(ctx, 551, springTop - 1, 574, springTop - 1, '#f8e6b7', 4);
    if (game.round?.remaining > 0 && !engine.balls.some(b => b.phase === 'launch' && b.y > 620)) drawBall(ctx, 562, 712 + power * 12, 8.5);
    const rolling = now < rollingUntil;
    engine.slots.forEach((slot, i) => {
      const lit = rolling ? i === Math.floor(now / 65) % 10 : game.round?.litSlots.includes(i);
      if (!lit) return;
      ctx.save(); ctx.globalAlpha = rolling ? .85 : .7 + Math.sin(now / 450) * .15;
      ctx.shadowBlur = 20; ctx.shadowColor = '#fff39a';
      ellipse(ctx, slot.x + 24, 636, 8, 6, '#fff6ad');
      ctx.restore();
    });
    for (const [id, hit] of hits) {
      const age = (now - hit.time) / 500;
      if (age >= 1) { hits.delete(id); continue; }
      ctx.save(); ctx.globalAlpha = (1 - age) * .75;
      const glow = ctx.createRadialGradient(hit.x, hit.y, 0, hit.x, hit.y, 25);
      glow.addColorStop(0, '#fff4b8'); glow.addColorStop(.35, '#ffe477a0'); glow.addColorStop(1, '#ffe47800');
      ellipse(ctx, hit.x, hit.y, 25, 25, glow);
      ctx.beginPath(); ctx.arc(hit.x, hit.y, 8 + age * 20, 0, Math.PI * 2); ctx.strokeStyle = '#fff7b9'; ctx.lineWidth = 1.4; ctx.stroke(); ctx.restore();
    }
    for (const [i, time] of slotFlashes) {
      const age = (now - time) / 1200;
      if (age >= 1) { slotFlashes.delete(i); continue; }
      const slot = engine.slots[i]; const a = (1 - age) * (.6 + Math.sin(age * 25) * .2);
      ctx.save(); ctx.globalAlpha = a;
      rounded(ctx, slot.x + 3, 651, 42, 75, 10, '#ffe4a0');
      ctx.shadowBlur = 25; ctx.shadowColor = '#ffed9b'; ellipse(ctx, slot.x + 24, 636, 8, 6, '#fff0b1'); ctx.restore();
    }
    for (const ball of engine.balls) {
      if (ball.trail.length > 1) {
        ctx.beginPath(); ctx.moveTo(ball.x, ball.y);
        ball.trail.forEach(point => ctx.lineTo(point.x, point.y));
        ctx.lineCap = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = '#fff5c838'; ctx.stroke();
      }
      drawBall(ctx, ball.x, ball.y, ball.radius, Math.max(0, ball.fade));
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 200 * dt;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.life * 2); ctx.translate(p.x, p.y); ctx.rotate(p.life * 6); ctx.fillStyle = p.color; ctx.fillRect(-2, -2, p.size, p.size); ctx.restore();
    }
  }

  function onPegHit(event) {
    hits.set(event.pegId, { x: event.x, y: event.y, time: performance.now() });
    playSound('peg', event.peg.row);
  }
  function onScore(event) {
    const result = game.landBall(event.ballId, event.slotIndex);
    if (!result.accepted) return;
    saveProgress();
    recent.unshift({ hit: result.hit, reward: result.reward, slot: event.slotIndex + 1 });
    recent.length = Math.min(3, recent.length);
    $('recentShots').innerHTML = recent.map(s => `<li><span><span class="shot-num">${String(s.slot).padStart(2, '0')} 轨</span>${s.hit ? '亮灯命中！' : '下颗继续加油'}</span><span class="shot-points">${s.hit ? `+${s.reward} 珠` : '未中奖'}</span></li>`).join('');
    if (result.hit) {
      slotFlashes.set(event.slotIndex, performance.now());
      const pop = document.createElement('span'); pop.className = 'score-pop big';
      pop.textContent = `+${result.reward} 珠`; pop.style.left = `${event.x / W * 100}%`; pop.style.top = '86%'; $('floatingScores').appendChild(pop);
      setTimeout(() => pop.remove(), 1350);
      const panel = document.querySelector('.session-score'); panel.classList.remove('bump'); void panel.offsetWidth; panel.classList.add('bump');
      $('cabinet').classList.remove('jackpot'); void $('cabinet').offsetWidth; $('cabinet').classList.add('jackpot');
      for (let i = 0; i < 14; i++) particles.push({ x: event.x, y: 635, vx: (Math.random() - .5) * 230, vy: -60 - Math.random() * 200, life: .7 + Math.random() * .6, color: i % 2 ? '#fff2b4' : '#eb753b', size: 2 + Math.random() * 3 });
      playSound('score', result.reward);
    }
    updateUI();
  }
  function activeCount() { return engine.balls.filter(ball => !ball.scored).length; }
  function isOpenRound() { return !!game.round && game.round.phase !== 'settled'; }
  function canLaunch() { return isOpenRound() && game.round.remaining > 0 && performance.now() >= rollingUntil; }
  function currentStake() { return Number($('stakeInput').value); }
  function updateUI() {
    const r = game.round, open = isOpenRound(), rolling = performance.now() < rollingUntil;
    const stake = currentStake(), valid = Number.isInteger(stake) && stake >= 5 && stake <= 99 && stake <= game.wallet;
    const won = r?.won || 0, remaining = r?.remaining || 0;
    $('walletCount').textContent = game.wallet;
    $('cardCount').textContent = game.cards;
    $('inventoryCount').textContent = Object.values(game.inventory).reduce((sum, count) => sum + count, 0);
    $('scoreDigits').textContent = String(won).padStart(5, '0');
    $('ballDigits').textContent = String(remaining).padStart(2, '0');
    $('remainingBalls').textContent = remaining;
    $('sessionScore').textContent = won;
    $('bestScore').textContent = String(game.bestWin).padStart(4, '0');
    $('roundNumber').textContent = `第 ${String(r ? game.roundNumber : game.roundNumber + 1).padStart(2, '0')} 局`;
    if (!rolling) {
      $('multiplierValue').textContent = r ? `${r.multiplier}×` : '--×';
      $('multiplierDigits').textContent = r ? `${r.multiplier}×` : '--×';
    }
    $('litCount').textContent = r ? `${r.litSlots.length} / 10 条轨道亮灯` : '低倍率亮灯轨道更多';
    $('roundProgress').style.width = `${r ? r.resolved / r.stake * 100 : 0}%`;
    $('roundProgressText').textContent = r ? `已落袋 ${r.resolved} / ${r.stake} · 命中 ${r.hits} 颗` : '每局投入 5–99 颗';
    $('roundStatus').textContent = rolling ? '倍率抽取中…' : !r ? '选择投珠数量，抽取本局倍率' : r.phase === 'settled' ? '本局已结算，积分卡已入账' : remaining === 0 ? '等待台面上的弹珠全部落袋' : `命中亮灯轨道，每颗返还 ${r.multiplier} 颗弹珠`;
    $('stakeInput').disabled = open;
    $('stakeMinus').disabled = open || stake <= 5;
    $('stakePlus').disabled = open || stake >= Math.min(99, game.wallet);
    document.querySelectorAll('[data-stake]').forEach(button => { button.disabled = open || Number(button.dataset.stake) > game.wallet; button.classList.toggle('selected', Number(button.dataset.stake) === stake); });
    $('stakeHint').textContent = open ? `已投入 ${r.stake} 颗，本局倍率已锁定` : !Number.isInteger(stake) || stake < 5 || stake > 99 ? '请输入 5–99 的整数' : stake > game.wallet ? '弹珠不足，请减少投入' : `点击抽倍率将投入 ${stake} 颗 · 新手可从 5 颗开始`;
    $('drawMultiplier').disabled = open || !valid;
    $('drawMultiplier').textContent = rolling ? '正在抽取…' : open ? '本局倍率已锁定' : `投入 ${Number.isFinite(stake) ? stake : '—'} 颗 · 抽倍率`;
    launchButton.disabled = open && !canLaunch();
    $('leverHandle').disabled = !canLaunch();
    $('autoLaunchButton').disabled = !canLaunch();
    $('autoLaunchButton').textContent = autoFire ? '暂停连发' : '连续发射本局弹珠';
    $('autoLaunchButton').setAttribute('aria-pressed', String(autoFire));
    $('resetButton').disabled = rolling || activeCount() > 0 || !r;
    $('resetButton').textContent = !r || r.phase === 'settled' ? '准备下一局 ↗' : activeCount() ? '等待弹珠落袋…' : `结束本局 · 退回 ${remaining} 颗`;
    $('rescueButton').hidden = game.wallet >= 5 || open;
    if (!charging) {
      $('launchLabel').textContent = !r ? '选择投珠 · 开始游戏' : rolling ? '正在抽取倍率…' : r.phase === 'settled' ? '本局完成 · 准备下一局' : remaining === 0 ? '等待弹珠落袋…' : autoFire ? '连发中 · 点击可暂停' : '按住蓄力 · 松手发射';
      $('launchSublabel').textContent = !r ? '5–99 BALLS / ROUND' : canLaunch() ? `剩余 ${remaining} 颗 · ${r.multiplier} 倍好运` : 'PIGGY PINBALL CLUB';
    }
    $('shopCardCount').textContent = game.cards;
    if ($('shopDialog').open) renderShop();
  }
  function updatePower() {
    powerFill.style.width = `${power * 100}%`;
    $('powerMeter').setAttribute('aria-valuenow', Math.round(power * 100));
    powerLabel.textContent = charging ? `${Math.round(power * 100)}%` : '等待拉动';
    $('leverTrack').style.setProperty('--pull', String(power));
    if (charging) $('launchLabel').textContent = `${Math.round(power * 100)}% · 松手发射`;
  }
  function beginCharge(source) {
    if (charging || !canLaunch() || document.querySelector('dialog[open]')) return false;
    if (activeCount() >= 10) { toast('等一颗弹珠落袋，马上可以继续发射'); return false; }
    autoFire = false; initAudio(); charging = true; chargeSource = source; chargeStart = performance.now(); power = source.startsWith('lever') ? 0 : .08;
    launchButton.classList.add('charging'); $('launchSublabel').textContent = 'RELEASE TO LAUNCH'; updatePower(); return true;
  }
  function cancelCharge() {
    charging = false; chargeSource = ''; activePointer = null; power = 0;
    launchButton.classList.remove('charging'); updatePower(); updateUI();
  }
  function fire(force, quiet = false) {
    if (!canLaunch() || document.querySelector('dialog[open]')) return false;
    if (!engine.launch(force)) { if (!quiet) toast('台面有点热闹，等一颗落袋再发射'); return false; }
    game.launchBall(engine.balls[engine.balls.length - 1].id);
    lastPower = force; saveProgress(); $('boardHint').classList.add('hide');
    if (game.round.remaining === 0) autoFire = false;
    updateUI(); return true;
  }
  function releaseCharge() {
    if (!charging) return;
    const force = Math.max(.18, power), dragged = !chargeSource.startsWith('lever') || power > .03;
    cancelCharge();
    if (dragged) fire(force);
  }
  function prepareRound() {
    clearTimeout(endTimer); endTimer = undefined; autoFire = false; rollingUntil = 0;
    if (!game.clearRound()) return;
    engine.reset(); hits.clear(); slotFlashes.clear(); particles.length = 0; recent.length = 0; roundAnnounced = false;
    $('floatingScores').replaceChildren(); $('recentShots').innerHTML = '<li class="history-empty">亮灯轨道，等你来命中 <span>↘</span></li>';
    $('boardHint').classList.remove('hide'); $('endDialog').close();
    $('boardHint').innerHTML = '<span class="hint-star">✦</span> 先投珠抽倍率 · 亮灯轨道中奖 <span class="hint-star">✦</span>';
    saveProgress(); cancelCharge(); drawBackground();
  }
  function startRound() {
    const result = game.startRound(currentStake());
    if (!result.ok) { toast(result.error); return; }
    clearTimeout(endTimer); endTimer = undefined; roundAnnounced = false; autoFire = false;
    engine.reset(); hits.clear(); slotFlashes.clear(); particles.length = 0; recent.length = 0;
    $('floatingScores').replaceChildren(); $('recentShots').innerHTML = '<li class="history-empty">亮灯轨道，等你来命中 <span>↘</span></li>';
    $('boardHint').classList.remove('hide');
    rollingUntil = performance.now() + 750; lastRollDigit = -1;
    saveProgress(); initAudio(); drawBackground(); updateUI();
  }
  function finishRound() {
    const r = game.round;
    if (!r || r.phase !== 'settled' || roundAnnounced || endTimer || document.querySelector('dialog[open]')) return;
    autoFire = false; roundAnnounced = true; updateUI();
    endTimer = setTimeout(() => {
      endTimer = undefined;
      if (game.round !== r) return;
      if (document.querySelector('dialog[open]')) { roundAnnounced = false; return; }
      $('finalScore').textContent = r.won;
      $('finalCards').textContent = `+${r.cardsAwarded}`;
      $('finalHits').textContent = `${r.hits} / ${r.launched}`;
      $('finalStake').textContent = r.stake;
      $('recordMessage').textContent = `命中 ${r.hits} 颗 × ${r.multiplier} 倍 = ${r.won} 颗返珠。${r.refunded ? `另退回未发射的 ${r.refunded} 颗。` : ''}${r.cardsAwarded ? `获得 ${r.cardsAwarded} 张积分卡！` : '本局返珠未满30颗，继续收集好运。'}`;
      $('endDialog').showModal();
    }, 650);
  }
  function endOrPrepare() {
    if (!game.round || game.round.phase === 'settled') { prepareRound(); return; }
    autoFire = false; cancelCharge();
    const result = game.refundUnlaunched();
    if (!result.ok) { toast(result.error); return; }
    saveProgress(); updateUI(); finishRound();
  }
  function renderShop() {
    $('shopCardCount').textContent = game.cards;
    $('prizeList').innerHTML = PinballRules.PRIZES.map(prize => `<article class="prize-card"><span class="prize-icon" aria-hidden="true">${prize.icon}</span><h3 class="prize-name">${prize.name}</h3><span class="prize-cost">${prize.cost} 张积分卡</span><button type="button" class="redeem-button" data-prize="${prize.id}" ${game.cards < prize.cost ? 'disabled' : ''}>${game.cards < prize.cost ? `还差 ${prize.cost - game.cards} 张` : '兑换收藏'}</button></article>`).join('');
    const owned = PinballRules.PRIZES.filter(prize => game.inventory[prize.id] > 0);
    $('inventoryList').innerHTML = owned.length ? owned.map(prize => `<span class="inventory-item">${prize.icon} ${prize.name} × ${game.inventory[prize.id]}</span>`).join('') : '<p class="inventory-empty">用积分卡兑换第一件礼品，点亮你的收藏柜。</p>';
  }
  function goToSetup() {
    if (game.round?.phase === 'settled') prepareRound();
    document.querySelector('.stake-section').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  }
  function toast(message) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('visible');
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2500);
  }

  function initAudio() {
    if (!sound) return;
    try { const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return; if (!audioContext) audioContext = new Audio(); if (audioContext.state === 'suspended') audioContext.resume().catch(() => {}); } catch { /* Audio is optional. */ }
  }
  function note(freq, duration, volume, delay = 0, wave = 'sine') {
    if (!audioContext || audioContext.state !== 'running') return;
    const time = audioContext.currentTime + delay;
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = wave; oscillator.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(volume, time + .005); gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(time); oscillator.stop(time + duration + .02);
  }
  function playSound(type, value) {
    if (!sound || !audioContext) return;
    if (type === 'peg') { if (performance.now() - lastTick < 35) return; lastTick = performance.now(); note(780 + value * 95, .1, .035); }
    if (type === 'launch') { note(170, .11, .06, 0, 'triangle'); note(370, .14, .045, .06, 'triangle'); }
    if (type === 'score') { [523.25, 659.25, value >= 8 ? 1046.5 : 783.99].forEach((n, i) => note(n, .25, .055, i * .09, 'triangle')); }
  }
  function toggleSound() { sound = !sound; saveStorage('piggySound', sound); updateSound(); if (sound) { initAudio(); playSound('score', 10); } toast(sound ? '音效已开启，听见好运叮当响' : '音效已关闭'); }
  function updateSound() { $('soundButton').classList.toggle('muted', !sound); $('soundButton').setAttribute('aria-pressed', String(sound)); $('soundButton').setAttribute('aria-label', sound ? '关闭音效' : '开启音效'); }

  function bindLauncher(element, mode) {
    element.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.isPrimary === false || charging) return;
      e.preventDefault();
      if (element === launchButton && !isOpenRound()) { goToSetup(); return; }
      if (element === launchButton && autoFire) { autoFire = false; updateUI(); return; }
      let source = mode;
      if (mode === 'canvas') {
        const bounds = canvas.getBoundingClientRect();
        if ((e.clientX - bounds.left) / bounds.width * W > 535) source = 'lever-canvas';
      }
      if (!beginCharge(source)) return;
      activePointer = e.pointerId; dragStartY = e.clientY; element.setPointerCapture(e.pointerId);
    });
    element.addEventListener('pointermove', e => {
      if (activePointer !== e.pointerId || !chargeSource.startsWith('lever')) return;
      const distance = mode === 'canvas' ? canvas.getBoundingClientRect().height / H * 110 : 70;
      power = Math.max(0, Math.min(1, (e.clientY - dragStartY) / distance)); updatePower();
    });
    element.addEventListener('pointerup', e => { if (activePointer === e.pointerId) { e.preventDefault(); releaseCharge(); } });
    element.addEventListener('pointercancel', e => { if (activePointer === e.pointerId) cancelCharge(); });
    element.addEventListener('lostpointercapture', e => { if (activePointer === e.pointerId) cancelCharge(); });
    element.addEventListener('contextmenu', e => e.preventDefault());
    if (mode !== 'canvas') element.addEventListener('click', e => {
      if (e.detail !== 0 || charging) return;
      if (element === launchButton && !isOpenRound()) { goToSetup(); return; }
      if (element === launchButton && autoFire) { autoFire = false; updateUI(); return; }
      if (beginCharge('accessible')) { power = lastPower; releaseCharge(); }
    });
  }
  bindLauncher(launchButton, 'pointer');
  bindLauncher($('leverHandle'), 'lever');
  bindLauncher(canvas, 'canvas');
  document.addEventListener('keydown', e => {
    if (e.target.matches('input,textarea,select,[contenteditable="true"]')) return;
    if (e.code === 'Space' && !document.querySelector('dialog[open]') && (!e.target.closest('button,a') || e.target === launchButton || e.target === $('leverHandle'))) {
      e.preventDefault(); if (!e.repeat) { if (!isOpenRound()) goToSetup(); else beginCharge('keyboard'); }
    }
    if (e.code === 'KeyM' && !e.repeat) toggleSound();
  });
  document.addEventListener('keyup', e => { if (e.code === 'Space' && chargeSource === 'keyboard') { e.preventDefault(); releaseCharge(); } });
  window.addEventListener('blur', () => { autoFire = false; cancelCharge(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { autoFire = false; cancelCharge(); } lastFrame = performance.now(); });
  $('soundButton').addEventListener('click', toggleSound);
  $('drawMultiplier').addEventListener('click', startRound);
  $('stakeInput').addEventListener('input', updateUI);
  function adjustStake(value) { if (isOpenRound()) return; $('stakeInput').value = Math.max(5, Math.min(99, value)); updateUI(); }
  $('stakeMinus').addEventListener('click', () => adjustStake((currentStake() || 5) - 1));
  $('stakePlus').addEventListener('click', () => adjustStake((currentStake() || 5) + 1));
  document.querySelectorAll('[data-stake]').forEach(button => button.addEventListener('click', () => adjustStake(Number(button.dataset.stake))));
  $('autoLaunchButton').addEventListener('click', () => {
    if (!canLaunch()) return;
    const enable = !autoFire; cancelCharge(); autoFire = enable; nextAutoFire = 0; initAudio(); updateUI();
  });
  $('resetButton').addEventListener('click', endOrPrepare);
  $('playAgain').addEventListener('click', prepareRound);
  $('rescueButton').addEventListener('click', () => {
    const result = game.getRescue();
    if (!result.ok) { toast(result.error); return; }
    saveProgress(); updateUI(); toast('50 颗弹珠补给到账，继续出发！');
  });
  $('shopButton').addEventListener('click', () => { autoFire = false; cancelCharge(); renderShop(); $('shopDialog').showModal(); });
  $('prizeList').addEventListener('click', e => {
    const button = e.target.closest('[data-prize]'); if (!button) return;
    const result = game.redeem(button.dataset.prize);
    if (!result.ok) { toast(result.error); return; }
    saveProgress(); updateUI(); renderShop(); playSound('score', 12); toast(`已收藏「${result.prize.name}」`);
  });
  $('playNav').addEventListener('click', () => { document.querySelector('.machine-section').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); });
  document.querySelectorAll('[data-dialog]').forEach(button => {
    if (button.id === 'shopButton') return;
    button.addEventListener('click', () => { autoFire = false; cancelCharge(); $(button.dataset.dialog).showModal(); });
  });
  document.querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', e => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  }));
  $('startPlaying').addEventListener('click', () => { $('helpDialog').close(); (canLaunch() ? launchButton : $('stakeInput')).focus({ preventScroll: true }); });

  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, .05); lastFrame = now;
    if (charging && !chargeSource.startsWith('lever')) { const t = (now - chargeStart) / 1300; power = .08 + .92 * (1 - Math.abs((t % 2) - 1)); updatePower(); }
    if (rollingUntil > 0) {
      if (now < rollingUntil) {
        const digit = 2 + Math.floor(now / 65) % 11;
        if (digit !== lastRollDigit) { lastRollDigit = digit; $('multiplierValue').textContent = `${digit}×`; $('multiplierDigits').textContent = `${digit}×`; }
      } else {
        rollingUntil = 0; updateUI(); playSound('score', game.round.multiplier);
        $('boardHint').innerHTML = '<span class="hint-star">✦</span> 拉动拉杆 · 瞄准亮灯轨道 <span class="hint-star">✦</span>';
        if (matchMedia('(max-width:650px)').matches) document.querySelector('.machine-section').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        toast(`${game.round.multiplier} 倍好运 · ${game.round.litSlots.length} 条中奖轨道已亮灯`);
      }
    }
    if (autoFire && !charging && !document.hidden && !document.querySelector('dialog[open]') && now >= nextAutoFire) {
      if (fire(lastPower, true)) nextAutoFire = now + 450;
      else if (!canLaunch()) { autoFire = false; updateUI(); }
    }
    engine.step(dt); draw(now, dt); finishRound(); requestAnimationFrame(frame);
  }
  saveProgress(); drawBackground(); updatePower(); updateUI(); updateSound(); requestAnimationFrame(frame);
  if (game.recovered) toast(`已保留上局奖励，退回 ${game.recovered.refunded} 颗未落袋弹珠`);
  window.PiggyGame = { getState: () => ({ ...game.serialize(), charging, power, autoFire, activeBalls: activeCount() }), engine };
})();
