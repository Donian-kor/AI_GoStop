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

function createView(viewMode) {
  const players = new Element('div');
  const window = {
    document: {
      createElement: (tagName) => new Element(tagName),
      createTextNode: (value) => {
        const node = new Element('#text');
        node.textContent = value;
        return node;
      },
    },
  };
  const context = { window };
  vm.runInNewContext(fs.readFileSync('public/opponent-view.js', 'utf8'), context);

  const view = window.GostopOpponentView({
    el: { players },
    mySeat: () => 0,
    oppView: () => viewMode,
    formatMoney: (value) => value + '원',
    makeCardEl: (card, className) => {
      const element = new Element('div');
      element.className = 'card ' + className;
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
  });

  return { view, players };
}

function player(overrides) {
  return Object.assign({
    seat: 1,
    name: '상대',
    score: 3,
    handCount: 7,
    money: 1200,
    connected: true,
    type: 'human',
    goCount: 0,
    captured: { bright: 1, animal: 2, ribbon: 0, junk: 3, doubleJunk: 1, bonus: 1 },
    capturedCards: [],
  }, overrides);
}

test('상대 목록은 내 자리 제외·현재 턴·접속 상태·점수 정보를 렌더링한다', () => {
  const { view, players } = createView('image');
  view.render({
    currentSeat: 2,
    players: [
      player({ seat: 0, name: '나' }),
      player({ seat: 1, name: '컴퓨터 A', type: 'ai', goCount: 2 }),
      player({ seat: 2, connected: false, goCount: 3 }),
    ],
  });

  assert.strictEqual(players.children.length, 1);
  assert.strictEqual(players.children[0].className, 'player ai');
  assert.strictEqual(players.children[0].attributes['data-seat'], '1');
  const aiName = findAll(players.children[0], 'pname')[0];
  assert.strictEqual(aiName.children[0].className, 'ai-badge');
  assert.strictEqual(aiName.children[1].children[0].textContent, '컴퓨터 A');
  assert.strictEqual(aiName.children[0].children[0].textContent, 'AI');
  assert.strictEqual(aiName.children[0].attributes['aria-label'], 'AI 상대');
  assert.strictEqual(findAll(players.children[0], 'pmeta')[0].innerHTML, '점수 <b>3</b> · 7장');
  assert.strictEqual(findAll(players.children[0], 'pmoney')[0].innerHTML, '1200원');
  assert.strictEqual(findAll(players.children[0], 'pready')[0].innerHTML, '🔥 2고!');

  view.render({
    currentSeat: 2,
    players: [
      player({ seat: 0, name: '나' }),
      player({ seat: 1, name: '컴퓨터 A', type: 'ai', goCount: 2 }),
      player({ seat: 2, connected: true }),
    ],
  });
  assert.strictEqual(players.children.length, 2, '다시 연결되면 상대를 다시 표시한다');
});

test('사용자 지정 AI 이름은 기본 컴퓨터 이름 규칙으로 바꾸지 않는다', () => {
  const { view, players } = createView('image');
  view.render({
    currentSeat: 1,
    players: [player({ seat: 0 }), player({ seat: 1, name: '홍단봇', type: 'ai' })],
  });

  assert.strictEqual(findAll(players, 'pname-text')[0].children[0].textContent, '홍단봇');
});

test('그림 보기에서는 먹은 패를 종류별로 분류하고 빈 종류와 족보 색을 표시한다', () => {
  const { view, players } = createView('image');
  view.render({
    currentSeat: 1,
    players: [
      player({ seat: 0 }),
      player({
        capturedCards: [
          { id: 'april_tane', kind: 'animal', month: 4, tags: ['godori'] },
          { id: 'january_bright', kind: 'bright', month: 1, tags: [] },
          { id: 'february_tane', kind: 'animal', month: 2, tags: ['godori'] },
        ],
      }),
    ],
  });

  assert.strictEqual(findAll(players, 'opp-cap').length, 4);
  assert.strictEqual(findAll(players, 'opp-cap-label')[0].innerHTML, '광 <b>1</b>');
  assert.strictEqual(findAll(players, 'opp-cap-label')[1].innerHTML, '열끗 <b>2</b>');
  assert.strictEqual(findAll(players, 'opp-cap-none').length, 2);
  assert.strictEqual(findAll(players, 'card')[0].card.id, 'january_bright');
  assert.strictEqual(findAll(players, 'card')[1].card.id, 'february_tane');
  assert.strictEqual(findAll(players, 'card')[1].className, 'card micro in-set');
  assert.strictEqual(findAll(players, 'card')[1].style['--sc'], '#8fe0a8');
});

test('먹은 패가 없으면 안내를 보이고 글자 보기에서는 종류 합계를 표시한다', () => {
  const imageView = createView('image');
  imageView.view.render({ currentSeat: 1, players: [player({ seat: 0 }), player()] });
  assert.strictEqual(findAll(imageView.players, 'opp-caps-empty')[0].innerHTML, '먹은 패 없음');

  const textView = createView('text');
  textView.view.render({
    currentSeat: 1,
    players: [player({ seat: 0 }), player()],
  });
  const summary = findAll(textView.players, 'captured-sum')[0];
  assert.strictEqual(summary.children.length, 4);
  assert.strictEqual(summary.children[0].innerHTML, '<span>광</span><b>1</b>');
  assert.strictEqual(summary.children[3].innerHTML, '<span>피</span><b>5</b>');
});

test('내 먹은 패 요약도 상대의 글자 보기와 같은 형식으로 렌더링한다', () => {
  const { view } = createView('image');
  const summary = view.capturedSummary({
    bright: 1,
    animal: 2,
    ribbon: 3,
    junk: 4,
    doubleJunk: 1,
    bonus: 1,
  });

  assert.strictEqual(summary.className, 'captured-sum');
  assert.deepStrictEqual(
    summary.children.map((item) => item.innerHTML),
    [
      '<span>광</span><b>1</b>',
      '<span>열</span><b>2</b>',
      '<span>띠</span><b>3</b>',
      '<span>피</span><b>6</b>',
    ],
  );
});
