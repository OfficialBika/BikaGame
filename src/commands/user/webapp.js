'use strict';

const { publicMiniAppUrl } = require('../../web/miniAppRoutes');
const { replyHTML } = require('../../utils/telegram');

function appKeyboard(url) {
  return {
    inline_keyboard: [
      [{ text: '🎮 Open Bika Game App', web_app: { url } }],
    ],
  };
}

module.exports = (bot) => {
  bot.command(['app', 'web', 'miniapp'], async (ctx) => {
    const url = publicMiniAppUrl();

    if (!url || url === '/miniapp') {
      return replyHTML(
        ctx,
        '⚠️ Mini App URL မသတ်မှတ်ရသေးပါ။ Render မှာ <code>PUBLIC_URL</code> ကို သင့် service URL နဲ့ထည့်ပါ။'
      );
    }

    return replyHTML(
      ctx,
      '🎮 <b>Bika Game Mini App</b>\n' +
        '━━━━━━━━━━━━━━━━\n' +
        'Web ထဲမှာ Slot / Crash ဆော့နိုင်ပါတယ်။\n\n' +
        'အောက်က button ကိုနှိပ်ပါ။',
      { reply_markup: appKeyboard(url) }
    );
  });
};
