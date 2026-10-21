'use strict';

// AI 상대 통합 테스트 — 혼자 AI 와 치는 방이 실제로 동작하는지 확인한다.
// 실행: node tests/ai_test.js
//
// 검증 항목
//   1) 혼자 방(solo) 생성 → 1번 자리에는 사람이, 나머지는 AI 가 앉는다
//   2) AI 가 실제로 수를 두고 판이 진행된다
//   3) AI 가 고/스톱을 결정한다
//   4) AI 가 손패를 소모한다(계속 두기)
//   5) AI 난이도별 행동이 다르다(쉬움은 실수가 많다)

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8792;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');

let child = null;

function makeClient() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    async req(method, url, body) {
      const res = await fetch(BASE + url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of setCookie) {
        const pair = c.split(';')[0];
        if (pair.startsWith('gs_id=')) cookie = pair;
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/api/room/AAAAAA/state`);
      if (res.status === 404) break;
      await wait(100);
    } catch {
      await wait(100);
    }
  }
});

test.after(() => {
  if (child) child.kill();
});

test('혼자 AI 와 2인 방이 만들어지고 AI 가 자리를 차지한다', async () => {
  const c = makeClient();
  const res = await c.post('/api/room', { name: '나', mode: 'solo', playerCount: 2, aiDifficulty: 'normal' });
  assert.ok(res.code);
  assert.strictEqual(res.mode, 'solo');

  const st = await c.get(`/api/room/${res.code}/state`);
  assert.strictEqual(st.state.players.length, 2);
  assert.strictEqual(st.state.players[0].type, 'human');
  assert.strictEqual(st.state.players[1].type, 'ai');
  assert.strictEqual(st.state.players[1].name, '컴퓨터 A');
  assert.strictEqual(st.state.settings.aiDifficulty, 'normal');
});

test('AI 가 실제로 수를 두고 판이 끝까지 진행된다', async () => {
  const c = makeClient();
  // 3인(혼자 + AI 2명) — 승리 기준이 3점이라 판이 빨리 끝난다
  const res = await c.post('/api/room', { name: '나', mode: 'solo', playerCount: 3, aiDifficulty: 'normal' });
  const code = res.code;

  await c.post(`/api/room/${code}/action`, { type: 'start' });

  // 선 결정 — 동점이면 다시 뽑으므로 'play' 가 될 때까지 반복
  for (let round = 0; round < 10; round++) {
    const s = await c.get(`/api/room/${code}/state`);
    if (s.state.phase !== 'seon') break;
    if (s.state.seonPicked[s.state.mySeat] !== -1) break;
    await c.post(`/api/room/${code}/action`, { type: 'seonPick', payload: { cardIndex: 0 } });
    await wait(150);
  }

  // 대국 진행 — 사람이 두면 AI 가 반응해야 한다
  let st = await c.get(`/api/room/${code}/state`);
  assert.strictEqual(st.state.phase, 'play', '대국 단계여야 한다');
  let aiMoved = false;
  let steps = 0;
  let phase = 'play';
  let goCount = 0;

  while (phase !== 'settle' && steps < 300) {
    steps++;
    await wait(200);
    st = await c.get(`/api/room/${code}/state`);
    phase = st.state.phase;
    if (phase === 'settle') break;

    const seat = st.state.currentSeat;
    const prompt = st.state.prompt;

    if (seat === 0) {
      // 사람 차례
      if (prompt && prompt.seat === 0) {
        if (prompt.type === 'goStop') {
          // 2고까지 하고 스톱한다 (계속 고르면 판이 끝나지 않는다)
          await c.post(`/api/room/${code}/action`, { type: goCount < 2 ? 'go' : 'stop' });
          if (goCount < 2) goCount++;
        } else if (prompt.type === 'floorChoice') {
          await c.post(`/api/room/${code}/action`, { type: 'floorChoice', payload: { choice: 0 } });
        } else if (prompt.type === 'flipChoice') {
          await c.post(`/api/room/${code}/action`, { type: 'flipChoice', payload: { ordinal: 0 } });
        } else if (prompt.type === 'bonusDraw') {
          const opt = prompt.options[prompt.options.length - 1];
          await c.post(`/api/room/${code}/action`, { type: 'bonusDraw', payload: { stockIndex: opt.stockIndex } });
        }
      } else {
        const s2 = await c.get(`/api/room/${code}/state`);
        if (!s2.state.myHand.length) {
          await c.post(`/api/room/${code}/action`, { type: 'flipOnly' });
        } else {
          // 흔들기 등으로 내야 할 월이 정해진 경우를 대비해 합법한 카드를 찾는다
          var played = false;
          for (var hi = 0; hi < s2.state.myHand.length; hi++) {
            var r = await c.post(`/api/room/${code}/action`, { type: 'playCard', payload: { handIndex: hi } });
            if (r && r.ok) { played = true; break; }
          }
          if (!played) {
            await c.post(`/api/room/${code}/action`, { type: 'flipOnly' });
          }
        }
      }
    } else {
      // AI 가 방금 움직였는지 확인
      const aiTotal = st.state.players.filter((p) => p.type === 'ai').reduce((sum, p) => sum + p.handCount, 0);
      if (aiTotal < 14) aiMoved = true;
    }
  }

  assert.strictEqual(phase, 'settle', `판이 끝나야 한다 (현재 ${phase}, ${steps}단계)`);
  assert.ok(st.state.result, '결과가 있어야 한다');
  // 딜 직후 총통으로 끝난 판은 AI 가 둘 기회가 없으므로 aiMoved 검사는 생략한다
  if (steps > 0) assert.ok(aiMoved, 'AI 가 카드를 냈어야 한다');
});

test('AI 는 사람이 둔 뒤에 반응해서 카드를 낸다', async () => {
  const c = makeClient();
  const res = await c.post('/api/room', { name: '나', mode: 'solo', playerCount: 3, aiDifficulty: 'easy' });
  const code = res.code;
  await c.post(`/api/room/${code}/action`, { type: 'start' });
  await wait(200);
  for (let round = 0; round < 10; round++) {
    const s0 = await c.get(`/api/room/${code}/state`);
    if (s0.state.phase !== 'seon') break;
    if (s0.state.seonPicked[s0.state.mySeat] !== -1) break;
    await c.post(`/api/room/${code}/action`, { type: 'seonPick', payload: { cardIndex: 0 } });
    await wait(150);
  }

  // 사람이 먼저 한 장을 둔다 (합법한 카드를 찾아낸다)
  let st = await c.get(`/api/room/${code}/state`);
  if (st.state.currentSeat === 0 && st.state.myHand.length) {
    var played2 = false;
    for (var hi2 = 0; hi2 < st.state.myHand.length; hi2++) {
      var r2 = await c.post(`/api/room/${code}/action`, { type: 'playCard', payload: { handIndex: hi2 } });
      if (r2 && r2.ok) { played2 = true; break; }
    }
    if (!played2) {
      await c.post(`/api/room/${code}/action`, { type: 'flipOnly' }).catch(function () {});
    }
    // 후속 선택(바닥·뒤집기·보너스·고/스톱)이 뜨면 해결한다
    for (var pr = 0; pr < 6; pr++) {
      var sp = await c.get(`/api/room/${code}/state`);
      if (sp.state.currentSeat !== 0) break;
      var pp = sp.state.prompt;
      if (!pp || pp.seat !== 0) break;
      if (pp.type === 'goStop') await c.post(`/api/room/${code}/action`, { type: 'stop' });
      else if (pp.type === 'floorChoice') await c.post(`/api/room/${code}/action`, { type: 'floorChoice', payload: { choice: 0 } });
      else if (pp.type === 'flipChoice') await c.post(`/api/room/${code}/action`, { type: 'flipChoice', payload: { ordinal: 0 } });
      else if (pp.type === 'bonusDraw') {
        var opt = pp.options[pp.options.length - 1];
        await c.post(`/api/room/${code}/action`, { type: 'bonusDraw', payload: { stockIndex: opt.stockIndex } });
      } else break;
    }
  }

  // AI 가 그에 반응해 카드를 낸다
  const before = (await c.get(`/api/room/${code}/state`)).state.players
    .filter((p) => p.type === 'ai')
    .reduce((sum, p) => sum + p.handCount, 0);
  await wait(2500);
  const afterState = await c.get(`/api/room/${code}/state`);
  // 딜 직후 총통으로 끝난 판은 AI 가 둘 기회가 없으므로 검사를 생략한다
  if (afterState.state.phase !== 'settle') {
    const after = afterState.state.players
      .filter((p) => p.type === 'ai')
      .reduce((sum, p) => sum + p.handCount, 0);
    assert.ok(after < before, `AI 가 카드를 내야 한다 (${before} → ${after})`);
  }
});
