# ruflo 한국어 현지화 용어집

## 1) 원칙

1. 한 영어 용어에는 한 한국어 표기만 쓴다. 문맥에 맞춘 미묘한 변형보다 일관성을 우선한다.
2. 제품명, 기술명, 식별자는 번역하지 않는다. 목록은 3절에 있다.
3. 한국 개발자가 실제로 쓰는 표기를 고른다. 외래어는 음차하고, 정착한 한자어는 한자어를 쓴다.
4. 확정 표기는 다음과 같다.
   - agent=에이전트
   - swarm=스웜
   - hook=훅
   - memory=메모리
   - daemon=데몬
   - task=작업
5. 사용자에게 보이는 문자열만 번역한다. 모델에게 전달되는 프롬프트, 훅 주입 문구, MCP 도구 설명, 검증용 오류 토큰은 영어로 둔다. 번역하려면 별도로 결정한다. 영문 유지 대상의 예는 다음과 같다.
   - `ruflo.segment: id must be 1-32 of [A-Za-z0-9_-]` 같은 검증 오류 토큰
   - `For coding work use topology hierarchical, maxAgents 6-8, strategy specialized.`
   - `Call before complex multi-file work...` 같은 MCP 도구 옵션 설명
6. 한 용어에 후보가 둘 이상이면 이 용어표의 선택을 따른다. 대안은 비고에만 적고 본문에는 쓰지 않는다. 다른 인벤토리(문서, 콘솔, CLI, 에이전트 description)가 다른 표기를 권해도 이 용어표가 우선한다.
7. 미결정 항목(8절 참조)은 이 문서의 잠정 선택을 쓴다. 사용자가 결정을 바꾸면 용어표만 고친다.

## 2) 용어표

중요도(빈도와 영향) 순이다.

### 핵심 개념

| English | 한국어 | 비고 |
|---|---|---|
| agent | 에이전트 | 확정. 복수형 없음: "3 agents"는 "에이전트 3개". 복합어는 붙임: 브라우저 에이전트. |
| task | 작업 | 확정. "태스크" 금지. |
| swarm | 스웜 | 확정. 명령어 `swarm`은 코드 스팬. |
| memory | 메모리 | 확정. RAM 의미도 동일. |
| session | 세션 | |
| hook / hooks | 훅 | 확정. 이벤트명(PreToolUse 등)은 영문. |
| daemon | 데몬 | 확정. |
| worker | 워커 | agent와 구분. "백그라운드 워커", "루프 워커". |
| plugin | 플러그인 | 플러그인 ID(ruflo-core 등)는 영문. |
| skill | 스킬 | 스킬 이름은 영문 유지. |
| MCP server | MCP 서버 | MCP는 영문, server=서버. |
| tool / tool call | 도구 / 도구 호출 | MCP 도구명은 영문. |
| mission | 미션 | 콘솔의 Missions 기능. "임무" 금지. |
| workflow | 워크플로 | "워크플로우" 쓰지 않음. |
| mod | mod | 제품 개념이라 번역하지 않는다. mode(모드)와 혼동을 피하기 위해 본문은 "mod"로 쓴다. 첫 등장에만 "mod(훅 기반 확장 단위)"를 병기한다. 콘솔 인벤토리의 "mod → 모드"는 채택하지 않는다. |
| mode | 모드 | mod와 구분. |
| topology | 토폴로지 | 값(`hierarchical`, `mesh`, `ring`, `star`, `hybrid`, `hierarchical-mesh`, `pheromone-adaptive`)은 코드 스팬. |
| hierarchical | 계층형 | 산문에서만. |
| mesh | 메시 | |
| coordination / coordinate | 조율 / 조율하다 | orchestration과 구분. |
| coordinator | 코디네이터 | 역할명. |
| orchestration / orchestrator | 오케스트레이션 / 오케스트레이터 | |
| consensus | 합의 | raft, byzantine, gossip, CRDT는 영문. |
| vote / proposal / quorum | 투표 / 제안 / 정족수 | |
| hive-mind | 하이브마인드 | 붙여 씀. "하이브 마인드" 쓰지 않음. 명령어 `hive-mind`는 영문. |
| hive | 하이브 | hive-mind와 일관. |
| queen | 퀸 | 역할명. "(임기 3)" 형태: "퀸 {id} (임기 3)". |
| federation | 페더레이션 | |
| peer | 피어 | |
| member / leader | 멤버 / 리더 | |
| role | 역할 | |
| type | 유형 | "타입" 쓰지 않음. |
| specialist / specialized | 전문 에이전트 / 전문 | "Specialized X"는 "전문 X", "Expert agent for X"는 "X 전문 에이전트". 콘솔 역할명 버튼 라벨만 "스페셜리스트". `expert`(전문가) 행은 두지 않는다. |
| team | 팀 | "AI 팀". |
| pool | 풀 | "에이전트 풀". |
| strategy | 전략 | 값 `specialized`, `balanced`, `adaptive`는 영문. |
| scale / auto-scaling | 확장 / 자동 확장 | "스케일링" 쓰지 않음. |
| claim | 클레임 | 명사와 동사 모두. 첫 등장 시 "클레임(claim)". "Claims Board"는 "클레임 보드". |
| release (claim) | 해제 | "반납" 쓰지 않음. |
| steal | 가로채기 | "탈취" 쓰지 않음. "stealable"은 "가로챌 수 있음". |
| handoff / hand off | 인계 | "hand X to Y"는 "X를 Y에게 인계". |
| run (verb/noun) | 실행 | 콘솔 인벤토리에 약 470회 등장. "▶ run" → "▶ 실행". execution/execute도 실행. start(시작)/stop(중지)과 구분. |
| parallel | 병렬 | |
| priority | 우선순위 | |
| dependencies | 의존성 | "상위 작업"(parent task)과 함께 쓴다. |
| weight | 가중치 | "Task-success score weight"는 "작업 성공 점수 가중치". |
| eligibility | 자격 | "Role-aware dynamic eligibility"는 "역할 인지형 동적 자격". |

