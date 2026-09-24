function parse2dCommand(text) {
  const m = String(text || '').trim().match(/^\.2d\s+(.+?)\s+(\d[\d,]*)$/i);
  if (!m) return { error: 'ပုံစံမှားနေပါတယ်။ ဥပမာ .2d 00.33.66 5000' };
  const amount = Number(m[2].replaceAll(',', ''));
  if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_PER_NUMBER) return { error: 'တစ်ကြိမ်ထိုးကြေးကို ' + fmt(MIN_BET) + ' မှ ' + fmt(MAX_PER_NUMBER) + ' အတွင်းထားပါ။' };
  const map = new Map();
  const display = [];
  const tokens = m[1].split(/[.\s,]+/).filter(Boolean);
  for (const raw of tokens) {
    const token = raw.toUpperCase(); let nums = [];
    if (/^\d{2}$/.test(token)) nums = [token];
    else if (/^\d{2}R$/.test(token)) { const n = token.slice(0, 2), r = n[1] + n[0]; nums = r === n ? [n] : [n, r]; }
    else return { error: '<code>' + escHtml(raw) + '</code> က 00-99 သို့မဟုတ် 00R ပုံစံမဟုတ်ပါ။' };
    display.push({ label: token, amount: amount, multiplier: nums.length });
    nums.forEach(function (n) { map.set(n, (map.get(n) || 0) + amount); });
  }
  const lines = Array.from(map, function (x) { return { number: x[0], amount: x[1] }; });
  if (!lines.length) return { error: 'ထိုးမည့်ဂဏန်းမတွေ့ပါ။' };
  return { lines: lines, display: display, total: lines.reduce(function (s, x) { return s + x.amount; }, 0) };
}
function owner(ctx) { return Number(ctx.from && ctx.from.id) === Number(env.OWNER_ID); }
function weekend(key) { const a = key.split('-').map(Number); const d = new Date(Date.UTC(a[0], a[1] - 1, a[2])).getUTCDay(); return d === 0 || d === 6; }
async function offDate(key) { return !!(await offdates().findOne({ dateKey: key })); }
async function getEvent(id) { return events().findOne({ eventId: id }); }
async function openEvent() { return events().findOne({ channelId: env.TWO_D_CHANNEL_ID, status: 'open', closeAt: { $gt: new Date() } }, { sort: { openAt: -1 } }); }
async function pendingResult() {
  return events().findOne({ channelId: env.TWO_D_CHANNEL_ID, status: { $in: ['closed', 'settling'] }, resultAt: null, closeAt: { $lte: new Date() } }, { sort: { closeAt: -1 } });
}
async function discussionId(bot) {
  if (!env.TWO_D_CHANNEL_ID) return null;
  try {
    const c = await safeTelegram(function () { return bot.telegram.getChat(env.TWO_D_CHANNEL_ID); });
    if (c && c.linked_chat_id) {
      const linked = String(c.linked_chat_id);
      if (env.TWO_D_DISCUSSION_CHAT_ID && String(env.TWO_D_DISCUSSION_CHAT_ID) !== linked) {
        logger.warn('2D discussion env ID does not match channel linked_chat_id; using the actual linked discussion chat.');
      }
      return linked;
    }
  } catch (err) {
    logger.warn('2D channel linked_chat_id lookup failed: ' + (err && err.message ? err.message : err));
  }
  return env.TWO_D_DISCUSSION_CHAT_ID ? String(env.TWO_D_DISCUSSION_CHAT_ID) : null;
}
async function sendDiscussionReply(bot, discussionChatId, channelMessageId, text, rootMessageId) {
  if (!discussionChatId || !channelMessageId) throw new Error('DISCUSSION_REPLY_TARGET_MISSING');
  let lastError = null;

  const send = function (params) {
    if (bot.telegram && typeof bot.telegram.callApi === 'function') {
      return bot.telegram.callApi('sendMessage', params);
    }
    return bot.telegram.sendMessage(params.chat_id, params.text, {
      parse_mode: params.parse_mode,
      disable_web_page_preview: params.disable_web_page_preview,
      reply_parameters: params.reply_parameters,
    });
  };

  // PRIMARY: reply inside the linked discussion group using the actual
  // automatically-forwarded root message captured from Telegram.
  // This is what makes the message appear under the channel post's Comments.
  if (rootMessageId) {
    try {
      return await send({
        chat_id: String(discussionChatId),
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_parameters: {
          message_id: Number(rootMessageId),
          allow_sending_without_reply: false,
        },
      });
    } catch (err) {
      lastError = err;
      logger.warn('2D local discussion-root reply failed: ' + (err && err.message ? err.message : err));
    }
  }

  // SECONDARY: official cross-chat ReplyParameters route. This is used only
  // when Telegram has not exposed/captured the discussion root yet.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      if (attempt) await new Promise(function (resolve) { setTimeout(resolve, attempt * 1200); });
      return await send({
        chat_id: String(discussionChatId),
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_parameters: {
          message_id: Number(channelMessageId),
          chat_id: String(env.TWO_D_CHANNEL_ID),
          allow_sending_without_reply: false,
        },
      });
    } catch (err) {
      lastError = err;
      logger.warn('2D cross-chat discussion reply attempt ' + (attempt + 1) + '/4 failed: ' + (err && err.message ? err.message : err));
    }
  }

  throw lastError || new Error('DISCUSSION_REPLY_FAILED');
}
function openText(e, useCustom) {
  const test = e.manual ? '\n\n⚠️ <b>Owner စမ်းသပ်တဲ့ Post ပါ</b>\nကြေးအများကြီး မထိုးကြပါနဲ့။ အစစ်မဟုတ်ပါ။' : '';
  return emoji('BET', '🎯', useCustom) + ' <b>BIKA 2D ထိုးကြေးဖွင့်ပါပြီရှင့်</b>\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    emoji('DATE', '📅', useCustom) + ' <b>' + escHtml(dateTime(e.openAt)) + '</b>\n\n' +
    emoji('TIME', '⏳', useCustom) + ' <b>' + escHtml(displayTime(e.closeAt)) + '</b> မှာ ထိုးကြေးပိတ်ပါမယ်\n\n' +
    emoji('MONEY', '💰', useCustom) + ' ပေါက်ကြေး <b>' + PAYOUT + ' ဆ</b>\n' +
    emoji('TICKET', '🎟️', useCustom) + ' ထိုးကြေးကန့်သတ်ချက် <b>' + fmt(MIN_BET) + ' → ' + fmt(MAX_PER_NUMBER) + '</b>\n\n' +
    emoji('USERS', '👥', useCustom) + ' <b>Bika Game Bot ရဲ့ player အပေါင်းတို့က</b>\n\n' +
    'ယခု Post ရဲ့ Comments မှာ\nအောက်ကလို လောင်းကြေးတင်နိုင်ပါပြီ\n\n' +
    '👉 <code>.2d 00.33.66 5000</code>\n' +
    '👉 <code>.2d 45R 5000</code>\n\n' + emoji('LUCKY', '🍀', useCustom) + ' <b>ကံကောင်းပါစေရှင့်</b> ' + emoji('LUCKY', '🍀', useCustom) + test;
}
function closeText(e, useCustom) {
  return emoji('LOCK', '🔒', useCustom) + ' <b>Bet ပိတ်လိုက်ပါပြီရှင့်</b>\n━━━━━━━━━━━━━━━━━━\n' +
    emoji('DATE', '📅', useCustom) + ' ' + escHtml(dateTime(e.closeAt)) + '\n\n' +
    emoji('WAIT', '🎯', useCustom) + ' ပေါက်ဂဏန်းထွက်ရန် အချိန်ကို စောင့်နေပါသည်။\n\n' +
    emoji('LUCKY', '🍀', useCustom) + ' အားလုံး ကံကောင်းကြပါစေရှင့် ' + emoji('LUCKY', '🍀', useCustom);
}
function resultText(e, useCustom) {
  return emoji('WIN', '🏆', useCustom) + ' <b>BIKA 2D ပေါက်ဂဏန်းထွက်ပါပြီ</b>\n━━━━━━━━━━━━━━━━━━\n' +
    emoji('DATE', '📅', useCustom) + ' <b>' + escHtml(dateTime(e.resultAt)) + '</b>\n\n' +
    emoji('NUMBER', '🎯', useCustom) + ' ပေါက်ဂဏန်း <b>' + e.winningNumber + '</b>\n\n' +
    emoji('COMMENT', '🎉', useCustom) + ' ကံထူးရှင်များစာရင်းကို Comment မှာ ဝင်ကြည့်နိုင်ပါတယ်ရှင့်\n\n' +
    emoji('LUCKY', '🍀', useCustom) + ' ကံထူးရှင်အားလုံး ဂုဏ်ယူပါတယ် ' + emoji('LUCKY', '🍀', useCustom);
}
async function createEvent(id, key, open, close, manual) {
  const doc = { eventId: id, dateKey: key, openAt: yangonDateAt(key, open), closeAt: yangonDateAt(key, close), status: 'scheduled', manual: !!manual, channelId: env.TWO_D_CHANNEL_ID, discussionChatId: null, discussionRootMessageId: null, resultDiscussionRootMessageId: null, openMessageId: null, closeMessageId: null, resultMessageId: null, winningNumber: null, resultAt: null, createdAt: new Date(), updatedAt: new Date() };
  try { await events().insertOne(doc); return doc; } catch (e) { if (e && e.code === 11000) return getEvent(id); throw e; }
}
async function publishOpen(bot, e) {
  const d = await discussionId(bot);
  let sent;
  try {
    sent = await safeTelegram(function () {
      return bot.telegram.sendMessage(env.TWO_D_CHANNEL_ID, openText(e, false), { parse_mode: 'HTML', disable_web_page_preview: true });
    });
  } catch (err) {
    if (!VALID_CUSTOM_EMOJI_IDS.size) throw err;