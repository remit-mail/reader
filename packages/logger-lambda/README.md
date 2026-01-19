# @remit/logger-lambda

Shared logging package for Remit Lambda workers. Wraps [Pino](https://getpino.io/) with Lambda-specific configuration and environment-aware formatting.

## Features

- **Structured Logging**: JSON output for CloudWatch ingestion in production.
- **Pretty Print**: Human-readable output for local development.
- **Request Context**: Automatically correlates logs with Lambda request IDs.
- **Zero Configuration**: Sensible defaults based on `NODE_ENV`.

## Installation

```bash
npm install @remit/logger-lambda
```

## Usage

```typescript
import { createLogger } from "@remit/logger-lambda";
import type { SQSEvent, Context } from "aws-lambda";

export const handler = async (event: SQSEvent, context: Context) => {
  // Initialize logger with Lambda context
  const log = createLogger(context);

  log.info({ event }, "Processing SQS event");

  try {
    // ... business logic
    log.info("Success");
  } catch (error) {
    log.error({ error }, "Processing failed");
    throw error;
  }
};
```

## Environment Variables

| Variable    | Default      | Description                                             |
| ----------- | ------------ | ------------------------------------------------------- |
| `LOG_LEVEL` | `info`       | Pino log level (trace, debug, info, warn, error, fatal) |
| `NODE_ENV`  | `production` | If `development`, enables pretty printing               |
