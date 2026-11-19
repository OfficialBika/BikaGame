const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';
let config = null;
let pollTimer = null;
let rafTimer = null;
let liveRound = null;
let rocketVisual = null;
let rocketVisualReady = null;
let slotSpinTimer = null;
let wheelRotation = 0;
const urlParams = new URLSearchParams(window.location.search);
function getStartParam() {
  return String(
    tg?.initDataUnsafe?.start_param ||
    urlParams.get('tgWebAppStartParam') ||
    urlParams.get('startapp') ||
    ''
  ).trim();
}
function parseStartTarget() {
  const start = getStartParam();
  const queryGame = urlParams.get('game') || '';
  const queryRoom = urlParams.get('room') || '';
  return { game: queryGame, room: queryRoom };
}
const startTarget = parseStartTarget();

const SLOT_SYMBOLS = ['🍒', '🍋', '🍉', '🔔', '⭐', 'BAR', '7️⃣'];
const PANEL_TO_GAME = { crash: 'rocket', slot: 'slot', plinko: 'plinko', wheel: 'wheel', mines: 'mines' };
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const coin = () => config?.coin || '$';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ===== Premium v13 Audio Engine: no external files, generated with Web Audio ===== */
const AudioFX = (() => {
  const KEY_ON = 'bika_audio_enabled_v13';
  const KEY_MUSIC = 'bika_audio_music_v13';
  const KEY_SFX = 'bika_audio_sfx_v13';
  const sceneNames = { home:'Lobby Ambience', crash:'Rocket Engine', slot:'Slot Neon', plinko:'Plinko Bounce', wheel:'Lucky Wheel', mines:'Mines Tension' };
  const scales = {
    home:[196,246.94,293.66,392], crash:[110,146.83,220,293.66], slot:[261.63,329.63,392,523.25], plinko:[293.66,369.99,440,587.33], wheel:[261.63,329.63,392,493.88], mines:[82.41,110,164.81,220]
  };
  let ctx = null, master = null, musicGain = null, sfxGain = null, musicTimer = null, enabled = localStorage.getItem(KEY_ON) === '1', scene = 'home', step = 0;
  let musicVolume = Number(localStorage.getItem(KEY_MUSIC) || 32) / 100;
  let sfxVolume = Number(localStorage.getItem(KEY_SFX) || 68) / 100;
  function setup() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.85; master.connect(ctx.destination);
    musicGain = ctx.createGain(); sfxGain = ctx.createGain();
    musicGain.gain.value = musicVolume * 0.16; sfxGain.gain.value = sfxVolume * 0.58;
    musicGain.connect(master); sfxGain.connect(master);
    return ctx;
  }
  function now() { return setup()?.currentTime || 0; }
  function safeResume() { const c = setup(); if (c && c.state === 'suspended') c.resume().catch(() => null); }
  function setGain() { if (musicGain) musicGain.gain.setTargetAtTime(musicVolume * 0.16, now(), 0.04); if (sfxGain) sfxGain.gain.setTargetAtTime(sfxVolume * 0.58, now(), 0.03); }
  function tone(freq, dur = 0.12, type = 'sine', gain = 0.18, delay = 0, dest = sfxGain) {
    const c = setup(); if (!c || !dest) return;
    const t = c.currentTime + delay;
    const osc = c.createOscillator(); const g = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(Math.max(20, Number(freq) || 440), t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.03, dur));
    osc.connect(g); g.connect(dest); osc.start(t); osc.stop(t + dur + 0.05);
  }
  function sweep(from, to, dur = 0.4, type = 'sawtooth', gain = 0.16) {
    const c = setup(); if (!c || !sfxGain) return;
    const t = c.currentTime; const osc = c.createOscillator(); const g = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(from, t); osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.035); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(sfxGain); osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(dur = 0.24, gain = 0.12, filterFreq = 900) {
    const c = setup(); if (!c || !sfxGain) return;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buffer = c.createBuffer(1, len, c.sampleRate); const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buffer;
    const filt = c.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.value = filterFreq; filt.Q.value = 0.9;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(filt); filt.connect(g); g.connect(sfxGain); src.start();
  }
  function arp(notes, baseDelay = 0, dur = 0.13, type = 'triangle', gain = 0.15) { notes.forEach((n, i) => tone(n, dur, type, gain, baseDelay + i * 0.075)); }
  function musicTick() {
    if (!enabled || !ctx || !musicGain) return;
    const notes = scales[scene] || scales.home;
    const n = notes[step % notes.length];
    tone(n, 0.7, scene === 'rocket' || scene === 'mines' ? 'sawtooth' : 'triangle', scene === 'slot' || scene === 'wheel' ? 0.045 : 0.035, 0, musicGain);
    tone(n * 1.5, 0.45, 'sine', 0.018, 0.08, musicGain);
    step += 1;
  }
  function startMusic() { if (!enabled) return; safeResume(); clearInterval(musicTimer); musicTick(); musicTimer = setInterval(musicTick, scene === 'rocket' ? 680 : scene === 'mines' ? 920 : 1180); }
  function stopMusic() { clearInterval(musicTimer); musicTimer = null; }
  function updateUI() {
    const btn = document.getElementById('soundToggleBtn');
    const dock = document.getElementById('soundDock');
    const sceneText = document.getElementById('soundSceneText');
    const mv = document.getElementById('musicVolume'); const sv = document.getElementById('sfxVolume');
    if (btn) btn.textContent = enabled ? '🔊 Sound On' : '🔇 Sound Off';
    if (dock) dock.classList.toggle('sound-on', enabled);
    if (sceneText) sceneText.textContent = enabled ? sceneNames[scene] || 'Premium Audio' : 'Tap Sound On';
    if (mv) mv.value = Math.round(musicVolume * 100);
    if (sv) sv.value = Math.round(sfxVolume * 100);
  }
  function setScene(panelId = 'home') { scene = PANEL_TO_GAME[panelId] || panelId || 'home'; updateUI(); if (enabled) startMusic(); }
  function enable() { enabled = true; localStorage.setItem(KEY_ON, '1'); setup(); safeResume(); updateUI(); startMusic(); sfx('open'); }
  function disable() { enabled = false; localStorage.setItem(KEY_ON, '0'); stopMusic(); updateUI(); }
  function toggle() { enabled ? disable() : enable(); }
  function setMusicVolume(v) { musicVolume = Math.max(0, Math.min(1, Number(v) / 100)); localStorage.setItem(KEY_MUSIC, String(Math.round(musicVolume * 100))); setGain(); updateUI(); }
  function setSfxVolume(v) { sfxVolume = Math.max(0, Math.min(1, Number(v) / 100)); localStorage.setItem(KEY_SFX, String(Math.round(sfxVolume * 100))); setGain(); updateUI(); sfx('tap'); }
  function sfx(name) {
    if (!enabled) return; safeResume();
    switch (name) {
      case 'tap': tone(520, .055, 'triangle', .11); break;
      case 'open': arp([523,659,784], 0, .09, 'triangle', .13); break;
      case 'bet': arp([330,440,660], 0, .1, 'square', .10); break;
      case 'cashout': arp([523,659,784,1046], 0, .12, 'triangle', .16); break;
      case 'rocketLaunch': noise(.38,.08,420); sweep(130,560,.48,'sawtooth',.12); break;
      case 'crash': noise(.46,.20,220); sweep(240,55,.55,'sawtooth',.16); break;
      case 'slotSpin': noise(.75,.055,1800); for (let i=0;i<9;i++) tone(700+i*24,.035,'square',.055,i*.075); break;
      case 'reelStop': tone(360,.065,'square',.12); tone(720,.045,'triangle',.08,.04); break;
      case 'win': arp([523,659,784,1046,1318],0,.13,'triangle',.18); break;
      case 'lose': tone(180,.15,'sawtooth',.10); tone(120,.18,'sine',.08,.12); break;
      case 'plinkoDrop': arp([620,560,500,450],0,.08,'triangle',.10); break;
      case 'plinkoTick': tone(640 + Math.random()*220,.035,'triangle',.08); break;
      case 'plinkoLand': tone(260,.08,'sine',.10); tone(520,.11,'triangle',.11,.08); break;
      case 'wheelSpin': sweep(260,920,.72,'triangle',.11); noise(.42,.045,2600); break;
      case 'wheelStop': arp([784,659,523],0,.09,'triangle',.12); break;
      case 'dailySpin': sweep(330,1320,.9,'triangle',.12); arp([659,784,988],.14,.09,'sine',.08); break;
      case 'cardDeal': noise(.075,.09,2200); tone(440,.05,'triangle',.13,.012); break;
      case 'cardSlide': noise(.11,.075,1700); sweep(720,420,.14,'triangle',.07); break;
      case 'turn': arp([440,587,740],0,.07,'triangle',.12); break;
      case 'tin': noise(.16,.11,700); tone(260,.11,'square',.14); tone(520,.10,'triangle',.10,.08); break;
      case 'reveal': arp([392,523,659,784],0,.08,'triangle',.14); break;
      case 'tableOpen': noise(.22,.07,450); arp([220,330,440,660],.02,.08,'triangle',.12); break;
      case 'mineGem': arp([600,760],0,.065,'triangle',.12); break;
      case 'mineBoom': noise(.44,.18,160); sweep(190,60,.42,'sawtooth',.12); break;
      case 'error': tone(130,.16,'sawtooth',.14); break;
      default: tone(440,.08,'sine',.08);
    }
  }
  function init() {
    setup(); setGain(); updateUI();
    document.getElementById('soundToggleBtn')?.addEventListener('click', toggle);
    document.getElementById('musicVolume')?.addEventListener('input', (e) => setMusicVolume(e.target.value));
    document.getElementById('sfxVolume')?.addEventListener('input', (e) => setSfxVolume(e.target.value));
    const unlock = () => { if (enabled) { safeResume(); startMusic(); } };
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  }
  return { init, setScene, sfx, toggle, isEnabled: () => enabled };
})();


