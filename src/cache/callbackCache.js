const locks = new Set();
async function withLock(key, fn){ if(locks.has(key)) return false; locks.add(key); try{ await fn(); return true; } finally { locks.delete(key); } }
module.exports = { withLock };
