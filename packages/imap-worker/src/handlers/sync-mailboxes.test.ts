import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_MAILBOX_FRESHNESS_MS,
	emitSyncMessagesEvents,
	MAILBOX_FRESHNESS_MS,
	mailboxNeedsSync,
	resolveMailboxFreshnessMs,
	splitInboxFirst,
} from "./sync-mailboxes.js";

const NOW = 1_700_000_000_000;

const askedForByName = { explicitRequest: true } as const;
const sideEffect = {} as const;

describe("mailboxNeedsSync", () => {
	// Issue #37: the gate this replaces applied to every trigger, so a refresh
	// that landed just after a side-effect sync did nothing at all. A sync
	// asked for by name (POST /sync) is never gated, however recently one ran.
	it("syncs a mailbox synced a moment ago when the sync was asked for by name", () => {
		const mailbox = { lastMessageSyncAt: NOW - 1_000 };

		assert.equal(mailboxNeedsSync(mailbox, askedForByName, NOW), true);
	});

	// Without this, `GET /config` — which fires a trigger per account on every
	// call — re-enumerates every folder an account owns on every page load.
	it("skips a freshly-synced mailbox for a side-effect trigger", () => {
		const mailbox = { lastMessageSyncAt: NOW - 1_000 };

		assert.equal(mailboxNeedsSync(mailbox, sideEffect, NOW), false);
	});

	it("syncs a stale mailbox for a side-effect trigger", () => {
		const mailbox = { lastMessageSyncAt: NOW - MAILBOX_FRESHNESS_MS - 1 };

		assert.equal(mailboxNeedsSync(mailbox, sideEffect, NOW), true);
	});

	it("syncs exactly at the freshness threshold", () => {
		const mailbox = { lastMessageSyncAt: NOW - MAILBOX_FRESHNESS_MS };

		assert.equal(mailboxNeedsSync(mailbox, sideEffect, NOW), true);
	});

	it("always syncs a mailbox that has never synced", () => {
		assert.equal(mailboxNeedsSync({}, sideEffect, NOW), true);
		assert.equal(
			mailboxNeedsSync({ lastMessageSyncAt: 0 }, sideEffect, NOW),
			true,
		);
	});
});

describe("resolveMailboxFreshnessMs", () => {
	it("defaults to the production window when unset", () => {
		assert.equal(resolveMailboxFreshnessMs({}), DEFAULT_MAILBOX_FRESHNESS_MS);
		assert.equal(DEFAULT_MAILBOX_FRESHNESS_MS, 60_000);
	});

	it("honors a valid override", () => {
		assert.equal(resolveMailboxFreshnessMs({ MAILBOX_FRESHNESS_MS: "0" }), 0);
		assert.equal(
			resolveMailboxFreshnessMs({ MAILBOX_FRESHNESS_MS: "1000" }),
			1000,
		);
	});

	it("falls back to the default for a non-numeric or negative value", () => {
		assert.equal(
			resolveMailboxFreshnessMs({ MAILBOX_FRESHNESS_MS: "" }),
			DEFAULT_MAILBOX_FRESHNESS_MS,
		);
		assert.equal(
			resolveMailboxFreshnessMs({ MAILBOX_FRESHNESS_MS: "abc" }),
			DEFAULT_MAILBOX_FRESHNESS_MS,
		);
		assert.equal(
			resolveMailboxFreshnessMs({ MAILBOX_FRESHNESS_MS: "-5" }),
			DEFAULT_MAILBOX_FRESHNESS_MS,
		);
		assert.equal(
			resolveMailboxFreshnessMs({ MAILBOX_FRESHNESS_MS: "1.5" }),
			DEFAULT_MAILBOX_FRESHNESS_MS,
		);
	});
});

describe("splitInboxFirst", () => {
	it("pulls INBOX out of the list whatever case it is spelled in", () => {
		const { inbox, rest } = splitInboxFirst([
			{ mailboxId: "mb-sent", fullPath: "Sent" },
			{ mailboxId: "mb-inbox", fullPath: "Inbox" },
			{ mailboxId: "mb-junk", fullPath: "Junk" },
		]);

		assert.equal(inbox?.mailboxId, "mb-inbox");
		assert.deepEqual(
			rest.map((mailbox) => mailbox.mailboxId),
			["mb-sent", "mb-junk"],
		);
	});

	it("leaves an account without an INBOX intact", () => {
		const { inbox, rest } = splitInboxFirst([
			{ mailboxId: "mb-sent", fullPath: "Sent" },
		]);

		assert.equal(inbox, undefined);
		assert.deepEqual(
			rest.map((mailbox) => mailbox.mailboxId),
			["mb-sent"],
		);
	});
});

describe("emitSyncMessagesEvents", () => {
	// Every event of an account shares one FIFO group, so arrival order is
	// service order. pMap only bounds concurrency: it used to race all the
	// emits, letting INBOX queue behind up to nineteen other folders while a
	// person waited for their new mail.
	it("emits INBOX before any other folder", async () => {
		const emitted: string[] = [];
		const mailboxes = Array.from({ length: 25 }, (_, index) => ({
			mailboxId: `mb-${index}`,
			fullPath: `Folder ${index}`,
		}));
		mailboxes.push({ mailboxId: "mb-inbox", fullPath: "INBOX" });

		await emitSyncMessagesEvents("acc-1", mailboxes, async (event) => {
			emitted.push(event.mailboxId);
		});

		assert.equal(emitted[0], "mb-inbox");
		assert.equal(emitted.length, 26);
	});

	// Emitting INBOX and awaiting it is the whole fix: a fire-and-forget emit
	// would leave it racing the fan-out again.
	it("waits for the INBOX emit to resolve before emitting the rest", async () => {
		const emitted: string[] = [];
		let releaseInbox: () => void = () => {};
		const inboxEmitted = new Promise<void>((resolve) => {
			releaseInbox = resolve;
		});

		const done = emitSyncMessagesEvents(
			"acc-1",
			[
				{ mailboxId: "mb-inbox", fullPath: "INBOX" },
				{ mailboxId: "mb-sent", fullPath: "Sent" },
			],
			async (event) => {
				emitted.push(event.mailboxId);
				if (event.mailboxId === "mb-inbox") await inboxEmitted;
			},
		);

		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(emitted, ["mb-inbox"]);

		releaseInbox();
		await done;
		assert.deepEqual(emitted, ["mb-inbox", "mb-sent"]);
	});

	it("emits every folder for an account with no INBOX", async () => {
		const emitted: string[] = [];

		await emitSyncMessagesEvents(
			"acc-1",
			[
				{ mailboxId: "mb-sent", fullPath: "Sent" },
				{ mailboxId: "mb-junk", fullPath: "Junk" },
			],
			async (event) => {
				emitted.push(event.mailboxId);
			},
		);

		assert.deepEqual(emitted.sort(), ["mb-junk", "mb-sent"]);
	});
});
