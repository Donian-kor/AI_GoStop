# 자산 출처 및 라이선스 (ATTRIBUTION)

이 프로젝트는 아래 자산을 사용합니다. 각 자산은 원래 라이선스를 유지하며,
이 저장소의 라이선스로 재license 되지 않습니다.

---

## 1. 화투 카드 SVG (48장 + 뒷장)

- **출처**: Wikimedia Commons — [Category:SVG Hwatu](https://commons.wikimedia.org/wiki/Category:SVG_Hwatu)
- **저작자**: Spenĉjo (개별 SVG) / 한국 화투 마스터 디자인 Marcus Richert
- **라이선스**: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- **사용 위치**: `assets/hwatu/svg/`
- **파일 규격**:
  - `m01-01.svg` … `m12-04.svg` — 정규 카드 48장 (itsent-lab/hwatu 의 `hwatuAssetMap.json` 매핑 기준, Wikimedia 원본 SHA-1 검증됨)
  - `january_hikari.svg` 등 — civilian7/gostop 의 파일명 체계 48장 + 뒷장 5장
  - `bonus_*.svg` — 보너스패 4장 (itsent-lab 자체 제작, 자유 사용)
- **필수**: CC BY-SA 4.0 이므로 **저작자 표기**와 **동일 조건 공유**가 필요합니다.
  이 파일(`ATTRIBUTION.md`)이 그 표기 역할을 합니다.

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

## 3. 이 프로젝트 자체 코드

- MIT License (아래 LICENSE 참고)
- 엔진·규칙 구현은 `civilian7/gostop` 의 `docs/game-rules.md` 와
  `itsent-lab/hwatu` 의 `apps/web/src/engine/rules/*` 를 참고해 재구현했다.

---

## 4. 아직 포함하지 않은 자산 (필요 시 추가)

| 자산 | 출처 | 라이선스 | 조건 |
|---|---|---|---|
| 국악 BGM | 공유마당 (한국저작권위원회) | CC BY 4.0 | 출처 표기 필수 |
| 캐릭터 음성 99종 | Supertonic 3 | BigScience OpenRAIL-M | **AI 생성물임을 명시**해야 함 |

둘 다 `itsent-lab/hwatu` 에서 가져올 수 있습니다. 가족끼리 쓰는 앱에서는
배경음악 없이 효과음만으로도 충분하다고 판단해 아직 넣지 않았습니다.
