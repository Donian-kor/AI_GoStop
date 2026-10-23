'use strict';

/*
 * 명지네고스톱 PWA — 서비스 워커
 * ES5 문법 (구형 브라우저 호환 검사 통과용)
 *
 * - 정적 자산(CSS/JS/HTML/이미지)은 캐시 우선으로 제공해 빠르게 뜬다
 * - API 요청(/api/*)은 네트워크 우선으로 처리한다 (게임 상태는 항상 최신)
 * - 오프라인에서는 캐시된 화면을 보여준다
 */

var CACHE_NAME = 'gostop-v13';
var STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/style.css',
  '/assets/title.png',
  '/app.js',
  '/fx.js',
  '/room-session.js',
  '/room-browser.js',
  '/score-panel.js',
  '/result-view.js',
  '/phase-views.js',
  '/opponent-view.js',
  '/hand-view.js',
  '/table-deck-view.js',
  '/settings-view.js',
  '/opponent-card-motion.js',
  '/sw.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// 설치 — 정적 자산 캐시
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(STATIC_ASSETS).catch(function (e) {
        // 일부 자산이 없어도 설치는 계속 진행한다
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting();
});

// 활성화 — 오래된 캐시 정리
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
        return Promise.resolve();
      }));
    })
  );
  self.clients.claim();
});

// 요청 가로채기
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // API 요청은 네트워크 우선 (게임 상태는 항상 최신)
  if (url.pathname.indexOf('/api/') === 0) {
    event.respondWith(
      fetch(event.request).catch(function () {
        // 오프라인 — 캐시된 응답이 있으면 반환
        return caches.match(event.request);
      })
    );
    return;
  }

  // 카드 이미지(화투 패)는 캐시 우선 — 외부 접속 시 매번 네트워크로 받아오지 않게 한다
  if (url.pathname.indexOf('/assets/hwatu/png/') === 0) {
    event.respondWith(
      caches.match(event.request).then(function (cached) {
        if (cached) return cached;
        return fetch(event.request).then(function (response) {
          if (response && response.status === 200 && response.type === 'basic') {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML/JS/CSS 코드는 네트워크 우선 (최신 코드 즉시 반영), 오프라인일 때만 캐시
  var isCode = url.pathname === '/' || url.pathname.indexOf('.html') !== -1 || url.pathname.indexOf('.js') !== -1 || url.pathname.indexOf('.css') !== -1;
  if (isCode) {
    event.respondWith(
      fetch(event.request).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function () {
        return caches.match(event.request).then(function (cached) {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('/index.html');
          return new Response('', { status: 503, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // 기타 정적 자산(아이콘 등)은 캐시 우선, 없으면 네트워크
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        // 성공한 응답은 캐시에 저장
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function () {
        // 오프라인 — index.html로 폴백
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
