'use strict';

// 고스톱 규칙 단위 테스트
// 실행: node tests/engine_test.js
//
// 규칙 기준: civilian7/gostop 의 docs/game-rules.md
// 검증 방법: 각 족보·특수상황·배수를 따로 떼어 내 결과값을 확인한다.

const test = require('node:test');
const assert = require('node:assert');

const { byAssetId, KIND, RIBBON } = require('../engine/cards');
const { evaluate, evaluateAsLoser, settle, DEFAULT_OPTIONS } = require('../engine/score');
const { deal, pickSeon, configFor } = require('../engine/deal');
const { TurnEngine, PHASE, EVENT } = require('../engine/play');
const { settleGame, applyToBalances } = require('../engine/settlement');
const { deckFromAssetIds } = require('../engine/deck');

let uidSeq = 0;
function card(id) {
  const c = byAssetId(id);
  assert.ok(c, `알 수 없는 카드 id: ${id}`);
  return { ...c, uid: `u${++uidSeq}`, locked: false };
}
function cards(...ids) {
  return ids.map(card);
}

/** 원하는 상태로 엔진을 세팅한다. */
function makeEngine({ playerCount = 3, names, floor = [], hands = [], stock = [], current = 0 } = {}) {
  const engine = new TurnEngine({
    playerCount,
    names: names || Array.from({ length: playerCount }, (_, i) => `${i + 1}번`),
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

// ─────────────────────────────────────────────────────────────────────────────
// 1) 족보 점수 (§6)
// ─────────────────────────────────────────────────────────────────────────────

test('3광 (비광 제외) = 3점', () => {
  const b = evaluate(cards('january_hikari', 'march_hikari', 'august_hikari'));
  assert.strictEqual(b.brightCount, 3);
  assert.strictEqual(b.brightPoints, 3);
  assert.strictEqual(b.total, 3);
});

test('3광 (비광 포함) = 2점', () => {
  const b = evaluate(cards('january_hikari', 'march_hikari', 'december_hikari'));
  assert.strictEqual(b.brightCount, 3);
  assert.strictEqual(b.brightPoints, 2);
  assert.strictEqual(b.total, 2);
});

test('4광 = 4점, 5광 = 15점', () => {
  const four = evaluate(cards('january_hikari', 'march_hikari', 'august_hikari', 'november_hikari'));
  assert.strictEqual(four.brightPoints, 4);
  const five = evaluate(cards('january_hikari', 'march_hikari', 'august_hikari', 'november_hikari', 'december_hikari'));
  assert.strictEqual(five.brightPoints, 15);
});

test('고도리 (2·4·8월 열꽃 3장) = 5점', () => {
  const b = evaluate(cards('february_tane', 'april_tane', 'august_tane'));
  assert.strictEqual(b.godoriPoints, 5);
  assert.strictEqual(b.animalCount, 3);
  assert.strictEqual(b.animalPoints, 0); // 열꽃 3장은 문턱(5) 미달
  assert.strictEqual(b.total, 5);
});

test('열꽃 5장 = 1점, 6장 = 2점', () => {
  const five = evaluate(cards('february_tane', 'april_tane', 'august_tane', 'june_tane', 'october_tane'));
  assert.strictEqual(five.animalPoints, 1);
  const six = evaluate(cards('february_tane', 'april_tane', 'august_tane', 'june_tane', 'october_tane', 'september_tane'));
  assert.strictEqual(six.animalPoints, 2);
});

test('홍단·청단·초단 각 세트 = 3점', () => {
  const hong = evaluate(cards('january_tanzaku', 'february_tanzaku', 'march_tanzaku'));
  assert.strictEqual(hong.hongdanPoints, 3);
  const cheong = evaluate(cards('june_tanzaku', 'september_tanzaku', 'october_tanzaku'));
  assert.strictEqual(cheong.cheongdanPoints, 3);
  const cho = evaluate(cards('april_tanzaku', 'may_tanzaku', 'july_tanzaku'));
  assert.strictEqual(cho.chodanPoints, 3);
  // 12월 비띠는 어느 세트에도 속하지 않는 일반 띠
  const bi = evaluate(cards('december_tanzaku'));
  assert.strictEqual(bi.hongdanPoints + bi.cheongdanPoints + bi.chodanPoints, 0);
  assert.strictEqual(bi.ribbonCount, 1);
});

test('띠 5장 = 1점, 6장 = 2점', () => {
  const five = evaluate(cards('january_tanzaku', 'february_tanzaku', 'march_tanzaku', 'june_tanzaku', 'september_tanzaku'));
  assert.strictEqual(five.ribbonPoints, 1);
  const six = evaluate(cards('january_tanzaku', 'february_tanzaku', 'march_tanzaku', 'june_tanzaku', 'september_tanzaku', 'october_tanzaku'));
  assert.strictEqual(six.ribbonPoints, 2);
});

test('피값 10 = 1점, 11 = 2점 (쌍피는 값 2)', () => {
  const ten = evaluate(cards(
    'january_kasu_1', 'january_kasu_2', 'february_kasu_1', 'february_kasu_2',
    'march_kasu_1', 'march_kasu_2', 'april_kasu_1', 'april_kasu_2',
    'may_kasu_1', 'may_kasu_2'
  ));
  assert.strictEqual(ten.junkValue, 10);
  assert.strictEqual(ten.junkPoints, 1);

  // 똥쌍피(november_kasu_3, 값2) + 비쌍피(december_kasu, 값2)
  const eleven = evaluate(cards(
    'january_kasu_1', 'february_kasu_1', 'march_kasu_1', 'april_kasu_1',
    'may_kasu_1', 'june_kasu_1', 'july_kasu_1', 'september_kasu_1',
    'november_kasu_2', 'december_kasu'
  ));
  assert.strictEqual(eleven.junkValue, 12);
  assert.strictEqual(eleven.junkPoints, 3);
});

test('국진은 열꽃/쌍피 중 유리한 쪽으로 자동 계산', () => {
  // 국진 1장 + 열꽃 4장 → 열꽃 5장(1점) 이 더 유리 (고도리 없음)
  const asAnimal = evaluate(cards('september_tane', 'june_tane', 'july_tane', 'october_tane', 'may_tane'));
  assert.strictEqual(asAnimal.gukjinAsPi, false);
  assert.strictEqual(asAnimal.total, 1);

  // 국진 1장 + 열꽃 0장 + 피 9 → 쌍피로 보면 피값 11(2점)
  const asPi = evaluate(cards(
    'september_tane',
    'january_kasu_1', 'january_kasu_2', 'february_kasu_1', 'february_kasu_2',
    'march_kasu_1', 'march_kasu_2', 'april_kasu_1', 'april_kasu_2', 'may_kasu_1'
  ));
  assert.strictEqual(asPi.gukjinAsPi, true);
  assert.strictEqual(asPi.junkValue, 11);
  assert.strictEqual(asPi.total, 2);
});

test('국진 잠그기 — 낼 피가 없으면 국진을 넘기지 않고 열꽃 고정', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: [],
    hands: [[], [], []],
    stock: [],
  });
  // 2번 플레이어는 국진만 가졌고, 1번은 피를 가짐
  engine.state.players[2].captured = cards('september_tane');
  engine.state.players[1].captured = cards('january_kasu_1');

  const ok = engine.stealOnePi(0, 2);
  assert.strictEqual(ok, false, '낼 피가 없으면 뺏지 못한다');
  assert.strictEqual(engine.state.players[2].captured.length, 1, '국진은 넘어가지 않는다');
  assert.strictEqual(engine.state.players[2].captured[0].locked, true, '국진이 열꽃 고정된다');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) 피 뺏기 우선순위 (§4)
// ─────────────────────────────────────────────────────────────────────────────

test('피 뺏기는 단피 → 쌍피 → 3피 순으로 낮은 값부터 뺏는다', () => {
  const engine = makeEngine({ playerCount: 2 });
  engine.state.players[1].captured = cards('january_kasu_1', 'november_kasu_3', 'bonus_sampi');
  assert.strictEqual(engine.stealOnePi(0, 1), true);
  assert.strictEqual(engine.state.players[1].captured.length, 2);
  assert.strictEqual(engine.state.players[0].captured[0].id, 'january_kasu_1', '단피가 먼저 넘어간다');

  engine.stealOnePi(0, 1);
  assert.strictEqual(engine.state.players[0].captured[1].id, 'november_kasu_3', '그 다음 쌍피');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) 턴 진행 (§3) — 바닥 2장 선택
// ─────────────────────────────────────────────────────────────────────────────

test('바닥에 같은 월 2장이고 종류가 다르면 선택이 필요하다', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: ['may_tanzaku', 'may_kasu_1'],
    hands: [['may_tane'], [], []],
    stock: ['june_kasu_1'],
  });
  const r = engine.playHandCard(0, null);
  assert.strictEqual(r.awaiting, 'floorChoice');
  assert.strictEqual(r.options.length, 2);
  assert.strictEqual(engine.state.phase, PHASE.AWAITING_FLOOR_CHOICE);

  engine.resolveFloorChoice(0);
  // 손패 광 + 선택한 띠 = 2장 획득
  assert.strictEqual(engine.state.players[0].captured.length, 2);
});

