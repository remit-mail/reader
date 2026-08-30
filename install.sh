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
# stack up. Re-running it is safe: an existing .env keeps every value it
# already holds, secrets above all, and gains the keys the template has added
# since it was written.
#
# Everything comes from flags and environment — the script never prompts, so
# it works unchanged under `curl | bash`.

set -euo pipefail

REPO="${REMIT_REPO:-remit-mail/reader}"
REF="${REMIT_REF:-main}"
# Where the deploy assets are read from. Defaults to the public raw endpoint;
# point it at a local directory to install from a checkout.
ASSET_BASE="${REMIT_ASSET_BASE:-https://raw.githubusercontent.com/${REPO}/${REF}/deploy/vps}"

DIR="${REMIT_DIR:-}"
ORIGIN=""
TLS_MODE="internal"
TAG="${REMIT_TAG:-latest}"
DRY_RUN=0

# The Compose project. Everything Compose namespaces — containers, volumes, the
# network — carries it, so it is what makes a second deployment on this host a
# separate deployment rather than a second directory pointing at the first one's
# data. The default project is the one whose wrapper is `remit`.
DEFAULT_PROJECT="remit"
PROJECT=""
PROJECT_GIVEN=0
WRAPPER_NAME="remit"

TUNNEL_TOKEN=""
TUNNEL_TOKEN_FILE=""
TUNNEL_TOKEN_SOURCE=""
HTTP_BIND=""
HTTP_BIND_PORT=""
DEFAULT_TUNNEL_HTTP_BIND="127.0.0.1:8080"
DEFAULT_HTTPS_BIND="0.0.0.0:443"

COMPOSE_FILE="docker-compose.sqlite.yml"
ASSETS=(
	"docker-compose.sqlite.yml"
	"queues.json"
	"remit.env.template"
	"remit"
	# The snapshot primitive `remit update` takes its pre-update snapshot with,
	# shared with the backup sidecar (RFC 037 R8). The wrapper reads it from the
	# install directory, so it ships with every install, backup profile or not.
	"backup/snapshot-db.sh"
	"backup/backup-sqlite.sh"
	# The scrape target list the `observability` profile's VictoriaMetrics reads.
	# Ships with every install, profile on or not — a missing bind mount would
	# have the daemon create a directory where this file belongs.
	"observability/scrape.yml"
	"caddy/routes.caddy"
	"caddy/off.caddy"
	"caddy/internal.caddy"
	"caddy/tailscale.caddy"
	"caddy/acme.caddy"
	"caddy/tunnel.caddy"
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
  --tls-mode <mode>  internal | off | tailscale | acme | tunnel
                                                          (default: internal)
                       internal   HTTPS with Caddy's own CA, no external deps;
                                  browsers warn until you trust its root.
                       off        plain HTTP; reach it over a tailnet/VPN.
                       tailscale  HTTPS via the local tailscaled.
                       acme       public Let's Encrypt; needs public DNS + 80/443.
                       tunnel     TLS terminates at a provider's edge; an
                                  outbound-only agent on this box holds the
                                  connection open. No public IP, no port
                                  forward, no inbound firewall rule.
  --dir <path>       Install directory                     (default: \$PWD/reader)
  --project <name>   Compose project for a second deployment on this host.
                     Containers, volumes and the network all carry it, and the
                     wrapper is installed as 'remit-<name>' beside the default
                     one. The install directory defaults to \$PWD/reader-<name>,
                     and a tunnel deployment needs its own --http-bind.
                                                            (default: $DEFAULT_PROJECT)
  --tag <tag>        Image tag                             (default: latest)
  --dry-run          Do everything except pull and start: check the host, fetch
                     assets, write .env, and validate the compose file.
  --help             This message.

Only with --tls-mode tunnel:
  --tunnel-token-file <path>
                     File holding the tunnel credential on its first line. Read
                     into .env and never printed. There is no flag that takes
                     the credential itself: it would land in your shell history
                     and in 'ps'. \$REMIT_TUNNEL_TOKEN does the same job.
  --http-bind <addr:port>
                     Loopback address Caddy is published on, your own route to
                     the app while the tunnel is down.
                                                  (default: $DEFAULT_TUNNEL_HTTP_BIND)

Environment:
  REMIT_ASSET_BASE     Where deploy assets are read from (URL or local directory).
  REMIT_DIR            Same as --dir.
  REMIT_TUNNEL_TOKEN   The tunnel credential, instead of --tunnel-token-file.
  REMIT_BINDIR         Where the remit wrapper is placed on PATH, when that
                       directory is writable        (default: /usr/local/bin)
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
		--project) [ $# -ge 2 ] || die "--project needs a name"; PROJECT="$2"; PROJECT_GIVEN=1; shift 2 ;;
		--tag) [ $# -ge 2 ] || die "--tag needs a value"; TAG="$2"; shift 2 ;;
		--tunnel-token-file) [ $# -ge 2 ] || die "--tunnel-token-file needs a path"; TUNNEL_TOKEN_FILE="$2"; shift 2 ;;
		--tunnel-token | --tunnel-token=*)
			die "there is no --tunnel-token flag. A credential on a command line lands in your shell history and is readable in 'ps' for as long as the install runs. Put it in a file and pass --tunnel-token-file <path>, or export REMIT_TUNNEL_TOKEN."
			;;
		--http-bind) [ $# -ge 2 ] || die "--http-bind needs an address:port"; HTTP_BIND="$2"; shift 2 ;;
		--dry-run) DRY_RUN=1; shift ;;
		--help | -h) usage; exit 0 ;;
		*) die "unknown option '$1' (--help lists them all)" ;;
		esac
	done
}

