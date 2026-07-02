'use strict';

const { COIN, SHAN = {} } = require('../config/constants');
const { getUser, userPayToTreasury, treasuryPayToUser } = require('./economyService');
const { getTreasury } = require('./treasuryService');
const { getWebGameRtp } = require('./webGameRtpService');
const { recordWebGameHistory } = require('./webBetHistoryService');

const MIN_BET = Math.max(1, Number(process.env.WEB_SHAN_MIN_BET || SHAN.minBet || 50));
const MAX_BET = Math.max(MIN_BET, Number(process.env.WEB_SHAN_MAX_BET || SHAN.maxBet || 10000));
const CAP_PERCENT = Math.max(0.03, Math.min(0.40, Number(process.env.WEB_SHAN_CAP_PERCENT || 0.12)));
const MAX_PAYOUT_MULTIPLIER = Math.max(1, Math.min(10, Number(process.env.WEB_SHAN_MAX_PAYOUT_MULTIPLIER || 2)));
const RTP_GAME_KEY = 'shan';

const SUITS = Object.freeze(['♠', '♥', '♦', '♣']);
const RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);

function parseBet(value) {
  const n = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.floor(n) : NaN;
}

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit, red: suit === '♥' || suit === '♦' });
  }
  return deck;
}

function shuffle(cards) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function rankPoint(rank) {
  if (rank === 'A') return 1;
  if (['10', 'J', 'Q', 'K'].includes(rank)) return 0;
  return Number(rank) || 0;
}

function highRank(rank) {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  return Number(rank) || 0;
}

function points(cards = []) {
  return cards.reduce((sum, card) => sum + rankPoint(card.rank), 0) % 10;
}

function tieRanks(cards = []) {
  return cards.map((card) => highRank(card.rank)).sort((a, b) => b - a);
}

function handInfo(cards = []) {
  const sameRank = cards.length === 3 && cards.every((card) => card.rank === cards[0].rank);
  const faceTriple = cards.length === 3 && cards.every((card) => ['J', 'Q', 'K'].includes(card.rank));
  const sameSuit = cards.length === 3 && cards.every((card) => card.suit === cards[0].suit);
  const handPoints = points(cards);

  if (sameRank) {
    return { category: 4, name: 'Shan Koe Mee', short: 'SKM', points: handPoints, tieBreaker: tieRanks(cards) };
  }
  if (faceTriple) {
    return { category: 3, name: 'Zat Toe', short: 'Face Triple', points: handPoints, tieBreaker: tieRanks(cards) };
  }
  if (sameSuit) {
    return { category: 2, name: 'Suit Triple', short: 'Flush', points: handPoints, tieBreaker: tieRanks(cards) };
  }
  return { category: 1, name: `Point ${handPoints}`, short: `${handPoints} Points`, points: handPoints, tieBreaker: tieRanks(cards) };
}

