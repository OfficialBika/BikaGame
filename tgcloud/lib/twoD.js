import { api, db, EndpointError } from 'sdk';
import { and, desc, eq, lt, or } from 'sdk/db';
import { twoDEvents, twoDBets, twoDPositions, twoDOffdates } from '../schema.js';
import {
  ensureEconomy, ensureUser, getSetting, setSetting, placeTwoDBet, settleMultiPayouts,
} from './economy.js';
import { SERVERLESS_OWNER_TELEGRAM_ID } from './config.js';
import { parseTwoDBet, twoDSessionAt, TWO_D_RULES } from './twoDPolicy.js';

const now = () => new Date();
const CHANNEL_SETTING = 'serverless_two_d_channel_id';
const OWNER_SETTING = 'serverless_two_d_owner_notification_id';
const stalePublishMs = 120000;

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function owner(actorId) {
  const expected = Number(SERVERLESS_OWNER_TELEGRAM_ID);
  if (!Number.isSafeInteger(expected) || expected <= 0) {
    throw new EndpointError('SERVERLESS_OWNER_TELEGRAM_ID ကို config မှာ သတ်မှတ်ပါ။', { code: 'OWNER_NOT_CONFIGURED' });
  }
  if (Number(actorId) !== expected) {
    throw new EndpointError('Owner only.', { code: 'OWNER_ONLY' });
  }
  return expected;
}

function isGroup(chat) {
  return chat?.type === 'group' || chat?.type === 'supergroup';
}

function channelIdNumber(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id < 0 ? id : null;
}

async function configuredChannelId() {
  await ensureEconomy();
  return channelIdNumber(await getSetting(CHANNEL_SETTING, null));
}

async function sendText(chatId, text) {
  return api.sendMessage({ chat_id: chatId, text, disable_web_page_preview: true });
}

export async function settingsChannelIdForOwner(actorId, rawChatId) {
  owner(actorId);
  const chatId = channelIdNumber(rawChatId);
  if (!chatId) {
    throw new EndpointError('Channel ID ကို -100... ပုံစံ numeric ID ဖြင့် ထည့်ပါ။', { code: 'TWO_D_CHANNEL_INVALID' });
  }
  let chat;
  try {
    chat = await api.getChat({ chat_id: chatId });
  } catch (_) {
    throw new EndpointError('Channel ကို မဖတ်နိုင်ပါ။ Bot ကို Channel admin လုပ်ပြီး ID ပြန်စစ်ပါ။', { code: 'TWO_D_CHANNEL_UNAVAILABLE' });
  }
  if (chat?.type !== 'channel') {
    throw new EndpointError('2D post အတွက် Telegram channel တစ်ခုကိုပဲ သတ်မှတ်နိုင်ပါတယ်။', { code: 'TWO_D_CHANNEL_REQUIRED' });
  }
  const bot = await api.getMe();
  const member = await api.getChatMember({ chat_id: chatId, user_id: Number(bot?.id) });
  if (!['creator', 'administrator'].includes(String(member?.status || '').toLowerCase())) {
    throw new EndpointError('Bot ကို သတ်မှတ်ထားသော Channel မှာ administrator ပေးပြီး ပြန်စမ်းပါ။', { code: 'TWO_D_CHANNEL_BOT_ADMIN_REQUIRED' });
  }
  await setSetting(CHANNEL_SETTING, chatId);
  await setSetting(OWNER_SETTING, Number(actorId));
  return { ok: true, channelId: chatId, title: String(chat.title || 'BIKA 2D Channel') };
}

function dateAtYangon(dayKey, hhmm) {
  const [year, month, day] = dayKey.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - TWO_D_RULES.yangonOffsetMinutes * 60000);
}

function dateLabel(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(date);
}

