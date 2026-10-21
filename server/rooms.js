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
const { shuffledDeck } = require('../engine/deck');
const { pickSeon } = require('../engine/deal');
const { normalizeSettings, toScoreOptions, DEFAULT_SETTINGS } = require('../engine/settings');
const { settleGame, applyToBalances } = require('../engine/settlement');
const { chooseAiMove, chooseAiGoStop, chooseAiFloorMatch } = require('../engine/ai');

/** 방 코드에 사용할 문자 (혼동되는 I·O·0·1 제외). */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/** 방 단계. */
const ROOM_PHASE = {
  LOBBY: 'lobby', // 대기실
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

class Room {
  /**
   * @param {string} code 방 코드
   * @param {object} [options] 방 설정
   */
  constructor(code, options = {}) {
    this.code = code;
    this.settings = normalizeSettings(options);
    this.hostId = null;
    this.seats = new Array(this.settings.playerCount).fill(null); // 좌석 고정 배열 (빈 자리는 null)
    this.aiTimer = null;
    this.engine = null;
    this.deck = null; // 선 결정까지 보관해 두는 덱
    this.seonCandidates = []; // 좌석별 후보 카드 3장
    this.seonPicked = []; // 좌석별 선택한 후보 인덱스(-1 = 미선택)
    this.prompt = null; // 현재 기다리는 선택
    this.deadline = null; // 현재 차례 마감 시각(epoch ms)
    this.settle = null; // 마지막 정산 결과
    this.fx = []; // 이펙트 로그 (seq 증가)
    this.log = []; // 텍스트 로그
    this.lastActivity = Date.now();
    this.result = null; // 마지막 판 결과

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
  addPlayer(id, name) {
    if (!this.hasFreeSeat()) return null;
    const seat = this.seats.findIndex((s) => s === null);
    const player = {
      id,
      name: (name || '').trim().slice(0, 12) || `${seat + 1}번`,
      seat,
      type: 'human',
      money: this.settings.seedMoney,
      ready: false,
      connected: true,
      lastSeen: Date.now(),
    };
    this.seats[seat] = player;
    if (!this.hostId) this.hostId = id;
    this.touch();
    return { seat, player };
  }

  findPlayer(id) {
    return this.seats.find((p) => p && p.id === id) || null;
  }

  playerAt(seat) {
    return this.seats[seat] || null;
  }

  /** 사람이 앉아 있는 자리 수. */
  get humanCount() {
    return this.seats.filter((s) => s && s.type === 'human').length;
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
    }
  }

  touch() {
    this.lastActivity = Date.now();
  }

  get isEmpty() {
    return this.humanCount === 0;
  }

  get isExpired() {
    return Date.now() - this.lastActivity > ROOM_TTL_MS;
  }

  // ── 대국 진행 ────────────────────────────────────────────────────────────

  /** 방장이 판을 시작한다. 선 결정 단계로 들어간다. */
  startRound() {
    const needed = this.settings.mode === 'solo' ? 1 : this.settings.playerCount;
    if (this.humanCount < needed) {
      throw new EngineError(
        this.settings.mode === 'solo'
          ? '혼자 치기입니다. 아무도 오지 않아도 시작할 수 있습니다.'
          : `${this.settings.playerCount}명이 모두 모여야 시작할 수 있습니다.`
      );
    }

    this.deck = shuffledDeck(this.settings.bonusPack);

    // 선 결정용 후보 3장씩 (덱에서 뽑으면 실제 딜 덱에서 빠진다)
    // AI 자리도 후보를 갖는다 — 화면에는 비추지만 동점 판정에는 필요하다.
    this.seonCandidates = this.seats.map((p) =>
      p ? [this.deck.pop(), this.deck.pop(), this.deck.pop()] : null
    );
    this.seonPicked = this.seats.map(() => -1);
    this.seonRetries = 0;

    this.engine = null;
    this.settle = null;
    this.result = null;
    this.prompt = null;
    this.deadline = null;
    this.phase = ROOM_PHASE.SEON;
    this.logEvent('새 판을 시작합니다. 선을 정해 주세요.');
    this.touch();
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
    this.engine = new TurnEngine({
      playerCount: this.playerCount,
      names,
      options: toScoreOptions(this.settings),
    });
    this.engine.startGame(this.deck, seon);
    this.deck = null;

    this.phase = ROOM_PHASE.PLAY;
    this.prompt = null;
    this.settle = null;
    this.result = null;
    this.pushFxFromEngine();
    this.logEvent(`${this.seats[seon] ? this.seats[seon].name : '선'}님이 선입니다. 대국을 시작합니다.`);
    this.syncPrompt();
    this.scheduleAiTurn();
    this.touch();
  }

  /** 엔진 이벤트를 이펙트 로그로 옮긴다. */
  pushFxFromEngine() {
    if (!this.engine) return;
    for (const evt of this.engine.state.events) {
      if (evt._pushed) continue;
      evt._pushed = true;
      this.fx.push({
        seq: this.fx.length + 1,
        kind: evt.kind,
        seat: evt.seat,
        month: evt.month,
        text: evt.text,
        victimSeat: evt.victimSeat,
      });
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

    switch (type) {
      case 'ready':
        player.ready = !player.ready;
        return { ok: true, ready: player.ready };

      case 'start':
        this.requireHost(player);
        this.startRound();
        return { ok: true };

      case 'settings':
        this.requireHost(player);
        this.applySettings({ ...this.settings, ...payload });
        return { ok: true, settings: this.settings };

      case 'seonPick':
        this.pickSeonCard(player.seat, payload.cardIndex);
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
        this.requireHost(player);
        this.startRound();
        return { ok: true };

      case 'leave':
        this.markDisconnected(player.id);
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
    if (this.engine.state.current !== player.seat) {
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
      this.prompt = { type: 'bonusDraw', seat: this.engine.state.current, options: this.bonusOptions() };
    } else if (result && result.awaiting === 'floorChoice') {
      this.prompt = { type: 'floorChoice', seat: this.engine.state.current, options: result.options };
    } else if (result && result.awaiting === 'flipChoice') {
      this.prompt = { type: 'flipChoice', seat: this.engine.state.current, options: result.options };
    } else {
      this.syncPrompt();
    }

    if (this.engine.state.phase === PHASE.FINISHED) this.finishRound();
    else this.scheduleAiTurn();
    this.touch();
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
      this.prompt = { type: 'goStop', seat: this.engine.state.current, options: [] };
    } else if (phase === PHASE.AWAITING_FLOOR_CHOICE) {
      this.prompt = { type: 'floorChoice', seat: this.engine.state.current, options: [] };
    } else if (phase === PHASE.AWAITING_FLIP_CHOICE) {
      this.prompt = { type: 'flipChoice', seat: this.engine.state.current, options: [] };
    } else if (phase === PHASE.AWAITING_BONUS_DRAW) {
      this.prompt = { type: 'bonusDraw', seat: this.engine.state.current, options: this.bonusOptions() };
    } else {
      this.prompt = null;
    }
    this.deadline = this.computeDeadline();
  }

  computeDeadline() {
    if (!this.engine || !this.settings.timeLimit.enabled) return null;
    if (this.engine.state.phase === PHASE.FINISHED) return null;
    const seat = this.engine.state.current;
    if (!this.seats[seat]) return null;
    const limit = this.settings.timeLimit.base + this.settings.timeLimit.increment * this.engine.state.playCount;
    return Date.now() + limit * 1000;
  }

  // ── AI 진행 ──────────────────────────────────────────────────────────────

  /** AI 자리 차례면 곧바로 진행을 예약한다. */
  scheduleAiTurn() {
    if (this.phase !== ROOM_PHASE.PLAY || !this.engine) return;
    if (this.aiTimer) return;
    const seat = this.engine.state.current;
    const p = this.seats[seat];
    if (!p || p.type !== 'ai') return;

    const delay = AI_THINK_MIN + Math.floor(Math.random() * (AI_THINK_MAX - AI_THINK_MIN));
    this.aiTimer = setTimeout(() => {
      this.aiTimer = null;
      try {
        this.runAiTurn(seat);
      } catch (err) {
        console.error(`[room ${this.code}] AI 진행 오류:`, err.message);
      }
    }, delay);
  }

  /** AI가 실제로 수를 둔다. */
  runAiTurn(seat) {
    if (!this.engine || this.engine.state.current !== seat) return;
    const p = this.seats[seat];
    if (!p || p.type !== 'ai') return;

    const difficulty = p.difficulty || this.settings.aiDifficulty;
    const prompt = this.prompt;

    // 대기 중인 선택이 있으면 그것부터 처리
    if (prompt && prompt.seat === seat) {
      if (prompt.type === 'goStop') {
        const choice = chooseAiGoStop(this.engine, seat, difficulty);
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
          const view = this.engine.state.players[seat];
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
    const move = chooseAiMove(this.engine, seat, difficulty);
    if (!move) return;

    if (move.kind === 'card') {
      const result = this.engine.playHandCard(move.index, move.floorIndex >= 0 ? move.floorIndex : null);
      this.afterAction(result);
    } else if (move.kind === 'bomb') {
      this.engine.playBomb(move.month);
      this.afterAction(null);
    } else if (move.kind === 'shake') {
      this.engine.declareShake(move.month);
      const idx = this.engine.state.players[seat].hand.findIndex((c) => c.month === move.month);
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

  /** 시간이 넘었으면 강제 진행한다. */
  checkTimeout() {
    if (this.phase !== ROOM_PHASE.PLAY || !this.engine) return false;
    if (!this.deadline || Date.now() < this.deadline) return false;

    const seat = this.engine.state.current;
    const player = this.seats[seat];
    this.logEvent(`${player ? player.name : '플레이어'} 시간 초과 — 자동으로 넘어갑니다.`);
    this.fx.push({ seq: this.fx.length + 1, kind: 'timeout', seat, month: 0, text: '시간 초과!', victimSeat: -1 });

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
    const result = settleGame(this.engine, {
      moneyPerPoint: this.settings.moneyPerPoint,
      stakeMultiplier: this.settings.stakeMultiplier,
    });

    const balances = this.seats.map((p, seat) => ({ seat, money: p ? p.money : 0 }));
    const updated = applyToBalances(balances, result.rows);
    for (const u of updated) {
      const p = this.playerAt(u.seat);
      if (p) p.money = u.money;
    }

    this.settle = { ...result, at: Date.now() };
    this.result = {
      winnerSeat: result.winnerSeat,
      nagari: result.nagari,
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
    const base = {
      code: this.code,
      phase: this.phase || ROOM_PHASE.LOBBY,
      playerCount: this.playerCount,
      hostId: this.hostId,
      isHost: Boolean(viewerId) && viewerId === this.hostId,
      settings: this.settings,
      mySeat: viewerSeat,
      currentSeat: -1,
      deadline: this.deadline,
      prompt: this.prompt,
      players: this.seats
        .map((p, seat) => {
          if (!p) return null;
          return {
            seat: p.seat,
            name: p.name,
            type: p.type,
            money: p.money,
            ready: p.ready,
            connected: p.connected,
            handCount: this.engine ? this.engine.state.players[p.seat].hand.length : 0,
            score: this.engine ? this.engine.scoreOf(p.seat).total : 0,
            goCount: this.engine ? this.engine.state.players[p.seat].goCount : 0,
            shakeCount: this.engine ? this.engine.state.players[p.seat].shakeCount : 0,
          };
        })
        .filter(Boolean),
      table: [],
      deckCount: 0,
      myHand: [],
      seonCandidates: [],
      seonPicked: [],
      settle: this.settle,
      result: this.result,
      serverTime: Date.now(),
    };

    if (this.phase === ROOM_PHASE.SEON) {
      base.seonCandidates = this.seonCandidates.map((cards, seat) =>
        cards && (seat === viewerSeat || this.seonPicked[seat] !== -1)
          ? cards.map((c) => ({ uid: c.uid, id: c.id, imageKey: c.imageKey, month: c.month, name: `${c.month}월` }))
          : []
      );
      base.seonPicked = this.seonPicked.slice();
      return base;
    }

    if (this.engine) {
      base.currentSeat = this.engine.state.current;
      base.table = this.engine.state.floor.map((c) => this.engine.describeCard(c));
      base.deckCount = this.engine.state.stock.length;
      base.winnerSeat = this.engine.state.winner;
      if (viewerSeat >= 0) {
        base.myHand = this.engine.state.players[viewerSeat].hand.map((c) => this.engine.describeCard(c));
      }
    }
    return base;
  }
}

module.exports = {
  Room,
  ROOM_PHASE,
  CODE_LENGTH,
  randomCode,
  DEFAULT_SETTINGS,
};
