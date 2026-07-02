const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';
let config = null;
let pollTimer = null;
let rafTimer = null;
let liveRound = null;
let slotSpinTimer = null;
let wheelRotation = 0;

const SLOT_SYMBOLS = ['🍒', '🍋', '🍉', '🔔', '⭐', 'BAR', '7️⃣'];
const PANEL_TO_GAME = { crash: 'rocket', slot: 'slot', plinko: 'plinko', wheel: 'wheel', mines: 'mines' };
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const coin = () => config?.coin || '$';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setText(id, value) { const el = $(id); if (el) el.textContent = value; return el; }
function setHTML(id, value) { const el = $(id); if (el) el.innerHTML = value; return el; }
function setClass(id, value) { const el = $(id); if (el) el.className = value; return el; }
function setBusy(btn, busy, label) { if (!btn) return; if (busy) { btn.dataset.oldText = btn.textContent; btn.textContent = label || 'Loading...'; btn.disabled = true; } else { btn.textContent = btn.dataset.oldText || btn.textContent; btn.disabled = false; } }
function setBalance(value) { const text = `${fmt(value)} ${coin()}`; setText('balanceText', text); setText('stickyBalanceText', text); }
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
  config = await res.json();
  setText('slotRange', `${fmt(config.slot.minBet)} - ${fmt(config.slot.maxBet)} ${coin()}`);
  [['crashBet', config.crash.minBet], ['slotBet', config.slot.minBet], ['plinkoBet', config.plinko.minBet], ['wheelBet', config.wheel.minBet], ['minesBet', config.mines.minBet]].forEach(([id, value]) => { const el = $(id); if (el) el.value = value; });
  renderPlinkoPins();
  renderPlinkoBuckets();
  renderMinesBoard(null);
}

async function loadMe() {
  const data = await api('/api/mini/me');
  setPlayer(data.user || {});
  setBalance(data.user?.balance || 0);
}

function openPanel(id) {
  document.querySelectorAll('.panel').forEach((el) => el.classList.toggle('active', el.id === id));
  document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.dataset.open === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const game = PANEL_TO_GAME[id];
  if (game) loadHistory(game).catch(() => null);
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
  const data = await api('/api/mini/history', { game, limit: 12 });
  renderGameHistory(game, data.items || []);
}

function refreshAllVisibleHistory() {
  const active = document.querySelector('.panel.active')?.id;
  const game = PANEL_TO_GAME[active];
  if (game) loadHistory(game).catch(() => null);
}

