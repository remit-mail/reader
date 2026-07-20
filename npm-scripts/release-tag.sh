#!/usr/bin/env bash
# Cut a release: create and push an annotated vX.Y.Z tag from HEAD, which
# triggers .github/workflows/release.yml. Refuses on a malformed version, a
# tag that already exists locally or on the remote, a dirty working tree, or
# a HEAD that is not origin/main's current commit — a release names a commit
# that has actually landed on main, not a branch tip.
#
# Usage: npm run release:tag -- vX.Y.Z
set -euo pipefail

VERSION="${1:?usage: release-tag.sh vX.Y.Z}"

if ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	echo "release: '${VERSION}' is not a valid version; expected vX.Y.Z" >&2
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

git tag -a "$VERSION" -m "$VERSION"
git push origin "$VERSION"
echo "release: pushed ${VERSION}"
