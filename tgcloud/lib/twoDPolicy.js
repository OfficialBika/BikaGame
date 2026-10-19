const MIN_BET = 200;
const MAX_PER_NUMBER = 200000;
const PAYOUT_MULTIPLIER = 40;
const YANGON_OFFSET_MINUTES = 390;
const SCHEDULE = Object.freeze([
  Object.freeze({ key: 'am', open: '08:00', close: '11:50' }),
  Object.freeze({ key: 'pm', open: '13:00', close: '15:59' }),
]);

function amount(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isSafeInteger(n) && n >= MIN_BET && n <= MAX_PER_NUMBER ? n : null;
}

export function parseTwoDBet(text) {
  const match = String(text ?? '').trim().match(/^\.2d(?:@\w+)?\s+(.+?)\s+([\d,]+)\s*$/i);
  if (!match) return { ok: false, error: 'FORMAT' };
  const perNumber = amount(match[2]);
  if (perNumber === null) return { ok: false, error: 'AMOUNT_LIMIT', min: MIN_BET, max: MAX_PER_NUMBER };

  const tokens = match[1].split(/[.\s,]+/).filter(Boolean);
  const positions = new Map();
  const display = [];
  for (const raw of tokens) {
    const token = raw.toUpperCase();
    let numbers;
    if (/^\d{2}$/.test(token)) {
      numbers = [token];
    } else if (/^\d{2}R$/.test(token)) {
      const number = token.slice(0, 2);
      const reversed = number[1] + number[0];
      numbers = reversed === number ? [number] : [number, reversed];
    } else {
      return { ok: false, error: 'INVALID_NUMBER', token: raw };
    }

    display.push({ label: token, amount: perNumber, multiplier: numbers.length });
    for (const number of numbers) {
      const next = (positions.get(number) || 0) + perNumber;
      if (next > MAX_PER_NUMBER) return { ok: false, error: 'NUMBER_LIMIT', number, max: MAX_PER_NUMBER };
      positions.set(number, next);
    }
  }
  const lines = [...positions.entries()].map(([number, lineAmount]) => ({
    number, amount: lineAmount, potentialWin: lineAmount * PAYOUT_MULTIPLIER,
  }));
  if (!lines.length) return { ok: false, error: 'NO_NUMBERS' };
  return {
    ok: true,
    lines,
    display,
    total: lines.reduce((sum, line) => sum + line.amount, 0),
    payoutMultiplier: PAYOUT_MULTIPLIER,
    minBet: MIN_BET,
    maxPerNumber: MAX_PER_NUMBER,
  };
}

function yangonParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  let hour = Number(values.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    weekday: values.weekday, hour, minute: Number(values.minute),
  };
}

export function yangonDayKey(date = new Date()) {
  const p = yangonParts(date);
  return p.year + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');
}

function minutesOfDay(hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

export function twoDSessionAt(date = new Date()) {
  const p = yangonParts(date);
  const key = yangonDayKey(date);
  const minute = p.hour * 60 + p.minute;
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return { open: false, reason: 'WEEKEND', dayKey: key };
  const session = SCHEDULE.find(s => minute >= minutesOfDay(s.open) && minute < minutesOfDay(s.close));
  if (!session) return { open: false, reason: 'OUTSIDE_SESSION', dayKey: key };
  return {
    open: true, dayKey: key, session: session.key,
    openTime: session.open, closeTime: session.close,
    eventDateKey: key + '-' + session.key,
    eventId: 'auto-' + key + '-' + session.key,
  };
}

export const TWO_D_RULES = Object.freeze({
  minBet: MIN_BET,
  maxPerNumber: MAX_PER_NUMBER,
  payoutMultiplier: PAYOUT_MULTIPLIER,
  yangonOffsetMinutes: YANGON_OFFSET_MINUTES,
  sessions: SCHEDULE,
});
