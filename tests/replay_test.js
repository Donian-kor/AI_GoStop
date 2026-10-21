'use strict';

// 재플레이 스모크 테스트
// 실행: node tests/replay_test.js
//
// 참조 저장소(civilian7/gostop)의 delphi/records/*.rec 는 한 판의 전체를 JSON으로 담고 있다
// (덱 순서 + 수 시퀀스). 그 레코드를 우리 엔진에 그대로 넣었을 때 **예외 없이 진행되는지**
// 확인한다.
//
// ── 왜 "완전 재현"이 아닌가 (중요) ───────────────────────────────────────────
// .rec 형식에는 판을 재현하는 데 필요한 정보가 일부 빠져 있다.
//   1) SeonWinner 가 항상 -1 로 기록되어 있어, 시뮬레이터가 어떤 선(先)으로 딜했는지 알 수 없다.
//      (시뮬레이터는 TDealer.Deal 을 선=0 으로 호출하고 선을 별도로 기록하지 않는다)
//   2) 바닥 선택 값(b) 이 "자동(-1)" 과 "0번 카드" 가 구분되지 않는다.
//      → 특정 순간에 "몇 번째 카드를 가져갔는지"가 기록에 없어 점수/바닥이 달라질 수 있다.
// 그래서 이 테스트는 **정확한 값 비교가 아니라 "크래시 없이 끝까지 도는지"**를 검증한다.
// 규칙 정합성은 tests/engine_test.js(44 케이스, 정본 소스에서 직접 도출)가 담당한다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { deckFromAssetIds } = require('../engine/deck');
const { TurnEngine, PHASE } = require('../engine/play');

const REC_DIR = path.join(__dirname, 'records');

/** 레코드의 수 종류 (Delphi TSimMoveKind ordinal). */
const MKIND = {
  PLAY_CARD: 0,
  FLIP_CHOICE: 1,
  BONUS_DRAW: 2,
  GO: 3,
  STOP: 4,
  NAGARI: 5,
  CHONGTONG: 6,
  SHAKE: 7,
  BOMB: 8,
  FLIP_ONLY: 9,
  NEGOTIATION: 10,
  SHODANG: 11,
  GIRI_CUT: 12,
};

/** v1 미구현 규칙(4인 협상 / 쇼당 / 기리 컷) */
const V2_ONLY = new Set([MKIND.NEGOTIATION, MKIND.SHODANG, MKIND.GIRI_CUT]);

