const { chance } = require('../services/vipService');
const SLOT_DATA = { reels:[[ {s:'🍒',w:3200},{s:'🍋',w:2200},{s:'🍉',w:1500},{s:'🔔',w:900},{s:'⭐',w:450},{s:'BAR',w:200},{s:'7',w:100} ],[ {s:'🍒',w:3200},{s:'🍋',w:2200},{s:'🍉',w:1500},{s:'🔔',w:900},{s:'⭐',w:450},{s:'BAR',w:200},{s:'7',w:100} ],[ {s:'🍒',w:3200},{s:'🍋',w:2200},{s:'🍉',w:1500},{s:'🔔',w:900},{s:'⭐',w:450},{s:'BAR',w:200},{s:'7',w:100} ]], payouts:{'7,7,7':20,'BAR,BAR,BAR':15,'⭐,⭐,⭐':12,'🔔,🔔,🔔':9,'🍉,🍉,🍉':7,'🍋,🍋,🍋':5,'🍒,🍒,🍒':3,ANY2:1.5} };
function weightedPick(items){ let total=items.reduce((a,x)=>a+x.w,0), r=Math.random()*total; for(const it of items){ r-=it.w; if(r<=0)return it.s; } return items.at(-1).s; }
function normalSpin(){ return SLOT_DATA.reels.map(weightedPick); }
function vipSpin(rate=90){ if(Math.random()<chance(rate)){ const wins=Object.keys(SLOT_DATA.payouts).filter(k=>k!=='ANY2').map(k=>k.split(',')); return wins[Math.floor(Math.random()*wins.length)]; } return normalSpin(); }
function spin(user, rate=90){ return user?.isVip ? vipSpin(rate) : normalSpin(); }
function isAnyTwo(a,b,c){ return (a===b&&a!==c)||(a===c&&a!==b)||(b===c&&b!==a); }
function multiplier(reels){ const key=reels.join(','); if(SLOT_DATA.payouts[key]!=null)return SLOT_DATA.payouts[key]; return isAnyTwo(...reels)?SLOT_DATA.payouts.ANY2:0; }
function art(reels){ const box=x=>x==='BAR'?'BAR':x==='7'?'7️⃣':x; return `┏━━━━━━━━━━━━━━━━━━┓\n┃  ${box(reels[0])}  |  ${box(reels[1])}  |  ${box(reels[2])}  ┃\n┗━━━━━━━━━━━━━━━━━━┛`; }
module.exports = { SLOT_DATA, spin, multiplier, art };
