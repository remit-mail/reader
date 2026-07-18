#!/bin/sh
#
# Remit self-host installer (RFC 035 D3: published images only, no repo
# checkout on the server). Downloads the deploy assets for one pinned ref,
# writes .env, and brings the stack up.
#
#   export GITHUB_TOKEN=ghp_...
#   curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/remit-mail/remit/contents/deploy/vps/install.sh?ref=main" \
#     | sh -s -- --origin https://your-host
#
# Runs under `curl | sh`, where stdin is the script itself: there is no
# prompting, ever. Everything comes from flags and environment variables.

set -eu

REPO=remit-mail/remit

# The images are public and pull anonymously; the repo is not. The token is
# only for reading deploy/vps/*. raw.githubusercontent.com cannot carry one
# for a private repo's file, so the assets come through the contents API,
# which can. INSTALL_RAW_URL is what the command becomes once the repo is
# public: documented, not used.
INSTALL_API_URL="https://api.github.com/repos/$REPO/contents/deploy/vps/install.sh?ref=main"
INSTALL_RAW_URL="https://raw.githubusercontent.com/$REPO/main/deploy/vps/install.sh"

MANIFEST=.remit-assets

ASSETS="docker-compose.yml
elasticmq.conf
remit.env.template
remit
caddy/routes.caddy
caddy/off.caddy
caddy/internal.caddy
caddy/tailscale.caddy
caddy/acme.caddy
backup/backup.sh"

# search-index-worker alone is ~1.36 GB (it bakes in a 449 MB embedding
# model); the rest of the roster plus postgres and the volumes bring a
# working box to roughly 4 GB. 8 GB is the floor that leaves room to pull an
# update alongside the running version.
MIN_DISK_KB=8388608
# A 4 GB box reports a little under 4 GB of MemTotal once the kernel has
# taken its share, so the warn line sits below the nominal size.
MIN_MEM_KB=3500000

DIR=/opt/remit
REF=main
TAG=latest
TAG_SET=0
TLS_MODE=internal
TLS_MODE_SET=0
ORIGIN=""
INSTALL_DEPS=0
ORIGINAL_ARGS=""
WRAPPER_MANUAL=""

PKG=""
DISTRO="this system"
SUDO=""

say() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }

die() {
	printf '\nerror: %s\n' "$1" >&2
	exit 1
}

