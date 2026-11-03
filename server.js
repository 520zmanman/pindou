'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const path = require('path');
const tls = require('tls');
const zlib = require('zlib');
const { promisify } = require('util');
const { DatabaseSync } = require('node:sqlite');
const { createWorker, PSM } = require('tesseract.js');
const englishOcrData = require('@tesseract.js-data/eng');

const scrypt = promisify(crypto.scrypt);
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 4173);
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const draftLifetime = 3 * 24 * 60 * 60 * 1000;
const maximumDraftBytes = 12 * 1024 * 1024;
const verificationLifetime = 10 * 60 * 1000;
const verificationResendInterval = 60 * 1000;
const guestPaymentLifetime = 2 * 60 * 1000;
const guestProofUploadGrace = 5 * 60 * 1000;
const guestOrderLifetime = guestPaymentLifetime + guestProofUploadGrace;
const downloadAccessLifetime = 2 * 60 * 1000;
const guestClaimLifetime = guestOrderLifetime + downloadAccessLifetime + 60 * 1000;
const maximumPaymentProofBytes = 2 * 1024 * 1024;
const pricing = Object.freeze({ guestOwnPdfFen: 20, memberOwnPdfFen: 10, sharedPdfFen: 1, currency: 'CNY', paymentMode: 'reward_code_ocr_pilot' });
const securityQuestions = Object.freeze([
  { id: 'first_pet', text: '你第一只宠物的名字是什么？' },
  { id: 'childhood_favorite', text: '你童年最喜欢的一本书、动画或游戏是什么？' },
  { id: 'memorable_place', text: '你最难忘的一次旅行目的地是哪里？' },
  { id: 'important_person', text: '一位对你影响很深的人的称呼是什么？' },
  { id: 'private_nickname', text: '只有亲近家人知道的童年昵称是什么？' },
]);
const securityQuestionById = new Map(securityQuestions.map(question => [question.id, question]));
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

