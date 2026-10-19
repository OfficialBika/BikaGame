import { db, EndpointError } from 'sdk';
import { and, eq, gt, lt } from 'sdk/db';
import { giftRequests } from '../schema.js';
import { ensureEconomy, ensureUser, userById, transferBalance, getTransaction, consumeCooldown } from './economy.js';

const now = () => new Date();
const uid = () => 'gift-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
const amountOf = (value) => {
  const amount = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000000000) {
    throw new EndpointError('Gift amount ကို positive whole number အဖြစ်ထည့်ပါ။', { code: 'GIFT_AMOUNT_INVALID' });
  }
  return amount;
};
const affected = (result) => Array.isArray(result) ? result.length
  : Array.isArray(result?.rows) ? result.rows.length
    : Number(result?.rowsAffected || result?.changes || 0);

export async function createGiftRequest({ sender, recipient, chatId, messageId, amount }) {
  await ensureEconomy();
  const senderId = Number(sender?.id ?? sender?.tgId);
  const recipientId = Number(recipient?.id ?? recipient?.tgId);
  const value = amountOf(amount);
  if (!Number.isSafeInteger(senderId) || senderId <= 0 || !Number.isSafeInteger(recipientId) || recipientId <= 0) {
    throw new EndpointError('Gift user ID မမှန်ပါ။', { code: 'GIFT_USER_INVALID' });
  }
  if (senderId === recipientId) throw new EndpointError('ကိုယ့်ကိုကိုယ် gift မပို့နိုင်ပါ။', { code: 'GIFT_SELF' });
  if (recipient?.is_bot) throw new EndpointError('Bot ကို gift မပို့နိုင်ပါ။', { code: 'GIFT_BOT_TARGET' });
  const senderUser = await ensureUser(sender);
  const recipientUser = await ensureUser(recipient);
  if (senderUser?.isBanned) throw new EndpointError('ဒီ account ကို gift ပို့ခွင့် ပိတ်ထားပါတယ်။', { code: 'USER_BANNED' });
  if (Number(senderUser?.balance || 0) < value) throw new EndpointError('လက်ကျန်ငွေ မလုံလောက်ပါ။', { code: 'USER_INSUFFICIENT' });
  await consumeCooldown(senderId, 'gift', 3000);
  const id = uid(), stamp = now(), expiresAt = new Date(stamp.getTime() + 60000);
  await db.insert(giftRequests).values({
    id, chatId: Number(chatId), messageId: Number(messageId || 0),
    fromUserId: senderId, toUserId: recipientId, amount: value, status: 'pending',
    expiresAt, data: {
      sender: { id: senderId, username: sender.username || null, firstName: sender.first_name || sender.firstName || 'Player' },
      recipient: { id: recipientId, username: recipient.username || null, firstName: recipient.first_name || recipient.firstName || 'Player' },
    },
    createdAt: stamp, updatedAt: stamp,
  }).run();
  return { ok: true, id, amount: value, expiresAt, sender: senderUser, recipient: recipientUser };
}

async function finishIfLedgerExists(request) {
  const transaction = await getTransaction('gift:' + request.id);
  if (!transaction) return null;
  await db.update(giftRequests).set({ status: 'completed', updatedAt: now() }).where(eq(giftRequests.id, request.id)).run();
  return { ok: true, duplicate: true, request: await db.select().from(giftRequests).where(eq(giftRequests.id, request.id)).get() };
}

