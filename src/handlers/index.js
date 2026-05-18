module.exports = (bot)=>{ require('./memberHandler')(bot); require('./callbackHandler')(bot); require('./messageHandler')(bot); require('./errorHandler')(bot); };
