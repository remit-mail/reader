# Observability in the standalone deployment

Status: proposed
Scope: `deploy/vps` (the self-host compose stack, the `remit` wrapper), `packages/logger-lambda`, and the metric surface of `backend`, `queue-sidecar` and the four workers. The hosted platform is out of scope.
Decision numbers are local to this document; they do not continue the sequence in `docs/architecture` or in `mail-list-server-query.md`.

## What observability is here

Observability in this deployment is the operator's answer to four questions:

1. Is the stack up?
2. Is mail still arriving, and is it still being sent?
3. Is work being quarantined instead of done?
4. Will I find out without looking?

It is not distributed tracing, not APM, and not a dashboard. The deployment is one VM, one operator, a handful of accounts, and no on-call rota. The operator is usually the only user.

Each question is answered by a different surface. (1) is container state. (2) and (3) are domain facts the application knows and nothing else does. (4) is a message that has to leave the box.

## Current state

**Logs.** Every service writes structured JSON to stdout through `@remit/logger-lambda`. The exported `Logger` interface is implementation-free and is what the five consuming packages (`backend`, `imap-worker`, `smtp-worker`, `account-worker`, `search-index-worker`) import. Behind it sits AWS Lambda Powertools: the JSON field shape is Powertools', and `withTelemetry` takes a Lambda `Context`. The standalone stack runs no Lambda — `@remit/sqs-client`'s poller fabricates `{ functionName } as Context` for every invocation, so `addContext` records one field and `captureColdStartMetric` fires once per container lifetime.

**Metrics.** The same package exports a Powertools `Metrics` instance. It emits CloudWatch Embedded Metric Format on stdout. Handlers already write to it: `invocationCount`, `invocationLatency` and `errorCount` in `withTelemetry`; `imapOperationLatency` and `imapOperationFailures` in `imap-worker`; `smtpSendFailures` in `smtp-worker`; `searchIndexProcessed`, `searchIndexSkipped` and `searchIndexFailures` in `search-index-worker`; and, per handler, `flagPushFailed`, `imapSyncCursorStalled`, `placementMoveFailed` and the body-sync counters. Several of those are the domain signals D3 asks for, already emitted into a format nothing in this deployment reads.

**Health.** `queue`, `backend`, `apisix` and `web` have compose healthchecks. `imap-worker`, `smtp-worker`, `account-worker` and `search-index-worker` have none, in the compose file or in their image. `caddy` has none by design (RFC 037 D5 keeps it serving 502s through an outage). A worker whose poll loop wedges inside a socket read never exits, so `restart: unless-stopped` never fires, and `docker compose ps` reports it running. Mail silently stops arriving.

**Queues.** All eleven work queues in `queues.json` have a dead-letter queue at `maxReceiveCount = 3`. A message that reaches one sits there until someone looks. `deploy/vps/README.md` covers this under "Queue failures: watch the dead-letter queues", where reading a queue's depth is an escape hatch: a hand-written node one-liner through `docker compose exec queue`, once per queue, speaking the SQS wire protocol by hand. It is the signal that most warrants an alert and the one hardest to reach.

## Decisions

### D1. The four workers get a heartbeat file, and a healthcheck against it

Each worker touches a timestamp file — `/data/heartbeat/<service>` on a small `heartbeat` volume — once per poll cycle, at the top of each receive attempt. The image declares a `HEALTHCHECK` that reads that file's age and fails when it exceeds a threshold. The threshold must exceed the longest legitimate handler run (300 s for body sync and search indexing), or a slow mailbox reads as a hang.

Docker's healthcheck reads the file from inside the container, so `docker compose ps` and `remit status` report the same state they report for `backend` and `queue`. The `doctor` service (D9) mounts the same volume read-only, so `remit doctor` (D4) and an alert (D7) evaluate the same timestamps. One signal, no second mechanism.

A file rather than `/health` on the listener D2 adds: an HTTP handler answers from a process whose poll loop is wedged, so any honest health endpoint would have to consult this same timestamp anyway. The file removes the listener, the port and the request path from the health signal, and keeps health working when the metrics server is not.

What this gives up: a heartbeat proves the loop is turning, not that the last unit of work succeeded. A worker that receives, fails every handler and touches the file each cycle is healthy under D1. The outcome signals in D3 — handler failures, DLQ depth, sync age — carry whether work is succeeding, and D1 does not substitute for them.