const smtpConfigPath = path.resolve(process.env.PINDOU_SMTP_CONFIG_PATH || path.join(dataDirectory, 'smtp-config.json'));
let privateSmtpConfig = {};
try {
  privateSmtpConfig = JSON.parse(fs.readFileSync(smtpConfigPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error(`无法读取邮箱配置 ${smtpConfigPath}：${error.message}`);
    process.exit(1);
  }
}

function smtpSetting(name, fallback = '') {
  const value = process.env[name] !== undefined ? process.env[name] : privateSmtpConfig[name];
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

const verificationSecretPath = path.join(dataDirectory, 'verification-secret');
const rewardCodeImagePath = path.resolve(process.env.REWARD_CODE_IMAGE_PATH || path.join(dataDirectory, 'reward-code.png'));
let verificationSecret;
try { verificationSecret = fs.readFileSync(verificationSecretPath); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  verificationSecret = crypto.randomBytes(32);
  fs.writeFileSync(verificationSecretPath, verificationSecret, { mode: 0o600 });
}

const databasePath = path.join(dataDirectory, 'pindou.db');
const db = new DatabaseSync(databasePath);
const pointsStore = require('./points-store.js').createPointsStore(db);
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

  CREATE TABLE IF NOT EXISTS registration_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL COLLATE NOCASE,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS registration_codes_email ON registration_codes(email, created_at DESC);

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

  CREATE TABLE IF NOT EXISTS guest_download_orders (
    id TEXT PRIMARY KEY,
    claim_token_hash TEXT NOT NULL,
    amount_fen INTEGER NOT NULL CHECK (amount_fen > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'paid', 'rejected', 'consumed', 'expired')),
    payment_reference TEXT,
    proof_mime TEXT,
    proof_base64 TEXT,
    proof_sha256 TEXT,
    ocr_text TEXT,
    ocr_confidence REAL,
    detected_paid_at INTEGER,
    review_note TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    created_at INTEGER NOT NULL,
    submitted_at INTEGER,
    reviewed_at INTEGER,
    paid_at INTEGER,
    consumed_at INTEGER,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS guest_download_orders_status ON guest_download_orders(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS guest_download_orders_expires_at ON guest_download_orders(expires_at);

  CREATE TABLE IF NOT EXISTS account_payment_orders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('recharge', 'own_pdf')),
    amount_fen INTEGER NOT NULL CHECK (amount_fen > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'rejected', 'consumed', 'expired')),
    payment_reference TEXT,
    proof_mime TEXT,
    proof_base64 TEXT,
    proof_sha256 TEXT,
    ocr_text TEXT,
    ocr_confidence REAL,
    detected_paid_at INTEGER,
    created_at INTEGER NOT NULL,
    submitted_at INTEGER,
    paid_at INTEGER,
    consumed_at INTEGER,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS account_payment_orders_user ON account_payment_orders(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS account_payment_orders_expires ON account_payment_orders(expires_at);
  CREATE UNIQUE INDEX IF NOT EXISTS account_payment_orders_proof_sha256 ON account_payment_orders(proof_sha256) WHERE proof_sha256 IS NOT NULL;
`);

const userColumns = db.prepare('PRAGMA table_info(users)').all();
if (!userColumns.some(column => column.name === 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'superuser'))");
}
for (const [name, definition] of [
  ['security_question_id', 'TEXT'],
  ['security_answer_hash', 'TEXT'],
  ['security_answer_salt', 'TEXT'],
  ['security_question_updated_at', 'INTEGER'],
]) {
  if (!userColumns.some(column => column.name === name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
}

const guestOrderColumns = db.prepare('PRAGMA table_info(guest_download_orders)').all();
for (const [name, definition] of [
  ['proof_sha256', 'TEXT'],
  ['ocr_text', 'TEXT'],
  ['ocr_confidence', 'REAL'],
  ['detected_paid_at', 'INTEGER'],
  ['access_expires_at', 'INTEGER'],
]) {
  if (!guestOrderColumns.some(column => column.name === name)) db.exec(`ALTER TABLE guest_download_orders ADD COLUMN ${name} ${definition}`);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS guest_download_orders_proof_sha256 ON guest_download_orders(proof_sha256) WHERE proof_sha256 IS NOT NULL');

const accountOrderColumns = db.prepare('PRAGMA table_info(account_payment_orders)').all();
if (!accountOrderColumns.some(column => column.name === 'access_expires_at')) {
  db.exec('ALTER TABLE account_payment_orders ADD COLUMN access_expires_at INTEGER');
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
    INSERT INTO users (username, password_hash, password_salt, email, email_verified, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
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
  insertRegistrationCode: db.prepare(`
    INSERT INTO registration_codes (email, code_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `),
  latestRegistrationCode: db.prepare(`
    SELECT * FROM registration_codes
    WHERE email = ? COLLATE NOCASE AND consumed_at IS NULL
    ORDER BY id DESC LIMIT 1
  `),
  incrementRegistrationAttempts: db.prepare('UPDATE registration_codes SET attempts = attempts + 1 WHERE id = ?'),
  consumeRegistrationCode: db.prepare('UPDATE registration_codes SET consumed_at = ? WHERE id = ?'),
  deleteExpiredRegistrationCodes: db.prepare('DELETE FROM registration_codes WHERE expires_at <= ? OR consumed_at IS NOT NULL'),
  updateVerifiedEmail: db.prepare('UPDATE users SET email = ?, email_verified = 1, updated_at = ? WHERE id = ?'),
  updateVerifiedPhone: db.prepare('UPDATE users SET phone = ?, phone_verified = 1, updated_at = ? WHERE id = ?'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?'),
  updateSecurityQuestion: db.prepare(`
    UPDATE users
    SET security_question_id = ?, security_answer_hash = ?, security_answer_salt = ?, security_question_updated_at = ?, updated_at = ?
    WHERE id = ?
  `),
  deleteSessionsByUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  guestOrderById: db.prepare('SELECT * FROM guest_download_orders WHERE id = ? LIMIT 1'),
  guestOrderByProofHash: db.prepare('SELECT id FROM guest_download_orders WHERE proof_sha256 = ? LIMIT 1'),
  insertGuestOrder: db.prepare(`
    INSERT INTO guest_download_orders (id, claim_token_hash, amount_fen, status, created_at, expires_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `),
  approveGuestOrderByOcr: db.prepare(`
    UPDATE guest_download_orders
    SET status = 'paid', payment_reference = ?, proof_mime = ?, proof_base64 = ?, proof_sha256 = ?,
        ocr_text = ?, ocr_confidence = ?, detected_paid_at = ?, submitted_at = ?, reviewed_at = ?, paid_at = ?, access_expires_at = ?,
        review_note = 'OCR 时间校验通过'
    WHERE id = ? AND status IN ('pending', 'rejected')
  `),
  listGuestOrdersForReview: db.prepare(`
    SELECT id, amount_fen, status, payment_reference, proof_mime, review_note, created_at, submitted_at, reviewed_at, expires_at, access_expires_at
    FROM guest_download_orders WHERE status = ? ORDER BY COALESCE(submitted_at, created_at) DESC LIMIT 50
  `),
  reviewGuestOrder: db.prepare(`
    UPDATE guest_download_orders
    SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, paid_at = ?, access_expires_at = ?
    WHERE id = ? AND status = 'submitted'
  `),
  expireGuestDownloadAccess: db.prepare(`UPDATE guest_download_orders SET status = 'consumed', consumed_at = ? WHERE id = ? AND status = 'paid' AND access_expires_at <= ?`),
  expireStaleGuestDownloadAccess: db.prepare(`UPDATE guest_download_orders SET status = 'consumed', consumed_at = ? WHERE status = 'paid' AND access_expires_at <= ?`),
  expireGuestOrder: db.prepare(`UPDATE guest_download_orders SET status = 'expired' WHERE id = ? AND status IN ('pending', 'submitted', 'rejected')`),
  expireStaleGuestOrders: db.prepare(`UPDATE guest_download_orders SET status = 'expired' WHERE expires_at <= ? AND status IN ('pending', 'submitted', 'rejected')`),
  deleteOldGuestOrders: db.prepare(`DELETE FROM guest_download_orders WHERE expires_at <= ? AND status IN ('expired', 'consumed', 'rejected')`),
  accountOrderById: db.prepare('SELECT * FROM account_payment_orders WHERE id = ? LIMIT 1'),
  accountOrderByIdAndUser: db.prepare('SELECT * FROM account_payment_orders WHERE id = ? AND user_id = ? LIMIT 1'),
  latestOpenAccountOrder: db.prepare(`
    SELECT * FROM account_payment_orders
    WHERE user_id = ? AND kind = ? AND amount_fen = ? AND status IN ('pending', 'rejected', 'paid')
    ORDER BY created_at DESC LIMIT 1
  `),
  activeAccountDownloadAccess: db.prepare(`
    SELECT * FROM account_payment_orders
    WHERE user_id = ? AND kind = 'own_pdf' AND status = 'paid' AND access_expires_at > ?
    ORDER BY paid_at DESC LIMIT 1
  `),
  accountOrderByProofHash: db.prepare('SELECT id FROM account_payment_orders WHERE proof_sha256 = ? LIMIT 1'),
  insertAccountOrder: db.prepare(`
    INSERT INTO account_payment_orders (id, user_id, kind, amount_fen, status, created_at, expires_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `),
  payAccountOrderByOcr: db.prepare(`
    UPDATE account_payment_orders
    SET status = 'paid', payment_reference = ?, proof_mime = ?, proof_base64 = ?, proof_sha256 = ?,
        ocr_text = ?, ocr_confidence = ?, detected_paid_at = ?, submitted_at = ?, paid_at = ?, access_expires_at = ?
    WHERE id = ? AND user_id = ? AND status IN ('pending', 'rejected')
  `),
  insertPaidAccountOrder: db.prepare(`
    INSERT INTO account_payment_orders (id, user_id, kind, amount_fen, status, created_at, paid_at, expires_at, access_expires_at)
    VALUES (?, ?, 'own_pdf', ?, 'paid', ?, ?, ?, ?)
  `),
  consumeRechargeOrder: db.prepare(`
    UPDATE account_payment_orders SET status = 'consumed', consumed_at = ?
    WHERE id = ? AND user_id = ? AND kind = 'recharge' AND status = 'paid'
  `),
  expireAccountDownloadAccess: db.prepare(`
    UPDATE account_payment_orders SET status = 'consumed', consumed_at = ?
    WHERE id = ? AND user_id = ? AND kind = 'own_pdf' AND status = 'paid' AND access_expires_at <= ?
  `),
  expireStaleAccountDownloadAccess: db.prepare(`
    UPDATE account_payment_orders SET status = 'consumed', consumed_at = ?
    WHERE kind = 'own_pdf' AND status = 'paid' AND access_expires_at <= ?
  `),
  expireAccountOrder: db.prepare(`UPDATE account_payment_orders SET status = 'expired' WHERE id = ? AND status IN ('pending', 'rejected')`),
  renewAccountOrderWindow: db.prepare(`
    UPDATE account_payment_orders SET created_at = ?, expires_at = ?
    WHERE id = ? AND user_id = ? AND status IN ('pending', 'rejected')
  `),
  expireStaleAccountOrders: db.prepare(`UPDATE account_payment_orders SET status = 'expired' WHERE expires_at <= ? AND status IN ('pending', 'rejected')`),
  deleteOldAccountOrders: db.prepare(`DELETE FROM account_payment_orders WHERE expires_at <= ? AND status IN ('expired', 'consumed', 'rejected')`),
  debitUserBalance: db.prepare('UPDATE users SET balance_fen = balance_fen - ?, updated_at = ? WHERE id = ? AND balance_fen >= ?'),
  creditUserBalance: db.prepare('UPDATE users SET balance_fen = balance_fen + ?, updated_at = ? WHERE id = ?'),
  insertWalletLedger: db.prepare(`
    INSERT INTO wallet_ledger (user_id, delta_fen, balance_after_fen, reason, reference_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
};

const publicFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/style.css', 'style.css'],
  ['/app.js', 'app.js'],
  ['/account.js', 'account.js'],
  ['/gallery.js', 'gallery.js'],
  ['/mard-palette.js', 'mard-palette.js'],
  ['/assets/payment-proof-example.png', 'assets/payment-proof-example.png'],
]);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
};

const staticAssetCache = new Map();
const minimumCompressionBytes = 1024;

function createEtag(payload) {
  const digest = crypto.createHash('sha256').update(payload).digest('base64url').slice(0, 27);
  return `"${digest}"`;
}

function acceptedContentEncoding(req) {
  const header = String(req.headers['accept-encoding'] || '').trim().toLowerCase();
  if (!header) return null;

  const qualities = new Map();
  for (const item of header.split(',')) {
    const [rawName, ...parameters] = item.trim().split(';');
    if (!rawName) continue;
    let quality = 1;
    for (const parameter of parameters) {
      const match = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(parameter);
      if (match) quality = Math.max(0, Math.min(1, Number(match[1]) || 0));
    }
    qualities.set(rawName.trim(), quality);
  }

  const wildcardQuality = qualities.get('*') || 0;
  const brotliQuality = qualities.has('br') ? qualities.get('br') : wildcardQuality;
  const gzipQuality = qualities.has('gzip') ? qualities.get('gzip') : wildcardQuality;
  if (brotliQuality > 0 && brotliQuality >= gzipQuality) return 'br';
  if (gzipQuality > 0) return 'gzip';
  return null;
}

async function getStaticAsset(filePath) {
  const stats = await fs.promises.stat(filePath);
  const cached = staticAssetCache.get(filePath);
  if (cached && cached.size === stats.size && cached.modifiedMs === stats.mtimeMs) return cached;

  const identity = await fs.promises.readFile(filePath);
  const asset = {
    identity,
    identityEtag: createEtag(identity),
    modified: stats.mtime.toUTCString(),
    modifiedMs: stats.mtimeMs,
    size: stats.size,
    br: null,
    brEtag: null,
    gzip: null,
    gzipEtag: null,
  };

  if (identity.length >= minimumCompressionBytes) {
    asset.br = zlib.brotliCompressSync(identity, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
    });
    asset.brEtag = createEtag(asset.br);
    asset.gzip = zlib.gzipSync(identity, { level: 6 });
    asset.gzipEtag = createEtag(asset.gzip);
  }

  staticAssetCache.set(filePath, asset);
  return asset;
}

function requestHasFreshAsset(req, etag, modifiedMs) {
  const ifNoneMatch = String(req.headers['if-none-match'] || '');
  if (ifNoneMatch) {
    return ifNoneMatch.split(',').some(value => value.trim() === '*' || value.trim() === etag);
  }

  const ifModifiedSince = Date.parse(String(req.headers['if-modified-since'] || ''));
  return Number.isFinite(ifModifiedSince) && Math.floor(modifiedMs / 1000) * 1000 <= ifModifiedSince;
}

async function respondStatic(req, res, filePath, versioned) {
  const asset = await getStaticAsset(filePath);
  let encoding = acceptedContentEncoding(req);
  if (!asset[encoding]) encoding = null;

  const payload = encoding ? asset[encoding] : asset.identity;
  const etag = encoding ? asset[`${encoding}Etag`] : asset.identityEtag;
  const isHtml = path.extname(filePath) === '.html';
  const headers = {
    'Cache-Control': !isHtml && versioned
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
    ETag: etag,
    'Last-Modified': asset.modified,
    Vary: 'Accept-Encoding',
  };
  if (encoding) headers['Content-Encoding'] = encoding;

  if (requestHasFreshAsset(req, etag, asset.modifiedMs)) {
    res.writeHead(304, { ...securityHeaders, ...headers });
    res.end();
    return;
  }
  respond(req, res, 200, payload, headers);
}

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

function normalizeSecurityAnswer(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
}

function verificationProviderStatus() {
  const consoleMode = process.env.PINDOU_VERIFICATION_MODE === 'console';
  const emailConfigured = consoleMode || ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'].every(name => smtpSetting(name));
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

async function sendEmailMessage(destination, subjectText, bodyText, attachment = null) {
  const hostName = smtpSetting('SMTP_HOST'), portNumber = Number(smtpSetting('SMTP_PORT', 465));
  const user = smtpSetting('SMTP_USER'), password = smtpSetting('SMTP_PASS'), from = smtpSetting('SMTP_FROM');
  if (![hostName, user, password, from].every(Boolean)) throw Object.assign(new Error('邮箱验证码服务尚未配置'), { statusCode: 503 });
  if (![destination, from].every(value => !/[\r\n]/.test(value))) throw Object.assign(new Error('邮箱地址不合法'), { statusCode: 400 });
  const socket = tls.connect({ host: hostName, port: portNumber, servername: hostName, rejectUnauthorized: smtpSetting('SMTP_ALLOW_INSECURE') !== '1' });
  await new Promise((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject); });
  try {
    await smtpCommand(socket, null, [220]);
    await smtpCommand(socket, `EHLO ${smtpSetting('SMTP_HELO', 'pindou.local')}`, [250]);
    await smtpCommand(socket, 'AUTH LOGIN', [334]);
    await smtpCommand(socket, Buffer.from(user).toString('base64'), [334]);
    await smtpCommand(socket, Buffer.from(password).toString('base64'), [235]);
    await smtpCommand(socket, `MAIL FROM:<${from}>`, [250]);
    await smtpCommand(socket, `RCPT TO:<${destination}>`, [250, 251]);
    await smtpCommand(socket, 'DATA', [354]);
    const subject = `=?UTF-8?B?${Buffer.from(subjectText).toString('base64')}?=`;
    const bodyBase64 = Buffer.from(bodyText).toString('base64');
    const body = bodyBase64.match(/.{1,76}/g).join('\r\n');
    let message;
    if (attachment) {
      const boundary = `pindou-${crypto.randomBytes(18).toString('hex')}`;
      const attachmentBody = Buffer.from(attachment.base64, 'base64').toString('base64').match(/.{1,76}/g).join('\r\n');
      message = [
        `From: 豆格 <${from}>`, `To: <${destination}>`, `Subject: ${subject}`,
        'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
        `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body, '',
        `--${boundary}`, `Content-Type: ${attachment.mime}; name="payment-evidence.${attachment.extension}"`,
        'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="payment-evidence.${attachment.extension}"`, '', attachmentBody, '',
        `--${boundary}--`
      ].join('\r\n');
    } else {
      message = [
        `From: 豆格 <${from}>`, `To: <${destination}>`, `Subject: ${subject}`,
        'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body
      ].join('\r\n');
    }
    await smtpCommand(socket, `${message}\r\n.`, [250]);
    await smtpCommand(socket, 'QUIT', [221]);
  } finally { socket.destroy(); }
}

async function sendEmailCode(destination, code, purpose) {
  const action = purpose === 'register' ? '注册' : purpose === 'bind' ? '邮箱验证' : '找回密码';
  return sendEmailMessage(
    destination,
    `豆格${action}验证码`,
    `你的豆格${action}验证码是：${code}\n\n验证码 10 分钟内有效，请勿告知他人。`
  );
}

function publicEmailDeliveryError(error) {
  const networkBlocked = error && (error.code === 'EACCES' || error.code === 'EPERM'
    || (Array.isArray(error.errors) && error.errors.some(item => item.code === 'EACCES' || item.code === 'EPERM')));
  const message = networkBlocked
    ? '服务器无法连接邮件服务，请检查防火墙或运行权限是否允许访问 SMTP 465 端口'
    : '邮件发送失败，请检查 SMTP 地址、端口和邮箱客户端授权码';
  return Object.assign(new Error(message), { statusCode: 502, cause: error });
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

async function deliverVerificationCode(channel, destination, code, purpose) {
  if (process.env.PINDOU_VERIFICATION_MODE === 'console') {
    console.log(`[仅限本地测试] ${channel} ${destination} 的验证码：${code}`);
    return { developmentCode: code };
  }
  if (channel === 'email') {
    try {
      await sendEmailCode(destination, code, purpose);
    } catch (error) {
      throw publicEmailDeliveryError(error);
    }
  } else await sendTencentSmsCode(destination, code);
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

function guestOrderCookie(req, value, maxAgeSeconds) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1';
  return `pindou_guest_order=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function refreshedGuestOrderCookie(req, order) {
  const claim = parseCookies(req).pindou_guest_order;
  if (!claim) return {};
  const absoluteExpiry = Math.max(Number(order.expires_at || 0), Number(order.access_expires_at || 0));
  const maxAgeSeconds = Math.max(1, Math.ceil((absoluteExpiry - Date.now()) / 1000) + 60);
  return { 'Set-Cookie': guestOrderCookie(req, claim, maxAgeSeconds) };
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id), username: row.username, email: row.email || null, emailVerified: Boolean(row.email_verified),
    phone: row.phone || null, phoneVerified: Boolean(row.phone_verified), balanceFen: Number(row.balance_fen || 0), points: pointsStore.balance(Number(row.id))/100,
    role: row.role || 'user', isSuperuser: row.role === 'superuser', createdAt: Number(row.created_at),
    hasSecurityQuestion: Boolean(row.security_question_id && row.security_answer_hash && row.security_answer_salt)
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

function rewardCodeStatus() {
  let configured = false;
  try {
    const stat = fs.statSync(rewardCodeImagePath);
    configured = stat.isFile() && stat.size > 0 && stat.size <= 8 * 1024 * 1024;
  } catch {}
  return {
    provider: 'wechat_reward_code_ocr', configured, trustMode: false, ocrMode: true,
    paymentWindowSeconds: Math.floor(guestPaymentLifetime / 1000),
    proofUploadGraceSeconds: Math.floor(guestProofUploadGrace / 1000),
    orderLifetimeSeconds: Math.floor(guestOrderLifetime / 1000),
    imageEndpoint: configured ? '/api/payments/reward-code/image' : null
  };
}

function rewardCodeMime() {
  try {
    const descriptor = fs.openSync(rewardCodeImagePath, 'r'), signature = Buffer.alloc(12);
    fs.readSync(descriptor, signature, 0, signature.length, 0); fs.closeSync(descriptor);
    if (signature[0] === 0xff && signature[1] === 0xd8) return 'image/jpeg';
    if (signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  } catch {}
  return 'image/png';
}

function guestClaim(req) {
  const raw = parseCookies(req).pindou_guest_order;
  if (!raw || raw.length > 200) return null;
  const separator = raw.indexOf('.');
  if (separator < 1) return null;
  const id = raw.slice(0, separator), token = raw.slice(separator + 1), order = statements.guestOrderById.get(id);
  if (!order || token.length < 20) return null;
  const expected = Buffer.from(order.claim_token_hash, 'hex'), actual = Buffer.from(tokenHash(token), 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  if (Number(order.expires_at) <= Date.now() && ['pending', 'submitted', 'rejected'].includes(order.status)) {
    statements.expireGuestOrder.run(order.id); order.status = 'expired';
  }
  if (order.status === 'paid' && Number(order.access_expires_at || 0) <= Date.now()) {
    statements.expireGuestDownloadAccess.run(Date.now(), order.id, Date.now()); order.status = 'consumed';
  }
  return order;
}

function publicGuestOrder(order) {
  if (!order) return null;
  const accessExpiresAt = order.access_expires_at ? Number(order.access_expires_at) : null;
  return {
    id: order.id, amountFen: Number(order.amount_fen), status: order.status,
    paymentReference: order.payment_reference || '', reviewNote: order.review_note || '',
    createdAt: Number(order.created_at), paymentExpiresAt: Number(order.created_at) + guestPaymentLifetime,
    submittedAt: order.submitted_at ? Number(order.submitted_at) : null,
    reviewedAt: order.reviewed_at ? Number(order.reviewed_at) : null, expiresAt: Number(order.expires_at),
    accessExpiresAt,
    downloadAuthorized: order.status === 'paid' && Boolean(accessExpiresAt && accessExpiresAt > Date.now())
  };
}

function publicAccountOrder(order) {
  if (!order) return null;
  const accessExpiresAt = order.access_expires_at ? Number(order.access_expires_at) : null;
  return {
    id: order.id, kind: order.kind, amountFen: Number(order.amount_fen), status: order.status,
    paymentReference: order.payment_reference || '', createdAt: Number(order.created_at),
    paymentExpiresAt: Number(order.created_at) + guestPaymentLifetime,
    submittedAt: order.submitted_at ? Number(order.submitted_at) : null,
    paidAt: order.paid_at ? Number(order.paid_at) : null,
    expiresAt: Number(order.expires_at), accessExpiresAt,
    downloadAuthorized: order.kind === 'own_pdf' && order.status === 'paid' && Boolean(accessExpiresAt && accessExpiresAt > Date.now()),
    balanceCredited: order.kind === 'recharge' && order.status === 'consumed'
  };
}

function requireAccount(req, res) {
  const user = currentUser(req);
  if (!user) {
    respondJson(req, res, 401, { error: '请先登录账号' });
    return null;
  }
  return user;
}

function inTransaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function requireSuperuser(req, res) {
  const user = currentUser(req);
  if (!user || user.role !== 'superuser') {
    respondJson(req, res, 403, { error: '仅超级账户可以审核游客付款' });
    return null;
  }
  return user;
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
function clientAddress(req) {
  const direct = String(req.socket.remoteAddress || 'unknown');
  const isLoopback = direct === '127.0.0.1' || direct === '::1' || direct === '::ffff:127.0.0.1';
  if (isLoopback || process.env.TRUST_PROXY === '1') {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (net.isIP(forwarded)) return forwarded;
  }
  return direct;
}

function allowAttempt(req, bucket, maximum = 12, windowMs = 15 * 60 * 1000) {
  const key = `${bucket}:${clientAddress(req)}`;
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
  const delivery = await deliverVerificationCode(channel, destination, code, purpose);
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

function registrationCodeHash(email, code) {
  return crypto.createHmac('sha256', verificationSecret)
    .update(`register:${email}:${code}`)
    .digest('hex');
}

async function handleRegistrationCode(req, res) {
  if (!allowAttempt(req, 'register-code', 6, 30 * 60 * 1000)) {
    return respondJson(req, res, 429, { error: '注册验证码发送过于频繁，请稍后再试' });
  }
  const body = await readJson(req);
  const username = normalizeUsername(body.username), email = normalizeEmail(body.email);
  if (!validUsername(username)) return respondJson(req, res, 400, { error: '请先填写有效的用户名' });
  if (!email || !validEmail(email)) return respondJson(req, res, 400, { error: '请输入有效的邮箱地址' });
  if (statements.userByUsername.get(username)) return respondJson(req, res, 409, { error: '该用户名已被使用' });
  if (statements.userByEmail.get(email)) return respondJson(req, res, 409, { error: '该邮箱已绑定其他账号' });
  if (!verificationProviderStatus().emailConfigured) return respondJson(req, res, 503, { error: '邮箱验证码服务尚未配置' });

  const previous = statements.latestRegistrationCode.get(email);
  if (previous && Number(previous.created_at) + verificationResendInterval > Date.now()) {
    const seconds = Math.ceil((Number(previous.created_at) + verificationResendInterval - Date.now()) / 1000);
    return respondJson(req, res, 429, { error: `请等待 ${seconds} 秒后再重新发送` });
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const delivery = await deliverVerificationCode('email', email, code, 'register');
  const now = Date.now();
  statements.insertRegistrationCode.run(email, registrationCodeHash(email, code), now, now + verificationLifetime);
  return respondJson(req, res, 200, { message: '注册验证码已发送，10 分钟内有效', ...delivery });
}

function consumeValidRegistrationCode(email, code) {
  const row = statements.latestRegistrationCode.get(email);
  if (!row || Number(row.expires_at) <= Date.now()) throw Object.assign(new Error('注册验证码无效或已过期，请重新获取'), { statusCode: 400 });
  if (Number(row.attempts) >= 5) throw Object.assign(new Error('验证码错误次数过多，请重新获取'), { statusCode: 429 });
  const expected = Buffer.from(row.code_hash, 'hex');
  const actual = Buffer.from(registrationCodeHash(email, String(code || '').trim()), 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    statements.incrementRegistrationAttempts.run(Number(row.id));
    throw Object.assign(new Error('注册验证码不正确'), { statusCode: 400 });
  }
  statements.consumeRegistrationCode.run(Date.now(), Number(row.id));
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

async function handleSetSecurityQuestion(req, res) {
  const user = currentUser(req);
  if (!user) return respondJson(req, res, 401, { error: '请先登录后再设置验证问题' });
  if (!allowAttempt(req, 'set-security-question', 8, 30 * 60 * 1000)) {
    return respondJson(req, res, 429, { error: '验证问题设置尝试过于频繁，请稍后再试' });
  }

  const body = await readJson(req);
  const questionId = String(body.questionId || ''), answer = normalizeSecurityAnswer(body.answer);
  const currentPassword = String(body.currentPassword || '');
  if (!securityQuestionById.has(questionId)) return respondJson(req, res, 400, { error: '请选择有效的验证问题' });
  if (answer.length < 2 || answer.length > 80) return respondJson(req, res, 400, { error: '验证答案需为 2–80 个字符' });
  if (!currentPassword || currentPassword.length > 72) return respondJson(req, res, 400, { error: '请输入当前登录密码' });

  const fullUser = statements.userByUsername.get(user.username);
  if (!await passwordMatches(currentPassword, fullUser.password_salt, fullUser.password_hash)) {
    return respondJson(req, res, 401, { error: '当前密码不正确' });
  }
  const credentials = await createPassword(answer), now = Date.now();
  statements.updateSecurityQuestion.run(questionId, credentials.hash, credentials.salt, now, now, Number(user.id));
  return respondJson(req, res, 200, {
    message: '验证问题已保存，可作为邮箱之外的备用找回方式',
    user: publicUser(statements.userByUsername.get(user.username)),
  });
}

async function handleGetSecurityQuestion(req, res, searchParams) {
  if (!allowAttempt(req, 'get-security-question', 12, 30 * 60 * 1000)) {
    return respondJson(req, res, 429, { error: '验证问题查询过于频繁，请稍后再试' });
  }
  const identifier = String(searchParams.get('identifier') || '').normalize('NFKC').trim();
  if (!identifier) return respondJson(req, res, 400, { error: '请输入用户名或已验证邮箱' });
  const user = recoveryUser(identifier);
  const question = user && securityQuestionById.get(user.security_question_id);
  if (!question || !user.security_answer_hash || !user.security_answer_salt) {
    await new Promise(resolve => setTimeout(resolve, 250));
    return respondJson(req, res, 404, { error: '该账号尚未设置验证问题，或账号信息不正确' });
  }
  return respondJson(req, res, 200, { question });
}

async function handleSecurityQuestionReset(req, res) {
  const body = await readJson(req), identifier = String(body.identifier || '').normalize('NFKC').trim();
  const bucketSuffix = sha256Hex(identifier.toLocaleLowerCase('zh-CN')).slice(0, 16);
  if (!allowAttempt(req, `security-question-reset:${bucketSuffix}`, 5, 30 * 60 * 1000)) {
    return respondJson(req, res, 429, { error: '验证答案尝试次数过多，请 30 分钟后再试' });
  }
  const password = String(body.password || ''), answer = normalizeSecurityAnswer(body.answer);
  if (!identifier) return respondJson(req, res, 400, { error: '请输入用户名或已验证邮箱' });
  if (password.length < 8 || password.length > 72) return respondJson(req, res, 400, { error: '新密码长度需为 8–72 位' });
  if (answer.length < 2 || answer.length > 80) return respondJson(req, res, 400, { error: '请输入验证问题答案' });

  const user = recoveryUser(identifier);
  const hasQuestion = user && securityQuestionById.has(user.security_question_id)
    && user.security_answer_hash && user.security_answer_salt;
  const matches = hasQuestion
    ? await passwordMatches(answer, user.security_answer_salt, user.security_answer_hash)
    : false;
  if (!matches) return respondJson(req, res, 400, { error: '验证答案不正确，或账号尚未设置验证问题' });

  const credentials = await createPassword(password), now = Date.now();
  statements.updatePassword.run(credentials.hash, credentials.salt, now, Number(user.id));
  statements.deleteSessionsByUser.run(Number(user.id));
  return respondJson(req, res, 200, { message: '验证成功，密码已重置，请使用新密码登录' }, { 'Set-Cookie': sessionCookie(req, '', 0) });
}

async function handleFeedback(req, res) {
  if (req.method !== 'POST') return respondJson(req, res, 405, { error: '请求方法不支持' }, { Allow: 'POST' });
  if (!allowAttempt(req, 'feedback', 3, 30 * 60 * 1000)) {
    return respondJson(req, res, 429, { error: '反馈发送过于频繁，请稍后再试' });
  }
  const body = await readJson(req, maximumPaymentProofBytes * 2);
  if (String(body.website || '').trim()) return respondJson(req, res, 200, { message: '感谢你的反馈' });
  const message = String(body.message || '').normalize('NFKC').trim();
  const contact = String(body.contact || '').normalize('NFKC').trim().replace(/[\r\n]+/g, ' ');
  if (message.length < 2 || message.length > 2000) {
    return respondJson(req, res, 400, { error: '反馈内容需为 2–2000 个字符' });
  }
  if (contact.length > 120) return respondJson(req, res, 400, { error: '联系方式不能超过 120 个字符' });
  let attachment = null;
  if (body.attachmentDataUrl) {
    const image = parseImageDataUrl(body.attachmentDataUrl, maximumPaymentProofBytes, '证据截图须为不超过 2 MB 的 PNG、JPG 或 WEBP 图片');
    const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
    attachment = { ...image, extension: extensions[image.mime] || 'png' };
  }

  const recipient = smtpSetting('FEEDBACK_TO', smtpSetting('SMTP_FROM'));
  if (!recipient || !validEmail(recipient)) return respondJson(req, res, 503, { error: '站点反馈邮箱尚未配置' });
  const user = currentUser(req);
  const identity = user
    ? `注册用户：${user.username}${user.email_verified && user.email ? `（${user.email}）` : ''}`
    : '游客';
  const feedbackBody = [
    '豆格收到一条新的用户反馈：', '', message, '',
    `提交身份：${identity}`,
    `用户填写的联系方式：${contact || '未填写'}`,
    `提交时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`
  ].join('\n');
  if (process.env.PINDOU_VERIFICATION_MODE === 'console') {
    console.log(`[仅限本地测试] 用户反馈\n${feedbackBody}`);
  } else {
    try { await sendEmailMessage(recipient, '豆格用户反馈', feedbackBody, attachment); }
    catch (error) { throw publicEmailDeliveryError(error); }
  }
  return respondJson(req, res, 200, { message: attachment ? '反馈和证据截图已发送，管理员会尽快处理' : '反馈已发送，感谢你的建议' });
}

function createGuestOrderId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `DG${date}${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function createAccountOrderId(kind) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = kind === 'recharge' ? 'RC' : 'DM';
  return `${prefix}${date}${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function parseImageDataUrl(value, maximumBytes, missingMessage) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!match) throw Object.assign(new Error(missingMessage), { statusCode: 400 });
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > maximumBytes) throw Object.assign(new Error(`图片不能超过 ${Math.round(maximumBytes / 1024 / 1024)} MB`), { statusCode: 413 });
  return { mime: match[1], base64: bytes.toString('base64') };
}

function parsePaymentProof(value) {
  return parseImageDataUrl(value, maximumPaymentProofBytes, '请上传 PNG、JPG 或 WEBP 格式的付款截图');
}

let paymentOcrWorkerPromise = null;
let paymentOcrQueue = Promise.resolve();

async function paymentOcrWorker() {
  if (!paymentOcrWorkerPromise) {
    paymentOcrWorkerPromise = createWorker(englishOcrData.code, 1, {
      langPath: englishOcrData.langPath,
      gzip: englishOcrData.gzip,
      cacheMethod: 'readOnly',
      errorHandler: error => console.error('Payment OCR worker error:', error)
    }).then(async worker => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: '0123456789:.-/ '
      });
      return worker;
    }).catch(error => {
      paymentOcrWorkerPromise = null;
      throw error;
    });
  }
  return paymentOcrWorkerPromise;
}

function chinaEpoch(year, month, day, hour, minute, second = 0) {
  const epoch = Date.UTC(year, month - 1, day, hour - 8, minute, second);
  const check = new Date(epoch + 8 * 60 * 60 * 1000);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day ||
      check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) return null;
  return epoch;
}

function paymentTimeCandidates(rawText, order) {
  const text = String(rawText || '').normalize('NFKC').replace(/[：]/g, ':');
  const results = [];
  const occupied = [];
  const fullPattern = /\b(20\d{2}|\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\s+(\d{1,2})\s*[:.]\s*(\d{2})(?:\s*[:.]\s*(\d{2}))?\b/g;
  for (const match of text.matchAll(fullPattern)) {
    const year = Number(match[1]) < 100 ? 2000 + Number(match[1]) : Number(match[1]);
    const values = [year, ...match.slice(2, 7).map(value => Number(value || 0))];
    const epoch = chinaEpoch(...values);
    if (epoch !== null) {
      results.push({ epoch, precision: match[6] ? 'second' : 'minute', source: match[0] });
      occupied.push([match.index, match.index + match[0].length]);
    }
  }

  const chinaCreated = new Date(Number(order.created_at) + 8 * 60 * 60 * 1000);
  const baseMidnight = Date.UTC(chinaCreated.getUTCFullYear(), chinaCreated.getUTCMonth(), chinaCreated.getUTCDate());
  const timePattern = /\b([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)(?:\s*[:.]\s*([0-5]\d))?\b/g;
  for (const match of text.matchAll(timePattern)) {
    if (occupied.some(([start, end]) => match.index >= start && match.index < end)) continue;
    for (const dayOffset of [-1, 0, 1]) {
      const localDate = new Date(baseMidnight + dayOffset * 24 * 60 * 60 * 1000);
      const epoch = chinaEpoch(localDate.getUTCFullYear(), localDate.getUTCMonth() + 1, localDate.getUTCDate(), Number(match[1]), Number(match[2]), Number(match[3] || 0));
      if (epoch !== null) results.push({ epoch, precision: match[3] ? 'second' : 'minute', source: match[0] });
    }
  }
  return results;
}

function matchingPaymentTime(candidates, order) {
  const start = Number(order.created_at), end = start + guestPaymentLifetime;
  return candidates.find(candidate => {
    const candidateEnd = candidate.epoch + (candidate.precision === 'minute' ? 59_999 : 999);
    return candidate.epoch <= end && candidateEnd >= start;
  }) || null;
}

async function recognizePaymentProof(bytes, order) {
  const job = paymentOcrQueue.catch(() => {}).then(async () => {
    const worker = await paymentOcrWorker();
    const result = await worker.recognize(bytes);
    const text = String(result.data.text || '').trim();
    const candidates = paymentTimeCandidates(text, order);
    return { text, confidence: Number(result.data.confidence || 0), candidates, match: matchingPaymentTime(candidates, order) };
  });
  paymentOcrQueue = job.catch(() => {});
  return job;
}

function paymentAmountCandidates(rawText) {
  const normalized = String(rawText || '').normalize('NFKC').replace(/,/g, '.');
  const values = [];
  for (const match of normalized.matchAll(/(?:¥|￥|\bRMB\s*|\bCNY\s*|\bY\s*)(\d{1,5})\s*\.\s*(\d{2})(?!\d)/gi)) {
    const fen = Number(match[1]) * 100 + Number(match[2]);
    if (Number.isSafeInteger(fen) && !values.includes(fen)) values.push(fen);
  }
  for (const match of normalized.matchAll(/(?:^|[^\d])(\d{1,5})\s*\.\s*(\d{2})(?!\d)/g)) {
    const fen = Number(match[1]) * 100 + Number(match[2]);
    if (Number.isSafeInteger(fen) && !values.includes(fen)) values.push(fen);
  }
  return values;
}

async function handleRewardCodeAdmin(req, res) {
  const admin = requireSuperuser(req, res);
  if (!admin) return;
  if (req.method !== 'POST') return respondJson(req, res, 405, { error: '请求方法不支持' });
  const body = await readJson(req, 12 * 1024 * 1024);
  const image = parseImageDataUrl(body.imageDataUrl, 8 * 1024 * 1024, '请选择 PNG、JPG 或 WEBP 格式的赞赏码原图');
  fs.mkdirSync(path.dirname(rewardCodeImagePath), { recursive: true });
  fs.writeFileSync(rewardCodeImagePath, Buffer.from(image.base64, 'base64'), { mode: 0o600 });
  return respondJson(req, res, 200, { message: '赞赏码原图已保存', rewardCode: rewardCodeStatus() });
}

async function handleGuestOrder(req, res, pathname) {
  const reward = rewardCodeStatus();
  if (!reward.configured) return respondJson(req, res, 503, { error: '游客赞赏码尚未配置，请联系站点管理员' });

  if (pathname === '/api/payments/guest/order' && req.method === 'POST') {
    const body = await readJson(req);
    const replacePending = body.replacePending === true;
    const current = guestClaim(req);
    const currentCanBeReplaced = current && replacePending && ['pending', 'rejected'].includes(current.status);
    if (current && !['consumed', 'expired'].includes(current.status) && !currentCanBeReplaced) {
      return respondJson(req, res, 200, { order: publicGuestOrder(current), rewardCode: reward }, refreshedGuestOrderCookie(req, current));
    }
    if (!allowAttempt(req, 'guest-order', 10, 60 * 60 * 1000)) return respondJson(req, res, 429, { error: '创建订单过于频繁，请稍后再试' });
    if (currentCanBeReplaced) statements.expireGuestOrder.run(current.id);
    const id = createGuestOrderId(), token = crypto.randomBytes(32).toString('base64url'), now = Date.now();
    statements.insertGuestOrder.run(id, tokenHash(token), pricing.guestOwnPdfFen, now, now + guestOrderLifetime);
    paymentOcrWorker().catch(error => console.error('Payment OCR warm-up failed:', error));
    const order = statements.guestOrderById.get(id);
    return respondJson(req, res, 201, { order: publicGuestOrder(order), rewardCode: reward }, {
      'Set-Cookie': guestOrderCookie(req, `${id}.${token}`, Math.floor(guestClaimLifetime / 1000))
    });
  }

  const order = guestClaim(req);
  if (!order) return respondJson(req, res, 404, { error: '没有找到当前游客订单，请重新创建' });
  if (pathname === '/api/payments/guest/order' && req.method === 'GET') {
    return respondJson(req, res, 200, { order: publicGuestOrder(order), rewardCode: reward }, refreshedGuestOrderCookie(req, order));
  }

  if (pathname === '/api/payments/guest/order/self-confirm' && req.method === 'POST') {
    return respondJson(req, res, 410, { error: '自行确认付款功能已停用，请上传支付成功截图进行时间校验' });
  }

  if (pathname === '/api/payments/guest/order/submit' && req.method === 'POST') {
    if (!allowAttempt(req, `guest-proof-ocr:${order.id}`, 10, 10 * 60 * 1000)) return respondJson(req, res, 429, { error: '本订单截图校验次数过多，请更换订单后重试' });
    if (order.status === 'expired') return respondJson(req, res, 410, { error: '截图上传期限已经结束，请返回后重新创建订单' });
    if (!['pending', 'rejected'].includes(order.status)) return respondJson(req, res, 409, { error: '当前订单状态不能重新提交付款凭证' });
    const receivedAt = Date.now();
    if (receivedAt > Number(order.expires_at)) {
      statements.expireGuestOrder.run(order.id);
      return respondJson(req, res, 410, { error: '额外五分钟截图上传时间已经结束，请返回后重新创建订单' });
    }
    const body = await readJson(req, maximumPaymentProofBytes * 2);
    const reference = String(body.paymentReference || '').normalize('NFKC').trim();
    if (reference.length > 80 || /[\r\n]/.test(reference)) return respondJson(req, res, 400, { error: '支付单号或备注不能超过 80 个字符' });
    const proof = parsePaymentProof(body.proofDataUrl);
    const proofBytes = Buffer.from(proof.base64, 'base64');
    const proofHash = crypto.createHash('sha256').update(proofBytes).digest('hex');
    const reused = statements.guestOrderByProofHash.get(proofHash);
    const reusedByAccount = statements.accountOrderByProofHash.get(proofHash);
    if ((reused && reused.id !== order.id) || reusedByAccount) return respondJson(req, res, 409, { error: '这张付款截图已用于其他订单，请勿重复使用' });

    let ocr;
    try { ocr = await recognizePaymentProof(proofBytes, order); }
    catch (error) {
      console.error('Payment proof OCR failed:', error);
      return respondJson(req, res, 503, { error: '暂时无法识别付款截图，请稍后重试' });
    }
    if (!ocr.match) {
      const recognized = ocr.candidates.slice(0, 4).map(item => item.source).filter((value, index, values) => values.indexOf(value) === index);
      return respondJson(req, res, 422, {
        error: recognized.length
          ? `截图中的时间（${recognized.join('、')}）不在本订单两分钟内，请上传本次付款成功截图`
          : '没有识别到清晰的付款时间，请上传包含完整支付时间的原始截图'
      });
    }
    const now = Date.now();
    let result;
    try {
      result = statements.approveGuestOrderByOcr.run(
        reference, proof.mime, proof.base64, proofHash, ocr.text.slice(0, 2000), ocr.confidence,
        ocr.match.epoch, now, now, now, now + downloadAccessLifetime, order.id
      );
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return respondJson(req, res, 409, { error: '这张付款截图已经使用过' });
      throw error;
    }
    if (!result.changes) return respondJson(req, res, 409, { error: '订单状态已经改变，请刷新后重试' });
    const updatedOrder = statements.guestOrderById.get(order.id);
    return respondJson(req, res, 200, {
      message: '截图校验通过，已获得 2 分钟重复下载权限', order: publicGuestOrder(updatedOrder)
    }, refreshedGuestOrderCookie(req, updatedOrder));
  }

  if (pathname === '/api/payments/guest/order/consume' && req.method === 'POST') {
    if (order.status !== 'paid' || Number(order.access_expires_at || 0) <= Date.now()) {
      statements.expireGuestDownloadAccess.run(Date.now(), order.id, Date.now());
      return respondJson(req, res, 409, { error: '当前订单的下载权限已结束' });
    }
    return respondJson(req, res, 200, {
      authorized: true, accessExpiresAt: Number(order.access_expires_at)
    }, refreshedGuestOrderCookie(req, order));
  }
  return respondJson(req, res, 405, { error: '请求方法不支持' });
}

async function handleAccountPayment(req, res, pathname, searchParams) {
  const user = requireAccount(req, res);
  if (!user) return;
  const reward = rewardCodeStatus();

  if (pathname === '/api/payments/account/order' && req.method === 'POST') {
    if (!reward.configured) return respondJson(req, res, 503, { error: '赞赏码尚未配置，请联系站点管理员' });
    if (!allowAttempt(req, `account-order-${user.id}`, 15, 60 * 60 * 1000)) return respondJson(req, res, 429, { error: '创建订单过于频繁，请稍后再试' });
    const body = await readJson(req);
    const kind = String(body.kind || '');
    if (!['own_pdf', 'recharge'].includes(kind)) return respondJson(req, res, 400, { error: '订单类型不正确' });
    let amountFen = kind === 'own_pdf' ? pricing.memberOwnPdfFen : Number(body.amountFen);
    if (!Number.isInteger(amountFen) || (kind === 'recharge' && (amountFen < 100 || amountFen > 50000))) {
      return respondJson(req, res, 400, { error: '充值金额须为 1.00 至 500.00 元' });
    }
    if (kind === 'own_pdf') {
      const activeAccess = statements.activeAccountDownloadAccess.get(Number(user.id), Date.now());
      if (activeAccess) return respondJson(req, res, 200, { order: publicAccountOrder(activeAccess), rewardCode: reward, user: publicUser(user) });
    }
    const openOrder = statements.latestOpenAccountOrder.get(Number(user.id), kind, amountFen);
    if (openOrder) {
      if (body.replacePending === true && ['pending', 'rejected'].includes(openOrder.status)) statements.expireAccountOrder.run(openOrder.id);
      else if (['pending', 'rejected'].includes(openOrder.status) && Number(openOrder.expires_at) <= Date.now()) statements.expireAccountOrder.run(openOrder.id);
      else if (openOrder.status === 'paid' && Number(openOrder.access_expires_at || 0) <= Date.now()) statements.expireAccountDownloadAccess.run(Date.now(), openOrder.id, Number(user.id), Date.now());
      else return respondJson(req, res, 200, { order: publicAccountOrder(openOrder), rewardCode: reward, user: publicUser(user) });
    }
    const id = createAccountOrderId(kind), now = Date.now();
    statements.insertAccountOrder.run(id, Number(user.id), kind, amountFen, now, now + guestOrderLifetime);
    paymentOcrWorker().catch(error => console.error('Payment OCR warm-up failed:', error));
    return respondJson(req, res, 201, {
      order: publicAccountOrder(statements.accountOrderById.get(id)), rewardCode: reward, user: publicUser(user)
    });
  }

  if (pathname === '/api/payments/account/access' && req.method === 'GET') {
    const activeAccess = statements.activeAccountDownloadAccess.get(Number(user.id), Date.now());
    return respondJson(req, res, 200, {
      order: activeAccess ? publicAccountOrder(activeAccess) : null,
      user: publicUser(user)
    });
  }

  if (pathname === '/api/payments/account/order' && req.method === 'GET') {
    const id = String(searchParams.get('id') || '');
    const order = statements.accountOrderByIdAndUser.get(id, Number(user.id));
    if (!order) return respondJson(req, res, 404, { error: '没有找到当前账户订单' });
    if (Number(order.expires_at) <= Date.now() && ['pending', 'rejected'].includes(order.status)) {
      statements.expireAccountOrder.run(order.id); order.status = 'expired';
    }
    if (order.status === 'paid' && order.kind === 'own_pdf' && Number(order.access_expires_at || 0) <= Date.now()) {
      statements.expireAccountDownloadAccess.run(Date.now(), order.id, Number(user.id), Date.now()); order.status = 'consumed';
    }
    return respondJson(req, res, 200, { order: publicAccountOrder(order), rewardCode: reward, user: publicUser(statements.userByUsername.get(user.username)) });
  }

  if (pathname === '/api/payments/account/order/submit' && req.method === 'POST') {
    const body = await readJson(req, maximumPaymentProofBytes * 2);
    const order = statements.accountOrderByIdAndUser.get(String(body.orderId || ''), Number(user.id));
    if (!order) return respondJson(req, res, 404, { error: '没有找到当前账户订单' });
    if (!allowAttempt(req, `account-proof-ocr:${user.id}:${order.id}`, 10, 10 * 60 * 1000)) return respondJson(req, res, 429, { error: '本订单截图校验次数过多，请更换订单后重试' });
    if (Number(order.expires_at) <= Date.now()) {
      statements.expireAccountOrder.run(order.id);
      return respondJson(req, res, 410, { error: '截图上传期限已经结束，请重新创建订单' });
    }
    if (!['pending', 'rejected'].includes(order.status)) return respondJson(req, res, 409, { error: '当前订单状态不能重新提交付款凭证' });
    const reference = String(body.paymentReference || '').normalize('NFKC').trim();
    if (reference.length > 80 || /[\r\n]/.test(reference)) return respondJson(req, res, 400, { error: '支付单号或备注不能超过 80 个字符' });
    const proof = parsePaymentProof(body.proofDataUrl), proofBytes = Buffer.from(proof.base64, 'base64');
    const proofHash = crypto.createHash('sha256').update(proofBytes).digest('hex');
    if (statements.guestOrderByProofHash.get(proofHash) || statements.accountOrderByProofHash.get(proofHash)) {
      return respondJson(req, res, 409, { error: '这张付款截图已经使用过，请上传本次订单的截图' });
    }
    let ocr;
    try { ocr = await recognizePaymentProof(proofBytes, order); }
    catch (error) {
      console.error('Account payment proof OCR failed:', error);
      return respondJson(req, res, 503, { error: '暂时无法识别付款截图，请稍后重试' });
    }
    if (!ocr.match) return respondJson(req, res, 422, { error: '截图中的付款时间不在本订单两分钟内，请上传本次支付成功截图' });
    const amounts = paymentAmountCandidates(ocr.text);
    let settledAmountFen = Number(order.amount_fen);
    const amountMatched = amounts.includes(settledAmountFen);
    if (order.kind === 'recharge' && !amountMatched) {
      const recognizedText = amounts.length ? amounts.map(value => `${(value / 100).toFixed(2)} 元`).join('、') : '无法识别';
      return respondJson(req, res, 422, {
        code: 'RECHARGE_AMOUNT_MISMATCH',
        error: `充值金额与截图金额不一致：订单金额 ${(settledAmountFen / 100).toFixed(2)} 元，截图识别金额为 ${recognizedText}。为防止严重入账错误，本次不会自动充值。请不要重复付款，通过“用户反馈”提交付款截图和相关证据，管理员将在几天内处理`
      });
    } else if (!amountMatched) {
      const renewedAt = Date.now();
      statements.renewAccountOrderWindow.run(renewedAt, renewedAt + guestOrderLifetime, order.id, Number(user.id));
      const recognizedText = amounts.length ? amounts.map(value => `${(value / 100).toFixed(2)} 元`).join('、') : '无法识别';
      return respondJson(req, res, 422, {
        code: 'PAYMENT_AMOUNT_MISMATCH',
        error: `付款金额不符：本订单应付 ${(Number(order.amount_fen) / 100).toFixed(2)} 元，截图识别金额为 ${recognizedText}。已重新开启 2 分钟付款窗口，请按正确金额重新支付并上传新截图`,
        expectedAmountFen: Number(order.amount_fen),
        recognizedAmountsFen: amounts,
        order: publicAccountOrder(statements.accountOrderById.get(order.id))
      });
    }

    const now = Date.now();
    try {
      inTransaction(() => {
        const paid = statements.payAccountOrderByOcr.run(
          reference, proof.mime, proof.base64, proofHash, ocr.text.slice(0, 2000), ocr.confidence,
          ocr.match.epoch, now, now, order.kind === 'own_pdf' ? now + downloadAccessLifetime : null, order.id, Number(user.id)
        );
        if (!paid.changes) throw Object.assign(new Error('订单状态已经改变，请刷新后重试'), { statusCode: 409 });
        if(order.kind==='own_pdf')pointsStore.reward(Number(user.id),order.id);
        if (order.kind === 'recharge') {
          const consumed = statements.consumeRechargeOrder.run(now, order.id, Number(user.id));
          if (!consumed.changes) throw Object.assign(new Error('充值订单状态异常'), { statusCode: 409 });
          statements.creditUserBalance.run(settledAmountFen, now, Number(user.id));
          const updated = statements.userByUsername.get(user.username);
          statements.insertWalletLedger.run(Number(user.id), settledAmountFen, Number(updated.balance_fen), 'reward_code_recharge', order.id, now);
        }
      });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return respondJson(req, res, 409, { error: '这张付款截图已经使用过' });
      throw error;
    }
    const updatedUser = statements.userByUsername.get(user.username);
    const updatedOrder = statements.accountOrderById.get(order.id);
    return respondJson(req, res, 200, {
      message: order.kind === 'recharge' ? `充值成功，已到账 ${(settledAmountFen / 100).toFixed(2)} 元` : '截图校验通过，已获得 2 分钟重复下载权限',
      creditedAmountFen: order.kind === 'recharge' ? settledAmountFen : null,
      order: publicAccountOrder(updatedOrder), user: publicUser(updatedUser)
    });
  }

  if (pathname === '/api/payments/account/balance-download' && req.method === 'POST') {
    if (user.role === 'superuser') return respondJson(req, res, 200, { free: true, user: publicUser(user) });
    const activeAccess = statements.activeAccountDownloadAccess.get(Number(user.id), Date.now());
    if (activeAccess) return respondJson(req, res, 200, { order: publicAccountOrder(activeAccess), user: publicUser(user), reused: true });
    if (Number(user.balance_fen) < pricing.memberOwnPdfFen) {
      return respondJson(req, res, 409, {
        code: 'INSUFFICIENT_BALANCE',
        error: '当前账户余额不足',
        balanceFen: Number(user.balance_fen),
        requiredFen: pricing.memberOwnPdfFen
      });
    }
    const now = Date.now(), id = createAccountOrderId('own_pdf');
    let updated;
    inTransaction(() => {
      const debited = statements.debitUserBalance.run(pricing.memberOwnPdfFen, now, Number(user.id), pricing.memberOwnPdfFen);
      if (!debited.changes) throw Object.assign(new Error(`余额不足，请先充值；本次需要 ${Number(pricing.memberOwnPdfFen / 100).toFixed(2)} 元`), { statusCode: 409 });
      statements.insertPaidAccountOrder.run(id, Number(user.id), pricing.memberOwnPdfFen, now, now, now + 3 * 24 * 60 * 60 * 1000, now + downloadAccessLifetime);
      pointsStore.reward(Number(user.id),id);
      updated = statements.userByUsername.get(user.username);
      statements.insertWalletLedger.run(Number(user.id), -pricing.memberOwnPdfFen, Number(updated.balance_fen), 'own_pdf_download', id, now);
    });
    return respondJson(req, res, 200, { order: publicAccountOrder(statements.accountOrderById.get(id)), user: publicUser(updated) });
  }

  if (pathname === '/api/payments/account/order/consume' && req.method === 'POST') {
    const body = await readJson(req), id = String(body.orderId || '');
    const order = statements.accountOrderByIdAndUser.get(id, Number(user.id));
    if (!order || order.kind !== 'own_pdf' || order.status !== 'paid' || Number(order.access_expires_at || 0) <= Date.now()) {
      if (order) statements.expireAccountDownloadAccess.run(Date.now(), id, Number(user.id), Date.now());
      return respondJson(req, res, 409, { error: '当前订单的下载权限已结束' });
    }
    return respondJson(req, res, 200, { authorized: true, accessExpiresAt: Number(order.access_expires_at), user: publicUser(statements.userByUsername.get(user.username)) });
  }
  return respondJson(req, res, 404, { error: '账户支付接口不存在' });
}

async function handleGuestOrderAdmin(req, res, pathname, searchParams) {
  const admin = requireSuperuser(req, res);
  if (!admin) return;
  if (pathname === '/api/admin/guest-orders' && req.method === 'GET') {
    const requested = String(searchParams.get('status') || 'submitted');
    const status = ['submitted', 'paid', 'rejected', 'consumed', 'expired'].includes(requested) ? requested : 'submitted';
    return respondJson(req, res, 200, { orders: statements.listGuestOrdersForReview.all(status).map(order => ({
      ...publicGuestOrder(order), hasProof: Boolean(order.proof_mime), proofUrl: order.proof_mime ? `/api/admin/guest-orders/${encodeURIComponent(order.id)}/proof` : null
    })) });
  }
  const proofMatch = /^\/api\/admin\/guest-orders\/([A-Z0-9]+)\/proof$/.exec(pathname);
  if (proofMatch && req.method === 'GET') {
    const order = statements.guestOrderById.get(proofMatch[1]);
    if (!order || !order.proof_mime || !order.proof_base64) return respondJson(req, res, 404, { error: '付款截图不存在' });
    return respond(req, res, 200, Buffer.from(order.proof_base64, 'base64'), { 'Content-Type': order.proof_mime, 'Content-Disposition': 'inline' });
  }
  const reviewMatch = /^\/api\/admin\/guest-orders\/([A-Z0-9]+)\/review$/.exec(pathname);
  if (reviewMatch && req.method === 'POST') {
    const body = await readJson(req), action = String(body.action || ''), note = String(body.note || '').normalize('NFKC').trim().slice(0, 200);
    if (!['approve', 'reject'].includes(action)) return respondJson(req, res, 400, { error: '审核操作不正确' });
    const now = Date.now(), nextStatus = action === 'approve' ? 'paid' : 'rejected';
    const result = statements.reviewGuestOrder.run(
      nextStatus, note, Number(admin.id), now,
      action === 'approve' ? now : null,
      action === 'approve' ? now + downloadAccessLifetime : null,
      reviewMatch[1]
    );
    if (!result.changes) return respondJson(req, res, 409, { error: '订单已被审核或状态已经改变' });
    return respondJson(req, res, 200, { message: action === 'approve' ? '已批准游客下载' : '已驳回付款凭证', order: publicGuestOrder(statements.guestOrderById.get(reviewMatch[1])) });
  }
  return respondJson(req, res, 404, { error: '审核接口不存在' });
}

async function handleRegister(req, res) {
  if (!allowAttempt(req, 'register', 8)) return respondJson(req, res, 429, { error: '注册尝试过于频繁，请稍后再试' });
  const body = await readJson(req);
  const username = normalizeUsername(body.username), email = normalizeEmail(body.email), password = String(body.password || '');
  if (!validUsername(username)) return respondJson(req, res, 400, { error: '用户名需为 3–24 位文字、字母、数字、下划线或短横线' });
  if (password.length < 8 || password.length > 72) return respondJson(req, res, 400, { error: '密码长度需为 8–72 位' });
  if (!email || !validEmail(email)) return respondJson(req, res, 400, { error: '注册必须填写有效邮箱' });
  if (statements.userByUsername.get(username)) return respondJson(req, res, 409, { error: '该用户名已被使用' });
  if (statements.userByEmail.get(email)) return respondJson(req, res, 409, { error: '该邮箱已绑定其他账号' });

  const credentials = await createPassword(password); const now = Date.now();
  consumeValidRegistrationCode(email, body.code);
  const result = statements.insertUser.run(username, credentials.hash, credentials.salt, email, now, now);
  const user = statements.userByUsername.get(username);
  respondJson(req, res, 201, { message: '邮箱验证成功，账号创建成功', user: publicUser(user), pricing }, { 'Set-Cookie': issueSession(req, Number(result.lastInsertRowid)) });
}

async function handleLogin(req, res) {
  if (!allowAttempt(req, 'login', 15)) return respondJson(req, res, 429, { error: '登录尝试过于频繁，请稍后再试' });
  const body = await readJson(req);
  const identifier = String(body.identifier || '').normalize('NFKC').trim();
  const password = String(body.password || '');
  if (!identifier || !password || password.length > 72) return respondJson(req, res, 400, { error: '请输入账号和密码' });
  const user = statements.userByLogin.get(identifier, identifier.toLowerCase(), normalizePhone(identifier));
  const matches = user ? await passwordMatches(password, user.password_salt, user.password_hash) : false;
  if (!matches) return respondJson(req, res, 401, { error: '账号或密码不正确；邮箱需验证后才能登录' });
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

let galleryHandler;
async function handleApi(req, res, pathname, searchParams) {
  if (!sameOrigin(req)) return respondJson(req, res, 403, { error: '请求来源不受信任' });
  if (pathname === '/api/gallery' || pathname.startsWith('/api/gallery/')) {
    galleryHandler ||= require('./gallery-store.js').createGalleryHandler({db,currentUser,respondJson,readJson,allowAttempt,points:pointsStore});
    return galleryHandler(req,res,pathname,searchParams);
  }
  if (pathname === '/api/health' && req.method === 'GET') return respondJson(req, res, 200, { ok: true, database: 'sqlite' });
  if (pathname === '/api/points' && req.method === 'GET') {
    const user=currentUser(req);if(!user)return respondJson(req,res,401,{error:'请先登录'});
    const entries=db.prepare('SELECT delta,kind,created_at FROM point_ledger WHERE user_id=? ORDER BY id DESC LIMIT 50').all(user.id);
    return respondJson(req,res,200,{points:pointsStore.balance(user.id)/100,entries:entries.map(e=>({points:e.delta/100,kind:e.kind,createdAt:e.created_at}))});
  }
  if (pathname === '/api/billing/config' && req.method === 'GET') return respondJson(req, res, 200, { pricing, rechargeEnabled: true, rechargeMinimumFen: 100, rechargeMaximumFen: 50000, wechatPay: wechatPayStatus(), rewardCode: rewardCodeStatus() });
  if (pathname === '/api/payments/reward-code/image' && req.method === 'GET') {
    const reward = rewardCodeStatus();
    if (!reward.configured) return respondJson(req, res, 404, { error: '赞赏码图片尚未配置' });
    return respond(req, res, 200, fs.readFileSync(rewardCodeImagePath), { 'Content-Type': rewardCodeMime() });
  }
  if (pathname === '/api/admin/reward-code') return handleRewardCodeAdmin(req, res);
  if (pathname.startsWith('/api/payments/guest/order')) return handleGuestOrder(req, res, pathname);
  if (pathname.startsWith('/api/payments/account/')) return handleAccountPayment(req, res, pathname, searchParams);
  if (pathname.startsWith('/api/admin/guest-orders')) return handleGuestOrderAdmin(req, res, pathname, searchParams);
  if (pathname === '/api/auth/config' && req.method === 'GET') return respondJson(req, res, 200, { verification: verificationProviderStatus(), securityQuestions });
  if (pathname === '/api/auth/me' && req.method === 'GET') return respondJson(req, res, 200, { user: publicUser(currentUser(req)), pricing });
  if (pathname === '/api/feedback') return handleFeedback(req, res);
  if (pathname === '/api/draft') return handleDraft(req, res);
  if (pathname === '/api/auth/register' && req.method === 'POST') return handleRegister(req, res);
  if (pathname === '/api/auth/register/request-code' && req.method === 'POST') return handleRegistrationCode(req, res);
  if (pathname === '/api/auth/login' && req.method === 'POST') return handleLogin(req, res);
  if (pathname === '/api/auth/contact/request-code' && req.method === 'POST') return handleBindingCode(req, res);
  if (pathname === '/api/auth/contact/verify' && req.method === 'POST') return handleBindContact(req, res);
  if (pathname === '/api/auth/password/request-code' && req.method === 'POST') return handleResetCode(req, res);
  if (pathname === '/api/auth/password/reset' && req.method === 'POST') return handleResetPassword(req, res);
  if (pathname === '/api/auth/security-question' && req.method === 'GET') return handleGetSecurityQuestion(req, res, searchParams);
  if (pathname === '/api/auth/security-question' && req.method === 'POST') return handleSetSecurityQuestion(req, res);
  if (pathname === '/api/auth/password/reset-with-security-question' && req.method === 'POST') return handleSecurityQuestionReset(req, res);
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = parseCookies(req).pindou_session;
    if (token) statements.deleteSession.run(tokenHash(token));
    return respondJson(req, res, 200, { message: '已退出登录' }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  respondJson(req, res, 404, { error: '接口不存在' });
}

async function handleRequest(req, res) {
  let parsedUrl, pathname;
  try { parsedUrl = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(parsedUrl.pathname); }
  catch { return respond(req, res, 400, 'Bad Request'); }

  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname, parsedUrl.searchParams);
  if (req.method !== 'GET' && req.method !== 'HEAD') return respond(req, res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });

  const relativePath = publicFiles.get(pathname);
  if (!relativePath) return respond(req, res, 404, 'Not Found');
  const filePath = path.join(__dirname, relativePath);
  try {
    await respondStatic(req, res, filePath, parsedUrl.searchParams.has('v'));
  } catch (error) {
    respond(req, res, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not Found' : 'Internal Server Error');
  }
}

function cleanupExpired() {
  const now = Date.now();
  statements.deleteExpiredSessions.run(now);
  statements.deleteExpiredDrafts.run(now);
  statements.deleteExpiredVerificationCodes.run(now);
  statements.deleteExpiredRegistrationCodes.run(now);
  statements.expireStaleGuestOrders.run(now);
  statements.expireStaleGuestDownloadAccess.run(now, now);
  statements.deleteOldGuestOrders.run(now - 3 * 24 * 60 * 60 * 1000);
  statements.expireStaleAccountOrders.run(now);
  statements.expireStaleAccountDownloadAccess.run(now, now);
  statements.deleteOldAccountOrders.run(now - 30 * 24 * 60 * 60 * 1000);
}
galleryHandler = require('./gallery-store.js').createGalleryHandler({db,currentUser,respondJson,readJson,allowAttempt,points:pointsStore});
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

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(cleanupTimer);
  server.close(async () => {
    try {
      const worker = paymentOcrWorkerPromise ? await paymentOcrWorkerPromise : null;
      if (worker) await worker.terminate();
    } catch (error) { console.error('Payment OCR shutdown error:', error); }
    db.close();
    process.exit(0);
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
