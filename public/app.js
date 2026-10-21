'use strict';

/*
 * 고스톱 클라이언트 — ES5 문법으로 작성 (Android 4.4 등 구형 브라우저 대응)
 *
 * 사용하지 않는 것:
 *   let/const,箭头함수, 템플릿리터럴, async/await, Promise, fetch,
 *   객체/배열 전개, 기본 매개변수, 구조분해, ?. / ??, Object.assign,
 *   Array.find/includes, String.padStart/includes
 *
 * 벤치마킹: itsent-lab/hwatu 의 apps/web/src/lib/effects.ts (Web Animations API 카드 비행)
 */

(function () {
  var CARD_IMG = 'assets/hwatu/png/';
  var buildVersion = '1';
  var roomCode = null;
  var mySeat = -1;
  var lastFxSeq = 0;
  var lastVersion = -1;
  var pollTimer = null;
  var watchdogTimer = null;
  var pollPending = false;
  var lastUpdateAt = 0;
  var lastState = null;
  var busy = false;
  var Fx = window.GostopFx;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    lobby: $('lobby'),
    room: $('room'),
    nameInput: $('nameInput'),
    modeSelect: $('modeSelect'),
    diffSelect: $('diffSelect'),
    createBtn: $('createBtn'),
    joinBtn: $('joinBtn'),
    joinBox: $('joinBox'),
    codeInput: $('codeInput'),
    joinGoBtn: $('joinGoBtn'),
    lobbyError: $('lobbyError'),
    codeChip: $('codeChip'),
    moneyChip: $('moneyChip'),
    muteBtn: $('muteBtn'),
    bgmBtn: $('bgmBtn'),
    deckStack: $('deckStack'),
    scorePanel: $('scorePanel'),
    players: $('players'),
    table: $('table'),
    tableHint: $('tableHint'),
    promptBox: $('promptBox'),
    hand: $('hand'),
    turnInfo: $('turnInfo'),
    timer: $('timer'),
    startBtn: $('startBtn'),
    overlay: $('overlay')
  };

  var KIND_LABEL = {
    bright: '광', animal: '열꽃', ribbon: '띠', junk: '피',
    doubleJunk: '쌍피', bonus: '보너스'
  };

  var DOT_COLOR = {
    guang: '#e8c46a', godori: '#8fe0a8', hong: '#ef8fb0', cheong: '#7fb2e8',
    cho: '#9ed48a', animal: '#c9a0e8', ribbon: '#7fd4c4', junk: '#b9c4bb'
  };

  var SET_TAGS = ['godori', 'hongdan', 'cheongdan', 'chodan'];
  var SET_COLOR = { godori: 'godori', hongdan: 'hong', cheongdan: 'cheong', chodan: 'cho' };

  // ── 네트워크 (XMLHttpRequest — 구형 브라우저 대응) ───────────────────────

  function request(method, url, body, onOk, onErr) {
    var xhr = new XMLHttpRequest();
    try {
      xhr.open(method, url, true);
    } catch (e) {
      if (onErr) onErr();
      return;
    }
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.withCredentials = true;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
        if (onOk) onOk(data);
      } else if (onErr) {
        onErr(xhr);
      }
    };
    xhr.onerror = function () { if (onErr) onErr(xhr); };
    try {
      xhr.send(body ? JSON.stringify(body) : null);
    } catch (e) {
      if (onErr) onErr(xhr);
    }
  }

  function getJson(url, onOk, onErr) { request('GET', url, null, onOk, onErr); }
  function postJson(url, body, onOk, onErr) { request('POST', url, body, onOk, onErr); }

  // ── 이름 기억 ────────────────────────────────────────────────────────────
  // 한 번 입력한 이름을 저장해 두면 새로고침·재접속 때 다시 입력하지 않아도 된다.
  function savedName() {
    try { return localStorage.getItem('gs_user') || ''; } catch (e) { return ''; }
  }

  function rememberName(name) {
    try { localStorage.setItem('gs_user', name || ''); } catch (e) {}
  }

  function currentName() {
    var n = el.nameInput.value.replace(/^\s+|\s+$/g, '');
    if (!n) n = savedName();
    if (n) el.nameInput.value = n;
    return n || '나';
  }

  // ── 자동 갱신 (구버전 화면이면 자동으로 새로고침) ────────────────────────

  function checkBuild() {
    getJson('/api/version', function (res) {
      if (!res || !res.version) return;
      buildVersion = res.version;
      var saved = null;
      try { saved = localStorage.getItem('gs_build'); } catch (e) { saved = null; }
      if (saved && saved !== res.version) {
        try { localStorage.setItem('gs_build', res.version); } catch (e) {}
        location.reload();
        return;
      }
      try { localStorage.setItem('gs_build', res.version); } catch (e) {}
    }, function () {});
  }
  checkBuild();

  // ── 입장 ────────────────────────────────────────────────────────────────

  el.nameInput.addEventListener('input', function () { rememberName(this.value.replace(/^\s+|\s+$/g, '')); });

  el.createBtn.addEventListener('click', function () {
    var name = currentName();
    el.lobbyError.textContent = '';
    var parts = el.modeSelect.value.split('-');
    var mode = parts[0];
    var count = parts[1] ? parseInt(parts[1], 10) : 3;
    var diff = el.diffSelect.value;
    postJson('/api/room', { name: name, mode: mode, playerCount: count, aiDifficulty: diff },
      function (res) {
        if (!res || !res.code) {
          el.lobbyError.textContent = (res && res.error) || '방을 만들지 못했습니다.';
          return;
        }
        enterRoom(res.code, res.seat);
      },
      function () { el.lobbyError.textContent = '서버에 연결할 수 없습니다.'; });
  });

  el.joinBtn.addEventListener('click', function () {
    if (el.joinBox.className.indexOf('hidden') >= 0) { el.joinBox.className = ''; el.codeInput.focus(); }
    else { el.joinBox.className = 'hidden'; }
  });

  el.joinGoBtn.addEventListener('click', function () {
    var name = currentName();
    var code = el.codeInput.value.replace(/^\s+|\s+$/g, '').toUpperCase();
    if (code.length !== 6) { el.lobbyError.textContent = '방 코드는 6자리입니다.'; return; }
    el.lobbyError.textContent = '';
    postJson('/api/room/' + code + '/join', { name: name }, function (res) {
      if (!res || !res.code) {
        el.lobbyError.textContent = (res && res.error) || '방에 참가할 수 없습니다.';
        return;
      }
      enterRoom(res.code, res.seat);
    }, function () { el.lobbyError.textContent = '서버에 연결할 수 없습니다.'; });
  });

  el.codeChip.addEventListener('click', function () {
    var done = function () { Fx.showBanner('방 코드 복사됨', 'plain', 900); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(roomCode || '').then(done, function () { done(); });
    } else { done(); }
  });

  el.muteBtn.addEventListener('click', function () {
    var muted = Fx.setMuted(!Fx.isMuted());
    el.muteBtn.innerHTML = muted ? '🔇' : '🔊';
    el.muteBtn.title = muted ? '소리 켜기' : '소리 끄기';
  });

  el.bgmBtn.addEventListener('click', function () {
    var on = Fx.toggleBgm();
    el.bgmBtn.className = 'chip icon' + (on ? ' on' : '');
    el.bgmBtn.title = on ? '배경음악 끄기' : '배경음악 켜기';
  });

  el.startBtn.addEventListener('click', function () { act('start'); });

  function enterRoom(code, seat) {
    roomCode = code;
    mySeat = seat;
    lastFxSeq = 0;
    // 새로고침해도 방으로 돌아올 수 있게 방 코드와 이름을 기억한다
    try {
      sessionStorage.setItem('gs_room', code);
      sessionStorage.setItem('gs_name', el.nameInput.value.replace(/^\s+|\s+$/g, ''));
    } catch (e) {}
    el.lobby.className = 'screen hidden';
    el.room.className = 'screen';
    el.codeChip.innerHTML = code;
    document.title = '고스톱 ' + code;
    startPolling();
  }

  // 새로고침 후 방으로 자동 복귀 (기존 참가자라면 쿠키로 자리도 복원된다)
  function restoreRoom() {
    var saved = null;
    try { saved = sessionStorage.getItem('gs_room'); } catch (e) { saved = null; }
    if (!saved) return;
    var savedName2 = savedName();
    postJson('/api/room/' + saved + '/join', { name: savedName2 }, function (res) {
      if (res && res.code) {
        enterRoom(res.code, res.seat);
      } else {
        try { sessionStorage.removeItem('gs_room'); } catch (e) {}
      }
    }, function () {
      try { sessionStorage.removeItem('gs_room'); } catch (e) {}
    });
  }
  restoreRoom();

  // ── 폴링 (긴 폴링: 서버가 상태 변경 시 즉시 응답) ───────────────────────

  function startPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    var loop = function () {
      pollNow(function () {
        if (roomCode) pollTimer = setTimeout(loop, 50);
      });
    };
    loop();
    if (!watchdogTimer) {
      watchdogTimer = setInterval(watchdog, 2000);
    }
  }

  function pollNow(done) {
    if (!roomCode || pollPending) { if (done) done(); return; }
    pollPending = true;
    getJson('/api/room/' + roomCode + '/state?since=' + lastFxSeq + '&v=' + lastVersion,
      function (res) {
        pollPending = false;
        if (done) done();
        if (!res || !res.ok) return;
        lastUpdateAt = new Date().getTime();
        if (typeof res.version === 'number') lastVersion = res.version;
        var fx = res.fx || [];
        for (var i = 0; i < fx.length; i++) {
          if (fx[i].seq > lastFxSeq) lastFxSeq = fx[i].seq;
          try {
            if (Fx) Fx.handleFx(fx[i], { seatEl: seatEl, mySeat: mySeat });
          } catch (e) { /* 이펙트 오류가 게임을 멈추지 않게 */ }
        }
        lastState = res.state;
        try {
          render(res.state);
        } catch (e) {
          // 화면을 그리는 중 오류가 나도 대국은 계속된다
          if (!window.console || !console.error) return;
          console.error('[render]', e);
        }
      },
      function () { pollPending = false; if (done) done(); });
  }

  // 상태 갱신이 멈췄다면(폴링 루프가 죽었거나 연결이 꼬였으면) 자동으로 새로고침한다
  function watchdog() {
    if (!roomCode) return;
    if (new Date().getTime() - lastUpdateAt > 12000) {
      location.reload();
      return;
    }
    setTimeout(watchdog, 2000);
  }

  // ── 액션 ────────────────────────────────────────────────────────────────

  function act(type, payload) {
    if (!roomCode || busy) return;
    busy = true;
    var body = {
      requestId: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
      type: type,
      payload: payload || {}
    };
    postJson('/api/room/' + roomCode + '/action', body, function (res) {
      busy = false;
      if (res && res.ok === false) Fx.showBanner(res.error || '처리할 수 없습니다.', 'red', 1400);
      pollNow(function () {});
    }, function () {
      busy = false;
      Fx.showBanner('연결이 끊겼습니다', 'red', 1400);
    });
  }

  // ── 렌더링 ──────────────────────────────────────────────────────────────

  function cardImg(card) {
    return CARD_IMG + card.id + '.png?v=' + buildVersion;
  }

  function makeCardEl(card, extraClass) {
    var d = document.createElement('div');
    d.className = 'card ' + (extraClass || '');
    var img = document.createElement('img');
    img.className = 'card-img';
    img.src = cardImg(card);
    img.alt = '';
    d.appendChild(img);
    if (card.month >= 1 && card.month <= 12) {
      d.className += ' m' + (card.month < 10 ? '0' + card.month : String(card.month));
      d.setAttribute('data-month-label', card.month + '월');
    }
    d.setAttribute('data-kind', KIND_LABEL[card.kind] || '');
    return d;
  }

  function capturedSummary(sum) {
    var wrap = document.createElement('div');
    wrap.className = 'captured-sum';
    if (!sum) return wrap;
    var items = [
      ['guang', '광', sum.bright],
      ['', '열', sum.animal],
      ['ribbon', '띠', sum.ribbon],
      ['junk', '피', sum.junk + sum.doubleJunk + sum.bonus]
    ];
    for (var i = 0; i < items.length; i++) {
      var cls = items[i][0];
      var n = items[i][2];
      var tag = document.createElement('i');
      tag.className = (cls ? cls + ' ' : '') + (n > 0 ? 'on' : '');
      tag.innerHTML = items[i][1] + n;
      wrap.appendChild(tag);
    }
    return wrap;
  }

  function fitHandCards(count) {
    if (!count) return;
    var avail = Math.min(window.innerWidth - 16, 760);
    var gap = 3;
    var w = Math.floor((avail - (count - 1) * gap) / count);
    if (w > 74) w = 74;
    if (w < 54) w = 54;
    el.hand.style.setProperty('--hand-w', w + 'px');
  }

  function render(state) {
    var me = state.players[mySeat];
    el.moneyChip.innerHTML = (me ? me.money : 0).toLocaleString() + ' P';

    // 플레이어
    el.players.innerHTML = '';
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      var div = document.createElement('div');
      var cls = 'player';
      if (p.seat === state.currentSeat) cls += ' turn';
      if (p.seat === mySeat) cls += ' me';
      if (p.type === 'ai') cls += ' ai';
      div.className = cls;
      div.setAttribute('data-seat', String(p.seat));

      var name = document.createElement('div');
      name.className = 'pname';
      var av = document.createElement('span');
      av.className = 'avatar';
      av.style.background = avatarColor(p.name);
      av.innerHTML = (p.name || '?').replace(/^\s+|\s+$/g, '').charAt(0) || '?';
      name.appendChild(av);
      name.appendChild(document.createTextNode(p.name + (p.type === 'ai' ? ' 🤖' : '')));

      var meta = document.createElement('div');
      meta.className = 'pmeta';
      meta.innerHTML = p.handCount + '장 · ' + p.score + '점';

      var money = document.createElement('div');
      money.className = 'pmoney';
      money.innerHTML = p.money.toLocaleString() + 'P';

      div.appendChild(name);
      div.appendChild(meta);
      div.appendChild(money);
      div.appendChild(capturedSummary(p.captured));

      if (p.seat !== mySeat && p.handCount > 0) {
        div.appendChild(handBacks(p.handCount));
      }
      if (!p.connected) {
        var off = document.createElement('div');
        off.className = 'pready';
        off.innerHTML = '연결 끊김';
        div.appendChild(off);
      } else if (p.goCount > 0) {
        var go = document.createElement('div');
        go.className = 'pready';
        go.innerHTML = p.goCount + '고';
        div.appendChild(go);
      }
      el.players.appendChild(div);
    }

    // 4인 광팔기 협상
    if (state.phase === 'negotiate') {
      el.table.innerHTML = '';
      for (var t = 0; t < state.table.length; t++) el.table.appendChild(makeCardEl(state.table[t], 'small'));
      el.tableHint.innerHTML = '바닥 1장만 공개됩니다 (협상 중)';
      el.hand.innerHTML = '';
      for (var h = 0; h < state.myHand.length; h++) el.hand.appendChild(makeCardEl(state.myHand[h], ''));
      el.turnInfo.innerHTML = '4인 광팔기 — 참가 여부 협상 중';
      el.timer.innerHTML = '';
      el.startBtn.className = 'primary hidden';
      el.overlay.className = 'overlay hidden';
      renderNegotiation(state);
      return;
    }

    // 선 결정
    if (state.phase === 'seon') {
      el.table.innerHTML = '';
      el.hand.innerHTML = '';
      el.turnInfo.innerHTML = '';
      el.timer.innerHTML = '';
      el.startBtn.className = 'primary hidden';
      el.overlay.className = 'overlay hidden';
      renderSeon(state);
      return;
    }

    // 바닥
    el.table.innerHTML = '';
    for (var f = 0; f < state.table.length; f++) {
      el.table.appendChild(makeCardEl(state.table[f], 'small'));
    }
    el.tableHint.innerHTML = state.table.length ? '바닥 ' + state.table.length + '장' : '';

    // 뒷패 더미
    el.deckStack.innerHTML = '';
    if (state.deckCount > 0) {
      var stack = document.createElement('div');
      stack.className = 'deck';
      for (var d = 0; d < Math.min(state.deckCount, 5); d++) {
        var b = document.createElement('div');
        b.className = 'card back';
        stack.appendChild(b);
      }
      el.deckStack.appendChild(stack);
      var dl = document.createElement('span');
      dl.className = 'deck-count';
      dl.innerHTML = '뒷패 ' + state.deckCount + '장';
      el.deckStack.appendChild(dl);
    }

    // 내 손패
    var myTurn = state.currentSeat === mySeat && !state.prompt;
    fitHandCards(state.myHand.length);
    el.hand.innerHTML = '';
    for (var k = 0; k < state.myHand.length; k++) {
      (function (index) {
        var card = makeCardEl(state.myHand[index], myTurn ? 'pick' : '');
        card.setAttribute('data-card-id', state.myHand[index].id);
        if (myTurn) {
          card.addEventListener('click', function () { playCard(card, index); });
        }
        el.hand.appendChild(card);
      })(k);
    }
    el.hand.className = 'hand' + (!myTurn && state.phase === 'play' ? ' waiting' : '');

    renderPrompt(state);
    renderScorePanel(state);

    var cur = state.players[state.currentSeat];
    if (state.phase === 'settle') el.turnInfo.innerHTML = '판이 끝났습니다.';
    else if (cur) el.turnInfo.innerHTML = cur.seat === mySeat ? '내 차례입니다' : cur.name + ' 차례';
    else el.turnInfo.innerHTML = '';

    var canStart = state.isHost && (state.phase === 'lobby' || state.phase === 'settle');
    el.startBtn.className = canStart ? 'primary' : 'primary hidden';
    el.startBtn.innerHTML = state.phase === 'settle' ? '다음 판' : '판 시작';

    if (state.phase === 'settle' && state.result) showResult(state);
    else el.overlay.className = 'overlay hidden';
  }

  function avatarColor(name) {
    var colors = ['#c96f5a', '#5a8fc9', '#6fbf73', '#c9a05a', '#9a6fc9', '#5ac9c0', '#c95a9a', '#8a9ac9'];
    var s = name || '?';
    var hash = 0;
    for (var i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return colors[hash % colors.length];
  }

  function handBacks(count) {
    var wrap = document.createElement('div');
    wrap.className = 'hand-backs';
    var n = count < 6 ? count : 6;
    for (var i = 0; i < n; i++) {
      var b = document.createElement('div');
      b.className = 'card back mini';
      wrap.appendChild(b);
    }
    return wrap;
  }

  function playCard(cardEl, index) {
    if (busy) return;
    if (!lastState || lastState.currentSeat !== mySeat || lastState.prompt) return;
    Fx.animateCardFlight(cardEl, el.table, -6, 260);
    setTimeout(function () { act('playCard', { handIndex: index }); }, 120);
  }

  function seatEl(seat) {
    return el.players.querySelector('.player[data-seat="' + seat + '"]');
  }

  // ── 4인 광팔기 협상 ─────────────────────────────────────────────────────

  function renderNegotiation(state) {
    var n = state.negotiation || {};
    var waiting = n.waitingSeat;
    el.promptBox.className = 'prompt';
    el.promptBox.innerHTML = '';

    var dec = n.decisions || {};
    var info = [];
    for (var key in dec) {
      if (!Object.prototype.hasOwnProperty.call(dec, key)) continue;
      var p = state.players[key];
      var d = dec[key];
      info.push((p ? p.name : '') + ': ' + (d === 'giveup' ? '포기' : d === 'sell' ? '광팔기' : '참가'));
    }
    if (info.length) {
      var span = document.createElement('span');
      span.innerHTML = info.join(' · ');
      el.promptBox.appendChild(span);
    }

    if (waiting !== mySeat) {
      var w = document.createElement('span');
      var wp = state.players[waiting];
      w.innerHTML = waiting < 0 ? '협상이 끝났습니다.' : (wp ? wp.name : '') + ' 님이 결정하는 중…';
      el.promptBox.appendChild(w);
      return;
    }

    var title = document.createElement('strong');
    title.innerHTML = '참가하시겠습니까?';
    el.promptBox.appendChild(title);

    var join = document.createElement('button');
    join.className = 'primary';
    join.innerHTML = '참가';
    join.addEventListener('click', function () { act('negotiate', { decision: 'join' }); });
    el.promptBox.appendChild(join);

    if (mySeat === 3) {
      var sell = document.createElement('button');
      sell.innerHTML = '광을 판다 (' + (n.gwangCount || 0) + '광)';
      sell.addEventListener('click', function () { act('negotiate', { decision: 'sell' }); });
      el.promptBox.appendChild(sell);
      if (n.mySaleCards && n.mySaleCards.length) {
        var lab = document.createElement('span');
        lab.innerHTML = '팔 패:';
        el.promptBox.appendChild(lab);
        for (var s = 0; s < n.mySaleCards.length; s++) {
          el.promptBox.appendChild(makeCardEl(n.mySaleCards[s], 'small'));
        }
      }
    } else {
      var giveup = document.createElement('button');
      giveup.innerHTML = '포기';
      giveup.addEventListener('click', function () { act('negotiate', { decision: 'giveup' }); });
      el.promptBox.appendChild(giveup);
    }
  }

  // ── 선 결정 ─────────────────────────────────────────────────────────────

  function renderSeon(state) {
    var cands = state.seonCandidates[mySeat] || [];
    if (!cands.length) {
      el.tableHint.innerHTML = '선(先)을 정하는 중입니다.';
      el.promptBox.className = 'prompt';
      el.promptBox.innerHTML = '<span>이 방은 이미 선을 정하는 중입니다. 다음 판에 참여해 주세요.</span>';
      return;
    }
    if (state.seonPicked[mySeat] !== -1) {
      el.tableHint.innerHTML = '카드를 골랐습니다. 다른 가족을 기다리는 중…';
      el.promptBox.className = 'prompt';
      el.promptBox.innerHTML = '<span>다른 가족들이 카드를 고르는 중입니다…</span>';
      return;
    }
    el.tableHint.innerHTML = '가장 크게(낮) 또는 가장 작게(밤) 나는 카드를 고르세요.';
    el.promptBox.className = 'prompt';
    el.promptBox.innerHTML = '';
    var label = document.createElement('strong');
    label.innerHTML = '선 결정 카드:';
    el.promptBox.appendChild(label);
    for (var i = 0; i < cands.length; i++) {
      (function (index) {
        var c = makeCardEl(cands[index], 'pick small');
        c.addEventListener('click', function () { act('seonPick', { cardIndex: index }); });
        el.promptBox.appendChild(c);
      })(i);
    }
  }

  // ── 프롬프트 ────────────────────────────────────────────────────────────

  function renderPrompt(state) {
    var p = state.prompt;
    if (!p) { el.promptBox.className = 'prompt hidden'; return; }
    el.promptBox.className = 'prompt';
    el.promptBox.innerHTML = '';

    if (p.seat !== mySeat) {
      var who = state.players[p.seat] ? state.players[p.seat].name : '상대';
      el.promptBox.innerHTML = '<span>' + who + ' 님이 선택하는 중입니다…</span>';
      return;
    }

    if (p.type === 'goStop') {
      el.promptBox.innerHTML = '<strong>고 / 스톱</strong>';
      var go = document.createElement('button');
      go.innerHTML = '고 (계속)';
      go.addEventListener('click', function () { act('go'); });
      var stop = document.createElement('button');
      stop.className = 'primary';
      stop.innerHTML = '스톱 (승리)';
      stop.addEventListener('click', function () { act('stop'); });
      el.promptBox.appendChild(go);
      el.promptBox.appendChild(stop);
      return;
    }

    if (p.type === 'floorChoice' || p.type === 'flipChoice') {
      el.promptBox.innerHTML = '<strong>가져갈 카드를 고르세요</strong>';
      var opts = p.options || [];
      for (var i = 0; i < opts.length; i++) {
        (function (index) {
          var c = makeCardEl(opts[index], 'pick small');
          c.addEventListener('click', function () {
            if (p.type === 'floorChoice') act('floorChoice', { choice: index });
            else act('flipChoice', { ordinal: index });
          });
          el.promptBox.appendChild(c);
        })(i);
      }
      return;
    }

    if (p.type === 'bonusDraw') {
      el.promptBox.innerHTML = '<strong>보너스패를 냈습니다 — 보충할 카드를 고르세요</strong>';
      var bopts = p.options || [];
      for (var j = 0; j < bopts.length; j++) {
        (function (opt) {
          var c = makeCardEl(opt, 'pick small');
          c.addEventListener('click', function () { act('bonusDraw', { stockIndex: opt.stockIndex }); });
          el.promptBox.appendChild(c);
        })(bopts[j]);
      }
    }
  }

  // ── 족보 패널 ───────────────────────────────────────────────────────────

  function renderScorePanel(state) {
    var s = state.mySets;
    el.scorePanel.innerHTML = '';
    if (!s) return;

    var me = state.players[mySeat];
    var total = me ? me.score : 0;

    var tiles = document.createElement('div');
    tiles.className = 'sp-tiles';

    var scoreTile = document.createElement('div');
    scoreTile.className = 'sp big';
    scoreTile.innerHTML = '<b>' + total + '</b><span>점</span>';
    tiles.appendChild(scoreTile);

    var countTile = document.createElement('div');
    countTile.className = 'sp';
    var captured = me && me.captured ? me.captured.total : 0;
    countTile.innerHTML = '<b>' + captured + '</b><span>개</span>';
    tiles.appendChild(countTile);

    var items = [
      ['광', s.bright, 3, 'guang'],
      ['고도리', s.godori, 3, 'godori'],
      ['홍단', s.hongdan, 3, 'hong'],
      ['청단', s.cheongdan, 3, 'cheong'],
      ['초단', s.chodan, 3, 'cho'],
      ['열꽃', s.animal, 5, 'animal'],
      ['띠', s.ribbon, 5, 'ribbon'],
      ['피', s.junk, 10, 'junk']
    ];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var d = document.createElement('div');
      d.className = 'sp' + (it[1] >= it[2] ? ' done' : '');
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = DOT_COLOR[it[3]] || 'var(--muted)';
      var b = document.createElement('b');
      b.innerHTML = it[0];
      var need = document.createElement('span');
      need.className = 'need';
      need.innerHTML = it[1] + '/' + it[2];
      d.appendChild(dot);
      d.appendChild(b);
      d.appendChild(need);
      tiles.appendChild(d);
    }
    el.scorePanel.appendChild(tiles);

    var cards = state.myCaptured || [];
    var rack = document.createElement('div');
    rack.className = 'my-cards';
    var title = document.createElement('span');
    title.className = 'my-cards-title';
    title.innerHTML = '내가 먹은 패';
    rack.appendChild(title);

    var fan = document.createElement('div');
    fan.className = 'card-fan';
    for (var c2 = 0; c2 < cards.length; c2++) {
      var card = cards[c2];
      var el2 = makeCardEl(card, 'tiny');
      var tags = card.tags || [];
      var setTag = null;
      for (var t = 0; t < tags.length; t++) {
        if (SET_TAGS.join(' ').indexOf(tags[t]) >= 0) { setTag = tags[t]; break; }
      }
      if (setTag) {
        el2.className += ' in-set';
        el2.style.setProperty('--sc', DOT_COLOR[SET_COLOR[setTag]] || '#e8c46a');
      }
      fan.appendChild(el2);
    }
    if (!cards.length) {
      var empty = document.createElement('span');
      empty.className = 'my-cards-empty';
      empty.innerHTML = '아직 먹은 패가 없습니다';
      fan.appendChild(empty);
    }
    rack.appendChild(fan);
    el.scorePanel.appendChild(rack);
  }

  // ── 정산 화면 ───────────────────────────────────────────────────────────

  function showResult(state) {
    var r = state.result;
    el.overlay.className = 'overlay';
    el.overlay.innerHTML = '';

    var box = document.createElement('div');
    box.className = 'overlay-inner';

    var h = document.createElement('h2');
    var wname = state.players[r.winnerSeat] ? state.players[r.winnerSeat].name : '승자';
    h.innerHTML = r.nagari ? '나가리' : wname + ' 승리!';
    box.appendChild(h);

    var sub = document.createElement('p');
    sub.className = 'overlay-sub';
    sub.innerHTML = r.nagari ? '이번 판은 승패가 없습니다. 다음 판은 2배입니다.' : '정산 결과';
    box.appendChild(sub);

    var rows = document.createElement('div');
    rows.className = 'rows';
    for (var i = 0; i < r.rows.length; i++) {
      var row = r.rows[i];
      var line = document.createElement('div');
      line.className = 'rowline' + (row.seat === r.winnerSeat ? ' win' : '');
      var left = document.createElement('span');
      left.innerHTML = row.name;
      var right = document.createElement('b');
      right.innerHTML = (row.amount > 0 ? '+' : '') + row.amount.toLocaleString() + ' P';
      line.appendChild(left);
      line.appendChild(right);
      if (row.reasons && row.reasons.length) {
        var why = document.createElement('small');
        why.innerHTML = row.reasons.join(' · ');
        line.appendChild(why);
      }
      rows.appendChild(line);
    }
    box.appendChild(rows);

    var steps = null;
    for (var j = 0; j < r.rows.length; j++) {
      if (r.rows[j].steps && r.rows[j].steps.length) { steps = r.rows[j]; break; }
    }
    if (steps) {
      var wrap = document.createElement('div');
      wrap.className = 'steps';
      var title2 = document.createElement('h3');
      title2.innerHTML = '점수 계산';
      wrap.appendChild(title2);
      for (var s = 0; s < steps.steps.length; s++) {
        var l = document.createElement('div');
        l.className = 'step';
        l.innerHTML = '<span>' + steps.steps[s].label + '</span><b>' + steps.steps[s].formula + ' = ' + steps.steps[s].value + '</b>';
        wrap.appendChild(l);
      }
      var money = document.createElement('div');
      money.className = 'step total';
      var total2 = steps.steps[steps.steps.length - 1];
      money.innerHTML = '<span>최종 점수</span><b>' + total2.value + '점</b>';
      wrap.appendChild(money);
      box.appendChild(wrap);
    }

    var btn = document.createElement('button');
    btn.className = 'primary';
    btn.innerHTML = '닫기';
    btn.addEventListener('click', function () { el.overlay.className = 'overlay hidden'; });
    box.appendChild(btn);

    el.overlay.appendChild(box);
  }

  // ── 타이머 ──────────────────────────────────────────────────────────────

  setInterval(function () {
    var s = lastState;
    if (!s || !s.deadline) { el.timer.innerHTML = ''; return; }
    var remain = Math.max(0, Math.round((s.deadline - Date.now()) / 1000));
    el.timer.innerHTML = remain + '초';
    el.timer.style.color = remain <= 5 ? 'var(--red)' : 'var(--gold)';
  }, 250);

  // 첫 사용자 입력 시 오디오 재생 허용(모바일 자동재생 정책 대비)
  document.addEventListener('pointerdown', function () {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) { var c = new Ctx(); if (c.resume) c.resume(); }
    } catch (e) {}
  }, false);

  var remembered = savedName();
  if (remembered) el.nameInput.value = remembered;

  if (Fx) {
    el.muteBtn.innerHTML = Fx.isMuted() ? '🔇' : '🔊';
    el.bgmBtn.className = 'chip icon' + (Fx.isBgmOn() ? ' on' : '');
  } else {
    // fx.js 가 로드되지 않은 구형 환경에서도 화면이 죽지 않게 한다
    el.muteBtn.style.display = 'none';
    el.bgmBtn.style.display = 'none';
  }
})();
