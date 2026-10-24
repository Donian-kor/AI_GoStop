'use strict';

// 방(Room) — 한 판 고스톱을 진행하는 단위.
//
// 서버 권위 모델: 덱 섞기·딜·규칙 판정·점수 계산은 전부 여기(엔진)에서 한다.
// 클라이언트는 "몇 번 카드를 낼지" 같은 의도만 보내고, 상태는 폴링으로 내려받는다.
//
// 자리(seat)는 사람이든 AI든 같은 자리에 앉는다.
//   mode = 'multi' → 전원 사람
//   mode = 'solo'  → 0번 자리는 사람, 나머지는 AI (혼자 치기 / 2인 맞고)

const { TurnEngine, EngineError, PHASE, EVENT } = require('../engine/play');
const { displayName } = require('../engine/cards');
const { shuffledDeck, shuffle } = require('../engine/deck');
const { pickSeon, deal } = require('../engine/deal');
const { normalizeSettings, toScoreOptions, DEFAULT_SETTINGS } = require('../engine/settings');
const { settleGame, applyToBalances } = require('../engine/settlement');
const { chooseAiMove, chooseAiGoStop, chooseAiFloorMatch } = require('../engine/ai');
const fourplayer = require('../engine/fourplayer');
const { snapshot: createSnapshot } = require('./room-snapshot');
const users = require('./users');

/** 방 코드에 사용할 문자 (혼동되는 I·O·0·1 제외). */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/** 방 단계. */
const ROOM_PHASE = {
  LOBBY: 'lobby', // 대기실
  NEGOTIATE: 'negotiate', // 4인 광팔기 협상
  SEON: 'seon', // 선(先) 결정
  PLAY: 'play', // 대국 중
  SETTLE: 'settle', // 정산 후
};

/** 방이 아무도 쓰지 않으면 이 시간 뒤 사라진다. */
const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // 6시간

/** AI가 생각하는 시간(짧게 — 가족이 기다리지 않게). */
const AI_THINK_MIN = 350;
const AI_THINK_MAX = 900;

function randomCode() {
  const bytes = require('crypto').randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return code;
}

/** 카드 종류별 개수 (획득 요약판용). */
/** 사람이 읽는 로그로 남길 이벤트 종류. */
const LOGGED_EVENTS = new Set([
  EVENT.BBEOK,
  EVENT.CHEOT_BBEOK,
  EVENT.YEON_BBEOK,
  EVENT.JAB_BBEOK,
  EVENT.TTADAK,
  EVENT.JJOK,
  EVENT.SSEUL,
  EVENT.SHAKE,
  EVENT.BOMB,
  EVENT.CHONGTONG,
  EVENT.GO,
  EVENT.REVERSE_GO,
  EVENT.STOP,
  EVENT.PI_STEAL,
  EVENT.BONUS_CAPTURE,
  EVENT.FINISHED,
]);

function playerNameError(name) {
  if (name === undefined || name === null) return null;
  if (typeof name !== 'string') return '이름은 문자열이어야 합니다.';
  const normalized = name.trim();
  if (normalized.length > 12) return '이름은 12자 이내로 입력해 주세요.';
  if (/[\u0000-\u001f\u007f-\u009f]/.test(normalized)) return '이름에 제어 문자를 사용할 수 없습니다.';
  return null;
}

class Room {
  /**
   * @param {string} code 방 코드
   * @param {object} [options] 방 설정
   */
  constructor(code, options = {}) {
    this.code = code;
    this.settings = normalizeSettings(options);
    this.createdAt = Date.now();
    this.hostId = null;
    this.seats = new Array(this.settings.playerCount).fill(null); // 좌석 고정 배열 (빈 자리는 null)
    this.aiTimer = null;
    this.engine = null;
    this.deck = null; // 선 결정까지 보관해 두는 덱
    this.seonPool = null; // 선 결정 후보를 뽑을 복사본 (딜 덱은 그대로 유지)
    this.seonCandidates = []; // 좌석별 후보 카드 3장
    this.seonPicked = []; // 좌석별 선택한 후보 인덱스(-1 = 미선택)
    this.prompt = null; // 현재 기다리는 선택
    this.deadline = null; // 현재 차례 마감 시각(epoch ms)
    this.settle = null; // 마지막 정산 결과
    this.fx = []; // 이펙트 로그 (seq 증가)
    this.fxSeq = 0; // 판이 바뀌어도 유지되는 이펙트 번호
    this.log = []; // 텍스트 로그
    this.lastActivity = Date.now();
    this.result = null; // 마지막 판 결과

    // 4인 광팔기
    this.playSeats = null; // 실제로 치는 3명의 물리 좌석 (엔진 플레이어 순서)
    this.negotiation = null; // 광팔기 협상 상태
    this.lastSitOutSeat = -1; // 직전 판에 빠진 자리 (연사 방지)
    this.gwangSale = null; // 직전 판 광팔기 정산 내역
    this.autoPlayAt = 0; // 연결 끊김 자동 진행 예약 시각
    this.version = 0; // 상태 변경 횟수 (긴 폴링용)
    this.changeWaiters = []; // 상태 변경을 기다리는 요청들
    this.closed = false;

    if (this.settings.mode === 'solo') this.setupAiSeats();
  }

  // ── 자리 ─────────────────────────────────────────────────────────────────

  get playerCount() {
    return this.settings.playerCount;
  }

  /** 사람이 앉을 수 있는 빈 자리가 있는지. */
  hasFreeSeat() {
    return this.seats.some((s) => s === null);
  }

  /** AI 자리 채우기 (혼자 치기 모드). */
  setupAiSeats() {
    const names = ['나', '컴퓨터 A', '컴퓨터 B'];
    for (let seat = 1; seat < this.settings.playerCount; seat++) {
      this.seats[seat] = this.makeAiPlayer(seat, names[seat] || `컴퓨터 ${seat}`);
    }
  }

  makeAiPlayer(seat, name) {
    return {
      id: `ai:${seat}`,
      name,
      seat,
      type: 'ai',
      difficulty: this.settings.aiDifficulty,
      money: this.settings.seedMoney,
      ready: true,
      connected: true,
      lastSeen: Date.now(),
    };
  }

