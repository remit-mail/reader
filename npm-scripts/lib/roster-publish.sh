#!/usr/bin/env bash
# Pure decision, no I/O: given one classify_manifest_check verdict per roster
# image (exists|absent|abort, passed as arguments), decide whether the nightly
# in images.yml has anything to build. It builds unless every image is already
# present at the tip's sha tag — a fully-imaged tip is a green no-op.
#
# This inverts release-check-tag's fail-closed stance on purpose. There the tag
# is an immutable vX.Y.Z release, so any doubt refuses rather than risk
# overwriting it. Here the tag is sha-<commit>: content-addressed and idempotent
# to re-push, so any doubt builds. `absent` (an un-imaged commit) and `abort`
# (a never-published new service, or a transient registry-read error) both
# resolve to build — a genuine auth or push failure then surfaces in
# build-and-push, never masked here as a skip.
roster_build_decision() {
	for verdict in "$@"; do
		if [ "$verdict" != "exists" ]; then
			echo true
			return
		fi
	done
	echo false
}
