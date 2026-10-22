'use strict';

const { evaluateAsLoser, settle } = require('./score');

/**
 * 최종 정산.
 * @param {object} engine 게임 엔진
 * @param {string} chongtongEvent 총통 이벤트 종류
 * @returns {Array} 자리별 { seat, net, pibak, gwangbak, meongbak, gobak, ... }
 */
function calculateFinalSettlement(engine, chongtongEvent) {
  const count = engine.state.playerCount;
  const results = engine.state.players.map((p) => ({
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
  if (engine.state.winner < 0) return results;

  const winner = engine.state.winner;

  // 쓰리뻑·총통 즉시 승리: 고정 점수(2인 7점 / 3인+ 3점), 박·고 배수 미적용
  let instantWin = engine.state.threeBbeok;
  if (!instantWin) {
    for (const evt of engine.state.events) {
      if (evt.kind === chongtongEvent) {
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

  const winnerPlayer = engine.state.players[winner];
  const winBreak = engine.scoreOf(winner);

  // 피박 기준은 인원수에 따라 다르다: 2인(맞고) ≤7, 3인 이상 ≤5
  const scoreOpt = { ...engine.options };
  scoreOpt.pibakMaxJunk = count >= 3 ? 5 : 7;

  let totalToWinner = 0;
  let gobakLoser = -1;

  for (let p = 0; p < count; p++) {
    if (p === winner) continue;

    const loserBreak = evaluateAsLoser(engine.state.players[p].captured, scoreOpt);
    const s = settle(winBreak, loserBreak, winnerPlayer.goCount, winnerPlayer.shakeCount, scoreOpt, winnerPlayer.reverseGo);

    // 패자가 한 장도 획득하지 못하면 점수는 유지하되 지급은 면제한다.
    const paymentExempt = engine.state.players[p].captured.length === 0;

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

    if (engine.state.players[p].goCount > 0) gobakLoser = p;
  }

  // 고박: 고를 부르고 진 사람이 있으면 그 사람이 전액(다른 패자 몫까지)을 ×2로 부담
  if (gobakLoser >= 0) {
    for (let p = 0; p < count; p++) {
      if (p !== winner) results[p].net = 0;
    }
    const gobakTotal = totalToWinner * engine.options.gobakMultiplier;
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

module.exports = { calculateFinalSettlement };
