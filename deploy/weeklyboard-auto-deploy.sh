#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT=/www/wwwroot/zkb.yutianfu.me
STATE_ROOT="$APP_ROOT/.deploy"
ENV_FILE=/etc/weeklyboard/auto-deploy.env
SERVICE_NAME=weeklyboard.service
NODE_HOME=/www/server/nodejs/v24.11.0
NODE_BIN="$NODE_HOME/bin/node"
NPM_BIN="$NODE_HOME/bin/npm"
NODE_GYP="$NODE_HOME/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js"
PYTHON_BIN=/usr/bin/python3.11
REPO_DIR="$STATE_ROOT/repo"
RELEASE_ROOT="$STATE_ROOT/releases"
PREVIOUS_ROOT="$STATE_ROOT/previous"
DEPLOYED_FILE="$STATE_ROOT/deployed"
LOCK_FILE="$STATE_ROOT/lock"
swap_started=false
old_dist_moved=false
old_server_moved=false
old_src_moved=false
new_dist_moved=false
new_server_moved=false
new_src_moved=false

log() { printf '[%s] %s\n' "$(date -Is)" "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

rollback() {
  trap - ERR
  set +e
  log 'new release failed; rolling back previous live directories' >&2
  systemctl stop "$SERVICE_NAME" >/dev/null 2>&1
  failed_root="$STATE_ROOT/failed/${remote_sha}-$(date +%Y%m%d%H%M%S)"
  install -d -m 0750 "$failed_root"
  if [[ "$new_dist_moved" == true && -e "$APP_ROOT/dist" ]]; then
    mv -- "$APP_ROOT/dist" "$failed_root/dist"
  fi
  if [[ "$new_server_moved" == true && -e "$APP_ROOT/server" ]]; then
    mv -- "$APP_ROOT/server" "$failed_root/server"
  fi
  if [[ "$new_src_moved" == true && -e "$APP_ROOT/src" ]]; then
    mv -- "$APP_ROOT/src" "$failed_root/src"
  fi
  if [[ "$old_dist_moved" == true && -e "$PREVIOUS_ROOT/dist" ]]; then
    mv -- "$PREVIOUS_ROOT/dist" "$APP_ROOT/dist"
  fi
  if [[ "$old_server_moved" == true && -e "$PREVIOUS_ROOT/server" ]]; then
    mv -- "$PREVIOUS_ROOT/server" "$APP_ROOT/server"
  fi
  if [[ "$old_src_moved" == true && -e "$PREVIOUS_ROOT/src" ]]; then
    mv -- "$PREVIOUS_ROOT/src" "$APP_ROOT/src"
  fi
  if [[ -d "$APP_ROOT/server/data" ]]; then
    chown -R www:www "$APP_ROOT/server/data"
  fi
  systemctl start "$SERVICE_NAME" >/dev/null 2>&1
  swap_started=false
  set -e
}

on_error() {
  rc=$?
  if [[ "$swap_started" == true ]]; then rollback; fi
  log "failed line=${LINENO} exit=${rc}" >&2
  exit "$rc"
}
trap on_error ERR

[[ -r "$ENV_FILE" ]] || fail "missing $ENV_FILE"
# shellcheck disable=SC1090
. "$ENV_FILE"
: "${DEPLOY_REPO:?DEPLOY_REPO is required in $ENV_FILE}"
: "${DEPLOY_BRANCH:?DEPLOY_BRANCH is required in $ENV_FILE}"

git check-ref-format --branch "$DEPLOY_BRANCH" >/dev/null || fail "invalid deploy branch: $DEPLOY_BRANCH"
[[ -x "$NODE_BIN" ]] || fail "missing Node runtime: $NODE_BIN"
[[ -x "$NPM_BIN" ]] || fail "missing npm runtime: $NPM_BIN"
[[ -f "$NODE_GYP" ]] || fail "missing node-gyp: $NODE_GYP"
[[ -x "$PYTHON_BIN" ]] || fail "missing Python runtime: $PYTHON_BIN"

install -d -m 0750 "$STATE_ROOT" "$RELEASE_ROOT"
touch "$LOCK_FILE"
chmod 0600 "$LOCK_FILE"
exec 9>"$LOCK_FILE"
flock -n 9 || { log 'another deployment check is already running'; exit 0; }

export PATH="$NODE_HOME/bin:/usr/bin:/usr/sbin:/bin:/sbin"
export npm_config_python="$PYTHON_BIN"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  [[ ! -e "$REPO_DIR" ]] || fail "deployment repo path exists but is not a Git repository: $REPO_DIR"
  log "cloning $DEPLOY_REPO branch=$DEPLOY_BRANCH"
  git clone --branch "$DEPLOY_BRANCH" --single-branch "$DEPLOY_REPO" "$REPO_DIR"
  baseline_sha=$(git -C "$REPO_DIR" rev-parse "origin/$DEPLOY_BRANCH")
  printf 'branch=%s\nsha=%s\n' "$DEPLOY_BRANCH" "$baseline_sha" > "$DEPLOYED_FILE"
  chmod 0600 "$DEPLOYED_FILE"
  log "Git baseline initialized at $baseline_sha; live files were not changed"
  exit 0
fi

git -C "$REPO_DIR" remote set-url origin "$DEPLOY_REPO"
git -C "$REPO_DIR" fetch --prune origin "$DEPLOY_BRANCH"
remote_ref="origin/$DEPLOY_BRANCH"
remote_sha=$(git -C "$REPO_DIR" rev-parse "$remote_ref")

deployed_branch=''
deployed_sha=''
if [[ -r "$DEPLOYED_FILE" ]]; then
  deployed_branch=$(sed -n 's/^branch=//p' "$DEPLOYED_FILE" | head -n 1)
  deployed_sha=$(sed -n 's/^sha=//p' "$DEPLOYED_FILE" | head -n 1)
fi
if [[ "$deployed_branch" == "$DEPLOY_BRANCH" && "$deployed_sha" == "$remote_sha" ]]; then
  log "no change on $DEPLOY_BRANCH at $remote_sha"
  exit 0
fi

git -C "$REPO_DIR" checkout -q -B "$DEPLOY_BRANCH" "$remote_ref"
release_dir="$RELEASE_ROOT/$remote_sha"
rm -rf -- "$release_dir"
install -d -m 0755 "$release_dir"
git -C "$REPO_DIR" archive "$remote_sha" | tar -x -C "$release_dir"

log "building branch=$DEPLOY_BRANCH sha=$remote_sha"
(
  cd "$release_dir"
  "$NPM_BIN" ci
  if grep -Fq "const API = 'http://127.0.0.1:8787/api';" src/main.jsx; then
    sed -i "s#const API = 'http://127.0.0.1:8787/api';#const API = import.meta.env.VITE_API_BASE || '/api';#" src/main.jsx
    log 'applied production API path overlay'
  fi
  "$NPM_BIN" run build
  rm -rf -- node_modules
  cd server
  "$NPM_BIN" ci --omit=dev
  if [[ -d node_modules/better-sqlite3 ]]; then
    if [[ -f node_modules/better-sqlite3/prebuilds/linux-x64.node ]]; then
      mv node_modules/better-sqlite3/prebuilds/linux-x64.node \
        node_modules/better-sqlite3/prebuilds/linux-x64.node.incompatible-glibc
    fi
    (
      cd node_modules/better-sqlite3
      "$NODE_BIN" "$NODE_GYP" clean
      "$NODE_BIN" "$NODE_GYP" rebuild --release --force_build=1 --python="$PYTHON_BIN"
    )
    chmod 0755 node_modules/better-sqlite3/build node_modules/better-sqlite3/build/Release \
      node_modules/better-sqlite3/build/Release/better_sqlite3.node
  fi
)

smoke_root=$(mktemp -d /tmp/weeklyboard-smoke.XXXXXX)
cleanup_smoke() { rm -rf -- "$smoke_root"; }
trap cleanup_smoke EXIT
chown www:www "$smoke_root"
smoke_server="$smoke_root/server"
install -d -m 0750 -o www -g www "$smoke_root/data" "$smoke_server"
cp -a "$release_dir/server/." "$smoke_server/"
# server modules import shared code from ../src
cp -a "$release_dir/src" "$smoke_root/src"
chown -R www:www "$smoke_server" "$smoke_root/src"
smoke_log="$smoke_root/service.log"
if timeout 12s runuser -u www -- env \
    DEBUG_MODE=false \
    PORT=0 \
    DB_FILE="$smoke_root/data/weeklyboard.db" \
    JWT_SECRET="$(openssl rand -hex 48)" \
    "$NODE_BIN" "$smoke_server/index.js" >"$smoke_log" 2>&1; then
  smoke_rc=0
else
  smoke_rc=$?
fi
if ! grep -q 'weeklyboard api listening' "$smoke_log"; then
  cat "$smoke_log" >&2
  fail "release smoke test failed (timeout exit=$smoke_rc)"
fi
log "release smoke test passed"
trap - EXIT
cleanup_smoke

[[ -d "$APP_ROOT/dist" && -d "$APP_ROOT/server" ]] || fail "live layout is incomplete; refusing deployment"
rm -rf -- "$PREVIOUS_ROOT"
install -d -m 0750 "$PREVIOUS_ROOT"
systemctl stop "$SERVICE_NAME"
swap_started=true
mv -- "$APP_ROOT/dist" "$PREVIOUS_ROOT/dist"
old_dist_moved=true
mv -- "$APP_ROOT/server" "$PREVIOUS_ROOT/server"
old_server_moved=true
if [[ -e "$APP_ROOT/src" ]]; then
  mv -- "$APP_ROOT/src" "$PREVIOUS_ROOT/src"
  old_src_moved=true
fi
mv -- "$release_dir/dist" "$APP_ROOT/dist"
new_dist_moved=true
mv -- "$release_dir/server" "$APP_ROOT/server"
new_server_moved=true
mv -- "$release_dir/src" "$APP_ROOT/src"
new_src_moved=true
install -d -m 0750 -o www -g www "$APP_ROOT/server/data"
if [[ -d "$PREVIOUS_ROOT/server/data" ]]; then
  cp -a "$PREVIOUS_ROOT/server/data/." "$APP_ROOT/server/data/"
fi
chown -R root:root "$APP_ROOT/dist" "$APP_ROOT/server" "$APP_ROOT/src"
chown -R www:www "$APP_ROOT/server/data"
chmod 0750 "$APP_ROOT/server/data"
find "$APP_ROOT/server/data" -maxdepth 1 -type f -name '*.db' -exec chmod 0600 {} +

if ! systemctl start "$SERVICE_NAME"; then
  rollback
  fail 'systemd could not start the new release'
fi

healthy=false
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 http://127.0.0.1:8787/api/health | grep -q '"debugMode":false'; then
    healthy=true
    break
  fi
  sleep 1
done
if [[ "$healthy" != true ]]; then
  journalctl -u "$SERVICE_NAME" -n 40 --no-pager >&2 || true
  rollback
  fail 'new release health check failed'
fi

swap_started=false
printf 'branch=%s\nsha=%s\n' "$DEPLOY_BRANCH" "$remote_sha" > "$DEPLOYED_FILE"
chmod 0600 "$DEPLOYED_FILE"
rm -rf -- "$release_dir"
log "deployed branch=$DEPLOY_BRANCH sha=$remote_sha"