function setText(id, value) { const el = $(id); if (el) el.textContent = window.bikaTranslateText ? window.bikaTranslateText(value) : value; return el; }
function setHTML(id, value) { const el = $(id); if (el) el.innerHTML = window.bikaTranslateText ? window.bikaTranslateText(value) : value; return el; }
function setClass(id, value) { const el = $(id); if (el) el.className = value; return el; }
function setBusy(btn, busy, label) { if (!btn) return; if (busy) { btn.dataset.oldText = btn.textContent; btn.textContent = label || 'Loading...'; btn.disabled = true; } else { btn.textContent = btn.dataset.oldText || btn.textContent; btn.disabled = false; } }
function setBalance(value) {
  if (value == null || !Number.isFinite(Number(value))) return;
  const text = `${fmt(Number(value))} ${coin()}`;
  setText('balanceText', text);
  setText('stickyBalanceText', text);
}
function displayName(user = {}) { return [user.firstName || user.first_name, user.lastName || user.last_name].filter(Boolean).join(' ').trim() || user.username || 'Bika Player'; }
function setPlayer(user = {}) { const name = displayName(user); setText('playerNameText', name); setText('avatarText', name.slice(0, 2).toUpperCase()); }
function escapeHtml(v) { return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
function shortTime(ms) { const d = ms ? new Date(ms) : new Date(); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

async function api(path, body = {}) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) { const err = new Error(data.message || data.error || 'Request failed'); err.payload = data; throw err; }
  return data;
}

