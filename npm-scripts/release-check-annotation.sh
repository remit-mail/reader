#!/usr/bin/env bash
# Refuse a release whose tag carries no authored annotation.
#
# release-tag.sh is a convenience, not a gate: release.yml fires on any pushed
# v*.*.* tag, so a hand-pushed lightweight tag would otherwise cut a real
# release with no annotation at all. The annotation is the summary rendered
# verbatim on the self-update consent screen — the sentence someone reads
# before agreeing to replace their software — so the workflow, not the script,
# has to be the thing that insists on it.
#
# The tag object is fetched explicitly. actions/checkout does not fetch tag
# objects by default: on a tag push it fetches the commit and writes the local
# ref straight to it, so `git cat-file -t` answers `commit` for a perfectly
# good annotated tag. Reading that as "lightweight" would reject every real
# release. The explicit refspec below fetches the tag object itself, which is
# what makes the distinction meaningful here.
#
# Fails closed throughout. A fetch that fails, a type that cannot be
# determined, an object that is neither a tag nor a commit — all abort. The
# only path that proceeds is a fetched tag object whose message passes the
# same validation release-tag.sh applies (lib/summary-check.sh), so the two
# cannot disagree about what a valid summary is.
#
# Environment:
#   TAG     tag being released (e.g. v1.4.1). Required.
#   REMOTE  remote to fetch the tag object from. Default origin.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=npm-scripts/lib/tag-object-check.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/tag-object-check.sh"
# shellcheck source=npm-scripts/lib/summary-check.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/summary-check.sh"

TAG="${TAG:?TAG is required (e.g. v1.4.1)}"
REMOTE="${REMOTE:-origin}"

reject_unannotated() {
	echo "release: ${TAG} is a lightweight tag and carries no annotation" >&2
	echo "release: the annotation is the summary shown verbatim on the update consent" >&2
	echo "release: screen, so a release cannot be cut without one" >&2
	echo "release:" >&2
	echo "release: drop this tag and cut it again with an authored summary:" >&2
	echo "release:   git push ${REMOTE} :refs/tags/${TAG} && git tag -d ${TAG}" >&2
	echo "release:   npm run release:tag -- ${TAG} \"one-line summary of this release\"" >&2
	exit 1
}

echo "release: fetching the tag object for ${TAG} from ${REMOTE}"
if ! git fetch --no-tags --force "$REMOTE" "+refs/tags/${TAG}:refs/tags/${TAG}"; then
	echo "release: could not fetch the tag object for ${TAG}; refusing to guess" >&2
	exit 1
fi

status=0
object_type="$(git cat-file -t "refs/tags/${TAG}" 2>&1)" || status=$?

case "$(classify_tag_object "$status" "$object_type")" in
annotated) ;;
lightweight)
	reject_unannotated
	;;
abort)
	echo "release: could not determine what ${TAG} points at; refusing to guess" >&2
	echo "$object_type" >&2
	exit 1
	;;
esac

subject="$(git for-each-ref --format='%(contents:subject)' "refs/tags/${TAG}")"
body="$(git for-each-ref --format='%(contents:body)' "refs/tags/${TAG}")"

summary="$subject"
if [ -n "${body//[[:space:]]/}" ]; then
	summary="${subject}"$'\n'"${body}"
fi

summary_error="$(validate_summary "$summary")"
if [ -n "$summary_error" ]; then
	echo "release: ${TAG}'s annotation is not a usable summary: ${summary_error}" >&2
	echo "release: it is shown verbatim on the update consent screen" >&2
	echo "release:" >&2
	echo "release: drop this tag and cut it again with an authored summary:" >&2
	echo "release:   git push ${REMOTE} :refs/tags/${TAG} && git tag -d ${TAG}" >&2
	echo "release:   npm run release:tag -- ${TAG} \"one-line summary of this release\"" >&2
	exit 1
fi

echo "release: ${TAG} is annotated: ${summary}"
