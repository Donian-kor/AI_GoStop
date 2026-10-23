'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createSession(options) {
  const requests = [];
  const timeouts = [];
  const intervals = [];
  const storage = {};
  const rendered = [];
  const handledFx = [];
  const opponentMoves = [];
  const banners = [];
  const leftMessages = [];
  let reloadCount = 0;
  let roomBrowserCloseCount = 0;
  let enterCount = 0;
  let nextTimerId = 1;

  function FakeXMLHttpRequest() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
    this.headers = {};
    this.withCredentials = false;
    requests.push(this);
  }

  FakeXMLHttpRequest.prototype.open = function (method, url, async) {
    if (options && options.openError) throw options.openError;
    this.method = method;
    this.url = url;
    this.async = async;
  };

  FakeXMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    this.headers[name] = value;
  };

  FakeXMLHttpRequest.prototype.send = function (body) {
    if (options && options.sendError) throw options.sendError;
    this.body = body;
  };

  FakeXMLHttpRequest.prototype.complete = function (status, responseText) {
    this.readyState = 4;
    this.status = status;
    this.responseText = responseText;
    this.onreadystatechange();
  };

  FakeXMLHttpRequest.prototype.failNetwork = function () {
    this.onerror();
  };

  const window = {
    XMLHttpRequest: FakeXMLHttpRequest,
    sessionStorage: {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null),
      setItem: (key, value) => { storage[key] = String(value); },
      removeItem: (key) => { delete storage[key]; },
    },
    document: { title: '명지네고스톱' },
    location: { reload: () => { reloadCount++; } },
    console: { error: () => {} },
    setTimeout: (callback, delay) => {
      const timer = { id: nextTimerId++, callback, delay, cleared: false };
      timeouts.push(timer);
      return timer.id;
    },
    clearTimeout: (id) => {
      const timer = timeouts.find((item) => item.id === id);
      if (timer) timer.cleared = true;
    },
    setInterval: (callback, delay) => {
      const timer = { id: nextTimerId++, callback, delay };
      intervals.push(timer);
      return timer.id;
    },
  };
  vm.runInNewContext(fs.readFileSync('public/room-session.js', 'utf8'), { window });

  const elements = {
    lobby: { className: 'screen' },
    room: { className: 'screen hidden' },
    nameInput: { value: '  홍길동  ' },
    codeChip: { innerHTML: '------' },
  };
  const session = window.GostopRoomSession({
    el: elements,
    fx: {
      handleFx: (event, context) => handledFx.push([event, context]),
      showBanner: (message, color, duration) => banners.push([message, color, duration]),
    },
    render: (state) => rendered.push(state),
    seatEl: (seat) => ({ seat }),
    closeRoomBrowser: () => { roomBrowserCloseCount++; },
    onEnter: () => { enterCount++; },
    onLeave: (message) => leftMessages.push(message),
    getSavedName: () => (options && options.savedName) || '저장된 이름',
    playOpponentMoves: (events) => opponentMoves.push(events),
  });

  function runNextTimeout(delay) {
    const timer = timeouts.find((item) => !item.cleared && (delay === undefined || item.delay === delay));
    assert.ok(timer, '요청한 타이머가 예약되어야 한다');
    timer.cleared = true;
    timer.callback();
    return timer;
  }

  return {
    session,
    requests,
    timeouts,
    intervals,
    storage,
    rendered,
    handledFx,
    opponentMoves,
    banners,
    leftMessages,
    elements,
    runNextTimeout,
    getReloadCount: () => reloadCount,
    getRoomBrowserCloseCount: () => roomBrowserCloseCount,
    getEnterCount: () => enterCount,
  };
}

function stateResponse(overrides) {
  return Object.assign({
    ok: true,
    state: { phase: 'lobby' },
    fx: [],
    version: 1,
  }, overrides);
}

test('GET and POST keep credentialed asynchronous JSON transport behavior', () => {
  const { session, requests } = createSession();
  let getResponse;
  let postResponse;

  session.getJson('/api/version', (data) => { getResponse = data; });
  session.postJson('/api/room/action', { type: 'start' }, (data) => { postResponse = data; });

  assert.strictEqual(requests[0].method, 'GET');
  assert.strictEqual(requests[0].async, true);
  assert.strictEqual(requests[0].headers['Content-Type'], 'application/json');
  assert.strictEqual(requests[0].withCredentials, true);
  assert.strictEqual(requests[0].body, null);
  assert.strictEqual(requests[1].method, 'POST');
  assert.strictEqual(requests[1].body, '{"type":"start"}');

  requests[0].complete(200, '{"version":"build"}');
  requests[1].complete(201, '{"ok":true}');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(getResponse)), { version: 'build' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(postResponse)), { ok: true });
});

