# Observability in the standalone deployment

Status: proposed
Scope: `deploy/vps` (the self-host compose stack, the `remit` wrapper), `packages/logger-lambda`, and the metric surface of `backend`, `queue-sidecar` and the four workers. The hosted platform is out of scope.

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

**Metrics.** The same package exports a Powertools `Metrics` instance. It emits CloudWatch Embedded Metric Format on stdout. Handlers already write to it — `invocationCount`, `invocationLatency`, `errorCount` in `withTelemetry`, plus `imapOperationLatency` and `imapOperationFailures` dimensioned by event type in `imap-worker`. Nothing in this deployment reads EMF, so those lines are stdout noise.

**Health.** `queue`, `backend`, `apisix` and `web` have compose healthchecks. `imap-worker`, `smtp-worker`, `account-worker` and `search-index-worker` have none, in the compose file or in their image. `caddy` has none by design (RFC 037 D5 keeps it serving 502s through an outage). A worker whose poll loop wedges inside a socket read never exits, so `restart: unless-stopped` never fires, and `docker compose ps` reports it running. Mail silently stops arriving.

**Queues.** All eleven work queues in `queues.json` have a dead-letter queue at `maxReceiveCount = 3`. A message that reaches one sits there until someone looks. `deploy/vps/README.md` documents this as a known gap and tells the operator to run a hand-written node one-liner through `docker compose exec queue`, once per queue, reading the SQS wire protocol by hand. It is the signal that most warrants an alert and the one hardest to reach.

## Decisions

### D1. The four workers get healthchecks

Each worker exposes `/health` on an internal HTTP listener and a compose healthcheck against it. A worker is healthy when every poll loop it started has completed a receive-or-handler cycle within a threshold derived from that queue's visibility timeout — the threshold must exceed the longest legitimate handler run (300 s for body sync and search indexing), or a slow mailbox reads as a hang.

This buys visibility, not recovery. Compose marks an unhealthy container unhealthy and `restart: unless-stopped` does not act on that, so the hung poller stays hung — but it now shows in `docker compose ps`, in `remit doctor` (D4) and in an alert (D6).

### D2. `/metrics` in Prometheus text format, on the internal port, not published

Every service that owns a signal serves it at `/metrics` in Prometheus/OpenMetrics text format, on its existing internal port (the same listener D1 adds for the workers). No Caddy route, no published host port. The only host ports remain caddy's 80 and 443.

Pull, not push. A push exporter needs a destination, a credential and an outbound connection from a box that holds someone's mail — three things to configure and one new egress path on a product that otherwise makes none. A pull endpoint needs nothing on our side: an operator running Prometheus, VictoriaMetrics, Grafana Alloy, Netdata, a Datadog agent or an OpenTelemetry collector points it at the container and is done, and an operator running none of them pays for an unused route. Push also fixes the wire protocol at build time; OpenMetrics text is read by all of them.

What this gives up: the endpoint reaches nobody who runs no scraper, which is most self-hosters. What it buys: zero configuration, zero credentials, zero outbound connections, and compatibility with every agent an operator might already run. D4 and D6 exist because of what it gives up.

### D3. Measure domain signals, not the host

The host agent an operator already runs reports CPU, memory, disk and network. It cannot know whether mail is arriving. The exported series are the facts only this application holds:

| Signal | Exported by |
|---|---|
| Queue depth and DLQ depth, per queue | `queue-sidecar` |
| Seconds since the last successful sync, per account | `backend` |
| IMAP failures, with authentication failures counted separately | `imap-worker` |
| SMTP failures, with authentication failures counted separately | `smtp-worker` |
| Handler outcome (success/failure) and duration, per queue and event type | each worker |
| Search index backlog — unprocessed outbox rows | `search-index-worker` |
| Last update check, its outcome, and the last update run's outcome | `updater` |

Authentication failures are separate from other failures because they are the one class that never resolves itself: an expired OAuth grant or a changed password fails identically forever, and it is the most common way a self-hosted mailbox goes quiet.

Per-account series are labelled by account id, never by address (D9 applies to metric labels — a scraped label travels wherever the scrape goes). Cardinality is a non-issue at self-host scale, where accounts are single digits.

### D4. `remit doctor`