async function loadConfig() {
  const res = await fetch('/api/mini/config', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Game setup failed (HTTP ${res.status})`);
  config = await res.json().catch(() => null);
  if (!config?.slot || !config?.crash || !config?.plinko || !config?.wheel || !config?.mines) {
    throw new Error('Game setup returned incomplete configuration');
  }
  setText('slotRange', `${fmt(config.slot.minBet)} - ${fmt(config.slot.maxBet)} ${coin()}`);
  [['crashBet', config.crash.minBet], ['slotBet', config.slot.minBet], ['plinkoBet', config.plinko.minBet], ['wheelBet', config.wheel.minBet], ['minesBet', config.mines.minBet]].forEach(([id, value]) => { const el = $(id); if (el) el.value = value; });
  renderPlinkoPins();
  renderPlinkoBuckets();
  renderMinesBoard(null);
}

async function loadMe() {
  const data = await api('/api/mini/me');
  setPlayer(data.user || {});
  setBalance(data.user?.balance);
}

function openPanel(id) {
  AudioFX.setScene(id);
  AudioFX.sfx('tap');
  document.body?.setAttribute('data-bika-game', id || 'home');
  document.documentElement?.setAttribute('data-bika-game', id || 'home');
  document.querySelectorAll('.panel').forEach((el) => el.classList.toggle('active', el.id === id));
  const navTarget = id === 'home' ? 'home' : (PANEL_TO_GAME[id] ? 'games' : null);
  if (navTarget) document.querySelectorAll('.nav-tabs .tab').forEach((el) => el.classList.toggle('active', el.dataset.b === navTarget));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const game = PANEL_TO_GAME[id];
  if (game) loadHistory(game).catch(() => null);
  if (id === 'wheel') loadWheelDailyStatus().catch(() => null);
}


function renderGameHistory(game, items = []) {
  const box = $(`${game}History`); if (!box) return;
  box.innerHTML = items.length ? items.map((item) => {
    const positive = Number(item.net || 0) > 0;
    const cls = positive ? 'win' : Number(item.payout || 0) > 0 ? 'paid' : 'lose';
    const label = item.label || (item.multiplier ? `x${Number(item.multiplier).toFixed(2)}` : item.outcome);
    const round = item.roundNo ? `#${item.roundNo}` : shortTime(item.createdAtMs);
    return `<div class="history-item ${cls}"><div><b>${escapeHtml(label)}</b><span>${escapeHtml(item.title || item.game)} • ${round}</span></div><strong>${Number(item.net || 0) >= 0 ? '+' : ''}${fmt(item.net)} ${coin()}</strong></div>`;
  }).join('') : '<div class="history-empty">ဒီနေ့ history မရှိသေးပါ။</div>';
}

async function loadHistory(game = 'all') {
  if (!initData) return;
  if (game === 'rocket') {
    await pollCrash();
    return;
  }
  const data = await api('/api/mini/history', { game, limit: 12 });
  renderGameHistory(game, data.items || []);
}

function refreshAllVisibleHistory() {
  const active = document.querySelector('.panel.active')?.id;
  const game = PANEL_TO_GAME[active];
  if (game) loadHistory(game).catch(() => null);
}

function renderHistory(history = []) {
  const items = Array.isArray(history) ? history.slice(0, 10) : [];
  const makeItem = (item) => {
    const m = Number(item?.multiplier || 1);
    const color = item?.color || (m < 1.5 ? 'red' : m < 2.5 ? 'yellow' : m < 5 ? 'blue' : 'green');
    return `<span class="odd ${color}" title="Round #${escapeHtml(item?.roundNo ?? '—')}">x${m.toFixed(2)}</span>`;
  };
  const html = items.length ? items.map(makeItem).join('') : '<span class="odd blue">waiting</span>';
  const row = $('oddsRow');
  if (row) row.innerHTML = html;
  const rocket = $('rocketHistory');
  if (rocket) rocket.innerHTML = items.length ? items.map((item) => makeItem(item)).join('') : '<span class="odd blue">waiting</span>';
}

function multiplierAt(round) {
  if (!round || round.state !== 'running') return Number(round?.multiplier || 1);
  const base = Number(round.multiplier || 1);
  const receivedAt = Number(round.receivedAtMs || Date.now());
  const elapsed = Math.max(0, (Date.now() - receivedAt) / 1000);
  const speed = base < 1.6 ? 0.052 : base < 2.6 ? 0.08 : 0.12;
  return base + Math.min(0.12, elapsed * speed);
}

function rocketProgress(multiplier, phase) {
  if (phase === 'betting') return 0;
  const m = Math.max(1, Number(multiplier || 1));
  const visualMax = Math.max(6, Number(config?.crash?.maxMultiplier || 6));
  return Math.max(0, Math.min(0.96, Math.log(m) / Math.log(visualMax)));
}

async function ensureRocketVisual() {
  if (rocketVisual) return rocketVisual;
  if (rocketVisualReady) return rocketVisualReady;
  rocketVisualReady = import('/miniapp/rocket-pixi-v1.js?v=20261007-v4')
    .then((mod) => mod.createBikaRocketScene($('rocketCanvas')))
    .then((instance) => {
      rocketVisual = instance;
      return instance;
    })
    .catch((err) => {
      rocketVisualReady = null;
      console.warn('BIKA PixiJS rocket visual unavailable; using CSS scene.', err);
      return null;
    });
  return rocketVisualReady;
}

