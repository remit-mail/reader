#!/usr/bin/env node
import { parseArgs } from "node:util";
import { emitEvent } from "./emit.js";

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
      --path <path>         Mailbox path (required for MAILBOX_CREATE, MAILBOX_DELETE)
      --oldPath <path>      Old mailbox path (required for MAILBOX_RENAME)
      --newPath <path>      New mailbox path (required for MAILBOX_RENAME)
      --subscribe           Subscribe to mailbox after creation (MAILBOX_CREATE only)
  -h, --help                Show this help message

EVENT TYPES:
  SYNC_MAILBOXES     Sync all mailboxes for an account
  SYNC_MESSAGES      Sync messages in a specific mailbox
  SYNC_MESSAGE_BODY  Fetch and store message bodies in batch
  MAILBOX_CREATE     Create a new mailbox
  MAILBOX_RENAME     Rename a mailbox
  MAILBOX_DELETE     Delete a mailbox

EXAMPLES:
  # Sync all mailboxes for an account
  remit-worker -t SYNC_MAILBOXES -a account-123

  # Sync messages in a mailbox
  remit-worker -t SYNC_MESSAGES -a account-123 -m mailbox-456

  # Force a full sync of messages (ignore lastSyncUid)
  remit-worker -t SYNC_MESSAGES -a account-123 -m mailbox-456 --fullSync

  # Sync message bodies for specific messages
  remit-worker -t SYNC_MESSAGE_BODY -a account-123 -m mailbox-456 --messageIds id1,id2,id3

  # Create a new mailbox
  remit-worker -t MAILBOX_CREATE -a account-123 -m mailbox-id --path Work/Projects --subscribe

  # Rename a mailbox
  remit-worker -t MAILBOX_RENAME -a account-123 -m mailbox-id --oldPath Work/Projects --newPath Archive/Projects

  # Delete a mailbox
  remit-worker -t MAILBOX_DELETE -a account-123 -m mailbox-id --path Work/Projects
`;

const { values } = parseArgs({
	options: {
		type: { type: "string", short: "t" },
		accountId: { type: "string", short: "a" },
		mailboxId: { type: "string", short: "m" },
		messageIds: { type: "string" },
		fullSync: { type: "boolean", default: false },
		path: { type: "string" },
		oldPath: { type: "string" },
		newPath: { type: "string" },
		subscribe: { type: "boolean", default: false },
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

const validTypes = [
	"SYNC_MAILBOXES",
	"SYNC_MESSAGES",
	"SYNC_MESSAGE_BODY",
	"MAILBOX_CREATE",
	"MAILBOX_RENAME",
	"MAILBOX_DELETE",
];
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

// Validation for mailbox management events
if (
	["MAILBOX_CREATE", "MAILBOX_DELETE"].includes(values.type) &&
	!values.path
) {
	console.error(`Error: --path is required for ${values.type}\n`);
	process.exit(1);
}

if (
	["MAILBOX_CREATE", "MAILBOX_RENAME", "MAILBOX_DELETE"].includes(
		values.type,
	) &&
	!values.mailboxId
) {
	console.error(`Error: --mailboxId is required for ${values.type}\n`);
	process.exit(1);
}

if (values.type === "MAILBOX_RENAME" && (!values.oldPath || !values.newPath)) {
	console.error(
		`Error: --oldPath and --newPath are required for ${values.type}\n`,
	);
	process.exit(1);
}

// Build the event based on type
const buildEvent = () => {
	switch (values.type) {
		case "SYNC_MAILBOXES":
			return {
				type: "SYNC_MAILBOXES" as const,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				accountId: values.accountId!,
			};
		case "SYNC_MESSAGES":
			return {
				type: "SYNC_MESSAGES" as const,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				accountId: values.accountId!,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				mailboxId: values.mailboxId!,
				fullSync: values.fullSync,
			};
		case "SYNC_MESSAGE_BODY":
			return {
				type: "SYNC_MESSAGE_BODY" as const,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				accountId: values.accountId!,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				mailboxId: values.mailboxId!,
				messageIds: values.messageIds?.split(",").map((id) => id.trim()),
			};
		case "MAILBOX_CREATE":
			return {
				type: "MAILBOX_CREATE" as const,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				accountId: values.accountId!,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				mailboxId: values.mailboxId!,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				path: values.path!,
				subscribe: values.subscribe,
			};
		case "MAILBOX_RENAME":
			return {
				type: "MAILBOX_RENAME" as const,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				accountId: values.accountId!,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				mailboxId: values.mailboxId!,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				oldPath: values.oldPath!,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				newPath: values.newPath!,
			};
		case "MAILBOX_DELETE":
			return {
				type: "MAILBOX_DELETE" as const,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				accountId: values.accountId!,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				mailboxId: values.mailboxId!,
				// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
				path: values.path!,
			};
		default:
			throw new Error(`Unknown event type: ${values.type}`);
	}
};

const event = buildEvent();

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
