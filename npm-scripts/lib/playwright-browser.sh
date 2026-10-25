#!/usr/bin/env bash
# Install a Playwright browser, and its system packages only when the browser
# it downloaded cannot load a shared library. Sourced, never run.
#
# `install --with-deps` runs apt on every call. The CI runner image already
# carries Chromium's libraries, so that apt run proved nothing and, when the
# mirror was slow, took ten minutes and timed the story suite out (#1458). A
# host without root or passwordless sudo cannot run it at all.
set -euo pipefail

playwright_missing_libraries() {
	local browsers="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
	[ -d "$browsers" ] || return 0
	# ldd exits non-zero on a file it cannot inspect; what it printed for the
	# others still counts, and a browser it could not read fails at launch.
	{
		find "$browsers" -type f \( -name chrome -o -name chrome-headless-shell \) \
			-exec ldd {} + 2>/dev/null || true
	} | awk '/not found/ { print $1 }' | sort -u | tr '\n' ' '
}

# playwright_install <playwright binary> <browser> [install flags...]
playwright_install() {
	local playwright=$1 browser=$2
	shift 2

	"$playwright" install "$@" "$browser"

	local missing
	missing=$(playwright_missing_libraries)
	if [ -z "$missing" ]; then
		return 0
	fi

	echo "playwright: $browser cannot load ${missing}; installing its system packages"
	if [ "$(id -u)" -ne 0 ] && ! { command -v sudo >/dev/null && sudo -n true 2>/dev/null; }; then
		echo "playwright: installing system packages needs root or passwordless sudo; install them on this host: $playwright install-deps $browser" >&2
		return 1
	fi
	"$playwright" install-deps "$browser"
}
