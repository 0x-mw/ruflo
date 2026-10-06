# Ruflo 한글화·설치 설계 (2026-10-06)

포크 `0x-mw/ruflo`(원본 `ruvnet/ruflo` v3.53.0)를 한국어로 쓰기 위한 설계. 브랜치 `ko`.

## 목표

- 사람이 보는 화면을 한국어로 보여 준다. 대상은 CLI 도움말·주요 메시지, Claude Code 안의 명령·에이전트·스킬 설명, `/ruflo` 콘솔 등 모드 플러그인 화면, 마켓플레이스 목록, README·입문 가이드.
- Claude가 사용자에게 한국어로 답하게 한다.
- 원본 업데이트를 계속 따라갈 수 있게 원본 소스 변경을 최소로 한다.
- 한글판 CLI를 전역에 설치하고, 테스트 폴더에서 init과 모드 설치까지 확인한다.

## 범위

| 포함 | 제외(영어 유지) |
|---|---|
| CLI 도움말 전체: 명령·옵션·예시 설명 약 2,600개 | 주요 9개 명령 밖의 실행 메시지 |
| 주요 명령 9개(init·start·status·doctor·agent·swarm·memory·task·session)의 실행 메시지 | MCP 도구 설명 314개. Claude가 읽는 문구라서 |
| `v3/@claude-flow/cli/.claude/`의 에이전트 91·명령 167·스킬 37의 `description` | 에이전트·명령·스킬 본문(프롬프트) |
| init이 만드는 CLAUDE.md의 한국어 응답 지시 | `.claude/helpers/*`. Ed25519 서명 대상이며 상태줄 문구도 여기에 포함 |
| 모드 3종(ruflo-mods·ruflo-swarm·ruflo-console)의 화면 문구 | 저장소 루트 `.claude/`(원본 개발용 설정) |
| 마켓플레이스 46개 플러그인 설명과 각 플러그인의 명령·스킬·에이전트 설명 | USERGUIDE.md, `v3/docs`, 기타 문서, 셸 자동완성 |
| `README.ko.md`, `docs/ruflo-explained.ko.md` | |

## 결정과 이유

1. **번역 사전 덧씌우기.** 원본 소스 문자열은 그대로 두고, 출력 지점에서 영어 원문을 키로 한국어 사전을 찾는다. 사전에 없으면 영어로 둔다. 원본 병합 충돌이 적고 영어로 되돌리기 쉽다.
2. **언어 결정 규칙(CLI).** `RUFLO_LANG=ko|en`을 먼저 따른다. 없으면 stdout이 TTY일 때만 한국어로 한다. 파이프·훅·MCP·테스트는 영어 원문을 받으므로 출력 문자열에 기대는 원본 테스트와 헬퍼가 깨지지 않는다.
3. **에셋은 설명만 번역.** 본문(프롬프트)은 원작자가 다듬은 영어 그대로 둔다. 응답 언어는 CLAUDE.md 지시로 정한다. 토큰을 덜 쓰고 병합 충돌도 적다.
4. **헬퍼는 건드리지 않음.** `helpers.manifest.json`이 원작자 키로 서명되어 있다. 고치면 서명 키를 바꿔야 하는데, 그건 보안 통제를 바꾸는 일이다. 버전도 3.53.0으로 유지한다.
5. **모드는 포크 폴더에서 바로 불러옴.** `ruflo mods install --source local --marketplace-path <포크>`를 쓴다. 푸시 없이 한글판 플러그인이 반영된다. 푸시한 뒤에는 `claude plugin marketplace add 0x-mw/ruflo`로 바꿀 수 있다.

## 구조

### CLI (`v3/@claude-flow/cli`)

- `src/i18n/`: 언어 결정, 사전 적재(처음 쓸 때 한 번), 번역 함수 `tr()`.
- `i18n/ko/help.json`, `i18n/ko/messages.json`: 영어 원문을 키로 하는 사전. 패키지 `files`에 추가한다.
- 끼우는 곳:
  - (1) `src/index.ts`의 `showHelp`·`showCommandHelp`. 명령·옵션·예시·하위명령 설명을 그리기 직전에 정확 일치로 번역한다.
  - (2) `src/output.ts` 심. 공용 `output` 객체의 출력·서식 메서드가 받는 문자열 인자를 번역한다. `printJson`과 JSON처럼 생긴 문자열은 제외한다.
- 찾는 순서:
  1. 정확 일치.
  2. 앞뒤 공백과 기호(`✓ • ⚠ ✗ - *`)를 떼고 다시 찾은 뒤 뗀 것을 다시 붙인다.
  3. 템플릿 틀로 맞춘다. 예: `Failed to initialize: {0}` → `초기화 실패: {0}`. 정적 부분에 글자가 충분한 틀만 쓴다.
- 소문자 한 단어(식별자일 수 있는 것)는 사전에 넣지 않는다.
- 표 정렬: 한글은 터미널에서 두 칸을 차지한다. 그래서 `table/printTable`을 표시 폭 기준으로 다시 계산하도록 감싼다.
- `src/init/claudemd-generator.ts`: 생성되는 CLAUDE.md 맨 위에 `## 언어` 절을 넣는다.
- `src/init/mcp-generator.ts`: MCP 등록을 `npx -y ruflo@latest mcp start`에서 `ruflo mcp start`(전역 설치본)로 바꾼다. 이에 맞춰 관련 테스트도 고친다.
- `bin/ruflo.js` 추가, `package.json`의 `bin`에 `ruflo` 등록. 원래 `ruflo` 래퍼 패키지는 npm 원본 CLI를 끌어오므로 쓰지 않는다.

