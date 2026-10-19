const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

export function walletIdForUserId(userId, suffix) {
  const id = String(userId ?? '').trim();
  const tail = String(suffix ?? '').trim().toLowerCase();
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return null;
  if (!/^[a-z]{5}$/.test(tail)) return null;
  return 'Bika' + id + tail;
}

export function userIdFromWalletId(walletId) {
  const value = String(walletId ?? '').trim();
  const match = /^Bika([1-9]\d*)([a-z]{5})$/i.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1]))) return null;
  return match[1];
}

export function walletSuffix(random = Math.random) {
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    const sample = Number(random());
    const index = Math.max(0, Math.min(25, Math.floor((Number.isFinite(sample) ? sample : 0) * 26)));
    out += ALPHABET[index];
  }
  return out;
}

export function isWalletId(value) {
  return userIdFromWalletId(value) !== null;
}
