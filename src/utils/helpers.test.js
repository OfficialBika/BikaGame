'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isBotCommandText } = require('./helpers');

test('RPS dot command is recognized with an amount argument', () => {
  assert.equal(isBotCommandText('.rps 10'), true);
  assert.equal(isBotCommandText('.RPS 500000'), true);
});

test('RPS recognition does not accept command-name prefixes', () => {
  assert.equal(isBotCommandText('.rpsanything 10'), false);
  assert.equal(isBotCommandText('hello .rps 10'), false);
});

test('existing Shan dot command recognition remains intact', () => {
  assert.equal(isBotCommandText('.shan 500'), true);
});