export async function confirmGiftRequest({ actorId, giftId }) {
  await ensureEconomy();
  const id = String(giftId || '');
  let request = await db.select().from(giftRequests).where(eq(giftRequests.id, id)).get();
  if (!request) throw new EndpointError('Gift request မတွေ့ပါ သို့မဟုတ် သက်တမ်းကုန်သွားပါပြီ။', { code: 'GIFT_NOT_FOUND' });
  if (String(request.fromUserId) !== String(actorId)) throw new EndpointError('Gift ပေးပို့သူပဲ Confirm လုပ်နိုင်ပါတယ်။', { code: 'GIFT_SENDER_ONLY' });
  if (request.status === 'completed') return { ok: true, duplicate: true, request };
  if (request.status === 'cancelled' || request.status === 'expired' || request.status === 'failed') {
    throw new EndpointError('Gift request က ' + request.status + ' ဖြစ်နေပါပြီ။', { code: 'GIFT_NOT_PENDING' });
  }
  if (request.status === 'processing') {
    const recovered = await finishIfLedgerExists(request);
    if (recovered) return recovered;
    if (now().getTime() - new Date(request.updatedAt).getTime() < 15000) {
      throw new EndpointError('Gift ကို process လုပ်နေဆဲပါ။ ခဏစောင့်ပြီး ပြန်စစ်ပါ။', { code: 'GIFT_PROCESSING' });
    }
    const reset = await db.update(giftRequests).set({ status: 'pending', updatedAt: now() })
      .where(and(eq(giftRequests.id, id), eq(giftRequests.status, 'processing'), lt(giftRequests.updatedAt, new Date(now().getTime() - 15000))))
      .returning().run();
    if (!affected(reset)) {
      request = await db.select().from(giftRequests).where(eq(giftRequests.id, id)).get();
      const recoveredAgain = await finishIfLedgerExists(request);
      if (recoveredAgain) return recoveredAgain;
      throw new EndpointError('Gift process lock ကို ပြန်မရနိုင်ပါ။', { code: 'GIFT_PROCESSING' });
    }
    request = await db.select().from(giftRequests).where(eq(giftRequests.id, id)).get();
  }
  if (new Date(request.expiresAt).getTime() <= now().getTime()) {
    await db.update(giftRequests).set({ status: 'expired', updatedAt: now() })
      .where(and(eq(giftRequests.id, id), eq(giftRequests.status, 'pending'))).run();
    throw new EndpointError('Gift request သက်တမ်းကုန်သွားပါပြီ။', { code: 'GIFT_EXPIRED' });
  }
  const claimed = await db.update(giftRequests).set({ status: 'processing', updatedAt: now() })
    .where(and(eq(giftRequests.id, id), eq(giftRequests.status, 'pending'), gt(giftRequests.expiresAt, now())))
    .returning().run();
  if (!affected(claimed)) {
    request = await db.select().from(giftRequests).where(eq(giftRequests.id, id)).get();
    const recovered = await finishIfLedgerExists(request);
    if (recovered) return recovered;
    throw new EndpointError('Gift request ကို အခြား process က အရင်လက်ခံသွားပါပြီ။', { code: 'GIFT_NOT_PENDING' });
  }
  try {
    const result = await transferBalance(request.fromUserId, request.toUserId, request.amount, {
      chatId: request.chatId, giftId: id, source: 'telegram_gift_confirmation',
    }, 'gift:' + id);
    await db.update(giftRequests).set({ status: 'completed', updatedAt: now() }).where(eq(giftRequests.id, id)).run();
    return { ok: true, duplicate: Boolean(result.duplicate), request: await db.select().from(giftRequests).where(eq(giftRequests.id, id)).get(), sender: result.sender, recipient: result.recipient };
  } catch (error) {
    const transaction = await getTransaction('gift:' + id).catch(() => null);
    if (transaction) {
      await db.update(giftRequests).set({ status: 'completed', updatedAt: now() }).where(eq(giftRequests.id, id)).run();
      return { ok: true, duplicate: true, request: await db.select().from(giftRequests).where(eq(giftRequests.id, id)).get() };
    }
    await db.update(giftRequests).set({ status: 'failed', data: { ...(request.data || {}), error: String(error?.code || error?.message || 'transfer_failed').slice(0, 160) }, updatedAt: now() })
      .where(eq(giftRequests.id, id)).run();
    throw error;
  }
}

export async function cancelGiftRequest({ actorId, giftId }) {
  await ensureEconomy();
  const id = String(giftId || '');
  const request = await db.select().from(giftRequests).where(eq(giftRequests.id, id)).get();
  if (!request) throw new EndpointError('Gift request မတွေ့ပါ သို့မဟုတ် သက်တမ်းကုန်သွားပါပြီ။', { code: 'GIFT_NOT_FOUND' });
  if (String(request.fromUserId) !== String(actorId)) throw new EndpointError('Gift ပေးပို့သူပဲ Cancel လုပ်နိုင်ပါတယ်။', { code: 'GIFT_SENDER_ONLY' });
  if (request.status === 'cancelled') return { ok: true, duplicate: true, request };
  if (request.status === 'completed' || request.status === 'processing') {
    throw new EndpointError('Gift process စတင်ပြီးသားဖြစ်လို့ Cancel မလုပ်နိုင်ပါ။', { code: 'GIFT_NOT_PENDING' });
  }
  if (request.status !== 'pending') throw new EndpointError('Gift request က pending မဟုတ်တော့ပါ။', { code: 'GIFT_NOT_PENDING' });
  const status = new Date(request.expiresAt).getTime() <= now().getTime() ? 'expired' : 'cancelled';
  const changed = await db.update(giftRequests).set({ status, updatedAt: now() })
    .where(and(eq(giftRequests.id, id), eq(giftRequests.status, 'pending'))).returning().run();
  if (!affected(changed)) throw new EndpointError('Gift request ကို အခြား process က ပြောင်းလဲသွားပါပြီ။', { code: 'GIFT_NOT_PENDING' });
  return { ok: true, duplicate: false, status, request: await db.select().from(giftRequests).where(eq(giftRequests.id, id)).get() };
}
