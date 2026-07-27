# @remit/logger-lambda

The logging seam every Remit service writes through. One JSON object per line on
stdout, via [pino](https://getpino.io/). The exported `Logger` interface is what
consuming code imports; the writer behind it is an implementation detail.

The field names on each line are a contract an operator's log pipeline parses.
They are documented, with the reserved names and the personal-data caveat, in
[`deploy/vps/README.md`](../../deploy/vps/README.md) under "Logs".

## Usage

```typescript
import { createLogger } from "@remit/logger-lambda";
import type { SQSEvent } from "aws-lambda";

const log = createLogger().child({ queue: "remit-imap-sync" });

export const handler = async (event: SQSEvent) => {
  log.debug({ records: event.Records.length }, "Batch received");

  try {
    // ... business logic
  } catch (error) {
    log.error({ error }, "Processing failed");
    throw error;
  }
};
```

## Metrics

`@remit/logger-lambda/metrics` owns the process-wide Prometheus registry every
service renders at `/metrics`, and the recorders that write to it. See
[docs/design/standalone-observability.md](../../docs/design/standalone-observability.md)
for the signal set and why it is pulled rather than pushed.

```typescript
import {
  onScrape,
  recordImapFailure,
  startMetricsServer,
} from "@remit/logger-lambda/metrics";

// A service with no listener of its own gets one for /metrics alone. A port it
// cannot bind is reported and then dropped: the process keeps doing its work
// and serves no metrics.
startMetricsServer();

// Counters and histograms are written where the work happens.
recordImapFailure("SYNC_MESSAGES", "auth");

// A gauge whose value is a read is collected when a scrape arrives. A collector
// that throws fails the scrape rather than rendering a stale or zero value.
onScrape(async () => setBacklog(await countUndrainedRows()));
```

A signal only one service can answer for is declared by that service against the
exported `registry` — see `search-index-worker/src/metrics.ts` and
`queue-sidecar/src/metrics.ts`. Declaring it here would render it in every
process that imports this module, including the four that cannot know its value.

`withTelemetry` records handler duration and outcome into the same registry.

Both argument orders work: `(bindings, message)` and `(message, bindings)`.
Bindings land at the top level of the line, never nested. A value under `error`
that is an `Error` is expanded to `type`, `message` and `stack`; anything else is
written as it is.

`child(bindings)` returns a logger that adds those bindings to every line, and
`setBindings(bindings)` adds them to an existing one. Neither is per-request:
they belong to the logger instance, so on a process serving requests
concurrently use `withLogContext` instead.

```typescript
import { logger, withLogContext } from "@remit/logger-lambda";

const handler = (request: Request) =>
  withLogContext({ requestId: request.id }, async () => {
    logger.debug("Request received"); // carries requestId
    return respond(request);
  });
```

The scope follows the work through its asynchronous continuations, so two
overlapping requests never see each other's fields. Scopes nest, and an inner
one adds to the bindings of the one it runs inside.

## Environment variables

| Variable             | Default | Description                                                                                                                          |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `LOG_LEVEL`          | `info`  | `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent`. An unrecognised value logs one warning and falls back to the default. |
| `REMIT_SERVICE_NAME` | `remit` | The `service` field on every line. Stamped into each service bundle at build time by `npm-scripts/docker-bundle.mjs`.                 |
| `METRICS_PORT`       | `9464`  | Port `startMetricsServer` binds. Empty is unset and takes the default; anything that is not a port number in 0–65535 logs one error and serves no metrics, rather than falling back. A service that cannot be scraped is a smaller failure than one that reports on the wrong port. |
| `METRICS_HOST`       | `0.0.0.0` | Interface `startMetricsServer` binds. Set `127.0.0.1` when the service runs as a host process rather than a container. |
