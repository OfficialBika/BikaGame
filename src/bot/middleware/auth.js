function onlyOwner(ownerId) {
  return (ctx, next) => {
    if (ctx.from?.id !== ownerId) {
      return ctx.reply('You are not authorized to use this command.');
    }
    return next();
  };
}

module.exports = { onlyOwner };
