'use strict';

// AI 상대 — 수 후보를 평가해 가장 좋은 수를 고른다.
//
// 벤치마킹: itsent-lab/hwatu 의 apps/web/src/engine/ai/{evaluator,strategy,settings}.ts
//            (TypeScript → 이 엔진의 상태 모델로 이식)
//
// 설계: 탐욕 평가(evaluator) + 난이도별 "최적 수를 고를 확률" (strategy)
//       딥러닝/몬테카를로가 아니라 **휴리스틱 평가**라 규칙 엔진 위에서 즉시 계산된다.
//       가족용 2인(맞고)·혼자(1인 대 AI) 플레이의 상대 역할.

const { KIND } = require('./cards');
const { evaluate } = require('./score');

/** 난이도별 설정 (itsent-lab AI_DIFFICULTIES 와 동일 구조). */
const AI_DIFFICULTIES = {
  easy: { id: 'easy', label: '쉬움', optimalMoveProbability: 0.37, easyStopProbability: 0.8, goRiskTolerance: 0.25 },
  normal: { id: 'normal', label: '보통', optimalMoveProbability: 0.75, easyStopProbability: 0, goRiskTolerance: 0.52 },
  hard: { id: 'hard', label: '어려움', optimalMoveProbability: 1, easyStopProbability: 0, goRiskTolerance: 0.68 },
  expert: { id: 'expert', label: '초고수', optimalMoveProbability: 1, easyStopProbability: 0, goRiskTolerance: 0 },
};

const AI_DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'expert'];

/** 완성 시 가치가 큰 족보 세트. */
const SET_TAGS = ['godori', 'hongdan', 'cheongdan', 'chodan'];

// ── 카드 평가 ───────────────────────────────────────────────────────────────

/** 카드의 대체 가치. 밝을수록 비싸다. */
function cardValue(card) {
  if (!card) return 0;
  let base;
  if (card.kind === KIND.BRIGHT) base = 8;
  else if (card.kind === KIND.ANIMAL) base = 4.2;
  else if (card.kind === KIND.RIBBON) base = 3.2;
  else if (card.tags.includes('triple-junk')) base = 3.8;
  else if (card.tags.includes('double-junk')) base = 2.4;
  else base = 1.15;

  const special =
    (card.godori ? 1.4 : 0) + (card.gukjin ? 1.2 : 0) + (card.tags.includes('bonus-pee') ? 2.8 : 0);
  return base + special;
}

/** 특정 태그를 가진 카드 수. */
function tagCount(cards, tag) {
  return cards.filter((c) => c.tags && c.tags.includes(tag)).length;
}

/** 이 카드를 먹었을 때 늘어나는 점수. */
function scoreDelta(captured, added) {
  const before = evaluate(captured).total;
  const after = evaluate([...captured, ...added]).total;
  return after - before;
}

/**
 * 족보 완성 진척도 — 세트 완성/진행에 따른 추가 가치.
 * 완성(3장)이면 크게, 2장이면 중간, 1장이면 조금 본다.
 */
function combinationProgress(captured, added) {
  let value = 0;
  const next = [...captured, ...added];
  for (const tag of SET_TAGS) {
    const before = tagCount(captured, tag);
    const after = tagCount(next, tag);
    if (after >= 3 && before < 3) value += tag === 'godori' ? 18 : 11;
    else if (after === 2 && before < 2) value += tag === 'godori' ? 7 : 4.5;
    else if (after === 1 && before === 0) value += 1.2;
  }
  const beforeScore = evaluate(captured);
  const afterScore = evaluate(next);
  if (afterScore.brightCount > beforeScore.brightCount) value += afterScore.brightCount >= 3 ? 7 : 2;
  if (afterScore.animalCount > beforeScore.animalCount) value += Math.max(1, afterScore.animalCount - 3) * 1.2;
  if (afterScore.ribbonCount > beforeScore.ribbonCount) value += Math.max(1, afterScore.ribbonCount - 3);
  if (afterScore.junkValue > beforeScore.junkValue) value += afterScore.junkValue >= 8 ? 2.3 : 0.5;
  return value;
}

