# 벤치마킹 보고서

비교 대상 3곳의 검토 결과와, 무엇을 가져왔는지 정리한다.

| 저장소 | 성격 | 라이선스 | 역할 |
|---|---|---|---|
| [civilian7/gostop](https://github.com/civilian7/gostop) | Delphi 데스크톱 고스톱 | 자체 + CC BY-SA 4.0 | **규칙 정본·엔진 근거** |
| [itsent-lab/hwatu](https://github.com/itsent-lab/hwatu) | TypeScript 모노레포(웹+맥OS), "가족만을 위한 맞고, 고스톱" | MIT (+ 자산별 개별) | **카드 모델·이펙트·아키텍처·자산** |
| (내 기존) `../장기게임` | 바닐라 JS Canvas 게임 | 자체 | 코드 스타일·테스트 관례 |

---

## 1. 규칙 — civilian7/gostop 를 정본으로

`docs/game-rules.md` 전량(§1~§7, §9, §10)을 구현 기준으로 삼았다.
Delphi 엔진 소스(`Gostop.Engine.Play/Score/Deal/Deck.pas`)를 직접 읽고
점수·박·정산 공식을 그대로 옮겼다.

### 가져온 것
- **족보 점수**: 3광(비광 포함 2 / 미포함 3) · 4광 4 · 5광 15 · 고도리 5 ·
  열꽃 5장부터 1+ · 띠 5장부터 1+ · 홍단/청단/초단 각 3 · 피값 10부터 1+
- **국진 자동 전환**: 열꽃/쌍피 중 유리한 쪽 자동 선택 (승자관점) /
  **패자 관점은 피박 회피를 우선**으로 해석 — 이 비대칭까지 동일하게 구현
- **박 4종**: 피박 · 광박 · 멍박(열꽃박) · 고박(독박)
- **특수상황**: 뻑 · 첫뻑 · 연뻑 · 자뻑 · 뻑 회수 · 쪽 · 따닥 · 싹쓸이 ·
  흔들기 · 폭탄 · 총통 · 쓰리뻑 · 마지막 장 예외 · 피 뺏기 우선순위
- **고/스톱**: 고 보너스 +1/회, 3고부터 ×2, 역고 ×4 대체, 나가리 판돈 이월
- **정산**: (족보점수 + 고보너스) × 배수, 배수 = 고 × 흔들기 × 박

### 버린 것
- **쇼당**(3인 전용 협상) · **4인 광팔기** → v2 (가족 3인용에 비해 버그 여지가 큼)
- **Delphi UI/AI** → 우리 서버 권위 엔진으로 재설계

### 검증
`tests/engine_test.js` 44 케이스 — 전부 정본 소스에서 직접 도출한 기대값.
`tests/contract_test.js` 10 케이스 — itsent-lab 규약과의 교차 검증.

---

## 2. 카드 모델 — itsent-lab/hwatu 를 따르다

itsent-lab 의 `apps/web/src/engine/cards.ts` 가 훨씬 정돈되어 있어 **카드 ID·태그 체계를
그대로 따랐다.** 이 결정으로 세 가지가 함께 해결됐다.

### 2-1. `imageKey` 규약 (`m01-01`)
```
m{월 2자리}-{월 안에서 1~4번째}
m01-01 1월 광 / m01-02 1월 띠 / m01-03·04 1월 피
m11-01 11월 광 / m11-02 11월 쌍피 / m11-03·04 11월 피
m12-01 12월 비광 / m12-02 열꽃 / m12-03 비띠 / m12-04 비쌍피
```
Wikimedia 원본 파일명이 이 규약과 정확히 대응한다(`HwatuAssetMap.json`).
→ **화투 이미지 ↔ 규칙 데이터의 어긋남이 구조적으로 사라진다.**

### 2-2. 11월 쌍피 위치 정정
| | 쌍피 위치 | 근거 |
|---|---|---|
| civilian7 | `november_kasu_3` | Delphi 카탈로그 기준 |
| **itsent-lab** | **`m11-02` (가운데 자리)** | 화투 관례상 쌍피는 가운데 |

itsent-lab 쪽이 실제 화투 배치와 맞으므로 **쌍피를 `m11-02` 로 바꿔 적용**했다.
(11월 쌍피가 `november_kasu_3` → `november_kasu_2` 로 변경)

### 2-3. 태그 기반 족보 판정
`bright` `animal` `ribbon` `junk` `double-junk` `triple-junk` `godori`
`hongdan` `cheongdan` `chodan` `gookjin` `rain-bright` `rain-ribbon` `bonus-pee`
→ 족보 판정이 "월 하드코딩"에서 "태그 조회"로 바뀌어 설정으로 다르게 만들 수 있다.

---

## 3. 점수 라인 — 정산 화면을 위해

itsent-lab 의 `ScoreLine[]` 구조를 도입했다. 엔진이 점수만 돌려주면 UI가
족보를 재현해야 하는데, **엔진이 라벨·설명까지 내려주도록** 바꿨다.

```js
{ code: 'bright', label: '비삼광', points: 2, description: '비광이 포함된 3광' }
{ code: 'godori', label: '고도리', points: 5, description: '2월·4월·8월의 새 패 완성' }
{ code: 'junk',    label: '피',    points: 3, description: '보너스피·쌍피를 포함해 피 12장' }
```
`code` 는 안정적인 식별자(애니메이션·점수 변화 감지용), `label`/`description` 은 표시용.

---

## 4. 정산 — 단계별 배수 내역 + 지급면제

itsent-lab 의 `calculateSettlement` 을 참고해 두 가지를 추가했다.

### 4-1. 배수 계산 과정 공개
```js
steps: [
  { label: '기본 점수',     formula: '3점',        value: 3 },
  { label: '고 보너스',    formula: '3 + 1',      value: 4 },
  { label: '고 배수',      formula: '4 × 2',      value: 8 },
  { label: '흔들기·폭탄',  formula: '8 × 2',      value: 16 },
  { label: '박 배수',      formula: '16 × 2',     value: 32 },
]
```
정산 화면에서 "왜 이 금액인지"를 한 줄씩 보여줄 수 있다.

### 4-2. 지급면제(paymentExempt)
> 패자가 **한 장도 획득하지 못하면** 점수는 유지하고 **지급만 면제**한다.

civillian7 에는 없는 규칙이다. 가족끼리 치다 보면 "한 장도 못 먹은 사람이 억울하게
돈을 잃는" 상황이 생기고, 실제로 house rule 로 자주 쓰인다. 적용했다.

### 4-3. 가상 화폐 명시
itsent-lab 처럼 정산 결과에 `isRealCurrency: false` 를 명시하고,
"가상 포인트" 라는 명칭을 유지한다(국내법상 안전).

---

## 5. 이펙트·애니메이션 — itsent-lab 를 벤치마킹

### 5-1. 상태-diff → 이펙트 (핵심 패턴)
itsent-lab 의 `getGostopTransitionEffect(previous, current)` 를 그대로 따랐다.

> **이전 상태와 현재 상태를 비교해서 "무엇이 일어났는지"를 순수 함수로 뽑아낸다.**

이 패턴이解决了 문제:
- 스냅샷을 다시 그릴 때 애니메이션이 중복 실행되지 않는다
- 어떤 화면에서 열었든 같은 이펙트가 나온다
- 이펙트 우선순위를 한곳에서 관리할 수 있다

이펙트 종류와 우선순위:
```
settlement > stop > shake > go(고) > bomb > ttadak > jjok > sweep > self-ppeok
> ppeok-capture > ppeok > bonus-pee > score > capture
```
각 이펙트는 `{ kind, text, detail, duration, player }` — 길이는 620ms(잡기) ~
1800ms(5고·정산)로 계층화.

### 5-2. 카드 비행 애니메이션 (Web Animations API)
itsent-lab 의 `apps/web/src/lib/effects.ts` 를 참고. **복제 → 포물선 비행 → 착지 플래시** 3단:

```js
// 1) 손패에서 바닥으로 복제본이 포물선을 그리며 날아간다
clone.animate([
  { transform: 'translate3d(0,0,0) rotate(0deg) scale(1)' },
  { transform: `translate3d(${dx*.55}px,${dy*.35-34}px,0) rotate(-5deg) scale(1.08)`, offset: .55 },
  { transform: `translate3d(${dx}px,${dy}px,0) rotate(2.5deg) scale(.96)' },
], { duration: 280, easing: 'cubic-bezier(.2,.75,.18,1)', fill: 'forwards' });

