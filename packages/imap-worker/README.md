# @remit/imap-worker

SQS-driven Lambda worker for handling IMAP lifecycle events in the Remit system.

## Features

- **Event Driven**: Processes events from SQS (`SYNC_MAILBOXES`, `SYNC_MESSAGES`, etc.).
- **CLI Tool**: Includes a CLI for manually triggering events during development.
- **Bundled**: Built with esbuild for optimal Lambda performance.

## Installation

```bash
npm install
npm run build
```

## Usage

### Lambda Handler

The package exports a standard AWS Lambda SQS handler:

```typescript
import { handler } from "@remit/imap-worker";
```

### CLI (Local Development)

You can trigger events manually using the included CLI:

```bash
# Sync mailboxes for an account
npm run cli -- -t SYNC_MAILBOXES -a <accountId>

# Sync messages for a specific mailbox
npm run cli -- -t SYNC_MESSAGES -a <accountId> -m <mailboxId>

# Full sync (ignore lastSyncUid)
npm run cli -- -t SYNC_MESSAGES -a <accountId> -m <mailboxId> --fullSync
```

## Environment Variables

| Variable              | Required | Description                                         |
| --------------------- | -------- | --------------------------------------------------- |
| `DYNAMODB_TABLE_NAME` | Yes      | Name of the DynamoDB table for Remit data.          |
| `SQS_QUEUE_URL`       | Yes      | URL of the SQS queue for emitting follow-up events. |
| `S3_BUCKET`           | Yes      | S3 bucket for storing raw message content.          |
| `NODE_ENV`            | No       | Set to `development` for local execution.           |
| `LOG_LEVEL`           | No       | Logging level (default: `info`).                    |

## Event Types

- `SYNC_MAILBOXES`: Discovers and syncs the list of mailboxes for an account.
- `SYNC_MESSAGES`: Fetches new messages for a specific mailbox.
- `FETCH_BODY`: (Planned) Fetches full message content.
- `UPDATE_FLAGS`: (Planned) Syncs flag changes back to the IMAP server.