/** 상대가 진행 중인 족보를 망치는 가치. */
function denialValue(opponentCaptured, capturedIds) {
  let value = 0;
  for (const tag of SET_TAGS) {
    const opponentCount = tagCount(opponentCaptured, tag);
    const deniedCount = tagCount(capturedIds, tag);
    if (deniedCount > 0 && opponentCount >= 2) value += tag === 'godori' ? 8 : 5;
  }
  return value;
}

/**
 * 상대의 손패에 같은 월 카드가 하나도 없을 확률.
 * (없는 카드풀에서 손패 크기만큼 뽑을 때 하나도 안 맞을 확률)
 */
function noHitProbability(totalUnknown, matchingUnknown, handSize) {
  if (matchingUnknown <= 0 || handSize <= 0 || totalUnknown <= 0) return 1;
  let probability = 1;
  for (let index = 0; index < handSize; index++) {
    const remaining = totalUnknown - index;
    if (remaining <= 0) break;
    probability *= Math.max(0, remaining - matchingUnknown) / remaining;
  }
  return probability;
}

/**
 * 이 카드를 냈을 때 상대가 같은 월 카드를 갖고 있을 위험도.
 * (상대가 먹으면 내 카드가 잡힌다)
 */
function opponentMatchRisk(engine, seat, card) {
  const view = viewOf(engine, seat);
  const visible = [...view.hand, ...engine.state.floor, ...view.captured, ...view.opponentCaptured];
  const visibleMonth = visible.filter((c) => c.month === card.month).length;
  const totalCards = 48 + view.bonusCount;
  const unknownTotal = Math.max(1, totalCards - new Set(visible.map((c) => c.id)).size);
  const matchingUnknown = Math.max(0, 4 - visibleMonth);
  const opponentHandSize = view.opponentHandSize;
  const hitProbability = 1 - noHitProbability(unknownTotal, matchingUnknown, opponentHandSize);
  return hitProbability * (cardValue(card) + 2.4);
}

/** 내 관점에서 본 정보 묶음. */
function viewOf(engine, seat) {
  const players = engine.state.players;
  const me = players[seat];
  const opponent = players.find((p) => p.seat !== seat) || players[0];
  const bonusCount = engine.state.stock.length + players.reduce((s, p) => s + p.hand.length + p.captured.length, 0) + engine.state.floor.length;
  return {
    hand: me.hand,
    captured: me.captured,
    opponentCaptured: opponent.captured,
    opponentHandSize: opponent.hand.length,
    goCount: me.goCount,
    cardDebt: me.cardDebt,
    pendingShakeMonth: me.pendingShakeMonth,
    shakenMonths: me.shakenMonths || [],
    bonusCount: Math.max(0, bonusCount - 48),
  };
}

/** 바닥에서 이 월 카드들을 찾는다. */
function floorMatches(engine, month) {
  return engine.state.floor.filter((c) => c.month === month);
}

/**
 * 바닥에 같은 월 카드가 2장일 때 AI가 가져갈 카드를 고른다.
 * @returns {number} 매칭 목록 안에서의 순번 (0 또는 1). 고를 수 없으면 -1
 */
function chooseAiFloorMatch(engine, seat, month) {
  const matches = floorMatches(engine, month);
  if (matches.length !== 2) return -1;
  const view = viewOf(engine, seat);
  const score = (card) => cardValue(card) + denialValue(view.opponentCaptured, [card]);
  return score(matches[1]) > score(matches[0]) ? 1 : 0;
}

/** 카드 한 장을 냈을 때 잡히는 카드(내 매칭 후보). */
function capturedByCard(engine, seat, card) {
  const matches = floorMatches(engine, card.month);
  if (matches.length === 0) return { capturedIds: [], matchCount: 0 };
  if (matches.length === 2) {
    const ordinal = chooseAiFloorMatch(engine, seat, card.month);
    const selected = ordinal >= 0 ? matches[ordinal] : null;
    return {
      capturedIds: selected ? [selected, card] : [card],
      floorIndex: ordinal,
      matchCount: 2,
    };
  }
  return { capturedIds: [...matches, card], matchCount: matches.length };
}

