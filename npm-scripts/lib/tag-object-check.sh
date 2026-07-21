#!/usr/bin/env bash
# Classifies the git object a release tag points at. Pure — no git, no I/O —
# so release-check-annotation.sh's decision is testable without a repository.
#
# A lightweight tag is a ref pointing straight at a commit; an annotated tag is
# its own `tag` object carrying a message. Only the annotated one has a summary
# to show on the update consent screen, so only the annotated one may release.
#
# Call with the exit status and stdout of `git cat-file -t refs/tags/<tag>`;
# echoes exactly one of:
#   annotated    — a tag object, which carries the authored annotation
#   lightweight  — a bare commit ref, which has no annotation of its own
#   abort        — the type could not be determined. A failed cat-file, an
#                  empty answer, or any other object type (a tag can point at
#                  a tree or a blob) must never be read as "annotated": this
#                  gate fails closed, because guessing here publishes a release
#                  whose consent screen has nothing legitimate to show.
classify_tag_object() {
	local status="$1"
	local object_type="${2//[[:space:]]/}"

	if [ "$status" -ne 0 ]; then
		echo abort
		return
	fi

	case "$object_type" in
	tag)
		echo annotated
		;;
	commit)
		echo lightweight
		;;
	*)
		echo abort
		;;
	esac
}
