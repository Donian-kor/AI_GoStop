'use strict';

// 4인 광팔기 — 4명이 모였을 때 한 명이 광을 팔고 3인이 치는 규칙.
//
// 규칙 근거: civilian7/gostop 의 docs/game-rules.md §2 "4인 광팔기"
//            delphi/src/engine/Gostop.Engine.FourPlayer.pas
//
// 요약
//   - 딜: 4명 × 7장, 바닥 6장, 뒷패 17장
//   - 협상 순서: 선(P1)은 무조건 참가, P2 → P3 순으로 포기 가능
//       · P2 포기 → P3·P4 자동 참가      (치는 좌석: P1, P3, P4)
//       · P2 참가 + P3 포기 → P4 자동 참가 (치는 좌석: P1, P2, P4)
//       · P2·P3 모두 참가 → P4 가 광을 팔거나 빠짐 (치는 좌석: P1, P2, P3)
//   - 협상 중에는 바닥 1장만 공개한다 (그대로 보면 치팅이 된다)
//   - 광값 = 광(밝은 패) + 보너스패 개수 + 완성된 족보 점수
//            흔들기 가능(같은 월 3장 이상)이면 전체 ×2
//   - 광값은 선을 제외한 나머지 참가자가 선불로 낸다
//   - 빠진 사람의 손패는 뒷패에 섞어 넣는다 (카드 경제 유지)

const { KIND, RIBBON } = require('./cards');
const { evaluate } = require('./score');

/** 광 1개당 단가. */
const GWANG_UNIT_PRICE = 100;

/**
 * 광값에 해당하는 "광 개수"를 센다.
 * @param {Array} hand 팔 사람이 가진 손패
 * @param {object} options 점수 규칙
 * @returns {number} 광 개수 (완성 족보 점수 포함, 흔들기 가능 시 ×2)
 */
function gwangCount(hand, options = {}) {
  let count = 0;
  for (const card of hand) {
    if (card.kind === KIND.BRIGHT || card.kind === KIND.BONUS) count++;
  }

  const b = evaluate(hand, options);
  count += b.godoriPoints + b.hongdanPoints + b.cheongdanPoints + b.chodanPoints;

  // 흔들기 가능(같은 월 3장 이상)이면 전체 값 ×2
  const byMonth = new Map();
  for (const card of hand) byMonth.set(card.month, (byMonth.get(card.month) || 0) + 1);
  for (const n of byMonth.values()) {
    if (n >= 3) return count * 2;
  }
  return count;
}

/**
 * 광팔기 다이얼로그에 보여줄 카드(광·보너스패 + 완성된 족보의 카드).
 */
function saleCards(hand, options = {}) {
  const out = [];
  for (const card of hand) {
    if (card.kind === KIND.BRIGHT || card.kind === KIND.BONUS) out.push(card);
  }
  const b = evaluate(hand, options);
  for (const card of hand) {
    if (b.godoriPoints > 0 && card.kind === KIND.ANIMAL && card.godori) {
      out.push(card);
    } else if (
      card.kind === KIND.RIBBON &&
      ((b.hongdanPoints > 0 && card.ribbon === RIBBON.HONG) ||
        (b.cheongdanPoints > 0 && card.ribbon === RIBBON.CHEONG) ||
        (b.chodanPoints > 0 && card.ribbon === RIBBON.CHO))
    ) {
      out.push(card);
    }
  }
  return out;
}

/**
 * 협상 결과로 실제 치는 3좌석과 광 정산을 계산한다.
 * @param {object} opts
 * @param {boolean} opts.p2GiveUp P2(좌석 1)가 포기
 * @param {boolean} opts.p3GiveUp P3(좌석 2)가 포기
 * @param {boolean} opts.p4Sell P4(좌석 3)가 광을 판다
 * @param {number} opts.unitPrice 광 1개당 단가
 * @param {Array} opts.sellerHand P4 의 손패
 * @param {object} opts.options 점수 규칙
 * @returns {{playSeats:number[], sitOutSeat:number, gwang:object}}
 */
function resolve({ p2GiveUp, p3GiveUp, p4Sell, unitPrice = GWANG_UNIT_PRICE, sellerHand = [], options = {} }) {
  const gwang = { sold: false, sellerSeat: -1, gwangCount: 0, valuePerPayer: 0, payerSeats: [] };

  if (p2GiveUp) {
    // P2 포기 → P3·P4 자동 참가
    return { playSeats: [0, 2, 3], sitOutSeat: 1, gwang };
  }
  if (p3GiveUp) {
    // P2 참가 · P3 포기 → P4 자동 참가
    return { playSeats: [0, 1, 3], sitOutSeat: 2, gwang };
  }
  // P2·P3 모두 참가 → P4 는 광을 팔거나 그냥 빠진다 (어느 쪽이든 3인)
  if (p4Sell) {
    gwang.sold = true;
    gwang.sellerSeat = 3;
    gwang.gwangCount = gwangCount(sellerHand, options);
    gwang.valuePerPayer = gwang.gwangCount * unitPrice;
    gwang.payerSeats = [1, 2]; // 선(0)은 제외
  }
  return { playSeats: [0, 1, 2], sitOutSeat: 3, gwang };
}

module.exports = {
  GWANG_UNIT_PRICE,
  gwangCount,
  saleCards,
  resolve,
};