### 메모리와 검색

| English | 한국어 | 비고 |
|---|---|---|
| namespace | 네임스페이스 | 값(`guidance` 등)은 코드 스팬. |
| key | 키 | |
| value | 값 | |
| tag | 태그 | |
| entry | 항목 | "엔트리" 쓰지 않음. |
| vector | 벡터 | RVF, RuVector는 영문. |
| embedding | 임베딩 | "384-dim"은 "384차원". |
| index / indexing | 인덱스 / 인덱싱 | |
| search | 검색 | |
| semantic search | 시맨틱 검색 | 옵션 값 `semantic`, `keyword`, `hybrid`는 영문. |
| keyword search | 키워드 검색 | |
| hybrid search | 하이브리드 검색 | |
| retrieval / retrieve | 검색 / 조회 | |
| similarity | 유사도 | |
| threshold | 임계값 | |
| backend | 백엔드 | |
| store (noun) | 저장소 | |
| store / save (verb) | 저장 | |
| cache / caching | 캐시 / 캐싱 | |
| purge | 완전 삭제 | 첫 등장에 "완전 삭제(purge)". 하위 명령어는 영문. |
| cleanup | 정리 | |
| TTL | TTL | 설명은 "유지 시간(초)". |
| knowledge graph | 지식 그래프 | |
| provenance | 출처 | 첫 등장에 "출처(provenance)". |
| pattern | 패턴 | |
| neural patterns | 뉴럴 패턴 | "신경망 패턴" 쓰지 않음. |
| trajectory | 궤적 | |
| transcript | 대화 기록 | "에이전트 대화 기록". |
| journal | 저널 | |
| snapshot | 스냅샷 | |
| brute force | 전수 탐색 | |
| schema / migration | 스키마 / 마이그레이션 | |
| coverage | 커버리지 | |

### 학습과 AI

| English | 한국어 | 비고 |
|---|---|---|
| model | 모델 | |
| provider | 프로바이더 | `anthropic`, `openrouter`, `ollama` 같은 ID는 영문. |
| tier | 티어 | |
| level | 수준 | "로그 수준", "신뢰 수준". |
| learning / self-learning | 학습 / 자가 학습 | |
| train / pretrain | 학습시키다 / 사전 학습 | epoch=에폭. |
| neural | 뉴럴 | "neural network"는 신경망. |
| router / routing | 라우터 / 라우팅 | |
| harness | 하네스 | "하니스" 쓰지 않음. 첫 등장에 "하네스(harness)". MetaHarness는 영문. |
| prompt injection | 프롬프트 인젝션 | |
| token / token budget | 토큰 / 토큰 예산 | |
| budget | 예산 | |
| cost | 비용 | "토큰 비용". |
| spend | 지출 | "사용액" 쓰지 않음. |
| compress | 압축 | |
| evolve / flywheel / champion / promote | 진화 / 플라이휠 / 챔피언 / 승격 | `flywheel-v1` 등 ID는 영문. |
| genome | 지놈 | GEPA는 영문. |
| loop | 루프 | |
| autopilot | 오토파일럿 | |
| goal / plan | 목표 / 계획 | SPARC, GOAP은 영문. |
| anti-drift | 드리프트 방지 | |
| peer-to-peer | P2P | |
| spoke | 스포크 | |
| quorum safety | 정족수 안전성 | |
| Pheromone Adaptive | 페로몬 적응형 | 값 `pheromone-adaptive`는 영문. |
| grade / score / readiness | 등급 / 점수 / 준비도 | |

