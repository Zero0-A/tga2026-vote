const test = require('node:test');
const assert = require('node:assert/strict');
const { dayKey, nextDayAt, ballotForDay, ballotHistory } = require('../data/ballots');
const { emptyAnalytics, reportAnalytics } = require('../data/analytics');

test('resets eligibility at midnight in Beijing and keeps prior-day ballots', () => {
  const midnight = Date.parse('2026-11-25T16:00:00Z');
  const first = { nomineeId: 'first-game', ts: midnight - 1, device: 'mobile' };
  const second = { nomineeId: 'second-game', ts: midnight, device: 'desktop' };
  assert.equal(dayKey(first.ts), '2026-11-25');
  assert.equal(dayKey(second.ts), '2026-11-26');
  assert.equal(nextDayAt(first.ts), midnight);
  assert.equal(nextDayAt(second.ts), Date.parse('2026-11-26T16:00:00Z'));
  assert.equal(ballotForDay(first, dayKey(first.ts)), first);
  assert.equal(ballotForDay(first, dayKey(second.ts)), undefined);
  const history = [...ballotHistory(first), second];
  assert.equal(ballotForDay(history, dayKey(second.ts)), second);
  assert.equal(ballotForDay(history, dayKey(first.ts)), first);
});

test('counts repeated daily ballots while deduplicating voters and preserving legacy ballots', () => {
  const first = { nomineeId: 'first-game', ts: Date.parse('2026-11-25T15:55:00Z'), device: 'mobile' };
  const second = { nomineeId: 'second-game', ts: Date.parse('2026-11-25T16:05:00Z'), device: 'desktop' };
  const legacy = 'legacy-game';
  assert.deepEqual(ballotHistory(legacy), [legacy]);
  assert.equal(ballotForDay(legacy, dayKey(first.ts)), undefined);
  const analytics = emptyAnalytics();
  analytics.startedAt = first.ts;
  const result = reportAnalytics(analytics, { goty: { browser: [legacy, first, second] } }, second.ts);
  assert.equal(result.summary.all.votes, 2);
  assert.equal(result.summary.all.voters, 1);
  assert.equal(result.summary.mobile.votes, 1);
  assert.equal(result.summary.desktop.votes, 1);
  assert.equal(result.legacyVotes, 1);
  assert.deepEqual(result.daily.map(day => day.groups.all.votes), [1, 1]);
});
