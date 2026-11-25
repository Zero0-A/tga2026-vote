const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const archiveId = /^\d{13}-[a-f0-9]{8}$/;

function archiveSummary({ id, archivedAt, results }) {
  return { id, archivedAt, totalVotes: results.totalVotes, voters: results.voters };
}

function createArchive(directory, results, backup, archivedAt = Date.now()) {
  const id = archivedAt + '-' + randomBytes(4).toString('hex');
  const archive = { id, archivedAt, results, backup };
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, id + '.json');
  fs.writeFileSync(filename + '.tmp', JSON.stringify(archive, null, 2), { flag: 'wx' });
  fs.renameSync(filename + '.tmp', filename);
  return archiveSummary(archive);
}

function readArchive(directory, id) {
  if (!archiveId.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(directory, id + '.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function listArchives(directory) {
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return names.filter(name => name.endsWith('.json') && archiveId.test(name.slice(0, -5)))
    .sort().reverse().map(name => readArchive(directory, name.slice(0, -5)))
    .filter(Boolean).map(archiveSummary);
}

function archiveCsv(archive) {
  const { results } = archive;
  const captured = new Date(archive.archivedAt).toISOString();
  const lines = [['归档时间（UTC）', '总票数', '参与人数', '奖项', '候选', '票数', '得票率']];
  for (const category of results.categories) {
    for (const nominee of category.nominees) {
      lines.push([captured, results.totalVotes, results.voters, category.cn, nominee.name, nominee.votes, nominee.pct + '%']);
    }
  }
  return '\uFEFF' + lines.map(row => row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(',')).join('\r\n');
}

module.exports = { createArchive, readArchive, listArchives, archiveCsv };