  /**
   * 사람이 앉는다.
   * @returns {{seat:number, player:object}|null} 자리가 없으면 null
   */
  addPlayer(id, name, opts) {
    opts = opts || {};
    const nameError = playerNameError(name);
    if (nameError) throw new EngineError(nameError);
    if (!this.hasFreeSeat()) return null;
    const seat = this.seats.findIndex((s) => s === null);
    const player = {
      id,
      name: (typeof name === 'string' ? name.trim() : '').slice(0, 12) || `${seat + 1}번`,
      seat,
      type: 'human',
      money: (typeof opts.money === 'number') ? opts.money : this.settings.seedMoney,
      userId: opts.userId || null,
      ready: false,
      connected: true,
      lastSeen: Date.now(),
    };
    this.seats[seat] = player;
    if (!this.hostId) this.hostId = id;

    // 선 결정 중에 들어온 사람에게도 후보 카드를 준다 (아니면 선을 고를 수 없어 stuck 된다)
    if (this.phase === ROOM_PHASE.SEON && this.seonPool && this.seonPool.length >= 3) {
      this.seonCandidates[seat] = [this.seonPool.pop(), this.seonPool.pop(), this.seonPool.pop()];
      this.seonPicked[seat] = -1;
    }

    this.touch();
    this.bump();
    return { seat, player };
  }

  findPlayer(id) {
    return this.seats.find((p) => p && p.id === id) || null;
  }

  playerAt(seat) {
    return this.seats[seat] || null;
  }

  /**
   * 물리 좌석 → 엔진 플레이어 인덱스.
   * 4인 광팔기는 실제로 치는 3명이 한 자리를 비우므로 매핑이 필요하다.
   */
  engineSeatOf(physicalSeat) {
    if (!this.playSeats) return physicalSeat;
    return this.playSeats.indexOf(physicalSeat);
  }

  /** 엔진 플레이어 인덱스 → 물리 좌석. */
  physicalSeatOf(engineSeat) {
    if (!this.playSeats) return engineSeat;
    return this.playSeats[engineSeat] ?? engineSeat;
  }

  /** 사람이 앉아 있는 자리 수. */
  get humanCount() {
    return this.seats.filter((s) => s && s.type === 'human').length;
  }

  /**
   * 로비 방 목록에 보여줄 요약.
   * viewerId 가 이미 이 방의 참가자라면 자리가 없어도 다시 들어갈 수 있다.
   */
  lobbyInfo(viewerId = null) {
    const phase = this.phase || ROOM_PHASE.LOBBY;
    const member = viewerId ? this.findPlayer(viewerId) : null;
    const host = (this.hostId ? this.findPlayer(this.hostId) : null)
      || this.seats.find((s) => s && s.type === 'human')
      || null;
    const openSeats = this.seats.filter((s) => s === null).length;
    const canJoin = Boolean(member)
      || (this.settings.mode === 'multi' && openSeats > 0);

    return {
      code: this.code,
      hostName: host ? host.name : '',
      mode: this.settings.mode,
      playerCount: this.settings.playerCount,
      humanCount: this.humanCount,
      openSeats,
      phase,
      canJoin,
      isMember: Boolean(member),
      createdAt: this.createdAt,
    };
  }

  markSeen(id) {
    const p = this.findPlayer(id);
    if (p) {
      p.connected = true;
      p.lastSeen = Date.now();
      this.touch();
    }
  }

  markDisconnected(id) {
    const p = this.findPlayer(id);
    if (p) {
      p.connected = false;
      p.lastSeen = Date.now();
      this.touch();
    this.bump();
    }
  }

  touch() {
    this.lastActivity = Date.now();
  }

  /** 상태가 바뀌었다고 알린다 — 기다리는 폴링 요청을 깨운다. */
  bump() {
    this.version++;
    const waiters = this.changeWaiters;
    this.changeWaiters = [];
    for (const w of waiters) {
      try {
        w();
      } catch {
        /* 무시 */
      }
    }
  }

  close() {
    this.closed = true;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = null;
    const waiters = this.changeWaiters.slice();
    for (const waiter of waiters) {
      try {
        waiter();
      } catch {
        /* 무시 */
      }
    }
    this.changeWaiters = [];
  }

  /**
   * 상태가 바뀌거나 타임아웃할 때까지 기다린다 (긴 폴링).
   * @param {number} timeoutMs 최대 대기 시간
   * @returns {Promise<boolean>} 상태가 바뀌었으면 true
   */
  waitForChange(timeoutMs, signal) {
    return new Promise((resolve) => {
      const startVersion = this.version;
      const room = this;
      let finished = false;
      let timer = null;

      function finish(changed) {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', abort);
        const i = room.changeWaiters.indexOf(check);
        if (i >= 0) room.changeWaiters.splice(i, 1);
        resolve(changed);
      }

      function abort() {
        finish(false);
      }

      function check() {
        if (finished) return;
        if (room.closed) {
          finish(false);
          return;
        }
        if (room.version !== startVersion) finish(true);
      }

      if (signal && signal.aborted) {
        finish(false);
        return;
      }
      // 이미 바뀌었으면 기다리지 않고 바로 응답한다
      if (room.version !== startVersion) {
        finish(true);
        return;
      }
      if (signal) signal.addEventListener('abort', abort, { once: true });
      room.changeWaiters.push(check);
      // 상태 변화가 없어도 시간이 되면 응답한다 (하트비트)
      timer = setTimeout(function () { finish(false); }, timeoutMs);
    });
  }

  get isEmpty() {
    // 사람이 한 명도 연결되어 있지 않으면 정리 대상이다 (AI 자리는 상주)
    return this.seats.every((s) => !s || s.type === 'ai' || !s.connected);
  }

  get isExpired() {
    return Date.now() - this.lastActivity > ROOM_TTL_MS;
  }

  // ── 대국 진행 ────────────────────────────────────────────────────────────