/** 카드 수를 평가한다. */
function evaluateCard(engine, seat, card, index) {
  const view = viewOf(engine, seat);

  // 보너스패 — 즉시 획득 + 상대 피 1장 뺏기
  if (card.kind === KIND.BONUS) {
    const stolen = [...view.opponentCaptured]
      .filter((c) => c.kind === KIND.JUNK || c.kind === KIND.DOUBLE_JUNK)
      .sort((a, b) => cardValue(a) - cardValue(b))[0];
    const capturedIds = stolen ? [card, stolen] : [card];
    const immediateValue = capturedIds.reduce((sum, c) => sum + cardValue(c), 0) + scoreDelta(view.captured, capturedIds) * 13;
    const combinationValue = combinationProgress(view.captured, capturedIds);
    return {
      kind: 'card',
      index,
      card,
      total: immediateValue + combinationValue * 1.15 + 8.5,
      reason: '보너스패로 한 번 더 진행',
    };
  }

  const capture = capturedByCard(engine, seat, card);
  const capturedValue = capture.capturedIds.reduce((sum, c) => sum + cardValue(c), 0);
  const scoreValue = scoreDelta(view.captured, capture.capturedIds) * 13;
  const immediateValue = capturedValue + scoreValue;
  const combinationValue =
    combinationProgress(view.captured, capture.capturedIds) + denialValue(view.opponentCaptured, capture.capturedIds);

  // 폭탄을 아껴두기 위한 가치 (같은 월 3장 보유 + 바닥에 없음)
  const duplicateCount = view.hand.filter((c) => c.month === card.month).length;
  const bombPreservation = capture.matchCount === 0 && duplicateCount >= 2 ? (duplicateCount - 1) * 1.8 : 0;

  const opponentRisk =
    capture.matchCount === 0 ? opponentMatchRisk(engine, seat, card) + bombPreservation : -capture.matchCount * 0.9;
  const ppeokRisk = capture.matchCount === 1 ? opponentMatchRisk(engine, seat, card) * 0.55 : 0;

  return {
    kind: 'card',
    index,
    card,
    floorIndex: capture.floorIndex,
    total: immediateValue + combinationValue * 1.15 - opponentRisk * 1.25 - ppeokRisk,
    reason: capture.matchCount ? `즉시 ${capture.matchCount}장 매칭` : `상대 매칭 위험`,
  };
}

/** 폭탄 수를 평가한다. */
function evaluateBomb(engine, seat, month) {
  const view = viewOf(engine, seat);
  const handCards = view.hand.filter((c) => c.month === month);
  if (handCards.length < 3) return null;
  const floorCards = floorMatches(engine, month);
  if (floorCards.length < 1) return null;

  const capturedIds = [...handCards, ...floorCards];
  const immediateValue =
    capturedIds.reduce((sum, c) => sum + cardValue(c), 0) + scoreDelta(view.captured, capturedIds) * 13;
  const combinationValue =
    combinationProgress(view.captured, capturedIds) + denialValue(view.opponentCaptured, capturedIds);
  const opponentRisk = -floorCards.reduce((sum, c) => sum + opponentMatchRisk(engine, seat, c), 0) * 0.35;
  const tempoValue = (handCards.length - 1) * 3.2 + (view.hand.length <= 5 ? 2.5 : 0);

  return {
    kind: 'bomb',
    month,
    total: immediateValue + combinationValue * 1.15 - opponentRisk * 1.25 + tempoValue,
    reason: `폭탄으로 ${capturedIds.length}장 확보`,
  };
}

/** 흔들기 수를 평가한다. */
function evaluateShake(engine, seat, month) {
  const view = viewOf(engine, seat);
  const handCards = view.hand.filter((c) => c.month === month);
  if (handCards.length < 3) return null;
  if (floorMatches(engine, month).length > 0) return null;
  if (view.shakenMonths.includes(month)) return null;

  const currentScore = evaluate(view.captured).total;
  const combinationValue = combinationProgress(view.captured, handCards);
  return {
    kind: 'shake',
    month,
    total: 32 + currentScore * 2 + combinationValue - 1.5,
    reason: `${month}월 세 장을 흔들어 배수 확보`,
  };
}

/**
 * AI가 낼 수 있는 모든 수를 평가해 정렬한다.
 * @returns {Array} 평가 내림차순
 */