test('바닥에 같은 월 2장이고 종류가 같으면 자동 처리된다', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: ['may_kasu_1', 'may_kasu_2'],
    hands: [['may_tane'], [], []],
    stock: ['june_kasu_1'],
  });
  const r = engine.playHandCard(0, null);
  assert.strictEqual(r.awaiting, null, '선택 대기가 아니다');
  assert.strictEqual(engine.state.players[0].captured.length, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) 특수 상황 (§4)
// ─────────────────────────────────────────────────────────────────────────────

test('뻑 — 손패가 바닥 1장과 매칭인데 뒤집은 것도 같은 월이면 아무도 못 먹는다', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: ['may_tanzaku'],
    hands: [['may_tane'], [], []],
    stock: ['may_kasu_1'],
  });
  engine.playHandCard(0, null);
  assert.strictEqual(engine.state.players[0].captured.length, 0, '아무것도 못 먹었다');
  assert.strictEqual(engine.state.floor.length, 3, '바닥에 3장 쌓였다');
  assert.strictEqual(engine.state.bbeokCreator.get(5), 0, '뻑을 낸 사람이 기록된다');
  assert.ok(engine.state.events.some((e) => e.kind === EVENT.BBEOK));
});

test('자뻑 — 자기가 싼 뻑을 자기가 먹으면 상대 전원에게서 피 2장씩', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: ['may_tanzaku'],
    hands: [['may_tane'], [], []],
    stock: ['may_kasu_1'],
  });
  engine.state.players[0].captured = cards('august_kasu_1'); // 뻑을 낸 사람에게도 피가 있다
  engine.state.players[1].captured = cards('june_kasu_1', 'july_kasu_1');
  engine.state.players[2].captured = cards('june_kasu_2', 'july_kasu_2');

  engine.playHandCard(0, null); // 뻑
  assert.strictEqual(engine.state.bbeokCreator.get(5), 0);

  // 0번이 뻑 더미(5월 3장)를 회수 → 자뻑 → 각 상대에게서 피 2장
  engine.state.current = 0;
  const captured = [];
  engine.captureInto(captured, engine.matchIndices(5), -1);
  assert.strictEqual(captured.length, 3, '뻑 더미 3장 전량 회수');
  engine.state.players[0].captured.push(...captured);
  engine.resolveBbeokCapture(5);

  // 상대 2명 × 2장 = 4장을 빼앗았다
  assert.strictEqual(engine.state.players[1].captured.length, 0, '1번에게서 2장 뺏김');
  assert.strictEqual(engine.state.players[2].captured.length, 0, '2번에게서 2장 뺏김');
  assert.strictEqual(engine.state.players[0].captured.filter((c) => c.kind === KIND.JUNK).length, 6, '기존 피 1장 + 뻑 더미의 피 1장 + 뺏은 4장');
});