This buys visibility, not recovery: compose does not restart a container for being unhealthy, and `restart: unless-stopped` acts on exit. The worker could exit non-zero itself when its own heartbeat goes stale, and compose would then restart it for free. That is rejected here: an exit drops in-flight work that the queue will redeliver but the visibility timeout has to expire first, and a threshold that has to tolerate a 300 s handler is exactly the threshold most likely to turn a slow mailbox into a restart loop. The condition is reported, and what to do about it stays the operator's.

### D2. `/metrics` in Prometheus text format, on an internal port, not published

Every service that owns a signal serves it at `/metrics` in Prometheus/OpenMetrics text format on the compose network. `backend` and `queue-sidecar` serve it on their existing internal ports. The four workers have no listener today, so D2 adds one to each worker image for `/metrics` alone — no health route on it (D1), no Caddy route, no published host port. The only host ports remain caddy's 80 and 443.

Pull, not push. A push exporter needs a destination, a credential and an outbound connection from a box that holds someone's mail — three things to configure and one new egress path on a product that otherwise makes none. A pull endpoint needs nothing on our side: an operator running Prometheus, VictoriaMetrics, Grafana Alloy, a Datadog agent or an OpenTelemetry collector points it at the container and is done, and an operator running none of them pays for an unused route. Push also fixes the wire protocol at build time; OpenMetrics text is read by all of them.

What this gives up: the endpoint reaches nobody who runs no scraper, which is most self-hosters, and four worker images gain an HTTP server they did not have. What it buys: zero configuration, zero credentials, zero outbound connections, and compatibility with every agent an operator might already run. D4 and D7 exist because of what it gives up.

### D3. Measure domain signals, not the host

The host agent an operator already runs reports CPU, memory, disk and network. It cannot know whether mail is arriving. The exported series are the facts only this application holds:

| Signal | Exported by |
|---|---|
| Queue depth and DLQ depth, per queue | `queue-sidecar` |
| Seconds since the last completed message-sync round, per account | `backend` |
| IMAP failures, with authentication failures counted separately | `imap-worker` |
| SMTP failures, with authentication failures counted separately | `smtp-worker` |
| Handler outcome (success/failure) and duration, per queue and event type | each worker |
| Search index backlog — unprocessed outbox rows | `search-index-worker` |

**Sync age is measured from `mailbox.last_message_sync_at`, not `account.last_sync_at`.** `account.last_sync_at` is stamped in one place, `packages/imap-worker/src/handlers/sync-mailboxes.ts:192`, after the mailbox *list* sync and before the per-mailbox fan-out that fetches messages. A deployment whose message handlers all throw — a bad cursor, a server that rejects `SEARCH` — keeps that column fresh forever while no mail arrives. `mailbox.last_message_sync_at` is stamped at the end of a message-sync round, after the fetch and the writes, on every path in `packages/mailbox-service/src/message-sync.ts`. The exported series is, per account, the age of the newest such stamp across that account's mailboxes: seconds since this account last completed a round trip that would have found new mail if there were any.

What it does not cover: a message the round fetched but that failed afterwards — a body that never downloads, a document that never indexes — and a single folder wedged while the rest of the account syncs. Those are handler outcome, DLQ depth and `imapSyncCursorStalled`, which is why all three are in the table. The account-level series answers "is mail arriving", not "is every message complete".

Authentication failures are separate from other failures because they are the one class that never resolves itself: an expired OAuth grant or a changed password fails identically forever, and it is the most common way a self-hosted mailbox goes quiet.

Update state is not in the table. The updater already records the last check and the last run's outcome on the `updater_state` volume, and `remit status` renders both. It binds no port by design — `deploy/vps/docker-compose.sqlite.yml` states that the volume mount is its authentication, and its image is alpine plus `docker-cli` and the wrapper script, with no node in it. Giving the one container that holds `/var/run/docker.sock` a network listener to re-export a fact `remit status` already prints is not a trade this design makes. Update state stays where it is and stays out of the verdict.

Per-account series are labelled by account id, never by address (D10 applies to metric labels — a scraped label travels wherever the scrape goes). Cardinality is a non-issue at self-host scale, where accounts are single digits.

### D4. `remit doctor`

A new wrapper command that reads the signals in D3, computes a verdict, and prints it. `healthy` or `degraded`, the reasons, and a non-zero exit on `degraded` so a cron job or an external monitor can use it directly. `--json` emits the same verdict as a machine-readable object.

The signals are on the compose network and `remit` is a POSIX shell script whose only tool is `docker`, so `remit doctor` does not scrape anything itself. It runs `compose exec -T doctor` against the service in D9 — the container that already scrapes the D2 endpoints and already mounts the heartbeat volume — and formats what comes back. The verdict is computed in one place and read three ways: at a shell, as an exit code, and as an alert.

