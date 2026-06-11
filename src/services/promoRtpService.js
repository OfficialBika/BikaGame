// services/promoRtpService.js

const timers = new Map();

function getDb() {
  // သင့် project ရဲ့ database export ပေါ်မူတည်ပြီး ဒီ import ကိုညှိပါ
  const { db } = require('../config/database');
  return db;
}

function promoCollection() {
  return getDb().collection('promo_rtps');
}

function parseRtp(input) {
  const raw = String(input || '').replace('%', '').trim();
  const rtp = Number(raw);

  if (!Number.isFinite(rtp) || rtp <= 0 || rtp > 100) {
    throw new Error('RTP must be between 1 and 100');
  }

  return rtp;
}

function parseDurationMs(input) {
  const text = String(input || '').trim().toLowerCase();

  const match = text.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hour|hours)$/);

  if (!match) {
    throw new Error('Invalid time format');
  }

  const value = Number(match[1]);
  const unit = match[2];

  if (value <= 0) {
    throw new Error('Time must be greater than 0');
  }

  if (['s', 'sec', 'secs', 'second', 'seconds'].includes(unit)) {
    return value * 1000;
  }

  if (['m', 'min', 'mins', 'minute', 'minutes'].includes(unit)) {
    return value * 60 * 1000;
  }

  if (['h', 'hr', 'hour', 'hours'].includes(unit)) {
    return value * 60 * 60 * 1000;
  }

  throw new Error('Invalid time unit');
}

function formatDuration(input) {
  return String(input).replace(/\s+/g, '');
}

async function startPromoRtp(ctx, rtp, durationText, bot) {
  const chatId = ctx.chat.id;
  const groupId = String(chatId);
  const groupName = ctx.chat.title || ctx.chat.username || groupId;

  const durationMs = parseDurationMs(durationText);

  const now = new Date();
  const expiresAt = new Date(Date.now() + durationMs);

  const col = promoCollection();

  // same group မှာ active promo ရှိရင် အဟောင်းကို replaced လုပ်မယ်
  await col.updateMany(
    {
      groupId,
      ended: false,
    },
    {
      $set: {
        ended: true,
        endedAt: now,
        endReason: 'replaced',
      },
    }
  );

  const startText =
`🎰 Promotion Time Start

Promo RTP - ${rtp}%
Promo Time - ${formatDuration(durationText)}
Promo Group - ${groupName}`;

  const sent = await ctx.reply(startText);

  try {
    await ctx.telegram.pinChatMessage(chatId, sent.message_id, {
      disable_notification: false,
    });
  } catch (err) {
    console.log('Promo start pin failed:', err.message);
  }

  await col.insertOne({
    groupId,
    chatId,
    groupName,
    rtp,
    durationText: formatDuration(durationText),
    startedAt: now,
    expiresAt,
    ended: false,
    startMessageId: sent.message_id,
    createdBy: ctx.from?.id || null,
  });

  schedulePromoEnd(bot, groupId, expiresAt);

  return {
    groupId,
    groupName,
    rtp,
    expiresAt,
  };
}

async function getActivePromoRtp(groupId) {
  const col = promoCollection();
  const now = new Date();

  const promo = await col.findOne({
    groupId: String(groupId),
    ended: false,
    expiresAt: {
      $gt: now,
    },
  });

  return promo || null;
}

async function getEffectiveSlotRtp(groupId, globalRtp) {
  const promo = await getActivePromoRtp(groupId);

  if (promo) {
    return promo.rtp;
  }

  return globalRtp;
}

async function finishPromoRtp(bot, groupId, reason = 'expired') {
  const col = promoCollection();
  const now = new Date();

  const promo = await col.findOne({
    groupId: String(groupId),
    ended: false,
  });

  if (!promo) return;

  await col.updateOne(
    {
      _id: promo._id,
    },
    {
      $set: {
        ended: true,
        endedAt: now,
        endReason: reason,
      },
    }
  );

  const endText =
`🎰 Promotion Time End

ပုံမှန် Global RTP အဖြစ်သို့ ပြန်လည် ပြောင်းလဲသွားပါပြီ`;

  try {
    const sent = await bot.telegram.sendMessage(promo.chatId, endText);

    try {
      await bot.telegram.pinChatMessage(promo.chatId, sent.message_id, {
        disable_notification: false,
      });
    } catch (err) {
      console.log('Promo end pin failed:', err.message);
    }
  } catch (err) {
    console.log('Promo end message failed:', err.message);
  }
}

function schedulePromoEnd(bot, groupId, expiresAt) {
  const key = String(groupId);

  if (timers.has(key)) {
    clearTimeout(timers.get(key));
  }

  const delay = new Date(expiresAt).getTime() - Date.now();

  if (delay <= 0) {
    finishPromoRtp(bot, key, 'expired');
    return;
  }

  const timer = setTimeout(async () => {
    timers.delete(key);
    await finishPromoRtp(bot, key, 'expired');
  }, delay);

  timers.set(key, timer);
}

async function restorePromoTimers(bot) {
  const col = promoCollection();
  const now = new Date();

  const activePromos = await col.find({
    ended: false,
  }).toArray();

  for (const promo of activePromos) {
    if (new Date(promo.expiresAt).getTime() <= now.getTime()) {
      await finishPromoRtp(bot, promo.groupId, 'expired_after_restart');
    } else {
      schedulePromoEnd(bot, promo.groupId, promo.expiresAt);
    }
  }
}

module.exports = {
  parseRtp,
  parseDurationMs,
  startPromoRtp,
  getActivePromoRtp,
  getEffectiveSlotRtp,
  finishPromoRtp,
  restorePromoTimers,
};
