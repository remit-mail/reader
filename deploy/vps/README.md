# Reader — self-host VPS deployment

A single-VM deployment: Docker Compose on one small box, running the published
`ghcr.io/remit-mail/reader/*` images plus two upstream images (`caddy`,
`alpine`) and, behind optional profiles, two more (`dozzle`,
`victoria-metrics`). All relational state lives in two SQLite files on one
local volume — there is no database server to run. Message bodies are cached
on a second volume and can always be re-synced from IMAP.

Sized for a 2 vCPU / 4 GB box (~€5/mo class). HTTPS on :443 out of the box,
signed by Caddy's own CA (browsers warn until you trust its root); the [TLS](#tls)
section covers the other modes, including plain HTTP.

The images are published to `ghcr.io/remit-mail/reader/*` and pull anonymously —
no registry login, no token, nothing on the box holds a credential.

## Install

On a fresh amd64 box with Docker (or Podman) and the Compose v2 plugin:

```bash
REMIT_ORIGIN="https://<the address you will load the app from>"
curl -fsSL https://raw.githubusercontent.com/remit-mail/reader/main/install.sh \
  | bash -s -- --origin "$REMIT_ORIGIN"
```

Set `REMIT_ORIGIN` first — pasted unedited, the installer refuses the
placeholder rather than installing against it. Every auth and CORS origin
derives from this value, so one that is merely accepted rather than correct
surfaces later as a failed sign-in, not as a failed install.

The installer downloads the deploy assets into `./reader`, generates the
secrets, writes `.env` with mode 600, and brings the stack up. It takes no
input while it runs — everything comes from flags and environment variables.
`--help` lists them; the ones that matter are `--tls-mode`, `--tag`, `--dir`
and `--dry-run`. `--dry-run` runs the host checks, fetches the assets, writes
`.env`, and validates the compose file without pulling images or starting
anything.

The installer checks the host before it changes anything: a container engine
and the Compose v2 plugin (real Compose, not podman-compose, 2.30 or newer),
amd64 (no arm64 image is built), and ports 80 and 443. It also normalizes
`--origin` against `--tls-mode` — an `http://` origin is upgraded to `https://`
under the default `internal` mode, and `--tls-mode off` requires an `http://`
origin.

Re-running is safe for your data. An existing `.env` is kept, and a secret that
already has a value is never regenerated: `.env` holds `FAKE_KMS_DATAKEY`, the
only copy of the key every stored IMAP credential is encrypted with. The
installer re-downloads the deploy assets on every run, so edits to the compose
file or the Caddy files are replaced — pin the image version through
`REMIT_TAG` in `.env` (which is kept across runs), not by editing the compose
file.

The host checks run on every invocation, existing install or not, and there is
one that stops a re-run against a deployment that is serving: a Compose plugin
older than 2.30. Nothing is changed when it does. Below 2.30 `--profile '*'`
selects no profile, so `remit down`, `remit purge` and `remit restart --hard`
skip the optional profiles while reporting that they covered everything, and
`remit restart` cannot tell a service that was removed from the compose file
from one sitting behind a profile — so it keeps a name it can never start in
its restart record instead of clearing it. One such name is enough to hold the
whole optional profile down: the restore brings the record back in a single
command, and Compose refuses that command outright over one name it does not
know. Both are silent, which is why the installer refuses rather than warns.
Update the compose plugin and run it again.

Then visit `$REMIT_ORIGIN` — the installer prints it when it finishes. The first
sign-up on that page creates your account; every subsequent IMAP account is
added from the app itself (Settings → Add account).

## Managing the deployment

The installer writes everything into the install directory (`./reader` by
default) and ships `remit`, which knows that directory and the compose file in
it. It is the interface to the deployment and runs from anywhere:

```bash
remit status              # what is running, and whether the origin reaches it
remit doctor              # whether anything is wrong; non-zero when it is
remit logs [service…]     # follow the logs
remit restart             # apply an edit to .env
remit update              # install the current release, atomically
remit update --check      # what is available, changing nothing
remit down                # stop serving; remit restart brings it back
remit config              # the effective configuration, secrets redacted
remit cert                # export Caddy's root CA (TLS_MODE=internal)
remit purge --yes         # destroy the deployment, data included
remit probe-host <origin> # check how a name resolves from this box
```

When `/usr/local/bin` is writable the installer puts `remit` there; otherwise it
stays in the install directory and the installer prints the one-line `sudo cp`
that places it on PATH. `$REMIT_DIR` points it at a different install directory.

That chooses whose files and `.env` are used, not whose data is touched. The
compose file pins `name: remit`, which outranks the directory it is run from, so
every install on a host is one Compose project sharing one set of containers and
volumes. A second install directory on the same box adopts the first one's data
rather than getting its own, and `remit purge` from either destroys it for both.
One deployment per host.

`remit down` stops the containers, so the address stops answering until
`remit restart`. It removes no volume — accounts, mail and settings all come
back with it.

`remit purge` is the destructive one, for abandoning a failed install or
starting clean: it removes the containers and every data volume, including
`sqlite_data`, which holds the accounts and everything organised in the app.
Those do not come back. Message bodies do — they are a cache of IMAP and
re-sync once an account is added again. Run without `--yes` it only prints what
would go. The install directory survives either way, `.env` and its
`FAKE_KMS_DATAKEY` included, so `remit restart` afterwards brings up an empty
working stack.

Apply an `.env` edit with `remit restart`, not `docker compose restart`.
Compose's `restart` reuses the existing containers with the environment they
were created with, and reports success — the edit appears to have taken effect
and has not. `remit restart` runs `up -d`, which recreates the containers whose
configuration changed.

A few operations below still show a raw `docker compose` line. Those are
escape hatches: one-off or rarely-needed things the wrapper deliberately has no
command for.