### 보안과 검증

| English | 한국어 | 비고 |
|---|---|---|
| security | 보안 | safety는 안전. |
| audit / audit trail | 감사 / 감사 추적 | |
| verify / verification | 검증 | |
| validate | 유효성 검사 | verify와 구분할 때만. |
| gate / quality gate | 게이트 / 품질 게이트 | |
| evidence | 증거 | |
| receipt | 영수증 | "확인 기록" 쓰지 않음. |
| ledger | 원장 | "장부" 쓰지 않음. "작업 원장". |
| guard | 가드 | "쓰기 가드". |
| guardrails | 가드레일 | |
| policy / rule | 정책 / 규칙 | |
| allow | 허용 | |
| deny / refuse | 거부 | "Refuse ..."는 "~를 거부합니다". |
| block / blocked | 차단 / 차단됨 | |
| ask (policy verdict) | 확인 요청 | allow/ask/deny는 허용/확인 요청/거부. "허용/확인/거부"로 줄이지 않는다. |
| ask Claude | Claude에게 질문 | 버튼 라벨 "✦ ask Claude" → "✦ Claude에게 질문". 정책 값 `ask`와 구분. |
| permission | 권한 | |
| approve / approval | 승인 | |
| confirm / confirmation | 확인 | "확인 없이 삭제합니다". |
| Yes, run it (y) | 예, 실행합니다 (y) | 5절 예시와 동일. |
| trust / trust level | 신뢰 / 신뢰 수준 | "제로 트러스트", "신뢰 경계". |
| threat | 위협 | |
| alert | 경고 | |
| warning | 주의 | ⚠ 톤. |
| false positive | 오탐 | |
| scan | 스캔 | |
| sandbox | 샌드박스 | |
| compliance | 규정 준수 | "컴플라이언스" 쓰지 않음. |
| witness | 위트니스 | "위트니스 매니페스트". |
| circuit breaker | 서킷 브레이커 | |
| failover | 페일오버 | |
| tenant | 테넌트 | |
| prompt disclosure | 프롬프트 노출 | |
| role reassignment | 역할 재지정 | |
| goal replacement | 목표 교체 | |
| covert action | 은밀한 행동 | |
| fake role tags | 가짜 역할 태그 | |
| private key | 개인 키 | |
| pubkey | 공개 키 | |
| envelope | 엔벨로프 | |
| invite code / roster / membership | 초대 코드 / 명단 / 멤버십 | |
| ack | 확인(ack) | |
| blockers | 블로커 | |

### 상태와 동작 (CLI 동사)

