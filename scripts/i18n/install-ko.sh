#!/usr/bin/env bash
# ruflo 한글판 설치 스크립트 (계획 §4.7 install-ko.sh, 검증 F2).
#   bash scripts/i18n/install-ko.sh [--tools-only] [--skip-build] [--no-global] [--force]
#
#   --tools-only  ① pnpm 심만 만들고 끝낸다(빌드·설치 없음)
#   --skip-build  ③ 설치·빌드를 건너뛴다(미러에 빌드 결과가 이미 있어야 한다)
#   --no-global   ⑧⑨ 전역 사전 점검과 npm install -g 를 건너뛴다
#   --force       ⑧ 전역 사전 점검에서 경고가 나도 중단하지 않는다
#
# 단계: ①pnpm 심 ②작업본→미러 rsync ③빌드 ④i18n 검사 ⑤스테이징 ⑥헬퍼 검증 ⑦pack
#       ⑧전역 사전 점검 ⑨전역 설치 ⑩마켓플레이스 스냅숏 ⑪확인
# 작업본(REPO)에는 쓰지 않는다. 빌드·스테이징·pack 은 ext4 미러($M)와 복사본($STAGE)에서만 한다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 경로 변수는 이 스크립트 전용 이름만 읽는다. 셸에 흔한 이름(M·REPO·STAGE·MK·TOOLS)이 export 돼 있어도 영향이 없다(rsync --delete 가 홈을 지우는 사고 방지).
REPO="${RUFLO_KO_REPO:-$(cd "$SCRIPT_DIR/../.." && pwd)}"          # 작업본(편집은 여기서만)
M="${RUFLO_KO_MIRROR:-$HOME/.cache/ruflo-ko-build}"                # ext4 빌드 미러(rsync --delete 대상)
STAGE="${RUFLO_KO_STAGE:-$HOME/.cache/ruflo-ko-stage}"             # 스테이징·pack 전용 복사본(rm -rf 대상)
MK="${RUFLO_KO_MK:-$HOME/.local/share/ruflo-ko/marketplace}"       # 커밋된 HEAD 로 만든 고정 마켓플레이스 스냅숏(rm -rf 대상)
TOOLS="${RUFLO_KO_TOOLS:-$HOME/.cache/ruflo-ko-tools}"
PNPM_VERSION="8.15.0"
EXPECT_VERSION_LINE='ruflo v3.53.0 (ko)'
# ⑪ 확인용 격리 HOME: 사용자 홈의 설정·데몬을 건드리지 않는다.
TEST_HOME="$HOME/.cache/ruflo-ko-test-home"

TOOLS_ONLY=0
SKIP_BUILD=0
NO_GLOBAL=0
FORCE=0
for a in "$@"; do
  case "$a" in
    --tools-only) TOOLS_ONLY=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --no-global) NO_GLOBAL=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "[install-ko] 알 수 없는 옵션: $a" >&2; exit 2 ;;
  esac
done

CURRENT_STEP="(시작 전)"
MK_TMP=""
on_exit() {
  local rc=$?
  # ⑩ 이 중간에 실패하면 반쯤 푼 스냅숏 임시 폴더가 남지 않게 한다.
  if [ -n "$MK_TMP" ] && [ -d "$MK_TMP" ]; then rm -rf -- "$MK_TMP"; fi
  if [ "$rc" -ne 0 ]; then
    echo "[install-ko] 실패: 단계 '$CURRENT_STEP' (exit $rc)" >&2
  fi
}
trap on_exit EXIT

step_begin() { CURRENT_STEP="$1"; echo "[install-ko] >>> $1 시작"; }
step_ok() { echo "[install-ko] <<< $CURRENT_STEP OK"; }
warn() { echo "[install-ko] 경고: $*" >&2; }
die() { echo "[install-ko] 오류: $*" >&2; exit 1; }

# grep -c 는 0건이면 exit 1(정상), 2 이상은 오류다. 표준입력의 줄 중 패턴($@)에 맞는 줄 수를 낸다. 입력을 끝까지 읽으므로 SIGPIPE 가 나지 않는다.
count_lines() {
  local n rc=0
  n="$(grep -c "$@")" || rc=$?
  [ "$rc" -le 1 ] || die "grep 오류(rc=$rc): $*"
  echo "${n:-0}"
}
hangul_lines() { LC_ALL=C.utf8 count_lines -P '[\x{AC00}-\x{D7A3}]'; }

