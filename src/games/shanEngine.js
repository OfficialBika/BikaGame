'use strict';

const SUITS = Object.freeze(['♠', '♥', '♦', '♣']);
const RANKS = Object.freeze([
  'A', '2', '3', '4', '5', '6', '7',
  '8', '9', '10', 'J', 'Q', 'K',
]);

function buildDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }

  return deck;
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

function draw(deck, count) {
  if (!Array.isArray(deck)) {
    throw new TypeError('draw expects a deck array');
  }

  const amount = Math.floor(Number(count));

  if (!Number.isInteger(amount) || amount < 0) {
    throw new TypeError('draw count must be a non-negative integer');
  }

  if (deck.length < amount) {
    throw new Error('NOT_ENOUGH_CARDS');
  }

  return deck.splice(0, amount);
}

function validateHand(cards) {
  if (!Array.isArray(cards) || cards.length !== 3) {
    throw new TypeError('Shan hand must contain exactly 3 cards');
  }

  for (const card of cards) {
    if (!card || !RANKS.includes(card.rank) || !SUITS.includes(card.suit)) {
      throw new TypeError('Shan hand contains an invalid card');
    }
  }
}

function rankValue(rank) {
  if (rank === 'A') return 1;
  if (['10', 'J', 'Q', 'K'].includes(rank)) return 0;
  return Number(rank) || 0;
}

function points(cards) {
  validateHand(cards);
  return cards.reduce((sum, card) => sum + rankValue(card.rank), 0) % 10;
}

function highCardValue(rank) {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  return Number(rank) || 0;
}

function sortedHighRanks(cards) {
  return cards
    .map((card) => highCardValue(card.rank))
    .sort((a, b) => b - a);
}

function info(cards) {
  validateHand(cards);

  const sameRank = cards.every((card) => card.rank === cards[0].rank);
  const zatToe = cards.every((card) => ['J', 'Q', 'K'].includes(card.rank));
  const sameSuit = cards.every((card) => card.suit === cards[0].suit);
  const handPoints = points(cards);

  if (sameRank) {
    return {
      cat: 4,
      category: 4,
      name: 'Shan Koe Mee',
      points: handPoints,
      tieBreaker: sortedHighRanks(cards),
    };
  }

  if (zatToe) {
    return {
      cat: 3,
      category: 3,
      name: 'Zat Toe',
      points: handPoints,
      tieBreaker: sortedHighRanks(cards),
    };
  }

  if (sameSuit) {
    return {
      cat: 2,
      category: 2,
      name: 'Suit Triple',
      points: handPoints,
      tieBreaker: sortedHighRanks(cards),
    };
  }

  return {
    cat: 1,
    category: 1,
    name: `Point ${handPoints}`,
    points: handPoints,
    tieBreaker: sortedHighRanks(cards),
  };
}

function compareTieBreakers(a, b) {
  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    const left = a[i] || 0;
    const right = b[i] || 0;

    if (left > right) return 1;
    if (right > left) return -1;
  }

  return 0;
}

function compare(cardsA, cardsB) {
  const infoA = info(cardsA);
  const infoB = info(cardsB);

  if (infoA.cat !== infoB.cat) {
    return {
      winner: infoA.cat > infoB.cat ? 'A' : 'B',
      infoA,
      infoB,
    };
  }

  if (infoA.points !== infoB.points) {
    return {
      winner: infoA.points > infoB.points ? 'A' : 'B',
      infoA,
      infoB,
    };
  }

  const tie = compareTieBreakers(infoA.tieBreaker, infoB.tieBreaker);

  return {
    winner: tie > 0 ? 'A' : tie < 0 ? 'B' : 'TIE',
    infoA,
    infoB,
  };
}

function deal(random = Math.random) {
  const deck = shuffle(buildDeck(), random);
  const cardsA = draw(deck, 3);
  const cardsB = draw(deck, 3);

  return {
    cardsA,
    cardsB,
    result: compare(cardsA, cardsB),
  };
}

function render(cards) {
  validateHand(cards);
  return cards.map((card) => `${card.rank}${card.suit}`).join('  ');
}

module.exports = {
  SUITS,
  RANKS,
  buildDeck,
  shuffle,
  draw,
  rankValue,
  points,
  info,
  compare,
  deal,
  render,
};
