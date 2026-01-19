#!/usr/bin/env node
import { parseArgs } from "node:util";
import { emitEvent } from "./emit.js";
import type { ImapEvent } from "./events.js";

const HELP = `
remit-imap-worker - Process IMAP sync events

USAGE:
  remit-worker -t <type> -a <accountId> [options]

OPTIONS:
  -t, --type <type>         Event type (required)
  -a, --accountId <id>      Account ID (required)
  -m, --mailboxId <id>      Mailbox ID (required for some event types)
      --messageIds <ids>    Comma-separated message IDs (required for SYNC_MESSAGE_BODY)
      --fullSync            Force full sync, ignoring lastSyncUid (SYNC_MESSAGES only)
  -h, --help                Show this help message

EVENT TYPES:
  SYNC_MAILBOXES     Sync all mailboxes for an account
  SYNC_MESSAGES      Sync messages in a specific mailbox
  SYNC_MESSAGE_BODY  Fetch and store message bodies in batch

EXAMPLES:
  # Sync all mailboxes for an account
  remit-worker -t SYNC_MAILBOXES -a account-123

  # Sync messages in a mailbox
  remit-worker -t SYNC_MESSAGES -a account-123 -m mailbox-456

  # Force a full sync of messages (ignore lastSyncUid)
  remit-worker -t SYNC_MESSAGES -a account-123 -m mailbox-456 --fullSync

  # Sync message bodies for specific messages
  remit-worker -t SYNC_MESSAGE_BODY -a account-123 -m mailbox-456 --messageIds id1,id2,id3
`;

const { values } = parseArgs({
	options: {
		type: { type: "string", short: "t" },
		accountId: { type: "string", short: "a" },
		mailboxId: { type: "string", short: "m" },
		messageIds: { type: "string" },
		fullSync: { type: "boolean", default: false },
		help: { type: "boolean", short: "h", default: false },
	},
});

if (values.help) {
	console.log(HELP);
	process.exit(0);
}

if (!values.type || !values.accountId) {
	console.error("Error: --type and --accountId are required\n");
	console.log(HELP);
	process.exit(0);
}

const validTypes = ["SYNC_MAILBOXES", "SYNC_MESSAGES", "SYNC_MESSAGE_BODY"];
if (!validTypes.includes(values.type)) {
	console.error(
		`Error: Invalid type "${values.type}". Must be one of: ${validTypes.join(", ")}\n`,
	);
	process.exit(1);
}

if (
	["SYNC_MESSAGES", "SYNC_MESSAGE_BODY"].includes(values.type) &&
	!values.mailboxId
) {
	console.error(`Error: --mailboxId is required for ${values.type}\n`);
	process.exit(1);
}

if (values.type === "SYNC_MESSAGE_BODY" && !values.messageIds) {
	console.error(`Error: --messageIds is required for ${values.type}\n`);
	process.exit(1);
}

const event = {
	type: values.type,
	accountId: values.accountId,
	mailboxId: values.mailboxId,
	messageIds: values.messageIds?.split(",").map((id) => id.trim()),
	fullSync: values.fullSync,
} as Omit<ImapEvent, "eventId" | "timestamp">;

console.log(`Enqueueing ${event.type} event for account ${event.accountId}...`);

emitEvent(event)
	.then(() => {
		console.log("Event enqueued successfully");
		process.exit(0);
	})
	.catch((error) => {
		console.error("Failed to enqueue event:", error);
		process.exit(1);
	});
