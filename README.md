# 고스톱 게임

가족이 같은 집에서 함께 즐길 수 있도록 만드는 고스톱 프로젝트입니다. 3인 삼파전을 중심으로 2인 맞고도 지원하는 것을 목표로 하며, 실제 돈이 아닌 가상 포인트만 사용합니다.

> **현재 상태:** 게임 규칙 엔진과 테스트 코드는 구현되어 있습니다. 브라우저 화면과 HTTP 서버 실행 진입점은 아직 준비 중이므로, 지금은 게임을 브라우저에서 실행할 수 없습니다.

## 현재 구현된 기능

- 화투 48장 및 보너스패 구성별 덱 생성과 셔플
- 2인 맞고·3인 삼파전의 패 나누기와 선 결정
- 턴 진행, 카드 매칭, 뻑·쪽·따닥·싹쓸이·폭탄·흔들기 등 특수 상황
- 광·열끗·띠·피 족보 점수와 국진 처리
- 고·스톱, 역고, 박, 나가리 이월 및 가상 포인트 정산
- 고정된 `.rec` 기록을 이용한 재생 테스트
- 화투 SVG와 효과음 자산

## 요구 사항

- Node.js 18 이상
- npm

외부 npm 패키지를 사용하지 않아 `npm install`은 필요하지 않습니다.

## 테스트 실행

프로젝트 폴더에서 전체 테스트를 실행합니다.

```bash
npm test
```

개별 테스트도 실행할 수 있습니다.

```bash
npm run test:engine
npm run test:contract
npm run test:replay
```

현재 전체 테스트는 **57개**입니다.

- 규칙 엔진 테스트 44개
- 카드·점수 계약 테스트 10개
- 재생 테스트 3개

테스트는 Node.js 기본 `node:test`로 실행하며, 외부 테스트 패키지가 필요하지 않습니다.

## 프로젝트 구조

```text
engine/                 게임 규칙과 상태 처리
  cards.js              카드 목록 및 카드 식별자
  deck.js               덱 생성, 셔플, 재생용 덱 구성
  deal.js               패 나누기와 선 결정
  play.js               턴 진행과 특수 상황
  score.js              족보·점수·박 계산
  settlement.js         가상 포인트 정산
  settings.js           기본 규칙 및 설정 정규화
assets/
  hwatu/svg/            화투 카드 이미지
  audio/                효과음
tests/
  engine_test.js        규칙 테스트
  contract_test.js      카드·점수 계약 테스트
  replay_test.js        기록 재생 테스트
  records/              재생용 게임 기록
tools/
  fetch-assets.js       외부 저장소에서 자산 받기
server/                 서버 기능 개발 중
public/                 브라우저 UI 개발 예정
```

## 자산 다운로드

필요한 경우 자산을 다시 받을 수 있습니다.

```bash
npm run fetch-assets
```

이미 파일이 있고 원본과 크기가 같으면 건너뜁니다. 강제로 다시 받으려면 다음 명령을 사용합니다.

```bash
node tools/fetch-assets.js --force
```

자산별 저작자와 라이선스는 [ATTRIBUTION.md](./ATTRIBUTION.md)를 참고하세요. 소스 코드는 [LICENSE](./LICENSE)에 적힌 MIT License를 따르며, 포함된 이미지와 효과음에는 각각의 원래 라이선스가 적용됩니다.

## 개발 계획과 규칙 근거

- 게임 구현 계획 및 범위: [gostop-game.md](./gostop-game.md)
- 참고 프로젝트와 설계 결정: [BENCHMARK.md](./BENCHMARK.md)
- 게임 규칙의 주요 근거: [civilian7/gostop](https://github.com/civilian7/gostop)
- 카드 모델과 웹 게임 참고: [itsent-lab/hwatu](https://github.com/itsent-lab/hwatu)

브라우저에서 가족과 실제로 한 판을 진행하려면 서버와 UI 구현이 더 필요합니다. 현재 `npm start` 실행 스크립트는 서버 진입 파일이 아직 준비되지 않아 사용할 수 없습니다.
