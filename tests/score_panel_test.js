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
    this.textContent = '';
    this.style = {
      setProperty: (name, value) => { this.style[name] = value; },
    };
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

function createPanel(storageValues) {
  const storage = { ...storageValues };
  const scorePanel = new Element('div');
  const window = {
    document: { createElement: (tagName) => new Element(tagName) },
    localStorage: {
      getItem: (key) => storage[key] || null,
      setItem: (key, value) => { storage[key] = value; },
    },
  };
  const context = { window };
  vm.runInNewContext(fs.readFileSync('public/score-panel.js', 'utf8'), context);

  let fitCount = 0;
  const panel = window.GostopScorePanel({
    el: { scorePanel },
    cardImg: (card) => 'assets/hwatu/png/' + card.id + '.png?v=1',
    makeCardEl: (card, extraClass) => {
      const element = new Element('div');
      element.className = 'card ' + extraClass;
      element.card = card;
      return element;
    },
    cardsOfKinds: (cards, kinds) => cards
      .filter((card) => kinds.includes(card.kind))
      .sort((a, b) => (a.month || 0) - (b.month || 0)),
    capGroups: [
      { key: 'bright', label: '광', kinds: ['bright'] },
      { key: 'animal', label: '열끗', kinds: ['animal'] },
      { key: 'ribbon', label: '띠', kinds: ['ribbon'] },
      { key: 'junk', label: '피', kinds: ['junk', 'doubleJunk', 'bonus'] },
    ],
    setTags: ['godori', 'hongdan', 'cheongdan', 'chodan'],
    dotColor: { godori: '#8fe0a8' },
    setColor: { godori: 'godori' },
    escapeHtml: (value) => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    fitTableCards: () => { fitCount++; },
    mySeat: () => 0,
  });

  return {
    panel,
    scorePanel,
    storage,
    fitCount: () => fitCount,
  };
}

test('점수판은 족보가 없으면 비우고 서버 내역이 없으면 기본 족보를 그린다', () => {
  const { panel, scorePanel } = createPanel({});
  panel.render({ mySets: null });
  assert.strictEqual(scorePanel.className, 'score-panel');
  assert.strictEqual(scorePanel.children.length, 0);

  panel.render({
    mySets: { bright: 2, godori: 1, hongdan: 0, cheongdan: 0, chodan: 0, animal: 3, ribbon: 2, junk: 4 },
    players: [{ score: 5, captured: { total: 7 } }],
  });

  assert.strictEqual(findAll(scorePanel, 'jk-set').length, 8);
  assert.strictEqual(findAll(scorePanel, 'jk-score')[0].innerHTML, '먹은 패 7장 · <b>5</b>점');
  assert.strictEqual(findAll(scorePanel, 'my-cards-empty')[0].innerHTML, '아직 먹은 패가 없습니다');
});

test('점수판은 족보 카드와 획득 카드, 사용자 펼침 설정을 렌더링한다', () => {
  const { panel, scorePanel, storage, fitCount } = createPanel({ gs_fan: '1', gs_jokbo: '0' });
  panel.render({
    mySets: { bright: 0, godori: 1 },
    players: [{ score: 2, captured: { total: 1 } }],
    myJokbo: [{
      name: '<고도리>',
      need: 3,
      have: 1,
      done: false,
      points: 0,
      cards: [
        { id: 'february_tane', owned: true },
        { id: 'april_tane', owned: false },
      ],
    }],
    myCaptured: [{
      id: 'february_tane',
      kind: 'animal',
      month: 2,
      tags: ['godori'],
    }],
  });

  assert.strictEqual(scorePanel.className, 'score-panel show-fan folded');
  assert.strictEqual(findAll(scorePanel, 'jk-name')[0].innerHTML, '&lt;고도리&gt;');
  assert.strictEqual(findAll(scorePanel, 'jk-card').length, 2);
  assert.strictEqual(findAll(scorePanel, 'jk-card')[0].className, 'jk-card');
  assert.strictEqual(findAll(scorePanel, 'jk-card')[1].className, 'jk-card miss');
  assert.strictEqual(findAll(scorePanel, 'cap-group').length, 1);
  assert.strictEqual(findAll(scorePanel, 'card')[0].className, 'card tiny in-set');
  assert.strictEqual(findAll(scorePanel, 'card')[0].style['--sc'], '#8fe0a8');

  findAll(scorePanel, 'jk-fold')[0].click();
  assert.strictEqual(scorePanel.className, 'score-panel show-fan');
  assert.strictEqual(storage.gs_jokbo, '1');
  assert.strictEqual(findAll(scorePanel, 'jk-fold')[0].innerHTML, '족보 접기 ▲');

  findAll(scorePanel, 'jk-toggle')[0].click();
  assert.strictEqual(scorePanel.className, 'score-panel');
  assert.strictEqual(storage.gs_fan, '0');
  assert.strictEqual(findAll(scorePanel, 'jk-toggle')[0].innerHTML, '🎴 먹은 패 보기');
  assert.strictEqual(fitCount(), 2);
});
