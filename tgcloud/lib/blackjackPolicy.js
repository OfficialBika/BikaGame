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


export async function runBlackjackPolicyTests(assert) {
assert.equal(BLACKJACK_RULES.minBet, 50);
const gameSource = await (await import('node:fs/promises')).readFile(new URL('./game.js', import.meta.url), 'utf8');
const messageSource = await (await import('node:fs/promises')).readFile(new URL('../handlers/message.js', import.meta.url), 'utf8');
const callbackSource = await (await import('node:fs/promises')).readFile(new URL('../handlers/callback_query.js', import.meta.url), 'utf8');
const miniSource = await (await import('node:fs/promises')).readFile(new URL('./mini.js', import.meta.url), 'utf8');
assert.ok(gameSource.includes("getSetting('blackjack_rtp', BLACKJACK_RULES.defaultRtp)"));
assert.ok(gameSource.includes("BLACKJACK_RULES.actionTimeoutMs"));
assert.ok(gameSource.includes("'bj-refund:' + keyBase"));
assert.ok(gameSource.includes("'bj-payout:' + keyBase"));
assert.ok(gameSource.includes("updateBlackjackSession(session, nextState, 'settling')"));
assert.ok(gameSource.includes("eq(gameSessions.version, version)"), 'Blackjack session updates must use optimistic version guards');
assert.ok(messageSource.includes("await assertGameEnabled('blackjack')"));
assert.ok(callbackSource.includes("await assertGameEnabled('blackjack')"));
assert.ok(miniSource.includes("await assertGameEnabled('blackjack')"));

assert.equal(BLACKJACK_RULES.maxBet, 300000);
assert.equal(BLACKJACK_RULES.cooldownMs, 1500);
assert.equal(BLACKJACK_RULES.actionTimeoutMs, 90000);
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

  return true;
}
