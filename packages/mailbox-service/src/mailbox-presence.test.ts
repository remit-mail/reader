import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailboxSyncStatus } from "@remit/domain-enums";
import {
	isFolderMutationInFlight,
	isMailboxMutationInFlight,
} from "./mailbox-presence.js";
import {
	openStore,
	seedAccount,
	seedMailbox,
} from "./test-helpers/test-store.js";

describe("isFolderMutationInFlight", () => {
	for (const [syncStatus, inFlight] of [
		[MailboxSyncStatus.synced, false],
		[MailboxSyncStatus.pending, true],
		[MailboxSyncStatus.deleting, true],
		[MailboxSyncStatus.failed, false],
	] as const) {
		it(`${syncStatus} is ${inFlight ? "" : "not "}a mutation in flight`, () => {
			assert.equal(isFolderMutationInFlight({ syncStatus }), inFlight);
		});
	}

	it("does not read failed as a folder to leave alone", () => {
		// `failed` means the folder exists at `fullPath` and the last rename or
		// delete intent did not land — so it holds the user's mail and syncing it
		// is right. D7 upholds that by leaving no row at all for a create the
		// server refused. Reading it as in-flight would stop syncing a live folder
		// permanently and silently.
		assert.equal(
			isFolderMutationInFlight({ syncStatus: MailboxSyncStatus.failed }),
			false,
		);
	});
});

describe("isMailboxMutationInFlight", () => {
	it("reads the stored row, and treats an absent one as in flight", async () => {
		const store = await openStore();
		const account = await seedAccount(store);
		const deleting = await seedMailbox(store, account, "Receipts", {
			overrides: { syncStatus: MailboxSyncStatus.deleting },
		});
		const settled = await seedMailbox(store, account, "Work");

		assert.equal(
			await isMailboxMutationInFlight(
				store.mailbox,
				account.accountId,
				deleting.mailboxId,
			),
			true,
		);
		assert.equal(
			await isMailboxMutationInFlight(
				store.mailbox,
				account.accountId,
				settled.mailboxId,
			),
			false,
		);
		assert.equal(
			await isMailboxMutationInFlight(
				store.mailbox,
				account.accountId,
				"mbx-gone",
			),
			true,
		);
		await store.close();
	});
});
