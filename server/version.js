'use strict';

// 버전 번호 규칙
//
// 버전 규칙
//   v0.1        최초 공개
//   v0.1x       버그 수정      (v0.11, v0.12, ...
//   v0.x        기능 추가      (v0.2, v0.3, ...
//   vx.x        대규모 리팩토링 / 대형 기능 추가 (v1.0, v2.0, ...

// GAME_VERSION  : 화면에 표시되는 버전. 위 규칙에 따라 올린다.
// BUILD_VERSION : 빌드/화면/자산을 구분하는 번호.
//                 파일을 바꾼 뒤에는 이 번호도 올려 폰이 새 화면을 받게 한다.

const GAME_VERSION = 'v0.27';
const BUILD_VERSION = '2026-10-23-11';

module.exports = { GAME_VERSION, BUILD_VERSION };
