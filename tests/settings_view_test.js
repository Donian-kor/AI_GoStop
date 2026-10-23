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
    this.title = '';
    this.value = '';
    this.text = '';
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

function createSettings(initialStorage, initialState) {
  const storage = Object.assign({}, initialStorage);
  const elements = {
    settingsBtn: new Element('button'),
    lobbySettingsBtn: new Element('button'),
    settingsOverlay: new Element('div'),
    settingsTitle: new Element('h2'),
    settingsSub: new Element('p'),
    settingsSaveBtn: new Element('button'),
    settingsCloseBtn: new Element('button'),
    pointSelect: new Element('select'),
    timeSelect: new Element('select'),
    bonusPackSelect: new Element('select'),
    showMonthSelect: new Element('select'),
  };
  const actions = [];
  const banners = [];
  let state = initialState;
  const window = {
    document: { createElement: (tagName) => new Element(tagName) },
    localStorage: {
      getItem: (key) => Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null,
      setItem: (key, value) => { storage[key] = value; },
    },
  };
  const context = { window };
  vm.runInNewContext(fs.readFileSync('public/settings-view.js', 'utf8'), context);
  const settingsView = window.GostopSettingsView({
    el: elements,
    getState: () => state,
    act: (type, payload) => actions.push({ type, payload }),
    fx: { showBanner: (...args) => banners.push(args) },
  });

  return {
    settingsView,
    elements,
    actions,
    banners,
    storage,
    setState: (value) => { state = value; },
  };
}

test('저장된 로비 기본값을 허용 목록으로 복원하고 잘못된 값은 기본값으로 정규화한다', () => {
  const defaults = createSettings({}, null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(defaults.settingsView.getRoomDefaults())), {
    moneyPerPoint: 100,
    timeLimit: { enabled: false, base: 0, increment: 0 },
    bonusPack: 50,
    showMonth: true,
  });

  const saved = createSettings({
    gs_lobby_settings: JSON.stringify({ moneyPerPoint: 5000, timeKey: '45', showMonth: false }),
  }, null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(saved.settingsView.getRoomDefaults())), {
    moneyPerPoint: 5000,
    timeLimit: { enabled: true, base: 45, increment: 5 },
    bonusPack: 50,
    showMonth: false,
  });

  const invalid = createSettings({
    gs_lobby_settings: JSON.stringify({ moneyPerPoint: 999, timeKey: 'unknown' }),
  }, null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(invalid.settingsView.getRoomDefaults())), {
    moneyPerPoint: 100,
    timeLimit: { enabled: false, base: 0, increment: 0 },
    bonusPack: 50,
    showMonth: true,
  });
});

test('로비 설정 창은 저장값을 표시하고 저장 시 새 방 기본값을 보존한다', () => {
  const { elements, settingsView, banners, storage } = createSettings({
    gs_lobby_settings: JSON.stringify({ moneyPerPoint: 500, timeKey: '30' }),
  }, null);
  elements.lobbySettingsBtn.click();
  assert.strictEqual(elements.settingsTitle.innerHTML, '새 방 설정');
  assert.strictEqual(elements.settingsSub.innerHTML, '방을 만들 때 적용됩니다.<br>게임 중에는 바꿀 수 없습니다.');
  assert.strictEqual(elements.settingsOverlay.className, 'overlay');
  assert.strictEqual(elements.pointSelect.value, '500');
  assert.strictEqual(elements.timeSelect.value, '30');
  assert.strictEqual(elements.showMonthSelect.value, 'on');

  elements.pointSelect.value = '1000';
  elements.timeSelect.value = '60';
  elements.showMonthSelect.value = 'off';
  elements.settingsSaveBtn.click();
  assert.strictEqual(elements.settingsOverlay.className, 'overlay hidden');
  assert.deepStrictEqual(JSON.parse(storage.gs_lobby_settings), { moneyPerPoint: 1000, timeKey: '60', bonusPack: 50, showMonth: false });
  assert.deepStrictEqual(banners, [['새 방 설정을 저장했습니다', 'plain', 1100]]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(settingsView.getRoomDefaults())), {
    moneyPerPoint: 1000,
    timeLimit: { enabled: true, base: 60, increment: 10 },
    bonusPack: 50,
    showMonth: false,
  });
});

test('게임 설정은 방장·대기 또는 정산 단계에서만 열고 기존 액션 payload로 저장한다', () => {
  const { elements, settingsView, actions, banners, setState } = createSettings({}, {
    isHost: true,
    phase: 'lobby',
    settings: { moneyPerPoint: 300, timeLimit: { enabled: true, base: 45 }, showMonth: true },
  });
  settingsView.renderAccess({ isHost: true, phase: 'lobby' });
  assert.strictEqual(elements.settingsBtn.className, 'chip icon');
  assert.strictEqual(elements.settingsBtn.title, '게임 설정 (점당·시간 제한)');

  elements.settingsBtn.click();
  assert.strictEqual(elements.settingsTitle.innerHTML, '게임 설정');
  assert.strictEqual(elements.settingsSub.innerHTML, '방장만 바꿀 수 있습니다.<br>판을 시작하기 전에만 변경됩니다.');
  assert.strictEqual(elements.pointSelect.value, '300');
  assert.strictEqual(elements.pointSelect.children[0].value, '300');
  assert.strictEqual(elements.timeSelect.value, '45');
  assert.strictEqual(elements.showMonthSelect.value, 'on');
  elements.pointSelect.value = '5000';
  elements.timeSelect.value = '30';
  elements.showMonthSelect.value = 'off';
  elements.settingsSaveBtn.click();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actions)), [{
    type: 'settings',
    payload: {
      moneyPerPoint: 5000,
      timeLimit: { enabled: true, base: 30, increment: 5 },
      bonusPack: 50,
      showMonth: false,
    },
  }]);
  assert.deepStrictEqual(banners, [['설정을 저장했습니다', 'plain', 1100]]);

  setState({ isHost: true, phase: 'lobby', settings: { moneyPerPoint: 5000, showMonth: false } });
  elements.settingsBtn.click();
  assert.strictEqual(elements.showMonthSelect.value, 'off');
  elements.settingsCloseBtn.click();

  setState({ isHost: false, phase: 'play', settings: { moneyPerPoint: 100 } });
  elements.settingsBtn.click();
  assert.strictEqual(elements.settingsOverlay.className, 'overlay hidden');
  assert.deepStrictEqual(banners[1], ['방장만 바꿀 수 있습니다', 'plain', 1200]);

  setState({ isHost: true, phase: 'play', settings: { moneyPerPoint: 100 } });
  elements.settingsBtn.click();
  assert.strictEqual(elements.settingsOverlay.className, 'overlay hidden');
  assert.deepStrictEqual(banners[2], ['판 시작 전에만 바꿀 수 있습니다', 'plain', 1500]);
});

test('설정 창 닫기와 호스트가 아닌 상태의 버튼 표시를 유지한다', () => {
  const { elements, settingsView } = createSettings({}, null);
  elements.lobbySettingsBtn.click();
  elements.settingsCloseBtn.click();
  assert.strictEqual(elements.settingsOverlay.className, 'overlay hidden');

  settingsView.renderAccess({ isHost: false, phase: 'play' });
  assert.strictEqual(elements.settingsBtn.className, 'chip icon hidden off');
  assert.strictEqual(elements.settingsBtn.title, '판 시작 전에만 설정을 바꿀 수 있습니다');
});
