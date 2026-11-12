# @remit/logger

The logging interface every Remit package writes through. Packages import the `logger` handle; the composition root installs the implementation once with `setLogger`, the way `setClient` installs the data client. Its main entry reads no `process` global, so it loads on Node and on Cloudflare Workers alike; `@remit/logger/node` holds `installNodeLogger()`, which writes one JSON object per line on stdout at `LOG_LEVEL`, for Node hosts only.

The field names on each line are a contract an operator's log pipeline parses. They are documented in [`deploy/vps/README.md`](../../deploy/vps/README.md) under "Logs".
