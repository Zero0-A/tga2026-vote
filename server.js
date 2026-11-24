/**
 * TGA 2026 玩家票选 - 零依赖 Node.js 服务
 * 启动：node server.js   （默认 http://localhost:3000）
 * 后台：http://localhost:3000/admin （默认密码 tga2026admin，可用环境变量 ADMIN_PASSWORD 修改）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const categories = require('./data/categories');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tga2026admin';
const PUBLIC_DIR = path.join(__dirname, 'public');
const COVER_DIR = path.join(PUBLIC_DIR, 'covers');
const STORAGE_DIR = path.join(__dirname, 'storage');
const DATA_FILE = process.env.DATA_FILE || path.join(STORAGE_DIR, 'votes.json');
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 小时

const validCategory = new Map(categories.map((c) => [c.id, new Set(c.nominees.map((n) => n.id))]));
const sessions = new Map(); // token -> expiresAt

/* ---------------- 数据存储 ---------------- */
function emptyState() {
  return { votes: {}, log: [] };
}

function loadState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      votes: parsed.votes && typeof parsed.votes === 'object' ? parsed.votes : {},
      log: Array.isArray(parsed.log) ? parsed.log : []
    };
  } catch (err) {
    return emptyState();
  }
}

let state = loadState();

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
  Object.values(votes).forEach((v) => {
    const nomineeId = typeof v === 'string' ? v : v && v.nomineeId;
    if (!nomineeId) return;
    map.set(nomineeId, (map.get(nomineeId) || 0) + 1);
  });
  return category.nominees.map((n) => ({ id: n.id, votes: map.get(n.id) || 0 }));
}

function uniqueVoters() {
  const set = new Set();
  Object.values(state.votes).forEach((catVotes) => {
    Object.keys(catVotes || {}).forEach((voter) => set.add(voter));
  });
  return set.size;
}

function totalVotes() {
  return Object.values(state.votes).reduce((sum, catVotes) => sum + Object.keys(catVotes || {}).length, 0);
}

function hasCoverFile(id) {
  try {
    return fs.statSync(path.join(COVER_DIR, id + '.jpg')).size > 1000;
  } catch (err) {
    return false;
  }
}

function publicState(voterId) {
  const myVotes = {};
  const catVotes = state.votes;
  categories.forEach((c) => {
    const v = catVotes[c.id] && catVotes[c.id][voterId];
    if (v) myVotes[c.id] = typeof v === 'string' ? v : v.nomineeId;
  });
  return {
    event: {
      name: 'TGA 2026',
      ceremonyAt: '2026-12-11T12:00:00+08:00',
      totalVotes: totalVotes(),
      voters: uniqueVoters(),
      categoryCount: categories.length
    },
    myVotes,
    categories: categories.map((c) => ({
      id: c.id,
      en: c.en,
      cn: c.cn,
      tab: c.tab,
      counts: countsForCategory(c),
      nominees: c.nominees.map((n) => ({ ...n, cover: hasCoverFile(n.id) }))
    }))
  };
}

function adminStats() {
  const list = categories.map((c) => {
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
  const recent = state.log
    .slice(-30)
    .reverse()
    .map((item) => {
      const cat = categories.find((c) => c.id === item.categoryId);
      const nom = cat && cat.nominees.find((n) => n.id === item.nomineeId);
      return {
        category: cat ? cat.cn : item.categoryId,
        nominee: nom ? nom.name : item.nomineeId,
        ts: item.ts
      };
    });
  return {
    totalVotes: totalVotes(),
    voters: uniqueVoters(),
    categories: list,
    recent
  };
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function serveStatic(res, urlPath) {
  let relative = decodeURIComponent(urlPath);
  if (relative === '/' || relative === '') relative = '/index.html';
  if (relative === '/admin' || relative === '/admin/') relative = '/admin.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(relative));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

/* ---------------- 路由 ---------------- */
async function handleApi(req, res, pathname) {
  // 公共：获取票选数据
  if (req.method === 'GET' && pathname === '/api/state') {
    const voterId = ensureVoter(req, res);
    return sendJson(res, 200, publicState(voterId));
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
    const { categoryId, nomineeId } = body;
    const category = categories.find((c) => c.id === categoryId);
    if (!category || !validCategory.get(categoryId).has(nomineeId)) {
      return sendJson(res, 400, { error: '无效的奖项或提名' });
    }
    state.votes[categoryId] = state.votes[categoryId] || {};
    const existing = state.votes[categoryId][voterId];
    if (existing) {
      const existingId = typeof existing === 'string' ? existing : existing.nomineeId;
      return sendJson(res, 409, {
        error: '你已经在该奖项投过票了',
        votedFor: existingId,
        counts: countsForCategory(category)
      });
    }
    state.votes[categoryId][voterId] = { nomineeId, ts: Date.now() };
    state.log.push({ categoryId, nomineeId, ts: Date.now() });
    if (state.log.length > 2000) state.log = state.log.slice(-2000);
    saveState();
    return sendJson(res, 200, {
      ok: true,
      votedFor: nomineeId,
      counts: countsForCategory(category),
      totalVotes: totalVotes(),
      voters: uniqueVoters()
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
    const input = String(body.password || '');
    const a = Buffer.from(input);
    const b = Buffer.from(ADMIN_PASSWORD);
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

  // 后台：重置数据
  if (req.method === 'POST' && pathname === '/api/admin/reset') {
    if (!isAdmin(req)) return sendJson(res, 401, { error: '未登录' });
    let body = {};
    try {
      body = await readBody(req);
    } catch (err) {
      body = {};
    }
    if (body.categoryId) {
      delete state.votes[body.categoryId];
      state.log = state.log.filter((x) => x.categoryId !== body.categoryId);
    } else {
      state = emptyState();
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
      await handleApi(req, res, pathname);
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
  console.log(`TGA 2026 票选已启动：http://localhost:${PORT}`);
  console.log(`后台地址：http://localhost:${PORT}/admin`);
  console.log(`数据文件：${DATA_FILE}`);
});

process.on('SIGINT', () => {
  saveState();
  process.exit(0);
});
