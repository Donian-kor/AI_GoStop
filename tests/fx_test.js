'use strict';

// 카드 연출(FLIP 이동 · 섞기 연출 · 상대 패 날아가는 연출) 연결 확인
// 실행: node tests/fx_test.js
//
// 브라우저 화면이라 DOM 이 필요해 실제 동작 단위 테스트는 어렵다.
// 그래서 "연결이 되어 있는가" 를 정적으로 확인하고,
// 서버가 "무슨 카드를 냈는지" 를 이벤트에 담아 주는지는 엔진으로 직접 확인한다.
//
//   1) fx.js 가 FLIP/섞기/카드 이동 함수를 공개하는가
//   2) style.css 에 카드 등장 키프레임과 섞기 스타일이 있는가
//   3) app.js 가 실제로 그 함수를 호출하는가
//   4) PLACE/CAPTURE 이벤트가 카드 id 를 담아 주는가 (상대 연출에 필요)

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { byAssetId } = require('../engine/cards');
const { TurnEngine, PHASE, EVENT } = require('../engine/play');
const { Room, ROOM_PHASE } = require('../server/rooms');

const PUBLIC = path.join(__dirname, '..', 'public');
const fx = fs.readFileSync(path.join(PUBLIC, 'fx.js'), 'utf8');
const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
const app = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
const opponentCardMotion = fs.readFileSync(path.join(PUBLIC, 'opponent-card-motion.js'), 'utf8');

let uidSeq = 0;
function card(id) {
  const c = byAssetId(id);
  assert.ok(c, `알 수 없는 카드 id: ${id}`);
  return { ...c, uid: `u${++uidSeq}`, locked: false };
}

/** 정해진 바닥·손패·뒷패로 엔진을 직접 만든다. */
function makeEngine({ playerCount = 3, floor = [], hands = [], stock = [], current = 0 } = {}) {
  const engine = new TurnEngine({
    playerCount,
    names: Array.from({ length: playerCount }, (_, i) => `${i + 1}번`),
  });
  engine.state.floor = floor.map(card);
  engine.state.stock = stock.map(card);
  engine.state.players.forEach((p, i) => {
    p.hand = (hands[i] || []).map(card);
  });
  engine.state.current = current;
  engine.state.phase = PHASE.PLAYING;
  return engine;
}

test('효과음 모듈이 카드 이동(FLIP)과 섞기 연출을 공개한다', () => {
  assert.ok(/function\s+captureRects/.test(fx), 'captureRects 구현');
  assert.ok(/function\s+flipCards/.test(fx), 'flipCards 구현');
  assert.ok(/function\s+playShuffle/.test(fx), 'playShuffle 구현');
  assert.ok(/function\s+animateCardMove/.test(fx), 'animateCardMove 구현');
  assert.ok(/function\s+animateCardFlipMove/.test(fx), '뒤집으며 이동하는 카드 연출');
  assert.ok(/captureRects\s*:\s*captureRects/.test(fx), 'captureRects 공개');
  assert.ok(/flipCards\s*:\s*flipCards/.test(fx), 'flipCards 공개');
  assert.ok(/playShuffle\s*:\s*playShuffle/.test(fx), 'playShuffle 공개');
  assert.ok(/animateCardMove\s*:\s*animateCardMove/.test(fx), 'animateCardMove 공개');
  assert.ok(/animateCardFlipMove\s*:\s*animateCardFlipMove/.test(fx), '뒤집기 연출 공개');
});

