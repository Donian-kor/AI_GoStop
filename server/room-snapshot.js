'use strict';

const { KIND, STANDARD, displayName } = require('../engine/cards');
const { evaluate } = require('../engine/score');
const { toScoreOptions } = require('../engine/settings');
const fourplayer = require('../engine/fourplayer');

/** 카드 종류별 개수 (획득 요약판용). */
function countKinds(cards) {
  const out = { bright: 0, animal: 0, ribbon: 0, junk: 0, doubleJunk: 0, bonus: 0, bonusValue: 0, total: cards.length };
  for (const c of cards) {
    if (out[c.kind] !== undefined) out[c.kind]++;
    // 보너스패는 2피/3피로 계산되므로 실제 피값을 따로 기록한다
    if (c.kind === 'bonus') out.bonusValue += (c.junkValue || 1);
  }
  return out;
}

/** 족보 달성 진행도 (족보 패널용). */
function setProgress(cards) {
  const tag = (t) => cards.filter((c) => c.tags && c.tags.includes(t)).length;
  return {
    bright: cards.filter((c) => c.kind === KIND.BRIGHT).length,
    animal: cards.filter((c) => c.kind === KIND.ANIMAL).length,
    ribbon: cards.filter((c) => c.kind === KIND.RIBBON).length,
    junk: cards.filter((c) => c.kind === KIND.JUNK || c.kind === KIND.DOUBLE_JUNK || c.kind === KIND.BONUS).length,
    godori: tag('godori'),
    hongdan: tag('hongdan'),
    cheongdan: tag('cheongdan'),
    chodan: tag('chodan'),
  };
}

/** 카드 요약 정보(클라이언트가 족보 묶음을 만들 수 있도록 태그까지). */
function describeCards(engine, cards) {
  return cards.map((c) => ({
    id: c.id,
    imageKey: c.imageKey,
    month: c.month,
    kind: c.kind,
    tags: c.tags || [],
  }));
}

const FIXED_SETS = [
  {
    code: 'guang',
    name: '광',
    line: 'bright',
    need: 3,
    cards: STANDARD.filter((c) => c.kind === KIND.BRIGHT),
  },
  {
    code: 'godori',
    name: '고도리',
    line: 'godori',
    need: 3,
    cards: STANDARD.filter((c) => (c.tags || []).includes('godori')),
  },
  {
    code: 'hongdan',
    name: '홍단',
    line: 'hongdan',
    need: 3,
    cards: STANDARD.filter((c) => (c.tags || []).includes('hongdan')),
  },
  {
    code: 'cheongdan',
    name: '청단',
    line: 'cheongdan',
    need: 3,
    cards: STANDARD.filter((c) => (c.tags || []).includes('cheongdan')),
  },
  {
    code: 'chodan',
    name: '초단',
    line: 'chodan',
    need: 3,
    cards: STANDARD.filter((c) => (c.tags || []).includes('chodan')),
  },
];

const COUNT_SETS = [
  { code: 'animal', name: '열꽃', line: 'animal', need: 5 },
  { code: 'ribbon', name: '띠', line: 'ribbon', need: 5 },
  { code: 'junk', name: '피', line: 'junk', need: 10 },
];

/**
 * 족보 패널에 그릴 내역.
 * @param {Array} captured 내가 먹은 카드
 * @param {object} ev evaluate() 결과 (점수·개수 해석이 이미 반영됨)
 */
function describeJokbo(captured, ev) {
  const owned = new Set(captured.map((c) => c.id));
  const lines = ev.lines || [];
  const points = {};
  for (const line of lines) points[line.code] = line.points;
  const count = { animal: ev.animalCount, ribbon: ev.ribbonCount, junk: ev.junkValue };

  const sets = [];
  for (const set of FIXED_SETS) {
    const have = set.cards.filter((c) => owned.has(c.id)).length;
    sets.push({
      code: set.code,
      name: set.name,
      need: set.need,
      have,
      done: !!points[set.line],
      points: points[set.line] || 0,
      cards: set.cards.map((c) => ({ id: c.id, owned: owned.has(c.id) })),
    });
  }
  for (const set of COUNT_SETS) {
    sets.push({
      code: set.code,
      name: set.name,
      need: set.need,
      have: count[set.code],
      done: !!points[set.line],
      points: points[set.line] || 0,
    });
  }
  return sets;
}