function updateRocketVector(progress, phase = 'betting') {
  const scene = $('rocketScene');
  const art = $('rocketArt');
  if (!scene || !art) return;
  const w = scene.clientWidth || 320;
  const h = scene.clientHeight || 330;
  const u = Math.max(0.02, Math.min(0.98, Number(progress) || 0.02));
  const x0 = w * 0.075, y0 = h * 0.86;
  const x1 = w * 0.86, y1 = h * 0.15;
  const cx = w * 0.48, cy = h * 0.63;
  const inv = 1 - u;
  const x = inv * inv * x0 + 2 * inv * u * cx + u * u * x1;
  const y = inv * inv * y0 + 2 * inv * u * cy + u * u * y1;
  const scale = Math.max(.82, Math.min(1.18, w / 540));
  const tilt = -38 - (u * 5);
  const opacity = phase === 'crashed' ? 0.28 : 1;
  art.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) rotate(${tilt}deg) scale(${scale})`;
  art.style.opacity = String(opacity);
  art.style.setProperty('--rocket-motion-intensity', phase === 'running' ? '1' : '0.25');
  art.style.setProperty('--rocket-progress', String(u));
  art.dataset.progress = String(u);

  const path = $('rocketTrajectoryPath');
  const glow = $('rocketTrajectoryGlow');
  if (path && glow) {
    const visible = phase === 'betting' ? Math.max(0, u * 100) : Math.max(4, u * 100);
    path.style.strokeDasharray = '100';
    glow.style.strokeDasharray = '100';
    path.style.strokeDashoffset = String(100 - visible);
    glow.style.strokeDashoffset = String(100 - visible);
    const endX = 6 + (88 - 6) * u;
    const endY = 87 + (15 - 87) * u - 18 * u * (1 - u);
    path.dataset.endX = String(endX);
    path.dataset.endY = String(endY);
  }
}

function syncRocketVisual(round, multiplierOverride = null) {
  const multiplier = multiplierOverride == null
    ? Number(round?.state === 'crashed' ? (round.crashPoint || round.multiplier || 1) : multiplierAt(round))
    : Number(multiplierOverride);
  const progress = rocketProgress(Math.max(1, multiplier), round?.state);
  updateRocketVector(progress, round?.state || 'betting');
  if (rocketVisual) {
    try { rocketVisual.setFrame(progress, multiplier, round?.state || 'betting'); } catch (_) {}
  }
}

function renderPlayers(round) {
  const list = $('playersList'); if (!list) return;
  const players = Array.isArray(round?.players) ? round.players : [];
  list.innerHTML = players.length ? players.map((p) => {
    const cashout = Number(p.cashoutMultiplier || 0);
    const betText = fmt(p.bet) + ' ' + coin();
    const cashText = p.cashedOut && cashout > 0 ? `x${cashout.toFixed(2)}` : '—';
    return `
      <div class="player-row ${p.me ? 'me' : ''}">
        <span><i class="player-status-dot ${p.cashedOut ? 'out' : 'live'}"></i>${escapeHtml(p.name || 'Player')}</span>
        <b class="player-bet-cell">${betText}</b>
        <em class="player-cash-cell ${p.cashedOut ? 'out' : ''}">${cashText}</em>
      </div>`;
  }).join('') : '<div class="result muted">No players yet.</div>';
}

function renderRocket(status) {
  const prevAudioKey = liveRound ? `${liveRound.no || ''}:${liveRound.state || ''}` : '';
  const round = status.round || status.lastRound;
  if (!round) return;
  liveRound = { ...round, serverNowMs: status.serverNowMs, receivedAtMs: Date.now() };
  setText('onlineCountText', status.onlineCount ?? '—');
  setBalance(status.balance);
  setText('roundTitle', `#${round.no || '—'} / 100`);
  setText('phaseChip', String(round.state || 'idle').toUpperCase());
  setText('playerCount', fmt(round.playerCount || 0));
  setText('totalBet', `${fmt(round.totalBet || 0)} ${coin()}`);
  setText('totalPaid', `${fmt(round.totalPaid || 0)} ${coin()}`);
  renderPlayers(round);
  renderHistory(status.history);
  const cashBtn = $('cashoutBtn');
  if (cashBtn) cashBtn.disabled = !(round.state === 'running' && round.me?.canCashout);
  const betBtn = $('crashStartBtn');
  if (betBtn) betBtn.disabled = !(round.state === 'betting') || !!round.me?.inRound;

  const state = round.state;
  setText('rocketStageStatus', state === 'running' ? 'LIVE ROUND • AUTO' : state === 'crashed' ? 'ROUND ENDED • NEXT' : 'BETTING OPEN • AUTO');
  setText('rocketRunTag', state === 'running' ? '● ROCKET ASCENDING' : state === 'crashed' ? '✦ ROUND CRASHED' : '● WAITING FOR LAUNCH');
  const nextAudioKey = `${round.no || ''}:${state || ''}`;
  if (nextAudioKey && nextAudioKey !== prevAudioKey) {
    if (state === 'betting') AudioFX.sfx('open');
    if (state === 'running') AudioFX.sfx('rocketLaunch');
    if (state === 'crashed') AudioFX.sfx('crash');
  }
  const scene = $('rocketScene');
  if (scene) scene.className = `rocket-scene ${state || ''}`;
  if (state === 'betting') {
    const left = Math.max(0, Number(round.secondsLeft || 0));
    setText('roundCountdown', left);
    setText('crashMultiplier', 'x1.00');
    setText('crashState', `Bet time — ${left}s`);
    if (scene) scene.style.setProperty('--count-progress', Math.max(0, left / Math.max(1, round.betSeconds || 15)));
  } else if (state === 'running') {
    setText('roundCountdown', 'GO');
    setText('crashState', round.me?.inRound ? (round.me.cashedOut ? `Cashed out: ${fmt(round.me.payout)} ${coin()}` : 'Rocket တက်နေပါတယ် — Cash Out timing!') : 'Rocket တက်နေပါတယ်');
  } else if (state === 'crashed') {
    setText('roundCountdown', '💥');
    setText('crashMultiplier', `x${Number(round.crashPoint || round.multiplier || 1).toFixed(2)}`);
    setText('crashState', 'CRASHED — next round coming');
    setHTML('crashResult', `💥 Crashed at <b>x${Number(round.crashPoint || round.multiplier || 1).toFixed(2)}</b>`);
  }
  updateRocketFrame();
  syncRocketVisual(round);
}

