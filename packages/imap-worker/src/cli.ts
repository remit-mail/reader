#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { createLogger } from "@remit/logger-lambda";
import type { ImapEvent } from "./events.js";
import { processEvent } from "./processor.js";

const { values } = parseArgs({
	options: {
		type: { type: "string", short: "t" },
		accountId: { type: "string", short: "a" },
		mailboxId: { type: "string", short: "m" },
		messageId: { type: "string" },
		fullSync: { type: "boolean", default: false },
	},
});

const log = createLogger();

if (!values.type || !values.accountId) {
	console.error(
		"Usage: remit-worker -t <type> -a <accountId> [-m <mailboxId>] [--messageId <messageId>] [--fullSync]",
	);
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
await processEvent(event, log);
