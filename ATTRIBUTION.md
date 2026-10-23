# 자산 출처 및 라이선스 (ATTRIBUTION)

이 프로젝트는 아래 자산을 사용합니다. 각 자산은 원래 라이선스를 유지하며,
이 저장소의 라이선스로 재license 되지 않습니다.

---

## 1. 화투 카드 SVG (48장 + 뒷장)

- **출처**: **자체 제작** (직접 그린 일러스트)
- **저작자**: 프로젝트 소유자 (donian)
- **라이선스**: 자체 제작물 — 출처 표기 불필요, 자유 사용
- **사용 위치**: `assets/hwatu/svg/` (48장 + 뒷장·보너스)
- **파일 규격**:
  - `january_hikari.svg` … `december_tanzaku.svg` — 정규 카드 48장 (월별 파일명 체계)
  - `back_red.svg` 등 — 뒷장
  - `bonus_*.svg` — 보너스패 4장
- **변경 이력**: 2026-10-23 Wikimedia Commons 출처의 CC BY-SA 4.0 이미지를
  자체 제작 일러스트로 전량 교체. 더 이상 CC BY-SA 4.0 저작자 표기가 필요하지 않다.

> ※ 이미지 파일명과 실제 화투 구성이 다를 수 있습니다.
> 규칙 데이터는 `engine/cards.js` 의 정의(11월=오동, 12월=비)를 따릅니다.

---

## 2. 게임 효과음

### 2-1. `assets/audio/*.ogg` — Kenney Casino / Impact / Interface Sounds (CC0)

- **출처**: [Kenney](https://kenney.nl) — Casino Audio / Impact Sounds / Interface Sounds
- **라이선스**: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — 출처 표기 불필요
- **사용 위치**: `assets/audio/`

### 2-2. `assets/audio/*.wav` — itsent-lab/hwatu 판독용 효과음 (CC0)

- **출처**: [itsent-lab/hwatu](https://github.com/itsent-lab/hwatu) `apps/web/public/audio/effects/`
- **원저작자**: Kenney Vleugels (Kenney.nl) — Casino Audio 1.1 / Impact Sounds 1.0 / Interface Sounds 1.0
- **라이선스**: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- **변경사항**: OGG Vorbis → 44.1 kHz PCM-16 WAV 로 디코딩(브라우저 호환), 파일명만 의미적 이름으로 변경
- **고스톱 대응표**:

  | 파일 | 용도 | 원본 |
  |---|---|---|
  | `deal.wav` | 딜 | card-fan-1.ogg |
  | `ppeok.wav` | 뻑 | impactWood_heavy_001.ogg |
  | `double-ppeok.wav` | 연뻑 | impactWood_heavy_003.ogg |
  | `triple-ppeok.wav` | 쓰리뻑 | impactPunch_heavy_004.ogg |
  | `bomb.wav` | 폭탄 | impactPunch_heavy_000.ogg |
  | `jjok.wav` | 쪽 | impactPlate_light_002.ogg |
  | `sweep.wav` | 싹쓸이 | card-fan-2.ogg |
  | `ttadak.wav` | 따닥 | card-shuffle.ogg |
  | `pee-transfer-two/three.wav` | 피 옮기기 | chips-handle-3/6.ogg |
  | `ppeok-capture.wav` | 피 뺏기 | impactMetal_medium_003.ogg |
  | `self-ppeok.wav` | 자뻑 | impactBell_heavy_001.ogg |
  | `chongtong.wav` | 총통 | impactBell_heavy_004.ogg |
  | `shake.wav` | 흔들기 | dice-shake-2.ogg |
  | `bonus-two/three.wav` | 보너스피 | chips-stack-2/6.ogg |
  | `go.wav` / `go-high.wav` | 고 / 5고 이상 | confirmation_001 / maximize_006.ogg |
  | `stop.wav` | 스톱 | close_004.ogg |
  | `win.wav` / `lose.wav` | 승 / 패 | maximize_005 / minimize_005.ogg |
  | `nagari.wav` | 나가리 | question_004.ogg |
  | `score.wav` / `mission.wav` | 점수 / 미션 | confirmation_004 / confirmation_002.ogg |
  | `decision.wav` / `select.wav` / `cancel.wav` | 선택 UI | question_001 / select_006 / back_002.ogg |
  | `undo.wav` | 무르기 | back_004.ogg |
  | `gookjin-double.wav` / `gookjin-animal.wav` | 국진 전환 | switch_005 / switch_002.ogg |
  | `dealer-human.wav` / `dealer-opponent.wav` | 선 결정 | confirmation_003 / minimize_003.ogg |
  | `autoplay-on.wav` / `autoplay-off.wav` | 자동 진행 | toggle_001 / toggle_004.ogg |
  | `money-win.wav` / `money-lose.wav` | 정산 | chips-collide-4 / error_007.ogg |
  | `start.wav` | 시작 | open_004.ogg |

---

## 3. 카드 연출(애니메이션) 참고 소스

- **출처**: [bipark/gostop-ts](https://github.com/bipark/gostop-ts) (루미 고스톱 TypeScript 버전)
  - `web/main.ts` — FLIP 기법(카드가 제자리로 미끄러지는 이동 연출), 카드 DOM 구성
  - `web/style.css` — 카드 등장 키프레임(`cardEnter`)
- **직접 만든 부분**: 패 섞는 연출(`.shuffle-overlay` · `.shuffle-card`)은 아이디어만 참고하고
  이 프로젝트에서 다시 설계했다 — 실제 덱 장수(48/50/51)만큼 촘촘히 모으고, 여러 번 짧게 뒤섞은 뒤
  가운데로 모이는 연출. 앞의 FLIP·카드 등장 기법만 참고 코드다.
- **라이선스**: [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
- **필수 고지 (Required Notice)**: Copyright (c) 2024-2026 fullbit computing (https://github.com/civilian7)
- **변경사항**: TypeScript → ES5 바닐라 JS 로 옮기고, 이 프로젝트의 카드 DOM 구조(`#hand` · `#table` · `#promptBox`)와
  서버 권한(폴링) 구조에 맞게 조정했다. 상대가 낸 패·먹은 패 연출은 이 저장소 엔진 이벤트를 확장해 구현했다.
- **이용 범위**: 이 프로젝트는 가족끼리 함께 즐기는 **비상업적** 용도다.
  PolyForm Noncommercial 라이선스는 상업적 이용을 허용하지 않으므로, 상업적으로 쓰려면 별도 허가를 받아야 한다.

---

## 4. 이 프로젝트 자체 코드

- MIT License (아래 LICENSE 참고)
- 엔진·규칙 구현은 `civilian7/gostop` 의 `docs/game-rules.md` 와
  `itsent-lab/hwatu` 의 `apps/web/src/engine/rules/*` 를 참고해 재구현했다.

---

## 5. 아직 포함하지 않은 자산 (필요 시 추가)

| 자산 | 출처 | 라이선스 | 조건 |
|---|---|---|---|
| 국악 BGM | 공유마당 (한국저작권위원회) | CC BY 4.0 | 출처 표기 필수 |
| 캐릭터 음성 99종 | Supertonic 3 | BigScience OpenRAIL-M | **AI 생성물임을 명시**해야 함 |

둘 다 `itsent-lab/hwatu` 에서 가져올 수 있습니다. 가족끼리 쓰는 앱에서는
배경음악 없이 효과음만으로도 충분하다고 판단해 아직 넣지 않았습니다.
