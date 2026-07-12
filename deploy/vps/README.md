# Remit — self-host VPS deployment

The reference deployment from RFC 035 (`doc/RFC/035_container-deployment-target.md`):
docker compose on one small VPS, consuming only published
`ghcr.io/remit-mail/remit/*` images plus three upstream images
(`pgvector/pgvector`, `elasticmq`, `caddy`). No repo checkout, no npm, no
build toolchain on the server — pulling `main` onto a server is not
possible with this deployment, by design (RFC 035 D3).

Sized for a 2 vCPU / 4 GB EU VPS (Hetzner CX23-class, ~€5.50/mo). Reachable
over a private network (tailnet, VPN, SSH tunnel) by default — see
`Caddyfile` for the public-hostname/TLS variant if you have one.

## Quickstart

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
| `caddy` | `caddy:2-alpine` | Only published port. TLS termination (optional), reverse proxy. |
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

## Update procedure

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
