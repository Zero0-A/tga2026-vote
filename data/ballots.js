const DAY_MS = 24 * 60 * 60 * 1000;
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;

function dayKey(timestamp) {
  return new Date(timestamp + BEIJING_OFFSET).toISOString().slice(0, 10);
}

function nextDayAt(timestamp) {
  const day = Math.floor((timestamp + BEIJING_OFFSET) / DAY_MS);
  return (day + 1) * DAY_MS - BEIJING_OFFSET;
}

function ballotHistory(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function ballotForDay(value, date) {
  return ballotHistory(value).find(ballot => Number.isFinite(ballot?.ts) && dayKey(ballot.ts) === date);
}

module.exports = { DAY_MS, dayKey, nextDayAt, ballotHistory, ballotForDay };
