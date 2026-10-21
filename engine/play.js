'use strict';

// 턴 엔진 — 카드 내기 · 먹기 · 특수상황 · 고/스톱.
//
// 규칙 기준: docs/game-rules.md §3, §4, §5, §7
// 구현 근거: delphi/src/engine/Gostop.Engine.Play.pas (TTurnEngine)
//
// 이 엔진은 서버에서만 돌린다. 클라이언트는 "몇 번 카드를 낼지" 같은 의도만 보내고,
// 규칙 판정과 점수 계산은 전부 여기서 이뤄진다.

const { KIND, RIBBON, displayName } = require('./cards');
const { deal } = require('./deal');
const { evaluate, evaluateAsLoser, settle, DEFAULT_OPTIONS } = require('./score');

/** 엔진 단계. */
const PHASE = {
  PLAYING: 'playing',
  AWAITING_GO_STOP: 'awaitingGoStop',
  AWAITING_FLIP_CHOICE: 'awaitingFlipChoice',
  AWAITING_BONUS_DRAW: 'awaitingBonusDraw',
  AWAITING_FLOOR_CHOICE: 'awaitingFloorChoice',
  FINISHED: 'finished',
};

/** 이벤트 종류 (UI 이펙트·사운드 트리거로 쓰인다). */
const EVENT = {
  CAPTURE: 'capture',
  PLACE: 'place',
  BBEOK: 'bbeok',
  CHEOT_BBEOK: 'cheotBbeok',
  YEON_BBEOK: 'yeonBbeok',
  JAB_BBEOK: 'jabBbeok',
  PI_STEAL: 'piSteal',
  TTADAK: 'ttadak',
  JJOK: 'jjok',
  SSEUL: 'sseul',
  SHAKE: 'shake',
  BOMB: 'bomb',
  CHONGTONG: 'chongtong',
  GO: 'go',
  STOP: 'stop',
  GO_STOP_PROMPT: 'goStopPrompt',
  REVERSE_GO: 'reverseGo',
  TURN_PASS: 'turnPass',
  BONUS_CAPTURE: 'bonusCapture',
  FINISHED: 'finished',
};

/** 엔진 규칙 오류. */
class EngineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EngineError';
  }
}

function newPlayer(seat, name) {
  return {
    seat,
    name,
    hand: [],
    captured: [],
    goCount: 0,
    lastGoScore: 0,
    shakeCount: 0,
    bombCount: 0,
    bbeokCount: 0,
    reverseGo: false,
    cardDebt: 0,
    pendingShakeMonth: 0,
  };
}

class TurnEngine {
  /**
   * @param {object} opts
   * @param {number} opts.playerCount 2 또는 3
   * @param {string[]} opts.names 좌석 순서 이름
   * @param {object} [opts.options] 점수 규칙 (score.DEFAULT_OPTIONS 병합)
   * @param {object} [opts.rules] 엔진 동작 규칙
   */
  constructor({ playerCount, names, options = {}, rules = {} }) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.rules = {
      piStealPerEvent: 1, // 피 뺏기 1장씩
      flipChoiceEnabled: true, // 뒤집은 패 선택 UI
      bonusDrawEnabled: true, // 보너스패 뒷패 펼침 선택 UI
      enforceShakeMonth: true, // 흔들면 그 월을 내야 함
      ...rules,
    };

    this.state = {
      playerCount,
      players: Array.from({ length: playerCount }, (_, i) => newPlayer(i, names[i] || `${i + 1}번`)),
      current: 0,
      phase: PHASE.PLAYING,
      floor: [],
      stock: [],
      bbeokCreator: new Map(), // 월 → 뻑을 낸 사람(없으면 -1 = 딜에서 온 뻑 더미)
      playCount: 0,
      winner: -1,
      threeBbeok: false,
      events: [],
    };

