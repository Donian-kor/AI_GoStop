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

function findAll(element, className) {
  const found = [];
  for (const child of element.children) {
    if (child.className.split(' ').includes(className)) found.push(child);
    found.push(...findAll(child, className));
  }
  return found;
}

function findTag(element, tagName) {
  const found = [];
  for (const child of element.children) {
    if (child.tagName === tagName) found.push(child);
    found.push(...findTag(child, tagName));
  }
  return found;
}

function createViews(mySeat) {
  const promptBox = new Element('div');
  const tableHint = new Element('div');
  const actions = [];
  const window = { document: { createElement: (tagName) => new Element(tagName) } };
  const context = { window };
  vm.runInNewContext(fs.readFileSync('public/phase-views.js', 'utf8'), context);

  const views = window.GostopPhaseViews({
    el: { promptBox, tableHint },
    mySeat: () => mySeat,
    escapeHtml: (value) => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    makeCardEl: (card, className) => {
      const element = new Element('div');
      element.className = 'card ' + className;
      element.card = card;
      return element;
    },
    act: (type, payload) => actions.push({ type, payload }),
  });

  return { views, promptBox, tableHint, actions };
}

test('4인 협상은 대기 정보와 참가·포기·광팔기 선택을 보여준다', () => {
  const { views, promptBox, actions } = createViews(3);
  views.renderNegotiation({
    players: [{ name: '선' }, { name: 'P2' }, { name: 'P3' }, { name: '<P4>' }],
    negotiation: {
      waitingSeat: 3,
      decisions: { 1: 'giveup', 2: 'join' },
      gwangCount: 2,
      mySaleCards: [{ id: 'january_bright', month: 1 }],
    },
  });

  assert.strictEqual(promptBox.className, 'prompt');
  assert.strictEqual(promptBox.children[0].innerHTML, 'P2: 포기 · P3: 참가');
  assert.strictEqual(findTag(promptBox, 'strong')[0].innerHTML, '참가하시겠습니까?');
  assert.strictEqual(findAll(promptBox, 'card').length, 1);
  const buttons = findTag(promptBox, 'button');
  buttons[0].click();
  buttons[1].click();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actions)), [
    { type: 'negotiate', payload: { decision: 'join' } },
    { type: 'negotiate', payload: { decision: 'sell' } },
  ]);

  const waitingView = createViews(0);
  waitingView.views.renderNegotiation({
    players: [{ name: '선' }, { name: 'P2' }],
    negotiation: { waitingSeat: 1, decisions: {} },
  });
  assert.strictEqual(waitingView.promptBox.children.length, 1);
  assert.strictEqual(waitingView.promptBox.children[0].innerHTML, 'P2 님이 결정하는 중…');
});

test('선 결정은 미선택·완료·대기 상태를 표시하고 카드 선택을 전달한다', () => {
  const { views, promptBox, tableHint, actions } = createViews(0);
  views.renderSeon({
    seonCandidates: [[{ id: 'card-a' }, { id: 'card-b' }]],
    seonPicked: [-1],
  });
  assert.strictEqual(tableHint.innerHTML, '가장 크게(낮) 또는 가장 작게(밤) 나는 카드를 고르세요.');
  assert.strictEqual(findAll(promptBox, 'card').length, 2);
  findAll(promptBox, 'card')[1].click();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actions)), [{ type: 'seonPick', payload: { cardIndex: 1 } }]);

  views.renderSeon({ seonCandidates: [[{ id: 'card-a' }]], seonPicked: [0] });
  assert.strictEqual(promptBox.innerHTML, '<span>다른 가족들이 카드를 고르는 중입니다…</span>');

  views.renderSeon({ seonCandidates: [[]], seonPicked: [-1] });
  assert.strictEqual(tableHint.innerHTML, '선(先)을 정하는 중입니다.');
  assert.strictEqual(promptBox.innerHTML, '<span>이 방은 이미 선을 정하는 중입니다. 다음 판에 참여해 주세요.</span>');
});

test('턴 프롬프트는 본인 액션·상대 대기·숨김 상태를 유지한다', () => {
  const { views, promptBox, actions } = createViews(0);
  views.renderPrompt({ prompt: null });
  assert.strictEqual(promptBox.className, 'prompt hidden');

  views.renderPrompt({ prompt: { seat: 1, type: 'goStop' }, players: [{ name: '나' }, { name: '<상대>' }] });
  assert.strictEqual(promptBox.innerHTML, '<span>&lt;상대&gt; 님이 선택하는 중입니다…</span>');

  views.renderPrompt({ prompt: { seat: 0, type: 'goStop' }, players: [] });
  const goStopButtons = findTag(promptBox, 'button');
  goStopButtons[0].click();
  goStopButtons[1].click();

  views.renderPrompt({
    prompt: { seat: 0, type: 'floorChoice', options: [{ id: 'floor-a' }, { id: 'floor-b' }] },
    players: [],
  });
  findAll(promptBox, 'card')[1].click();

  views.renderPrompt({
    prompt: { seat: 0, type: 'flipChoice', options: [{ id: 'flip-a' }] },
    players: [],
  });
  findAll(promptBox, 'card')[0].click();

  views.renderPrompt({
    prompt: { seat: 0, type: 'bonusDraw', options: [{ id: 'stock-a', stockIndex: 5 }] },
    players: [],
  });
  findAll(promptBox, 'card')[0].click();

  assert.deepStrictEqual(JSON.parse(JSON.stringify(actions)), [
    { type: 'go' },
    { type: 'stop' },
    { type: 'floorChoice', payload: { choice: 1 } },
    { type: 'flipChoice', payload: { ordinal: 0 } },
    { type: 'bonusDraw', payload: { stockIndex: 5 } },
  ]);
});
