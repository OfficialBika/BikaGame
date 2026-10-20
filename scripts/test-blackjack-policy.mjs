import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  BLACKJACK_RULES,
  normalizeBlackjackRoom,
  clampBlackjackRtp,
  cardValue,
  isNaturalBlackjack,
  resultForBlackjack,
  blackjackPayout,
  createBlackjackDeck,
  chooseBlackjackTargetResult,
  buildBlackjackSettlementPlan,
} from '../tgcloud/lib/blackjackPolicy.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(BLACKJACK_RULES.minBet, 50);
assert.equal(BLACKJACK_RULES.maxBet, 300000);
assert.equal(BLACKJACK_RULES.cooldownMs, 1500);
assert.equal(BLACKJACK_RULES.actionTimeoutMs, 90000);
assert.equal(BLACKJACK_RULES.defaultRtp, (() => { const raw = process.env.BLACKJACK_DEFAULT_RTP; if (raw == null || String(raw).trim() === '') return 50; const parsed = Number(raw); return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 50; })());
assert.equal(clampBlackjackRtp(130), 100);
assert.equal(clampBlackjackRtp(-2), 0);
assert.equal(clampBlackjackRtp('not-a-rate'), 50);
assert.equal(cardValue([{ r: 'A' }, { r: 'K' }]), 21);
assert.equal(cardValue([{ r: 'A' }, { r: '9' }, { r: '7' }]), 17);
assert.equal(cardValue([{ r: 'A' }, { r: 'A' }, { r: '9' }]), 21);
assert.equal(isNaturalBlackjack([{ r: 'A' }, { r: 'K' }]), true);
assert.equal(isNaturalBlackjack([{ r: 'A' }, { r: 'K' }, { r: '2' }]), false);
assert.equal(resultForBlackjack([{ r: 'A' }, { r: 'K' }], [{ r: '9' }, { r: '7' }]), 'BLACKJACK');
assert.equal(resultForBlackjack([{ r: 'A' }, { r: 'K' }], [{ r: 'A' }, { r: 'Q' }]), 'PUSH');
assert.equal(resultForBlackjack([{ r: '10' }, { r: '8' }], [{ r: '10' }, { r: '9' }]), 'LOSE');
assert.equal(resultForBlackjack([{ r: '10' }, { r: '9' }], [{ r: '10' }, { r: '8' }]), 'WIN');
assert.equal(resultForBlackjack([{ r: '10' }, { r: '8' }], [{ r: '10' }, { r: '8' }]), 'PUSH');
assert.equal(blackjackPayout('BLACKJACK', 100), 250);
assert.equal(blackjackPayout('WIN', 100), 200);
assert.equal(blackjackPayout('PUSH', 100), 100);
assert.equal(blackjackPayout('LOSE', 100), 0);
assert.equal(createBlackjackDeck(() => 0).length, 52);
assert.equal(new Set(createBlackjackDeck(() => 0).map((c) => c.r + c.s)).size, 52);
assert.equal(normalizeBlackjackRoom('solo'), 'solo');
assert.equal(normalizeBlackjackRoom('bj:room-1'), 'room-1');
assert.throws(() => normalizeBlackjackRoom('room with spaces'), /BJ_ROOM_INVALID/);
assert.throws(() => blackjackPayout('WIN', 1), /BJ_BET_INVALID/);

assert.equal(chooseBlackjackTargetResult([{r:'A'},{r:'K'}], [{r:'9'},{r:'7'}], 'BLACKJACK', 0, () => 0.99), 'BLACKJACK');
assert.equal(chooseBlackjackTargetResult([{r:'10'},{r:'9'}], [{r:'10'},{r:'8'}], 'WIN', 100, () => 0), 'WIN');
assert.equal(chooseBlackjackTargetResult([{r:'10'},{r:'8'}], [{r:'10'},{r:'9'}], 'LOSE', 0, () => 0.99), 'LOSE');
const savedPlan = buildBlackjackSettlementPlan([{id:7,bet:100,cards:[{r:'A'},{r:'K'}]}],[{r:'9'},{r:'7'}],'actions_complete',50,()=>0);
assert.equal(savedPlan[0].result, 'BLACKJACK');
assert.equal(savedPlan[0].payout, 250);
const timeoutPlan = buildBlackjackSettlementPlan([{id:7,bet:100,cards:[{r:'10'},{r:'8'}]}],[{r:'A'},{r:'Q'}],'timeout');
assert.equal(timeoutPlan[0].result, 'REFUND');
assert.equal(timeoutPlan[0].payout, 100);

const gameSource = await readFile(resolve(root, 'tgcloud/lib/game.js'), 'utf8');
const messageSource = await readFile(resolve(root, 'tgcloud/handlers/message.js'), 'utf8');
const callbackSource = await readFile(resolve(root, 'tgcloud/handlers/callback_query.js'), 'utf8');
const miniSource = await readFile(resolve(root, 'tgcloud/lib/mini.js'), 'utf8');

assert.ok(gameSource.includes("getSetting('blackjack_rtp', BLACKJACK_RULES.defaultRtp)"));
assert.ok(gameSource.includes('BLACKJACK_RULES.actionTimeoutMs'));
assert.ok(gameSource.includes("'bj-refund:' + keyBase"));
assert.ok(gameSource.includes("'bj-payout:' + keyBase"));
assert.ok(gameSource.includes("updateBlackjackSession(session, nextState, 'settling')"));
assert.ok(gameSource.includes('eq(gameSessions.version, version)'), 'Blackjack session updates must use optimistic version guards');
assert.ok(messageSource.includes("await assertGameEnabled('blackjack')"));
assert.ok(callbackSource.includes("await assertGameEnabled('blackjack')"));
assert.ok(miniSource.includes("await assertGameEnabled('blackjack')"));

console.log('Blackjack policy tests passed (main bet/cooldown/timeout/natural payout, soft aces, result parity, room validation, durable settlement and handler wiring).');