    this.pendingBonus = []; // 이번 턴에 손에서 낸 보너스패 (뻑에 묻힘)
    this.flipBonus = []; // 이번 뒤집기에서 나온 보너스패 (뻑에 묻힘)
    this.pendingPlay = null; // 바닥 카드 선택 대기 중인 수
    this.flipCard = null; // 뒤집기 선택 대기 중인 카드
    this.flipOptions = [];
    this.flipHandMonth = 0;
    this.flipHandCaptured = false;
    this.flipHandPlaced = false;
  }

  // ── 유틸 ────────────────────────────────────────────────────────────────

  get currentPlayer() {
    return this.state.players[this.state.current];
  }

  addEvent(kind, seat, month, text, victimSeat = -1) {
    const evt = { kind, seat, month, text, victimSeat };
    this.state.events.push(evt);
    return evt;
  }

  /** 바닥에서 해당 월 카드들의 인덱스. */
  matchIndices(month) {
    const res = [];
    for (let i = 0; i < this.state.floor.length; i++) {
      if (this.state.floor[i].month === month) res.push(i);
    }
    return res;
  }

  /** 획득 우선순위: 광 > 열꽃 > 띠 > 피(쌍피>피). */
  captureRank(card) {
    switch (card.kind) {
      case KIND.BRIGHT: return 100;
      case KIND.ANIMAL: return 80;
      case KIND.RIBBON: return 60;
      case KIND.JUNK:
      case KIND.DOUBLE_JUNK:
      case KIND.BONUS: return 10 + card.junkValue;
      default: return 0;
    }
  }

  /**
   * 매칭된 바닥 카드를 획득더미로 옮긴다.
   * 3장 이상이면 전량, 뻑 더미면 전량, 2장이면 선택(없으면 가치가 높은 쪽).
   */
  captureInto(captured, indices, choice) {
    if (indices.length === 0) return;

    const month = this.state.floor[indices[0]].month;
    if (indices.length >= 3 || (indices.length >= 2 && this.state.bbeokCreator.has(month))) {
      // 높은 인덱스부터 지워야 남은 인덱스가 유효하다
      for (let k = indices.length - 1; k >= 0; k--) {
        captured.push(this.state.floor[indices[k]]);
        this.state.floor.splice(indices[k], 1);
      }
      return;
    }

    let pick = 0;
    if (indices.length === 2) {
      if (Number.isInteger(choice) && choice >= 0 && choice < 2) {
        pick = choice;
      } else {
        // 자동: 가치가 높은 카드를 가져간다
        pick = this.captureRank(this.state.floor[indices[1]]) > this.captureRank(this.state.floor[indices[0]]) ? 1 : 0;
      }
    }
    const idx = indices[pick];
    captured.push(this.state.floor[idx]);
    this.state.floor.splice(idx, 1);
  }

  /** 바닥에서 카드 한 장 제거 (uid 기준). */
  removeFloorByUid(uid) {
    const i = this.state.floor.findIndex((c) => c.uid === uid);
    if (i >= 0) this.state.floor.splice(i, 1);
  }

  /** 바닥의 월별 장수. */
  countFloorMonths() {
    const counts = new Array(13).fill(0);
    for (const card of this.state.floor) {
      if (card.month >= 1 && card.month <= 12) counts[card.month]++;
    }
    return counts;
  }

  // ── 피 뺏기 ────────────────────────────────────────────────────────────

  /**
   * 패자에게서 낼 피 1장을 뺏는다.
   * 낼 일반 피가 하나도 없으면 국진도 넘기지 않고, 대신 그 국진이 열꽃 고정(전환권 상실)된다.
   */
  stealOnePi(winnerSeat, victimSeat) {
    if (winnerSeat === victimSeat) return false;

    const victim = this.state.players[victimSeat];
    let bestIdx = -1;
    let bestValue = Infinity;
    for (let i = 0; i < victim.captured.length; i++) {
      const card = victim.captured[i];
      if (card.kind === KIND.JUNK || card.kind === KIND.DOUBLE_JUNK || card.kind === KIND.BONUS) {
        if (card.junkValue < bestValue) {
          bestValue = card.junkValue;
          bestIdx = i;
        }
      }
    }

    if (bestIdx < 0) {
      const gi = victim.captured.findIndex((c) => c.gukjin && !c.locked);
      if (gi >= 0) {
        victim.captured[gi].locked = true;
        this.addEvent(
          EVENT.PI_STEAL,
          winnerSeat,
          0,
          `${victim.name}: 낼 피가 없어 국진이 열꽃 고정(쌍피 전환 불가)`,
          victimSeat
        );
      }
      return false;
    }

    const winner = this.state.players[winnerSeat];
    const pi = victim.captured.splice(bestIdx, 1)[0];
    winner.captured.push(pi);
    this.addEvent(EVENT.PI_STEAL, winnerSeat, 0, `${winner.name} ← ${victim.name} 피 1장`, victimSeat);
    return true;
  }

  /** 상대 전원에게서 피를 뺏는다. */
  stealPiFromOthers(winnerSeat) {
    for (let p = 0; p < this.state.playerCount; p++) {
      for (let k = 0; k < this.rules.piStealPerEvent; k++) {
        if (!this.stealOnePi(winnerSeat, p)) break;
      }
    }
  }

  /** 뻑 더미를 회수했을 때의 처리 (자뻑 2장 / 남의 뻑 1장). */
  resolveBbeokCapture(month) {
    if (!this.state.bbeokCreator.has(month)) return;
    const creator = this.state.bbeokCreator.get(month);
    this.state.bbeokCreator.delete(month);

    const current = this.state.current;
    const name = this.currentPlayer.name;

    if (creator === current) {
      this.addEvent(EVENT.JAB_BBEOK, current, month, `${name} 자뻑! (${month}월)`);
      this.stealPiFromOthers(current);
      this.stealPiFromOthers(current);
    } else {
      this.addEvent(EVENT.PI_STEAL, current, month, `${name} 뻑 회수 (${month}월)`);
      this.stealPiFromOthers(current);
    }
  }

  /** 바닥 같은 월 3장을 한 번에 먹었을 때의 피 처리. */
  resolveThreePileSteal(month) {
    if (this.state.bbeokCreator.has(month)) {
      this.resolveBbeokCapture(month);
    } else {
      this.addEvent(
        EVENT.PI_STEAL,
        this.state.current,
        month,
        `${this.currentPlayer.name} 바닥 ${month}월 3장 쓸어먹기 — 피 받기`
      );
      this.stealPiFromOthers(this.state.current);
    }
  }

  // ── 더미 ────────────────────────────────────────────────────────────────

  /**
   * 뒷패에서 1장 뒤집는다. 보너스패면 즉시 획득하고 한 장 더 뒤집는다.
   * @returns {object|null} 뒤집힌 일반 카드
   */
  drawNonBonus(player) {
    this.flipBonus = [];
    while (this.state.stock.length > 0) {
      const top = this.state.stock.pop();
      if (top.kind === KIND.BONUS) {
        player.captured.push(top);
        this.flipBonus.push(top);
        this.addEvent(EVENT.BONUS_CAPTURE, this.state.current, 0, `${player.name} 보너스패 획득(뒤집기)`);
        continue;
      }
      return top;
    }
    return null;
  }

  /** 카드빚을 낼 때 '뒤집기만' 수행. */
  flipStockAndResolve(player) {
    const draw = this.drawNonBonus(player);
    if (!draw) return false;

    const captured = [];
    const matches = this.matchIndices(draw.month);
    if (matches.length === 0) {
      this.state.floor.push(draw);
    } else {
      captured.push(draw);
      this.captureInto(captured, matches, -1);
      if (matches.length >= 3 || this.state.bbeokCreator.has(draw.month)) {
        this.resolveThreePileSteal(draw.month);
      }
    }

    if (captured.length > 0) {
      player.captured.push(...captured);
      this.addEvent(EVENT.CAPTURE, this.state.current, draw.month, `${player.name} 뒤집어 ${captured.length}장 먹음`);
    } else {
      this.addEvent(EVENT.PLACE, this.state.current, draw.month, `${player.name} 뒤집은 카드 바닥에 놓음`);
    }

    if (this.state.floor.length === 0 && captured.length > 0 && this.hasMoreToPlay(player)) {
      this.addEvent(EVENT.SSEUL, this.state.current, draw.month, `${player.name} 싹쓸이!`);
      this.stealPiFromOthers(this.state.current);
    }

    return captured.length > 0;
  }

  // ── 진행 ────────────────────────────────────────────────────────────────

  /** 더 둘 게 남았는지 (손패가 있거나 카드빚이 남았고 뒷패가 있으면). */
  hasMoreToPlay(player) {
    return player.hand.length > 0 || (player.cardDebt > 0 && this.state.stock.length > 0);
  }

  canAct(seat) {
    return this.hasMoreToPlay(this.state.players[seat]);
  }

  /** 턴을 넘긴다. 아무도 둘 수 없으면 나가리. */
  advanceTurn() {
    this.pendingBonus = [];
    this.flipBonus = [];

    let anyActive = false;
    for (let p = 0; p < this.state.playerCount; p++) {
      if (this.canAct(p)) {
        anyActive = true;
        break;
      }
    }

    if (!anyActive) {
      this.state.phase = PHASE.FINISHED;
      this.state.winner = -1;
      this.addEvent(EVENT.FINISHED, -1, 0, '나가리(손패 소진)');
      return;
    }

    do {
      this.state.current = (this.state.current + 1) % this.state.playerCount;
    } while (!this.canAct(this.state.current));

    this.state.phase = PHASE.PLAYING;
    this.addEvent(EVENT.TURN_PASS, this.state.current, 0, `${this.currentPlayer.name} 차례`);
  }

  /**
   * 판 시작 — 딜을 하고 딜 직후 규칙(총통·보너스·뻑 더미)을 적용한다.
   * @param {Array} deckCards 카드 카탈로그 배열 (마지막 = 맨 위). 소비된다.
   * @param {number} seonIndex 선(先) 자리
   */
  startGame(deckCards, seonIndex) {
    const result = deal(deckCards, this.state.playerCount, seonIndex);
    for (let i = 0; i < this.state.playerCount; i++) {
      this.state.players[i].hand = result.hands[i];
    }
    this.state.floor = result.floor;
    this.state.stock = result.stock;
    this.state.current = seonIndex;
    this.state.phase = PHASE.PLAYING;

    this.applyFloorBonus();
    if (!this.applyFloorChongtong()) {
      this.applyHandChongtong();
      this.applyFloorBbeok();
    }
  }

  /** 딜 직후 바닥의 보너스패는 선이 획득하고, 뒷패에서 일반패로 보충한다. */
  applyFloorBonus() {
    if (this.state.phase !== PHASE.PLAYING || this.state.playCount > 0) return;

    let i = 0;
    while (i < this.state.floor.length) {
      const card = this.state.floor[i];
      if (card.kind === KIND.BONUS) {
        this.state.floor.splice(i, 1);
        this.currentPlayer.captured.push(card);
        this.addEvent(EVENT.BONUS_CAPTURE, this.state.current, 0, `${this.currentPlayer.name} 바닥 보너스패 획득(선)`);

        const fill = this.drawNonBonus(this.currentPlayer);
        if (fill) this.state.floor.splice(i, 0, fill);
        // 보충 중 또 보너스가 나오면 그것도 선이 획득 (반복)
      } else {
        i++;
      }
    }
  }

  /** 딜 직후 바닥에 같은 월 4장이 깔려 있으면 선이 즉시 승리. */
  applyFloorChongtong() {
    if (this.state.phase !== PHASE.PLAYING || this.state.playCount > 0) return false;

    const counts = this.countFloorMonths();
    for (let m = 1; m <= 12; m++) {
      if (counts[m] >= 4) {
        this.state.phase = PHASE.FINISHED;
        this.state.winner = this.state.current;
        this.addEvent(EVENT.CHONGTONG, this.state.current, m, `바닥에 ${m}월 4장 총통! ${this.currentPlayer.name}(선) 즉시 승리`);
        return true;
      }
    }
    return false;
  }

  /** 딜 직후 바닥에 같은 월 3장이 있으면 뻑 더미로 등록(창조자 없음). */
  applyFloorBbeok() {
    if (this.state.phase !== PHASE.PLAYING || this.state.playCount > 0) return;

    const counts = this.countFloorMonths();
    for (let m = 1; m <= 12; m++) {
      if (counts[m] === 3 && !this.state.bbeokCreator.has(m)) {
        this.state.bbeokCreator.set(m, -1);
        this.addEvent(EVENT.BBEOK, -1, m, `바닥에 ${m}월 3장이 겹쳐 뻑으로 쌓임`);
      }
    }
  }

  /** 딜 직후 손패에 같은 월 4장이 있으면 그 사람이 즉시 승리. */
  applyHandChongtong() {
    if (this.state.phase !== PHASE.PLAYING) return false;

    for (let p = 0; p < this.state.playerCount; p++) {
      const month = this.chongtongMonth(p);
      if (month > 0) {
        this.state.phase = PHASE.FINISHED;
        this.state.winner = p;
        this.addEvent(EVENT.CHONGTONG, p, month, `${this.state.players[p].name} 총통! (${month}월 4장) — 즉시 승리`);
        return true;
      }
    }
    return false;
  }

  /** 해당 자리의 손패에 같은 월 4장이 있는지. 0 이면 없음. */
  chongtongMonth(seat) {
    const counts = new Array(13).fill(0);
    for (const card of this.state.players[seat].hand) {
      if (card.month >= 1 && card.month <= 12) counts[card.month]++;
    }
    for (let m = 1; m <= 12; m++) {
      if (counts[m] >= 4) return m;
    }
    return 0;
  }

  // ── 수 두기 ────────────────────────────────────────────────────────────

  /**
   * 손패에서 1장을 낸다.
   * @param {number} handIndex 손패 인덱스
   * @param {number|null} floorChoice 바닥 2장 중 가져갈 카드 (0/1). null 이면 필요 시 선택 대기.
   */
  playHandCard(handIndex, floorChoice = null) {
    if (this.state.phase !== PHASE.PLAYING) {
      throw new EngineError('지금은 손패를 낼 단계가 아닙니다.');
    }

    const player = this.currentPlayer;
    if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= player.hand.length) {
      throw new EngineError(`손패 인덱스 오류: ${handIndex} (손패 ${player.hand.length}장)`);
    }

    const handCard = player.hand[handIndex];

    // 흔들기 커밋: 흔든 월의 카드를 내야 한다
    if (
      this.rules.enforceShakeMonth &&
      player.pendingShakeMonth !== 0 &&
      handCard.kind !== KIND.BONUS &&
      handCard.month !== player.pendingShakeMonth
    ) {
      throw new EngineError(`${player.pendingShakeMonth}월을 흔들었으므로 그 월의 카드를 내야 합니다.`);
    }

    const handMatches = this.matchIndices(handCard.month);
    if (floorChoice === null && this.needsFloorChoice(handMatches)) {
      // 바닥에 같은 월 2장인데 종류가 다르면 고를 수 있게 대기
      this.pendingPlay = { seat: player.seat, handIndex, handCard, handMatches };
      this.state.phase = PHASE.AWAITING_FLOOR_CHOICE;
      return {
        awaiting: 'floorChoice',
        options: handMatches.map((i) => this.describeCard(this.state.floor[i])),
      };
    }

    return this.applyPlay(handIndex, floorChoice === null ? -1 : floorChoice);
  }

  /** 바닥 2장 중 종류가 다르면 선택이 필요하다. */
  needsFloorChoice(indices) {
    if (indices.length !== 2) return false;
    const a = this.state.floor[indices[0]];
    const b = this.state.floor[indices[1]];
    return a.kind !== b.kind;
  }

  /** 바닥 카드 선택을 확정하고 수를 계속 진행한다. */
  resolveFloorChoice(choice) {
    if (this.state.phase !== PHASE.AWAITING_FLOOR_CHOICE) {
      throw new EngineError('바닥 카드 선택 대기 단계가 아닙니다.');
    }
    const pending = this.pendingPlay;
    this.pendingPlay = null;
    this.state.phase = PHASE.PLAYING;
    if (!pending) throw new EngineError('선택할 수가 없습니다.');
    return this.applyPlay(pending.handIndex, choice);
  }

  /** 손패를 낸 뒤의 실제 처리. */
  applyPlay(handIndex, floorChoice) {
    const player = this.currentPlayer;
    const handCard = player.hand[handIndex];
    const wasPendingShake = player.pendingShakeMonth !== 0;

    let monthInHand = 0;
    for (const card of player.hand) {
      if (card.month === handCard.month) monthInHand++;
    }

    player.hand.splice(handIndex, 1);
    const month = handCard.month;
    const handMatches = this.matchIndices(month);

    // 자동 흔들기: 같은 월 3장 보유 + 바닥에 그 월 없음 → 흔들기 성립
    if (!wasPendingShake && handCard.kind !== KIND.BONUS && monthInHand >= 3 && handMatches.length === 0) {
      player.shakeCount++;
      this.addEvent(EVENT.SHAKE, this.state.current, month, `${player.name} 흔들기! (${month}월)`);
    }

    // 보너스패를 손에서 내면 즉시 획득 + 보충 + 같은 차례에 실제 패를 한 번 더 낸다
    if (handCard.kind === KIND.BONUS) {
      player.captured.push(handCard);
      this.pendingBonus.push(handCard);
      this.addEvent(EVENT.BONUS_CAPTURE, this.state.current, 0, `${player.name} 보너스패 획득`);

      if (this.rules.bonusDrawEnabled && this.state.stock.length > 0) {
        this.state.phase = PHASE.AWAITING_BONUS_DRAW;
        return { awaiting: 'bonusDraw' };
      }

      const refill = this.drawNonBonus(player);
      if (refill) player.hand.push(refill);
      return { awaiting: null };
    }

    player.pendingShakeMonth = 0;
    const firstPlay = this.state.playCount === 0;
    this.state.playCount++;

    const draw = this.drawNonBonus(player);
    const hasDraw = draw !== null;

    // 뻑: 손패가 바닥 1장과 매칭인데 뒤집은 것도 같은 월 → 3장이 바닥에 쌓이고 아무도 못 먹음
    if (hasDraw && handMatches.length === 1 && draw.month === month) {
      this.state.floor.push(handCard);
      this.state.floor.push(draw);
      this.addEvent(EVENT.BBEOK, this.state.current, month, `${player.name} 뻑! (${month}월)`);

      // 이번 턴에 획득한 보너스패는 뻑 무더기에 함께 묻힌다
      const bury = this.pendingBonus.concat(this.flipBonus);
      if (bury.length > 0) {
        for (const bonus of bury) {
          const idx = player.captured.findIndex((c) => c.uid === bonus.uid);
          if (idx >= 0) player.captured.splice(idx, 1);
          this.state.floor.push({ ...bonus, month });
        }
        this.addEvent(EVENT.PLACE, this.state.current, month, `${player.name} 보너스패도 뻑 더미에 묻힘`);
        this.pendingBonus = [];
        this.flipBonus = [];
      }

      if (player.bbeokCount === 1) {
        this.addEvent(EVENT.YEON_BBEOK, this.state.current, month, `${player.name} 연뻑!`);
      }
      if (firstPlay) {
        this.addEvent(EVENT.CHEOT_BBEOK, this.state.current, month, `${player.name} 첫뻑!`);
      }

      this.state.bbeokCreator.set(month, this.state.current);
      player.bbeokCount++;

      if (player.bbeokCount >= 3) {
        this.state.threeBbeok = true;
        this.state.winner = this.state.current;
        this.state.phase = PHASE.FINISHED;
        this.addEvent(EVENT.BBEOK, this.state.current, month, `${player.name} 쓰리뻑! 즉시 승리`);
        return { awaiting: null };
      }

      this.advanceTurn();
      return { awaiting: null };
    }

    // ── 손패 처리 ──
    const captured = [];
    let playedCaptured = false;

    if (handMatches.length === 0) {
      this.state.floor.push(handCard);
    } else {
      playedCaptured = true;
      captured.push(handCard);
      this.captureInto(captured, handMatches, floorChoice);
      if (handMatches.length >= 3 || this.state.bbeokCreator.has(month)) {
        this.resolveThreePileSteal(month);
      }
    }

    // ── 뒷패 카드 처리 ──
    let ttadak = false;
    let jjok = false;

    if (hasDraw) {
      const drawMatches = this.matchIndices(draw.month);
      if (drawMatches.length === 0) {
        this.state.floor.push(draw);
      } else if (
        this.rules.flipChoiceEnabled &&
        drawMatches.length === 2 &&
        this.state.floor[drawMatches[0]].kind !== this.state.floor[drawMatches[1]].kind &&
        !this.state.bbeokCreator.has(draw.month)
      ) {
        // 뒤집은 패가 바닥 2장(서로 다른 종류)과 매칭 → 가져갈 패 선택 대기
        if (captured.length > 0) {
          player.captured.push(...captured);
          this.addEvent(EVENT.CAPTURE, this.state.current, month, `${player.name} ${captured.length}장 먹음`);
          captured.length = 0;
        }

        this.flipCard = draw;
        this.flipOptions = [this.state.floor[drawMatches[0]], this.state.floor[drawMatches[1]]];
        this.flipHandMonth = month;
        this.flipHandCaptured = playedCaptured;
        this.flipHandPlaced = handMatches.length === 0;
        this.state.floor.push(draw);
        this.state.phase = PHASE.AWAITING_FLIP_CHOICE;
        return {
          awaiting: 'flipChoice',
          options: this.flipOptions.map((c) => this.describeCard(c)),
        };
      } else {
        captured.push(draw);
        this.captureInto(captured, drawMatches, -1);
        if (drawMatches.length >= 3 || this.state.bbeokCreator.has(draw.month)) {
          this.resolveThreePileSteal(draw.month);
        }

        if (playedCaptured && draw.month === month) {
          ttadak = true; // 손패로 먹고 뒤집은 것도 같은 월 → 따닥
        } else if (handMatches.length === 0 && draw.month === month) {
          jjok = true; // 손패를 빈 바닥에 놓고 뒤집은 카드가 그 카드를 먹음 → 쪽
        }
      }
    }

    if (captured.length > 0) {
      player.captured.push(...captured);
      this.addEvent(EVENT.CAPTURE, this.state.current, month, `${player.name} ${captured.length}장 먹음`);
    } else {
      this.addEvent(EVENT.PLACE, this.state.current, month, `${player.name} 못 먹고 바닥에 놓음`);
    }

    // 마지막 장(더 둘 게 없음)에서는 쪽·따닥·싹쓸이를 인정하지 않는다.
    // 단 폭탄 카드빚이 남아 뒤집기를 더 해야 하면 마지막 장이 아니므로 인정한다.
    const notLast = this.hasMoreToPlay(player);
    const sseul = this.state.floor.length === 0 && captured.length > 0 && notLast;

    if (ttadak && notLast) {
      this.addEvent(EVENT.TTADAK, this.state.current, month, `${player.name} 따닥!`);
      this.stealPiFromOthers(this.state.current);
    }
    if (jjok && notLast) {
      this.addEvent(EVENT.JJOK, this.state.current, month, `${player.name} 쪽!`);
      this.stealPiFromOthers(this.state.current);
    }
    if (sseul) {
      this.addEvent(EVENT.SSEUL, this.state.current, month, `${player.name} 싹쓸이!`);
      this.stealPiFromOthers(this.state.current);
    }

    this.scoreAndFinish(player);
    return { awaiting: null };
  }

  /** 뒤집은 패와 짝을 고른다. */
  resolveFlipChoice(ordinal) {
    if (this.state.phase !== PHASE.AWAITING_FLIP_CHOICE) {
      throw new EngineError('뒤집기 선택 대기 단계가 아닙니다.');
    }
    if (ordinal !== 0 && ordinal !== 1) {
      throw new EngineError(`뒤집기 선택지는 0/1 이어야 합니다(${ordinal}).`);
    }

    const player = this.currentPlayer;
    const chosen = this.flipOptions[ordinal];

    this.removeFloorByUid(this.flipCard.uid);
    this.removeFloorByUid(chosen.uid);
    player.captured.push(this.flipCard, chosen);
    this.addEvent(EVENT.CAPTURE, this.state.current, this.flipCard.month, `${player.name} 뒤집어 2장 먹음`);

    const notLast = this.hasMoreToPlay(player);
    if (notLast && this.flipHandCaptured && this.flipCard.month === this.flipHandMonth) {
      this.addEvent(EVENT.TTADAK, this.state.current, this.flipCard.month, `${player.name} 따닥!`);
      this.stealPiFromOthers(this.state.current);
    } else if (notLast && this.flipHandPlaced && this.flipCard.month === this.flipHandMonth) {
      this.addEvent(EVENT.JJOK, this.state.current, this.flipCard.month, `${player.name} 쪽!`);
      this.stealPiFromOthers(this.state.current);
    }

    if (this.state.floor.length === 0 && notLast) {
      this.addEvent(EVENT.SSEUL, this.state.current, this.flipCard.month, `${player.name} 싹쓸이!`);
      this.stealPiFromOthers(this.state.current);
    }

    this.flipCard = null;
    this.flipOptions = [];
    this.flipHandMonth = 0;
    this.flipHandCaptured = false;
    this.flipHandPlaced = false;

    this.scoreAndFinish(player);
    return { awaiting: null };
  }

  /** 보너스패를 낸 뒤 뒷패에서 보충할 1장을 고른다. */
  resolveBonusDraw(stockIndex) {
    if (this.state.phase !== PHASE.AWAITING_BONUS_DRAW) {
      throw new EngineError('보너스 뽑기 대기 단계가 아닙니다.');
    }
    if (!Number.isInteger(stockIndex) || stockIndex < 0 || stockIndex >= this.state.stock.length) {
      throw new EngineError(`뒷패 범위를 벗어난 선택입니다(${stockIndex}).`);
    }

    const player = this.currentPlayer;
    const card = this.state.stock.splice(stockIndex, 1)[0];

    if (card.kind === KIND.BONUS) {
      player.captured.push(card);
      this.addEvent(EVENT.BONUS_CAPTURE, this.state.current, 0, `${player.name} 보너스패 획득(뒷패)`);
      if (this.state.stock.length > 0) {
        return { awaiting: 'bonusDraw' }; // 다시 고르기
      }
      this.state.phase = PHASE.PLAYING;
      return { awaiting: null };
    }

    player.hand.push(card);
    this.state.phase = PHASE.PLAYING; // 같은 차례 계속 (실제 패를 냄)
    return { awaiting: null };
  }

  // ── 고 / 스톱 ───────────────────────────────────────────────────────────

  /** 점수를 계산해 고/스톱을 물을지 판단한다. */
  scoreAndFinish(player) {
    const minScore = this.state.playerCount === 2 ? 7 : 3;
    const score = this.scoreOf(player.seat);

    if (score.total >= minScore && score.total > player.lastGoScore) {
      // 마지막 장이면 고/스톱 선택이 무의미하므로 즉시 스톱(승리) 확정
      if (!this.hasMoreToPlay(player)) {
        this.state.phase = PHASE.FINISHED;
        this.state.winner = this.state.current;
        this.addEvent(EVENT.STOP, this.state.current, 0, `${player.name} ${score.total}점 — 마지막 장, 자동 스톱! 승리`);
        return false;
      }

      this.state.phase = PHASE.AWAITING_GO_STOP;
      this.addEvent(EVENT.GO_STOP_PROMPT, this.state.current, 0, `${player.name} ${score.total}점 — 고/스톱 선택`);
      return true;
    }

    this.advanceTurn();
    return false;
  }

  /** 고 — 게임을 계속한다. */
  declareGo() {
    if (this.state.phase !== PHASE.AWAITING_GO_STOP) {
      throw new EngineError('고/스톱 대기 단계가 아닙니다.');
    }

    const player = this.currentPlayer;

    // 역고: 이미 고를 부른 상대가 있는데 내가 또 고를 부른 상황. 한 번 성립하면 유지된다.
    if (!player.reverseGo) {
      for (let p = 0; p < this.state.playerCount; p++) {
        if (p !== this.state.current && this.state.players[p].goCount > 0) {
          player.reverseGo = true;
          break;
        }
      }
    }

    player.goCount++;
    player.lastGoScore = this.scoreOf(this.state.current).total;

    if (player.reverseGo) {
      this.addEvent(EVENT.REVERSE_GO, this.state.current, 0, `${player.name} 역고! (${player.goCount}고)`);
    } else {
      this.addEvent(EVENT.GO, this.state.current, 0, `${player.name} ${player.goCount}고!`);
    }

    this.advanceTurn();
  }

  /** 스톱 — 즉시 승리. */
  declareStop() {
    if (this.state.phase !== PHASE.AWAITING_GO_STOP) {
      throw new EngineError('고/스톱 대기 단계가 아닙니다.');
    }
    this.state.phase = PHASE.FINISHED;
    this.state.winner = this.state.current;
    this.addEvent(EVENT.STOP, this.state.current, 0, `${this.currentPlayer.name} 스톱! 승리`);
  }

  // ── 흔들기 / 폭탄 / 카드빚 ──────────────────────────────────────────────

  /** 흔들 수 있는 월인지 (손패에 3장 이상). */
  canShake(month) {
    return this.currentPlayer.hand.filter((c) => c.month === month).length >= 3;
  }

  /** 흔들기 선언 — 그 월을 내야 성립한다. */
  declareShake(month) {
    if (this.state.phase !== PHASE.PLAYING) {
      throw new EngineError('지금은 흔들 수 있는 단계가 아닙니다.');
    }
    if (!this.canShake(month)) {
      throw new EngineError(`${month}월 3장을 들고 있지 않아 흔들 수 없습니다.`);
    }

    const player = this.currentPlayer;
    if (player.pendingShakeMonth !== 0) {
      throw new EngineError('이미 흔들기를 선언했습니다(중복 선언으로 배수를 불릴 수 없음).');
    }

    player.shakeCount++;
    player.pendingShakeMonth = month;
    this.addEvent(EVENT.SHAKE, this.state.current, month, `${player.name} 흔들기! (${month}월)`);
  }

  /** 폭탄 가능한지 (손패 3장 + 바닥에 같은 월). */
  canBomb(month) {
    if (!this.canShake(month)) return false;
    return this.matchIndices(month).length >= 1;
  }

  /** 폭탄 — 손패 3장 + 바닥 같은 월을 한꺼번에 먹는다. */
  playBomb(month) {
    if (this.state.phase !== PHASE.PLAYING) {
      throw new EngineError('지금은 폭탄을 칠 단계가 아닙니다.');
    }
    if (!this.canBomb(month)) {
      throw new EngineError(`폭탄 조건 미충족: ${month}월 손패 3장 + 바닥 같은 월이 필요합니다.`);
    }

    this.state.playCount++;

    const player = this.currentPlayer;
    const captured = [];

    let taken = 0;
    for (let i = player.hand.length - 1; i >= 0 && taken < 3; i--) {
      if (player.hand[i].month === month) {
        captured.push(player.hand[i]);
        player.hand.splice(i, 1);
        taken++;
      }
    }

    // 바닥의 같은 월은 전부 획득 (선택 없이)
    const floorIdx = this.matchIndices(month);
    for (let k = floorIdx.length - 1; k >= 0; k--) {
      captured.push(this.state.floor[floorIdx[k]]);
      this.state.floor.splice(floorIdx[k], 1);
    }

    player.captured.push(...captured);
    this.addEvent(EVENT.BOMB, this.state.current, month, `${player.name} 폭탄! (${month}월)`);

    player.shakeCount++;
    player.bombCount++;
    this.stealPiFromOthers(this.state.current);

    // 카드빚: 일반 턴(1장) 대비 여분(낸 장수 - 1)장 → 이후 '뒤집기만' 턴으로 갚는다
    player.cardDebt += taken - 1;

    this.flipStockAndResolve(player);
    this.scoreAndFinish(player);
    return { awaiting: null };
  }

  /** 카드빚을 갚는 '뒤집기만' 턴. */
  flipOnly() {
    if (this.state.phase !== PHASE.PLAYING) {
      throw new EngineError('지금은 뒤집기만 할 단계가 아닙니다.');
    }

    const player = this.currentPlayer;
    if (player.cardDebt <= 0) {
      throw new EngineError('갚을 카드빚이 없어 뒤집기만 할 수 없습니다.');
    }

    player.cardDebt--;
    this.addEvent(EVENT.TURN_PASS, this.state.current, 0, `${player.name} 뒤집기만(카드빚 갚기, ${player.cardDebt} 남음)`);
    this.flipStockAndResolve(player);
    this.scoreAndFinish(player);
    return { awaiting: null };
  }

  // ── 점수 / 정산 ─────────────────────────────────────────────────────────

  /** 해당 자리의 족보 내역. */
  scoreOf(seat) {
    return evaluate(this.state.players[seat].captured, this.options);
  }

  /**
   * 최종 정산.
   * @returns {Array} 자리별 { seat, net, pibak, gwangbak, meongbak, gobak, ... }
   */
  finalSettlement() {
    const count = this.state.playerCount;
    const results = this.state.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      net: 0,
      pibak: false,
      gwangbak: false,
      meongbak: false,
      gobak: false,
      paymentExempt: false,
      points: 0,
      goBonus: 0,
      shakeMultiplier: 1,
      bakMultiplier: 1,
      steps: [],
      goCount: 0,
      goMultiplier: 1,
      shakeCount: 0,
      bombCount: 0,
      reverseGo: false,
    }));

    // 나가리 또는 미종료 → 전원 0
    if (this.state.winner < 0) return results;

    const winner = this.state.winner;

    // 쓰리뻑·총통 즉시 승리: 고정 점수(2인 7점 / 3인+ 3점), 박·고 배수 미적용
    let instantWin = this.state.threeBbeok;
    if (!instantWin) {
      for (const evt of this.state.events) {
        if (evt.kind === EVENT.CHONGTONG) {
          instantWin = true;
          break;
        }
      }
    }

    if (instantWin) {
      const fixed = count === 2 ? 7 : 3;
      let total = 0;
      for (let p = 0; p < count; p++) {
        if (p !== winner) {
          results[p].net = -fixed;
          total += fixed;
        }
      }
      results[winner].net = total;
      return results;
    }

    const winnerPlayer = this.state.players[winner];
    const winBreak = this.scoreOf(winner);

    // 피박 기준은 인원수에 따라 다르다: 2인(맞고) ≤7, 3인 이상 ≤5
    const scoreOpt = { ...this.options };
    scoreOpt.pibakMaxJunk = count >= 3 ? 5 : 7;

    let totalToWinner = 0;
    let gobakLoser = -1;

    for (let p = 0; p < count; p++) {
      if (p === winner) continue;

      const loserBreak = evaluateAsLoser(this.state.players[p].captured, scoreOpt);
      const s = settle(winBreak, loserBreak, winnerPlayer.goCount, winnerPlayer.shakeCount, scoreOpt, winnerPlayer.reverseGo);

      // 패자가 한 장도 획득하지 못하면 점수는 유지하되 지급은 면제한다.
      const paymentExempt = this.state.players[p].captured.length === 0;

      results[p].net = paymentExempt ? 0 : -s.points;
      results[p].paymentExempt = paymentExempt;
      results[p].points = s.points;
      results[p].goBonus = s.goBonus;
      results[p].shakeMultiplier = s.shakeMultiplier;
      results[p].bakMultiplier = s.bakMultiplier;
      results[p].steps = s.steps;
      results[p].pibak = s.pibak;
      results[p].gwangbak = s.gwangbak;
      results[p].meongbak = s.meongbak;
      results[p].goCount = winnerPlayer.goCount;
      results[p].goMultiplier = s.goMultiplier;
      results[p].shakeCount = winnerPlayer.shakeCount;
      results[p].bombCount = winnerPlayer.bombCount;
      results[p].reverseGo = s.reverseGo;

      totalToWinner += paymentExempt ? 0 : s.points;

      if (this.state.players[p].goCount > 0) gobakLoser = p;
    }

    // 고박: 고를 부르고 진 사람이 있으면 그 사람이 전액(다른 패자 몫까지)을 ×2로 부담
    if (gobakLoser >= 0) {
      for (let p = 0; p < count; p++) {
        if (p !== winner) results[p].net = 0;
      }
      const gobakTotal = totalToWinner * this.options.gobakMultiplier;
      results[gobakLoser].net = -gobakTotal;
      results[gobakLoser].gobak = true;
      totalToWinner = gobakTotal;
    }

    results[winner].net = totalToWinner;
    results[winner].reverseGo = winnerPlayer.reverseGo;
    results[winner].shakeCount = winnerPlayer.shakeCount;
    results[winner].bombCount = winnerPlayer.bombCount;

    return results;
  }

  // ── 직렬화 ──────────────────────────────────────────────────────────────

  /** UI/전송용 카드 정보. */
  describeCard(card) {
    return {
      uid: card.uid,
      id: card.id,
      month: card.month,
      kind: card.kind,
      name: displayName(card),
      junkValue: card.junkValue,
      ribbon: card.ribbon,
    };
  }

  /** 전체 상태를 직렬화 (handPrivate 는 각자만 볼 부분). */
  toJSON(viewerSeat = -1) {
    return {
      phase: this.state.phase,
      current: this.state.current,
      winner: this.state.winner,
      playCount: this.state.playCount,
      deckCount: this.state.stock.length,
      floor: this.state.floor.map((c) => this.describeCard(c)),
      players: this.state.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        handCount: p.hand.length,
        cardDebt: p.cardDebt,
        goCount: p.goCount,
        shakeCount: p.shakeCount,
        bombCount: p.bombCount,
        reverseGo: p.reverseGo,
        capturedCount: p.captured.length,
        score: this.scoreOf(p.seat).total,
      })),
      myHand: viewerSeat >= 0 ? this.state.players[viewerSeat].hand.map((c) => this.describeCard(c)) : [],
    };
  }
}

module.exports = {
  TurnEngine,
  EngineError,
  PHASE,
  EVENT,
  newPlayer,
};