usage() {
	cat <<EOF
Remit self-host installer.

Usage:
  export GITHUB_TOKEN=ghp_...
  curl -fsSL -H "Authorization: Bearer \$GITHUB_TOKEN" -H "Accept: application/vnd.github.raw" \\
    "$INSTALL_API_URL" \\
    | sh -s -- --origin <url> [options]

  The token reads deploy/vps/* out of the private repo. The images are public,
  so nothing else needs it. Once the repo is public this is the whole command:

  curl -fsSL $INSTALL_RAW_URL | sh -s -- --origin <url> [options]

Required:
  --origin <url>        Public origin, scheme://host, no trailing path. This is
                        the address you load the app from. https:// for the
                        default internal mode (an http:// origin is upgraded to
                        it and served over Caddy's redirect); http:// only for
                        --tls-mode off.

Options:
  --tls-mode <mode>     internal | off | tailscale | acme   (default: internal)
                        internal   HTTPS on :443 with Caddy's own CA, no
                                   external deps; browsers warn until you trust
                                   its root. The default: https works out of
                                   the box.
                        off        plain HTTP; reach it over a tailnet/VPN/tunnel
                        tailscale  HTTPS via the local tailscaled
                        acme       public Let's Encrypt, needs public DNS + 80/443
  --tag <tag>           Image tag: sha-<git-sha> or latest   (default: latest)
  --dir <path>          Install directory                    (default: /opt/remit)
  --ref <git-ref>       Ref to take the deploy assets from   (default: main)
  --install-deps        Install missing host dependencies (docker engine,
                        compose v2 plugin, curl, openssl). Off by default:
                        without it, missing dependencies are reported with the
                        exact commands to install them, and nothing is changed.
  --help                This message.

Environment:
  GITHUB_TOKEN          A token with read access to $REPO. Needed only while
                        the repo is private, and only to download deploy/vps/*.
                        The images are public: no registry login, no
                        read:packages scope, nothing to rotate.
  TAILSCALED_SOCKET     Host path of the tailscaled socket, for
                        --tls-mode tailscale
                        (default: /var/run/tailscale/tailscaled.sock)
EOF
}

quote() {
	case "$1" in
	*[!A-Za-z0-9_@%+=:,./-]*)
		printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
		;;
	*) printf '%s' "$1" ;;
	esac
}

# Every error path below prints this as the command to run once the problem is
# fixed, so it has to be one that works: while the repo is private that means
# the contents API and a token. $GITHUB_TOKEN is printed literally, never
# expanded — the token itself must not reach stdout, and the operator's shell
# already holds it.
rerun_command() {
	if [ -z "${GITHUB_TOKEN:-}" ]; then
		printf 'export GITHUB_TOKEN=ghp_...\n  '
	fi
	# shellcheck disable=SC2016  # $GITHUB_TOKEN is printed, not expanded: see above
	printf 'curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github.raw" "%s" | sh -s --%s' \
		"$INSTALL_API_URL" "$ORIGINAL_ARGS"
}

parse_args() {
	for _a in "$@"; do
		ORIGINAL_ARGS="$ORIGINAL_ARGS $(quote "$_a")"
	done
	while [ $# -gt 0 ]; do
		case "$1" in
		--origin)
			[ $# -ge 2 ] || die "--origin needs a value"
			ORIGIN=$2
			shift 2
			;;
		--tls-mode)
			[ $# -ge 2 ] || die "--tls-mode needs a value"
			TLS_MODE=$2
			TLS_MODE_SET=1
			shift 2
			;;
		--tag)
			[ $# -ge 2 ] || die "--tag needs a value"
			TAG=$2
			TAG_SET=1
			shift 2
			;;
		--dir)
			[ $# -ge 2 ] || die "--dir needs a value"
			DIR=$2
			shift 2
			;;
		--ref)
			[ $# -ge 2 ] || die "--ref needs a value"
			REF=$2
			shift 2
			;;
		--install-deps)
			INSTALL_DEPS=1
			shift
			;;
		--help | -h)
			usage
			exit 0
			;;
		*) die "unknown option '$1' (--help lists them all)" ;;
		esac
	done
}

# ---------------------------------------------------------------------------
# Host dependencies
# ---------------------------------------------------------------------------

detect_host() {
	if [ -r /etc/os-release ]; then
		# shellcheck disable=SC1091  # host file, not shipped with this script
		DISTRO=$(. /etc/os-release && printf '%s' "${PRETTY_NAME:-${NAME:-this system}}")
	fi
	if command -v apt-get >/dev/null 2>&1; then
		PKG=apt
	elif command -v dnf >/dev/null 2>&1; then
		PKG=dnf
	elif command -v apk >/dev/null 2>&1; then
		PKG=apk
	fi
	if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1; then
		SUDO="sudo "
	fi
}

pkg_install_cmd() {
	case "$PKG" in
	apt) printf '%sapt-get update && %sapt-get install -y %s' "$SUDO" "$SUDO" "$*" ;;
	dnf) printf '%sdnf install -y %s' "$SUDO" "$*" ;;
	apk) printf '%sapk add --no-cache %s' "$SUDO" "$*" ;;
	esac
}

docker_install_cmd() {
	case "$PKG" in
	# get.docker.com covers Debian/Ubuntu/Fedora/RHEL and installs the engine
	# and the compose v2 plugin together. It has no Alpine support.
	apt | dnf) printf 'curl -fsSL https://get.docker.com | %ssh' "$SUDO" ;;
	apk) printf '%sapk add --no-cache docker docker-cli-compose && %src-update add docker default && %sservice docker start' "$SUDO" "$SUDO" "$SUDO" ;;
	esac
}

# The two conventional podman socket paths: system-wide (rootful) and
# per-user (rootless). Either being a live socket means podman itself is on
# this host and reachable, whether or not DOCKER_HOST is pointed at it yet.
find_podman_socket() {
	if [ -S /run/podman/podman.sock ]; then
		printf '/run/podman/podman.sock'
		return 0
	fi
	_rootless_sock="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/podman/podman.sock"
	if [ -S "$_rootless_sock" ]; then
		printf '%s' "$_rootless_sock"
		return 0
	fi
	return 1
}

# True when docker (directly, or via a docker=podman shim) is actually
# talking to podman — whether that's DOCKER_HOST pointed at podman's socket,
# or /usr/bin/docker being the podman-docker package's shim. podman's own
# `docker version` output names its server component "Podman Engine"; real
# dockerd never does.
is_podman_backend() {
	docker version --format '{{.Server.Components}}' 2>/dev/null | grep -q 'Podman Engine'
}

is_podman_rootless() {
	docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -q rootless
}

docker_daemon_hint() {
	_err=$1
	case "$_err" in
	*"permission denied"*)
		if printf '%s %s' "${DOCKER_HOST:-}" "$_err" | grep -q podman; then
			die "cannot reach the podman socket — permission denied.

This is a socket ownership problem, not the docker group (that advice only
applies to a real docker daemon). Confirm podman.socket is running as the
same user DOCKER_HOST points at, and that this user can read the socket:

  systemctl --user status podman.socket   # rootless
  systemctl status podman.socket          # rootful

Then re-run:

  $(rerun_command)"
		fi
		die "the docker daemon socket is not readable by $(id -un).

Adding yourself to the docker group needs a new login to take effect — doing it
and re-running in this same shell will fail the same way:

  ${SUDO}usermod -aG docker $(id -un)
  newgrp docker          # or log out and back in

Then re-run:

  $(rerun_command)

Running the installer as root avoids this entirely."
		;;
	*"Cannot connect to the Docker daemon"* | *"daemon running"* | *"failed to connect to the docker API"*)
		if _podman_sock=$(find_podman_socket) && [ -z "${DOCKER_HOST:-}" ]; then
			die "no docker daemon is reachable, but podman provides one at $_podman_sock.

Point the docker CLI at it instead of installing or starting a separate
docker daemon — this is the supported way to run remit under podman (plain
'docker compose' behaves as documented once it talks to this socket;
podman-compose itself is refused by this installer — see --help):

  export DOCKER_HOST=unix://$_podman_sock
  $(rerun_command)"
		fi
		die "docker is installed but the daemon is not reachable. Start and enable it:

  ${SUDO}systemctl enable --now docker

Then re-run:

  $(rerun_command)"
		;;
	esac
	die "docker is installed but 'docker info' failed:

$_err"
}

# The whole host dependency list: docker engine, the compose v2 plugin, and
# two CLI tools. Everything else remit needs runs in a container.
missing_deps() {
	_missing=""
	command -v docker >/dev/null 2>&1 || _missing="$_missing docker"
	command -v curl >/dev/null 2>&1 || _missing="$_missing curl"
	command -v openssl >/dev/null 2>&1 || _missing="$_missing openssl"
	if command -v docker >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
		_missing="$_missing compose"
	fi
	printf '%s' "${_missing# }"
}

# The subset of missing_deps the host package manager installs directly;
# docker goes through docker_install_cmd instead.
missing_pkgs() {
	_pkgs=""
	case " $1 " in *" curl "*) _pkgs="$_pkgs curl" ;; esac
	case " $1 " in *" openssl "*) _pkgs="$_pkgs openssl" ;; esac
	printf '%s' "${_pkgs# }"
}

advise_deps() {
	_missing=$1
	printf '\nerror: missing dependencies on %s: %s\n\n' "$DISTRO" "$_missing" >&2
	if [ -z "$PKG" ]; then
		cat >&2 <<EOF
No apt, dnf or apk on this host, so there is nothing specific to advise.
Remit needs these on the host; everything else runs in containers:

  - docker engine
  - the docker compose v2 plugin ('docker compose version' must work)
  - curl
  - openssl

Install them however this system does that, then re-run:

  $(rerun_command)
EOF
		exit 1
	fi
	say "Install them with:" >&2
	printf '\n' >&2
	case " $_missing " in
	*" docker "* | *" compose "*) printf '  %s\n' "$(docker_install_cmd)" >&2 ;;
	esac
	_pkgs=$(missing_pkgs "$_missing")
	if [ -n "$_pkgs" ]; then
		printf '  %s\n' "$(pkg_install_cmd "$_pkgs")" >&2
	fi
	cat >&2 <<EOF

Then re-run:

  $(rerun_command)

Or re-run with --install-deps to have the installer do it.
EOF
	exit 1
}

install_deps() {
	_missing=$1
	say "Installing missing dependencies on $DISTRO: $_missing"
	_pkgs=$(missing_pkgs "$_missing")
	case " $_missing " in
	*" docker "* | *" compose "*)
		say "  docker engine + compose v2 plugin:  $(docker_install_cmd)"
		;;
	esac
	if [ -n "$_pkgs" ]; then
		say "  $_pkgs:  $(pkg_install_cmd "$_pkgs")"
	fi
	printf '\n'
	# curl and openssl go first: on a host with neither, get.docker.com is
	# itself fetched with curl.
	if [ -n "$_pkgs" ]; then
		eval "$(pkg_install_cmd "$_pkgs")" || die "installing $_pkgs failed (see above)"
	fi
	case " $_missing " in
	*" docker "* | *" compose "*)
		eval "$(docker_install_cmd)" || die "installing docker failed (see above)"
		;;
	esac
	_still=$(missing_deps)
	[ -z "$_still" ] || die "still missing after --install-deps: $_still"
}

check_deps() {
	_missing=$(missing_deps)
	if [ -n "$_missing" ]; then
		if [ "$INSTALL_DEPS" = "1" ]; then
			install_deps "$_missing"
		else
			advise_deps "$_missing"
		fi
	fi
	if ! _err=$(docker info 2>&1); then
		docker_daemon_hint "$_err"
	fi
}

# `docker compose` can resolve to podman-compose without ever naming it: the
# podman-docker package makes /usr/bin/docker exec podman, and podman's own
# `compose` subcommand falls back to podman-compose whenever the real
# Compose v2 plugin isn't found ahead of it. podman-compose silently drops
# `depends_on: condition:` (translated to `--requires`, which ignores the
# condition) and `profiles:` — verified against this repo's own
# docker-compose.yml: `podman-compose up -d` exited 0 with the entire app
# plane stuck in `Created` (never started) and the backup sidecar running
# unrequested. Real Compose v2 always prints a "Docker Compose version" line
# first, regardless of backend; podman-compose never does.
check_compose_provider() {
	_out=$(docker compose version 2>&1) || return 0
	case "$_out" in
	*"Docker Compose version"*) return 0 ;;
	esac
	die "docker compose on this host resolves to podman-compose (or an
unrecognized compose provider), not the real Compose v2 plugin:

$_out

podman-compose is refused here on purpose: it can report success on a stack
where the app containers started before the database migration finished, or
where the backup sidecar started without --profile backup. An installer that
lets that pass is worse than one that refuses to run under podman at all.

The supported way to run remit under podman is its own Docker-compatible
socket, driving the real Compose v2 plugin — install docker-compose-v2 (or
the docker-ce compose plugin) so podman prefers it, or point the docker CLI
directly at the podman socket:

  systemctl --user enable --now podman.socket    # rootless
  systemctl enable --now podman.socket           # rootful — recommended, see README

  export DOCKER_HOST=unix:\$XDG_RUNTIME_DIR/podman/podman.sock   # rootless
  export DOCKER_HOST=unix:///run/podman/podman.sock              # rootful

Then re-run with that DOCKER_HOST exported:

  $(rerun_command)"
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

check_arch() {
	_arch=$(uname -m)
	case "$_arch" in
	x86_64 | amd64) ;;
	*)
		die "this host is $_arch, and remit publishes linux/amd64 images only
(docker-bake.hcl builds no other platform). There is no arm64 image to pull —
running this on $_arch is not possible today, with or without emulation flags."
		;;
	esac
}

check_disk() {
	_root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || printf '/var/lib/docker')
	while [ ! -d "$_root" ] && [ "$_root" != "/" ]; do
		_root=$(dirname "$_root")
	done
	_free=$(df -Pk "$_root" | awk 'NR==2 {print $4}')
	[ -n "$_free" ] || return 0
	if [ "$_free" -lt "$MIN_DISK_KB" ]; then
		die "not enough disk for the images on $_root:
  needed:  $((MIN_DISK_KB / 1024 / 1024)) GB
  free:    $((_free / 1024 / 1024)) GB
search-index-worker alone is ~1.36 GB (it bakes in the embedding model); the
rest of the roster, postgres and the data volumes make up the difference."
	fi
}

check_mem() {
	[ -r /proc/meminfo ] || return 0
	_mem=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
	[ -n "$_mem" ] || return 0
	if [ "$_mem" -lt "$MIN_MEM_KB" ]; then
		warn "this box has $((_mem / 1024)) MB of RAM; the deployment is sized for 4 GB.
         Continuing — postgres and the workers may be killed under load."
	fi
}

check_ports() {
	# Compose publishes 80 and 443 in every TLS mode, so both must be free —
	# unless they are already ours from an earlier run.
	if [ -n "$(docker ps -q --filter 'label=com.docker.compose.project=remit' 2>/dev/null)" ]; then
		return 0
	fi
	if command -v ss >/dev/null 2>&1; then
		_listen=$(ss -ltnH 2>/dev/null || true)
	elif command -v netstat >/dev/null 2>&1; then
		_listen=$(netstat -ltn 2>/dev/null || true)
	else
		return 0
	fi
	for _p in 80 443; do
		if printf '%s\n' "$_listen" | awk '{print $4}' | grep -qE "[:.]$_p\$"; then
			die "port $_p is already in use on this host.
Compose publishes both 80 and 443 in every TLS mode (443 sits unused in
--tls-mode off, but is still bound), so both must be free. Stop whatever holds
port $_p, or install remit on a box that is not already serving on it."
		fi
	done
}

check_origin() {
	[ -n "$ORIGIN" ] || {
		usage >&2
		die "--origin is required. It is the address you load the app from,
e.g. --origin https://100.64.12.3 for a tailnet IP in the default internal mode."
	}
	case "$ORIGIN" in
	*/) ORIGIN=${ORIGIN%/} ;;
	esac
	case "$ORIGIN" in
	*://*/*)
		die "--origin must be scheme://host with no trailing path: got '$ORIGIN'"
		;;
	esac
	case "$TLS_MODE" in
	off)
		case "$ORIGIN" in
		http://*) ;;
		*) die "--tls-mode off serves plain HTTP, so --origin must start with http://
