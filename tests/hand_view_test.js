'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(name, listener) {
    (this.listeners[name] || (this.listeners[name] = [])).push(listener);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  click() {
    (this.listeners.click || []).forEach((listener) => listener());
  }
}

function createHandView(mySeat) {
  const hand = new Element('div');
  const playCalls = [];
  const fitCalls = [];
  const window = { document: { createElement: (tagName) => new Element(tagName) } };
  const context = { window };
  vm.runInNewContext(fs.readFileSync('public/hand-view.js', 'utf8'), context);

  const view = window.GostopHandView({
    el: { hand },
    mySeat: () => mySeat,
    fitHandCards: (count) => fitCalls.push(count),
    makeCardEl: (card, className, showMonth) => {
      const element = new Element('div');
      element.className = 'card ' + className + (showMonth === false ? ' hide-month' : '');
      element.card = card;
      return element;
    },
    playCard: (card, index) => playCalls.push({ card, index }),
  });

  return { view, hand, playCalls, fitCalls };
}

test('내 차례의 손패는 바닥과 같은 월을 강조하고 클릭 시 카드와 인덱스를 전달한다', () => {
  const { view, hand, playCalls, fitCalls } = createHandView(0);
  const cards = [
    { id: 'hand-match', month: 2 },
    { id: 'hand-other', month: 5 },
  ];
  view.render({
    currentSeat: 0,
    phase: 'play',
    prompt: null,
    settings: { showMonth: true },
    table: [{ id: 'floor', month: 2 }],
    myHand: cards,
  });

  assert.deepStrictEqual(fitCalls, [2]);
  assert.strictEqual(hand.className, 'hand');
  assert.strictEqual(hand.children[0].className, 'card pick match');
  assert.strictEqual(hand.children[0].attributes['data-card-id'], 'hand-match');
  assert.strictEqual(hand.children[0].children[0].className, 'can-play');
  assert.strictEqual(hand.children[1].className, 'card pick ');
  hand.children[0].click();
  assert.strictEqual(playCalls.length, 1);
  assert.strictEqual(playCalls[0].card, hand.children[0]);
  assert.strictEqual(playCalls[0].index, 0);
  hand.children[1].click();
  assert.strictEqual(playCalls.length, 2);
  assert.strictEqual(playCalls[1].index, 1);
});

test('상대 차례나 선택 프롬프트 중에는 손패를 누를 수 없고 대기 클래스를 표시한다', () => {
  const { view, hand, playCalls, fitCalls } = createHandView(0);
  const state = {
    currentSeat: 1,
    phase: 'play',
    prompt: null,
    table: [{ id: 'floor', month: 2 }],
    myHand: [{ id: 'hand-match', month: 2 }],
  };
  view.render(state);
  assert.strictEqual(hand.className, 'hand waiting');
  assert.strictEqual(hand.children[0].className, 'card ');
  assert.strictEqual(hand.children[0].children.length, 0);
  hand.children[0].click();
  assert.strictEqual(playCalls.length, 0);

  state.currentSeat = 0;
  state.prompt = { type: 'goStop' };
  view.render(state);
  assert.strictEqual(hand.className, 'hand waiting');
  assert.strictEqual(hand.children[0].className, 'card ');
  hand.children[0].click();
  assert.strictEqual(playCalls.length, 0);
  assert.deepStrictEqual(fitCalls, [1, 1]);
});

test('방 설정에서 월 표시를 끄면 내 손패의 월 밴드를 숨긴다', () => {
  const { view, hand } = createHandView(0);
  view.render({
    currentSeat: 0,
    phase: 'play',
    prompt: null,
    settings: { showMonth: false },
    table: [],
    myHand: [{ id: 'hand-hidden-month', month: 2 }],
  });

  assert.strictEqual(hand.children[0].className, 'card pick  hide-month');
});

test('빈 손패도 크기 조정 후 손패 영역을 비운다', () => {
  const { view, hand, fitCalls } = createHandView(0);
  hand.appendChild(new Element('div'));
  view.render({
    currentSeat: 0,
    phase: 'play',
    prompt: null,
    table: [],
    myHand: [],
  });
  assert.deepStrictEqual(fitCalls, [0]);
  assert.strictEqual(hand.children.length, 0);
  assert.strictEqual(hand.className, 'hand');
});
