'use strict';

// 고스톱 클라이언트 — 바닐라 JS, 빌드 없음.
//
// 흐름: 입장 → 방 코드 입력 → 폴링으로 상태 갱신 → 카드를 탭해서 내기.
// 서버가 규칙을 전부 판정하므로 여기는 "보여주기"와 "의도 전달"만 한다.
// 이펙트/애니메이션/사운드는 fx.js 가 담당한다.

(() => {
  const POLL_MS = 1200;
  // 카드 이미지: PNG(600x978 미리 래스터화)를 쓴다.
  //   SVG(103x168 내재 크기)는 고DPR 기기에서 103px로 래스터화돼 확대 시 흐려진다.
  //   PNG 는 어떤 기기 픽셀비에서도 선명하다.
  const CARD_IMG = 'assets/hwatu/png/';
  // 자산 버전 — 서버 빌드 버전과 맞춰 쓴다(자산이 바뀌면 URL 이 달라져 캐시가 무효화된다)
  let buildVersion = '1';

  const $ = (id) => document.getElementById(id);
  const el = {
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
    settingsRow: $('settingsRow'),
    timeLimitSelect: $('timeLimitSelect'),
    pointValueInput: $('pointValueInput'),
    table: $('table'),
    tableHint: $('tableHint'),
    promptBox: $('promptBox'),
    hand: $('hand'),
    turnInfo: $('turnInfo'),
    timer: $('timer'),
    startBtn: $('startBtn'),
    overlay: $('overlay'),
  };

  let roomCode = null;
  let mySeat = -1;
  let lastFxSeq = 0;
  let lastVersion = -1;
  let pollTimer = null;
  let pollPending = false;
  let lastState = null;
  let busy = false; // 액션 처리 중 잠금(중복 전송 방지)

  const Fx = window.GostopFx;

  // ── 자동 갱신 ────────────────────────────────────────────────────────────
  // 서버의 빌드 버전이 지금 것과 다르면(업데이트 happened) 화면을 자동으로 새로고침한다.
  // → 폰에서 "새로고침 눌러주세요" 없이도 항상 최신 화면을 쓰게 된다.
  (async () => {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (!res.ok) return;
      const { version } = await res.json();
      buildVersion = version;
      const saved = localStorage.getItem('gs_build');
      if (saved && saved !== version) {
        localStorage.setItem('gs_build', version);
        location.reload();
        return;
      }
      localStorage.setItem('gs_build', version);
    } catch {
      /* 무시 */
    }
  })();

  // ── 네트워크 ────────────────────────────────────────────────────────────

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    return res.json();
  }

  async function post(path, payload) {
    return api(path, { method: 'POST', body: JSON.stringify(payload || {}) });
  }

  async function act(type, payload = {}) {
    if (!roomCode || busy) return;
    busy = true;
    try {
      const res = await post(`/api/room/${roomCode}/action`, {
        requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        payload,
      });
      if (res && res.ok === false) {
        Fx.showBanner(res.error || '처리할 수 없습니다.', 'red', 1400);
      }
    } catch {
      Fx.showBanner('연결이 끊겼습니다', 'red', 1400);
    } finally {
      busy = false;
    }
    await pollNow();
  }

  // ── 입장 ────────────────────────────────────────────────────────────────

  el.createBtn.addEventListener('click', async () => {
    const name = el.nameInput.value.trim() || '나';
    el.lobbyError.textContent = '';

    const [mode, count] = el.modeSelect.value.split('-');
    const res = await post('/api/room', {
      name,
      mode,
      playerCount: Number(count),
      aiDifficulty: el.diffSelect.value,
    });
    if (!res.code) {
      el.lobbyError.textContent = res.error || '방을 만들지 못했습니다.';
      return;
    }
    enterRoom(res.code, res.seat);
  });

  el.joinBtn.addEventListener('click', () => {
    el.joinBox.classList.toggle('hidden');
    el.codeInput.focus();
  });

  el.joinGoBtn.addEventListener('click', async () => {
    const name = el.nameInput.value.trim() || '나';
    const code = el.codeInput.value.trim().toUpperCase();
    if (code.length !== 6) {
      el.lobbyError.textContent = '방 코드는 6자리입니다.';
      return;
    }
    el.lobbyError.textContent = '';
    const res = await post(`/api/room/${code}/join`, { name });
    if (!res.code) {
      el.lobbyError.textContent = res.error || '방에 참가할 수 없습니다.';
      return;
    }
    enterRoom(res.code, res.seat);
  });

  el.codeChip.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roomCode || '');
      Fx.showBanner('방 코드 복사됨', 'plain', 900);
    } catch {
      Fx.showBanner(roomCode || '', 'plain', 1400);
    }
  });

  el.muteBtn.addEventListener('click', () => {
    const muted = Fx.setMuted(!Fx.isMuted());
    el.muteBtn.textContent = muted ? '🔇' : '🔊';
    el.muteBtn.title = muted ? '소리 켜기' : '소리 끄기';
  });

  el.bgmBtn.addEventListener('click', () => {
    const on = Fx.toggleBgm();
    el.bgmBtn.classList.toggle('on', on);
    el.bgmBtn.title = on ? '배경음악 끄기' : '배경음악 켜기';
  });

  el.startBtn.addEventListener('click', () => act('start'));

  function enterRoom(code, seat) {
    roomCode = code;
    mySeat = seat;
    lastFxSeq = 0;
    el.lobby.classList.add('hidden');
    el.room.classList.remove('hidden');
    el.codeChip.textContent = code;
    document.title = `고스톱 ${code}`;
    startPolling();
  }

  // ── 폴링 ────────────────────────────────────────────────────────────────

  function startPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    // 긴 폴링 — 서버가 상태가 바뀌면 즉시 응답한다 (지연 없음)
    const loop = async () => {
      await pollNow();
      if (roomCode) pollTimer = setTimeout(loop, 50);
    };
    loop();
  }

  async function pollNow() {
    if (!roomCode || pollPending) return;
    pollPending = true;
    let res;
    try {
      res = await api(`/api/room/${roomCode}/state?since=${lastFxSeq}&v=${lastVersion}`);
    } catch {
      pollPending = false;
      return; // 네트워크 흔들림은 무시하고 다시 시도
    }
    pollPending = false;
    if (!res || !res.ok) return;
    if (typeof res.version === 'number') lastVersion = res.version;

    for (const fx of res.fx || []) {
      lastFxSeq = Math.max(lastFxSeq, fx.seq);
      Fx.handleFx(fx, { seatEl, mySeat });
    }

    lastState = res.state;
    render(res.state);
  }

  // ── 렌더링 ──────────────────────────────────────────────────────────────

  function cardImg(card) {
    return `${CARD_IMG}${card.id}.png?v=${buildVersion}`;
  }

  const KIND_LABEL = {
    bright: '광',
    animal: '열꽃',
    ribbon: '띠',
    junk: '피',
    doubleJunk: '쌍피',
    bonus: '보너스',
  };

  /**
   * 카드 요소 — 전통 그림 위에 '월' 색상 띠와 종류 배지를 얹는다.
   * (모바일에서 선명하게 보려면 background-image 가 아니라 <img> 를 쓴다.
   *  CSS 배경의 SVG 는 크롬이 저해상도로 래스터화해 흐려진다.)
   */
  function makeCardEl(card, extraClass = '') {
    const d = document.createElement('div');
    d.className = `card ${extraClass}`.trim();
    const img = document.createElement('img');
    img.className = 'card-img';
    img.src = cardImg(card);
    img.alt = '';
    img.draggable = false;
    d.appendChild(img);
    if (card.month >= 1 && card.month <= 12) {
      d.classList.add('m' + String(card.month).padStart(2, '0'));
      d.dataset.monthLabel = card.month + '월';
    }
    d.dataset.kind = KIND_LABEL[card.kind] || '';
    return d;
  }

  /** 획득 요약 (광/열꽃/띠/피 개수). */
  function capturedSummary(sum) {
    const wrap = document.createElement('div');
    wrap.className = 'captured-sum';
    if (!sum) return wrap;
    const items = [
      ['guang', '광', sum.bright],
      ['', '열', sum.animal],
      ['ribbon', '띠', sum.ribbon],
      ['junk', '피', sum.junk + sum.doubleJunk + sum.bonus],
    ];
    for (const [cls, label, n] of items) {
      const i = document.createElement('i');
      i.className = `${cls} ${n > 0 ? 'on' : ''}`.trim();
      i.textContent = `${label}${n}`;
      wrap.append(i);
    }
    return wrap;
  }

  /** 족보 패널 — 실제 화투처럼 내가 먹은 패를 카드로 보여준다. */
  function renderScorePanel(state) {
    const s = state.mySets;
    el.scorePanel.innerHTML = '';
    if (!s) return;

    const me = state.players[mySeat];
    const total = me ? me.score : 0;

    // ── 윗줄: 점수·개수·족보 진행 타일 ──
    const tiles = document.createElement('div');
    tiles.className = 'sp-tiles';

    const scoreTile = document.createElement('div');
    scoreTile.className = 'sp big';
    scoreTile.innerHTML = `<b>${total}</b><span>점</span>`;
    tiles.append(scoreTile);

    const countTile = document.createElement('div');
    countTile.className = 'sp';
    const captured = me && me.captured ? me.captured.total : 0;
    countTile.innerHTML = `<b>${captured}</b><span>개</span>`;
    tiles.append(countTile);

    const items = [
      { label: '광', n: s.bright, need: 3, cls: 'guang' },
      { label: '고도리', n: s.godori, need: 3, cls: 'godori' },
      { label: '홍단', n: s.hongdan, need: 3, cls: 'hong' },
      { label: '청단', n: s.cheongdan, need: 3, cls: 'cheong' },
      { label: '초단', n: s.chodan, need: 3, cls: 'cho' },
      { label: '열꽃', n: s.animal, need: 5, cls: 'animal' },
      { label: '띠', n: s.ribbon, need: 5, cls: 'ribbon' },
      { label: '피', n: s.junk, need: 10, cls: 'junk' },
    ];

    for (const it of items) {
      const d = document.createElement('div');
      d.className = 'sp' + (it.n >= it.need ? ' done' : '');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = DOT_COLOR[it.cls] || 'var(--muted)';
      const b = document.createElement('b');
      b.textContent = it.label;
      const need = document.createElement('span');
      need.className = 'need';
      need.textContent = `${it.n}/${it.need}`;
      d.append(dot, b, need);
      tiles.append(d);
    }
    el.scorePanel.append(tiles);

    // ── 아랫줄: 내가 먹은 패 (실제 카드로 펼친다) ──
    const cards = state.myCaptured || [];
    const rack = document.createElement('div');
    rack.className = 'my-cards';

    const title = document.createElement('span');
    title.className = 'my-cards-title';
    title.textContent = '내가 먹은 패';
    rack.append(title);

    const fan = document.createElement('div');
    fan.className = 'card-fan';
    for (const c of cards) {
      const d = makeCardEl(c, 'tiny');
      // 족보에 속하는 카드는 색 테두리로 강조 (실제 화투처럼 한 장씩 눈에 띄게)
      const setTag = (c.tags || []).find((t) => SET_TAGS.includes(t));
      if (setTag) {
        d.classList.add('in-set');
        d.style.setProperty('--sc', DOT_COLOR[SET_COLOR[setTag]] || '#e8c46a');
      }
      fan.append(d);
    }
    if (!cards.length) {
      const empty = document.createElement('span');
      empty.className = 'my-cards-empty';
      empty.textContent = '아직 먹은 패가 없습니다';
      fan.append(empty);
    }
    rack.append(fan);
    el.scorePanel.append(rack);
  }

  const SET_TAGS = ['godori', 'hongdan', 'cheongdan', 'chodan'];
  const SET_COLOR = {
    godori: 'godori',
    hongdan: 'hong',
    cheongdan: 'cheong',
    chodan: 'cho',
  };

  const DOT_COLOR = {
    guang: '#e8c46a',
    godori: '#8fe0a8',
    hong: '#ef8fb0',
    cheong: '#7fb2e8',
    cho: '#9ed48a',
    animal: '#c9a0e8',
    ribbon: '#7fd4c4',
    junk: '#b9c4bb',
  };

  /** 손패 카드가 화면폭에 맞춰 보이도록 크기를 정한다. */
  function fitHandCards(count) {
    if (!count) return;
    const avail = Math.min(window.innerWidth - 16, 760);
    const gap = 3;
    // 최대 74px, 최소 54px (어르신이 두드리기 편한 크기)
    const w = Math.max(54, Math.min(74, Math.floor((avail - (count - 1) * gap) / count)));
    el.hand.style.setProperty('--hand-w', `${w}px`);
  }

  // ── 아바타 ────────────────────────────────────────────────────────────────
  // 이름에서 만들어내는 아바타 (외부 이미지 자산 없이 이름 첫 글자 + 색상 해시)
  const AVATAR_COLORS = ['#c96f5a', '#5a8fc9', '#6fbf73', '#c9a05a', '#9a6fc9', '#5ac9c0', '#c95a9a', '#8a9ac9'];

  function avatarOf(name) {
    const ch = (name || '?').trim().charAt(0) || '?';
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return { ch, color: AVATAR_COLORS[hash % AVATAR_COLORS.length] };
  }

  /** 상대 손패를 카드 뒷장으로 보여준다(장수는 공개되므로 개수만큼). */
  function handBacks(count, max = 6) {
    const wrap = document.createElement('div');
    wrap.className = 'hand-backs';
    const n = Math.min(count, max);
    for (let i = 0; i < n; i++) {
      const b = document.createElement('div');
      b.className = 'card back mini';
      wrap.append(b);
    }
    return wrap;
  }

  function render(state) {
    const me = state.players[mySeat];
    el.moneyChip.textContent = `${(me?.money ?? 0).toLocaleString()} P`;

    // ── 플레이어 ──
    el.players.innerHTML = '';
    for (const p of state.players) {
      const div = document.createElement('div');
      div.className =
        'player' +
        (p.seat === state.currentSeat ? ' turn' : '') +
        (p.seat === mySeat ? ' me' : '') +
        (p.type === 'ai' ? ' ai' : '');
      div.dataset.seat = String(p.seat);

      const name = document.createElement('div');
      name.className = 'pname';
      const av = avatarOf(p.name);
      const ava = document.createElement('span');
      ava.className = 'avatar';
      ava.style.background = av.color;
      ava.textContent = av.ch;
      name.append(ava, document.createTextNode(p.name + (p.type === 'ai' ? ' 🤖' : '')));

      const meta = document.createElement('div');
      meta.className = 'pmeta';
      meta.textContent = `${p.handCount}장 · ${p.score}점`;

      const money = document.createElement('div');
      money.className = 'pmoney';
      money.textContent = `${p.money.toLocaleString()}P`;

      div.append(name, meta, money);
      div.append(capturedSummary(p.captured));

      // 상대 손패는 뒷장으로 보여준다 (내 손패는 공개)
      if (p.seat !== mySeat && p.handCount > 0) {
        div.append(handBacks(p.handCount));
      }

      if (!p.connected) {
        const off = document.createElement('div');
        off.className = 'pready';
        off.textContent = '연결 끊김';
        div.append(off);
      } else if (p.goCount > 0) {
        const go = document.createElement('div');
        go.className = 'pready';
        go.textContent = `${p.goCount}고`;
        div.append(go);
      }
      el.players.append(div);
    }

    // ── 4인 광팔기 협상 ──
    if (state.phase === 'negotiate') {
      el.table.innerHTML = '';
      for (const c of state.table) el.table.append(makeCardEl(c, 'small'));
      el.tableHint.textContent = '바닥 1장만 공개됩니다 (협상 중)';
      el.hand.innerHTML = '';
      for (const c of state.myHand) el.hand.append(makeCardEl(c, ''));
      el.turnInfo.textContent = '4인 광팔기 — 참가 여부 협상 중';
      el.timer.textContent = '';
      el.startBtn.classList.add('hidden');
      el.overlay.classList.add('hidden');
      renderNegotiation(state);
      return;
    }

    // ── 선 결정 단계 ──
    if (state.phase === 'seon') {
      el.table.innerHTML = '';
      el.hand.innerHTML = '';
      el.turnInfo.textContent = '';
      el.timer.textContent = '';
      el.startBtn.classList.add('hidden');
      el.overlay.classList.add('hidden');
      // renderSeon 이 프롬프트와 안내 문구를 직접 정한다 (그 뒤에 덮어쓰면 카드를 고를 수 없게 된다)
      renderSeon(state);
      return;
    }

    // ── 바닥 ──
    el.table.innerHTML = '';
    for (const c of state.table) {
      el.table.append(makeCardEl(c, 'small'));
    }
    el.tableHint.textContent = state.table.length ? `바닥 ${state.table.length}장` : '';

    // ── 뒷패 더미 ──
    el.deckStack.innerHTML = '';
    if (state.deckCount > 0) {
      const stack = document.createElement('div');
      stack.className = 'deck';
      for (let i = 0; i < Math.min(state.deckCount, 5); i++) {
        const b = document.createElement('div');
        b.className = 'card back';
        stack.append(b);
      }
      el.deckStack.append(stack);
      const label = document.createElement('span');
      label.className = 'deck-count';
      label.textContent = `뒷패 ${state.deckCount}장`;
      el.deckStack.append(label);
    }

    // ── 내 손패 ──
    // 내 차례가 아니거나 선택 대기 중이면 카드를 눌러도 안 된다(서버가 거절하고 오류가 뜬다)
    const myTurn = state.currentSeat === mySeat && !state.prompt;
    fitHandCards(state.myHand.length);
    el.hand.innerHTML = '';
    state.myHand.forEach((c, i) => {
      const d = makeCardEl(c, myTurn ? 'pick' : '');
      d.dataset.cardId = c.id;
      if (myTurn) d.addEventListener('click', () => playCard(d, i));
      el.hand.append(d);
    });
    el.hand.classList.toggle('waiting', !myTurn && state.phase === 'play');

    renderPrompt(state);
    renderScorePanel(state);

    const cur = state.players[state.currentSeat];
    el.turnInfo.textContent = state.phase === 'settle'
      ? '판이 끝났습니다.'
      : cur
        ? state.currentSeat === mySeat
          ? '내 차례입니다'
          : `${cur.name} 차례`
        : '';

    // ── 방장 시작 버튼 ──
    const canStart = state.isHost && (state.phase === 'lobby' || state.phase === 'settle');
    el.startBtn.classList.toggle('hidden', !canStart);
    el.startBtn.textContent = state.phase === 'settle' ? '다음 판' : '판 시작';

    // ── 방장만 볼 수 있는 방 설정 ──
    el.settingsRow.classList.toggle('hidden', !state.isHost);
    if (state.isHost) {
      const tl = state.settings.timeLimit;
      const preset = tl.enabled ? String(tl.base) : 'off';
      if (el.timeLimitSelect.value !== preset) el.timeLimitSelect.value = preset;
      if (document.activeElement !== el.pointValueInput) {
        el.pointValueInput.value = String(state.settings.moneyPerPoint);
      }
    }

    // ── 정산 ──
    if (state.phase === 'settle' && state.result) showResult(state);
    else el.overlay.classList.add('hidden');
  }

  // ── 방 설정 변경 (방장 전용) ────────────────────────────────────────────

  el.timeLimitSelect.addEventListener('change', () => {
    const v = el.timeLimitSelect.value;
    const base = Number(v);
    const timeLimit = v === 'off'
      ? { enabled: false, base: 30, increment: 5 }
      : { enabled: true, base, increment: base === 60 ? 10 : 5 };
    act('settings', { timeLimit });
  });

  el.pointValueInput.addEventListener('change', () => {
    const v = Math.max(1, Math.min(100000, Number(el.pointValueInput.value) || 100));
    act('settings', { moneyPerPoint: v });
  });

  /** 카드를 낸다 — 카드가 손패에서 바닥으로 날아가는 애니메이션을 먼저 보여준다. */
  async function playCard(cardEl, index) {
    if (busy) return;
    // 마지막으로 받은 상태가 "내 차례"가 아니면 보내지 않는다.
    // (긴 폴링이라 상태는 거의 실시간이지만, 클릭 직전 확인이 안전망이 된다)
    if (!lastState || lastState.currentSeat !== mySeat || lastState.prompt) return;

    const target = el.table;
    Fx.animateCardFlight(cardEl, target, -6, 260);
    // 애니메이션이 진행되는 동안 잠깐 대기 → 손에서 카드가 "빠지는" 느낌
    await new Promise((r) => setTimeout(r, 120));
    act('playCard', { handIndex: index });
  }

  function seatEl(seat) {
    return el.players.querySelector(`.player[data-seat="${seat}"]`);
  }

  /** 4인 광팔기 협상 화면. */
  function renderNegotiation(state) {
    const n = state.negotiation || {};
    const waiting = n.waitingSeat;
    el.promptBox.classList.remove('hidden');
    el.promptBox.innerHTML = '';

    // 이미 결정한 사람들
    const done = Object.entries(n.decisions || {});
    if (done.length) {
      const info = document.createElement('span');
      info.textContent = done
        .map(([seat, d]) => `${state.players[seat]?.name || ''}: ${d === 'giveup' ? '포기' : d === 'sell' ? '광팔기' : '참가'}`)
        .join(' · ');
      el.promptBox.append(info);
    }

    if (waiting !== mySeat) {
      const w = document.createElement('span');
      w.textContent = waiting < 0 ? '협상이 끝났습니다.' : `${state.players[waiting]?.name || ''} 님이 결정하는 중…`;
      el.promptBox.append(w);
      return;
    }

    const title = document.createElement('strong');
    title.textContent = '참가하시겠습니까?';
    el.promptBox.append(title);

    const join = document.createElement('button');
    join.className = 'primary';
    join.textContent = '참가';
    join.addEventListener('click', () => act('negotiate', { decision: 'join' }));
    el.promptBox.append(join);

    // P4(4번째)만 광을 팔 수 있다
    if (mySeat === 3) {
      const sell = document.createElement('button');
      sell.textContent = `광을 판다 (${n.gwangCount || 0}광)`;
      sell.addEventListener('click', () => act('negotiate', { decision: 'sell' }));
      el.promptBox.append(sell);

      if (n.mySaleCards && n.mySaleCards.length) {
        const label = document.createElement('span');
        label.textContent = '팔 패:';
        el.promptBox.append(label);
        for (const c of n.mySaleCards) el.promptBox.append(makeCardEl(c, 'small'));
      }
    } else {
      const giveup = document.createElement('button');
      giveup.textContent = '포기';
      giveup.addEventListener('click', () => act('negotiate', { decision: 'giveup' }));
      el.promptBox.append(giveup);
    }
  }

  function renderSeon(state) {
    const cands = state.seonCandidates[mySeat] || [];
    if (cands.length === 0) {
      // 늦게 들어온 경우 등 — 선택할 카드가 없으면 안내만 보여준다
      el.tableHint.textContent = '선(先)을 정하는 중입니다.';
      el.promptBox.classList.remove('hidden');
      el.promptBox.innerHTML = '<span>이 방은 이미 선을 정하는 중입니다. 다음 판에 참여해 주세요.</span>';
      return;
    }
    if (state.seonPicked[mySeat] !== -1) {
      el.tableHint.textContent = '카드를 골랐습니다. 다른 가족을 기다리는 중…';
      el.promptBox.classList.remove('hidden');
      el.promptBox.innerHTML = '<span>다른 가족들이 카드를 고르는 중입니다…</span>';
      return;
    }
    el.tableHint.textContent = '가장 크게(낮) 또는 가장 작게(밤) 나는 카드를 고르세요.';
    el.promptBox.classList.remove('hidden');
    el.promptBox.innerHTML = '';

    const label = document.createElement('strong');
    label.textContent = '선 결정 카드:';
    el.promptBox.append(label);

    cands.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'card pick small';
      d.style.backgroundImage = `url(${cardImg(c)})`;
      d.addEventListener('click', () => act('seonPick', { cardIndex: i }));
      el.promptBox.append(d);
    });
  }

  function renderPrompt(state) {
    const p = state.prompt;
    if (!p) {
      el.promptBox.classList.add('hidden');
      return;
    }
    el.promptBox.classList.remove('hidden');
    el.promptBox.innerHTML = '';

    if (p.seat !== mySeat) {
      const who = state.players[p.seat]?.name || '상대';
      el.promptBox.innerHTML = `<span>${who} 님이 선택하는 중입니다…</span>`;
      return;
    }

    if (p.type === 'goStop') {
      el.promptBox.innerHTML = '<strong>고 / 스톱</strong>';
      const go = document.createElement('button');
      go.textContent = '고 (계속)';
      go.addEventListener('click', () => act('go'));
      const stop = document.createElement('button');
      stop.className = 'primary';
      stop.textContent = '스톱 (승리)';
      stop.addEventListener('click', () => act('stop'));
      el.promptBox.append(go, stop);
      return;
    }

    if (p.type === 'floorChoice' || p.type === 'flipChoice') {
      el.promptBox.innerHTML = '<strong>가져갈 카드를 고르세요</strong>';
      (p.options || []).forEach((opt, i) => {
        const d = document.createElement('div');
        d.className = 'card pick small';
        d.style.backgroundImage = `url(${cardImg(opt)})`;
        d.addEventListener('click', () =>
          act(p.type === 'floorChoice' ? 'floorChoice' : 'flipChoice', p.type === 'floorChoice' ? { choice: i } : { ordinal: i })
        );
        el.promptBox.append(d);
      });
      return;
    }

    if (p.type === 'bonusDraw') {
      el.promptBox.innerHTML = '<strong>보너스패를 냈습니다 — 보충할 카드를 고르세요</strong>';
      (p.options || []).forEach((opt) => {
        const d = document.createElement('div');
        d.className = 'card pick small';
        d.style.backgroundImage = `url(${cardImg(opt)})`;
        d.addEventListener('click', () => act('bonusDraw', { stockIndex: opt.stockIndex }));
        el.promptBox.append(d);
      });
    }
  }

  // ── 정산 화면 ───────────────────────────────────────────────────────────

  function showResult(state) {
    const r = state.result;
    el.overlay.classList.remove('hidden');
    el.overlay.innerHTML = '';

    const box = document.createElement('div');
    box.className = 'overlay-inner';

    const h = document.createElement('h2');
    h.textContent = r.nagari ? '나가리' : `${state.players[r.winnerSeat]?.name || '승자'} 승리!`;
    box.append(h);

    const sub = document.createElement('p');
    sub.className = 'overlay-sub';
    sub.textContent = r.nagari ? '이번 판은 승패가 없습니다. 다음 판은 2배입니다.' : '정산 결과';
    box.append(sub);

    const rows = document.createElement('div');
    rows.className = 'rows';
    for (const row of r.rows) {
      const line = document.createElement('div');
      line.className = 'rowline' + (row.seat === r.winnerSeat ? ' win' : '');

      const left = document.createElement('span');
      left.textContent = row.name;
      const right = document.createElement('b');
      right.textContent = `${row.amount > 0 ? '+' : ''}${row.amount.toLocaleString()} P`;
      line.append(left, right);

      if (row.reasons && row.reasons.length) {
        const why = document.createElement('small');
        why.textContent = row.reasons.join(' · ');
        line.append(why);
      }
      rows.append(line);
    }
    box.append(rows);

    // 배수 계산 과정
    const steps = r.rows.find((x) => x.steps && x.steps.length);
    if (steps) {
      const wrap = document.createElement('div');
      wrap.className = 'steps';
      const title = document.createElement('h3');
      title.textContent = '점수 계산';
      wrap.append(title);
      for (const s of steps.steps) {
        const l = document.createElement('div');
        l.className = 'step';
        l.innerHTML = `<span>${s.label}</span><b>${s.formula} = ${s.value}</b>`;
        wrap.append(l);
      }
      const money = document.createElement('div');
      money.className = 'step total';
      const total = steps.steps[steps.steps.length - 1];
      money.innerHTML = `<span>최종 점수</span><b>${total.value}점</b>`;
      wrap.append(money);
      box.append(wrap);
    }

    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = '닫기';
    btn.addEventListener('click', () => el.overlay.classList.add('hidden'));
    box.append(btn);

    el.overlay.append(box);
  }

  // ── 타이머 ──────────────────────────────────────────────────────────────

  setInterval(() => {
    const s = lastState;
    if (!s || !s.deadline) {
      el.timer.textContent = '';
      return;
    }
    const remain = Math.max(0, Math.round((s.deadline - Date.now()) / 1000));
    el.timer.textContent = `${remain}초`;
    el.timer.style.color = remain <= 5 ? 'var(--red)' : 'var(--gold)';
  }, 250);

  // 첫 사용자 입력 시 오디오 재생 허용(모바일 자동재생 정책 대비)
  document.addEventListener(
    'pointerdown',
    () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        ctx.resume();
      } catch {
        /* 무시 */
      }
    },
    { once: true }
  );

  // 소리 상태 표시
  el.muteBtn.textContent = Fx.isMuted() ? '🔇' : '🔊';
  el.bgmBtn.classList.toggle('on', Fx.isBgmOn());
  el.bgmBtn.title = Fx.isBgmOn() ? '배경음악 끄기' : '배경음악 켜기';
})();
