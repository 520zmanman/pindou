'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { DatabaseSync } = require('node:sqlite');

const scrypt = promisify(crypto.scrypt);
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 4173);
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const draftLifetime = 3 * 24 * 60 * 60 * 1000;
const maximumDraftBytes = 12 * 1024 * 1024;
const pricing = Object.freeze({ ownPdfFen: 10, sharedPdfFen: 1, currency: 'CNY', paymentMode: 'wallet' });
const wechatPayEnvironment = Object.freeze([
  'WECHATPAY_MCHID', 'WECHATPAY_APPID', 'WECHATPAY_CERT_SERIAL_NO', 'WECHATPAY_PRIVATE_KEY_PATH',
  'WECHATPAY_PUBLIC_KEY_ID', 'WECHATPAY_PUBLIC_KEY_PATH', 'WECHATPAY_API_V3_KEY', 'WECHATPAY_NOTIFY_URL'
]);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

const dataDirectory = process.env.PINDOU_DATA_DIR
  ? path.resolve(process.env.PINDOU_DATA_DIR)
  : path.join(__dirname, 'data');
fs.mkdirSync(dataDirectory, { recursive: true });

const databasePath = path.join(dataDirectory, 'pindou.db');
const db = new DatabaseSync(databasePath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'superuser')),
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    email TEXT COLLATE NOCASE UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    phone TEXT UNIQUE,
    phone_verified INTEGER NOT NULL DEFAULT 0,
    balance_fen INTEGER NOT NULL DEFAULT 0 CHECK (balance_fen >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('email', 'phone')),
    destination TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('bind', 'reset_password')),
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS drafts (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS drafts_expires_at ON drafts(expires_at);

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('recharge', 'own_pdf', 'shared_pdf')),
    amount_fen INTEGER NOT NULL CHECK (amount_fen >= 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
    provider TEXT,
    provider_trade_no TEXT,
    created_at INTEGER NOT NULL,
    paid_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS orders_user_id ON orders(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS wallet_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    delta_fen INTEGER NOT NULL,
    balance_after_fen INTEGER NOT NULL CHECK (balance_after_fen >= 0),
    reason TEXT NOT NULL,
    reference_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS wallet_ledger_user_id ON wallet_ledger(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    project_payload TEXT NOT NULL,
    price_fen INTEGER NOT NULL DEFAULT 1 CHECK (price_fen >= 0),
    status TEXT NOT NULL DEFAULT 'private' CHECK (status IN ('private', 'published', 'hidden')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    order_id TEXT NOT NULL REFERENCES orders(id),
    share_id TEXT REFERENCES shares(id),
    kind TEXT NOT NULL CHECK (kind IN ('own_pdf', 'shared_pdf')),
    created_at INTEGER NOT NULL
  );
`);

const userColumns = db.prepare('PRAGMA table_info(users)').all();
if (!userColumns.some(column => column.name === 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'superuser'))");
}

const statements = {
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE LIMIT 1'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE LIMIT 1'),
  userByLogin: db.prepare(`
    SELECT * FROM users
    WHERE username = ? COLLATE NOCASE
       OR (email = ? COLLATE NOCASE AND email_verified = 1)
       OR (phone = ? AND phone_verified = 1)
    LIMIT 1
  `),
  insertUser: db.prepare(`
    INSERT INTO users (username, password_hash, password_salt, email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  sessionUser: db.prepare(`
    SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    LIMIT 1
  `),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  deleteExpiredDrafts: db.prepare('DELETE FROM drafts WHERE expires_at <= ?'),
  draftByUser: db.prepare('SELECT payload, updated_at, expires_at FROM drafts WHERE user_id = ? LIMIT 1'),
  upsertDraft: db.prepare(`
    INSERT INTO drafts (user_id, payload, updated_at, expires_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, expires_at = excluded.expires_at
  `),
  deleteDraftByUser: db.prepare('DELETE FROM drafts WHERE user_id = ?'),
};

const publicFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/style.css', 'style.css'],
  ['/app.js', 'app.js'],
  ['/account.js', 'account.js'],
  ['/mard-palette.js', 'mard-palette.js'],
]);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
};

