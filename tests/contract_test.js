'use strict';

// 계약 테스트 — itsent-lab/hwatu 와 공유하는 규칙 계약(점수 라인·정산 단계·카드 매핑)을 검증한다.
// 실행: node tests/contract_test.js
//
// 규칙 벡터 형식은 itsent-lab/hwatu 의 shared/contracts/game-rule-vectors-v1.json 을 따른다.
// (operation / input / expected 형태 — 나중에 이 파일로 교차 검증할 수 있다.)

const test = require('node:test');
const assert = require('node:assert');

const { byAssetId, byImageKey, STANDARD, KIND } = require('../engine/cards');
const { evaluate, settle, DEFAULT_OPTIONS } = require('../engine/score');
const { TurnEngine } = require('../engine/play');
const { settleGame } = require('../engine/settlement');

function card(id) {
  const c = byAssetId(id);
  assert.ok(c, `알 수 없는 카드 id: ${id}`);
  return { ...c, uid: `u${Math.random().toString(36).slice(2, 8)}`, locked: false };
}
function cards(...ids) {
  return ids.map(card);
}

// ─────────────────────────────────────────────────────────────────────────────
// 카드 매핑 — itsent-lab 의 imageKey(m01-01) 규약과 일치해야 한다
// ─────────────────────────────────────────────────────────────────────────────

test('카드 매핑 — 모든 카드가 itsent-lab 규약의 imageKey를 갖는다', () => {
  assert.strictEqual(STANDARD.length, 48);
  for (const c of STANDARD) {
    assert.match(c.imageKey, /^m\d{2}-0[1-4]$/, `imageKey 형식 오류: ${c.id}`);
    assert.strictEqual(byImageKey(c.imageKey), c, `imageKey 역참조 실패: ${c.imageKey}`);
  }
  // 규약 그대로: 1월은 광·띠·피·피
  assert.deepStrictEqual(
    STANDARD.filter((c) => c.month === 1).map((c) => c.imageKey),
    ['m01-01', 'm01-02', 'm01-03', 'm01-04']
  );
  assert.strictEqual(byImageKey('m01-01').kind, KIND.BRIGHT);
  assert.strictEqual(byImageKey('m01-02').ribbon, 'hong');
});

test('카드 매핑 — 11월 쌍피는 m11-02(가운데 자리), 12월 비쌍피는 m12-04', () => {
  const gukjinPi = byImageKey('m11-02');
  assert.strictEqual(gukjinPi.kind, KIND.DOUBLE_JUNK);
  assert.strictEqual(gukjinPi.junkValue, 2);

  const biPi = byImageKey('m12-04');
  assert.strictEqual(biPi.kind, KIND.DOUBLE_JUNK);
  assert.strictEqual(biPi.junkValue, 2);

  // 11월 광은 m11-01
  assert.strictEqual(byImageKey('m11-01').kind, KIND.BRIGHT);
  // 12월 비광은 m12-01
  assert.strictEqual(byImageKey('m12-01').biGwang, true);
});

test('카드 태그 — 고도리/홍단/청단/초단/국진/비광 표식이 정확하다', () => {
  assert.ok(byImageKey('m02-01').tags.includes('godori'));
  assert.ok(byImageKey('m04-01').tags.includes('godori'));
  assert.ok(byImageKey('m08-02').tags.includes('godori'));
  assert.ok(byImageKey('m09-01').tags.includes('gookjin'));
  assert.ok(byImageKey('m12-01').tags.includes('rain-bright'));
  assert.ok(byImageKey('m12-03').tags.includes('rain-ribbon'));
  assert.ok(byImageKey('m01-02').tags.includes('hongdan'));
  assert.ok(byImageKey('m06-02').tags.includes('cheongdan'));
  assert.ok(byImageKey('m05-02').tags.includes('chodan'));
  // 비띠는 어느 단 세트에도 속하지 않는다
  assert.ok(!byImageKey('m12-03').tags.includes('hongdan'));
  assert.ok(!byImageKey('m12-03').tags.includes('cheongdan'));
  assert.ok(!byImageKey('m12-03').tags.includes('chodan'));
});

// ─────────────────────────────────────────────────────────────────────────────
// 점수 라인 — 화면에 그대로 보여줄 수 있는 구조
// ─────────────────────────────────────────────────────────────────────────────

test('점수 라인 — 광 3점은 라벨·설명까지 갖는다', () => {
  const b = evaluate(cards('january_hikari', 'march_hikari', 'august_hikari'));
  const line = b.lines.find((l) => l.code === 'bright');
  assert.ok(line, '광 라인이 있어야 한다');
  assert.strictEqual(line.points, 3);
  assert.strictEqual(line.label, '삼광');
  assert.strictEqual(line.description, '광 3장');
});

test('점수 라인 — 비광 포함 3광은 비삼광', () => {
  const b = evaluate(cards('january_hikari', 'march_hikari', 'december_hikari'));
  const line = b.lines.find((l) => l.code === 'bright');
  assert.strictEqual(line.label, '비삼광');
  assert.strictEqual(line.description, '비광이 포함된 3광');
  assert.strictEqual(line.points, 2);
});