# ---------------------------------------------------------------- 경로 검증
# rsync --delete / rm -rf 대상이 되는 경로(미러·스테이징·스냅숏)는 아래를 모두 통과해야 한다.
#   - 비어 있지 않은 절대 경로, 정규화(realpath -m) 후 '/'·$HOME·작업본 자신이 아니고, 작업본·$HOME 의 상위나 작업본의 하위도 아니다.
#   - $HOME/.cache/ 아래이거나(MK 는 $HOME/.local/share/ruflo-ko/ 아래도), 이 스크립트가 남긴 표식 파일이 있어야 한다.
#   - 이미 내용이 있으면 이 스크립트가 만든 것처럼 보여야 한다(표식 파일 또는 종류별 특징 파일).
canon() { realpath -m -- "$1"; }
is_under() { case "$1/" in "$2"/*) [ "$1" != "$2" ] ;; *) return 1 ;; esac; }
dir_nonempty() { [ -d "$1" ] && [ -n "$(ls -A "$1" 2>/dev/null)" ]; }

HOME_C=""
REPO_C=""
guard_dir() { # guard_dir <이름> <경로> <종류: mirror|stage|mk|tools> → 정규화한 경로를 GUARD_OUT 에 둔다(서브셸로 부르면 GUARDED 가 사라진다)
  local name="$1" raw="$2" kind="$3" p marker feature ok=0
  [ -n "$raw" ] || die "$name 경로가 비어 있습니다"
  case "$raw" in /*) ;; *) die "$name 는 절대 경로여야 합니다: '$raw'" ;; esac
  case "$raw" in *$'\n'*) die "$name 경로에 줄 바꿈이 있습니다" ;; esac
  p="$(canon "$raw")"
  [ -n "$p" ] && [ "$p" != "/" ] || die "$name 경로가 위험합니다(루트): '$raw'"
  [ "$p" != "$HOME_C" ] || die "$name 경로가 홈 디렉터리 자신입니다: '$raw'"
  if [ -n "$REPO_C" ]; then
    [ "$p" != "$REPO_C" ] || die "$name 경로가 작업본(REPO) 자신입니다: '$raw'"
    ! is_under "$REPO_C" "$p" || die "$name 경로가 작업본(REPO)의 상위입니다: '$raw' ⊃ $REPO_C"
    ! is_under "$p" "$REPO_C" || die "$name 경로가 작업본(REPO) 안입니다: '$raw'"
  fi
  ! is_under "$HOME_C" "$p" || die "$name 경로가 홈 디렉터리의 상위입니다: '$raw'"
  case "$kind" in
    mirror) marker=".ruflo-ko-mirror"; feature="v3/@claude-flow/cli/package.json" ;;
    stage) marker=".ruflo-ko-stage"; feature="cli/package.json" ;;
    mk) marker=".ruflo-ko-commit"; feature=".ruflo-ko-commit" ;;
    *) marker=".ruflo-ko-tools"; feature="bin/pnpm" ;;
  esac
  if is_under "$p" "$HOME_C/.cache"; then ok=1
  elif [ "$kind" = mk ] && is_under "$p" "$HOME_C/.local/share/ruflo-ko"; then ok=1
  elif [ -f "$p/$marker" ]; then ok=1
  fi
  [ "$ok" -eq 1 ] || die "$name 경로가 허용 위치 밖입니다(\$HOME/.cache/ 아래이거나 $marker 표식이 있어야 합니다): '$raw'"
  if dir_nonempty "$p" && [ ! -f "$p/$marker" ] && [ ! -e "$p/$feature" ]; then
    die "$name 경로에 이 스크립트가 만들지 않은 내용이 있습니다($marker·$feature 없음): '$raw'"
  fi
  GUARDED+=("$p")
  GUARD_OUT="$p"
}
GUARDED=()
GUARD_OUT=""
# 검증한 경로끼리 서로 겹치지 않아야 한다.
guard_disjoint() {
  local i j a b
  for ((i = 0; i < ${#GUARDED[@]}; i++)); do
    for ((j = i + 1; j < ${#GUARDED[@]}; j++)); do
      a="${GUARDED[$i]}"; b="${GUARDED[$j]}"
      [ "$a" != "$b" ] && ! is_under "$a" "$b" && ! is_under "$b" "$a" || die "작업 경로끼리 겹칩니다: $a / $b"
    done
  done
}

HOME_C="$(canon "$HOME")"
[ -n "$HOME" ] && [ "$HOME_C" != "/" ] || die "HOME 이 비어 있거나 루트입니다"
# tools-only 는 도구 폴더만 쓰므로 그것만 검증한다. 그 밖에는 모든 경로를 어떤 단계보다 먼저(rsync·rm 전에) 검증한다.
if [ "$TOOLS_ONLY" -eq 1 ]; then
  guard_dir RUFLO_KO_TOOLS "$TOOLS" tools; TOOLS="$GUARD_OUT"
else
  case "$REPO" in /*) ;; *) die "RUFLO_KO_REPO 는 절대 경로여야 합니다: '$REPO'" ;; esac
  REPO="$(canon "$REPO")"
  [ -f "$REPO/v3/@claude-flow/cli/package.json" ] && [ -e "$REPO/.git" ] || die "작업본이 아닙니다(v3/@claude-flow/cli/package.json 또는 .git 이 없음): $REPO"
  [ "$(PJ="$REPO/v3/@claude-flow/cli/package.json" node -p 'require(process.env.PJ).name' 2>/dev/null || true)" = "@claude-flow/cli" ] || die "작업본의 v3/@claude-flow/cli/package.json 이 @claude-flow/cli 가 아닙니다: $REPO"
  REPO_C="$REPO"
  guard_dir RUFLO_KO_TOOLS "$TOOLS" tools; TOOLS="$GUARD_OUT"
  guard_dir RUFLO_KO_MIRROR "$M" mirror; M="$GUARD_OUT"
  guard_dir RUFLO_KO_STAGE "$STAGE" stage; STAGE="$GUARD_OUT"
  guard_dir RUFLO_KO_MK "$MK" mk; MK="$GUARD_OUT"
  guard_disjoint
  # git 이 작업본을 못 읽으면(safe.directory·소유권 등) 아래 상태 검사가 빈 결과로 통과해 버리므로 먼저 막는다.
  git -C "$REPO" rev-parse --verify -q HEAD >/dev/null || die "git 이 작업본을 읽지 못합니다(safe.directory·소유권·HEAD 확인): $REPO"
  # 스냅숏은 커밋된 HEAD 만 담는다. 일부만 커밋된 스냅숏은 마켓플레이스 import 를 깨므로, 이 두 경로가 더러우면 --force 없이는 시작하지 않는다.
  dirty_mk="$(git -C "$REPO" status --porcelain -- .claude-plugin plugins)" || die "git status 가 실패했습니다: $REPO"
  if [ -n "$dirty_mk" ]; then
    warn ".claude-plugin·plugins 에 커밋되지 않은 변경이 $(printf '%s\n' "$dirty_mk" | count_lines '') 건 있습니다. 스냅숏은 커밋된 HEAD 만 담습니다."
    [ "$FORCE" -eq 1 ] || die "먼저 커밋하거나(권장) --force 로 부분 스냅숏을 감수하고 진행하세요."
    warn "--force: 부분 스냅숏을 감수하고 계속합니다."
  fi
  dirty_cli="$(git -C "$REPO" status --porcelain -- v3/@claude-flow/cli i18n scripts/i18n)" || die "git status 가 실패했습니다: $REPO"
  if [ -n "$dirty_cli" ]; then
    warn "v3/@claude-flow/cli·i18n·scripts/i18n 에 커밋되지 않은 변경이 있습니다. 미러는 작업 트리를 쓰지만 catalog-manifest 의 gitSha 는 커밋(HEAD)을 가리키므로, 설치되는 CLI 와 gitSha 가 어긋날 수 있습니다. 커밋 뒤 설치를 권합니다."
  fi
fi

# ---------------------------------------------------------------- ① pnpm 심
step_begin "① pnpm 심"
mkdir -p "$TOOLS/bin"
: > "$TOOLS/.ruflo-ko-tools"
cat > "$TOOLS/bin/pnpm" <<EOF
#!/usr/bin/env bash
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
exec corepack pnpm@${PNPM_VERSION} "\$@"
EOF
chmod +x "$TOOLS/bin/pnpm"
export PATH="$TOOLS/bin:$PATH"
[ "$(command -v pnpm)" = "$TOOLS/bin/pnpm" ] || die "pnpm 심이 PATH 앞에 오지 않았습니다: $(command -v pnpm || echo 없음)"
echo "[install-ko] pnpm 심: $TOOLS/bin/pnpm (PATH 앞에 둘 것: export PATH=\"$TOOLS/bin:\$PATH\")"
step_ok
if [ "$TOOLS_ONLY" -eq 1 ]; then
  echo "[install-ko] --tools-only: 여기서 끝냅니다."
  CURRENT_STEP="(완료)"
  exit 0
fi

for c in rsync node npm git corepack realpath; do command -v "$c" >/dev/null 2>&1 || die "$c 가 필요합니다"; done

# ---------------------------------------------------------------- ② 미러 동기화
step_begin "② 작업본 → 미러 rsync"
CLI="$M/v3/@claude-flow/cli"
mkdir -p "$M"
: > "$M/.ruflo-ko-mirror"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude '*.tsbuildinfo' --exclude '/docs/task-id' --exclude '/.ruflo-ko-mirror' \
  "$REPO/" "$M/"
[ -f "$CLI/package.json" ] || die "미러에 CLI 패키지가 없습니다: $CLI"
step_ok

# ---------------------------------------------------------------- ③ 빌드
if [ "$SKIP_BUILD" -eq 1 ]; then
  step_begin "③ 빌드(건너뜀: --skip-build)"
  [ -f "$CLI/dist/src/index.js" ] || die "--skip-build 인데 미러에 빌드 결과($CLI/dist/src/index.js)가 없습니다"
  step_ok
else
  step_begin "③ pnpm install --frozen-lockfile && pnpm build"
  (cd "$M/v3" && pnpm install --frozen-lockfile && pnpm build)
  step_ok
fi

# ---------------------------------------------------------------- ④ i18n 검사
step_begin "④ check.mjs --strict"
(cd "$M" && node scripts/i18n/check.mjs --strict)
step_ok

# ---------------------------------------------------------------- ⑤ 스테이징 (.github/workflows/stable-npm-release.yml 'Stage CLI publish assets' 재현)
step_begin "⑤ 스테이징"
# (a) 카탈로그 매니페스트: 미러(.git 있음)에서 두 번 만들어 같은지, gitSha 가 HEAD 와 같은지 확인한다(워크플로와 같음).
src_epoch="$(git -C "$M" show -s --format=%ct HEAD)"
(cd "$M" && SOURCE_DATE_EPOCH="$src_epoch" node v3/@claude-flow/cli/scripts/generate-catalog-manifest.mjs)
first_digest="$(sha256sum "$CLI/catalog-manifest.json" | cut -d' ' -f1)"
(cd "$M" && SOURCE_DATE_EPOCH="$src_epoch" node v3/@claude-flow/cli/scripts/generate-catalog-manifest.mjs)
[ "$(sha256sum "$CLI/catalog-manifest.json" | cut -d' ' -f1)" = "$first_digest" ] || die "catalog-manifest.json 이 결정적이지 않습니다"
expected_sha="$(git -C "$M" rev-parse --short=8 HEAD)"
CATALOG_FILE="$CLI/catalog-manifest.json" EXPECTED_SHA="$expected_sha" node -e '
const c = JSON.parse(require("fs").readFileSync(process.env.CATALOG_FILE, "utf8"));
if (c.gitSha !== process.env.EXPECTED_SHA) { console.error(`catalog gitSha ${c.gitSha} != ${process.env.EXPECTED_SHA}`); process.exit(1); }
'
# 작업 트리가 HEAD 와 다르면 gitSha 는 설치될 CLI 의 내용을 정확히 설명하지 못한다.
dirty_now="$(git -C "$REPO" status --porcelain -- v3/@claude-flow/cli i18n)" || die "git status 가 실패했습니다: $REPO"
[ -z "$dirty_now" ] || warn "catalog gitSha(${expected_sha})는 커밋 기준이고, 패키징된 CLI·i18n 에는 커밋되지 않은 변경이 들어 있습니다(tgz 와 gitSha 불일치 가능)."
# (b) 스테이징 복사본(미러의 node_modules 를 건드리지 않는다)
rm -rf "$STAGE"
mkdir -p "$STAGE"
: > "$STAGE/.ruflo-ko-stage"
rsync -a --exclude node_modules "$CLI/" "$STAGE/cli/"
# (c) 내부 런타임 번들(security·codex·mcp·plugin-agent-federation)을 복사본의 node_modules 에 넣는다. 이미 빌드했으므로 --no-build.
(cd "$M" && node scripts/stage-internal-runtime-bundles.mjs --target "$STAGE/cli" --no-build)
# (d) README 와 metaharness 플러그인 복사
cp "$M/README.md" "$STAGE/cli/README.md"
rm -rf "$STAGE/cli/plugins/ruflo-metaharness"
mkdir -p "$STAGE/cli/plugins"
cp -r "$M/plugins/ruflo-metaharness" "$STAGE/cli/plugins/"
step_ok

# ---------------------------------------------------------------- ⑥ 헬퍼 서명 검증
step_begin "⑥ verify-helpers.mjs"
(cd "$CLI" && node scripts/verify-helpers.mjs)
step_ok

# ---------------------------------------------------------------- ⑦ npm pack
step_begin "⑦ npm pack --ignore-scripts"
mkdir -p "$STAGE/pack"
(cd "$STAGE" && npm pack "$STAGE/cli" --ignore-scripts --json --pack-destination "$STAGE/pack" > "$STAGE/pack.json")
TGZ="$STAGE/pack/$(PJ="$STAGE/pack.json" node -p 'require(process.env.PJ)[0].filename')"
[ -f "$TGZ" ] || die "tgz 가 만들어지지 않았습니다: $TGZ"
# 파이프라인 안에서 grep -q 는 일찍 끝나 tar 에 SIGPIPE 를 주므로(pipefail 에서 거짓 실패) 끝까지 읽는 grep -c 로 센다.
tgz_list="$STAGE/pack/tgz-list.txt"
tar -tzf "$TGZ" > "$tgz_list"
[ "$(count_lines -E '(^|/)\.\.(/|$)' < "$tgz_list")" -eq 0 ] || die "tgz 에 경로를 벗어나는 항목이 있습니다"
tgz_has() { [ "$(count_lines -Fx -- "$1" < "$tgz_list")" -ge 1 ]; }
for need in package/bin/ruflo.js package/README.md package/i18n/ko/help.json package/i18n/ko/messages.json package/catalog-manifest.json package/plugins/ruflo-metaharness/scripts/_harness.mjs; do
  tgz_has "$need" || die "tgz 에 $need 가 없습니다"
done
for b in security codex mcp plugin-agent-federation; do
  for f in package.json dist/index.js; do
    tgz_has "package/node_modules/@claude-flow/$b/$f" || die "tgz 에 번들 @claude-flow/$b 의 $f 가 없습니다"
  done
done
echo "[install-ko] tgz: $TGZ"
step_ok

# ---------------------------------------------------------------- ⑧ 전역 사전 점검
if [ "$NO_GLOBAL" -eq 1 ]; then
  step_begin "⑧ 전역 사전 점검(건너뜀: --no-global)"
  step_ok
else
  step_begin "⑧ 전역 사전 점검"
  GLOBAL_JSON="$(npm ls -g --depth=0 --json 2>/dev/null || true)"
  [ -n "$GLOBAL_JSON" ] || GLOBAL_JSON='{}'
  problems="$(GLOBAL_JSON="$GLOBAL_JSON" NPM_ROOT_G="$(npm root -g)" node -e '
const d = (JSON.parse(process.env.GLOBAL_JSON).dependencies) || {};
const out = [];
if (d["ruflo"]) out.push(`전역 패키지 ruflo@${d["ruflo"].version} 가 있습니다(${d["ruflo"].resolved || "경로 미상"}). 설치하면 bin 이 겹칩니다.`);
const c = d["@claude-flow/cli"];
if (c) {
  const fs = require("fs"), path = require("path");
  let ours = false;
  try { ours = fs.existsSync(path.join(process.env.NPM_ROOT_G, "@claude-flow/cli/i18n/ko/help.json")); } catch {}
  if (!ours) out.push(`전역 @claude-flow/cli@${c.version} 가 한글판이 아닌 다른 설치본입니다(${c.resolved || c.path || "경로 미상"}).`);
}
// 한글판이 쓰는 bin 이름(cli·claude-flow·claude-flow-mcp·ruflo)을 가진 다른 전역 패키지는 설치 때 bin 을 덮거나 충돌한다.
const MINE = new Set(["cli", "claude-flow", "claude-flow-mcp", "ruflo"]);
for (const name of Object.keys(d)) {
  if (name === "@claude-flow/cli" || name === "ruflo") continue;
  try {
    const fs = require("fs"), path = require("path");
    const pj = JSON.parse(fs.readFileSync(path.join(process.env.NPM_ROOT_G, name, "package.json"), "utf8"));
    const bins = typeof pj.bin === "string" ? [String(pj.name || name).replace(/^@[^/]+\//, "")] : Object.keys(pj.bin || {});
    const hit = bins.filter((b) => MINE.has(b));
    if (hit.length) out.push(`전역 패키지 ${name}@${pj.version || "?"} 가 같은 bin(${hit.join(", ")})을 가지고 있어 충돌합니다.`);
  } catch {}
}
process.stdout.write(out.join("\n"));
')"
  # PATH 의 ruflo 가 전역 prefix 밖에 있으면 설치 뒤에도 그쪽이 먼저 잡힌다.
  NPM_BIN="$(npm prefix -g)/bin"
  other="$(command -v ruflo 2>/dev/null || true)"
  if [ -n "$other" ] && [ "$(dirname "$other")" != "$NPM_BIN" ]; then
    problems="${problems:+$problems$'\n'}PATH 의 ruflo 가 전역 prefix 밖($other)에 있어, 설치 뒤에도 그것이 먼저 실행됩니다."
  fi
  if [ -n "$problems" ]; then
    while IFS= read -r line; do warn "$line"; done <<< "$problems"
    if [ "$FORCE" -eq 1 ]; then
      warn "--force: 경고를 무시하고 계속합니다."
    else
      die "전역 사전 점검에서 경고가 나왔습니다. 확인 뒤 --force 로 다시 실행하거나 --no-global 로 설치를 건너뛰세요."
    fi
  fi
  step_ok

  # -------------------------------------------------------------- ⑨ 전역 설치
  step_begin "⑨ npm install -g"
  npm install -g "$TGZ"
  step_ok
fi

# ---------------------------------------------------------------- ⑩ 마켓플레이스 고정 스냅숏
step_begin "⑩ 마켓플레이스 스냅숏"
mkdir -p "$(dirname "$MK")"
MK_TMP="$(mktemp -d "$(dirname "$MK")/.mk.XXXXXX")"
git -C "$REPO" archive HEAD .claude-plugin plugins | tar -x -C "$MK_TMP"
git -C "$REPO" rev-parse HEAD > "$MK_TMP/.ruflo-ko-commit"
rm -rf "$MK"
mv "$MK_TMP" "$MK"
MK_TMP=""
[ -f "$MK/.claude-plugin/marketplace.json" ] || die "스냅숏에 marketplace.json 이 없습니다"
echo "[install-ko] 마켓플레이스 스냅숏: $MK ($(cat "$MK/.ruflo-ko-commit"))"
step_ok

# ---------------------------------------------------------------- ⑪ 확인
step_begin "⑪ 확인"
if [ "$NO_GLOBAL" -eq 1 ]; then
  echo "[install-ko] --no-global: 설치본 실행 확인은 건너뛰고 tgz 안의 파일만 확인했습니다(⑦)."
else
  RBIN="$(npm prefix -g)/bin/ruflo"
  [ -x "$RBIN" ] || die "설치된 ruflo 를 찾지 못했습니다: $RBIN"
  # 사용자 홈의 설정·데몬을 건드리지 않도록 격리 HOME 과 자동 갱신·데몬 자동 시작 끄기로 돌린다.
  mkdir -p "$TEST_HOME"
  ISO=(env -u RUFLO_LANG HOME="$TEST_HOME" CLAUDE_FLOW_AUTO_UPDATE=false RUFLO_DAEMON_AUTOSTART=0)
  got="$("${ISO[@]}" "$RBIN" --version)"
  [ "$got" = "$EXPECT_VERSION_LINE" ] || die "ruflo --version 이 '$got' 입니다(기대: '$EXPECT_VERSION_LINE')"
  [ -f "$(npm root -g)/@claude-flow/cli/i18n/ko/help.json" ] || die "설치본에 i18n/ko/help.json 이 없습니다"
  n="$("${ISO[@]}" RUFLO_LANG=ko "$RBIN" --help 2>/dev/null | hangul_lines)"
  [ "${n:-0}" -ge 1 ] || die "RUFLO_LANG=ko ruflo --help 에 한글 줄이 없습니다"
  echo "[install-ko] ruflo --version = $got, 한글 도움말 줄 수 = $n"
  echo "[install-ko] 주의: ruflo 를 npm update -g 로 갱신하면 영어판으로 덮입니다. 갱신은 이 스크립트로 하세요."
fi
step_ok

CURRENT_STEP="(완료)"
echo "[install-ko] 모든 단계 OK"
