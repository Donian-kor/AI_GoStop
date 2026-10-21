'use strict';
// 연결 끊김(배터리 방전 등) 처리 검증
// 실행: node tests/disconnect_test.js
//
// 시나리오
//   1) 3인 방에서 대국 중 한 명이 연결이 끊김
//   2) 서버가 20초 이상 폴링이 없으면 '연결 끊김' 으로 표시
//   3) 그 사람 차례가 오면 30초 뒤 자동으로 진행 → 나머지 2명이 계속 칠 수 있다

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { Room } = require('../server/rooms');

function makeRoom() {
  const room = new Room('TEST01', { mode: 'multi', playerCount: 3 });
  room.addPlayer('p0', '엄마');
  room.addPlayer('p1', '아빠');
  room.addPlayer('p2', '나');
  return room;
}

/**
 * 선 결정을 끝내고 대국을 시작한다.
 * - 최고월이 겹치면 서버가 같은 후보로 다시 뽑게 하므로 확정될 때까지 반복한다.
 * - 딜 직후 총통(바닥·손패 4장)으로 판이 끝나면 새 판으로 다시 시작한다.
 */
function makePlayRoom() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const room = makeRoom();
    room.startRound();
    for (let round = 0; round < 12 && room.phase === 'seon'; round++) {
      for (let s = 0; s < 3 && room.phase === 'seon'; s++) {
        if (room.seonPicked[s] === -1) room.pickSeonCard(s, 0);
      }
    }
    if (room.phase === 'play') return room;
  }
  throw new Error('대국 시작 실패');
}

/** 현재 차례 사람의 손패 중 바닥 2장 선택이 필요한 카드를 찾는다. */
function findFloorChoice(room) {
  const s = room.engine.state;
  if (s.phase !== 'playing') return null;
  const seat = room.physicalSeatOf(s.current);
  const player = s.players[s.current];
  for (let i = 0; i < player.hand.length; i++) {
    const card = player.hand[i];
    if (player.pendingShakeMonth && card.month !== player.pendingShakeMonth) continue;
    if (room.engine.needsFloorChoice(room.engine.matchIndices(card.month))) {
      return { seat, handIndex: i };
    }
  }
  return null;
}

/** 프롬프트를 처리하거나 한 수 진행한다 (탐색용). */
function advance(room) {
  const s = room.engine.state;
  if (s.phase === 'finished') return false;
  const seat = room.physicalSeatOf(s.current);
  const p = room.seats[seat];
  const prompt = room.prompt;
  if (prompt && prompt.seat === seat) {
    if (prompt.type === 'goStop') room.act(p, 'stop');
    else if (prompt.type === 'floorChoice') room.act(p, 'floorChoice', { choice: 0 });
    else if (prompt.type === 'flipChoice') room.act(p, 'flipChoice', { ordinal: 0 });
    else if (prompt.type === 'bonusDraw') {
      const opt = prompt.options[prompt.options.length - 1];
      room.act(p, 'bonusDraw', { stockIndex: opt.stockIndex });
    }
    return true;
  }
  if (s.phase !== 'playing') return false;
  const player = s.players[s.current];
  let idx = -1;
  for (let i = 0; i < player.hand.length; i++) {
    const c = player.hand[i];
    if (c.kind === 'bonus') continue;
    if (player.pendingShakeMonth && c.month !== player.pendingShakeMonth) continue;
    idx = i;
    break;
  }
  if (idx < 0) idx = 0;
  room.act(p, player.hand.length ? 'playCard' : 'flipOnly', player.hand.length ? { handIndex: idx } : undefined);
  return true;
}

