'use strict';

// 화투 카드 카탈로그.
//
// 규칙 기준: itsent-lab/hwatu 의 apps/web/src/engine/cards.ts (사용자 본인 프로젝트)
//            civilian7/gostop 의 docs/game-rules.md
// 자산 기준: Wikimedia Commons "Category:SVG Hwatu" (Spenĉjo / Marcus Richert, CC BY-SA 4.0)
//
// 카드 ID 두 가지를 함께 쓴다.
//   id       : 내부 ID (에셋명 기반)  — 예) january_hikari
//   imageKey : itsent-lab 호환 ID    — 예) m01-01  (= assets/hwatu/svg/m01-01.svg)
//   imageKey 규격: m{월 2자리}-{월 안에서 1~4번째}
//     m01-01 1월 광 / m01-02 1월 띠 / m01-03·04 1월 피
//     m11-01 11월 광 / m11-02 11월 쌍피 / m11-03·04 11월 피
//     m12-01 12월 비광 / m12-02 열끗 / m12-03 비띠 / m12-04 비쌍피

const KIND = {
  BRIGHT: 'bright', // 광(光)
  ANIMAL: 'animal', // 열끗
  RIBBON: 'ribbon', // 띠(단)
  JUNK: 'junk', // 피(껍데기)
  DOUBLE_JUNK: 'doubleJunk', // 쌍피
  BONUS: 'bonus', // 보너스패(조커)
};

const RIBBON = {
  NONE: 'none', // 일반 띠 또는 띠 아님
  HONG: 'hong', // 홍단 (1·2·3월)
  CHEONG: 'cheong', // 청단 (6·9·10월)
  CHO: 'cho', // 초단 (4·5·7월)
  RAIN: 'rain', // 비띠 (12월) — 어느 세트에도 속하지 않음
};

const MONTH_NAMES = ['송학', '매조', '벚꽃', '흑싸리', '난초', '모란', '홍싸리', '공산', '국화', '단풍', '똥', '비'];

