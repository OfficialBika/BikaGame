module.exports = {
  COIN: 'MMK',
  HOUSE_CUT_PERCENT: 0.02,
  START_BONUS: Number(process.env.START_BONUS || 10000),
  DAILY_MIN: Number(process.env.DAILY_MIN || 1500),
  DAILY_MAX: Number(process.env.DAILY_MAX || 5000),
  SLOT: { minBet: 50, maxBet: 7000, cooldownMs: 700, capPercent: 0.30, maxActive: 10 },
  DICE: { minBet: 10, maxBet: 40000, timeoutMs: 60000, maxActive: 5 },
  SHAN: { minBet: 10, maxBet: 40000, timeoutMs: 60000, maxActive: 5 },
  BLACKJACK: { minBet: 50, maxBet: 40000, cooldownMs: 1500 }
};
