#!/usr/bin/env bash
# Sync the locally installed CLI Proxy API stack with the source checkouts.
#
#   bun run sync:local              deploy whatever changed
#   bun run sync:local --dry-run    only report what would happen
#   bun run sync:local --force      redeploy everything
#
# Each piece is deployed only when its source has changed since the last sync:
#   backend  backend/ submodule (Go)        -> rebuild, swap binary, restart proxy
#   indexer  tools/request-archive/*.py -> copy, restart indexer agent
#   frontend this repo                  -> bun run build, copy management.html
# Restarting the proxy clears its in-memory usage statistics, so the proxy is
# never restarted unless the files that make up the binary have changed.
# Docs, tests, and other non-binary files do not count as a backend change.
set -euo pipefail

FRONTEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="${CPA_BACKEND_DIR:-$FRONTEND_DIR/backend}"
INSTALL_DIR="${CPA_INSTALL_DIR:-$HOME/.local/share/cliproxyapi}"
STATIC_DIR="${CPA_STATIC_DIR:-$HOME/.config/cliproxyapi/static}"
PROXY_URL="${CPA_PROXY_URL:-http://127.0.0.1:8317}"
PROXY_AGENT="${CPA_PROXY_AGENT:-com.local.cliproxyapi}"
INDEXER_AGENT="${CPA_INDEXER_AGENT:-com.local.cliproxyapi-request-index}"

BINARY="$INSTALL_DIR/cli-proxy-api"
INDEXER_SRC="$BACKEND_DIR/tools/request-archive"
INDEXER_DST="$INSTALL_DIR/request-archive"
PANEL="$STATIC_DIR/management.html"
STATE_DIR="$INSTALL_DIR/sync-state"
BACKUP_ROOT="$INSTALL_DIR/backups"

# Files that end up in the Go binary (embedded assets live under internal/).
BACKEND_PATHS=(go.mod go.sum tools/archive-upstream-base cmd internal sdk
  ':(exclude,glob)**/*_test.go' ':(exclude,glob)**/testdata/**' ':(exclude,glob)**/*.md')
# Files that affect the built dashboard.
FRONTEND_PATHS=(. ':(exclude)backend' ':(exclude)tests' ':(exclude)scripts' ':(exclude).github'
  ':(exclude,glob)**/*.md' ':(exclude)LICENSE')

DRY_RUN=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run | -n) DRY_RUN=1 ;;
    --force | -f) FORCE=1 ;;
    -h | --help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '%-9s %s\n' "$1" "$2"; }
die() { echo "error: $*" >&2; exit 1; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

# Content hash of the given paths in a git checkout, including uncommitted and
# untracked (non-ignored) files. Depends only on file contents, not on commits.
fingerprint() {
  local repo=$1
  shift
  (
    cd "$repo"
    local list
    list=$(mktemp)
    git ls-files -co --exclude-standard -- "$@" | while IFS= read -r p; do
      [ -f "$p" ] && printf '%s\n' "$p"
    done | LC_ALL=C sort -u >"$list"
    git hash-object --stdin-paths <"$list" | paste "$list" - | shasum -a 256 | cut -d' ' -f1
    rm -f "$list"
  )
}

read_state() { cat "$STATE_DIR/$1" 2>/dev/null || true; }
write_state() {
  [ "$DRY_RUN" = 1 ] && return 0
  mkdir -p "$STATE_DIR"
  printf '%s\n' "$2" >"$STATE_DIR/$1"
}

restart_agent() { launchctl kickstart -k "gui/$(id -u)/$1"; }

wait_for_proxy() {
  local i status
  for i in $(seq 1 30); do
    # Management traffic is excluded from full request recording. A public-root
    # probe can wait on archive I/O even when the server is already accepting calls.
    status=$(curl -sS -o /dev/null --max-time 2 -w '%{http_code}' \
      "$PROXY_URL/v8/management/observability/archive" 2>/dev/null) || status=
    case "$status" in
      200 | 401) return 0 ;;
    esac
    sleep 1
  done
  return 1
}

[ -e "$BACKEND_DIR/.git" ] || die "backend not found at $BACKEND_DIR (run: git submodule update --init)"
[ -x "$BINARY" ] || die "installed proxy binary not found at $BINARY"
for tool in go bun git shasum curl launchctl python3; do
  command -v "$tool" >/dev/null || die "$tool is not on PATH"
done

LOCK="$STATE_DIR.lock"
if [ "$DRY_RUN" = 0 ]; then
  mkdir -p "$(dirname "$LOCK")"
  mkdir "$LOCK" 2>/dev/null || die "another sync is running (remove $LOCK if it is stale)"
fi
WORK=$(mktemp -d)
cleanup() {
  rm -rf "$WORK"
  [ "$DRY_RUN" = 1 ] || rmdir "$LOCK" 2>/dev/null || true
}
trap cleanup EXIT

[ "$DRY_RUN" = 1 ] && echo "(dry run: nothing will be built, copied, or restarted)"
STAMP=$(date +%Y%m%d%H%M%S)