// [월, 종류, 월내번호, imageKey, 내부id, 피값, 띠색, 고도리, 비광, 국진, 태그]
const STANDARD_ROWS = [
  // 1월 송학: 광 · 홍단 · 피2
  [1, KIND.BRIGHT, 1, 'm01-01', 'january_hikari', 0, RIBBON.NONE, false, false, false, ['bright']],
  [1, KIND.RIBBON, 1, 'm01-02', 'january_tanzaku', 0, RIBBON.HONG, false, false, false, ['ribbon', 'hongdan']],
  [1, KIND.JUNK, 1, 'm01-03', 'january_kasu_1', 1, RIBBON.NONE, false, false, false, ['junk']],
  [1, KIND.JUNK, 2, 'm01-04', 'january_kasu_2', 1, RIBBON.NONE, false, false, false, ['junk']],
  // 2월 매조: 열끗(고도리) · 홍단 · 피2
  [2, KIND.ANIMAL, 1, 'm02-01', 'february_tane', 0, RIBBON.NONE, true, false, false, ['animal', 'godori']],
  [2, KIND.RIBBON, 1, 'm02-02', 'february_tanzaku', 0, RIBBON.HONG, false, false, false, ['ribbon', 'hongdan']],
  [2, KIND.JUNK, 1, 'm02-03', 'february_kasu_1', 1, RIBBON.NONE, false, false, false, ['junk']],
  [2, KIND.JUNK, 2, 'm02-04', 'february_kasu_2', 1, RIBBON.NONE, false, false, false, ['junk']],
  // 3월 벚꽃: 광 · 홍단 · 피2
  [3, KIND.BRIGHT, 1, 'm03-01', 'march_hikari', 0, RIBBON.NONE, false, false, false, ['bright']],
  [3, KIND.RIBBON, 1, 'm03-02', 'march_tanzaku', 0, RIBBON.HONG, false, false, false, ['ribbon', 'hongdan']],
  [3, KIND.JUNK, 1, 'm03-03', 'march_kasu_1', 1, RIBBON.NONE, false, false, false, ['junk']],
  [3, KIND.JUNK, 2, 'm03-04', 'march_kasu_2', 1, RIBBON.NONE, false, false, false, ['junk']],
  // 4월 흑싸리: 열끗(고도리) · 초단 · 피2
  [4, KIND.ANIMAL, 1, 'm04-01', 'april_tane', 0, RIBBON.NONE, true, false, false, ['animal', 'godori']],
  [4, KIND.RIBBON, 1, 'm04-02', 'april_tanzaku', 0, RIBBON.CHO, false, false, false, ['ribbon', 'chodan']],
  [4, KIND.JUNK, 1, 'm04-03', 'april_kasu_1', 1, RIBBON.NONE, false, false, false, ['junk']],
  [4, KIND.JUNK, 2, 'm04-04', 'april_kasu_2', 1, RIBBON.NONE, false, false, false, ['junk']],
  // 5월 난초: 열끗 · 초단 · 피2
  [5, KIND.ANIMAL, 1, 'm05-01', 'may_tane', 0, RIBBON.NONE, false, false, false, ['animal']],
  [5, KIND.RIBBON, 1, 'm05-02', 'may_tanzaku', 0, RIBBON.CHO, false, false, false, ['ribbon', 'chodan']],
  [5, KIND.JUNK, 1, 'm05-03', 'may_kasu_1', 1, RIBBON.NONE, false, false, false, ['junk']],
  [5, KIND.JUNK, 2, 'm05-04', 'may_kasu_2', 1, RIBBON.NONE, false, false, false, ['junk']],
  // 6월 모란: 열끗 · 청단 · 피2
  [6, KIND.ANIMAL, 1, 'm06-01', 'june_tane', 0, RIBBON.NONE, false, false, false, ['animal']],
  [6, KIND.RIBBON, 1, 'm06-02', 'june_tanzaku', 0, RIBBON.CHEONG, false, false, false, ['ribbon', 'cheongdan']],
  [6, KIND.JUNK, 1, 'm06-03', 'june_kasu_1', 1, RIBBON.NONE, false, false, false, ['junk']],
  [6, KIND.JUNK, 2, 'm06-04', 'june_kasu_2', 1, RIBBON.NONE, false, false, false, ['junk']],
  // 7월 홍싸리: 열끗 · 초단 · 피2
  [7, KIND.ANIMAL, 1, 'm07-01', 'july_tane', 0, RIBBON.NONE, false, false, false, ['animal']],
  [7, KIND.RIBBON, 1, 'm07-02', 'july_tanzaku', 0, RIBBON.CHO, false, false, false, ['ribbon', 'chodan']],
  [7, KIND.JUNK, 1, 'm07-03', 'july_kasu_1', 1, RIBBON.NONE, false, false, false, ['junk']],
  [7, KIND.JUNK, 2, 'm07-04', 'july_kasu_2', 1, RIBBON.NONE, false, false, false, ['junk']],
  // 8월 공산: 광 · 열끗(고도리) · 피2
  [8, KIND.BRIGHT, 1, 'm08-01', 'august_hikari', 0, RIBBON.NONE, false, false, false, ['bright']],
  [8, KIND.ANIMAL, 1, 'm08-02', 'august_tane', 0, RIBBON.NONE, true, false, false, ['animal', 'godori']],
  [8, KIND.JUNK, 1, 'm08-03', 'august_kasu_1', 1, RIBBON.NONE, false, false, false, ['junk']],
  [8, KIND.JUNK, 2, 'm08-04', 'august_kasu_2', 1, RIBBON.NONE, false, false, false, ['junk']],
  // 9월 국화: 열끗(국진) · 청단 · 피2
  [9, KIND.ANIMAL, 1, 'm09-01', 'september_tane', 0, RIBBON.NONE, false, false, true, ['animal', 'gookjin']],
  [9, KIND.RIBBON, 1, 'm09-02', 'september_tanzaku', 0, RIBBON.CHEONG, false, false, false, ['ribbon', 'cheongdan']],
  [9, KIND.JUNK, 1, 'm09-03', 'september_kasu_1', 1, RIBBON.NONE, false, false, false, ['junk']],
  [9, KIND.JUNK, 2, 'm09-04', 'september_kasu_2', 1, RIBBON.NONE, false, false, false, ['junk']],
  // 10월 단풍: 열끗 · 청단 · 피2
  [10, KIND.ANIMAL, 1, 'm10-01', 'october_tane', 0, RIBBON.NONE, false, false, false, ['animal']],
  [10, KIND.RIBBON, 1, 'm10-02', 'october_tanzaku', 0, RIBBON.CHEONG, false, false, false, ['ribbon', 'cheongdan']],
  [10, KIND.JUNK, 1, 'm10-03', 'october_kasu_1', 1, RIBBON.NONE, false, false, false, ['junk']],
  [10, KIND.JUNK, 2, 'm10-04', 'october_kasu_2', 1, RIBBON.NONE, false, false, false, ['junk']],
  // 11월 똥: 똥광 · 똥쌍피 · 똥피2   (쌍피는 화투 관례상 가운데 자리)
  [11, KIND.BRIGHT, 1, 'm11-01', 'november_hikari', 0, RIBBON.NONE, false, false, false, ['bright']],
  [11, KIND.DOUBLE_JUNK, 1, 'm11-02', 'november_kasu_2', 2, RIBBON.NONE, false, false, false, ['junk', 'double-junk']],
  [11, KIND.JUNK, 1, 'm11-03', 'november_kasu_1', 1, RIBBON.NONE, false, false, false, ['junk']],
  [11, KIND.JUNK, 2, 'm11-04', 'november_kasu_3', 1, RIBBON.NONE, false, false, false, ['junk']],
  // 12월 비: 비광 · 열끗 · 비띠 · 비쌍피
  [12, KIND.BRIGHT, 1, 'm12-01', 'december_hikari', 0, RIBBON.NONE, false, true, false, ['bright', 'rain-bright']],
  [12, KIND.ANIMAL, 1, 'm12-02', 'december_tane', 0, RIBBON.NONE, false, false, false, ['animal']],
  [12, KIND.RIBBON, 1, 'm12-03', 'december_tanzaku', 0, RIBBON.RAIN, false, false, false, ['ribbon', 'rain-ribbon']],
  [12, KIND.DOUBLE_JUNK, 1, 'm12-04', 'december_kasu', 2, RIBBON.NONE, false, false, false, ['junk', 'double-junk']],
];