test('점수 라인 — 고도리/띠/피 라인이 각각 나온다', () => {
  const b = evaluate(cards(
    'february_tane', 'april_tane', 'august_tane', // 고도리
    'june_tane', 'july_tane', 'october_tane', // 열꽃 6장
    'january_tanzaku', 'february_tanzaku', 'march_tanzaku', 'june_tanzaku', 'september_tanzaku', // 띠 5장
    'january_kasu_1', 'february_kasu_1', 'march_kasu_1', 'april_kasu_1', 'may_kasu_1',
    'june_kasu_1', 'july_kasu_1', 'august_kasu_1', 'september_kasu_1', 'october_kasu_1' // 피 10
  ));
  const codes = b.lines.map((l) => l.code);
  assert.ok(codes.includes('godori'));
  assert.ok(codes.includes('animal'));
  assert.ok(codes.includes('ribbon'));
  assert.ok(codes.includes('hongdan'));
  assert.ok(codes.includes('junk'));
  // 라인의 합이 총점과 같아야 한다
  assert.strictEqual(b.lines.reduce((sum, l) => sum + l.points, 0), b.total);
});

// ─────────────────────────────────────────────────────────────────────────────
// 정산 단계 — 배수 계산 과정이 그대로 노출된다
// ─────────────────────────────────────────────────────────────────────────────

test('정산 단계 — 기본점수 → 고 보너스 → 고 배수 → 흔들기 → 박 순서', () => {
  const win = evaluate(cards('january_hikari', 'march_hikari', 'august_hikari')); // 3점
  const lose = evaluate(cards('june_kasu_1'));
  const s = settle(win, lose, 3, 1, DEFAULT_OPTIONS, false);

  const labels = s.steps.map((st) => st.label);
  assert.deepStrictEqual(labels, ['기본 점수', '고 보너스', '고 배수', '흔들기·폭탄', '박 배수']);

  // 3점 + 고보너스 3점 = 6, ×고배수 2 = 12, ×흔들기 2 = 24, ×광박 2 = 48
  assert.strictEqual(s.goBonus, 3);
  assert.strictEqual(s.goMultiplier, 2);
  assert.strictEqual(s.shakeMultiplier, 2);
  assert.strictEqual(s.bakMultiplier, 2);
  assert.strictEqual(s.points, 48);
  assert.strictEqual(s.steps[s.steps.length - 1].value, 48);
});

test('정산 단계 — 단계 값이 순서대로 이어진다', () => {
  const win = evaluate(cards('january_hikari', 'march_hikari', 'august_hikari'));
  const lose = evaluate(cards('june_kasu_1'));
  const s = settle(win, lose, 1, 0, DEFAULT_OPTIONS, false);

  assert.strictEqual(s.steps[0].value, 3, '기본 점수');
  assert.strictEqual(s.steps[1].value, 4, '고 보너스 반영');
  assert.strictEqual(s.steps[2].value, 4, '고 배수 1배');
  assert.strictEqual(s.steps[3].value, 4, '흔들기 없음');
  assert.strictEqual(s.steps[4].value, 8, '광박 ×2');
  assert.strictEqual(s.points, s.steps[s.steps.length - 1].value);
});

// ─────────────────────────────────────────────────────────────────────────────
// 지급 면제 — 패자가 한 장도 획득하지 못하면 점수는 유지하고 지급만 면제
// ─────────────────────────────────────────────────────────────────────────────

test('지급 면제 — 패자가 0장이면 점수는 유지하고 지급은 0', () => {
  const engine = new TurnEngine({ playerCount: 2, names: ['A', 'B'] });
  engine.state.winner = 0;
  engine.state.players[0].captured = cards('january_hikari', 'march_hikari', 'august_hikari');
  engine.state.players[1].captured = [];

  const res = settleGame(engine, { moneyPerPoint: 100 });
  assert.strictEqual(res.rows[1].paymentExempt, true);
  assert.strictEqual(res.rows[1].amount, 0, '지급하지 않는다');
  assert.ok(res.rows[1].points > 0, '점수는 그대로 유지된다 (면제되어도 0이 아님)');
  assert.strictEqual(res.rows[0].amount, 0, '승자도 이 패자에게서는 받지 않는다');
});

test('지급 면제 — 패자가 패를 갖고 있으면 정상 지급된다', () => {
  const engine = new TurnEngine({ playerCount: 2, names: ['A', 'B'] });
  engine.state.winner = 0;
  engine.state.players[0].captured = cards('january_hikari', 'march_hikari', 'august_hikari');
  engine.state.players[1].captured = cards('june_kasu_1');

  const res = settleGame(engine, { moneyPerPoint: 100 });
  assert.strictEqual(res.rows[1].paymentExempt, false);
  assert.ok(res.rows[1].amount < 0, '패자가 지불한다');
  assert.strictEqual(res.rows[0].amount, -res.rows[1].amount, '승자 수령 = 패자 지불');
});
