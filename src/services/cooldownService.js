const cache = require('../cache/cooldownCache');
function checkCooldown(key, seconds){ return cache.check(key, seconds*1000); }
module.exports = { checkCooldown };
