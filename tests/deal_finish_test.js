'use strict';
// 딜 직후 판이 끝나는 경우(총통) 회귀 테스트
// 실행: node tests/deal_finish_test.js
//
// 바닥에 같은 월 4장(또는 손패 4장)이 나오면 선이 즉시 이긴다.
// 이때 방이 'play' 에 머물면 아무도 둘 수 없어 차례에서 영원히 멈춘다.
// (AI 가 선이면 "컴퓨터 A 차례" 에서 멈춘 것처럼 보인다)

const test = require('node:test');
const assert = require('node:assert');

const { Room } = require('../server/rooms');
const { shuffledDeck } = require('../engine/deck');

/** 바닥 첫 묶음(4장)이 모두 같은 월이 되도록 덱을 만든다. */
function chongtongDeck(month) {
  const deck = shuffledDeck();
  const same = deck.filter((c) => c.month === month);
  const rest = deck.filter((c) => c.month !== month);
  assert.strictEqual(same.length, 4, `${month}월 카드는 4장`);
  // deal() 은 덱의 마지막 장부터 꺼낸다 → 마지막 4장이 첫 바닥 묶음
  return rest.concat(same);
}

function startWithDeck(deck) {
  const room = new Room('TEST01', { mode: 'solo', playerCount: 2, aiDifficulty: 'expert' });
  room.addPlayer('p0', '나');
  room.startRound();
  // 후보 카드를 뽑은 뒤 덱을 바꿔 끼운다 (실제 딜에 쓰이는 덱)
  room.deck = deck;
  // 사람이 고르면 선이 확정되고 딜이 시작된다 (같은 월이면 다시 뽑는다)
  for (let i = 0; i < 12 && room.phase === 'seon'; i++) {
    if (room.seonPicked[0] === -1) room.pickSeonCard(0, 0);
  }
  return room;
}

test('딜 직후 바닥 총통이면 곧바로 정산으로 넘어간다', () => {
  const room = startWithDeck(chongtongDeck(5));

  assert.strictEqual(room.engine.state.phase, 'finished', '엔진은 끝난 상태');
  assert.strictEqual(room.phase, 'settle', '방은 정산 단계여야 한다 (play 에 멈추면 안 됨)');
  assert.ok(room.result, '정산 결과가 있어야 한다');
  assert.ok(room.settle, '정산 내역이 있어야 한다');
  assert.strictEqual(room.aiTimer, null, '끝난 판에 AI 차례를 예약하면 안 된다');
  assert.ok(
    room.fx.some((e) => e.kind === 'chongtong'),
    '총통 이펙트가 기록되어야 한다'
  );
});

test('총통으로 끝난 판은 스냅샷에서도 settle 로 보인다', () => {
  const room = startWithDeck(chongtongDeck(8));
  const snap = room.snapshot(0);

  assert.strictEqual(snap.phase, 'settle');
  assert.ok(snap.result, '화면이 정산 창을 띄울 수 있어야 한다');
  assert.ok(snap.result.winnerSeat >= 0, '승자가 정해져야 한다');
  assert.ok(snap.result.rows.length >= 2, '참가자별 정산 줄이 있어야 한다');
});
