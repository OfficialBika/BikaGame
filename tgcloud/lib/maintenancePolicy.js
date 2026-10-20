export function maintenanceEnabledFromValue(value) {
  if (value == null || value === false) return false;
  if (value === true) return true;
  if (typeof value === 'object' && typeof value.enabled === 'boolean') return value.enabled;
  // Corrupt non-null state must not silently disable maintenance.
  return true;
}

export function maintenanceCommandAction(command) {
  if (command === 'off') return { action: 'on', legacy: true };
  if (command === 'on') return { action: 'off', legacy: true };
  return null;
}

export function isConfiguredOwnerId(userId, configuredOwnerId) {
  const value = Number(configuredOwnerId);
  if (!Number.isSafeInteger(value) || value <= 0) return false;
  return String(userId ?? '') === String(value);
}

const MAINTENANCE_SAFE_ACTIONS = new Set([
  'features', 'config', 'me', 'wallet', 'walletLookup', 'walletTransfers',
  'history', 'leaderboard', 'crashStatus', 'minesStatus', 'blackjackStatus',
  'shanStatus', 'wheelDailyStatus',
  'crashCashout', 'minesCashout', 'blackjackStand', 'shanStay',
]);
export function maintenanceActionAllowed(action) {
  return MAINTENANCE_SAFE_ACTIONS.has(String(action || ''));
}
export function maintenanceCallbackAllowed(data) {
  const value = String(data || '');
  return value === 'crash:cashout' || value === 'mines:cashout' || value.startsWith('gift:cancel:') ||
    /^bj:stand:[^:]+$/.test(value) || /^shan:stay:[^:]+$/.test(value) ||
    /^dice:cancel:[^:]+$/.test(value) || /^dice:resume:[^:]+$/.test(value);
}