## When the app is unreachable

Run `remit status` first. Besides the service table it resolves the host in
`PUBLIC_ORIGIN` from this box and probes it, printing what it resolved to and
whether the origin answers.

The failure worth knowing about is the one nothing else reports: every container
is up, the box serves fine, and the browser hangs anyway, because the name
resolves somewhere else — a record left from an earlier origin, or a stale
answer cached by the client's resolver or MagicDNS. From the box the name works,
so nothing looks wrong. `remit status` says `this box does not hold that, so
clients reach a different machine` when that is what happened. Fix the record,
then flush the resolver cache on the machine you browse from.

`remit probe-host <origin>` runs the same check against any name, which is how
to test a record before pointing `PUBLIC_ORIGIN` at it.

## Manual install

The explicit path the installer automates, from a checkout — raw Compose
throughout, since this is the path that does without the installer:

```bash
cd deploy/vps
cp remit.env.template .env
chmod 600 .env
$EDITOR .env            # fill in every value marked SECRET — see the file
                        # and set REMIT_DEPLOY_DIR to this directory: "$(pwd)"
docker compose -f docker-compose.sqlite.yml --env-file .env up -d
docker compose -f docker-compose.sqlite.yml --env-file .env logs -f migrate
```

`REMIT_DEPLOY_DIR` is the one value the installer sets that you must set by hand
here: the absolute path of this directory. The updater mounts it at the same
path on both sides of the docker socket so a self-update resolves relative binds
against the right host path (reader#272); the `updater` service refuses to start
until it is set, rather than mount the wrong path.

`remit` still works against a directory set up this way — it just does not know
where that is, so point it there once: `export REMIT_DIR=$PWD`.

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
| `apisix` | `ghcr.io/remit-mail/reader/apisix` | Edge JWT gate, with the generated route table baked in. |
| `web` | `ghcr.io/remit-mail/reader/web` | Static server for the built web client. |
| `backend` | `ghcr.io/remit-mail/reader/backend` | The API. Also the image the `migrate` and `volume-init` one-shots run. |
| `imap-worker`, `smtp-worker`, `account-worker`, `search-index-worker` | `ghcr.io/remit-mail/reader/*` | Queue pollers: sync mail, push flag and folder changes back, send outgoing mail, and build the search index. |
| `queue` | `ghcr.io/remit-mail/reader/queue-sidecar` | The SQS-compatible queue seam: a SQLite-backed sidecar speaking the SQS wire protocol, persisting enqueued work to its own volume. |
| `migrate` | `ghcr.io/remit-mail/reader/backend` (command override) | One-shot: applies the SQLite migrations, repairs `thread_message.category`, and installs the FTS5 search index before any app service starts. See [The category repair](#the-category-repair). |
| `volume-init` | `ghcr.io/remit-mail/reader/backend` (entrypoint override) | One-shot: fixes ownership of the data volumes so the non-root app user can write them. |
| `doctor` | `ghcr.io/remit-mail/reader/doctor` | The checker: reads the signals below on an interval, computes one verdict, and posts a settled change of it to a webhook. Mounts no docker socket and publishes no port. See [Alerts](#alerts). |
| `backup` | `alpine:3.23` | Off by default (`profiles: ["backup"]`). Nightly encrypted database snapshot. See [Backups](#backups). |
| `dozzle` | `amir20/dozzle` | Off by default (`profiles: ["observability"]`). Live log tail and search. Binds `127.0.0.1` only. See [Looking at the box](#looking-at-the-box). |
| `victoriametrics` | `victoriametrics/victoria-metrics` | Off by default (`profiles: ["observability"]`). Scrapes the `/metrics` endpoints, stores the series, serves the query UI. Binds `127.0.0.1` only. |

The relational store and the better-auth identity tables share one file
(`/data/sqlite/remit.db`); the vector store keeps its data in a second file
(`/data/sqlite/vec.db`). Both sit on the `sqlite_data` named volume, which
**must be local disk** — WAL's cross-process coordination uses a shared-memory
file next to the database that does not work over NFS/CIFS. Message bodies live
on the `message_storage` named volume via the filesystem storage backend — not
backed up by the nightly snapshot below (see [Backups](#backups)).

The idle footprint stays small: removing a database server leaves the embedding
model in `search-index-worker` as the largest resident once indexing has run.
The `observability` profile adds about 30 MB resident on top of that, measured
rather than estimated — see [Looking at the box](#looking-at-the-box).

Every Node service runs under a 512 MB V8 heap ceiling, so a heavy or runaway
job fails inside its own container instead of taking the box with it. Move it
with `REMIT_NODE_HEAP_MB` in `.env` — raise it on a larger box if indexing a big
mailbox runs out of memory. The containers carry no hard memory limit on
purpose: a slow job should stay slow, not be killed.

Each worker's health is a heartbeat. A worker polls one queue per kind of work —
`imap-worker` six of them — and each of those loops rewrites its own timestamp
file on the `heartbeat` volume every poll cycle. The check reads the oldest of a
worker's files, so one wedged queue is enough to report it: a loop hung in a
socket read never exits, the container stays up, `restart: unless-stopped` never
fires, and mail quietly stops moving while its siblings keep polling. That is
the failure nothing else reports.

A file counts as stale after seven minutes, comfortably longer than the slowest
legitimate handler so a slow mailbox never reads as a hang, and the container is
marked unhealthy after three consecutive failing checks — about nine minutes
after a loop stops. Nothing restarts on it. An unhealthy worker is a condition
to look at: `remit logs <service>`, then `docker compose restart <service>` if
you want it recycled.

A healthy worker means its loops are turning, not that the work is succeeding.
For that, run [`remit doctor`](#is-anything-wrong-remit-doctor).

## The category repair

The mail list filters on `thread_message.category`, a copy of `message.category`
kept on the row so the filter can be a SQL predicate over the whole folder rather
than a pass over the pages a browser happens to hold. The `migrate` one-shot
repairs any row whose copy disagrees, and logs what it found before and after —
so an upgrade leaves the numbers behind instead of an assumption. It runs one
statement, writes only rows that need it, and issues no write at all once there
is nothing left to repair.

To look without waiting for an update:

```bash
remit check-categories
```

That reports and changes nothing — the database is opened read-only — and prints
each figure with the cause it
measures and the result a healthy instance is expected to produce. Most of them
are zero, for reasons the output states. Two are not defects:

- **ahead** counts rows classified while their message is still pending. That is
  a classification in flight, so on a syncing instance it is expected and clears
  itself. Those rows are left alone.
- **not-yet-classified** counts mail the classifier has not reached.

## Search

Text search is the primary surface and works out of the box: FTS5 over subjects
and senders. Queries of 1–2 characters run as an unindexed scan rather than
through the index.

Free-text semantic (vector) search queries are not served. Answering one
requires embedding the query in the API process, and the `backend` image
deliberately ships without the embedding runtime (the model plus its
dependencies would roughly quadruple the image and keep hundreds of MiB
resident). The `/search/semantic` endpoint detects the missing embedder and
returns empty results instead of erroring, so the web client's "Related" section
is simply empty. The `search-index-worker` still indexes embeddings, so a future
backend image that carries the query pipeline lights up free-text semantic
search without a re-index.

The Organize "find similar" widen does work. It pools the vectors already stored
for the anchor message and runs a nearest-neighbour read over the vector store —
no query embedding, so it needs only `sqlite-vec`. The npm build of that
extension is glibc-only and will not load on the Alpine/musl `backend` image, so
the image carries a musl-compiled `vec0.so` and points the store's loader at it
(`SQLITE_VEC_EXTENSION_PATH`).

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
each client. Caddy keeps it on the `caddy_data` volume; export it into the
current directory with:

```bash
remit cert
```

Then import `reader-root.crt` into the client's trust store (macOS Keychain, the
Windows cert store, `/usr/local/share/ca-certificates` +
`update-ca-certificates` on Linux, or the browser's own authorities). Skipping
this is fine, but a browser's click-through exception is pinned to the leaf
certificate, which Caddy reissues every 12 hours — so the warning (and the
click-through) comes back twice a day. Trusting the root CA once per device is
what makes it go away for good.

The same file is also a download in the app: Settings › Advanced offers it
directly, for a client that has no shell access to the box.

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

An update can come from two places, and both run the same sequence. In the app,
any signed-in user of the instance is offered the release and installs it with a
click. At a shell:

```bash
remit update                    # install the current release
remit update --check            # report what is available, change nothing
remit update --tag sha-<git-sha>
remit update --recover          # finish an update that was interrupted
```

The app path goes through the `updater` container, which watches a private
volume the app writes a version string onto and runs this same `remit`. It binds
no port; the volume is the only way to reach it, and only the backend and the
updater mount it. What the app hands across is a version and nothing else — the
registry and every image reference come from the manifest the updater fetches
itself, so a compromised app cannot redirect an update at another registry.

The updater also checks the manifest on its own — once at startup and every six
hours after, so the app shows an available release without anyone opening a
shell. Override the cadence with `REMIT_UPDATE_CHECK_INTERVAL` (seconds); the
check only reports and never installs.

An update takes the instance offline for a few minutes. Nothing is served and no
worker runs between the snapshot and the verdict, so nothing is lost if it rolls
back — a rollback returns the instance to the exact release and database it was
running before. Caddy stays up throughout and serves 502s, so a browser sees an
instance restarting rather than a name that stopped resolving.

Against a running stack an update is atomic. In order:

1. The manifest at `REMIT_UPDATE_MANIFEST_URL` is fetched and validated. A
   version at or below the running one is refused, as is a manifest naming
   images from outside its own registry.
2. Every image is pulled at the target version. A failure here — a registry
   refusal, a full disk — has touched nothing and a retry is safe.
3. Both databases are snapshotted with `VACUUM INTO` **while the old version is
   still live**. The work queue is deliberately not part of the snapshot.
4. `REMIT_TAG` is written to `.env`, before the stop, so a host that reboots
   mid-update comes back on binaries that match the migrated database.
5. Every service stops. The instance is offline from here.
6. Only `queue`, `migrate` and `backend` start. APISIX, the web server and every
   worker stay down, so nothing is served and nothing is sent, purged or indexed
   between the snapshot and the verdict.
7. The gate: this run's `migrate` exited `0`, every recreated service is up and
   not restarting, every healthcheck reports healthy, and `/health` answers
   three times in a row. 300 seconds, then the update has failed.
8. On a pass the held-back services start and the update is done.
9. On a failure the snapshot and the previous tag are restored, the gate runs
   again, and the outcome is `rolledBack` — or `rollbackFailed`, which is the
   one case that ends with you needing this shell.

`remit status` reports the running version, the last check and the last run's
outcome. Caddy stays up throughout and serves 502s, so a browser sees an
instance that is restarting rather than a name that stopped resolving.

The check reports two schema versions: the running instance's, read from the
database, and the target release's, carried in the manifest. A target whose
schema version is higher than the running one applies a schema migration during
the offline window; a rollback restores the pre-migration database, so the
schema version returns to what it was. Neither number is a verdict — the update
runs the same atomic sequence either way — but a higher target schema is the
signal that this update changes the database, not only the binaries.

Discovery is the manifest and nothing else. The default `REMIT_UPDATE_MANIFEST_URL`
is the `stable.json` asset of the project's latest published GitHub release, which
the release workflow uploads before the release leaves draft. A `vX.Y.Z` tag can
be present in the registry for a version that was never fully published — image
pushes are not atomic across the roster — so a tag existing is not an offer,
because no published release carries its manifest. Clear
`REMIT_UPDATE_MANIFEST_URL` and no check happens at all; point it at your own
HTTPS URL serving the same JSON to hold releases back or run a fork.

`--tag` still installs any tag directly, published release or not, and takes the
same gate and the same rollback. On a box with nothing running yet — the
installer's first update — there is no old version to snapshot and nothing to
roll back to, so it pulls and starts, as before.

## Rollback

A failed update rolls itself back. The snapshot it restores was taken before
anything stopped, so it carries the writes still in the write-ahead log, and the
restored files are left owned by `1000:1000` — a root-owned file on
`sqlite_data` makes every app writer fail with `EACCES`.

To go back deliberately, `remit update --tag <previous working tag>`. Practise
it once before you need it.

If the updater is killed mid-run, it recovers on its next start rather than
waiting for you: `remit update --recover` reads the breadcrumb on its volume and
branches on the phase it recorded. Interrupted before anything stopped, the
update is abandoned and the instance was never touched. Interrupted after, the
gate decides, and an interrupted rollback can only end as rolled back or failed
— never as a success. The lock is an `flock`, released by the kernel when its
holder dies, so a killed updater never locks its own recovery out.

`rollbackFailed` is the one outcome that needs you. The pre-update snapshot is
still on the updater's volume under `snapshots/<runId>/` and the previous
release's images are still pulled, so the repair is bounded: restore the
snapshot over `sqlite_data` as uid 1000, put the previous tag back in `.env`,
and `remit restart`.

## Podman

One path is supported: **rootful Podman driving real Compose v2 over Podman's
Docker-compatible socket** — not podman-compose.

```bash
systemctl enable --now podman.socket
export DOCKER_HOST=unix:///run/podman/podman.sock
```

`docker compose` behaves as documented once it is talking to that socket, so the
installer and every `remit` command above work unchanged.

**Never run `podman-compose` against this deployment.** It silently drops
`depends_on: condition:` and ignores `profiles:`, so every app container is left
in `Created` (the migration never gates them, it just never runs them) while the
command exits `0`. A green exit with a broken stack is worse than no Podman
support, so the installer refuses to proceed if `docker compose` resolves to
podman-compose.

One host setting needs attention before the first start, checked by the
installer:

- **Short image names.** The `ghcr.io/remit-mail/reader/*` images are fully
  qualified and unaffected; the upstream images (`caddy`, `alpine`, and
  `amir20/dozzle` and `victoriametrics/victoria-metrics` behind the
  `observability` profile) are pulled by short name. A fresh Podman install has
  no unqualified-search-registries and refuses them
  (`short-name "caddy:2-alpine" did not resolve to an alias`). Fix:
  ```
  echo 'unqualified-search-registries = ["docker.io"]' | sudo tee /etc/containers/registries.conf
  ```

- **The observability profile's log viewer needs the socket path.** dozzle reads
  container logs from the host socket, and the compose default is Docker's
  `/var/run/docker.sock`. That path does not exist on a Podman host, and Podman
  refuses the mount rather than creating it, so `--profile observability up -d`
  fails outright. Point it at Podman's socket in `.env`:
  ```
  REMIT_DOZZLE_SOCKET=/run/podman/podman.sock
  ```
  `victoriametrics` needs nothing — it reads over the network, not the socket.

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
default. Turning it on is a one-off, so it is an escape hatch rather than a
`remit` command; run it from the install directory:

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

## ListId backfill for pre-upgrade mail

Filters can match on a mailing list's `List-Id`, but the field is only
populated at body-sync time — mail synced before this shipped keeps it empty,
so a `ListId` clause under-matches the back catalogue. A one-time backfill
derives it from each message's already-stored raw source (no IMAP refetch)
and writes only that field:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env run --rm backend \
  node backfill-list-id.mjs
```

Safe to interrupt: it checkpoints to `/data/sqlite/list-id-backfill-checkpoint.json`
after every batch and resumes from there on the next run, and a message
already backfilled (or one that never carried a `List-Id`) is left alone on a
rerun. Run it once after upgrading; there is no need to run it again unless a
later run is interrupted before completion.

## Known gap: account deletion's AWS-only steps

The `account-worker` deletion cascade calls AWS-only services directly (identity
sign-out and CDN cache invalidation), with no portable implementation in the
codebase today. The image runs and the queues are wired
(`remit-account-fanout`, `remit-account-finalize`,
`remit-account-purge-delete.fifo`), but triggering an actual account deletion on
this deployment errors partway through the cascade. This is a pre-existing
application gap, not something particular to this deployment — flagged here so
it is not a surprise.

## Logs

Every service writes one JSON object per line to stdout — the queue sidecar puts
its failures on stderr, and `remit logs` shows both. That includes the first line
a container writes: there is no startup banner, no table of settings, and no
plain-text progress from the `migrate` one-shot. Nothing writes a log file, and
nothing rotates one, so the container runtime's log driver is the only shipping
mechanism involved.

One exception, and it is not a container: `remit-worker`, the hand-run CLI that
enqueues a sync event for an account, writes plain text for a terminal. It is not
an entrypoint of any image and never runs under the log driver, so nothing a
pipeline reads is affected.

These field names are the contract. They are what a Vector, Alloy, Fluent Bit or
Promtail pipeline parses, and they do not change without a note in the release:

| Field | Always present | What it is |
|---|---|---|
| `level` | yes | `trace`, `debug`, `info`, `warn`, `error` or `fatal`, lowercase. |
| `time` | yes | When the line was written, RFC 3339 with millisecond precision, always UTC (`2026-01-30T09:12:44.117Z`). |
| `service` | yes | Which service wrote it. Stamped into the image at build time, so it is the service and not the container name. |
| `msg` | yes | The human-readable message. An empty string on a line that carries only fields. |
| `error` | no | On a failure line. An object with `type`, `message` and `stack` where the failure was an exception; a plain string where the call site only had one. |
| `stack` | no | A stack trace as a top-level string, on the backend's error paths, alongside a string `error`. |
| `name` | no | An exception class name, on the same backend paths. |

`service` is one of `backend`, `imap-worker`, `smtp-worker`, `account-worker`,
`search-index-worker`, `queue-sidecar`, or — from the
one-shot commands that run out of the backend image — `backend-migrate` and
`backend-backfill-list-id`. Migrations log under their own name, not the
backend's.

Everything else on a line is a field the call site added, at the top level, never
nested: `accountId`, `mailboxId`, `messageId`, `queue`, `requestId`, `path`,
`method`. Treat the set as open — a new field appears without warning, a
documented one does not disappear without a note.

`requestId` is the correlation key, and the unit it covers is one handler
invocation — one HTTP request on the backend, one batch of queue messages on a
worker. A batch is one message by default, so on today's configuration the id is
per message, but a target that raises its batch size puts that whole batch under
one id. Every line the invocation produces carries the value, from the poller's
`poller: invoking handler` through the handler's own lines to
`poller: batch processed`, including the `Lambda invocation failed` line written
after the handler has already given up. Grouping on it yields the complete story
of one unit of work, outcome included.

`level`, `time`, `service` and `msg` are reserved. A call-site field using one of
those names is dropped rather than written, so a line is always one well-formed
object and its level always means what it says.

There is no `pid` and no `hostname`. One container runs one service, and the
container name and id already reach the collector from the log driver.

Two consequences worth planning a pipeline around. **A message body, a subject
and an address never appear in a field of their own**, but a message that a
handler failed on can put an address inside `msg`, inside `error` or inside a
stack, so treat log lines as personal data and give them the retention you give
the mailbox. And **lines are not ordered across services** — `time` is each
container's own clock, so sort on it rather than on arrival.

`LOG_LEVEL` in `.env` sets the threshold for the application services; unset it
is `info`, which drops `debug` and `trace`. `silent` turns logging off entirely.
A value that is not a level name is reported on one `warn` line at startup and
the service logs at `info`. The queue sidecar has no threshold — it writes only
`info` and `error`.

```bash
remit logs backend | jq -c 'select(.level=="error")'
remit logs | jq -r 'select(.accountId=="…") | "\(.time) \(.service) \(.msg)"'
remit logs imap-worker | jq -r 'select(.error) | .error.stack // .stack // .error'
```

## Metrics

Every service that owns a signal serves `/metrics` in Prometheus/OpenMetrics text
format on the container network. `backend` and `queue` serve it on the port they
already listen on; the four workers serve it on `9464`. Nothing is published to
the host, nothing is routed through Caddy, and there are no credentials — the only
host ports remain caddy's 80 and 443.

Point any scraper you already run at the containers: Prometheus, VictoriaMetrics,
Grafana Alloy, a Datadog agent, an OpenTelemetry collector. Nothing is ever
pushed, so an operator who runs no scraper pays for an unused route and the box
makes no outbound connection. If you run none and want one on the box, the
optional `observability` profile is a scraper and a query UI in one container —
see [Looking at the box](#looking-at-the-box).

| Series | From |
|---|---|
| `remit_queue_messages{queue,role}` | `queue` — depth per queue; `role="dead_letter"` is a DLQ |
| `remit_account_sync_age_seconds{account_id}` | `backend` — seconds since that account last completed a message-sync round |
| `remit_imap_failures_total{operation,kind}` | `imap-worker` — `kind="auth"` is counted apart from other failures |
| `remit_smtp_failures_total{kind}` | `smtp-worker` — same split |
| `remit_queue_event_duration_seconds{queue,event_type,outcome}` | each worker — per-message duration and outcome |
| `remit_handler_duration_seconds{handler,outcome}` | each worker — per-invocation duration and outcome |
| `remit_search_index_backlog_rows` | `search-index-worker` — outbox rows not yet relayed; present only on the backend that has an outbox |

Host CPU, memory, disk and network are not here: the agent you already run reports
those, and it cannot know whether mail is arriving. Per-account series are labelled
by account id and never by address — a scraped label travels wherever the scrape
goes. Update state is not here either; it lives on the `updater_state` volume and
`remit status` prints it.

`remit_account_sync_age_seconds` sawtooths rather than sitting flat. A sync that
was not explicitly requested skips a mailbox stamped inside the freshness window
(`MAILBOX_FRESHNESS_MS`, 60 s by default), so on a healthy account the value
climbs to that window plus the scheduler's tick interval before dropping back.
Set an alert threshold above their sum or it fires on an account that is fine.

A scrape that cannot evaluate a signal answers 500 rather than a number. The
queue depths fail that way when the sidecar's database holds no queues, and the
sync ages when the relational store cannot be read — a series that renders `0`
because nothing could look is the failure this endpoint exists to remove.

The endpoint has no credentials, so any container on the compose network can read
it, per-account sync ages included. Weigh that before adding a container to the
stack; nothing outside the network can reach it.

Read a series from the host with `docker compose exec`:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env exec queue \
  node -e 'require("http").get("http://127.0.0.1:9324/metrics",r=>r.pipe(process.stdout))'
```

## Alerts

The `doctor` container runs a check every 60 seconds and computes one verdict:
`healthy` or `degraded`. Set two URLs in `.env` and a settled change of that
verdict is posted to a webhook. Set neither and the check still runs — it is what
answers when you ask.

It is degraded when any of these is true:

| Reason | Threshold |
|---|---|
| `scrape_failed` | A service is not answering `/metrics` |
| `worker_heartbeat_stale` | A worker's slowest poll loop has not written for 7 minutes, or has written nothing at all |
| `account_sync_stalled` | An account has not completed a sync round in 3 hours |
| `mail_auth_failing` | An IMAP or SMTP authentication failure counter has gone up in the last 3 hours |
| `dead_letter_queue_not_empty` | Anything is quarantined on any DLQ |
| `signal_missing` | A service answered `/metrics` but exported none of the series the check reads |
| `checker_unreachable` | No usable verdict came back from the checker at all. Produced by `remit doctor`, never by the checker, so it never reaches a webhook — see [Is anything wrong](#is-anything-wrong-remit-doctor) |

A signal that cannot be evaluated is degraded, never skipped. An endpoint that
refuses the connection, a heartbeat file that is absent, a scrape that times out,
a 200 that carries none of the series being read — each of them reads as a
problem, because a `healthy` produced by a check that failed to look is the worst
answer available.

Authentication is a counter, so the signal is the increase, not the total — a
counter that has been non-zero since March is not news. The increase happens on
one check, and the retries arrive one burst per sync tick, so the condition is
held open for three hours after the last one: the quiet hour between two bursts
is not a recovery.

Three hours is the sync-age threshold, deliberately. A broken password sets off
both reasons — authentication is failing, and the account stops completing sync
rounds — and matching the two windows means they clear together, so you get one
recovery message instead of two arriving hours apart.

**Fixing the password does not produce an immediate all-clear.** The condition
holds for the full window after the last failure, so expect the recovery about
three hours after you fix it, not three minutes. The same applies to anything
else that was wrong at the same time: if the stack recovers while an
authentication hold is still open, the verdict stays `degraded` until the hold
expires, and the all-clear for all of it waits that long. `remit doctor` shows
the real state immediately — the delay is in the announcement, not in the check.

`DOCTOR_AUTH_FAILURE_HOLD_SECONDS` moves the window. Keep it above
`MAILBOX_SYNC_TICK_INTERVAL_SECONDS`, or a healthy gap between two retries reads
as a recovery; keeping it equal to `DOCTOR_SYNC_AGE_MAX_SECONDS` is what buys
the single recovery message.

### Turn it on

```dotenv
DOCTOR_WEBHOOK_URL=https://hooks.slack.com/services/T000/B000/XXXX
DOCTOR_HEARTBEAT_URL=https://hc-ping.com/your-uuid
```

Then `remit restart`. Both are required together: setting the webhook without
the heartbeat fails the container at startup, and it is not a mistake in the
check — read [The dead-man's switch](#the-dead-mans-switch) before you work
around it.

For ntfy, or anything else that takes a raw body, add one line:

```dotenv
DOCTOR_WEBHOOK_URL=https://ntfy.sh/your-topic
DOCTOR_WEBHOOK_CONTENT_TYPE=text/plain
```

There is no per-provider integration. The default payload is Slack-shaped JSON,
which Mattermost and Discord also accept; `text/plain` covers the rest. If your
target wants a different document, write it:

```dotenv
DOCTOR_WEBHOOK_TEMPLATE={"title":"remit {{verdict}}","message":"{{summary}}\n{{reasons}}"}
```

`{{verdict}}` is `healthy` or `degraded`, `{{summary}}` is the one-line headline,
and `{{reasons}}` is the bullet list. Substituted values are escaped for the
content type — a JSON template gets JSON string escaping, so a value containing a
quote or a newline cannot break the document. In a plain-text template a literal
`\n` becomes a newline, since a `.env` file cannot carry a real one.

### When it sends

On a change of verdict that has held for three consecutive checks, and never on
an unchanged verdict however long it persists. Two messages per incident: one
when it breaks, one when it clears.

The dwell is what makes the channel readable. Transition-only firing on its own
is the loudest possible response to a flapping signal — a verdict that oscillates
every check sends two messages per cycle, which is worse than posting on a timer.
A dead-letter message you replay that fails again produces exactly that shape.

**The cost is three check intervals of latency.** At the default 60 second
interval an outage is reported up to three minutes after it starts, and a
recovery up to three minutes after it clears. Nobody acts inside three minutes on
a mailbox that stopped syncing, and the dead-man's switch is unaffected — it pings
on every completed check, settled or not.

The last announced verdict is on the checker's own volume, so a reboot or a
`remit update` does not re-announce a condition already reported.

The dwell is also what covers a restart. A stack coming back up reads as degraded
for a check or two while the workers reach their queues, and that is short of the
three it takes to announce. An update whose downtime runs past three minutes will
report degraded and then recover, which is accurate — mail was not moving for
three minutes. Raise `DOCTOR_DWELL_CHECKS` if you would rather not hear about it.

### What a payload carries

Counts, service names, queue names and the verdict. Never an address, a subject,
a sender, a message id, a folder name or an account id. "2 of 5 accounts have not
completed a sync in over 3h", not which two.

This is a mail server and the payload goes to a third-party service over the
internet. To find out which account, run `remit doctor` on the box — the account
ids are in its output and never in a payload.

The container holds nothing else worth sending, either: it takes no `.env`, only
the `DOCTOR_*` variables above, so it has no database path, no auth secret and no
provider credential to leak.

### The dead-man's switch

`DOCTOR_HEARTBEAT_URL` is pinged with a GET on every completed check, whatever
the verdict. Point it at healthchecks.io, Cronitor, or an Uptime Kuma push
monitor, and configure that service to alert you when the pings stop.

It is required whenever the webhook is set, and the container refuses to start
without it. If the VM is off, the disk is full, the network is gone or the checker
crashed, no alert fires — and an operator with only a webhook cannot tell that
apart from a week with nothing wrong. That is the silent failure this removes, and
behind a second optional variable the common half-configuration is the unsafe one.

A check that produced a verdict pings, including a `degraded` verdict computed
from signals it could not read: a scrape failure degrades the verdict and still
pings, because the checker is working. A check that threw before producing one
does not.

Delivery is retried when, and only when, retrying could help.

A **4xx** is the endpoint deciding about your payload — a template written wrong,
a URL that was revoked. Repeating it produces the same answer forever, so that
transition is spent and you get one `error` line in `remit logs doctor` naming
the status.

A **timeout, a refused connection, a 5xx or a 429** says nothing about the
payload, so the announcement is not recorded and the next check sends it again.
A webhook that is down for a minute delays the alert by a minute; it does not
lose it. A permanently unreachable URL costs one `error` line per interval, which
is the loud failure rather than the silent one.

The dead-man's switch does **not** cover this. It is a different URL at a
different provider and it keeps answering while your webhook is down — that is
why the retry is in the checker and not left to your monitor. What the switch
covers is the checker itself not running.

### Reading the verdict by hand

`remit doctor`, from anywhere — see [Is anything wrong](#is-anything-wrong-remit-doctor).

## Looking at the box

The `observability` profile puts two UIs on the box: one for logs, one for
metrics. It is off unless you ask for it, and it is for operators who want
history and a chart rather than a point-in-time answer. If you already run
Prometheus, Grafana, a Datadog agent or an OpenTelemetry collector, don't enable
it — point what you have at the `/metrics` endpoints above.

- **dozzle** — every container's log, live, with search across services. This is
  `remit logs` with a scrollback and a filter box. It stores nothing.
- **VictoriaMetrics** — scrapes the six `/metrics` endpoints, keeps the series,
  and serves `vmui` to query and graph them. It answers "when did that account
  last sync" and "has this DLQ ever been non-zero", which no live view can.

No dashboards ship. `vmui` is the interface: type a query, get a graph.

### Turn it on

```bash
cd <install dir>
docker compose -f docker-compose.sqlite.yml --env-file .env --profile observability up -d
```

Both containers come back on reboot and survive `remit update`, which restarts
whatever was running. Turn the profile off again with:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env stop dozzle victoriametrics
docker compose -f docker-compose.sqlite.yml --env-file .env rm -f dozzle victoriametrics
```

The metrics survive that; they are on their own volume. `docker volume rm
remit_victoriametrics_data` discards the history.

`remit down` stops these two along with everything else and prints the command
to bring them back — `remit restart` starts the always-on services only, because
nothing behind a profile is started for you. While they are running, `remit
restart` does apply an `.env` edit to them like it does to everything else, so a
changed `REMIT_METRICS_RETENTION` takes effect. A container that is crash-looping
counts as running for this: it is one the deployment is trying to run, and fixing
the `.env` that broke it is what `remit restart` is for. `remit purge` destroys
both containers and the metrics volume with the rest of the deployment.

`remit restart` writes the profile services it stopped to `.remit-profiles-held`
before it stops anything, and clears the file once they are back. If a restart is
killed in between — a dropped ssh session, or a bad `.env` edit that fails the
start — the next `remit restart` reads that file and finishes the job. Anything
it still cannot start is named, with the command that starts it.

### Reach them

**Neither is on the public origin, and neither has a password.** Both bind
`127.0.0.1` on the box and get no Caddy route. dozzle shows every log line the
stack writes, which on a mail server includes addresses and subjects in error
messages; `vmui` shows every series, per-account labels included. The loopback
bind is what protects them — do not "fix" it by publishing the port or adding a
Caddy route.

So you reach them from your laptop over an SSH tunnel:

```bash
ssh -N -L 9999:127.0.0.1:9999 -L 8428:127.0.0.1:8428 you@your-box
```

Then open <http://127.0.0.1:9999> for logs and
<http://127.0.0.1:8428/vmui/> for metrics.

On a tailnet, `tailscale serve` reaches them without a tunnel. It terminates on
the box and forwards to loopback, so the compose bind does not change:

```bash
tailscale serve --bg --https 8443 http://127.0.0.1:8428
tailscale serve --bg --https 9443 http://127.0.0.1:9999
```

That makes both readable by every device on your tailnet, not only by you.
Neither asks for a password, so treat it as the same decision as handing out a
shell on the box.

Change the loopback ports in `.env` if something else on the host already holds
one: `REMIT_DOZZLE_PORT` and `REMIT_VMUI_PORT`. The `127.0.0.1` in front of them
is not configurable.

On Podman, set `REMIT_DOZZLE_SOCKET=/run/podman/podman.sock` as well — see
[Podman](#podman).

### First queries

In `vmui`, the query box takes PromQL. Start with these:

| Question | Query |
|---|---|
| Is anything quarantined? | `remit_queue_messages{role="dead_letter"} > 0` |
| Is work piling up? | `remit_queue_messages{role="work"}` |
| When did each account last finish a sync round? | `remit_account_sync_age_seconds` |
| Is an account's password or OAuth grant broken? | `increase(remit_imap_failures_total{kind="auth"}[1h])` |
| Which handlers are failing? | `sum by (queue, event_type) (increase(remit_queue_event_duration_seconds_count{outcome="failure"}[1h]))` |
| Is a service being scraped at all? | `up` — `0` means the endpoint stopped answering |

`up` is the one to check first when a graph goes flat: a series that stops
because the container died looks exactly like a series that stops because
nothing happened.

### What it costs

Measured against a month of stored series, not an empty start:

| | Resident memory | Disk |
|---|---|---|
| `dozzle` | ~10 MB | none — it stores nothing |
| `victoriametrics` | 14 MB at start, ~21 MB settled | under 3 MB per 30 days |

About 30 MB together at rest. A query spanning the whole retention window is the
expensive thing either does: `victoriametrics` reached 37 MB straight after
running every query in the table above across 30 days, and released it.

`-memory.allowedBytes=256MB` bounds VictoriaMetrics' **caches**, which it
otherwise sizes against 60% of host RAM. It is not a ceiling on process memory —
a bulk import will exceed it — but this deployment writes 88 series every 30
seconds, so the cache sizing is the only part that would scale with the host
rather than with the work.

Retention defaults to **30 days**, set with `REMIT_METRICS_RETENTION` in `.env`.
The suffixes are `h d w M y`, and **`M` is months while `m` is minutes** —
`12m` is twelve minutes and VictoriaMetrics rejects it outright, so write twelve
months as `12M`. `30d`, `90d`, `1w`, `12M` and `1y` are all accepted.

The disk figure is a measurement: 30 days of these series backfilled at a 30 s
step occupied 0.7 MB when the values sit still, 2.8 MB when they move. Accounts
add a handful of series each, so a year of history is still tens of MB. Set
retention by how far back you want to look, not by disk.

Metrics live on their own `victoriametrics_data` volume and are never backed up.
They are a reconstructible view of the past; losing them costs history, not
state.

## Is anything wrong: `remit doctor`

`remit status` answers what is running. `remit doctor` answers whether anything
is wrong:

```bash
remit doctor
```

```
verdict degraded
checked-at 2026-07-27T08:50:01.029Z
summary remit is degraded
reason dead_letter_queue_not_empty 2 messages are quarantined on 1 dead-letter queue (remit-body-dlq)
reason account_sync_stalled 1 of 3 accounts has not completed a sync in over 3h
detail account_sync_stalled 0f8a…: 40122s
```

It checks the same conditions the alert fires on — a service not answering
`/metrics` or answering without the series, a worker's poll loop gone stale, an
account that has not completed a sync round, mail authentication failing,
anything quarantined on a dead-letter queue ([the table](#alerts)) — and it
reports the account ids behind them, which an alert payload never carries. Each
run is a fresh check, not the alerter's last verdict.

**The exit code is the point.** `0` healthy, `1` degraded, `2` when no verdict
could be produced, so it is a monitoring check as it stands:

```
*/5 * * * * remit doctor >/dev/null || logger -t remit "degraded"
```

A signal that cannot be evaluated is `degraded`, never healthy — and so is a
verdict the wrapper cannot stand behind. Exit `2` with the reason
`checker_unreachable` covers all of it: the `doctor` container is not running,
docker refuses the exec, the exec does not come back at all (it is capped;
raise `REMIT_DOCTOR_TIMEOUT` if your box needs longer), the verdict on stdout
disagrees with the exit code the exec returned, or the `--json` document
arrives truncated. In every one of those the checker's output is discarded
rather than printed. A healthy verdict from a check that failed to look, or an
exit `0` under the word `degraded`, are the two answers this command never
gives.

`checker_unreachable` is the wrapper's own code, and the only one not in the
[reason table](#alerts) — nothing in the alert path can produce it, because it
describes the checker rather than the stack.

`--json` emits the same verdict as `{ verdict, checkedAt, summary, reasons }`,
including for that case, so a script parses one shape whatever happened. The
checker's own logs go to stderr; stdout carries only the verdict.

Nothing here needs configuring. Point it somewhere to be told without asking —
see [Alerts](#alerts).

## Queue failures: watch the dead-letter queues

Every worker queue in `queues.json` has a dead-letter queue (`<queue>-dlq`,
`maxReceiveCount = 3`) — a message a worker's handler keeps failing to process
(a malformed payload, a bug, a downstream outage) is redelivered up to 3 times,
then quarantined in the DLQ instead of redelivering forever and crash-looping
the worker. This stops one bad message from taking a whole queue's throughput
down, but a message that lands in a DLQ is not automatically retried or drained
— it sits there until an operator looks at it.

`remit doctor` reports a non-empty dead-letter queue by name, across all of
them, and exits non-zero. That is how to find out; run it from anywhere.

Per-queue depth, rather than the total, is `remit_queue_messages{queue,role}` in
the [metrics](#metrics) endpoint.

A non-zero DLQ is a signal to look at, not a resolved failure. Draining one is
manual SQS work: `ReceiveMessage` on the `-dlq` queue for the body, then
`SendMessage` back to the source queue and `DeleteMessage` from the DLQ once you
have fixed the bug or the bad data — or `DeleteMessage` alone to discard it. Any
SQS-compatible client works. The `queue` image ships `node`, so the wire
protocol is reachable from inside the container; the actions are form-encoded
POSTs, unlike the plain GET the metrics read uses:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env exec queue \
  node -e 'const b="Action=ReceiveMessage&QueueUrl=http://localhost:9324/000000000000/remit-body-dlq&Version=2012-11-05";const r=require("http").request("http://localhost:9324/",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"}},s=>{let d="";s.on("data",c=>d+=c);s.on("end",()=>console.log(d))});r.end(b)'
```

`SendMessage` adds `&MessageBody=…`, `DeleteMessage` takes `&ReceiptHandle=…`
from the receive. This is an escape hatch — `remit` has no command for it; run
it from the install directory.

## Security notes

- **Self-update.** The self-update feature (RFC 037) is available to any
  signed-in user of the instance — the account list is the trust boundary of a
  self-hosted box. It stays off entirely on deployments that leave the update
  manifest URL unset (the hosted service), so it never appears there at all.
- `.env` holds real secrets (the better-auth JWT signing key and the IMAP
  credential encryption key). `chmod 600` it and never commit it —
  `deploy/vps/.gitignore` already excludes it.
- The IMAP credential encryption key (`FAKE_KMS_DATAKEY`) is explained in the
  template — the name is a holdover from how the code was first built, not a
  statement that it is unfit for this use. Generate it once, keep it safe;
  losing it makes every stored IMAP credential unrecoverable.
- `apisix` re-verifies every JWT the same way the backend does — defence in
  depth, not the only check.
