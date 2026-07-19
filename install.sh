#!/usr/bin/env bash
#
# Reader self-host installer — single VM, SQLite backend.
#
# Run it straight from the repo:
#
#   REMIT_ORIGIN="https://<the address you will load the app from>"
#   curl -fsSL https://raw.githubusercontent.com/remit-mail/reader/main/install.sh \
#     | bash -s -- --origin "$REMIT_ORIGIN"
#
# It checks the host has a container engine and Compose v2, downloads the
# SQLite deploy assets, generates the secrets into a .env, and brings the
# stack up. Re-running it is safe: existing secrets and an existing .env are
# left untouched.
#
# Everything comes from flags and environment — the script never prompts, so
# it works unchanged under `curl | bash`.

set -euo pipefail

REPO="${REMIT_REPO:-remit-mail/reader}"
REF="${REMIT_REF:-main}"
# Where the deploy assets are read from. Defaults to the public raw endpoint;
# point it at a local directory to install from a checkout.
ASSET_BASE="${REMIT_ASSET_BASE:-https://raw.githubusercontent.com/${REPO}/${REF}/deploy/vps}"

DIR="${REMIT_DIR:-$PWD/reader}"
ORIGIN=""
TLS_MODE="internal"
TAG="${REMIT_TAG:-latest}"
DRY_RUN=0

COMPOSE_FILE="docker-compose.sqlite.yml"
ASSETS=(
	"docker-compose.sqlite.yml"
	"queues.json"
	"remit.env.template"
	"remit"
	"caddy/routes.caddy"
	"caddy/off.caddy"
	"caddy/internal.caddy"
	"caddy/tailscale.caddy"
	"caddy/acme.caddy"
)

# Set once the remit admin wrapper is placed on PATH, so the summary can point
# at it.
WRAPPER_ON_PATH=""

say() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
	printf '\nerror: %s\n' "$*" >&2
	exit 1
}

usage() {
	cat <<EOF
Reader self-host installer (single VM, SQLite).

Usage:
  REMIT_ORIGIN="https://<the address you will load the app from>"
  curl -fsSL https://raw.githubusercontent.com/${REPO}/${REF}/install.sh \\
    | bash -s -- --origin "\$REMIT_ORIGIN" [options]

Required:
  --origin <url>     The address you load the app from: scheme://host, no
                     trailing path. Its scheme must match --tls-mode (https for
                     internal/tailscale/acme, http for off). Every auth and CORS
                     origin derives from it, so a wrong value fails at sign-in,
                     not at install.

Options:
  --tls-mode <mode>  internal | off | tailscale | acme     (default: internal)
                       internal   HTTPS with Caddy's own CA, no external deps;
                                  browsers warn until you trust its root.
                       off        plain HTTP; reach it over a tailnet/VPN/tunnel.
                       tailscale  HTTPS via the local tailscaled.
                       acme       public Let's Encrypt; needs public DNS + 80/443.
  --dir <path>       Install directory                     (default: \$PWD/reader)
  --tag <tag>        Image tag                             (default: latest)
  --dry-run          Do everything except pull and start: check the host, fetch
                     assets, write .env, and validate the compose file.
  --help             This message.

Environment:
  REMIT_ASSET_BASE   Where deploy assets are read from (URL or local directory).
  REMIT_DIR          Same as --dir.
EOF
}