function renderHistory(history = []) {
  const row = $('oddsRow'); if (!row) return;
  const items = Array.isArray(history) ? history.slice(0, 10) : [];
  row.innerHTML = items.length ? items.map((item) => `<span class="odd ${item.color || 'blue'}">x${Number(item.multiplier || 1).toFixed(2)}</span>`).join('') : '<span class="odd blue">waiting</span>';
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

function renderPlayers(round) {
  const list = $('playersList'); if (!list) return;
  const players = round?.players || [];
  list.innerHTML = players.length ? players.map((p) => `
    <div class="player-row ${p.me ? 'me' : ''}">
      <span>${p.cashedOut ? '✅' : '⏳'} ${escapeHtml(p.name)}</span>
      <b>${p.cashedOut ? fmt(p.payout) + ' ' + coin() : fmt(p.bet) + ' ' + coin()}</b>
    </div>`).join('') : '<div class="result muted">No players yet.</div>';
}

function renderRocket(status) {
  const round = status.round || status.lastRound;
  if (!round) return;
  liveRound = { ...round, serverNowMs: status.serverNowMs, receivedAtMs: Date.now() };
  setText('onlineCountText', status.onlineCount ?? '—');
  setBalance(status.balance ?? 0);
  setText('roundTitle', `Round #${round.no || '—'} / 100`);
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
}

function updateRocketFrame() {
  if (!liveRound) return;
  const m = multiplierAt(liveRound);
  if (liveRound.state === 'running') setText('crashMultiplier', `x${m.toFixed(2)}`);
  const scene = $('rocketScene');
  if (scene) scene.style.setProperty('--rocket-progress', rocketProgress(m, liveRound.state));
}

async function pollCrash() {
  try { renderRocket(await api('/api/mini/crash/status')); } catch (err) { if (!initData) $('notTelegram')?.classList.remove('hidden'); }
}

function startRocketRaf() { if (rafTimer) cancelAnimationFrame(rafTimer); const tick = () => { updateRocketFrame(); rafTimer = requestAnimationFrame(tick); }; tick(); }
function startPolling() { if (pollTimer) clearInterval(pollTimer); pollCrash(); pollTimer = setInterval(pollCrash, 850); startRocketRaf(); }

async function placeCrashBet() { const btn = $('crashStartBtn'); setBusy(btn, true, 'Joining...'); try { renderRocket(await api('/api/mini/crash/bet', { bet: $('crashBet')?.value })); refreshAllVisibleHistory(); tg?.HapticFeedback?.notificationOccurred?.('success'); } catch (err) { setHTML('crashResult', `<span class="lose">${escapeHtml(err.message)}</span>`); tg?.HapticFeedback?.notificationOccurred?.('error'); } finally { setBusy(btn, false); } }
async function cashoutCrash() { const btn = $('cashoutBtn'); setBusy(btn, true, 'Cash Out...'); try { const data = await api('/api/mini/crash/cashout'); setBalance(data.balance); renderRocket(data); setHTML('crashResult', `🎉 Cash Out: <b>${fmt(data.payout)} ${coin()}</b> at <b>x${Number(data.effectiveMultiplier || 0).toFixed(2)}</b>`); refreshAllVisibleHistory(); tg?.HapticFeedback?.notificationOccurred?.('success'); } catch (err) { setHTML('crashResult', `<span class="lose">${escapeHtml(err.message)}</span>`); tg?.HapticFeedback?.notificationOccurred?.('error'); } finally { setBusy(btn, false); } }

function setSlotReels(reels = ['?', '?', '?']) { ['slotReelA','slotReelB','slotReelC'].forEach((id, i) => setText(id, String(reels[i] || '?') === '7' ? '7️⃣' : String(reels[i] || '?'))); }
function startSlotAnimation() {
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
  }
  $('slotMachine')?.classList.remove('spinning');
}
async function spinSlot() { const btn = $('spinBtn'); setBusy(btn, true, 'SPINNING...'); setClass('slotResult', 'result muted'); setText('slotResult', '🎰 Reels rolling...'); startSlotAnimation(); try { const data = await api('/api/mini/slot/spin', { bet: $('slotBet')?.value }); await sleep(2800); await stopSlotAnimation(data.reels || ['?','?','?']); setBalance(data.balance); const won = Number(data.payout || 0) > 0; $('slotMachine')?.classList.toggle('slot-win-glow', won); setClass('slotResult', `result ${won ? 'win' : 'lose'}`); setHTML('slotResult', `${won ? '🏆 BIG WIN' : '💨 TRY AGAIN'}<br>Bet: <b>${fmt(data.bet)} ${coin()}</b> • Payout: <b>${fmt(data.payout)} ${coin()}</b> • Net: <b>${fmt(data.net)} ${coin()}</b>`); refreshAllVisibleHistory(); } catch (err) { await stopSlotAnimation(['?','?','?']); setClass('slotResult','result lose'); setText('slotResult', err.message); } finally { setBusy(btn, false); } }

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
    await sleep(255);
  }
  const finalX = 5 + Number(data.bucket?.index || 0) * 10;
  ball.style.left = `${finalX}%`;
  ball.style.top = '92%';
  ball.style.transform = 'translate(-50%, -50%) scale(1.18)';
  ball.classList.add('settled');
  if (board) board.classList.remove('dropping');
  await sleep(250);
}
async function dropPlinko() { const btn = $('plinkoBtn'); setBusy(btn, true, 'DROPPING...'); setClass('plinkoResult','result muted'); setText('plinkoResult','🟡 Ball တစ်ချက်ချင်းလှိမ့်ကျနေပါတယ်...'); renderPlinkoBuckets(); try { const data = await api('/api/mini/plinko/drop', { bet: $('plinkoBet')?.value }); await animatePlinkoPath(data); renderPlinkoBuckets(data.bucket.index); setBalance(data.balance); const won = Number(data.payout || 0) > Number(data.bet || 0); setClass('plinkoResult', `result ${won ? 'win' : Number(data.payout) > 0 ? '' : 'lose'}`); setHTML('plinkoResult', `Bucket: <b>${escapeHtml(data.bucket.label)}</b> • Payout: <b>${fmt(data.payout)} ${coin()}</b> • Net: <b>${fmt(data.net)} ${coin()}</b>`); refreshAllVisibleHistory(); } catch (err) { setClass('plinkoResult','result lose'); setText('plinkoResult', err.message); } finally { setBusy(btn, false); } }