A signal that cannot be evaluated is `degraded`, never skipped: an endpoint that refuses the connection, a scrape that times out, a heartbeat file that is absent. If the `doctor` container itself does not answer the exec, the wrapper reports `degraded` for that reason alone. A verdict of `healthy` produced by a check that failed to look is the worst outcome available, so no path produces one.

This is where DLQ depth is surfaced, and the README's one-liner section is deleted when it lands. `remit doctor` is what most self-hosters will actually run, and it is the only observability surface that requires the operator to install nothing and configure nothing.

`remit status` stays what it is — directory, tag, origin reachability, update state, `compose ps`. `doctor` answers "is anything wrong", `status` answers "what is running".

### D5. A real metrics registry replaces Powertools `Metrics`

Powertools `Metrics` emits CloudWatch Embedded Metric Format. EMF cannot serve a Prometheus endpoint at any configuration, so D2 forces this: a registry (prom-client or equivalent) replaces it, and the registry is what `/metrics` renders. `withTelemetry` keeps its name, its call sites and its per-invocation timing, and records into the registry instead.

The call sites are the inventory above — the three in `withTelemetry` plus roughly ten named metrics across `imap-worker`, `smtp-worker` and `search-index-worker`. Most of them become D3 series unchanged; the migration is a registry swap behind the same function names, not a re-instrumentation.

### D6. The logging implementation is replaced too, in its own PR

The `Logger` interface stays exactly as it is; the Powertools implementation behind it becomes a minimal JSON-lines writer. Nothing in this deployment uses what Powertools adds — there is no Lambda context to enrich, no cold start that means anything, no CloudWatch Logs Insights to shape the fields for.

This is separable from D5 and separately rejectable. Rejecting it leaves the distro shipping an AWS Lambda logging stack on a VM and costs the design nothing else; D2, D3 and D4 stand on D5 alone. It ships as its own PR, because a field-shape change across five packages has nothing to do with the metrics endpoint and reviewing them together hides both.

What this gives up: the log JSON field names change once, so any grep or log-shipping rule an operator wrote against the current shape breaks, and the change touches five packages' imports for no user-visible gain. What it buys: two AWS-shaped dependencies leave five images, and the package every service logs through stops being named for a runtime this distro does not use.

### Alerting: D7 to D12

The six decisions below are one job, not six independent choices. A periodic check runs, it fires on a settled change of verdict, it runs in its own container, it carries no personal data, it heartbeats to an external monitor, and it renders through a template. Each is numbered so a reviewer can disagree with one by name, but they are built and shipped as a unit: dropping the heartbeat leaves a checker nobody watches, dropping the transition rule leaves a channel nobody reads, and dropping the container leaves an alerter that dies with what it reports on.

### D7. Alerting ships with the stack, not behind the metrics profile

The `doctor` service runs the same check `remit doctor` runs on an interval and POSTs the result to a webhook URL. One environment variable turns posting on; unset, the check still runs (D4 needs it) and nothing is sent. Slack incoming webhooks and ntfy are both a plain POST, so both are targets with no integration code.

An alerting stack that lives behind an optional metrics profile only ever reaches an operator who opted into it. The operator who most needs an alert is the one who installed nothing — ran `install.sh`, added a mailbox, and has not logged into the box since. The three facts worth waking someone for (a mailbox stopped syncing, IMAP authentication broke, a DLQ is non-zero) are point-in-time facts about current state. None of them needs a time-series database to evaluate.

What this gives up: no rate alerts, no "error rate doubled", no trend. What it buys: an alert that works on a stock install with one line in `.env`.

### D8. Fire on a settled change of verdict, after three consecutive agreeing checks

A verdict fires when it changes and the new verdict has held for three consecutive checks: `healthy` → `degraded`, and `degraded` → `healthy`. Never on an unchanged verdict, however long it persists. The last fired verdict and the run of agreeing checks are persisted, so a restart of the container does not re-announce a condition already reported.

Without the dwell rule, transition-only firing is the loudest possible response to a flapping signal: a verdict that oscillates every check sends two messages per cycle, which is worse than the periodic posting this decision rejects. A DLQ message an operator replays and that fails again, or sync age sitting on its threshold for an account on a slow server, both produce that shape.

What this costs: detection is three check intervals late. At a 60 s interval, an outage is reported up to three minutes after it starts, and a recovery up to three minutes after it clears — the only alert this design sends is one a human reads, and no human acts inside three minutes on a mailbox that stopped syncing.

The dead-man's switch (D11) is unaffected by dwell. It pings on every completed check whatever the verdict, settled or not, because it reports that the checker is running, not what the checker found.

