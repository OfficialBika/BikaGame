'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compare, normalizeMove } = require('./rpsEngine');

test('Rock Paper Scissors resolves all six winning combinations', () => {
  const cases = [
    ['ROCK', 'SCISSORS', 'A'],
    ['SCISSORS', 'ROCK', 'B'],
    ['PAPER', 'ROCK', 'A'],
    ['ROCK', 'PAPER', 'B'],
    ['SCISSORS', 'PAPER', 'A'],
    ['PAPER', 'SCISSORS', 'B'],
  ];

  for (const [moveA, moveB, winner] of cases) {
    assert.deepEqual(compare(moveA, moveB), { moveA, moveB, winner });
  }
});

test('matching choices always produce a draw', () => {
  for (const move of ['ROCK', 'PAPER', 'SCISSORS']) {
    assert.deepEqual(compare(move, move), {
      moveA: move,
      moveB: move,
      winner: 'TIE',
    });
  }
});

test('moves are normalized case-insensitively', () => {
  assert.equal(normalizeMove(' rock '), 'ROCK');
  assert.equal(compare('paper', 'ROCK').winner, 'A');
});

test('invalid moves are rejected instead of producing a result', () => {
  assert.throws(() => normalizeMove('LIZARD'), /INVALID_RPS_MOVE/);
  assert.throws(() => compare('ROCK', 'INVALID'), /INVALID_RPS_MOVE/);
});
