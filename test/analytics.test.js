const test = require('node:test');
const assert = require('node:assert/strict');
const { deviceFromHeaders, emptyAnalytics, recordVisit, reportAnalytics } = require('../data/analytics');

test('classifies desktop, phone, tablet and unknown browser headers', () => {
  for (const [agent, expected] of [
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'desktop'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile', 'mobile'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 8) Mobile Safari', 'mobile'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel Tablet) Safari', 'tablet'],
    ['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Mobile', 'tablet'],
    ['Mozilla/5.0 (Linux; Android 15) Mobile Googlebot', 'unknown'],
    ['', 'unknown']
  ]) {
    assert.equal(deviceFromHeaders({ 'user-agent': agent }), expected);
  }
  assert.equal(deviceFromHeaders({ 'sec-ch-ua-mobile': '?1' }), 'mobile');
});

test('deduplicates visitors and voters within the selected device and date range', () => {
  const beforeMidnight = Date.parse('2026-11-25T15:59:00Z');
  const afterMidnight = Date.parse('2026-11-25T16:01:00Z');
  const analytics = emptyAnalytics();
  recordVisit(analytics, 'shared-browser', 'mobile', beforeMidnight);
  recordVisit(analytics, 'shared-browser', 'mobile', beforeMidnight);
  recordVisit(analytics, 'mobile-only', 'mobile', beforeMidnight);
  recordVisit(analytics, 'shared-browser', 'desktop', afterMidnight);

  const report = reportAnalytics(analytics, {
    goty: {
      'shared-browser': { device: 'mobile', ts: afterMidnight },
      legacy: 'old-nominee',
      'api-only': { device: 'desktop', ts: afterMidnight }
    },
    action: {
      'shared-browser': { device: 'mobile', ts: afterMidnight },
      'old-browser': { nomineeId: 'old-nominee', ts: beforeMidnight }
    }
  }, Date.parse('2026-11-28T00:00:00Z'));

  assert.equal(report.since, '2026-11-25');
  assert.equal(report.legacyVotes, 2);
  assert.deepEqual(report.summary.all, {
    visits: 4, visitors: 2, votes: 3, voters: 2, converted: 1, conversionRate: 50
  });
  assert.deepEqual(report.summary.mobile, {
    visits: 3, visitors: 2, votes: 2, voters: 1, converted: 1, conversionRate: 50
  });
  assert.equal(report.summary.desktop.conversionRate, 0);
  assert.deepEqual(report.daily.map(day => day.date), ['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28']);
  assert.equal(report.daily[0].groups.mobile.conversionRate, 0);
  assert.equal(report.daily[1].groups.mobile.conversionRate, null);
  assert.equal(report.daily[1].groups.all.conversionRate, 100);
  assert.equal(report.daily[2].groups.all.visits, 0);
});

test('keeps historical votes out of a new tracking period', () => {
  const report = reportAnalytics(emptyAnalytics(), { goty: { alex: 'old-nominee' } });
  assert.equal(report.since, null);
  assert.equal(report.legacyVotes, 1);
  assert.equal(report.summary.all.conversionRate, null);
  assert.deepEqual(report.daily, []);
});
