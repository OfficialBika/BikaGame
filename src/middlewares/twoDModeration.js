'use strict';

const twoD = require('../services/twoDService');
const logger = require('../utils/logger');

module.exports = async function (ctx, next) {
  try {
    const handled = await twoD.handleComment(ctx, {
      telegram: ctx.telegram,
    });
    if (handled) return;
  } catch (err) {
    logger.error('2D betting moderation error', err);
  }
  return next();
};
