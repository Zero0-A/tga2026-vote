const { DAY_MS, dayKey, ballotHistory } = require('./ballots');
const DEVICES = ['mobile', 'desktop', 'tablet', 'unknown'];
const CHANNELS = ['qq', 'wechat', 'bilibili', 'xiaohongshu'];

function deviceFromHeaders(headers) {
  const agent = headers['user-agent'] || '';
  if (/bot\b|crawler|spider|headless|curl|wget/i.test(agent)) return 'unknown';
  if (/iPad|Tablet|PlayBook|Kindle|Silk/i.test(agent)) return 'tablet';
  if (/iPhone|iPod|Windows Phone|Mobile|Mobi/i.test(agent) || headers['sec-ch-ua-mobile'] === '?1') return 'mobile';
  if (/Android/i.test(agent)) return 'tablet';
  if (/Windows NT|Macintosh|X11|CrOS|Linux/i.test(agent)) return 'desktop';
  return 'unknown';
}

function emptyAnalytics() {
  return { startedAt: null, views: {} };
}

function recordVisit(analytics, voterId, device, timestamp, source) {
  analytics.startedAt ??= timestamp;
  const date = dayKey(timestamp);
  const day = analytics.views[date] ??= {};
  const group = day[device] ??= { visits: 0, visitors: {} };
  group.visits++;
  group.visitors[voterId] = true;

  const channels = analytics.channels ??= {};
  const label = source?.trim().toLowerCase();
  const channel = channels[CHANNELS.includes(label) ? label : 'untagged'] ??= { visits: 0, visitors: {} };
  channel.visits++;
  channel.visitors[voterId] = true;
}

function bucketsByDevice() {
  return Object.fromEntries(['all', ...DEVICES].map(device => [
    device, { visits: 0, visitors: new Set(), votes: 0, voters: new Set() }
  ]));
}

function summarize(groups) {
  return Object.fromEntries(Object.entries(groups).map(([device, group]) => {
    const visitors = group.visitors.size;
    const converted = [...group.voters].filter(id => group.visitors.has(id)).length;
    return [device, {
      visits: group.visits,
      visitors,
      votes: group.votes,
      voters: group.voters.size,
      converted,
      conversionRate: visitors ? Math.round(converted / visitors * 10000) / 100 : null
    }];
  }));
}

function reportAnalytics(analytics, votes, now = Date.now()) {
  const total = bucketsByDevice();
  const daily = new Map();
  const days = date => {
    if (!daily.has(date)) daily.set(date, bucketsByDevice());
    return daily.get(date);
  };

  for (const [date, groups] of Object.entries(analytics.views)) {
    for (const device of DEVICES) {
      const entry = groups[device];
      if (!entry) continue;
      const ids = Object.keys(entry.visitors);
      for (const bucket of [total.all, total[device], days(date).all, days(date)[device]]) {
        bucket.visits += entry.visits;
        for (const id of ids) bucket.visitors.add(id);
      }
    }
  }

  let legacyVotes = 0;
  for (const category of Object.values(votes)) {
    for (const [voterId, history] of Object.entries(category || {})) {
      for (const vote of ballotHistory(history)) {
        if (!DEVICES.includes(vote?.device) || !Number.isFinite(vote.ts)) {
          legacyVotes++;
          continue;
        }
        const day = days(dayKey(vote.ts));
        for (const bucket of [total.all, total[vote.device], day.all, day[vote.device]]) {
          bucket.votes++;
          bucket.voters.add(voterId);
        }
      }
    }
  }

  const since = analytics.startedAt === null ? null : dayKey(analytics.startedAt);
  if (since) {
    const start = Date.parse(since);
    const end = Date.parse(dayKey(now));
    for (let date = start; date <= end; date += DAY_MS) {
      days(new Date(date).toISOString().slice(0, 10));
    }
  }
  return {
    since,
    legacyVotes,
    channels: Object.fromEntries([...CHANNELS, 'untagged'].map(source => {
      const channel = analytics.channels?.[source];
      return [source, { visits: channel?.visits ?? 0, visitors: Object.keys(channel?.visitors ?? {}).length }];
    })),
    summary: summarize(total),
    daily: [...daily].sort(([left], [right]) => left.localeCompare(right))
      .map(([date, groups]) => ({ date, groups: summarize(groups) }))
  };
}

module.exports = { deviceFromHeaders, emptyAnalytics, recordVisit, reportAnalytics };
