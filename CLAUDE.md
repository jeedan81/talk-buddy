# Talk Buddy – 프로젝트 안내 (Claude Code용)

이 파일은 다른 컴퓨터에서 이 프로젝트를 열었을 때 바로 이어서 작업할 수 있도록 쓴 안내입니다.
사람이 읽어도 되고, Claude Code는 폴더를 열면 자동으로 읽습니다. 자세한 작업 이력은 `docs/대화기록.md`를 보세요.

## 한 줄 요약

상황별 영어·일본어 회화 롤플레이 웹앱(PWA). 초등·중등·고등·일반 4단계, 상황 174개, 미니게임 7종.
빌드 도구 없이 **순수 HTML/CSS/JS** 로 만들어졌고, GitHub Pages로 배포됩니다.

- 배포 주소: https://jeedan81.github.io/talk-buddy/
- 저장소: https://github.com/jeedan81/talk-buddy (main 브랜치 루트가 그대로 Pages로 서빙됨)
- 배포 방법: `git push` 하면 1~2분 뒤 반영. 별도 빌드 없음.

## 기술 스택과 제약

- 프레임워크/번들러 없음. `index.html`이 `<script>` 태그로 js 파일을 순서대로 읽음 (ES 모듈 아님, 전역 변수 사용).
  로드 순서: scenarios.js → scenarios_ja.js → scenarios_middle/high/adult.js → storage.js → api.js → vocab.js → games.js → app.js
- 데이터 저장: 모두 브라우저 `localStorage` (키: `talkbuddy.settings`, `talkbuddy.history`, `talkbuddy.current`, `talkbuddy.progress`).
  서버 없음. 기기 간 동기화 없음(설정 → 내보내기/가져오기 JSON으로 수동 이동).
- AI: OpenAI Chat Completions를 브라우저에서 직접 호출 (`js/api.js`). 사용자가 설정 화면에 API 키를 입력하면 localStorage에 저장.
  키가 없으면 **데모 모드**(고정 대사)로 동작하므로 키 없이도 UI 테스트 가능.
- 음성: Web Speech API (TTS `speechSynthesis`, STT `webkitSpeechRecognition`). https 또는 localhost에서만 마이크 동작.
- PWA: `manifest.webmanifest` + `sw.js`. **파일을 고치면 `sw.js`의 `CACHE` 버전을 올려야** 기존 설치 기기에 빠르게 반영됨 (현재 v5).

## 파일 지도

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 뼈대, 하단 내비(홈/상황/게임/기록/설정), 서비스워커 등록 |
| `css/style.css` | 전체 스타일. 섹션 주석으로 구분(홈, 채팅, 게임, 마스코트 등) |
| `js/scenarios.js` | 초등 상황 84개 + 카테고리 12개, `LANGS`, `STAGES`, `localize()`, `registerStagePack()` |
| `js/scenarios_ja.js` | 초등 상황의 일본어 버전 (`SCENARIOS_JA[id] = {title, ai, phrases, opener}`) |
| `js/scenarios_middle.js` / `_high.js` / `_adult.js` | 단계별 팩: 카테고리 10개 + 상황 30개, 각 상황 안에 `ja:{...}` 포함 |
| `js/storage.js` | localStorage 래퍼 (설정, 세션 기록, 게임 진행도, 내보내기/가져오기) |
| `js/api.js` | OpenAI 호출, 단계·언어별 시스템 프롬프트, 태그 파싱(`[[MISSION:n]]`, `[[TIP: ...]]`), 번역/추천/리포트, 데모 모드 |
| `js/vocab.js` | 게임용 단어장 `VOCAB[stage][lang]`(각 25개), 문법 문제 `GRAMMAR[stage][lang]`(각 10개) |
| `js/games.js` | 미니게임 7종(단어 카드, 단어 퀴즈, 빈칸, 문장 조립, 짝 맞추기, 받아쓰기, 문법), XP/레벨/배지 |
| `js/app.js` | 화면 렌더링과 상태. 홈/상황/채팅/리포트/기록/설정, 마스코트 SVG, 언어·단계 선택 시트 |
| `icons/` | PWA 아이콘 (Python PIL로 생성, 원본 스크립트는 없음. 다시 만들려면 아무 1024px 주황 말풍선 PNG면 됨) |
| `README.md` | 사용자용 설명서 (설치, 휴대폰 사용, 기능표) |
| `docs/대화기록.md` | 개발 이력과 결정 사항 |

