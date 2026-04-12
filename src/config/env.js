const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load variables from .env file if present. This allows local development
// while not breaking when running on platforms like Render where env vars
// are injected automatically. We do not throw here because dotenv will
// silently ignore missing files.
const envFile = path.join(__dirname, '../..', '.env');
if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
} else {
  dotenv.config();
}

// Helper to require a variable and throw a descriptive error when absent.
function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

// Parse integer environment variables.
function parseIntEnv(key, defaultValue = undefined) {
  const v = process.env[key];
  if (v === undefined || v === '') return defaultValue;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${key}`);
  return n;
}

const config = {
  botToken: requireEnv('BOT_TOKEN'),
  mongoUri: requireEnv('MONGO_URI'),
  dbName: process.env.DB_NAME || 'bika_slot',
  ownerId: parseIntEnv('OWNER_ID'),
  publicUrl: process.env.PUBLIC_URL || null,
  webhookSecret: process.env.WEBHOOK_SECRET || null,
  timeZone: process.env.TZ || 'Asia/Yangon',
  startBonus: parseIntEnv('START_BONUS', 30000),
  coin: process.env.COIN || 'MMK',
  port: parseIntEnv('PORT', 3000),
};

// Determine if we should use webhook mode. Render requires PUBLIC_URL and WEBHOOK_SECRET.
config.useWebhook = Boolean(config.publicUrl && config.webhookSecret);

module.exports = config;