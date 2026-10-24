'use strict';

// 족보 점수 계산 · 박 판정 · 정산.
//
// 규칙 기준: civilian7/gostop 의 docs/game-rules.md §6, §9, §10
// 구현 근거: delphi/src/engine/Gostop.Engine.Score.pas

const { KIND, RIBBON } = require('./cards');

/** 표준 점수 규칙값 (TScoreOptions.Default 와 동일). */
const DEFAULT_OPTIONS = {
  bright3: 3, // 3광 (비광 제외)
  bright3WithBi: 2, // 3광 (비광 포함)
  bright4: 4, // 4광
  bright5: 15, // 5광
  animalThreshold: 5, // 열끗 개수 문턱
  ribbonThreshold: 5, // 띠 개수 문턱
  junkThreshold: 10, // 피값 문턱
  godoriPoints: 5, // 고도리
  danPoints: 3, // 홍단/청단/초단 각 세트
  goBonusPerGo: 1, // 고 1회당 가산점
  goDoubleFromCount: 3, // 이 고 횟수부터 배수 2배 시작
  pibakEnabled: true,
  pibakMaxJunk: 7, // 2인=7, 3인 이상=5 (정산 시 인원수로 덮어씀)
  gwangbakEnabled: true,
  meongbakEnabled: true,
  meongbakMinAnimal: 7, // 멍박: 열끗 7장 이상 보유
  gobakMultiplier: 2, // 고박 배수
  reverseGoEnabled: true,
  reverseGoMultiplier: 4, // 역고 배수
};

/**
 * 소유한 국진이 전환권을 잃었는지(=항상 열끗으로만 계산) 확인.
 */
function hasUnlockedGukjin(captured) {
  return captured.some((c) => c.gukjin && !c.locked);
}

/**
 * 국진 해석(gukjinAsPi) 고정해서 족보 내역 계산.
 * @param {Array} captured 먹은 카드 목록
 * @param {object} options 점수 규칙
 * @param {boolean} gukjinAsPi true 면 국진을 쌍피(피값 2)로 계산
 */