### 모드 플러그인 (`plugins/ruflo-{mods,swarm,console}`)

- 콘솔 문구는 `hooks/views/common.ts`의 `text·kv·rule·button` 등 공용 그리기 함수를 거친다. 여기에 같은 방식의 번역기를 끼운다. 도움말 주제, 팔레트·데이터 정의의 라벨도 사전에 넣는다.
- 플러그인 언어는 `RUFLO_LANG`을 따르고, 없으면 한국어로 한다. 사람에게만 보이는 화면이기 때문이다. 플러그인 테스트는 `RUFLO_LANG=en`으로 돌린다.
- ruflo-mods·ruflo-swarm의 토스트·상태 문구에도 같은 번역기를 쓴다.

### 마켓플레이스·에셋 설명

- `.claude-plugin/marketplace.json`, 각 `plugins/*/.claude-plugin/plugin.json`의 `description`을 번역한다.
- `plugins/*/{commands,skills,agents}` 머리말과 `v3/@claude-flow/cli/.claude/{agents,commands,skills}` 머리말의 `description` 값만 바꾼다. 머리말이 없는 명령 파일에는 `description:`을 넣는다. 끝나면 전 파일 YAML 파싱 검사를 한다.

### 사전 파이프라인 (`scripts/i18n/`)

- `extract.mjs`: TypeScript 구문 분석으로 원문을 뽑는다. 대상은 명령 정의의 설명들, 주요 9개 명령과 모드 플러그인의 출력 문자열·템플릿이다. 기존 번역과 합쳐 미번역 목록을 만든다.
- `check.mjs`: 누락, `{n}` 자리 불일치, 번역문 안의 깨진 식별자, YAML 파싱을 검사한다.
- 용어집 `i18n/ko/glossary.md`:
  - 제품·기술명은 그대로 둔다: Ruflo, RuVector, AgentDB, MCP, HNSW, SONA, Claude Code.
  - agent=에이전트, swarm=스웜, hook=훅, memory=메모리, daemon=데몬, task=작업.
  - 말투: 도움말 설명은 "~합니다", 짧은 제목은 명사형, 실행 메시지는 "~했습니다".

## 빌드·설치

1. 작업본은 `/mnt/c/Users/CEO/.0x-mw/ruflo`(브랜치 `ko`)에 둔다. 빌드는 ext4 쪽 `~/.cache/ruflo-ko-build`로 복사해서 한다. `/mnt/c` 쓰기 속도와 C: 여유 공간(34GB) 때문이다.
2. 원본 배포 절차를 따른다: `corepack pnpm@8.15.0 install` → `pnpm build` → `stage-internal-runtime-bundles.mjs --target v3/@claude-flow/cli` → 카탈로그 매니페스트 생성 → `verify-helpers.mjs` → `npm pack ./v3/@claude-flow/cli`.
3. `npm install -g <tgz>`로 설치한다. 명령은 `ruflo`, `claude-flow`, `claude-flow-mcp`.
4. `scripts/i18n/install-ko.sh` 하나로 1~3을 다시 돌릴 수 있게 한다.
5. `/mnt/c/Users/CEO/.0x-mw/ruflo-playground`에서 다음을 실행한다.
   - `ruflo init --no-global --no-skills-sh --no-codex-detect --no-signup --no-mods`
   - `ruflo mods install --scope project --source local --marketplace-path /mnt/c/Users/CEO/.0x-mw/ruflo`

## 검증

1. pnpm 빌드가 성공하고, init·mcp-generator·도움말 관련 vitest와 모드 플러그인 테스트가 통과한다.
2. `check.mjs`에서 누락 0, 자리 불일치 0, YAML 오류 0.
3. TTY에서 `ruflo --help`가 한국어, `ruflo --help | cat`이 영어, `RUFLO_LANG=ko`로 강제하면 한국어로 나온다.
4. playground:
   - `.claude/` 설명이 한국어다.
   - CLAUDE.md에 언어 절이 있다.
   - `.mcp.json`이 `ruflo mcp start`를 쓴다.
   - `claude mcp list`에서 claude-flow가 연결됨으로 나온다.
   - `ruflo mods doctor`가 통과한다.
5. tmux 창에서 playground의 Claude Code를 열어 `/ruflo` 콘솔이 한국어로 그려지는지 화면 캡처로 확인하고, `claude -p`로 한국어 응답을 확인한다.

## git·원본 동기화

- `upstream` = `https://github.com/ruvnet/ruflo.git`(push 막아 둠). 단계별로 `ko`에 커밋한다. `origin` 푸시는 사용자 확인 후에 한다.
- 원본 업데이트 절차: `git fetch upstream` → `git merge upstream/main` → `extract.mjs`로 새 문구만 번역 → `check.mjs` → `install-ko.sh`.

## 위험과 대응

| 위험 | 대응 |
|---|---|
| 동적 문장이 사전에 안 맞아 영어로 남음 | 영어로 두는 것이 정상 동작이다. extract가 적용률을 보고하므로 빈 곳을 채운다 |
| 한글 폭 때문에 표·박스가 어긋남 | CLI 표는 표시 폭 기준으로 다시 그린다. 콘솔은 Claude Code 렌더러가 그리므로 화면 캡처로 확인한다 |
| 포크 폴더 마켓플레이스는 작업 트리를 실시간으로 읽음 | 브랜치를 바꾸면 플러그인도 바뀐다. 푸시한 뒤에는 GitHub 포크 소스로 바꿀 수 있다 |
| 원본이 같은 설명 줄을 바꾸면 병합 충돌 | 설명 줄만 다시 번역한다 |
