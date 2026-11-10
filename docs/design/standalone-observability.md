# Observability in the standalone deployment

Observability in this deployment is the operator's answer to four questions:

1. Is the stack up?
2. Is mail still arriving, and is it still being sent?
3. Is work being quarantined instead of done?
4. Will I find out without looking?

It is not distributed tracing, not APM, and not a dashboard. The deployment is one VM, one operator, a handful of accounts, and no on-call rota. (1) is container state. (2) and (3) are domain facts the application knows and nothing else does. (4) is a message that has to leave the box. The operator side is in [`deploy/vps/observability.md`](../../deploy/vps/observability.md).

## Decisions

### D1. The four workers get a heartbeat file, and a healthcheck against it

Each worker touches `/data/heartbeat/<service>` once per poll cycle, at the top of each receive attempt. The image's `HEALTHCHECK` fails when the file's age exceeds a threshold, which must exceed the longest legitimate handler run (300 s for body sync and search indexing), or a slow mailbox reads as a hang. A worker whose poll loop wedges inside a socket read never exits, so without this `docker compose ps` reports it running while mail stops arriving.

A file rather than `/health` on the D2 listener: an HTTP handler answers from a process whose poll loop is wedged, so any honest health endpoint would consult this timestamp anyway. The `doctor` service (D9) mounts the same volume read-only, so `remit doctor` and an alert evaluate the same timestamps.

A heartbeat proves the loop is turning, not that work succeeds; the D3 signals carry that. The worker does not exit on its own stale heartbeat: an exit drops in-flight work until the visibility timeout expires, and a threshold that tolerates a 300 s handler is the one most likely to turn a slow mailbox into a restart loop.

### D2. `/metrics` in Prometheus text format, on an internal port, not published

Every service that owns a signal serves `/metrics` in Prometheus/OpenMetrics text format on the compose network. No Caddy route and no published host port; the only host ports remain caddy's 80 and 443.

Pull, not push. A push exporter needs a destination, a credential and an outbound connection from a box that holds someone's mail. A pull endpoint needs nothing on our side, and every common agent reads OpenMetrics text.

### D3. Measure domain signals, not the host

| Signal | Exported by |
|---|---|
| Queue depth and DLQ depth, per queue | `queue-sidecar` |
| Seconds since the last completed message-sync round, per account | `backend` |
| IMAP failures, with authentication failures counted separately | `imap-worker` |
| SMTP failures, with authentication failures counted separately | `smtp-worker` |
| Handler outcome (success/failure) and duration, per queue and event type | each worker |

**Sync age is measured from `mailbox.last_message_sync_at`, not `account.last_sync_at`.** `account.last_sync_at` is stamped after the mailbox *list* sync and before the per-mailbox fan-out that fetches messages, so a deployment whose message handlers all throw keeps it fresh forever while no mail arrives. `mailbox.last_message_sync_at` is stamped at the end of a message-sync round. The series is, per account, the age of the newest such stamp across its mailboxes.

Authentication failures are separate because they never resolve themselves: an expired OAuth grant or a changed password fails identically forever.

Update state is not in the table. The updater container holds the docker socket and binds no port by design; `remit status` already prints its state.

Per-account series are labelled by account id, never by address (D10 applies to metric labels).

### D4. `remit doctor`

Reads the D3 signals, computes `healthy` or `degraded` with reasons, and exits non-zero on `degraded`; `--json` emits the same verdict. It runs `compose exec -T doctor` against the D9 service, so the verdict is computed in one place and read at a shell, as an exit code, and as an alert.

A signal that cannot be evaluated is `degraded`, never skipped: a refused connection, a scrape timeout, an absent heartbeat file, a 200 that carries none of the series being read. If the `doctor` container does not answer the exec, the wrapper reports `degraded` for that reason alone. No path produces `healthy` from a check that failed to look.

### Alerting: D7 to D12

These six are one job, built and shipped as a unit: dropping the heartbeat leaves a checker nobody watches, dropping the transition rule leaves a channel nobody reads, and dropping the container leaves an alerter that dies with what it reports on.

### D7. Alerting ships with the stack, not behind the metrics profile

The `doctor` service runs the `remit doctor` check on an interval and POSTs the result to a webhook URL. Unset, the check still runs and nothing is sent. The operator who most needs an alert is the one who installed nothing extra, and the facts worth waking someone for are point-in-time states that need no time-series database.

### D8. Fire on a settled change of verdict, after three consecutive agreeing checks

A verdict fires when it changes and the new verdict has held for three consecutive checks. Never on an unchanged verdict. The last fired verdict and the run of agreeing checks are persisted, so a container restart does not re-announce a condition already reported.

A transition is spent when the endpoint has answered about it, not when it is decided. A delivery that never arrived leaves the last fired verdict where it was, and the next check announces it again. A crash between a delivered alert and the write re-announces once — a duplicate, against a dropped outage alert.

A signal that is true for a single check cannot satisfy the dwell rule, so it is held open for as long as its condition lasts. Authentication failures arrive as counter increases, one burst per sync tick, and are held for a window wider than that tick.

The dead-man's switch (D11) is unaffected by dwell.

### D9. The check runs in its own container, with no docker socket

A checker inside the backend dies with the backend, which is one of the conditions it exists to report. The `doctor` service has its own state volume for D8 and mounts the `heartbeat` volume read-only. It mounts no docker socket: D1 put worker liveness on a file so that reading it does not require the daemon. Nothing healthchecks it, so its liveness rests on D11.

### D10. No mail content and no addresses in an alert payload

The payload carries counts, service names, queue names and verdicts. It never carries an email address, a subject, a sender, a message id or a folder name. The payload goes to a third party over the internet; the operator identifies the affected account by running `remit doctor` on the box.

### D11. The dead-man's switch is required whenever the webhook is set

The `doctor` service pings an external URL on every completed check, whatever the verdict. A check that produces a `degraded` verdict from signals it could not read still pings; a check that throws before producing a verdict does not.

Setting the webhook URL without the heartbeat URL fails the container at startup with a message naming both variables. Without it, a dead VM, a full disk or a crashed checker is indistinguishable from a week with nothing wrong.

### D12. One webhook URL and a payload template, no integration registry

Configuration is a URL, an optional payload template with a small substitution set (verdict, summary, reasons), and an optional content type. Substituted values are escaped for the declared content type.

A payload the endpoint **rejects** with a 4xx is a decision about that body, so the transition is spent and the operator gets one error line naming the status. A payload that **never arrived** — a timeout, a refused connection, a 5xx, a 429 — is retried on the next check (D8).

### D13. An optional `observability` compose profile, off by default, bound to localhost

`profiles: ["observability"]` adds dozzle (a log viewer) and VictoriaMetrics single-node (scrapes D2, serves `vmui`).

**Both publish on `127.0.0.1` only, and neither ever gets a Caddy route.** dozzle serves every container's logs with no authentication, and those logs carry the personal data D10 keeps out of a webhook; `vmui` serves D3's per-account series. Adding a route would put an unauthenticated view of every mailbox's log lines on the public origin.

No dashboards ship: they hardcode metric names and break on the first rename.
