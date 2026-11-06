(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  const W = 600, H = 760;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const feederCanvas = $('feederCanvas');
  const feederCtx = feederCanvas.getContext('2d');
  feederCanvas.width = W * dpr;
  feederCanvas.height = PinballFeeder.HEIGHT * dpr;
  feederCtx.scale(dpr, dpr);
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
  let rollingUntil = 0, lastRollDigit = -1, lastPower = .65, dragStartY = 0;
  let helpPage = 0, layoutFrame = 0;
  let launchReady = false, launchAttempt = null, feedRound = null, feedDirty = false, feedCollected = 0;
  let feedPointAt = -Infinity, lastFeedSound = -Infinity;
  const audio = new PinballAudio({ enabled: sound });
  const haptics = new PinballHaptics({ enabled: readStorage('piggyHaptics', 'true') !== 'false' });
  const hits = new Map(), slotFlashes = new Map(), particles = [], recent = loadPractice();
  lastPower = normalizePower(recent[0]?.power ?? .65);
  const engine = new PinballPhysics({ onPegHit, onScore, onImpact, onExit: onGuideExit, onReturn: onGuideReturn, onLaunch: event => { playSound('launch'); haptics.launch(event.power); } });
  const collector = new PinballCollector();
  const feeder = new PinballFeeder({ onCollect: collectFeedPoint, onDrop: ball => collector.tryAdd(ball), onReady: readyFeedBall, onComplete: finishFeed });

  function readStorage(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
  function saveStorage(key, value) { try { localStorage.setItem(key, String(value)); } catch { /* Game remains playable without storage. */ } }
  function normalizePower(value) { return Math.max(.01, Math.min(1, Math.round(value * 100) / 100)); }
  function loadPractice() {
    try {
      const saved = JSON.parse(readStorage('piggyPracticeThresholdV3', '[]'));
      if (!Array.isArray(saved)) return [];
      return saved.filter(s => s && Number.isFinite(s.power) && s.power > .1 && s.power <= 1 && Number.isInteger(s.slot) && s.slot >= 1 && s.slot <= 10 && typeof s.hit === 'boolean' && Number.isSafeInteger(s.reward) && s.reward >= 0).slice(0, 3);
    } catch { return []; }
  }
  function renderPractice() {
    const previous = recent[0];
    $('shotMemory').textContent = previous ? `上次 ${Math.round(previous.power * 100)}% → ${String(previous.slot).padStart(2, '0')}轨` : '落袋后记录力度与轨道';
    $('shotMemory').setAttribute('aria-label', previous ? `上次力度 ${Math.round(previous.power * 100)}%，落入从左数第 ${previous.slot} 条轨道` : '完成一次发射后记录力度与轨道');
    $('recentShots').innerHTML = recent.length ? recent.map(s => `<li><span><span class="shot-num">${Math.round(s.power * 100)}% → ${String(s.slot).padStart(2, '0')} 轨</span>${s.hit ? '亮灯命中' : '已记录落点'}</span><span class="shot-points">${s.hit ? `+${s.reward} 珠` : '未中奖'}</span></li>`).join('') : '<li class="history-empty">练习力度，记住落点 <span>↘</span></li>';
  }
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

  function launchChuteFinish(c, curved = false) {
    const rail = PinballPhysics.LAUNCH_RAIL;
    // At the straight/arc join r = x - centerX, so the same colour stops
    // follow the channel's normal without a diagonal band through the bend.
    const chute = curved
      ? c.createRadialGradient(rail.centerX, rail.centerY, 540 - rail.centerX,
        rail.centerX, rail.centerY, 580 - rail.centerX)
      : c.createLinearGradient(540, 0, 580, 0);
    chute.addColorStop(0, '#b88e58'); chute.addColorStop(.3, '#cfa76f');
    chute.addColorStop(.7, '#c89d64'); chute.addColorStop(1, '#b88950');
    return chute;
  }
  function drawCabinetSurface(c, offsetY = 0) {
    // Both canvases are windows onto one continuous cabinet, in global units.
    const totalHeight = H + PinballFeeder.HEIGHT;
    c.save(); c.translate(0, -offsetY);
    const gradient = c.createLinearGradient(0, 0, 520, totalHeight);
    gradient.addColorStop(0, '#ed9750'); gradient.addColorStop(.5, '#e9a143'); gradient.addColorStop(1, '#e38b3c');
    c.fillStyle = gradient; c.fillRect(0, 0, W, totalHeight);
    c.save(); c.beginPath(); c.rect(30, 15, 492, totalHeight - 25); c.clip();
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      c.beginPath(); c.moveTo(278, 430); c.lineTo(278 + Math.cos(a) * 900, 430 + Math.sin(a) * 900); c.lineTo(278 + Math.cos(a + .095) * 900, 430 + Math.sin(a + .095) * 900); c.closePath(); c.fillStyle = '#b65c3023'; c.fill();
    }
    c.restore();
    // Only the bottom of the complete cabinet turns the outside corners.
    rounded(c, 11, 10, 578, totalHeight - 20, 28, null, '#ac5735', 18);
    rounded(c, 11, 10, 578, totalHeight - 20, 28, null, '#f9d39a', 3);
    // The playfield's inner trim continues down to the level storage tray.
    c.beginPath(); c.moveTo(58, 20); c.lineTo(497, 20);
    c.quadraticCurveTo(522, 20, 522, 45);
    c.lineTo(522, H + traySurface.floorAt(522));
    traceTrayFloor(c, 522, 33, H);
    c.lineTo(33, 45); c.quadraticCurveTo(33, 20, 58, 20); c.closePath();
    c.strokeStyle = '#994c2e'; c.lineWidth = 6; c.stroke();
    c.strokeStyle = '#ffe1a1'; c.lineWidth = 2; c.stroke();
    // The loading bay spans both canvases, so the new insert has no canvas seam.
    c.save(); c.translate(0, H);
    const bowl = makeTrayBowlPath(); c.clip(bowl);
    const well = c.createLinearGradient(0, 12, 0, 127);
    [[0,'#252c22'],[.35,'#343e2d'],[.8,'#414b35'],[1,'#2a3124']].forEach(([at,color]) => well.addColorStop(at,color));
    c.fillStyle = well; c.fillRect(30, -24, 498, 154);
    const ambient = c.createRadialGradient(158, 25, 0, 192, 46, 280);
    ambient.addColorStop(0, '#f4d48216'); ambient.addColorStop(1, '#f4d48200');
    c.fillStyle = ambient; c.fillRect(32, 13, 494, 113);
    // Warm enamel and champagne metal share the cabinet's existing palette.
    const bridge = c.createLinearGradient(0, -24, 0, 15);
    bridge.addColorStop(0, '#fff0ce'); bridge.addColorStop(1, '#ddbd8d');
    rounded(c, 32, -24, 494, 39, 9, bridge);
    line(c, 78, 15, 510, 15, '#242b1e', 3);
    line(c, 83, 17, 506, 17, '#e0c17d55', 1);
    text(c, '投 珠 仓', 279, -5, 17, '#665036', 'Microsoft YaHei, sans-serif');
    rounded(c, 105, -8, 62, 5, 2.5, '#b69a6c');
    rounded(c, 392, -8, 62, 5, 2.5, '#b69a6c');
    rounded(c, 461, -10, 23, 9, 4.5, '#ef8b46');
    // The lower tray's satin highlight follows its horizontal supporting floor.
    c.beginPath(); traceTrayFloor(c, 34, 524, -12, true);
    traceTrayFloor(c, 524, 34, -1); c.closePath();
    c.fillStyle = '#f5dfaa0e'; c.fill();
    for (const x of [33, 525]) {
      line(c, x, 15, x, traySurface.floorAt(x) - 4, '#e7c78f', 7);
      line(c, x + (x < 100 ? 4 : -4), 19, x + (x < 100 ? 4 : -4), traySurface.floorAt(x) - 6, '#96784d', 1.2);
    }
    // Inlet and upper channel are one continuous moulding across the seam.
    drawChuteBack(c);
    c.restore();
    c.restore();
  }
  function drawBackground() {
    drawCabinetSurface(bg);
    // Painted edge stripes and raised metal rails.
    for (let y = 65; y < 628; y += 35) {
      bg.beginPath(); bg.moveTo(12, y); bg.lineTo(25, y + 11); bg.lineTo(25, y + 21); bg.lineTo(12, y + 10); bg.fillStyle = '#f8ca88'; bg.fill();
    }
    const rail = PinballPhysics.LAUNCH_RAIL;
    const chute = launchChuteFinish(bg);
    // The painted channel and the simulation share one quarter-turn centerline.
    // Paint over the cabinet edge so the outlet is visibly open to the playfield.
    bg.save(); bg.lineCap = 'butt';
    bg.beginPath(); bg.moveTo(rail.startX, H); bg.lineTo(rail.startX, rail.startY);
    bg.arc(rail.centerX, rail.centerY, rail.radius, 0, -rail.angle, true);
    bg.strokeStyle = '#a57848'; bg.lineWidth = rail.halfWidth * 2 + 3; bg.stroke();
    bg.strokeStyle = chute; bg.lineWidth = rail.halfWidth * 2; bg.stroke();
    // Paint the bend over the continuous undercoat so no butt-cap gap opens
    // where its radial finish meets the straight shaft's linear finish.
    bg.beginPath(); bg.arc(rail.centerX, rail.centerY, rail.radius, 0, -rail.angle, true);
    bg.strokeStyle = launchChuteFinish(bg, true); bg.stroke();
    // A softly flared, open mouth blends the channel floor into the playfield.
    // Only the lip finish changes; the physical 90-degree guide stays intact.
    const mouthLeft = rail.exitX - 20, mouthTop = rail.exitY - rail.halfWidth - 6;
    const mouthWidth = 22, mouthHeight = (rail.halfWidth + 6) * 2;
    const mouthArt = document.createElement('canvas');
    mouthArt.width = mouthWidth * dpr; mouthArt.height = mouthHeight * dpr;
    const mouthCtx = mouthArt.getContext('2d'); mouthCtx.scale(dpr, dpr);
    mouthCtx.translate(-mouthLeft, -mouthTop);
    mouthCtx.fillStyle = launchChuteFinish(mouthCtx, true);
    mouthCtx.fillRect(mouthLeft, mouthTop, mouthWidth, mouthHeight);
    // Fade only the isolated outlet layer; retain the bend's cross-section
    // colours instead of covering it with a separate, flat dark-gold patch.
    mouthCtx.globalCompositeOperation = 'destination-in';
    const mouthFade = mouthCtx.createLinearGradient(mouthLeft, 0, rail.exitX, 0);
    mouthFade.addColorStop(0, '#0000'); mouthFade.addColorStop(1, '#000');
    mouthCtx.fillStyle = mouthFade;
    mouthCtx.fillRect(mouthLeft, mouthTop, mouthWidth, mouthHeight);
    bg.beginPath(); bg.moveTo(rail.exitX + 1, rail.exitY - rail.halfWidth);
    bg.bezierCurveTo(rail.exitX - 6, rail.exitY - rail.halfWidth, rail.exitX - 10, rail.exitY - rail.halfWidth - 6, rail.exitX - 20, rail.exitY - rail.halfWidth - 6);
    bg.lineTo(rail.exitX - 20, rail.exitY + rail.halfWidth + 6);
    bg.bezierCurveTo(rail.exitX - 10, rail.exitY + rail.halfWidth + 6, rail.exitX - 6, rail.exitY + rail.halfWidth, rail.exitX + 1, rail.exitY + rail.halfWidth);
    bg.closePath(); bg.save(); bg.clip();
    bg.drawImage(mouthArt, mouthLeft, mouthTop, mouthWidth, mouthHeight); bg.restore();
    bg.lineCap = 'round'; bg.lineJoin = 'round';
    for (const side of [-1, 1]) {
      const radius = rail.radius + side * rail.halfWidth;
      bg.beginPath(); bg.moveTo(rail.centerX + radius, H); bg.lineTo(rail.centerX + radius, rail.centerY);
      bg.arc(rail.centerX, rail.centerY, radius, 0, -rail.angle, true);
      const endY = rail.centerY - radius;
      bg.bezierCurveTo(rail.exitX - 6, endY, rail.exitX - 10, endY - side * 6, rail.exitX - 20, endY - side * 6);
      bg.strokeStyle = '#a57848'; bg.lineWidth = 2.6; bg.stroke();
      bg.strokeStyle = side < 0 ? '#f3d39b' : '#e8c18a'; bg.lineWidth = 1.1; bg.stroke();
    }
    bg.restore();
    for (let y = 258; y < 615; y += 100) {
      bg.beginPath(); bg.moveTo(555, y + 10); bg.lineTo(562, y); bg.lineTo(569, y + 10); bg.strokeStyle = '#f6d99b66'; bg.lineWidth = 2; bg.lineCap = 'round'; bg.stroke();
    }
    bg.save(); bg.translate(562, 155); bg.rotate(Math.PI / 2); text(bg, 'LAUNCH LANE', 0, 0, 9, '#78512e', 'monospace'); bg.restore();
    // The playfield's printed artwork.
    text(bg, 'LET THE GOOD', 279, 84, 18, '#fff0be', 'Arial Black, sans-serif', '900');
    bg.save(); bg.translate(279, 120); bg.rotate(-.035); text(bg, 'TIMES ROLL', 0, 0, 45, '#fff1c7', 'Impact, Arial Black, sans-serif', '900'); bg.restore();
    line(bg, 152, 148, 403, 148, '#a9522f55', 1);
    text(bg, game.round?.multiplier ? `${game.round.multiplier} 倍好运 · ${game.round.litSlots.length} 条亮灯轨道` : '投 珠 激 活  ·  自 动 获 取 倍 率', 279, 151, 11, '#9b472b', 'Microsoft YaHei, sans-serif');
    bg.save(); bg.globalAlpha = .82; drawPig(bg); bg.restore();
    text(bg, 'GOOD LUCK!', 279, 606, 17, '#ffdb9b', 'Arial Black, sans-serif', '900');
    // Every round has a fixed, clearly illuminated set of winning lanes.
    engine.slots.forEach((slot, i) => {
      const gold = !!game.round?.litSlots.includes(i);
      const x = slot.x + 4, width = slot.width - 8, center = slot.x + slot.width / 2;
      bg.save();
      // A copper bezel surrounds a wide glass window and a separate number plate.
      rounded(bg, x + 1, 654, width, 76, 10, '#56331f', '#794326', 2);
      const rim = bg.createLinearGradient(x, 650, x + width, 727);
      rim.addColorStop(0, gold ? '#fff1ae' : '#cdb58a');
      rim.addColorStop(.22, gold ? '#ffbb61' : '#a38a5b');
      rim.addColorStop(.48, gold ? '#aa5429' : '#66573b');
      rim.addColorStop(.75, gold ? '#f4b766' : '#a08c64');
      rim.addColorStop(1, gold ? '#ffe3a0' : '#c5ad7e');
      bg.shadowBlur = gold ? 16 : 0; bg.shadowColor = '#ff9d32';
      rounded(bg, x, 650, width, 77, 10, rim, gold ? '#ffe1a0' : '#755638', 1.6);
      bg.shadowBlur = 0;
      rounded(bg, x + 2.5, 652.5, width - 5, 72, 8, gold ? '#c68438' : '#726046', gold ? '#7c3d20' : '#514730', 1.5);
      const glass = bg.createLinearGradient(x, 656, x + width, 698);
      glass.addColorStop(0, gold ? '#453b23' : '#30352b');
      glass.addColorStop(.42, gold ? '#503418' : '#1c211a');
      glass.addColorStop(1, gold ? '#62441d' : '#404332');
      rounded(bg, x + 4, 655, width - 8, 43, 6, glass, gold ? '#fbd37f' : '#ad976a', 1.4);
      line(bg, x + 8, 658, x + width - 8, 658, gold ? '#fff0ac88' : '#ddd0a83d', 1);
      line(bg, x + 5, 700, x + width - 5, 700, gold ? '#f9cc84' : '#a18c65', 1);
      text(bg, String(i + 1).padStart(2, '0'), center, 713, 20, gold ? '#fff1ce' : '#e0d5b7', 'Arial, sans-serif', '700');
      bg.shadowBlur = gold ? 7 : 0; bg.shadowColor = '#ffac31';
      bg.fillStyle = gold ? '#fff3bc' : '#a8aa8c';
      bg.font = `700 ${gold ? (game.round.multiplier >= 10 ? 23 : 27) : 22}px Arial, sans-serif`;
      bg.textAlign = 'center'; bg.textBaseline = 'middle';
      bg.fillText(gold ? `×${game.round.multiplier}` : '—', center, 678, width - 8);
      bg.shadowBlur = 0;
      ellipse(bg, center, 638, 10, 7, '#75442d', '#d59655', 1.4);
      ellipse(bg, center, 636, 6.8, 4.4, gold ? '#f0ad50' : '#a66a43');
      bg.restore();
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
    [ [22, 37], [519, 37] ].forEach(([x, y]) => {
      ellipse(bg, x, y, 5, 5, '#cfbd90', '#795331', 1.5); line(bg, x - 2, y + 2, x + 2, y - 2, '#715332', 1);
    });
  }

  function drawBall(c, x, y, radius, alpha = 1) {
    c.save(); c.globalAlpha = alpha;
    ellipse(c, x + radius * .2, y + radius * .75, radius * 1.12, radius * .48, '#21150e66');
    const metal = c.createRadialGradient(x - radius * .34, y - radius * .42, radius * .02, x, y, radius);
    metal.addColorStop(0, '#ffffff'); metal.addColorStop(.23, '#f2f2e9'); metal.addColorStop(.47, '#b4b8b8'); metal.addColorStop(.72, '#6b7275'); metal.addColorStop(.88, '#383f45'); metal.addColorStop(1, '#a4a59d');
    ellipse(c, x, y, radius, radius, metal, '#393b36', 1.1);
    c.beginPath(); c.arc(x, y, radius * .82, .25, 1.7); c.strokeStyle = '#d1c7aa88'; c.lineWidth = radius * .12; c.stroke();
    ellipse(c, x - radius * .32, y - radius * .42, radius * .24, radius * .14, '#ffffffcc'); c.restore();
  }

  function draw(now, dt) {
    ctx.clearRect(0, 0, W, H); ctx.drawImage(background, 0, 0, W, H);
    // The waiting ball and spring now live in the connected lower feed tray.
    const rolling = now < rollingUntil;
    engine.slots.forEach((slot, i) => {
      const lit = rolling ? i === Math.floor(now / 65) % 10 : game.round?.litSlots.includes(i);
      if (!lit) return;
      ctx.save(); ctx.globalAlpha = rolling ? .85 : .7 + Math.sin(now / 450) * .15;
      ctx.shadowBlur = 18; ctx.shadowColor = '#ffac28';
      rounded(ctx, slot.x + 5, 651, slot.width - 10, 75, 9, null, '#ffe39b', 2.2);
      ellipse(ctx, slot.x + 24, 636, 7, 4.5, '#ffe6a0');
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

  function collectFeedPoint(tokenIndex) {
    if (game.round !== feedRound) return;
    const result = game.collectPoint(tokenIndex);
    if (!result.ok) return;
    feedCollected++; feedDirty = true;
    feedPointAt = performance.now();
    if (!document.hidden && feedPointAt - lastFeedSound > 85) {
      lastFeedSound = feedPointAt; playSound('peg', 2);
    }
  }
  function readyFeedBall() {
    if (game.round !== feedRound) return;
    launchReady = true; $('feederReady').textContent = '待发射 1 颗';
  }
  function finishFeed() {
    if (game.round !== feedRound) return;
    feedDirty = true;
    $('feederStatus').textContent = `入珠完成，本次增加 ${feedCollected} 积分，待发射 1 颗`;
    updateUI();
  }
  function flushFeedPoints() {
    if (!feedDirty) return;
    feedDirty = false;
    $('pointCount').textContent = game.points;
    $('pointCount').title = `${game.points} 积分`;
    saveProgress();
  }
  function finishFeedMotion() {
    // The outlet can hold a bead while the lower pile settles. Advance both
    // mechanisms together when skipping motion, so a full mouth can clear.
    for (let frame = 0; frame < 60 * 60 && feeder.busy; frame++) {
      feeder.step(1 / 60); collector.step(1 / 60);
    }
    collector.step(10);
    flushFeedPoints();
  }
  let feederArtwork, shownFeederGate = 1, lastGateFrame = 0;
  const traySurface = PinballFeeder.TRAY;
  const chuteSurface = PinballFeeder.CHUTE;
  function traceTrayFloor(path, from, to, offset = 0, move = false) {
    const step = from <= to ? 4 : -4;
    if (move) path.moveTo(from, traySurface.floorAt(from) + offset);
    else path.lineTo(from, traySurface.floorAt(from) + offset);
    for (let x = from + step; step > 0 ? x < to : x > to; x += step) path.lineTo(x, traySurface.floorAt(x) + offset);
    path.lineTo(to, traySurface.floorAt(to) + offset);
  }
  function traceChuteFloor(path, from, to, offset = 0, move = false) {
    const step = from <= to ? 4 : -4;
    if (move) path.moveTo(from, chuteSurface.floorAt(from) + offset);
    else path.lineTo(from, chuteSurface.floorAt(from) + offset);
    for (let x = from + step; step > 0 ? x < to : x > to; x += step) path.lineTo(x, chuteSurface.floorAt(x) + offset);
    path.lineTo(to, chuteSurface.floorAt(to) + offset);
  }
  function makeChuteBackPath(inner = false) {
    const path = new Path2D(), end = PinballCollector.MOUTH_LEFT;
    const left = inner ? 43 : 37, right = inner ? 69 : 75;
    const top = inner ? -14 : -18, bottomOffset = inner ? 0 : 6;
    const upperOffset = inner ? -23 : -25, shoulder = inner ? 82 : 88;
    const joinY = chuteSurface.floorAt(52) + bottomOffset;
    path.moveTo(50, top); path.quadraticCurveTo(left, top, left, -6);
    path.lineTo(left, inner ? 24 : 30);
    path.bezierCurveTo(left, inner ? 34 : 42, inner ? 46 : 43,
      joinY - chuteSurface.slopeAt(52) * (inner ? 6 : 9), 52, joinY);
    traceChuteFloor(path, 52, end, bottomOffset);
    traceChuteFloor(path, end, shoulder, upperOffset);
    const shoulderY = chuteSurface.floorAt(shoulder) + upperOffset;
    path.bezierCurveTo(shoulder - 8, shoulderY - chuteSurface.slopeAt(shoulder) * 8,
      right, inner ? 17 : 16, right, inner ? 10 : 8);
    path.lineTo(right, -6); path.quadraticCurveTo(right, top, 61, top);
    path.closePath(); return path;
  }
  function drawChuteBack(c) {
    const bezel = c.createLinearGradient(0, -18, 0, 76);
    [[0,'#fff0ce'],[.4,'#e1c593'],[.75,'#b59a69'],[1,'#8b734c']].forEach(([at,color]) => bezel.addColorStop(at,color));
    const outer = makeChuteBackPath();
    c.fillStyle = bezel; c.fill(outer);
    c.strokeStyle = '#8d754c'; c.lineWidth = 1.2; c.stroke(outer);
    const inner = makeChuteBackPath(true);
    const well = c.createLinearGradient(0, -14, 0, 76);
    [[0,'#1e271c'],[.4,'#46533b'],[1,'#2c3626']].forEach(([at,color]) => well.addColorStop(at,color));
    c.fillStyle = well; c.fill(inner);
    c.strokeStyle = '#806d49'; c.lineWidth = 1; c.stroke(inner);
    c.beginPath(); c.moveTo(40, -6); c.lineTo(40, 27);
    c.bezierCurveTo(40, 40, 45, 45, 52, chuteSurface.bottomAt(52) - 1);
    c.strokeStyle = '#fff0c48c'; c.lineWidth = 1.3; c.stroke();
    c.beginPath(); traceChuteFloor(c, 84, PinballCollector.MOUTH_LEFT, -24, true);
    c.strokeStyle = '#f7dfac88'; c.lineWidth = 1; c.stroke();
    for (const x of [100, 275, 424]) {
      const y = chuteSurface.floorAt(x) - 17;
      ellipse(c, x, y, 2.4, 2.4, '#c5aa78');
      line(c, x - 1, y, x + 1, y, '#75613f', 1);
    }
  }
  function launchFloorAt(x) {
    return PinballFeeder.launchPoint((x - PinballFeeder.INTAKE_X)
      / (PinballFeeder.LAUNCH_X - PinballFeeder.INTAKE_X)).y + 8.5;
  }
  function traceLaunchFloor(path, from, to, offset = 0, move = false) {
    const step = from <= to ? 2 : -2;
    const floor = x => launchFloorAt(x) + offset;
    if (move) path.moveTo(from, floor(from)); else path.lineTo(from, floor(from));
    for (let x = from + step; step > 0 ? x < to : x > to; x += step) path.lineTo(x, floor(x));
    path.lineTo(to, floor(to));
  }
  function traceDiverter(c) {
    c.beginPath(); c.moveTo(0, 0); c.lineTo(-4, 6);
    c.quadraticCurveTo(8, 19, -14, 26);
  }
  function makeTrayBowlPath() {
    const bowl = new Path2D(); bowl.moveTo(traySurface.LEFT, -24);
    bowl.lineTo(traySurface.RIGHT, -24);
    traceTrayFloor(bowl, traySurface.RIGHT, traySurface.LEFT);
    bowl.closePath();
    return bowl;
  }
  function makeTrayApronPath() {
    const apron = new Path2D(), top = traySurface.FLOOR + 1;
    apron.moveTo(traySurface.LEFT, top); apron.lineTo(traySurface.RIGHT, top);
    apron.quadraticCurveTo(530, top, 530, 131);
    apron.quadraticCurveTo(530, 134, traySurface.RIGHT, 134);
    apron.lineTo(traySurface.LEFT, 134);
    apron.quadraticCurveTo(28, 134, 28, 131);
    apron.quadraticCurveTo(28, top, traySurface.LEFT, top);
    apron.closePath();
    return apron;
  }
  function makeFeederArtwork() {
    const art = document.createElement('canvas'); art.width = W * dpr; art.height = PinballFeeder.HEIGHT * dpr;
    const c = art.getContext('2d'); c.scale(dpr, dpr); c.lineCap = 'round'; c.lineJoin = 'round';
    const gradient = (x1, y1, x2, y2, stops) => {
      const g = c.createLinearGradient(x1, y1, x2, y2); stops.forEach(([at, color]) => g.addColorStop(at, color)); return g;
    };
    drawCabinetSurface(c, H);
    // A level warm-enamel apron supports the olive well. It stays behind
    // the beads; only the transparent, half-bead-high guard is foreground art.
    const apron = makeTrayApronPath();
    c.save(); c.clip(apron);
    c.fillStyle = gradient(0, 127, 0, 136, [[0,'#fff0ce'],[.4,'#f1d1a2'],[.8,'#c7a576'],[1,'#9a794e']]);
    c.fillRect(23, 126, 507, 10);
    c.beginPath(); traceTrayFloor(c, traySurface.LEFT, traySurface.RIGHT, 3, true);
    c.strokeStyle = '#fff0ce'; c.lineWidth = 1; c.stroke();
    rounded(c, 55, 131, 45, 2, 1, '#a08255');
    rounded(c, 105, 131, 15, 2, 1, '#ef8b46');
    c.restore();
    // Rear support is painted before the receiver so neither its upright nor
    // the tray wall can cross the open branch. Bury the round foot in the casting.
    line(c, 421, 41, 548, 41, '#73502f33', 8);
    line(c, 421, 40, 548, 40, '#c9a16b', 5);
    line(c, 422, 38, 547, 38, '#eed0a0', 1);
    rounded(c, 494, 15, 28, 32, 6, gradient(0, 15, 0, 47, [[0,'#e5bd86'],[1,'#c49a64']]), '#ad824e', 1);
    line(c, 516, 44, 516, launchFloorAt(516), '#c69b63', 6);
    // The open upper recess receives the same fixed-size arm when folded up.
    c.save(); c.translate(500, 43); c.rotate(Math.PI); traceDiverter(c);
    c.strokeStyle = '#8c7752'; c.lineWidth = 9; c.stroke();
    c.strokeStyle = '#293322'; c.lineWidth = 6; c.stroke(); c.restore();
    // The receiver and shaft form one casting; its left wall opens into the
    // branch instead of crossing it. All ball-contact geometry stays unchanged.
    const branchStart = 504, branchEnd = PinballFeeder.LAUNCH_X, shoulderX = 532;
    c.beginPath(); c.moveTo(548, -10); c.lineTo(576, -10);
    c.lineTo(576, 119); c.quadraticCurveTo(576, 126, 569, 126);
    c.lineTo(555, 126); c.quadraticCurveTo(548, 126, 548, 119);
    c.lineTo(548, 99);
    c.quadraticCurveTo(548, 94, 540, launchFloorAt(540) + 6);
    traceLaunchFloor(c, 540, branchStart, 6);
    traceLaunchFloor(c, branchStart, shoulderX, -25);
    c.quadraticCurveTo(548, 62, 548, 48); c.closePath();
    c.fillStyle = launchChuteFinish(c); c.fill();
    // A soft recess gives depth without an olive/gold seam across the shaft.
    c.save(); c.clip();
    const recess = gradient(504, 0, 563, 0, [[0,'#6f59354d'],[.55,'#8e683329'],[1,'#8e683300']]);
    c.beginPath(); traceLaunchFloor(c, branchStart, branchEnd, -23, true);
    traceLaunchFloor(c, branchEnd, branchStart, -3); c.closePath();
    c.fillStyle = recess; c.fill(); c.restore();
    // One fine highlight follows each continuous outer edge of the junction.
    c.beginPath(); c.moveTo(548, 0); c.lineTo(548, 48);
    c.quadraticCurveTo(548, 62, shoulderX, launchFloorAt(shoulderX) - 25);
    traceLaunchFloor(c, shoulderX, branchStart, -25);
    c.moveTo(548, 99); c.lineTo(548, 119);
    c.quadraticCurveTo(548, 126, 555, 126); c.lineTo(569, 126);
    c.quadraticCurveTo(576, 126, 576, 119); c.lineTo(576, 0);
    c.strokeStyle = '#a57848'; c.lineWidth = 2.6; c.stroke();
    c.strokeStyle = '#edcb95'; c.lineWidth = 1.1; c.stroke();
    rounded(c, 582, 94, 4, 23, 2, '#e7c78f');
    return art;
  }
  function drawChuteFront(c, gate) {
    const end = PinballCollector.MOUTH_LEFT, branchX = 504;
    const branch = PinballFeeder.launchPoint((branchX - PinballFeeder.INTAKE_X)
      / (PinballFeeder.LAUNCH_X - PinballFeeder.INTAKE_X));
    const pivotY = chuteSurface.floorAt(end);
    const dx = branchX - end, dy = branch.y + 8.5 - pivotY;
    // A rigid bridge slides back into the left channel. The lip conceals the
    // retracted length; no part grows, shrinks or fades into existence.
    c.save(); c.beginPath(); c.rect(end - 1, pivotY - 5, dx + 3, 20); c.clip();
    line(c, end - gate * dx, pivotY - gate * dy,
      branchX - gate * dx, branch.y + 8.5 - gate * dy, '#b59a69', 6);
    line(c, end - gate * dx, pivotY - gate * dy - 2,
      branchX - gate * dx, branch.y + 6.5 - gate * dy, '#ffe5b3', 1.5); c.restore();
    // The inlet's lower cheek turns into the same continuous six-pixel lip.
    c.beginPath(); c.moveTo(43, 24);
    const innerY = chuteSurface.floorAt(52) - 3;
    c.bezierCurveTo(43, 32, 46, innerY - chuteSurface.slopeAt(52) * 6, 52, innerY);
    traceChuteFloor(c, 52, end, -3);
    traceChuteFloor(c, end, 52, 6);
    c.bezierCurveTo(43, chuteSurface.bottomAt(52) - chuteSurface.slopeAt(52) * 9, 37, 42, 37, 30);
    c.lineTo(37, 24); c.closePath();
    c.fillStyle = '#b59a69'; c.fill();
    c.beginPath(); c.moveTo(43, 24);
    c.bezierCurveTo(43, 32, 46, innerY - chuteSurface.slopeAt(52) * 6, 52, innerY);
    traceChuteFloor(c, 52, end, -3);
    c.strokeStyle = '#ffe5b3'; c.lineWidth = 1.8; c.stroke();
    c.beginPath(); c.moveTo(37, 24); c.lineTo(37, 30);
    c.bezierCurveTo(37, 42, 43, chuteSurface.bottomAt(52) - chuteSurface.slopeAt(52) * 9,
      52, chuteSurface.bottomAt(52));
    traceChuteFloor(c, 52, end, 6);
    c.strokeStyle = '#695737'; c.lineWidth = 1.5; c.stroke();
    // Fold the low lip into the near wall before the spring well. Its right
    // edge stays left of x547, clear of the seat even at full compression.
    const turnX = 532, wallX = 546;
    const traceReceiverLip = (path, lower = false) => {
      traceLaunchFloor(path, branchX, turnX, lower ? 6 : -3, true);
      if (lower) path.bezierCurveTo(542, launchFloorAt(turnX) + 10, wallX - 4, 94, wallX - 4, 99);
      else path.bezierCurveTo(542, launchFloorAt(turnX), wallX, 88, wallX, 99);
    };
    c.beginPath(); traceReceiverLip(c); c.lineTo(wallX, 102);
    c.quadraticCurveTo(wallX - 4, 102, wallX - 4, 99);
    c.bezierCurveTo(wallX - 4, 94, 542, launchFloorAt(turnX) + 10, turnX, launchFloorAt(turnX) + 6);
    traceLaunchFloor(c, turnX, branchX, 6); c.closePath();
    c.fillStyle = launchChuteFinish(c); c.fill();
    c.beginPath(); traceReceiverLip(c); c.lineTo(wallX, 102);
    c.strokeStyle = '#edcb95'; c.lineWidth = 1.2; c.stroke();
    c.beginPath(); traceReceiverLip(c, true);
    c.strokeStyle = '#a57848'; c.lineWidth = 1.2; c.stroke();
    rounded(c, end - 3, pivotY - 3, 5, 10, 1.5, '#b59a69', '#e9cf9d', 1);
  }
  function drawFeederBall(c, x, y, radius, opacity = 1) {
    drawBall(c, x, y, radius, opacity);
  }
  function drawCollectorFront(c) {
    // Nearly clear glass reflects the cabinet's warm colors. Its top edge
    // stays horizontal with the physical floor and the same low guard height.
    c.beginPath(); traceTrayFloor(c, traySurface.LEFT, traySurface.RIGHT, -6, true);
    traceTrayFloor(c, traySurface.RIGHT, traySurface.LEFT, 8); c.closePath();
    const glass = c.createLinearGradient(0, 80, 0, 134);
    glass.addColorStop(0, '#fff0ce20'); glass.addColorStop(1, '#d3c2a533');
    c.fillStyle = glass; c.fill();
    c.beginPath(); traceTrayFloor(c, traySurface.LEFT, traySurface.RIGHT, -6, true);
    c.strokeStyle = '#fff0ce'; c.lineWidth = 2; c.stroke();
    c.beginPath(); traceTrayFloor(c, traySurface.LEFT, traySurface.RIGHT, 6, true);
    c.strokeStyle = '#a58b60aa'; c.lineWidth = 1.5; c.stroke();
    for (const [x, direction] of [[traySurface.LEFT,1],[traySurface.RIGHT,-1]]) {
      const y = traySurface.floorAt(x);
      c.beginPath(); c.moveTo(x, y + 6); c.quadraticCurveTo(x - direction * 5, y + 5, x - direction * 5, y - 3);
      c.strokeStyle = '#edcfa0'; c.lineWidth = 4; c.stroke();
    }
  }
  function drawFeeder(now) {
    const c = feederCtx, snapshot = feeder.getSnapshot();
    const gateStep = Math.max(0, Math.min(.05, (now - lastGateFrame) / 1000));
    lastGateFrame = now;
    // Rearm visibly before the first bead reaches the outlet. Opening follows
    // the feeder's existing gate timing so collection always has a clear path.
    shownFeederGate = snapshot.gate < shownFeederGate
      ? Math.max(snapshot.gate, shownFeederGate - gateStep / .16) : snapshot.gate;
    if (!feederArtwork) feederArtwork = makeFeederArtwork();
    c.clearRect(0, 0, W, PinballFeeder.HEIGHT); c.drawImage(feederArtwork, 0, 0, W, PinballFeeder.HEIGHT);
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    const pointAge = (now - feedPointAt) / 650;
    // Status light belongs to the open inlet; it never overlays the roll path.
    rounded(c, 38, 0, 3, 17, 1.5, snapshot.inletOpen ? '#ffe5a2' : '#7a7952');
    if (snapshot.inletOpen) {
      const glow = c.createRadialGradient(40, 10, 0, 40, 10, 14);
      glow.addColorStop(0, '#ffda8b30'); glow.addColorStop(1, '#ffda8b00');
      ellipse(c, 40, 10, 14, 14, glow);
    }
    if (pointAge >= 0 && pointAge < 1) {
      c.save(); c.globalAlpha = 1 - pointAge;
      ellipse(c, 481, PinballFeeder.INTAKE_Y + 18, 15 + pointAge * 4, 5, '#ffb57530', '#ffc08a', 1.5);
      c.restore();
    }
    const springTop = 89 + (charging ? power * 10 : 0);
    c.beginPath(); c.moveTo(552, springTop);
    for (let i = 0; i <= 9; i++) c.lineTo(i % 2 ? 571 : 553, springTop + i * (120 - springTop) / 9);
    c.strokeStyle = '#413f2c'; c.lineWidth = 3.5; c.stroke();
    c.strokeStyle = '#e0c797'; c.lineWidth = 1.4; c.stroke();
    line(c, 551, springTop - 2, 573, springTop - 2, '#9a8154', 3.5);
    line(c, 551, springTop - 2, 573, springTop - 2, '#fff0c6', 1.5);
    // The fixed-size guide rotates on a visible bearing into its upper recess.
    c.save(); c.translate(500, 43); c.rotate(Math.PI * (1 - shownFeederGate));
    traceDiverter(c);
    c.strokeStyle = '#ef8b46'; c.lineWidth = 4; c.stroke();
    c.strokeStyle = '#ffdda7'; c.lineWidth = 1; c.stroke(); c.restore();
    ellipse(c, 500, 43, 4.4, 4.4, '#d9bd88', '#78613e', 1.2);
    line(c, 498.5, 43, 501.5, 43, '#77613e', 1);
    // Falling and stacked balls share the playfield's silver finish.
    const trayBalls = collector.getSnapshot().balls;
    c.save(); c.clip(makeTrayBowlPath());
    for (const ball of snapshot.balls) if (ball.x >= 56 && ball.x <= PinballFeeder.INTAKE_X) {
      const radius = ball.kind === 'point' ? 11 : 8.5;
      const contact = chuteSurface.centerAt(ball.x, radius);
      ellipse(c, contact.contactX, contact.contactY - 1, radius * .85, 1.8, '#17190f66');
    }
    c.restore();
    snapshot.balls.forEach(ball => {
      c.save();
      if (ball.x < chuteSurface.LEFT) c.clip(makeChuteBackPath(true));
      drawFeederBall(c, ball.x, ball.y, (ball.kind === 'point' ? 11 : 8.5) * ball.scale, ball.opacity);
      c.restore();
    });
    c.save(); c.clip(makeTrayBowlPath());
    // Silver beads and soft contact shadows stay distinct on the olive floor.
    for (const ball of trayBalls) ellipse(c, ball.x + 1.5, Math.min(traySurface.floorAt(ball.x), ball.y + ball.radius - 1), ball.radius * .9, 2.2, '#17190f66');
    trayBalls.slice().sort((a, b) => a.y - b.y).forEach(ball => drawFeederBall(c, ball.x, ball.y, ball.radius, ball.opacity));
    c.restore();
    drawChuteFront(c, shownFeederGate);
    drawCollectorFront(c);
    if (launchReady) {
      const seatY = PinballFeeder.LAUNCH_Y + (charging ? power * 10 : 0);
      drawFeederBall(c, PinballFeeder.LAUNCH_X, seatY, 8.5);
    }
    for (const ball of engine.balls) if (ball.y + ball.radius >= H) drawFeederBall(c, ball.x, ball.y - H, ball.radius, Math.max(0, ball.fade));
    const age = pointAge;
    if (age >= 0 && age < 1) {
      c.globalAlpha = Math.min(1, (1 - age) * 1.5);
      text(c, '+1', 482, 32 - age * 12, 17, '#ffd3aa', 'Microsoft YaHei, sans-serif');
    }
    c.restore();
  }

  function onPegHit(event) {
    hits.set(event.pegId, { x: event.x, y: event.y, time: performance.now() });
    playSound('peg', event.peg.row);
  }
  function onImpact(event) {
    haptics.impact(event.speed);
    if (event.kind !== 'peg') playSound('bounce', event.speed);
  }
  function onGuideExit(event) {
    if (launchAttempt !== event.ballId || !game.launchBall(event.ballId)) return;
    launchAttempt = null;
    lastPower = event.power;
    $('feederReady').textContent = '已发射'; $('feederStatus').textContent = '弹珠已发射，等待落袋';
    saveProgress(); updateUI();
  }
  function onGuideReturn(event) {
    if (launchAttempt !== event.ballId) return;
    launchAttempt = null; launchReady = true;
    $('feederReady').textContent = '待发射 1 颗'; $('feederStatus').textContent = '弹珠已回位，请重新拉杆';
    updateUI();
    $('leverInstruction').textContent = '弹珠已回位 · 请重新拉杆';
  }
  function onScore(event) {
    const result = game.landBall(event.ballId, event.slotIndex);
    if (!result.accepted) return;
    saveProgress();
    recent.unshift({ hit: result.hit, reward: result.reward, slot: event.slotIndex + 1, power: event.power ?? lastPower });
    recent.length = Math.min(3, recent.length);
    saveStorage('piggyPracticeThresholdV3', JSON.stringify(recent)); renderPractice();
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
  function canLaunch() { return launchReady && launchAttempt === null && !feeder.busy && game.round?.phase === 'ready' && game.round.remaining === 1 && performance.now() >= rollingUntil; }
  function canDeposit() { return !charging && launchAttempt === null && !feeder.busy && performance.now() >= rollingUntil && (!isOpenRound() || ['activated', 'ready'].includes(game.round.phase)); }
  function depositLimit() { return Math.min(game.wallet, 99 - (isOpenRound() ? game.round.stake : 0)); }
  function currentStake() { return Number($('stakeInput').value); }
  function isMobile() { return matchMedia('(max-width:650px), (max-width:950px) and (max-height:500px)').matches; }
  function updateUI() {
    const r = game.round, open = isOpenRound(), rolling = performance.now() < rollingUntil;
    const stake = currentStake(), limit = depositLimit(), editable = canDeposit();
    const valid = Number.isInteger(stake) && stake >= 1 && stake <= limit;
    const won = r?.won || 0, principal = r?.stake || 0;
    $('walletCount').textContent = game.wallet;
    $('pointCount').textContent = game.points;
    $('pointCount').title = `${game.points} 积分`;
    $('cardCount').textContent = game.cards;
    $('inventoryCount').textContent = Object.values(game.inventory).reduce((sum, count) => sum + count, 0);
    const settled = r?.phase === 'settled';
    const possibleReturn = r?.multiplier && !rolling ? principal * r.multiplier : 0;
    $('scoreDigits').textContent = String(settled ? won : possibleReturn).padStart(5, '0');
    $('scoreDisplayLabel').textContent = settled ? '本局返珠' : '命中可返';
    $('scoreDigits').setAttribute('aria-label', settled ? '本局实际返珠' : '命中亮灯轨道可返弹珠');
    $('rewardCardDigits').textContent = String(settled ? r.cardsAwarded : Math.floor(possibleReturn / 30)).padStart(2, '0');
    $('rewardCardDigits').setAttribute('aria-label', settled ? '本局实际获得积分卡，单位张' : '命中亮灯轨道可获积分卡，单位张');
    $('rewardCardLabel').innerHTML = `${settled ? '本局得卡' : '可获积分卡'} <small>CARDS</small>`;
    $('remainingBalls').textContent = principal;
    $('principalAmount').textContent = principal;
    $('potentialWin').textContent = r?.multiplier && !rolling ? possibleReturn : '—';
    $('sessionScore').textContent = won;
    $('bestScore').textContent = String(game.bestWin).padStart(4, '0');
    $('roundNumber').textContent = `第 ${String(r ? game.roundNumber : game.roundNumber + 1).padStart(2, '0')} 局`;
    if (!rolling) {
      $('multiplierValue').textContent = r?.multiplier ? `${r.multiplier}×` : '--×';
      $('multiplierDigits').textContent = r?.multiplier ? `${r.multiplier}×` : '--×';
    }
    $('litCount').textContent = r?.multiplier ? `${r.litSlots.length} / 10 条轨道亮灯` : '低倍率亮灯轨道更多';
    $('roundProgress').style.width = `${r?.phase === 'settled' ? 100 : 0}%`;
    $('roundProgressText').textContent = !r ? '每局本金 1–99 颗 · 只发射一次' : r.phase === 'playing' ? '已发射 1 / 1 次 · 等待落袋' : r.phase === 'settled' ? '本局已结束' : '剩余发射机会 1 / 1';
    $('roundStatus').textContent = feeder.busy ? '弹珠正从进珠口流入 · 入洞即时加分' : rolling ? '首次投珠成功，自动获取倍率…' : !r ? '点击投珠，自动激活并获取倍率' : r.phase === 'settled' ? '本局已结算，积分卡已入账' : r.phase === 'playing' ? '本金已锁定，等待这唯一一发落袋' : launchAttempt !== null ? '弹珠运动中 · 请稍候' : `可继续投珠加注 · 命中返还 ${principal} × ${r.multiplier} = ${principal * r.multiplier} 颗`;
    $('stakeInput').disabled = !editable || limit === 0;
    $('stakeInput').max = Math.max(1, limit);
    $('stakeSlider').max = Math.max(1, limit);
    $('stakeSlider').value = Number.isFinite(stake) ? Math.max(1, Math.min(limit, stake)) : 1;
    $('stakeSlider').disabled = !editable || limit === 0;
    $('stakeSlider').parentElement.hidden = limit === 0;
    $('stakeRangeMax').textContent = `${limit} 颗`;
    $('stakeDialogTitle').textContent = '设置投珠数量';
    $('stakeMinus').disabled = !editable || limit === 0 || stake <= 1;
    $('stakePlus').disabled = !editable || stake >= limit;
    $('stakeLimit').textContent = r?.phase === 'playing' ? '发射后本金已锁定' : open ? `还可加注 ${limit} 颗` : '本金共 1—99 颗';
    document.querySelectorAll('[data-stake]').forEach(button => { button.disabled = !editable || Number(button.dataset.stake) > limit; button.classList.toggle('selected', Number(button.dataset.stake) === stake); });
    $('stakeHint').textContent = r?.phase === 'playing' ? '已发射，本局不能再加注或发射' : launchAttempt !== null ? '弹珠运动中，请稍候' : charging ? '蓄力中，本金暂时锁定' : rolling ? '等待倍率确定后可继续加注' : limit === 0 ? '已达本局上限或弹珠余额不足' : !Number.isInteger(stake) || stake < 1 ? '请输入至少 1 颗的整数' : stake > limit ? `本次最多可投入 ${limit} 颗` : '设置数量不会扣珠，回到台面点击投珠按钮后投入。';
    $('depositButton').disabled = !editable || !valid;
    $('depositButton').textContent = `投珠 ${Number.isFinite(stake) ? stake : '—'} 颗`;
    $('saveStakeButton').disabled = !editable || (limit > 0 && !valid);
    $('saveStakeButton').textContent = limit === 0 ? '返回台面' : `完成 · 每次投 ${Number.isFinite(stake) ? stake : '—'} 颗`;
    $('multiplierStatus').textContent = rolling ? '首次投珠成功，正在获取倍率…' : r?.multiplier ? `已锁定 ${r.multiplier} 倍 · 加注不改变倍率` : '首次投珠自动抽取 2—12 倍，发射前加注倍率不变。';
    launchButton.disabled = !canLaunch();
    $('leverHandle').disabled = !canLaunch();
    $('addStakeButton').disabled = !editable;
    $('leverInstruction').textContent = feeder.busy ? '正在入珠 · 请稍候' : rolling ? '投珠成功 · 正在获取倍率' : !r ? '投珠后自动获取倍率' : r.phase === 'playing' ? '本局已发射 · 等待落袋' : r.phase === 'settled' ? '投珠开始下一局' : launchAttempt !== null ? '弹珠运动中 · 请稍候' : '下拉蓄力 · 松手发射';
    $('rescueButton').hidden = game.wallet >= 1 || open;
    if (!charging) {
      $('launchLabel').textContent = feeder.busy ? '弹珠入槽中…' : rolling ? '正在获取倍率…' : !r || r.phase === 'settled' ? '先投珠 · 自动激活游戏' : r.phase === 'playing' ? '等待弹珠落袋…' : launchAttempt !== null ? '弹珠运动中…' : '按住蓄力 · 松手发射';
      $('launchSublabel').textContent = !r ? '1–99 PRINCIPAL / ONE SHOT' : canLaunch() ? `本金 ${principal} 颗 · ${r.multiplier} 倍好运` : 'PIGGY PINBALL CLUB';
    }
    $('shopCardCount').textContent = game.cards;
    if ($('shopDialog').open) renderShop();
  }
  function updatePower() {
    powerFill.style.width = `${power * 100}%`;
    $('powerMeter').setAttribute('aria-valuenow', Math.round(power * 100));
    powerLabel.textContent = charging ? `${Math.round(power * 100)}%` : '等待拉动';
    $('leverHandle').setAttribute('aria-label', charging ? `当前力度 ${Math.round(power * 100)}%，松开发射` : '向下拉动拉杆蓄力，松开发射');
    $('leverTrack').style.setProperty('--pull', String(power));
    if (charging) $('launchLabel').textContent = `${Math.round(power * 100)}% · 松手发射`;
    if (charging) haptics.pull(power);
  }
  function beginCharge(source) {
    if (charging || !canLaunch() || document.querySelector('dialog[open]')) return false;
    if (activeCount() > 0) return false;
    initAudio(); charging = true; chargeSource = source; chargeStart = performance.now(); power = source.startsWith('lever') ? 0 : .08;
    haptics.beginCharge();
    launchButton.classList.add('charging'); $('launchSublabel').textContent = 'RELEASE TO LAUNCH'; updatePower(); updateUI(); return true;
  }
  function cancelCharge() {
    haptics.stop();
    charging = false; chargeSource = ''; activePointer = null; power = 0;
    launchButton.classList.remove('charging'); updatePower(); updateUI();
  }
  function fire(force) {
    if (!canLaunch() || document.querySelector('dialog[open]')) return false;
    force = normalizePower(force);
    if (!engine.launch(force, { startY: H + PinballFeeder.LAUNCH_Y + force * 10 })) return false;
    const ball = engine.balls[engine.balls.length - 1];
    launchAttempt = ball.id;
    launchReady = false; $('feederReady').textContent = '弹珠运动中'; $('feederStatus').textContent = '弹珠运动中，请稍候';
    $('boardHint').classList.add('hide');
    updateUI(); return true;
  }
  function releaseCharge() {
    if (!charging) return;
    // A touch release is a valid Safari audio gesture, even when pointerdown
    // did not unlock playback. Do this before the launch sound is requested.
    initAudio();
    const force = normalizePower(power), dragged = !chargeSource.startsWith('lever') || power >= .01;
    cancelCharge();
    if (dragged) fire(force);
  }
  function prepareRound() {
    clearTimeout(endTimer); endTimer = undefined; rollingUntil = 0;
    if (!game.clearRound()) return;
    feeder.reset(); collector.reset(); launchReady = false; launchAttempt = null; feedRound = null; feedPointAt = -Infinity; feedDirty = false;
    $('feederReady').textContent = '待发射 0 颗'; $('feederStatus').textContent = '等待投珠';
    engine.reset(); hits.clear(); slotFlashes.clear(); particles.length = 0; roundAnnounced = false;
    $('floatingScores').replaceChildren();
    $('boardHint').classList.remove('hide'); $('endDialog').close();
    $('boardHint').innerHTML = '<span class="hint-star">✦</span> 投珠自动获取倍率 · 一发定局 <span class="hint-star">✦</span>';
    saveProgress(); cancelCharge(); drawBackground();
  }
  function depositStake() {
    if (!canDeposit()) return;
    clearTimeout(toastTimer); $('toast').classList.remove('visible');
    const adding = isOpenRound();
    if (!adding && game.round) prepareRound();
    const amount = currentStake(), pointOffset = adding ? game.round.stake - 1 : 0;
    const result = adding ? game.addStake(amount) : game.startRound(amount);
    if (!result.ok) { toast(result.error); return; }
    if (!adding) {
      collector.reset();
      clearTimeout(endTimer); endTimer = undefined; roundAnnounced = false;
      engine.reset(); hits.clear(); slotFlashes.clear(); particles.length = 0;
      $('floatingScores').replaceChildren();
      $('boardHint').classList.remove('hide');
      $('boardHint').innerHTML = '<span class="hint-star">✦</span> 首次投珠成功 · 自动获取倍率 <span class="hint-star">✦</span>';
      rollingUntil = performance.now() + 750; lastRollDigit = -1;
    }
    feedRound = game.round; feedCollected = 0;
    feeder.start({ count: amount, launchBall: !adding, pointOffset });
    $('feederStatus').textContent = `正在投入 ${amount} 颗弹珠${adding ? '，全部进入积分收集口' : '，首颗进入发射轨道'}`;
    const limit = depositLimit();
    if (limit > 0 && currentStake() > limit) $('stakeInput').value = limit;
    saveProgress(); initAudio(); drawBackground(); updateUI();
    if ($('stakeDialog').open) $('stakeDialog').close();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) finishFeedMotion();
  }
  function finishRound() {
    const r = game.round;
    if (!r || r.phase !== 'settled' || roundAnnounced || endTimer || document.querySelector('dialog[open]')) return;
    roundAnnounced = true; updateUI();
    endTimer = setTimeout(() => {
      endTimer = undefined;
      if (game.round !== r) return;
      if (document.querySelector('dialog[open]')) { roundAnnounced = false; return; }
      $('finalScore').textContent = r.won;
      $('finalCards').textContent = `+${r.cardsAwarded}`;
      $('finalHits').textContent = r.refunded ? '已取消' : r.hits ? '命中' : '未命中';
      $('finalStake').textContent = r.stake;
      $('recordMessage').textContent = r.refunded ? `发射前取消本局，已退回全部 ${r.refunded} 颗本金。` : `${r.hits ? `本金 ${r.stake} 颗 × ${r.multiplier} 倍 = ${r.won} 颗返珠（含本金）。` : `本局唯一一发未命中亮灯轨道，${r.stake} 颗本金不返还。`}${r.cardsAwarded ? `获得 ${r.cardsAwarded} 张积分卡！` : '本局返珠未满30颗，未获得积分卡。'}`;
      $('endDialog').showModal();
    }, 650);
  }
  function renderShop() {
    $('shopCardCount').textContent = game.cards;
    $('prizeList').innerHTML = PinballRules.PRIZES.map(prize => `<article class="prize-card"><span class="prize-icon" aria-hidden="true">${prize.icon}</span><h3 class="prize-name">${prize.name}</h3><span class="prize-cost">${prize.cost} 张积分卡</span><button type="button" class="redeem-button" data-prize="${prize.id}" ${game.cards < prize.cost ? 'disabled' : ''}>${game.cards < prize.cost ? `还差 ${prize.cost - game.cards} 张` : '兑换收藏'}</button></article>`).join('');
    const owned = PinballRules.PRIZES.filter(prize => game.inventory[prize.id] > 0);
    $('inventoryList').innerHTML = owned.length ? owned.map(prize => `<span class="inventory-item">${prize.icon} ${prize.name} × ${game.inventory[prize.id]}</span>`).join('') : '<p class="inventory-empty">用积分卡兑换第一件礼品，点亮你的收藏柜。</p>';
  }
  function goToSetup() {
    if (game.round?.phase === 'settled') prepareRound();
    if (isMobile()) {
      if (!$('stakeDialog').open) $('stakeDialog').showModal();
      $('stakePlus').focus({ preventScroll: true });
      return;
    }
    const first = document.querySelector('.stake-section');
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    first.scrollIntoView({ behavior, block: 'center' });
  }
  function fitViewport() {
    const mobile = isMobile(), controls = $('setupControls');
    document.documentElement.style.setProperty('--app-height', `${window.visualViewport?.height || window.innerHeight}px`);
    const home = mobile ? $('stakeDialogContent') : $('setupHome');
    if (controls.parentElement !== home) {
      if ($('stakeDialog').open) $('stakeDialog').close();
      home.appendChild(controls);
    }
    $('stakeInput').readOnly = mobile;
    $('stakeInput').setAttribute('inputmode', mobile ? 'none' : 'numeric');
    if (mobile) $('addStakeButton').setAttribute('aria-haspopup', 'dialog');
    else $('addStakeButton').removeAttribute('aria-haspopup');
    if (mobile) {
      const board = document.querySelector('.machine-section').getBoundingClientRect();
      const width = Math.max(0, Math.min(board.width - 12, (board.height - 33) * W / (H + PinballFeeder.HEIGHT)));
      document.documentElement.style.setProperty('--mobile-machine-width', `${width}px`);
    }
    document.documentElement.style.setProperty('--mobile-dock-height', `${$('launchConsole').getBoundingClientRect().height}px`);
  }
  function scheduleLayout() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; fitViewport(); });
  }
  function showHelpPage(index) {
    const pages = [...document.querySelectorAll('.help-page')];
    helpPage = Math.max(0, Math.min(pages.length - 1, index));
    pages.forEach((page, i) => { page.hidden = i !== helpPage; });
    $('helpPrev').disabled = helpPage === 0;
    $('helpNext').disabled = helpPage === pages.length - 1;
    $('helpPageCount').textContent = `${helpPage + 1} / ${pages.length}`;
  }
  function toast(message) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('visible');
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2500);
  }

  function initAudio() { return audio.unlock(); }
  function playSound(type, value) { audio.play(type, value); }
  function toggleSound() {
    sound = !sound; audio.setEnabled(sound); saveStorage('piggySound', sound); updateSound();
    if (sound) { initAudio(); playSound('score', 10); }
    toast(sound ? '音效已开启 · 播放测试音' : '音效已关闭');
  }
  function updateSound() { $('soundButton').classList.toggle('muted', !sound); $('soundButton').setAttribute('aria-pressed', String(sound)); $('soundButton').setAttribute('aria-label', sound ? '关闭音效' : '开启音效'); }
  function updateHaptics() {
    const status = haptics.getStatus(), supported = haptics.isSupported();
    $('hapticButton').classList.toggle('muted', !status.enabled || !supported);
    $('hapticButton').setAttribute('aria-pressed', String(status.enabled && supported));
    $('hapticButton').setAttribute('aria-label', !supported ? '震动反馈：当前浏览器不支持' : status.enabled ? '关闭震动反馈' : '开启震动反馈');
  }
  function toggleHaptics() {
    if (!haptics.isSupported()) { toast('当前浏览器不支持震动反馈，音效和游戏仍可正常使用'); return; }
    const enabled = !haptics.getStatus().enabled;
    haptics.setEnabled(enabled); saveStorage('piggyHaptics', enabled); updateHaptics();
    if (enabled) haptics.preview();
    toast(enabled ? '震动已开启：轻拉轻震，重碰更强' : '震动反馈已关闭');
  }

  function bindLauncher(element, mode) {
    element.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.isPrimary === false || charging) return;
      e.preventDefault();
      if (element === launchButton && (!isOpenRound() || game.round.phase === 'activated')) { goToSetup(); return; }
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
      power = Math.max(0, Math.min(1, Math.round((e.clientY - dragStartY) / distance * 100) / 100)); updatePower();
    });
    element.addEventListener('pointerup', e => { if (activePointer === e.pointerId) { e.preventDefault(); releaseCharge(); } });
    element.addEventListener('pointercancel', e => { if (activePointer === e.pointerId) cancelCharge(); });
    element.addEventListener('lostpointercapture', e => { if (activePointer === e.pointerId) cancelCharge(); });
    element.addEventListener('contextmenu', e => e.preventDefault());
    if (mode !== 'canvas') element.addEventListener('click', e => {
      if (e.detail !== 0 || charging) return;
      if (element === launchButton && (!isOpenRound() || game.round.phase === 'activated')) { goToSetup(); return; }
      if (beginCharge('accessible')) { power = lastPower; releaseCharge(); }
    });
  }
  bindLauncher(launchButton, 'pointer');
  bindLauncher($('leverHandle'), 'lever');
  bindLauncher(canvas, 'canvas');
  // Keep gesture retries available after iOS interruptions. Capture the end
  // of a touch as well as click: dragging the lever can suppress its click.
  function unlockAudioFromGesture(e) {
    if (!e.isTrusted || e.target.closest?.('#soundButton')) return;
    if (e.type === 'keydown' && (e.repeat || !['Enter', ' ', 'm', 'M'].includes(e.key))) return;
    initAudio();
  }
  for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
    document.addEventListener(type, unlockAudioFromGesture, { capture: true, passive: true });
  }
  document.addEventListener('keydown', e => {
    if (e.target.matches('input,textarea,select,[contenteditable="true"]')) return;
    if (e.code === 'Space' && !document.querySelector('dialog[open]') && (!e.target.closest('button,a') || e.target === launchButton || e.target === $('leverHandle'))) {
      e.preventDefault(); if (!e.repeat) { if (!isOpenRound() || game.round.phase === 'activated') goToSetup(); else beginCharge('keyboard'); }
    }
    if (e.code === 'KeyM' && !e.repeat) toggleSound();
  });
  document.addEventListener('keyup', e => { if (e.code === 'Space' && chargeSource === 'keyboard') { e.preventDefault(); releaseCharge(); } });
  window.addEventListener('blur', cancelCharge);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelCharge(); audio.pause(); finishFeedMotion(); }
    else audio.recover();
    lastFrame = performance.now();
  });
  window.addEventListener('pagehide', () => audio.pause());
  window.addEventListener('pageshow', () => audio.recover());
  window.addEventListener('focus', () => audio.recover());
  $('soundButton').addEventListener('click', toggleSound);
  $('hapticButton').addEventListener('click', toggleHaptics);
  $('depositButton').addEventListener('click', depositStake);
  $('saveStakeButton').addEventListener('click', () => {
    if ($('saveStakeButton').disabled) return;
    if ($('stakeDialog').open) $('stakeDialog').close();
    if (depositLimit() === 0) { (canLaunch() ? $('leverHandle') : $('addStakeButton')).focus({ preventScroll: true }); return; }
    $('depositButton').focus({ preventScroll: true });
    toast(`已设定每次投入 ${currentStake()} 颗，点击投珠按钮后投入`);
  });
  $('stakeInput').addEventListener('input', updateUI);
  $('stakeSlider').addEventListener('input', () => adjustStake(Number($('stakeSlider').value)));
  function adjustStake(value) { if (!canDeposit() || depositLimit() < 1) return; $('stakeInput').value = Math.max(1, Math.min(depositLimit(), value)); updateUI(); }
  $('stakeMinus').addEventListener('click', () => adjustStake((currentStake() || 1) - 1));
  $('stakePlus').addEventListener('click', () => adjustStake((currentStake() || 1) + 1));
  document.querySelectorAll('[data-stake]').forEach(button => button.addEventListener('click', () => adjustStake(Number(button.dataset.stake))));
  $('addStakeButton').addEventListener('click', goToSetup);
  $('playAgain').addEventListener('click', prepareRound);
  $('rescueButton').addEventListener('click', () => {
    const result = game.getRescue();
    if (!result.ok) { toast(result.error); return; }
    saveProgress(); updateUI(); toast('50 颗弹珠补给到账，继续出发！');
  });
  $('shopButton').addEventListener('click', () => { cancelCharge(); renderShop(); $('shopDialog').showModal(); });
  $('prizeList').addEventListener('click', e => {
    const button = e.target.closest('[data-prize]'); if (!button) return;
    const result = game.redeem(button.dataset.prize);
    if (!result.ok) { toast(result.error); return; }
    saveProgress(); updateUI(); renderShop(); playSound('score', 12); toast(`已收藏「${result.prize.name}」`);
  });
  $('playNav').addEventListener('click', () => { if (!isMobile()) document.querySelector('.machine-section').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); });
  document.querySelectorAll('[data-dialog]').forEach(button => {
    if (button.id === 'shopButton') return;
    button.addEventListener('click', () => { cancelCharge(); if (button.dataset.dialog === 'helpDialog') showHelpPage(0); $(button.dataset.dialog).showModal(); });
  });
  document.querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', e => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  }));
  $('startPlaying').addEventListener('click', () => {
    $('helpDialog').close();
    if (canLaunch()) {
      (isMobile() ? $('leverHandle') : launchButton).focus({ preventScroll: true });
    } else $('depositButton').focus({ preventScroll: true });
  });
  $('helpPrev').addEventListener('click', () => showHelpPage(helpPage - 1));
  $('helpNext').addEventListener('click', () => showHelpPage(helpPage + 1));

  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, .05); lastFrame = now;
    if (charging && !chargeSource.startsWith('lever')) { const t = (now - chargeStart) / 1300; power = normalizePower(.08 + .92 * (1 - Math.abs((t % 2) - 1))); updatePower(); }
    if (rollingUntil > 0) {
      if (now < rollingUntil) {
        const digit = 2 + Math.floor(now / 65) % 11;
        if (digit !== lastRollDigit) { lastRollDigit = digit; $('multiplierValue').textContent = `${digit}×`; $('multiplierDigits').textContent = `${digit}×`; }
      } else {
        rollingUntil = 0; updateUI(); playSound('score', game.round.multiplier);
        $('boardHint').innerHTML = '<span class="hint-star">✦</span> 可继续加注 · 只发射一次 <span class="hint-star">✦</span>';
      }
    }
    feeder.step(dt); collector.step(dt); flushFeedPoints(); engine.step(dt); draw(now, dt); drawFeeder(now); finishRound(); requestAnimationFrame(frame);
  }
  const layoutObserver = new ResizeObserver(scheduleLayout);
  layoutObserver.observe(document.querySelector('.machine-section'));
  layoutObserver.observe($('launchConsole'));
  window.addEventListener('resize', scheduleLayout);
  window.visualViewport?.addEventListener('resize', scheduleLayout);
  fitViewport(); showHelpPage(0);
  saveProgress(); drawBackground(); renderPractice(); updatePower(); updateUI(); updateSound(); updateHaptics(); requestAnimationFrame(frame);
  if (game.recovered) toast(`上局未完成，已退回 ${game.recovered.refunded} 颗弹珠并保留已结算奖励`);
  window.PiggyGame = { getState: () => ({ ...game.serialize(), charging, power, activeBalls: activeCount(), feeding: feeder.busy, launchReady, guideBusy: launchAttempt !== null }), engine };
})();
