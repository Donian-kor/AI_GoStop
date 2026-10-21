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
 * 최고월이 겹치면 서버가 같은 후보로 다시 뽑게 하므로, 확정될 때까지 반복한다.
 */
function startPlay(room) {
  room.startRound();
  for (let round = 0; round < 12 && room.phase === 'seon'; round++) {
    for (let s = 0; s < 3 && room.phase === 'seon'; s++) {
      if (room.seonPicked[s] === -1) room.pickSeonCard(s, 0);
    }
  }
  assert.strictEqual(room.phase, 'play', '선 결정이 끝나야 한다');
  return room;
}

test('연결이 끊기면 ' + "'연결 끊김'" + ' 으로 표시된다', () => {
  const room = startPlay(makeRoom());

  // 2번 플레이어가 30초째 폴링이 없다고 가정
  const p2 = room.seats[2];
  p2.lastSeen = Date.now() - 30000;

  room.checkDisconnected();
  assert.strictEqual(p2.connected, false, '연결 끊김으로 표시되어야 한다');
  assert.ok(room.log.some((l) => l.text.indexOf('연결이 끊겼습니다') >= 0), '로그에 남아야 한다');
});

test('연결이 끊긴 사람의 차례는 자동으로 진행된다', () => {
  const room = startPlay(makeRoom());

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
