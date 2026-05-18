function num(name, fallback = null) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}: must be number`);
  return n;
}

const env = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  MONGO_URI: process.env.MONGO_URI,
  DB_NAME: process.env.DB_NAME || 'bika_slot',
  OWNER_ID: num('OWNER_ID'),
  PORT: num('PORT', 3000),
  TZ: process.env.TZ || 'Asia/Yangon',
  PUBLIC_URL: process.env.PUBLIC_URL || '',
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || '',
  WEB_ORIGIN: process.env.WEB_ORIGIN || 'https://officialbika.github.io',
  WEB_API_KEY: process.env.WEB_API_KEY || '',
  START_BONUS: num('START_BONUS', 300),
  DAILY_MIN: num('DAILY_MIN', 500),
  DAILY_MAX: num('DAILY_MAX', 2000)
};

if (!env.BOT_TOKEN) throw new Error('Missing BOT_TOKEN');
if (!env.MONGO_URI) throw new Error('Missing MONGO_URI');
if (!env.OWNER_ID) throw new Error('Missing/Invalid OWNER_ID');
const USE_WEBHOOK = Boolean(env.PUBLIC_URL && env.WEBHOOK_SECRET);
module.exports = { env, USE_WEBHOOK };
