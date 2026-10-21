'use strict';

// 버전 관리 — 프로젝트 단 하나의 기준.
//
// 버전 규칙
//   v0.1        최초 공개
//   v0.1x       버그 수정      (v0.11, v0.12, …)
//   v0.x        기능 추가      (v0.2, v0.3, …)
//   vx.x        대규모 리팩토링 / 대형 기능 추가 (v1.0, v2.0, …)
//
// GAME_VERSION  : 화면에 표시되는 버전. 위 규칙에 따라 올린다.
// BUILD_VERSION : 서버/화면/자산을 구분하는 빌드 번호.
//                 어떤 파일이든 바뀌면 올리면, 폰이 알아서 새 화면을 받는다.

const GAME_VERSION = 'v0.1';
const BUILD_VERSION = '2026-10-21-5';

module.exports = { GAME_VERSION, BUILD_VERSION };
