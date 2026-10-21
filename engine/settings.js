'use strict';

// 방 설정 (하우스룰) 기본값.
//
// 규칙 기준: docs/game-rules.md 의 "설정 가능 항목"
// 가족끼리 규칙이 다르면 정산에서 다투게 되므로 방 만들 때 맞춰 고른다.

/** 기본 설정. */
const DEFAULT_SETTINGS = {
  playerCount: 3, // 2 = 맞고, 3 = 삼파전
  bonusPack: 50, // 보너스패 구성: 48 | 50 | 51
  moneyPerPoint: 100, // 1점당 가상 포인트
  seedMoney: 30000, // 플레이어 시작 잔액
  timeLimit: {
    enabled: false, // 시간제한 사용 여부
    base: 30, // 첫 수 제한 시간(초)
    increment: 5, // 이후 수마다 추가되는 시간(초)
  },
  bak: {
    pi: true, // 피박
    gwang: true, // 광박
    meong: true, // 멍박(열꽃박)
    go: true, // 고박
  },
  reverseGo: true, // 역고(따따블) 규칙
  stakeMultiplier: 1, // 판돈 배수 (나가리 이월)
};

/** 시간제한 프리셋 목록 (방 설정 화면용). */
const TIME_LIMIT_PRESETS = [
  { id: 'off', label: '제한 없음', enabled: false, base: 0, increment: 0 },
  { id: '30', label: '30초 + 5초', enabled: true, base: 30, increment: 5 },
  { id: '45', label: '45초 + 5초', enabled: true, base: 45, increment: 5 },
  { id: '60', label: '60초 + 10초', enabled: true, base: 60, increment: 10 },
];

/** 보너스패 구성 목록. */
const BONUS_PACKS = [
  { id: 48, label: '48장 (보너스 없음)' },
  { id: 50, label: '50장 (쌍피 1 + 조커 1)' },
  { id: 51, label: '51장 (쌍피 2 + 3피 1)' },
];

/** 유한한 양의 정수만 통과시키고, 아니면 기본값으로 되돌린다. */
function positiveInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** 유한한 0 이상의 정수만 통과시키고, 아니면 기본값으로 되돌린다. */
function nonNegativeInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** 방 설정을 기본값과 병합하되, 허용된 값만 반영한다. */
function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input };
  s.timeLimit = { ...DEFAULT_SETTINGS.timeLimit, ...(input.timeLimit || {}) };
  s.bak = { ...DEFAULT_SETTINGS.bak, ...(input.bak || {}) };

  if (![2, 3].includes(Number(s.playerCount))) s.playerCount = DEFAULT_SETTINGS.playerCount;
  if (![48, 50, 51].includes(Number(s.bonusPack))) s.bonusPack = DEFAULT_SETTINGS.bonusPack;
  s.playerCount = Number(s.playerCount);
  s.bonusPack = Number(s.bonusPack);

  s.moneyPerPoint = positiveInt(s.moneyPerPoint, DEFAULT_SETTINGS.moneyPerPoint, 1, 100000);
  s.seedMoney = nonNegativeInt(s.seedMoney, DEFAULT_SETTINGS.seedMoney, 0, 100000000);
  s.stakeMultiplier = positiveInt(s.stakeMultiplier, 1, 1, 1024);

  s.timeLimit.base = positiveInt(s.timeLimit.base, DEFAULT_SETTINGS.timeLimit.base, 5, 300);
  s.timeLimit.increment = nonNegativeInt(s.timeLimit.increment, 0, 0, 120);
  s.timeLimit.enabled = Boolean(s.timeLimit.enabled);

  return s;
}

/** 점수 계산기에 넘길 규칙 옵션 (박 on/off 반영). */
function toScoreOptions(settings) {
  return {
    pibakEnabled: settings.bak.pi,
    gwangbakEnabled: settings.bak.gwang,
    meongbakEnabled: settings.bak.meong,
    reverseGoEnabled: settings.reverseGo,
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  TIME_LIMIT_PRESETS,
  BONUS_PACKS,
  normalizeSettings,
  toScoreOptions,
};