test('뻑 회수 — 남이 싼 뻑을 먹으면 상대 전원에게서 피 1장씩', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: ['may_tanzaku'],
    hands: [['may_tane'], [], []],
    stock: ['may_kasu_1'],
  });
  engine.state.players[0].captured = cards('august_kasu_1'); // 뻑을 낸 사람에게도 피가 있다
  engine.state.players[1].captured = cards('june_kasu_1', 'july_kasu_1');
  engine.state.players[2].captured = cards('june_kasu_2', 'july_kasu_2');

  engine.playHandCard(0, null); // 0번이 뻑
  assert.strictEqual(engine.state.bbeokCreator.get(5), 0);

  // 1번이 뻑 더미를 회수
  engine.state.current = 1;
  const captured = [];
  engine.captureInto(captured, engine.matchIndices(5), -1);
  engine.state.players[1].captured.push(...captured);
  engine.resolveBbeokCapture(5);

  assert.strictEqual(engine.state.players[0].captured.length, 0, '0번에게서 1장 뺏김');
  assert.strictEqual(engine.state.players[2].captured.length, 1, '2번에게서 1장 뺏김');
  assert.strictEqual(engine.state.players[1].captured.filter((c) => c.kind === KIND.JUNK).length, 5, '처음 가진 피 2장 + 뻑 더미의 피 1장 + 뺏은 2장');
});

