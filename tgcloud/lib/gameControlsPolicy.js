// Missing settings use the explicit fallback supplied by getSetting().
// Any present but malformed persisted value must fail closed (game OFF).
export function enabledFromSetting(value) {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && typeof value.enabled === 'boolean') {
    return value.enabled;
  }
  return false;
}