A new wrapper command that reads the signals in D3, computes a verdict, and prints it. `healthy` or `degraded`, the reasons, and a non-zero exit on `degraded` so a cron job or an external monitor can use it directly. `--json` emits the same verdict as a machine-readable object.

This is where DLQ depth is surfaced, and the README one-liner is deleted when it lands. The CLI is the core of this product. `remit doctor` is what most self-hosters will actually run, and it is the only observability surface that requires the operator to install nothing and configure nothing.

`remit status` stays what it is — directory, tag, origin reachability, update state, `compose ps`. `doctor` answers "is anything wrong", `status` answers "what is running".

### D5. Replace the metrics half of `@remit/logger-lambda`, and the logging half with it

Powertools `Metrics` emits CloudWatch EMF. It cannot serve D2 at any configuration, so this half is not a judgement call: a real registry (prom-client or equivalent) replaces it, and the registry is what `/metrics` renders. `withTelemetry` keeps its name, its call sites and its per-invocation timing, and records into the registry.

The logging half is a judgement call, and the recommendation is to replace it too. The `Logger` interface stays exactly as it is; the Powertools implementation behind it becomes a minimal JSON-lines writer. Nothing in this deployment uses what Powertools adds — there is no Lambda context to enrich, no cold start that means anything, no CloudWatch Logs Insights to shape the fields for.

What this gives up: the log JSON field names change once, so any grep or log-shipping rule an operator wrote against the current shape breaks, and the change touches five packages' imports for no user-visible gain. What it buys: two AWS-shaped dependencies leave five images, and the package every service logs through stops being named for a runtime this distro does not use.

The alternative — keep Powertools for logging, replace only `Metrics` — is cheaper today and leaves the distro shipping an AWS Lambda logging stack on a VM. The interface has five call sites now and will have more later.

### D6. Alerting ships with the stack, not behind the metrics profile

A small periodic job runs the same check `remit doctor` runs and POSTs the result to a webhook URL. One environment variable turns it on; unset, nothing runs and nothing is sent. Slack incoming webhooks and ntfy are both a plain POST, so both are targets with no integration code.

vmalert and Alertmanager (D13) only ever reach an operator who opted into the metrics profile. The operator who most needs an alert is the one who installed nothing — ran `install.sh`, added a mailbox, and has not logged into the box since. The three facts worth waking someone for (a mailbox stopped syncing, IMAP authentication broke, a DLQ is non-zero) are point-in-time facts about current state. None of them needs a time-series database to evaluate.

What this gives up: no rate alerts, no "error rate doubled", no trend. What it buys: an alert that works on a stock install with one line in `.env`.

### D7. Fire on state transitions only

An alert is sent when the verdict changes: `healthy` → `degraded`, and `degraded` → `healthy`. Never on an unchanged verdict, however long it persists. The last verdict is persisted so a restart of the job does not re-announce a condition already reported.

A job that posts every poll while a DLQ stays non-zero trains its reader to mute the channel, which leaves the operator believing they are covered when they are not. The recovery message matters as much as the failure one — without it the operator has to go and check whether the condition cleared.

### D8. The alerting job runs in its own container

Not in the backend, not in a worker. An alerter inside the backend dies with the backend, which is one of the conditions it exists to report. It gets its own service with `restart: unless-stopped` and its own small state volume for D7's last verdict, the same shape as `updater` and for the same reason — a job that has to outlive the failure of what it watches cannot share its lifecycle.

### D9. No mail content and no addresses in an alert payload

The payload carries counts, service names, queue names and verdicts. It never carries an email address, a subject, a sender, a message id or a folder name. "2 of 5 accounts are failing authentication", not which two.

This is a mail server, and the payload goes to a third-party SaaS over the internet. Addresses, folder names and subject lines are all personal data. The operator identifies the affected account by running `remit doctor` on the box.

### D10. A dead-man's switch, shipped with D6

The same job pings an external URL on every check that completes, whatever the verdict. It is configured by a second environment variable and ships with D6, not after it.

If the VM is off, the disk is full, the network is gone or the alerter itself crashed, no alert fires, and the operator cannot tell that apart from a week with nothing wrong. Healthchecks.io, ntfy and Uptime Kuma all alert on the absence of an expected ping.

### D11. One webhook URL and a payload template, no integration registry

Configuration is a URL, an optional payload template with a small substitution set (verdict, summary, reasons), and an optional content type. The default template is Slack-shaped JSON, which Mattermost and Discord also accept; a plain-text content type covers ntfy and anything else that takes a raw body.

