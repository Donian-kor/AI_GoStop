'use strict';
// 족보 패널 데이터 검증
// 실행: node tests/jokbo_test.js
//
// 화면은 족보를 '카드 그림' 으로 보여준다. 그러려면 서버가
//   - 이 세트에 어떤 카드가 필요한지
//   - 그중 내가 먹은 것은 무엇인지
// 를 정확히 내려줘야 한다.

const test = require('node:test');
const assert = require('node:assert');

const { Room } = require('../server/rooms');
const { byAssetId } = require('../engine/cards');

function makeRoom() {
  const room = new Room('TEST01', { mode: 'multi', playerCount: 3 });
  room.addPlayer('p0', '엄마');
  room.addPlayer('p1', '아빠');
  room.addPlayer('p2', '나');
  room.startRound();
  // 선 결정 — 최고월이 겹치면 다시 뽑으므로 확정될 때까지 반복한다
  for (let round = 0; round < 12 && room.phase === 'seon'; round++) {
    for (let s = 0; s < 3 && room.phase === 'seon'; s++) {
      if (room.seonPicked[s] === -1) room.pickSeonCard(s, 0);
    }
  }
  assert.strictEqual(room.phase, 'play', '선 결정이 끝나야 한다');
  return room;
}

function tile(snap, code) {
  const found = (snap.myJokbo || []).find((s) => s.code === code);
  assert.ok(found, `${code} 족보 항목이 있어야 한다`);
  return found;
}

test('족보 타일은 필요한 카드를 그림으로 보여준다', () => {
  const snap = makeRoom().snapshot(0);

  // 광은 5장 전부, 고도리·단은 3장씩
  assert.strictEqual(tile(snap, 'guang').cards.length, 5, '광은 5장 전부를 보여준다');
  assert.strictEqual(tile(snap, 'godori').cards.length, 3, '고도리는 3장');
  assert.strictEqual(tile(snap, 'hongdan').cards.length, 3, '홍단은 3장');
  assert.strictEqual(tile(snap, 'cheongdan').cards.length, 3, '청단은 3장');
  assert.strictEqual(tile(snap, 'chodan').cards.length, 3, '초단은 3장');

  const ids = tile(snap, 'godori').cards.map((c) => c.id).sort();
  assert.deepStrictEqual(ids, ['april_tane', 'august_tane', 'february_tane']);

  // 개수 세트는 카드 목록 없이 달성 수치만
  assert.strictEqual(tile(snap, 'junk').cards, undefined);
  assert.strictEqual(tile(snap, 'junk').need, 10);
});

test('내가 먹은 카드만 owned 로 표시된다', () => {
  const room = makeRoom();
  const captured = room.engine.state.players[0].captured;

  // 2월 매조(고도리) 한 장만 먹은 상태
  captured.push(byAssetId('february_tane'));

  const godori = tile(room.snapshot(0), 'godori');
  const owned = godori.cards.filter((c) => c.owned).map((c) => c.id);
  assert.deepStrictEqual(owned, ['february_tane'], '먹은 카드만 밝게 표시된다');
  assert.strictEqual(godori.have, 1);
  assert.strictEqual(godori.done, false);
  assert.strictEqual(godori.points, 0);
});

test('세트를 완성하면 완성 표시와 점수가 붙는다', () => {
  const room = makeRoom();
  const captured = room.engine.state.players[0].captured;

  // 홍단 3장(1·2·3월) 완성
  captured.push(byAssetId('january_tanzaku'));
  captured.push(byAssetId('february_tanzaku'));
  captured.push(byAssetId('march_tanzaku'));

  const snap = room.snapshot(0);
  const hong = tile(snap, 'hongdan');
  assert.strictEqual(hong.have, 3);
  assert.strictEqual(hong.done, true, '완성으로 표시되어야 한다');
  assert.strictEqual(hong.points, 3, '홍단은 3점');
  assert.ok(hong.cards.every((c) => c.owned), '3장 모두 내 카드');
  assert.strictEqual(tile(snap, 'chodan').done, false, '다른 세트는 그대로');
});

test('개수 세트는 점수 계산과 같은 수치를 쓴다 (쌍피 포함)', () => {
  const room = makeRoom();
  const captured = room.engine.state.players[0].captured;

  // 쌍피 5장 = 피 10장 → 피 족보 완성
  const doubleJunk = ['november_kasu_2', 'december_kasu', 'bonus_ssangpi_1', 'bonus_ssangpi_2', 'bonus_joker'];
  for (const id of doubleJunk) captured.push(byAssetId(id));

  const junk = tile(room.snapshot(0), 'junk');
  assert.strictEqual(junk.have, 10, '쌍피는 2장으로 세야 한다');
  assert.strictEqual(junk.done, true);
  assert.strictEqual(junk.points, 1, '피 10장 = 1점');
});
