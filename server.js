// VideoHub - zero dependency server. Run: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // CHANGE THIS
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = __dirname;   // saari files ek hi folder me (public folder nahi)
// sirf ye files bahar dikhengi (server.js / data.json kabhi nahi)
const ALLOWED = new Set(['/index.html', '/admin.html', '/style.css', '/common.js']);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function loadVideos() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}
function saveVideos(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function isAdmin(req) {
  const given = String(req.headers['x-admin-password'] || '');
  const a = Buffer.from(given), b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
  });
}

// ---- YouTube search (official YouTube Data API v3) ----
const YT_KEY = process.env.YOUTUBE_API_KEY || '';
const YT_BASE = process.env.YT_API_BASE || 'https://www.googleapis.com/youtube/v3';
const ytCache = new Map();      // same search dobara aaye to API call nahi (quota bachta hai)
let ytCalls = [];               // pichhle 24 ghante ke API calls
const YT_DAILY_LIMIT = 90;      // free quota: 10,000 units/din, 1 search = 100 units

function decodeEntities(s) {
  return String(s).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

async function ytSearch(q, short) {
  const key = (short ? 's:' : 'v:') + q.toLowerCase();
  const hit = ytCache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.data;

  ytCalls = ytCalls.filter(t => Date.now() - t < 24 * 3600 * 1000);
  if (ytCalls.length >= YT_DAILY_LIMIT) { const e = new Error('daily limit'); e.code = 429; throw e; }
  ytCalls.push(Date.now());

  const params = new URLSearchParams({
    part: 'snippet', type: 'video', maxResults: '24', videoEmbeddable: 'true', safeSearch: 'moderate',
    q: short ? q + ' #shorts' : q, key: YT_KEY
  });
  if (short) params.set('videoDuration', 'short');
  const r = await fetch(YT_BASE + '/search?' + params);
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || ('YouTube HTTP ' + r.status));
  const data = (j.items || []).filter(i => i.id && i.id.videoId).map(i => ({
    id: i.id.videoId,
    title: decodeEntities(i.snippet.title),
    channel: decodeEntities(i.snippet.channelTitle || 'YouTube'),
    url: 'https://youtu.be/' + i.id.videoId
  }));
  ytCache.set(key, { t: Date.now(), data });
  return data;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // ---- API ----
  if (url.pathname === '/api/videos' && req.method === 'GET') {
    return send(res, 200, loadVideos());
  }
  if (url.pathname === '/api/login' && req.method === 'POST') {
    return isAdmin(req) ? send(res, 200, { ok: true }) : send(res, 401, { error: 'Wrong password' });
  }
  if (url.pathname === '/api/videos' && req.method === 'POST') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Unauthorized' });
    try {
      const { url: link, title, type } = await readBody(req);
      if (!link || !/^https?:\/\//i.test(link)) return send(res, 400, { error: 'Valid link daalo' });
      const list = loadVideos();
      const video = { id: crypto.randomBytes(5).toString('hex'), url: link.trim(), title: (title || '').trim() || 'Untitled video', type: type === 'short' ? 'short' : 'video', addedAt: Date.now() };
      list.unshift(video);
      saveVideos(list);
      return send(res, 201, video);
    } catch { return send(res, 400, { error: 'Bad request' }); }
  }
  if (url.pathname.startsWith('/api/videos/') && req.method === 'PATCH') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Unauthorized' });
    try {
      const { type } = await readBody(req);
      const id = url.pathname.split('/').pop();
      const list = loadVideos();
      const v = list.find(x => x.id === id);
      if (!v) return send(res, 404, { error: 'Not found' });
      v.type = type === 'short' ? 'short' : 'video';
      saveVideos(list);
      return send(res, 200, v);
    } catch { return send(res, 400, { error: 'Bad request' }); }
  }
  if (url.pathname.startsWith('/api/videos/') && req.method === 'DELETE') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Unauthorized' });
    const id = url.pathname.split('/').pop();
    saveVideos(loadVideos().filter(v => v.id !== id));
    return send(res, 200, { ok: true });
  }

  if (url.pathname === '/api/yt-search' && req.method === 'GET') {
    if (!YT_KEY) return send(res, 503, { error: 'no_key' });
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    if (q.length < 2) return send(res, 200, []);
    try {
      return send(res, 200, await ytSearch(q, url.searchParams.get('kind') === 'short'));
    } catch (e) {
      console.error('YouTube search error:', e.message);
      return e.code === 429 ? send(res, 429, { error: 'limit' }) : send(res, 502, { error: 'yt_error' });
    }
  }

  // ---- Static ----
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (p === '/admin') p = '/admin.html';
  if (!ALLOWED.has(p)) { res.writeHead(404); return res.end('Not found'); }
  const file = path.join(PUBLIC_DIR, p);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`VideoHub chal raha hai: http://localhost:${PORT}`);
  console.log(YT_KEY ? 'YouTube search: ON' : 'YouTube search: OFF (YOUTUBE_API_KEY set nahi hai)');
  console.log(`Admin panel: http://localhost:${PORT}/admin  (password: ${ADMIN_PASSWORD})`);
});
