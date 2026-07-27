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
