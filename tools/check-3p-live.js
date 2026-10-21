'use strict';
// 3대 접속 실전 시뮬레이션 — 실행 중인 서버(8787)에 쿠키가 다른 클라이언트 3개로 접속한다.
//   1) 3명 방 만들기/참가 → 선 결정 → 한 판 완주 → 정산
//   2) 대국 중 새로고침(같은 쿠키로 새 클라이언트) → 같은 방·같은 좌석·같은 손패
//   3) 새 판에서 한 명이 폴링을 멈춤 → 20초 뒤 '연결 끊김' → 30초 뒤 자동 진행
// 실행: 서버를 켠 뒤 node tools/check-3p-live.js  (약 2분)

const BASE = 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(initialCookie) {
  let cookie = initialCookie || '';
  return {
    get cookie() {
      return cookie;
    },
    async req(method, url, body) {
      const res = await fetch(BASE + url, {
        method,
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          cookie ? { Cookie: cookie } : {}
        ),
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of setCookie) {
        const pair = c.split(';')[0];
        if (pair.indexOf('gs_id=') === 0) cookie = pair;
      }
      return res.json();
    },
    get(url) {
      return this.req('GET', url);
    },
    post(url, body) {
      return this.req('POST', url, body);
    },
  };
}

function check(cond, msg) {
  if (!cond) throw new Error('실패: ' + msg);
  console.log('  ✔ ' + msg);
}

async function pickSeon(clients, code) {
  for (let i = 0; i < 30; i++) {
    const s = await clients[0].get(`/api/room/${code}/state`);
    if (s.state.phase !== 'seon') return s.state;
    for (const c of clients) {
      const own = await c.get(`/api/room/${code}/state`);
      if (own.state.phase !== 'seon') break;
      if (own.state.seonPicked && own.state.seonPicked[own.state.mySeat] === -1) {
        const r = await c.post(`/api/room/${code}/action`, {
          type: 'seonPick',
          payload: { cardIndex: 0 },
        });
        if (!r.ok) throw new Error('선 선택 실패: ' + r.error);
      }
    }
  }
  throw new Error('선 결정이 끝나지 않음');
}

async function step(code, clients) {
  const s = await clients[0].get(`/api/room/${code}/state`);
  if (s.state.phase !== 'play') return s.state;
  const seat = s.state.currentSeat;
  const client = clients[seat];
  const p = s.state.prompt;
  if (p && p.seat === seat) {
    if (p.type === 'goStop') {
      await client.post(`/api/room/${code}/action`, { type: 'stop' });
      return s.state;
    }
    if (p.type === 'floorChoice') {
      await client.post(`/api/room/${code}/action`, {
        type: 'floorChoice',
        payload: { choice: 0 },
      });
      return s.state;
    }
    if (p.type === 'flipChoice') {
      await client.post(`/api/room/${code}/action`, {
        type: 'flipChoice',
        payload: { ordinal: 0 },
      });
      return s.state;
    }
    if (p.type === 'bonusDraw') {
      const opt = p.options[p.options.length - 1];
      await client.post(`/api/room/${code}/action`, {
        type: 'bonusDraw',
        payload: { stockIndex: opt.stockIndex },
      });
      return s.state;
    }
    throw new Error('처리 못한 프롬프트: ' + p.type);
  }

  const own = await client.get(`/api/room/${code}/state`);
  const hand = own.state.myHand || [];
  let idx = 0;
  for (let i = 0; i < hand.length; i++) {
    if (hand[i].kind !== 'bonus') {
      idx = i;
      break;
    }
  }
  const res = hand.length
    ? await client.post(`/api/room/${code}/action`, {
        type: 'playCard',
        payload: { handIndex: idx },
      })
    : await client.post(`/api/room/${code}/action`, { type: 'flipOnly' });
  if (!res.ok) throw new Error('수 두기 실패: ' + res.error);
  return s.state;
}

