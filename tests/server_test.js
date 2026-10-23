'use strict';

// 서버 통합 테스트 — 실제 HTTP 로 3명이 접속해서 한 판을 끝까지 치는다.
// 실행: node tests/server_test.js
//
// 검증 항목
//   1) 방 만들기 → 6자리 코드 → 3명 입장
//   2) 손패 은닉 — 남의 패가 자기 화면에 보이지 않는다
//   3) 선 결정 → 딜 → 대국 → 고/스톱 → 정산까지 완주
//   4) 정산 — 승자 수령액 = 패자 지불액 합, 잔액 총합 보존
//   5) 재접속 — 같은 쿠키로 다시 조회하면 같은 방·같은 손패

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8791; // 테스트용 포트(실제 서버와 분리)
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');

let child = null;

/** 쿠키를 직접 관리하는 아주 단순한 HTTP 클라이언트. */
function makeClient() {
  let cookie = '';
  let setCookie = '';
  return {
    get cookie() {
      return cookie;
    },
    get setCookie() {
      return setCookie;
    },
    async req(method, url, body, extraHeaders) {
      const res = await fetch(BASE + url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(extraHeaders || {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      });
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of setCookies) {
        setCookie = c;
        const pair = c.split(';')[0];
        if (pair.startsWith('gs_id=') || pair.startsWith('gs_token=')) {
          cookie = cookie ? cookie + '; ' + pair : pair;
        }
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

test.before(async () => {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  // 서버가 뜰 때까지 대기
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/api/room/${'A'.repeat(6)}/state`);
      if (res.status === 404) break; // 서버는 뜬 상태
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

test.after(() => {
  if (child) child.kill();
});

test('3명이 접속해서 한 판을 끝까지 치고 정산까지 된다', async () => {
  // ── 1) 방 만들기 + 3명 입장 ──
  const host = makeClient();
  var _r=await host.post('/api/auth/register',{name:'엄마',password:'1234'}); if(!_r.ok) await host.post('/api/auth/login',{name:'엄마',password:'1234'});
  const created = await host.post('/api/room', { name: '엄마' });
  assert.ok(created.code, '방 코드가 있어야 한다');
  assert.strictEqual(created.code.length, 6, '방 코드는 6자리');
  assert.match(host.setCookie, /;\s*HttpOnly(?:;|$)/i, '세션 쿠키는 HttpOnly여야 한다');

  const p2 = makeClient();
  const p3 = makeClient();
  var _r=await p2.post('/api/auth/register',{name:'아빠',password:'1234'}); if(!_r.ok) await p2.post('/api/auth/login',{name:'아빠',password:'1234'});
  var _r=await p3.post('/api/auth/register',{name:'나',password:'1234'}); if(!_r.ok) await p3.post('/api/auth/login',{name:'나',password:'1234'});
  const j2 = await p2.post(`/api/room/${created.code}/join`, { name: '아빠' });
  const j3 = await p3.post(`/api/room/${created.code}/join`, { name: '나' });
  assert.strictEqual(j2.seat, 1);
  assert.strictEqual(j3.seat, 2);
  assert.notStrictEqual(host.cookie, p2.cookie, '플레이어마다 다른 쿠키');
  assert.match(p2.setCookie, /;\s*HttpOnly(?:;|$)/i, '참가 쿠키도 HttpOnly여야 한다');

  // ── 2) 대기실 상태 확인 ──
  let st = await host.get(`/api/room/${created.code}/state`);
  assert.strictEqual(st.state.phase, 'lobby');
  assert.strictEqual(st.state.players.length, 3);
  assert.strictEqual(st.state.isHost, true, '방장만 isHost');
  assert.ok(!('hostId' in st.state), '상태 응답에 방장 인증 토큰이 없어야 한다');
  assert.strictEqual((await p2.get(`/api/room/${created.code}/state`)).state.isHost, false);

  // ── 3) 선 결정 ──
  const started = await host.post(`/api/room/${created.code}/action`, { type: 'start' });
  assert.strictEqual(started.ok, true);

  st = await host.get(`/api/room/${created.code}/state`);
  assert.strictEqual(st.state.phase, 'seon', '선 결정 단계여야 한다');
  assert.strictEqual(st.state.seonCandidates[0].length, 3, '선 후보 카드가 3장');

  // 3명 모두 카드 선택 → 선 확정 → 딜
  // (선 결정이 동점이면 다시 뽑으므로, 'play' 가 될 때까지 반복)
  for (let round = 0; round < 10; round++) {
    for (const c of [host, p2, p3]) {
      const s = await c.get(`/api/room/${created.code}/state`);
      if (s.state.phase !== 'seon') break;
      if (s.state.seonPicked[s.state.mySeat] !== -1) continue;
      await c.post(`/api/room/${created.code}/action`, { type: 'seonPick', payload: { cardIndex: 0 } });
    }
    const check = await host.get(`/api/room/${created.code}/state`);
    if (check.state.phase === 'play') break;
  }

  st = await host.get(`/api/room/${created.code}/state`);
  assert.strictEqual(st.state.phase, 'play', '대국 단계여야 한다');
  assert.strictEqual(st.state.myHand.length, 7, '내 손패는 7장');
  assert.strictEqual(st.state.table.length, 6, '바닥은 6장');
  // 뒷패: 50장 − 딜 27장 = 23장.
  // 바닥에 보너스패가 있으면 선이 가져가고 뒷패에서 1장 보충하므로 21~23장이 된다.
  assert.ok(
    st.state.deckCount >= 21 && st.state.deckCount <= 23,
    `뒷패는 21~23장이어야 한다 (실제 ${st.state.deckCount})`
  );

  // ── 4) 손패 은닉 확인 ──
  const other = await p2.get(`/api/room/${created.code}/state`);
  assert.strictEqual(other.state.myHand.length, 7);
  const myIds = st.state.myHand.map((c) => c.id);
  const otherIds = other.state.myHand.map((c) => c.id);
  assert.notDeepStrictEqual(myIds, otherIds, '서로 다른 손패여야 한다');
  // 상대 손패는 개수만 보인다
  for (const p of other.state.players) {
    assert.strictEqual(typeof p.handCount, 'number');
    assert.ok(!('hand' in p), '상대 손패는 노출되지 않는다');
  }

  // ── 5) 자동 대국 — 끝까지 ──
  const clients = { 0: host, 1: p2, 2: p3 };
  let goCount = 0;
  let steps = 0;
  let phase = st.state.phase;

  while (phase !== 'settle' && steps < 400) {
    steps++;
    const s = await host.get(`/api/room/${created.code}/state`);
    phase = s.state.phase;
    if (phase === 'settle') break;

    const seat = s.state.currentSeat;
    const client = clients[seat];
    const p = s.state.prompt;

    if (p && p.seat === seat) {
      if (p.type === 'goStop') {
        // 2고까지 해보고 스톱한다
        await client.post(`/api/room/${created.code}/action`, {
          type: goCount < 2 ? 'go' : 'stop',
        });
        if (goCount < 2) goCount++;
        continue;
      }
      if (p.type === 'floorChoice') {
        await client.post(`/api/room/${created.code}/action`, { type: 'floorChoice', payload: { choice: 0 } });
        continue;
      }
      if (p.type === 'flipChoice') {
        await client.post(`/api/room/${created.code}/action`, { type: 'flipChoice', payload: { ordinal: 0 } });
        continue;
      }
      if (p.type === 'bonusDraw') {
        const opt = p.options[p.options.length - 1];
        await client.post(`/api/room/${created.code}/action`, {
          type: 'bonusDraw',
          payload: { stockIndex: opt.stockIndex },
        });
        continue;
      }
    }

    // 일반 수 — 손패 첫 장을 낸다
    const s2 = await client.get(`/api/room/${created.code}/state`);
    if (!s2.state.myHand.length) {
      await client.post(`/api/room/${created.code}/action`, { type: 'flipOnly' });
      continue;
    }
    const res = await client.post(`/api/room/${created.code}/action`, {
      type: 'playCard',
      payload: { handIndex: 0 },
    });
    assert.ok(res.ok, `수가 처리되어야 한다: ${res.error || ''}`);
  }

  assert.strictEqual(phase, 'settle', `판이 끝나야 한다 (현재 ${phase}, ${steps}단계)`);

  // ── 6) 정산 검증 ──
  st = await host.get(`/api/room/${created.code}/state`);
  const result = st.state.result;
  assert.ok(result, '결과가 있어야 한다');
  assert.ok(result.rows.length === 3);

  // 나가는 경우(나가리)는 전원 0 이고, 승자가 있으면 수령액 = 패자 지불액 합
  const winnerGain = result.nagari ? { amount: 0 } : result.rows.find((r) => r.seat === result.winnerSeat);
  const loserSum = result.nagari
    ? 0
    : result.rows.filter((r) => r.seat !== result.winnerSeat).reduce((sum, r) => sum + -r.amount, 0);
  assert.strictEqual(winnerGain.amount, loserSum, '승자 수령 = 패자 지불 합');

  // 잔액 총합 보존 (승자+패자 = 초기 3×30000)
  const totalMoney = st.state.players.reduce((sum, p) => sum + p.money, 0);
  assert.strictEqual(totalMoney, 90000, '가상 잔액 총합이 보존되어야 한다');

  // ── 7) 재접속 ──
  const again = await host.get(`/api/room/${created.code}/state`);
  assert.strictEqual(again.state.code, created.code, '같은 방으로 복귀');
  assert.strictEqual(again.state.mySeat, 0, '같은 좌석으로 복귀');
  assert.strictEqual(again.state.phase, 'settle');
});

test('없는 방에 접근하면 404 를 돌려준다', async () => {
  const c = makeClient();
  const res = await c.get('/api/room/ZZZZZZ/state');
  assert.strictEqual(res.ok, false);
  assert.ok(res.error, '오류 메시지가 있어야 한다');
});

test('방에 참가하지 않은 사람은 액션을 보낼 수 없다', async () => {
  const host = makeClient();
  var _r=await host.post('/api/auth/register',{name:'엄마',password:'1234'}); if(!_r.ok) await host.post('/api/auth/login',{name:'엄마',password:'1234'});
  const created = await host.post('/api/room', { name: '엄마' });
  const outsider = makeClient();
  const res = await outsider.post(`/api/room/${created.code}/action`, { type: 'ready' });
  assert.strictEqual(res.ok, false);
});

test('방 미참가자는 상세 상태를 읽을 수 없다', async () => {
  const host = makeClient();
  var _r=await host.post('/api/auth/register',{name:'엄마',password:'1234'}); if(!_r.ok) await host.post('/api/auth/login',{name:'엄마',password:'1234'});
  const created = await host.post('/api/room', { name: '엄마' });
  const outsider = makeClient();
  var _r=await outsider.post('/api/auth/register',{name:'다른 방 참가자',password:'1234'}); if(!_r.ok) await outsider.post('/api/auth/login',{name:'다른 방 참가자',password:'1234'});
  await outsider.post('/api/room', { name: '다른 방 참가자' });

  const res = await outsider.get(`/api/room/${created.code}/state`);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, '이 방의 참가자가 아닙니다.');
});

test('잘못된 플레이어 이름은 방 생성·입장을 거부한다', async () => {
  const host = makeClient();
  var _r=await host.post('/api/auth/register',{name:'엄마',password:'1234'}); if(!_r.ok) await host.post('/api/auth/login',{name:'엄마',password:'1234'});
  const badCreate = await host.post('/api/room', { name: { value: '이름' } });
  assert.strictEqual(badCreate.ok, false);
  assert.strictEqual(badCreate.error, '이름은 문자열이어야 합니다.');

  var _r=await host.post('/api/auth/register',{name:'엄마',password:'1234'}); if(!_r.ok) await host.post('/api/auth/login',{name:'엄마',password:'1234'});
  const created = await host.post('/api/room', { name: '엄마' });
  const guest = makeClient();
  var _r=await guest.post('/api/auth/register', { name: '게스트', password: '1234' }); if(!_r.ok) await guest.post('/api/auth/login', { name: '게스트', password: '1234' });
  const badJoin = await guest.post(`/api/room/${created.code}/join`, { name: '가'.repeat(13) });
  assert.strictEqual(badJoin.ok, false);
  assert.strictEqual(badJoin.error, '이름은 12자 이내로 입력해 주세요.');

  const controlName = await guest.post(`/api/room/${created.code}/join`, { name: '이름\n공격' });
  assert.strictEqual(controlName.ok, false);
  assert.strictEqual(controlName.error, '이름에 제어 문자를 사용할 수 없습니다.');
});

test('HTTPS 프록시를 통한 방 생성은 Secure 쿠키를 설정한다', async () => {
  const client = makeClient();
  var _r=await client.post('/api/auth/register',{name:'안전한 방장',password:'1234'}); if(!_r.ok) await client.post('/api/auth/login',{name:'안전한 방장',password:'1234'});
  await client.req('POST', '/api/room', { name: '안전한 방장' }, { 'X-Forwarded-Proto': 'https' });
  assert.match(client.setCookie, /;\s*Secure(?:;|$)/i);
});

test('중복 액션 요청은 최초 성공 응답을 재사용하고 액션을 반복하지 않는다', async () => {
  const host = makeClient();
  var _r=await host.post('/api/auth/register',{name:'엄마',password:'1234'}); if(!_r.ok) await host.post('/api/auth/login',{name:'엄마',password:'1234'});
  const created = await host.post('/api/room', { name: '엄마' });
  const actionUrl = `/api/room/${created.code}/action`;
  const request = { type: 'ready', requestId: 'retry-ready-1' };

  const first = await host.post(actionUrl, request);
  const duplicate = await host.post(actionUrl, request);

  assert.deepStrictEqual(duplicate, first);
  assert.strictEqual(first.ready, true);
  const state = await host.get(`/api/room/${created.code}/state`);
  assert.strictEqual(state.state.players[0].ready, true, '같은 액션이 두 번 실행되면 안 된다');
});

test('중복 액션 요청은 최초 실패 응답을 성공으로 바꾸지 않는다', async () => {
  const host = makeClient();
  var _r=await host.post('/api/auth/register',{name:'엄마',password:'1234'}); if(!_r.ok) await host.post('/api/auth/login',{name:'엄마',password:'1234'});
  const created = await host.post('/api/room', { name: '엄마' });
  const actionUrl = `/api/room/${created.code}/action`;
  const request = { type: 'playCard', requestId: 'retry-invalid-action-1' };

  const first = await host.post(actionUrl, request);
  const duplicate = await host.post(actionUrl, request);

  assert.deepStrictEqual(duplicate, first);
  assert.deepStrictEqual(duplicate, { ok: false, error: '지금은 대국할 수 없습니다.' });
});

test('요청 ID는 문자열이며 최대 128자여야 한다', async () => {
  const host = makeClient();
  var _r=await host.post('/api/auth/register',{name:'엄마',password:'1234'}); if(!_r.ok) await host.post('/api/auth/login',{name:'엄마',password:'1234'});
  const created = await host.post('/api/room', { name: '엄마' });
  const actionUrl = `/api/room/${created.code}/action`;

  const nonString = await host.post(actionUrl, { type: 'ready', requestId: { id: 1 } });
  const tooLong = await host.post(actionUrl, { type: 'ready', requestId: 'x'.repeat(129) });

  assert.strictEqual(nonString.ok, false);
  assert.strictEqual(tooLong.ok, false);
  const state = await host.get(`/api/room/${created.code}/state`);
  assert.strictEqual(state.state.players[0].ready, false);
});

test('방 목록 API — 참가 가능 여부와 내가 있던 방을 알려준다', async () => {
  const host = makeClient();
  var _r=await host.post('/api/auth/register',{name:'엄마',password:'1234'}); if(!_r.ok) await host.post('/api/auth/login',{name:'엄마',password:'1234'});
  const multi = await host.post('/api/room', { name: '엄마', mode: 'multi', playerCount: 3 });
  assert.ok(multi.code);

  const fullHost = makeClient();
  var _r=await fullHost.post('/api/auth/register',{name:'아빠',password:'1234'}); if(!_r.ok) await fullHost.post('/api/auth/login',{name:'아빠',password:'1234'});
  const full = await fullHost.post('/api/room', { name: '아빠', mode: 'multi', playerCount: 2 });
  const guest = makeClient();
  var _r=await guest.post('/api/auth/register', { name: '나', password: '1234' }); if(!_r.ok) await guest.post('/api/auth/login', { name: '나', password: '1234' });
  const joined = await guest.post(`/api/room/${full.code}/join`, { name: '나' });
  assert.strictEqual(joined.ok, true);

  const soloHost = makeClient();
  var _r=await soloHost.post('/api/auth/register',{name:'할머니',password:'1234'}); if(!_r.ok) await soloHost.post('/api/auth/login',{name:'할머니',password:'1234'});
  const solo = await soloHost.post('/api/room', { name: '할머니', mode: 'solo', playerCount: 3 });

  const viewer = makeClient();
  const list = await viewer.get('/api/rooms');
  assert.strictEqual(list.ok, true);
  assert.ok(Array.isArray(list.rooms));
  assert.strictEqual(list.rooms[0].canJoin, true, '참가 가능한 방이 먼저 온다');

  const byCode = {};
  for (const r of list.rooms) byCode[r.code] = r;

  const m = byCode[multi.code];
  assert.ok(m, '새로 만든 방이 목록에 있어야 한다');
  assert.strictEqual(m.hostName, '엄마');
  assert.strictEqual(m.mode, 'multi');
  assert.strictEqual(m.playerCount, 3);
  assert.strictEqual(m.humanCount, 1);
  assert.strictEqual(m.openSeats, 2);
  assert.strictEqual(m.phase, 'lobby');
  assert.strictEqual(m.canJoin, true);
  assert.strictEqual(m.isMember, false);
  assert.strictEqual(typeof m.createdAt, 'number');

  const f = byCode[full.code];
  assert.ok(f);
  assert.strictEqual(f.humanCount, 2);
  assert.strictEqual(f.openSeats, 0);
  assert.strictEqual(f.canJoin, false, '가득 찬 방은 참가할 수 없다');

  const s = byCode[solo.code];
  assert.ok(s);
  assert.strictEqual(s.mode, 'solo');
  assert.strictEqual(s.openSeats, 0);
  assert.strictEqual(s.canJoin, false, 'AI 혼자 치는 방은 참가할 수 없다');

  const own = await host.get('/api/rooms');
  const mine = own.rooms.filter((r) => r.code === multi.code)[0];
  assert.ok(mine);
  assert.strictEqual(mine.isMember, true, '내가 만든 방은 다시 참가할 수 있다');
  assert.strictEqual(mine.canJoin, true);
});

test('방장이 방을 나가면 방이 바로 사라진다', async () => {
  const host = makeClient();
  var _r=await host.post('/api/auth/register',{name:'엄마',password:'1234'}); if(!_r.ok) await host.post('/api/auth/login',{name:'엄마',password:'1234'});
  const created = await host.post('/api/room', { name: '엄마' });
  const guest = makeClient();
  await guest.post(`/api/room/${created.code}/join`, { name: '아빠' });

  let list = await host.get('/api/rooms');
  assert.ok(
    list.rooms.some((r) => r.code === created.code),
    '나가기 전에는 목록에 있어야 한다'
  );

  const res = await host.post(`/api/room/${created.code}/action`, { type: 'leave' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.roomClosed, true, '방장이 나가면 방이 닫혔다고 알려준다');

  list = await host.get('/api/rooms');
  assert.ok(
    !list.rooms.some((r) => r.code === created.code),
    '방장이 나간 방은 목록에서 바로 사라진다'
  );

  // 남아 있던 사람은 방이 없어졌다는 404 를 받는다
  const state = await guest.get(`/api/room/${created.code}/state`);
  assert.strictEqual(state.ok, false, '남은 사람에게는 방이 없다는 응답이 온다');
});

test('방장이 아닌 사람이 나가면 방은 그대로 남는다', async () => {
  const host = makeClient();
  var _r=await host.post('/api/auth/register',{name:'엄마',password:'1234'}); if(!_r.ok) await host.post('/api/auth/login',{name:'엄마',password:'1234'});
  const created = await host.post('/api/room', { name: '엄마' });
  const guest = makeClient();
  var _r=await guest.post('/api/auth/register', { name: '아빠', password: '1234' }); if(!_r.ok) await guest.post('/api/auth/login', { name: '아빠', password: '1234' });
  await guest.post(`/api/room/${created.code}/join`, { name: '아빠' });

  const res = await guest.post(`/api/room/${created.code}/action`, { type: 'leave' });
  assert.strictEqual(res.ok, true);
  assert.notStrictEqual(res.roomClosed, true, '방장이 아니면 방을 닫지 않는다');

  const list = await host.get('/api/rooms');
  assert.ok(
    list.rooms.some((r) => r.code === created.code),
    '방장이 남아 있으면 방도 남는다'
  );
});