Got '$ORIGIN'. The scheme and the mode have to agree: caddy takes the origin as
its site address, and the app derives its auth and CORS origins from it, so a
mismatch fails at request time rather than here." ;;
		esac
		;;
	internal | tailscale | acme)
		# These modes serve HTTPS, so the origin caddy takes as its site address
		# and the app derives auth/CORS from must be https. An http:// origin is
		# upgraded rather than rejected: caddy redirects http→https on its own,
		# so the address the operator typed still reaches the app. A scheme-less
		# origin is a real mistake and still fails.
		case "$ORIGIN" in
		https://*) ;;
		http://*)
			ORIGIN="https://${ORIGIN#http://}"
			warn "--tls-mode $TLS_MODE serves HTTPS; using --origin $ORIGIN.
         Caddy redirects http→https itself, so the http address still works."
			;;
		*) die "--tls-mode $TLS_MODE serves HTTPS, so --origin must be a URL,
e.g. https://your-host. Got '$ORIGIN'." ;;
		esac
		;;
	*)
		die "--tls-mode must be one of off, internal, tailscale, acme. Got '$TLS_MODE'."
		;;
	esac
}

check_tailscale() {
	[ "$TLS_MODE" = "tailscale" ] || return 0
	_sock=${TAILSCALED_SOCKET:-/var/run/tailscale/tailscaled.sock}
	if is_podman_backend && is_podman_rootless; then
		warn "--tls-mode tailscale on rootless podman is unproven and likely to fail.
         tailscaled's socket is normally 0600 root:root; a rootless container
         gets READ_DENIED trying to open it, and the certificate fetch may
         also peer-credential-check for uid 0. Rootful podman (see README)
         sidesteps this. Continuing, since this may still work on your setup."
	fi
	[ -S "$_sock" ] && return 0
	die "--tls-mode tailscale needs the tailscaled socket at $_sock, which is not there.
Two things cause this:
  - tailscaled is not running on this host (start it, or install tailscale)
  - the socket is somewhere else — set TAILSCALED_SOCKET to its real path
Caddy fetches the certificate through that socket, so it must exist on the host
before the stack comes up. Enabling HTTPS for your tailnet (admin console →
DNS → Enable HTTPS) is also required, and this script cannot check it."
}

