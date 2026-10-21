'use strict';

// 게임 필감 — 이펙트 · 애니메이션 · 사운드.
//
// 벤치마킹: itsent-lab/hwatu 의 apps/web/src/lib/effects.ts (Web Animations API 카드 비행)
//            apps/web/src/games/gostop/effects.ts (상태-diff → 이펙트 우선순위)
//
// 원칙
//   1) 애니메이션은 CSS 키프레임이 아니라 element.animate() 로 제어한다.
//      → "어느 카드가 어디서 어디로 갔는지"를 정확히 추적할 수 있다.
//   2) 이펙트는 서버가 준 이벤트(fx)를 받아서만 실행한다.
//      → 스냅샷을 다시 그려도 애니메이션이 중복 실행되지 않는다.
//   3) 사운드는 우선순위가 높은 것만 한 번에 울린다(겹쳐 지면 지저분).

(() => {
  // ── 공용 이징 ────────────────────────────────────────────────────────────
  // 게임 필감 감사(gostop game-feel-audit)의 지적을 반영해 이징을 한곳에서 관리한다.
  const EASE = {
    out: 'cubic-bezier(.2,.75,.18,1)', // 기본 (빠르게 시작, 부드럽게 끝)
    inOut: 'cubic-bezier(.45,.05,.55,.95)',
    back: 'cubic-bezier(.34,1.56,.64,1)', // 살짝 튀는 느낌
    soft: 'cubic-bezier(.25,.46,.45,.94)',
  };

  // ── 이펙트 정의 ──────────────────────────────────────────────────────────
  // kind: { text, sound, style }  style: 'gold' | 'red' | 'plain'
  const EFFECTS = {
    bbeok: { text: '뻑!', sound: 'ppeok.wav', style: 'red' },
    cheotBbeok: { text: '첫뻑!', sound: 'ppeok.wav', style: 'red' },
    yeonBbeok: { text: '연뻑!', sound: 'double-ppeok.wav', style: 'red' },
    jabBbeok: { text: '자뻑!', sound: 'self-ppeok.wav', style: 'red' },
    ttadak: { text: '따닥!', sound: 'ttadak.wav', style: 'gold' },
    jjok: { text: '쪽!', sound: 'jjok.wav', style: 'gold' },
    sseul: { text: '싹쓸이!', sound: 'sweep.wav', style: 'gold' },
    shake: { text: '흔들기!', sound: 'shake.wav', style: 'gold' },
    bomb: { text: '폭탄!', sound: 'bomb.wav', style: 'gold' },
    chongtong: { text: '총통!', sound: 'chongtong.wav', style: 'gold' },
    go: { text: '고!', sound: 'go.wav', style: 'plain' },
    reverseGo: { text: '역고!', sound: 'go-high.wav', style: 'gold' },
    stop: { text: '스톱!', sound: 'stop.wav', style: 'gold' },
    timeout: { text: '시간 초과!', sound: 'nagari.wav', style: 'red' },
    bonusCapture: { text: '보너스패!', sound: 'bonus-two.wav', style: 'gold' },
    piSteal: { text: '피 뺏기!', sound: 'pee-transfer-two.wav', style: 'plain' },
    score: { text: '점수!', sound: 'score.wav', style: 'gold' },
    goStopPrompt: { text: '고 / 스톱', sound: 'decision.wav', style: 'plain' },
  };

  // 사운드 우선순위 (높을수록 먼저) — 동시에 울리지 않게 조절
  const SOUND_PRIORITY = {
    'stop.wav': 100,
    'chongtong.wav': 95,
    'bomb.wav': 90,
    'go-high.wav': 85,
    'go.wav': 80,
    'nagari.wav': 78,
    'sseul.wav': 70,
    'ttadak.wav': 68,
    'jjok.wav': 66,
    'double-ppeok.wav': 64,
    'self-ppeok.wav': 62,
    'ppeok.wav': 60,
    'shake.wav': 58,
    'bonus-two.wav': 50,
    'bonus-three.wav': 50,
    'pee-transfer-two.wav': 40,
    'pee-transfer-three.wav': 40,
    'score.wav': 30,
    'decision.wav': 20,
  };

  const soundCache = new Map();
  let muted = localStorage.getItem('gs_muted') === '1';
  let lastSound = '';
  let lastSoundAt = 0;

  function playSound(file, volume = 1) {
    if (muted || !file) return;
    const now = Date.now();
    // 같은 소리를 너무 빠르게 연속 재생하지 않는다
    if (file === lastSound && now - lastSoundAt < 120) return;
    lastSound = file;
    lastSoundAt = now;

    try {
      let audio = soundCache.get(file);
      if (!audio) {
        audio = new Audio(`assets/audio/${file}`);
        audio.preload = 'auto';
        audio.volume = volume;
        soundCache.set(file, audio);
      }
      audio.currentTime = 0;
      const p = audio.play();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* 오디오 실패는 무시한다 */
    }
  }

  function setMuted(v) {
    muted = Boolean(v);
    localStorage.setItem('gs_muted', muted ? '1' : '0');
    return muted;
  }

  function isMuted() {
    return muted;
  }

  // ── 카드 비행 애니메이션 ─────────────────────────────────────────────────

  /**
   * 카드를 복제해서 출발지 → 도착지로 포물선을 그리며 날린다.
   * @param {Element|null} source 출발 요소
   * @param {Element|null} target 도착 요소
   * @param {number} rotate 회전각
   * @param {number} duration 밀리초
   */
  async function animateCardFlight(source, target, rotate = -5, duration = 280) {
    if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) return;
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    const clone = source.cloneNode(true);
    clone.classList.add('flying-card');
    Object.assign(clone.style, {
      left: `${sourceRect.left}px`,
      top: `${sourceRect.top}px`,
      width: `${sourceRect.width}px`,
      height: `${sourceRect.height}px`,
    });
    document.body.appendChild(clone);

    const dx = targetRect.left + targetRect.width / 2 - sourceRect.left - sourceRect.width / 2;
    const dy = targetRect.top + targetRect.height / 2 - sourceRect.top - sourceRect.height / 2;

    const animation = clone.animate(
      [
        { transform: 'translate3d(0,0,0) rotate(0deg) scale(1)' },
        { transform: `translate3d(${dx * 0.55}px,${dy * 0.35 - 34}px,0) rotate(${rotate}deg) scale(1.08)`, offset: 0.55 },
        { transform: `translate3d(${dx}px,${dy}px,0) rotate(${-rotate / 2}deg) scale(0.96)` },
      ],
      { duration, easing: EASE.out, fill: 'forwards' }
    );
    await animation.finished.catch(() => undefined);
    clone.remove();

    // 도착 지점이 살짝 커졌다가 밝아진다
    target.animate(
      [
        { transform: 'scale(1)', filter: 'brightness(1)' },
        { transform: 'scale(1.025)', filter: 'brightness(1.2)', offset: 0.34 },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ],
      { duration: 170, easing: 'ease-out' }
    );
  }

  /** 잡힌 카드들을 라크로 옮기는 애니메이션. */
  async function animateCapturedTransfers(cardIds, sourceRack, targetRack) {
    if (!sourceRack || !targetRack) return;
    for (const cardId of cardIds) {
      const source = [...sourceRack.querySelectorAll('[data-card-id]')].find(
        (el) => el.dataset.cardId === cardId
      );
      if (!source) continue;
      await animateCardFlight(source, targetRack, -9, 360);
    }
  }

  // ── 이펙트 배너 ──────────────────────────────────────────────────────────

  let bannerEl = null;
  let bannerTimer = null;

  function ensureBanner() {
    if (bannerEl && document.body.contains(bannerEl)) return bannerEl;
    bannerEl = document.getElementById('banner');
    if (!bannerEl) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'banner';
      bannerEl.className = 'banner';
      document.body.appendChild(bannerEl);
    }
    return bannerEl;
  }

  /**
   * 이펙트 배너를 띄운다.
   * @param {string} text 문구
   * @param {string} style 'gold' | 'red' | 'plain'
   * @param {number} duration 유지 시간(밀리초)
   */
  function showBanner(text, style = 'plain', duration = 1100) {
    const el = ensureBanner();
    el.textContent = text;
    el.className = `banner show ${style}`;
    // 다시 트리거하기 위해 애니메이션을 리셋한다
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      el.className = 'banner';
    }, duration);
  }

  /** 플레이어 패널을 흔들며 "피 뺏김" 을 알린다. */
  function flashPlayer(seatEl, text) {
    if (!seatEl) return;
    seatEl.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-5px)' },
        { transform: 'translateX(5px)' },
        { transform: 'translateX(-3px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 260, easing: EASE.out }
    );
    if (!text) return;
    const tag = document.createElement('span');
    tag.className = 'float-tag';
    tag.textContent = text;
    seatEl.appendChild(tag);
    setTimeout(() => tag.remove(), 900);
  }

  // ── 서버 이벤트 → 이펙트 ─────────────────────────────────────────────────

  /**
   * 서버가 보낸 fx 이벤트를 재생한다.
   * @param {object} fx { kind, seat, month, text, victimSeat }
   * @param {object} ctx { seatEl(seat) 로 요소 찾는 함수, mySeat }
   */
  function handleFx(fx, ctx = {}) {
    const def = EFFECTS[fx.kind];
    if (!def) return;

    // 사운드 우선순위: 지금 울리는 소드보다 중요하지 않으면 건너뛴다
    const prio = SOUND_PRIORITY[def.sound] || 0;
    const now = Date.now();
    if (prio < 30 && now - lastSoundAt < 250) return;

    let text = def.text;
    if (fx.kind === 'go' && fx.text) {
      const m = fx.text.match(/(\d+)고/);
      if (m) text = `${m[1]}고!`;
      if (Number(m?.[1]) >= 5) def.sound = 'go-high.wav';
    }

    showBanner(text, def.style);
    playSound(def.sound);

    // 크게 외치는 이벤트는 컷인 + 진동
    if (CUTIN_KINDS.has(fx.kind)) {
      cutIn(text, def.style);
      vibrate(fx.kind === 'bomb' || fx.kind === 'stop' ? [30, 40, 30] : [25]);
    }

    // 피 뺏기 — 빼앗긴 사람 패널에 표시
    if (fx.kind === 'piSteal' && ctx.seatEl && fx.victimSeat >= 0) {
      flashPlayer(ctx.seatEl(fx.victimSeat), '피 -1');
    }
  }

  // ── 배경음악 (BGN) ────────────────────────────────────────────────────────
  // 국악 배경음악 #133 (공유마당, CC BY 4.0) — ATTRIBUTION.md 참고
  let bgm = null;
  let bgmOn = localStorage.getItem('gs_bgm') === '1';

  function bgmElement() {
    if (!bgm) {
      bgm = new Audio('assets/audio/gugak-bgm-133.mp3');
      bgm.loop = true;
      bgm.volume = 0.22;
      bgm.preload = 'none';
    }
    return bgm;
  }

  /** BGM 켜기/끄기. 반환값 = 켜졌는지. */
  function toggleBgm() {
    bgmOn = !bgmOn;
    localStorage.setItem('gs_bgm', bgmOn ? '1' : '0');
    try {
      const el = bgmElement();
      if (bgmOn) {
        const p = el.play();
        if (p && p.catch) p.catch(() => {});
      } else {
        el.pause();
      }
    } catch {
      /* 무시 */
    }
    return bgmOn;
  }

  function isBgmOn() {
    return bgmOn;
  }

  // ── 컷인 · 햅틱 ──────────────────────────────────────────────────────────

  /** 크게 외치는 이벤트(쪽/따닥/폭탄/뻑/고/스톱/총통)의 컷인 연출. */
  const CUTIN_KINDS = new Set(['jjok', 'ttadak', 'bomb', 'bbeok', 'chongtong', 'go', 'reverseGo', 'stop', 'sseul', 'goStopPrompt']);

  function cutIn(text, style = 'gold') {
    const el = ensureBanner();
    el.textContent = text;
    el.className = `banner show cutin ${style}`;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      el.className = 'banner';
    }, 1500);

    // 화면 흔들림
    if (document.body.animate) {
      const strong = style === 'red' ? 12 : 7;
      document.body.animate(
        [
          { transform: 'translate3d(0,0,0)' },
          { transform: `translate3d(${-strong}px,${strong / 2}px,0)` },
          { transform: `translate3d(${strong}px,${-strong / 2}px,0)` },
          { transform: `translate3d(${-strong / 2}px,${strong / 3}px,0)` },
          { transform: 'translate3d(0,0,0)' },
        ],
        { duration: 320, easing: EASE.out }
      );
    }
    // 화면 플래시
    const flash = document.createElement('div');
    flash.className = `cutin-flash ${style}`;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 420);
  }

  /** 진동(햅틱) 피드백. 지원하지 않으면 조용히 무시. */
  function vibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch {
      /* 무시 */
    }
  }

  window.GostopFx = {
    EASE,
    EFFECTS,
    animateCardFlight,
    animateCapturedTransfers,
    showBanner,
    cutIn,
    vibrate,
    flashPlayer,
    playSound,
    setMuted,
    isMuted,
    handleFx,
    toggleBgm,
    isBgmOn,
    CUTIN_KINDS,
  };
})();