## 데이터 모델 핵심

- 상황(scenario): `{ id, cat, emoji, title(한글), en(영문 제목), level 1~3, place, ai(역할), user(학생 역할), situation, missions[3], phrases[[외국어, 한국어] x4], opener, stage }`
- 일본어 버전은 `localize(scenario, 'ja')`가 `SCENARIOS_JA[id]`에서 가져와 `{subtitle, ai, phrases, opener}`로 반환. phrases의 한국어 뜻은 영어 버전과 같은 순서를 재사용.
- 세션(대화 1회): `{ id, scenarioId, lang, stage, startedAt, endedAt, messages[{role:'ai'|'user', text, at, ko?, tip?}], missionsDone[], report, demo }`
- 게임 진행도: `{ xp, known: {'en:apple': ts}, games: [{id, lang, stage, score, total, xp, at}] }`

## 꼭 지켜야 할 규칙

1. **일본어 초등 데이터는 한자 금지**, 히라가나·가타카나 + 띄어쓰기(わかちがき). 중등부터 한자 허용. AI 프롬프트도 같은 규칙(`api.js`의 `STAGE_RULES`).
2. 새 상황을 추가할 때 `id`는 전체에서 유일해야 하고(중등 `m-`, 고등 `h-`, 일반 `a-` 접두사), `cat`은 같은 단계의 카테고리 id여야 함. phrases 4개, missions 3개 유지(게임이 이 개수를 가정).
3. `VOCAB`의 예문 `ex`에는 단어 `w`가 **그대로 포함**되어야 함(빈칸 채우기 게임이 `ex.replace(w, '___')`).
4. 파일을 바꾸면 `sw.js`의 `CACHE` 버전을 하나 올리고, 새 js 파일을 추가하면 `SHELL` 목록과 `index.html`에 모두 등록.
5. 커밋 후 `git push`만 하면 배포됨. 배포 직후 1~2분은 새 파일이 404일 수 있음(CDN). 이미 열어 둔 브라우저는 최대 10분간 옛 화면.

## 로컬에서 실행·테스트

```bash
python -m http.server 8766 --directory "E:\프로그램 제작\회화" --bind 127.0.0.1
```
(폴더 경로는 그 컴퓨터에 맞게 바꾸기.) 브라우저에서 `http://127.0.0.1:8766/` 또는 `http://localhost:8766/`.
`index.html`을 더블클릭해 `file://`로 열어도 동작하지만 마이크·서비스워커는 안 됨.

데이터 무결성 검사(브라우저 콘솔에서):
```js
SCENARIOS.length;                                   // 174
SCENARIOS.filter(s => !SCENARIOS_JA[s.id]).length;  // 0 이어야 함
SCENARIOS.filter(s => s.stage==='elem' && /[\u4e00-\u9faf]/.test(JSON.stringify(SCENARIOS_JA[s.id]))).length; // 0
```

## 아직 안 한 것 / 아이디어

- 실제 OpenAI 응답 품질 검증(특히 일본어 초등 가나 전용 규칙, 일반 단계 경어)은 API 키를 넣고 확인 필요.
- 상황·단어·문법 데이터는 AI가 작성한 것이라 원어민 검수 전.
- 기기 간 동기화(서버/클라우드)는 없음. 필요하면 Firebase 같은 백엔드 추가.
- 받아쓰기·문장 조립의 일본어(중등 이상) 조각 나누기는 글자 수 기반이라 어색할 수 있음. 형태소 분석기(kuromoji 등) 도입 가능.
- 발음 평가, 음성 대화(STT 자동 전송), 학부모 리포트 공유 등은 미구현.

## 이 저장소를 만든 환경 메모

- 2026-10-25, Windows 11, Claude Code(desktop)에서 작성. git/gh는 winget으로 설치했고 GitHub 계정 jeedan81로 Pages 배포.
- 커밋 메시지는 한국어, 본문 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` 줄을 붙임.
