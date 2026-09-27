'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2);
const username = String(args.find(arg => !arg.startsWith('--')) || '').normalize('NFKC').trim();
const generatePassword = args.includes('--generate');
const resetPassword = args.includes('--reset-password');

if (username.length < 3 || username.length > 24 || !/^[\p{L}\p{N}_-]+$/u.test(username)) {
  console.error('用法：node scripts/create-superuser.js <用户名> --generate [--reset-password]');
  console.error('用户名需为 3–24 位文字、字母、数字、下划线或短横线。');
  process.exit(1);
}

let password = process.env.PINDOU_SUPERUSER_PASSWORD || '';
if (!password && generatePassword) password = crypto.randomBytes(18).toString('base64url');
if (password.length < 12 || password.length > 72) {
  console.error('请使用 --generate，或通过 PINDOU_SUPERUSER_PASSWORD 提供 12–72 位强密码。');
  process.exit(1);
}

const dataDirectory = process.env.PINDOU_DATA_DIR
  ? path.resolve(process.env.PINDOU_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const databasePath = path.join(dataDirectory, 'pindou.db');
if (!fs.existsSync(databasePath)) {
  console.error(`数据库不存在：${databasePath}。请先运行一次 node server.js。`);
  process.exit(1);
}

const db = new DatabaseSync(databasePath);
db.exec('PRAGMA busy_timeout = 5000;');
const columns = db.prepare('PRAGMA table_info(users)').all();
if (!columns.some(column => column.name === 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'superuser'))");
}

const existing = db.prepare('SELECT id, role FROM users WHERE username = ? COLLATE NOCASE LIMIT 1').get(username);
if (existing && !resetPassword) {
  db.prepare("UPDATE users SET role = 'superuser', updated_at = ? WHERE id = ?").run(Date.now(), Number(existing.id));
  db.close();
  console.log(`SUPERUSER_USERNAME=${username}`);
  console.log('PASSWORD_UNCHANGED=true');
  console.log('账户已升级为超级权限，原密码保持不变。若需重置，请追加 --reset-password。');
  process.exit(0);
}

const salt = crypto.randomBytes(16).toString('base64url');
const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64url');
const now = Date.now();

if (existing) {
  db.prepare("UPDATE users SET role = 'superuser', password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?")
    .run(hash, salt, now, Number(existing.id));
} else {
  db.prepare(`
    INSERT INTO users (username, role, password_hash, password_salt, created_at, updated_at)
    VALUES (?, 'superuser', ?, ?, ?, ?)
  `).run(username, hash, salt, now, now);
}
db.close();

console.log(`SUPERUSER_USERNAME=${username}`);
console.log(`SUPERUSER_PASSWORD=${password}`);
console.log('请立即安全保存密码；数据库中只保存 scrypt 哈希，无法反查明文。');