function respond(req, res, statusCode, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(statusCode, {
    ...securityHeaders,
    'Content-Length': payload.length,
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : payload);
}

function respondJson(req, res, statusCode, data, headers = {}) {
  respond(req, res, statusCode, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
}

function normalizeUsername(value) {
  return String(value || '').normalize('NFKC').trim();
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

function validUsername(username) {
  return username.length >= 3 && username.length <= 24 && /^[\p{L}\p{N}_-]+$/u.test(username);
}

function validEmail(email) {
  return !email || (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

async function passwordDigest(password, salt) {
  const result = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return Buffer.from(result).toString('base64url');
}

async function createPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  return { salt, hash: await passwordDigest(password, salt) };
}

async function passwordMatches(password, salt, expectedHash) {
  const actual = Buffer.from(await passwordDigest(password, salt), 'base64url');
  const expected = Buffer.from(expectedHash, 'base64url');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return cookies;
}

function sessionCookie(req, value, maxAgeSeconds) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1';
  return `pindou_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id), username: row.username, email: row.email || null, emailVerified: Boolean(row.email_verified),
    phone: row.phone || null, phoneVerified: Boolean(row.phone_verified), balanceFen: Number(row.balance_fen || 0),
    role: row.role || 'user', isSuperuser: row.role === 'superuser', createdAt: Number(row.created_at)
  };
}

function currentUser(req) {
  const token = parseCookies(req).pindou_session;
  if (!token || token.length > 200) return null;
  return statements.sessionUser.get(tokenHash(token), Date.now()) || null;
}

function issueSession(req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  statements.insertSession.run(tokenHash(token), userId, now, now + sessionLifetime);
  return sessionCookie(req, token, Math.floor(sessionLifetime / 1000));
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function wechatPayStatus() {
  const missing = wechatPayEnvironment.filter(name => !process.env[name]);
  return { provider: 'wechatpay_native', configured: missing.length === 0, missing };
}

function validDraftProject(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) return false;
  if (project.version !== 1 || typeof project.fileName !== 'string' || project.fileName.length > 255) return false;
  if (typeof project.imageSrc !== 'string' || !/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(project.imageSrc)) return false;
  if (!project.settings || typeof project.settings !== 'object') return false;
  if (!Array.isArray(project.manualOverrides) || !Array.isArray(project.colorReplacements)) return false;
  return true;
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { const error = new Error('请求内容过大'); error.statusCode = 413; reject(error); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > limit) return;
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { const error = new Error('请求内容不是有效的 JSON'); error.statusCode = 400; reject(error); }
    });
    req.on('error', reject);
  });
}

const rateLimits = new Map();
function allowAttempt(req, bucket, maximum = 12, windowMs = 15 * 60 * 1000) {
  const key = `${bucket}:${req.socket.remoteAddress || 'unknown'}`;
  const now = Date.now(); const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) { rateLimits.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  current.count++;
  return current.count <= maximum;
}

async function handleRegister(req, res) {
  if (!allowAttempt(req, 'register', 8)) return respondJson(req, res, 429, { error: '注册尝试过于频繁，请稍后再试' });
  const body = await readJson(req);
  const username = normalizeUsername(body.username), email = normalizeEmail(body.email), password = String(body.password || '');
  if (!validUsername(username)) return respondJson(req, res, 400, { error: '用户名需为 3–24 位文字、字母、数字、下划线或短横线' });
  if (password.length < 8 || password.length > 72) return respondJson(req, res, 400, { error: '密码长度需为 8–72 位' });
  if (!validEmail(email)) return respondJson(req, res, 400, { error: '邮箱格式不正确' });
  if (statements.userByUsername.get(username)) return respondJson(req, res, 409, { error: '该用户名已被使用' });
  if (email && statements.userByEmail.get(email)) return respondJson(req, res, 409, { error: '该邮箱已绑定其他账号' });

  const credentials = await createPassword(password); const now = Date.now();
  const result = statements.insertUser.run(username, credentials.hash, credentials.salt, email, now, now);
  const user = statements.userByUsername.get(username);
  respondJson(req, res, 201, { message: '账号创建成功', user: publicUser(user), pricing }, { 'Set-Cookie': issueSession(req, Number(result.lastInsertRowid)) });
}

async function handleLogin(req, res) {
  if (!allowAttempt(req, 'login', 15)) return respondJson(req, res, 429, { error: '登录尝试过于频繁，请稍后再试' });
  const body = await readJson(req);
  const identifier = String(body.identifier || '').normalize('NFKC').trim();
  const password = String(body.password || '');
  if (!identifier || !password || password.length > 72) return respondJson(req, res, 400, { error: '请输入账号和密码' });
  const user = statements.userByLogin.get(identifier, identifier.toLowerCase(), identifier);
  const matches = user ? await passwordMatches(password, user.password_salt, user.password_hash) : false;
  if (!matches) return respondJson(req, res, 401, { error: '账号或密码不正确；邮箱和手机号需验证后才能登录' });
  respondJson(req, res, 200, { message: '登录成功', user: publicUser(user), pricing }, { 'Set-Cookie': issueSession(req, Number(user.id)) });
}

async function handleDraft(req, res) {
  const user = currentUser(req);
  if (!user) return respondJson(req, res, 401, { error: '请先登录后再使用云草稿' });

  if (req.method === 'GET') {
    const row = statements.draftByUser.get(Number(user.id));
    if (!row) return respondJson(req, res, 200, { draft: null });
    if (Number(row.expires_at) <= Date.now()) {
      statements.deleteDraftByUser.run(Number(user.id));
      return respondJson(req, res, 200, { draft: null, expired: true });
    }
    try {
      return respondJson(req, res, 200, { draft: JSON.parse(row.payload), updatedAt: Number(row.updated_at), expiresAt: Number(row.expires_at) });
    } catch {
      statements.deleteDraftByUser.run(Number(user.id));
      return respondJson(req, res, 200, { draft: null, corrupted: true });
    }
  }

  if (req.method === 'PUT') {
    const body = await readJson(req, maximumDraftBytes + 512 * 1024);
    if (!validDraftProject(body.project)) return respondJson(req, res, 400, { error: '云草稿数据格式不正确' });
    const now = Date.now(), expiresAt = now + draftLifetime;
    const project = { ...body.project, savedAt: now, expiresAt };
    const payload = JSON.stringify(project);
    if (Buffer.byteLength(payload) > maximumDraftBytes) return respondJson(req, res, 413, { error: '草稿超过 12 MB 上限，请使用尺寸更小的原图' });
    statements.upsertDraft.run(Number(user.id), payload, now, expiresAt);
    return respondJson(req, res, 200, { saved: true, updatedAt: now, expiresAt });
  }

  if (req.method === 'DELETE') {
    statements.deleteDraftByUser.run(Number(user.id));
    return respondJson(req, res, 200, { deleted: true });
  }

  return respondJson(req, res, 405, { error: '请求方法不支持' }, { Allow: 'GET, PUT, DELETE' });
}

async function handleApi(req, res, pathname) {
  if (!sameOrigin(req)) return respondJson(req, res, 403, { error: '请求来源不受信任' });
  if (pathname === '/api/health' && req.method === 'GET') return respondJson(req, res, 200, { ok: true, database: 'sqlite' });
  if (pathname === '/api/billing/config' && req.method === 'GET') return respondJson(req, res, 200, { pricing, rechargeEnabled: false, wechatPay: wechatPayStatus() });
  if (pathname === '/api/auth/me' && req.method === 'GET') return respondJson(req, res, 200, { user: publicUser(currentUser(req)), pricing });
  if (pathname === '/api/draft') return handleDraft(req, res);
  if (pathname === '/api/auth/register' && req.method === 'POST') return handleRegister(req, res);
  if (pathname === '/api/auth/login' && req.method === 'POST') return handleLogin(req, res);
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = parseCookies(req).pindou_session;
    if (token) statements.deleteSession.run(tokenHash(token));
    return respondJson(req, res, 200, { message: '已退出登录' }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  respondJson(req, res, 404, { error: '接口不存在' });
}

async function handleRequest(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { return respond(req, res, 400, 'Bad Request'); }

  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') return respond(req, res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });

  const relativePath = publicFiles.get(pathname);
  if (!relativePath) return respond(req, res, 404, 'Not Found');
  const filePath = path.join(__dirname, relativePath);
  fs.readFile(filePath, (error, data) => {
    if (error) return respond(req, res, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not Found' : 'Internal Server Error');
    respond(req, res, 200, data, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
  });
}

function cleanupExpired() {
  const now = Date.now();
  statements.deleteExpiredSessions.run(now);
  statements.deleteExpiredDrafts.run(now);
}
cleanupExpired();
const cleanupTimer = setInterval(cleanupExpired, 60 * 60 * 1000);
cleanupTimer.unref();

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    console.error(error);
    if (!res.headersSent) respondJson(req, res, error.statusCode || 500, { error: error.statusCode ? error.message : '服务器内部错误' });
    else res.end();
  });
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Close the other server or set another PORT.`);
  else console.error(error);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log('豆格本地服务器已启动：');
  console.log(`  本机访问：http://localhost:${port}`);
  for (const address of [...new Set(Object.values(os.networkInterfaces()).flatMap(items => (items || []).filter(item => item.family === 'IPv4' && !item.internal).map(item => item.address)))]) {
    console.log(`  局域网访问：http://${address}:${port}`);
  }
  console.log(`  账号数据库：${databasePath}`);
  console.log('按 Ctrl+C 停止服务器。');
});

function shutdown() {
  clearInterval(cleanupTimer);
  server.close(() => { db.close(); process.exit(0); });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
