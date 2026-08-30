# Reader — self-host VPS deployment

Docker Compose on one small box, running the published
`ghcr.io/remit-mail/reader/*` images plus two upstream images (`caddy`,
`alpine`) and, behind optional profiles, two more (`dozzle`,
`victoria-metrics`). All relational state lives in two SQLite files on one local
volume. Message bodies are cached on a second volume and re-sync from IMAP.

Sized for a 2 vCPU / 4 GB box. HTTPS on :443 out of the box, signed by Caddy's
own CA; the [TLS](#tls) section covers the other modes, including plain HTTP.
The images pull anonymously, so there is no registry login to set up.

## Install

On a fresh amd64 box with Docker (or Podman) and the Compose v2 plugin:

```bash
REMIT_ORIGIN="https://<the address you will load the app from>"
curl -fsSL https://raw.githubusercontent.com/remit-mail/reader/main/install.sh \
  | bash -s -- --origin "$REMIT_ORIGIN"
```

Every auth and CORS origin derives from `--origin`, so an address that is
accepted but wrong surfaces later as a failed sign-in. Pasted unedited, the
installer refuses the placeholder.

The installer downloads the deploy assets into `./reader`, generates the
secrets, writes `.env` with mode 600, and brings the stack up. It takes no input
while it runs. `--help` lists every flag; the ones that matter are `--tls-mode`,
`--tag`, `--dir` and `--dry-run`. `--dry-run` runs the host checks, fetches the
assets, writes `.env` and validates the compose file without pulling images or
starting anything.

The host checks run before anything changes: a container engine and the Compose
v2 plugin (real Compose, not podman-compose, 2.30 or newer), amd64 (no arm64
image is built), and the host ports that mode publishes, 80 and 443 or the
loopback port under `--tls-mode tunnel`. `--origin` is normalized against
`--tls-mode`: an `http://` origin is upgraded to `https://` under the default
`internal` mode, `--tls-mode off` requires an `http://` origin, and `--tls-mode
tunnel` requires an `https://` one it will not guess at.

Re-running is safe for your data: an existing `.env` is kept and a secret that
already has a value is never regenerated. The deploy assets are re-downloaded
every run, so edits to the compose file or the Caddy files are replaced. Pin the
image version through `REMIT_TAG` in `.env`, not by editing the compose file.

Back up `FAKE_KMS_DATAKEY` from `.env`.

Then visit `$REMIT_ORIGIN`, which the installer prints when it finishes. The
first sign-up on that page creates your account; every subsequent IMAP account
is added from the app itself (Settings → Add account). Close sign-up once you
have your account:

```bash
sed -i 's/^SELF_SIGN_UP_ENABLED=.*/SELF_SIGN_UP_ENABLED=false/' .env
remit restart
```

## Managing the deployment

The installer writes everything into the install directory (`./reader` by
default) and ships `remit`, which knows that directory and the compose file in
it. It runs from anywhere:

```bash
remit status              # what is running, and whether the origin reaches it
remit doctor              # whether anything is wrong; non-zero when it is
remit logs [service…]     # follow the logs
remit restart             # apply an edit to .env
remit update              # install the current release, atomically
remit update --check      # what is available, changing nothing
remit down                # stop serving; remit restart brings it back
remit config              # the effective configuration, secrets redacted
remit config save <file>  # every setting to <file>, before a drop; no password
remit cert                # export Caddy's root CA (TLS_MODE=internal)
remit purge --yes         # destroy the deployment, data included
remit probe-host <origin> # check how a name resolves from this box
```

When `/usr/local/bin` is writable the installer puts `remit` there; otherwise it
stays in the install directory and the installer prints the one-line `sudo cp`
that places it on PATH. `$REMIT_DIR` points it at a different install directory.

`.env`'s `REMIT_PROJECT` names the Compose project, and containers, volumes and
the network all carry that name. Two install directories with the same project
name are one deployment, and `remit purge` from either destroys the data for
both.

`remit down` stops the containers and removes no volume: accounts, mail and
settings all come back with `remit restart`.

`remit purge` removes the containers and every data volume, `sqlite_data`
included, so accounts and everything organised in the app do not come back.
Without `--yes` it only prints what would go. The install directory survives
either way, `.env` and its `FAKE_KMS_DATAKEY` included.

Apply an `.env` edit with `remit restart`, not `docker compose restart`.
Compose's `restart` reuses the existing containers with the environment they
were created with and reports success; `remit restart` runs `up -d`, which
recreates the containers whose configuration changed.

## A second deployment on one host

A second deployment is a project name and a port:

```bash
curl -fsSL https://raw.githubusercontent.com/remit-mail/reader/main/install.sh \
  | bash -s -- \
      --tls-mode tunnel \
      --origin https://beta.example.org \
      --tunnel-token-file ./beta.token \
      --project beta \
      --http-bind 127.0.0.1:8081
```

`--project beta` names the Compose project, so every container, volume and
network of that deployment carries it. It installs into `$PWD/reader-beta`
unless `--dir` says otherwise, writes `REMIT_PROJECT=beta` to that directory's
`.env`, and puts its wrapper on PATH as `remit-beta`. Re-running the installer
over an existing directory keeps the project it already holds, and refuses a
`--project` that disagrees with it.

`--http-bind` is the one host-level number two deployments must not share. The
modes that publish 80 and 443 are one deployment per host.

## When the app is unreachable

Run `remit status` first. Besides the service table it resolves the host in
`PUBLIC_ORIGIN` from this box and probes it, printing what it resolved to and
whether the origin answers. It says `this box does not hold that, so clients
reach a different machine` when the name points elsewhere; fix the record, then
flush the resolver cache on the machine you browse from.

`remit probe-host <origin>` runs the same check against any name, which is how
to test a record before pointing `PUBLIC_ORIGIN` at it.

## Manual install

The explicit path the installer automates, from a checkout:

```bash
cd deploy/vps
cp remit.env.template .env
chmod 600 .env
$EDITOR .env            # fill in every value marked SECRET — see the file
                        # and set REMIT_DEPLOY_DIR to this directory: "$(pwd)"
docker compose -f docker-compose.sqlite.yml --env-file .env up -d
docker compose -f docker-compose.sqlite.yml --env-file .env logs -f migrate
```

`REMIT_DEPLOY_DIR` is the absolute path of this directory, the one value the
installer sets that you must set by hand. The `updater` service refuses to start
until it is set.

`remit` works against a directory set up this way; point it there once with
`export REMIT_DIR=$PWD`.

The two secrets the stack cannot run without are `BETTER_AUTH_SECRET` (signs the
identity JWTs) and `FAKE_KMS_DATAKEY` (encrypts stored IMAP credentials).
Generate each with `openssl rand -hex 32`. `migrate` is a one-shot that runs
before every app service and applies the schema; confirm it succeeds before
signing in at the address you set as `PUBLIC_ORIGIN`.

## What's running

| Service | Image | Role |
|---|---|---|
| `caddy` | `caddy:2-alpine` | The edge: reverse proxy and TLS termination. Publishes the only host ports, 80 and 443 (443 is bound in every mode but serves traffic only in the TLS modes). See [TLS](#tls). |
| `apisix` | `ghcr.io/remit-mail/reader/apisix` | Edge JWT gate, with the generated route table baked in. |
| `web` | `ghcr.io/remit-mail/reader/web` | Static server for the built web client. |
| `backend` | `ghcr.io/remit-mail/reader/backend` | The API. Also the image the `migrate` and `volume-init` one-shots run. |
| `imap-worker`, `smtp-worker`, `account-worker`, `search-index-worker` | `ghcr.io/remit-mail/reader/*` | Queue pollers: sync mail, push flag and folder changes back, send outgoing mail, and build the search index. |
| `scheduler` | `ghcr.io/remit-mail/reader/imap-worker` (command override) | The periodic mailbox-sync tick: enqueues a sync for every account whose last one is older than `MAILBOX_SYNC_OFFLINE_INTERVAL_SECONDS`. This is what fetches mail when no browser is open. See [Mail sync cadence](#mail-sync-cadence). |
| `queue` | `ghcr.io/remit-mail/reader/queue-sidecar` | The SQS-compatible queue seam: a SQLite-backed sidecar speaking the SQS wire protocol, persisting enqueued work to its own volume. |
| `migrate` | `ghcr.io/remit-mail/reader/backend` (command override) | One-shot: applies the SQLite migrations, repairs `thread_message.category`, and installs the FTS5 search index before any app service starts. See [maintenance.md](maintenance.md). |
| `volume-init` | `ghcr.io/remit-mail/reader/backend` (entrypoint override) | One-shot: fixes ownership of the data volumes so the non-root app user can write them. |
| `doctor` | `ghcr.io/remit-mail/reader/doctor` | Reads the metrics on an interval, computes one verdict, and posts a settled change of it to a webhook. Mounts no docker socket and publishes no port. See [observability.md](observability.md). |
| `backup` | `alpine:3.23` | Off by default (`profiles: ["backup"]`). Nightly encrypted database snapshot. See [Backups](#backups). |
| `dozzle` | `amir20/dozzle` | Off by default (`profiles: ["observability"]`). Live log tail and search. Binds `127.0.0.1` only. See [observability.md](observability.md). |
| `victoriametrics` | `victoriametrics/victoria-metrics` | Off by default (`profiles: ["observability"]`). Scrapes the `/metrics` endpoints, stores the series, serves the query UI. Binds `127.0.0.1` only. |

The relational store and the better-auth identity tables share one file
(`/data/sqlite/remit.db`); the vector store keeps its data in a second file
(`/data/sqlite/vec.db`). Both sit on the `sqlite_data` named volume, which
**must be local disk**: WAL's cross-process coordination uses a shared-memory
file next to the database that does not work over NFS/CIFS. Message bodies live
on the `message_storage` named volume and are not part of the nightly snapshot
(see [Backups](#backups)).

Every Node service runs under a 512 MB V8 heap ceiling, moved with
`REMIT_NODE_HEAP_MB` in `.env`. It bounds JavaScript objects and nothing else,
so it is not the answer to a worker that runs out of memory while indexing —
see [Indexing on a small box](#indexing-on-a-small-box). The containers carry no
hard memory limit: one would turn a slow job into an OOM kill.

### Indexing on a small box

The `search-index-worker` holds the embedding model, and the model, its
inference arenas and its per-batch tensors are all allocated by onnxruntime,
outside the V8 heap the ceiling above bounds. A first index of a large mailbox
is the job that can exhaust a 4 GB box, and the kernel then picks its OOM victim
by size — usually the backend, not the indexer.

So the worker bounds itself. It starts at the smallest batch with one inference
in flight, reads `MemAvailable` after every batch, and ramps up only while the
box keeps more than 768 MB free. Under that it halves the batch, drops back to
one inference and paces itself; under 384 MB it stops and waits, logging a line
and counting `remit_search_index_memory_stalls_total`, rather than pushing the
host into swap. Each change of plan logs once, and
`remit_search_index_embed_batch_size` shows where it settled.

The cost is deliberate: a first index uses a large box fully and crawls on a
small one. Six variables in `.env` move it, all optional:

| Variable | Default | What it does |
| --- | --- | --- |
| `SEARCH_INDEX_MEMORY_HEADROOM_MB` | `768` | Free memory the box must keep for the worker to ramp up. |
| `SEARCH_INDEX_MEMORY_CRITICAL_MB` | `384` | Free memory below which indexing stops and waits. Must be below the headroom. |
| `SEARCH_INDEX_EMBED_BATCH_MIN` | `4` | Chunks per embedding call at the floor, and after shedding. |
| `SEARCH_INDEX_EMBED_BATCH_MAX` | `32` | Chunks per embedding call at full ramp. |
| `SEARCH_INDEX_EMBED_CONCURRENCY_MAX` | `2` | Embedding calls in flight at full ramp. |
| `SEARCH_INDEX_MEMORY_PAUSE_MS` | `2000` | Wait between batches while shedding, and between reads while stopped. |

On a box with memory to spare, raising `SEARCH_INDEX_EMBED_BATCH_MAX` and
`SEARCH_INDEX_MEMORY_HEADROOM_MB` together is what makes a first index finish
sooner.

Each worker's health is a heartbeat. A worker polls one queue per kind of work
(`imap-worker` six of them), each loop rewrites its own timestamp file on the
`heartbeat` volume every poll cycle, and the check reads the oldest of them. A
file counts as stale after seven minutes, and the container is marked unhealthy
after three consecutive failing checks. Nothing restarts on it: run `remit logs
<service>`, then `docker compose restart <service>` if you want it recycled.

A healthy worker means its loops are turning, not that the work is succeeding.
For that, run [`remit doctor`](#is-anything-wrong-remit-doctor).

## Mail sync cadence

The `scheduler` service fetches mail on a timer, so the box keeps receiving with
nothing open. Every other trigger — loading the client, pressing sync, connecting
an account — is a person.

Two settings, both in `.env`:

| Setting | Default | What it is |
|---|---|---|
| `MAILBOX_SYNC_OFFLINE_INTERVAL_SECONDS` | `900` | The mail latency you get: an account is fetched again once its last sync is this old. |
| `MAILBOX_SYNC_TICK_INTERVAL_SECONDS` | `300` | How often the scheduler looks. Keep it well below the interval above. |

Fifteen minutes is where desktop mail clients sit. Lower it for fresher mail at
the cost of one more IMAP connection per account per cycle — a server that rate-
limits logins is the reason not to go far below it.

A healthy account's sync age climbs to the offline interval plus one tick plus
the round itself, about 25 minutes at these defaults, and drops back. Raise
either setting and raise `DOCTOR_SYNC_AGE_MAX_SECONDS` with it, or
[`remit doctor`](#is-anything-wrong-remit-doctor) reports `account_sync_stalled`
on accounts that are fine.

The scheduler is healthchecked on its own heartbeat, like the workers, and the
staleness threshold follows `MAILBOX_SYNC_TICK_INTERVAL_SECONDS` rather than
being a fixed seven minutes. Healthy there means rounds are still completing,
not that mail arrived: for that, `remit doctor` reports `account_sync_stalled`
off the sync age.

## Search

Text search is FTS5 over subjects and senders, and needs no configuration.

Free-text semantic search is not served: the `backend` image ships without the
embedding runtime, so `/search/semantic` returns empty results and the web
client's "Related" section stays blank. The `search-index-worker` still writes
embeddings, and the Organize "find similar" widen reads those stored vectors and
does work.

## TLS

One setting, `TLS_MODE` in `.env`, picks how Caddy serves the origin. Set it,
set `PUBLIC_ORIGIN` to a matching `scheme://host`, and bring the stack up.
`PUBLIC_ORIGIN` is the single origin knob: Caddy's site address and the app's
auth and CORS origins all derive from it, and its scheme has to match the mode.

| `TLS_MODE` | What it does | `PUBLIC_ORIGIN` |
|---|---|---|
| `internal` (default) | HTTPS on :443 with Caddy's own locally-trusted CA. No public DNS, no ACME, no tailnet. Browsers warn until you trust the root CA. | `https://…` |
| `off` | Plain HTTP on :80. Reach it over a private network (tailnet, VPN, SSH tunnel). | `http://…` |
| `tailscale` | A publicly-trusted certificate from the local `tailscaled` for this box's `<name>.<tailnet>.ts.net`. | `https://<name>.<tailnet>.ts.net` |
| `acme` | Public Let's Encrypt. Ports 80/443 must be reachable from the internet and the host must resolve in public DNS. | `https://mail.example.com` |
| `tunnel` | TLS terminates at Cloudflare. An outbound-only agent on the box holds the connection open: no public IP, no port forward, no inbound firewall rule. | `https://mail.example.com` |

The mode also decides whether the app can be installed to a phone's home
screen. Installing needs a secure context, which `acme`, `tunnel` and
`tailscale` give you. Under `TLS_MODE=off` the browser offers no install option
at all, and `internal` offers one only on a device where Caddy's root CA is
installed and trusted — on iOS that means both importing the profile and
enabling it under Certificate Trust Settings.

To make the `internal`-mode browser warning go away, trust Caddy's root CA on
each client. Caddy keeps it on the `caddy_data` volume; export it into the
current directory with:

```bash
remit cert
```

Then import `reader-root.crt` into the client's trust store (macOS Keychain, the
Windows cert store, `/usr/local/share/ca-certificates` +
`update-ca-certificates` on Linux, or the browser's own authorities). The same
file is a download in the app, at Settings › Advanced, for a client with no
shell access to the box.

`tailscale` needs two things beyond `TLS_MODE`: enable HTTPS for your tailnet
(Tailscale admin console → DNS → **Enable HTTPS**), and set `TAILSCALED_SOCKET`
in `.env` to the host's `tailscaled` socket (usually
`/var/run/tailscale/tailscaled.sock`). Both are required. Caddy detects the
`.ts.net` host and fetches the certificate itself.

### `tunnel`

For a box behind a router you do not control. In the Cloudflare dashboard,
create a tunnel, copy its token to a file on the box, point the hostname at the
tunnel and route it to `http://caddy:80`. That mapping lives at Cloudflare; no
file on the box names it. Then one run sets the rest up:

```bash
curl -fsSL https://raw.githubusercontent.com/remit-mail/reader/main/install.sh \
  | bash -s -- \
      --tls-mode tunnel \
      --origin https://mail.example.com \
      --tunnel-token-file ./tunnel.token

rm ./tunnel.token
```

The token is read from that file into `.env`, never from an argument.
`$REMIT_TUNNEL_TOKEN` does the same job for an environment that already carries
it.

That run writes:

```
TLS_MODE=tunnel
PUBLIC_ORIGIN=https://mail.example.com
TUNNEL_TOKEN=…
CADDY_HTTP_BIND=127.0.0.1:8080
CADDY_HTTPS_BIND=0.0.0.0:443
SELF_SIGN_UP_ENABLED=true
```

The template's `COMPOSE_PROFILES` derives from `TLS_MODE`, so setting the mode
is what starts `cloudflared`. `CADDY_HTTP_BIND` on loopback is your way into the
app over SSH while the tunnel is down; the agent reaches Caddy over the compose
network and needs no published port. `--http-bind` picks another loopback
address, and the installer's free-port check follows it instead of checking 80
and 443.

`remit status` reports the mode and whether `cloudflared` is connected to
Cloudflare, in place of the resolves-to-this-box line.

A dropped tunnel is a site that is down while the box is fine: the browser gets
Cloudflare's error page, `remit doctor` says `tunnel_disconnected`, `remit logs
tunnel` says why (usually a revoked or mistyped token), and the app is still
there on the loopback port over SSH.

Caddy takes the client address from `Cf-Connecting-Ip`, and only from a
connection on the compose network.

### FAQ

**Can one deployment serve both a tunnel and my tailnet address?** Not as two
addresses for users. Cookies and tokens are pinned to a single origin, so a
second address gives a page that loads and a session that does not. The tailnet
stays the way you reach the box.

**How do I move to a different domain?** Change `PUBLIC_ORIGIN`, point the new
hostname at the tunnel, update the redirect URI in Entra if Microsoft sign-in is
on, and `remit restart`. Nothing else names the hostname.

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
volume the app writes a version string onto and runs this same `remit`. Every
image reference comes from the manifest the updater fetches itself.

The updater also checks the manifest on its own, once at startup and every six
hours after. Override the cadence with `REMIT_UPDATE_CHECK_INTERVAL` (seconds);
the check only reports and never installs.

An update takes the instance offline for a few minutes. Caddy stays up
throughout and serves 502s. Wherever the volume holds a database it is atomic,
in order:

1. The manifest at `REMIT_UPDATE_MANIFEST_URL` is fetched and validated. A
   version at or below the running one is refused, as is a manifest naming
   images from outside its own registry.
2. Every image is pulled at the target version. A failure here has touched
   nothing and a retry is safe.
3. Both databases are snapshotted with `VACUUM INTO` **while the old version is
   still live**. The work queue is deliberately not part of the snapshot.
4. `REMIT_TAG` is written to `.env`, before the stop, so a host that reboots
   mid-update comes back on binaries that match the migrated database.
5. Every service stops. The instance is offline from here.
6. Only `queue`, `migrate` and `backend` start, so nothing is served and nothing
   is sent, purged or indexed between the snapshot and the verdict.
7. The gate: this run's `migrate` exited `0`, every recreated service is up and
   not restarting, every healthcheck reports healthy, and `/health` answers
   three times in a row. 300 seconds, then the update has failed.
8. On a pass the held-back services start and the update is done. Held back is
   what was running when the run began, so a service you had stopped stays
   stopped; on a box where nothing was running it is the whole always-on stack.
9. On a failure the snapshot and the previous tag are restored, the gate runs
   again, and the outcome is `rolledBack`, or `rollbackFailed`.

`remit status` reports the running version, the last check and the last run's
outcome.

The check reports two schema versions: the running instance's, read from the
database, and the target release's, carried in the manifest. A higher target
schema means this update migrates the database during the offline window, and a
rollback restores the pre-migration database.

Discovery is the manifest and nothing else. The default
`REMIT_UPDATE_MANIFEST_URL` is the `stable.json` asset of the project's latest
published GitHub release. A `vX.Y.Z` tag present in the registry is not an offer
on its own. Clear `REMIT_UPDATE_MANIFEST_URL` and no check happens at all; point
it at your own HTTPS URL serving the same JSON to hold releases back or run a
fork.

`--tag` installs any tag directly, published release or not, and takes the same
gate and the same rollback. On a box whose volume holds no database yet there is
no old version to snapshot, so it pulls and starts; that is the first install and
nothing else. A box stopped with `remit down` still holds its accounts and mail,
so an update there is snapshotted, gated and rolled back like any other, and the
stack comes back up serving. A volume that cannot be read at all — a daemon that
is not answering, an image that will not pull — refuses the update rather than
guess which of those two a box is, and nothing is changed.

## Rollback

A failed update rolls itself back. The snapshot it restores was taken before
anything stopped, so it carries the writes still in the write-ahead log, and the
restored files are left owned by `1000:1000`: a root-owned file on `sqlite_data`
makes every app writer fail with `EACCES`.

To go back deliberately, `remit update --tag <previous working tag>`. Practise
it once before you need it.

If the updater is killed mid-run, it recovers on its next start: `remit update
--recover` reads the breadcrumb on its volume and branches on the phase it
recorded. Interrupted before anything stopped, the update is abandoned.
Interrupted after, the gate decides. The lock is an `flock`, so a killed updater
never locks its own recovery out.

`rollbackFailed` is the one outcome that needs you. The pre-update snapshot is
still on the updater's volume under `snapshots/<runId>/` and the previous
release's images are still pulled: restore the snapshot over `sqlite_data` as
uid 1000, put the previous tag back in `.env`, and `remit restart`.

## When a release rekeys stored data

A release can change how a stored id is derived, and thread identity is the one
that has. A thread is keyed on the account configuration rather than on the
account, so one conversation held by two connected mailboxes is one thread and a
reply sent from either account joins it. Rows written before that release were
keyed the old way and a later sync keys the new way, so the two never meet: the
conversation stays split, and no amount of resyncing on top of the old rows
mends it.

There is no backfill. Keep the configuration, drop the mail, let it sync again:

```bash
remit config save reader-config.json   # accounts, filters, labels, roles, signatures
remit purge --yes                      # every data volume, mail included
remit restart
```

Then sign up again on `PUBLIC_ORIGIN` — set `SELF_SIGN_UP_ENABLED=true` in
`.env` first if you closed it — import the file from Settings → Advanced, and
give each account its password again, because the export carries no credential
and no OAuth token. Mail re-syncs from IMAP.

Every thread URL bookmarked before the drop names an id nothing holds any more.

## Podman

One path is supported: **rootful Podman driving real Compose v2 over Podman's
Docker-compatible socket**, not podman-compose.

```bash
systemctl enable --now podman.socket
export DOCKER_HOST=unix:///run/podman/podman.sock
```

`docker compose` behaves as documented once it is talking to that socket, so the
installer and every `remit` command above work unchanged.

**Never run `podman-compose` against this deployment.** It silently drops
`depends_on: condition:` and ignores `profiles:`, so every app container is left
in `Created` while the command exits `0`. The installer refuses to proceed if
`docker compose` resolves to podman-compose.

Two host settings need attention before the first start, both checked by the
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
  `/var/run/docker.sock`, which does not exist on a Podman host. Point it at
  Podman's socket in `.env`:
  ```
  REMIT_DOZZLE_SOCKET=/run/podman/podman.sock
  ```
  `victoriametrics` needs nothing; it reads over the network, not the socket.

Rootless Podman also runs the stack, with one more setting:
`net.ipv4.ip_unprivileged_port_start=80` (`sysctl -w`, or persist it in
`/etc/sysctl.conf`). Compose publishes 80 and 443 in every `TLS_MODE`, and
rootless Podman refuses to bind ports below that threshold by default.

`--tls-mode tailscale` under rootless Podman is unproven and likely broken: the
`tailscaled` socket is normally `0600 root:root`, so a rootless container gets
`READ_DENIED` opening it. Use rootful Podman if you need `tailscale` mode.

## Backups

A `backup` sidecar is in the compose file behind `profiles: ["backup"]`, off by
default. Turn it on from the install directory:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env --profile backup up -d
```

It runs `VACUUM INTO` on the two database files nightly, encrypts each with
`age`, and ships them to an S3-compatible bucket via `rclone`. Retention
defaults to 30 days. Message bodies re-sync from IMAP after a restore, so they
are deliberately not backed up here. Restore is putting the two files back on
the `sqlite_data` volume and starting the stack.

See the Backups section in `remit.env.template` for the variables
(`BACKUP_AGE_RECIPIENT`, `BACKUP_RCLONE_REMOTE`, and the `RCLONE_CONFIG_*` vars
for your provider). Test a restore before you need one: decrypt a backup with
the `age` private key, `gunzip` it, and open it with `sqlite3`.

## Logs

Every service writes one JSON object per line to stdout; the queue sidecar puts
its failures on stderr, and `remit logs` shows both. Nothing writes a log file,
and nothing rotates one, so the container runtime's log driver is the only
shipping mechanism involved. One exception, and it is not a container:
`remit-worker`, the hand-run CLI that enqueues a sync event for an account,
writes plain text for a terminal.

These field names are the contract, and they do not change without a note in the
release:

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
`search-index-worker`, `queue-sidecar`, or, from the one-shot commands that run
out of the backend image, `backend-migrate` and `backend-backfill-list-id`.

Everything else on a line is a field the call site added, at the top level,
never nested: `accountId`, `mailboxId`, `messageId`, `queue`, `requestId`,
`path`, `method`. Treat the set as open. `requestId` is the correlation key, and
the unit it covers is one handler invocation: one HTTP request on the backend,
one batch of queue messages on a worker. `level`, `time`, `service` and `msg`
are reserved, and a call-site field using one of those names is dropped rather
than written.

A message body, a subject and an address never appear in a field of their own,
but a message that a handler failed on can put an address inside `msg`, inside
`error` or inside a stack. Lines are not ordered across services: `time` is each
container's own clock, so sort on it rather than on arrival.

`LOG_LEVEL` in `.env` sets the threshold for the application services; unset it
is `info`, which drops `debug` and `trace`. `silent` turns logging off entirely.
A value that is not a level name is reported on one `warn` line at startup and
the service logs at `info`. The queue sidecar has no threshold: it writes only
`info` and `error`.

```bash
remit logs backend | jq -c 'select(.level=="error")'
remit logs | jq -r 'select(.accountId=="…") | "\(.time) \(.service) \(.msg)"'
remit logs imap-worker | jq -r 'select(.error) | .error.stack // .stack // .error'
```

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

It checks the same conditions the alert fires on
([the table](observability.md#alerts)) and reports the account ids behind them,
which an alert payload never carries. Each run is a fresh check, not the
alerter's last verdict.

The exit code is `0` healthy, `1` degraded, `2` when no verdict could be
produced, so it is a monitoring check as it stands:

```
*/5 * * * * remit doctor >/dev/null || logger -t remit "degraded"
```

Exit `2` with the reason `checker_unreachable` covers a verdict the wrapper
cannot stand behind: the `doctor` container is not running, docker refuses the
exec, the exec does not come back at all (it is capped; raise
`REMIT_DOCTOR_TIMEOUT` if your box needs longer), the verdict on stdout
disagrees with the exit code the exec returned, or the `--json` document arrives
truncated. In every one of those the checker's output is discarded rather than
printed.

`--json` emits the same verdict as `{ verdict, checkedAt, summary, reasons }`,
including for that case, so a script parses one shape whatever happened. The
checker's own logs go to stderr; stdout carries only the verdict.

Metrics, webhook alerts, the on-box log and metric UIs, and draining a
dead-letter queue are in [observability.md](observability.md). One-off data
repairs are in [maintenance.md](maintenance.md).
