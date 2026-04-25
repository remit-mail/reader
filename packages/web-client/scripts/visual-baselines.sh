#!/usr/bin/env bash
# visual-baselines.sh — manage Playwright visual-regression baselines
# stored on the orphan `visual-baselines` branch.
#
# Subcommands:
#   fetch      — sync the orphan branch into a local cache and symlink it
#                into the path Playwright reads from.
#   publish    — commit & push the current baselines back to the orphan
#                branch. Run this after `npm run test:visual:update`.
#   status     — print where the cache is, what branch it's on, and any
#                pending changes.
#
# Layout:
#   <repo-root>/.visual-baselines/                   — git clone of branch
#   packages/remit-web-client/visual-regression/__screenshots__
#       -> <repo-root>/.visual-baselines/packages/remit-web-client/visual-regression/__screenshots__
#
# CI-safe: idempotent, no interactive prompts, exits non-zero on failure.

set -euo pipefail

BRANCH="visual-baselines"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(git -C "${PKG_DIR}" rev-parse --show-toplevel)"
CACHE_DIR="${REPO_ROOT}/.visual-baselines"
SNAPSHOT_REL="packages/remit-web-client/visual-regression/__screenshots__"
SNAPSHOT_LINK="${REPO_ROOT}/${SNAPSHOT_REL}"
SNAPSHOT_TARGET="${CACHE_DIR}/${SNAPSHOT_REL}"

# In CI we sometimes need to override the remote (e.g. fork PRs) — fall
# back to whatever `origin` resolves to in the consuming repo.
REMOTE_URL="${VISUAL_BASELINES_REMOTE:-$(git -C "${REPO_ROOT}" remote get-url origin)}"

