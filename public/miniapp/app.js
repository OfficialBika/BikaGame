const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';
let config = null;
let pollTimer = null;
let rafTimer = null;
let liveRound = null;
let slotSpinTimer = null;
let wheelRotation = 0;

const SLOT_SYMBOLS = ['🍒', '🍋', '🍉', '🔔', '⭐', 'BAR', '7️⃣'];
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const coin = () => config?.coin || '$';

function setText(id, value) { const el = $(id); if (el) el.textContent = value; return el; }
function setHTML(id, value) { const el = $(id); if (el) el.innerHTML = value; return el; }
function setClass(id, value) { const el = $(id); if (el) el.className = value; return el; }
function setBusy(btn, busy, label) { if (!btn) return; if (busy) { btn.dataset.oldText = btn.textContent; btn.textContent = label || 'Loading...'; btn.disabled = true; } else { btn.textContent = btn.dataset.oldText || btn.textContent; btn.disabled = false; } }
function setBalance(value) { const text = `${fmt(value)} ${coin()}`; setText('balanceText', text); setText('stickyBalanceText', text); }
function displayName(user = {}) { return [user.firstName || user.first_name, user.lastName || user.last_name].filter(Boolean).join(' ').trim() || user.username || 'Bika Player'; }
function setPlayer(user = {}) { const name = displayName(user); setText('playerNameText', name); setText('avatarText', name.slice(0, 2).toUpperCase()); }
function escapeHtml(v) { return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }

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
  const speed = base < 1.6 ? 0.055 : base < 2.6 ? 0.085 : 0.13;
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

async function placeCrashBet() { const btn = $('crashStartBtn'); setBusy(btn, true, 'Joining...'); try { renderRocket(await api('/api/mini/crash/bet', { bet: $('crashBet')?.value })); tg?.HapticFeedback?.notificationOccurred?.('success'); } catch (err) { setHTML('crashResult', `<span class="lose">${escapeHtml(err.message)}</span>`); tg?.HapticFeedback?.notificationOccurred?.('error'); } finally { setBusy(btn, false); } }
async function cashoutCrash() { const btn = $('cashoutBtn'); setBusy(btn, true, 'Cash Out...'); try { const data = await api('/api/mini/crash/cashout'); setBalance(data.balance); renderRocket(data); setHTML('crashResult', `🎉 Cash Out: <b>${fmt(data.payout)} ${coin()}</b> at <b>x${Number(data.effectiveMultiplier || 0).toFixed(2)}</b>`); tg?.HapticFeedback?.notificationOccurred?.('success'); } catch (err) { setHTML('crashResult', `<span class="lose">${escapeHtml(err.message)}</span>`); tg?.HapticFeedback?.notificationOccurred?.('error'); } finally { setBusy(btn, false); } }

function setSlotReels(reels = ['?', '?', '?']) { ['slotReelA','slotReelB','slotReelC'].forEach((id, i) => setText(id, String(reels[i] || '?') === '7' ? '7️⃣' : String(reels[i] || '?'))); }
function startSlotAnimation() { const machine = $('slotMachine'); machine?.classList.add('spinning'); if (slotSpinTimer) clearInterval(slotSpinTimer); slotSpinTimer = setInterval(() => setSlotReels([0,1,2].map(() => SLOT_SYMBOLS[Math.floor(Math.random()*SLOT_SYMBOLS.length)])), 60); }
function stopSlotAnimation(reels) { if (slotSpinTimer) clearInterval(slotSpinTimer); slotSpinTimer = null; $('slotMachine')?.classList.remove('spinning'); setSlotReels(reels); }
async function spinSlot() { const btn = $('spinBtn'); setBusy(btn, true, 'SPINNING...'); setClass('slotResult', 'result muted'); setText('slotResult', '🎰 Reels rolling...'); startSlotAnimation(); try { const data = await api('/api/mini/slot/spin', { bet: $('slotBet')?.value }); await new Promise(r => setTimeout(r, 900)); stopSlotAnimation(data.reels || ['?','?','?']); setBalance(data.balance); const won = Number(data.payout || 0) > 0; $('slotMachine')?.classList.toggle('slot-win-glow', won); setClass('slotResult', `result ${won ? 'win' : 'lose'}`); setHTML('slotResult', `${won ? '🏆 BIG WIN' : '💨 TRY AGAIN'}<br>Bet: <b>${fmt(data.bet)} ${coin()}</b> • Payout: <b>${fmt(data.payout)} ${coin()}</b> • Net: <b>${fmt(data.net)} ${coin()}</b>`); } catch (err) { stopSlotAnimation(['?','?','?']); setClass('slotResult','result lose'); setText('slotResult', err.message); } finally { setBusy(btn, false); } }