function updateRocketFrame() {
  if (!liveRound) return;
  const m = multiplierAt(liveRound);
  if (liveRound.state === 'running') setText('crashMultiplier', `x${m.toFixed(2)}`);
  const progress = rocketProgress(m, liveRound.state);
  const scene = $('rocketScene');
  if (scene) scene.style.setProperty('--rocket-progress', progress);
  updateRocketVector(progress, liveRound.state);
  if (rocketVisual) {
    try { rocketVisual.setFrame(progress, m, liveRound.state); } catch (_) {}
  }
}

async function pollCrash() {
  try {
    renderRocket(await api('/api/mini/crash/status'));
    if (initData) $('notTelegram')?.classList.add('hidden');
  } catch (err) {
    const notice = $('notTelegram');
    if (notice && (!initData || !liveRound)) {
      setText('notTelegram', !initData
        ? 'Telegram Mini App ထဲကနေဖွင့်မှ account verify လုပ်နိုင်ပါမယ်။'
        : `Game connection failed: ${err.message || 'Please try again.'}`);
      notice.classList.remove('hidden');
    }
  }
}

function startRocketRaf() { if (rafTimer) cancelAnimationFrame(rafTimer); const tick = () => { updateRocketFrame(); rafTimer = requestAnimationFrame(tick); }; tick(); }
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollCrash();
  pollTimer = setInterval(pollCrash, 850);
  startRocketRaf();
  // Progressive enhancement: keep the current SVG art if WebGL/Pixi fails.
  ensureRocketVisual().then((instance) => {
    if (!instance) return;
    $('rocketScene')?.classList.add('pixi-ready');
    if (liveRound) syncRocketVisual(liveRound);
  }).catch(() => null);
}

async function placeCrashBet() { const btn = $('crashStartBtn'); setBusy(btn, true, 'Joining...'); try { renderRocket(await api('/api/mini/crash/bet', { bet: $('crashBet')?.value })); AudioFX.sfx('bet'); refreshAllVisibleHistory(); tg?.HapticFeedback?.notificationOccurred?.('success'); } catch (err) { setHTML('crashResult', `<span class="lose">${escapeHtml(err.message)}</span>`); AudioFX.sfx('error'); tg?.HapticFeedback?.notificationOccurred?.('error'); } finally { setBusy(btn, false); } }
async function cashoutCrash() { const btn = $('cashoutBtn'); setBusy(btn, true, 'Cash Out...'); try { const data = await api('/api/mini/crash/cashout'); setBalance(data.balance); renderRocket(data); setHTML('crashResult', `🎉 Cash Out: <b>${fmt(data.payout)} ${coin()}</b> at <b>x${Number(data.effectiveMultiplier || 0).toFixed(2)}</b>`); AudioFX.sfx('cashout'); refreshAllVisibleHistory(); tg?.HapticFeedback?.notificationOccurred?.('success'); } catch (err) { setHTML('crashResult', `<span class="lose">${escapeHtml(err.message)}</span>`); tg?.HapticFeedback?.notificationOccurred?.('error'); } finally { setBusy(btn, false); } }

function setSlotReels(reels = ['?', '?', '?']) { ['slotReelA','slotReelB','slotReelC'].forEach((id, i) => setText(id, String(reels[i] || '?') === '7' ? '7️⃣' : String(reels[i] || '?'))); }
function startSlotAnimation() {
  AudioFX.sfx('slotSpin');
  const machine = $('slotMachine'); machine?.classList.remove('slot-win-glow'); machine?.classList.add('spinning');
  if (slotSpinTimer) clearInterval(slotSpinTimer);
  let ticks = 0;
  slotSpinTimer = setInterval(() => {
    ticks += 1;
    setSlotReels([0,1,2].map(() => SLOT_SYMBOLS[(Math.floor(Math.random()*SLOT_SYMBOLS.length) + ticks) % SLOT_SYMBOLS.length]));
  }, 70);
}
async function stopSlotAnimation(reels) {
  if (slotSpinTimer) clearInterval(slotSpinTimer);
  slotSpinTimer = null;
  const ids = ['slotReelA','slotReelB','slotReelC'];
  for (let i = 0; i < ids.length; i += 1) {
    await sleep(430);
    setText(ids[i], String(reels[i] || '?') === '7' ? '7️⃣' : String(reels[i] || '?'));
    $(ids[i])?.classList.add('reel-stop');
    setTimeout(() => $(ids[i])?.classList.remove('reel-stop'), 420);
    tg?.HapticFeedback?.impactOccurred?.('light');
    AudioFX.sfx('reelStop');
  }
  $('slotMachine')?.classList.remove('spinning');
}
async function spinSlot() { const btn = $('spinBtn'); setBusy(btn, true, 'SPINNING...'); setClass('slotResult', 'result muted'); setText('slotResult', '🎰 Reels rolling...'); startSlotAnimation(); try { const data = await api('/api/mini/slot/spin', { bet: $('slotBet')?.value }); await sleep(2800); await stopSlotAnimation(data.reels || ['?','?','?']); setBalance(data.balance); const won = Number(data.payout || 0) > 0; $('slotMachine')?.classList.toggle('slot-win-glow', won); setClass('slotResult', `result ${won ? 'win' : 'lose'}`); setHTML('slotResult', `${won ? '🏆 BIG WIN' : '💨 TRY AGAIN'}<br>Bet: <b>${fmt(data.bet)} ${coin()}</b> • Payout: <b>${fmt(data.payout)} ${coin()}</b> • Net: <b>${fmt(data.net)} ${coin()}</b>`); AudioFX.sfx(won ? 'win' : 'lose'); refreshAllVisibleHistory(); } catch (err) { await stopSlotAnimation(['?','?','?']); setClass('slotResult','result lose'); setText('slotResult', err.message); AudioFX.sfx('error'); } finally { setBusy(btn, false); } }

