# Reader — metrics, alerts and the on-box UIs

Companion to the [deployment README](README.md).

## Metrics

Every service that owns a signal serves `/metrics` in Prometheus/OpenMetrics
text format on the container network. `backend` and `queue` serve it on the port
they already listen on; the four workers serve it on `9464`. Nothing is
published to the host, nothing is routed through Caddy, and there are no
credentials. The only host ports remain caddy's 80 and 443.

Point any scraper you already run at the containers: Prometheus,
VictoriaMetrics, Grafana Alloy, a Datadog agent, an OpenTelemetry collector.
Nothing is ever pushed. If you run none and want one on the box, the optional
`observability` profile is a scraper and a query UI in one container, see
[Looking at the box](#looking-at-the-box).

| Series | From |
|---|---|
| `remit_queue_messages{queue,role}` | `queue` — depth per queue; `role="dead_letter"` is a DLQ |
| `remit_account_sync_age_seconds{account_id}` | `backend` — seconds since that account last completed a message-sync round |
| `remit_imap_failures_total{operation,kind}` | `imap-worker` — `kind="auth"` is counted apart from other failures |
| `remit_smtp_failures_total{kind}` | `smtp-worker` — same split |
| `remit_queue_event_duration_seconds{queue,event_type,outcome}` | each worker — per-message duration and outcome |
| `remit_handler_duration_seconds{handler,outcome}` | each worker — per-invocation duration and outcome |
| `remit_search_index_backlog_rows` | `search-index-worker` — outbox rows not yet relayed. Absent where semantic search is off, which is the default: the worker sits behind the `semantic` profile (README: Search) |

Host CPU, memory, disk and network are not here. Per-account series are labelled
by account id and never by address. Update state is not here either; it lives on
the `updater_state` volume and `remit status` prints it.

`remit_account_sync_age_seconds` sawtooths rather than sitting flat. A sync that
was not explicitly requested skips a mailbox stamped inside the freshness window
(`MAILBOX_FRESHNESS_MS`, 60 s by default), so on a healthy account the value
climbs to that window plus the scheduler's tick interval before dropping back.
Set an alert threshold above their sum or it fires on an account that is fine.

A scrape that cannot evaluate a signal answers 500 rather than a number. The
queue depths fail that way when the sidecar's database holds no queues, and the
sync ages when the relational store cannot be read.

Read a series from the host with `docker compose exec`:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env exec queue \
  node -e 'require("http").get("http://127.0.0.1:9324/metrics",r=>r.pipe(process.stdout))'
```

## Alerts

The `doctor` container runs a check every 60 seconds and computes one verdict:
`healthy` or `degraded`. Set two URLs in `.env` and a settled change of that
verdict is posted to a webhook. Set neither and the check still runs; it is what
`remit doctor` answers with.

It is degraded when any of these is true:

| Reason | Threshold |
|---|---|
| `scrape_failed` | A service is not answering `/metrics` |
| `worker_heartbeat_stale` | A worker's slowest poll loop has not written for 7 minutes, or has written nothing at all. `search-index-worker` is watched only where semantic search is on, so an instance that never opted in is not reported as missing it |
| `account_sync_stalled` | An account has not completed a sync round in an hour, against a healthy peak of about 25 minutes at the default [sync cadence](README.md#mail-sync-cadence) |
| `mail_auth_failing` | An IMAP or SMTP authentication failure counter has gone up in the last hour |
| `dead_letter_queue_not_empty` | Anything is quarantined on any DLQ |
| `signal_missing` | A service answered `/metrics` but exported none of the series the check reads |
| `tunnel_disconnected` | On `TLS_MODE=tunnel` only: the agent holds no connection to Cloudflare |
| `checker_unreachable` | No usable verdict came back from the checker at all. Produced by `remit doctor`, never by the checker, so it never reaches a webhook |

A signal that cannot be evaluated is degraded, never skipped: a refused
connection, an absent heartbeat file, a scrape that times out, a 200 carrying
none of the series being read.

Authentication is a counter, so the signal is the increase, not the total. The
retries arrive one burst per sync cycle, so the condition is held open for an
hour after the last one, matching the sync-age threshold. **Fixing the password
does not produce an immediate all-clear**: expect the recovery about an hour
after you fix it, and the verdict stays `degraded` until the hold expires even
if everything else has recovered. `remit doctor` shows the real state
immediately.

`DOCTOR_AUTH_FAILURE_HOLD_SECONDS` moves the window. Keep it above
`MAILBOX_SYNC_OFFLINE_INTERVAL_SECONDS`, or a healthy gap between two retries
reads as a recovery; keeping it equal to `DOCTOR_SYNC_AGE_MAX_SECONDS` is what
buys the single recovery message.

### Turn it on

```dotenv
DOCTOR_WEBHOOK_URL=https://hooks.slack.com/services/T000/B000/XXXX
DOCTOR_HEARTBEAT_URL=https://hc-ping.com/your-uuid
```

Then `remit restart`. Both are required together: setting the webhook without
the heartbeat fails the container at startup. Read [The dead-man's
switch](#the-dead-mans-switch) before you work around it.

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

`{{verdict}}` is `healthy` or `degraded`, `{{summary}}` is the one-line
headline, and `{{reasons}}` is the bullet list. Substituted values are escaped
for the content type. In a plain-text template a literal `\n` becomes a newline,
since a `.env` file cannot carry a real one.

### When it sends

On a change of verdict that has held for three consecutive checks, and never on
an unchanged verdict however long it persists. Two messages per incident: one
when it breaks, one when it clears.

The cost is three check intervals of latency: at the default 60 second interval
an outage is reported up to three minutes after it starts, and a recovery up to
three minutes after it clears. The dead-man's switch is unaffected; it pings on
every completed check, settled or not.

The last announced verdict is on the checker's own volume, so a reboot or a
`remit update` does not re-announce a condition already reported.

The dwell also covers a restart. A stack coming back up reads as degraded for a
check or two while the workers reach their queues, which is short of the three
it takes to announce. An update whose downtime runs past three minutes will
report degraded and then recover. Raise `DOCTOR_DWELL_CHECKS` if you would
rather not hear about it.

### What a payload carries

Counts, service names, queue names and the verdict. Never an address, a subject,
a sender, a message id, a folder name or an account id. "2 of 5 accounts have
not completed a sync in over 3h", not which two. To find out which account, run
`remit doctor` on the box. The container takes no `.env`, only the `DOCTOR_*`
variables above.

### The dead-man's switch

`DOCTOR_HEARTBEAT_URL` is pinged with a GET on every completed check, whatever
the verdict. Point it at healthchecks.io, Cronitor, or an Uptime Kuma push
monitor, and configure that service to alert you when the pings stop. It is
required whenever the webhook is set, and the container refuses to start without
it. If the VM is off, the disk is full, the network is gone or the checker
crashed, no alert fires.

A check that produced a verdict pings, including a `degraded` verdict computed
from signals it could not read. A check that threw before producing one does
not.

Delivery is retried when, and only when, retrying could help. A **4xx** is the
endpoint deciding about your payload: a template written wrong, a URL that was
revoked. That transition is spent and you get one `error` line in `remit logs
doctor` naming the status. A **timeout, a refused connection, a 5xx or a 429**
says nothing about the payload, so the announcement is not recorded and the next
check sends it again. A webhook that is down for a minute delays the alert by a
minute; a permanently unreachable URL costs one `error` line per interval.

The dead-man's switch does not cover this. What it covers is the checker itself
not running.

## Looking at the box

The `observability` profile puts two UIs on the box: one for logs, one for
metrics. It is off unless you ask for it. If you already run Prometheus,
Grafana, a Datadog agent or an OpenTelemetry collector, point what you have at
the `/metrics` endpoints above instead.

- **dozzle** — every container's log, live, with search across services. It
  stores nothing.
- **VictoriaMetrics** — scrapes the six `/metrics` endpoints, keeps the series,
  and serves `vmui` to query and graph them.

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
remit_victoriametrics_data` discards the history. The volume is named after the
deployment's project, so on a second deployment it is `<project>_…`.

`remit down` stops these two along with everything else and prints the command
to bring them back. `remit restart` starts the always-on services only, because
nothing behind a profile is started for you. While they are running, `remit
restart` applies an `.env` edit to them like it does to everything else, so a
changed `REMIT_METRICS_RETENTION` takes effect. `remit purge` destroys both
containers and the metrics volume with the rest of the deployment.

`remit restart` writes the profile services it stopped to `.remit-profiles-held`
before it stops anything, and clears the file once they are back. If a restart
is killed in between, the next `remit restart` reads that file and finishes the
job. Anything it still cannot start is named, with the command that starts it.

### Reach them

Neither is on the public origin and neither has a password. Both bind
`127.0.0.1` on the box and get no Caddy route, so you reach them from your
laptop over an SSH tunnel:

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

Change the loopback ports in `.env` if something else on the host already holds
one: `REMIT_DOZZLE_PORT` and `REMIT_VMUI_PORT`. The `127.0.0.1` in front of them
is not configurable.

On Podman, set `REMIT_DOZZLE_SOCKET=/run/podman/podman.sock` as well, see
[Podman](README.md#podman).

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
otherwise sizes against 60% of host RAM. It is not a ceiling on process memory,
but this deployment writes 88 series every 30 seconds.

Retention defaults to **30 days**, set with `REMIT_METRICS_RETENTION` in `.env`.
The suffixes are `h d w M y`, and **`M` is months while `m` is minutes**: `12m`
is twelve minutes and VictoriaMetrics rejects it outright, so write twelve
months as `12M`. `30d`, `90d`, `1w`, `12M` and `1y` are all accepted.

The disk figure is a measurement: 30 days of these series backfilled at a 30 s
step occupied 0.7 MB when the values sit still, 2.8 MB when they move. Accounts
add a handful of series each, so a year of history is still tens of MB. Set
retention by how far back you want to look, not by disk.

Metrics live on their own `victoriametrics_data` volume and are never backed up.

## Queue failures: the dead-letter queues

Every worker queue in `queues.json` has a dead-letter queue (`<queue>-dlq`,
`maxReceiveCount = 3`). A message a worker's handler keeps failing to process is
redelivered up to 3 times, then quarantined in the DLQ. A message that lands in
a DLQ is not automatically retried or drained; it sits there until an operator
looks at it.

`remit doctor` reports a non-empty dead-letter queue by name, across all of
them, and exits non-zero. Per-queue depth, rather than the total, is
`remit_queue_messages{queue,role}`.

Draining one is manual SQS work: `ReceiveMessage` on the `-dlq` queue for the
body, then `SendMessage` back to the source queue and `DeleteMessage` from the
DLQ once you have fixed the bug or the bad data, or `DeleteMessage` alone to
discard it. Any SQS-compatible client works. The `queue` image ships `node`, so
the wire protocol is reachable from inside the container; the actions are
form-encoded POSTs, unlike the plain GET the metrics read uses:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env exec queue \
  node -e 'const b="Action=ReceiveMessage&QueueUrl=http://localhost:9324/000000000000/remit-body-dlq&Version=2012-11-05";const r=require("http").request("http://localhost:9324/",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"}},s=>{let d="";s.on("data",c=>d+=c);s.on("end",()=>console.log(d))});r.end(b)'
```

`SendMessage` adds `&MessageBody=…`, `DeleteMessage` takes `&ReceiptHandle=…`
from the receive. Run it from the install directory; `remit` has no command for
it.