# --- the compose project ----------------------------------------------------
#
# Resolved before anything looks at the host, because the project decides which
# containers this run is allowed to see, which directory it installs into and
# what its wrapper is called.

resolve_project() {
	[ "$PROJECT_GIVEN" = "1" ] || PROJECT="$DEFAULT_PROJECT"
	# Compose's own rule for a project name. A name it rejects fails every
	# command against this deployment, starting with the one at the end of this
	# install. An empty one is refused rather than taken as the default: a
	# --project that expanded to nothing was meant to name a second deployment,
	# and installing the first one instead is the wrong stack.
	[ -n "$PROJECT" ] || die "--project got an empty name. It names the second deployment's containers, volumes and network — omit the flag for the default deployment."
	case "$PROJECT" in
	[a-z0-9]*) ;;
	*) die "--project must start with a lowercase letter or a digit (got '$PROJECT'). Compose names every container, volume and network after it." ;;
	esac
	case "$PROJECT" in
	*[!a-z0-9_-]*) die "--project takes lowercase letters, digits, '-' and '_' (got '$PROJECT'). Compose names every container, volume and network after it." ;;
	esac
	if [ -z "$DIR" ]; then
		DIR="$PWD/reader"
		[ "$PROJECT" = "$DEFAULT_PROJECT" ] || DIR="$PWD/reader-$PROJECT"
	fi
	adopt_installed_project
	[ "$PROJECT" = "$DEFAULT_PROJECT" ] || WRAPPER_NAME="remit-$PROJECT"
}