test('transport preserves invalid JSON, HTTP, open, send, and network error callbacks', () => {
  const invalidJson = createSession();
  let invalidResponse = 'not called';
  invalidJson.session.getJson('/api/version', (data) => { invalidResponse = data; });
  invalidJson.requests[0].complete(200, 'invalid');
  assert.strictEqual(invalidResponse, null);

  const httpFailure = createSession();
  let httpError;
  httpFailure.session.getJson('/api/missing', null, (xhr) => { httpError = xhr; });
  httpFailure.requests[0].complete(404, '{}');
  assert.strictEqual(httpError, httpFailure.requests[0]);

  const openFailure = createSession({ openError: new Error('open failed') });
  let openError = 'not called';
  openFailure.session.getJson('/api/version', null, (error) => { openError = error; });
  assert.strictEqual(openError, undefined);

  const sendFailure = createSession({ sendError: new Error('send failed') });
  let sendError;
  sendFailure.session.getJson('/api/version', null, (error) => { sendError = error; });
  assert.strictEqual(sendError, sendFailure.requests[0]);

  const networkFailure = createSession();
  let networkError;
  networkFailure.session.getJson('/api/version', null, (error) => { networkError = error; });
  networkFailure.requests[0].failNetwork();
  assert.strictEqual(networkError, networkFailure.requests[0]);
});

test('createRoom enters the room, persists the session, and starts the initial poll', () => {
  const h = createSession();
  let createError;

  h.session.createRoom({ name: '홍길동', mode: 'multi' }, (message) => { createError = message; });
  assert.strictEqual(h.requests[0].url, '/api/room');
  assert.deepStrictEqual(JSON.parse(h.requests[0].body), { name: '홍길동', mode: 'multi' });
  h.requests[0].complete(200, '{"code":"ABC123","seat":0}');

  assert.strictEqual(createError, undefined);
  assert.strictEqual(h.session.getRoomCode(), 'ABC123');
  assert.strictEqual(h.session.getMySeat(), 0);
  assert.strictEqual(h.storage.gs_room, 'ABC123');
  assert.strictEqual(h.storage.gs_name, '홍길동');
  assert.strictEqual(h.elements.lobby.className, 'screen hidden');
  assert.strictEqual(h.elements.room.className, 'screen');
  assert.strictEqual(h.elements.codeChip.innerHTML, 'ABC123');
  assert.strictEqual(h.getRoomBrowserCloseCount(), 1);
  assert.strictEqual(h.getEnterCount(), 1);
  assert.strictEqual(h.requests[1].url, '/api/room/ABC123/state?since=0&v=-1');
  assert.strictEqual(h.intervals[0].delay, 2000);
});

test('watchdog checks on one interval without scheduling additional timers', () => {
  const h = createSession();
  h.session.enterRoom('ABC123', 0);
  h.requests[0].complete(200, JSON.stringify(stateResponse()));

  const scheduledTimeouts = h.timeouts.length;
  h.intervals[0].callback();
  h.intervals[0].callback();

  assert.strictEqual(h.intervals.length, 1);
  assert.strictEqual(h.timeouts.length, scheduledTimeouts);
  assert.strictEqual(h.getReloadCount(), 0);
});

test('the first poll updates state and cursor without replaying old effects', () => {
  const h = createSession();
  h.session.enterRoom('ABC123', 1);
  h.requests[0].complete(200, JSON.stringify(stateResponse({
    state: { phase: 'play' },
    fx: [{ seq: 4, type: 'place' }],
    version: 9,
  })));

  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.rendered)), [{ phase: 'play' }]);
  assert.strictEqual(h.handledFx.length, 0);
  assert.strictEqual(h.opponentMoves.length, 1);
  assert.strictEqual(h.opponentMoves[0].length, 0);
  h.runNextTimeout(50);
  assert.strictEqual(h.requests[1].url, '/api/room/ABC123/state?since=4&v=9');
});

test('later polls handle effects before rendering and play opponent moves afterward', () => {
  const h = createSession();
  const order = [];
  h.session.enterRoom('ABC123', 1);
  h.requests[0].complete(200, JSON.stringify(stateResponse()));
  h.session.getLastState();
  h.handledFx.length = 0;
  h.rendered.length = 0;
  h.opponentMoves.length = 0;

  h.runNextTimeout(50);
  const event = { seq: 1, type: 'capture' };
  h.requests[1].complete(200, JSON.stringify(stateResponse({
    state: { phase: 'play', turn: 2 },
    fx: [event],
    version: 2,
  })));
  assert.deepStrictEqual(h.handledFx.map((item) => item[0].type), ['capture']);
  assert.strictEqual(h.handledFx[0][1].mySeat, 1);
  assert.strictEqual(h.handledFx[0][1].seatEl(1).seat, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.rendered)), [{ phase: 'play', turn: 2 }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.opponentMoves)), [[event]]);
});

