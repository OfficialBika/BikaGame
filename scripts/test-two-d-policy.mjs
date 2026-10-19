import assert from 'node:assert/strict';
import { parseTwoDBet, twoDSessionAt, yangonDayKey } from '../tgcloud/lib/twoDPolicy.js';

const ordinary = parseTwoDBet('.2d 00.33.66 5000');
assert.equal(ordinary.ok, true);
assert.deepEqual(ordinary.lines.map(x => x.number), ['00', '33', '66']);
assert.equal(ordinary.total, 15000);
assert.equal(ordinary.lines[0].potentialWin, 200000);

const reverse = parseTwoDBet('.2d 45R 5000');
assert.equal(reverse.ok, true);
assert.deepEqual(reverse.lines, [
  { number: '45', amount: 5000, potentialWin: 200000 },
  { number: '54', amount: 5000, potentialWin: 200000 },
]);
assert.equal(parseTwoDBet('.2d 00R 5000').lines.length, 1);

const duplicateNumbers = parseTwoDBet('.2d 45.45R 5000');
assert.equal(duplicateNumbers.ok, true);
assert.equal(duplicateNumbers.lines.find(x => x.number === '45').amount, 10000);
assert.equal(duplicateNumbers.total, 15000);

assert.equal(parseTwoDBet('.2d 00 199').error, 'AMOUNT_LIMIT');
assert.equal(parseTwoDBet('.2d 00 200001').error, 'AMOUNT_LIMIT');
assert.equal(parseTwoDBet('.2d 4R 200').error, 'INVALID_NUMBER');
assert.equal(parseTwoDBet('.2d 00 200,000').ok, true);
assert.equal(parseTwoDBet('.2d 00 200000 1').error, 'AMOUNT_LIMIT');

const amOpen = twoDSessionAt(new Date('2026-10-19T01:30:00.000Z')); // 08:00 Yangon Monday
assert.equal(amOpen.open, true);
assert.equal(amOpen.session, 'am');
assert.equal(amOpen.eventId, 'auto-2026-10-19-am');

const amClosed = twoDSessionAt(new Date('2026-10-19T04:50:00.000Z')); // 11:20? no: 11:20 Yangon
assert.equal(amClosed.open, false);
assert.equal(amClosed.reason, 'OUTSIDE_SESSION');

const pmOpen = twoDSessionAt(new Date('2026-10-19T06:30:00.000Z')); // 13:00 Yangon Monday
assert.equal(pmOpen.open, true);
assert.equal(pmOpen.session, 'pm');
assert.equal(pmOpen.eventDateKey, '2026-10-19-pm');

const weekend = twoDSessionAt(new Date('2026-10-18T02:30:00.000Z')); // Sunday Yangon
assert.equal(weekend.open, false);
assert.equal(weekend.reason, 'WEEKEND');
assert.equal(yangonDayKey(new Date('2026-10-18T18:00:00.000Z')), '2026-10-19');

console.log('2D parsing and Yangon schedule policy tests passed.');
