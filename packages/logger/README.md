# @remit/logger

The logging seam every Remit package writes through. It defines the `Logger`
interface, a platform-neutral writer that formats one JSON object per line, and
the `logger` handle packages log through. It reads no `process` global, so it
loads on Node and on Cloudflare Workers (`nodejs_compat`, for
`AsyncLocalStorage`) alike.

The field names on each line are a contract an operator's log pipeline parses.
They are documented in [`deploy/vps/README.md`](../../deploy/vps/README.md)
under "Logs".

## Plugging in a logger

Packages import the handle, never a concrete writer. The composition root
installs the implementation once, the same way `setClient` installs the data
client:

```typescript
import { createJsonLogger, setLogger } from "@remit/logger";

setLogger(createJsonLogger({ level: "debug", service: "reader-worker" }));
```

On Node, `installNodeLogger()` from `@remit/logger-lambda/node` installs the
stdout writer configured by `LOG_LEVEL` and `REMIT_SERVICE_NAME`; `withTelemetry`
calls it for every Lambda entry point. Until something is installed, the handles
write through `console.log` at `info`.

`withLogContext(bindings, fn)` adds bindings to every line written inside `fn`,
across its asynchronous continuations. A `Logger` implemented elsewhere reads
them with `logContext()`.
