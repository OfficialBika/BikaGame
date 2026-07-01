const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';
let config = null;
let pollTimer = null;
let lastRoundId = null;
let lastPhase = null;

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const coin = () => config?.coin || '$';

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.oldText = button.textContent;
    button.textContent = label || 'Loading...';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.oldText || button.textContent;
    button.disabled = false;
  }
}

function setBalance(value) {
  $('balanceText').textContent = `${fmt(value)} ${coin()}`;
  $('smallBalanceText').textContent = `${fmt(value)} ${coin()}`;
}

async function api(path, body = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.message || data.error || 'Request failed');
    err.payload = data;
    throw err;
  }

  return data;
}

async function loadConfig() {
  const res = await fetch('/api/mini/config');
  config = await res.json();
  $('slotRange').textContent = `${fmt(config.slot.minBet)} - ${fmt(config.slot.maxBet)} ${config.coin}`;
  $('crashBet').value = config.crash.minBet;
  $('slotBet').value = config.slot.minBet;
}

async function loadMe() {
  const data = await api('/api/mini/me');
  const user = data.user || {};
  setBalance(user.balance);
}

function showTab(tab) {
  document.querySelectorAll('.tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === tab));
}

async function spinSlot() {
  const btn = $('spinBtn');
  const resultBox = $('slotResult');
  const bet = $('slotBet').value;
  setBusy(btn, true, 'SPINNING...');
  resultBox.className = 'result muted';
  resultBox.textContent = 'Rolling...';

  try {
    const data = await api('/api/mini/slot/spin', { bet });
    $('slotReels').textContent = data.art || (data.reels || []).join(' | ');
    setBalance(data.balance);
    const won = Number(data.payout || 0) > 0;
    resultBox.className = `result ${won ? 'win' : 'lose'}`;
    resultBox.innerHTML = `${won ? '✅ WIN' : '❌ LOSE'}<br>Bet: <b>${fmt(data.bet)}</b> ${coin()}<br>Multiplier: <b>x${Number(data.multiplier || 0).toFixed(2)}</b><br>Payout: <b>${fmt(data.payout)}</b> ${coin()}<br>Net: <b>${fmt(data.net)}</b> ${coin()}`;
    tg?.HapticFeedback?.notificationOccurred?.(won ? 'success' : 'warning');
  } catch (err) {
    resultBox.className = 'result lose';
    resultBox.textContent = err.message;
    tg?.HapticFeedback?.notificationOccurred?.('error');
  } finally {
    setBusy(btn, false);
  }
}

function rocketProgress(multiplier, phase) {
  if (phase === 'betting') return 0;
  const m = Math.max(1, Number(multiplier || 1));
  const visualMax = Math.max(3.6, Number(config?.crash?.maxPayoutMultiplier || 4));
  return Math.max(0, Math.min(1, (m - 1) / (visualMax - 1)));
}

function setRocketScene(phase, multiplier, secondsLeft) {
  const scene = $('rocketScene');
  const progress = rocketProgress(multiplier, phase);
  scene.style.setProperty('--rocket-progress', progress.toFixed(3));
  scene.classList.remove('betting', 'running', 'crashed', 'cashed', 'waiting');

  if (phase === 'betting') {
    scene.classList.add('betting');
    const total = Math.max(1, Number(config?.crash?.betSeconds || 15));
    scene.style.setProperty('--count-progress', String(Math.max(0, Math.min(1, secondsLeft / total))));
  } else if (phase === 'running') {
    scene.classList.add('running');
  } else if (phase === 'crashed') {
    scene.classList.add('crashed');
  } else if (phase === 'cashed') {
    scene.classList.add('cashed');
  } else {
    scene.classList.add('waiting');
  }
}

function renderPlayers(round) {
  const box = $('playersList');
  const players = round?.players || [];

  if (!players.length) {
    box.innerHTML = '<div class="result muted">ဒီ round မှာ bet ဝင်သူမရှိသေးပါ။</div>';
    return;
  }

  box.innerHTML = players.map((p) => {
    const payout = p.cashedOut
      ? `<span class="player-payout win">x${Number(p.cashoutMultiplier || 0).toFixed(2)} • ${fmt(p.payout)} ${coin()}</span>`
      : `<span class="player-payout">${round.state === 'crashed' ? '💥 Lost' : 'Playing'}</span>`;

    return `
      <div class="player-row ${p.me ? 'me' : ''}">
        <div class="avatar">${escapeHtml(p.initials || 'P')}</div>
        <div>
          <div class="player-name">${escapeHtml(p.name || 'Player')}${p.me ? ' • You' : ''}</div>
          <div class="player-meta">Bet ${fmt(p.bet)} ${coin()}</div>
        </div>
        ${payout}
      </div>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderCrash(data) {
  if (typeof data.balance !== 'undefined') setBalance(data.balance);

  const round = data.round || data.lastRound;
  const lastRound = data.lastRound;
  const phase = round?.state || 'waiting';
  const me = round?.me || {};
  const multiplier = Number(round?.multiplier || round?.crashPoint || 1);

  if (round?.id && (round.id !== lastRoundId || phase !== lastPhase)) {
    lastRoundId = round.id;
    lastPhase = phase;
    if (phase === 'running') tg?.HapticFeedback?.impactOccurred?.('light');
    if (phase === 'crashed') tg?.HapticFeedback?.notificationOccurred?.('warning');
  }

  $('roundTitle').textContent = round ? `Round #${round.no}` : 'Round #—';
  $('playerCount').textContent = fmt(round?.playerCount || 0);
  $('totalBet').textContent = `${fmt(round?.totalBet || 0)} ${coin()}`;
  $('totalPaid').textContent = `${fmt(round?.totalPaid || 0)} ${coin()}`;

  const chip = $('phaseChip');
  chip.className = 'round-chip';

  if (phase === 'betting') {
    chip.textContent = 'BET';
    $('roundCountdown').textContent = Math.max(0, Number(round.secondsLeft || 0));
    $('crashMultiplier').textContent = 'x1.00';
    $('crashState').textContent = `Bet time ${round.secondsLeft}s • လူအများဝင်လောင်းနိုင်ပါတယ်`;
    $('crashResult').className = 'result muted';
    $('crashResult').innerHTML = me.inRound
      ? `✅ ဒီ round မှာပါဝင်ပြီးပါပြီ။ Bet: <b>${fmt(me.bet)}</b> ${coin()}`
      : `Bet range: <b>${fmt(round.minBet)}</b> - <b>${fmt(round.maxBet)}</b> ${coin()}<br>Place bet နှိပ်ပြီးဝင်ဆော့ပါ။`;
    $('crashStartBtn').disabled = !!me.inRound;
    $('cashoutBtn').disabled = true;
    setRocketScene('betting', 1, Number(round.secondsLeft || 0));
  } else if (phase === 'running') {
    chip.textContent = 'LIVE';
    chip.classList.add('run');
    $('crashMultiplier').textContent = `x${multiplier.toFixed(2)}`;
    $('crashState').textContent = round.hypeMode ? 'All players cashed out — rocket keeps flying!' : 'Rocket တက်နေပါတယ် • အချိန်မီ Cash Out လုပ်ပါ';
    $('crashResult').className = 'result muted';
    $('crashResult').innerHTML = me.inRound
      ? me.cashedOut
        ? `✅ Cash Out ပြီးပါပြီ။ Payout: <b>${fmt(me.payout)}</b> ${coin()}`
        : `သင့် Bet: <b>${fmt(me.bet)}</b> ${coin()}<br>Cash Out min <b>x${Number(round.minCashoutMultiplier || 1.1).toFixed(2)}</b>`
      : 'သင်ဒီ round မှာ bet မဝင်ထားပါ။ နောက် bet time ကိုစောင့်ပါ။';
    $('crashStartBtn').disabled = true;
    $('cashoutBtn').disabled = !(me.inRound && !me.cashedOut && round.me?.canCashout);
    setRocketScene(me.cashedOut ? 'cashed' : 'running', multiplier, 0);
  } else if (phase === 'crashed') {
    chip.textContent = 'CRASHED';
    chip.classList.add('crash');
    const crashPoint = Number(round?.crashPoint || round?.multiplier || 1);
    $('crashMultiplier').textContent = `x${crashPoint.toFixed(2)}`;
    $('crashState').textContent = 'Rocket exploded! နောက် round auto စပါမယ်';
    $('crashResult').className = 'result lose';
    $('crashResult').innerHTML = `💥 <b>CRASHED</b><br>Crash Point: <b>x${crashPoint.toFixed(2)}</b><br>Cash Out: <b>${fmt(round?.cashoutCount || 0)}</b> | Lost: <b>${fmt(round?.leftCount || 0)}</b>`;
    $('crashStartBtn').disabled = true;
    $('cashoutBtn').disabled = true;
    setRocketScene('crashed', crashPoint, 0);
  } else if (phase === 'no_bets') {
    chip.textContent = 'NEXT';
    $('crashMultiplier').textContent = 'x1.00';
    $('crashState').textContent = 'Bet ဝင်သူမရှိလို့ နောက် round ပြန်စပါမယ်';
    $('crashResult').className = 'result muted';
    $('crashResult').textContent = 'နောက် bet time ကိုစောင့်ပါ။';
    $('crashStartBtn').disabled = true;
    $('cashoutBtn').disabled = true;
    setRocketScene('waiting', 1, 0);
  } else {
    chip.textContent = 'WAIT';
    $('crashMultiplier').textContent = 'x1.00';
    $('crashState').textContent = 'Loading next round...';
    $('crashStartBtn').disabled = true;
    $('cashoutBtn').disabled = true;
    setRocketScene('waiting', 1, 0);
  }

  renderPlayers(round || lastRound);
}

async function pollCrash() {
  try {
    const data = await api('/api/mini/crash/status');
    renderCrash(data);
  } catch (_) {}
}

async function placeCrashBet() {
  const btn = $('crashStartBtn');
  setBusy(btn, true, 'Joining...');
  try {
    const data = await api('/api/mini/crash/bet', { bet: $('crashBet').value });
    renderCrash(data);
    tg?.HapticFeedback?.notificationOccurred?.('success');
  } catch (err) {
    $('crashResult').className = 'result lose';
    $('crashResult').textContent = err.message;
    tg?.HapticFeedback?.notificationOccurred?.('error');
  } finally {
    btn.textContent = btn.dataset.oldText || 'Place bet';
    await pollCrash();
  }
}

async function cashOut() {
  const btn = $('cashoutBtn');
  setBusy(btn, true, 'Cashing...');
  try {
    const data = await api('/api/mini/crash/cashout');
    renderCrash(data);
    tg?.HapticFeedback?.notificationOccurred?.('success');
  } catch (err) {
    $('crashResult').className = 'result lose';
    $('crashResult').textContent = err.message;
    tg?.HapticFeedback?.notificationOccurred?.('error');
    await pollCrash();
  } finally {
    btn.textContent = btn.dataset.oldText || 'Cash Out';
  }
}

async function init() {
  tg?.ready?.();
  tg?.expand?.();
  tg?.setHeaderColor?.('#07080d');
  tg?.setBackgroundColor?.('#07080d');

  if (!initData) $('notTelegram').classList.remove('hidden');

  document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  document.querySelectorAll('[data-crash-bet]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('crashBet').value = btn.dataset.crashBet;
      tg?.HapticFeedback?.selectionChanged?.();
    });
  });

  $('spinBtn').addEventListener('click', spinSlot);
  $('crashStartBtn').addEventListener('click', placeCrashBet);
  $('cashoutBtn').addEventListener('click', cashOut);

  await loadConfig();
  await loadMe();
  await pollCrash();
  pollTimer = setInterval(pollCrash, 650);
}

window.addEventListener('beforeunload', () => {
  if (pollTimer) clearInterval(pollTimer);
});

init().catch((err) => {
  $('notTelegram').classList.remove('hidden');
  $('notTelegram').textContent = err.message || 'Mini App loading error.';
});
