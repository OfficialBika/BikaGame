export const MINES_RULES = Object.freeze({
  boardSize: 5,
  defaultMineCount: 5,
  allowedMineCounts: Object.freeze([5, 7, 9, 10]),
  minCashoutSafePicks: 4,
  firstSafeFreePicks: 1,
  actionTimeoutMs: 150000,
  maxActive: 30,
  cooldownMs: 1200,
  minBet: 50,
  maxBet: 20000,
  capPercent: 0.10,
  houseEdge: 0.35,
  maxPayoutMultiplier: 5,
  payoutDamping: 0.85,
});

export function normalizeMineCount(value) {
  if (value == null || String(value).trim() === '') return MINES_RULES.defaultMineCount;
  const count = Number(String(value).replace(/,/g, '').trim());
  if (!Number.isSafeInteger(count) || !MINES_RULES.allowedMineCounts.includes(count)) {
    throw new TypeError('INVALID_MINE_COUNT');
  }
  return count;
}

export function generateMineLayout(mineCount = MINES_RULES.defaultMineCount, firstSafeIndex = null, random = Math.random) {
  const count = normalizeMineCount(mineCount);
  const totalCells = MINES_RULES.boardSize ** 2;
  if (firstSafeIndex != null &&
      (!Number.isSafeInteger(Number(firstSafeIndex)) || Number(firstSafeIndex) < 0 || Number(firstSafeIndex) >= totalCells)) {
    throw new TypeError('INVALID_TILE');
  }

  const blocked = firstSafeIndex == null ? null : Number(firstSafeIndex);
  const positions = new Set();
  while (positions.size < count) {
    const sample = Number(random());
    const safeSample = Number.isFinite(sample) ? Math.max(0, Math.min(0.999999999999, sample)) : 0;
    const index = Math.floor(safeSample * totalCells);
    if (index === blocked) continue;
    positions.add(index);
  }
  return [...positions];
}

export function paidSafeOpened(safeOpened, firstSafeFreePicks = MINES_RULES.firstSafeFreePicks) {
  return Math.max(0, Math.floor(Number(safeOpened) || 0) - Math.max(0, Math.floor(Number(firstSafeFreePicks) || 0)));
}

export function calculateMinesMultiplier(safeOpened, mineCount = MINES_RULES.defaultMineCount, options = {}) {
  const count = normalizeMineCount(mineCount);
  const rules = { ...MINES_RULES, ...options };
  const totalCells = Number(rules.boardSize) ** 2;
  const safeCells = totalCells - count;
  const opened = Math.max(0, Math.min(safeCells, Math.floor(Number(safeOpened) || 0)));
  const paidOpened = paidSafeOpened(opened, rules.firstSafeFreePicks);
  if (paidOpened <= 0) return 1;

  const remainingCellsAfterFree = Math.max(1, totalCells - rules.firstSafeFreePicks);
  const remainingSafeAfterFree = Math.max(1, safeCells - rules.firstSafeFreePicks);
  let multiplier = 1;
  for (let i = 0; i < paidOpened; i += 1) {
    multiplier *= (remainingCellsAfterFree - i) / Math.max(1, remainingSafeAfterFree - i);
  }

  const adjusted = multiplier * (1 - Number(rules.houseEdge)) * Number(rules.payoutDamping);
  const capped = Math.min(adjusted, Number(rules.maxPayoutMultiplier));
  return Math.max(1.01, Math.floor(capped * 100) / 100);
}

export function canCashOutMines(safeOpened, options = {}) {
  const rules = { ...MINES_RULES, ...options };
  const opened = Math.max(0, Math.floor(Number(safeOpened) || 0));
  return opened >= Number(rules.minCashoutSafePicks) &&
    paidSafeOpened(opened, rules.firstSafeFreePicks) > 0;
}

export function minesExpiryTime(startedAtMs, timeoutMs = MINES_RULES.actionTimeoutMs) {
  const started = Number(startedAtMs);
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(started) || started <= 0 || !Number.isFinite(timeout) || timeout <= 0) {
    throw new TypeError('INVALID_MINES_EXPIRY');
  }
  return started + timeout;
}

export function isMinesExpired(expiresAtMs, nowMs = Date.now()) {
  const expires = Number(expiresAtMs);
  return Number.isFinite(expires) && expires > 0 && Number(nowMs) >= expires;
}
