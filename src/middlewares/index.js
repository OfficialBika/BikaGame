'use strict';

const { parsePayload } = require('../services/starsBalanceService');
const logger = require('../utils/logger');

function registerPreCheckoutHandler(bot) {
  // Register before maintenance/user/group middleware. Telegram requires an
  // answer within 10 seconds, so this path must never wait for MongoDB checks.
  bot.on('pre_checkout_query', async (ctx) => {
    const query = ctx.update.pre_checkout_query;
    const parsed = parsePayload(query.invoice_payload);
    const amount = Number(query.total_amount);
    const valid = Boolean(
      parsed
      && String(parsed.userId) === String(ctx.from?.id)
      && query.currency === 'XTR'
      && Number.isSafeInteger(amount)
      && amount === parsed.stars
      && amount > 0
    );

    try {
      if (valid) {
        await ctx.answerPreCheckoutQuery(true);
        logger.info(`Stars pre-checkout accepted: user=${ctx.from.id}, stars=${parsed.stars}`);
      } else {
        await ctx.answerPreCheckoutQuery(false, 'Invalid or expired Bal purchase. Please start again.');
        logger.warn(`Stars pre-checkout rejected: user=${ctx.from?.id || 'unknown'}, reason=payload_or_amount_mismatch`);
      }
    } catch (err) {
      logger.error('Stars pre-checkout response failed', err);
      throw err;
    }
  });
}

module.exports = (bot) => {
  // Payment confirmation is deliberately registered first to avoid DB latency.
  registerPreCheckoutHandler(bot);

  // Direct numeric RTP aliases run before the general maintenance gate.
  // They only consume /rtp <number> and /bjrtp <number>; all other commands
  // continue through the existing middleware chain unchanged.
  bot.use(require('./rtpCommands'));

  // Maintenance gate runs first so blocked non-owner commands do not trigger
  // user/group DB checks or other downstream middleware.
  bot.use(require('./maintenance'));
  bot.use(require('./userCheck'));
  bot.use(require('./groupApproval'));
  bot.use(require('./twoDModeration'));
};
