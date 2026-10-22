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
  // 사용자 입력(이름 등)을 innerHTML에 안전하게 넣기 위한 이스케이프
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  // 가상 돈을 한국 돈 단위로 표시 (1만 이상이면 만원, 아니면 원)
  function won(n) {
    n = Math.round(n || 0);
    if (Math.abs(n) >= 10000) {
      var m = n / 10000;
      var mStr = (Math.abs(m - Math.round(m)) < 0.001) ? String(Math.round(m)) : m.toFixed(1).replace(/\.0$/, '');
      return mStr + '만원';
    }
    return n.toLocaleString() + '원';
  }
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
  // 방에 새로 들어온 직후의 첫 응답 — 지난 이벤트를 다시 재생하지 않는다
  var freshJoin = true;
  // 정산 창을 한 번만 띄우기 위해 직전 phase 를 기억한다
  var prevPhase = '';
  var busy = false;
  // 상대 먹은 패 보기 방식: 'text' = 숫자만 / 'image' = 종류별 그림 (기본 그림)
  var oppView = 'image';
  try { oppView = localStorage.getItem('gs_opp_view') === 'text' ? 'text' : 'image'; } catch (e) { oppView = 'image'; }
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
    rulesBtn: $('rulesBtn'),
    rulesOverlay: $('rulesOverlay'),
    rulesCloseBtn: $('rulesCloseBtn'),
    joinBox: $('joinBox'),
    codeInput: $('codeInput'),
    joinGoBtn: $('joinGoBtn'),
    lobbyError: $('lobbyError'),
    roomListOverlay: $('roomListOverlay'),
    roomList: $('roomList'),
    roomListError: $('roomListError'),
    roomListJoinBtn: $('roomListJoinBtn'),
    roomListRefreshBtn: $('roomListRefreshBtn'),
    roomListCodeBtn: $('roomListCodeBtn'),
    roomListCloseBtn: $('roomListCloseBtn'),
    lobbySoundBtn: $('lobbySoundBtn'),
    lobbySettingsBtn: $('lobbySettingsBtn'),
    codeChip: $('codeChip'),
    moneyChip: $('moneyChip'),
    stakesChip: $('stakesChip'),
    meScore: $('meScore'),
    meCaptured: $('meCaptured'),
    muteBtn: $('muteBtn'),
    leaveBtn: $('leaveBtn'),
    settingsBtn: $('settingsBtn'),
    settingsOverlay: $('settingsOverlay'),
    settingsTitle: $('settingsTitle'),
    settingsSub: $('settingsSub'),
    settingsSaveBtn: $('settingsSaveBtn'),
    settingsCloseBtn: $('settingsCloseBtn'),
    pointSelect: $('pointSelect'),
    timeSelect: $('timeSelect'),
    deckStack: $('deckStack'),
    scorePanel: $('scorePanel'),
    players: $('players'),
    oppViewToggle: $('oppViewToggle'),
    table: $('table'),
    tableHint: $('tableHint'),
    promptBox: $('promptBox'),
    hand: $('hand'),
    flipBtn: $('flipBtn'),
    shakeBtn: $('shakeBtn'),
    turnInfo: $('turnInfo'),
    timer: $('timer'),
    startBtn: $('startBtn'),
    overlay: $('overlay')
  };

  var roomBrowser = window.GostopRoomBrowser({
    el: el,
    getJson: getJson,
    postJson: postJson,
    currentName: currentName,
    enterRoom: enterRoom
  });

  var KIND_LABEL = {
    bright: '광', animal: '열꽃', ribbon: '띠', junk: '피',
    doubleJunk: '쌍피', bonus: '보너스'
  };

  // 먹은 패를 종류별로 묶는 기준 — 내 패널과 상대 패 그림에서 함께 쓴다
  var CAP_GROUPS = [
    { key: 'bright', label: '광', kinds: ['bright'] },
    { key: 'animal', label: '열꽃', kinds: ['animal'] },
    { key: 'ribbon', label: '띠', kinds: ['ribbon'] },
    { key: 'junk', label: '피', kinds: ['junk', 'doubleJunk', 'bonus'] }
  ];

  var DOT_COLOR = {
    guang: '#e8c46a', godori: '#8fe0a8', hong: '#ef8fb0', cheong: '#7fb2e8',
    cho: '#9ed48a', animal: '#c9a0e8', ribbon: '#7fd4c4', junk: '#b9c4bb'
  };

  var SET_TAGS = ['godori', 'hongdan', 'cheongdan', 'chodan'];
  var SET_COLOR = { godori: 'godori', hongdan: 'hong', cheongdan: 'cheong', chodan: 'cho' };

  var scorePanel = window.GostopScorePanel({
    el: el,
    cardImg: cardImg,
    makeCardEl: makeCardEl,
    cardsOfKinds: cardsOfKinds,
    capGroups: CAP_GROUPS,
    setTags: SET_TAGS,
    dotColor: DOT_COLOR,
    setColor: SET_COLOR,
    escapeHtml: esc,
    fitTableCards: fitTableCards,
    mySeat: function () { return mySeat; }
  });

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

  // 드롭다운 선택 시 표시 텍스트 갱신 (선택 옵션의 텍스트를 표시에 반영)
  function refreshSelectLabel(selectEl) {
    var label = selectEl.options[selectEl.selectedIndex].text;
    var span = selectEl.parentNode.querySelector('span.z-0');
    if (span) { span.textContent = label; }
  }
  el.modeSelect.addEventListener('change', function () {
    refreshSelectLabel(this);
    toggleDiffSelect();
  });
  el.diffSelect.addEventListener('change', function () { refreshSelectLabel(this); });

  // 혼자(AI) 모드일 때만 AI 난이도 드롭다운 활성화, 그 외는 비활성화
  function toggleDiffSelect() {
    var isAI = el.modeSelect.value.indexOf('solo-') === 0;
    el.diffSelect.disabled = !isAI;
    if (isAI) {
      el.diffSelect.classList.remove('opacity-25');
      el.diffSelect.classList.add('cursor-pointer');
      el.diffSelect.classList.remove('cursor-not-allowed');
    } else {
      el.diffSelect.classList.add('opacity-25');
      el.diffSelect.classList.remove('cursor-pointer');
      el.diffSelect.classList.add('cursor-not-allowed');
    }
    refreshSelectLabel(el.diffSelect);
  }

  // 초기 로드 시 표시 텍스트 및 활성화 상태 설정
  refreshSelectLabel(el.modeSelect);
  refreshSelectLabel(el.diffSelect);
  toggleDiffSelect();

  el.createBtn.addEventListener('click', function () {
    var name = currentName();
    el.lobbyError.textContent = '';
    var parts = el.modeSelect.value.split('-');
    var mode = parts[0];
    var count = parts[1] ? parseInt(parts[1], 10) : 3;
    var diff = el.diffSelect.value;
    // 로비 ⚙ 에서 저장한 새 방 기본값 (점당 금액 · 시간 제한)
    var lobbySet = getLobbySettings();
    var preset = TIME_PRESETS[lobbySet.timeKey] || TIME_PRESETS.off;
    postJson('/api/room', {
      name: name,
      mode: mode,
      playerCount: count,
      aiDifficulty: diff,
      moneyPerPoint: lobbySet.moneyPerPoint,
      timeLimit: { enabled: preset.enabled, base: preset.base, increment: preset.increment }
    },
      function (res) {
        if (!res || !res.code) {
          el.lobbyError.textContent = (res && res.error) || '방을 만들지 못했습니다.';
          return;
        }
        enterRoom(res.code, res.seat);
      },
      function () { el.lobbyError.textContent = '서버에 연결할 수 없습니다.'; });
  });

  el.codeChip.addEventListener('click', function () {
    var done = function () { Fx.showBanner('방 코드 복사됨', 'plain', 900); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(roomCode || '').then(done, function () { done(); });
    } else { done(); }
  });

  // 소리 — 로비와 게임 화면의 버튼이 같은 상태를 공유한다
  function updateMuteButtons() {
    var muted = Fx ? Fx.isMuted() : false;
    if (el.muteBtn) {
      el.muteBtn.innerHTML = muted ? '🔇' : '🔊';
      el.muteBtn.title = muted ? '소리 켜기' : '소리 끄기';
    }
    if (el.lobbySoundBtn) {
      el.lobbySoundBtn.innerHTML = muted ? '🔇' : '🔊';
      el.lobbySoundBtn.title = muted ? '소리 켜기' : '소리 끄기';
    }
  }

  function toggleMute() {
    if (!Fx) return;
    Fx.setMuted(!Fx.isMuted());
    updateMuteButtons();
  }

  if (el.muteBtn) el.muteBtn.addEventListener('click', toggleMute);
  if (el.lobbySoundBtn) el.lobbySoundBtn.addEventListener('click', toggleMute);

  // ── 게임 설정 (방장 · 판 시작 전에만) ────────────────────────────────────
  var POINT_OPTIONS = [10, 100, 500, 1000, 5000, 10000];
  var TIME_PRESETS = {
    off: { enabled: false, base: 0, increment: 0 },
    '30': { enabled: true, base: 30, increment: 5 },
    '45': { enabled: true, base: 45, increment: 5 },
    '60': { enabled: true, base: 60, increment: 10 }
  };
  var LOBBY_SETTINGS_KEY = 'gs_lobby_settings';
  // 설정 창을 연 곳: 'room' = 방장 설정 / 'lobby' = 새 방 기본값
  var settingsMode = 'room';

  // 로비에서 저장한 새 방 기본값을 읽는다 (없거나 잘못된 값이면 기본값)
  function getLobbySettings() {
    var out = { moneyPerPoint: 100, timeKey: 'off' };
    try {
      var raw = localStorage.getItem(LOBBY_SETTINGS_KEY);
      if (!raw) return out;
      var saved = JSON.parse(raw);
      var pv = Number(saved && saved.moneyPerPoint);
      for (var i = 0; i < POINT_OPTIONS.length; i++) {
        if (POINT_OPTIONS[i] === pv) { out.moneyPerPoint = pv; break; }
      }
      if (saved && TIME_PRESETS[saved.timeKey]) out.timeKey = saved.timeKey;
    } catch (e) {}
    return out;
  }

  function saveLobbySettings(moneyPerPoint, timeKey) {
    try {
      localStorage.setItem(LOBBY_SETTINGS_KEY, JSON.stringify({
        moneyPerPoint: moneyPerPoint,
        timeKey: timeKey
      }));
    } catch (e) {}
  }

  function canEditSettings(state) {
    return !!(state && state.isHost && (state.phase === 'lobby' || state.phase === 'settle'));
  }

  function closeSettings() {
    if (el.settingsOverlay) el.settingsOverlay.className = 'overlay hidden';
  }

  // 창의 제목·설명을 여는 곳(로비/게임)에 맞춘다
  function setSettingsPanel(mode) {
    settingsMode = mode;
    if (el.settingsTitle) {
      el.settingsTitle.innerHTML = mode === 'lobby' ? '새 방 설정' : '게임 설정';
    }
    if (el.settingsSub) {
      el.settingsSub.innerHTML = mode === 'lobby'
        ? '방을 만들 때 적용됩니다.<br>게임 중에는 바꿀 수 없습니다.'
        : '방장만 바꿀 수 있습니다.<br>판을 시작하기 전에만 변경됩니다.';
    }
  }

  // 목록에 없는 점당 금액이면 선택지를 하나 추가한다
  function ensurePointOption(pv) {
    for (var i = 0; i < POINT_OPTIONS.length; i++) {
      if (String(POINT_OPTIONS[i]) === pv) return;
    }
    var opt = document.createElement('option');
    opt.value = pv;
    opt.text = Number(pv).toLocaleString() + '원';
    el.pointSelect.appendChild(opt);
  }

  function openSettings() {
    var st = lastState;
    if (!st || !st.settings) return;
    if (!st.isHost) { if (Fx) Fx.showBanner('방장만 바꿀 수 있습니다', 'plain', 1200); return; }
    if (!canEditSettings(st)) {
      if (Fx) Fx.showBanner('판 시작 전에만 바꿀 수 있습니다', 'plain', 1500);
      return;
    }

    setSettingsPanel('room');
    // 현재 점당 금액을 목록에 표시 (목록에 없는 값이면 하나 추가)
    var pv = String(st.settings.moneyPerPoint);
    ensurePointOption(pv);
    el.pointSelect.value = pv;

    var tl = st.settings.timeLimit || {};
    var tkey = !tl.enabled ? 'off' : String(tl.base);
    if (tkey !== 'off' && tkey !== '30' && tkey !== '45' && tkey !== '60') tkey = 'off';
    el.timeSelect.value = tkey;

    if (el.settingsOverlay) el.settingsOverlay.className = 'overlay';
  }

  // 로비 ⚙ — 방을 만들기 전에 새 방 기본값을 정한다 (방장 제한 없음)
  function openLobbySettings() {
    setSettingsPanel('lobby');
    var ls = getLobbySettings();
    ensurePointOption(String(ls.moneyPerPoint));
    el.pointSelect.value = String(ls.moneyPerPoint);
    el.timeSelect.value = ls.timeKey;
    if (el.settingsOverlay) el.settingsOverlay.className = 'overlay';
  }

  if (el.settingsBtn) el.settingsBtn.addEventListener('click', openSettings);
  if (el.lobbySettingsBtn) el.lobbySettingsBtn.addEventListener('click', openLobbySettings);
  if (el.settingsCloseBtn) el.settingsCloseBtn.addEventListener('click', closeSettings);
  if (el.settingsSaveBtn) el.settingsSaveBtn.addEventListener('click', function () {
    var preset = TIME_PRESETS[el.timeSelect.value] || TIME_PRESETS.off;
    var money = Number(el.pointSelect.value);
    closeSettings();
    if (settingsMode === 'lobby') {
      saveLobbySettings(money, el.timeSelect.value);
      if (Fx) Fx.showBanner('새 방 설정을 저장했습니다', 'plain', 1100);
      return;
    }
    act('settings', {
      moneyPerPoint: money,
      timeLimit: { enabled: preset.enabled, base: preset.base, increment: preset.increment }
    });
    if (Fx) Fx.showBanner('설정을 저장했습니다', 'plain', 1100);
  });

  el.startBtn.addEventListener('click', function () { act('start'); });
  if (el.flipBtn) el.flipBtn.addEventListener('click', function () { act('flipOnly'); });
  if (el.shakeBtn) el.shakeBtn.addEventListener('click', function () {
    var me2 = lastState ? lastState.players[mySeat] : null;
    var months = (me2 && me2.shakableMonths) || [];
    if (months.length) act('shake', { month: months[0] });
  });
  if (el.rulesBtn) el.rulesBtn.addEventListener('click', function () {
    if (el.rulesOverlay) el.rulesOverlay.className = 'overlay';
  });
  if (el.rulesCloseBtn) el.rulesCloseBtn.addEventListener('click', function () {
    if (el.rulesOverlay) el.rulesOverlay.className = 'overlay hidden';
  });

  // ── 나가기 ──────────────────────────────────────────────────────────────

  /** 방 화면을 정리하고 대기실로 돌아간다. (방이 닫혔을 때도 같은 경로를 쓴다) */
  function backToLobby(message) {
    try {
      sessionStorage.removeItem('gs_room');
      sessionStorage.removeItem('gs_name');
    } catch (e) {}
    roomCode = null;
    mySeat = -1;
    lastState = null;
    lastFxSeq = 0;
    lastVersion = -1;
    busy = false;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    el.room.className = 'screen hidden';
    el.lobby.className = 'screen';
    el.overlay.className = 'overlay hidden';
    el.promptBox.className = 'prompt hidden';
    el.scorePanel.innerHTML = '';
    el.players.innerHTML = '';
    el.table.innerHTML = '';
    el.hand.innerHTML = '';
    el.deckStack.innerHTML = '';
    el.codeChip.innerHTML = '------';
    el.moneyChip.innerHTML = '0원';
    if (el.stakesChip) el.stakesChip.innerHTML = '점당 —';
    if (el.meScore) el.meScore.innerHTML = '내 점수 <b>0</b>점';
    if (el.meCaptured) el.meCaptured.innerHTML = '';
    closeSettings();
    roomBrowser.close();
    el.turnInfo.innerHTML = '';
    el.timer.innerHTML = '';
    document.title = '명지네고스톱';
    if (message) el.lobbyError.textContent = message;
  }

  el.leaveBtn.addEventListener('click', function () {
    var code = roomCode;
    // 서버에는 '접속 끊김' 으로 알리고, 방 복귀 정보는 지운다
    if (code) {
      postJson('/api/room/' + code + '/action', { type: 'leave', payload: {} }, function () {}, function () {});
    }
    backToLobby('');
  });

  function enterRoom(code, seat) {
    roomBrowser.close();
    roomCode = code;
    mySeat = seat;
    lastFxSeq = 0;
    freshJoin = true;
    prevPhase = '';
    // 새로고침해도 방으로 돌아올 수 있게 방 코드와 이름을 기억한다
    try {
      sessionStorage.setItem('gs_room', code);
      sessionStorage.setItem('gs_name', el.nameInput.value.replace(/^\s+|\s+$/g, ''));
    } catch (e) {}
    el.lobby.className = 'screen hidden';
    el.room.className = 'screen';
    el.codeChip.innerHTML = code;
    document.title = '명지네고스톱 ' + code;
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
        var moveFx = []; // 상대가 낸 패·먹은 패 연출에 쓸 이벤트
        if (freshJoin) {
          // 새로고침·재입장 직후에는 지난 이벤트를 재생하지 않고 위치만 맞춘다
          for (var f = 0; f < fx.length; f++) {
            if (fx[f].seq > lastFxSeq) lastFxSeq = fx[f].seq;
          }
          freshJoin = false;
        } else {
          for (var i = 0; i < fx.length; i++) {
            if (fx[i].seq > lastFxSeq) lastFxSeq = fx[i].seq;
            moveFx.push(fx[i]);
            try {
              if (Fx) Fx.handleFx(fx[i], { seatEl: seatEl, mySeat: mySeat });
            } catch (e) { /* 이펙트 오류가 게임을 멈추지 않게 */ }
          }
        }
        lastState = res.state;
        try {
          render(res.state);
        } catch (e) {
          // 화면을 그리는 중 오류가 나도 대국은 계속된다
          if (!window.console || !console.error) return;
          console.error('[render]', e);
        }
        // 화면을 그린 뒤 — 상대가 낸 패·먹은 패가 날아가는 연출
        try {
          playOpponentMoves(moveFx);
        } catch (e) { /* 연출 오류가 게임을 멈추지 않게 */ }
      },
      function (xhr) {
        pollPending = false;
        if (done) done();
        // 방이 닫혔다면(방장이 나가서 방이 사라짐) 대기실로 돌아간다
        if (xhr && xhr.status === 404) {
          backToLobby('방이 닫혔습니다. 방장이 방을 나갔을 수 있습니다.');
        }
      });
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
    }, function (xhr) {
      busy = false;
      if (xhr && xhr.status === 404) {
        backToLobby('방이 닫혔습니다. 방장이 방을 나갔을 수 있습니다.');
        return;
      }
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
      tag.innerHTML = '<span>' + items[i][1] + '</span><b>' + n + '</b>';
      wrap.appendChild(tag);
    }
    return wrap;
  }

  function fitHandCards(count) {
    if (!count) return;
    // 좌우 여백(핸드 감싸는 패딩)과 부채꼴 회전으로 생기는 바깥쪽 여유까지 빼고 계산한다
    var avail = Math.min(window.innerWidth - 56, 760);
    var gap = 3;
    var w = Math.floor((avail - (count - 1) * gap) / count);
    // 화면 높이가 낮으면(가로 모드) 손패를 줄여 가운데 화투판 자리를 남긴다
    var cap = 74;
    var min = 38;
    if (window.innerHeight < 700) cap = 64;
    if (window.innerHeight < 560) { cap = 52; min = 36; }
    if (w > cap) w = cap;
    if (w < min) w = min;
    el.hand.style.setProperty('--hand-w', w + 'px');
  }

  // PC 화면 — 바닥 화투패를 화면 크기에 맞춰 크게 (폰은 CSS 고정 크기를 쓴다)
  function fitTableCards() {
    if (window.innerWidth <= 480 || window.innerHeight <= 560) {
      el.table.style.removeProperty('--floor-w');
      return;
    }
    var wrap = el.table.parentNode;
    var count = el.table.children ? el.table.children.length : 0;
    if (!wrap || !count) return;
    var deckH = el.deckStack ? el.deckStack.offsetHeight : 0;
    var hintH = el.tableHint ? el.tableHint.offsetHeight : 0;
    var availW = wrap.clientWidth - 12;
    var availH = wrap.clientHeight - deckH - hintH - 26;
    var size = 40;
    for (var s = 126; s >= 40; s -= 2) {
      var ch = Math.round(s * 1.63);
      var perRow = Math.floor((availW + 4) / (s + 4));
      if (perRow < 1) perRow = 1;
      var rows = Math.ceil(count / perRow);
      if (rows * ch + (rows - 1) * 4 <= availH) { size = s; break; }
    }
    el.table.style.setProperty('--floor-w', size + 'px');
  }

  // 먹은 카드 중 해당 종류만 골라 월 순서로 정렬
  function cardsOfKinds(cards, kinds) {
    var list = [];
    for (var i = 0; i < cards.length; i++) {
      for (var k = 0; k < kinds.length; k++) {
        if (cards[i].kind === kinds[k]) { list.push(cards[i]); break; }
      }
    }
    list.sort(function (a, b) { return (a.month || 0) - (b.month || 0); });
    return list;
  }

  // 상대가 먹은 패 — 종류별 2×2 묶음, 각 묶음은 옆으로 넘겨 볼 수 있다
  function oppCaptured(cards) {
    var wrap = document.createElement('div');
    wrap.className = 'opp-caps';
    for (var g = 0; g < CAP_GROUPS.length; g++) {
      var grp = CAP_GROUPS[g];
      var list = cardsOfKinds(cards, grp.kinds);
      var cell = document.createElement('div');
      cell.className = 'opp-cap opp-cap-' + grp.key;

      var label = document.createElement('span');
      label.className = 'opp-cap-label';
      label.innerHTML = grp.label + ' <b>' + list.length + '</b>';
      cell.appendChild(label);

      var strip = document.createElement('div');
      strip.className = 'opp-cap-cards';
      if (!list.length) {
        var none = document.createElement('span');
        none.className = 'opp-cap-none';
        none.innerHTML = '—';
        strip.appendChild(none);
      } else {
        for (var i = 0; i < list.length; i++) {
          var card = makeCardEl(list[i], 'micro');
          var tags = list[i].tags || [];
          var setTag = null;
          for (var t = 0; t < tags.length; t++) {
            if (SET_TAGS.join(' ').indexOf(tags[t]) >= 0) { setTag = tags[t]; break; }
          }
          if (setTag) {
            card.className += ' in-set';
            card.style.setProperty('--sc', DOT_COLOR[SET_COLOR[setTag]] || '#e8c46a');
          }
          strip.appendChild(card);
        }
      }
      cell.appendChild(strip);
      wrap.appendChild(cell);
    }
    return wrap;
  }

  // 상대 플레이어 — 나는 아래(손패·족보·머니칩)에 이미 나오므로 상단에는 상대만 보여준다
  function renderOpponents(state) {
    el.players.innerHTML = '';
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      if (p.seat === mySeat) continue;
      var div = document.createElement('div');
      var cls = 'player';
      if (p.seat === state.currentSeat) cls += ' active';
      if (p.type === 'ai') cls += ' ai';
      if (!p.connected) cls += ' off';
      div.className = cls;
      div.setAttribute('data-seat', String(p.seat));

      // 이름 · 점수 · 돈 — 한 줄 알약
      var pill = document.createElement('div');
      pill.className = 'opp-pill';

      var name = document.createElement('span');
      name.className = 'pname';
      name.appendChild(document.createTextNode(p.name + (p.type === 'ai' ? ' 🤖' : '')));
      pill.appendChild(name);

      var meta = document.createElement('span');
      meta.className = 'pmeta';
      meta.innerHTML = '점수 <b>' + p.score + '</b> · ' + p.handCount + '장';
      pill.appendChild(meta);

      var money = document.createElement('span');
      money.className = 'pmoney';
      money.innerHTML = won(p.money);
      pill.appendChild(money);

      if (!p.connected) {
        var off = document.createElement('span');
        off.className = 'pready off';
        off.innerHTML = '연결 끊김';
        pill.appendChild(off);
      } else if (p.goCount > 0) {
        var go = document.createElement('span');
        go.className = 'pready go';
        go.innerHTML = '🔥 ' + p.goCount + '고!';
        pill.appendChild(go);
      }
      div.appendChild(pill);

      // 먹은 패 — 숫자(요약) 또는 종류별 그림
      var box = document.createElement('div');
      box.className = 'opp-box';
      if (oppView === 'image' && p.capturedCards && p.capturedCards.length) {
        box.appendChild(oppCaptured(p.capturedCards));
      } else if (oppView === 'image') {
        var empty = document.createElement('div');
        empty.className = 'opp-caps-empty';
        empty.innerHTML = '먹은 패 없음';
        box.appendChild(empty);
      } else {
        box.appendChild(capturedSummary(p.captured));
      }
      div.appendChild(box);

      el.players.appendChild(div);
    }
  }

  // 상대 패 보기 토글 — 선택은 이 기기에 저장한다
  function updateOppViewButtons() {
    if (!el.oppViewToggle) return;
    var btns = el.oppViewToggle.getElementsByTagName('button');
    var on = oppView === 'text' ? 'text' : 'image';
    for (var i = 0; i < btns.length; i++) {
      btns[i].className = btns[i].getAttribute('data-view') === on ? 'on' : '';
    }
  }

  function setOppView(v) {
    oppView = v === 'text' ? 'text' : 'image';
    try { localStorage.setItem('gs_opp_view', oppView); } catch (e) {}
    updateOppViewButtons();
    if (lastState) renderOpponents(lastState);
  }

  if (el.oppViewToggle) {
    el.oppViewToggle.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var v = t.getAttribute('data-view');
      if (v) setOppView(v);
    });
  }
  updateOppViewButtons();

  // 카드 연출 — 그리기 전 자리 기억 → 다시 그림 → 옮겨진 카드는 미끄러지고
  // 새로 생긴 카드는 위에서 떨어지며 나타난다. (벤치마킹: bipark/gostop-ts)
  var CARD_ANIM_SELECTOR = '#hand .card, #table .card, #promptBox .card';
  // 직전 화면의 카드 자리 — 상대가 먹은 패가 어디서 날아왔는지 알 때 쓴다
  var prevCardRects = {};
  // 상대가 내는 중인 카드 — 바닥에 먼저 도착하지 않게 잠시 가려둔다
  var flyingCards = {};

  function render(state) {
    prevCardRects = Fx.captureRects(CARD_ANIM_SELECTOR);
    renderState(state);
    Fx.flipCards(prevCardRects, CARD_ANIM_SELECTOR);
    // 날아가는 중인 카드는 화면이 갱신돼도 계속 가려둔다
    for (var id in flyingCards) {
      var flown = el.table.querySelector('[data-card-id="' + id + '"]');
      if (flown) flown.style.opacity = '0';
    }
  }

  /**
   * 상대가 낸 패 · 먹은 패 연출
   *   - 낸 카드  : 상대의 자리 → 바닥으로 날아온다
   *   - 먹은 패  : 바닥 → 상대의 먹은 패 자리로 날아간다
   */
  function playOpponentMoves(fxs) {
    if (!fxs || !fxs.length) return;
    for (var i = 0; i < fxs.length; i++) {
      var fx = fxs[i];
      if (!fx || !fx.cards || !fx.cards.length) continue;
      if (fx.seat < 0) continue;
      var isMe = fx.seat === mySeat;
      var seat = isMe ? null : seatEl(fx.seat);
      if (!isMe && !seat) continue;
      var seatRect = isMe ? el.meCaptured.getBoundingClientRect() : seat.getBoundingClientRect();

      if (fx.kind === 'place' || fx.kind === 'bbeok') {
        // 상대가 낸 카드가 자리에서 바닥으로 날아온다 (내가 낸 카드는 playCard 가 맡는다)
        if (isMe) continue;
        for (var c = 0; c < fx.cards.length; c++) {
          var id = fx.cards[c];
          var target = el.table.querySelector('[data-card-id="' + id + '"]');
          if (!target) continue; // 곧바로 먹힌 카드는 먹은 패 연출로 이어진다
          var toRect = target.getBoundingClientRect();
          // 출발은 상대의 자리 가운데, 크기는 바닥 카드와 똑같이
          var fromBox = cardBox(seatRect, toRect.width, toRect.height);
          target.style.opacity = '0';
          flyingCards[id] = 1;
          Fx.animateCardMove(fromBox, toRect, cardImg({ id: id }), 340, -8, (function (cardId, node) {
            return function () {
              delete flyingCards[cardId];
              var again = node && node.parentNode
                ? node
                : el.table.querySelector('[data-card-id="' + cardId + '"]');
              if (again) again.style.opacity = '';
            };
          })(id, target));
        }
      } else if (fx.kind === 'capture') {
        // 먹은 패가 바닥에서 먹은 패 자리로 날아간다
        var rack = isMe ? el.meCaptured : (seat.querySelector('.opp-box') || seat);
        var rackRect = rack.getBoundingClientRect();
        for (var k = 0; k < fx.cards.length; k++) {
          var cid = fx.cards[k];
          var old = prevCardRects[cid];
          var from = old || cardBox(seatRect, 54, 88);
          Fx.animateCardMove(from, rackRect, cardImg({ id: cid }), 380, 10);
        }
      }
    }
  }

  /** 자리 가운데에 카드 크기의 상자를 만든다. */
  function cardBox(centerRect, w, h) {
    return {
      left: centerRect.left + centerRect.width / 2 - w / 2,
      top: centerRect.top + centerRect.height / 2 - h / 2,
      width: w,
      height: h
    };
  }

  function renderState(state) {
    var phaseBefore = prevPhase;
    prevPhase = state.phase;
    var me = state.players[mySeat];
    el.moneyChip.innerHTML = won(me ? me.money : 0);

    // 점당 금액 · 판돈 배수 (나가리 이월)
    if (el.stakesChip && state.settings) {
      var mult = state.settings.stakeMultiplier || 1;
      el.stakesChip.innerHTML = '점당 ' + won(state.settings.moneyPerPoint) +
        (mult > 1 ? ' <b>×' + mult + '</b>' : '');
    }
    // 내 점수 · 먹은 패 요약
    if (el.meScore) el.meScore.innerHTML = '내 점수 <b>' + (me ? me.score : 0) + '</b>점';
    if (el.meCaptured) {
      el.meCaptured.innerHTML = '';
      el.meCaptured.appendChild(capturedSummary(me ? me.captured : null));
    }

    // 설정(⚙) — 방장만 보이고, 판 시작 전(lobby/settle)에만 활성화
    if (el.settingsBtn) {
      var canSet = state.isHost && (state.phase === 'lobby' || state.phase === 'settle');
      el.settingsBtn.className = 'chip icon' + (state.isHost ? '' : ' hidden') + (canSet ? '' : ' off');
      el.settingsBtn.title = canSet ? '게임 설정 (점당·시간 제한)' : '판 시작 전에만 설정을 바꿀 수 있습니다';
    }

    // 플레이어 — 나는 아래(손패·족보·머니칩)에 이미 나오므로 상단에는 상대만 보여준다
    renderOpponents(state);

    // 4인 광팔기 협상
    if (state.phase === 'negotiate') {
      el.table.innerHTML = '';
      for (var t = 0; t < state.table.length; t++) {
        var nc = makeCardEl(state.table[t], 'small');
        nc.setAttribute('data-card-id', state.table[t].id);
        el.table.appendChild(nc);
      }
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
      // 새 판이 시작됐으므로 지난 판의 먹은 패·점수판을 비운다
      scorePanel.render(state);
      renderSeon(state);
      // 덱을 섞는 연출 — 판이 넘어가 '선 결정' 으로 넘어갈 때 한 번
      // (섞는 카드 수는 서버가 알려주는 실제 덱 장수를 따른다)
      if (phaseBefore !== 'seon') Fx.playShuffle(state.deckCount);
      return;
    }

    // 바닥
    el.table.innerHTML = '';
    for (var f = 0; f < state.table.length; f++) {
      var fc = makeCardEl(state.table[f], 'small');
      fc.setAttribute('data-card-id', state.table[f].id);
      el.table.appendChild(fc);
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
    // 바닥에 같은 월이 있으면 '낼수있음' 표시 — 고를 때 한눈에 보이게
    var floorMonths = {};
    for (var tf = 0; tf < state.table.length; tf++) floorMonths[state.table[tf].month] = true;
    for (var k = 0; k < state.myHand.length; k++) {
      (function (index) {
        var cardData = state.myHand[index];
        var canMatch = myTurn && floorMonths[cardData.month];
        var card = makeCardEl(cardData, (myTurn ? 'pick ' : '') + (canMatch ? 'match' : ''));
        card.setAttribute('data-card-id', cardData.id);
        if (myTurn) {
          if (canMatch) {
            var badge = document.createElement('span');
            badge.className = 'can-play';
            badge.innerHTML = '낼수있음';
            card.appendChild(badge);
          }
          card.addEventListener('click', function () { playCard(card, index); });
        }
        el.hand.appendChild(card);
      })(k);
    }
    el.hand.className = 'hand' + (!myTurn && state.phase === 'play' ? ' waiting' : '');

    renderPrompt(state);
    scorePanel.render(state);
    // 족보 줄까지 그린 뒤에 바닥패 크기를 계산해야 실제 남은 높이가 맞는다
    fitTableCards();

    var cur = state.players[state.currentSeat];
    if (state.phase === 'settle') el.turnInfo.innerHTML = '판이 끝났습니다.';
    else if (cur) el.turnInfo.innerHTML = cur.seat === mySeat ? '내 차례입니다' : esc(cur.name) + ' 차례';
    else el.turnInfo.innerHTML = '';

    // 뒤집기 버튼 — 카드빚이 있을 때만 (내 차례)
    if (el.flipBtn) {
      var showFlip = (state.phase === 'play' && state.currentSeat === mySeat && me && me.cardDebt > 0);
      el.flipBtn.className = showFlip ? 'chip' : 'chip hidden';
    }
    // 흔들기 버튼 — 같은 월 3장 이상 들고 있을 때 (내 차례)
    if (el.shakeBtn) {
      var showShake = (state.phase === 'play' && state.currentSeat === mySeat && me && me.shakableMonths && me.shakableMonths.length > 0);
      el.shakeBtn.className = showShake ? 'chip' : 'chip hidden';
    }

    var canStart = state.isHost && (state.phase === 'lobby' || state.phase === 'settle');
    el.startBtn.className = canStart ? 'primary' : 'primary hidden';
    el.startBtn.innerHTML = state.phase === 'settle' ? '다음 판' : '판 시작';

    // 정산 창은 판이 끝난 순간에만 띄운다 (닫은 뒤 몇 초마다 다시 뜨지 않게)
    if (state.phase === 'settle' && state.result) {
      if (phaseBefore !== 'settle') showResult(state);
    } else {
      el.overlay.className = 'overlay hidden';
    }
  }

  function playCard(cardEl, index) {
    if (busy) return;
    if (!lastState || lastState.currentSeat !== mySeat || lastState.prompt) return;
    var cardId = cardEl.getAttribute('data-card-id');
    Fx.animateCardFlight(cardEl, el.table, -6, 260);
    // 날아가는 동안 바닥에는 카드가 아직 없는 것처럼 보여 준다
    if (cardId) {
      flyingCards[cardId] = 1;
      setTimeout(function () {
        delete flyingCards[cardId];
        var node = el.table.querySelector('[data-card-id="' + cardId + '"]');
        if (node) node.style.opacity = '';
      }, 320);
    }
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
      info.push((p ? esc(p.name) : '') + ': ' + (d === 'giveup' ? '포기' : d === 'sell' ? '광팔기' : '참가'));
    }
    if (info.length) {
      var span = document.createElement('span');
      span.innerHTML = info.join(' · ');
      el.promptBox.appendChild(span);
    }

    if (waiting !== mySeat) {
      var w = document.createElement('span');
      var wp = state.players[waiting];
      w.innerHTML = waiting < 0 ? '협상이 끝났습니다.' : (wp ? esc(wp.name) : '') + ' 님이 결정하는 중…';
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
        c.setAttribute('data-card-id', cands[index].id);
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
      el.promptBox.innerHTML = '<span>' + esc(who) + ' 님이 선택하는 중입니다…</span>';
      return;
    }

    if (p.type === 'goStop') {
      el.promptBox.innerHTML = '<strong>고 / 스톱</strong><em class="prompt-sub">점수를 더 노릴까요, 지금 이길까요?</em>';
      var go = document.createElement('button');
      go.className = 'btn-go';
      go.innerHTML = '🔥 고! (계속)';
      go.addEventListener('click', function () { act('go'); });
      var stop = document.createElement('button');
      stop.className = 'btn-stop';
      stop.innerHTML = '✋ 스톱! (승리)';
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
          c.setAttribute('data-card-id', opts[index].id);
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

  // ── 정산 화면 ───────────────────────────────────────────────────────────

  function showResult(state) {
    var r = state.result;
    el.overlay.className = 'overlay';
    el.overlay.innerHTML = '';

    // 정산 사운드 — 내 gain/lose + 박 발생 시 sfx_bak
    try {
      if (window.GostopFx && GostopFx.playSound) {
        var myRow = null;
        for (var i = 0; i < r.rows.length; i++) {
          if (r.rows[i].seat === mySeat) { myRow = r.rows[i]; break; }
        }
        if (myRow) {
          if (myRow.amount > 0) GostopFx.playSound('sfx_money_gain.ogg');
          else if (myRow.amount < 0) GostopFx.playSound('sfx_money_lose.ogg');
        }
        var anyBak = false;
        for (var j = 0; j < r.rows.length; j++) {
          if (r.rows[j].pibak || r.rows[j].gwangbak || r.rows[j].meongbak || r.rows[j].gobak) { anyBak = true; break; }
        }
        if (anyBak) GostopFx.playSound('sfx_bak.ogg');
      }
    } catch (e) {}

    var box = document.createElement('div');
    box.className = 'overlay-inner';

    var h = document.createElement('h2');
    var wname = state.players[r.winnerSeat] ? state.players[r.winnerSeat].name : '승자';
    h.innerHTML = r.nagari ? '나가리' : esc(wname) + ' 승리!';
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
      left.innerHTML = esc(row.name);
      var right = document.createElement('b');
      right.innerHTML = (row.amount > 0 ? '+' : '') + won(row.amount);
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

  // 화면을 돌리거나 창 크기가 바뀌면 손패 크기를 다시 맞춘다
  window.addEventListener('resize', function () {
    try {
      if (lastState && lastState.myHand && lastState.myHand.length) {
        fitHandCards(lastState.myHand.length);
        fitTableCards();
      }
    } catch (e) {}
  }, false);

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
    updateMuteButtons();
  } else {
    // fx.js 가 로드되지 않은 구형 환경에서도 화면이 죽지 않게 한다
    if (el.muteBtn) el.muteBtn.style.display = 'none';
    if (el.lobbySoundBtn) el.lobbySoundBtn.style.display = 'none';
  }
})();
