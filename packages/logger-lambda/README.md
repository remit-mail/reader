# @remit/logger-lambda

The Node host for [`@remit/logger`](../logger/README.md). `@remit/logger-lambda/node` holds what only a Node process can run: `installNodeLogger()`, re-exported from `@remit/logger/node`, which writes one JSON object per line on stdout at `LOG_LEVEL`, and `withTelemetry`, which installs it and records handler duration and outcome. `@remit/logger-lambda/metrics` owns the process-wide Prometheus registry every service renders at `/metrics`; see [docs/design/standalone-observability.md](../../docs/design/standalone-observability.md) for the signal set. A Workers host imports neither entry.

A signal only one service can answer for is declared by that service against the exported `registry` — see `queue-sidecar/src/metrics.ts`. Declaring it here would render it in every process that imports this module, including the ones that cannot know its value.

## Environment variables

| Variable             | Default | Description                                                                                                                          |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `LOG_LEVEL`          | `info`  | `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent`. An unrecognised value logs one warning and falls back to the default. |
| `REMIT_SERVICE_NAME` | `remit` | The `service` field on every line. Stamped into each service bundle at build time by `npm-scripts/docker-bundle.mjs`.                 |
| `METRICS_PORT`       | `9464`  | Port `startMetricsServer` binds. Empty is unset and takes the default; anything that is not a port number in 0–65535 logs one error and serves no metrics, rather than falling back. A service that cannot be scraped is a smaller failure than one that reports on the wrong port. |
| `METRICS_HOST`       | `0.0.0.0` | Interface `startMetricsServer` binds. Set `127.0.0.1` when the service runs as a host process rather than a container. |
