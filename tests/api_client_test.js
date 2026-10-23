'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function createApiClient(options) {
  const requests = [];

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

  const window = { XMLHttpRequest: FakeXMLHttpRequest };
  vm.runInNewContext(fs.readFileSync('public/api-client.js', 'utf8'), { window });

  return { api: window.GostopApiClient(), requests };
}

test('GET sends a credentialed asynchronous JSON request and parses a successful response', () => {
  const { api, requests } = createApiClient();
  let response;

  api.getJson('/api/room/state', (data) => { response = data; });
  const xhr = requests[0];

  assert.strictEqual(xhr.method, 'GET');
  assert.strictEqual(xhr.url, '/api/room/state');
  assert.strictEqual(xhr.async, true);
  assert.strictEqual(xhr.headers['Content-Type'], 'application/json');
  assert.strictEqual(xhr.withCredentials, true);
  assert.strictEqual(xhr.body, null);

  xhr.complete(200, '{"ok":true}');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(response)), { ok: true });
});

test('POST serializes the request body and parses a successful response', () => {
  const { api, requests } = createApiClient();
  let response;

  api.postJson('/api/room/action', { type: 'start' }, (data) => { response = data; });
  const xhr = requests[0];

  assert.strictEqual(xhr.method, 'POST');
  assert.strictEqual(xhr.body, '{"type":"start"}');
  xhr.complete(201, '{"ok":true}');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(response)), { ok: true });
});

test('a successful response with invalid JSON calls onOk with null', () => {
  const { api, requests } = createApiClient();
  let response = 'not called';

  api.getJson('/api/version', (data) => { response = data; });
  requests[0].complete(200, 'invalid');

  assert.strictEqual(response, null);
});

test('a non-success status calls onErr with the XMLHttpRequest', () => {
  const { api, requests } = createApiClient();
  let error;

  api.getJson('/api/room/missing', null, (xhr) => { error = xhr; });
  requests[0].complete(404, '{"error":"missing"}');

  assert.strictEqual(error, requests[0]);
});

test('open, send, and network errors preserve their existing onErr arguments', () => {
  const openFailure = createApiClient({ openError: new Error('open failed') });
  let openError = 'not called';
  openFailure.api.getJson('/api/version', null, (error) => { openError = error; });
  assert.strictEqual(openError, undefined);

  const sendFailure = createApiClient({ sendError: new Error('send failed') });
  let sendError = 'not called';
  sendFailure.api.getJson('/api/version', null, (error) => { sendError = error; });
  assert.strictEqual(sendError, sendFailure.requests[0]);

  const networkFailure = createApiClient();
  let networkError = 'not called';
  networkFailure.api.getJson('/api/version', null, (error) => { networkError = error; });
  networkFailure.requests[0].failNetwork();
  assert.strictEqual(networkError, networkFailure.requests[0]);
});
