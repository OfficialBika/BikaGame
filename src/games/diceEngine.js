const { randInt } = require('../utils/helpers');
const { chance } = require('../services/vipService');
function roll(userA,userB,rate=90){ let d1=randInt(1,6), d2=randInt(1,6); const a=!!userA?.isVip,b=!!userB?.isVip; if(a&&!b&&Math.random()<chance(rate)){ d1=randInt(2,6); d2=randInt(1,d1-1); } else if(b&&!a&&Math.random()<chance(rate)){ d2=randInt(2,6); d1=randInt(1,d2-1); } return {d1,d2,winner:d1>d2?'A':d2>d1?'B':'TIE'}; }
module.exports = { roll };