| English | 한국어 | 비고 |
|---|---|---|
| status / state | 상태 | |
| running | 실행 중 | |
| idle | 유휴 | |
| busy | 작업 중 | |
| pending | 대기 중 | |
| waiting | 기다리는 중 | pending과 구분. 다른 후보("대기", "보류 중")는 채택하지 않는다. |
| completed / done | 완료 | |
| failed | 실패 | |
| terminated | 종료됨 | |
| paused | 일시 중지됨 | "일시정지" 쓰지 않음. |
| archived | 보관됨 | |
| active / inactive | 활성 / 비활성 | "비활성 에이전트도 포함합니다"처럼 쓴다. |
| on / off | 켜짐 / 꺼짐 | 좁은 폭·버튼은 켬/끔. |
| healthy / degraded / unhealthy | 정상 / 성능 저하 / 비정상 | "건전성" 쓰지 않음. |
| pass / warn / fail | 통과 / 경고 / 실패 | 표시 텍스트만. 내부 값은 영문. |
| initialize | 초기화 | reset과 구분. |
| reset | 재설정 | |
| clear | 비우기 | |
| start | 시작 | |
| stop | 중지 | "정지", "중단" 쓰지 않음. |
| pause | 일시 중지 | |
| resume | 재개 | |
| spawn | 생성 | "스폰" 쓰지 않음. 하위 명령어 `spawn`은 영문. |
| create / generate | 생성 | |
| delete | 삭제 | |
| remove | 제거 | |
| cancel | 취소 | |
| restore | 복원 | |
| export | 내보내기 | |
| import | 가져오기 | |
| enable / disable | 활성화 / 비활성화 | |
| skip | 건너뛰기 | |
| force | 강제 | 정상 종료 대비 "강제로 중지합니다". |
| overwrite | 덮어쓰기 | |
| retry | 재시도 | |
| assign | 할당 | |
| refresh | 새로고침 | |
| read / write | 읽기 / 쓰기 | "읽기 전용". |
| show | 표시 | "보여줍니다" 쓰지 않음. |
| list | 목록 | 동사형은 "목록을 표시합니다". |
| filter | 필터 | "~로 필터링합니다". |
| check | 확인 | 점검 항목은 "점검". |
| health check | 상태 점검 | 이 용어 전용. "헬스 체크" 쓰지 않음. |
| ask first | 먼저 묻습니다 | "asks y or n first"는 "y 또는 n을 먼저 묻습니다". "먼저 확인 요청"과 겹치지 않게 한다. |
| diagnostics | 진단 | |
| monitor / monitoring | 모니터링 | Claude Code 도구명 Monitor는 영문. |
| watch mode | 감시 모드 | |
| follow (logs) | 따라가기 | "실시간 추적" 쓰지 않음. "● following"은 "● 따라가는 중". |
| graceful shutdown | 정상 종료 | |
| dry run | 드라이런 | "드라이 런" 쓰지 않음. 플래그 `--dry-run`은 영문. |
| optimize | 최적화 | |
| deploy | 배포 | |
| scaffold | 스캐폴드 | 동사는 "스캐폴드를 생성합니다". |
| detect | 감지 | "탐지" 쓰지 않음. |
| ingest | 수집 | |
| ago / none yet / n/a | 전 / 아직 없음 / 해당 없음 | 시간은 "{n}분 전". |
| older / newer | 이전 / 최신 | 화살표 위치 유지. |
| drill into | 자세히 보기 | |
| rollout / canary | 롤아웃 / 카나리 | |
| tick | 틱 | |
| supersede | 대체 | |
| dangling ref | 끊어진 참조 | |
| fault tolerance | 장애 허용 | |

### UI와 일반 용어

| English | 한국어 | 비고 |
|---|---|---|
| view / page | 화면 | |
| pane | 패널 | |
| command palette | 명령 팔레트 | |
| help / guide | 도움말 / 가이드 | |
| settings | 설정 | |
| configuration / config | 설정 | "구성"은 composition 의미일 때만. |
| setup | 설정 | "agent setup"은 "에이전트 설정". |
| wizard | 마법사 | "setup wizard"는 "설정 마법사". |
| option | 옵션 | |
| command / subcommand | 명령어 / 하위 명령어 | |
| usage | 사용법 | |
| example | 예시 | |
| default | 기본값 | "[기본값: x]". |
| required | 필수 | "(필수)". |
| directory | 디렉터리 | "디렉토리" 쓰지 않음. |
| folder | 폴더 | |
| file / path | 파일 / 경로 | |
| format | 형식 | |
| output | 출력 | |
| detailed / verbose | 상세 | |
| log | 로그 | |
| event | 이벤트 | |
| timeline | 타임라인 | |
| overview | 개요 | |
| dashboard | 대시보드 | |
| console | 콘솔 | |
| template | 템플릿 | |
| catalog | 카탈로그 | |
| marketplace | 마켓플레이스 | |
| install | 설치 | |
| update | 업데이트 | |
| metrics | 메트릭 | |
| performance | 성능 | |
| benchmark | 벤치마크 | |
| test | 테스트 | |
| acceptance test | 인수 테스트 | |
| review | 리뷰 | |
| documentation | 문서화 | |
| phase | 단계 | |
| step (workflow) | 스텝 | 안내 문구의 "다음 단계"는 예외. |
| timeout | 타임아웃 | |
| maximum / minimum | 최대 / 최소 | |
| number of | ~ 수 | |
| comma-separated | 쉼표로 구분 | |
| specific | 특정 | |
| background | 백그라운드 | |
| real-time | 실시간 | |
| worktree | 워크트리 | |
| branch / commit | 브랜치 / 커밋 | PR, diff는 영문. |
| pipeline | 파이프라인 | |
| device / fleet | 디바이스 / 플릿 | "디바이스 플릿". |
| on disk | 디스크에 | "X가 디스크에 없습니다". |
| acceptance criteria | 인수 기준 | |
| regression | 회귀 | |
| observability | 관측성 | |
| pair programming | 페어 프로그래밍 | |
| Domain-Driven Design | 도메인 주도 설계(DDD) | |
| Architecture Decision Record | 아키텍처 결정 기록(ADR) | |
| Event-sourced | 이벤트 소싱 | |

