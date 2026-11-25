const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { emptyAnalytics, recordVisit, reportAnalytics } = require('../data/analytics');
const { recordAwardOpen, reportAwardActivity } = require('../data/award-activity');
const { createArchive, listArchives, readArchive, archiveCsv } = require('../data/archives');

test('award activity uses dated ballots, deduplicates opens and counts same-day conversion', () => {
  const time = Date.parse('2026-11-25T15:59:00Z');
  const nextDay = time + 120000;
  const analytics = emptyAnalytics();
  const award = { id: 'goty', cn: '年度最佳', nominees: [{ id: 'first', name: '游戏一' }, { id: 'second', name: '游戏二' }] };
  recordAwardOpen(analytics, award.id, 'voter', time);
  recordAwardOpen(analytics, award.id, 'voter', time);
  recordAwardOpen(analytics, award.id, 'other', time);
  recordAwardOpen(analytics, 'another-award', 'visitor', time);
  const report = reportAwardActivity(analytics, award, {
    voter: [{ nomineeId: 'first', ts: time }, { nomineeId: 'second', ts: nextDay }],
    old: 'first'
  });
  assert.equal(report.opensSince, '2026-11-25');
  assert.equal(report.undatedVotes, 1);
  assert.deepEqual(report.summary, { opens: 3, visitors: 2, voters: 2, votes: 3, conversionRate: 50 });
  assert.deepEqual(report.daily.map(row => [row.date, row.votes, row.conversionRate, row.nomineeVotes]), [
    ['2026-11-26', 1, null, { second: 1 }],
    ['2026-11-25', 1, 50, { first: 1 }]
  ]);
});

test('source labels count browser visits without recording arbitrary input', () => {
  const analytics = emptyAnalytics();
  const time = Date.parse('2026-11-25T15:59:00Z');
  recordVisit(analytics, 'same', 'desktop', time, 'QQ');
  recordVisit(analytics, 'same', 'desktop', time, 'qq');
  recordVisit(analytics, 'same', 'desktop', time, 'wechat');
  recordVisit(analytics, 'other', 'mobile', time, 'unexpected-identifier');
  const { channels } = reportAnalytics(analytics, {}, time);
  assert.deepEqual(channels.qq, { visits: 2, visitors: 1 });
  assert.deepEqual(channels.wechat, { visits: 1, visitors: 1 });
  assert.deepEqual(channels.untagged, { visits: 1, visitors: 1 });
  assert(!JSON.stringify(analytics).includes('unexpected-identifier'));
});

test('results archive preserves an independent snapshot and original ballots', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suyou-archive-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'votes.json.archives');
  const time = Date.parse('2026-11-26T09:30:00Z');
  const results = {
    totalVotes: 1, voters: 1,
    categories: [{ cn: '年度最佳', nominees: [{ name: '示例, "作品"', votes: 1, pct: 100 }] }]
  };
  const backup = { votes: { goty: { browser: 'first' } }, log: [], analytics: emptyAnalytics() };
  assert.deepEqual(listArchives(directory), []);
  const created = createArchive(directory, results, backup, time);
  results.totalVotes = 0;
  delete backup.votes.goty;
  assert.deepEqual(listArchives(directory), [created]);
  const archive = readArchive(directory, created.id);
  assert.equal(archive.results.totalVotes, 1);
  assert.equal(archive.backup.votes.goty.browser, 'first');
  assert(archiveCsv(archive).includes('"示例, ""作品"""'));
  assert.equal(readArchive(directory, '../votes'), null);
});