# --- backend -----------------------------------------------------------------
backend_fp=$(fingerprint "$BACKEND_DIR" "${BACKEND_PATHS[@]}")
installed_fp=$(read_state backend.fingerprint)
if [ -z "$installed_fp" ]; then
  # First sync: trust the binary if it was built from a clean copy of HEAD.
  info=$(go version -m "$BINARY" 2>/dev/null || true)
  rev=$(printf '%s\n' "$info" | sed -n 's/.*vcs\.revision=\([0-9a-f]*\).*/\1/p')
  modified=$(printf '%s\n' "$info" | sed -n 's/.*vcs\.modified=\(.*\)$/\1/p')
  head=$(git -C "$BACKEND_DIR" rev-parse HEAD)
  dirty=$(git -C "$BACKEND_DIR" status --porcelain -- "${BACKEND_PATHS[@]}")
  if [ "$rev" = "$head" ] && [ "$modified" = false ] && [ -z "$dirty" ]; then
    installed_fp=$backend_fp
    write_state backend.fingerprint "$installed_fp"
  fi
fi

if [ "$FORCE" = 0 ] && [ "$backend_fp" = "$installed_fp" ]; then
  say backend "unchanged, proxy left running"
elif [ "$DRY_RUN" = 1 ]; then
  say backend "changed: would rebuild, swap binary, and restart the proxy"
else
  say backend "changed: building"
  "$BACKEND_DIR/tools/build-archive.sh" "$WORK/cli-proxy-api"
  go version -m "$WORK/cli-proxy-api" >/dev/null || die "built binary is not readable"
  backup="$BACKUP_ROOT/before-sync-$STAMP"
  mkdir -p "$backup"
  cp -p "$BINARY" "$backup/cli-proxy-api"
  cp "$WORK/cli-proxy-api" "$BINARY.new"
  mv -f "$BINARY.new" "$BINARY"
  say backend "restarting proxy (old binary saved in $backup)"
  if restart_agent "$PROXY_AGENT" && wait_for_proxy; then
    write_state backend.fingerprint "$backend_fp"
    say backend "deployed, proxy is responding"
  else
    say backend "proxy did not come back; restoring the previous binary"
    cp -p "$backup/cli-proxy-api" "$BINARY.new"
    mv -f "$BINARY.new" "$BINARY"
    restart_agent "$PROXY_AGENT"
    wait_for_proxy || die "proxy is still down after rollback; check $INSTALL_DIR/logs/stderr.log"
    die "new backend failed to start and was rolled back"
  fi
fi

# --- request archive indexer -------------------------------------------------
changed=()
for src in "$INDEXER_SRC"/*.py; do
  name=$(basename "$src")
  case "$name" in test_*) continue ;; esac
  dst="$INDEXER_DST/$name"
  if [ "$FORCE" = 1 ] || [ ! -f "$dst" ] || [ "$(sha "$src")" != "$(sha "$dst")" ]; then
    changed+=("$name")
  fi
done
if [ ${#changed[@]} -eq 0 ]; then
  say indexer "unchanged"
elif [ "$DRY_RUN" = 1 ]; then
  say indexer "changed (${changed[*]}): would copy and restart the indexer"
else
  for name in "${changed[@]}"; do
    python3 -m py_compile "$INDEXER_SRC/$name" || die "$name does not compile"
  done
  mkdir -p "$INDEXER_DST"
  for name in "${changed[@]}"; do
    cp "$INDEXER_SRC/$name" "$INDEXER_DST/$name.new"
    mv -f "$INDEXER_DST/$name.new" "$INDEXER_DST/$name"
  done
  restart_agent "$INDEXER_AGENT"
  say indexer "deployed ${changed[*]}, indexer restarted"
fi

# --- frontend ----------------------------------------------------------------
frontend_fp=$(fingerprint "$FRONTEND_DIR" "${FRONTEND_PATHS[@]}")
panel_sha=$([ -f "$PANEL" ] && sha "$PANEL" || true)
if [ "$FORCE" = 0 ] && [ "$frontend_fp" = "$(read_state frontend.fingerprint)" ] &&
  [ -n "$panel_sha" ] && [ "$panel_sha" = "$(read_state frontend.sha256)" ]; then
  say frontend "unchanged"
elif [ "$DRY_RUN" = 1 ]; then
  say frontend "changed or not yet synced: would build and copy management.html"
else
  say frontend "building"
  (cd "$FRONTEND_DIR" && bun run build)
  built="$FRONTEND_DIR/dist/index.html"
  [ -s "$built" ] || die "build did not produce $built"
  if [ "$(sha "$built")" = "$panel_sha" ]; then
    say frontend "build is identical to the installed dashboard"
  else
    mkdir -p "$STATIC_DIR"
    [ -f "$PANEL" ] && cp -p "$PANEL" "$PANEL.prev"
    cp "$built" "$PANEL.new"
    mv -f "$PANEL.new" "$PANEL"
    say frontend "deployed (reload the page; previous copy saved as management.html.prev)"
  fi
  write_state frontend.fingerprint "$frontend_fp"
  write_state frontend.sha256 "$(sha "$PANEL")"
fi
