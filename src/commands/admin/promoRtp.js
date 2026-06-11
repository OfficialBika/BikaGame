// commands/admin/promoRtp.js

const {
  parseRtp,
  startPromoRtp,
} = require('../../services/promoRtpService');

const OWNER_IDS = String(process.env.OWNER_IDS || process.env.OWNER_ID || '')
  .split(',')
  .map((id) => Number(id.trim()))
  .filter(Boolean);

function isOwner(userId) {
  return OWNER_IDS.includes(Number(userId));
}

module.exports = function registerPromoRtpCommand(bot) {
  bot.command('promortp', async (ctx) => {
    try {
      if (!isOwner(ctx.from.id)) {
        return ctx.reply('❌ Owner only command ပါ။');
      }

      if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) {
        return ctx.reply('❌ ဒီ command ကို group ထဲမှာပဲ သုံးပါ။');
      }

      const parts = ctx.message.text.trim().split(/\s+/);

      const rtpInput = parts[1];
      const timeInput = parts[2];

      if (!rtpInput || !timeInput) {
        return ctx.reply(
`အသုံးပြုပုံမှားနေပါတယ်။

ဥပမာ:
/promortp 85% 10mins`
        );
      }

      const rtp = parseRtp(rtpInput);

      await startPromoRtp(ctx, rtp, timeInput, bot);
    } catch (err) {
      return ctx.reply(
`❌ Promo RTP မစနိုင်ပါ။

Reason: ${err.message}

ဥပမာ:
/promortp 85% 10mins`
      );
    }
  });
};
