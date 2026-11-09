'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const game = require('./gameService');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('deleting an RPS match removes only its state and cancels its timeout', async (t) => {
  const rpsId = 'rps-cleanup-test';
  const diceId = 'dice-preserved-by-rps-cleanup-test';
  const shanId = 'shan-preserved-by-rps-cleanup-test';
  let timeoutFired = false;

  const timeoutHandle = setTimeout(() => {
    timeoutFired = true;
  }, 30);

  game.setRps(rpsId, { status: 'SETTLED', timeoutHandle });
  game.setDice(diceId, { status: 'OPEN' });
  game.setShan(shanId, { status: 'OPEN' });

  t.after(() => {
    game.delRps(rpsId);
    game.delDice(diceId);
    game.delShan(shanId);
  });

  game.delRps(rpsId);

  assert.equal(game.getRps(rpsId), undefined);
  assert.ok(game.getDice(diceId), 'RPS cleanup must not remove Dice state');
  assert.ok(game.getShan(shanId), 'RPS cleanup must not remove Shan state');

  await delay(50);
  assert.equal(timeoutFired, false, 'RPS cleanup must cancel its pending timeout');
});

test('RPS capacity is released after a match is deleted', (t) => {
  const ids = Array.from({ length: 5 }, (_, index) => `rps-capacity-test-${index}`);

  t.after(() => {
    for (const id of ids) game.delRps(id);
  });

  for (const id of ids) game.setRps(id, { status: 'OPEN' });
  assert.equal(game.canOpenRps(), false);

  game.delRps(ids[0]);
  assert.equal(game.canOpenRps(), true);
});