// 보너스패: [순번, id, imageKey(파일명), 피값, 태그]
// 보너스패는 정규 카드와 달리 itsent-lab 규약에 없으므로 파일명 stem 을 그대로 쓴다.
const BONUS_ROWS = [
  [1, 'bonus_ssangpi_1', 'bonus_ssangpi_1', 2, ['junk', 'double-junk', 'bonus-pee']],
  [2, 'bonus_ssangpi_2', 'bonus_ssangpi_2', 2, ['junk', 'double-junk', 'bonus-pee']],
  [3, 'bonus_sampi', 'bonus_sampi', 3, ['junk', 'double-junk', 'triple-junk', 'bonus-pee']],
  [4, 'bonus_joker', 'bonus_joker', 2, ['junk', 'double-junk', 'bonus-pee']],
];

function rowToCard(row) {
  const [month, kind, ordinal, imageKey, id, junkValue, ribbon, godori, biGwang, gukjin, tags] = row;
  return { id, imageKey, month, kind, ordinal, junkValue, ribbon, godori, biGwang, gukjin, tags };
}

const STANDARD = STANDARD_ROWS.map(rowToCard);
const BONUS = BONUS_ROWS.map(([ordinal, id, imageKey, junkValue, tags]) => ({
  id,
  imageKey,
  month: 0,
  kind: KIND.BONUS,
  ordinal,
  junkValue,
  ribbon: RIBBON.NONE,
  godori: false,
  biGwang: false,
  gukjin: false,
  tags,
}));

const BY_ID = new Map();
const BY_IMAGE_KEY = new Map();
for (const c of STANDARD) {
  BY_ID.set(c.id, c);
  BY_IMAGE_KEY.set(c.imageKey, c);
}
for (const c of BONUS) {
  BY_ID.set(c.id, c);
  BY_IMAGE_KEY.set(c.imageKey, c);
}

/**
 * 물리 카드 1장을 만든다(uid 는 판 안에서 유일).
 * 'locked' 는 국진 잠금 상태를 담기 위한 필드.
 */
function instantiate(catalogCard, uid) {
  return { ...catalogCard, uid, locked: false };
}

/** 내부 ID 로 카탈로그 카드를 찾는다. 없으면 null. */
function byAssetId(id) {
  return BY_ID.get(id) || null;
}

/** itsent-lab 호환 ID(m01-01) 로 카탈로그 카드를 찾는다. 없으면 null. */
function byImageKey(key) {
  return BY_IMAGE_KEY.get(key) || null;
}

/** 사람이 읽을 카드 이름. 예: '11월 똥 피3', '9월 국화 열끗' */
function displayName(card) {
  if (card.kind === KIND.BONUS) {
    if (card.junkValue === 3) return '보너스 3피';
    if (card.junkValue === 2) return '보너스 쌍피';
    return '보너스패';
  }
  if (card.kind === KIND.JUNK || card.kind === KIND.DOUBLE_JUNK) {
    return `${card.month}월 ${MONTH_NAMES[card.month - 1]} 피${card.ordinal}`;
  }
  const kindName = { bright: '광', animal: '열끗', ribbon: '띠' }[card.kind] || '';
  return `${card.month}월 ${MONTH_NAMES[card.month - 1]} ${kindName}`;
}

module.exports = {
  KIND,
  RIBBON,
  MONTH_NAMES,
  STANDARD,
  BONUS,
  byAssetId,
  byImageKey,
  instantiate,
  displayName,
};
