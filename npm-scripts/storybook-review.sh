#!/usr/bin/env bash
# Serve the workbench Storybook for any ref, on the tailnet, without publishing.
#
# GitHub Pages only ever shows main, so reviewing a branch's UI from a phone
# needs a server on this host. This keeps one detached review checkout under
# reader-worktrees/, points it at the ref asked for, and serves it on 0.0.0.0
# so the printed <hostname>:6007 URL resolves from anywhere on the tailnet.
#
# The review checkout is disposable: every run force-detaches it onto the
# requested commit, so nothing may be authored there. The main checkout is only
# read from — the ref is resolved and fetched through it, never checked out.
#
# npm ci runs only when node_modules is absent or package-lock.json moved, and
# holds the shared install lock while it does, because installs on this host
# are memory-hungry enough to collide with other work. Codegen is `make`, which
# decides for itself what the new ref actually invalidated.
#
# Usage:
#   npm run storybook:review                  # origin/main
#   npm run storybook:review -- some-branch   # any branch, tag or commit
#   npm run storybook:review:down             # stop the server
#   npm run storybook:review:down -- --remove # stop it and drop the checkout
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REVIEW_DIR="$HOME/development/reader-worktrees/storybook-review"
STATE_DIR="$HOME/development/.tmp/storybook-review"
PID_FILE="$STATE_DIR/server.pid"
LOG_FILE="$STATE_DIR/server.log"
LOCK_FILE="$HOME/development/.tmp/npm-install.lock"
PORT=6007

usage() {
	cat <<'EOF'
usage: npm run storybook:review [-- <ref>]
       npm run storybook:review:down [-- --remove]

  <ref>      branch, tag or commit to review (default: origin/main)
  --down     stop the review server
  --remove   with --down, also delete the review checkout
EOF
}

MODE=start
REMOVE=no
REF=""
while [ $# -gt 0 ]; do
	case "$1" in
	--down) MODE=down ;;
	--remove) REMOVE=yes ;;
	-h | --help)
		usage
		exit 0
		;;
	-*)
		echo "storybook-review: unknown option '$1'" >&2
		usage >&2
		exit 1
		;;
	*)
		if [ -n "$REF" ]; then
			echo "storybook-review: expected one ref, got '$REF' and '$1'" >&2
			exit 1
		fi
		REF="$1"
		;;
	esac
	shift
done

# The pid names the npm parent, whose command line carries the review checkout's
# path. Matching on that is what keeps a teardown from reaching a Storybook
# somebody else started on this host.
review_server_pid() {
	[ -f "$PID_FILE" ] || return 1
	local pid
	pid="$(cat "$PID_FILE")"
	[ -n "$pid" ] || return 1
	kill -0 "$pid" 2>/dev/null || return 1
	ps -p "$pid" -o args= 2>/dev/null | grep -qF "$REVIEW_DIR" || return 1
	echo "$pid"
}

stop_review_server() {
	local pid
	if ! pid="$(review_server_pid)"; then
		rm -f "$PID_FILE"
		return 0
	fi
	kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
	for _ in $(seq 1 20); do
		kill -0 "$pid" 2>/dev/null || break
		sleep 0.5
	done
	kill -KILL -- "-$pid" 2>/dev/null || true
	rm -f "$PID_FILE"
	echo "storybook-review: stopped the review server"
}

if [ "$MODE" = down ]; then
	stop_review_server
	if [ "$REMOVE" = yes ]; then
		git -C "$REPO_ROOT" worktree prune
		if [ -d "$REVIEW_DIR" ]; then
			git -C "$REPO_ROOT" worktree remove --force "$REVIEW_DIR"
			echo "storybook-review: removed $REVIEW_DIR"
		fi
	fi
	exit 0
fi

if [ "$REPO_ROOT" = "$REVIEW_DIR" ]; then
	echo "storybook-review: run this from the main checkout, not the review checkout" >&2
	exit 1
fi

if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
	exec 3<&- 3>&-
	echo "storybook-review: port ${PORT} is already in use" >&2
	echo "storybook-review: stop it with 'npm run storybook:review:down'" >&2
	exit 1
fi

REF="${REF:-origin/main}"
git -C "$REPO_ROOT" fetch origin --quiet --tags

# A bare branch name that only exists on the remote still names something
# reviewable, so resolve it against origin before giving up on it.
if ! SHA="$(git -C "$REPO_ROOT" rev-parse -q --verify "${REF}^{commit}")"; then
	if ! SHA="$(git -C "$REPO_ROOT" rev-parse -q --verify "origin/${REF}^{commit}")"; then
		echo "storybook-review: '${REF}' is not a branch, tag or commit" >&2
		exit 1
	fi
fi

mkdir -p "$STATE_DIR" "$(dirname "$REVIEW_DIR")"
git -C "$REPO_ROOT" worktree prune

if [ -d "$REVIEW_DIR/.git" ] || [ -f "$REVIEW_DIR/.git" ]; then
	git -C "$REVIEW_DIR" checkout --detach --force --quiet "$SHA"
elif [ -e "$REVIEW_DIR" ]; then
	echo "storybook-review: ${REVIEW_DIR} exists but is not a git checkout" >&2
	echo "storybook-review: remove it, then run this again" >&2
	exit 1
else
	git -C "$REPO_ROOT" worktree add --detach --quiet "$REVIEW_DIR" "$SHA"
fi
echo "storybook-review: reviewing ${REF} (${SHA})"

LOCK_STAMP="$REVIEW_DIR/node_modules/.storybook-review-lockfile"
WANT_LOCK="$(cksum <"$REVIEW_DIR/package-lock.json")"
if [ ! -f "$LOCK_STAMP" ] || [ "$(cat "$LOCK_STAMP")" != "$WANT_LOCK" ]; then
	echo "storybook-review: installing dependencies"
	flock "$LOCK_FILE" npm --prefix "$REVIEW_DIR" ci
	echo "$WANT_LOCK" >"$LOCK_STAMP"
fi

echo "storybook-review: generating API packages"
npm --prefix "$REVIEW_DIR" run codegen

setsid npm --prefix "$REVIEW_DIR" run storybook:host -w @remit/workbench \
	>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

# Storybook prebundles on a cold checkout, so the URL is only printed once the
# port answers — and the process is rechecked each round, so a server that died
# on startup reports itself instead of timing out silently.
for _ in $(seq 1 240); do
	if ! review_server_pid >/dev/null; then
		echo "storybook-review: the server exited; last output:" >&2
		tail -n 20 "$LOG_FILE" >&2
		rm -f "$PID_FILE"
		exit 1
	fi
	if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
		exec 3<&- 3>&-
		echo "storybook-review: serving ${REF} at http://$(hostname):${PORT}"
		echo "storybook-review: logs in ${LOG_FILE}"
		exit 0
	fi
	sleep 1
done

echo "storybook-review: the server did not answer on port ${PORT}; last output:" >&2
tail -n 20 "$LOG_FILE" >&2
stop_review_server
exit 1