# A directory that already holds a deployment is a deployment this run
# continues. Re-running the installer over it is how an operator changes a tag
# or an origin, and a project name is not something they should have to remember
# to repeat — silently taking the default would point the run at a different set
# of containers and volumes and start an empty stack beside the data.
#
# An .env from before this flag existed has no REMIT_PROJECT line, and its stack
# is running under `remit` — the compose file's default. An absent line is that
# deployment's project, not an absent deployment, so it is what a --project has
# to be refused against: every deployment installed to date is one of these.
adopt_installed_project() {
	local installed
	[ -f "$DIR/.env" ] || return 0
	installed="$(get_var REMIT_PROJECT "$DIR/.env")"
	[ -n "$installed" ] || installed="$DEFAULT_PROJECT"
	[ "$installed" != "$PROJECT" ] || return 0
	if [ "$PROJECT_GIVEN" = "1" ]; then
		die "$DIR holds the deployment '$installed', and --project says '$PROJECT'.

Containers and volumes are named after the project, so renaming this one would
leave its mail, accounts and secrets on volumes nothing points at any more.

Re-run without --project to keep it, or give the second deployment its own
--dir."
	fi
	PROJECT="$installed"
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
	# No http:// upgrade here, unlike the modes above: this origin is the public
	# identity of an internet-facing deployment, and guessing at it is how a
	# stranger's browser ends up somewhere the operator never named.
	tunnel)
		case "$ORIGIN" in
		https://*) ;;
		*) die "--tls-mode tunnel serves a public hostname whose TLS terminates at the provider's edge, so --origin must be https://your-host (got '$ORIGIN')" ;;
		esac
		;;
	*) die "--tls-mode must be one of off, internal, tailscale, acme, tunnel (got '$TLS_MODE')" ;;
	esac
}

# --- tunnel credential and loopback publish ---------------------------------
#
# The credential reaches .env without ever being an argument to anything: read
# with the shell's own `read`, written with the shell's own `printf`. A value
# passed to awk with -v, or echoed for a progress line, is readable in `ps` by
# every user on the box for as long as that command runs.

read_tunnel_token() {
	local f="$1"
	[ -e "$f" ] || die "--tunnel-token-file: no such file: $f"
	[ -r "$f" ] || die "--tunnel-token-file: cannot read $f"
	IFS= read -r TUNNEL_TOKEN <"$f" || true
	[ -n "$TUNNEL_TOKEN" ] || die "--tunnel-token-file: $f holds nothing. Its first line must be the tunnel credential your provider issued."
}

check_tunnel() {
	if [ "$TLS_MODE" != "tunnel" ]; then
		[ -z "$TUNNEL_TOKEN_FILE" ] || die "--tunnel-token-file applies to --tls-mode tunnel; this run is --tls-mode $TLS_MODE."
		[ -z "$HTTP_BIND" ] || die "--http-bind applies to --tls-mode tunnel; this run is --tls-mode $TLS_MODE."
		return 0
	fi
	if [ -n "$TUNNEL_TOKEN_FILE" ]; then
		read_tunnel_token "$TUNNEL_TOKEN_FILE"
		TUNNEL_TOKEN_SOURCE="$TUNNEL_TOKEN_FILE"
	elif [ -n "${REMIT_TUNNEL_TOKEN:-}" ]; then
		TUNNEL_TOKEN="$REMIT_TUNNEL_TOKEN"
		TUNNEL_TOKEN_SOURCE="\$REMIT_TUNNEL_TOKEN"
	elif ! is_unset "$(get_var TUNNEL_TOKEN "$DIR/.env")"; then
		TUNNEL_TOKEN_SOURCE=""
	else
		die "--tls-mode tunnel needs the tunnel credential your provider issued.

Write it to a file and pass the path:
  --tunnel-token-file ./tunnel.token
or export it:
  REMIT_TUNNEL_TOKEN=...

There is no flag that takes the credential itself — it would land in your shell
history and be readable in 'ps'."
	fi
	[ -n "$HTTP_BIND" ] || HTTP_BIND="$DEFAULT_TUNNEL_HTTP_BIND"
	check_http_bind
}

check_http_bind() {
	local host port
	case "$HTTP_BIND" in
	*:*) ;;
	*) die "--http-bind must be address:port, e.g. $DEFAULT_TUNNEL_HTTP_BIND (got '$HTTP_BIND')" ;;
	esac
	host="${HTTP_BIND%:*}"
	port="${HTTP_BIND##*:}"
	case "$port" in
	"" | *[!0-9]*) die "--http-bind must end in a port number (got '$HTTP_BIND')" ;;
	esac
	case "$host" in
	127.* | localhost | "[::1]") ;;
	*) die "--http-bind is your own route to the app while the tunnel is down, so it must be a loopback address (got '$host'). Everything a browser reaches arrives through the tunnel; published anywhere else this port serves the app in plain HTTP to that network." ;;
	esac
	HTTP_BIND_PORT="$port"
}

