'use strict';
// 2인 맞고 진행 확인 — 두 클라이언트가 번갈아 두며 "내 차례" 오류가 없는지 본다.
// 사용법: node tools/check-2p.js

const { spawn } = require('child_process');
const path = require('path');

const PORT = 8801;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');

function makeClient() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
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
      return r.json();
    },
    get(u) {
      return this.req('GET', u);
    },
    post(u, b) {
      return this.req('POST', u, b);
    },
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
    } catch {
      await wait(100);
    }
  }

  const pc = makeClient();
  const phone = makeClient();

  const room = await pc.post('/api/room', { name: '아빠', mode: 'multi', playerCount: 2 });
  const code = room.code;
  await phone.post(`/api/room/${code}/join`, { name: '아들' });
  console.log(`방 ${code} (2인 맞고)`);

  await pc.post(`/api/room/${code}/action`, { type: 'start' });
  await wait(200);
  for (const c of [pc, phone]) {
    const s = await c.get(`/api/room/${code}/state?since=0`);
    if (s.state.phase === 'seon') {
      await c.post(`/api/room/${code}/action`, { type: 'seonPick', payload: { cardIndex: 0 } });
      await wait(150);
    }
  }

  let st = await pc.get(`/api/room/${code}/state?since=0`);
  console.log('phase:', st.state.phase, '| 내 손패:', st.state.myHand.length, '| 상대 손패:', st.state.players[1].handCount);

  let errors = 0;
  let plays = 0;
  const clients = { 0: pc, 1: phone };

  for (let i = 0; i < 60; i++) {
    st = await pc.get(`/api/room/${code}/state?since=0`);
    if (st.state.phase === 'settle') break;
    if (st.state.phase !== 'play') {
      await wait(200);
      continue;
    }

    const seat = st.state.currentSeat;
    const c = clients[seat];
    if (!c) {
      await wait(200);
      continue;
    }
    const p = st.state.prompt;

    let res;
    if (p && p.seat === seat) {
      if (p.type === 'goStop') res = await c.post(`/api/room/${code}/action`, { type: 'go' });
      else if (p.type === 'floorChoice') res = await c.post(`/api/room/${code}/action`, { type: 'floorChoice', payload: { choice: 0 } });
      else if (p.type === 'flipChoice') res = await c.post(`/api/room/${code}/action`, { type: 'flipChoice', payload: { ordinal: 0 } });
      else if (p.type === 'bonusDraw') {
        const o = p.options[p.options.length - 1];
        res = await c.post(`/api/room/${code}/action`, { type: 'bonusDraw', payload: { stockIndex: o.stockIndex } });
      }
    } else {
      const mine = await c.get(`/api/room/${code}/state?since=0`);
      res = mine.state.myHand.length
        ? await c.post(`/api/room/${code}/action`, { type: 'playCard', payload: { handIndex: 0 } })
        : await c.post(`/api/room/${code}/action`, { type: 'flipOnly' });
      if (res && res.ok) plays++;
    }

    if (res && res.ok === false) {
      errors++;
      console.log(`  ✖ ${res.error} (단계 ${i})`);
    }
    await wait(120);
  }

  st = await pc.get(`/api/room/${code}/state?since=0`);
  console.log(`\n결과: phase=${st.state.phase} · 처리한 수 ${plays}개 · 오류 ${errors}건`);
  console.log(errors === 0 ? '✅ "내 차례가 아닙니다" 오류 없음' : '❌ 오류 발생');

  ch.kill();
  process.exit(errors === 0 ? 0 : 1);
})();