test('카드가 떨어지며 나타나는 키프레임과 섞기 스타일이 있다', () => {
  assert.ok(/\.card\.enter/.test(css), '카드 등장 클래스');
  assert.ok(/@keyframes\s+cardEnter/.test(css), 'cardEnter 키프레임');
  assert.ok(/\.shuffle-overlay/.test(css), '섞기 오버레이 스타일');
  assert.ok(/\.shuffle-card/.test(css), '섞는 카드 스타일');
  assert.ok(/\.shuffle-overlay\.gather \.shuffle-card/.test(css), '중앙 수렴 카드 스타일');
  assert.ok(/#table\.capture-impact/.test(css), '먹기 순간 바닥 충격 애니메이션');
  assert.ok(/\.flip-flight-back/.test(css), '뒤집기 카드 뒷면 스타일');
  assert.ok(/@keyframes\s+captureShockwave/.test(css), '먹기 충격파 키프레임');
  assert.ok(/captureImpact\(\)/.test(opponentCardMotion), '먹기 이벤트가 바닥 충격을 발생시킨다');
  assert.ok(/prefers-reduced-motion:\s*reduce/.test(css), '모션 감소 설정 지원');
  assert.ok(/translate\(-50%, -50%\).*translateY/.test(fx), '카드가 중앙의 덱 형태로 모인다');
  assert.ok(/prefers-reduced-motion:\s*reduce/.test(fx), '모션 감소 시 빠른 정적 덱으로 전환');
  assert.ok(/GATHER_DURATION\s*=\s*580/.test(fx), '카드 수렴 시간을 정의한다');
  assert.ok(/GATHER_DURATION\s*\+\s*260/.test(fx), '수렴 후 덱을 잠시 유지한다');
});

test('셔플 연출이 끝나면 셔플 효과음을 중단한다', () => {
  assert.ok(/function\s+stopSound/.test(fx), '재생 중인 효과음을 중단하는 함수');
  assert.ok(/function\s+stopShuffleSounds/.test(fx), '셔플 효과음을 모두 중단하는 함수');
  assert.equal((fx.match(/stopShuffleSounds\(\)/g) || []).length, 3,
    '일반 연출과 모션 감소 연출 종료 시 셔플 소리를 중단한다');
  ['card_deal.ogg', 'card_flip.ogg', 'card_place.ogg'].forEach((file) => {
    assert.ok(fx.includes(`stopSound('${file}')`), `${file} 중단`);
  });
});

test('화면이 카드 이동을 실제로 적용한다', () => {
  assert.ok(/Fx\.captureRects\(/.test(app), '그리기 전 자리 기억');
  assert.ok(/Fx\.flipCards\(/.test(app), '그린 뒤 자리 맞춤');
  assert.ok(/Fx\.playShuffle\(/.test(app), '선 결정에서 섞기 연출');
  assert.ok(/opponentCardMotion\.play\(moveFx, state\)/.test(app), '상대 패 연출 모듈 호출');
  assert.ok(/deps\.fx\.animateCardMove\(/.test(opponentCardMotion), '상대 패가 날아가는 연출');
});

test('바닥에 놓은 패 이벤트가 카드 id 를 담아 준다', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: ['may_tanzaku'],
    hands: [['june_kasu_1'], [], []],
    stock: ['july_kasu_1'],
  });
  engine.playHandCard(0, null);
  const place = engine.state.events.find((e) => e.kind === EVENT.PLACE);
  assert.ok(place, 'PLACE 이벤트가 있어야 한다');
  assert.ok(Array.isArray(place.cards) && place.cards.length > 0, '카드 id 가 담겨야 한다');
  assert.ok(place.cards.includes('june_kasu_1'), '낸 카드의 id 가 담겨야 한다');
});

test('먹은 패 이벤트가 먹은 카드 id 를 담아 준다', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: ['may_kasu_1', 'may_kasu_2'],
    hands: [['may_tane'], [], []],
    stock: ['june_kasu_1'],
  });
  engine.playHandCard(0, null);
  const capture = engine.state.events.find((e) => e.kind === EVENT.CAPTURE);
  assert.ok(capture, 'CAPTURE 이벤트가 있어야 한다');
  assert.ok(Array.isArray(capture.cards) && capture.cards.length > 0, '카드 id 가 담겨야 한다');
  assert.ok(capture.cards.includes('may_tane'), '손에서 낸 카드의 id 가 담겨야 한다');
  assert.ok(capture.cards.length >= 2, '바닥에서 먹은 카드도 담겨야 한다');
});

test('방의 이펙트 로그에도 카드 id 가 담긴다', () => {
  const room = new Room('TESTFX', { mode: 'multi', playerCount: 3 });
  room.addPlayer('p0', '엄마');
  room.addPlayer('p1', '아빠');
  room.addPlayer('p2', '나');
  room.engine = makeEngine({
    floor: ['may_tanzaku'],
    hands: [['june_kasu_1'], [], []],
    stock: ['july_kasu_1'],
  });
  room.phase = ROOM_PHASE.PLAY;
  room.act(room.seats[0], 'playCard', { handIndex: 0 });

  const withCards = room.fx.filter((e) => e.cards && e.cards.length);
  assert.ok(withCards.length > 0, '이펙트 로그에 카드 id 가 담겨야 한다');
  assert.ok(
    withCards.every((e) => e.cards.every((id) => typeof id === 'string' && id.length > 0)),
    '카드 id 는 문자열이어야 한다'
  );
});

test('다음 판에서도 이펙트 번호가 이어진다', () => {
  const room = new Room('TESTFXSEQ', { mode: 'multi', playerCount: 2 });
  room.addPlayer('p0', '엄마');
  room.addPlayer('p1', '아빠');

  room.startRound();
  room.engine = {
    state: {
      events: [{ kind: 'place', seat: 0, month: 1, text: '패를 냈습니다.', cards: ['january_kasu_1'] }],
    },
  };
  room.pushFxFromEngine();
  const firstSequence = room.fx[0].seq;

  room.startRound();
  assert.strictEqual(room.fx.length, 0, '새 판의 이펙트 로그는 초기화되어야 한다');
  room.engine = {
    state: {
      events: [{ kind: 'place', seat: 0, month: 1, text: '패를 냈습니다.', cards: ['january_kasu_2'] }],
    },
  };
  room.pushFxFromEngine();

  assert.ok(room.fx[0].seq > firstSequence, '새 판의 이펙트 번호는 이전 판보다 커야 한다');
});
