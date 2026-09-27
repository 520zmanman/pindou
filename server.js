'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const tls = require('tls');
const { promisify } = require('util');
const { DatabaseSync } = require('node:sqlite');

const scrypt = promisify(crypto.scrypt);
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 4173);
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const draftLifetime = 3 * 24 * 60 * 60 * 1000;
const maximumDraftBytes = 12 * 1024 * 1024;
const verificationLifetime = 10 * 60 * 1000;
const verificationResendInterval = 60 * 1000;
const pricing = Object.freeze({ guestOwnPdfFen: 100, memberOwnPdfFen: 50, sharedPdfFen: 1, currency: 'CNY', paymentMode: 'wechatpay_native' });
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

const verificationSecretPath = path.join(dataDirectory, 'verification-secret');
let verificationSecret;
try { verificationSecret = fs.readFileSync(verificationSecretPath); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  verificationSecret = crypto.randomBytes(32);
  fs.writeFileSync(verificationSecretPath, verificationSecret, { mode: 0o600 });
}

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
  userByPhone: db.prepare('SELECT * FROM users WHERE phone = ? LIMIT 1'),
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
  insertVerificationCode: db.prepare(`
    INSERT INTO verification_codes (user_id, channel, destination, purpose, code_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  latestVerificationCode: db.prepare(`
    SELECT * FROM verification_codes
    WHERE user_id = ? AND channel = ? AND destination = ? AND purpose = ? AND consumed_at IS NULL
    ORDER BY id DESC LIMIT 1
  `),
  incrementVerificationAttempts: db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?'),
  consumeVerificationCode: db.prepare('UPDATE verification_codes SET consumed_at = ? WHERE id = ?'),
  deleteExpiredVerificationCodes: db.prepare('DELETE FROM verification_codes WHERE expires_at <= ? OR consumed_at IS NOT NULL'),
  updateVerifiedEmail: db.prepare('UPDATE users SET email = ?, email_verified = 1, updated_at = ? WHERE id = ?'),
  updateVerifiedPhone: db.prepare('UPDATE users SET phone = ?, phone_verified = 1, updated_at = ? WHERE id = ?'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?'),
  deleteSessionsByUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
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

function normalizePhone(value) {
  const phone = String(value || '').replace(/[\s()-]/g, '');
  if (/^1\d{10}$/.test(phone)) return `+86${phone}`;
  if (/^86(1\d{10})$/.test(phone)) return `+${phone}`;
  return phone;
}

function validPhone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

function verificationProviderStatus() {
  const consoleMode = process.env.PINDOU_VERIFICATION_MODE === 'console';
  const emailConfigured = consoleMode || ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'].every(name => process.env[name]);
  const smsConfigured = consoleMode || [
    'TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY', 'TENCENT_SMS_SDK_APP_ID',
    'TENCENT_SMS_SIGN_NAME', 'TENCENT_SMS_TEMPLATE_ID'
  ].every(name => process.env[name]);
  return { mode: consoleMode ? 'console' : 'production', emailConfigured, smsConfigured };
}

function verificationCodeHash(userId, channel, destination, purpose, code) {
  return crypto.createHmac('sha256', verificationSecret)
    .update(`${userId}:${channel}:${destination}:${purpose}:${code}`)
    .digest('hex');
}

function smtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => finish(new Error('邮件服务器响应超时')), 15000);
    function finish(error, value) {
      clearTimeout(timer); socket.off('data', onData); socket.off('error', onError);
      if (error) reject(error); else resolve(value);
    }
    function onError(error) { finish(error); }
    function onData(chunk) {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(last)) finish(null, { code: Number(last.slice(0, 3)), message: buffer.trim() });
    }
    socket.on('data', onData); socket.on('error', onError);
  });
}

async function smtpCommand(socket, command, acceptedCodes) {
  if (command !== null) socket.write(`${command}\r\n`);
  const response = await smtpResponse(socket);
  if (!acceptedCodes.includes(response.code)) throw new Error(`邮件服务器拒绝请求：${response.message}`);
  return response;
}

async function sendEmailCode(destination, code) {
  const hostName = process.env.SMTP_HOST, portNumber = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER, password = process.env.SMTP_PASS, from = process.env.SMTP_FROM;
  if (![hostName, user, password, from].every(Boolean)) throw Object.assign(new Error('邮箱验证码服务尚未配置'), { statusCode: 503 });
  if (![destination, from].every(value => !/[\r\n]/.test(value))) throw Object.assign(new Error('邮箱地址不合法'), { statusCode: 400 });
  const socket = tls.connect({ host: hostName, port: portNumber, servername: hostName, rejectUnauthorized: process.env.SMTP_ALLOW_INSECURE !== '1' });
  await new Promise((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject); });
  try {
    await smtpCommand(socket, null, [220]);
    await smtpCommand(socket, `EHLO ${process.env.SMTP_HELO || 'pindou.local'}`, [250]);
    await smtpCommand(socket, 'AUTH LOGIN', [334]);
    await smtpCommand(socket, Buffer.from(user).toString('base64'), [334]);
    await smtpCommand(socket, Buffer.from(password).toString('base64'), [235]);
    await smtpCommand(socket, `MAIL FROM:<${from}>`, [250]);
    await smtpCommand(socket, `RCPT TO:<${destination}>`, [250, 251]);
    await smtpCommand(socket, 'DATA', [354]);
    const subject = `=?UTF-8?B?${Buffer.from('豆格找回密码验证码').toString('base64')}?=`;
    const body = Buffer.from(`你的豆格验证码是：${code}\n\n验证码 10 分钟内有效，请勿告知他人。`).toString('base64');
    const message = [
      `From: 豆格 <${from}>`, `To: <${destination}>`, `Subject: ${subject}`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body
    ].join('\r\n');
    await smtpCommand(socket, `${message}\r\n.`, [250]);
    await smtpCommand(socket, 'QUIT', [221]);
  } finally { socket.destroy(); }
}

function sha256Hex(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function hmac(key, value) { return crypto.createHmac('sha256', key).update(value).digest(); }

async function sendTencentSmsCode(destination, code) {
  const secretId = process.env.TENCENTCLOUD_SECRET_ID, secretKey = process.env.TENCENTCLOUD_SECRET_KEY;
  const sdkAppId = process.env.TENCENT_SMS_SDK_APP_ID, signName = process.env.TENCENT_SMS_SIGN_NAME;
  const templateId = process.env.TENCENT_SMS_TEMPLATE_ID, region = process.env.TENCENT_SMS_REGION || 'ap-guangzhou';
  if (![secretId, secretKey, sdkAppId, signName, templateId].every(Boolean)) throw Object.assign(new Error('手机验证码服务尚未配置'), { statusCode: 503 });
  const payload = JSON.stringify({
    PhoneNumberSet: [destination], SmsSdkAppId: sdkAppId, SignName: signName,
    TemplateId: templateId, TemplateParamSet: [code, '10']
  });
  const timestamp = Math.floor(Date.now() / 1000), date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = 'content-type:application/json; charset=utf-8\nhost:sms.tencentcloudapi.com\nx-tc-action:sendsms\n';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(payload)}`;
  const credentialScope = `${date}/sms/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const secretDate = hmac(`TC3${secretKey}`, date), secretService = hmac(secretDate, 'sms'), secretSigning = hmac(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const result = await new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'sms.tencentcloudapi.com', path: '/', method: 'POST',
      headers: {
        Authorization: authorization, 'Content-Type': 'application/json; charset=utf-8', Host: 'sms.tencentcloudapi.com',
        'X-TC-Action': 'SendSms', 'X-TC-Timestamp': String(timestamp), 'X-TC-Version': '2021-01-11', 'X-TC-Region': region,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('短信服务返回了无法识别的数据')); }
      });
    });
    request.setTimeout(15000, () => request.destroy(new Error('短信服务响应超时')));
    request.on('error', reject); request.end(payload);
  });
  if (result.Response && result.Response.Error) throw new Error(`短信发送失败：${result.Response.Error.Message}`);
  const status = result.Response && result.Response.SendStatusSet && result.Response.SendStatusSet[0];
  if (!status || status.Code !== 'Ok') throw new Error(`短信发送失败：${status ? status.Message : '未知错误'}`);
}

async function deliverVerificationCode(channel, destination, code) {
  if (process.env.PINDOU_VERIFICATION_MODE === 'console') {
    console.log(`[仅限本地测试] ${channel} ${destination} 的验证码：${code}`);
    return { developmentCode: code };
  }
  if (channel === 'email') await sendEmailCode(destination, code);
  else await sendTencentSmsCode(destination, code);
  return {};
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

function destinationForChannel(channel, value) {
  if (channel === 'email') {
    const email = normalizeEmail(value);
    if (!email || !validEmail(email)) throw Object.assign(new Error('请输入有效的邮箱地址'), { statusCode: 400 });
    return email;
  }
  if (channel === 'phone') {
    const phone = normalizePhone(value);
    if (!validPhone(phone)) throw Object.assign(new Error('请输入有效的手机号，例如 13800138000'), { statusCode: 400 });
    return phone;
  }
  throw Object.assign(new Error('验证码渠道不正确'), { statusCode: 400 });
}

function recoveryUser(identifier) {
  const normalized = String(identifier || '').normalize('NFKC').trim();
  if (!normalized) return null;
  return statements.userByUsername.get(normalized)
    || statements.userByLogin.get(normalized, normalized.toLowerCase(), normalizePhone(normalized));
}

async function createAndDeliverCode(user, channel, destination, purpose) {
  const previous = statements.latestVerificationCode.get(Number(user.id), channel, destination, purpose);
  if (previous && Number(previous.created_at) + verificationResendInterval > Date.now()) {
    const seconds = Math.ceil((Number(previous.created_at) + verificationResendInterval - Date.now()) / 1000);
    throw Object.assign(new Error(`请等待 ${seconds} 秒后再重新发送`), { statusCode: 429 });
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const delivery = await deliverVerificationCode(channel, destination, code);
  const now = Date.now();
  statements.insertVerificationCode.run(
    Number(user.id), channel, destination, purpose,
    verificationCodeHash(Number(user.id), channel, destination, purpose, code), now, now + verificationLifetime
  );
  return delivery;
}

function consumeValidCode(user, channel, destination, purpose, code) {
  const row = statements.latestVerificationCode.get(Number(user.id), channel, destination, purpose);
  if (!row || Number(row.expires_at) <= Date.now()) throw Object.assign(new Error('验证码无效或已过期，请重新获取'), { statusCode: 400 });
  if (Number(row.attempts) >= 5) throw Object.assign(new Error('验证码错误次数过多，请重新获取'), { statusCode: 429 });
  const expected = Buffer.from(row.code_hash, 'hex');
  const actual = Buffer.from(verificationCodeHash(Number(user.id), channel, destination, purpose, String(code || '').trim()), 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    statements.incrementVerificationAttempts.run(Number(row.id));
    throw Object.assign(new Error('验证码不正确'), { statusCode: 400 });
  }
  statements.consumeVerificationCode.run(Date.now(), Number(row.id));
}

async function handleBindingCode(req, res) {
  const user = currentUser(req);
  if (!user) return respondJson(req, res, 401, { error: '请先登录后再绑定联系方式' });
  if (!allowAttempt(req, 'bind-code', 6, 30 * 60 * 1000)) return respondJson(req, res, 429, { error: '验证码发送过于频繁，请稍后再试' });
  const body = await readJson(req), channel = String(body.channel || '');
  const destination = destinationForChannel(channel, body.destination);
  const existing = channel === 'email' ? statements.userByEmail.get(destination) : statements.userByPhone.get(destination);
  if (existing && Number(existing.id) !== Number(user.id)) return respondJson(req, res, 409, { error: '该联系方式已绑定其他账号' });
  const delivery = await createAndDeliverCode(user, channel, destination, 'bind');
  return respondJson(req, res, 200, { message: '验证码已发送，10 分钟内有效', ...delivery });
}

async function handleBindContact(req, res) {
  const user = currentUser(req);
  if (!user) return respondJson(req, res, 401, { error: '请先登录后再绑定联系方式' });
  if (!allowAttempt(req, 'bind-verify', 12)) return respondJson(req, res, 429, { error: '验证尝试过于频繁，请稍后再试' });
  const body = await readJson(req), channel = String(body.channel || '');
  const destination = destinationForChannel(channel, body.destination);
  const existing = channel === 'email' ? statements.userByEmail.get(destination) : statements.userByPhone.get(destination);
  if (existing && Number(existing.id) !== Number(user.id)) return respondJson(req, res, 409, { error: '该联系方式已绑定其他账号' });
  consumeValidCode(user, channel, destination, 'bind', body.code);
  if (channel === 'email') statements.updateVerifiedEmail.run(destination, Date.now(), Number(user.id));
  else statements.updateVerifiedPhone.run(destination, Date.now(), Number(user.id));
  const updated = statements.userByUsername.get(user.username);
  return respondJson(req, res, 200, { message: channel === 'email' ? '邮箱绑定并验证成功' : '手机号绑定并验证成功', user: publicUser(updated) });
}

async function handleResetCode(req, res) {
  if (!allowAttempt(req, 'reset-code', 6, 30 * 60 * 1000)) return respondJson(req, res, 429, { error: '验证码发送过于频繁，请稍后再试' });
  const body = await readJson(req), channel = String(body.channel || '');
  if (!['email', 'phone'].includes(channel)) return respondJson(req, res, 400, { error: '请选择邮箱或手机验证码' });
  const user = recoveryUser(body.identifier);
  const destination = user && channel === 'email' && user.email_verified ? user.email
    : user && channel === 'phone' && user.phone_verified ? user.phone : null;
  if (!destination) {
    await new Promise(resolve => setTimeout(resolve, 250));
    return respondJson(req, res, 200, { message: '如果该账号已绑定并验证此联系方式，验证码将会发送' });
  }
  const delivery = await createAndDeliverCode(user, channel, destination, 'reset_password');
  return respondJson(req, res, 200, { message: '如果该账号已绑定并验证此联系方式，验证码将会发送', ...delivery });
}

async function handleResetPassword(req, res) {
  if (!allowAttempt(req, 'reset-password', 12)) return respondJson(req, res, 429, { error: '重置尝试过于频繁，请稍后再试' });
  const body = await readJson(req), channel = String(body.channel || ''), password = String(body.password || '');
  if (password.length < 8 || password.length > 72) return respondJson(req, res, 400, { error: '新密码长度需为 8–72 位' });
  const user = recoveryUser(body.identifier);
  const destination = user && channel === 'email' && user.email_verified ? user.email
    : user && channel === 'phone' && user.phone_verified ? user.phone : null;
  if (!user || !destination) return respondJson(req, res, 400, { error: '验证码无效或已过期，请重新获取' });
  consumeValidCode(user, channel, destination, 'reset_password', body.code);
  const credentials = await createPassword(password);
  statements.updatePassword.run(credentials.hash, credentials.salt, Date.now(), Number(user.id));
  statements.deleteSessionsByUser.run(Number(user.id));
  return respondJson(req, res, 200, { message: '密码已重置，请使用新密码登录' }, { 'Set-Cookie': sessionCookie(req, '', 0) });
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
  const user = statements.userByLogin.get(identifier, identifier.toLowerCase(), normalizePhone(identifier));
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
  if (pathname === '/api/auth/config' && req.method === 'GET') return respondJson(req, res, 200, { verification: verificationProviderStatus() });
  if (pathname === '/api/auth/me' && req.method === 'GET') return respondJson(req, res, 200, { user: publicUser(currentUser(req)), pricing });
  if (pathname === '/api/draft') return handleDraft(req, res);
  if (pathname === '/api/auth/register' && req.method === 'POST') return handleRegister(req, res);
  if (pathname === '/api/auth/login' && req.method === 'POST') return handleLogin(req, res);
  if (pathname === '/api/auth/contact/request-code' && req.method === 'POST') return handleBindingCode(req, res);
  if (pathname === '/api/auth/contact/verify' && req.method === 'POST') return handleBindContact(req, res);
  if (pathname === '/api/auth/password/request-code' && req.method === 'POST') return handleResetCode(req, res);
  if (pathname === '/api/auth/password/reset' && req.method === 'POST') return handleResetPassword(req, res);
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
  statements.deleteExpiredVerificationCodes.run(now);
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
