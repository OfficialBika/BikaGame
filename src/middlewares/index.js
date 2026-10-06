module.exports = (bot) => {
  // Maintenance gate runs first so blocked non-owner commands do not trigger
  // user/group DB checks or other downstream middleware.
  bot.use(require('./maintenance'));
  bot.use(require('./userCheck'));
  bot.use(require('./groupApproval'));
  bot.use(require('./twoDModeration'));
};