# The 8 ghcr.io/remit-mail/remit/* images are fully qualified and unaffected;
# the 4 upstream images (caddy, pgvector, elasticmq, and postgres for the
# backup profile) are bare short names. podman refuses to resolve those
# without an explicit unqualified-search-registries — Ubuntu's podman
# package ships none, so a fresh host fails every one of those pulls with
# `short-name "caddy:2-alpine" did not resolve to an alias`. Not a concern
# under real docker at all (verified: no such thing as a "search registry" —
# Docker Hub is just the default).
check_podman_registries() {
	is_podman_backend || return 0
	command -v podman >/dev/null 2>&1 || return 0
	_reg=$(podman info --format '{{.Registries}}' 2>/dev/null || true)
	case "$_reg" in
	"" | "map[]") ;;
	*) return 0 ;;
	esac
	die "podman on this host has no unqualified-search-registries configured, so
it cannot resolve the short image names this deployment's upstream images use
(caddy:2-alpine, pgvector/pgvector:pg16, softwaremill/elasticmq-native,
postgres:16-alpine) — every one of those pulls fails with:

  short-name \"caddy:2-alpine\" did not resolve to an alias

Fix by adding this line to /etc/containers/registries.conf (create it if it
does not exist):

  unqualified-search-registries = [\"docker.io\"]

Then re-run:

  $(rerun_command)"
}