function renderPlinkoPins() {
  const board = $('plinkoBoard'); if (!board) return;
  board.querySelectorAll('.plinko-pin').forEach((pin) => pin.remove());
  const rows = 14;
  for (let r = 0; r < rows; r += 1) {
    const count = 4 + r;
    const top = 8 + r * 6.05;
    for (let c = 0; c < count; c += 1) {
      const pin = document.createElement('i');
      pin.className = 'plinko-pin';
      const span = Math.min(82, 34 + r * 4.3);
      const left = 50 + (c - (count - 1) / 2) * (span / Math.max(1, count - 1));
      pin.style.left = `${left}%`;
      pin.style.top = `${top}%`;
      board.appendChild(pin);
    }
  }
  const ball = $('plinkoBall');
  if (ball && !ball.dataset.dropped) {
    ball.style.left = '50%';
    ball.style.top = '5%';
    ball.style.opacity = '0.92';
    ball.style.transform = 'translate(-50%, -50%) scale(1)';
  }
}
function renderPlinkoBuckets(hitIndex = null) { const row = $('plinkoBuckets'); if (!row || !config?.plinko?.buckets) return; row.innerHTML = config.plinko.buckets.map((b) => `<div class="bucket ${hitIndex === b.index ? 'hit' : ''}">${b.label}</div>`).join(''); }
async function animatePlinkoPath(data) {
  AudioFX.sfx('plinkoDrop');
  const ball = $('plinkoBall'); if (!ball) return;
  const path = Array.isArray(data.path) ? data.path : [];
  const board = $('plinkoBoard');
  if (board) board.classList.add('dropping');
  ball.dataset.dropped = '1';
  ball.classList.remove('settled');
  ball.style.opacity = '1';
  ball.style.left = '50%';
  ball.style.top = '5%';
  ball.style.transform = 'translate(-50%, -50%) scale(1)';
  await sleep(180);
  let x = 50;
  const rows = 14;
  for (let i = 0; i < rows; i += 1) {
    const dir = path[i] || (Math.random() > 0.5 ? 'R' : 'L');
    const wobble = i % 3 === 0 ? 1.1 : i % 3 === 1 ? -0.7 : 0.35;
    x += dir === 'R' ? 3.55 : -3.55;
    x += wobble;
    x = Math.max(8, Math.min(92, x));
    const y = 10 + i * 5.95;
    ball.style.left = `${x}%`;
    ball.style.top = `${y}%`;
    ball.style.transform = `translate(-50%, -50%) scale(${i % 2 ? 0.92 : 1.1}) rotate(${dir === 'R' ? 16 : -16}deg)`;
    tg?.HapticFeedback?.impactOccurred?.('soft');
    AudioFX.sfx('plinkoTick');
    await sleep(255);
  }
  const finalX = 5 + Number(data.bucket?.index || 0) * 10;
  ball.style.left = `${finalX}%`;
  ball.style.top = '92%';
  ball.style.transform = 'translate(-50%, -50%) scale(1.18)';
  ball.classList.add('settled');
  AudioFX.sfx('plinkoLand');
  if (board) board.classList.remove('dropping');
  await sleep(250);
}
async function dropPlinko() { const btn = $('plinkoBtn'); setBusy(btn, true, 'DROPPING...'); setClass('plinkoResult','result muted'); setText('plinkoResult','🟡 Ball တစ်ချက်ချင်းလှိမ့်ကျနေပါတယ်...'); renderPlinkoBuckets(); try { const data = await api('/api/mini/plinko/drop', { bet: $('plinkoBet')?.value }); await animatePlinkoPath(data); renderPlinkoBuckets(data.bucket.index); setBalance(data.balance); const won = Number(data.payout || 0) > Number(data.bet || 0); setClass('plinkoResult', `result ${won ? 'win' : Number(data.payout) > 0 ? '' : 'lose'}`); setHTML('plinkoResult', `Bucket: <b>${escapeHtml(data.bucket.label)}</b> • Payout: <b>${fmt(data.payout)} ${coin()}</b> • Net: <b>${fmt(data.net)} ${coin()}</b>`); AudioFX.sfx(won ? 'win' : Number(data.payout) > 0 ? 'cashout' : 'lose'); refreshAllVisibleHistory(); } catch (err) { setClass('plinkoResult','result lose'); setText('plinkoResult', err.message); AudioFX.sfx('error'); } finally { setBusy(btn, false); } }