function buildWheel() {
  const disk = $('wheelDisk');
  const legend = $('wheelLegend');
  if (!disk || !config?.wheel?.segments) return;
  const segments = config.wheel.segments;
  disk.title = segments.map((s) => s.label).join(' • ');
  disk.innerHTML = segments.map((s, i) => {
    const angle = i * 36 + 18;
    return `<span class="wheel-mark" style="--a:${angle}deg; --c:${escapeHtml(s.color || '#fff')}"><i>${escapeHtml(s.label)}</i></span>`;
  }).join('');
  if (legend) {
    legend.innerHTML = segments.map((s) => `<span style="--c:${escapeHtml(s.color || '#fff')}">${escapeHtml(s.label)}</span>`).join('');
  }
}
async function spinWheel() {
  const btn = $('wheelBtn');
  setBusy(btn, true, 'SPINNING...');
  setClass('wheelResult','result muted');
  setText('wheelResult','🎡 Wheel လည်နေပါတယ်... ရပ်မယ့်နေရာကိုစောင့်ပါ');
  try {
    const data = await api('/api/mini/wheel/spin', { bet: $('wheelBet')?.value });
    wheelRotation += Number(data.spinAngle || 1800) + 720;
    const disk = $('wheelDisk');
    if (disk) disk.style.transform = `rotate(${wheelRotation}deg)`;
    await sleep(4550);
    setBalance(data.balance);
    const won = Number(data.payout || 0) > Number(data.bet || 0);
    setClass('wheelResult', `result ${won ? 'win' : Number(data.payout) > 0 ? '' : 'lose'}`);
    setHTML('wheelResult', `Result: <b>${escapeHtml(data.segment?.label || '?')}</b> • Payout: <b>${fmt(data.payout)} ${coin()}</b> • Net: <b>${fmt(data.net)} ${coin()}</b>`);
    refreshAllVisibleHistory();
  } catch (err) {
    setClass('wheelResult','result lose');
    setText('wheelResult', err.message);
  } finally { setBusy(btn, false); }
}

