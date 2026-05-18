const { DICE, SHAN } = require('../config/constants');
const activeDice = new Map(); const activeShan = new Map();
function makeId(chatId,msgId){ return `${chatId}:${msgId}`; }
function canOpenDice(){ return activeDice.size < DICE.maxActive; }
function canOpenShan(){ return activeShan.size < SHAN.maxActive; }
function setDice(id,c){ activeDice.set(id,c); } function getDice(id){ return activeDice.get(id); } function delDice(id){ const c=activeDice.get(id); if(c?.timeoutHandle) clearTimeout(c.timeoutHandle); activeDice.delete(id); }
function setShan(id,c){ activeShan.set(id,c); } function getShan(id){ return activeShan.get(id); } function delShan(id){ const c=activeShan.get(id); if(c?.timeoutHandle) clearTimeout(c.timeoutHandle); activeShan.delete(id); }
module.exports = { makeId, canOpenDice, canOpenShan, setDice, getDice, delDice, setShan, getShan, delShan, activeDice, activeShan };
