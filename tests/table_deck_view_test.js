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
    this.className = '';
    this.parentNode = null;
    this.style = {};
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
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  descendants() {
    const found = [];
    for (const child of this.children) {
      found.push(child);
      found.push(...child.descendants());
    }
    return found;
  }

  querySelectorAll(selector) {
    if (selector !== '[data-card-id]') return [];
    return this.descendants().filter((el) => el.getAttribute('data-card-id') !== null);
  }
}

function findAll(element, className) {
  const found = [];
  for (const child of element.children) {
    if (child.className.split(' ').includes(className)) found.push(child);
    found.push(...findAll(child, className));
  }
  return found;
}

function createView() {
  const table = new Element('div');
  const tableHint = new Element('div');
  const deckStack = new Element('div');
  const window = { document: { createElement: (tagName) => new Element(tagName) } };
  const context = { window };
  vm.runInNewContext(fs.readFileSync('public/table-deck-view.js', 'utf8'), context);

  const view = window.GostopTableDeckView({
    el: { table, tableHint, deckStack },
    makeCardEl: (card, className, showMonth) => {
      const element = new Element('div');
      element.className = 'card ' + className + (showMonth === false ? ' hide-month' : '');
      element.card = card;
      return element;
    },
    updateCardEl: (element, card, className, showMonth) => {
      element.className = 'card ' + className + (showMonth === false ? ' hide-month' : '');
      element.card = card;
      return element;
    },
  });

  return { view, table, tableHint, deckStack };
}

test('바닥 패를 순서대로 렌더링하고 카드 식별자와 장수를 표시한다', () => {
  const { view, table, tableHint } = createView();
  const cards = [
    { id: 'floor-a', month: 3 },
    { id: 'floor-b', month: 1 },
    { id: 'floor-c', month: 3 },
  ];
  view.render({ settings: { showMonth: true }, table: cards, deckCount: 0 });

  assert.strictEqual(table.children.length, 2);
  assert.strictEqual(table.children[0].className, 'floor-month-group');
  assert.strictEqual(table.children[0].attributes['data-month'], '1');
  assert.strictEqual(table.children[0].children.length, 1);
  assert.strictEqual(table.children[0].children[0].card, cards[1]);
  assert.strictEqual(table.children[1].attributes['data-month'], '3');
  assert.strictEqual(table.children[1].children.length, 2);
  assert.strictEqual(table.children[1].children[0].className, 'card small');
  assert.strictEqual(table.children[1].children[0].attributes['data-card-id'], 'floor-a');
  assert.strictEqual(table.children[1].children[1].attributes['data-card-id'], 'floor-c');
  assert.strictEqual(tableHint.innerHTML, '바닥 3장');
});

test('뒷패 더미는 최대 다섯 장을 그리되 실제 남은 장수를 표시한다', () => {
  const { view, deckStack } = createView();
  view.render({ table: [], deckCount: 8 });

  assert.strictEqual(deckStack.children.length, 2);
  assert.strictEqual(deckStack.children[0].className, 'deck');
  assert.strictEqual(findAll(deckStack, 'back').length, 5);
  assert.strictEqual(deckStack.children[1].className, 'deck-count');
  assert.strictEqual(deckStack.children[1].innerHTML, '뒷패 8장');
});

test('방 설정에서 월 표시를 끄면 바닥패의 월 밴드를 숨긴다', () => {
  const { view, table } = createView();
  view.render({
    settings: { showMonth: false },
    table: [{ id: 'hidden-month-floor', month: 3 }],
    deckCount: 0,
  });

  assert.strictEqual(table.children[0].children[0].className, 'card small hide-month');
});

test('바닥과 뒷패가 비면 이전 내용을 모두 지운다', () => {
  const { view, table, tableHint, deckStack } = createView();
  view.render({ table: [{ id: 'old-floor' }], deckCount: 2 });
  view.render({ table: [], deckCount: 0 });

  assert.strictEqual(table.children.length, 0);
  assert.strictEqual(tableHint.innerHTML, '');
  assert.strictEqual(deckStack.children.length, 0);
});

test('같은 바닥패는 다시 그려도 요소를 재사용한다', () => {
  const { view, table } = createView();
  const card = { id: 'reuse-floor', month: 3 };
  view.render({ settings: { showMonth: true }, table: [card], deckCount: 0 });
  const first = table.children[0].children[0];

  view.render({ settings: { showMonth: true }, table: [card], deckCount: 0 });
  assert.strictEqual(table.children[0].children[0], first);
});
