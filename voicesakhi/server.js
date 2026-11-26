'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Agent } = require('./agent');
const { Services } = require('./services');

const svc = new Services({ logFile: path.join(__dirname, 'audit.log.jsonl') });
const agent = new Agent(svc);
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function json(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/turn') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      try {
        const { session = 'demo', text = '' } = JSON.parse(body || '{}');
        json(res, 200, agent.turn(String(session).slice(0, 64), String(text).slice(0, 1000)));
      } catch { json(res, 400, { error: 'bad request' }); }
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, svc.snapshot());
  if (req.method === 'POST' && url.pathname === '/api/reset') { agent.reset(url.searchParams.get('session') || 'demo'); return json(res, 200, { ok: true }); }
  const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

if (require.main === module) {
  const port = process.env.PORT || 4100;
  server.listen(port, () => console.log(`VoiceSakhi running on http://localhost:${port}`));
}
module.exports = { server };
