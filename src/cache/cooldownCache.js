const map = new Map();
function check(key, ms){ const now=Date.now(); const until=map.get(key)||0; if(until>now) return Math.ceil((until-now)/1000); map.set(key, now+ms); return 0; }
function clear(key){ map.delete(key); }
module.exports = { check, clear };
