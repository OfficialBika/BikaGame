function num(name, fallback = null) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}: must be number`);
  return n;
}

function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

const telegramApiRoot = (process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org').replace(/\\/+$/, '');
if (!/^https?:\\/\\//i.test(telegramApiRoot)) {
  throw new Error('Invalid TELEGRAM_API_ROOT: must be an http(s) URL');
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
  TELEGRAM_API_ROOT: telegramApiRoot,
  TELEGRAM_EDIT_QUEUE_ENABLED: bool('TELEGRAM_EDIT_QUEUE_ENABLED', false),
  TELEGRAM_EDIT_MAX_CONCURRENT: num('TELEGRAM_EDIT_MAX_CONCURRENT', 5),
  TELEGRAM_EDIT_RETRIES: num('TELEGRAM_EDIT_RETRIES', 3),
  START_BONUS: num('START_BONUS', 300),
  DAILY_MIN: num('DAILY_MIN', 500),
  DAILY_MAX: num('DAILY_MAX', 2000),
  TWO_D_CHANNEL_ID: process.env.TWO_D_CHANNEL_ID || '',
  TWO_D_DISCUSSION_CHAT_ID: process.env.TWO_D_DISCUSSION_CHAT_ID || '',
  AUCTION_CHANNEL_ID: process.env.AUCTION_CHANNEL_ID || '',
  AUCTION_DISCUSSION_CHAT_ID: process.env.AUCTION_DISCUSSION_CHAT_ID || ''
};

if (!env.BOT_TOKEN) throw new Error('Missing BOT_TOKEN');
if (!env.MONGO_URI) throw new Error('Missing MONGO_URI');
if (!env.OWNER_ID) throw new Error('Missing/Invalid OWNER_ID');
const USE_WEBHOOK = Boolean(env.PUBLIC_URL && env.WEBHOOK_SECRET);
module.exports = { env, USE_WEBHOOK };
