import { EndpointError } from 'sdk';
import { getSetting, setSetting } from './economy.js';
import { SERVERLESS_OWNER_TELEGRAM_ID } from './config.js';

const KEY = 'maintenance_mode';

function configuredOwnerId() {
  const value = Number(SERVERLESS_OWNER_TELEGRAM_ID);
  return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}

export function isConfiguredOwner(userId) {
  const ownerId = configuredOwnerId();
  return Boolean(ownerId && String(userId ?? '') === ownerId);
}

export async function getMaintenanceMode() {
  const value = await getSetting(KEY, false);
  // A malformed non-null value fails closed (ON); missing/explicit false is OFF.
  if (value == null || value === false) return { enabled: false, updatedAt: null, updatedBy: null };
  if (value === true) return { enabled: true, updatedAt: null, updatedBy: null };
  if (typeof value === 'object' && value.enabled === false) {
    return { enabled: false, updatedAt: value.updatedAt || null, updatedBy: value.updatedBy || null };
  }
  if (typeof value === 'object' && value.enabled === true) {
    return { enabled: true, updatedAt: value.updatedAt || null, updatedBy: value.updatedBy || null };
  }
  return { enabled: true, updatedAt: null, updatedBy: null };
}

export async function setMaintenanceMode(actorUserId, enabled) {
  const ownerId = configuredOwnerId();
  if (!ownerId) {
    throw new EndpointError('Serverless environment မှာ SERVERLESS_OWNER_TELEGRAM_ID မသတ်မှတ်ရသေးပါ။', {
      code: 'OWNER_NOT_CONFIGURED',
    });
  }
  if (String(actorUserId ?? '') !== ownerId) {
    throw new EndpointError('Owner only.', { code: 'OWNER_ONLY' });
  }
  const record = {
    enabled: Boolean(enabled),
    updatedBy: ownerId,
    updatedAt: new Date().toISOString(),
  };
  await setSetting(KEY, record);
  const saved = await getMaintenanceMode();
  if (saved.enabled !== record.enabled) {
    throw new EndpointError('Maintenance setting ကို သိမ်းဆည်းပြီး ပြန်စစ်မရပါ။', {
      code: 'MAINTENANCE_WRITE_UNVERIFIED',
    });
  }
  return saved;
}

export async function assertMaintenanceAccess(userId) {
  const state = await getMaintenanceMode();
  if (state.enabled && !isConfiguredOwner(userId)) {
    throw new EndpointError('🛠️ Bot Maintenance Mode ON — Owner သာ အသုံးပြုနိုင်ပါတယ်။', {
      code: 'MAINTENANCE_MODE',
    });
  }
  return state;
}

export function maintenanceCommandAction(command) {
  if (command === 'off') return { action: 'on', legacy: true };
  if (command === 'on') return { action: 'off', legacy: true };
  return null;
}
