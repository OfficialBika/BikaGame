'use strict';

const { publicMiniAppUrl } = require('../../web/miniAppRoutes');
const { getBotInfo } = require('../../config/bot');
const { replyHTML } = require('../../utils/telegram');
const { ensureTreasury, isOwner } = require('../../services/treasuryService');
const { getRocketRtp, setRocketRtp } = require('../../services/webCrashService');
const { cleanGameKey, getWebGameRtp, setWebGameRtp, getAllWebGameRtps, gameLabel } = require('../../services/webGameRtpService');
const { createWebBlackjackRoom } = require('../../services/webBlackjackService');

function appKeyboard(url) {
  return {
    inline_keyboard: [
      [{ text: '🎮 Open Bika Game App', web_app: { url } }],
    ],
  };
}


function miniAppDirectLink(startParam = '') {
  const username = getBotInfo()?.username || process.env.BOT_USERNAME || '';
  if (!username) return null;
  const clean = String(username).replace(/^@/, '');
  const suffix = startParam ? `?startapp=${encodeURIComponent(startParam)}` : '?startapp';
  return `https://t.me/${clean}${suffix}`;
}

function miniAppJoinKeyboard(ctx, webUrl, label, startParam) {
  const chatType = ctx.chat?.type;
  const isPrivate = chatType === 'private';
  const directUrl = miniAppDirectLink(startParam);

  if (isPrivate) {
    return {
      inline_keyboard: [
        [{ text: label, web_app: { url: webUrl } }],
        [{ text: '🔗 Open Direct Link', url: directUrl || webUrl }],
      ],
    };
  }

  const rows = [];
  if (directUrl) rows.push([{ text: label, url: directUrl }]);
  rows.push([{ text: '🌐 Open Web Link', url: webUrl }]);
  return { inline_keyboard: rows };
}

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId, allow_sending_without_reply: true } : {};
}

function isPrivateChat(ctx) {
  return ctx.chat?.type === 'private';
}