test('연결이 끊기면 ' + "'연결 끊김'" + ' 으로 표시된다', () => {
  const room = makePlayRoom();

  // 2번 플레이어가 30초째 폴링이 없다고 가정
  const p2 = room.seats[2];
  p2.lastSeen = Date.now() - 30000;

  room.checkDisconnected();
  assert.strictEqual(p2.connected, false, '연결 끊김으로 표시되어야 한다');
  assert.ok(room.log.some((l) => l.text.indexOf('연결이 끊겼습니다') >= 0), '로그에 남아야 한다');
});

test('연결이 끊긴 사람의 차례는 자동으로 진행된다', () => {
  const room = makePlayRoom();

  // 현재 차례인 사람이 한 수를 둔다 (보너스패는 같은 차례로 돌아오므로 일반패를 고른다)
  const before = room.engine.state.playCount;
  const curSeat = room.engine.state.current;
  const curPhysical = room.physicalSeatOf(curSeat);
  const handCards = room.engine.currentPlayer.hand;
  let playIdx = handCards.findIndex((c) => c.kind !== 'bonus');
  if (playIdx < 0) playIdx = 0;
  room.act(room.seats[curPhysical], 'playCard', { handIndex: playIdx });
  assert.ok(room.engine.state.playCount > before, '한 수가 진행되어야 한다');

  // 다음 사람이 1번(아빠)이 되도록, 현재 차례를 1번으로 맞춘다
  const p1 = room.seats[1];
  p1.lastSeen = Date.now() - 30000;
  room.engine.state.current = room.engineSeatOf(1);

  room.checkDisconnected();
  assert.strictEqual(p1.connected, false);

  // 자동 진행 예약이 이미 지난 상태로 만들어 바로 진행시킨다
  room.autoPlayAt = Date.now() - 31000;
  room.checkDisconnected();

  assert.ok(room.engine.state.playCount > before, '연결이 끊긴 사람의 차례도 자동으로 진행되어야 한다');
  assert.ok(
    room.log.some((l) => l.text.indexOf('자동으로 진행') >= 0),
    '자동 진행 로그가 남아야 한다'
  );
});

test('연결이 끊긴 사람에게 바닥 선택이 떠도 자동으로 진행된다', () => {
  // 바닥에 같은 월 2장(종류가 다름)이 있고, 그 월 카드를 손에 들고 있는 상황을 찾는다
  let found = null;
  for (let t = 0; t < 150 && !found; t++) {
    const room = makePlayRoom();
    for (let step = 0; step < 25 && room.engine.state.phase !== 'finished'; step++) {
      const hit = findFloorChoice(room);
      if (hit) {
        found = { room, seat: hit.seat, handIndex: hit.handIndex };
        break;
      }
      if (!advance(room)) break;
    }
  }
  assert.ok(found, '바닥 선택이 필요한 상황을 찾아야 한다');

  const { room, seat, handIndex } = found;
  const p = room.seats[seat];
  room.act(p, 'playCard', { handIndex });
  assert.strictEqual(room.engine.state.phase, 'awaitingFloorChoice', '바닥 선택 대기 상태여야 한다');

  p.lastSeen = Date.now() - 21000;
  room.checkDisconnected();
  assert.strictEqual(p.connected, false);

  room.autoPlayAt = Date.now() - 31000;
  room.checkDisconnected();

  assert.notStrictEqual(
    room.engine.state.phase,
    'awaitingFloorChoice',
    '자동 진행이 바닥 선택을 처리해야 한다'
  );
  assert.ok(
    room.log.some((l) => l.text.indexOf('자동으로 진행') >= 0),
    '자동 진행 로그가 남아야 한다'
  );
});

test('연결이 끊긴 사람이 방을 나가지 않아도 방이 사라지지 않는다', () => {
  const room = makeRoom();
  room.startRound();
  const p2 = room.seats[2];
  p2.lastSeen = Date.now() - 60000;
  room.checkDisconnected();
  // AI 자리는 상주, 사람은 끊겼어도 자리는 남아 있다
  assert.strictEqual(room.seats.length, 3);
  assert.ok(room.seats[2], '자리는 유지된다');
});