function renderMinesBoard(game) { const board = $('minesBoard'); if (!board) return; const tiles = game?.tiles || Array.from({length:25}, (_, i) => ({ index:i, label:'hidden' })); board.innerHTML = tiles.map((t) => { const cls = t.exploded ? 'boom' : t.label === 'mine' ? 'mine' : t.opened ? 'safe' : ''; const icon = t.exploded ? '💥' : t.label === 'mine' ? '💣' : t.opened ? '💎' : '?'; return `<button class="mine-tile ${cls}" data-mine-index="${t.index}" ${game?.state !== 'playing' || t.opened ? 'disabled' : ''}>${icon}</button>`; }).join(''); }
function renderMines(game, balance) { if (balance != null) setBalance(balance); renderMinesBoard(game); setText('minesSafe', game ? `${game.safeOpened}/${25 - game.mineCount}` : '0'); setText('minesMulti', `x${Number(game?.multiplier || 1).toFixed(2)}`); setText('minesCash', game?.cashoutLocked ? 'Locked' : `${fmt(game?.cashoutEstimate || 0)} ${coin()}`); const cashBtn = $('minesCashoutBtn'); if (cashBtn) cashBtn.disabled = !game || game.cashoutLocked || game.state !== 'playing'; }
async function startMines() { const btn = $('minesStartBtn'); setBusy(btn, true, 'STARTING...'); try { const data = await api('/api/mini/mines/start', { bet: $('minesBet')?.value }); renderMines(data.game, data.balance); setClass('minesResult','result muted'); setText('minesResult', `Safe ${data.game.minCashoutSafe} ခုဖွင့်ပြီးမှ Cash Out လုပ်နိုင်ပါတယ်။`); } catch (err) { setClass('minesResult','result lose'); setText('minesResult', err.message); } finally { setBusy(btn, false); } }
async function openMine(index) { try { const data = await api('/api/mini/mines/open', { index }); renderMines(data.game, data.balance); if (data.result === 'lost') { setClass('minesResult','result lose'); setText('minesResult', '💥 BOOM! Mine ထိသွားပါပြီ။'); refreshAllVisibleHistory(); } else { setClass('minesResult','result win'); setText('minesResult', '💎 Safe! ဆက်ဖွင့်မလား Cash Out လုပ်မလား ရွေးပါ။'); } } catch (err) { setClass('minesResult','result lose'); setText('minesResult', err.message); } }
async function cashoutMines() { const btn = $('minesCashoutBtn'); setBusy(btn, true, 'CASHING...'); try { const data = await api('/api/mini/mines/cashout'); renderMines(data.game, data.balance); setClass('minesResult','result win'); setHTML('minesResult', `✅ Cash Out Success: <b>${fmt(data.payout)} ${coin()}</b>`); refreshAllVisibleHistory(); } catch (err) { setClass('minesResult','result lose'); setText('minesResult', err.message); } finally { setBusy(btn, false); } }

function bindEvents() {
  document.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => openPanel(btn.dataset.open)));
  document.querySelectorAll('[data-refresh-history]').forEach((btn) => btn.addEventListener('click', () => loadHistory(btn.dataset.refreshHistory).catch(() => null)));
  $('crashStartBtn')?.addEventListener('click', placeCrashBet); $('cashoutBtn')?.addEventListener('click', cashoutCrash);
  $('spinBtn')?.addEventListener('click', spinSlot); $('plinkoBtn')?.addEventListener('click', dropPlinko); $('wheelBtn')?.addEventListener('click', spinWheel); $('minesStartBtn')?.addEventListener('click', startMines); $('minesCashoutBtn')?.addEventListener('click', cashoutMines);
  document.querySelectorAll('[data-crash-bet]').forEach((b) => b.addEventListener('click', () => $('crashBet').value = b.dataset.crashBet));
  document.querySelectorAll('[data-slot-bet]').forEach((b) => b.addEventListener('click', () => $('slotBet').value = b.dataset.slotBet));
  document.querySelectorAll('[data-plinko-bet]').forEach((b) => b.addEventListener('click', () => $('plinkoBet').value = b.dataset.plinkoBet));
  document.querySelectorAll('[data-wheel-bet]').forEach((b) => b.addEventListener('click', () => $('wheelBet').value = b.datasetWheelBet || b.dataset.wheelBet));
  document.querySelectorAll('[data-mines-bet]').forEach((b) => b.addEventListener('click', () => $('minesBet').value = b.dataset.minesBet));
  $('minesBoard')?.addEventListener('click', (e) => { const btn = e.target.closest('[data-mine-index]'); if (btn && !btn.disabled) openMine(Number(btn.dataset.mineIndex)); });
}

async function init() {
  tg?.ready?.(); tg?.expand?.();
  if (!initData) $('notTelegram')?.classList.remove('hidden');
  bindEvents();
  await loadConfig();
  buildWheel();
  try { await loadMe(); } catch (_) {}
  try { const status = await api('/api/mini/mines/status'); renderMines(status.game, status.balance); } catch (_) {}
  startPolling();
}

init().catch((err) => { setHTML('notTelegram', escapeHtml(err.message || err)); $('notTelegram')?.classList.remove('hidden'); });
