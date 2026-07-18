# Reader — self-host VPS deployment

A single-VM deployment: Docker Compose on one small box, running the published
`ghcr.io/remit-mail/remit/*` images plus three upstream images (`caddy`,
`elasticmq`, `alpine`). All relational state lives in two SQLite files on one
local volume — there is no database server to run. Message bodies are cached
on a second volume and can always be re-synced from IMAP.

Sized for a 2 vCPU / 4 GB box (~€5/mo class). HTTPS on :443 out of the box,
signed by Caddy's own CA (browsers warn until you trust its root); the [TLS](#tls)
section covers the other modes, including plain HTTP.

The images are published to `ghcr.io/remit-mail/remit/*` and pull anonymously —
no registry login, no token, nothing on the box holds a credential.

## Install

On a fresh amd64 box with Docker (or Podman) and the Compose v2 plugin:

```bash
curl -fsSL https://raw.githubusercontent.com/remit-mail/reader/main/install.sh \
  | bash -s -- --origin https://your-host
```

The installer downloads the deploy assets into `./reader`, generates the
secrets, writes `.env` with mode 600, and brings the stack up. It takes no
input while it runs — everything comes from flags and environment variables.
`--help` lists them; the ones that matter are `--tls-mode`, `--tag`, `--dir`
and `--dry-run`. `--dry-run` runs the host checks, fetches the assets, writes
`.env`, and validates the compose file without pulling images or starting
anything.

The installer checks the host before it changes anything: a container engine
and the Compose v2 plugin (real Compose, not podman-compose), amd64 (no arm64
image is built), and ports 80 and 443. It also normalizes `--origin` against
`--tls-mode` — an `http://` origin is upgraded to `https://` under the default
`internal` mode, and `--tls-mode off` requires an `http://` origin.

Re-running is safe for your data. An existing `.env` is kept, and a secret that
already has a value is never regenerated: `.env` holds `FAKE_KMS_DATAKEY`, the
only copy of the key every stored IMAP credential is encrypted with. The
installer re-downloads the deploy assets on every run, so edits to the compose
file or the Caddy files are replaced — pin the image version through
`REMIT_TAG` in `.env` (which is kept across runs), not by editing the compose
file.

Then visit the address passed as `--origin`. The first sign-up on that page
creates your account; every subsequent IMAP account is added from the app
itself (Settings → Add account).

## Managing the deployment

The installer writes everything into the install directory (`./reader` by
default). Manage the stack with Compose from that directory:

```bash
cd reader
docker compose -f docker-compose.sqlite.yml --env-file .env ps
docker compose -f docker-compose.sqlite.yml --env-file .env logs -f [service…]
docker compose -f docker-compose.sqlite.yml --env-file .env down   # data volumes are kept
```

Editing `.env` and running `docker compose restart` does not apply the change.
`restart` reuses the existing containers with the environment they were created
with, and reports success — the edit appears to have taken effect and has not.
`docker compose … up -d` recreates the containers whose configuration changed,
which is what applies an `.env` edit.

`deploy/vps/remit` is a wrapper over these commands (`remit status`, `remit
logs`, `remit restart`, `remit update`, `remit down`, `remit config`) — it adds
the `-f`/`--env-file` flags and reads the install directory from `$REMIT_DIR`.
The installer does not put it on your PATH; copy it to `/usr/local/bin/remit`
and set `REMIT_DIR` to your install directory if you want the shorter commands.

## Manual install

The explicit path the installer automates:

```bash
cd deploy/vps
cp remit.env.template .env
chmod 600 .env
$EDITOR .env            # fill in every value marked SECRET — see the file
docker compose -f docker-compose.sqlite.yml --env-file .env up -d
docker compose -f docker-compose.sqlite.yml --env-file .env logs -f migrate
```