A named integration per service — a Slack block builder, a Discord embed shape, a PagerDuty Events API client, a Teams card — is how this file becomes 400 lines and how every new provider becomes our maintenance. A template covers providers we have never heard of, and the operator owns it.

What this gives up: no rich formatting, no threading, no per-service niceties. What it buys: one code path, and any HTTP endpoint as a target.

### D12. An optional `observability` compose profile, off by default

Same pattern as `backup`: `profiles: ["observability"]`, absent unless asked for. Two containers.

- **dozzle** — a log viewer over the Docker socket. Tens of MB, no storage, no configuration. It replaces `remit logs` scrollback with something searchable across services.
- **VictoriaMetrics single-node** — one binary that scrapes the D2 endpoints itself, stores the series, and serves `vmui` for queries and graphs.

**No dashboards ship.** `vmui` answers "what is the DLQ depth" and "when did that account last sync" with a query, which is the entire need. Curated dashboards carry permanent maintenance: they hardcode metric names, they break on the first rename, and a broken panel is read as a broken system.

VictoriaMetrics rather than Prometheus + Grafana because it is one container instead of two, scrapes without a separate agent, and ships a query UI in the same binary. The README advertises a small idle footprint, and a two-container metrics stack is the larger claim on it.

### D13. vmalert and Alertmanager live inside the profile only

Rate and trend alerting — "sync latency doubled", "failures rising over an hour" — needs a time-series database and belongs where one exists. Both are added to the `observability` profile for the operators who want it. It is a rare need, and those operators have already accepted the container cost.

## Rejected

**Push by default, OTLP as the primary transport.** Deferred rather than built. The environment-variable contract is there if it is wanted later, but distributed tracing across four workers on one VM buys very little — the trace is almost always one handler, one mailbox, one failure, which a log line already carries. The cost is a collector, an exporter in five packages, and a destination to configure.

**Netdata.** One container, built-in alarms out of the box, and it would satisfy D6 and D12 together. It is heavier than its reputation suggests, and it wants to register with Netdata Cloud by default. For a product whose position is that nothing leaves your box unless you say so, a default that phones home is the wrong default to inherit, and turning it off is a configuration step we would have to document and keep working.

**Bundled Grafana dashboards.** See D12.

## FAQ

**Why not just Prometheus?** You can — D2 is a plain Prometheus endpoint and Prometheus scrapes it unchanged. The `observability` profile ships VictoriaMetrics instead because Prometheus's own UI is an expression browser, so most people pair it with Grafana; that comparison is two containers against one.

**Does this phone home?** No. `/metrics` is pulled, never pushed. Alerting (D6) and the dead-man's switch (D10) make outbound connections only to URLs you configure, and are inert until you set them.

**What if I already run Grafana, Datadog, or an OTel collector?** Point it at the `/metrics` endpoints. That is the whole integration, and it is why D2 chose the text format everything reads. Don't enable the `observability` profile.

**Will this slow my VM down?** The metrics endpoints do work only when scraped, and the series count is in the hundreds. The alerter is a process that wakes on an interval, runs the same checks `remit doctor` runs, and sleeps. The `observability` profile is off unless you turn it on; dozzle idles in the tens of MB and stores nothing.

**What happens if Slack is down?** The POST fails, that check reports nothing, and the next state transition tries again. Alerting is best-effort by design — the dead-man's switch (D10) is what catches a delivery path that has stopped working, because your monitor notices the missing heartbeat whether the cause was a dead VM or a dead webhook.

**Do I need the metrics stack to get alerts?** No. D6 runs on a stock install with one line in `.env`. The `observability` profile is for querying history, not for being told something broke.

**Can I turn alerting off?** It is off. It starts when you set the webhook URL and stops when you unset it.

**Why can't a healthcheck restart a hung worker?** Compose marks an unhealthy container unhealthy; it does not restart it, and `restart: unless-stopped` acts on exit, not on health. D1 makes the hang visible to `remit doctor` and to an alert. Deciding what to do about it stays yours.

**My DLQ has a message in it. Now what?** `remit doctor` tells you which queue. Inspecting and replaying the message is still the manual SQS work the README describes — this design surfaces the condition, it does not drain the queue for you.
