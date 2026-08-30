'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 4173);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

const publicFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/style.css', 'style.css'],
  ['/app.js', 'app.js'],
  ['/mard-palette.js', 'mard-palette.js'],
]);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function respond(req, res, statusCode, body, headers = {}) {
  const payload = Buffer.from(body);
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': payload.length,
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : payload);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    respond(req, res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    respond(req, res, 400, 'Bad Request');
    return;
  }

  const relativePath = publicFiles.get(pathname);
  if (!relativePath) {
    respond(req, res, 404, 'Not Found');
    return;
  }

  const filePath = path.join(__dirname, relativePath);
  fs.readFile(filePath, (error, data) => {
    if (error) {
      respond(req, res, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not Found' : 'Internal Server Error');
      return;
    }

    const headers = {
      'Cache-Control': 'no-store',
      'Content-Length': data.length,
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
    };
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Close the other server or set another PORT.`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  console.log('豆格本地服务器已启动：');
  console.log(`  本机访问：http://localhost:${port}`);

  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === 'IPv4' && !item.internal) {
        addresses.push(item.address);
      }
    }
  }

  for (const address of [...new Set(addresses)]) {
    console.log(`  局域网访问：http://${address}:${port}`);
  }
  console.log('按 Ctrl+C 停止服务器。');
});