function doEvaluate(captured, options, gukjinAsPi) {
  const r = {
    brightCount: 0,
    brightPoints: 0,
    animalCount: 0,
    animalPoints: 0,
    godoriPoints: 0,
    ribbonCount: 0,
    ribbonPoints: 0,
    hongdanPoints: 0,
    cheongdanPoints: 0,
    chodanPoints: 0,
    junkValue: 0,
    junkPoints: 0,
    total: 0,
    gukjinAsPi: false,
    lines: [],
  };

  let hasBi = false;
  let godoriCount = 0;
  let hong = 0;
  let cheong = 0;
  let cho = 0;

  for (const card of captured) {
    switch (card.kind) {
      case KIND.BRIGHT:
        r.brightCount++;
        if (card.biGwang) hasBi = true;
        break;

      case KIND.ANIMAL:
        // 쌍피 전환권을 잃은 국진은 항상 열끗. 그 외 소유 국진은 호출자가 정한 해석을 따른다.
        if (card.gukjin && !card.locked && gukjinAsPi) {
          r.junkValue += 2;
        } else {
          r.animalCount++;
          if (card.godori) godoriCount++;
        }
        break;

      case KIND.RIBBON:
        r.ribbonCount++;
        if (card.ribbon === RIBBON.HONG) hong++;
        else if (card.ribbon === RIBBON.CHEONG) cheong++;
        else if (card.ribbon === RIBBON.CHO) cho++;
        break;

      case KIND.JUNK:
      case KIND.DOUBLE_JUNK:
      case KIND.BONUS:
        r.junkValue += card.junkValue;
        break;

      default:
        break;
    }
  }

  // 광
  if (r.brightCount >= 5) r.brightPoints = options.bright5;
  else if (r.brightCount === 4) r.brightPoints = options.bright4;
  else if (r.brightCount === 3) r.brightPoints = hasBi ? options.bright3WithBi : options.bright3;
  if (r.brightPoints > 0) {
    const label = r.brightCount === 5 ? '5광' : r.brightCount === 4 ? '4광' : hasBi ? '비삼광' : '삼광';
    const description = r.brightCount === 3 && hasBi ? '비광이 포함된 3광' : `광 ${r.brightCount}장`;
    r.lines.push({ code: 'bright', label, points: r.brightPoints, description });
  }

  // 열끗(개수) + 고도리
  if (r.animalCount >= options.animalThreshold) {
    r.animalPoints = r.animalCount - (options.animalThreshold - 1);
    r.lines.push({ code: 'animal', label: '열끗', points: r.animalPoints, description: `열끗 ${r.animalCount}장` });
  }
  if (godoriCount >= 3) {
    r.godoriPoints = options.godoriPoints;
    r.lines.push({ code: 'godori', label: '고도리', points: r.godoriPoints, description: '2월·4월·8월의 새 패 완성' });
  }

  // 띠(개수) + 홍/청/초단
  if (r.ribbonCount >= options.ribbonThreshold) {
    r.ribbonPoints = r.ribbonCount - (options.ribbonThreshold - 1);
    r.lines.push({ code: 'ribbon', label: '띠', points: r.ribbonPoints, description: `띠 ${r.ribbonCount}장` });
  }
  if (hong >= 3) {
    r.hongdanPoints = options.danPoints;
    r.lines.push({ code: 'hongdan', label: '홍단', points: r.hongdanPoints, description: '1월·2월·3월 홍단 완성' });
  }
  if (cheong >= 3) {
    r.cheongdanPoints = options.danPoints;
    r.lines.push({ code: 'cheongdan', label: '청단', points: r.cheongdanPoints, description: '6월·9월·10월 청단 완성' });
  }
  if (cho >= 3) {
    r.chodanPoints = options.danPoints;
    r.lines.push({ code: 'chodan', label: '초단', points: r.chodanPoints, description: '4월·5월·7월 초단 완성' });
  }

  // 피
  if (r.junkValue >= options.junkThreshold) {
    r.junkPoints = r.junkValue - (options.junkThreshold - 1);
    r.lines.push({ code: 'junk', label: '피', points: r.junkPoints, description: `보너스피·쌍피를 포함해 피 ${r.junkValue}장` });
  }

  r.total =
    r.brightPoints +
    r.animalPoints + r.godoriPoints +
    r.ribbonPoints + r.hongdanPoints + r.cheongdanPoints + r.chodanPoints +
    r.junkPoints;

  return r;
}

/**
 * 승자 관점 족보 내역.
 * 소유 국진은 열끗/쌍피 중 총점이 유리한 쪽을 자동으로 고른다.
 */
function evaluate(captured, options = DEFAULT_OPTIONS) {
  let result = doEvaluate(captured, options, false);
  if (hasUnlockedGukjin(captured)) {
    const asPi = doEvaluate(captured, options, true);
    if (asPi.total > result.total) {
      result = asPi;
      result.gukjinAsPi = true;
    }
  }
  return result;
}

/** 이 피값이면 피박을 면하는지 (피 0장이면 면제, 기준 초과면 면제). */
function isPibakSafe(junkValue, options) {
  return junkValue === 0 || junkValue > options.pibakMaxJunk;
}

/**
 * 패자 관점 족보 내역.
 * 패자의 총점은 정산에 쓰이지 않고 피값·광 장수·열끗 장수만 쓰이므로,
 * 총점보다 "피박 회피"를 우선 기준으로 해석을 고른다.
 */
function evaluateAsLoser(captured, options = DEFAULT_OPTIONS) {
  let result = doEvaluate(captured, options, false);
  if (!hasUnlockedGukjin(captured)) return result;

  const asPi = doEvaluate(captured, options, true);
  const animalSafe = isPibakSafe(result.junkValue, options);
  const piSafe = isPibakSafe(asPi.junkValue, options);

  if (piSafe && !animalSafe) {
    // 쌍피로 봐야만 피박을 면함 → 총점이 낮아져도 그쪽을 선택
    result = asPi;
    result.gukjinAsPi = true;
  } else if (animalSafe === piSafe && asPi.total > result.total) {
    result = asPi;
    result.gukjinAsPi = true;
  }
  return result;
}

/**
 * 승자가 한 패자로부터 받을 점수를 고·흔들기·박을 반영해 계산.
 * @returns {{points:number, multiplier:number, goBonus:number, goMultiplier:number,
 *            pibak:boolean, gwangbak:boolean, meongbak:boolean, reverseGo:boolean}}
 */