function parsePercent(text) {
  const parts = String(text || '').trim().split(/\s+/);
  const raw = String(parts[1] || '').replace('%', '').trim();
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function parseSetGameRtp(text) {
  const parts = String(text || '').trim().split(/\s+/);
  const game = cleanGameKey(parts[1]);
  const raw = String(parts[2] || '').replace('%', '').trim();
  const n = Number(raw);
  return { game, value: Number.isFinite(n) ? Math.floor(n) : null };
}

function setCommandFor(gameKey) {
  const key = cleanGameKey(gameKey);
  if (key === 'rocket') return '/setrocketrtp 70';
  if (key === 'blackjack') return '/setwebbjrtp 70';
  if (key === 'shan') return '/setwebshanrtp 70';
  if (key === 'mines') return '/setwebminesrtp 70';
  return `/set${key}rtp 70`;
}

async function requireOwnerDm(ctx) {
  const treasury = await ensureTreasury();
  if (!isOwner(ctx, treasury)) {
    await replyHTML(ctx, '⛔ Owner only.', replyOptions(ctx));
    return false;
  }

  if (!isPrivateChat(ctx)) {
    await replyHTML(ctx, 'ℹ️ Web game RTP command ကို bot DM ထဲမှာပဲသုံးပါ။', replyOptions(ctx));
    return false;
  }

  return true;
}

async function showSingleRtp(ctx, game) {
  const key = cleanGameKey(game);
  const rtp = key === 'rocket' ? await getRocketRtp() : await getWebGameRtp(key);
  const setCmd = setCommandFor(key);
  return replyHTML(
    ctx,
    `🎛 <b>Web ${gameLabel(key)} RTP</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `Current RTP: <b>${rtp}%</b>\n\n` +
      `ပြင်ရန်: <code>${setCmd}</code>\n` +
      `Range: <b>40% - 95%</b>\n\n` +
      `<i>RTP နည်းလေ owner safe ပိုဖြစ်ပြီး game ပိုတင်းပါတယ်။</i>`,
    replyOptions(ctx)
  );
}

async function setSingleRtp(ctx, game, value) {
  const key = cleanGameKey(game);
  if (value == null || value < 40 || value > 95) {
    return replyHTML(
      ctx,
      `Usage: <code>${setCommandFor(key)}</code>\n` +
        `Range: <b>40% - 95%</b>`,
      replyOptions(ctx)
    );
  }

  const rtp = key === 'rocket'
    ? await setRocketRtp(value, ctx.from?.id)
    : await setWebGameRtp(key, value, ctx.from?.id);

  return replyHTML(
    ctx,
    `✅ <b>Web ${gameLabel(key)} RTP Updated</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `New RTP: <b>${rtp}%</b>\n\n` +
      `ပိုတင်းချင်ရင်: <code>${setCommandFor(key).replace('70', '60')}</code>\n` +
      `ပိုပေးချင်ရင်: <code>${setCommandFor(key).replace('70', '80')}</code>`,
    replyOptions(ctx)
  );
}

module.exports = (bot) => {
  bot.command(['app', 'web', 'miniapp'], async (ctx) => {
    const url = publicMiniAppUrl();

    if (!url || url === '/miniapp') {
      return replyHTML(
        ctx,
        '⚠️ Mini App URL မသတ်မှတ်ရသေးပါ။ Render မှာ <code>PUBLIC_URL</code> ကို သင့် service URL နဲ့ထည့်ပါ။',
        replyOptions(ctx)
      );
    }

    return replyHTML(
      ctx,
      '🎮 <b>Bika Game Mini App</b>\n' +
        '━━━━━━━━━━━━━━━━\n' +
        'Web ထဲမှာ Rocket / Slot / Blackjack / Shan Koe Mee / Plinko / Wheel / Mines ဆော့နိုင်ပါတယ်။\n\n' +
        'အောက်က button ကိုနှိပ်ပါ။',
      { ...replyOptions(ctx), reply_markup: appKeyboard(url) }
    );
  });

  bot.command(['webgamertp', 'webgamesrtp'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;

    const rtps = await getAllWebGameRtps();
    rtps.rocket = await getRocketRtp();
    const lines = ['rocket', 'blackjack', 'shan', 'plinko', 'wheel', 'mines']
      .map((key) => `• <b>${gameLabel(key)}</b>: <b>${rtps[key]}%</b>`)
      .join('\n');

    return replyHTML(
      ctx,
      `🎛 <b>Web Game RTP Control</b>\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `${lines}\n\n` +
        `Commands:\n` +
        `<code>/setrocketrtp 70</code>\n` +
        `<code>/setwebbjrtp 70</code>\n` +
        `<code>/setwebshanrtp 70</code>\n` +
        `<code>/setplinkortp 70</code>\n` +
        `<code>/setwheelrtp 70</code>\n` +
        `<code>/setwebminesrtp 70</code>\n\n` +
        `General: <code>/setwebgamertp plinko 70</code>`,
      replyOptions(ctx)
    );
  });

  bot.command(['rocketrtp', 'webcrashrtp'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;
    return showSingleRtp(ctx, 'rocket');
  });

  bot.command(['webbjrtp', 'webblackjackrtp', 'bjwebrtp'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;
    return showSingleRtp(ctx, 'blackjack');
  });

  bot.command(['webshanrtp', 'shankoemeertp', 'shanrtp'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;
    return showSingleRtp(ctx, 'shan');
  });

  bot.command(['plinkortp'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;
    return showSingleRtp(ctx, 'plinko');
  });

  bot.command(['wheelrtp', 'luckywheelrtp'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;
    return showSingleRtp(ctx, 'wheel');
  });

  bot.command(['webminesrtp', 'mineswebrtp'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;
    return showSingleRtp(ctx, 'mines');
  });

  bot.command(['setrocketrtp', 'setwebcrashrtp'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;
    return setSingleRtp(ctx, 'rocket', parsePercent(ctx.message?.text));
  });

  bot.command(['setwebbjrtp', 'setwebblackjackrtp', 'setbjwebrtp'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;
    return setSingleRtp(ctx, 'blackjack', parsePercent(ctx.message?.text));
  });

  bot.command(['setwebshanrtp', 'setshankoemeertp', 'setshanrtp'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;
    return setSingleRtp(ctx, 'shan', parsePercent(ctx.message?.text));
  });

  bot.command(['setplinkortp'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;
    return setSingleRtp(ctx, 'plinko', parsePercent(ctx.message?.text));
  });

  bot.command(['setwheelrtp', 'setluckywheelrtp'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;
    return setSingleRtp(ctx, 'wheel', parsePercent(ctx.message?.text));
  });

  bot.command(['setwebminesrtp', 'setmineswebrtp'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;
    return setSingleRtp(ctx, 'mines', parsePercent(ctx.message?.text));
  });

  bot.command(['setwebgamertp'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;
    const parsed = parseSetGameRtp(ctx.message?.text);
    if (!['rocket', 'blackjack', 'shan', 'plinko', 'wheel', 'mines'].includes(parsed.game)) {
      return replyHTML(
        ctx,
        `Usage: <code>/setwebgamertp plinko 70</code>\n` +
          `Games: rocket, blackjack, shan, plinko, wheel, mines`,
        replyOptions(ctx)
      );
    }

    return setSingleRtp(ctx, parsed.game, parsed.value);
  });

  bot.hears(/^\.(wbj|webbj|webblackjack)\b/i, async (ctx) => {
    const chatType = ctx.chat?.type;
    if (!['group', 'supergroup'].includes(chatType)) {
      return replyHTML(ctx, 'ℹ️ <code>.wbj</code> ကို group ထဲမှာပဲသုံးပါ။', replyOptions(ctx));
    }

    const baseUrl = publicMiniAppUrl();
    if (!baseUrl || baseUrl === '/miniapp') {
      return replyHTML(
        ctx,
        '⚠️ Mini App URL မသတ်မှတ်ရသေးပါ။ Render မှာ <code>PUBLIC_URL</code> ကို သင့် service URL နဲ့ထည့်ပါ။',
        replyOptions(ctx)
      );
    }

    const room = await createWebBlackjackRoom({
      chatId: ctx.chat?.id,
      title: ctx.chat?.title || 'Bika Blackjack Table',
      createdBy: ctx.from?.id || null,
    });
    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}game=blackjack&room=${encodeURIComponent(room.room.id)}`;

    return replyHTML(
      ctx,
      '🃏 <b>Web Blackjack Table is open!</b>\n' +
        '━━━━━━━━━━━━━━━━\n' +
        'Up to <b>5 players</b> can join this premium Blackjack table.\n' +
        'Only your own cards are visible. Other players cannot see your hand.\n' +
        'Dealer cards stay hidden until the dealer turn / final comparison.\n\n' +
        'Tap the button below to join the table.',
      {
        ...replyOptions(ctx),
        reply_markup: miniAppJoinKeyboard(ctx, url, '🃏 Join Web Blackjack', `wbj_${room.room.id}`),
      }
    );
  });


  bot.hears(/^\.(wshan|webshan|skm)\b/i, async (ctx) => {
    const baseUrl = publicMiniAppUrl();
    if (!baseUrl || baseUrl === '/miniapp') {
      return replyHTML(
        ctx,
        '⚠️ Mini App URL မသတ်မှတ်ရသေးပါ။ Render မှာ <code>PUBLIC_URL</code> ကို သင့် service URL နဲ့ထည့်ပါ။',
        replyOptions(ctx)
      );
    }

    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}game=shan`;
    return replyHTML(
      ctx,
      '🃏 <b>Web Shan Koe Mee is ready!</b>\n' +
        '━━━━━━━━━━━━━━━━\n' +
        'Play premium Shan Koe Mee in the Mini App.\n' +
        'You will receive 3 private cards and compare against the dealer.\n' +
        'Special hands and 9-point hands are ranked automatically.\n\n' +
        'Tap the button below to open the Shan table.',
      {
        ...replyOptions(ctx),
        reply_markup: miniAppJoinKeyboard(ctx, url, '🃏 Open Web Shan Koe Mee', 'shan'),
      }
    );
  });

};
