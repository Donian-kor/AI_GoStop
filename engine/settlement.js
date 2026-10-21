'use strict';

// 정산 — 판 결과를 가상 포인트로 바꾼다.
//
// 규칙 기준: docs/game-rules.md §10
// 실제 현금은 오가지 않는다. 게임 안에서만 쓰는 가상 포인트(코인)다.

const { PHASE } = require('./play');

/**
 * 한 판의 정산 결과를 만든다.
 * @param {import('./play').TurnEngine} engine
 * @param {object} opts
 * @param {number} opts.moneyPerPoint 1점당 가상 포인트 (기본 100)
 * @param {number} opts.stakeMultiplier 판돈 배수 (나가리 이월분, 기본 1)
 * @returns {{rows: Array, total: number, nagari: boolean, winnerSeat: number}}
 */
function settleGame(engine, { moneyPerPoint = 100, stakeMultiplier = 1 } = {}) {
  const results = engine.finalSettlement();
  const winnerSeat = engine.state.winner;
  const nagari = winnerSeat < 0;

  const rows = results.map((r) => {
    const reasons = [];
    if (r.goCount > 0) reasons.push(`${r.goCount}고`);
    if (r.reverseGo) reasons.push('역고 ×4');
    if (r.shakeCount > 0) reasons.push(`흔들기${r.bombCount > 0 ? `·폭탄 ${r.shakeCount}` : ` ${r.shakeCount}`} ×${2 ** r.shakeCount}`);
    if (r.gwangbak) reasons.push('광박 ×2');
    if (r.pibak) reasons.push('피박 ×2');
    if (r.meongbak) reasons.push('멍박 ×2');
    if (r.gobak) reasons.push('고박 ×2');

    return {
      seat: r.seat,
      name: r.name,
      points: r.points !== undefined ? r.points : r.net, // 정산 점수(면제 전)
      net: r.net, // 실제 이동 점수 (면제 시 0)
      amount: r.net * moneyPerPoint * stakeMultiplier, // 가상 포인트
      reasons,
      // 배수 계산 과정(정산 화면에 그대로 보여준다)
      steps: r.steps,
      goBonus: r.goBonus,
      goMultiplier: r.goMultiplier,
      shakeMultiplier: r.shakeMultiplier,
      bakMultiplier: r.bakMultiplier,
      // 패자가 한 장도 획득하지 못하면 지급을 면제한다(점수는 그대로 유지)
      paymentExempt: r.paymentExempt,
      pibak: r.pibak,
      gwangbak: r.gwangbak,
      meongbak: r.meongbak,
      gobak: r.gobak,
    };
  });

  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  return { rows, total, nagari, winnerSeat };
}

/**
 * 가상 잔액에 정산 결과를 반영한다.
 * @param {Array} players [{ seat, money }]
 * @param {Array} rows settleGame 결과의 rows
 * @returns {Array} 갱신된 players
 */
function applyToBalances(players, rows) {
  const next = players.map((p) => ({ ...p }));
  for (const row of rows) {
    const target = next.find((p) => p.seat === row.seat);
    if (target) target.money = Math.max(0, target.money + row.amount);
  }
  return next;
}

module.exports = {
  settleGame,
  applyToBalances,
};
