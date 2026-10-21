'use strict';

// 고스톱 클라이언트 — 바닐라 JS, 빌드 없음.
//
// 흐름: 입장 → 방 코드 입력 → 폴링으로 상태 갱신 → 카드를 탭해서 내기.
// 서버가 규칙을 전부 판정하므로 여기는 "보여주기"와 "의도 전달"만 한다.
// 이펙트/애니메이션/사운드는 fx.js 가 담당한다.

(() => {
  const POLL_MS = 1200;
  const CARD_IMG = 'assets/hwatu/svg/';

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
  let pollTimer = null;
  let lastState = null;
  let busy = false; // 액션 처리 중 잠금(중복 전송 방지)

  const Fx = window.GostopFx;

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
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollNow, POLL_MS);
    pollNow();
  }

  async function pollNow() {
    if (!roomCode) return;
    let res;
    try {
      res = await api(`/api/room/${roomCode}/state?since=${lastFxSeq}`);
    } catch {
      return; // 네트워크 흔들림은 무시하고 다음 주기에 다시 시도
    }
    if (!res || !res.ok) return;

    for (const fx of res.fx || []) {
      lastFxSeq = Math.max(lastFxSeq, fx.seq);
      Fx.handleFx(fx, { seatEl, mySeat });
    }

    lastState = res.state;
    render(res.state);
  }

  // ── 렌더링 ──────────────────────────────────────────────────────────────

  function cardImg(card) {
    return `${CARD_IMG}${card.imageKey || card.id}.svg`;
  }

  /** 손패 카드가 화면폭에 맞춰 보이도록 크기를 정한다. */
  function fitHandCards(count) {
    if (!count) return;
    const avail = Math.min(window.innerWidth - 24, 520);
    const w = Math.max(34, Math.min(58, Math.floor((avail - (count - 1) * 4) / count)));
    el.hand.style.setProperty('--card-w', `${w}px`);
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
      const d = document.createElement('div');
      d.className = 'card small';
      d.style.backgroundImage = `url(${cardImg(c)})`;
      el.table.append(d);
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
    fitHandCards(state.myHand.length);
    el.hand.innerHTML = '';
    state.myHand.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'card pick';
      d.dataset.cardId = c.id;
      d.style.backgroundImage = `url(${cardImg(c)})`;
      d.addEventListener('click', () => playCard(d, i));
      el.hand.append(d);
    });

    renderPrompt(state);

    const cur = state.players[state.currentSeat];
    el.turnInfo.textContent = state.phase === 'settle' ? '판이 끝났습니다.' : cur ? `${cur.name} 차례` : '';

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
    const target = el.table;
    Fx.animateCardFlight(cardEl, target, -6, 260);
    // 애니메이션이 진행되는 동안 잠깐 대기 → 손에서 카드가 "빠지는" 느낌
    await new Promise((r) => setTimeout(r, 120));
    act('playCard', { handIndex: index });
  }

  function seatEl(seat) {
    return el.players.querySelector(`.player[data-seat="${seat}"]`);
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
