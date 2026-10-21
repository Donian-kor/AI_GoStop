'use strict';

/*
 * 게임 필감 — 이펙트·애니메이션·사운드 (ES5 문법, Android 4.4 등 구형 브라우저 대응)
 *
 * 벤치마킹: itsent-lab/hwatu 의 apps/web/src/lib/effects.ts (Web Animations API 카드 비행)
 *
 * 주의: Web Animations API(element.animate) 는 Chrome 39+ 에서만 지원된다.
 *       지원하지 않으면 애니메이션 없이 동작한다(화면이 깨지지 않는 게 우선).
 */

(function () {
  var EASE = {
    out: 'cubic-bezier(.2,.75,.18,1)',
    inOut: 'cubic-bezier(.45,.05,.55,.95)',
    back: 'cubic-bezier(.34,1.56,.64,1)',
    soft: 'cubic-bezier(.25,.46,.45,.94)'
  };

  var EFFECTS = {
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
    goStopPrompt: { text: '고 / 스톱', sound: 'decision.wav', style: 'plain' }
  };

  var SOUND_PRIORITY = {
    'stop.wav': 100, 'chongtong.wav': 95, 'bomb.wav': 90, 'go-high.wav': 85,
    'go.wav': 80, 'nagari.wav': 78, 'sseul.wav': 70, 'ttadak.wav': 68,
    'jjok.wav': 66, 'double-ppeok.wav': 64, 'self-ppeok.wav': 62, 'ppeok.wav': 60,
    'shake.wav': 58, 'bonus-two.wav': 50, 'bonus-three.wav': 50,
    'pee-transfer-two.wav': 40, 'pee-transfer-three.wav': 40,
    'score.wav': 30, 'decision.wav': 20
  };

  var CUTIN_KINDS = {
    jjok: 1, ttadak: 1, bomb: 1, bbeok: 1, chongtong: 1, go: 1,
    reverseGo: 1, stop: 1, sseul: 1, goStopPrompt: 1
  };

  var soundCache = {};
  var muted = false;
  var lastSound = '';
  var lastSoundAt = 0;
  var bannerEl = null;
  var bannerTimer = null;
  var bgm = null;
  var bgmOn = false;

  try { muted = localStorage.getItem('gs_muted') === '1'; } catch (e) { muted = false; }
  try { bgmOn = localStorage.getItem('gs_bgm') === '1'; } catch (e) { bgmOn = false; }

  // ── 사운드 ──────────────────────────────────────────────────────────────

  function playSound(file, volume) {
    if (muted || !file) return;
    var now = new Date().getTime();
    if (file === lastSound && now - lastSoundAt < 120) return;
    lastSound = file;
    lastSoundAt = now;
    try {
      var audio = soundCache[file];
      if (!audio) {
        audio = new Audio('assets/audio/' + file);
        audio.preload = 'auto';
        audio.volume = volume === undefined ? 1 : volume;
        soundCache[file] = audio;
      }
      audio.currentTime = 0;
      var p = audio.play();
      if (p && p.catch) { try { p.catch(function () {}); } catch (e) {} }
    } catch (e) {}
  }

  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem('gs_muted', muted ? '1' : '0'); } catch (e) {}
    return muted;
  }

  function isMuted() { return muted; }

  // ── 배경음악 ────────────────────────────────────────────────────────────

  function bgmElement() {
    if (!bgm) {
      try {
        bgm = new Audio('assets/audio/gugak-bgm-133.mp3');
        bgm.loop = true;
        bgm.volume = 0.22;
        bgm.preload = 'none';
      } catch (e) { bgm = false; }
    }
    return bgm;
  }

  function toggleBgm() {
    bgmOn = !bgmOn;
    try { localStorage.setItem('gs_bgm', bgmOn ? '1' : '0'); } catch (e) {}
    try {
      var el = bgmElement();
      if (el && bgmOn) {
        var p = el.play();
        if (p && p.catch) { try { p.catch(function () {}); } catch (e) {} }
      } else if (el) {
        el.pause();
      }
    } catch (e) {}
    return bgmOn;
  }

  function isBgmOn() { return bgmOn; }

  // ── 이펙트 배너 ─────────────────────────────────────────────────────────

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

  function showBanner(text, style, duration) {
    var el = ensureBanner();
    el.innerHTML = text;
    el.className = 'banner show ' + (style || 'plain');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { el.className = 'banner'; }, duration || 1100);
  }

  /** 크게 외치는 이벤트 — 화면 플래시 + 흔들림 + 진동 */
  function cutIn(text, style) {
    showBanner(text, style, 1500);
    var el = ensureBanner();
    el.className = 'banner show cutin ' + (style || 'gold');

    if (document.body.animate) {
      var strong = style === 'red' ? 12 : 7;
      try {
        document.body.animate(
          [
            { transform: 'translate3d(0,0,0)' },
            { transform: 'translate3d(' + (-strong) + 'px,' + (strong / 2) + 'px,0)' },
            { transform: 'translate3d(' + strong + 'px,' + (-strong / 2) + 'px,0)' },
            { transform: 'translate3d(' + (-strong / 2) + 'px,' + (strong / 3) + 'px,0)' },
            { transform: 'translate3d(0,0,0)' }
          ],
          { duration: 320, easing: EASE.out }
        );
      } catch (e) {}
    }

    var flash = document.createElement('div');
    flash.className = 'cutin-flash ' + (style || 'gold');
    document.body.appendChild(flash);
    setTimeout(function () {
      if (flash.parentNode) flash.parentNode.removeChild(flash);
    }, 420);
  }

  function vibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {}
  }

  /** 패널 흔들면서 '피 -1' 표시 */
  function flashPlayer(seatEl, text) {
    if (!seatEl) return;
    if (seatEl.animate) {
      try {
        seatEl.animate(
          [
            { transform: 'translateX(0)' },
            { transform: 'translateX(-5px)' },
            { transform: 'translateX(5px)' },
            { transform: 'translateX(-3px)' },
            { transform: 'translateX(0)' }
          ],
          { duration: 260, easing: EASE.out }
        );
      } catch (e) {}
    }
    if (!text) return;
    var tag = document.createElement('span');
    tag.className = 'float-tag';
    tag.innerHTML = text;
    seatEl.appendChild(tag);
    setTimeout(function () {
      if (tag.parentNode) tag.parentNode.removeChild(tag);
    }, 900);
  }

  // ── 카드 비행 애니메이션 ────────────────────────────────────────────────

  function canAnimate(el) {
    return !!(el && typeof el.animate === 'function');
  }

  /**
   * 카드를 복제해 출발지 → 도착지로 포물선을 그리며 날린다.
   * Web Animations API 미지원 환경에서는 조용히 건너뛴다.
   */
  function animateCardFlight(source, target, rotate, duration) {
    if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) return;
    if (!canAnimate(source)) return;

    var sourceRect = source.getBoundingClientRect();
    var targetRect = target.getBoundingClientRect();

    var clone = source.cloneNode(true);
    clone.className += ' flying-card';
    clone.style.left = sourceRect.left + 'px';
    clone.style.top = sourceRect.top + 'px';
    clone.style.width = sourceRect.width + 'px';
    clone.style.height = sourceRect.height + 'px';
    document.body.appendChild(clone);

    var dx = targetRect.left + targetRect.width / 2 - sourceRect.left - sourceRect.width / 2;
    var dy = targetRect.top + targetRect.height / 2 - sourceRect.top - sourceRect.height / 2;
    var rot = rotate === undefined ? -5 : rotate;

    try {
      var animation = clone.animate(
        [
          { transform: 'translate3d(0,0,0) rotate(0deg) scale(1)' },
          { transform: 'translate3d(' + (dx * 0.55) + 'px,' + (dy * 0.35 - 34) + 'px,0) rotate(' + rot + 'deg) scale(1.08)', offset: 0.55 },
          { transform: 'translate3d(' + dx + 'px,' + dy + 'px,0) rotate(' + (-rot / 2) + 'deg) scale(0.96)' }
        ],
        { duration: duration || 280, easing: EASE.out, fill: 'forwards' }
      );
      if (animation && animation.finished && animation.finished.then) {
        animation.finished.then(function () {
          if (clone.parentNode) clone.parentNode.removeChild(clone);
        }, function () {
          if (clone.parentNode) clone.parentNode.removeChild(clone);
        });
      } else {
        setTimeout(function () {
          if (clone.parentNode) clone.parentNode.removeChild(clone);
        }, duration || 280);
      }

      target.animate(
        [
          { transform: 'scale(1)', filter: 'brightness(1)' },
          { transform: 'scale(1.025)', filter: 'brightness(1.2)', offset: 0.34 },
          { transform: 'scale(1)', filter: 'brightness(1)' }
        ],
        { duration: 170, easing: 'ease-out' }
      );
    } catch (e) {
      if (clone.parentNode) clone.parentNode.removeChild(clone);
    }
  }

  function animateCapturedTransfers(cardIds, sourceRack, targetRack) {
    if (!sourceRack || !targetRack) return;
    for (var i = 0; i < cardIds.length; i++) {
      (function (cardId) {
        var all = sourceRack.querySelectorAll('[data-card-id]');
        var source = null;
        for (var j = 0; j < all.length; j++) {
          if (all[j].getAttribute('data-card-id') === cardId) { source = all[j]; break; }
        }
        if (!source) return;
        animateCardFlight(source, targetRack, -9, 360);
      })(cardIds[i]);
    }
  }

  // ── 서버 이벤트 → 이펙트 ───────────────────────────────────────────────

  function handleFx(fx, ctx) {
    var def = EFFECTS[fx.kind];
    if (!def) return;

    var prio = SOUND_PRIORITY[def.sound] || 0;
    var now = new Date().getTime();
    if (prio < 30 && now - lastSoundAt < 250) return;

    var text = def.text;
    if (fx.kind === 'go' && fx.text) {
      var m = /(\d+)고/.exec(fx.text);
      if (m) {
        text = m[1] + '고!';
        if (parseInt(m[1], 10) >= 5) def = { text: text, sound: 'go-high.wav', style: def.style };
      }
    }

    showBanner(text, def.style);
    playSound(def.sound);

    if (CUTIN_KINDS[fx.kind]) {
      cutIn(text, def.style);
      vibrate(fx.kind === 'bomb' || fx.kind === 'stop' ? [30, 40, 30] : [25]);
    }

    if (fx.kind === 'piSteal' && ctx && ctx.seatEl && fx.victimSeat >= 0) {
      flashPlayer(ctx.seatEl(fx.victimSeat), '피 -1');
    }
  }

  window.GostopFx = {
    EASE: EASE,
    EFFECTS: EFFECTS,
    CUTIN_KINDS: CUTIN_KINDS,
    animateCardFlight: animateCardFlight,
    animateCapturedTransfers: animateCapturedTransfers,
    showBanner: showBanner,
    cutIn: cutIn,
    vibrate: vibrate,
    flashPlayer: flashPlayer,
    playSound: playSound,
    setMuted: setMuted,
    isMuted: isMuted,
    handleFx: handleFx,
    toggleBgm: toggleBgm,
    isBgmOn: isBgmOn
  };
})();
