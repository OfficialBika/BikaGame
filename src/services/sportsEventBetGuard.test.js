'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const servicePath = path.join(__dirname, 'sportsEventService.js');

function loadService({ eventMatchedCount = 1 } = {}) {
  const calls = [];
  const eventsCollection = {
    async updateOne(filter, update, options) {
      calls.push(['event.updateOne', filter, update, options]);
      return { matchedCount: eventMatchedCount };
    }
  };
  const betsCollection = {
    async findOne(filter, options) {
      calls.push(['bet.findOne', filter, options]);
      return null;
    },
    async insertOne(document, options) {
      calls.push(['bet.insertOne', document, options]);
      return { insertedId: 'bet-1' };
    }
  };
  const usersCollection = {
    async findOneAndUpdate(filter, update, options) {
      calls.push(['user.findOneAndUpdate', filter, update, options]);
      return { userId: 42, balance: 80000 };
    }
  };
  const treasuryCollection = {
    async findOneAndUpdate(filter, update, options) {
      calls.push(['treasury.findOneAndUpdate', filter, update, options]);
      return { key: 'treasury', ownerBalance: 20000 };
    }
  };

  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (parent && parent.filename === servicePath && request === '../config/database') {
      return {
        col(name) {
          if (name === 'sports_events') return eventsCollection;
          if (name === 'sports_bets') return betsCollection;
          if (name === 'users') return usersCollection;
          throw new Error('Unexpected collection in test: ' + name);
        },
        async withRequiredTx(work) {
          calls.push(['tx.start']);
          const result = await work({ id: 'test-session' });
          calls.push(['tx.commit']);
          return result;
        }
      };
    }
    if (parent && parent.filename === servicePath && request === '../models/treasuryModel') {
      return { collection: () => treasuryCollection };
    }
    if (parent && parent.filename === servicePath && request === './economyService') {
      return { async ensureUser() { calls.push(['ensureUser']); } };
    }
    if (parent && parent.filename === servicePath && request === './transactionService') {
      return { async logTx(document, options) { calls.push(['transaction.logTx', document, options]); } };
    }
    if (parent && parent.filename === servicePath && request === '../config/env') {
      return { env: { TZ: 'Asia/Yangon', OWNER_ID: 1 } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[servicePath];
  try {
    return { service: require(servicePath), calls };
  } finally {
    Module._load = originalLoad;
  }
}

function context() {
  return {
    from: { id: 42, username: 'draw_player', first_name: 'Draw', last_name: 'Player' }
  };
}

test('kickoff cutoff rejection happens before any balance or treasury mutation', async () => {
  const { service, calls } = loadService({ eventMatchedCount: 0 });
  const event = {
    _id: 'event-after-kickoff',
    status: 'open', // stale event snapshot from the comment handler
    teams: [{ name: 'သရေ', alias: 'draw', odd: 3 }]
  };

  await assert.rejects(
    service.placeBet(event, context(), 'draw', 20000),
    (error) => error.message === 'BET_CLOSED'
  );

  const eventWrite = calls.find(call => call[0] === 'event.updateOne');
  assert.ok(eventWrite);
  assert.equal(eventWrite[1].status, 'open');
  assert.deepEqual(eventWrite[1].$or[1].$expr, { $gt: ['$kickoffAt', '$$NOW'] });
  assert.deepEqual(eventWrite[2].$inc, { totalBet: 1, totalBetBal: 20000 });
  assert.equal(calls.some(call => call[0] === 'user.findOneAndUpdate'), false);
  assert.equal(calls.some(call => call[0] === 'treasury.findOneAndUpdate'), false);
  assert.equal(calls.some(call => call[0] === 'bet.insertOne'), false);
  assert.equal(calls.some(call => call[0] === 'transaction.logTx'), false);
});

test('draw bet uses its own odds and commits inside the existing required transaction', async () => {
  const { service, calls } = loadService({ eventMatchedCount: 1 });
  const event = {
    _id: 'event-draw',
    status: 'open',
    teams: [{ name: 'သရေ', alias: 'draw', odd: 3 }]
  };

  const bet = await service.placeBet(event, context(), 'draw', 20000);

  assert.equal(bet.alias, 'draw');
  assert.equal(bet.teamName, 'သရေ');
  assert.equal(bet.odd, 3);
  assert.equal(bet.amount, 20000);
  assert.equal(bet.potentialWin, 60000);

  const eventIndex = calls.findIndex(call => call[0] === 'event.updateOne');
  const userIndex = calls.findIndex(call => call[0] === 'user.findOneAndUpdate');
  const treasuryIndex = calls.findIndex(call => call[0] === 'treasury.findOneAndUpdate');
  const betIndex = calls.findIndex(call => call[0] === 'bet.insertOne');
  const ledgerIndex = calls.findIndex(call => call[0] === 'transaction.logTx');
  assert.ok(eventIndex >= 0 && eventIndex < userIndex);
  assert.ok(userIndex < treasuryIndex);
  assert.ok(treasuryIndex < betIndex);
  assert.ok(betIndex < ledgerIndex);
  assert.equal(calls.at(-1)[0], 'tx.commit');
});

test('legacy two-way events without kickoff remain eligible for manual betting', async () => {
  const { service, calls } = loadService({ eventMatchedCount: 1 });
  const event = {
    _id: 'legacy-event',
    status: 'open',
    teams: [{ name: 'Team A', alias: 'a', odd: 2 }, { name: 'Team B', alias: 'b', odd: 2 }]
  };

  await service.placeBet(event, context(), 'a', 1000);
  const eventWrite = calls.find(call => call[0] === 'event.updateOne');
  assert.deepEqual(eventWrite[1].$or[0], { kickoffAt: { $exists: false } });
});
