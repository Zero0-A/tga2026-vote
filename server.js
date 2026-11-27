/**
 * TGA 2026 玩家票选 - 零依赖 Node.js 服务
 * 启动：node server.js   （默认 http://localhost:3000）
 * 后台：http://localhost:3000/admin （默认密码 sy42065#@#@！！，可用环境变量 ADMIN_PASSWORD 修改）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const categories = require('./data/categories');
const nomineeDetails = require('./data/nominee-details.json');
const nomineeVideos = require('./data/nominee-videos.json');
const { deviceFromHeaders, emptyAnalytics, recordVisit, reportAnalytics } = require('./data/analytics');
const { DAY_MS, dayKey, nextDayAt, ballotHistory, ballotForDay } = require('./data/ballots');
const { recordAwardOpen, reportAwardActivity } = require('./data/award-activity');
const { createArchive, readArchive, listArchives, archiveCsv, readPublication, publishArchive } = require('./data/archives');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sy42065#@#@！！';

/* 全角/半角标点视为等价：NFKC 会把 ！＃＠ 等折成半角，避免输入法差异导致登录失败 */
const normalizePassword = (value) => String(value).normalize('NFKC');
const PUBLIC_DIR = path.join(__dirname, 'public');
const COVER_DIR = path.join(PUBLIC_DIR, 'covers');
const STORAGE_DIR = path.join(__dirname, 'storage');
const DATA_FILE = process.env.DATA_FILE || path.join(STORAGE_DIR, 'votes.json');
const ARCHIVE_DIR = DATA_FILE + '.archives';
const CEREMONY_AT = '2026-12-11T08:30:00+08:00';
const RESULTS_AVAILABLE_AT = nextDayAt(Date.parse(CEREMONY_AT)) - 2 * DAY_MS;
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 小时

const validCategory = new Map(categories.map((c) => [c.id, new Set(c.nominees.map((n) => n.id))]));
const sessions = new Map(); // token -> expiresAt

/* ---------------- 数据存储 ---------------- */
function emptyState() {
  return { votes: {}, log: [], analytics: emptyAnalytics() };
}

function loadState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      votes: parsed.votes && typeof parsed.votes === 'object' ? parsed.votes : {},
      log: Array.isArray(parsed.log) ? parsed.log : [],
      analytics: parsed.analytics?.views ? parsed.analytics : emptyAnalytics()
    };
  } catch (err) {
    return emptyState();
  }
}

let state = loadState();
let publication = readPublication(ARCHIVE_DIR);

function saveState() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('[storage] 保存失败：', err.message);
  }
}

/* ---------------- 工具函数 ---------------- */
function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const result = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > -1) result[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return result;
}