function openPostText(event) {
  const data = objectValue(event.data);
  return [
    '🎯 BIKA 2D ထိုးကြေးဖွင့်ပါပြီ',
    '━━━━━━━━━━━━━━━━━━',
    '📅 ' + dateLabel(new Date(data.openAt || event.openedAt || event.createdAt)),
    '⏳ ' + dateLabel(new Date(event.closeAt)) + ' မှာ ပိတ်ပါမယ်',
    '💰 ပေါက်ကြေး ' + TWO_D_RULES.payoutMultiplier + ' ဆ',
    '🎟️ တစ်ဂဏန်းလျှင် ' + TWO_D_RULES.minBet.toLocaleString('en-US') + ' မှ ' + TWO_D_RULES.maxPerNumber.toLocaleString('en-US') + ' Bal အထိ',
    '',
    'ဒီ post ရဲ့ linked discussion comment ကို reply လုပ်ပြီး ထိုးနိုင်ပါတယ်။',
    'ဥပမာ: .2d 00.33.66 5000',
    'ပြောင်းပြန်ဂဏန်း: .2d 45R 5000',
    '',
    '🍀 ကံကောင်းပါစေရှင့်',
  ].join('\n');
}

function closePostText(event) {
  return [
    '🔒 BIKA 2D ထိုးကြေးပိတ်လိုက်ပါပြီ',
    '━━━━━━━━━━━━━━━━━━',
    '📅 ' + dateLabel(new Date(event.closeAt)),
    '🎯 ပေါက်ဂဏန်းထွက်ရန် Owner ၏ /2dwin 45 command ကို စောင့်နေပါသည်။',
    '🍀 အားလုံး ကံကောင်းကြပါစေရှင့်',
  ].join('\n');
}

function eventOrder(a, b) {
  return new Date(b.closeAt || 0).getTime() - new Date(a.closeAt || 0).getTime();
}

async function claimScheduledEvent(event) {
  const timestamp = now();
  const claimed = await db.update(twoDEvents).set({ status: 'publishing', updatedAt: timestamp })
    .where(and(eq(twoDEvents.id, event.id), eq(twoDEvents.status, 'scheduled'))).returning().run();
  if (Array.isArray(claimed)) return claimed.length > 0;
  if (Array.isArray(claimed?.rows)) return claimed.rows.length > 0;
  return Number(claimed?.rowsAffected || claimed?.changes || 0) > 0;
}

async function closeExpiredEvents(channelId) {
  const timestamp = now();
  const candidates = await db.select().from(twoDEvents).where(eq(twoDEvents.status, 'open')).all();
  const expired = candidates.filter(event => event.closeAt && new Date(event.closeAt).getTime() <= timestamp.getTime());
  for (const event of expired) {
    const changed = await db.update(twoDEvents).set({ status: 'closed', updatedAt: timestamp })
      .where(and(eq(twoDEvents.id, event.id), eq(twoDEvents.status, 'open'), lt(twoDEvents.closeAt, timestamp))).returning().run();
    const didChange = Array.isArray(changed)
      ? changed.length > 0
      : Array.isArray(changed?.rows)
        ? changed.rows.length > 0
        : Number(changed?.rowsAffected || changed?.changes || 0) > 0;
    if (!didChange) continue;

    const data = objectValue(event.data);
    try {
      await sendText(channelId, closePostText(event));
      await db.update(twoDEvents).set({
        data: { ...data, closeNotifiedAt: timestamp.toISOString() },
        updatedAt: timestamp,
      }).where(eq(twoDEvents.id, event.id)).run();
    } catch (error) {
      console.warn('BIKA_2D_CLOSE_POST_FAILED', String(error?.message || error));
    }

    const ownerId = Number(await getSetting(OWNER_SETTING, SERVERLESS_OWNER_TELEGRAM_ID));
    if (Number.isSafeInteger(ownerId) && ownerId > 0) {
      try {
        await sendText(ownerId, '🔔 BIKA 2D Bet ပိတ်ပြီးပါပြီ။\nEvent: ' + event.id + '\nပေါက်ဂဏန်းထွက်လျှင် /2dwin 45 ကို သုံးပါ။');
      } catch (_) {}
    }
  }
}