test('createRoom reports server and response errors without entering a room', () => {
  const invalidResponse = createSession();
  let responseError;
  invalidResponse.session.createRoom({}, (message) => { responseError = message; });
  invalidResponse.requests[0].complete(200, '{"error":"invalid"}');
  assert.strictEqual(responseError, 'invalid');
  assert.strictEqual(invalidResponse.session.getRoomCode(), null);

  const networkFailure = createSession();
  let networkError;
  networkFailure.session.createRoom({}, (message) => { networkError = message; });
  networkFailure.requests[0].failNetwork();
  assert.strictEqual(networkError, '서버에 연결할 수 없습니다.');
});

test('restoreRoom joins the saved room and uses the remembered player name', () => {
  const h = createSession({ savedName: '이전 이름' });
  h.storage.gs_room = 'REST01';
  h.session.restoreRoom();

  assert.strictEqual(h.requests[0].url, '/api/room/REST01/join');
  assert.strictEqual(h.requests[0].body, '{"name":"이전 이름"}');
  h.requests[0].complete(200, '{"code":"REST01","seat":2}');
  assert.strictEqual(h.session.getRoomCode(), 'REST01');
  assert.strictEqual(h.session.getMySeat(), 2);
  assert.strictEqual(h.requests[1].url, '/api/room/REST01/state?since=0&v=-1');
});

test('restoreRoom clears only the saved room code when join fails', () => {
  const h = createSession();
  h.storage.gs_room = 'MISSING';
  h.storage.gs_name = '보존 이름';
  h.session.restoreRoom();
  h.requests[0].complete(404, '{}');

  assert.strictEqual(h.storage.gs_room, undefined);
  assert.strictEqual(h.storage.gs_name, '보존 이름');
  assert.strictEqual(h.session.getRoomCode(), null);
});

test('act ignores duplicate actions while busy and polls after a response', () => {
  const h = createSession();
  h.session.enterRoom('ABC123', 0);
  h.session.act('start');
  h.session.act('stop');

  assert.strictEqual(h.session.isBusy(), true);
  assert.strictEqual(h.requests.length, 2);
  assert.strictEqual(h.requests[1].url, '/api/room/ABC123/action');
  const body = JSON.parse(h.requests[1].body);
  assert.strictEqual(body.type, 'start');
  assert.deepStrictEqual(body.payload, {});
  assert.match(body.requestId, /^[0-9]+-[a-z0-9]{6}$/);

  h.requests[1].complete(200, '{"ok":false,"error":"차례가 아닙니다"}');
  assert.strictEqual(h.session.isBusy(), false);
  assert.deepStrictEqual(h.banners, [['차례가 아닙니다', 'red', 1400]]);
  assert.strictEqual(h.requests.length, 2);
});

test('a failed action reports connection errors and leaves when the room is gone', () => {
  const connectionFailure = createSession();
  connectionFailure.session.enterRoom('ABC123', 0);
  connectionFailure.session.act('start');
  connectionFailure.requests[1].complete(500, '{}');
  assert.deepStrictEqual(connectionFailure.banners, [['연결이 끊겼습니다', 'red', 1400]]);

  const missingRoom = createSession();
  missingRoom.session.enterRoom('ABC123', 0);
  missingRoom.session.act('start');
  missingRoom.requests[1].complete(404, '{}');
  assert.strictEqual(missingRoom.session.getRoomCode(), null);
  assert.deepStrictEqual(missingRoom.leftMessages, ['방이 닫혔습니다. 방장이 방을 나갔을 수 있습니다.']);
});

test('a missing room during polling returns to the lobby and clears session state', () => {
  const h = createSession();
  h.session.enterRoom('ABC123', 2);
  h.requests[0].complete(404, '{}');

  assert.strictEqual(h.session.getRoomCode(), null);
  assert.strictEqual(h.session.getMySeat(), -1);
  assert.strictEqual(h.session.getLastState(), null);
  assert.strictEqual(h.storage.gs_room, undefined);
  assert.strictEqual(h.storage.gs_name, undefined);
  assert.deepStrictEqual(h.leftMessages, ['방이 닫혔습니다. 방장이 방을 나갔을 수 있습니다.']);
});

test('leave posts the leave action and resets the room session immediately', () => {
  const h = createSession();
  h.session.enterRoom('ABC123', 0);
  h.session.leave();

  assert.strictEqual(h.requests[1].url, '/api/room/ABC123/action');
  assert.strictEqual(h.requests[1].body, '{"type":"leave","payload":{}}');
  assert.strictEqual(h.session.getRoomCode(), null);
  assert.strictEqual(h.session.getMySeat(), -1);
  assert.strictEqual(h.storage.gs_room, undefined);
  assert.deepStrictEqual(h.leftMessages, ['']);
});

test('pollNow completes immediately when no room is active', () => {
  const h = createSession();
  let completed = 0;

  h.session.pollNow(() => { completed++; });

  assert.strictEqual(completed, 1);
  assert.strictEqual(h.requests.length, 0);
});