test('쪽 — 손패를 빈 바닥에 놓고 뒤집은 카드가 먹음. 상대 전원에게서 피 1장씩', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: [],
    hands: [['may_tane', 'june_kasu_1'], [], []],
    stock: ['may_kasu_2'],
  });
  engine.state.players[1].captured = cards('june_kasu_1');
  engine.state.players[2].captured = cards('july_kasu_1');

  engine.playHandCard(0, null);
  assert.ok(engine.state.events.some((e) => e.kind === EVENT.JJOK), '쪽 이벤트가 발생한다');
  // 먹은 피 1장 + 쪽으로 뺏은 2장 = 3장 (상대는 피가 1장뿐이라 더 못 뺏는다)
  assert.strictEqual(engine.state.players[0].captured.filter((c) => c.kind === KIND.JUNK).length, 3);
});

test('따닥 — 바닥 2장 + 손패 + 뒤집은 것 4장, 상대 전원에게서 피 1장씩', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: ['may_tanzaku', 'may_kasu_1'],
    hands: [['may_tane', 'june_kasu_1'], [], []],
    stock: ['may_kasu_2'],
  });
  engine.state.players[1].captured = cards('june_kasu_1');
  engine.state.players[2].captured = cards('july_kasu_1');

  engine.playHandCard(0, 0);
  assert.ok(engine.state.events.some((e) => e.kind === EVENT.TTADAK), '따닥 이벤트가 발생한다');
  assert.strictEqual(engine.state.players[0].captured.length, 6, '4장 먹음 + 뺏은 피 2장');
});

test('싹쓸이 — 이번 턴으로 바닥이 빔', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: ['may_kasu_1'],
    hands: [['may_kasu_2', 'june_kasu_1'], [], []],
    stock: [],
  });
  engine.state.players[1].captured = cards('june_kasu_1');
  engine.state.players[2].captured = cards('july_kasu_1');

  engine.playHandCard(0, null);
  assert.ok(engine.state.events.some((e) => e.kind === EVENT.SSEUL), '싹쓸이 이벤트가 발생한다');
  assert.strictEqual(engine.state.floor.length, 0, '바닥이 비었다');
  // 먹은 2장 + 상대 2명에게서 뺏은 1장씩 = 4장
  assert.strictEqual(engine.state.players[0].captured.filter((c) => c.kind === KIND.JUNK).length, 4);
});

test('마지막 장 예외 — 마지막 장으로는 쪽/따닥/싹쓸이가 인정되지 않는다', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: [],
    hands: [['may_tane'], [], []],
    stock: ['may_kasu_2'],
  });
  engine.state.players[1].captured = cards('june_kasu_1');
  engine.state.players[2].captured = cards('july_kasu_1');

  engine.playHandCard(0, null);
  assert.ok(!engine.state.events.some((e) => e.kind === EVENT.JJOK), '쪽이 인정되지 않는다');
  assert.ok(!engine.state.events.some((e) => e.kind === EVENT.SSEUL), '싹쓸이가 인정되지 않는다');
  // 상대 피는 그대로 (빼앗기지 않았다)
  assert.strictEqual(engine.state.players[1].captured.length, 1);
  assert.strictEqual(engine.state.players[2].captured.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5) 보너스패 (§5)
// ─────────────────────────────────────────────────────────────────────────────