### D9. The check runs in its own container, with no docker socket

Not in the backend, not in a worker. A checker inside the backend dies with the backend, which is one of the conditions it exists to report. The `doctor` service gets `restart: unless-stopped` and its own small state volume for D8's last verdict, the same shape as `updater` and for the same reason — a job that has to outlive the failure of what it watches cannot share its lifecycle.

It is a small node service on the compose network. It scrapes the D2 endpoints over that network and mounts the `heartbeat` volume read-only. It mounts no docker socket and needs none: D1 put worker liveness on a file precisely so that reading it does not require the daemon. A second socket-mounting container on a mail server, added for an alert, is a cost this design does not pay.

It runs whether or not alerting is configured, because `remit doctor` execs into it (D4). Nothing healthchecks it — D1 is workers only — so its own liveness rests entirely on D11, which is why D11 is not optional.

### D10. No mail content and no addresses in an alert payload

The payload carries counts, service names, queue names and verdicts. It never carries an email address, a subject, a sender, a message id or a folder name. "2 of 5 accounts are failing authentication", not which two.

This is a mail server, and the payload goes to a third-party SaaS over the internet. Addresses, folder names and subject lines are all personal data. The operator identifies the affected account by running `remit doctor` on the box.

### D11. The dead-man's switch is required whenever the webhook is set

The `doctor` service pings an external URL on every completed check, whatever the verdict. A check completes when it produces a verdict, including a `degraded` verdict produced from signals it could not read; a check that throws before producing one does not ping. That is the same rule D4 states for the verdict itself, and it holds in both directions: a scrape failure degrades the verdict and still heartbeats, because the checker is working; a crashed checker heartbeats never.

Setting the webhook URL without the heartbeat URL fails the container at startup with a message naming both variables. There is no configuration in which alerting looks on and is not.

If the VM is off, the disk is full, the network is gone or the checker itself crashed, no alert fires, and an operator with only a webhook cannot tell that apart from a week with nothing wrong. That is the silent failure this design exists to remove, and behind a second optional variable the common half-configuration is the unsafe one.

What this costs: an operator who wants a webhook must also have somewhere to point a heartbeat. Healthchecks.io and Cronitor have free tiers that need an account, and Uptime Kuma is self-hostable; all three are a URL to paste, and none of them is zero effort.

### D12. One webhook URL and a payload template, no integration registry

Configuration is a URL, an optional payload template with a small substitution set (verdict, summary, reasons), and an optional content type. The default template is Slack-shaped JSON, which Mattermost and Discord also accept; a plain-text content type covers ntfy and anything else that takes a raw body.

Substituted values are escaped for the declared content type — JSON string escaping for a JSON body, none for a plain-text one. Reasons are assembled from queue and service names today, so nothing in them needs escaping yet, and a payload that a webhook rejects with a 400 fails silently under D8: the transition is spent, and the next thing the operator hears is the recovery.

A named integration per service — a Slack block builder, a Discord embed shape, a PagerDuty Events API client, a Teams card — makes every new provider our maintenance. A template covers providers we have never heard of, and the operator owns it.

What this gives up: no rich formatting, no threading, no per-service niceties. What it buys: one code path, and any HTTP endpoint as a target.

### D13. An optional `observability` compose profile, off by default, bound to localhost

Same pattern as `backup`: `profiles: ["observability"]`, absent unless asked for. Two containers.

- **dozzle** — a log viewer over the Docker socket. Tens of MB, no storage, no configuration. It replaces `remit logs` scrollback with something searchable across services.
- **VictoriaMetrics single-node** — one binary that scrapes the D2 endpoints itself, stores the series, and serves `vmui` for queries and graphs.

**Both publish on `127.0.0.1` only, and neither ever gets a Caddy route.** dozzle serves every container's logs with no authentication of its own, and on this box those logs are the richest source of exactly the personal data D10 keeps out of a webhook payload; `vmui` serves every series, including D3's per-account labels. A loopback bind means the reader is someone who can already open a shell on the host — which, given dozzle mounts the docker socket, is already root-equivalent access to everything in the stack. Reaching either from a laptop is an SSH tunnel, or the box's tailnet address if the operator runs one. No route through Caddy is provided, and adding one is not a deployment detail an operator should improvise: it would put an unauthenticated view of every mailbox's log lines on the public origin.

What this costs: no browser access without a tunnel, on the two surfaces an operator would most want to open from a phone.

**No dashboards ship.** `vmui` answers "what is the DLQ depth" and "when did that account last sync" with a query, which is the entire need. Curated dashboards carry permanent maintenance: they hardcode metric names and they break on the first rename.

