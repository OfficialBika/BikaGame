'use strict';

const MOVES = Object.freeze({
  ROCK: Object.freeze({ label: 'Rock', emoji: '🪨' }),
  PAPER: Object.freeze({ label: 'Paper', emoji: '📄' }),
  SCISSORS: Object.freeze({ label: 'Scissors', emoji: '✂️' }),
});

const BEATS = Object.freeze({
  ROCK: 'SCISSORS',
  PAPER: 'ROCK',
  SCISSORS: 'PAPER',
});

function normalizeMove(value) {
  const move = String(value ?? '').trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(MOVES, move)) {
    throw new TypeError('INVALID_RPS_MOVE');
  }
  return move;
}

function compare(moveA, moveB) {
  const a = normalizeMove(moveA);
  const b = normalizeMove(moveB);

  return {
    moveA: a,
    moveB: b,
    winner: a === b ? 'TIE' : BEATS[a] === b ? 'A' : 'B',
  };
}

module.exports = { MOVES, normalizeMove, compare };