# In GitHub Actions the checked-out repo's `.git/config` carries an
# `extraheader` with a short-lived token that authenticates against
# `github.com`. Fresh `git clone`s do NOT inherit that — so weave the
# token into the URL when one is available. Locally, GITHUB_TOKEN is
# usually empty and we just clone over the user's git credential
# helper.
if [[ -n "${GITHUB_TOKEN:-}" && "${REMOTE_URL}" =~ ^https://github\.com/ ]]; then
	REMOTE_URL="${REMOTE_URL/https:\/\//https://x-access-token:${GITHUB_TOKEN}@}"
fi

log() {
	printf '[visual-baselines] %s\n' "$*" >&2
}

# Strip the embedded `x-access-token:...@` from a URL before logging
# so the token never appears in CI output.
redact_url() {
	local url="$1"
	echo "${url//x-access-token:*@/x-access-token:***@}"
}

ensure_cache() {
	if [[ ! -d "${CACHE_DIR}/.git" ]]; then
		log "cloning ${BRANCH} from $(redact_url "${REMOTE_URL}") into ${CACHE_DIR}"
		rm -rf "${CACHE_DIR}"
		git clone --depth=1 --branch "${BRANCH}" --single-branch \
			"${REMOTE_URL}" "${CACHE_DIR}"
		return
	fi

	# Repoint origin if it drifted (e.g. local override).
	local current_url
	current_url="$(git -C "${CACHE_DIR}" remote get-url origin || true)"
	if [[ "${current_url}" != "${REMOTE_URL}" ]]; then
		log "updating cache remote: $(redact_url "${current_url}") -> $(redact_url "${REMOTE_URL}")"
		git -C "${CACHE_DIR}" remote set-url origin "${REMOTE_URL}"
	fi
}

ensure_symlink() {
	mkdir -p "${SNAPSHOT_TARGET}"

	# If something other than a correct symlink is already there, replace it.
	if [[ -L "${SNAPSHOT_LINK}" ]]; then
		local actual
		actual="$(readlink "${SNAPSHOT_LINK}")"
		if [[ "${actual}" == "${SNAPSHOT_TARGET}" ]]; then
			return
		fi
		log "replacing stale symlink ${SNAPSHOT_LINK} -> ${actual}"
		rm "${SNAPSHOT_LINK}"
	elif [[ -e "${SNAPSHOT_LINK}" ]]; then
		log "ERROR: ${SNAPSHOT_LINK} exists but is not a symlink. Refusing to clobber."
		log "Remove it manually if you intended to wipe local baselines."
		exit 1
	fi

	mkdir -p "$(dirname "${SNAPSHOT_LINK}")"
	ln -s "${SNAPSHOT_TARGET}" "${SNAPSHOT_LINK}"
	log "symlinked ${SNAPSHOT_REL} -> .visual-baselines/${SNAPSHOT_REL}"
}

cmd_fetch() {
	ensure_cache
	log "fetching latest ${BRANCH}"
	git -C "${CACHE_DIR}" fetch --depth=1 origin "${BRANCH}"
	# Hard-reset so any local edits in the cache are dropped — the cache
	# is a mirror of the remote, not a working branch.
	git -C "${CACHE_DIR}" reset --hard "origin/${BRANCH}"
	ensure_symlink
	local sha
	sha="$(git -C "${CACHE_DIR}" rev-parse HEAD)"
	log "cache is at ${BRANCH}@${sha}"
}

cmd_publish() {
	if [[ ! -d "${CACHE_DIR}/.git" ]]; then
		log "ERROR: no cache at ${CACHE_DIR}. Run 'npm run test:visual:fetch' first."
		exit 1
	fi

	# Make sure the cache has the freshest remote tip before we add to it.
	git -C "${CACHE_DIR}" fetch origin "${BRANCH}"
	# Stash any uncommitted PNGs so we can rebase, then reapply.
	local has_changes=0
	if ! git -C "${CACHE_DIR}" diff --quiet || ! git -C "${CACHE_DIR}" diff --cached --quiet \
		|| [[ -n "$(git -C "${CACHE_DIR}" ls-files --others --exclude-standard)" ]]; then
		has_changes=1
	fi

	if [[ "${has_changes}" -eq 0 ]]; then
		log "no baseline changes to publish"
		return
	fi

	# We're at a detached state on the orphan branch in the clone; switch
	# back to the named branch so the push has a target.
	git -C "${CACHE_DIR}" checkout -B "${BRANCH}" "origin/${BRANCH}" 2>/dev/null || \
		git -C "${CACHE_DIR}" checkout "${BRANCH}"

	git -C "${CACHE_DIR}" add -A "${SNAPSHOT_REL}"

	if git -C "${CACHE_DIR}" diff --cached --quiet; then
		log "no staged baseline changes after add — nothing to publish"
		return
	fi

	local source_sha source_short
	source_sha="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
	source_short="$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"

	local commit_msg
	commit_msg="update baselines from ${source_short}

Captured against ${source_sha}."

	GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-Visual Baselines Bot}" \
	GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-visual-baselines@remit.local}" \
	git -C "${CACHE_DIR}" \
		-c "user.name=${GIT_AUTHOR_NAME:-${GIT_COMMITTER_NAME:-Visual Baselines Bot}}" \
		-c "user.email=${GIT_AUTHOR_EMAIL:-${GIT_COMMITTER_EMAIL:-visual-baselines@remit.local}}" \
		commit -m "${commit_msg}"

	log "pushing ${BRANCH}"
	git -C "${CACHE_DIR}" push origin "${BRANCH}"

	local sha
	sha="$(git -C "${CACHE_DIR}" rev-parse HEAD)"
	log "published ${BRANCH}@${sha}"
}

cmd_status() {
	if [[ ! -d "${CACHE_DIR}/.git" ]]; then
		log "no cache at ${CACHE_DIR}"
		exit 0
	fi
	log "cache: ${CACHE_DIR}"
	log "remote: $(redact_url "$(git -C "${CACHE_DIR}" remote get-url origin)")"
	log "head:   $(git -C "${CACHE_DIR}" rev-parse HEAD)"
	log "branch: $(git -C "${CACHE_DIR}" rev-parse --abbrev-ref HEAD)"
	log "diff vs origin/${BRANCH}:"
	git -C "${CACHE_DIR}" status --short
}

main() {
	local cmd="${1:-fetch}"
	case "${cmd}" in
		fetch) cmd_fetch ;;
		publish) cmd_publish ;;
		status) cmd_status ;;
		*)
			log "unknown subcommand: ${cmd}"
			log "usage: visual-baselines.sh [fetch|publish|status]"
			exit 1
			;;
	esac
}

main "$@"
