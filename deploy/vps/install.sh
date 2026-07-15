#!/bin/sh
#
# Remit self-host installer (RFC 035 D3: published images only, no repo
# checkout on the server). Downloads the deploy assets for one pinned ref,
# writes .env, and brings the stack up.
#
#   curl -fsSL https://raw.githubusercontent.com/remit-mail/remit/main/deploy/vps/install.sh \
#     | sh -s -- --origin http://your-host
#
# Runs under `curl | sh`, where stdin is the script itself: there is no
# prompting, ever. Everything comes from flags and environment variables.

set -eu

REPO=remit-mail/remit
INSTALL_URL="https://raw.githubusercontent.com/remit-mail/remit/main/deploy/vps/install.sh"
REGISTRY=ghcr.io

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
TLS_MODE=off
TLS_MODE_SET=0
ORIGIN=""
INSTALL_DEPS=0
ORIGINAL_ARGS=""

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
  curl -fsSL $INSTALL_URL | sh -s -- --origin <url> [options]

Required:
  --origin <url>        Public origin, scheme://host, no trailing path. This is
                        the address you load the app from. http:// for
                        --tls-mode off, https:// for every other mode.

Options:
  --tls-mode <mode>     off | internal | tailscale | acme   (default: off)
                        off        plain HTTP; reach it over a tailnet/VPN/tunnel
                        internal   HTTPS with Caddy's own CA, no external deps
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
  GITHUB_TOKEN          A token with read:packages. Needed only while the repo
                        and the ghcr.io/remit-mail/remit/* packages are private.
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

rerun_command() {
	printf 'curl -fsSL %s | sh -s --%s' "$INSTALL_URL" "$ORIGINAL_ARGS"
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
e.g. --origin http://100.64.12.3 for a tailnet IP in the default off mode."
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
		case "$ORIGIN" in
		https://*) ;;
		*) die "--tls-mode $TLS_MODE serves HTTPS, so --origin must start with https://
Got '$ORIGIN'. The scheme and the mode have to agree: caddy takes the origin as
its site address, and the app derives its auth and CORS origins from it, so a
mismatch fails at request time rather than here." ;;
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
		_code=$(curl -sSL -o "$_dest" -w '%{http_code}' \
			-H 'Accept: application/vnd.github.raw' \
			-H "Authorization: Bearer $GITHUB_TOKEN" \
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

The remit-mail/remit repository is private today, and GitHub answers an
anonymous request for a private file with $_code. Either:
  - set GITHUB_TOKEN to a token with repo read access and re-run, or
  - check --ref '$REF' names a real branch, tag or sha.

  GITHUB_TOKEN=ghp_... $(rerun_command)"
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

fetch_assets() {
	say "Downloading deploy assets from $REPO at $REF"
	for _a in $ASSETS; do
		fetch "$_a" "$DIR/$_a"
	done
	chmod 755 "$DIR/remit"
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

set_var() {
	_k=$1
	_v=$2
	_f=$3
	_k="$_k" _v="$_v" awk '
		BEGIN { k = ENVIRON["_k"]; v = ENVIRON["_v"]; done = 0 }
		!done && index($0, k "=") == 1 { print k "=" v; done = 1; next }
		{ print }
		END { if (!done) print k "=" v }
	' "$_f" >"$_f.tmp"
	chmod 600 "$_f.tmp"
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

	_pg_before=$(get_var POSTGRES_PASSWORD "$_f")
	ensure_secret POSTGRES_PASSWORD 24 "$_f"
	ensure_secret BETTER_AUTH_SECRET 32 "$_f"
	ensure_secret FAKE_KMS_DATAKEY 32 "$_f"

	# The template ships POSTGRES_PASSWORD and PG_CONNECTION_URL as two
	# separate placeholders that have to carry the same password; a mismatch
	# is a silent breakage, so the URL is built from the password rather than
	# filled in twice. An operator-customised URL (a different host, say) is
	# left alone.
	if is_unset "$_pg_before" || is_unset "$(get_var PG_CONNECTION_URL "$_f")"; then
		_pw=$(get_var POSTGRES_PASSWORD "$_f")
		set_var PG_CONNECTION_URL "postgresql://remit:$_pw@postgres:5432/remit" "$_f"
	fi

	set_var PUBLIC_ORIGIN "$ORIGIN" "$_f"
	set_var TLS_MODE "$TLS_MODE" "$_f"
	set_var REMIT_TAG "$TAG" "$_f"
	if [ "$TLS_MODE" = "tailscale" ]; then
		set_var TAILSCALED_SOCKET "${TAILSCALED_SOCKET:-/var/run/tailscale/tailscaled.sock}" "$_f"
	fi
}

install_wrapper() {
	_k=DEFAULT_DIR
	_v=$DIR
	_k="$_k" _v="$_v" awk '
		BEGIN { k = ENVIRON["_k"]; v = ENVIRON["_v"] }
		index($0, k "=") == 1 { print k "=" v; next }
		{ print }
	' "$DIR/remit" >"$DIR/remit.tmp"
	mv "$DIR/remit.tmp" "$DIR/remit"
	chmod 755 "$DIR/remit"
	if cp "$DIR/remit" /usr/local/bin/remit 2>/dev/null; then
		chmod 755 /usr/local/bin/remit
		say "Installed the 'remit' admin command to /usr/local/bin/remit"
	else
		warn "cannot write /usr/local/bin/remit — the admin command is at $DIR/remit.
         Copy it onto your PATH yourself, or re-run as root."
	fi
}

registry_login() {
	[ -n "${GITHUB_TOKEN:-}" ] || return 0
	say "Logging in to $REGISTRY with GITHUB_TOKEN"
	# GHCR authenticates on the token; the username is not checked.
	printf '%s' "$GITHUB_TOKEN" |
		docker login "$REGISTRY" -u "${GITHUB_USER:-remit-installer}" --password-stdin >/dev/null 2>&1 ||
		die "docker login to $REGISTRY failed. GITHUB_TOKEN needs the read:packages scope."
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
	registry_login
	bring_up
	summary
}

main "$@"
