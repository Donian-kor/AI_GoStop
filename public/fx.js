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
    place: { text: null, sound: 'card_place.ogg', style: 'plain' },
    capture: { text: null, sound: 'card_capture.ogg', style: 'plain' },
    bbeok: { text: '뻑!', sound: 'ppeok.wav', style: 'red' },
    finished: { text: null, sound: null, style: 'plain' },
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
    'score.wav': 30, 'decision.wav': 20,
    'card_place.ogg': 10, 'card_capture.ogg': 35, 'draw.ogg': 70
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

  try { muted = localStorage.getItem('gs_muted') === '1'; } catch (e) { muted = false; }

  // iOS/Android 자동재생 정책 대비: 첫 사용자 입력에서 오디오를 한 번 깨운다.
  var audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    playSound('ui_click.ogg', 0);
  }
  if (document && document.addEventListener) {
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);
  }

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

  function stopSound(file) {
    var audio = soundCache[file];
    if (audio) audio.pause();
  }

  function stopShuffleSounds() {
    stopSound('card_deal.ogg');
    stopSound('card_flip.ogg');
    stopSound('card_place.ogg');
  }

  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem('gs_muted', muted ? '1' : '0'); } catch (e) {}
    return muted;
  }

  function isMuted() { return muted; }

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

  // ── 카드 이동(FLIP) · 섞기 연출 ─────────────────────────────────────────
  //
  // 벤치마킹: bipark/gostop-ts 의 web/main.ts · web/style.css
  //          (PolyForm Noncommercial 1.0.0 — https://github.com/bipark/gostop-ts)
  //
  // FLIP 기법(First-Last-Invert-Play)
  //   1) 그리기 전 카드 자리를 기억한다
  //   2) 그린다
  //   3) 옮겨진 카드는 이전 자리로 되돌렸다가 제자리로 미끄러뜨린다
  //   4) 새로 생긴 카드는 위에서 살짝 떨어지며 나타난다

  function raf(fn) {
    if (window.requestAnimationFrame) window.requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }

  /** 그리기 전 카드 자리(사각형)를 기억한다. */
  function captureRects(selector) {
    var out = {};
    var els = document.querySelectorAll(selector);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var key = el.getAttribute('data-card-id');
      if (key) out[key] = el.getBoundingClientRect();
    }
    return out;
  }

  /** 손패 카드는 CSS 로 각도·높이가 정해져 있으니 그 값도 함께 옮긴다. */
  function flipTransform(el, dx, dy) {
    var parent = el.parentNode;
    var inHand = parent && parent.className && String(parent.className).indexOf('hand') >= 0;
    if (inHand) {
      return 'translate(' + dx + 'px,' + dy + 'px) rotate(var(--rot)) translateY(var(--lift))';
    }
    return 'translate(' + dx + 'px,' + dy + 'px)';
  }

  /**
   * 다시 그린 뒤 카드 자리를 자연스럽게 맞춘다.
   * @param {object} prev captureRects() 로 기억한 이전 자리
   * @param {string} selector 대상 카드 선택자
   */
  function flipCards(prev, selector) {
    if (!prev) return;
    var els = document.querySelectorAll(selector);
    var stagger = 0;
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        var key = el.getAttribute('data-card-id');
        if (!key) return;
        var now = el.getBoundingClientRect();
        var old = prev[key];
        if (old) {
          var dx = old.left - now.left;
          var dy = old.top - now.top;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
            el.style.transition = 'none';
            el.style.transform = flipTransform(el, dx, dy);
            el.style.zIndex = '5';
            raf(function () {
              el.style.transition = 'transform 0.34s cubic-bezier(0.35,0,0.2,1)';
              el.style.transform = '';
              var clear = function () {
                el.style.transition = '';
                el.style.transform = '';
                el.style.zIndex = '';
                el.removeEventListener('transitionend', clear);
              };
              el.addEventListener('transitionend', clear);
              setTimeout(clear, 460); // transitionend 가 안 와도 정리
            });
          }
        } else if (String(el.className).indexOf('enter') < 0) {
          // 새로 나온 카드 — 위에서 살짝 떨어지며 나타난다
          el.className += ' enter';
          if (stagger > 0) el.style.animationDelay = (stagger * 45) + 'ms';
          stagger++;
        }
      })(els[i]);
    }
  }

  /**
   * 패를 섞는 연출 — 이 프로젝트에서 직접 만든 버전.
   * 뒷장 카드가 판 위에 넓게 퍼져 뒤섞인 다음 가운데로 모여 한 덱이 된다.
   * (bipark/gostop-ts 의 연출을 그대로 베끼지 않았다)
   * @param {number} [deckCount] 실제 덱 장수 (기본 50장)
   * @param {function} [onDone] 연출이 끝난 뒤 호출
   */
  function playShuffle(deckCount, onDone) {
    var GATHER_DURATION = 580;

    // playShuffle(onDone) 형태도 쓸 수 있게 한다
    if (typeof deckCount === 'function') {
      onDone = deckCount;
      deckCount = 0;
    }
    var felt = document.getElementById('feltBoard');
    if (!felt) {
      if (onDone) onDone();
      return;
    }
    // 이미 겹쳐 있으면 새로 만들지 않는다
    var old = felt.querySelector('.shuffle-overlay');
    if (old) {
      if (onDone) onDone();
      return;
    }

    var ov = document.createElement('div');
    ov.className = 'shuffle-overlay';
    var tip = document.createElement('div');
    tip.className = 'shuffle-tip';
    tip.textContent = '패를 섞는 중입니다';
    ov.appendChild(tip);

    // 실제 덱 장수만큼 (48 / 50 / 51) 뒷장 카드를 만든다
    var COUNT = deckCount >= 20 ? Math.min(deckCount, 60) : 50;
    var cards = [];
    for (var i = 0; i < COUNT; i++) {
      var c = document.createElement('div');
      c.className = 'shuffle-card';
      ov.appendChild(c);
      cards.push(c);
    }
    felt.appendChild(ov);

    // 처음 — 카드를 판 위에 넓게 펼쳐 놓는다
    var scatter = function () {
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        c.style.left = (8 + Math.random() * 80) + '%';
        c.style.top = (14 + Math.random() * 64) + '%';
        c.style.transform = 'rotate(' + ((Math.random() - 0.5) * 80) + 'deg)';
      }
    };

    // 섞는 중 — 카드가 자리를 넓게 바꾼다 (리플 셔플)
    var churn = function () {
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var x = parseFloat(c.style.left) || 50;
        var y = parseFloat(c.style.top) || 50;
        x += Math.random() * 24 - 12;
        y += Math.random() * 22 - 11;
        if (x < 6) x = 6 + Math.random() * 8;
        if (x > 92) x = 92 - Math.random() * 8;
        if (y < 10) y = 10 + Math.random() * 8;
        if (y > 82) y = 82 - Math.random() * 8;
        c.style.left = x + '%';
        c.style.top = y + '%';
        c.style.transform = 'rotate(' + ((Math.random() - 0.5) * 80) + 'deg)';
      }
    };

    // 끝 — 가운데로 모아 한 더미로 정리한다
    var gather = function () {
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var layer = i % 8;
        c.style.left = '50%';
        c.style.top = '50%';
        c.style.zIndex = String(i + 1);
        c.style.transform = 'translate(-50%, -50%) translateY(' + (layer * 0.65) +
          'px) rotate(' + ((i % 3 - 1) * 0.7) + 'deg)';
      }
    };

    playSound('card_deal.ogg', 0.5);
    var reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      ov.className = 'shuffle-overlay gather';
      gather();
      setTimeout(function () {
        stopShuffleSounds();
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        if (onDone) onDone();
      }, 120);
      return;
    }
    scatter();

    var n = 0;
    var timer = setInterval(function () {
      n++;
      churn();
      // 두 소리를 번갈아 넣어 섞는 리듬을 만든다
      playSound(n % 2 ? 'card_flip.ogg' : 'card_place.ogg', 0.32);
      if (n < 7) return;
      clearInterval(timer);
      // 마지막에 모으는 동작
      ov.className = 'shuffle-overlay gather';
      tip.textContent = '패를 한 덱으로 모읍니다';
      gather();
      playSound('card_deal.ogg', 0.45);
      setTimeout(function () {
        ov.className = 'shuffle-overlay gather out';
        setTimeout(function () {
          stopShuffleSounds();
          if (ov.parentNode) ov.parentNode.removeChild(ov);
          if (onDone) onDone();
        }, 220);
      }, GATHER_DURATION + 260);
    }, 72);
  }

  /**
   * 카드를 지정한 자리에서 다른 자리로 날린다.
   * (상대가 낸 패 · 먹은 패 연출)
   * @param {DOMRect} fromRect 출발 자리
   * @param {DOMRect} toRect 도착 자리
   * @param {string} imageUrl 카드 그림 주소
   * @param {number} [duration] 이동 시간(ms)
   * @param {number} [rotate] 회전각
   * @param {function} [onArrive] 도착했을 때 호출
   */
  function animateCardMove(fromRect, toRect, imageUrl, duration, rotate, onArrive) {
    if (!fromRect || !toRect || !imageUrl) {
      if (onArrive) onArrive();
      return;
    }
    // Web Animations 미지원 환경(구형 안드로이드)에서는 조용히 끝낸다
    if (!canAnimate(document.body)) {
      if (onArrive) onArrive();
      return;
    }

    var clone = document.createElement('div');
    clone.className = 'flying-card pic';
    clone.style.backgroundImage = 'url(' + imageUrl + ')';
    clone.style.left = fromRect.left + 'px';
    clone.style.top = fromRect.top + 'px';
    clone.style.width = fromRect.width + 'px';
    clone.style.height = fromRect.height + 'px';
    document.body.appendChild(clone);

    var dx = toRect.left + toRect.width / 2 - fromRect.left - fromRect.width / 2;
    var dy = toRect.top + toRect.height / 2 - fromRect.top - fromRect.height / 2;
    var rot = rotate === undefined ? -8 : rotate;
    var dur = duration || 340;
    var done = function () {
      if (clone.parentNode) clone.parentNode.removeChild(clone);
      if (onArrive) onArrive();
    };

    try {
      var animation = clone.animate(
        [
          { transform: 'translate3d(0,0,0) rotate(0deg) scale(1)' },
          { transform: 'translate3d(' + (dx * 0.5) + 'px,' + (dy * 0.4 - 26) + 'px,0) rotate(' + rot + 'deg) scale(1.06)', offset: 0.55 },
          { transform: 'translate3d(' + dx + 'px,' + dy + 'px,0) rotate(' + (-rot / 2) + 'deg) scale(0.95)' }
        ],
        { duration: dur, easing: EASE.out, fill: 'forwards' }
      );
      if (animation && animation.finished && animation.finished.then) {
        animation.finished.then(done, done);
      } else {
        setTimeout(done, dur);
      }
    } catch (e) {
      done();
    }
  }

  function animateCardFlipMove(fromRect, toRect, imageUrl, duration, rotate, onArrive) {
    var reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fromRect || !toRect || !imageUrl || !canAnimate(document.body) || reducedMotion) {
      if (onArrive) onArrive();
      return;
    }

    var clone = document.createElement('div');
    clone.className = 'flying-card flip-flight';
    clone.style.left = fromRect.left + 'px';
    clone.style.top = fromRect.top + 'px';
    clone.style.width = fromRect.width + 'px';
    clone.style.height = fromRect.height + 'px';

    var back = document.createElement('div');
    back.className = 'flip-flight-face flip-flight-back';
    var front = document.createElement('div');
    front.className = 'flip-flight-face flip-flight-front';
    front.style.backgroundImage = 'url(' + imageUrl + ')';
    clone.appendChild(back);
    clone.appendChild(front);
    document.body.appendChild(clone);

    var dx = toRect.left + toRect.width / 2 - fromRect.left - fromRect.width / 2;
    var dy = toRect.top + toRect.height / 2 - fromRect.top - fromRect.height / 2;
    var finalScale = toRect.width / fromRect.width;
    var rot = rotate === undefined ? 8 : rotate;
    var dur = duration || 420;
    var done = function () {
      if (clone.parentNode) clone.parentNode.removeChild(clone);
      if (onArrive) onArrive();
    };

    try {
      var animation = clone.animate(
        [
          { transform: 'perspective(700px) translate3d(0,0,0) rotate(0deg) rotateY(0deg) scale(.94)' },
          { transform: 'perspective(700px) translate3d(' + (dx * 0.45) + 'px,' + (dy * 0.35 - 34) + 'px,0) rotate(' + rot + 'deg) rotateY(90deg) scale(1.08)', offset: 0.5 },
          { transform: 'perspective(700px) translate3d(' + dx + 'px,' + dy + 'px,0) rotate(' + (-rot / 2) + 'deg) rotateY(180deg) scale(' + finalScale + ')' }
        ],
        { duration: dur, easing: EASE.out, fill: 'forwards' }
      );
      if (animation && animation.finished && animation.finished.then) {
        animation.finished.then(done, done);
      } else {
        setTimeout(done, dur);
      }
    } catch (e) {
      done();
    }
  }

  // ── 서버 이벤트 → 이펙트 ───────────────────────────────────────────────

  function handleFx(fx, ctx) {
    var def = EFFECTS[fx.kind];
    if (!def) return;

    // 나가리(손패 소진) → 전용 사운드
    if (fx.kind === 'finished') {
      if (fx.text && /나가리/.test(fx.text)) playSound('draw.ogg');
      return;
    }

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

    if (text) showBanner(text, def.style);
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
    captureRects: captureRects,
    flipCards: flipCards,
    playShuffle: playShuffle,
    animateCardMove: animateCardMove,
    animateCardFlipMove: animateCardFlipMove,
    showBanner: showBanner,
    cutIn: cutIn,
    vibrate: vibrate,
    flashPlayer: flashPlayer,
    playSound: playSound,
    setMuted: setMuted,
    isMuted: isMuted,
    handleFx: handleFx
  };
})();
