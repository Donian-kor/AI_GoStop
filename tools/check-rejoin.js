'use strict';
// 재접속 검증 — 방에 들어갔다가 새로고침(재입장)해도 오류 없이 복귀하는지 본다.
// 사용법: node tools/check-rejoin.js

const { spawn } = require('child_process');
const path = require('path');

const PORT = 8803;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');

function makeClient() {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async req(m, u, b) {
      const r = await fetch(BASE + u, {
        method: m,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: b ? JSON.stringify(b) : undefined,
      });
      const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      for (const c of sc) {
        const p = c.split(';')[0];
        if (p.startsWith('gs_id=')) cookie = p;
      }
      return { status: r.status, body: await r.json().catch(() => ({})) };
    },
    get(u) { return this.req('GET', u); },
    post(u, b) { return this.req('POST', u, b); },
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ch = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/api/room/AAAAAA/state`);
      if (r.status === 404) break;
      await wait(100);
    } catch { await wait(100); }
  }

  const c = makeClient();
  const created = await c.post('/api/room', { name: '엄마' });
  const code = created.body.code;
  console.log(`방 생성: ${code} (seat ${created.body.seat})`);

  // 같은 쿠키로 재입장 (= 새로고침 후 복귀)
  const again = await c.post(`/api/room/${code}/join`, { name: '엄마' });
  console.log(`재입장: HTTP ${again.status} → ${JSON.stringify(again.body)}`);
  const ok1 = again.status === 200 && again.body.ok === true && again.body.seat === created.body.seat;

  // 다른 사람이 그 방에 참가 (3인)
  const c2 = makeClient();
  const j2 = await c2.post(`/api/room/${code}/join`, { name: '아빠' });
  const c3 = makeClient();
  const j3 = await c3.post(`/api/room/${code}/join`, { name: '나' });
  console.log(`추가 입장: ${j2.body.seat}, ${j3.body.seat}`);

  // 상태 조회가 여전히 정상인지
  const st = await c.get(`/api/room/${code}/state?since=0&v=-1`);
  console.log(`상태 조회: HTTP ${st.status} / 플레이어 ${st.body.state ? st.body.state.players.length : '없음'}`);

  // 재입장 후에도 그 자리에 앉아 있는지
  const re = await c.get(`/api/room/${code}/state?since=0&v=-1`);
  const me = re.body.state.players.find((p) => p.seat === created.body.seat);
  console.log(`재입장 후 자리: ${me ? me.name : '없음'} / 좌석 ${created.body.seat}`);

  const okAll = ok1 && st.status === 200 && !!me;
  console.log(okAll ? '\n✅ 재접속 정상' : '\n❌ 재접속 오류');

  ch.kill();
  process.exit(okAll ? 0 : 1);
})();