parse_args() {
	while [ $# -gt 0 ]; do
		case "$1" in
		# An unset $REMIT_ORIGIN expands to nothing, so --origin either runs out
		# of arguments or swallows the next flag. Both are the same mistake and
		# neither should reach the compose file as a hostname.
		--origin)
			[ $# -ge 2 ] || die "--origin got no value. Set REMIT_ORIGIN to the address you will load the app from, then pass --origin \$REMIT_ORIGIN."
			case "$2" in
			-*) die "--origin got '$2', which is another flag. \$REMIT_ORIGIN is empty — set it to the address you will load the app from." ;;
			esac
			ORIGIN="$2"
			shift 2
			;;
		--tls-mode) [ $# -ge 2 ] || die "--tls-mode needs a value"; TLS_MODE="$2"; shift 2 ;;
		--dir) [ $# -ge 2 ] || die "--dir needs a value"; DIR="$2"; shift 2 ;;
		--tag) [ $# -ge 2 ] || die "--tag needs a value"; TAG="$2"; shift 2 ;;
		--dry-run) DRY_RUN=1; shift ;;
		--help | -h) usage; exit 0 ;;
		*) die "unknown option '$1' (--help lists them all)" ;;
		esac
	done
}

check_origin() {
	[ -n "$ORIGIN" ] || { usage >&2; die "--origin is required. Set REMIT_ORIGIN to the address you will load the app from, then pass --origin \$REMIT_ORIGIN."; }
	ORIGIN="${ORIGIN%/}"
	case "$ORIGIN" in
	# A pasted placeholder is worse than a rejected one: it installs a stack
	# whose auth and CORS origins are wrong, which surfaces at sign-in.
	*"<"* | *">"*) die "--origin still contains the placeholder: '$ORIGIN'. Set REMIT_ORIGIN to the real address you will load the app from." ;;
	*://*/*) die "--origin must be scheme://host with no trailing path: got '$ORIGIN'" ;;
	esac
	case "$TLS_MODE" in
	off)
		case "$ORIGIN" in
		http://*) ;;
		*) die "--tls-mode off serves plain HTTP, so --origin must start with http:// (got '$ORIGIN')" ;;
		esac
		;;
	internal | tailscale | acme)
		case "$ORIGIN" in
		https://*) ;;
		http://*)
			ORIGIN="https://${ORIGIN#http://}"
			warn "--tls-mode $TLS_MODE serves HTTPS; using --origin $ORIGIN"
			;;
		*) die "--tls-mode $TLS_MODE serves HTTPS, so --origin must be https://your-host (got '$ORIGIN')" ;;
		esac
		;;
	*) die "--tls-mode must be one of off, internal, tailscale, acme (got '$TLS_MODE')" ;;
	esac
}

# --- origin resolution ------------------------------------------------------
#
# The shape of an origin is checkable; whether it points anywhere is not, so a
# wrong one installs cleanly and only surfaces later as an app nobody can load.
# Every outcome here is a warning: DNS pointed at the box after the install,
# a name only the clients resolve, a proxy or NAT in front — all legitimate,
# and none of them worth refusing an install over.

PROBE_TIMEOUT=3
ORIGIN_DNS_WARNING=""

capped() {
	if command -v timeout >/dev/null 2>&1; then
		timeout "$PROBE_TIMEOUT" "$@" 2>/dev/null || true
		return 0
	fi
	"$@" 2>/dev/null || true
}

origin_host() {
	local h="${1#*://}"
	h="${h%%/*}"
	h="${h#*@}"
	case "$h" in
	"["*)
		h="${h#[}"
		h="${h%%]*}"
		;;
	*) h="${h%%:*}" ;;
	esac
	printf '%s' "$h"
}

resolver_tool() {
	local t
	for t in getent dig host; do
		if command -v "$t" >/dev/null 2>&1; then
			printf '%s' "$t"
			return 0
		fi
	done
	return 1
}

resolve_host() {
	case "$(resolver_tool || true)" in
	getent) capped getent ahosts "$1" | awk '{print $1}' | sort -u | tr '\n' ' ' ;;
	dig) capped dig +short +time=2 +tries=1 "$1" | grep -E '^[0-9a-fA-F.:]+$' | sort -u | tr '\n' ' ' ;;
	host) capped host -W 2 "$1" | awk '/has( IPv6)? address/ {print $NF}' | sort -u | tr '\n' ' ' ;;
	esac
}