### 콘솔 UI 이름

| English | 한국어 | 비고 |
|---|---|---|
| Lab | 랩 | Memory Lab=메모리 랩, Vector Lab=벡터 랩, Learning Lab=학습 랩. "러닝 랩" 쓰지 않음. |
| Mission Control | 미션 컨트롤 | |
| Event Stream | 이벤트 스트림 | |
| Scout / Specialist | 스카우트 / 스페셜리스트 | 콘솔 역할명 버튼 라벨 전용. 일반 설명문은 "전문 에이전트". |
| The Room | 룸 | |
| cockpit | 콕핏 | |
| Log Off / MAIN | 로그오프 / 메인 | |
| Doctor (화면 이름) | 닥터 | 명령어 `doctor`는 영문. "Security & Doctor" 화면은 "보안 & 진단"으로 하나만 쓴다. |

## 3) 번역하지 않음

- 제품 및 기술명: Ruflo/RuFlo, ruflo, claude-flow, RuVector, RuVLLM, AgentDB, ReasoningBank, MetaHarness, AIDefence, Anatole, Cognitum, Claude, Claude Code, Codex, Agent Teams, SONA, HNSW, RVF, RVM, SPARC, GOAP, ONNX, Flash Attention, GEPA, MemPoison, Playwright, Ollama, DeepSeek, GitHub, WASM, Rust, LLM, RAG, API, PII, CVE, ANN, APSC, SCM, IB+VQ, SmartRetrieval, recall@10, SOTA, TDD, DDD, IoT, agentbbs, x.ruv.io, V3, ADR, `mod`, `mods`.
  - SPARC 단계명은 "명세(Specification), 의사코드(Pseudocode), 아키텍처(Architecture), 정제(Refinement), 완료(Completion)"처럼 병기한다.