function snapshot(room, viewerSeat, viewerId, roomPhase) {
  const base = {
    code: room.code,
    phase: room.phase || roomPhase.LOBBY,
    playerCount: room.playerCount,
    isHost: Boolean(viewerId) && viewerId === room.hostId,
    settings: room.settings,
    mySeat: viewerSeat,
    currentSeat: -1,
    deadline: room.deadline,
    prompt: room.prompt,
    players: room.seats
      .map((p, seat) => {
        if (!p) return null;
        const e = room.engineSeatOf(seat);
        const inGame = room.engine && e >= 0;
        return {
          seat: p.seat,
          name: p.name,
          type: p.type,
          money: p.money,
          ready: p.ready,
          connected: p.connected,
          handCount: inGame ? room.engine.state.players[e].hand.length : p.hand ? p.hand.length : 0,
          score: inGame ? room.engine.scoreOf(e).total : 0,
          goCount: inGame ? room.engine.state.players[e].goCount : 0,
          shakeCount: inGame ? room.engine.state.players[e].shakeCount : 0,
          cardDebt: inGame ? room.engine.state.players[e].cardDebt : 0,
          shakableMonths: inGame && seat === viewerSeat
            ? (() => {
                const pl = room.engine.state.players[e];
                if (pl.pendingShakeMonth !== 0) return [];
                const months = [];
                const seen = {};
                for (const c of pl.hand) {
                  if (seen[c.month]) continue;
                  seen[c.month] = true;
                  if (pl.shakenMonths.includes(c.month)) continue;
                  if (pl.hand.filter((x) => x.month === c.month).length >= 3) months.push(c.month);
                }
                return months;
              })()
            : [],
          captured: inGame ? countKinds(room.engine.state.players[e].captured) : countKinds(p.hand || []),
          // 상대가 먹은 패를 그림으로 보여주기 위한 공개 정보 (먹은 패는 원래 공개된다)
          capturedCards: inGame ? describeCards(room.engine, room.engine.state.players[e].captured) : [],
          sittingOut: Boolean(room.lastSitOutSeat === seat && room.phase === roomPhase.PLAY),
        };
      })
      .filter(Boolean),
    table: [],
    deckCount: 0,
    myHand: [],
    seonCandidates: [],
    seonPicked: [],
    settle: room.settle,
    result: room.result,
    serverTime: Date.now(),
  };

  if (room.phase === roomPhase.SEON) {
    base.seonCandidates = room.seonCandidates.map((cards, seat) =>
      cards && (seat === viewerSeat || room.seonPicked[seat] !== -1)
        ? cards.map((c) => ({ uid: c.uid, id: c.id, imageKey: c.imageKey, month: c.month, name: `${c.month}월` }))
        : []
    );
    base.seonPicked = room.seonPicked.slice();
    // 선 결정 단계에는 아직 덱이 그대로 있다 — 섞는 연출이 실제 덱 장수를 쓰게 한다
    base.deckCount = room.deck ? room.deck.length : 0;
    return base;
  }

  if (room.phase === roomPhase.NEGOTIATE) {
    // 협상 중에는 바닥 1장만 공개한다 (나머지 5장을 보면 치팅이 된다)
    const openFloor = room.fourFloor && room.fourFloor.length ? [room.fourFloor[0]] : [];
    base.table = openFloor.map((c) => room.engine ? room.engine.describeCard(c) : { id: c.id, imageKey: c.imageKey, month: c.month });
    base.deckCount = room.fourStock ? room.fourStock.length : 0;
    base.negotiation = {
      waitingSeat: room.negotiateWaitingSeat(),
      decisions: { ...room.negotiation.decisions },
      p4Sell: room.negotiation.p4Sell,
      mySaleCards:
        room.negotiateWaitingSeat() === 3 && room.seats[3]
          ? fourplayer.saleCards(room.seats[3].hand || [], toScoreOptions(room.settings)).map((c) => ({
              uid: c.uid,
              id: c.id,
              imageKey: c.imageKey,
              month: c.month,
              name: displayName(c),
            }))
          : [],
      gwangCount:
        room.negotiateWaitingSeat() === 3 && room.seats[3]
          ? fourplayer.gwangCount(room.seats[3].hand || [], toScoreOptions(room.settings))
          : 0,
    };
    base.myHand = viewerSeat >= 0 && room.seats[viewerSeat] ? (room.seats[viewerSeat].hand || []).map((c) => room.engine ? room.engine.describeCard(c) : { id: c.id, imageKey: c.imageKey, month: c.month, name: displayName(c) }) : [];
    return base;
  }

  if (room.engine) {
    base.currentSeat = room.physicalSeatOf(room.engine.state.current);
    base.table = room.engine.state.floor.map((c) => room.engine.describeCard(c));
    base.deckCount = room.engine.state.stock.length;
    base.winnerSeat = room.engine.state.winner < 0
      ? -1
      : room.physicalSeatOf(room.engine.state.winner);
    if (viewerSeat >= 0) {
      const e = room.engineSeatOf(viewerSeat);
      base.myHand = e >= 0 ? room.engine.state.players[e].hand.map((c) => room.engine.describeCard(c)) : [];
      base.mySets = e >= 0 ? setProgress(room.engine.state.players[e].captured) : null;
      // 내가 먹은 패 (실제 화투처럼 카드로 보여주기)
      base.myCaptured = e >= 0 ? describeCards(room.engine, room.engine.state.players[e].captured) : [];
      // 족보 패널 — 필요한 카드를 그림으로 보여주기 위한 내역
      // 점수 옵션은 엔진이 쓰는 것과 똑같이 맞춘다(화면과 정산이 어긋나지 않게).
      base.myJokbo = e >= 0
        ? describeJokbo(
            room.engine.state.players[e].captured,
            evaluate(room.engine.state.players[e].captured, room.engine.options)
          )
        : null;
    }
  }
  return base;
}

module.exports = { snapshot };
