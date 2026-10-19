import assert from 'node:assert/strict';
import { buildDuelSettlementRow } from '../tgcloud/lib/duelSettlementPlan.js';

const bet = 100;
const fullPotPayout = Math.floor(bet * 2 * 0.98);
const base = {
  settlementId: 'dice-test-1',
  typePrefix: 'dice',
  challengerId: 101,
  targetUserId: 202,
  bet,
  payout: fullPotPayout,
  meta: { result: { d1: 6, d2: 2, winner: 'A' } },
};

const challengerWins = buildDuelSettlementRow({ ...base, winnerUserId: 101 });
assert.equal(challengerWins.accountUserId, 101);
assert.equal(challengerWins.balanceDelta, -bet);
assert.equal(challengerWins.requiredBalance, bet);
assert.equal(challengerWins.fromAccountUserId, 202);
assert.equal(challengerWins.amount, bet);
assert.deepEqual(challengerWins.payouts, [{ userId: 101, amount: fullPotPayout }]);
assert.equal(challengerWins.treasuryDelta, bet * 2 - fullPotPayout);
assert.equal(challengerWins.payouts.reduce((sum, row) => sum + row.amount, 0) + challengerWins.treasuryDelta, bet * 2);
assert.equal(challengerWins.idempotencyKey, '__settlement:dice:dice-test-1');
assert.equal(challengerWins.histories.length, 2);
assert.equal(challengerWins.histories[0].outcome, 'win');
assert.equal(challengerWins.histories[1].outcome, 'lose');
assert.equal(challengerWins.histories[0].payout, fullPotPayout);
assert.equal(challengerWins.histories[1].payout, 0);

const targetWins = buildDuelSettlementRow({ ...base, winnerUserId: 202, meta: { result: { d1: 1, d2: 6, winner: 'B' } } });
assert.deepEqual(targetWins.payouts, [{ userId: 202, amount: fullPotPayout }]);
assert.equal(targetWins.histories[0].outcome, 'lose');
assert.equal(targetWins.histories[1].outcome, 'win');
assert.equal(targetWins.payouts[0].userId, targetWins.fromAccountUserId);

const tied = buildDuelSettlementRow({ ...base, winnerUserId: null, meta: { result: { d1: 4, d2: 4, winner: 'TIE' } } });
assert.deepEqual(tied.payouts, [{ userId: 101, amount: bet }, { userId: 202, amount: bet }]);
assert.equal(tied.treasuryDelta, 0);
assert.equal(tied.histories[0].outcome, 'refund');
assert.equal(tied.histories[1].outcome, 'refund');
assert.equal(tied.histories[0].payout, bet);
assert.equal(tied.histories[1].payout, bet);

assert.throws(() => buildDuelSettlementRow({ ...base, challengerId: 101, targetUserId: 101, winnerUserId: 101 }), /INVALID_DUEL_USERS/);
assert.throws(() => buildDuelSettlementRow({ ...base, winnerUserId: 303 }), /INVALID_DUEL_WINNER/);
assert.throws(() => buildDuelSettlementRow({ ...base, bet: 0, winnerUserId: 101 }), /INVALID_DUEL_BET/);
assert.throws(() => buildDuelSettlementRow({ ...base, bet: 1.5, winnerUserId: 101 }), /INVALID_DUEL_BET/);
assert.throws(() => buildDuelSettlementRow({ ...base, payout: -1, winnerUserId: 101 }), /INVALID_DUEL_PAYOUT/);
assert.throws(() => buildDuelSettlementRow({ ...base, payout: bet * 2 + 1, winnerUserId: 101 }), /INVALID_DUEL_PAYOUT/);
assert.throws(() => buildDuelSettlementRow({ ...base, payout: 0, winnerUserId: 101 }), /INVALID_DUEL_PAYOUT/);

console.log('Dice duel settlement plan tests passed.');