function renderPlinkoBuckets(hitIndex = null) { const row = $('plinkoBuckets'); if (!row || !config?.plinko?.buckets) return; row.innerHTML = config.plinko.buckets.map((b) => `<div class="bucket ${hitIndex === b.index ? 'hit' : ''}">${b.label}</div>`).join(''); }
async function dropPlinko() { const btn = $('plinkoBtn'); const ball = $('plinkoBall'); setBusy(btn, true, 'DROPPING...'); setClass('plinkoResult','result muted'); setText('plinkoResult','🟡 Ball dropping...'); renderPlinkoBuckets(); try { const data = await api('/api/mini/plinko/drop', { bet: $('plinkoBet')?.value }); if (ball) { ball.classList.remove('drop'); ball.style.setProperty('--plinko-x', `${5 + data.bucket.index * 10}%`); void ball.offsetWidth; ball.classList.add('drop'); } await new Promise(r => setTimeout(r, 1000)); renderPlinkoBuckets(data.bucket.index); setBalance(data.balance); const won = Number(data.payout || 0) > Number(data.bet || 0); setClass('plinkoResult', `result ${won ? 'win' : Number(data.payout) > 0 ? '' : 'lose'}`); setHTML('plinkoResult', `Bucket: <b>${escapeHtml(data.bucket.label)}</b> • Payout: <b>${fmt(data.payout)} ${coin()}</b> • Net: <b>${fmt(data.net)} ${coin()}</b>`); } catch (err) { setClass('plinkoResult','result lose'); setText('plinkoResult', err.message); } finally { setBusy(btn, false); } }

function buildWheel() { const disk = $('wheelDisk'); if (!disk || !config?.wheel?.segments) return; disk.title = config.wheel.segments.map(s => s.label).join(' • '); }
async function spinWheel() { const btn = $('wheelBtn'); setBusy(btn, true, 'SPINNING...'); setClass('wheelResult','result muted'); setText('wheelResult','🎡 Wheel spinning...'); try { const data = await api('/api/mini/wheel/spin', { bet: $('wheelBet')?.value }); wheelRotation += Number(data.spinAngle || 1800); const disk = $('wheelDisk'); if (disk) disk.style.transform = `rotate(${wheelRotation}deg)`; await new Promise(r => setTimeout(r, 3050)); setBalance(data.balance); const won = Number(data.payout || 0) > Number(data.bet || 0); setClass('wheelResult', `result ${won ? 'win' : Number(data.payout) > 0 ? '' : 'lose'}`); setHTML('wheelResult', `Result: <b>${escapeHtml(data.segment.label)}</b> • Payout: <b>${fmt(data.payout)} ${coin()}</b> • Net: <b>${fmt(data.net)} ${coin()}</b>`); } catch (err) { setClass('wheelResult','result lose'); setText('wheelResult', err.message); } finally { setBusy(btn, false); } }