local_addresses() {
	if command -v ip >/dev/null 2>&1; then
		capped ip -o addr show | awk '{print $4}' | cut -d/ -f1
		return 0
	fi
	if command -v ifconfig >/dev/null 2>&1; then
		capped ifconfig | awk '/inet6? /{print $2}' | sed 's/^addr://'
		return 0
	fi
	return 1
}

check_origin_dns() {
	local host addrs local_addrs a l held=0 loopback_only=1
	host="$(origin_host "$ORIGIN")"
	[ -n "$host" ] || return 0
	# No resolver is not the operator's problem to hear about here.
	resolver_tool >/dev/null || return 0

	addrs="$(resolve_host "$host")"
	addrs="${addrs% }"
	if [ -z "$addrs" ]; then
		ORIGIN_DNS_WARNING="$host does not resolve from this box.
Nothing loads at $ORIGIN until it does.
Expected if you point DNS at this box after the install, or
if only your clients resolve the name (tailnet, VPN, a hosts
file). Otherwise the record is missing."
		warn "$ORIGIN_DNS_WARNING"
		return 0
	fi

	for a in $addrs; do
		case "$a" in
		127.* | ::1) ;;
		*) loopback_only=0 ;;
		esac
	done
	[ "$loopback_only" = "0" ] || return 0

	local_addrs="$(local_addresses || true)"
	[ -n "$local_addrs" ] || return 0
	for a in $addrs; do
		for l in $local_addrs; do
			if [ "$a" = "$l" ]; then
				held=1
			fi
		done
	done
	[ "$held" = "0" ] || return 0

	ORIGIN_DNS_WARNING="$host resolves to $addrs,
which this box does not hold — clients using DNS reach a
different machine, not this one. Expected behind a proxy, NAT
or split-horizon DNS. Otherwise the record is stale or names
the wrong host, and nothing loads at $ORIGIN."
	warn "$ORIGIN_DNS_WARNING"
}

check_engine() {
	command -v docker >/dev/null 2>&1 || die "docker (or a docker-compatible CLI such as podman's) is required and was not found on PATH."
	command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets and was not found on PATH."
	local out
	out="$(docker compose version 2>&1)" || die "the docker compose v2 plugin is required ('docker compose version' failed):
$out"
	case "$out" in
	*"Docker Compose version"*) ;;
	*) die "'docker compose' on this host is not the real Compose v2 plugin (podman-compose is not supported):
$out" ;;
	esac
	local err
	err="$(docker info 2>&1)" || die "the container daemon is not reachable:
$err"
}

check_arch() {
	local arch
	arch="$(uname -m)"
	case "$arch" in
	x86_64 | amd64) ;;
	*) die "this host is $arch; reader publishes linux/amd64 images only. There is no arm64 image to pull." ;;
	esac
}

check_ports() {
	[ "$DRY_RUN" = "1" ] && return 0
	if docker ps -q --filter 'label=com.docker.compose.project=remit' | grep -q .; then
		return 0
	fi
	local listen=""
	if command -v ss >/dev/null 2>&1; then
		listen="$(ss -ltnH 2>/dev/null || true)"
	elif command -v netstat >/dev/null 2>&1; then
		listen="$(netstat -ltn 2>/dev/null || true)"
	else
		return 0
	fi
	local p
	for p in 80 443; do
		if printf '%s\n' "$listen" | awk '{print $4}' | grep -qE "[:.]$p\$"; then
			die "port $p is already in use. Compose publishes both 80 and 443; free them or install on another box."
		fi
	done
}

fetch_asset() {
	local rel="$1" dest="$2"
	case "$ASSET_BASE" in
	http://* | https://*)
		local code
		code="$(curl -fsSL -o "$dest" -w '%{http_code}' "$ASSET_BASE/$rel" || printf '000')"
		[ "$code" = "200" ] || { rm -f "$dest"; die "cannot download $rel from $ASSET_BASE (HTTP $code)"; }
		;;
	*)
		[ -f "$ASSET_BASE/$rel" ] || die "asset not found: $ASSET_BASE/$rel"
		cp "$ASSET_BASE/$rel" "$dest"
		;;
	esac
}