test('보너스패를 손에서 내면 즉시 획득하고 뒷패에서 1장 골라 보충한다', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: [],
    hands: [['bonus_ssangpi_1', 'may_tane'], [], []],
    stock: ['june_kasu_1', 'july_kasu_1'],
  });
  const r = engine.playHandCard(0, null);
  assert.strictEqual(r.awaiting, 'bonusDraw');
  assert.strictEqual(engine.state.phase, PHASE.AWAITING_BONUS_DRAW);
  assert.strictEqual(engine.state.players[0].captured.length, 1, '보너스패는 즉시 획득');

  engine.resolveBonusDraw(0);
  assert.strictEqual(engine.state.phase, PHASE.PLAYING, '같은 차례 계속');
  assert.strictEqual(engine.state.players[0].hand.length, 2, '보충 후 손패 2장');
  assert.ok(engine.state.players[0].hand.some((c) => c.id === 'june_kasu_1'), '선택한 카드가 손패에 들어간다');
});

test('보너스패를 낸 턴에 뻑이 나면 보너스패도 뻑 더미에 묻힌다', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: ['may_tanzaku'],
    hands: [['bonus_ssangpi_1', 'may_tane'], [], []],
    stock: ['may_kasu_1', 'may_kasu_2'],
  });
  // 보너스패를 낸 뒤 → 뒷패 선택(일반패) → 같은 차례에 실제 패를 낸다
  engine.playHandCard(0, null);
  engine.resolveBonusDraw(0);
  engine.playHandCard(0, null); // may_tane 를 냄
  assert.ok(engine.state.events.some((e) => e.kind === EVENT.BBEOK), '뻑 발생');
  assert.strictEqual(engine.state.players[0].captured.length, 0, '보너스패도 획득이 취소되어 묻혔다');
  assert.strictEqual(engine.state.floor.length, 4, '바닥에 3장 + 묻힌 보너스패 1장');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6) 고 / 스톱 (§7)
// ─────────────────────────────────────────────────────────────────────────────

test('고 배수 — 3고부터 ×2, 4고 ×4, 5고 ×8', () => {
  const win = evaluate(cards('january_hikari', 'march_hikari', 'august_hikari')); // 3점
  const lose = evaluate([]);
  const cases = [
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 4],
    [5, 8],
  ];
  for (const [goCount, expected] of cases) {
    const s = settle(win, lose, goCount, 0, DEFAULT_OPTIONS, false);
    assert.strictEqual(s.goMultiplier, expected, `${goCount}고 배수`);
  }
});

test('역고 — 고 횟수 배수 대신 ×4로 대체되고 고 보너스는 유지', () => {
  const win = evaluate(cards('january_hikari', 'march_hikari', 'august_hikari'));
  const lose = evaluate(cards('january_hikari')); // 광을 1장 가져야 광박(×2)이 붙지 않는다
  const s = settle(win, lose, 5, 0, DEFAULT_OPTIONS, true);
  assert.strictEqual(s.reverseGo, true);
  assert.strictEqual(s.goMultiplier, 4, '고 횟수 배수를 대체한 고정 배수');
  assert.strictEqual(s.multiplier, 4, '광박 없음');
  assert.strictEqual(s.goBonus, 5, '고 보너스는 그대로');
  assert.strictEqual(s.points, (3 + 5) * 4);
});

test('역고 판정 — 상대가 이미 고를 불렀으면 내가 고를 부를 때 역고가 성립한다', () => {
  const engine = makeEngine({ playerCount: 3 });
  engine.state.phase = PHASE.AWAITING_GO_STOP;
  engine.state.players[1].goCount = 1; // 상대가 이미 고를 불렀다
  engine.state.current = 0;
  engine.declareGo();
  assert.strictEqual(engine.state.players[0].reverseGo, true);
  assert.strictEqual(engine.state.players[0].goCount, 1);
});

test('나가리 — 아무도 둘 수 없으면 승자 없이 종료', () => {
  const engine = makeEngine({ playerCount: 3, hands: [[], [], []], stock: [] });
  engine.advanceTurn();
  assert.strictEqual(engine.state.phase, PHASE.FINISHED);
  assert.strictEqual(engine.state.winner, -1);
});

