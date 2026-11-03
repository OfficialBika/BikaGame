'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const servicePath = path.join(__dirname, 'sportsEventService.js');

function loadSportsEventService() {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (parent && parent.filename === servicePath && request === '../config/database') {
      return { col() { throw new Error('not used in parser tests'); }, withRequiredTx() { throw new Error('not used in parser tests'); } };
    }
    if (parent && parent.filename === servicePath && request === '../models/treasuryModel') return {};
    if (parent && parent.filename === servicePath && request === './economyService') return {};
    if (parent && parent.filename === servicePath && request === './transactionService') return {};
    if (parent && parent.filename === servicePath && request === '../config/env') return { env: { TZ: 'Asia/Yangon', OWNER_ID: 1 } };
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[servicePath];
  try {
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
  }
}

const service = loadSportsEventService();

test('legacy two-way setup remains supported without an automatic cutoff', () => {
  const parsed = service.parseSetEvent('/setevent Arsenal Vs Liverpool\n1.5× | 2.5×\nars | liv');
  assert.ok(parsed);
  assert.equal(parsed.kickoffAt, null);
  assert.deepEqual(parsed.teams.map((team) => team.alias), ['ars', 'liv']);
});

test('three-way setup maps odds and aliases to home, draw, away', () => {
  const parsed = service.parseSetEvent('/setevent Arsenal Vs Liverpool\n1.5× | 3× | 2.5×\nars | draw | liv\n01/01/2099 02:20 AM');
  assert.ok(parsed);
  assert.equal(parsed.teams.length, 3);
  assert.deepEqual(parsed.teams.map((team) => [team.alias, team.name, team.odd]), [
    ['ars', 'Arsenal', 1.5],
    ['draw', 'သရေ', 3],
    ['liv', 'Liverpool', 2.5]
  ]);
  const displayed = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h12'
  }).format(parsed.kickoffAt);
  assert.match(displayed, /01\/01\/2099/);
  assert.match(displayed, /02:20/);
});

test('two-way setup with kickoff retains automatic-stop support', () => {
  const parsed = service.parseSetEvent('/setevent Team A Vs Team B\n1.8× | 2.1×\na | b\n01/01/2099 02:20 AM');
  assert.ok(parsed);
  assert.ok(parsed.kickoffAt instanceof Date);
  assert.equal(parsed.teams.length, 2);
});

test('rejects an invalid draw position or invalid odds', () => {
  assert.equal(service.parseSetEvent('/setevent Arsenal Vs Liverpool\n1.5× | 3× | 2.5×\nars | liv | draw\n01/01/2099 02:20 AM'), null);
  assert.equal(service.parseSetEvent('/setevent Arsenal Vs Liverpool\n1.5× | 1× | 2.5×\nars | draw | liv\n01/01/2099 02:20 AM'), null);
});

test('rejects invalid calendar dates and past kickoff times', () => {
  assert.equal(service.parseSetEvent('/setevent Arsenal Vs Liverpool\n1.5× | 3× | 2.5×\nars | draw | liv\n31/02/2099 02:20 AM'), null);
  assert.equal(service.parseSetEvent('/setevent Arsenal Vs Liverpool\n1.5× | 3× | 2.5×\nars | draw | liv\n01/01/2000 02:20 AM'), null);
});