function settle(winner, loser, goCount, shakeCount, options = DEFAULT_OPTIONS, reverseGo = false) {
  const goBonus = goCount * options.goBonusPerGo;
  const base = winner.total + goBonus;

  let multiplier = 1;
  let isReverseGo = false;

  if (reverseGo && options.reverseGoEnabled) {
    // 역고(따따블): 고 횟수 배수를 쓰지 않고 고정 배수로 대체. 고 보너스는 그대로 유지.
    isReverseGo = true;
    multiplier = options.reverseGoMultiplier;
  } else if (goCount >= options.goDoubleFromCount) {
    // 3고 ×2, 4고 ×4, 5고 ×8 …
    multiplier *= 2 ** Math.min(goCount - (options.goDoubleFromCount - 1), 10);
  }

  const goMultiplier = multiplier;

  // 흔들기: 각 ×2 (폭탄도 여기에 포함됨)
  let shakeMultiplier = 1;
  if (shakeCount > 0) {
    shakeMultiplier = 2 ** Math.min(shakeCount, 10);
    multiplier *= shakeMultiplier;
  }

  // 광박: 승자가 광 점수를 냈고 패자가 광을 하나도 못 먹음
  let gwangbak = false;
  if (options.gwangbakEnabled && winner.brightPoints > 0 && loser.brightCount === 0) {
    gwangbak = true;
    multiplier *= 2;
  }

  // 피박: 승자가 피 점수를 냈고 패자의 피값이 기준 이하. 단 피가 한 장도 없으면 면제.
  let pibak = false;
  if (options.pibakEnabled && winner.junkPoints > 0 && loser.junkValue > 0 && loser.junkValue <= options.pibakMaxJunk) {
    pibak = true;
    multiplier *= 2;
  }

  // 멍박(열끗박): 승자가 열끗을 7장 이상 보유하고 패자는 열끗 0장
  let meongbak = false;
  if (options.meongbakEnabled && winner.animalCount >= options.meongbakMinAnimal && loser.animalCount === 0) {
    meongbak = true;
    multiplier *= 2;
  }

  const bakMultiplier = multiplier / (goMultiplier * shakeMultiplier);
  const scoreWithGo = base * goMultiplier;
  const scoreWithShake = scoreWithGo * shakeMultiplier;
  const scoreWithBaks = scoreWithShake * bakMultiplier;

  // 배수 계산 과정을 그대로 보여준다(정산 화면용)
  const steps = [
    { label: '기본 점수', formula: `${winner.total}점`, value: winner.total },
    { label: '고 보너스', formula: `${winner.total} + ${goBonus}`, value: base },
    { label: '고 배수', formula: `${base} × ${goMultiplier}`, value: scoreWithGo },
    { label: '흔들기·폭탄', formula: `${scoreWithGo} × ${shakeMultiplier}`, value: scoreWithShake },
    { label: '박 배수', formula: `${scoreWithShake} × ${bakMultiplier}`, value: scoreWithBaks },
  ];

  return {
    points: scoreWithBaks,
    multiplier,
    goBonus,
    goMultiplier,
    shakeMultiplier,
    bakMultiplier,
    steps,
    pibak,
    gwangbak,
    meongbak,
    reverseGo: isReverseGo,
  };
}

/** 사람이 읽을 수 있는 내역 문자열. */
function breakdownToString(b) {
  return (
    `총 ${b.total}점 [광 ${b.brightCount}장=${b.brightPoints}, ` +
    `열끗 ${b.animalCount}장=${b.animalPoints}(고도리 ${b.godoriPoints}), ` +
    `띠 ${b.ribbonCount}장=${b.ribbonPoints}(홍${b.hongdanPoints} 청${b.cheongdanPoints} 초${b.chodanPoints}), ` +
    `피값 ${b.junkValue}=${b.junkPoints}]`
  );
}

module.exports = {
  DEFAULT_OPTIONS,
  evaluate,
  evaluateAsLoser,
  settle,
  doEvaluate,
  hasUnlockedGukjin,
  isPibakSafe,
  breakdownToString,
};
