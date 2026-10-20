import { EndpointError } from 'sdk';
import { getSetting, setSetting } from './economy.js';
import { normalizeGameKey } from './gameControlNames.js';
import { enabledFromSetting } from './gameControlsPolicy.js';
import { SERVERLESS_OWNER_TELEGRAM_ID } from './config.js';

const settingKey = (game) => 'game_enabled:' + game;

function configuredOwnerId() {
  const value = Number(SERVERLESS_OWNER_TELEGRAM_ID);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export async function getGameState(game) {
  const key = normalizeGameKey(game);
  if (!key) throw new EndpointError('Unknown game control.', { code: 'INVALID_GAME' });
  const value = await getSetting(settingKey(key), true);
  const metadata = value && typeof value === 'object' ? value : {};
  return {
    game: key,
    enabled: enabledFromSetting(value),
    updatedBy: Number.isSafeInteger(Number(metadata.updatedBy)) && Number(metadata.updatedBy) > 0
      ? Number(metadata.updatedBy)
      : null,
    updatedAt: typeof metadata.updatedAt === 'string' && metadata.updatedAt
      ? metadata.updatedAt
      : null,
  };
}

export async function getGameEnabled(game) {
  return (await getGameState(game)).enabled;
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

  // Verify what the authoritative settings store returns; a successful write
  // response alone does not prove the requested control state was persisted.
  const saved = await getGameState(key);
  if (saved.enabled !== record.enabled ||
      saved.updatedBy !== ownerId ||
      saved.updatedAt !== record.updatedAt) {
    throw new EndpointError('Game control setting ကို သိမ်းဆည်းပြီး ပြန်စစ်မရပါ။', {
      code: 'GAME_CONTROL_WRITE_UNVERIFIED',
      game: key,
    });
  }
  return saved;
}

export async function listGameStates() {
  const games = ['slot', 'blackjack', 'shan', 'dice', 'mines'];
  return Promise.all(games.map((game) => getGameState(game)));
}
