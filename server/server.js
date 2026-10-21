'use strict';

// 고스톱 서버 — 의존성 0개, Node 표준 라이브러리만 사용.
// 실행: node server/server.js
// 같은 집 와이파이의 다른 기기(폰·태블릿·PC)가 주소로 접속한다.
//
// 통신 방식: 폴링(1~2초) + 액션 POST
//   - GET  /api/room/:code/state?since=N  → 상태 스냅샷 + 새 이펙트
//   - POST /api/room/:code/join           → 입장
//   - POST /api/room/:code/action         → 수 두기/고/스톱 등
//
// 플레이어 식별은 쿠키(gs_id)로 한다. 응답 본문이나 URL 에 토큰을 넣지 않는다.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { Room, ROOM_PHASE, randomCode } = require('./rooms');
const { EngineError } = require('../engine/play');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const MAX_FX = 200;

/**
 * 빌드 버전 — 화면·엔진·자산을 바꿀 때마다 올린다.
 * 클라이언트가 이 값을 비교해 오래된 화면이면 자동으로 새로고침한다.
 */
const { GAME_VERSION, BUILD_VERSION } = require('./version');

/** 방 목록 */
const rooms = new Map();

// ── 유틸 ────────────────────────────────────────────────────────────────────

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';

  // /assets/** 는 프로젝트 루트의 assets 폴더(카드 이미지·사운드)에서 제공한다
  const baseDir = rel.startsWith('/assets/') ? ASSETS_DIR : PUBLIC_DIR;
  const subPath = rel.startsWith('/assets/') ? rel.slice('/assets'.length) : rel;

  const filePath = path.join(baseDir, path.normalize(subPath).replace(/^(\.\.[\\/])+/, ''));
  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403).end('접근 금지');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA 폴백
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(fallback, (e2, buf) => {
        if (e2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
          return;
        }
        const html = buf.toString('utf8').replace(/\{\{GAME_VERSION\}\}/g, GAME_VERSION);
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' }).end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // 코드는 자주 고치므로 캐시하지 않는다. 이미지·사운드만 캐시한다.
    const noCache = ext === '.html' || ext === '.js' || ext === '.css' || ext === '.json';
    headers['Cache-Control'] = noCache ? 'no-store' : 'public, max-age=86400';

    // HTML에는 버전 표시를 끼워 넣는다(화면과 서버 버전이 어긋나지 않게)
    if (ext === '.html') {
      fs.readFile(filePath, (e2, buf) => {
        if (e2) {
          res.writeHead(404).end('Not Found');
          return;
        }
        const html = buf.toString('utf8').replace(/\{\{GAME_VERSION\}\}/g, GAME_VERSION);
        res.writeHead(200, headers).end(html);
      });
      return;
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

/** 로컬 IP 주소 목록 (접속 안내용). */
function localAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push({ name, address: net.address });
    }
  }
  return out;
}

// ── 방 관리 ─────────────────────────────────────────────────────────────────

function createRoom(options = {}) {
  let code = randomCode();
  while (rooms.has(code)) code = randomCode();
  const room = new Room(code, options);
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase()) || null;
}

/** 중복 요청 방지용: 플레이어별 최근 requestId 기록 */
const seenRequests = new Map(); // `${code}:${playerId}` → Set

function isDuplicateRequest(code, playerId, requestId) {
  if (!requestId) return false;
  const key = `${code}:${playerId}`;
  if (!seenRequests.has(key)) seenRequests.set(key, new Set());
  const set = seenRequests.get(key);
  if (set.has(requestId)) return true;
  set.add(requestId);
  if (set.size > 50) {
    const first = set.values().next().value;
    set.delete(first);
  }
  return false;
}

// ── 라우팅 ─────────────────────────────────────────────────────────────────

