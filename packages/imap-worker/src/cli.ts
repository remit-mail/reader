#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { createLogger } from "@remit/remit-logger-lambda";
import type { ImapEvent } from "./events.js";
import { processEvent } from "./processor.js";

process.on("unhandledRejection", (reason, promise) => {
	console.error("Unhandled Rejection at:", promise, "reason:", reason);
	process.exit(1);
});

process.on("uncaughtException", (err) => {
	console.error("Uncaught Exception:", err);
	process.exit(1);
});

// Ignore SIGPIPE to prevent crashes when output is piped
process.on("SIGPIPE", () => {
	console.error("[SIGPIPE received - ignoring]");
});

const HELP = `
remit-imap-worker - Process IMAP sync events

USAGE:
  remit-worker -t <type> -a <accountId> [options]

OPTIONS:
  -t, --type <type>         Event type (required)
  -a, --accountId <id>      Account ID (required)
  -m, --mailboxId <id>      Mailbox ID (required for some event types)
      --messageId <id>      Message ID (required for FETCH_BODY, UPDATE_FLAGS)
      --fullSync            Force full sync, ignoring lastSyncUid (SYNC_MESSAGES only)
  -h, --help                Show this help message

EVENT TYPES:
  SYNC_MAILBOXES   Sync all mailboxes for an account
  SYNC_MESSAGES    Sync messages in a specific mailbox
  FETCH_BODY       Fetch the body of a specific message
  UPDATE_FLAGS     Update flags on a specific message

EXAMPLES:
  # Sync all mailboxes for an account
  remit-worker -t SYNC_MAILBOXES -a account-123

  # Sync messages in a mailbox
  remit-worker -t SYNC_MESSAGES -a account-123 -m mailbox-456

  # Force a full sync of messages (ignore lastSyncUid)
  remit-worker -t SYNC_MESSAGES -a account-123 -m mailbox-456 --fullSync

  # Fetch the body of a specific message
  remit-worker -t FETCH_BODY -a account-123 -m mailbox-456 --messageId msg-789

  # Update flags on a message
  remit-worker -t UPDATE_FLAGS -a account-123 -m mailbox-456 --messageId msg-789
`;

const { values } = parseArgs({
	options: {
		type: { type: "string", short: "t" },
		accountId: { type: "string", short: "a" },
		mailboxId: { type: "string", short: "m" },
		messageId: { type: "string" },
		fullSync: { type: "boolean", default: false },
		help: { type: "boolean", short: "h", default: false },
	},
});

const log = createLogger();

if (values.help) {
	console.log(HELP);
	process.exit(0);
}

if (!values.type || !values.accountId) {
	console.error("Error: --type and --accountId are required\n");
	console.log(HELP);
	process.exit(0);
}

const validTypes = [
	"SYNC_MAILBOXES",
	"SYNC_MESSAGES",
	"FETCH_BODY",
	"UPDATE_FLAGS",
];
if (!validTypes.includes(values.type)) {
	console.error(
		`Error: Invalid type "${values.type}". Must be one of: ${validTypes.join(", ")}\n`,
	);
	process.exit(1);
}

if (
	["SYNC_MESSAGES", "FETCH_BODY", "UPDATE_FLAGS"].includes(values.type) &&
	!values.mailboxId
) {
	console.error(`Error: --mailboxId is required for ${values.type}\n`);
	process.exit(1);
}

if (["FETCH_BODY", "UPDATE_FLAGS"].includes(values.type) && !values.messageId) {
	console.error(`Error: --messageId is required for ${values.type}\n`);
	process.exit(1);
}

const event = {
	type: values.type,
	accountId: values.accountId,
	mailboxId: values.mailboxId,
	messageId: values.messageId,
	fullSync: values.fullSync,
	eventId: randomUUID(),
	timestamp: Date.now(),
} as ImapEvent;

log.info({ event }, "Running CLI event");

try {
	await processEvent(event, log);
	log.info("Event processing complete");
	process.exit(0);
} catch (error) {
	log.error({ error }, "Event processing failed");
	process.exit(1);
}