function renderMinesBoard(game) { const board = $('minesBoard'); if (!board) return; const tiles = game?.tiles || Array.from({length:25}, (_, i) => ({ index:i, label:'hidden' })); board.innerHTML = tiles.map((t) => { const cls = t.exploded ? 'boom' : t.label === 'mine' ? 'mine' : t.opened ? 'safe' : ''; const icon = t.exploded ? '💥' : t.label === 'mine' ? '💣' : t.opened ? '💎' : '?'; return `<button class="mine-tile ${cls}" data-mine-index="${t.index}" ${game?.state !== 'playing' || t.opened ? 'disabled' : ''}>${icon}</button>`; }).join(''); }
function renderMines(game, balance) { if (balance != null) setBalance(balance); renderMinesBoard(game); setText('minesSafe', game ? `${game.safeOpened}/${25 - game.mineCount}` : '0'); setText('minesMulti', `x${Number(game?.multiplier || 1).toFixed(2)}`); setText('minesCash', game?.cashoutLocked ? 'Locked' : `${fmt(game?.cashoutEstimate || 0)} ${coin()}`); const cashBtn = $('minesCashoutBtn'); if (cashBtn) cashBtn.disabled = !game || game.cashoutLocked || game.state !== 'playing'; }
async function startMines() { const btn = $('minesStartBtn'); setBusy(btn, true, 'STARTING...'); try { const data = await api('/api/mini/mines/start', { bet: $('minesBet')?.value }); renderMines(data.game, data.balance); setClass('minesResult','result muted'); setText('minesResult', `Safe ${data.game.minCashoutSafe} ခုဖွင့်ပြီးမှ Cash Out လုပ်နိုင်ပါတယ်။`); } catch (err) { setClass('minesResult','result lose'); setText('minesResult', err.message); } finally { setBusy(btn, false); } }
async function openMine(index) { try { const data = await api('/api/mini/mines/open', { index }); renderMines(data.game, data.balance); if (data.result === 'lost') { setClass('minesResult','result lose'); setText('minesResult', '💥 BOOM! Mine ထိသွားပါပြီ။'); } else { setClass('minesResult','result win'); setText('minesResult', '💎 Safe! ဆက်ဖွင့်မလား Cash Out လုပ်မလား ရွေးပါ။'); } } catch (err) { setClass('minesResult','result lose'); setText('minesResult', err.message); } }
async function cashoutMines() { const btn = $('minesCashoutBtn'); setBusy(btn, true, 'CASHING...'); try { const data = await api('/api/mini/mines/cashout'); renderMines(data.game, data.balance); setClass('minesResult','result win'); setHTML('minesResult', `✅ Cash Out Success: <b>${fmt(data.payout)} ${coin()}</b>`); } catch (err) { setClass('minesResult','result lose'); setText('minesResult', err.message); } finally { setBusy(btn, false); } }

function bindEvents() {
  document.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => openPanel(btn.dataset.open)));
  $('crashStartBtn')?.addEventListener('click', placeCrashBet); $('cashoutBtn')?.addEventListener('click', cashoutCrash);
  $('spinBtn')?.addEventListener('click', spinSlot); $('plinkoBtn')?.addEventListener('click', dropPlinko); $('wheelBtn')?.addEventListener('click', spinWheel); $('minesStartBtn')?.addEventListener('click', startMines); $('minesCashoutBtn')?.addEventListener('click', cashoutMines);
  document.querySelectorAll('[data-crash-bet]').forEach((b) => b.addEventListener('click', () => $('crashBet').value = b.dataset.crashBet));
  document.querySelectorAll('[data-slot-bet]').forEach((b) => b.addEventListener('click', () => $('slotBet').value = b.dataset.slotBet));
  document.querySelectorAll('[data-plinko-bet]').forEach((b) => b.addEventListener('click', () => $('plinkoBet').value = b.dataset.plinkoBet));
  document.querySelectorAll('[data-wheel-bet]').forEach((b) => b.addEventListener('click', () => $('wheelBet').value = b.dataset.wheelBet));
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
