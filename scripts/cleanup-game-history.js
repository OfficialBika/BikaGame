'use strict';

require('dotenv').config();
const { connectMongo, closeMongo } = require('../src/config/database');
const { env } = require('../src/config/env');
const retention = require('../src/services/gameHistoryRetentionService');

(async () => {
  try {
    if (!env.DB_TWO_ENABLED) throw new Error('Refusing cleanup: DB_TWO_ENABLED=true is required.');
    await connectMongo();
    if (!retention || typeof retention.ensureIndexes !== 'function' || typeof retention.cleanupExpiredGameHistory !== 'function') {
      throw new Error('Game history retention service is unavailable.');
    }
    await retention.ensureIndexes();
    const report = await retention.cleanupExpiredGameHistory();
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error('GAME_HISTORY_CLEANUP_FAILED:', err?.stack || err);
    process.exitCode = 1;
  } finally {
    await closeMongo().catch(() => {});
  }
})();