fetch_assets() {
	say "Fetching deploy assets from $ASSET_BASE"
	mkdir -p "$DIR/caddy" || die "cannot create $DIR — pick a writable --dir or run with the right permissions."
	[ -w "$DIR" ] || die "$DIR is not writable."
	local a
	for a in "${ASSETS[@]}"; do
		fetch_asset "$a" "$DIR/$a"
	done
}

# --- .env: idempotent secret generation ------------------------------------

get_var() {
	local k="$1" f="$2"
	[ -f "$f" ] || return 0
	awk -v k="$k" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$f"
}

set_var() {
	local k="$1" v="$2" f="$3"
	rm -f "$f.tmp"
	( umask 077
	  awk -v k="$k" -v v="$v" '
		BEGIN { done = 0 }
		!done && index($0, k "=") == 1 { print k "=" v; done = 1; next }
		{ print }
		END { if (!done) print k "=" v }
	  ' "$f" >"$f.tmp" )
	mv "$f.tmp" "$f"
}

is_unset() {
	case "$1" in "" | CHANGE_ME*) return 0 ;; *) return 1 ;; esac
}

ensure_secret() {
	local k="$1" bytes="$2" f="$3"
	if is_unset "$(get_var "$k" "$f")"; then
		set_var "$k" "$(openssl rand -hex "$bytes")" "$f"
		say "  $k: generated"
	else
		say "  $k: kept"
	fi
}

write_env() {
	local f="$DIR/.env"
	if [ -f "$f" ]; then
		say "Keeping the existing $f"
	else
		say "Writing $f"
		cp "$DIR/remit.env.template" "$f"
	fi
	chmod 600 "$f"
	# SQLite needs no Postgres password. The identity signing key and the
	# IMAP-credential encryption key are the two secrets this stack cannot run
	# without.
	ensure_secret BETTER_AUTH_SECRET 32 "$f"
	ensure_secret FAKE_KMS_DATAKEY 32 "$f"
	set_var PUBLIC_ORIGIN "$ORIGIN" "$f"
	set_var TLS_MODE "$TLS_MODE" "$f"
	set_var REMIT_TAG "$TAG" "$f"
	if [ "$TLS_MODE" = "tailscale" ]; then
		set_var TAILSCALED_SOCKET "${TAILSCALED_SOCKET:-/var/run/tailscale/tailscaled.sock}" "$f"
	fi
}

# The remit wrapper ships as a deploy asset; here it is made executable and,
# where possible, put on PATH. DEFAULT_DIR and DEFAULT_COMPOSE_FILE are
# rewritten to what this run installed, so `remit` works with no REMIT_DIR or
# REMIT_COMPOSE_FILE set. /usr/local/bin is written only when already
# writable — the installer never elevates on its own.
place_wrapper() {
	local src="$DIR/remit"
	[ -f "$src" ] || die "the remit wrapper is missing from $DIR — the asset fetch did not complete."
	local tmp="$src.tmp"
	sed -e "s#^DEFAULT_DIR=.*#DEFAULT_DIR=$DIR#" \
		-e "s#^DEFAULT_COMPOSE_FILE=.*#DEFAULT_COMPOSE_FILE=$COMPOSE_FILE#" \
		"$src" >"$tmp"
	mv "$tmp" "$src"
	chmod +x "$src"
	[ "$DRY_RUN" = "1" ] && return 0
	local bindir="/usr/local/bin"
	if [ -w "$bindir" ]; then
		cp "$src" "$bindir/remit"
		chmod +x "$bindir/remit"
		WRAPPER_ON_PATH="$bindir/remit"
		say "  remit: installed at $bindir/remit"
	else
		say "  remit: wrapper written to $src (not on PATH — see the summary)"
	fi
}

