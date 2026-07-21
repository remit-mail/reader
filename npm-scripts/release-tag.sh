#!/usr/bin/env bash
# Cut a release: create and push an annotated vX.Y.Z tag from HEAD, which
# triggers .github/workflows/release.yml.
#
# The tag's annotation message is the summary shown verbatim on the update
# consent screen (packages/data-ports/src/update-manifest.ts, `summary`), so
# it must be authored on the command line, never defaulted — a silent
# fallback here is exactly what puts user-facing nonsense in front of someone
# about to replace their software.
#
# Always creates an annotated tag, never lightweight: a lightweight tag has no
# annotation of its own, so a reader resolving the message against the
# underlying commit would show the last commit subject instead of the
# authored summary.
#
# Refuses on a malformed version, a summary that is empty, multi-line, or
# past the manifest schema's length limit (lib/summary-check.sh, kept in sync
# with that schema's `summary` field), a tag that already exists locally or on
# the remote, a dirty working tree, or a HEAD that is not origin/main's
# current commit — a release names a commit that has actually landed on main,
# not a branch tip.
#
# Usage: npm run release:tag -- vX.Y.Z "one-line summary of this release"
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=npm-scripts/lib/summary-check.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/summary-check.sh"

VERSION="${1:?usage: release-tag.sh vX.Y.Z \"one-line summary\"}"
SUMMARY="${2:?usage: release-tag.sh vX.Y.Z \"one-line summary\"}"

if ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	echo "release: '${VERSION}' is not a valid version; expected vX.Y.Z" >&2
	exit 1
fi

summary_error="$(validate_summary "$SUMMARY")"
if [ -n "$summary_error" ]; then
	echo "release: ${summary_error}" >&2
	exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
	echo "release: working tree is dirty; commit or stash before tagging" >&2
	exit 1
fi

if git rev-parse -q --verify "refs/tags/${VERSION}" >/dev/null; then
	echo "release: tag ${VERSION} already exists locally" >&2
	exit 1
fi

git fetch origin --quiet --tags
if git ls-remote --exit-code --tags origin "refs/tags/${VERSION}" >/dev/null 2>&1; then
	echo "release: tag ${VERSION} already exists on origin" >&2
	exit 1
fi

HEAD_SHA="$(git rev-parse HEAD)"
MAIN_SHA="$(git rev-parse origin/main)"
if [ "$HEAD_SHA" != "$MAIN_SHA" ]; then
	echo "release: HEAD (${HEAD_SHA}) is not origin/main (${MAIN_SHA})" >&2
	exit 1
fi

git tag -a "$VERSION" -m "$SUMMARY"
git push origin "$VERSION"
echo "release: pushed ${VERSION}"