The two secrets the stack cannot run without are `BETTER_AUTH_SECRET` (signs
the identity JWTs) and `FAKE_KMS_DATAKEY` (encrypts stored IMAP credentials).
Generate each with `openssl rand -hex 32`. `migrate` is a one-shot that runs
before every app service and applies the schema; confirm it succeeds before
signing in.

Then visit the address you set as `PUBLIC_ORIGIN` in `.env`. The first sign-up
creates your account; every subsequent IMAP account is added from the app
itself (Settings → Add account).

## What's running

| Service | Image | Role |
|---|---|---|
| `caddy` | `caddy:2-alpine` | The edge: reverse proxy and TLS termination. Publishes the only host ports, 80 and 443 (443 is bound in every mode but serves traffic only in the TLS modes). See [TLS](#tls). |
| `apisix` | `ghcr.io/remit-mail/remit/apisix` | Edge JWT gate, with the generated route table baked in. |
| `web` | `ghcr.io/remit-mail/remit/web` | Static server for the built web client. |
| `backend` | `ghcr.io/remit-mail/remit/backend` | The API. Also the image the `migrate` and `volume-init` one-shots run. |
| `imap-worker`, `smtp-worker`, `account-worker`, `search-index-worker` | `ghcr.io/remit-mail/remit/*` | Queue pollers: sync mail, push flag and folder changes back, send outgoing mail, and build the search index. |
| `elasticmq` | `softwaremill/elasticmq-native` | The SQS-compatible queue seam. |
| `migrate` | `ghcr.io/remit-mail/remit/backend` (command override) | One-shot: applies the SQLite migrations and the FTS5 search index before any app service starts. |
| `volume-init` | `ghcr.io/remit-mail/remit/backend` (entrypoint override) | One-shot: fixes ownership of the data volumes so the non-root app user can write them. |
| `backup` | `alpine:3.23` | Off by default (`profiles: ["backup"]`). Nightly encrypted database snapshot. See [Backups](#backups). |

The relational store and the better-auth identity tables share one file
(`/data/sqlite/remit.db`); the vector store keeps its data in a second file
(`/data/sqlite/vec.db`). Both sit on the `sqlite_data` named volume, which
**must be local disk** — WAL's cross-process coordination uses a shared-memory
file next to the database that does not work over NFS/CIFS. Message bodies live
on the `message_storage` named volume via the filesystem storage backend — not
backed up by the nightly snapshot below (see [Backups](#backups)).

The idle footprint stays small: removing a database server leaves the embedding
model in `search-index-worker` as the largest resident once indexing has run.

## Search

Text search is the primary surface and works out of the box: FTS5 over subjects
and senders. Queries of 1–2 characters run as an unindexed scan rather than
through the index.

Semantic (vector) search queries are not served. Answering one requires
embedding the query in the API process, and the `backend` image deliberately
ships without the embedding runtime (the model plus its dependencies would
roughly quadruple the image and keep hundreds of MiB resident). The vector
store's extension is additionally glibc-only, which the Alpine/musl backend
cannot load. The `/search/semantic` endpoint detects the missing pipeline and
returns empty results instead of erroring, so the web client's "Related"
section is simply empty. The `search-index-worker` still indexes embeddings, so
a future backend image that carries the query pipeline lights up semantic search
without a re-index.

## TLS

One setting, `TLS_MODE` in `.env`, picks how Caddy serves the origin. `internal`
needs nothing outside the box. Set it, set `PUBLIC_ORIGIN` to a matching
`scheme://host`, and bring the stack up.

| `TLS_MODE` | What it does | `PUBLIC_ORIGIN` |
|---|---|---|
| `internal` (default) | HTTPS on :443 with Caddy's own locally-trusted CA. No public DNS, no ACME, no tailnet. Browsers warn until you trust the root CA. | `https://…` |
| `off` | Plain HTTP on :80. Reach it over a private network (tailnet, VPN, SSH tunnel). | `http://…` |
| `tailscale` | A publicly-trusted certificate from the local `tailscaled` for this box's `<name>.<tailnet>.ts.net`. | `https://<name>.<tailnet>.ts.net` |
| `acme` | Public Let's Encrypt. Ports 80/443 must be reachable from the internet and the host must resolve in public DNS. | `https://mail.example.com` |

To make the `internal`-mode browser warning go away, trust Caddy's root CA on
each client. Caddy keeps it on the `caddy_data` volume; export it with:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env cp \
  caddy:/data/caddy/pki/authorities/local/root.crt ./reader-root.crt
```

Then import `reader-root.crt` into the client's trust store (macOS Keychain, the
Windows cert store, `/usr/local/share/ca-certificates` +
`update-ca-certificates` on Linux, or the browser's own authorities). Skipping
this is fine — it only means the browser warning stays.

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
the host, free it before starting the stack.

**I set `TLS_MODE=tailscale` but Caddy can't get a certificate.** Two usual
causes: HTTPS isn't enabled for the tailnet, or `TAILSCALED_SOCKET` doesn't
point at a running `tailscaled` (the socket must exist on the host and be
mounted into the container). Both are required.

**Do I have to change `PUBLIC_ORIGIN` when I switch modes?** Yes — its scheme
must match. `http://` only for `off`; `https://` for the other three. It stays
the single origin knob (Caddy's site address and the app's auth/CORS origins all
derive from it), so nothing else changes.

**Can I use `acme` behind a tailnet or without public DNS?** No. Public Let's
Encrypt validates a publicly-resolvable name over ports 80/443. Use `internal`
or `tailscale` for private networks.

## Updating

Point `REMIT_TAG` at the tag you want, pull, and apply:

```bash
$EDITOR .env             # set REMIT_TAG=sha-<git-sha>
docker compose -f docker-compose.sqlite.yml --env-file .env pull
docker compose -f docker-compose.sqlite.yml --env-file .env up -d
```

`migrate` runs again (idempotent) before the app services restart. Published
tags are listed on the `ghcr.io/remit-mail/remit/backend` package page in GitHub
Packages; every image in the roster is built and tagged together, so the same
`REMIT_TAG` value applies to all of them.

`latest` tracks `main` — convenient for a first install, but pin a specific
`sha-…` tag once you are running for real so an update is a deliberate step.

## Rollback

Point `REMIT_TAG` at the previous working tag (or a pinned digest) and run the
same pull/up. This is also the disaster-recovery story for a bad release —
practice it once, deliberately, before you need it for real.

## Podman

One path is supported: **rootful Podman driving real Compose v2 over Podman's
Docker-compatible socket** — not podman-compose.

```bash
systemctl enable --now podman.socket
export DOCKER_HOST=unix:///run/podman/podman.sock
docker compose -f docker-compose.sqlite.yml --env-file .env up -d
```

`docker compose` behaves as documented once it is talking to that socket — the
installer and every command above work unchanged.

**Never run `podman-compose` against this deployment.** It silently drops
`depends_on: condition:` and ignores `profiles:`, so every app container is left
in `Created` (the migration never gates them, it just never runs them) while the
command exits `0`. A green exit with a broken stack is worse than no Podman
support, so the installer refuses to proceed if `docker compose` resolves to
podman-compose.

One host setting needs attention before the first start, checked by the
installer:

- **Short image names.** The `ghcr.io/remit-mail/remit/*` images are fully
  qualified and unaffected; the upstream images (`caddy`, `elasticmq`, `alpine`)
  are pulled by short name. A fresh Podman install has no
  unqualified-search-registries and refuses them
  (`short-name "caddy:2-alpine" did not resolve to an alias`). Fix:
  ```
  echo 'unqualified-search-registries = ["docker.io"]' | sudo tee /etc/containers/registries.conf
  ```

Rootless Podman also runs the stack, with one more setting:
`net.ipv4.ip_unprivileged_port_start=80` (`sysctl -w`, or persist it in
`/etc/sysctl.conf`) — compose publishes 80 and 443 in every `TLS_MODE`, and
rootless Podman refuses to bind ports below that threshold by default. Rootful
Podman binds them the same as real Docker and needs no tuning.

`--tls-mode tailscale` under rootless Podman is unproven and likely broken: the
`tailscaled` socket is normally `0600 root:root`, so a rootless container gets
`READ_DENIED` opening it. Use rootful Podman if you need `tailscale` mode.

## Backups

A `backup` sidecar is in the compose file behind `profiles: ["backup"]` — off by
default, on with:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env --profile backup up -d
```

It runs `VACUUM INTO` on the two database files — the app/auth store and the
vector store — on a nightly interval, encrypts each with `age`, and ships them
to an S3-compatible bucket via `rclone`. Retention defaults to 30 days (the
reference RPO is 24 hours). The database — accounts, credentials, metadata,
tags — is the asset; message bodies are a cache of IMAP (the source of truth)
and re-sync after a restore, so they are deliberately not backed up here.
Restore is putting the two files back on the `sqlite_data` volume and starting
the stack.

Turning it on is not free of responsibility: you own the offsite bucket,
custody of the `age` key (losing it makes every backup unreadable, with no
recovery), and actually testing a restore before you need one — decrypt a
backup with the private key, `gunzip` it, open it with `sqlite3`, and confirm it
looks right. See the Backups section in `remit.env.template` for the variables
(`BACKUP_AGE_RECIPIENT`, `BACKUP_RCLONE_REMOTE`, and the `RCLONE_CONFIG_*` vars
for your provider).

## Known gap: account deletion's AWS-only steps

The `account-worker` deletion cascade calls AWS-only services directly (identity
sign-out and CDN cache invalidation), with no portable implementation in the
codebase today. The image runs and the queues are wired
(`remit-account-fanout`, `remit-account-finalize`,
`remit-account-purge-delete.fifo`), but triggering an actual account deletion on
this deployment errors partway through the cascade. This is a pre-existing
application gap, not something particular to this deployment — flagged here so
it is not a surprise.

## Queue failures: watch the dead-letter queues

Every worker queue in `elasticmq.conf` has a dead-letter queue (`<queue>-dlq`,
`maxReceiveCount = 3`) — a message a worker's handler keeps failing to process
(a malformed payload, a bug, a downstream outage) is redelivered up to 3 times,
then quarantined in the DLQ instead of redelivering forever and crash-looping
the worker. This stops one bad message from taking a whole queue's throughput
down, but a message that lands in a DLQ is not automatically retried or drained
— it sits there until an operator looks at it.

Check depth periodically — any SQS-compatible client against the queue you care
about works. The `elasticmq-native` image ships `wget`, not `curl`:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env exec elasticmq \
  wget -qO- --post-data='Action=GetQueueAttributes&QueueUrl=http://localhost:9324/000000000000/remit-body-dlq&AttributeName.1=ApproximateNumberOfMessages&Version=2012-11-05' \
  http://localhost:9324/
```

A non-zero DLQ is a signal to look at, not a resolved failure: inspect the
message body (`Action=ReceiveMessage` against the `-dlq` queue), fix the
underlying bug or bad data, then either move it back to the source queue by hand
(`SendMessage` to the original queue, `DeleteMessage` from the DLQ) or discard it
once you understand why it failed.

## Security notes

- `.env` holds real secrets (the better-auth JWT signing key and the IMAP
  credential encryption key). `chmod 600` it and never commit it —
  `deploy/vps/.gitignore` already excludes it.
- The IMAP credential encryption key (`FAKE_KMS_DATAKEY`) is explained in the
  template — the name is a holdover from how the code was first built, not a
  statement that it is unfit for this use. Generate it once, keep it safe;
  losing it makes every stored IMAP credential unrecoverable.
- `apisix` re-verifies every JWT the same way the backend does — defence in
  depth, not the only check.
