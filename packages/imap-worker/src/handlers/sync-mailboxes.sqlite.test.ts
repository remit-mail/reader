import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SyncPhase } from "@remit/domain-enums";
import type { SyncMailboxesEvent } from "../events.js";
import { openStore } from "../test-helpers/test-world.js";
import { syncMailboxes } from "./sync-mailboxes.js";

const discoveryEvent = (accountId: string): SyncMailboxesEvent => ({
	type: "SYNC_MAILBOXES",
	eventId: "mailbox-discovery",
	timestamp: 1_700_000_000_000,
	accountId,
	explicitRequest: true,
});

describe("mailbox discovery round identity", () => {
	it("records the event timestamp with the discovering phase", async (t) => {
		const store = await openStore();
		t.after(store.close);
		const world = await store.world();
		world.imap.addFolder("INBOX");
		const { accountId } = world.account;
		const event = discoveryEvent(accountId);
		const update = t.mock.method(world.client.account, "update");

		await syncMailboxes(event, world.ctx());

		assert.deepEqual(
			update.mock.calls.find(
				(call) =>
					call.arguments[1].syncPhase === SyncPhase.discovering_mailboxes,
			)?.arguments,
			[
				accountId,
				{
					syncPhase: SyncPhase.discovering_mailboxes,
					syncRequestedAt: event.timestamp,
				},
			],
		);
		assert.equal(
			(await world.client.account.get(accountId)).syncRequestedAt,
			event.timestamp,
		);
	});

	it("records the event timestamp when discovery fails before the discovering phase", async (t) => {
		const store = await openStore();
		t.after(store.close);
		const world = await store.world();
		const { accountId } = world.account;
		const event = discoveryEvent(accountId);
		const error = new Error("Connection unavailable");
		const pool = world.connectVia(() => ({
			getConnection: async () => {
				throw error;
			},
			disconnect: async () => {},
		}));

		await assert.rejects(syncMailboxes(event, world.ctx({ pool })), error);

		const stored = await world.client.account.get(accountId);
		assert.equal(stored.syncPhase, SyncPhase.error);
		assert.equal(stored.syncRequestedAt, event.timestamp);
	});
});
