export function yangonDayBounds(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Yangon',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const year = Number(values.year), month = Number(values.month), day = Number(values.day);
  const dayKey = String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  const dayStart = new Date(Date.UTC(year, month - 1, day) - 390 * 60 * 1000);
  return { dayKey, dayStartUnix: Math.floor(dayStart.getTime() / 1000), dayStart };
}

export function dailyRewardAmount(min = 500, max = 2000, random = Math.random) {
  const low = Number(min), high = Number(max);
  if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high) || low < 1 || high < low) {
    throw new RangeError('Invalid daily reward range');
  }
  const sample = Number(random());
  const normalized = Number.isFinite(sample) ? Math.max(0, Math.min(0.9999999999999999, sample)) : 0;
  return low + Math.floor(normalized * (high - low + 1));
}
