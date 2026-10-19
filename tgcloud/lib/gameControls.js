import { EndpointError } from 'sdk';
import { getSetting, setSetting } from './economy.js';
import { normalizeGameKey } from './gameControlNames.js';
import { SERVERLESS_OWNER_TELEGRAM_ID } from './config.js';

const settingKey = (game) => 'game_enabled:' + game;

function configuredOwnerId() {
  const value = Number(SERVERLESS_OWNER_TELEGRAM_ID);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function enabledFromSetting(value) {
  if (value && typeof value === 'object') return value.enabled !== false;
  return value !== false;
}

export async function getGameEnabled(game) {
  const key = normalizeGameKey(game);
  if (!key) throw new EndpointError('Unknown game control.', { code: 'INVALID_GAME' });
  const value = await getSetting(settingKey(key), true);
  return enabledFromSetting(value);
}

export async function assertGameEnabled(game) {
  const key = normalizeGameKey(game);
  if (!key) throw new EndpointError('Unknown game.', { code: 'INVALID_GAME' });
  if (!(await getGameEnabled(key))) {
    throw new EndpointError('ဒီဂိမ်းကို Owner က ယာယီပိတ်ထားပါတယ်။', {
      code: 'GAME_DISABLED',
      game: key,
    });
  }
  return true;
}

export async function setGameEnabled(game, enabled, actorUserId) {
  const key = normalizeGameKey(game);
  if (!key) throw new EndpointError('Unknown game control.', { code: 'INVALID_GAME' });

  const ownerId = configuredOwnerId();
  if (!ownerId) {
    throw new EndpointError('Serverless environment မှာ OWNER_ID မသတ်မှတ်ရသေးပါ။', {
      code: 'OWNER_NOT_CONFIGURED',
    });
  }
  if (String(actorUserId ?? '') !== String(ownerId)) {
    throw new EndpointError('Owner only.', { code: 'OWNER_ONLY' });
  }

  const record = {
    enabled: Boolean(enabled),
    updatedBy: ownerId,
    updatedAt: new Date().toISOString(),
  };
  await setSetting(settingKey(key), record);
  return { game: key, ...record };
}

export async function listGameStates() {
  const games = ['slot', 'blackjack', 'shan', 'dice', 'mines'];
  const entries = await Promise.all(games.map(async (game) => ({
    game,
    enabled: await getGameEnabled(game),
  })));
  return entries;
}