# Rootless podman cannot bind ports below net.ipv4.ip_unprivileged_port_start
# (1024 by default) — and compose publishes 80 and 443 in every TLS mode.
# Verified: rootlessport fails with 'cannot expose privileged port 80 ...
# bind: permission denied' until the sysctl is lowered. Rootful podman binds
# 80/443 the same as real docker and needs no host tuning at all.
check_podman_rootless_ports() {
	is_podman_backend || return 0
	is_podman_rootless || return 0
	_start=$(sysctl -n net.ipv4.ip_unprivileged_port_start 2>/dev/null || printf 1024)
	[ "$_start" -le 80 ] 2>/dev/null && return 0
	die "rootless podman cannot bind ports 80 or 443 (unprivileged ports start at
$_start). Compose publishes both in every TLS mode, so this blocks every mode,
including --tls-mode off. Fix with:

  sudo sysctl -w net.ipv4.ip_unprivileged_port_start=80

To keep it across reboots, also add
'net.ipv4.ip_unprivileged_port_start=80' to /etc/sysctl.conf. Rootful podman
does not need this — see the README's podman section.

Then re-run:

  $(rerun_command)"
}

# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------

fetch() {
	_path=$1
	_dest=$2
	_url="https://api.github.com/repos/$REPO/contents/deploy/vps/$_path?ref=$REF"
	if [ -n "${GITHUB_TOKEN:-}" ]; then
		# As an argument the token would sit in `ps` output for the life of
		# every request; curl reads it from a config file on stdin instead.
		# printf is a shell builtin, so it forks nothing that could carry it
		# either.
		_code=$(printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN" |
			curl -sSL -o "$_dest" -w '%{http_code}' --config - \
				-H 'Accept: application/vnd.github.raw' \
				"$_url" || printf '000')
	else
		_code=$(curl -sSL -o "$_dest" -w '%{http_code}' \
			-H 'Accept: application/vnd.github.raw' \
			"$_url" || printf '000')
	fi
	case "$_code" in
	200) return 0 ;;
	401 | 403 | 404)
		rm -f "$_dest"
		if [ -z "${GITHUB_TOKEN:-}" ]; then
			die "cannot download deploy/vps/$_path from $REPO at ref '$REF' (HTTP $_code).

