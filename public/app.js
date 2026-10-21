'use strict';

// 고스톱 클라이언트 — 바닐라 JS, 빌드 없음.
//
// 흐름: 입장 → 방 코드 입력 → 폴링으로 상태 갱신 → 카드를 탭해서 내기.
// 서버가 규칙을 전부 판정하므로 여기는 "보여주기"와 "의도 전달"만 한다.

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
    players: $('players'),
    table: $('table'),
    tableHint: $('tableHint'),
    promptBox: $('promptBox'),
    hand: $('hand'),
    turnInfo: $('turnInfo'),
    timer: $('timer'),
    startBtn: $('startBtn'),
    toast: $('toast'),
    overlay: $('overlay'),
  };

  let roomCode = null;
  let mySeat = -1;
  let lastFxSeq = 0;
  let pollTimer = null;
  let lastState = null;
  let selectedHandIndex = -1;

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
    if (!roomCode) return;
    const res = await post(`/api/room/${roomCode}/action`, {
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      payload,
    });
    if (res && res.ok === false) {
      toast(res.error || '처리할 수 없습니다.');
    }
    await pollNow();
  }

  // ── 입장 ────────────────────────────────────────────────────────────────

  el.createBtn.addEventListener('click', async () => {
    const name = el.nameInput.value.trim() || '나';
    el.lobbyError.textContent = '';

    // "3명 / 2인 / 혼자·AI" 선택 → 서버 설정으로 전달
    const [mode, count] = $('modeSelect').value.split('-');
    const res = await post('/api/room', {
      name,
      mode,
      playerCount: Number(count),
      aiDifficulty: $('diffSelect').value,
    });
    if (!res.code) {
      el.lobbyError.textContent = res.error || '방을 만들지 못했습니다.';
      return;
    }
    enterRoom(res.code, res.seat, res.name);
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
    enterRoom(res.code, res.seat, res.name);
  });

  el.codeChip.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roomCode || '');
      toast('방 코드 복사됨');
    } catch {
      toast(roomCode || '');
    }
  });

  el.startBtn.addEventListener('click', () => act('start'));

  function enterRoom(code, seat, name) {
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
      showFx(fx);
    }

    lastState = res.state;
    render(res.state);
  }

  // ── 렌더링 ──────────────────────────────────────────────────────────────

  function cardImg(card) {
    return `${CARD_IMG}${card.imageKey || card.id}.svg`;
  }

  function render(state) {
    el.moneyChip.textContent = `${(state.players[mySeat]?.money ?? 0).toLocaleString()} P`;

    // 플레이어
    el.players.innerHTML = '';
    for (const p of state.players) {
      const div = document.createElement('div');
      div.className = 'player' + (p.seat === state.currentSeat ? ' turn' : '') + (p.seat === mySeat ? ' me' : '');
      const name = document.createElement('div');
      name.className = 'pname';
      name.textContent = p.name;
      const meta = document.createElement('div');
      meta.className = 'pmeta';
      meta.textContent = `${p.handCount}장 · ${p.score}점 · ${p.money.toLocaleString()}P`;
      div.append(name, meta);
      if (!p.connected) {
        const off = document.createElement('div');
        off.className = 'pready';
        off.textContent = '연결 끊김';
        div.append(off);
      }
      el.players.append(div);
    }

    // 선 결정 단계
    if (state.phase === 'seon') {
      renderSeon(state);
      el.table.innerHTML = '';
      el.tableHint.textContent = '선(先)을 정하는 중입니다.';
      el.hand.innerHTML = '';
      el.promptBox.classList.add('hidden');
      el.turnInfo.textContent = '';
      el.timer.textContent = '';
      el.startBtn.classList.add('hidden');
      return;
    }

    // 바닥
    el.table.innerHTML = '';
    for (const c of state.table) {
      const d = document.createElement('div');
      d.className = 'card small';
      d.style.backgroundImage = `url(${cardImg(c)})`;
      el.table.append(d);
    }

    // 내 손패
    el.hand.innerHTML = '';
    state.myHand.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'card pick' + (selectedHandIndex === i ? ' sel' : '');
      d.style.backgroundImage = `url(${cardImg(c)})`;
      d.addEventListener('click', () => {
        selectedHandIndex = i;
        act('playCard', { handIndex: i });
        selectedHandIndex = -1;
      });
      el.hand.append(d);
    });

    // 프롬프트 (고/스톱, 바닥 선택, 보너스 보충)
    renderPrompt(state);

    // 차례 표시
    const cur = state.players[state.currentSeat];
    el.turnInfo.textContent = state.phase === 'settle'
      ? '판이 끝났습니다.'
      : cur ? `${cur.name} 차례` : '';

    // 방장 시작 버튼
    el.startBtn.classList.toggle('hidden', !(state.isHost && (state.phase === 'lobby' || state.phase === 'settle')));
    el.startBtn.textContent = state.phase === 'settle' ? '다음 판' : '판 시작';

    // 정산 오버레이
    if (state.phase === 'settle' && state.result) {
      showResult(state);
    } else {
      el.overlay.classList.add('hidden');
    }
  }

  function myPlayerId() {
    return window.__gsPlayerId || null;
  }

  function renderSeon(state) {
    const cands = state.seonCandidates[mySeat] || [];
    if (state.seonPicked[mySeat] !== -1) {
      el.tableHint.textContent = '카드를 골랐습니다. 다른 가족을 기다리는 중…';
      el.promptBox.classList.remove('hidden');
      el.promptBox.innerHTML = '<span>상대가 카드를 고르는 중입니다…</span>';
      return;
    }
    el.tableHint.textContent = '가장 크게(낮) 또는 가장 작게(밤) 나는 카드를 고르세요.';
    el.promptBox.classList.remove('hidden');
    el.promptBox.innerHTML = '';

    const label = document.createElement('span');
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

    const mine = p.seat === mySeat;
    if (!mine) {
      el.promptBox.innerHTML = '<span>상대가 선택하는 중입니다…</span>';
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

  function showResult(state) {
    const r = state.result;
    el.overlay.classList.remove('hidden');
    el.overlay.innerHTML = '';

    const box = document.createElement('div');
    box.className = 'overlay-inner';

    const h = document.createElement('h2');
    h.textContent = r.nagari ? '나가리' : `${state.players[r.winnerSeat]?.name || '승자'} 승리!`;
    box.append(h);

    const rows = document.createElement('div');
    rows.className = 'rows';
    for (const row of r.rows) {
      const line = document.createElement('div');
      line.className = 'rowline';
      const left = document.createElement('span');
      left.textContent = row.name + (row.reasons?.length ? ` (${row.reasons.join(', ')})` : '');
      const right = document.createElement('b');
      right.textContent = `${row.amount > 0 ? '+' : ''}${row.amount.toLocaleString()} P`;
      line.append(left, right);
      rows.append(line);
    }
    box.append(rows);

    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = '닫기';
    btn.addEventListener('click', () => el.overlay.classList.add('hidden'));
    box.append(btn);

    el.overlay.append(box);
  }

  // ── 이펙트 ──────────────────────────────────────────────────────────────

  const FX_TEXT = {
    bbeok: '뻑!',
    cheotBbeok: '첫뻑!',
    yeonBbeok: '연뻑!',
    jabBbeok: '자뻑!',
    ttadak: '따닥!',
    jjok: '쪽!',
    sseul: '싹쓸이!',
    shake: '흔들기!',
    bomb: '폭탄!',
    chongtong: '총통!',
    go: '고!',
    reverseGo: '역고!',
    stop: '스톱!',
    timeout: '시간 초과!',
  };

  const FX_SOUND = {
    bbeok: 'ppeok.wav',
    cheotBbeok: 'ppeok.wav',
    yeonBbeok: 'double-ppeok.wav',
    jabBbeok: 'self-ppeok.wav',
    ttadak: 'ttadak.wav',
    jjok: 'jjok.wav',
    sseul: 'sweep.wav',
    shake: 'shake.wav',
    bomb: 'bomb.wav',
    chongtong: 'chongtong.wav',
    go: 'go.wav',
    reverseGo: 'go-high.wav',
    stop: 'stop.wav',
    timeout: 'nagari.wav',
  };

  function showFx(fx) {
    const text = FX_TEXT[fx.kind];
    if (text) toast(text, FX_SOUND[fx.kind]);
  }

  let toastTimer = null;
  function toast(text, sound) {
    if (!text) return;
    el.toast.textContent = text;
    el.toast.classList.remove('hidden');
    el.toast.style.animation = 'none';
    void el.toast.offsetWidth;
    el.toast.style.animation = '';
    if (sound) playSound(sound);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 1100);
  }

  // ── 사운드 ──────────────────────────────────────────────────────────────

  const soundCache = new Map();
  let soundEnabled = true;

  function playSound(file) {
    if (!soundEnabled) return;
    try {
      let audio = soundCache.get(file);
      if (!audio) {
        audio = new Audio(`assets/audio/${file}`);
        audio.preload = 'auto';
        soundCache.set(file, audio);
      }
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch {
      /* 오디오 실패는 무시 */
    }
  }

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
})();
