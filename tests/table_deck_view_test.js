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

  setAttribute(name, value) {
    this.attributes[name] = String(value);
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
    makeCardEl: (card, className) => {
      const element = new Element('div');
      element.className = 'card ' + className;
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
  view.render({ table: cards, deckCount: 0 });

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

test('바닥과 뒷패가 비면 이전 내용을 모두 지운다', () => {
  const { view, table, tableHint, deckStack } = createView();
  view.render({ table: [{ id: 'old-floor' }], deckCount: 2 });
  view.render({ table: [], deckCount: 0 });

  assert.strictEqual(table.children.length, 0);
  assert.strictEqual(tableHint.innerHTML, '');
  assert.strictEqual(deckStack.children.length, 0);
});