The repository is private, and GitHub answers an anonymous request for a
private file with $_code. This is about the repo only — the images are public
and pull without a token. Either:
  - set GITHUB_TOKEN to a token with read access to $REPO and re-run, or
  - check --ref '$REF' names a real branch, tag or sha.

  $(rerun_command)"
		fi
		die "cannot download deploy/vps/$_path from $REPO at ref '$REF' (HTTP $_code).
GITHUB_TOKEN is set, so either it lacks read access to $REPO, or ref '$REF'
does not exist."
		;;
	*)
		rm -f "$_dest"
		die "downloading deploy/vps/$_path failed (HTTP $_code)"
		;;
	esac
}

make_dir() {
	if ! mkdir -p "$DIR/caddy" "$DIR/backup" 2>/dev/null; then
		die "cannot create $DIR. Run as root (or with sudo), or pick a writable
directory with --dir."
	fi
	[ -w "$DIR" ] || die "$DIR is not writable by $(id -un). Run as root, or use --dir."
}

file_sha() {
	openssl dgst -sha256 "$1" | awk '{print $NF}'
}

# The sha the installer last recorded writing for an asset. Empty when it has
# no record of one: a directory made before this manifest existed, or by hand.
recorded_sha() {
	[ -f "$DIR/$MANIFEST" ] || return 0
	_p="$1" awk '$2 == ENVIRON["_p"] { print $1; exit }' "$DIR/$MANIFEST"
}

# The installer bakes the install directory into the wrapper, so what ships as
# `remit` is what comes out of here — not what was downloaded. Doing it before
# the manifest records the file is what keeps the installer's own rewrite from
# reading as an operator edit on the next run.
bake_wrapper_dir() {
	_k=DEFAULT_DIR _v="$DIR" awk '
		BEGIN { k = ENVIRON["_k"]; v = ENVIRON["_v"] }
		index($0, k "=") == 1 { print k "=" v; next }
		{ print }
	' "$1" >"$1.baked"
	mv "$1.baked" "$1"
}