  /** 방장이 판을 시작한다. 이어하기면 지정한 참가자가 선이 된다. */
  startRound(firstPlayerId = null) {
    // multi 모드: 연결된 사람이 줄어들었으면 좌석을 compact 하고 인원을 줄인다.
    // (3명으로 시작했다가 1명이 나간 뒤 남은 2명이 "다음 판"을 누르면 2명으로 진행)
    if (this.settings.mode === 'multi') {
      const humans = this.seats.filter((s) => s && s.type === 'human' && s.connected);
      if (humans.length < 2) {
        throw new EngineError('2명 이상이어야 시작할 수 있습니다.');
      }
      if (humans.length < this.settings.playerCount) {
        this.seats = new Array(humans.length).fill(null);
        humans.forEach((h, i) => {
          h.seat = i;
          this.seats[i] = h;
        });
        this.settings.playerCount = humans.length;
      }
    }

    const forcedSeonSeat = firstPlayerId === null
      ? -1
      : this.seats.findIndex((player) => player && player.id === firstPlayerId);
    this.roundFirstSeat = forcedSeonSeat >= 0 ? forcedSeonSeat : 0;

    const needed = this.settings.mode === 'solo' ? 1 : this.settings.playerCount;
    if (this.humanCount < needed) {
      throw new EngineError(
        this.settings.mode === 'solo'
          ? '혼자 치기입니다. 아무도 오지 않아도 시작할 수 있습니다.'
          : `${this.settings.playerCount}명이 모두 모여야 시작할 수 있습니다.`
      );
    }

    this.deck = shuffledDeck(this.settings.bonusPack);
    this.seonPool = null;
    this.playSeats = null;
    this.lastSitOutSeat = -1;

    // 4인 광팔기 — 먼저 포기/광팔기 협상을 한다
    if (this.settings.playerCount === 4) {
      // 4인 딜: 4×7장 + 바닥 6장 (뒷패 17장). 광을 팔 사람은 자기 손패를 봐야 한다.
      const dealt = deal(this.deck, 4, 0);
      this.seats.forEach((p, i) => {
        if (p) p.hand = dealt.hands[i];
      });
      this.fourFloor = dealt.floor;
      this.fourStock = dealt.stock;
      this.playSeats = null;
      const order = [1, 2, 3].map((offset) => (this.roundFirstSeat + offset) % 4);
      this.negotiation = {
        decisions: {}, // 좌석 → 'join' | 'giveup' | 'sell'
        p2GiveUp: false,
        p3GiveUp: false,
        p4Sell: false,
        firstSeat: this.roundFirstSeat,
        order, // 선 다음 좌석부터 참가 여부를 결정한다
      };
      this.seonCandidates = this.seats.map(() => null);
      this.seonPicked = this.seats.map(() => -1);
      this.engine = null;
      this.settle = null;
      this.result = null;
      this.prompt = null;
      this.deadline = null;
      this.phase = ROOM_PHASE.NEGOTIATE;
      this.logEvent('4인 광팔기 — 참가 여부를 정합니다. (선은 반드시 참가)');
      this.touch();
    this.bump();
      return;
    }

    // 선 결정용 후보 3장씩.
    // 후보를 딜 덱에서 직접 빼면 3인 기준 9장이 게임에서 사라져 나가리가 급증한다.
    // 후보는 딜 덱의 복사본에서 뽑고, 딜 덱은 다시 섞어 후보의 위치 정보를 지운다.
    // AI 자리도 후보를 갖는다 — 화면에는 비추지만 동점 판정에는 필요하다.
    this.seonPool = this.deck.slice();
    this.seonCandidates = this.seats.map((p) =>
      p ? [this.seonPool.pop(), this.seonPool.pop(), this.seonPool.pop()] : null
    );
    shuffle(this.deck, Math.random);
    this.seonPicked = this.seats.map(() => -1);
    this.seonRetries = 0;

    this.engine = null;
    this.settle = null;
    this.result = null;
    this.prompt = null;
    this.deadline = null;
    this.autoPlayAt = 0;
    this.fx = []; // 새 판이면 이펙트 로그도 초기화
    this.log = []; // 텍스트 로그도 초기화
    if (forcedSeonSeat >= 0) {
      this.beginPlay(forcedSeonSeat);
      return;
    }
    this.phase = ROOM_PHASE.SEON;
    this.logEvent('새 판을 시작합니다. 선을 정해 주세요.');
    this.touch();
    this.bump();
  }

  // ── 4인 광팔기 협상 ──────────────────────────────────────────────────────

  /** 현재 결정할 차례의 좌석 (없으면 -1). */
  negotiateWaitingSeat() {
    if (!this.negotiation) return -1;
    const n = this.negotiation;
    // P2 가 포기했으면 P3·P4 자동 참가 → 협상 종료
    if (n.p2GiveUp) return -1;
    // P3 가 포기했으면 P4 자동 참가 → 협상 종료
    if (n.p3GiveUp) return -1;
    for (let role = 0; role < n.order.length; role++) {
      if (n.decisions[role + 1] === undefined) return n.order[role];
    }
    return -1;
  }

  /**
   * 협상 결정. P2·P3 은 'join'/'giveup', P4 는 'join'/'sell'(광팔기).
   */
  negotiateDecision(seat, decision) {
    if (this.phase !== ROOM_PHASE.NEGOTIATE || !this.negotiation) {
      throw new EngineError('지금은 협상 단계가 아닙니다.');
    }
    const n = this.negotiation;
    const waiting = this.negotiateWaitingSeat();
    if (seat !== waiting) throw new EngineError('아직 내 차례가 아닙니다.');

    if (seat === n.order[0]) {
      // P2: 참가 또는 포기
      if (decision !== 'join' && decision !== 'giveup') throw new EngineError('잘못된 선택입니다.');
      n.decisions[1] = decision;
      n.p2GiveUp = decision === 'giveup';
    } else if (seat === n.order[1]) {
      if (decision !== 'join' && decision !== 'giveup') throw new EngineError('잘못된 선택입니다.');
      n.decisions[2] = decision;
      n.p3GiveUp = decision === 'giveup';
    } else if (seat === n.order[2]) {
      // P4: 참가(그냥 빠짐) 또는 광팔기
      if (decision !== 'join' && decision !== 'sell') throw new EngineError('잘못된 선택입니다.');
      n.decisions[3] = decision;
      n.p4Sell = decision === 'sell';
    } else {
      throw new EngineError('선은 반드시 참가해야 합니다.');
    }

    const player = this.seats[seat];
    this.logEvent(
      decision === 'giveup'
        ? `${player ? player.name : ''}님이 이번 판에 빠집니다.`
        : decision === 'sell'
          ? `${player ? player.name : ''}님이 광을 팝니다.`
          : `${player ? player.name : ''}님이 참가합니다.`
    );

    if (this.negotiateWaitingSeat() === -1) this.resolveNegotiation();
    this.touch();
    this.bump();
    return true;
  }

