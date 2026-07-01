'use strict';

const crypto = require('crypto');
const { env } = require('../config/env');

const DEFAULT_MAX_AGE_SECONDS = Number(process.env.MINIAPP_AUTH_MAX_AGE_SECONDS || 24 * 60 * 60);

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseInitData(initData) {
  const params = new URLSearchParams(String(initData || ''));
  const hash = params.get('hash') || '';
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();

  const userRaw = params.get('user');
  let user = null;

  if (userRaw) {
    try {
      user = JSON.parse(userRaw);
    } catch (_) {
      user = null;
    }
  }

  return {
    params,
    hash,
    dataCheckString: pairs.join('\n'),
    authDate: Number(params.get('auth_date') || 0),
    user,
  };
}

function verifyTelegramMiniAppInitData(initData, options = {}) {
  const botToken = options.botToken || env.BOT_TOKEN;
  const maxAgeSeconds = Number(options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS);

  if (!botToken) {
    throw new Error('BOT_TOKEN_MISSING');
  }

  const parsed = parseInitData(initData);

  if (!parsed.hash || !parsed.dataCheckString || !parsed.user?.id) {
    throw new Error('MINIAPP_AUTH_MISSING');
  }

  const secret = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const expectedHash = crypto
    .createHmac('sha256', secret)
    .update(parsed.dataCheckString)
    .digest('hex');

  if (!timingSafeEqualHex(expectedHash, parsed.hash)) {
    throw new Error('MINIAPP_AUTH_INVALID');
  }

  if (maxAgeSeconds > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (!parsed.authDate || now - parsed.authDate > maxAgeSeconds) {
      throw new Error('MINIAPP_AUTH_EXPIRED');
    }
  }

  return {
    user: parsed.user,
    authDate: parsed.authDate,
    queryId: parsed.params.get('query_id') || null,
    startParam: parsed.params.get('start_param') || null,
  };
}

function getInitDataFromRequest(req) {
  return (
    req.headers['x-telegram-init-data'] ||
    req.headers['telegram-init-data'] ||
    req.body?.initData ||
    req.query?.tgWebAppData ||
    ''
  );
}

module.exports = {
  parseInitData,
  verifyTelegramMiniAppInitData,
  getInitDataFromRequest,
};
