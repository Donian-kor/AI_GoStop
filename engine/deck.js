'use strict';

// 덱 생성 · 셔플 · 순서 주입.
//
// 규칙/구현 근거: delphi/src/engine/Gostop.Engine.Deck.pas
// 덱 배열의 **마지막 원소가 맨 위**다 (Draw 시 끝에서 꺼낸다).

const { STANDARD, byAssetId } = require('./cards');

/** 결정적 난수 생성기 (mulberry32). 같은 시드 → 같은 순열. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 암호학적 난수로 시드 생성. */
function randomSeed() {
  return require('crypto').randomBytes(4).readUInt32LE(0);
}

/**
 * 보너스패 구성에 따른 전체 덱(카드 카탈로그 배열).
 * @param {number} pack 48 | 50 | 51
 */
function createDeck(pack = 50) {
  const list = STANDARD.slice();
  if (pack === 50) {
    list.push(byAssetId('bonus_ssangpi_1'));
    list.push({ ...byAssetId('bonus_joker') });
  } else if (pack === 51) {
    list.push(byAssetId('bonus_ssangpi_1'));
    list.push(byAssetId('bonus_ssangpi_2'));
    list.push(byAssetId('bonus_sampi'));
  }
  return list;
}

/**
 * assetId 목록으로 덱을 만든다 (리플레이용).
 * 주어진 순서 그대로 배열에 담고, 마지막 원소가 맨 위로 취급한다.
 */
function deckFromAssetIds(assetIds) {
  return assetIds.map((id) => {
    const c = byAssetId(id);
    if (!c) throw new Error(`알 수 없는 카드 assetId: ${id}`);
    return { ...c };
  });
}

/** Fisher–Yates 셔플 (배열 안쪽, 결정적 rng 사용). */
function shuffle(cards, rng) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = cards[i];
    cards[i] = cards[j];
    cards[j] = tmp;
  }
  return cards;
}

/** 셔플된 덱 생성. */
function shuffledDeck(pack = 50, seed = randomSeed()) {
  return shuffle(createDeck(pack), mulberry32(seed));
}

module.exports = {
  mulberry32,
  randomSeed,
  createDeck,
  deckFromAssetIds,
  shuffle,
  shuffledDeck,
};
