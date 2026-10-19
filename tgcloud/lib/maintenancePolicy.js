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
