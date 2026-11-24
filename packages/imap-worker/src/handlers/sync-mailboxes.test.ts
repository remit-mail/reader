import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SyncPhase } from "@remit/domain-enums";
import { resolveMailboxFreshnessMs } from "../config-env.js";
import { DEFAULT_MAILBOX_FRESHNESS_MS } from "../context.js";
import { openStore } from "../test-helpers/test-world.js";
import {
	emitSyncMessagesEvents,
	splitInboxFirst,
	syncMailboxes,
} from "./sync-mailboxes.js";

it("advances lastSyncAt when mailbox discovery records an error", async (t) => {
	const store = await openStore();
	t.after(store.close);
	const world = await store.world();
	const { accountId } = world.account;
	const lastSyncAt = 1_700_000_000_000;
	await world.client.account.update(accountId, { lastSyncAt });

	const failure = new Error("IMAP LIST failed");
	const connection = world.imap.connection();
	connection.listMailboxes = async () => {
		throw failure;
	};

	await assert.rejects(
		syncMailboxes(
			{
				type: "SYNC_MAILBOXES",
				accountId,
				eventId: "failed-discovery",
				timestamp: Date.now(),
				explicitRequest: true,
			},
			world.ctx({
				pool: world.connectVia(() => ({
					...world.scope(),
					getConnection: async () => connection,
				})),
			}),
		),
		failure,
	);

	const account = await world.client.account.get(accountId);
	assert.equal(account.syncPhase, SyncPhase.error);
	assert.equal(account.lastError, failure.message);
	assert.ok(account.lastSyncAt > lastSyncAt);
});

describe("resolveMailboxFreshnessMs", () => {
	it("defaults to the production window when unset", () => {
		assert.equal(resolveMailboxFreshnessMs({}), DEFAULT_MAILBOX_FRESHNESS_MS);
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