- 알고리즘 및 프로토콜: Raft, Byzantine, Gossip, CRDT, mTLS, Ed25519/ed25519(원문 철자 그대로), WireGuard, Nostr, NIP-42, OHLCV, RRF, MMR, EMA.
- 식별자: ADR-NNN, 이슈 번호(#1744), 버전(v3.8.0), 플러그인 ID, 스킬 이름, `flywheel-v1`, `dream-cycle #NNNN`, `dream-cycle`, `pheromone`, M-1 같은 ID.
- 명령어와 플래그: `ruflo init`, `npx @claude-flow/cli@latest ...`, `--namespace`, `--dry-run`, `-o`, 하위 명령어(`spawn`, `list`, `purge`, `hive-mind`, `doctor`), 슬래시 명령(`/ruflo`, `/loop`, `/compact`).
- 환경 변수, 파일 경로, 설정 키: `settings.json`, `.claude-flow/...`, `costBudgetUsd`, `agentTrim`.
- MCP 도구명: `swarm_*`, `agent_*`, `memory_search_unified`.
- 옵션 값: `semantic`, `keyword`, `hybrid`, `json`, `yaml`, `pass`, `warn`, `fail`, `hierarchical-mesh`, `1h`, `24h`, `specialized`, `balanced`, `adaptive`, swarm 유형(`research`, `development`, `testing`, `optimization`, `maintenance`, `analysis`).
  - 값에 설명을 붙일 때는 값은 영문, 설명은 번역한다. 영문 값에 한국어 뜻을 병기하는 경우는 `BLOCK(차단)`처럼 첫 등장에만 괄호로 병기한다.
- 코드 스팬, 코드 블록, ASCII 다이어그램, 배지, URL 앵커.
- 단축키와 키 입력: `(y)`, `(n)`, `(s)`, `(1)`, `p`, `h`. 약어 `rd`/`wr`/`ad`/`cpu`/`$$`/`ctx`.
- 단위 및 기호: `$5`, MB, ms, %, ✓ ✗ ⚠ → • ▸ ◂ ● ○ ★ ✦ 등. 이모지는 추가하거나 삭제하지 않는다.
- 제3자 이름: Slack, ChatGPT, Grok, Gemini CLI, Cursor, Cline, Copilot, Windsurf, OpenCode, LangGraph, AutoGen, CrewAI, Tailscale, Node.js, npm, npx, Docker, tmux, Windows/macOS/Linux/WSL/PowerShell.
- 모델에게 전달되는 문구: `[INTELLIGENCE] ...` 훅 출력, 컴팩션 상태 문구, MCP 도구 설명, 검증 오류 토큰.
- 하단 태그라인 "Created with ❤️ by ruv.io"는 영문 유지.
- 이미지 캡션(이탤릭)은 번역하되 파일 경로는 유지한다.

## 4) 말투·문장 규칙

### 종류별 문체

| 종류 | 규칙 | 예 |
|---|---|---|
| 도움말 설명 | `~합니다`, 마침표 없음 | 새 에이전트를 생성합니다 |
| 제목·라벨·헤더 | 명사구, 콜론은 원문을 따름 | 사용법: / 다음 단계: / 옵션: |
| 진행 메시지 | `~하는 중...` | 세션을 저장하는 중... |
| 완료 메시지 | `~했습니다` | 세션을 저장했습니다 |
| 오류 | `~하지 못했습니다: {원인}` | 세션을 저장하지 못했습니다: {reason} |
| 필수값 누락 | `X가 필요합니다. --key 또는 -k를 사용하세요` | |
| 빈 상태 | `~가 없습니다` | 조건에 맞는 에이전트가 없습니다 |
| 힌트 | `~하세요` | `ruflo init`을 실행해 초기화하세요 |
| 문서(README, explained) | 서술은 `~합니다`, 지시는 `~하세요` | |

- 설명은 마침표 없이 쓴다. 원문에 마침표가 있는 문장(오류, 안내문)은 마침표를 유지한다.
- 구조 유지: 원문의 `— ` 줄표 구조와 "이름 — 설명" 형식을 유지한다. 줄표 앞은 명사구, 뒤는 `~합니다`로 맺는다.
- 명사구 설명은 "~을(를) 제공합니다" 또는 "~을(를) 수행합니다"로 맺는다. "~입니다"는 쓰지 않는다. 인벤토리에 "~입니다"로 끝나는 설명이 있어도 이 규칙을 따른다.
- `Use when ...` 트리거 문장은 "~할 때 사용합니다."로 번역하고, 스킬 매칭을 위해 따옴표 안 발화는 영문 원문을 함께 남긴다.
- `Same as <command>:` 패턴은 "<command>와 같습니다: ..."로 쓴다.
- 반복 문구(`As a mod (ADR-445): ...`, `Refuse ... hold a key, token or password`)는 한 번 확정해 일괄 재사용한다.
- 문서의 굵은 말머리는 다음으로 통일한다.
  - Try it: → 직접 해보기:
  - Success check: → 성공 확인:
  - Practical takeaway: → 핵심 정리:
  - Your next step: → 다음 단계:
- 도움말 섹션 제목은 다음으로 통일한다.
  - PRIMARY COMMANDS → 주요 명령어:
  - ADVANCED COMMANDS → 고급 명령어:
  - UTILITY COMMANDS → 유틸리티 명령어:
  - ANALYSIS COMMANDS → 분석 명령어:
  - MANAGEMENT COMMANDS → 관리 명령어:
  - GLOBAL OPTIONS → 전역 옵션:
  - V3 FEATURES → V3 기능:
  - EXAMPLES → 예시:
  - SUBCOMMANDS → 하위 명령어:
  - OPTIONS → 옵션:
- 도움말 그룹은 `Start`=시작, `Work`=진행, `Learn`=학습으로 쓴다. "Work"에 "진행"을 쓰는 것은 task=작업과 겹치지 않게 하려는 것이다.
- 도움말 주제의 `keywords[]`에는 영문을 남기고 한국어 키워드를 추가한다. `id`, `related`, `go`는 바꾸지 않는다.
- 예시 줄에서는 명령어 부분과 간격은 그대로 두고 `#` 뒤 주석만 번역한다.
- README 링크 텍스트는 번역해도 URL 앵커(`#quick-start`, `#-core-features`)는 바꾸지 않는다.
- 상태 줄 구분자 ` · `는 유지한다: "3 agents ready" → "에이전트 3개 준비됨".

### 표기법

- 한글과 영문, 숫자 사이는 띄운다: "에이전트 3개", "MCP 서버", "Claude Code". 단위는 숫자에 붙인다: 100ms, 1.0MB. 원문이 "1.0 MB"처럼 띄어 쓴 경우는 원문을 따른다.
- 조사는 영문 뒤에 그대로 붙인다: Claude에게, `ruflo init`을, MCP가. 영문 단어의 조사는 받침이 아닌 발음 기준으로 고른다.
- 코드 같은 텍스트(명령어, 경로, 플래그)는 ASCII 문장부호를 쓴다. 한국어 문장 안에서도 쉼표와 마침표는 ASCII로 쓴다.
- 말줄임표는 `…` 한 글자를 쓴다. 원문 `...`가 코드나 진행 메시지 형식이면 원문을 따른다.
- 전각 문장부호(，。、「」）는 쓰지 않는다. 따옴표는 원문(`"`, `“ ”`)을 그대로 쓴다.
- 복수형은 없앤다. 수 표현은 `{n}개`(사물), `{n}건`(경고·이슈·기록), `{n}명`(사람)을 쓴다. `ago`는 `{n}분 전`으로 쓴다.
- 장식용 이모지는 유지한다.

### 자리표시자 규칙

- `{0}`, `{id}`, `${n}`, `%s` 같은 자리표시자는 번역하지 않는다. 안쪽 텍스트도, 백틱 안도 번역하지 않는다.
- 한국어 어순에 맞게 `{0}`, `{1}`의 순서는 바꿀 수 있다. 번호는 바꾸지 않는다.
- 조사 오류를 피하려고 자리표시자 뒤에는 조사를 직접 붙이지 않는다. 대신 "작업: {id}", "세션 {name}", "에이전트 {n}개"처럼 쓴다. 어쩔 수 없으면 "을(를)", "이(가)"를 쓴다.
- 동사를 문자열 이어붙이기로 만드는 곳(`${verb} workflow`, `${verb} task`, `catalog-${verb}`)은 번역하지 않고 상위 세션에 보고한다. 동사별 룩업 테이블이 필요하다.
- 시간 헬퍼(`ago()`/`since()`)가 `5m`, `2h`처럼 단위를 코드에서 붙이는 곳은 번역 문자열만으로 해결되지 않는다. 번역하지 않고 상위 세션에 보고해, 코드가 `5분`, `2시간`을 출력하게 한다.
- YAML frontmatter의 번역문에 `: `가 있으면 따옴표로 감싸 YAML 유효성을 유지한다.

## 5) 짧은 라벨·정렬 규칙

### 버튼과 짧은 라벨

- 버튼 라벨은 2~6자 한글을 목표로 한다. 예: 실행, 중지, 취소, 삭제, 생성, 찾기, 지우기, 새로고침.
- 원문의 앞뒤 공백, 화살표·글리프의 위치와 방향은 그대로 둔다: ` ▶ 실행 `, `◂ 최신`, `이전 ▸`, `↻ 다시 읽기`.
- 단축키 표기는 라벨 뒤에 `(키)`를 붙이는 원문 형식을 유지하고, 키 바인딩은 그대로 동작해야 한다: "예, 실행합니다 (y)", "취소 (n)".
- 공간이 좁은 변형은 4자 안팎으로 줄인다: 켬/끔, 펼침/접음, 전체/없음.
- 카운터는 숫자를 뒤에 두는 형식을 쓴다: "차단 3", "실패 2".

### 열 정렬

- 한글은 터미널에서 2칸을 차지한다. `padEnd`, `clip` 같은 글자 수 기준 정렬은 한글이 들어가면 어긋난다.
- `padEnd`로 맞추는 열(플래그, 명령어 이름)에는 한글을 넣지 않는다. 설명은 그 뒤에 이어 붙인다. 예: swarm.ts의 `padEnd(12)`, `padEnd(15)`, `padEnd(25)`.
- 한글이 들어가는 표 헤더와 열은 표시 폭 기준으로 계산하는 패딩 함수를 쓰거나, 폭을 한글 글자 수의 2배로 잡는다.
- 표 헤더를 `{header, key, width}` 객체로 정의한 곳에서는 `key`를 바꾸지 않고 `width`만 한글 글자 수의 2배로 늘린다.
- 표 헤더는 짧은 형태를 쓴다: 이름, 상태, 우선순위, 생성일, 마지막 활동, 유형, 역할.
- `key:` 값은 번역하지 않는다.
- 코드 블록 안의 ASCII 다이어그램과 박스 그림은 번역하지 않는다.
- README 표의 구분선 행(`|---|`)은 바꾸지 않는다.

## 6) 예문

1. `Spawn a new agent` → 새 에이전트를 생성합니다
2. `List all active agents` → 활성 에이전트를 모두 표시합니다
3. `Key is required. Use --key or -k` → 키가 필요합니다. --key 또는 -k를 사용하세요
4. `No agents found matching criteria` → 조건에 맞는 에이전트가 없습니다
5. `Failed to save session` → 세션을 저장하지 못했습니다
6. `Initializing...` → 초기화하는 중...
7. `Session saved` → 세션을 저장했습니다
8. `Run "ruflo init" to initialize` → `ruflo init`을 실행해 초기화하세요
9. `-t coder   # Spawn a coder agent` → `-t coder   # 코더 에이전트 생성`
10. `Refuse memory writes that hold a key, token or password.` → 키, 토큰, 비밀번호가 포함된 메모리 쓰기를 거부합니다.

## 7) 충돌 해소 요약

| 항목 | 후보 | 최종 |
|---|---|---|
| harness | 하네스 / 하니스 | 하네스 |
| mod | 모드 / mod | mod (mode는 모드) |
| workflow | 워크플로 / 워크플로우 | 워크플로 |
| receipt | 영수증 / 확인 기록 | 영수증 |
| spend | 지출 / 사용액 | 지출 |
| compliance | 컴플라이언스 / 규정 준수 | 규정 준수 |
| neural | 뉴럴 / 신경망 | 뉴럴 (network는 신경망, patterns는 뉴럴 패턴) |
| config | 설정 / 구성 | 설정 |
| directory | 디렉터리 / 디렉토리 | 디렉터리 |
| hive-mind | 하이브마인드 / 하이브 마인드 | 하이브마인드 |
| pending vs waiting | 대기 / 대기 중 / 보류 중 | pending=대기 중, waiting=기다리는 중 |
| spawn | 스폰 / 생성 | 생성 |
| pause | 일시 중지 / 일시정지 | 일시 중지 |
| ledger | 원장 / 장부 | 원장 |
| release / steal | 반납 / 탈취 | 해제 / 가로채기 |
| ask (verdict) | 확인 / 확인 요청 | 확인 요청 |
| follow (logs) | 따라가기 / 실시간 추적 | 따라가기 |
| dry run | 드라이런 / 드라이 런 | 드라이런 |
| on/off | 켜짐·꺼짐 / 켬·끔 | 일반 상태는 켜짐/꺼짐, 버튼·좁은 폭은 켬/끔 |
| health check | 상태 점검 / 헬스 체크 | 상태 점검 |
| Lab | 랩 / 러닝 랩 | 랩 (학습 랩) |
| Security & Doctor | 보안 & 진단 / 보안 & 닥터 | 보안 & 진단 |

## 8) 결정된 항목 (설계 문서 기준)

- `mod`/`mods`는 영문 그대로 둔다(mode=모드와 구분). 첫 등장에만 "mod(훅 기반 확장 단위)"로 풀어 쓴다.
- 스킬 `Use when` 트리거는 "~할 때 사용합니다."로 옮기고, 따옴표 안 발화 예시와 핵심 영어 용어는 괄호로 병기한다.
- `docs/ruflo-explained.md`는 `docs/ruflo-explained.ko.md`로 번역했다.
- 훅이 모델에 주입하는 `[INTELLIGENCE]` 등 모델 대상 문구, MCP 도구 설명, 헬퍼(`.claude/helpers`) 문구, 상태 줄 `ctx`는 영문 그대로 둔다.
- 세 README의 언어 전환 줄에 `· [한국어](README.ko.md)`를 추가했다.

## 9) 추가 규칙 (구현 계획 §4.6 반영)

- **상태 태그는 영문 유지**: `[OK]` `[PASS]` `[WARN]` `[FAIL]` `[ERROR]` `[INFO]` `[RUNNING]` `[STOPPED]` 같은 대괄호 태그는 기계 판독 표지라 번역하지 않는다.
- **UI 부품 이름**: band(프롬프트 위 띠)=프롬프트 위 띠, palette=팔레트(command palette=명령 팔레트), notice=알림, toast=토스트(사람에게 보이는 문구에 이 단어가 나올 때만), approval=승인, guidance=가이던스, cockpit=콕핏, pane=패널, view=화면.
- **`null` 사용**: 번역해도 원문과 같거나, 고유명사·식별자·명령만으로 된 줄은 샤드에서 `"ko": null`(의도적 영문 유지)로 둔다. `""`는 미번역(누락)이다.
- **폭**: 콘솔 kv 라벨(16칸)은 한글 8자 이내, 버튼은 원문 표시 폭 이하를 목표로 한다. 한글 1자는 2칸이다.
- **description 길이**: 스킬 description은 1024자 이하. 에이전트·명령 description에는 줄바꿈을 넣지 않는다(원래 블록 스칼라인 것 제외).
- **영어 원문의 끝 문장부호**(`:` `...` `…` `.`) 유무는 그대로 따른다. 앞뒤 공백·줄머리 기호·이모지도 보존한다.
- **금지 변형**(검사기 GLOSSARY 경고): swarm→무리·군집·스왐, agent→대리인·요원, hook→후크, memory→기억장치, spawn→스폰, task→태스크, workflow→워크플로우, directory→디렉토리, harness→하니스, compliance→컴플라이언스.