function compareTie(a = [], b = []) {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function compareHands(playerCards, dealerCards) {
  const player = handInfo(playerCards);
  const dealer = handInfo(dealerCards);
  let winner = 'PUSH';

  if (player.category !== dealer.category) winner = player.category > dealer.category ? 'PLAYER' : 'DEALER';
  else if (player.points !== dealer.points) winner = player.points > dealer.points ? 'PLAYER' : 'DEALER';
  else {
    const tie = compareTie(player.tieBreaker, dealer.tieBreaker);
    winner = tie > 0 ? 'PLAYER' : tie < 0 ? 'DEALER' : 'PUSH';
  }

  return { winner, player, dealer };
}

function dealOnce() {
  const deck = shuffle(buildDeck());
  const playerCards = deck.splice(0, 3);
  const dealerCards = deck.splice(0, 3);
  const result = compareHands(playerCards, dealerCards);
  return { playerCards, dealerCards, result };
}

function desiredOutcomeFromRtp(rtp) {
  // Even-money game: WIN pays total 2x, PUSH refunds 1x. Target return ~= 2*P(win)+P(push).
  const targetReturn = Math.max(0.40, Math.min(0.95, Number(rtp || 68) / 100));
  const pushChance = 0.055;
  const playerWinChance = Math.max(0.12, Math.min(0.46, (targetReturn - pushChance) / 2));
  const roll = Math.random();
  if (roll < playerWinChance) return 'PLAYER';
  if (roll < playerWinChance + pushChance) return 'PUSH';
  return 'DEALER';
}

function pickControlledDeal(rtp) {
  const desired = desiredOutcomeFromRtp(rtp);
  let best = null;
  for (let i = 0; i < 360; i += 1) {
    const candidate = dealOnce();
    if (!best) best = candidate;
    if (candidate.result.winner === desired) return { ...candidate, desiredOutcome: desired };
  }
  return { ...best, desiredOutcome: desired };
}

async function capPayout(bet, rawPayout) {
  const treasury = await getTreasury();
  const ownerBalance = Math.max(0, Number(treasury?.ownerBalance || 0));
  const maxByPercent = Math.floor(ownerBalance * CAP_PERCENT);
  const maxByBet = Math.floor(Number(bet || 0) * MAX_PAYOUT_MULTIPLIER);
  const hardMax = Math.max(Number(bet || 0), Math.min(ownerBalance, maxByPercent > 0 ? maxByPercent : ownerBalance, maxByBet));
  return Math.max(0, Math.min(Math.floor(Number(rawPayout) || 0), hardMax));
}

function publicCard(card) {
  return { rank: card.rank, suit: card.suit, red: !!card.red };
}

function resultLabel(winner) {
  if (winner === 'PLAYER') return 'WIN';
  if (winner === 'DEALER') return 'LOSE';
  return 'PUSH';
}

async function playWebShan({ userId, bet }) {
  const amount = parseBet(bet);
  if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
    const err = new Error('BET_RANGE');
    err.minBet = MIN_BET;
    err.maxBet = MAX_BET;
    throw err;
  }

  const user = await getUser(userId);
  if (!user) throw new Error('USER_NOT_FOUND');
  if (Number(user.balance || 0) < amount) throw new Error('USER_INSUFFICIENT');

  const rtp = await getWebGameRtp(RTP_GAME_KEY);
  const round = pickControlledDeal(rtp);
  const label = resultLabel(round.result.winner);
  const rawPayout = label === 'WIN' ? amount * 2 : label === 'PUSH' ? amount : 0;

  await userPayToTreasury(userId, amount, {
    type: 'web_shan_bet',
    source: 'miniapp_shan',
    rtp,
  });

  let payout = 0;
  if (rawPayout > 0) {
    payout = await capPayout(amount, rawPayout);
    if (payout > 0) {
      await treasuryPayToUser(userId, payout, {
        type: 'web_shan_win',
        source: 'miniapp_shan',
        bet: amount,
        payout,
        rawPayout,
        result: label,
        rtp,
      });
    }
  }

  const updated = await getUser(userId);
  const net = payout - amount;
  await recordWebGameHistory({
    userId,
    game: 'shan',
    title: `Shan ${label}`,
    outcome: label.toLowerCase(),
    bet: amount,
    payout,
    net,
    multiplier: amount > 0 ? payout / amount : 0,
    label,
    meta: {
      rtp,
      desiredOutcome: round.desiredOutcome,
      player: round.result.player,
      dealer: round.result.dealer,
    },
  });

  return {
    ok: true,
    game: 'shan',
    coin: COIN,
    rtp,
    bet: amount,
    playerCards: round.playerCards.map(publicCard),
    dealerCards: round.dealerCards.map(publicCard),
    playerInfo: round.result.player,
    dealerInfo: round.result.dealer,
    result: label,
    winner: round.result.winner,
    payout,
    rawPayout,
    net,
    balance: Number(updated?.balance || 0),
  };
}

module.exports = {
  playWebShan,
  compareHands,
  handInfo,
  points,
  MIN_BET,
  MAX_BET,
};
