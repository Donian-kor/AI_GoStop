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
  // 가상 돈을 한국 돈 단위로 표시 (조/억/만/천/원 단위로 줄맞춤)
  function won(n) {
    n = Math.round(n || 0);
    if (n === 0) return '0원';
    var neg = n < 0;
    n = Math.abs(n);
    var t = Math.floor(n / 1000000000000); // 조
    n %= 1000000000000;
    var e = Math.floor(n / 100000000); // 억
    n %= 100000000;
    var m = Math.floor(n / 10000); // 만
    n %= 10000;
    var parts = [];
    if (t > 0) parts.push(t + '조');
    if (e > 0) parts.push(e + '억');
    if (m > 0) parts.push(m + '만');
    if (n > 0) parts.push(n + '원');
    else if (parts.length > 0) parts.push('원');
    else parts.push('0원');
    return neg ? '-' + parts.join('') : parts.join('');
  }
  var CARD_IMG = 'assets/hwatu/png/';
  var buildVersion = '1';
  // 정산 창을 한 번만 띄우기 위해 직전 phase 를 기억한다
  var prevPhase = '';
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
    installBtn: $('installBtn'),
    installGuide: $('installGuide'),
    roomListOverlay: $('roomListOverlay'),
    roomList: $('roomList'),
    roomListError: $('roomListError'),
    roomListJoinBtn: $('roomListJoinBtn'),
    roomListRefreshBtn: $('roomListRefreshBtn'),
    roomListCodeBtn: $('roomListCodeBtn'),
    roomListCloseBtn: $('roomListCloseBtn'),
    lobbySoundBtn: $('lobbySoundBtn'),
    lobbySettingsBtn: $('lobbySettingsBtn'),
    authBtn: $('authBtn'),
    leaderboardBtn: $('leaderboardBtn'),
    authOverlay: $('authOverlay'),
    authTitle: $('authTitle'),
    authSub: $('authSub'),
    authTabLogin: $('authTabLogin'),
    authTabRegister: $('authTabRegister'),
    authName: $('authName'),
    authPass: $('authPass'),
    authError: $('authError'),
    authInfo: $('authInfo'),
    authUserName: $('authUserName'),
    authUserMoney: $('authUserMoney'),
    authSubmitBtn: $('authSubmitBtn'),
    authLogoutBtn: $('authLogoutBtn'),
    authCloseBtn: $('authCloseBtn'),
    leaderboardOverlay: $('leaderboardOverlay'),
    leaderboardList: $('leaderboardList'),
    leaderboardRefreshBtn: $('leaderboardRefreshBtn'),
    leaderboardCloseBtn: $('leaderboardCloseBtn'),
    codeChip: $('codeChip'),
    moneyChip: $('moneyChip'),
    stakesChip: $('stakesChip'),
    meGoBadge: $('meGoBadge'),
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
    bonusPackSelect: $('bonusPackSelect'),
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

  var authMode = 'login';
  var currentUser = null;

  function authXhr(method, url, body, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.withCredentials = true;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
      cb(xhr.status, data);
    };
    xhr.send(body ? JSON.stringify(body) : null);
  }

  window.gostopOpenAuth = function () {
    if (el.authOverlay) el.authOverlay.className = 'overlay';
    refreshAuthUI();
  };
  function refreshAuthUI() {
    window.gostopUser = currentUser;
    if (currentUser) {
      el.authInfo.className = '';
      el.authUserName.innerHTML = esc(currentUser.name);
      el.authUserMoney.innerHTML = won(currentUser.money);
      el.authSubmitBtn.className = 'hidden';
      el.authLogoutBtn.className = '';
      el.authName.value = currentUser.name;
      el.authName.disabled = true;
      el.authPass.value = '';
      el.authPass.disabled = true;
      el.authTitle.innerHTML = '내 계정';
      el.authSub.innerHTML = '로그인 중입니다.';
      if (el.nameInput) el.nameInput.value = currentUser.name;
    } else {
      el.authInfo.className = 'hidden';
      el.authSubmitBtn.className = 'primary';
      el.authLogoutBtn.className = 'hidden';
      el.authName.disabled = false;
      el.authPass.disabled = false;
      el.authTitle.innerHTML = authMode === 'login' ? '로그인' : '회원가입';
      el.authSub.innerHTML = authMode === 'login' ? '기존 계정으로 로그인합니다.' : '새 가족 계정을 만듭니다.';
    }
    el.authError.innerHTML = '';
  }

  function loadAuth() {
    authXhr('GET', '/api/auth/me', null, function (status, data) {
      if (status === 200 && data && data.ok && data.user) {
        currentUser = data.user;
      } else {
        currentUser = null;
      }
      refreshAuthUI();
    });
  }

  function submitAuth() {
    var name = el.authName.value;
    var pass = el.authPass.value;
    var url = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    authXhr('POST', url, { name: name, password: pass }, function (status, data) {
      if (status === 200 && data && data.ok) {
        currentUser = { name: data.name, money: data.money };
        refreshAuthUI();
        el.authOverlay.className = 'overlay hidden';
      } else {
        el.authError.innerHTML = esc((data && data.error) || '처리 중 오류가 발생했습니다.');
      }
    });
  }

  function logoutAuth() {
    authXhr('POST', '/api/auth/logout', {}, function () {
      currentUser = null;
      el.authName.value = '';
      el.authPass.value = '';
      el.authName.disabled = false;
      el.authPass.disabled = false;
      refreshAuthUI();
    });
  }

  function openLeaderboard() {
    el.leaderboardOverlay.className = 'overlay';
    el.leaderboardList.innerHTML = '<p class="room-list-empty">불러오는 중입니다.</p>';
    authXhr('GET', '/api/leaderboard', null, function (status, data) {
      if (status !== 200 || !data || !data.ok) {
        el.leaderboardList.innerHTML = '<p class="room-list-empty">불러오지 못했습니다.</p>';
        return;
      }
      var list = data.list || [];
      if (!list.length) {
        el.leaderboardList.innerHTML = '<p class="room-list-empty">등록된 가족이 없습니다.</p>';
        return;
      }
      el.leaderboardList.innerHTML = '';
      for (var i = 0; i < list.length; i++) {
        var u = list[i];
        var rank = i + 1;
        var rankText = rank + '등';
        var row = document.createElement('div');
        row.className = 'leaderboard-item';
        row.innerHTML =
          '<span class="leaderboard-rank">' + esc(rankText) + '</span>' +
          '<span class="leaderboard-name">' + esc(u.name) + '</span>' +
          '<span class="leaderboard-money"><b>' + won(u.money) + '</b></span>';
        el.leaderboardList.appendChild(row);
      }
    });
  }

  var roomBrowser = null;
  var settingsView = null;
  var opponentCardMotion = null;
  var roomSession = window.GostopRoomSession({
    el: el,
    fx: Fx,
    render: render,
    seatEl: seatEl,
    closeRoomBrowser: function () { if (roomBrowser) roomBrowser.close(); },
    onEnter: function () {
      prevPhase = '';
      prevCardRects = {};
      renderedMoveContext = { handIds: {}, floorIds: {}, floorCards: [] };
      motionPreviousContext = renderedMoveContext;
    },
    onLeave: resetRoomView,
    getSavedName: savedName,
    playOpponentMoves: function (moveFx, state) { opponentCardMotion.play(moveFx, state); }
  });
  var getJson = roomSession.getJson;
  var postJson = roomSession.postJson;

  roomBrowser = window.GostopRoomBrowser({
    el: el,
    getJson: getJson,
    postJson: postJson,
    currentName: currentName,
    enterRoom: roomSession.enterRoom
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
    mySeat: function () { return roomSession.getMySeat(); }
  });

  var resultView = window.GostopResultView({
    el: el,
    escapeHtml: esc,
    formatMoney: won,
    mySeat: function () { return roomSession.getMySeat(); },
    startNextRound: function () { roomSession.act('start'); }
  });

  var phaseViews = window.GostopPhaseViews({
    el: el,
    mySeat: function () { return roomSession.getMySeat(); },
    escapeHtml: esc,
    makeCardEl: makeCardEl,
    act: roomSession.act
  });

  var opponentView = window.GostopOpponentView({
    el: el,
    mySeat: function () { return roomSession.getMySeat(); },
    oppView: function () { return oppView; },
    formatMoney: won,
    makeCardEl: makeCardEl,
    cardsOfKinds: cardsOfKinds,
    capGroups: CAP_GROUPS,
    setTags: SET_TAGS,
    dotColor: DOT_COLOR,
    setColor: SET_COLOR
  });

  var handView = window.GostopHandView({
    el: el,
    mySeat: function () { return roomSession.getMySeat(); },
    fitHandCards: fitHandCards,
    makeCardEl: makeCardEl,
    playCard: playCard
  });

  var tableDeckView = window.GostopTableDeckView({
    el: el,
    makeCardEl: makeCardEl
  });

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
    if (!currentUser) {
      el.lobbyError.textContent = '로그인 후 방을 만들 수 있습니다.';
      if (el.authOverlay) el.authOverlay.className = 'overlay';
      refreshAuthUI();
      return;
    }
    var name = currentUser.name;
    el.lobbyError.textContent = '';
    var parts = el.modeSelect.value.split('-');
    var mode = parts[0];
    var count = parts[1] ? parseInt(parts[1], 10) : 3;
    var diff = el.diffSelect.value;
    // 로비 ⚙ 에서 저장한 새 방 기본값 (점당 금액 · 시간 제한)
    var lobbySet = settingsView.getRoomDefaults();
    roomSession.createRoom({
      name: name,
      mode: mode,
      playerCount: count,
      aiDifficulty: diff,
      moneyPerPoint: lobbySet.moneyPerPoint,
      timeLimit: lobbySet.timeLimit,
      bonusPack: lobbySet.bonusPack
    }, function (message) { el.lobbyError.textContent = message; });
  });

  el.codeChip.addEventListener('click', function () {
    var done = function () { Fx.showBanner('방 코드 복사됨', 'plain', 900); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(roomSession.getRoomCode() || '').then(done, function () { done(); });
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
  settingsView = window.GostopSettingsView({
    el: el,
    getState: function () { return roomSession.getLastState(); },
    act: roomSession.act,
    fx: Fx
  });

  el.startBtn.addEventListener('click', function () { roomSession.act('start'); });
  if (el.flipBtn) el.flipBtn.addEventListener('click', function () { roomSession.act('flipOnly'); });
  if (el.shakeBtn) el.shakeBtn.addEventListener('click', function () {
    var lastState = roomSession.getLastState();
    var me2 = lastState ? lastState.players[roomSession.getMySeat()] : null;
    var months = (me2 && me2.shakableMonths) || [];
    if (months.length) roomSession.act('shake', { month: months[0] });
  });
  if (el.rulesBtn) el.rulesBtn.addEventListener('click', function () {
    if (el.rulesOverlay) el.rulesOverlay.className = 'overlay';
  });
  if (el.rulesCloseBtn) el.rulesCloseBtn.addEventListener('click', function () {
    if (el.rulesOverlay) el.rulesOverlay.className = 'overlay hidden';
  });

  // ── 계정(로그인/회원가입) ───────────────────────────────────────────────
  if (el.authBtn) el.authBtn.addEventListener('click', function () {
    if (el.authOverlay) el.authOverlay.className = 'overlay';
    refreshAuthUI();
  });
  if (el.authCloseBtn) el.authCloseBtn.addEventListener('click', function () {
    if (el.authOverlay) el.authOverlay.className = 'overlay hidden';
  });
  if (el.authTabLogin) el.authTabLogin.addEventListener('click', function () {
    authMode = 'login';
    el.authTabLogin.className = 'auth-tab on';
    el.authTabRegister.className = 'auth-tab';
    refreshAuthUI();
  });
  if (el.authTabRegister) el.authTabRegister.addEventListener('click', function () {
    authMode = 'register';
    el.authTabRegister.className = 'auth-tab on';
    el.authTabLogin.className = 'auth-tab';
    refreshAuthUI();
  });
  if (el.authSubmitBtn) el.authSubmitBtn.addEventListener('click', submitAuth);
  if (el.authLogoutBtn) el.authLogoutBtn.addEventListener('click', logoutAuth);

  // ── 순위표 ───────────────────────────────────────────────────────────────
  if (el.leaderboardBtn) el.leaderboardBtn.addEventListener('click', function () {
    if (el.leaderboardOverlay) el.leaderboardOverlay.className = 'overlay';
    openLeaderboard();
  });
  if (el.leaderboardCloseBtn) el.leaderboardCloseBtn.addEventListener('click', function () {
    if (el.leaderboardOverlay) el.leaderboardOverlay.className = 'overlay hidden';
  });
  if (el.leaderboardRefreshBtn) el.leaderboardRefreshBtn.addEventListener('click', openLeaderboard);

  // ── 나가기 ──────────────────────────────────────────────────────────────

  function resetRoomView(message) {
    el.room.className = 'screen hidden';
    el.lobby.className = 'screen relative z-10 w-full min-h-[100dvh] sm:max-h-[920px] overflow-hidden flex flex-col items-center justify-center shadow-2xl select-none';
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
    settingsView.close();
    roomBrowser.close();
    el.turnInfo.innerHTML = '';
    el.timer.innerHTML = '';
    document.title = '명지네고스톱';
    if (message) el.lobbyError.textContent = message;
  }

  el.leaveBtn.addEventListener('click', roomSession.leave);

  roomSession.restoreRoom();

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
    var groups = el.table.children || [];
    var count = groups.length;
    if (!wrap || !count) return;
    var deckH = el.deckStack ? el.deckStack.offsetHeight : 0;
    var hintH = el.tableHint ? el.tableHint.offsetHeight : 0;
    var availW = wrap.clientWidth - 12;
    var availH = wrap.clientHeight - deckH - hintH - 26;
    var size = 40;
    for (var s = 126; s >= 40; s -= 2) {
      var ch = Math.round(s * 1.63);
      var rows = 1;
      var rowW = 0;
      for (var g = 0; g < count; g++) {
        var groupCount = groups[g].children ? groups[g].children.length : 1;
        var groupW = s * (1 + Math.max(0, groupCount - 1) * 0.66 + 0.16);
        if (rowW && rowW + groupW > availW) {
          rows++;
          rowW = 0;
        }
        rowW += groupW + 4;
      }
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
    var lastState = roomSession.getLastState();
    if (lastState) opponentView.render(lastState);
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
  var renderedMoveContext = { handIds: {}, floorIds: {}, floorCards: [] };
  var motionPreviousContext = renderedMoveContext;
  // 상대가 내는 중인 카드 — 바닥에 먼저 도착하지 않게 잠시 가려둔다
  var flyingCards = {};
  opponentCardMotion = window.GostopOpponentCardMotion({
    el: el,
    fx: Fx,
    mySeat: function () { return roomSession.getMySeat(); },
    seatEl: seatEl,
    getPreviousCardRects: function () { return prevCardRects; },
    getPreviousMoveContext: function () { return motionPreviousContext; },
    getFlyingCards: function () { return flyingCards; },
    cardImg: cardImg
  });

  function render(state) {
    prevCardRects = Fx.captureRects(CARD_ANIM_SELECTOR);
    motionPreviousContext = renderedMoveContext;
    renderState(state);
    Fx.flipCards(prevCardRects, CARD_ANIM_SELECTOR);
    renderedMoveContext = { handIds: {}, floorIds: {}, floorCards: [] };
    var h;
    for (h = 0; h < (state.myHand || []).length; h++) {
      renderedMoveContext.handIds[state.myHand[h].id] = true;
    }
    for (var f = 0; f < (state.table || []).length; f++) {
      var floorCard = state.table[f];
      renderedMoveContext.floorIds[floorCard.id] = true;
      renderedMoveContext.floorCards.push({ id: floorCard.id, month: floorCard.month });
    }
    // 날아가는 중인 카드는 화면이 갱신돼도 계속 가려둔다
    for (var id in flyingCards) {
      var flown = el.table.querySelector('[data-card-id="' + id + '"]');
      if (flown) flown.style.opacity = '0';
    }
  }

  function renderState(state) {
    var phaseBefore = prevPhase;
    prevPhase = state.phase;
    var mySeat = roomSession.getMySeat();
    var me = state.players[mySeat];
    el.moneyChip.innerHTML = won(me ? me.money : 0);
    if (el.meGoBadge) {
      var goCount = me && me.goCount ? me.goCount : 0;
      el.meGoBadge.innerHTML = goCount ? '🔥 ' + goCount + '고!' : '';
      el.meGoBadge.className = goCount ? 'pready go me-go-badge' : 'pready go me-go-badge hidden';
    }

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
      el.meCaptured.appendChild(opponentView.capturedSummary(me ? me.captured : null));
    }

    // 설정(⚙) — 방장만 보이고, 판 시작 전(lobby/settle)에만 활성화
    settingsView.renderAccess(state);

    // 플레이어 — 나는 아래(손패·족보·머니칩)에 이미 나오므로 상단에는 상대만 보여준다
    opponentView.render(state);

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
      phaseViews.renderNegotiation(state);
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
      phaseViews.renderSeon(state);
      // 덱을 섞는 연출 — 판이 넘어가 '선 결정' 으로 넘어갈 때 한 번
      // (섞는 카드 수는 서버가 알려주는 실제 덱 장수를 따른다)
      if (phaseBefore !== 'seon') Fx.playShuffle(state.deckCount);
      return;
    }

    tableDeckView.render(state);

    handView.render(state);

    phaseViews.renderPrompt(state);
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
      if (phaseBefore !== 'settle') resultView.render(state);
    } else {
      el.overlay.className = 'overlay hidden';
    }
  }

  function playCard(cardEl, index) {
    if (roomSession.isBusy()) return;
    var lastState = roomSession.getLastState();
    var mySeat = roomSession.getMySeat();
    if (!lastState || lastState.currentSeat !== mySeat || lastState.prompt) return;
    var cardId = cardEl.getAttribute('data-card-id');
    cardEl.className += ' playing';
    setTimeout(function () {
      cardEl.className = cardEl.className.replace(/\splaying\b/, '');
    }, 240);
    setTimeout(function () { roomSession.act('playCard', { handIndex: index }); }, 120);
  }

  function seatEl(seat) {
    return el.players.querySelector('.player[data-seat="' + seat + '"]');
  }

  // ── 정산 화면 ───────────────────────────────────────────────────────────

  // ── 타이머 ──────────────────────────────────────────────────────────────

  setInterval(function () {
    var s = roomSession.getLastState();
    if (!s || !s.deadline) { el.timer.innerHTML = ''; return; }
    var remain = Math.max(0, Math.round((s.deadline - Date.now()) / 1000));
    el.timer.innerHTML = remain + '초';
    el.timer.style.color = remain <= 5 ? 'var(--red)' : 'var(--gold)';
  }, 250);

  // 화면을 돌리거나 창 크기가 바뀌면 손패 크기를 다시 맞춘다
  window.addEventListener('resize', function () {
    try {
      var lastState = roomSession.getLastState();
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
  loadAuth();

  if (Fx) {
    updateMuteButtons();
  } else {
    // fx.js 가 로드되지 않은 구형 환경에서도 화면이 죽지 않게 한다
    if (el.muteBtn) el.muteBtn.style.display = 'none';
    if (el.lobbySoundBtn) el.lobbySoundBtn.style.display = 'none';
  }

  // ── PWA : 서비스 워커 등록 (지원하지 않는 환경에서는 조용히 건너뛴다) ──
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  // ── PWA : 앱으로 설치하기 ────────────────────────────────────────────────
  // 안드로이드 Chrome은 beforeinstallprompt 이벤트로 설치 팝업을 띄울 수 있다.
  // iOS Safari는 이 이벤트가 없으므로, 수동 안내를 보여준다.
  var deferredInstallPrompt = null;

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function isInStandaloneMode() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || (window.navigator.standalone === true);
  }

  // iOS는 beforeinstallprompt를 지원하지 않으므로 수동 안내를 보여준다
  if (isIOS() && !isInStandaloneMode() && el.installGuide) {
    el.installGuide.textContent = 'iOS: Safari 공유 버튼(□↑) → "홈 화면에 추가"';
    el.installGuide.className = 'text-[#e7c992] text-xs mt-2 text-center';
  }

  // 폰에서만 설치 버튼을 보여준다 (PC에서는 불필요)
  var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (isMobile && el.installBtn && !isInStandaloneMode()) {
    el.installBtn.className = 'w-9 h-9 rounded-full bg-stone-900/75 border border-amber-600/60 flex items-center justify-center shadow-lg active:scale-95 transition-transform backdrop-blur-sm ml-2';
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (el.installGuide) {
      el.installGuide.textContent = '버튼을 눌러 앱으로 설치하세요';
      el.installGuide.className = 'text-[#8fe0a8] text-xs mt-2 text-center';
    }
  });

  if (el.installBtn) {
    el.installBtn.addEventListener('click', function () {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(function (choice) {
          if (choice.outcome === 'accepted') {
            if (el.installGuide) {
              el.installGuide.textContent = '설치가 완료되었습니다!';
              el.installGuide.className = 'text-[#8fe0a8] text-xs mt-2 text-center';
            }
          }
          deferredInstallPrompt = null;
          if (el.installBtn) el.installBtn.className = 'hidden w-9 h-9 rounded-full bg-stone-900/75 border border-amber-600/60 flex items-center justify-center shadow-lg active:scale-95 transition-transform backdrop-blur-sm ml-2';
        });
      } else if (isIOS()) {
        if (el.installGuide) {
          el.installGuide.textContent = 'Safari 공유 버튼(□↑) → "홈 화면에 추가" 를 탭하세요';
          el.installGuide.className = 'text-[#e7c992] text-xs mt-2 text-center';
        }
      } else {
        if (el.installGuide) {
          el.installGuide.textContent = '브라우저 메뉴(⋮) → "홈 화면에 추가" 또는 "앱 설치" 를 탭하세요';
          el.installGuide.className = 'text-[#e7c992] text-xs mt-2 text-center';
        }
      }
    });
  }

  window.addEventListener('appinstalled', function () {
    deferredInstallPrompt = null;
    if (el.installBtn) el.installBtn.className = 'hidden w-9 h-9 rounded-full bg-stone-900/75 border border-amber-600/60 flex items-center justify-center shadow-lg active:scale-95 transition-transform backdrop-blur-sm ml-2';
    if (el.installGuide) {
      el.installGuide.textContent = '앱으로 설치되었습니다!';
      el.installGuide.className = 'text-[#8fe0a8] text-xs mt-2 text-center';
    }
  });
})();
