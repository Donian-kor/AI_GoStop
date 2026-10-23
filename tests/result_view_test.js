'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
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

function createView(mySeat, startNextRound) {
  const overlay = new Element('div');
  const sounds = [];
  const window = {
    document: { createElement: (tagName) => new Element(tagName) },
    GostopFx: { playSound: (name) => sounds.push(name) },
  };
  const context = { window };
  vm.runInNewContext(fs.readFileSync('public/result-view.js', 'utf8'), context);
  const view = window.GostopResultView({
    el: { overlay },
    escapeHtml: (value) => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    formatMoney: (value) => value + '원',
    mySeat: () => mySeat,
    startNextRound: startNextRound,
  });
  return { view, overlay, sounds };
}

test('승리 결과는 정산 행, 점수 계산, 효과음 순서와 닫기를 표시한다', () => {
  const { view, overlay, sounds } = createView(0);
  overlay.className = 'overlay hidden';
  view.render({
    players: [{ name: '<나>' }, { name: '상대' }],
    result: {
      winnerSeat: 0,
      nagari: false,
      rows: [
        {
          seat: 0,
          name: '<나>',
          amount: 100,
          reasons: ['승리'],
          pibak: true,
          steps: [
            { label: '기본 점수', formula: '2', value: 2 },
            { label: '최종 점수', formula: '2×2', value: 4 },
          ],
        },
        { seat: 1, name: '상대', amount: -100, reasons: [] },
      ],
    },
  });

  assert.strictEqual(overlay.className, 'overlay');
  assert.strictEqual(findTag(overlay, 'h2')[0].innerHTML, '&lt;나&gt; 승리!');
  assert.strictEqual(findAll(overlay, 'overlay-sub')[0].innerHTML, '정산 결과');
  assert.strictEqual(findAll(overlay, 'rowline').length, 2);
  assert.strictEqual(findAll(overlay, 'rowline')[0].className, 'rowline win');
  assert.strictEqual(findTag(overlay, 'small')[0].innerHTML, '승리');
  assert.strictEqual(findAll(overlay, 'steps').length, 1);
  assert.strictEqual(findAll(overlay, 'step').length, 3);
  assert.strictEqual(findAll(overlay, 'total')[0].innerHTML, '<span>최종 점수</span><b>4점</b>');
  assert.deepStrictEqual(sounds, ['sfx_money_gain.ogg', 'sfx_bak.ogg']);

  findAll(overlay, 'primary')[0].click();
  assert.strictEqual(overlay.className, 'overlay hidden');
});

test('나가리는 승패 문구를 바꾸고 패배 효과음과 점수 상세를 표시한다', () => {
  const { view, overlay, sounds } = createView(1);
  view.render({
    players: [],
    result: {
      winnerSeat: -1,
      nagari: true,
      rows: [
        { seat: 0, name: '상대', amount: 0, reasons: [], steps: [] },
        { seat: 1, name: '나', amount: -20, reasons: [], gobak: true, steps: [] },
      ],
    },
  });

  assert.strictEqual(findTag(overlay, 'h2')[0].innerHTML, '나가리');
  assert.strictEqual(findAll(overlay, 'overlay-sub')[0].innerHTML, '이번 판은 승패가 없습니다. 다음 판은 2배입니다.');
  assert.strictEqual(findAll(overlay, 'steps').length, 0);
  assert.deepStrictEqual(sounds, ['sfx_money_lose.ogg', 'sfx_bak.ogg']);
});

test('총통 사유와 방장용 다음 판 시작 버튼을 표시한다', () => {
  let startCount = 0;
  const { view, overlay } = createView(0, () => { startCount += 1; });
  view.render({
    isHost: true,
    players: [{ name: '컴퓨터 A' }, { name: '나' }],
    result: {
      winnerSeat: 0,
      nagari: false,
      finishReason: '바닥에 12월 4장 총통! 컴퓨터 A(선) 즉시 승리',
      rows: [
        { seat: 0, name: '컴퓨터 A', amount: 100, reasons: [], steps: [] },
        { seat: 1, name: '나', amount: -100, reasons: [], steps: [] },
      ],
    },
  });

  const subtitles = findAll(overlay, 'overlay-sub');
  assert.strictEqual(subtitles[1].innerHTML, '바닥에 12월 4장 총통! 컴퓨터 A(선) 즉시 승리');
  assert.strictEqual(findTag(overlay, 'button')[0].innerHTML, '다음 판 시작');
  findTag(overlay, 'button')[0].click();
  assert.strictEqual(startCount, 1);
  assert.strictEqual(overlay.className, 'overlay hidden');
});