function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function ensureVoter(req, res) {
  const cookies = parseCookies(req);
  if (cookies.voter && /^[a-f0-9-]{36}$/i.test(cookies.voter)) return cookies.voter;
  const id = crypto.randomUUID();
  res.setHeader('Set-Cookie', `voter=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  return id;
}

function isAdmin(req) {
  const token = parseCookies(req).admin_session;
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires) return false;
  if (Date.now() > expires) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function countsForCategory(category) {
  const votes = state.votes[category.id] || {};
  const map = new Map();
  for (const history of Object.values(votes)) {
    for (const vote of ballotHistory(history)) {
      const nomineeId = typeof vote === 'string' ? vote : vote?.nomineeId;
      if (nomineeId) map.set(nomineeId, (map.get(nomineeId) || 0) + 1);
    }
  }
  return category.nominees.map((n) => ({ id: n.id, votes: map.get(n.id) || 0 }));
}

function categoryTotal(categoryId) {
  return Object.values(state.votes[categoryId] || {}).reduce((sum, history) => sum + ballotHistory(history).length, 0);
}

function uniqueVoters() {
  const set = new Set();
  Object.values(state.votes).forEach((catVotes) => {
    Object.keys(catVotes || {}).forEach((voter) => set.add(voter));
  });
  return set.size;
}

function totalVotes() {
  return Object.keys(state.votes).reduce((sum, categoryId) => sum + categoryTotal(categoryId), 0);
}

function hasCoverFile(id) {
  try {
    return fs.statSync(path.join(COVER_DIR, id + '.jpg')).size > 1000;
  } catch (err) {
    return false;
  }
}

function publicState(voterId, serverNow) {
  const myVotes = {};
  const catVotes = state.votes;
  const today = dayKey(serverNow);
  categories.forEach((c) => {
    const vote = ballotForDay(catVotes[c.id]?.[voterId], today);
    if (vote) myVotes[c.id] = vote.nomineeId;
  });
  return {
    event: {
      name: '溯游工作室 · 2026 年度游戏票选',
      ceremonyAt: CEREMONY_AT,
      resultsOpen: serverNow >= RESULTS_AVAILABLE_AT,
      votingClosed: Boolean(publication),
      totalVotes: totalVotes(),
      voters: uniqueVoters(),
      categoryCount: categories.length
    },
    myVotes,
    serverNow,
    voteDayEndsAt: nextDayAt(serverNow),
    categories: categories.map((c) => ({
      id: c.id,
      en: c.en,
      cn: c.cn,
      tab: c.tab,
      total: categoryTotal(c.id),
      nominees: c.nominees.map((n) => ({
        ...n,
        cover: hasCoverFile(n.id),
        details: nomineeDetails[n.id] || nomineeVideos[n.id]
          ? { ...(nomineeDetails[n.id] || {}), video: nomineeVideos[n.id] }
          : undefined
      }))
    }))
  };
}

function resultSummary() {
  const resultCategories = categories.map((c) => {
    const counts = countsForCategory(c);
    const total = counts.reduce((s, n) => s + n.votes, 0);
    return {
      id: c.id,
      en: c.en,
      cn: c.cn,
      tab: c.tab,
      total,
      nominees: c.nominees
        .map((n) => {
          const cnt = (counts.find((x) => x.id === n.id) || { votes: 0 }).votes;
          return { id: n.id, name: n.name, en: n.en, votes: cnt, pct: total ? Math.round((cnt / total) * 1000) / 10 : 0 };
        })
        .sort((a, b) => b.votes - a.votes)
    };
  });
  return { totalVotes: totalVotes(), voters: uniqueVoters(), categories: resultCategories };
}

function adminStats() {
  const recent = state.log
    .slice(-30)
    .reverse()
    .map((item) => {
      const cat = categories.find((c) => c.id === item.categoryId);
      const nom = cat && cat.nominees.find((n) => n.id === item.nomineeId);
      return {
        category: cat ? cat.cn : item.categoryId,
        nominee: nom ? nom.name : item.nomineeId,
        ts: item.ts,
        device: item.device || 'unknown'
      };
    });
  return {
    ...resultSummary(),
    recent,
    analytics: reportAnalytics(state.analytics, state.votes)
  };
}

/* ---------------- 静态文件 ---------------- */
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf'
};

function serveStatic(res, urlPath) {
  let relative = decodeURIComponent(urlPath);
  if (relative === '/' || relative === '') relative = '/index.html';
  if (relative === '/results' || relative === '/results/') relative = '/results.html';
  if (relative === '/admin' || relative === '/admin/') relative = '/admin.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(relative));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (filePath.toLowerCase() === path.join(PUBLIC_DIR, 'results.html').toLowerCase() && Date.now() < RESULTS_AVAILABLE_AT) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('票选结果入口尚未开放。');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const extension = path.extname(filePath).toLowerCase();
    let contentType = MIME[extension] || 'application/octet-stream';
    // 旧封面链接统一以 .jpg 结尾，部分源图实际是 PNG 或 WebP。
    if (extension === '.jpg') {
      if (data.subarray(0, 8).equals(PNG_SIGNATURE)) contentType = 'image/png';
      else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
        contentType = 'image/webp';
      }
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

/* ---------------- 路由 ---------------- */
async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;
  // 公共：获取票选数据
  if (req.method === 'GET' && pathname === '/api/state') {
    const voterId = ensureVoter(req, res);
    const serverNow = Date.now();
    if (req.headers['x-suyou-view'] === '1') {
      recordVisit(state.analytics, voterId, deviceFromHeaders(req.headers), serverNow, searchParams.get('utm_source'));
      saveState();
    }
    return sendJson(res, 200, publicState(voterId, serverNow));
  }

  if (req.method === 'POST' && pathname === '/api/award-view') {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJson(res, 400, { error: '请求格式错误' });
    }
    if (!validCategory.has(body?.categoryId)) {
      return sendJson(res, 400, { error: '无效的奖项' });
    }
    const voterId = ensureVoter(req, res);
    recordAwardOpen(state.analytics, body.categoryId, voterId, Date.now());
    saveState();
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    return res.end();
  }

  if (req.method === 'GET' && pathname === '/api/results') {
    const open = Date.now() >= RESULTS_AVAILABLE_AT;
    return sendJson(res, open ? 200 : 403, { availableAt: RESULTS_AVAILABLE_AT, results: open ? publication : null });
  }

  // 公共：投票
  if (req.method === 'POST' && pathname === '/api/vote') {
    const voterId = ensureVoter(req, res);
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: '请求格式错误' });
    }
    if (publication) return sendJson(res, 403, { code: 'VOTING_CLOSED', error: '本次投票已结束。' });
    const { categoryId, nomineeId } = body ?? {};
    const category = categories.find((c) => c.id === categoryId);
    if (!category || !validCategory.get(categoryId).has(nomineeId)) {
      return sendJson(res, 400, { error: '无效的奖项或提名' });
    }
    const ts = Date.now();
    const voteClock = { serverNow: ts, voteDayEndsAt: nextDayAt(ts) };
    const votes = state.votes[categoryId] ??= {};
    const history = ballotHistory(votes[voterId]);
    const existing = ballotForDay(history, dayKey(ts));
    if (existing) {
      return sendJson(res, 409, {
        error: '你今天已经在该奖项投过票了',
        votedFor: existing.nomineeId,
        categoryTotal: categoryTotal(categoryId),
        ...voteClock
      });
    }
    const device = deviceFromHeaders(req.headers);
    state.analytics.startedAt ??= ts;
    votes[voterId] = [...history, { nomineeId, ts, device }];
    state.log.push({ categoryId, nomineeId, ts, device });
    if (state.log.length > 2000) state.log = state.log.slice(-2000);
    saveState();
    return sendJson(res, 200, {
      ok: true,
      votedFor: nomineeId,
      categoryTotal: categoryTotal(categoryId),
      totalVotes: totalVotes(),
      voters: uniqueVoters(),
      ...voteClock
    });
  }

  // 后台：登录
  if (req.method === 'POST' && pathname === '/api/admin/login') {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: '请求格式错误' });
    }
    const input = normalizePassword(body.password || '');
    const a = Buffer.from(input);
    const b = Buffer.from(normalizePassword(ADMIN_PASSWORD));
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return sendJson(res, 401, { error: '密码错误' });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`
    });
  }

  // 后台：退出
  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    const token = parseCookies(req).admin_session;
    if (token) sessions.delete(token);
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': 'admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
    });
  }

  // 后台：数据统计
  if (req.method === 'GET' && pathname === '/api/admin/stats') {
    if (!isAdmin(req)) return sendJson(res, 401, { error: '未登录' });
    return sendJson(res, 200, adminStats());
  }

  if (req.method === 'GET' && pathname === '/api/admin/award-activity') {
    if (!isAdmin(req)) return sendJson(res, 401, { error: '未登录' });
    const categoryId = searchParams.get('categoryId');
    const category = categories.find(item => item.id === categoryId);
    if (!category) return sendJson(res, 404, { error: '未找到奖项' });
    return sendJson(res, 200, reportAwardActivity(state.analytics, category, state.votes[categoryId]));
  }

  if (pathname === '/api/admin/archives') {
    if (!isAdmin(req)) return sendJson(res, 401, { error: '未登录' });
    if (req.method === 'GET') return sendJson(res, 200, {
      archives: listArchives(ARCHIVE_DIR),
      publishedId: publication?.id ?? null,
      availableAt: RESULTS_AVAILABLE_AT,
      canPublish: Date.now() >= RESULTS_AVAILABLE_AT && !publication
    });
    if (req.method === 'POST') {
      const archive = createArchive(ARCHIVE_DIR, resultSummary(), state);
      return sendJson(res, 201, { archive });
    }
  }

  if (req.method === 'POST' && pathname === '/api/admin/publish-results') {
    if (!isAdmin(req)) return sendJson(res, 401, { error: '未登录' });
    if (publication) return sendJson(res, 409, { error: '结果已经公布。' });
    if (Date.now() < RESULTS_AVAILABLE_AT) return sendJson(res, 409, { error: '颁奖典礼前一天起可公布结果。' });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJson(res, 400, { error: '请求格式错误' });
    }
    if (publication) return sendJson(res, 409, { error: '结果已经公布。' });
    const archive = typeof body?.archiveId === 'string' && readArchive(ARCHIVE_DIR, body.archiveId);
    if (!archive) return sendJson(res, 404, { error: '未找到归档' });
    if (JSON.stringify(archive.backup.votes) !== JSON.stringify(state.votes)) {
      return sendJson(res, 409, { error: '归档后票数已有变化，请重新归档再公布。' });
    }
    publication = publishArchive(ARCHIVE_DIR, archive, Date.now());
    return sendJson(res, 201, { id: publication.id, publishedAt: publication.publishedAt });
  }

  const archivePath = pathname.match(/^\/api\/admin\/archives\/([^/]+)\/(results|backup)$/);
  if (req.method === 'GET' && archivePath) {
    if (!isAdmin(req)) return sendJson(res, 401, { error: '未登录' });
    const [, id, format] = archivePath;
    const archive = readArchive(ARCHIVE_DIR, id);
    if (!archive) return sendJson(res, 404, { error: '未找到归档' });
    if (format === 'backup') {
      return sendJson(res, 200, archive.backup, {
        'Content-Disposition': 'attachment; filename="suyou-backup-' + id + '.json"'
      });
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="suyou-results-' + id + '.csv"',
      'Cache-Control': 'no-store'
    });
    return res.end(archiveCsv(archive));
  }

  // 后台：重置数据
  if (req.method === 'POST' && pathname === '/api/admin/reset') {
    if (!isAdmin(req)) return sendJson(res, 401, { error: '未登录' });
    let body = {};
    try {
      body = await readBody(req);
    } catch (err) {
      body = {};
    }
    if (publication) return sendJson(res, 409, { error: '结果已经公布，投票数据已锁定。' });
    if (body.categoryId) {
      delete state.votes[body.categoryId];
      state.log = state.log.filter((x) => x.categoryId !== body.categoryId);
    } else {
      state = { ...emptyState(), analytics: state.analytics };
    }
    saveState();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: '接口不存在' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end('Method Not Allowed');
    }
    serveStatic(res, pathname);
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`溯游工作室票选已启动：http://localhost:${PORT}`);
  console.log(`后台地址：http://localhost:${PORT}/admin`);
  console.log(`数据文件：${DATA_FILE}`);
});

process.on('SIGINT', () => {
  saveState();
  process.exit(0);
});
