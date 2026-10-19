import { db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { treasury } from '../schema.js';
import {
  ensureEconomy, userById, recordLedgerOperation, getTreasury, getSetting, setSetting,
} from './economy.js';
import { SERVERLESS_OWNER_TELEGRAM_ID } from './config.js';

function assertOwner(actorId) {
  const ownerId = Number(SERVERLESS_OWNER_TELEGRAM_ID);
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
    throw new EndpointError('SERVERLESS_OWNER_TELEGRAM_ID ကို config မှာ သတ်မှတ်ပေးပါ။', { code: 'OWNER_NOT_CONFIGURED' });
  }
  if (String(actorId ?? '') !== String(ownerId)) throw new EndpointError('Owner only.', { code: 'OWNER_ONLY' });
}
function amount(value, allowZero = false) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isSafeInteger(n) || n < (allowZero ? 0 : 1) || n > 100000000000000) {
    throw new EndpointError('Amount ကို ကိန်းပြည့် positive value အဖြစ်ထည့်ပါ။', { code: 'ADMIN_AMOUNT_INVALID' });
  }
  return n;
}
function percent(value, min = 0, max = 100) {
  const n = Number(String(value ?? '').replace('%', '').trim());
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new EndpointError('Percent သတ်မှတ်ချက် မမှန်ပါ။', { code: 'ADMIN_PERCENT_INVALID' });
  }
  return Math.floor(n);
}

export async function ownerAdjustBalance({ actorId, targetUserId, amount: rawAmount, mode, idempotencyKey }) {
  await ensureEconomy();
  assertOwner(actorId);
  const targetId = Number(targetUserId);
  const n = amount(rawAmount);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) throw new EndpointError('User ID မမှန်ပါ။', { code: 'USER_ID_INVALID' });
  if (!['add', 'remove'].includes(mode)) throw new EndpointError('Balance action မမှန်ပါ။', { code: 'ADMIN_ACTION_INVALID' });
  const before = await userById(targetId);
  if (!before) throw new EndpointError('ဒီ User ကို preview database ထဲမှာ မတွေ့ပါ။ Bot ကို /start လုပ်ထားဖို့လိုပါတယ်။', { code: 'USER_NOT_FOUND' });
  const add = mode === 'add';
  const key = String(idempotencyKey || 'owner-balance:' + mode + ':' + actorId + ':' + targetId + ':' + Date.now()).slice(0, 180);
  const operation = await recordLedgerOperation({
    type: add ? 'owner_addbal' : 'owner_rmbal',
    fromUserId: add ? 'TREASURY' : String(targetId),
    toUserId: add ? String(targetId) : 'TREASURY',
    amount: n, accountUserId: targetId,
    balanceDelta: add ? n : -n, requiredBalance: add ? 0 : n,
    totalWonDelta: 0, totalLostDelta: 0,
    treasuryDelta: add ? -n : n, requiredTreasury: add ? n : 0,
    idempotencyKey: key,
    meta: { actorId: Number(actorId), targetUserId: targetId, mode: add ? 'add' : 'remove', source: 'owner_command' },
  });
  const after = await userById(targetId);
  const bank = await getTreasury();
  return { ok: true, duplicate: operation.duplicate, mode, amount: n,
    before: Number(before.balance || 0), after: Number(after?.balance || 0),
    balance: Number(after?.balance || 0), treasury: Number(bank?.ownerBalance || 0), user: after };
}

export async function setLegacySlotWinRate(actorId, value) {
  assertOwner(actorId);
  const rtp = percent(value, 0, 100);
  await setSetting('legacy_slot_win_rate', rtp);
  return rtp;
}
export async function getLegacySlotWinRate() {
  const value = Number(await getSetting('legacy_slot_win_rate', 35));
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.floor(value))) : 35;
}

export async function setVipWinRate(actorId, value) {
  await ensureEconomy();
  assertOwner(actorId);
  const rate = percent(value, 0, 100);
  await db.update(treasury).set({ vipWinRate: rate, updatedAt: new Date() }).where(eq(treasury.key, 'treasury')).run();
  const row = await getTreasury();
  if (Number(row?.vipWinRate) !== rate) throw new EndpointError('VIP Win Rate ကို save ပြီး ပြန်စစ်မရပါ။', { code: 'TREASURY_WRITE_UNVERIFIED' });
  return rate;
}

export async function setTotalSupply(actorId, value) {
  assertOwner(actorId);
  const total = amount(value);
  await setSetting('total_supply', total);
  if (Number(await getSetting('total_supply', 0)) !== total) {
    throw new EndpointError('Total supply ကို save ပြီး ပြန်စစ်မရပါ။', { code: 'TREASURY_WRITE_UNVERIFIED' });
  }
  return total;
}
export async function getTreasuryDashboard(actorId) {
  await ensureEconomy();
  assertOwner(actorId);
  const row = await getTreasury();
  return {
    ownerBalance: Number(row?.ownerBalance || 0),
    vipWinRate: Number(row?.vipWinRate ?? 90),
    legacySlotWinRate: await getLegacySlotWinRate(),
    totalSupply: Number(await getSetting('total_supply', 0) || 0),
  };
}
