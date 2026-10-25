import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createEmitEvent } from "../emit.js";
import type { SyncMessagesEvent } from "../events.js";
import { openStore, type World } from "../test-helpers/test-world.js";
import { drainPendingFlagPushes, syncMessages } from "./sync-messages.js";

let store: Awaited<ReturnType<typeof openStore>>;

before(async () => {
	store = await openStore();
});

after(() => store.close());

const syncEvent = (w: World, mailboxId: string): SyncMessagesEvent => ({
	type: "SYNC_MESSAGES",
	accountId: w.account.accountId,
	mailboxId,
	eventId: `evt-${mailboxId}`,
	timestamp: Date.now(),
});

const sync = async (w: World, mailboxId: string): Promise<number> => {
	await syncMessages(
		syncEvent(w, mailboxId),
		w.log,
		w.queues,
		w.connectionFactory,
	);
	return w.imap.connections;
};

describe("which SYNC_MESSAGES events reach the server", () => {
	it("a live mailbox does", async () => {
		const w = await store.world();
		const inbox = await w.folder("INBOX");

		assert.equal(await sync(w, inbox.mailboxId), 1);
	});

	// Issue #287: a NotFoundError at the head of the account's FIFO group
	// stalled every later event for the account.
	it("a mailbox whose row is gone is acked without connecting", async () => {
		const w = await store.world();
		const old = await w.folder("Old");
		await w.client.mailbox.delete(w.account.accountId, old.mailboxId);

		assert.equal(await sync(w, old.mailboxId), 0);
	});

	it("a mailbox being deleted is acked without connecting", async () => {
		const w = await store.world();
		const old = await w.folder("Old");
		await w.client.mailboxQueue.deleteMailbox(
			old.mailboxId,
			w.account.accountId,
		);

		assert.equal(await sync(w, old.mailboxId), 0);
	});

	it("a mailbox not yet created on the server is acked without connecting", async () => {
		const w = await store.world();
		const created = await w.client.mailboxQueue.createMailbox(
			{
				accountId: w.account.accountId,
				namespacePrefix: "",
				hierarchyDelimiter: "/",
				fullPath: "Receipts",
				uidValidity: 0,
				uidNext: 0,
				highestModseq: "0",
				messageCount: 0,
				unseenCount: 0,
				deletedCount: 0,
				totalSize: 0,
				lastSyncUid: 0,
				highWaterMarkUid: 0,
				lastMessageSyncAt: 0,
			},
			w.account.accountId,
		);
		if (created.outcome !== "Created") throw new Error("path taken");

		assert.equal(await sync(w, created.mailbox.mailboxId), 0);
	});
});

// Issue #339: a delete asked for while the round is in flight lands inside
// the guard, and the round then fails deeper on a folder that is gone.
describe("a folder deleted while its sync is in flight", () => {
	it("resolves the event and records no error phase on the account", async () => {
		const w = await store.world();
		const old = await w.folder("Old");
		const connectionFactory = () => {
			const factory = w.connectionFactory();
			const connection = factory.getConnection();
			const openBox = connection.openBox;
			let first = true;
			connection.openBox = async (path, readOnly) => {
				if (first) {
					first = false;
					await w.client.mailboxQueue.deleteMailbox(
						old.mailboxId,
						w.account.accountId,
					);
					w.imap.removeFolder("Old");
				}
				return openBox(path, readOnly);
			};
			return { getConnection: () => connection, close: factory.close };
		};

		await syncMessages(
			syncEvent(w, old.mailboxId),
			w.log,
			w.queues,
			connectionFactory,
		);

		const account = await w.client.account.get(w.account.accountId);
		assert.notEqual(account.syncPhase, "error");
	});
});

describe("drainPendingFlagPushes (issue #1273)", () => {
	const marker = (w: World, mailboxId: string, messageId: string) =>
		w.client.flagPush.put({
			messageId,
			flagName: "\\Seen",
			accountId: w.account.accountId,
			accountConfigId: w.account.accountConfigId,
			mailboxId,
			operation: "add",
		});

	it("re-arms the markers stuck before their wake-up and leaves the ones a driver owns", async () => {
		const w = await store.world();
		const inbox = await w.folder("INBOX");
		await marker(w, inbox.mailboxId, "msg-pending");
		await marker(w, inbox.mailboxId, "msg-queued");
		await w.client.flagPush.updateState("msg-queued", "\\Seen", "queued");
		await marker(w, inbox.mailboxId, "msg-processing");
		await w.client.flagPush.updateState(
			"msg-processing",
			"\\Seen",
			"processing",
		);

		await drainPendingFlagPushes(
			w.client.flagPush,
			w.account,
			inbox.mailboxId,
			w.log,
			createEmitEvent(w.queues),
		);

		assert.deepEqual(
			w
				.queued()
				.filter((body) => body.type === "FLAG_PUSH")
				.map((body) => body.messageId),
			["msg-pending"],
		);
	});

	it("keeps re-arming the others when one re-arm fails, and says so loudly", async () => {
		const w = await store.world();
		const inbox = await w.folder("INBOX");
		await marker(w, inbox.mailboxId, "will-fail");
		await marker(w, inbox.mailboxId, "will-succeed");
		const armed: string[] = [];

		await drainPendingFlagPushes(
			w.client.flagPush,
			w.account,
			inbox.mailboxId,
			w.log,
			async (event) => {
				const { messageId } = event as unknown as { messageId: string };
				if (messageId === "will-fail") throw new Error("queue down");
				armed.push(messageId);
			},
		);

		assert.deepEqual(armed, ["will-succeed"]);
		assert.equal(
			w.logs.filter(
				(line) => line.fields.alert === "flag_push_drain_rearm_failed",
			).length,
			1,
		);
	});
});
