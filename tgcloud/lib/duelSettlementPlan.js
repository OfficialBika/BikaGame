export function buildDuelSettlementRow({
  settlementId,
  typePrefix = 'dice',
  challengerId,
  targetUserId,
  winnerUserId = null,
  bet,
  payout = 0,
  meta = {},
}) {
  const id = String(settlementId || '').trim();
  const prefix = String(typePrefix || '').trim();
  const challenger = Number(challengerId);
  const target = Number(targetUserId);
  const amount = Number(bet);
  const reward = Number(payout);
  if (!id || id.length > 120 || !prefix || prefix.length > 40) throw new TypeError('INVALID_DUEL_ID');
  if (!Number.isSafeInteger(challenger) || challenger <= 0 ||
      !Number.isSafeInteger(target) || target <= 0 || challenger === target) {
    throw new TypeError('INVALID_DUEL_USERS');
  }
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(amount * 2)) {
    throw new TypeError('INVALID_DUEL_BET');
  }
  if (!Number.isSafeInteger(reward) || reward < 0 || reward > amount * 2) {
    throw new TypeError('INVALID_DUEL_PAYOUT');
  }

  const winner = winnerUserId == null ? null : Number(winnerUserId);
  if (winner !== null && winner !== challenger && winner !== target) {
    throw new TypeError('INVALID_DUEL_WINNER');
  }
  if (winner !== null && reward <= 0) throw new TypeError('INVALID_DUEL_PAYOUT');

  const tie = winner === null;
  const payouts = tie
    ? [{ userId: challenger, amount }, { userId: target, amount }]
    : [{ userId: winner, amount: reward }];
  const totalPayout = payouts.reduce((sum, item) => sum + item.amount, 0);
  const result = meta?.result ?? null;
  const historyFor = (userId) => {
    const userWon = winner === userId;
    const userPayout = tie ? amount : userWon ? reward : 0;
    return {
      userId,
      game: prefix,
      bet: amount,
      payout: userPayout,
      multiplier: userPayout / amount,
      result,
      title: prefix.toUpperCase() + ' Duel',
      outcome: tie ? 'refund' : userWon ? 'win' : 'lose',
    };
  };

  return {
    type: prefix + '_settlement',
    fromUserId: String(challenger),
    toUserId: 'TREASURY',
    amount,
    accountUserId: challenger,
    balanceDelta: -amount,
    requiredBalance: amount,
    totalWonDelta: 0,
    totalLostDelta: amount,
    fromAccountUserId: target,
    treasuryDelta: amount * 2 - totalPayout,
    requiredTreasury: 0,
    payouts,
    histories: [historyFor(challenger), historyFor(target)],
    idempotencyKey: '__settlement:' + prefix + ':' + id,
    meta: {
      ...meta,
      settlementId: id,
      typePrefix: prefix,
      challengerId: challenger,
      targetUserId: target,
      winnerUserId: winner,
      bet: amount,
      payout: reward,
      result,
      tie,
    },
  };
}
