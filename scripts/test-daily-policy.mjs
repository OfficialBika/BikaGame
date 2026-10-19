import assert from 'node:assert/strict';
import { dailyRewardAmount, yangonDayBounds } from '../tgcloud/lib/dailyPolicy.js';

const beforeYangonMidnight = yangonDayBounds(new Date('2026-10-19T17:29:59.000Z'));
assert.equal(beforeYangonMidnight.dayKey, '2026-10-19');
assert.equal(beforeYangonMidnight.dayStart.toISOString(), '2026-10-18T17:30:00.000Z');

const afterYangonMidnight = yangonDayBounds(new Date('2026-10-19T17:30:00.000Z'));
assert.equal(afterYangonMidnight.dayKey, '2026-10-20');
assert.equal(afterYangonMidnight.dayStart.toISOString(), '2026-10-19T17:30:00.000Z');
assert.equal(afterYangonMidnight.dayStartUnix, Math.floor(Date.parse('2026-10-19T17:30:00.000Z') / 1000));

assert.equal(dailyRewardAmount(500, 2000, () => 0), 500);
assert.equal(dailyRewardAmount(500, 2000, () => 0.5), 1250);
assert.equal(dailyRewardAmount(500, 2000, () => 0.999999), 2000);
assert.equal(dailyRewardAmount(12, 12, () => 0.3), 12);
assert.throws(() => dailyRewardAmount(0, 10), RangeError);
assert.throws(() => dailyRewardAmount(11, 10), RangeError);
console.log('Daily claim Yangon date and reward-range tests passed.');