# --- origin resolution ------------------------------------------------------
#
# The shape of an origin is checkable; whether it points anywhere is not, so a
# wrong one installs cleanly and only surfaces later as an app nobody can load.
# Every outcome here is a warning: DNS pointed at the box after the install,
# a name only the clients resolve, a proxy or NAT in front — all legitimate,
# and none of them worth refusing an install over.
#
# The resolving is the wrapper's `probe-host`, not a second copy of it here.
# That is why this runs after place_wrapper rather than beside check_origin —
# still well before the pull, which is where the cost of a wrong origin is.

ORIGIN_DNS_WARNING=""
ORIGIN_WARNING_LABEL="Unreachable"

check_origin_dns() {
	local probe verdict addrs
	probe="$("$DIR/remit" probe-host "$ORIGIN" 2>/dev/null || true)"
	# A probe that produced nothing is a broken probe, not a clean origin. The
	# silent branch below is for verdicts that mean "fine"; falling into it on
	# failure would make this check pass exactly when it cannot be trusted —
	# reachable with an older wrapper via $REMIT_REF or $REMIT_ASSET_BASE.
	[ -n "$probe" ] || {
		ORIGIN_WARNING_LABEL="Unchecked  "
		ORIGIN_DNS_WARNING="whether $ORIGIN points at this box is unknown:
the remit wrapper in $DIR did not answer 'probe-host'.
The install continues. Check it yourself with:
  $DIR/remit probe-host $ORIGIN"
		warn "$ORIGIN_DNS_WARNING"
		return 0
	}
	verdict="${probe%% *}"
	addrs="${probe#* }"
	case "$verdict" in
	unresolved)
		if [ "$TLS_MODE" = "tunnel" ]; then
			ORIGIN_DNS_WARNING="$(origin_host_of "$ORIGIN") does not resolve.
Nothing loads at $ORIGIN until your provider publishes the
record that points that name at the tunnel — it is theirs to
publish, not this box's."
			warn "$ORIGIN_DNS_WARNING"
			return 0
		fi
		ORIGIN_DNS_WARNING="$(origin_host_of "$ORIGIN") does not resolve from this box.
Nothing loads at $ORIGIN until it does.
Expected if you point DNS at this box after the install, or
if only your clients resolve the name (tailnet, VPN, a hosts
file). Otherwise the record is missing."
		;;
	elsewhere)
		# Under --tls-mode tunnel the name is supposed to answer with the
		# provider's edge: this box holds no public address and is not what a
		# browser connects to. That is the topology working, so nothing is said.
		[ "$TLS_MODE" = "tunnel" ] && return 0
		ORIGIN_DNS_WARNING="$ORIGIN resolves to $addrs,
which this box does not hold — clients using DNS reach a
different machine, not this one. Expected behind a proxy, NAT
or split-horizon DNS. Otherwise the record is stale or names
the wrong host, and nothing loads there."
		;;
	# held, loopback, unknown, and an unreadable probe are all silent: each is
	# either correct or unknowable, and neither is worth a warning.
	*) return 0 ;;
	esac
	warn "$ORIGIN_DNS_WARNING"
}

# Only for the warning text; the probe does its own parsing.
origin_host_of() {
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
	# 2.30 is where `--profile '*'` came in. Below it the flag matches no
	# profile, so every command whose contract is "everything" — 'remit down',
	# 'remit purge', 'remit restart --hard' — degrades to acting on the always-on
	# services while reporting as though it acted on all of them. That failure is
	# invisible at the moment it happens, so it is asserted here instead.
	local ver major minor
	ver="${out#*Docker Compose version }"
	ver="${ver#v}"
	ver="${ver%%[!0-9.]*}"
	major="${ver%%.*}"
	minor="${ver#*.}"
	minor="${minor%%.*}"
	case "$major$minor" in
	*[!0-9]* | "") die "cannot read the Compose version from '$out'. reader needs Compose 2.30 or newer." ;;
	esac
	if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 30 ]; }; then
		die "this host has Compose $ver; reader needs 2.30 or newer.