compose() {
	docker compose --project-directory "$DIR" -f "$DIR/$COMPOSE_FILE" --env-file "$DIR/.env" "$@"
}

validate_compose() {
	compose config >/dev/null || die "the compose file failed to validate — see the error above."
	say "  compose file validates"
}

# Delegated to the placed wrapper so a first install goes through the same
# migrate gate and registry-refusal diagnosis as every later `remit update` —
# which is when an operator is least equipped to read a raw compose failure.
bring_up() {
	say "Pulling images and starting reader"
	REMIT_DIR="$DIR" REMIT_COMPOSE_FILE="$COMPOSE_FILE" "$DIR/remit" update
}

# A warning emitted before the pull is minutes of image progress behind by the
# time the install finishes, so it is repeated where the operator is actually
# reading: next to the address that will not load.
origin_warning_block() {
	[ -n "$ORIGIN_DNS_WARNING" ] || return 0
	printf '\n  Unreachable %s\n' "$(printf '%s' "$ORIGIN_DNS_WARNING" | sed '2,$s/^/              /')"
}

# The wrapper is the interface: it knows the install directory and the compose
# file, so on PATH it runs from anywhere. When it could not be placed there the
# same commands are shown relative to the install directory, prefixed by the cd
# that makes them work.
manage_block() {
	local remit="remit" indent="              "
	if [ -n "$WRAPPER_ON_PATH" ]; then
		printf '  Manage      '
	else
		remit="./remit"
		printf '  Manage      cd %s\n%s' "$DIR" "$indent"
	fi
	printf '%s %-8s What is running, and whether the origin reaches it.\n' "$remit" status
	printf '%s%s %-8s Follow the logs.\n' "$indent" "$remit" logs
	printf '%s%s %-8s Apply an edit to .env.\n' "$indent" "$remit" restart
	printf '%s%s %-8s Pull the current images and apply them.\n' "$indent" "$remit" update
	printf '%s%s %-8s Stop serving; %s restart brings it back.\n' "$indent" "$remit" down "$remit"
	printf '%s%s %-8s Every command, including the destructive one.\n' "$indent" "$remit" help
}

summary() {
	local remit="remit"
	[ -n "$WRAPPER_ON_PATH" ] || remit="./remit"
	cat <<EOF

reader is up.

  Open        $ORIGIN
              The first sign-up on that page creates your account. After you
              are in, add a mailbox from Settings -> Add account with your
              IMAP/SMTP details (or "Sign in with Microsoft" if configured).
EOF
	origin_warning_block
	cat <<EOF

  Config      $DIR/.env  (chmod 600)
              Holds FAKE_KMS_DATAKEY, the key every stored IMAP credential is
              encrypted with. It is the only copy — back it up. Losing it means
              re-entering every account's credentials.

EOF
	manage_block
	if [ -z "$WRAPPER_ON_PATH" ]; then
		cat <<EOF

              /usr/local/bin was not writable, so remit stayed in the install
              directory. To type 'remit' from anywhere instead:
                sudo cp $DIR/remit /usr/local/bin/remit
EOF
	fi
	if [ "$TLS_MODE" = "internal" ]; then
		cat <<EOF

  Certificate --tls-mode internal signs with Caddy's own CA, so browsers warn
              until you trust its root. Export it with:

                $remit cert

              then import reader-root.crt on every machine you browse from.
EOF
	fi
}

main() {
	parse_args "$@"
	check_origin
	# Before the host checks and well before the pull: a wrong origin caught
	# here costs nothing, and caught after it costs ~4 GB and an install.
	check_origin_dns
	check_engine
	check_arch
	check_ports
	fetch_assets
	write_env
	place_wrapper
	validate_compose
	if [ "$DRY_RUN" = "1" ]; then
		say ""
		say "Dry run complete. Host checks passed, assets and .env are in $DIR."
		say "Re-run without --dry-run to pull the images and start the stack."
		origin_warning_block
		return 0
	fi
	bring_up
	summary
}

main "$@"
