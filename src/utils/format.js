/**
 * Helper functions for formatting numbers and durations.
 */

// Format a number with commas (en-US locale). Accepts strings with commas.
function fmt(n) {
  const x = typeof n === 'string' ? Number(n.replace(/,/g, '')) : Number(n || 0);
  return Number.isFinite(x) ? x.toLocaleString('en-US') : '0';
}

function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v.replace(/,/g, '')) || 0;
  return 0;
}

// Format a Date in the Asia/Yangon timezone. If Intl fails (e.g. environment
// missing ICU data), fall back to ISO string.
function formatYangon(dt = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Yangon',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(dt);
  } catch {
    return dt.toISOString();
  }
}

function formatUptime(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  if (m || h || d) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

module.exports = { fmt, toNum, formatYangon, formatUptime };