test('총통 — 딜 직후 손패에 같은 패 4장이면 즉시 승리(고정 점수)', () => {
  const engine = makeEngine({ playerCount: 3 });
  engine.state.players[0].hand = cards('may_kasu_1', 'may_kasu_2', 'may_tanzaku', 'may_tane');
  engine.applyHandChongtong();
  assert.strictEqual(engine.state.phase, PHASE.FINISHED);
  assert.strictEqual(engine.state.winner, 0);

  const rows = engine.finalSettlement();
  assert.strictEqual(rows[0].net, 6, '3인 고정 점수 3점 × 패자 2명');
  assert.strictEqual(rows[1].net, -3);
  assert.strictEqual(rows[2].net, -3);
});

test('바닥에 같은 월 4장이면 선이 즉시 승리한다', () => {
  const engine = makeEngine({ playerCount: 3 });
  engine.state.floor = cards('may_kasu_1', 'may_kasu_2', 'may_tanzaku', 'may_tane');
  const applied = engine.applyFloorChongtong();
  assert.strictEqual(applied, true);
  assert.strictEqual(engine.state.winner, 0, '선');
});

test('쓰리뻑 — 한 판에 같은 플레이어가 뻑을 3번 내면 즉시 승리', () => {
  const engine = makeEngine({
    playerCount: 3,
    floor: ['may_tanzaku'],
    hands: [['may_tane'], [], []],
    stock: ['may_kasu_1'],
  });
  engine.state.players[0].bbeokCount = 2; // 두 번 뻑을 낸 상태
  engine.playHandCard(0, null);
  assert.strictEqual(engine.state.phase, PHASE.FINISHED);
  assert.strictEqual(engine.state.winner, 0);
  assert.strictEqual(engine.state.threeBbeok, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7) 박 (§9)
// ─────────────────────────────────────────────────────────────────────────────

test('피박 — 승자가 피 점수를 냈고 패자의 피값이 기준 이하(3인 ≤5)이면 ×2', () => {
  const win = evaluate(cards(
    'january_kasu_1', 'february_kasu_1', 'march_kasu_1', 'april_kasu_1', 'may_kasu_1',
    'june_kasu_1', 'july_kasu_1', 'september_kasu_1', 'october_kasu_1', 'november_kasu_1'
  )); // 피값 10 → 1점
  const loser = evaluate(cards('january_kasu_1')); // 피값 1 ≤ 5
  const s = settle(win, loser, 0, 0, { ...DEFAULT_OPTIONS, pibakMaxJunk: 5 }, false);
  assert.strictEqual(s.pibak, true);
  assert.strictEqual(s.multiplier, 2);
  assert.strictEqual(s.points, (win.total + 0) * 2);
});

test('피박 면제 — 패자의 피가 0장이면 피박이 성립하지 않는다', () => {
  const win = evaluate(cards(
    'january_kasu_1', 'february_kasu_1', 'march_kasu_1', 'april_kasu_1', 'may_kasu_1',
    'june_kasu_1', 'july_kasu_1', 'september_kasu_1', 'october_kasu_1', 'november_kasu_1'
  ));
  const loser = evaluate([]);
  const s = settle(win, loser, 0, 0, { ...DEFAULT_OPTIONS, pibakMaxJunk: 5 }, false);
  assert.strictEqual(s.pibak, false);
  assert.strictEqual(s.multiplier, 1);
});

test('광박 — 승자가 광 점수를 냈고 패자의 광이 0장이면 ×2', () => {
  const win = evaluate(cards('january_hikari', 'march_hikari', 'august_hikari'));
  const loser = evaluate(cards('january_kasu_1'));
  const s = settle(win, loser, 0, 0, DEFAULT_OPTIONS, false);
  assert.strictEqual(s.gwangbak, true);
  assert.strictEqual(s.multiplier, 2);
});

test('멍박 — 승자가 열꽃 7장 이상 보유하고 패자의 열꽃이 0장이면 ×2', () => {
  const win = evaluate(cards(
    'february_tane', 'april_tane', 'august_tane', 'june_tane', 'july_tane', 'october_tane', 'september_tane'
  ));
  const loser = evaluate(cards('january_kasu_1'));
  const s = settle(win, loser, 0, 0, DEFAULT_OPTIONS, false);
  assert.strictEqual(s.meongbak, true);
  assert.strictEqual(s.multiplier, 2);
});

test('고박 — 고를 부르고 진 사람은 다른 패자 몫까지 전액 ×2 부담', () => {
  const engine = makeEngine({ playerCount: 3 });
  engine.state.winner = 0;
  engine.state.players[0].captured = cards('january_hikari', 'march_hikari', 'august_hikari'); // 3점
  engine.state.players[1].goCount = 1; // 1번이 고를 부르고 진 사람 → 고박 대상
  engine.state.players[1].captured = cards('june_kasu_1'); // 피 1장 (지급면제 아님)
  engine.state.players[2].captured = cards('july_kasu_1');

  const rows = engine.finalSettlement();
  assert.strictEqual(rows[1].gobak, true);
  assert.strictEqual(rows[1].net, -24, '3점 × 광박 ×2 → 총액 12, 고박배수 2 → 24');
  assert.strictEqual(rows[2].net, 0, '나머지 패자는 면제');
  assert.strictEqual(rows[0].net, 24);
});

// ─────────────────────────────────────────────────────────────────────────────
// 8) 정산 (§10)
// ─────────────────────────────────────────────────────────────────────────────

test('정산 금액 = 정산 점수 × 점당 금액 × 판돈 배수', () => {
  const engine = makeEngine({ playerCount: 2 });
  engine.state.winner = 0;
  engine.state.players[0].captured = cards('january_hikari', 'march_hikari', 'august_hikari'); // 3점
  engine.state.players[1].captured = cards('january_hikari'); // 광 1장 → 광박 없음

  const res = settleGame(engine, { moneyPerPoint: 100, stakeMultiplier: 1 });
  assert.strictEqual(res.rows[0].amount, 300);
  assert.strictEqual(res.rows[1].amount, -300);
  assert.strictEqual(res.total, 0, '승자 수령액 = 패자 지불액');
});

test('정산 — 광박이 걸리면 패자가 ×2 를 낸다', () => {
  const engine = makeEngine({ playerCount: 2 });
  engine.state.winner = 0;
  engine.state.players[0].captured = cards('january_hikari', 'march_hikari', 'august_hikari');
  engine.state.players[1].captured = cards('june_kasu_1');

  const res = settleGame(engine, { moneyPerPoint: 100 });
  assert.strictEqual(res.rows[1].gwangbak, true);
  assert.strictEqual(res.rows[1].amount, -600, '3점 × 광박 ×2');
});

test('가상 잔액 반영 — 승자는 증가하고 패자는 감소한다', () => {
  const players = [
    { seat: 0, money: 30000 },
    { seat: 1, money: 30000 },
  ];
  const next = applyToBalances(players, [
    { seat: 0, amount: 500 },
    { seat: 1, amount: -500 },
  ]);
  assert.strictEqual(next[0].money, 30500);
  assert.strictEqual(next[1].money, 29500);
});

// ─────────────────────────────────────────────────────────────────────────────
// 9) 딜 (§2)
// ─────────────────────────────────────────────────────────────────────────────

test('3인 딜 — 손패 7장씩, 바닥 6장, 더미 21장 (48장 구성)', () => {
  const ids = [];
  for (const c of require('../engine/cards').STANDARD) ids.push(c.id);
  const deck = deckFromAssetIds(ids);
  const before = deck.length;
  const r = deal(deck, 3, 0);
  assert.strictEqual(r.hands[0].length, 7);
  assert.strictEqual(r.hands[1].length, 7);
  assert.strictEqual(r.hands[2].length, 7);
  assert.strictEqual(r.floor.length, 6);
  assert.strictEqual(r.stock.length, before - 27);
});

test('2인 딜 — 손패 10장씩, 바닥 8장 (맞고)', () => {
  const ids = require('../engine/cards').STANDARD.map((c) => c.id);
  const deck = deckFromAssetIds(ids);
  const r = deal(deck, 2, 0);
  assert.strictEqual(r.hands[0].length, 10);
  assert.strictEqual(r.hands[1].length, 10);
  assert.strictEqual(r.floor.length, 8);
  assert.strictEqual(r.stock.length, 48 - 28);
});

test('딜 순서 — 손패는 선 다음 자리부터 받고 선이 마지막에 받는다', () => {
  // 덱 배열의 마지막 원소가 맨 위. 바닥 3장 → 손패 4장 → 바닥 3장 → 손패 3장.
  // 3인 손패 7장은 두 묶음(4장 + 3장)으로 나뉘며, 각 묶음에서 선은 마지막을 받는다.
  const deck = [];
  for (let i = 0; i < 51; i++) {
    deck.push({ id: `p${i}`, month: 1, kind: KIND.JUNK, ordinal: 1, junkValue: 1, ribbon: RIBBON.NONE, godori: false, biGwang: false, gukjin: false });
  }

  const r = deal(deck, 3, 0);
  // 바닥: 먼저 3장(p50,p49,p48), 첫 손패 묶음 뒤에 3장(p35,p34,p33)
  assert.deepStrictEqual(r.floor.map((c) => c.id), ['p50', 'p49', 'p48', 'p35', 'p34', 'p33']);
  // 첫 손패 묶음(4장): 1번 자리(선 다음) → 2번 → 선(0번)
  assert.deepStrictEqual(r.hands[1].slice(0, 4).map((c) => c.id), ['p47', 'p46', 'p45', 'p44']);
  assert.deepStrictEqual(r.hands[2].slice(0, 4).map((c) => c.id), ['p43', 'p42', 'p41', 'p40']);
  assert.deepStrictEqual(r.hands[0].slice(0, 4).map((c) => c.id), ['p39', 'p38', 'p37', 'p36']);
  // 둘째 손패 묶음(3장): 역시 선 다음 자리부터
  assert.deepStrictEqual(r.hands[1].slice(4).map((c) => c.id), ['p32', 'p31', 'p30']);
  assert.deepStrictEqual(r.hands[2].slice(4).map((c) => c.id), ['p29', 'p28', 'p27']);
  assert.deepStrictEqual(r.hands[0].slice(4).map((c) => c.id), ['p26', 'p25', 'p24']);
});

test('손패 정렬 — 월 → 종류(광/열꽃/띠/피) → 순번 순', () => {
  const engine = makeEngine({
    playerCount: 2,
    hands: [['january_kasu_1', 'january_hikari', 'january_tanzaku', 'january_kasu_2'], []],
  });
  const { sortHand } = require('../engine/deal');
  const sorted = sortHand(engine.state.players[0].hand);
  assert.deepStrictEqual(sorted.map((c) => c.id), ['january_hikari', 'january_tanzaku', 'january_kasu_1', 'january_kasu_2']);
});

test('밤일낮장 — 낮은 가장 큰 월, 밤은 가장 작은 월이 선', () => {
  const day = pickSeon([3, 11, 7], 12);
  assert.strictEqual(day.isDay, true);
  assert.strictEqual(day.value, 11);
  assert.strictEqual(day.winner, 1);

  const night = pickSeon([3, 11, 7], 22);
  assert.strictEqual(night.isDay, false);
  assert.strictEqual(night.value, 3);
  assert.strictEqual(night.winner, 0);

  // 최고월 동점이면 그자끼리 재경합
  const tie = pickSeon([5, 7, 7], 12);
  assert.deepStrictEqual(tie.winners, [1, 2]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 10) 설정
// ─────────────────────────────────────────────────────────────────────────────

test('설정 정규화 — 허용 범위를 벗어난 값은 기본값으로 돌아간다', () => {
  const { normalizeSettings } = require('../engine/settings');
  const s = normalizeSettings({ playerCount: 9, bonusPack: 77, moneyPerPoint: -5, timeLimit: { enabled: true, base: 0 } });
  assert.strictEqual(s.playerCount, 3);
  assert.strictEqual(s.bonusPack, 50);
  assert.strictEqual(s.moneyPerPoint, 100);
  assert.strictEqual(s.timeLimit.base, 30);
  assert.strictEqual(s.timeLimit.enabled, true);
});

test('박 on/off 설정이 점수 계산기에 반영된다', () => {
  const { normalizeSettings, toScoreOptions } = require('../engine/settings');
  const s = normalizeSettings({ bak: { pi: false } });
  const opt = toScoreOptions(s);
  assert.strictEqual(opt.pibakEnabled, false);
  assert.strictEqual(opt.gwangbakEnabled, true);
});
