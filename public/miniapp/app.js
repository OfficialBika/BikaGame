const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';
let config = null;
let crashTimer = null;

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

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

function coin() {
  return config?.coin || '$';
}

function setBalance(value) {
  $('balanceText').textContent = `${fmt(value)} ${coin()}`;
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
  $('crashRange').textContent = `${fmt(config.crash.minBet)} - ${fmt(config.crash.maxBet)} ${config.coin}`;
  $('slotBet').value = config.slot.minBet;
  $('crashBet').value = config.crash.minBet;
}

async function loadMe() {
  const data = await api('/api/mini/me');
  const user = data.user || {};
  setBalance(user.balance);
  $('welcomeText').textContent = `Welcome ${user.firstName || user.username || 'Player'}`;
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

function renderCrash(data) {
  const mult = Number(data.multiplier || 1);
  $('crashMultiplier').textContent = `x${mult.toFixed(2)}`;
  $('cashoutBtn').disabled = !(data.active && mult >= Number(config?.crash?.minCashoutMultiplier || 1.1));
  $('crashStartBtn').disabled = !!data.active;

  if (typeof data.balance !== 'undefined') setBalance(data.balance);

  if (data.active) {
    $('crashState').textContent = `Running • Bet ${fmt(data.bet)} ${coin()}`;
    $('crashResult').className = 'result muted';
    $('crashResult').textContent = `Cash Out min x${Number(data.cashoutMinMultiplier || config.crash.minCashoutMultiplier || 1.1).toFixed(2)}`;
  } else if (data.cashedOut) {
    $('crashState').textContent = 'Cash Out Success';
    $('crashResult').className = 'result win';
    $('crashResult').innerHTML = `🎉 Congratulations<br>Bet: <b>${fmt(data.bet)}</b> ${coin()}<br>Multiplier: <b>x${Number(data.effectiveMultiplier || data.multiplier || 1).toFixed(2)}</b><br>Payout: <b>${fmt(data.payout)}</b> ${coin()}<br>Net: <b>${fmt(data.net)}</b> ${coin()}`;
  } else if (data.crashed) {
    $('crashState').textContent = 'Crashed';
    $('crashResult').className = 'result lose';
    $('crashResult').innerHTML = `💥 CRASHED<br>Crash Point: <b>x${Number(data.crashPoint || data.multiplier || 1).toFixed(2)}</b><br>Lost: <b>${fmt(data.bet)}</b> ${coin()}`;
  } else {
    $('crashState').textContent = 'Bet ထည့်ပြီး Start နှိပ်ပါ။';
    $('crashResult').className = 'result muted';
    $('crashResult').textContent = 'Cash Out timing ကိုသတိထားပါ။';
  }
}

async function pollCrash() {
  try {
    const data = await api('/api/mini/crash/status');
    renderCrash(data);
    if (!data.active && crashTimer) {
      clearInterval(crashTimer);
      crashTimer = null;
    }
  } catch (_) {}
}

async function startCrash() {
  const btn = $('crashStartBtn');
  setBusy(btn, true, 'STARTING...');
  try {
    const data = await api('/api/mini/crash/start', { bet: $('crashBet').value });
    renderCrash(data);
    tg?.HapticFeedback?.impactOccurred?.('medium');
    if (crashTimer) clearInterval(crashTimer);
    crashTimer = setInterval(pollCrash, 550);
  } catch (err) {
    $('crashResult').className = 'result lose';
    $('crashResult').textContent = err.message;
    tg?.HapticFeedback?.notificationOccurred?.('error');
  } finally {
    btn.textContent = btn.dataset.oldText || 'START';
    btn.disabled = false;
  }
}

async function cashOut() {
  const btn = $('cashoutBtn');
  setBusy(btn, true, 'CASHING...');
  try {
    const data = await api('/api/mini/crash/cashout');
    renderCrash(data);
    tg?.HapticFeedback?.notificationOccurred?.('success');
    if (crashTimer) {
      clearInterval(crashTimer);
      crashTimer = null;
    }
  } catch (err) {
    $('crashResult').className = 'result lose';
    $('crashResult').textContent = err.message;
    tg?.HapticFeedback?.notificationOccurred?.('error');
    await pollCrash();
  } finally {
    btn.textContent = btn.dataset.oldText || 'CASH OUT';
  }
}

async function init() {
  tg?.ready?.();
  tg?.expand?.();

  if (!initData) $('notTelegram').classList.remove('hidden');

  document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  $('spinBtn').addEventListener('click', spinSlot);
  $('crashStartBtn').addEventListener('click', startCrash);
  $('cashoutBtn').addEventListener('click', cashOut);

  await loadConfig();
  await loadMe();
  await pollCrash();
}

init().catch((err) => {
  $('notTelegram').classList.remove('hidden');
  $('notTelegram').textContent = err.message || 'Mini App loading error.';
});