  /** 협상이 끝나면 3인 게임을 만든다. */
  resolveNegotiation() {
    const n = this.negotiation;
    const sellerSeat = n.order[2];
    const sellerHand = this.seats[sellerSeat] ? this.seats[sellerSeat].hand || [] : [];
    const round = fourplayer.resolve({
      p2GiveUp: n.p2GiveUp,
      p3GiveUp: n.p3GiveUp,
      p4Sell: n.p4Sell,
      unitPrice: this.settings.moneyPerPoint,
      sellerHand,
      options: toScoreOptions(this.settings),
    });
    const physicalSeat = (seat) => (n.firstSeat + seat) % 4;
    round.playSeats = round.playSeats.map(physicalSeat);
    round.sitOutSeat = physicalSeat(round.sitOutSeat);
    if (round.gwang.sellerSeat >= 0) round.gwang.sellerSeat = physicalSeat(round.gwang.sellerSeat);
    round.gwang.payerSeats = round.gwang.payerSeats.map(physicalSeat);

    this.playSeats = round.playSeats;
    this.lastSitOutSeat = round.sitOutSeat;
    this.gwangSale = round.gwang;

    // 광값 선불 — 선(0)을 제외한 참가자가 낸다
    if (round.gwang.sold && round.gwang.valuePerPayer > 0) {
      for (const payer of round.gwang.payerSeats) {
        const p = this.seats[payer];
        if (p) p.money -= round.gwang.valuePerPayer;
      }
      const seller = this.seats[round.gwang.sellerSeat];
      if (seller) seller.money += round.gwang.valuePerPayer * round.gwang.payerSeats.length;
      this.logEvent(
        `광값 ${round.gwang.gwangCount}광 × ${this.settings.moneyPerPoint}P = ` +
          `${round.gwang.valuePerPayer}P 씌(선 제외 ${round.gwang.payerSeats.length}명이 선불)`
      );
    }

    // 빠진 사람의 손패는 뒷패로 편입하고 섞는다
    const stock = this.fourStock.slice();
    const sitOutHand = this.seats[round.sitOutSeat] ? this.seats[round.sitOutSeat].hand || [] : [];
    stock.push(...sitOutHand);
    for (let i = stock.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = stock[i];
      stock[i] = stock[j];
      stock[j] = tmp;
    }

    // 3인 엔진 — 치는 3명의 손패를 순서대로 넘긴다
    const names = round.playSeats.map((s) => (this.seats[s] ? this.seats[s].name : `${s + 1}번`));
    this.engine = new TurnEngine({
      playerCount: 3,
      names,
      options: toScoreOptions(this.settings),
    });
    this.engine.startGameFromDealt({
      hands: round.playSeats.map((s) => (this.seats[s] ? this.seats[s].hand || [] : [])),
      floor: this.fourFloor,
      stock,
      seon: 0, // 4인 광팔기는 선이 항상 P1
    });

    // 빠진 자리의 손패는 비운다 (이제 뒷패에 있다)
    const sitOut = this.seats[round.sitOutSeat];
    if (sitOut) sitOut.hand = [];

    this.negotiation = null;
    this.fourFloor = null;
    this.fourStock = null;
    this.phase = ROOM_PHASE.PLAY;
    this.prompt = null;
    this.deadline = null;
    this.settle = null;
    this.result = null;
    this.pushFxFromEngine();
    this.logEvent('참가자가 정해졌습니다. 대국을 시작합니다.');

    // 딜 직후 총통으로 판이 끝난 경우에도 정산으로 넘긴다
    if (this.engine.state.phase === PHASE.FINISHED) {
      this.finishRound();
      this.touch();
      this.bump();
      return;
    }

    this.syncPrompt();
    this.scheduleAiTurn();
    this.touch();
    this.bump();
  }

  /** 선 결정: 후보 카드 중 하나를 고른다. */
  pickSeonCard(seat, cardIndex) {
    if (this.phase !== ROOM_PHASE.SEON) throw new EngineError('지금은 선을 정하는 단계가 아닙니다.');
    const candidates = this.seonCandidates[seat];
    if (!candidates) throw new EngineError('선 후보 카드가 없습니다.');
    if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= candidates.length) {
      throw new EngineError('선 후보 번호가 올바르지 않습니다.');
    }
    if (this.seonPicked[seat] !== -1) throw new EngineError('이미 골랐습니다.');

    this.seonPicked[seat] = cardIndex;
    this.touch();
    this.bump();

