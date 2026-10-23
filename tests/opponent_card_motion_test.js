'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(rect) {
    this.rect = rect || { left: 0, top: 0, width: 0, height: 0 };
    this.style = {};
    this.children = [];
    this.cards = {};
    this.parentNode = null;
    this.rack = null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  querySelector(selector) {
    if (selector === '.opp-box') return this.rack;
    const match = selector.match(/^\[data-card-id="([^"]+)"\]$/);
    return match ? this.cards[match[1]] || null : null;
  }
}

function createMotion(options) {
  options = options || {};
  const table = new Element();
  const meCaptured = new Element({ left: 100, top: 200, width: 80, height: 40 });
  const players = {};
  const calls = [];
  const flyingCards = {};
  let previousRects = options.previousRects || {};

  (options.tableCards || []).forEach((card) => {
    table.cards[card.id] = card.element;
  });
  Object.keys(options.players || {}).forEach((seat) => {
    players[seat] = options.players[seat];
  });

  const window = {};
  const context = { window };
  vm.runInNewContext(fs.readFileSync('public/opponent-card-motion.js', 'utf8'), context);
  const motion = window.GostopOpponentCardMotion({
    el: { table, meCaptured },
    fx: {
      animateCardMove: (...args) => calls.push(args),
    },
    mySeat: () => options.mySeat === undefined ? 0 : options.mySeat,
    seatEl: (seat) => players[seat] || null,
    getPreviousCardRects: () => previousRects,
    getFlyingCards: () => flyingCards,
    cardImg: ({ id }) => 'assets/' + id + '.png',
  });

  return {
    motion,
    table,
    meCaptured,
    calls,
    flyingCards,
    setPreviousRects: (value) => { previousRects = value; },
  };
}

test('상대 place/bbeok 카드를 자리 중앙에서 바닥으로 날리고 도착 시 숨김 상태를 해제한다', () => {
  const seat = new Element({ left: 20, top: 40, width: 100, height: 60 });
  const card = new Element({ left: 300, top: 400, width: 50, height: 82 });
  const { motion, calls, flyingCards } = createMotion({
    players: { 1: seat },
    tableCards: [{ id: 'place-card', element: card }],
  });
  motion.play([{ kind: 'place', seat: 1, cards: ['place-card'] }]);

  assert.strictEqual(card.style.opacity, '0');
  assert.strictEqual(flyingCards['place-card'], 1);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[0].slice(0, 5))), [
    { left: 45, top: 29, width: 50, height: 82 },
    card.rect,
    'assets/place-card.png',
    340,
    -8,
  ]);
  assert.strictEqual(typeof calls[0][5], 'function');
  calls[0][5]();
  assert.strictEqual(flyingCards['place-card'], undefined);
  assert.strictEqual(card.style.opacity, '');

  const bbeokCard = new Element({ left: 500, top: 100, width: 40, height: 65 });
  const next = createMotion({
    players: { 2: new Element({ left: 0, top: 0, width: 60, height: 60 }) },
    tableCards: [{ id: 'bbeok-card', element: bbeokCard }],
  });
  next.motion.play([{ kind: 'bbeok', seat: 2, cards: ['bbeok-card'] }]);
  assert.strictEqual(next.calls.length, 1);
  assert.strictEqual(next.calls[0][3], 340);
  assert.strictEqual(next.calls[0][4], -8);
});

test('본인이 낸 카드와 바닥에 이미 없는 상대 카드는 이동 연출하지 않는다', () => {
  const own = createMotion({ mySeat: 2 });
  own.motion.play([{ kind: 'place', seat: 2, cards: ['own-card'] }]);
  assert.strictEqual(own.calls.length, 0);

  const missing = createMotion({ players: { 1: new Element() } });
  missing.motion.play([{ kind: 'place', seat: 1, cards: ['already-captured'] }]);
  assert.strictEqual(missing.calls.length, 0);

  const absentSeat = createMotion();
  absentSeat.motion.play([{ kind: 'place', seat: 1, cards: ['card'] }]);
  assert.strictEqual(absentSeat.calls.length, 0);
});

test('capture는 이전 카드 위치를 사용하고 상대의 먹은 패 영역으로 이동시킨다', () => {
  const seat = new Element({ left: 10, top: 20, width: 120, height: 80 });
  seat.rack = new Element({ left: 500, top: 600, width: 180, height: 70 });
  const oldRect = { left: 70, top: 90, width: 45, height: 74 };
  const { motion, calls } = createMotion({
    players: { 1: seat },
    previousRects: { captured: oldRect },
  });
  motion.play([{ kind: 'capture', seat: 1, cards: ['captured'] }]);

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], oldRect);
  assert.strictEqual(calls[0][1], seat.rack.rect);
  assert.strictEqual(calls[0][2], 'assets/captured.png');
  assert.strictEqual(calls[0][3], 380);
  assert.strictEqual(calls[0][4], 10);
});

test('capture는 이전 위치가 없으면 자리 중앙에서 출발하고 본인 캡처 위치로 향한다', () => {
  const { motion, calls, meCaptured } = createMotion();
  motion.play([{ kind: 'capture', seat: 0, cards: ['fallback'] }]);

  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[0][0])), {
    left: 113,
    top: 176,
    width: 54,
    height: 88,
  });
  assert.strictEqual(calls[0][1], meCaptured.rect);

  motion.play(null);
  motion.play([]);
  motion.play([null, { kind: 'capture', seat: -1, cards: ['ignored'] }]);
  assert.strictEqual(calls.length, 1);
});
