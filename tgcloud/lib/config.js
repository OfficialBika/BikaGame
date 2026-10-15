export function miniConfig() {
  return {
    ok: true,
    serverless: true,
    productionDataImported: false,
    appUrl: '',
    botUsername: null,
    coin: '$',
    slot: { minBet: 10, maxBet: 1000000 },
    crash: { minBet: 10, maxBet: 1000000 },
    plinko: { minBet: 10, maxBet: 1000000 },
    wheel: { minBet: 10, maxBet: 1000000, segmentDegrees: 45 },
    mines: { minBet: 10, maxBet: 1000000, minCashoutSafe: 1, defaultMines: 3 },
    blackjack: { minBet: 50, maxBet: 1000000, maxPlayers: 5 },
    shan: { minBet: 50, maxBet: 1000000, maxPlayers: 6, minBankerStake: 1000, maxBankerStake: 1000000 },
  };
}