# remit.env.template tells operators to pin images by digest in
# docker-compose.yml, so a re-run must not revert that pin — an operator edit
# is kept for the same reason an existing secret is. The manifest is what tells
# an edit apart from an upstream change: a file still matching the sha the
# installer recorded writing is untouched and safe to replace, anything else is
# the operator's and is left alone.
fetch_assets() {
	say "Downloading deploy assets from $REPO at $REF"
	_next="$DIR/$MANIFEST.tmp"
	: >"$_next"
	_kept=""
	for _a in $ASSETS; do
		fetch "$_a" "$DIR/$_a.new"
		if [ "$_a" = "remit" ]; then
			bake_wrapper_dir "$DIR/$_a.new"
		fi
		_incoming=$(file_sha "$DIR/$_a.new")
		if [ ! -f "$DIR/$_a" ]; then
			mv "$DIR/$_a.new" "$DIR/$_a"
			printf '%s  %s\n' "$_incoming" "$_a" >>"$_next"
			continue
		fi
		_local=$(file_sha "$DIR/$_a")
		if [ "$_local" = "$_incoming" ]; then
			rm -f "$DIR/$_a.new"
			printf '%s  %s\n' "$_incoming" "$_a" >>"$_next"
			continue
		fi
		_recorded=$(recorded_sha "$_a")
		if [ -n "$_recorded" ] && [ "$_local" = "$_recorded" ]; then
			mv "$DIR/$_a.new" "$DIR/$_a"
			printf '%s  %s\n' "$_incoming" "$_a" >>"$_next"
			continue
		fi
		_kept="$_kept $_a"
		if [ -n "$_recorded" ]; then
			printf '%s  %s\n' "$_recorded" "$_a" >>"$_next"
		fi
	done
	mv "$_next" "$DIR/$MANIFEST"
	chmod 755 "$DIR/remit"
	[ -n "$_kept" ] || return 0
	warn "kept your edited copy of:$_kept
         Each incoming version is alongside it as <file>.new — diff and merge
         if you want it. A digest pin in docker-compose.yml is an edit like
         any other, which is why this re-run did not revert it."
}

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

get_var() {
	_k=$1
	_f=$2
	[ -f "$_f" ] || return 0
	_k="$_k" awk '
		BEGIN { k = ENVIRON["_k"] }
		index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }
	' "$_f"
}

# The temp file holds FAKE_KMS_DATAKEY like the .env it replaces, so it is
# created under a 077 umask rather than chmod'd after the write: a chmod after
# the fact leaves the secrets world-readable for the length of the write.
set_var() {
	_k=$1
	_v=$2
	_f=$3
	rm -f "$_f.tmp"
	(
		umask 077
		_k="$_k" _v="$_v" awk '
			BEGIN { k = ENVIRON["_k"]; v = ENVIRON["_v"]; done = 0 }
			!done && index($0, k "=") == 1 { print k "=" v; done = 1; next }
			{ print }
			END { if (!done) print k "=" v }
		' "$_f" >"$_f.tmp"
	)
	mv "$_f.tmp" "$_f"
}

# A value still carrying the template's CHANGE_ME placeholder is not a secret;
# anything else the operator (or an earlier run) put there is, and is never
# touched again.
is_unset() {
	case "$1" in
	"" | CHANGE_ME*) return 0 ;;
	*) return 1 ;;
	esac
}

ensure_secret() {
	_k=$1
	_bytes=$2
	_f=$3
	if is_unset "$(get_var "$_k" "$_f")"; then
		set_var "$_k" "$(openssl rand -hex "$_bytes")" "$_f"
		say "  $_k: generated"
	else
		say "  $_k: kept"
	fi
}

# Reads the effective TLS_MODE/REMIT_TAG out of an existing .env so a re-run
# that does not pass the flag does not silently revert them to the defaults.
resolve_existing() {
	_f="$DIR/.env"
	[ -f "$_f" ] || return 0
	if [ "$TLS_MODE_SET" = "0" ]; then
		_v=$(get_var TLS_MODE "$_f")
		if [ -n "$_v" ]; then TLS_MODE=$_v; fi
	fi
	if [ "$TAG_SET" = "0" ]; then
		_v=$(get_var REMIT_TAG "$_f")
		if [ -n "$_v" ]; then TAG=$_v; fi
	fi
}

