# Reader — self-host VPS deployment

A single-VM deployment: Docker Compose on one small box, running the published
`ghcr.io/remit-mail/reader/*` images plus two upstream images (`caddy`,
`alpine`). All relational state lives in two SQLite files on one
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

Then visit `$REMIT_ORIGIN` — the installer prints it when it finishes. The first
sign-up on that page creates your account; every subsequent IMAP account is
added from the app itself (Settings → Add account).

## Managing the deployment

The installer writes everything into the install directory (`./reader` by
default) and ships `remit`, which knows that directory and the compose file in
it. It is the interface to the deployment and runs from anywhere:

```bash
remit status              # what is running, and whether the origin reaches it
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
docker compose -f docker-compose.sqlite.yml --env-file .env up -d
docker compose -f docker-compose.sqlite.yml --env-file .env logs -f migrate
```

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
| `migrate` | `ghcr.io/remit-mail/reader/backend` (command override) | One-shot: applies the SQLite migrations and the FTS5 search index before any app service starts. |
| `volume-init` | `ghcr.io/remit-mail/reader/backend` (entrypoint override) | One-shot: fixes ownership of the data volumes so the non-root app user can write them. |
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
each client. Caddy keeps it on the `caddy_data` volume; export it into the
current directory with:

```bash
remit cert
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

```bash
remit update                    # install the current release
remit update --check            # report what is available, change nothing
remit update --tag sha-<git-sha>
remit update --recover          # finish an update that was interrupted
```

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

Discovery is the manifest and nothing else. A `vX.Y.Z` tag can be present in the
registry for a version that was never fully published — image pushes are not
atomic across the roster — so a tag existing is not an offer. Clear
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
  qualified and unaffected; the upstream images (`caddy`, `alpine`)
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

Every worker queue in `queues.json` has a dead-letter queue (`<queue>-dlq`,
`maxReceiveCount = 3`) — a message a worker's handler keeps failing to process
(a malformed payload, a bug, a downstream outage) is redelivered up to 3 times,
then quarantined in the DLQ instead of redelivering forever and crash-looping
the worker. This stops one bad message from taking a whole queue's throughput
down, but a message that lands in a DLQ is not automatically retried or drained
— it sits there until an operator looks at it.

Check depth periodically — any SQS-compatible client against the queue you care
about works. The `queue` image ships `node`, so a one-liner from inside the
container reads a queue's depth over the SQS wire protocol. This is an escape
hatch — `remit` has no command for it; run it from the install directory:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env exec queue \
  node -e 'const b="Action=GetQueueAttributes&QueueUrl=http://localhost:9324/000000000000/remit-body-dlq&AttributeName.1=ApproximateNumberOfMessages&Version=2012-11-05";const r=require("http").request("http://localhost:9324/",{method:"POST"},s=>{let d="";s.on("data",c=>d+=c);s.on("end",()=>console.log(d))});r.end(b)'
```

A non-zero DLQ is a signal to look at, not a resolved failure: inspect the
message body (`Action=ReceiveMessage` against the `-dlq` queue), fix the
underlying bug or bad data, then either move it back to the source queue by hand
(`SendMessage` to the original queue, `DeleteMessage` from the DLQ) or discard it
once you understand why it failed.

## Security notes

- **Instance owner.** A later self-update feature (RFC 037) restricts
  triggering it to one account: whoever registers first. On a fresh install
  that is automatic. On a box that already has users — or one where signup
  stays closed and accounts are provisioned out-of-band — nobody claims
  ownership on its own; set `REMIT_OWNER_EMAIL` in `.env` to the account that
  should hold it. It overrides the stored claim outright, including naming
  someone other than whoever registered first.
- `.env` holds real secrets (the better-auth JWT signing key and the IMAP
  credential encryption key). `chmod 600` it and never commit it —
  `deploy/vps/.gitignore` already excludes it.
- The IMAP credential encryption key (`FAKE_KMS_DATAKEY`) is explained in the
  template — the name is a holdover from how the code was first built, not a
  statement that it is unfit for this use. Generate it once, keep it safe;
  losing it makes every stored IMAP credential unrecoverable.
- `apisix` re-verifies every JWT the same way the backend does — defence in
  depth, not the only check.