async function main() {
  console.log('[1] 3명 접속 + 한 판 완주');
  const host = makeClient();
  const created = await host.post('/api/room', {
    name: '테스트1',
    mode: 'multi',
    playerCount: 3,
  });
  const code = created.code;
  check(!!code && code.length === 6, '방 코드 6자리: ' + code);

  const p2 = makeClient();
  const p3 = makeClient();
  const j2 = await p2.post(`/api/room/${code}/join`, { name: '테스트2' });
  const j3 = await p3.post(`/api/room/${code}/join`, { name: '테스트3' });
  check(j2.seat === 1 && j3.seat === 2, '3명 입장 (좌석 0/1/2)');

  await host.post(`/api/room/${code}/action`, { type: 'start' });
  await pickSeon([host, p2, p3], code);
  let st = await host.get(`/api/room/${code}/state`);
  check(st.state.phase === 'play', '선 결정 → 대국 시작');
  check(st.state.myHand.length === 7, '내 손패 7장');
  check(st.state.table.length === 6, '바닥 6장');

  const clients = [host, p2, p3];
  let phase = 'play';
  let steps = 0;
  let refreshedChecked = false;
  while (phase !== 'settle' && steps < 600) {
    steps++;
    st = await host.get(`/api/room/${code}/state`);
    phase = st.state.phase;
    if (phase === 'settle') break;

    // 대국 중 새로고침 시뮬레이션 (같은 쿠키 = 같은 사람)
    if (steps === 6 && !refreshedChecked) {
      refreshedChecked = true;
      const fresh = makeClient(host.cookie);
      const rs = await fresh.get(`/api/room/${code}/state?since=0`);
      const sameHand =
        JSON.stringify(rs.state.myHand.map((c) => c.id)) ===
        JSON.stringify(st.state.myHand.map((c) => c.id));
      check(rs.state.code === code, '새로고침 후 같은 방');
      check(rs.state.mySeat === 0, '새로고침 후 같은 좌석');
      check(sameHand, '새로고침 후 같은 손패');
      check(rs.state.phase === 'play', '새로고침 후 대국 계속');
    }

    await step(code, clients);
  }
  check(phase === 'settle', `한 판 완주 → 정산 (${steps}수)`);
  st = await host.get(`/api/room/${code}/state`);
  const result = st.state.result;
  check(!!result && result.rows.length === 3, '정산 결과 3명');
  const total = st.state.players.reduce((s, p) => s + p.money, 0);
  check(total === 90000, '잔액 총합 보존 (90,000P)');

  console.log('\n[2] 새 판 — 한 명 연결 끊김');
  await host.post(`/api/room/${code}/action`, { type: 'start' });
  await pickSeon([host, p2, p3], code);
  st = await host.get(`/api/room/${code}/state`);
  check(st.state.phase === 'play', '새 판 시작');

  // 3번(좌석 2) 차례가 될 때까지 정상 진행
  let guard = 0;
  while (st.state.phase === 'play' && st.state.currentSeat !== 2 && guard < 200) {
    guard++;
    await step(code, clients);
    st = await host.get(`/api/room/${code}/state`);
  }
  check(st.state.currentSeat === 2, '3번 차례로 만듦 (이제 3번은 폴링 중단)');

  // 1·2번만 계속 접속 (실제로는 두 사람이 계속 게임)
  const t0 = Date.now();
  let sawDisconnect = false;
  let sawAuto = false;
  let autoFx = null;
  let lastTick = -10;
  while (Date.now() - t0 < 80000) {
    const sec = Math.round((Date.now() - t0) / 1000);
    const s1 = await host.get(`/api/room/${code}/state?since=0`);
    await p2.get(`/api/room/${code}/state?since=0`);
    const sp3 = s1.state.players.filter((p) => p.seat === 2)[0];
    if (sp3 && sp3.connected === false && !sawDisconnect) {
      sawDisconnect = true;
      console.log(`  · ${sec}초: 3번 연결 끊김 표시`);
    }
    const sNow = await host.get(`/api/room/${code}/state`);
    if (sec - lastTick >= 5) {
      lastTick = sec;
      console.log(
        `    ${sec}초 current=${sNow.state.currentSeat} phase=${sNow.state.phase} ` +
          `prompt=${sNow.state.prompt ? sNow.state.prompt.type : '-'} ` +
          `p3=${sp3 && sp3.connected ? '연결' : '끊김'} hand=${sp3 && sp3.handCount}`
      );
    }
    if (sNow.state.phase === 'settle') {
      sawAuto = true;
      console.log(`  · ${sec}초: 판이 정산으로 끝남`);
      break;
    }
    const fx = sNow.fx || [];
    const autoEvent = fx.filter((e) => e.kind === 'autoPlay').pop() || null;
    if (autoEvent) {
      sawAuto = true;
      autoFx = autoEvent;
      console.log(
        `  · ${sec}초: 자동 진행 발생 (current=${sNow.state.currentSeat}, 3번 손패=${(sNow.state.players.filter((p) => p.seat === 2)[0] || {}).handCount})`
      );
      break;
    }
    await sleep(1000);
  }
  check(sawDisconnect, '20초 뒤 연결 끊김 표시');
  check(sawAuto, '연결 끊긴 사람 차례가 자동으로 진행됨');
  check(!!autoFx, '자동 진행 이펙트 기록');

  console.log('\n전체 통과');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n' + e.message);
  process.exit(1);
});