    // 사람이 모두 골랐으면 선을 확정한다
    this.maybeResolveSeon();
    return true;
  }

  /** 사람이 모두 카드를 골랐는지 확인하고, 같으면 선을 확정한다. */
  maybeResolveSeon() {
    const humans = this.seats.map((p, i) => (p && p.type === 'human' ? i : -1)).filter((i) => i >= 0);
    if (!humans.every((s) => this.seonPicked[s] !== -1)) return;
    this.resolveSeon();
  }

  /** 공개된 카드로 선을 정하고 딜을 시작한다. */
  resolveSeon() {
    const months = this.seonCandidates.map((cards, seat) => {
      if (!cards) return 1;
      const pick = this.seonPicked[seat];
      if (pick >= 0) return cards[pick].month;
      // AI 는 아직 고르지 않았다 → 가장 작은 월을 낸 것으로 본다
      return Math.min(...cards.map((c) => c.month));
    });
    const hour = new Date().getHours();
    const picked = pickSeon(months, hour);

    // 최고월 동점이면 동점자끼리 같은 후보로 다시 뽑는다 (무한 재경합 방지 위해 횟수 제한)
    if (picked.winners.length > 1 && this.seonRetries < 5) {
      this.seonRetries++;
      for (const seat of picked.winners) {
        if (!this.seats[seat]) continue;
        // 후보를 새로 뽑지 않는다 — 덱이 고갈나게 되므로 같은 3장 중에서 다시 고른다
        this.seonPicked[seat] = -1;
        if (this.seats[seat].type === 'ai') {
          // AI 는 임의의 후보를 고른다 (같은 달을 계속 고르면 무한 동점이 된다)
          const cands = this.seonCandidates[seat];
          this.seonPicked[seat] = Math.floor(Math.random() * cands.length);
        }
      }
      this.logEvent(`${picked.value}월이 같아 다시 뽑습니다.`);
      this.maybeResolveSeon();
      return;
    }

    this.beginPlay(picked.winners[0]);
  }

  /** 딜을 하고 대국을 시작한다. */
  beginPlay(seon) {
    const names = this.seats.map((p, i) => (p ? p.name : `${i + 1}번`));
    const reduceSoloGoChongtong = this.settings.mode === 'solo' && this.playerCount === 2;
    let deck = this.deck;
    while (true) {
      this.engine = new TurnEngine({
        playerCount: this.playerCount,
        names,
        options: toScoreOptions(this.settings),
      });
      this.engine.startGame(deck, seon);

      const hasOpeningChongtong = this.engine.state.events.some((event) => event.kind === EVENT.CHONGTONG);
      // AI 맞고에서는 초기 총통의 절반만 인정해 기본 덱 기준 약 1.3%로 낮춘다.
      if (!reduceSoloGoChongtong || !hasOpeningChongtong || Math.random() < 0.5) break;

      this.logEvent('초기 총통 확률 조정으로 패를 다시 섞습니다.');
      deck = shuffledDeck(this.settings.bonusPack);
    }
    this.deck = null;
    this.seonPool = null;

    this.phase = ROOM_PHASE.PLAY;
    this.prompt = null;
    this.settle = null;
    this.result = null;
    this.pushFxFromEngine();
    this.logEvent(`${this.seats[seon] ? this.seats[seon].name : '선'}님이 선입니다. 대국을 시작합니다.`);

    // 딜 직후 총통(바닥 4장·손패 4장)으로 판이 바로 끝날 수 있다.
    // 정산으로 넘기지 않으면 아무도 둘 수 없어 '차례'에서 영원히 멈춘다.
    if (this.engine.state.phase === PHASE.FINISHED) {
      this.finishRound();
      this.touch();
      this.bump();
      return;
    }

    this.syncPrompt();
    this.scheduleAiTurn();
    this.touch();
    this.bump();
  }

  /** 엔진 이벤트를 이펙트 로그로 옮긴다. */
  pushFxFromEngine() {
    if (!this.engine) return;
    for (const evt of this.engine.state.events) {
      if (evt._pushed) continue;
      evt._pushed = true;
      const fx = {
        seq: ++this.fxSeq,
        kind: evt.kind,
        seat: evt.seat,
        month: evt.month,
        text: evt.text,
        victimSeat: evt.victimSeat,
      };
      // 낸 패·먹은 패의 카드 id (화면에서 카드가 날아가는 연출에 쓴다)
      if (evt.cards && evt.cards.length) fx.cards = evt.cards;
      this.fx.push(fx);
    }
    for (const evt of this.engine.state.events) {
      if (evt._logged) continue;
      evt._logged = true;
      if (LOGGED_EVENTS.has(evt.kind)) this.logEvent(evt.text);
    }
  }

  logEvent(text) {
    this.log.push({ at: Date.now(), text });
    if (this.log.length > 100) this.log.splice(0, this.log.length - 100);
  }

  // ── 액션 처리 ────────────────────────────────────────────────────────────

  /**
   * 플레이어 액션을 처리한다.
   * @param {object} player 참가자 객체
   * @param {string} type 액션 종류
   * @param {object} payload 액션 파라미터
   */
  act(player, type, payload = {}) {
    this.touch();
    this.bump();

    switch (type) {
      case 'ready':
        player.ready = !player.ready;
        this.bump();
        return { ok: true, ready: player.ready };

      case 'start':
        this.requireHost(player);
        this.startRound();
        return { ok: true };

      case 'settings':
        this.requireHost(player);
        // 판이 진행 중일 때 바꾸면 정산이 어긋나므로 대기·정산 단계에서만 허용한다
        // (대기실은 phase 가 아직 undefined 이므로 lobby 로 간주)
        const settingsPhase = this.phase || ROOM_PHASE.LOBBY;
        if (settingsPhase !== ROOM_PHASE.LOBBY && settingsPhase !== ROOM_PHASE.SETTLE) {
          throw new EngineError('판 시작 전에만 설정을 바꿀 수 있습니다.');
        }
        this.applySettings({ ...this.settings, ...payload });
        return { ok: true, settings: this.settings };

      case 'seonPick':
        this.pickSeonCard(player.seat, payload.cardIndex);
        return { ok: true };

      case 'negotiate':
        // 4인 광팔기 — 참가/포기/광팔기 결정
        this.negotiateDecision(player.seat, payload.decision);
        return { ok: true };

      case 'playCard':
        return this.actOnTurn(player, () => this.engine.playHandCard(payload.handIndex, payload.floorChoice ?? null));

      case 'floorChoice':
        return this.actOnTurn(player, () => this.engine.resolveFloorChoice(payload.choice));

      case 'flipChoice':
        return this.actOnTurn(player, () => this.engine.resolveFlipChoice(payload.ordinal));

      case 'bonusDraw':
        return this.actOnTurn(player, () => this.engine.resolveBonusDraw(payload.stockIndex));

      case 'go':
        return this.actOnTurn(player, () => this.engine.declareGo());

      case 'stop':
        return this.actOnTurn(player, () => this.engine.declareStop());

      case 'shake':
        return this.actOnTurn(player, () => this.engine.declareShake(payload.month));

      case 'bomb':
        return this.actOnTurn(player, () => this.engine.playBomb(payload.month));

      case 'flipOnly':
        return this.actOnTurn(player, () => this.engine.flipOnly());

      case 'nextGame':
        if (this.phase !== ROOM_PHASE.SETTLE || !this.result) {
          throw new EngineError('판이 끝난 뒤에 다음 판을 시작할 수 있습니다.');
        }
        const winnerSeat = this.result && !this.result.nagari ? this.result.winnerSeat : -1;
        const soloHostCanStart = this.settings.mode === 'solo' && player.id === this.hostId;
        if (winnerSeat >= 0 && player.seat !== winnerSeat && !soloHostCanStart) {
          throw new EngineError('이긴 사람만 다음 판을 시작할 수 있습니다.');
        }
        if (winnerSeat < 0 || (this.settings.mode === 'solo' && !soloHostCanStart)) {
          this.requireHost(player);
        }
        const winnerId = winnerSeat >= 0 && this.seats[winnerSeat]
          ? this.seats[winnerSeat].id
          : null;
        this.startRound(winnerId);
        return { ok: true };

      case 'leave':
        this.markDisconnected(player.id);
        if (player.userId) users.updateMoney(player.userId, player.money);
        return { ok: true };

      default:
        throw new EngineError(`알 수 없는 액션입니다: ${type}`);
    }
  }

  /** 설정을 바꿀 때 AI 자리를 갱신한다. */
  applySettings(next) {
    const prevMode = this.settings.mode;
    const prevCount = this.settings.playerCount;
    this.settings = normalizeSettings(next);

    // 좌석 수가 바뀌면 배열을 다시 만든다
    if (this.settings.playerCount !== prevCount) {
      const humans = this.seats.filter((s) => s && s.type === 'human');
      this.seats = new Array(this.settings.playerCount).fill(null);
      humans.forEach((h, i) => {
        if (i < this.settings.playerCount) {
          h.seat = i;
          this.seats[i] = h;
        }
      });
    }

    // 모드가 바뀌면 AI 자리를 다시 채운다
    if (this.settings.mode !== prevMode) {
      for (let i = 0; i < this.seats.length; i++) {
        if (this.seats[i] && this.seats[i].type === 'ai') this.seats[i] = null;
      }
      if (this.settings.mode === 'solo') this.setupAiSeats();
    }
  }

  requireHost(player) {
    if (player.id !== this.hostId) throw new EngineError('방장만 할 수 있습니다.');
  }

  actOnTurn(player, fn) {
    if (this.phase !== ROOM_PHASE.PLAY || !this.engine) {
      throw new EngineError('지금은 대국할 수 없습니다.');
    }
    if (this.engine.state.current !== this.engineSeatOf(player.seat)) {
      throw new EngineError('아직 내 차례가 아닙니다.');
    }
    const result = fn();
    this.afterAction(result);
    return { ok: true };
  }

  /** 액션 후 엔진 상태를 방 상태에 반영한다. */
  afterAction(result) {
    this.pushFxFromEngine();

    if (result && result.awaiting === 'bonusDraw') {
      this.prompt = { type: 'bonusDraw', seat: this.physicalSeatOf(this.engine.state.current), options: this.bonusOptions() };
    } else if (result && result.awaiting === 'floorChoice') {
      this.prompt = { type: 'floorChoice', seat: this.physicalSeatOf(this.engine.state.current), options: result.options };
    } else if (result && result.awaiting === 'flipChoice') {
      this.prompt = { type: 'flipChoice', seat: this.physicalSeatOf(this.engine.state.current), options: result.options };
    } else {
      this.syncPrompt();
    }

    if (this.engine.state.phase === PHASE.FINISHED) this.finishRound();
    else this.scheduleAiTurn();
    this.touch();
    this.bump();
  }

  /** 보너스패 보충 후보(뒷패 맨 위 몇 장). */
  bonusOptions() {
    if (!this.engine) return [];
    const stock = this.engine.state.stock;
    const start = Math.max(0, stock.length - 3);
    const out = [];
    for (let i = stock.length - 1; i >= start; i--) {
      out.push({ ...this.engine.describeCard(stock[i]), stockIndex: i });
    }
    return out;
  }

  /** 엔진 단계에 맞춰 프롬프트와 마감 시각을 갱신한다. */
  syncPrompt() {
    if (!this.engine) {
      this.prompt = null;
      this.deadline = null;
      return;
    }
    const phase = this.engine.state.phase;
    if (phase === PHASE.AWAITING_GO_STOP) {
      this.prompt = { type: 'goStop', seat: this.physicalSeatOf(this.engine.state.current), options: [] };
    } else if (phase === PHASE.AWAITING_FLOOR_CHOICE) {
      this.prompt = { type: 'floorChoice', seat: this.physicalSeatOf(this.engine.state.current), options: [] };
    } else if (phase === PHASE.AWAITING_FLIP_CHOICE) {
      this.prompt = { type: 'flipChoice', seat: this.physicalSeatOf(this.engine.state.current), options: [] };
    } else if (phase === PHASE.AWAITING_BONUS_DRAW) {
      this.prompt = { type: 'bonusDraw', seat: this.physicalSeatOf(this.engine.state.current), options: this.bonusOptions() };
    } else {
      this.prompt = null;
    }
    this.deadline = this.computeDeadline();
  }

  computeDeadline() {
    if (!this.engine || !this.settings.timeLimit.enabled) return null;
    if (this.engine.state.phase === PHASE.FINISHED) return null;
    const seat = this.physicalSeatOf(this.engine.state.current);
    if (!this.seats[seat]) return null;
    const limit = this.settings.timeLimit.base + this.settings.timeLimit.increment * this.engine.state.playCount;
    return Date.now() + limit * 1000;
  }

  // ── AI 진행 ──────────────────────────────────────────────────────────────

  /** AI 자리 차례면 곧바로 진행을 예약한다. */
  scheduleAiTurn() {
    if (this.phase !== ROOM_PHASE.PLAY || !this.engine) return;
    if (this.engine.state.phase === PHASE.FINISHED) return;
    if (this.aiTimer) return;
    const seat = this.physicalSeatOf(this.engine.state.current);
    const p = this.seats[seat];
    if (!p || p.type !== 'ai') return;

    const delay = AI_THINK_MIN + Math.floor(Math.random() * (AI_THINK_MAX - AI_THINK_MIN));
    this.aiTimer = setTimeout(() => {
      this.aiTimer = null;
      try {
        this.runAiTurn(seat);
      } catch (err) {
        console.error(`[room ${this.code}] AI 진행 오류:`, err.message);
        // 오류 때문에 대국이 멈추지 않게 — 판이 이미 끝났으면 정산으로 넘긴다
        if (this.engine && this.engine.state.phase === PHASE.FINISHED) {
          this.finishRound();
          this.bump();
        }
      }
    }, delay);
  }

  /** AI가 실제로 수를 둔다. */
  runAiTurn(seat) {
    if (!this.engine) return;
    if (this.engine.state.phase === PHASE.FINISHED) return;
    const engineSeat = this.engineSeatOf(seat);
    if (this.engine.state.current !== engineSeat) return;
    const p = this.seats[seat];
    if (!p || p.type !== 'ai') return;

    const player = this.engine.state.players[engineSeat];
    const difficulty = p.difficulty || this.settings.aiDifficulty;
    const prompt = this.prompt;

    // 대기 중인 선택이 있으면 그것부터 처리
    if (prompt && prompt.seat === seat) {
      if (prompt.type === 'goStop') {
        const choice = chooseAiGoStop(this.engine, engineSeat, difficulty);
        if (choice === 'go') this.engine.declareGo();
        else this.engine.declareStop();
        this.afterAction(null);
        return;
      }
      if (prompt.type === 'floorChoice') {
        // 바닥 2장 중 AI 가 더 좋은 쪽을 고른다
        const options = prompt.options || [];
        let best = 0;
        if (options.length === 2) {
          const view = this.engine.state.players[engineSeat];
          const value = (c) => c.junkValue + (c.kind === 'bright' ? 8 : 0);
          best = value(options[1]) > value(options[0]) ? 1 : 0;
        }
        this.engine.resolveFloorChoice(best);
        this.afterAction(null);
        return;
      }
      if (prompt.type === 'flipChoice') {
        const options = prompt.options || [];
        let best = 0;
        if (options.length === 2) {
          const value = (c) => c.junkValue + (c.kind === 'bright' ? 8 : 0);
          best = value(options[1]) > value(options[0]) ? 1 : 0;
        }
        this.engine.resolveFlipChoice(best);
        this.afterAction(null);
        return;
      }
      if (prompt.type === 'bonusDraw') {
        const opts = prompt.options || [];
        const last = opts[opts.length - 1];
        this.engine.resolveBonusDraw(last ? last.stockIndex : 0);
        this.afterAction(null);
        return;
      }
    }

    // 일반 수
    const move = chooseAiMove(this.engine, engineSeat, difficulty);
    if (!move) return;

    if (move.kind === 'card') {
      const result = this.engine.playHandCard(move.index, move.floorIndex >= 0 ? move.floorIndex : null);
      this.afterAction(result);
    } else if (move.kind === 'bomb') {
      this.engine.playBomb(move.month);
      this.afterAction(null);
    } else if (move.kind === 'shake') {
      this.engine.declareShake(move.month);
      const idx = this.engine.state.players[engineSeat].hand.findIndex((c) => c.month === move.month);
      if (idx >= 0) {
        const result = this.engine.playHandCard(idx, null);
        this.afterAction(result);
      } else {
        this.afterAction(null);
      }
    } else if (move.kind === 'flipOnly') {
      this.engine.flipOnly();
      this.afterAction(null);
    }
  }

  // ── 타임아웃 ─────────────────────────────────────────────────────────────

  // ── 연결 끊김 처리 ───────────────────────────────────────────────────────
  //
  // 배터리 방전 등으로 앱이 강제 종료되면 서버는 즉시 알 수 없다.
  // 20초 이상 폴링이 없으면 '연결 끊김' 으로 표시하고,
  // 그 사람 차례가 왔을 때 30초 더 기다린 뒤 자동으로 진행한다(다른 사람들이 멈추지 않도록).

  /** 연결이 끊긴 플레이어를 표시하고, 차례가 오면 자동으로 진행한다. */
  checkDisconnected() {
    if (this.phase !== ROOM_PHASE.PLAY || !this.engine) return;
    const now = Date.now();

    for (const p of this.seats) {
      if (p && p.type === 'human' && p.connected && now - p.lastSeen > 20000) {
        p.connected = false;
        this.logEvent(`${p.name} 님의 연결이 끊겼습니다.`);
        this.bump();
      }
    }

    const engineSeat = this.engine.state.current;
    const cur = this.seats[this.physicalSeatOf(engineSeat)];
    if (!cur || cur.type !== 'human' || cur.connected) {
      this.autoPlayAt = 0;
      return;
    }

    if (!this.autoPlayAt) this.autoPlayAt = now;
    if (now - this.autoPlayAt > 30000) {
      this.autoPlayAt = 0;
      this.autoPlayFor(cur, engineSeat);
    }
  }

  /** 연결이 끊긴 플레이어 대신 한 수를 둔다. */
  autoPlayFor(player, engineSeat) {
    this.logEvent(`${player.name} 님 연결이 끊겨 자동으로 진행합니다.`);
    this.fx.push({
      seq: ++this.fxSeq,
      kind: 'autoPlay',
      seat: player.seat,
      month: 0,
      text: `${player.name} 님 연결 끊김 — 자동 진행`,
      victimSeat: -1,
    });

    // 한 차례에 선택(바닥 2장·뒤집기·보너스·고/스톱)이나 보너스패 재사용이
    // 이어질 수 있다. 첫 수만 두고 멈추면 그 차례에서 영원히 멈추므로,
    // 같은 사람 차례가 계속되는 동안 합법 선택을 골라 끝까지 진행한다.
    for (let guard = 0; guard < 12; guard++) {
      const state = this.engine.state;
      if (state.phase === PHASE.FINISHED) break;
      if (state.current !== engineSeat) break;

      try {
        if (state.phase === PHASE.AWAITING_GO_STOP) {
          this.engine.declareStop();
          this.afterAction(null);
        } else if (state.phase === PHASE.AWAITING_FLOOR_CHOICE) {
          this.engine.resolveFloorChoice(0);
          this.afterAction(null);
        } else if (state.phase === PHASE.AWAITING_FLIP_CHOICE) {
          this.engine.resolveFlipChoice(0);
          this.afterAction(null);
        } else if (state.phase === PHASE.AWAITING_BONUS_DRAW) {
          const stock = state.stock;
          this.engine.resolveBonusDraw(Math.max(0, stock.length - 1));
          this.afterAction(null);
        } else {
          const hand = state.players[engineSeat].hand;
          if (!hand.length) {
            this.engine.flipOnly();
            this.afterAction(null);
          } else {
            // 보너스패보다 일반패를 먼저 낸다
            let idx = 0;
            for (let i = 0; i < hand.length; i++) {
              if (hand[i].kind !== 'bonus') {
                idx = i;
                break;
              }
            }
            const result = this.engine.playHandCard(idx, null);
            this.afterAction(result);
          }
        }
      } catch (err) {
        this.logEvent(`자동 진행 중 오류: ${err.message}`);
        break;
      }

      // 차례가 넘어갔으면 끝, 같은 사람이면(보너스·선택) 이어서 처리
      if (this.engine.state.current !== engineSeat) break;
    }
  }

  /** 시간이 넘었으면 강제 진행한다. */
  checkTimeout() {
    if (this.phase !== ROOM_PHASE.PLAY || !this.engine) return false;
    if (!this.deadline || Date.now() < this.deadline) return false;

    const engineSeat = this.engine.state.current;
    const seat = this.physicalSeatOf(engineSeat);
    const player = this.seats[seat];
    this.logEvent(`${player ? player.name : '플레이어'} 시간 초과 — 자동으로 넘어갑니다.`);
    this.fx.push({ seq: ++this.fxSeq, kind: 'timeout', seat, month: 0, text: '시간 초과!', victimSeat: -1 });

    try {
      if (this.engine.state.phase === PHASE.AWAITING_GO_STOP) {
        this.engine.declareStop();
      } else if (this.engine.state.phase === PHASE.AWAITING_FLOOR_CHOICE) {
        this.engine.resolveFloorChoice(0);
      } else if (this.engine.state.phase === PHASE.AWAITING_FLIP_CHOICE) {
        this.engine.resolveFlipChoice(0);
      } else if (this.engine.state.phase === PHASE.AWAITING_BONUS_DRAW) {
        const stock = this.engine.state.stock;
        this.engine.resolveBonusDraw(Math.max(0, stock.length - 1));
      } else {
        const result = this.engine.playHandCard(0, null);
        this.afterAction(result);
        return true;
      }
      this.afterAction(null);
    } catch (err) {
      this.logEvent(`시간 초과 처리 중 오류: ${err.message}`);
    }
    return true;
  }

  // ── 정산 ─────────────────────────────────────────────────────────────────

  finishRound() {
    if (this.settle) return;
    const engineResult = settleGame(this.engine, {
      moneyPerPoint: this.settings.moneyPerPoint,
      stakeMultiplier: this.settings.stakeMultiplier,
    });
    const engineEvents = this.engine.state.events || [];
    const chongtongEvent = engineEvents.slice().reverse()
      .find((event) => event.kind === EVENT.CHONGTONG);
    const result = {
      ...engineResult,
      winnerSeat: engineResult.winnerSeat < 0 ? -1 : this.physicalSeatOf(engineResult.winnerSeat),
      rows: engineResult.rows.map((row) => ({ ...row, seat: this.physicalSeatOf(row.seat) })),
      finishReason: chongtongEvent ? chongtongEvent.text : null,
    };

    const balances = this.seats.map((p, seat) => ({ seat, money: p ? p.money : 0 }));
    const updated = applyToBalances(balances, result.rows);
    for (const u of updated) {
      const p = this.playerAt(u.seat);
      if (p) {
        p.money = u.money;
        if (p.userId) users.updateMoney(p.userId, p.money);
      }
    }

    this.settle = { ...result, at: Date.now() };
    this.result = {
      winnerSeat: result.winnerSeat,
      nagari: result.nagari,
      finishReason: result.finishReason,
      rows: result.rows.map((r) => ({ ...r, money: this.playerAt(r.seat)?.money ?? 0 })),
    };
    this.phase = ROOM_PHASE.SETTLE;
    this.prompt = null;
    this.deadline = null;

    if (result.nagari) {
      this.logEvent('나가리 — 이번 판은 승패가 없습니다.');
    } else {
      const winner = this.playerAt(result.winnerSeat);
      this.logEvent(`${winner ? winner.name : '승자'}님이 승리했습니다.`);
    }
  }

  // ── 상태 스냅샷 ──────────────────────────────────────────────────────────

  /**
   * 특정 참가자에게 내려줄 상태.
   * @param {number} viewerSeat 보는 사람의 좌석 (-1 이면 관전)
   * @param {string} viewerId 보는 사람의 식별자 (방장 여부 판정용)
   */
  snapshot(viewerSeat = -1, viewerId = null) {
    return createSnapshot(this, viewerSeat, viewerId, ROOM_PHASE);
  }
}

module.exports = {
  Room,
  ROOM_PHASE,
  CODE_LENGTH,
  randomCode,
  DEFAULT_SETTINGS,
  playerNameError,
};
