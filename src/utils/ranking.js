const { toNum } = require('./format');
function getBalanceRank(balance){ const b=toNum(balance); if(b===0)return{title:'ဖင်ပြောင်ငမွဲ',badge:'🪫'}; if(b<=500)return{title:'အိမ်ခြေမဲ့ ဆင်းရဲသား',badge:'🥀'}; if(b<=1000)return{title:'အိမ်ပိုင်ဝန်းပိုင် ဆင်းရဲသား',badge:'🏚️'}; if(b<=5000)return{title:'လူလတ်တန်းစား',badge:'🏘️'}; if(b<=10000)return{title:'သူဌေးပေါက်စ',badge:'💼'}; if(b<=100000)return{title:'သိန်းကြွယ်သူဌေး',badge:'💰'}; if(b<=1000000)return{title:'သန်းကြွယ်သူဌေး',badge:'🏦'}; if(b<=50000000)return{title:'ကုဋေ၈၀ သူဌေးကြီး',badge:'👑'}; return{title:'ကမ္ဘာ့အချမ်းသာဆုံး လူသား',badge:'👑✨'}; }
function topBadge(i){ return i===0?'🥇👑':i===1?'🥈':i===2?'🥉':i<10?'🏅':'•'; }
module.exports = { getBalanceRank, topBadge };
