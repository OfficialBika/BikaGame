const { DICE, SHAN, RPS } = require('../config/constants');
const activeDice = new Map(); const activeShan = new Map(); const activeRps = new Map();
function makeId(chatId,msgId){ return `${chatId}:${msgId}`; }
function canOpenDice(){ return activeDice.size < DICE.maxActive; }
function canOpenShan(){ return activeShan.size < SHAN.maxActive; }
function canOpenRps(){ return activeRps.size < RPS.maxActive; }
function setDice(id,c){ activeDice.set(id,c); } function getDice(id){ return activeDice.get(id); } function delDice(id){ const c=activeDice.get(id); if(c?.timeoutHandle) clearTimeout(c.timeoutHandle); activeDice.delete(id); }
function setShan(id,c){ activeShan.set(id,c); } function getShan(id){ return activeShan.get(id); } function delShan(id){ const c=activeShan.get(id); if(c?.timeoutHandle) clearTimeout(c.timeoutHandle); activeShan.delete(id); }
function setRps(id,c){ activeRps.set(id,c); } function getRps(id){ return activeRps.get(id); } function delRps(id){ const c=activeRps.get(id); if(c?.timeoutHandle) clearTimeout(c.timeoutHandle); activeRps.delete(id); }
module.exports = { makeId, canOpenDice, canOpenShan, canOpenRps, setDice, getDice, delDice, setShan, getShan, delShan, setRps, getRps, delRps, activeDice, activeShan, activeRps };