write_env() {
	_f="$DIR/.env"
	if [ -f "$_f" ]; then
		say "Keeping the existing $_f"
	else
		say "Writing $_f"
		cp "$DIR/remit.env.template" "$_f"
	fi
	chmod 600 "$_f"

	ensure_secret POSTGRES_PASSWORD 24 "$_f"
	ensure_secret BETTER_AUTH_SECRET 32 "$_f"
	ensure_secret FAKE_KMS_DATAKEY 32 "$_f"

	# The template ships POSTGRES_PASSWORD and PG_CONNECTION_URL as two
	# placeholders carrying one password, which is a drift waiting to happen:
	# the two disagree and the only symptom is migrate failing to authenticate.
	# The URL is derived from the password every run rather than trusted, so
	# the password is the single place that value lives.
	set_var PG_CONNECTION_URL \
		"postgresql://remit:$(get_var POSTGRES_PASSWORD "$_f")@postgres:5432/remit" "$_f"

	# This installer only ever brings up the Postgres stack, whose compose file
	# reads DATA_BACKEND from .env. A box first installed in the SQLite era keeps
	# DATA_BACKEND=sqlite in its preserved .env, and on that value the backend
	# never mounts the better-auth routes, so signup 404s. Pin it every run
	# rather than inherit a stale value. The SQLite stack sets DATA_BACKEND
	# itself in docker-compose.sqlite.yml, so it is unaffected by this.
	set_var DATA_BACKEND postgres "$_f"

	set_var PUBLIC_ORIGIN "$ORIGIN" "$_f"
	set_var TLS_MODE "$TLS_MODE" "$_f"
	set_var REMIT_TAG "$TAG" "$_f"
	if [ "$TLS_MODE" = "tailscale" ]; then
		set_var TAILSCALED_SOCKET "${TAILSCALED_SOCKET:-/var/run/tailscale/tailscaled.sock}" "$_f"
	fi
}

# The wrapper is the operator's 'remit' command; this either lands it on PATH or
# tells them the one command that will, never skips it silently. A plain copy
# covers root and any host where /usr/local/bin is already writable; a non-root
# run falls back to non-interactive sudo (never prompting — the installer does
# not). When neither lands it (no root, no passwordless sudo), the stack is
# still up and summary() prints the exact command to finish.
install_wrapper() {
	_dest=/usr/local/bin/remit
	if install -m 755 "$DIR/remit" "$_dest" 2>/dev/null; then
		say "Installed the 'remit' admin command to $_dest"
		return 0
	fi
	if [ -n "$SUDO" ] && sudo -n install -m 755 "$DIR/remit" "$_dest" 2>/dev/null; then
		say "Installed the 'remit' admin command to $_dest"
		return 0
	fi
	WRAPPER_MANUAL="sudo install -m 755 $DIR/remit $_dest"
}

bring_up() {
	say "Pulling images and starting remit"
	# The wrapper owns pull/up/migrate-gating; calling it here keeps that
	# sequence in one place instead of two.
	REMIT_DIR="$DIR" "$DIR/remit" update
}

summary() {
	cat <<EOF

remit is up.

  Open        $ORIGIN
              The first signup creates the account. Every IMAP account is
              added from the app afterwards (Settings → Add account).

  Config      $DIR/.env  (chmod 600)
              This holds FAKE_KMS_DATAKEY, the key every stored IMAP
              credential is encrypted with. It is the only copy. If you lose
              it, no stored credential can be decrypted again, and re-running
              this installer will not bring it back — it keeps an existing
              .env precisely so it cannot.

  Manage      remit status | logs | restart | update | down | config
              After editing $DIR/.env, run 'remit restart' to apply it.
EOF
	if [ -n "$WRAPPER_MANUAL" ]; then
		cat <<EOF

  !! Action   The 'remit' command is not on your PATH — no root and no
              passwordless sudo during install. The stack is up regardless.
              Put it on PATH with:

                $WRAPPER_MANUAL

              Until then, run it by full path: $DIR/remit status
EOF
	fi
	if [ "$TLS_MODE" = "internal" ]; then
		cat <<EOF

  Certificate --tls-mode internal signs with Caddy's own CA, so browsers warn
              until you trust its root. Export it with:

                docker compose -f $DIR/docker-compose.yml cp \\
                  caddy:/data/caddy/pki/authorities/local/root.crt ./remit-root.crt

              Then import remit-root.crt into each client's trust store.
EOF
	fi
}

main() {
	parse_args "$@"
	detect_host
	check_deps
	check_compose_provider
	resolve_existing
	check_origin
	check_arch
	check_disk
	check_mem
	check_ports
	check_podman_registries
	check_podman_rootless_ports
	check_tailscale
	make_dir
	fetch_assets
	write_env
	install_wrapper
	bring_up
	summary
}

main "$@"