VictoriaMetrics rather than Prometheus + Grafana because it is one container instead of two, scrapes without a separate agent, and ships a query UI in the same binary. The README advertises a small idle footprint, and a two-container metrics stack is the larger claim on it.

## Rejected

**OTLP as the primary transport.** Distributed tracing across four workers on one VM buys very little: the trace is almost always one handler, one mailbox, one failure, which a log line already carries. The cost is a collector to run, an exporter in five packages, and a destination to configure. An operator who wants traces runs a collector and scrapes D2 for metrics; the design does not carry a second transport for them.

**vmalert and Alertmanager.** Rate and trend alerting — "sync latency doubled", "failures rising over an hour" — needs a time-series database, so it could only reach operators who enabled D13, which is the wrong half of the audience. It also answers a question this deployment does not have: across single-digit accounts, the facts worth alerting on are point-in-time states, and a rule that fires on a trend across three mailboxes is noise with extra configuration to maintain. D7 covers what needs covering.

**Netdata.** One container, built-in alarms, and it would satisfy D7 and D13 together. Netdata reports host signals; every signal in D3 is a domain fact it reaches only through a custom collector we would write and maintain. D2 would still have to exist, and Netdata would sit on top of it as a second agent to configure and keep working. Its anonymous telemetry is on by default and turned off with a `DO_NOT_TRACK` or `DISABLE_TELEMETRY` environment variable — one more default to document and keep documented on a product whose position is that nothing leaves your box unless you say so. An unclaimed agent does not connect to Netdata Cloud; that connection is an explicit operator action with a token.

**Bundled Grafana dashboards.** See D13.

## FAQ

**Why not just Prometheus?** You can — D2 is a plain Prometheus endpoint and Prometheus scrapes it unchanged. The `observability` profile ships VictoriaMetrics instead because Prometheus's own UI is an expression browser, so most people pair it with Grafana; that comparison is two containers against one.

**How does `remit doctor` reach the metrics if nothing is published?** It does not reach them from the host. It runs `docker compose exec` into the `doctor` container, which is already on the compose network, and prints what that container reports. Nothing is listening on a host port at any point.

**What if the alerter itself is broken?** Nothing healthchecks it, so the dead-man's switch is the answer — which is why D11 makes it non-optional. Your external monitor stops seeing pings and tells you, whether the cause was a crashed checker, a dead VM or a dead network.

**Does this phone home?** No. `/metrics` is pulled, never pushed. The webhook (D7) and the heartbeat (D11) make outbound connections only to URLs you configure, and are inert until you set them.

**What if I already run Grafana, Datadog, or an OTel collector?** Point it at the `/metrics` endpoints. That is the whole integration, and it is why D2 chose the text format everything reads. Don't enable the `observability` profile.

**Will this slow my VM down?** The metrics endpoints do work only when scraped, and the series count is in the hundreds. The `doctor` container wakes on an interval, scrapes, compares and sleeps. The `observability` profile is off unless you turn it on; dozzle idles in the tens of MB and stores nothing.

**What happens if Slack is down?** The POST fails, that check reports nothing, and the next settled transition tries again. Alerting is best-effort by design — the dead-man's switch (D11) is what catches a delivery path that has stopped working, because your monitor notices the missing heartbeat whether the cause was a dead VM or a dead webhook.

**Do I need the metrics stack to get alerts?** No. D7 runs on a stock install with two lines in `.env`. The `observability` profile is for querying history, not for being told something broke.

**Can I turn alerting off?** It is off. It starts when you set the webhook and heartbeat URLs and stops when you unset them.

**Why can't a healthcheck restart a hung worker?** Compose marks an unhealthy container unhealthy; it does not restart it, and `restart: unless-stopped` acts on exit, not on health. The worker could exit on its own stale heartbeat and D1 says why it does not. The hang is reported to `docker compose ps`, to `remit doctor` and to an alert; deciding what to do about it stays yours.

**Why is my worker healthy while mail is not arriving?** D1's heartbeat says the poll loop is turning, not that handlers are succeeding. The signals that catch that are DLQ depth, handler failures and sync age, and all three reach you through `remit doctor` and the alert.

**My DLQ has a message in it. Now what?** `remit doctor` tells you which queue. Inspecting and replaying the message is still the manual SQS work the README describes — this design surfaces the condition, it does not drain the queue for you.

**Why can't I open the log viewer in a browser?** dozzle has no authentication and reads every container's logs, which on this box includes personal data. D13 binds it to loopback and gives it no public route; reach it over an SSH tunnel or your tailnet.
