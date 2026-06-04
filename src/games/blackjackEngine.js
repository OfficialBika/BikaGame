'use strict';

const SUITS = Object.freeze(['♠', '♥', '♦', '♣']);
const RANKS = Object.freeze([
  'A', '2', '3', '4', '5', '6', '7',
  '8', '9', '10', 'J', 'Q', 'K',
]);

function buildDeck() {
  const cards = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ rank, suit });
    }
  }

  return cards;
}

function shuffle(cards, random = Math.random) {
  if (!Array.isArray(cards)) {
    throw new TypeError('shuffle expects an array');
  }

  const copy = [...cards];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(
      Math.max(0, Math.min(0.999999999999, Number(random()))) * (i + 1)
    );

    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function validateCards(cards) {
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new TypeError('Blackjack hand must contain at least one card');
  }

  for (const card of cards) {
    if (!card || !RANKS.includes(card.rank) || !SUITS.includes(card.suit)) {
      throw new TypeError('Blackjack hand contains an invalid card');
    }
  }
}

function value(cards) {
  validateCards(cards);

  let total = 0;
  let aces = 0;

  for (const card of cards) {
    if (card.rank === 'A') {
      aces += 1;
      total += 11;
    } else if (['J', 'Q', 'K'].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return total;
}

function isBlackjack(cards) {
  return cards.length === 2 && value(cards) === 21;
}

function drawCard(deck) {
  if (!Array.isArray(deck) || deck.length === 0) {
    throw new Error('DECK_EMPTY');
  }

  return deck.pop();
}

/**
 * Simple auto-stand blackjack round.
 * Player receives two cards and stands.
 * Dealer draws until at least 17.
 */
function play(random = Math.random) {
  const deck = shuffle(buildDeck(), random);

  const player = [drawCard(deck), drawCard(deck)];
  const dealer = [drawCard(deck), drawCard(deck)];

  while (value(dealer) < 17) {
    dealer.push(drawCard(deck));
  }

  const pv = value(player);
  const dv = value(dealer);
  const playerBlackjack = isBlackjack(player);
  const dealerBlackjack = isBlackjack(dealer);

  let result = 'LOSE';

  if (playerBlackjack && dealerBlackjack) {
    result = 'PUSH';
  } else if (playerBlackjack) {
    result = 'BLACKJACK';
  } else if (dealerBlackjack) {
    result = 'LOSE';
  } else if (pv > 21) {
    result = 'LOSE';
  } else if (dv > 21 || pv > dv) {
    result = 'WIN';
  } else if (pv === dv) {
    result = 'PUSH';
  }

  return {
    player,
    dealer,
    pv,
    dv,
    playerBlackjack,
    dealerBlackjack,
    result,
  };
}

function render(cards) {
  validateCards(cards);
  return cards.map((card) => `${card.rank}${card.suit}`).join('  ');
}

module.exports = {
  SUITS,
  RANKS,
  buildDeck,
  shuffle,
  value,
  isBlackjack,
  play,
  render,
};