// 2) 도착 지점이 살짝 커졌다가 밝아진다
target.animate([
  { transform: 'scale(1)', filter: 'brightness(1)' },
  { transform: 'scale(1.025)', filter: 'brightness(1.2)', offset: .34 },
  { transform: 'scale(1)', filter: 'brightness(1)' },
], { duration: 170, easing: 'ease-out' });
```
핵심: **CSS 키프레임이 아니라 `element.animate()`** — JS에서 제어하므로
"어느 카드가 어디서 어디로 갔는지"를 정확히 추적할 수 있다.

### 5-3. 효과음 — 의미적 이름 + 이벤트 매핑
itsent-lab 의 효과음 세트를 그대로 사용한다(CC0). 이름이 곧 이벤트라 매핑이 명확하다.
`ppok`/`jjok`/`sweep`/`bomb`/`chongtong` 등 37종.

### 5-4. 아직 안 가져온 것
- **BGM**(국악, CC BY 4.0) · **캐릭터 음성 99종**(AI 생성, OpenRAIL-M)
  → 라이선스 조건(출처 표기 / AI 생성물 명시)이 있어, 가족용 앱에서는
  효과음만으로 충분하다고 판단해 **의도적으로 제외**. 필요하면 나중에 추가.

---

## 6. 아키텍처 — 폴링 기반 동기화

itsent-lab 의 `services/api/Program.cs` 를 보면 **SignalR/WebSocket 이 없다.**
REST 엔드포인트만 있고, 클라이언트가 주기적으로 상태를 가져간다.

| | SSE(내 초기 설계) | 폴링(itsent-lab) |
|---|---|---|
| 구현 난이도 | 중간 (SSE + POST) | 낮음 (GET + POST) |
| 재접속 | 자동 | 자동 |
| 지연 | 즉시 | 폴링 간격만큼 |
| 서버 부담 | 연결 유지 | 짧은 요청 반복 |

**가족 3명이 집에서 치는 규모**에서는 지연 1~2초가 전혀 체감되지 않고,
구현·운영 난이도가 훨씬 낮다. → **폴링으로 전환**한다.
(1~2초 간격, 서버는 상태 스냅샷을 그대로 내려주되 사람별로 필터링)

---

## 7. 공유 규칙 벡터 (계약)

itsent-lab 의 `shared/contracts/game-rule-vectors-v1.json` — **교차 플랫폼 규칙 계약**.
`{ operation, input, expected }` 형태의 테스트 벡터를 JSON으로 관리한다.

우리도 같은 형식을 도입한다. 앞으로 규칙을 바꾸면 벡터를 갱신하고,
다른 구현(예: 나중에 만들 맥OS 앱)도 같은 벡터로 검증할 수 있다.
현재 `tests/contract_test.js` 가 이 형식을 따르고 있다.

---

## 8. 테스트 전략 비교

| | itsent-lab | ours |
|---|---|---|
| 단위 테스트 | vitest, 파일별 | `node:test`, 파일별 |
| 규칙 벡터 | JSON 계약 파일 | `tests/contract_test.js` (형식만 차용) |
| 크로스 플랫폼 | 웹 ↔ Swift 회귀 테스트 | (v2) |
| 회귀 방지 | 스냅샷 | `tests/snapshots/` (예정) |

`node:test` 를 쓴 이유는 **의존성 0** 유지(AGENTS 규칙)와 `node tests/*.js` 한 줄 실행.

---

## 9. 규칙 충돌 항목 (사용자 결정 필요)

두 참조가 다르게 말하는 부분이 몇 군데 있다. 현재는 **itsent-lab(사용자 본인 프로젝트)
기준**으로 잡았으니, 다르게 정하고 싶으면 바꾸면 된다.

| 항목 | civilian7 | itsent-lab | 현재 적용 |
|---|---|---|---|
| 딜 순서 | 바닥3→손4→바닥3→손3 (선 다음 자리부터, 선이 마지막) | 손7→손7→손7→바닥6 (순서 고정) | civilian7 |
| 선 결정 | 밤일낮장(낮=큰 월, 밤=작은 월) | 별도 `dealerSelection.ts` | 밤일낮장 |
| 피박 기준 | 2인 ≤7, 3인 이상 ≤5 | ≤7 고정 | 2인 ≤7, 3인 ≤5 |
| 광박 | 패자의 광 0장 | 5광이면 무조건, 또는 패자의 광 0장 | 패자의 광 0장 |
| 멍박 | 승자 열꽃 7+ **그리고** 패자 열꽃 0 | 승자 열꽃 7+ 만 | 패자 열꽃 0도 요구 |
| 폭탄 | 손패 3장 + 바닥 같은 월 | 3장+바닥1 / 2장+바닥2 / 4장+바닥0 | 3장+바닥1 |
| 총통 | 즉시 승리(고정 점수) | 바닥 4장은 **나가리**, 손패 4장은 선택 | 즉시 승리 |
| 지급면제 | 없음 | 패자 0획득 시 면제 | **있음** |
| 역고 | 있음 | 없음 | 있음 |

---

## 10. 가져오지 않은 것 (이유)

| 항목 | 이유 |
|---|---|
| itsent-lab 의 ASP.NET 백엔드 | 우리는 **의존성 0 Node 서버**로 간다. DB·인증·JWT 는 가족용에 과하다 |
| SQLite + 마이그레이션 | 방마다 인메모리면 충분. 재시작하면 방은 사라져도 된다 |
| 계정/로그인/프로필 | 가족 3명은 이름 입력만으로 충분 |
| React + Vite | 바닐라 JS 로 충분 (기존 장기게임 프로젝트와 동일) |
| AI 상대 | 3명이 함께 치는 게 목적이므로 불필요 |
| 캐릭터/아바타 | 가족용에 과함 |
