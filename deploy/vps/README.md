# Remit — self-host VPS deployment

The reference deployment from RFC 035 (`doc/RFC/035_container-deployment-target.md`):
docker compose on one small VPS, consuming only published
`ghcr.io/remit-mail/remit/*` images plus three upstream images
(`pgvector/pgvector`, `elasticmq`, `caddy`). No repo checkout, no npm, no
build toolchain on the server — pulling `main` onto a server is not
possible with this deployment, by design (RFC 035 D3).

Sized for a 2 vCPU / 4 GB EU VPS (Hetzner CX23-class, ~€5.50/mo). Plain HTTP
over a private network (tailnet, VPN, SSH tunnel) by default; the [TLS](#tls)
section covers turning on HTTPS.

## Install

On a fresh amd64 box:

```bash
curl -fsSL https://raw.githubusercontent.com/remit-mail/remit/main/deploy/vps/install.sh \
  | sh -s -- --origin http://your-host
```

This downloads the deploy assets for one ref into `/opt/remit`, generates the
secrets, writes `.env` with mode 600, and brings the stack up. It takes no
input while it runs — everything comes from flags and environment variables.
`--help` lists them; the ones that matter are `--tls-mode`, `--tag`, `--dir`
and `--ref`.

Re-running is safe. An existing `.env` is kept, and a secret that already has a
value is never regenerated: `.env` holds `FAKE_KMS_DATAKEY`, the only copy of
the key every stored IMAP credential is encrypted with.

The installer checks the host before it changes anything — docker and the
compose v2 plugin, amd64 (no arm64 image is built), disk, RAM, ports 80 and
443, and that `--origin`'s scheme matches `--tls-mode`. Missing dependencies
are reported with the install command for the detected distro and nothing is
changed; `--install-deps` installs them instead. The host needs docker, the
compose v2 plugin, curl and openssl. Everything else runs in a container.

The repository and the `ghcr.io/remit-mail/remit/*` packages are private today,
so the download and the image pull both need a token until they are public
(RFC 035 D4). With one set, the installer uses it for both:

```bash
export GITHUB_TOKEN=ghp_...    # repo read + read:packages
curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github.raw" \
  "https://api.github.com/repos/remit-mail/remit/contents/deploy/vps/install.sh?ref=main" \
  | sh -s -- --origin http://your-host
```

Then visit the address passed as `--origin`. Sign up creates the first account;
every subsequent IMAP account is added from the app itself (Settings → Add
account).

### The `remit` command

The installer puts a `remit` wrapper at `/usr/local/bin/remit`. It wraps
`docker compose` against the install directory, so nothing below needs a `cd`
or any flags.

| Command | What it does |
|---|---|
| `remit status` | Services, the running tag, the public origin. |
| `remit logs [service…]` | Follow logs. |
| `remit restart [--hard]` | Apply `.env` changes and start. |
| `remit update [--tag sha-…]` | Pull images, apply them, check the migration. |
| `remit down` | Stop. Data volumes are left alone. |
| `remit config` | The effective configuration, secrets redacted. |

Editing `.env` and running `docker compose restart` does not apply the change.
`restart` reuses the existing containers with the environment they were created
with, and reports success — the edit appears to have taken effect and has not.
`remit restart` runs `docker compose up -d`, which recreates the containers
whose configuration changed.

The wrapper is a convenience over the compose commands documented below, not a
replacement: every subcommand is a `docker compose` invocation you can type
yourself. It reads the deployment directory from `$REMIT_DIR`, defaulting to
whatever `--dir` the installer used.

## Manual install

The explicit path the installer automates:

```bash
cd deploy/vps
cp remit.env.template .env
chmod 600 .env
$EDITOR .env            # fill in every value marked SECRET — see the file
docker compose up -d
docker compose logs -f migrate    # confirm the one-shot migration succeeded
```

Then visit the address you set as `PUBLIC_ORIGIN` in `.env`. Sign up creates
the first account; every subsequent IMAP account is added from the app
itself (Settings → Add account).

## What's running

| Service | Image | Role |
|---|---|---|
| `caddy` | `caddy:2-alpine` | The edge: reverse proxy and TLS termination. Publishes the only host ports, 80 and 443 (443 is bound in every mode but serves traffic only in the TLS modes). See [TLS](#tls). |
| `apisix` | `ghcr.io/remit-mail/remit/apisix` | Edge JWT gate — `apache/apisix:3.13.0-debian` with the generated route table baked in, the same table the Scaleway deployment uses (RFC 035 D5 parity). |
| `web` | `ghcr.io/remit-mail/remit/web` | Static server for the built SPA. |
| `backend` | `ghcr.io/remit-mail/remit/backend` | The API. Also the `migrate` service's image (see below). |
| `imap-worker`, `smtp-worker`, `account-worker`, `search-index-worker` | `ghcr.io/remit-mail/remit/*` | Queue pollers — the deployed form of `packages/remit-imap-worker/src/e2e-processor-shim.ts`, running the same production Lambda handlers against ElasticMQ instead of an SQS event-source mapping. |
| `pg-index-worker` | `ghcr.io/remit-mail/remit/pg-index-worker` | Postgres LISTEN/NOTIFY → SQS relay; wakes `search-index-worker` on new mail without a polling loop. |
| `postgres` | `pgvector/pgvector:pg16` | All durable state except message bodies. Named volume `pgdata`. |
| `elasticmq` | `softwaremill/elasticmq-native` | The SQS-compatible queue seam. |
| `migrate` | `ghcr.io/remit-mail/remit/backend` (command override) | One-shot: runs before every app service (`depends_on: condition: service_completed_successfully`). |

Message bodies live on the `message_storage` named volume via the
filesystem storage backend (`STORAGE_LOCAL_PATH`) — not S3, not backed up
by the nightly dump below (see Backups).

## TLS

One setting, `TLS_MODE` in `.env`, picks how Caddy serves the origin. The
deployment never depends on a single provider for TLS — `internal` needs
nothing outside the box. Set it, set `PUBLIC_ORIGIN` to a matching
`scheme://host`, and `docker compose up -d`.

| `TLS_MODE` | What it does | `PUBLIC_ORIGIN` |
|---|---|---|
| `off` (default) | Plain HTTP on :80. Reach it over a private network (tailnet, VPN, SSH tunnel). | `http://…` |
| `internal` | HTTPS on :443 with Caddy's own locally-trusted CA. No public DNS, no ACME, no tailnet. Browsers warn until you trust the root CA. | `https://…` |
| `tailscale` | A real, publicly-trusted certificate from the local `tailscaled` for this box's `<name>.<tailnet>.ts.net`. | `https://<name>.<tailnet>.ts.net` |
| `acme` | Public Let's Encrypt. Ports 80/443 must be reachable from the internet and the host must resolve in public DNS. | `https://mail.example.com` |

`internal` is the first-class provider-free option. To make the browser
warning go away, trust Caddy's root CA on each client. Caddy keeps it on the
`caddy_data` volume; export it with:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./remit-root.crt
```

Then import `remit-root.crt` into the client's trust store (macOS Keychain,
the Windows cert store, `/usr/local/share/ca-certificates` + `update-ca-certificates`
on Linux, or the browser's own authorities). Skipping this is fine — it only
means the browser warning stays.

`tailscale` needs two things beyond `TLS_MODE`: enable HTTPS for your tailnet
(Tailscale admin console → DNS → **Enable HTTPS**), and set `TAILSCALED_SOCKET`
in `.env` to the host's `tailscaled` socket (usually
`/var/run/tailscale/tailscaled.sock`) so the caddy container can reach the
daemon. Caddy detects the `.ts.net` host and fetches the certificate itself.

### FAQ

**My browser says the connection isn't private in `internal` mode. Is it broken?**
No. The certificate is real but signed by Caddy's own CA, which the browser
doesn't know yet. Trust the exported root CA (above) or click through the
warning — traffic is encrypted either way.

**Why is port 443 open in `off` mode?** Compose publishes 80 and 443 for all
modes so switching to a TLS mode needs no compose edit. In `off` mode nothing
listens on 443; it just sits unused. If another service already holds :443 on
the host, free it before `up`.

**I set `TLS_MODE=tailscale` but Caddy can't get a certificate.** Two usual
causes: HTTPS isn't enabled for the tailnet, or `TAILSCALED_SOCKET` doesn't
point at a running `tailscaled` (the socket must exist on the host and be
mounted into the container). Both are required.

**Do I have to change `PUBLIC_ORIGIN` when I switch modes?** Yes — its scheme
must match. `http://` only for `off`; `https://` for the other three. It stays
the single origin knob (Caddy's site address and the app's auth/CORS origins
all derive from it), so nothing else changes.

**Can I use `acme` behind a tailnet or without public DNS?** No. Public Let's
Encrypt validates a publicly-resolvable name over ports 80/443. Use `internal`
or `tailscale` for private networks.

## Update procedure

```bash
remit update --tag sha-<git-sha>
```

Or the same thing by hand:

```bash
$EDITOR .env             # bump REMIT_TAG to the sha- tag you want
docker compose pull
docker compose up -d     # migrate runs again (idempotent) before app services restart
```

Find published tags at `https://github.com/remit-mail/remit/pkgs/container/remit%2Fbackend`
(every image in the roster is built and tagged together, so the same
`REMIT_TAG` value applies to all of them).

## Rollback

Repoint `REMIT_TAG` at the previous working tag (or a pinned digest) and
run the same update procedure:

```bash
$EDITOR .env             # REMIT_TAG=sha-<previous-sha>
docker compose pull
docker compose up -d
```

This is also the disaster-recovery story for a bad release (RFC 035 D3) —
practice it once, deliberately, before you need it for real.

## Podman

One path is supported: **rootful podman, driving real Compose v2 over
podman's Docker-compatible socket** — not podman-compose.

```bash
systemctl enable --now podman.socket
export DOCKER_HOST=unix:///run/podman/podman.sock
docker compose up -d     # the ordinary compose commands throughout this file
```

`docker compose` behaves exactly as documented once it is talking to that
socket — the installer and every command above work unchanged. `install.sh`
detects podman automatically and adjusts what it checks.

**Never run `podman-compose` against this deployment.** It silently drops
`depends_on: condition:` (translated to `--requires`, which ignores the
condition entirely) and ignores `profiles:`. On this repo's own
`docker-compose.yml`, `podman-compose up -d` exits `0` with every app
container stuck in `Created` — the migration never gates them, it just never
runs them — and the backup sidecar starts unrequested. A green exit code with
a broken stack is worse than no podman support at all, so `install.sh`
refuses to proceed if `docker compose` resolves to podman-compose under the
hood.

Two host settings need attention before the first `up`, both checked by the
installer:

- **Short image names.** The 8 `ghcr.io/remit-mail/remit/*` images are fully
  qualified and unaffected; the 4 upstream images (`caddy`, `pgvector`,
  `elasticmq`, `postgres`) are not. A fresh podman install has no
  unqualified-search-registries and refuses them:
  `short-name "caddy:2-alpine" did not resolve to an alias`. Fix:
  ```
  echo 'unqualified-search-registries = ["docker.io"]' | sudo tee /etc/containers/registries.conf
  ```
- **`docker login ghcr.io` while the packages are private, not `podman
  login`.** Run it as root (`sudo docker login ghcr.io`, or plain `docker
  login` if already root) — `docker compose pull` reads credentials from
  root's `~/.docker/config.json`. `podman login` succeeds on its own but
  writes to a separate podman-native auth store that `docker compose pull`
  never reads; relying on it alone gets you GHCR's
  `invalid username/password: unauthorized` on the first pull.

Rootless podman also runs the stack, with one more setting:
`net.ipv4.ip_unprivileged_port_start=80` (`sysctl -w`, or persist it in
`/etc/sysctl.conf`) — compose publishes 80 and 443 in every `TLS_MODE`, and
rootless podman refuses to bind ports below that threshold by default.
Rootful podman binds them the same as real docker and needs no tuning.

`--tls-mode tailscale` under rootless podman is unproven and likely broken:
`tailscaled`'s socket is normally `0600 root:root`, so a rootless container
gets `READ_DENIED` opening it, and the certificate fetch may also
peer-credential-check for uid 0. This isn't claimed to work — use rootful
podman if you need `tailscale` mode.

## Backups (RFC 035 D7)

A `backup` sidecar (`deploy/vps/backup/backup.sh`) is in `docker-compose.yml`
behind `profiles: ["backup"]` — off by default, on with
`docker compose --profile backup up -d`. It runs a nightly `pg_dump`,
encrypted with `age`, shipped to an S3-compatible bucket via `rclone`
(retention 30 days is the reference RPO: 24 hours). The database —
accounts, credentials, metadata, tags — is the asset; message bodies are a
cache of IMAP (the source of truth) and re-sync after a restore, so they
are deliberately not backed up here.

Turning it on is not free of responsibility: you own the offsite bucket,
custody of the `age` key (losing it makes every backup unreadable, and
there is no recovery from that), and actually testing a restore before you
need one — decrypt a backup with the private key, `gunzip`, `psql` it into
a scratch database, and confirm it looks right. See the Backups section in
`remit.env.template` for the variables (`BACKUP_AGE_RECIPIENT`,
`BACKUP_RCLONE_REMOTE`, and the `RCLONE_CONFIG_*` vars for your provider).

## Known gap: account deletion's AWS-only steps

`account-worker`'s deletion cascade calls Cognito (sign-out) and CloudFront
(cache invalidation) directly — both AWS-only, with no portable
implementation in this codebase today. The image runs and the queues are
wired (`remit-account-fanout`, `remit-account-finalize`,
`remit-account-purge-delete.fifo`), but triggering an actual account
deletion on this deployment will error partway through the cascade. This is
a pre-existing application gap (see `packages/remit-account-worker/src/poller.ts`),
not something particular to this deployment — flagged here so it's not a
surprise.

## Queue failures: watch the dead-letter queues

Every worker queue in `elasticmq.conf` has a dead-letter queue
(`<queue>-dlq`, `maxReceiveCount = 3`) — a message a worker's handler keeps
failing to process (a malformed payload, a bug, a downstream outage) is
redelivered up to 3 times, then quarantined in the DLQ instead of
redelivering forever and crash-looping the worker. This stops one bad
message from taking a whole queue's throughput down, but a message that
lands in a DLQ is not automatically retried or drained — it just sits
there until an operator looks at it.

Check depth periodically (`docker compose exec elasticmq wget -qO-
--post-data='Action=GetQueueAttributes&QueueUrl=http://localhost:9324/000000000000/remit-body-dlq&AttributeName.1=ApproximateNumberOfMessages&Version=2012-11-05' http://localhost:9324/`,
or any SQS-compatible client against the queue you care about — the
`elasticmq-native` image ships `wget`, not `curl`). A non-zero
DLQ is a signal to look at, not a resolved failure: inspect the message
body (`Action=ReceiveMessage` against the `-dlq` queue), fix the underlying
bug or bad data, then either move it back to the source queue by hand
(`SendMessage` to the original queue, `DeleteMessage` from the DLQ) or
discard it once you understand why it failed.

## Security notes

- `.env` holds real secrets (Postgres password, the better-auth JWT signing
  key, the IMAP credential encryption key). `chmod 600` it and never commit
  it — `deploy/vps/.gitignore` already excludes it.
- The IMAP credential encryption key (`FAKE_KMS_DATAKEY`) is explained in
  the template — the name is a holdover from how the code was first built,
  not a statement that it's unfit for this use. Generate it once, keep it
  safe; losing it makes every stored IMAP credential unrecoverable.
- `apisix` re-verifies every JWT the same way the backend does — defence in
  depth, not the only check.
