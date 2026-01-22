# @remit/imap-worker

SQS-driven Lambda worker for handling IMAP lifecycle events in the Remit system.

## Features

- **Event Driven**: Processes events from SQS (`SYNC_MAILBOXES`, `SYNC_MESSAGES`, etc.)
- **CLI Tool**: Includes a CLI for manually triggering events during development
- **Bundled**: Built with esbuild for optimal Lambda performance

## Installation

```bash
npm install
npm run bundle
```

## Usage

### Lambda Handler

The package exports a standard AWS Lambda SQS handler:

```typescript
import { handler } from "@remit/imap-worker";
```

### CLI (Local Development)

Trigger events manually using the included CLI:

```bash
# Sync all mailboxes for an account
npm run cli -- -t SYNC_MAILBOXES -a <accountId>

# Sync messages in a mailbox
npm run cli -- -t SYNC_MESSAGES -a <accountId> -m <mailboxId>

# Force full sync (ignore lastSyncUid)
npm run cli -- -t SYNC_MESSAGES -a <accountId> -m <mailboxId> --fullSync

# Fetch the body of a specific message
npm run cli -- -t FETCH_BODY -a <accountId> -m <mailboxId> --messageId <messageId>

# Update flags on a message
npm run cli -- -t UPDATE_FLAGS -a <accountId> -m <mailboxId> --messageId <messageId>
```

## Environment Variables

| Variable              | Required | Description                                |
| --------------------- | -------- | ------------------------------------------ |
| `DYNAMODB_TABLE_NAME` | Yes      | Name of the DynamoDB table for Remit data  |
| `SQS_QUEUE_URL`       | Yes      | URL of the SQS queue for follow-up events  |
| `S3_BUCKET`           | Yes      | S3 bucket for storing raw message content  |
| `NODE_ENV`            | No       | Set to `development` for local execution   |
| `LOG_LEVEL`           | No       | Logging level (default: `info`)            |

## Event Types

| Event            | Description                                    | Required Fields                    |
| ---------------- | ---------------------------------------------- | ---------------------------------- |
| `SYNC_MAILBOXES` | Discovers and syncs mailboxes for an account   | `accountId`                        |
| `SYNC_MESSAGES`  | Fetches new messages for a mailbox             | `accountId`, `mailboxId`           |
| `FETCH_BODY`     | Fetches full message content                   | `accountId`, `mailboxId`, `messageId` |
| `UPDATE_FLAGS`   | Syncs flag changes back to the IMAP server     | `accountId`, `mailboxId`, `messageId` |

### Event Schema

All events share a base schema:

```typescript
interface BaseEvent {
  accountId: string;
  eventId: string;    // Idempotency key
  timestamp: number;  // Unix timestamp
}
```

## Architecture

```
SQS Queue
    │
    ▼
┌───────────────┐
│  Lambda/CLI   │
│   (index.ts)  │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│   processor   │  ─── Routes events to handlers
└───────┬───────┘
        │
        ├──► syncMailboxes
        ├──► syncMessages
        ├──► fetchBody
        └──► updateFlags
```
