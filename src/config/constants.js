module.exports = {
  COIN: 'MMK',
  HOUSE_CUT_PERCENT: 0.02,
  START_BONUS: Number(process.env.START_BONUS || 300),
  DAILY_MIN: Number(process.env.DAILY_MIN || 500),
  DAILY_MAX: Number(process.env.DAILY_MAX || 2000),
  SLOT: { minBet: 50, maxBet: 5000, cooldownMs: 700, capPercent: 0.30, maxActive: 5 },
  DICE: { minBet: 10, maxBet: 40000, timeoutMs: 60000, maxActive: 4 },
  SHAN: { minBet: 10, maxBet: 40000, timeoutMs: 60000, maxActive: 4 },
  BLACKJACK: { minBet: 50, maxBet: 40000, cooldownMs: 1500 }
};
