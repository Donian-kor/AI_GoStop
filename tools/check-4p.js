'use strict';
// 4인 광팔기 확인 — 협상 → 광값 정산 → 3인 대국까지 오류 없이 진행되는지 본다.
// 사용법: node tools/check-4p.js

const { spawn } = require('child_process');
const path = require('path');

const PORT = 8802;
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

  const c1 = makeClient();
  const c2 = makeClient();
  const c3 = makeClient();
  const c4 = makeClient();

  const room = await c1.post('/api/room', { name: '선', mode: 'multi', playerCount: 4 });
  const code = room.code;
  for (const c of [c2, c3, c4]) await c.post(`/api/room/${code}/join`, { name: '참가자' });
  console.log(`방 ${code} (4인 광팔기)`);

  await c1.post(`/api/room/${code}/action`, { type: 'start' });
  await wait(400);

  let st = await c1.get(`/api/room/${code}/state?since=0&v=-1`);
  console.log('phase:', st.state.phase, '| 협상 대기 좌석:', st.state.negotiation?.waitingSeat);

  // P2·P3 참가, P4 광팔기
  const decisions = [
    [c2, 'join'],
    [c3, 'join'],
    [c4, 'sell'],
  ];
  for (const [c, d] of decisions) {
    const s = await c.get(`/api/room/${code}/state?since=0&v=-1`);
    if (s.state.phase !== 'negotiate') break;
    const r = await c.post(`/api/room/${code}/action`, { type: 'negotiate', payload: { decision: d } });
    console.log(`  ${d} → ${r.ok ? 'OK' : r.error}`);
    await wait(250);
  }

  st = await c1.get(`/api/room/${code}/state?since=0&v=-1`);
  console.log('phase:', st.state.phase, '| 광값:', JSON.stringify(st.state.gwangSale || null));
  console.log(
    '잔액:',
    st.state.players.map((p) => `${p.name} ${p.money}`).join(' / ')
  );

  // 3인 대국 — 진행 확인
  const clients = { 0: c1, 1: c2, 2: c3 };
  let errors = 0;
  for (let i = 0; i < 20; i++) {
    const s = await c1.get(`/api/room/${code}/state?since=0&v=-1`);
    if (s.state.phase === 'settle') break;
    const seat = s.state.currentSeat;
    const c = clients[seat];
    if (!c) continue;
    const p = s.state.prompt;
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
      const mine = await c.get(`/api/room/${code}/state?since=0&v=-1`);
      res = mine.state.myHand.length
        ? await c.post(`/api/room/${code}/action`, { type: 'playCard', payload: { handIndex: 0 } })
        : await c.post(`/api/room/${code}/action`, { type: 'flipOnly' });
    }
    if (res && res.ok === false) {
      errors++;
      console.log('  ✖', res.error);
    }
    await wait(120);
  }

  st = await c1.get(`/api/room/${code}/state?since=0&v=-1`);
  console.log(`\n결과: phase=${st.state.phase} · 오류 ${errors}건`);
  console.log(errors === 0 ? '✅ 4인 광팔기 정상' : '❌ 오류 발생');

  ch.kill();
  process.exit(errors === 0 ? 0 : 1);
})();