Below 2.30 '--profile *' selects no profile, so 'remit down', 'remit purge' and
'remit restart --hard' would quietly skip every optional profile while reporting
that they covered the whole deployment. Update the compose plugin and re-run."
	fi
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
	if docker ps -q --filter "label=com.docker.compose.project=$PROJECT" | grep -q .; then
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
	# Nothing serves a tunnel on 80 or 443: requests arrive down the agent's
	# outbound connection, over the compose network. The one host port that has
	# to be free is the loopback publish, which is the operator's own way in.
	if [ "$TLS_MODE" = "tunnel" ]; then
		if printf '%s\n' "$listen" | awk '{print $4}' | grep -qE "[:.]$HTTP_BIND_PORT\$"; then
			die "port $HTTP_BIND_PORT is already in use. That is the loopback address Caddy is published on ($HTTP_BIND) — your route to the app while the tunnel is down. Free it, or pass --http-bind 127.0.0.1:<another port>."
		fi
		return 0
	fi
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
	# The directories to create are derived from the asset list rather than named
	# again here. A second hardcoded list turns every asset in a new
	# subdirectory into a mid-install `cp` failure, after the install has already
	# started writing.
	local dir_list=("$DIR")
	local a
	for a in "${ASSETS[@]}"; do
		dir_list+=("$DIR/$(dirname "$a")")
	done
	mkdir -p "${dir_list[@]}" || die "cannot create $DIR — pick a writable --dir or run with the right permissions."
	[ -w "$DIR" ] || die "$DIR is not writable."
	# Canonicalise to an absolute path now the directory exists: the wrapper's
	# DEFAULT_DIR and REMIT_DEPLOY_DIR (the updater's identity mount, reader#272)
	# both need a host-absolute path, not a relative --dir.
	DIR="$(cd "$DIR" && pwd)"
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

# set_var for a value no other process may see. awk -v puts its value on a
# command line, which `ps` shows to every user on the box; the shell's own read
# loop and printf are builtins and put it nowhere.
set_secret_var() {
	local k="$1" v="$2" f="$3"
	rm -f "$f.tmp"
	(
		umask 077
		local line found=0
		{
			while IFS= read -r line || [ -n "$line" ]; do
				if [ "$found" = "0" ] && [ "${line%%=*}" = "$k" ]; then
					printf '%s=%s\n' "$k" "$v"
					found=1
					continue
				fi
				printf '%s\n' "$line"
			done <"$f"
			[ "$found" = "1" ] || printf '%s=%s\n' "$k" "$v"
		} >"$f.tmp"
	)
	mv "$f.tmp" "$f"
}

is_unset() {
	case "$1" in "" | CHANGE_ME*) return 0 ;; *) return 1 ;; esac
}

ensure_secret() {
	local k="$1" bytes="$2" f="$3"
	if is_unset "$(get_var "$k" "$f")"; then
		set_secret_var "$k" "$(openssl rand -hex "$bytes")" "$f"
		say "  $k: generated"
	else
		say "  $k: kept"
	fi
}

