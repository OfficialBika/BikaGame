'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const schedulerPath = path.join(__dirname, 'sportsEventAutoStopService.js');

function loadScheduler({ dueResults = [], notifyResults = [] } = {}) {
  const calls = [];
  const timer = { unref() {}, cleared: false };
  let intervalCallback = null;
  let createIndexCalls = 0;

  const events = {
    async createIndex(...args) { createIndexCalls += 1; calls.push(['createIndex', ...args]); },
    async findOneAndUpdate(filter, update, options) {
      calls.push(['findOneAndUpdate', filter, update, options]);
      if (filter.status === 'open') return { value: dueResults.shift() || null };
      return { value: notifyResults.shift() || null };
    },
    async updateOne(...args) { calls.push(['updateOne', ...args]); return { matchedCount: 1 }; }
  };

  const fakeLogger = { logger: { info() {}, warn() {}, error() {} } };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (parent && parent.filename === schedulerPath && request === './sportsEventService') return { events: () => events };
    if (parent && parent.filename === schedulerPath && request === '../utils/logger') return fakeLogger;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[schedulerPath];
  const scheduler = require(schedulerPath);
  Module._load = originalLoad;

  return {
    scheduler, calls, timer,
    get createIndexCalls() { return createIndexCalls; },
    get intervalCallback() { return intervalCallback; },
    setInterval(fn, ms) { intervalCallback = fn; assert.equal(ms, 1000); return timer; }
  };
}

test('scheduler stops every due event with MongoDB server time and recovers on startup', async () => {
  const fixture = loadScheduler({ dueResults: [{ _id: 'event-1', status: 'stopped' }, null] });
  const originalSetInterval = global.setInterval;
  global.setInterval = (fn, ms) => fixture.setInterval(fn, ms);
  try {
    await fixture.scheduler.startSportsEventAutoStop({ telegram: { async sendMessage() {} } });
  } finally {
    global.setInterval = originalSetInterval;
  }

  assert.equal(fixture.createIndexCalls, 1);
  const stopCalls = fixture.calls.filter(call => call[0] === 'findOneAndUpdate' && call[1].status === 'open');
  assert.equal(stopCalls.length, 2);
  assert.deepEqual(stopCalls[0][1].$expr, { $lte: ['$kickoffAt', '$$NOW'] });
  assert.equal(stopCalls[0][2][0].$set.status, 'stopped');
  assert.equal(stopCalls[0][2][0].$set.stopReason, 'auto');
  assert.equal(stopCalls[0][2][0].$set.stoppedAt, '$$NOW');
  fixture.scheduler.stopSportsEventAutoStop();
});

test('scheduler does not stop events before their kickoff', async () => {
  const fixture = loadScheduler({ dueResults: [null] });
  await fixture.scheduler.startSportsEventAutoStop({ telegram: { async sendMessage() {} } });
  const stopCalls = fixture.calls.filter(call => call[0] === 'findOneAndUpdate' && call[1].status === 'open');
  assert.equal(stopCalls.length, 1);
  assert.equal(stopCalls[0][1].$expr.$lte[1], '$$NOW');
  fixture.scheduler.stopSportsEventAutoStop();
});

test('notification delivery records sent state on success', async () => {
  const event = { _id: 'event-2', status: 'stopped', stopReason: 'auto', commentChatId: '-1001', threadRootMessageId: 55, title: 'Team A Vs Team B', teams: [{ alias: 'a' }, { alias: 'draw' }, { alias: 'b' }] };
  const fixture = loadScheduler({ dueResults: [null], notifyResults: [event, null] });
  let messages = 0;
  await fixture.scheduler.startSportsEventAutoStop({ telegram: { async sendMessage(chatId, text, options) {
    messages += 1;
    assert.equal(chatId, '-1001');
    assert.match(text, /AUTO STOPBET/);
    assert.equal(options.reply_to_message_id, 55);
  } } });
  assert.equal(messages, 1);
  const sentUpdate = fixture.calls.find(call => call[0] === 'updateOne' && call[2].$set.autoStopNotificationStatus === 'sent');
  assert.ok(sentUpdate);
  fixture.scheduler.stopSportsEventAutoStop();
});

test('notification failure is returned to pending state for restart retry', async () => {
  const event = { _id: 'event-3', status: 'stopped', stopReason: 'auto', commentChatId: '-1002', threadRootMessageId: 56, title: 'Team C Vs Team D', teams: [{ alias: 'c' }, { alias: 'draw' }, { alias: 'd' }] };
  const fixture = loadScheduler({ dueResults: [null], notifyResults: [event, null] });
  await fixture.scheduler.startSportsEventAutoStop({ telegram: { async sendMessage() { throw new Error('Telegram unavailable'); } } });
  const retryUpdate = fixture.calls.find(call => call[0] === 'updateOne' && call[2].$set.autoStopNotificationStatus === 'pending');
  assert.ok(retryUpdate);
  assert.match(retryUpdate[2].$set.autoStopNotificationLastError, /Telegram unavailable/);
  fixture.scheduler.stopSportsEventAutoStop();
});
