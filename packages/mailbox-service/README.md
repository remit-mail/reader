# @remit/mailbox-service

IMAP mailbox synchronization service for Remit. Provides connection management, mailbox discovery, and message sync with DynamoDB persistence.

## Features

- **ImapFlow-based**: Modern async/await IMAP client with native envelope parsing
- **Mailbox Sync**: Discovers and syncs mailbox metadata from IMAP to DynamoDB
- **Message Sync**: Newest-first sync strategy with dual-watermark tracking
- **Address Extraction**: Parses and stores envelope addresses with role tracking

## Installation

```bash
npm install
```

## Usage

### IMAP Connection

```typescript
import {
  ImapFlowConnection,
  createImapFlowConnectionFromAccount,
} from "@remit/mailbox-service";

// From account data
const connection = createImapFlowConnectionFromAccount(
  {
    imapHost: "imap.example.com",
    imapPort: 993,
    imapTls: true,
    username: "user",
  },
  "password",
);

// Or direct configuration
const connection = new ImapFlowConnection({
  host: "imap.example.com",
  port: 993,
  tls: true,
  user: "user",
  password: "password",
});

await connection.connect();
const mailboxes = await connection.listMailboxes();
await connection.disconnect();
```

### Mailbox Sync

```typescript
import { MailboxSyncService } from "@remit/mailbox-service";

const syncService = new MailboxSyncService({
  client: dynamoDBClient,
  table: "remit-table",
});

const result = await syncService.syncMailboxes(
  { accountId: "acc-123" },
  connection,
);
// result: { created: 5, updated: 2, deleted: 0 }
```

### Message Sync

```typescript
import { MessageSyncService } from "@remit/mailbox-service";

const messageSyncService = new MessageSyncService(
  () => createConnection(), // connection factory
  mailboxService,
  messageService,
  envelopeService,
  addressService,
  logger,
);

const synced = await messageSyncService.syncMessages(
  mailboxId,
  accountConfigId,
  50, // batch size
);
```

## Exports

### Connections

| Export                                | Description                          |
| ------------------------------------- | ------------------------------------ |
| `ImapFlowConnection`                  | ImapFlow-based IMAP connection class |
| `createImapFlowConnectionFromAccount` | Factory from account data            |
| `createConnection`                    | Connection factory                   |
| `createConnectionFromAccount`         | Account-based connection factory     |

### Services

| Export               | Description                               |
| -------------------- | ----------------------------------------- |
| `MailboxSyncService` | Syncs mailbox list from IMAP to DynamoDB  |
| `MessageSyncService` | Syncs messages with newest-first strategy |

### Types

| Export                 | Description                  |
| ---------------------- | ---------------------------- |
| `IImapConnection`      | Connection interface         |
| `ImapConnectionConfig` | Connection configuration     |
| `ImapConnectionState`  | Connection state enum        |
| `ImapBoxStatus`        | Mailbox status after opening |
| `FlatMailboxInfo`      | Flattened mailbox info       |
| `MailboxSyncResult`    | Sync operation result        |
| `ImapNamespaces`       | IMAP namespace info          |

### Utilities

| Export                | Description                        |
| --------------------- | ---------------------------------- |
| `parseImapAttributes` | Parse IMAP mailbox attributes      |
| `hasChildren`         | Check if mailbox has children      |
| `isNoSelect`          | Check if mailbox is non-selectable |

## Sync Strategy

Message sync uses a dual-watermark approach:

```
highWaterMarkUid: 150  ─────────────────────────────────────┐
                                                            │ New messages
lastSyncUid: 100       ─────────────────────────────────────┤ (synced first)
                       │                                    │
                       │ Already synced                     │
                       │                                    │
lastSyncUid progress   ─────────────────────────────────────┤
                       │ Backfill                           │
UID 1                  ─────────────────────────────────────┘
```

1. **New messages** (UID > highWaterMarkUid) are synced first
2. **Backfill** (UID < lastSyncUid) continues in subsequent batches
3. Both watermarks update after each batch for resumability