function normalizeDeg(value) { return ((Number(value || 0) % 360) + 360) % 360; }
function wheelSegmentStopAngle(segmentIndex, jitter = 0) {
  const degrees = Number(config?.wheel?.segmentDegrees || 36);
  const center = Number(segmentIndex || 0) * degrees + degrees / 2;
  return normalizeDeg(360 - center + Number(jitter || 0));
}
function spinWheelTo(segmentIndex, stopAngleDegrees, mode = 'paid') {
  AudioFX.sfx(mode === 'daily' ? 'dailySpin' : 'wheelSpin');
  const target = Number.isFinite(Number(stopAngleDegrees)) ? normalizeDeg(stopAngleDegrees) : wheelSegmentStopAngle(segmentIndex);
  const current = normalizeDeg(wheelRotation);
  const delta = normalizeDeg(target - current);
  const extraTurns = mode === 'daily' ? 7 : 6;
  wheelRotation += extraTurns * 360 + delta;
  const duration = mode === 'daily' ? 5850 : 5250;
  const disk = $('wheelDisk');
  if (disk) disk.dataset.activeIndex = String(segmentIndex ?? '');
  const animate = (instance) => {
    if (instance?.spinTo) {
      instance.spinTo(wheelRotation, duration);
      setTimeout(() => AudioFX.sfx('wheelStop'), Math.max(0, duration - 10));
      return;
    }
    if (disk) {
      disk.classList.add('wheel-spinning');
      disk.style.transform = `rotate(${wheelRotation}deg)`;
      setTimeout(() => { disk.classList.remove('wheel-spinning'); AudioFX.sfx('wheelStop'); }, duration);
    }
  };
  if (wheel3D) animate(wheel3D);
  else loadWheel3D().then(animate).catch(() => null);
}
function renderWheelTarget(segment) {
  const label = segment?.label || '—';
  setHTML('wheelTarget', `Pointer result: <b>${escapeHtml(label)}</b>`);
}
async function loadWheelDailyStatus() {
  if (!initData) return;
  try {
    const data = await api('/api/mini/wheel/daily-status');
    const btn = $('dailyWheelBtn');
    const info = $('dailyWheelInfo');
    if (btn) btn.disabled = !data.available;
    if (btn) btn.textContent = data.available ? 'FREE DAILY SPIN' : 'CLAIMED TODAY';
    if (info) {
      if (data.available) info.innerHTML = `1 free spin today • base reward <b>${fmt(data.baseReward)} ${coin()}</b>`;
      else info.innerHTML = `Claimed today: <b>${escapeHtml(data.last?.label || '—')}</b> • next reset tomorrow`;
    }
    const reward = $('dailyWheelReward');
    if (reward) reward.textContent = data.baseReward != null ? `${fmt(data.baseReward)} ${coin()}` : '—';
  } catch (_) {}
}

let wheel3D = null;
let wheel3DReady = null;

