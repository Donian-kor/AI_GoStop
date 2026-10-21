'use strict';

// 딜(패 돌리기).
//
// 규칙 기준: docs/game-rules.md §2
// 구현 근거: delphi/src/engine/Gostop.Engine.Deal.pas (TDealer.Deal / TDealConfig.Schedule)
//
// 딜 리듬: [바닥 묶음 → 플레이어별 손패 묶음]을 두 바퀴.
//   2인: 바닥4 → 손패5 → 바닥4 → 손패5
//   3인: 바닥3 → 손패4 → 바닥3 → 손패3   (손패 7장을 두 묶음으로 못 나누므로 첫 바퀴가 4장 흡수)
// 손패는 "선 다음 자리"부터 받고 선이 마지막에 받는다.

const { KIND } = require('./cards');

/** 인원수별 표준 딜 구성. */
const DEAL_CONFIGS = {
  2: { playerCount: 2, handSize: 10, floorSize: 8 },
  3: { playerCount: 3, handSize: 7, floorSize: 6 },
};

/** 손패 정렬 기준 (THwatuKind ordinal). */
const KIND_ORDER = {
  [KIND.BRIGHT]: 0,
  [KIND.ANIMAL]: 1,
  [KIND.RIBBON]: 2,
  [KIND.JUNK]: 3,
  [KIND.BONUS]: 4,
};

function configFor(playerCount) {
  const cfg = DEAL_CONFIGS[playerCount];
  if (!cfg) throw new Error(`${playerCount}인 표준 딜 구성이 정의되지 않았습니다.`);
  return cfg;
}

/** 딜 스텝 순서. */
function scheduleFor(config) {
  const floorLast = Math.floor(config.floorSize / 2);
  const handLast = Math.floor(config.handSize / 2);
  return [
    { kind: 'floor', count: config.floorSize - floorLast },
    { kind: 'hand', count: config.handSize - handLast },
    { kind: 'floor', count: floorLast },
    { kind: 'hand', count: handLast },
  ].filter((s) => s.count > 0);
}

/** 손패 정렬: 월 → 종류 → 순번. */
function sortHand(hand) {
  hand.sort((a, b) => {
    if (a.month !== b.month) return a.month - b.month;
    const ka = KIND_ORDER[a.kind];
    const kb = KIND_ORDER[b.kind];
    if (ka !== kb) return ka - kb;
    return a.ordinal - b.ordinal;
  });
  return hand;
}

/**
 * 덱을 나눠 준다.
 * @param {Array} deck 카드 카탈로그 배열 — **마지막 원소가 맨 위**. 이 배열을 소비한다.
 * @param {number} playerCount 2 또는 3
 * @param {number} seonIndex 선(先) 자리
 * @returns {{hands: Array<Array>, floor: Array, stock: Array, config: object}}
 */
function deal(deck, playerCount, seonIndex) {
  const config = configFor(playerCount);
  if (deck.length < config.playerCount * config.handSize + config.floorSize) {
    throw new Error(`덱이 ${deck.length}장뿐이라 ${config.playerCount}인 구성을 분배할 수 없습니다.`);
  }

  const seats = config.playerCount;
  const seon = ((seonIndex % seats) + seats) % seats;
  const hands = Array.from({ length: seats }, () => []);
  const floor = [];

  let uidSeq = 0;
  const draw = () => {
    const card = deck.pop(); // 맨 위에서 꺼낸다
    card.uid = `c${++uidSeq}`;
    return card;
  };

  for (const step of scheduleFor(config)) {
    if (step.kind === 'floor') {
      for (let k = 0; k < step.count; k++) floor.push(draw());
    } else {
      // 선은 마지막에 받는다 — 첫 묶음은 선 다음 자리부터 좌석 순환
      for (let turn = 1; turn <= seats; turn++) {
        const seat = (seon + turn) % seats;
        for (let k = 0; k < step.count; k++) hands[seat].push(draw());
      }
    }
  }

  // 참고: 손패는 딜된 순서 그대로 유지한다(정렬하지 않는다).
  // 정본 구현의 TTableState.SortHands 는 어디에서도 호출되지 않아,
  // 손패 인덱스는 딜 순서를 기준으로 한다. 정렬은 화면 표시용으로만 쓴다.

  // 남은 카드가 뒷패 — 마지막 원소가 맨 위
  return { hands, floor, stock: deck, config };
}

/**
 * 밤일낮장으로 선(先)을 정한다.
 * 낮(06:00~17:59)은 가장 **큰 월**이 선, 밤은 가장 **작은 월**이 선.
 * 최고월 동점이면 그자끼리 재경합한다(여러 명이면 winners 로 돌려준다).
 * @param {number[]} revealed 각자가 뒤집은 카드의 월
 * @param {number} hour 현재 시각 (0~23)
 * @returns {{winner:number, winners:number[], value:number, isDay:boolean}}
 */
function pickSeon(revealed, hour) {
  const isDay = hour >= 6 && hour < 18;
  const value = isDay ? Math.max(...revealed) : Math.min(...revealed);
  const winners = [];
  for (let i = 0; i < revealed.length; i++) {
    if (revealed[i] === value) winners.push(i);
  }
  return { winner: winners[0], winners, value, isDay };
}

module.exports = {
  DEAL_CONFIGS,
  configFor,
  scheduleFor,
  sortHand,
  deal,
  pickSeon,
};
