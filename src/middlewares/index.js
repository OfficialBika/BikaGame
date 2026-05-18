module.exports = (bot) => {
  bot.use(require('./userCheck'));
  bot.use(require('./maintenance'));
  bot.use(require('./groupApproval'));
};