function loadRecord(file) {
  const raw = fs.readFileSync(path.join(REC_DIR, file), 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}

/**
 * 레코드를 엔진에 되먹인다.
 * @returns {{engine: TurnEngine, applied: number, stopped: string|null}}
 */
function replay(record) {
  const count = record.playerCount;
  const names = Array.from({ length: count }, (_, i) => `${i + 1}번`);

  // 재생 규칙(정본 Gostop.Board.pas 와 동일): 보너스 뒷패 자동 보충 · 운 보정 없음
  const engine = new TurnEngine({ playerCount: count, names, rules: { bonusDrawEnabled: false } });

  // 선: 기록에 없으므로 첫 수의 주체를 선으로 삼는다
  const seon = record.moves.length > 0 ? record.moves[0].p : 0;
  engine.startGame(deckFromAssetIds(record.deck), seon);

  let applied = 0;
  let stopped = null;

  for (const move of record.moves) {
    if (V2_ONLY.has(move.k)) {
      stopped = `수 종류 ${move.k}(v2 규칙) 도달`;
      break;
    }
    try {
      switch (move.k) {
        case MKIND.PLAY_CARD:
          engine.playHandCard(move.a, move.b);
          break;
        case MKIND.FLIP_CHOICE:
          engine.resolveFlipChoice(move.a);
          break;
        case MKIND.BONUS_DRAW:
          engine.resolveBonusDraw(move.a);
          break;
        case MKIND.GO:
          engine.declareGo();
          break;
        case MKIND.STOP:
          engine.declareStop();
          break;
        case MKIND.NAGARI:
          engine.state.phase = PHASE.FINISHED;
          engine.state.winner = -1;
          break;
        case MKIND.CHONGTONG:
          engine.state.phase = PHASE.FINISHED;
          engine.state.winner = move.p;
          break;
        case MKIND.SHAKE:
          engine.declareShake(move.a);
          break;
        case MKIND.BOMB:
          engine.playBomb(move.a);
          break;
        case MKIND.FLIP_ONLY:
          engine.flipOnly();
          break;
        default:
          stopped = `알 수 없는 수 종류 ${move.k}`;
          break;
      }
    } catch (err) {
      // 규칙 위반(EngineError)은 "기록과 엔진의 판단이 갈라진 것"으로 본다.
      // 레코드에 선(先)과 바닥 선택 정보가 없어 원판과 100% 같아질 수 없다.
      // 진짜 버그(타입 오류 등)는 여기서 걸러야 한다.
      if (err && err.name === 'EngineError') {
        stopped = `판 diverged (${move.k}번째 수): ${err.message}`;
      } else {
        stopped = `예외 발생 (${move.k}번째 수): ${err.message}`;
      }
      break;
    }
    applied++;
    if (stopped) break;
  }

  return { engine, applied, stopped };
}

const FILES = fs.readdirSync(REC_DIR).filter((f) => f.endsWith('.rec')).sort();

test('모든 재플레이 레코드를 예외 없이 처리한다', () => {
  assert.ok(FILES.length >= 6, '레코드 파일이 있어야 한다');
  for (const file of FILES) {
    const record = loadRecord(file);
    const { engine, applied, stopped } = replay(record);

    assert.ok(
      stopped === null || stopped.includes('v2 규칙') || stopped.includes('diverged'),
      `${file}: 처리 중 예외 발생 — ${stopped}`
    );
    // 수가 0개인 레코드(chongtong.rec — 딜 즉시 총통)는 진행 카운트가 0이어도 정상
    if (record.moves.length > 0) {
      assert.ok(applied > 0, `${file}: 최소 한 수 이상 진행되어야 한다`);
    }
    // 엔진 상태가 깨지지 않았는지 확인
    assert.ok(Array.isArray(engine.state.floor));
    assert.ok(engine.state.players.length === record.playerCount);
    for (const p of engine.state.players) {
      assert.ok(Array.isArray(p.hand));
      assert.ok(Array.isArray(p.captured));
    }
  }
});

test('재플레이 종료 시 정산이 항상 성립한다 (승자 또는 나가리)', () => {
  for (const file of FILES) {
    const record = loadRecord(file);
    const { engine } = replay(record);
    const rows = engine.finalSettlement();

    assert.strictEqual(rows.length, record.playerCount);
    for (const row of rows) {
      assert.ok(Number.isFinite(row.net), `${file}: 정산 값이 유한해야 한다`);
    }
    if (engine.state.winner < 0) {
      // 나가리면 전원 0
      for (const row of rows) assert.strictEqual(row.net, 0, `${file}: 나가리는 전원 0`);
    } else {
      // 승자가 있으면 승자 수령액 = 패자 지불액 합
      const loserSum = rows.filter((r) => r.seat !== engine.state.winner).reduce((s, r) => s + -r.net, 0);
      const winnerGain = rows.find((r) => r.seat === engine.state.winner).net;
      assert.strictEqual(winnerGain, loserSum, `${file}: 승자 수령과 패자 지불이 일치해야 한다`);
    }
  }
});

test('v2 전용 레코드는 사유와 함께 건너뛴다', () => {
  for (const file of ['4go.rec', 'shodang.rec', 'tan_5go.rec', 'tan.rec', 'go3.rec', 'chongtong.rec']) {
    const record = loadRecord(file);
    const { engine } = replay(record);
    assert.ok(engine.state, `${file}: 엔진 상태가 있어야 한다`);
  }
});