async function createAndPublishEvent(session, channelId) {
  const offDate = await db.select().from(twoDOffdates).where(eq(twoDOffdates.dateKey, session.dayKey)).get();
  if (offDate) return null;
  const openedAt = dateAtYangon(session.dayKey, session.openTime);
  const closeAt = dateAtYangon(session.dayKey, session.closeTime);
  const timestamp = now();
  const initialData = {
    session: session.session,
    openAt: openedAt.toISOString(),
    channelId,
    openMessageId: null,
    discussionChatId: null,
    discussionRootMessageId: null,
    resultMessageId: null,
  };
  await db.insert(twoDEvents).values({
    id: session.eventId,
    dateKey: session.eventDateKey,
    status: 'scheduled',
    result: null,
    openedAt,
    closeAt,
    publishedAt: null,
    data: initialData,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).onConflictDoNothing().run();

  let event = await db.select().from(twoDEvents).where(eq(twoDEvents.id, session.eventId)).get();
  if (!event) return null;

  if (event.status === 'publishing' && new Date(event.updatedAt).getTime() < Date.now() - stalePublishMs) {
    await db.update(twoDEvents).set({ status: 'scheduled', updatedAt: timestamp })
      .where(and(eq(twoDEvents.id, event.id), eq(twoDEvents.status, 'publishing'))).run();
    event = await db.select().from(twoDEvents).where(eq(twoDEvents.id, session.eventId)).get();
  }
  if (event.status !== 'scheduled' || !await claimScheduledEvent(event)) return event;

  try {
    const sent = await sendText(channelId, openPostText({ ...event, data: initialData, openedAt, closeAt, createdAt: timestamp }));
    const publishedData = { ...initialData, openMessageId: Number(sent?.message_id || 0), publishedMessageId: Number(sent?.message_id || 0) };
    await db.update(twoDEvents).set({
      status: 'open',
      publishedAt: now(),
      data: publishedData,
      updatedAt: now(),
    }).where(and(eq(twoDEvents.id, event.id), eq(twoDEvents.status, 'publishing'))).run();
    return await db.select().from(twoDEvents).where(eq(twoDEvents.id, event.id)).get();
  } catch (error) {
    await db.update(twoDEvents).set({ status: 'scheduled', updatedAt: now() })
      .where(and(eq(twoDEvents.id, event.id), eq(twoDEvents.status, 'publishing'))).run();
    console.warn('BIKA_2D_OPEN_POST_FAILED', String(error?.message || error));
    return null;
  }
}

async function captureDiscussionRoot(message, channelId) {
  if (!message?.chat?.id || !message?.is_automatic_forward) return false;
  const origin = message.forward_origin || {};
  const originChatId = origin.type === 'channel' ? origin.chat?.id : message.sender_chat?.id;
  const originMessageId = origin.type === 'channel' ? origin.message_id : message.forward_from_message_id;
  if (!originChatId || String(originChatId) !== String(channelId) || !Number(originMessageId)) return false;

  const recent = await db.select().from(twoDEvents).orderBy(desc(twoDEvents.createdAt)).limit(30).all();
  const event = recent.find(item => {
    const data = objectValue(item.data);
    return String(data.channelId || '') === String(channelId) && Number(data.openMessageId || data.publishedMessageId) === Number(originMessageId);
  });
  if (!event) return false;
  const data = objectValue(event.data);
  await db.update(twoDEvents).set({
    data: { ...data, discussionChatId: Number(message.chat.id), discussionRootMessageId: Number(message.message_id) },
    updatedAt: now(),
  }).where(eq(twoDEvents.id, event.id)).run();
  return true;
}

export async function reconcileTwoDOnUpdate(message) {
  await ensureEconomy();
  const channelId = await configuredChannelId();
  if (!channelId) return { ok: false, reason: 'channel_not_configured' };
  try {
    await captureDiscussionRoot(message, channelId);
  } catch (error) {
    console.warn('BIKA_2D_ROOT_CAPTURE_FAILED', String(error?.message || error));
  }

  await closeExpiredEvents(channelId);
  const session = twoDSessionAt(now());
  if (session.open) await createAndPublishEvent(session, channelId);
  return { ok: true, session: session.open ? session.session : null };
}

function matchesEventThread(message, event, channelId) {
  if (!isGroup(message.chat)) return false;
  const data = objectValue(event.data);
  const rootId = Number(data.discussionRootMessageId || 0);
  const openMessageId = Number(data.openMessageId || 0);
  const reply = message.reply_to_message || {};
  const externalReply = message.external_reply || {};
  const origin = reply.forward_origin || externalReply.origin || {};
  const originChatId = origin.type === 'channel'
    ? origin.chat?.id
    : reply.sender_chat?.id || externalReply.chat?.id || null;
  const originMessageId = origin.type === 'channel'
    ? origin.message_id
    : externalReply.message_id || reply.forward_from_message_id || null;
  if (originChatId && String(originChatId) === String(channelId) && Number(originMessageId) === openMessageId) return true;
  if (rootId && Number(reply.message_id || 0) === rootId && reply.is_automatic_forward) return true;
  if (rootId && Number(message.message_thread_id || 0) === rootId) return true;
  return false;
}

export async function handleTwoDBet(message) {
  await ensureEconomy();
  if (!isGroup(message?.chat)) {
    throw new EndpointError('.2d ကို 2D post ရဲ့ linked discussion group မှာပဲ သုံးပါ။', { code: 'TWO_D_GROUP_REQUIRED' });
  }
  const channelId = await configuredChannelId();
  if (!channelId) throw new EndpointError('Owner က private chat ထဲမှာ /2dchannel -100... ကို အရင်သတ်မှတ်ပါ။', { code: 'TWO_D_CHANNEL_NOT_CONFIGURED' });

  const parsed = parseTwoDBet(message.text);
  if (!parsed.ok) {
    if (parsed.error === 'AMOUNT_LIMIT') throw new EndpointError('တစ်ဂဏန်းလျှင် 200 မှ 200,000 Bal အတွင်း ထိုးပါ။', { code: 'TWO_D_AMOUNT_LIMIT' });
    if (parsed.error === 'INVALID_NUMBER') throw new EndpointError('ဂဏန်း ' + parsed.token + ' မမှန်ပါ။ 00–99 သို့မဟုတ် 00R ပုံစံ သုံးပါ။', { code: 'TWO_D_NUMBER_INVALID' });
    if (parsed.error === 'NUMBER_LIMIT') throw new EndpointError('ဂဏန်း ' + parsed.number + ' အတွက် စုစုပေါင်း 200,000 Bal ထက် မကျော်ရပါ။', { code: 'TWO_D_NUMBER_LIMIT' });
    throw new EndpointError('ပုံစံမှားနေပါတယ်။ ဥပမာ .2d 00.33.66 5000', { code: 'TWO_D_FORMAT' });
  }

  const currentSession = twoDSessionAt(now());
  if (!currentSession.open) throw new EndpointError('လက်ရှိအချိန်တွင် 2D ထိုးကြေးဖွင့်မထားပါ။ Yangon time AM 08:00–11:50 / PM 13:00–15:59 ဖြစ်ပါသည်။', { code: 'TWO_D_SESSION_CLOSED' });
  const event = await db.select().from(twoDEvents).where(eq(twoDEvents.id, currentSession.eventId)).get();
  if (!event || event.status !== 'open' || !event.closeAt || new Date(event.closeAt).getTime() <= Date.now()) {
    throw new EndpointError('2D post မဖွင့်ရသေးပါ။ Channel မှာ Open post ပေါ်လာပြီး linked discussion ကို reply လုပ်ပါ။', { code: 'TWO_D_EVENT_CLOSED' });
  }
  if (!matchesEventThread(message, event, channelId)) {
    throw new EndpointError('ထိုးလိုသောဂဏန်းကို သက်ဆိုင်ရာ 2D Open Post ရဲ့ linked discussion comment ကို reply လုပ်ပြီး ပို့ပါ။', { code: 'TWO_D_REPLY_REQUIRED' });
  }

  const user = await ensureUser(message.from);
  const result = await placeTwoDBet({
    eventId: event.id,
    userId: user.tgId,
    lines: parsed.lines,
    total: parsed.total,
    sourceChatId: message.chat.id,
    sourceMessageId: message.message_id,
    display: parsed.display,
  });
  if (result.duplicate) return { ok: true, duplicate: true, text: '⚠️ ဒီ message ကို လက်ခံပြီးသားပါ။ Balance ထပ်မဖြတ်ထားပါ။' };

  const list = parsed.display.map(row => row.label + ' - ' + row.amount.toLocaleString('en-US') + (row.multiplier > 1 ? ' × ' + row.multiplier : '')).join('\n');
  return {
    ok: true,
    duplicate: false,
    text: '✅ BIKA 2D BET COMPLETE\n━━━━━━━━━━━━━━━━━━\n' +
      '📅 ' + dateLabel(new Date(event.openedAt || event.createdAt)) + '\n' +
      list + '\n\n' +
      '💰 TOTAL BET: ' + result.total.toLocaleString('en-US') + ' Bal\n' +
      '💳 BALANCE: ' + result.balance.toLocaleString('en-US') + ' Bal\n🍀 ကံကောင်းပါစေရှင့်',
  };
}

async function latestClosedEvent() {
  const rows = await db.select().from(twoDEvents)
    .where(or(eq(twoDEvents.status, 'closed'), eq(twoDEvents.status, 'settling'), eq(twoDEvents.status, 'result')))
    .orderBy(desc(twoDEvents.closeAt)).limit(30).all();
  return rows[0] || null;
}

export async function closeTwoDEvent(actorId) {
  owner(actorId);
  await ensureEconomy();
  const rows = await db.select().from(twoDEvents).where(eq(twoDEvents.status, 'open')).orderBy(desc(twoDEvents.closeAt)).limit(10).all();
  const event = rows.find(item => item.closeAt && new Date(item.closeAt).getTime() > 0);
  if (!event) return { ok: false, reason: 'no_open_event' };
  const timestamp = now();
  const changed = await db.update(twoDEvents).set({ status: 'closed', updatedAt: timestamp })
    .where(and(eq(twoDEvents.id, event.id), eq(twoDEvents.status, 'open'))).returning().run();
  const didChange = Array.isArray(changed)
    ? changed.length > 0
    : Array.isArray(changed?.rows)
      ? changed.rows.length > 0
      : Number(changed?.rowsAffected || changed?.changes || 0) > 0;
  if (!didChange) return { ok: false, reason: 'already_closed' };
  const channelId = await configuredChannelId();
  if (channelId) {
    try {
      const sent = await sendText(channelId, closePostText(event));
      const data = objectValue(event.data);
      await db.update(twoDEvents).set({ data: { ...data, closeMessageId: Number(sent?.message_id || 0) }, updatedAt: now() })
        .where(eq(twoDEvents.id, event.id)).run();
    } catch (error) {
      console.warn('BIKA_2D_MANUAL_CLOSE_POST_FAILED', String(error?.message || error));
    }
  }
  return { ok: true, eventId: event.id };
}

export async function settleTwoDResult(actorId, winningNumber) {
  owner(actorId);
  await ensureEconomy();
  const number = String(winningNumber || '').trim();
  if (!/^\d{2}$/.test(number)) throw new EndpointError('ပေါက်ဂဏန်းကို 00–99 နှစ်လုံးပုံစံပေးပါ။', { code: 'TWO_D_RESULT_INVALID' });
  let event = await latestClosedEvent();
  if (!event) throw new EndpointError('ပိတ်ပြီးသား 2D Event မရှိပါ။ အရင် /betclose ပို့ပါ။', { code: 'TWO_D_EVENT_NOT_CLOSED' });
  if (event.status === 'result') {
    if (String(event.result) !== number) throw new EndpointError('ဒီ Event ကို အခြားပေါက်ဂဏန်းဖြင့် settle လုပ်ပြီးသားပါ။', { code: 'TWO_D_RESULT_CONFLICT' });
    return { ok: true, duplicate: true, eventId: event.id, number, totalPaid: Number(objectValue(event.data).totalPaid || 0) };
  }
  if (event.status === 'closed') {
    await db.update(twoDEvents).set({ status: 'settling', result: number, updatedAt: now() })
      .where(and(eq(twoDEvents.id, event.id), eq(twoDEvents.status, 'closed'))).run();
  }
  event = await db.select().from(twoDEvents).where(eq(twoDEvents.id, event.id)).get();
  if (!event || event.status !== 'settling' || String(event.result) !== number) {
    throw new EndpointError('Settlement အခြား process က လုပ်နေသည် သို့မဟုတ် result မတူပါ။', { code: 'TWO_D_SETTLEMENT_CONFLICT' });
  }

  const positions = await db.select().from(twoDPositions).where(and(eq(twoDPositions.eventId, event.id), eq(twoDPositions.number, number))).all();
  const payouts = positions.filter(row => Number(row.amount) > 0).map(row => ({
    userId: Number(row.userId), amount: Number(row.amount) * TWO_D_RULES.payoutMultiplier,
  }));
  const totalPaid = payouts.reduce((sum, row) => sum + row.amount, 0);
  if (!Number.isSafeInteger(totalPaid)) throw new EndpointError('Payout total exceeds safe ledger limit.', { code: 'TWO_D_PAYOUT_OVERFLOW' });
  const histories = payouts.map(row => ({
    userId: row.userId, game: 'two_d', bet: Number(positions.find(x => x.userId === row.userId)?.amount || 0),
    payout: row.amount, multiplier: TWO_D_RULES.payoutMultiplier,
    result: { winningNumber: number, eventId: event.id }, title: 'BIKA 2D',
    outcome: 'win',
  }));

  await settleMultiPayouts({
    settlementId: event.id,
    typePrefix: 'two_d',
    payouts,
    histories,
    meta: { eventId: event.id, winningNumber: number, payoutMultiplier: TWO_D_RULES.payoutMultiplier },
  });
  const timestamp = now();
  const data = objectValue(event.data);
  await db.update(twoDEvents).set({
    status: 'result',
    data: { ...data, winningNumber: number, totalPaid, winnerCount: payouts.length, settledAt: timestamp.toISOString() },
    updatedAt: timestamp,
  }).where(and(eq(twoDEvents.id, event.id), eq(twoDEvents.status, 'settling'), eq(twoDEvents.result, number))).run();
  await db.update(twoDBets).set({ status: 'settled', updatedAt: timestamp }).where(eq(twoDBets.eventId, event.id)).run();

  const channelId = await configuredChannelId();
  if (channelId) {
    try {
      const latest = await db.select().from(twoDEvents).where(eq(twoDEvents.id, event.id)).get();
      if (!Number(objectValue(latest?.data).resultMessageId)) {
        const sent = await sendText(channelId, [
          '🏆 BIKA 2D ပေါက်ဂဏန်းထွက်ပါပြီ',
          '━━━━━━━━━━━━━━━━━━',
          '📅 ' + dateLabel(new Date(event.closeAt)),
          '🎯 ပေါက်ဂဏန်း: ' + number,
          '👥 ကံထူးရှင်: ' + payouts.length,
          '💰 စုစုပေါင်းပေးချေ: ' + totalPaid.toLocaleString('en-US') + ' Bal',
          '🍀 ကံထူးရှင်အားလုံး ဂုဏ်ယူပါတယ်ရှင့်',
        ].join('\n'));
        await db.update(twoDEvents).set({
          data: { ...objectValue(latest?.data), resultMessageId: Number(sent?.message_id || 0) },
          updatedAt: now(),
        }).where(eq(twoDEvents.id, event.id)).run();
      }
    } catch (error) {
      console.warn('BIKA_2D_RESULT_POST_FAILED', String(error?.message || error));
    }
  }
  return { ok: true, duplicate: false, eventId: event.id, number, totalPaid, winnerCount: payouts.length };
}

export async function getTwoDStatus() {
  await ensureEconomy();
  const rows = await db.select().from(twoDEvents).orderBy(desc(twoDEvents.createdAt)).limit(20).all();
  const current = rows.find(event => ['scheduled', 'publishing', 'open', 'closed', 'settling'].includes(event.status));
  if (!current) return { status: 'idle', eventId: null, message: 'ဒီနေ့ 2D Event မရှိသေးပါ။' };
  return {
    status: current.status,
    eventId: current.id,
    closeAt: current.closeAt ? dateLabel(new Date(current.closeAt)) : null,
    winningNumber: current.result || null,
    channelConfigured: Boolean(await configuredChannelId()),
  };
}

export async function getMyTwoDBet(userId) {
  await ensureEconomy();
  const rows = await db.select().from(twoDEvents).orderBy(desc(twoDEvents.createdAt)).limit(20).all();
  const event = rows.find(item => ['scheduled', 'publishing', 'open', 'closed', 'settling', 'result'].includes(item.status));
  if (!event) return { ok: true, eventId: null, items: [] };
  const positions = await db.select().from(twoDPositions).where(and(eq(twoDPositions.eventId, event.id), eq(twoDPositions.userId, Number(userId)))).all();
  return { ok: true, eventId: event.id, status: event.status, items: positions.map(row => ({
    number: row.number, amount: Number(row.amount), potentialWin: Number(row.amount) * TWO_D_RULES.payoutMultiplier,
  })) };
}
