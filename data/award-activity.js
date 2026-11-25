const { dayKey, ballotHistory } = require('./ballots');

function recordAwardOpen(analytics, categoryId, voterId, timestamp) {
  const awards = analytics.awardViews ??= {};
  const dates = awards[categoryId] ??= {};
  const day = dates[dayKey(timestamp)] ??= { opens: 0, visitors: {} };
  day.opens++;
  day.visitors[voterId] = true;
}

function activityBucket() {
  return { opens: 0, visitors: new Set(), voters: new Set(), votes: 0, nominees: new Map() };
}

function summarize(bucket) {
  const visitors = bucket.visitors.size;
  const converted = [...bucket.voters].filter(id => bucket.visitors.has(id)).length;
  return {
    opens: bucket.opens,
    visitors,
    voters: bucket.voters.size,
    votes: bucket.votes,
    conversionRate: visitors ? Math.round(converted / visitors * 10000) / 100 : null
  };
}

function reportAwardActivity(analytics, category, voteMap = {}) {
  const total = activityBucket();
  const daily = new Map();
  function getDay(date) {
    if (!daily.has(date)) daily.set(date, activityBucket());
    return daily.get(date);
  }

  const views = analytics.awardViews?.[category.id] ?? {};
  for (const [date, entry] of Object.entries(views)) {
    const day = getDay(date);
    day.opens = entry.opens;
    total.opens += entry.opens;
    for (const id of Object.keys(entry.visitors)) {
      day.visitors.add(id);
      total.visitors.add(id);
    }
  }

  let undatedVotes = 0;
  for (const [voterId, history] of Object.entries(voteMap)) {
    for (const vote of ballotHistory(history)) {
      total.votes++;
      total.voters.add(voterId);
      if (!Number.isFinite(vote?.ts)) {
        undatedVotes++;
        continue;
      }
      const day = getDay(dayKey(vote.ts));
      day.votes++;
      day.voters.add(voterId);
      day.nominees.set(vote.nomineeId, (day.nominees.get(vote.nomineeId) ?? 0) + 1);
    }
  }

  return {
    categoryId: category.id,
    categoryName: category.cn,
    opensSince: Object.keys(views).sort()[0] ?? null,
    undatedVotes,
    summary: summarize(total),
    nominees: category.nominees.map(({ id, name }) => ({ id, name })),
    daily: [...daily.keys()].sort().reverse().map(date => {
      const day = daily.get(date);
      return { date, ...summarize(day), nomineeVotes: Object.fromEntries(day.nominees) };
    })
  };
}

module.exports = { recordAwardOpen, reportAwardActivity };
