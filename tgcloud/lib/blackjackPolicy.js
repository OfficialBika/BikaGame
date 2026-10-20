export const BLACKJACK_RULES = Object.freeze({
  minBet: 50,
  maxBet: 300000,
  cooldownMs: 1500,
  actionTimeoutMs: 90000,
  defaultRtp: 50,
  maxPlayers: 5,
});

export function normalizeBlackjackRoom(value) {
  const room = String(value ?? 'solo').trim().replace(/^bj:/i, '');
  if (!room || room.length > 40 || !/^[A-Za-z0-9_-]+$/.test(room)) {
    throw new TypeError('BJ_ROOM_INVALID');
  }
  return room;
}

export function clampBlackjackRtp(value, fallback = BLACKJACK_RULES.defaultRtp) {
  const n = Number(String(value ?? '').replace('%', '').trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

export function cardValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards || []) {
    const rank = String(card?.r ?? card?.rank ?? '');
    if (rank === 'A') {
      total += 11;
      aces += 1;
    } else if (['K', 'Q', 'J'].includes(rank)) {
      total += 10;
    } else {
      total += Number(rank) || 0;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

export function isNaturalBlackjack(cards) {
  return Array.isArray(cards) && cards.length === 2 && cardValue(cards) === 21;
}

export function resultForBlackjack(playerCards, dealerCards) {
  const playerValue = cardValue(playerCards);
  const dealerValue = cardValue(dealerCards);
  const playerNatural = isNaturalBlackjack(playerCards);
  const dealerNatural = isNaturalBlackjack(dealerCards);
  if (playerNatural && dealerNatural) return 'PUSH';
  if (playerNatural) return 'BLACKJACK';
  if (dealerNatural || playerValue > 21) return 'LOSE';
  if (dealerValue > 21 || playerValue > dealerValue) return 'WIN';
  if (playerValue < dealerValue) return 'LOSE';
  return 'PUSH';
}

export function blackjackPayout(result, bet) {
  const amount = Number(bet);
  if (!Number.isSafeInteger(amount) || amount < BLACKJACK_RULES.minBet || amount > BLACKJACK_RULES.maxBet) {
    throw new TypeError('BJ_BET_INVALID');
  }
  if (result === 'BLACKJACK') return Math.floor(amount * 2.5);
  if (result === 'WIN') return amount * 2;
  if (result === 'PUSH') return amount;
  if (result === 'LOSE') return 0;
  throw new TypeError('BJ_RESULT_INVALID');
}

export function chooseBlackjackTargetResult(playerCards, dealerCards, fairResult, rtpRate, random = Math.random) {
  const playerValue = cardValue(playerCards);
  if (isNaturalBlackjack(playerCards) || isNaturalBlackjack(dealerCards) || playerValue > 21) {
    return fairResult;
  }
  const rate = clampBlackjackRtp(rtpRate);
  if (Number(random()) * 100 < rate) return 'WIN';
  return playerValue >= 21 ? 'PUSH' : 'LOSE';
}

export function buildBlackjackSettlementPlan(players, dealerCards, reason = 'actions_complete', rtpRate = BLACKJACK_RULES.defaultRtp, random = Math.random) {
  return (players || []).map((player) => {
    const fairResult = resultForBlackjack(player.cards, dealerCards);
    const result = reason === 'timeout'
      ? 'REFUND'
      : (player.finalResult || chooseBlackjackTargetResult(player.cards, dealerCards, fairResult, rtpRate, random));
    return {
      userId: Number(player.id),
      bet: Number(player.bet),
      result,
      payout: result === 'REFUND' ? Number(player.bet) : blackjackPayout(result, Number(player.bet)),
      playerValue: cardValue(player.cards),
      natural: isNaturalBlackjack(player.cards),
    };
  });
}

const deckFor = (random = Math.random) => {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const cards = suits.flatMap((s) => ranks.map((r) => ({ r, s })));
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const draw = Number(random());
    const j = Math.floor(Math.max(0, Math.min(0.999999999999, draw)) * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
};

export const createBlackjackDeck = deckFor;