function evaluateMoves(engine, seat) {
  const view = viewOf(engine, seat);

  // 흔들기를 선언했으면 그 월만 낼 수 있다
  const playable = view.pendingShakeMonth
    ? view.hand.filter((c) => c.month === view.pendingShakeMonth)
    : view.hand;

  const cards = playable.map((c, i) => evaluateCard(engine, seat, c, view.hand.indexOf(c)));

  if (view.pendingShakeMonth) return cards.sort((a, b) => b.total - a.total);

  const moves = [...cards];

  // 폭탄 후보
  const months = new Set(view.hand.map((c) => c.month));
  for (const month of months) {
    const ev = evaluateBomb(engine, seat, month);
    if (ev) moves.push(ev);
  }

  // 흔들기 후보
  for (const month of months) {
    const ev = evaluateShake(engine, seat, month);
    if (ev) moves.push(ev);
  }

  // 폭탄을 아껴둔 채 뒤집기만 하는 수
  if (view.cardDebt > 0) {
    moves.push({
      kind: 'flipOnly',
      total: view.hand.length <= 1 ? 5 : 1 + view.cardDebt * 0.25,
      reason: '보관한 폭탄 빈 차례로 덱만 뒤집기',
    });
  }

  return moves.sort((a, b) => b.total - a.total);
}

/** 상대가 얼마나 위험한지 추정한다. */
function estimatePlayerThreat(engine, seat) {
  const view = viewOf(engine, seat);
  const score = evaluate(view.opponentCaptured);
  let threat = score.total * 1.7;
  if (score.junkValue >= 8) threat += (score.junkValue - 7) * 1.4;
  if (score.brightCount >= 2) threat += 2.2;
  if (score.animalCount >= 4) threat += 1.6;
  if (score.ribbonCount >= 4) threat += 1.4;
  for (const tag of SET_TAGS) {
    if (tagCount(view.opponentCaptured, tag) === 2) threat += tag === 'godori' ? 3.4 : 2;
  }
  return threat;
}

/**
 * 고/스톱을 고른다.
 * @returns {'go'|'stop'}
 */
function chooseAiGoStop(engine, seat, difficulty, rng = Math.random) {
  const config = AI_DIFFICULTIES[difficulty] || AI_DIFFICULTIES.normal;
  const view = viewOf(engine, seat);
  const actionsRemaining = view.hand.length + view.cardDebt;
  if (actionsRemaining <= 0) return 'stop';
  if (difficulty === 'easy') return rng() < config.easyStopProbability ? 'stop' : 'go';

  const currentScore = evaluate(view.captured).total;
  const opponentScore = evaluate(view.opponentCaptured).total;
  const bestFutureMove = evaluateMoves(engine, seat)[0]?.total ?? 0;
  const opponentThreat = estimatePlayerThreat(engine, seat);
  const reward = Math.min(8, bestFutureMove / 6) + actionsRemaining * 0.7 + (currentScore <= 9 ? 2.2 : 0);
  const risk = opponentThreat * (1 - config.goRiskTolerance) + opponentScore * 0.55 + view.goCount * 3.4 + (actionsRemaining <= 2 ? 4 : 0);
  return reward > risk ? 'go' : 'stop';
}

/**
 * AI가 낼 수를 고른다.
 * @param {object} engine TurnEngine
 * @param {number} seat AI 자리
 * @param {string} difficulty 'easy'|'normal'|'hard'|'expert'
 * @param {function} rng 난수 (0~1)
 * @returns {object|null} 선택한 수
 */
function chooseAiMove(engine, seat, difficulty = 'normal', rng = Math.random) {
  const config = AI_DIFFICULTIES[difficulty] || AI_DIFFICULTIES.normal;
  const evaluated = evaluateMoves(engine, seat);
  if (!evaluated.length) return null;
  if (evaluated.length === 1) return evaluated[0];

  const optimal = rng() < config.optimalMoveProbability;
  if (optimal) return evaluated[0];
  const idx = 1 + Math.floor(rng() * (evaluated.length - 1));
  return evaluated[Math.min(idx, evaluated.length - 1)];
}

module.exports = {
  AI_DIFFICULTIES,
  AI_DIFFICULTY_ORDER,
  cardValue,
  evaluateMoves,
  evaluateCard,
  evaluateBomb,
  evaluateShake,
  estimatePlayerThreat,
  chooseAiMove,
  chooseAiGoStop,
  chooseAiFloorMatch,
};