function wheelFallbackBuild(segments) {
  const disk = $('wheelDisk');
  const legend = $('wheelLegend');
  if (!disk) return;
  const list = Array.isArray(segments) ? segments : [];
  const palette = ['#ff3f73','#ff5d3b','#ffd158','#58e64f','#15cfc7','#229be8','#5363ff','#9347ff','#d83bc6','#f24970'];
  const colors = list.map((s, i) => /^#[0-9a-f]{3,8}$/i.test(String(s.color || '')) ? s.color : palette[i % palette.length]);
  disk.classList.remove('wheel-3d-host');
  disk.classList.add('wheel-2d-fallback');
  disk.style.setProperty('--fallback-count', String(Math.max(1, colors.length)));
  disk.style.background = `conic-gradient(from -90deg,${colors.map((color, i) => `${color} ${i * (360 / colors.length)}deg ${(i + 1) * (360 / colors.length)}deg`).join(',')})`;
  disk.innerHTML = '';
  if (legend) legend.innerHTML = list.map((s) => `<span>${escapeHtml(s.label || '')}</span>`).join('');
}

async function loadWheel3D() {
  if (wheel3D) return wheel3D;
  if (wheel3DReady) return wheel3DReady;
  wheel3DReady = import('/miniapp/wheel-three-v1.js?v=20261007-v53')
    .then((mod) => mod.createBikaWheel3D($('wheelDisk'), config?.wheel?.segments || []))
    .then((instance) => {
      wheel3D = instance;
      $('wheelDisk')?.classList.remove('wheel-2d-fallback');
      wheel3D.refresh(config?.wheel?.segments || []);
      return wheel3D;
    })
    .catch((err) => {
      wheel3DReady = null;
      console.warn('BIKA Three.js wheel unavailable; keeping visual fallback.', err);
      wheelFallbackBuild(config?.wheel?.segments || []);
      return null;
    });
  return wheel3DReady;
}

function buildWheel() {
  const segments = config?.wheel?.segments || [];
  const legend = $('wheelLegend');
  if (legend) legend.innerHTML = segments.map((s, i) => `<span class="legend-${i}" style="--c:${escapeHtml(s.color || '#7e88ff')}">${escapeHtml(s.label || '')}</span>`).join('');
  loadWheel3D().catch(() => null);
}

async function spinWheel() {
  const btn = $('wheelBtn');
  const centerBtn = $('wheelCenterBtn');
  setBusy(btn, true, 'SPINNING...');
  if (centerBtn) { centerBtn.disabled = true; centerBtn.classList.add('is-busy'); centerBtn.setAttribute('aria-busy', 'true'); }
  setClass('wheelResult','result muted');
  setText('wheelResult','🎡 Wheel လည်နေပါတယ်... မြှားအောက်မှာရပ်တဲ့ result နဲ့ payout တိတိကျကျတူပါမယ်');
  renderWheelTarget(null);
  try {
    const data = await api('/api/mini/wheel/spin', { bet: $('wheelBet')?.value });
    spinWheelTo(data.segment?.index, data.stopAngleDegrees, 'paid');
    await sleep(5350);
    setBalance(data.balance);
    renderWheelTarget(data.segment);
    const won = Number(data.payout || 0) > Number(data.bet || 0);
    setClass('wheelResult', `result ${won ? 'win' : Number(data.payout) > 0 ? '' : 'lose'}`);
    setHTML('wheelResult', `Result: <b>${escapeHtml(data.segment?.label || '?')}</b> • Payout: <b>${fmt(data.payout)} ${coin()}</b> • Net: <b>${fmt(data.net)} ${coin()}</b>`);
    refreshAllVisibleHistory();
    loadWheelDailyStatus().catch(() => null);
    AudioFX.sfx(won ? 'win' : Number(data.payout) > 0 ? 'cashout' : 'lose');
    tg?.HapticFeedback?.notificationOccurred?.(won ? 'success' : 'warning');
  } catch (err) {
    AudioFX.sfx('error');
    setClass('wheelResult','result lose');
    setText('wheelResult', err.message);
    tg?.HapticFeedback?.notificationOccurred?.('error');
  } finally {
    setBusy(btn, false);
    if (centerBtn) { centerBtn.disabled = false; centerBtn.classList.remove('is-busy'); centerBtn.removeAttribute('aria-busy'); }
  }
}

async function spinDailyWheel() {
  const btn = $('dailyWheelBtn');
  setBusy(btn, true, 'CLAIMING...');
  setClass('wheelResult','result muted');
  setText('wheelResult','🎁 Daily Free Spin လည်နေပါတယ်...');
  renderWheelTarget(null);
  try {
    const data = await api('/api/mini/wheel/daily-spin');
    spinWheelTo(data.segment?.index, data.stopAngleDegrees, 'daily');
    await sleep(5950);
    setBalance(data.balance);
    renderWheelTarget(data.segment);
    const won = Number(data.payout || 0) > 0;
    setClass('wheelResult', `result ${won ? 'win' : 'lose'}`);
    setHTML('wheelResult', `🎁 Daily Result: <b>${escapeHtml(data.segment?.label || '?')}</b> • Bonus: <b>${fmt(data.payout)} ${coin()}</b>`);
    refreshAllVisibleHistory();
    await loadWheelDailyStatus();
    AudioFX.sfx(won ? 'win' : 'lose');
    tg?.HapticFeedback?.notificationOccurred?.(won ? 'success' : 'warning');
  } catch (err) {
    AudioFX.sfx('error');
    setClass('wheelResult','result lose');
    setText('wheelResult', err.message);
    await loadWheelDailyStatus();
    tg?.HapticFeedback?.notificationOccurred?.('error');
  } finally { setBusy(btn, false); }
}


function bindEvents() {
  document.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => openPanel(btn.dataset.open)));
  document.querySelectorAll('[data-refresh-history]').forEach((btn) => btn.addEventListener('click', () => loadHistory(btn.dataset.refreshHistory).catch(() => null)));
  $('crashStartBtn')?.addEventListener('click', placeCrashBet); $('cashoutBtn')?.addEventListener('click', cashoutCrash);
  $('spinBtn')?.addEventListener('click', spinSlot); $('plinkoBtn')?.addEventListener('click', dropPlinko); $('wheelBtn')?.addEventListener('click', spinWheel); $('wheelCenterBtn')?.addEventListener('click', spinWheel); $('dailyWheelBtn')?.addEventListener('click', spinDailyWheel); $('minesStartBtn')?.addEventListener('click', startMines); $('minesCashoutBtn')?.addEventListener('click', cashoutMines);
  document.querySelectorAll('[data-crash-bet]').forEach((b) => b.addEventListener('click', () => $('crashBet').value = b.dataset.crashBet));
  document.querySelectorAll('[data-slot-bet]').forEach((b) => b.addEventListener('click', () => $('slotBet').value = b.dataset.slotBet));
  document.querySelectorAll('[data-plinko-bet]').forEach((b) => b.addEventListener('click', () => $('plinkoBet').value = b.dataset.plinkoBet));
  document.querySelectorAll('[data-wheel-bet]').forEach((b) => b.addEventListener('click', () => $('wheelBet').value = b.datasetWheelBet || b.dataset.wheelBet));
  document.querySelectorAll('[data-mines-bet]').forEach((b) => b.addEventListener('click', () => $('minesBet').value = b.dataset.minesBet));
  $('minesBoard')?.addEventListener('click', (e) => { const btn = e.target.closest('[data-mine-index]'); if (btn && !btn.disabled) openMine(Number(btn.dataset.mineIndex)); });
}

// Expose the panel controller for the Mini App's overlay navigation.
window.openPanel = openPanel;

async function init() {
  tg?.ready?.(); tg?.expand?.();
  if (!initData) $('notTelegram')?.classList.remove('hidden');
  AudioFX.init();
  bindEvents();
  await loadConfig();
  buildWheel();
  try {
    await loadMe();
  } catch (err) {
    setText('balanceText', 'Unavailable');
    setText('stickyBalanceText', 'Unavailable');
    console.warn('BIKA Mini App balance request failed', err);
  }
  try { await loadWheelDailyStatus(); } catch (_) {}
  try { const status = await api('/api/mini/mines/status'); renderMines(status.game, status.balance); } catch (_) {}
  startPolling();
  const startGame = startTarget.game;
}


init().catch((err) => { setHTML('notTelegram', escapeHtml(err.message || err)); $('notTelegram')?.classList.remove('hidden'); });