# An .env is written once and outlives the installer that wrote it. Every key
# the template gained since is absent from it, and the keep-existing path below
# only rewrites keys it names by hand — so a key added later stays absent
# through every re-run. Absent is not the same as defaulted: with no
# COMPOSE_PROFILES line, `--tls-mode tunnel` writes the mode, reports a finished
# install, and never starts the tunnel agent.
#
# Append-only, so the deployment's own values are not something this can reach:
# every line already in the file keeps its value, its formatting and its place,
# and only keys the file does not mention at all are added, carrying the
# template's value verbatim.
#
# A key the operator commented out counts as mentioned. Commenting a line out is
# how the template says "take the code's default", and re-adding it would
# overrule an edit someone made on purpose.
converge_env() {
	local f="$1" tpl="$DIR/remit.env.template" added line
	[ -f "$tpl" ] || return 0
	added="$(awk -v envfile="$f" '
		function name(s,   p, k) {
			sub(/^[ \t]*#*[ \t]*/, "", s)
			p = index(s, "=")
			if (p < 2) return ""
			k = substr(s, 1, p - 1)
			return (k ~ /^[A-Za-z_][A-Za-z0-9_]*$/) ? k : ""
		}
		BEGIN {
			while ((getline line < envfile) > 0) {
				k = name(line)
				if (k != "") present[k] = 1
			}
			close(envfile)
		}
		/^[A-Za-z_][A-Za-z0-9_]*=/ {
			k = name($0)
			if (k == "" || (k in present) || (k in added)) next
			# A placeholder is not a default. The keys carrying one are the keys
			# this run supplies itself, from a flag or from openssl, further down.
			if (index($0, "CHANGE_ME")) next
			added[k] = 1
			print
		}
	' "$tpl")"
	[ -n "$added" ] || return 0
	printf '\n# Added by install.sh: keys this .env was written before.\n%s\n' "$added" >>"$f"
	while IFS= read -r line; do
		say "  ${line%%=*}: added from the template"
	done <<<"$added"
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
	converge_env "$f"
	# The identity signing key and the IMAP-credential encryption key are the two
	# secrets this stack cannot run without.
	ensure_secret BETTER_AUTH_SECRET 32 "$f"
	ensure_secret FAKE_KMS_DATAKEY 32 "$f"
	set_var PUBLIC_ORIGIN "$ORIGIN" "$f"
	set_var TLS_MODE "$TLS_MODE" "$f"
	# Compose reads this from the same file to name the project, so the wrapper,
	# the installer and Compose itself cannot disagree about which deployment
	# this directory is.
	set_var REMIT_PROJECT "$PROJECT" "$f"
	set_var REMIT_TAG "$TAG" "$f"
	# The updater mounts the deployment directory at this absolute host path so a
	# socket-driven compose resolves relative binds identically inside the
	# container and on the host (reader#272). Rewritten on every run, so an
	# existing .env from a pre-#272 install picks it up when re-run here.
	set_var REMIT_DEPLOY_DIR "$DIR" "$f"
	if [ "$TLS_MODE" = "tailscale" ]; then
		set_var TAILSCALED_SOCKET "${TAILSCALED_SOCKET:-/var/run/tailscale/tailscaled.sock}" "$f"
	fi
	[ "$TLS_MODE" = "tunnel" ] && write_tunnel_env "$f"
	return 0
}

write_tunnel_env() {
	local f="$1"
	if [ -n "$TUNNEL_TOKEN" ]; then
		set_secret_var TUNNEL_TOKEN "$TUNNEL_TOKEN" "$f"
		say "  TUNNEL_TOKEN: read from $TUNNEL_TOKEN_SOURCE"
	else
		say "  TUNNEL_TOKEN: kept"
	fi
	set_var CADDY_HTTP_BIND "$HTTP_BIND" "$f"
	set_var CADDY_HTTPS_BIND "$DEFAULT_HTTPS_BIND" "$f"
	# The summary's closing step is a sed on this line, and sed replaces a line
	# that is there. Left commented in the template, closing sign-up would look
	# like it worked and leave the deployment open.
	if [ -z "$(get_var SELF_SIGN_UP_ENABLED "$f")" ]; then
		set_var SELF_SIGN_UP_ENABLED true "$f"
	fi
}

# The remit wrapper ships as a deploy asset; here it is made executable and,
# where possible, put on PATH. DEFAULT_DIR and COMPOSE_FILE are rewritten to
# what this run installed, so `remit` needs nothing in the environment to find
# the deployment. /usr/local/bin is written only when already writable — the
# installer never elevates on its own.
#
# A named project is placed as `remit-<name>`: one command per deployment, each
# holding its own install directory, so neither can be typed at the other's
# stack by accident.
place_wrapper() {
	local src="$DIR/remit"
	[ -f "$src" ] || die "the remit wrapper is missing from $DIR — the asset fetch did not complete."
	local tmp="$src.tmp"
	sed -e "s#^DEFAULT_DIR=.*#DEFAULT_DIR=$DIR#" \
		-e "s#^COMPOSE_FILE=.*#COMPOSE_FILE=$COMPOSE_FILE#" \
		-e "s#^PROG=.*#PROG=$WRAPPER_NAME#" \
		"$src" >"$tmp"
	mv "$tmp" "$src"
	chmod +x "$src"
	[ "$DRY_RUN" = "1" ] && return 0
	local bindir="${REMIT_BINDIR:-/usr/local/bin}"
	if [ -w "$bindir" ]; then
		cp "$src" "$bindir/$WRAPPER_NAME"
		chmod +x "$bindir/$WRAPPER_NAME"
		WRAPPER_ON_PATH="$bindir/$WRAPPER_NAME"
		say "  $WRAPPER_NAME: installed at $bindir/$WRAPPER_NAME"
	else
		say "  $WRAPPER_NAME: wrapper written to $src (not on PATH — see the summary)"
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
	REMIT_DIR="$DIR" REMIT_QUIET=1 "$DIR/remit" update
	# That run happened in this shell, so its lock, breadcrumb and state landed
	# beside .env. Every run after it happens in the updater container, which
	# keeps all of it on its own volume and never writes here again — left in
	# place, this directory is a record of the install that nothing supersedes
	# and that outlives what it describes (reader#573).
	rm -rf "$DIR/.update"
}

# A warning emitted before the pull is minutes of image progress behind by the
# time the install finishes, so it is repeated where the operator is actually
# reading: next to the address that will not load.
origin_warning_block() {
	[ -n "$ORIGIN_DNS_WARNING" ] || return 0
	printf '\n  %s %s\n' "$ORIGIN_WARNING_LABEL" "$(printf '%s' "$ORIGIN_DNS_WARNING" | sed '2,$s/^/              /')"
}

# The wrapper is the interface: it knows the install directory and the compose
# file, so on PATH it runs from anywhere. When it could not be placed there the
# same commands are shown relative to the install directory, prefixed by the cd
# that makes them work.
# Only for a second deployment: on the default project there is one stack, one
# wrapper and nothing to tell apart. Where there are two, the name is what the
# operator needs to know to reach the right one.
project_block() {
	[ "$PROJECT" != "$DEFAULT_PROJECT" ] || return 0
	cat <<EOF

  Project     $PROJECT
              Its containers, volumes and network carry that name, so this
              deployment shares nothing with the others on this box except the
              kernel, the container daemon and the images. Type '$WRAPPER_NAME'
              to manage it; 'remit' is the default deployment's.
EOF
}

# Search is two features, and an installer that says "search works" is only half
# right. The half that is off is off because of what it costs on this box, so the
# numbers are here rather than in a footnote, and so is the one command.
search_block() {
	local remit="$WRAPPER_NAME"
	[ -n "$WRAPPER_ON_PATH" ] || remit="cd $DIR && ./remit"
	cat <<EOF
  Search      Text search works now, over every message as it syncs. Nothing to
              turn on.

              Semantic search — the "Related" and "Similar messages" panels, and
              the semantic widen behind Organize filters — is off. It needs an
              embedding model: a ~1.4 GB image, and a first index of a 31k
              mailbox measured about 17 hours at 150-190% of a 2 vCPU box. Turn
              it on when you want it:

                $remit semantic on

              '$remit semantic' prints the state, and 'off' turns it back off
              and keeps the vectors it built.
EOF
}

manage_block() {
	local remit="$WRAPPER_NAME" indent="              "
	if [ -n "$WRAPPER_ON_PATH" ]; then
		printf '  Manage      '
	else
		remit="./remit"
		printf '  Manage      cd %s\n%s' "$DIR" "$indent"
	fi
	printf '%s %-8s What is running, and whether the origin reaches it.\n' "$remit" status
	printf '%s%s %-8s Follow the logs.\n' "$indent" "$remit" logs
	printf '%s%s %-8s Apply an edit to .env.\n' "$indent" "$remit" restart
	printf '%s%s %-8s Install a release. Atomic: gated, rolls back on failure.\n' "$indent" "$remit" update
	printf '%s%s %-8s Turn semantic search on or off; prints the state.\n' "$indent" "$remit" semantic
	printf '%s%s %-8s Stop serving; %s restart brings it back.\n' "$indent" "$remit" down "$remit"
	printf '%s%s %-8s Every command, including the destructive one.\n' "$indent" "$remit" help
}

# The window between a stack live on a public origin and sign-up closed is the
# whole trust boundary of --tls-mode tunnel: the network is no longer a gate,
# and until this is done anyone who finds the hostname can create an account
# here. It is the last thing printed, and the only thing framed as an
# instruction rather than a fact.
signup_block() {
	[ "$TLS_MODE" = "tunnel" ] || return 0
	local remit="$WRAPPER_NAME"
	[ -n "$WRAPPER_ON_PATH" ] || remit="cd $DIR && ./remit"
	cat <<EOF

  ══════════════════════════════════════════════════════════════════════════

  DO THIS NOW — sign-up is open on a public address

  $ORIGIN is reachable from the whole internet, and anyone who
  finds it can create an account until you close sign-up. Three steps:

    1. Open $ORIGIN and sign up. That first account is yours.
       Give it a password worth having: it is exposed to password spraying
       now, not to a LAN.

    2. Close sign-up to everyone else:
         sed -i 's/^SELF_SIGN_UP_ENABLED=.*/SELF_SIGN_UP_ENABLED=false/' $DIR/.env

    3. $remit restart

  ══════════════════════════════════════════════════════════════════════════
EOF
}

summary() {
	local remit="$WRAPPER_NAME"
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
	project_block
	printf '\n'
	search_block
	printf '\n'
	manage_block
	cat <<EOF

  Updates     This instance can update itself. Any signed-in user is offered
              each release in the app and installs it with a click;
              '$remit update --check' reports the same from a shell. An update
              is atomic and rolls back on failure, and clearing
              REMIT_UPDATE_MANIFEST_URL in .env turns the feature off entirely.
EOF
	if [ -z "$WRAPPER_ON_PATH" ]; then
		cat <<EOF

              /usr/local/bin was not writable, so remit stayed in the install
              directory. To type 'remit' from anywhere instead:
                sudo cp $DIR/remit /usr/local/bin/$WRAPPER_NAME
EOF
	fi
	if [ "$TLS_MODE" = "internal" ]; then
		cat <<EOF

  Certificate --tls-mode internal signs with Caddy's own CA, so browsers warn
              until you trust its root. Export it with:

                $remit cert

              then import reader-root.crt on every machine you browse from —
              or skip the shell and download it from Settings > Advanced once
              signed in.
EOF
	fi
	if [ "$TLS_MODE" = "tunnel" ]; then
		cat <<EOF

  Tunnel      The agent holds the connection to the edge. '$remit status' says
              whether it is up, '$remit logs tunnel' says why it is not, and
              $HTTP_BIND reaches the app over SSH while it is down.
EOF
	fi
	signup_block
}

main() {
	parse_args "$@"
	resolve_project
	check_origin
	check_tunnel
	check_engine
	check_arch
	check_ports
	fetch_assets
	write_env
	place_wrapper
	# Needs the wrapper on disk, and belongs before the pull: a wrong origin
	# caught here costs nothing, caught after it costs ~2.6 GB and an install.
	# (~4 GB before the search-index-worker image moved behind the `semantic`
	# profile — see deploy/vps/docker-compose.sqlite.yml.)
	check_origin_dns
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