async function handleApi(req, res, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ['api','room',code,...]
  const cookies = parseCookies(req);
  const playerId = cookies.gs_id || null;

  // GET /api/version — 빌드 버전 (클라이언트 자동 갱신용)
  if (segments.length === 2 && segments[1] === 'version' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, version: BUILD_VERSION, gameVersion: GAME_VERSION });
  }

  // POST /api/room — 방 만들기
  if (segments[1] === 'room' && segments.length === 2 && req.method === 'POST') {
    const body = await readJsonBody(req);
    // 방 모드: 'multi' = 사람끼리 / 'solo' = 나 혼자 + AI
    const options = {
      mode: body.mode === 'solo' ? 'solo' : 'multi',
      playerCount: [2, 3, 4].includes(Number(body.playerCount)) ? Number(body.playerCount) : 3,
      aiDifficulty: body.aiDifficulty,
    };
    const room = createRoom(options);
    const id = crypto.randomUUID();
    const joined = room.addPlayer(id, body.name);
    const headers = { 'Set-Cookie': `gs_id=${id}; Path=/; SameSite=Lax; Max-Age=86400` };
    return sendJson(res, 200, { code: room.code, seat: joined.seat, name: joined.player.name, mode: room.settings.mode }, headers);
  }

  if (segments[1] !== 'room' || !segments[2]) {
    return sendJson(res, 404, { ok: false, error: '없는 경로입니다.' });
  }

  const code = segments[2].toUpperCase();
  const room = getRoom(code);
  if (!room) {
    return sendJson(res, 404, { ok: false, error: '방을 찾을 수 없습니다. 방 코드를 확인해 주세요.' });
  }

  // POST /api/room/:code/join — 입장
  if (segments.length === 4 && segments[3] === 'join' && req.method === 'POST') {
    const body = await readJsonBody(req);
    let id = playerId;
    let joined = id ? room.findPlayer(id) : null;

    if (!joined) {
      if (!room.hasFreeSeat()) {
        return sendJson(res, 409, { ok: false, error: '방이 가득 찼습니다.' });
      }
      id = crypto.randomUUID();
      joined = room.addPlayer(id, body.name);
    }
    room.markSeen(id);
    const headers = id !== playerId
      ? { 'Set-Cookie': `gs_id=${id}; Path=/; SameSite=Lax; Max-Age=86400` }
      : {};
    return sendJson(
      res,
      200,
      { ok: true, code: room.code, seat: joined.seat, name: joined.player.name, playerCount: room.playerCount },
      headers
    );
  }

  // GET /api/room/:code/state — 상태 조회(긴 폴링)
  if (segments.length === 4 && segments[3] === 'state' && req.method === 'GET') {
    if (playerId) room.markSeen(playerId);
    const player = playerId ? room.findPlayer(playerId) : null;
    const seat = player ? player.seat : -1;
    const since = Number(url.searchParams.get('since') || 0);
    const clientVersion = Number(url.searchParams.get('v') || -1);

    // 긴 폴링 — 상태가 바뀌면 즉시 응답한다(지연 없음).
    // 바뀌지 않으면 20초 뒤 현재 상태로 응답한다(하트비트).
    if (clientVersion >= 0 && clientVersion === room.version) {
      await room.waitForChange(20000);
    }

    const fx = room.fx.filter((e) => e.seq > since);
    return sendJson(res, 200, {
      ok: true,
      state: room.snapshot(seat, playerId),
      fx,
      log: room.log.slice(-30),
      version: room.version,
    });
  }

  // POST /api/room/:code/action — 액션
  if (segments.length === 4 && segments[3] === 'action' && req.method === 'POST') {
    const body = await readJsonBody(req);
    if (!playerId) {
      return sendJson(res, 401, { ok: false, error: '먼저 방에 입장해 주세요.' });
    }
    const player = room.findPlayer(playerId);
    if (!player) {
      return sendJson(res, 403, { ok: false, error: '이 방의 참가자가 아닙니다.' });
    }
    room.markSeen(playerId);

    if (isDuplicateRequest(code, playerId, body.requestId)) {
      return sendJson(res, 200, { ok: true, duplicate: true });
    }

    try {
      const result = room.act(player, body.type, body.payload || {});
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      if (err instanceof EngineError) {
        return sendJson(res, 200, { ok: false, error: err.message });
      }
      console.error('[api] 액션 처리 오류:', err);
      return sendJson(res, 500, { ok: false, error: '처리 중 오류가 발생했습니다.' });
    }
  }

  return sendJson(res, 404, { ok: false, error: '없는 경로입니다.' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      console.error('[api] 처리 오류:', err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: '서버 오류' });
    }
    return;
  }

  serveStatic(req, res, url.pathname);
});

// ── 주기 작업 ───────────────────────────────────────────────────────────────

setInterval(() => {
  for (const [code, room] of rooms) {
    try {
      room.checkTimeout();
    } catch (err) {
      console.error(`[room ${code}] 타임아웃 처리 오류:`, err.message);
    }
    if (room.isEmpty && Date.now() - room.lastActivity > 30 * 60 * 1000) {
      rooms.delete(code);
    } else if (room.isExpired) {
      rooms.delete(code);
    }
  }
}, 1000);

// ── 시작 ────────────────────────────────────────────────────────────────────

server.listen(PORT, HOST, () => {
  const addrs = localAddresses();
  const line = '─'.repeat(58);
  console.log(line);
  console.log('  고스톱 서버가 시작되었습니다.');
  console.log(line);
  console.log(`  이 PC에서 접속   :  http://localhost:${PORT}`);
  for (const a of addrs) {
    console.log(`  같은 와이파이    :  http://${a.address}:${PORT}   (${a.name})`);
  }
  if (addrs.length > 0) {
    console.log(`  .local 주소      :  http://${os.hostname()}.local:${PORT}`);
  }
  console.log(line);
  console.log('  가족 모두 이 주소로 접속한 뒤, 방 코드를 입력하면 됩니다.');
  console.log('  종료: Ctrl + C');
  console.log(line);
});

process.on('SIGINT', () => {
  console.log('\n서버를 종료합니다.');
  process.exit(0);
});

module.exports = { server, rooms };
