import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailboxSyncStatus } from "@remit/domain-enums";
import type { RemitClient } from "./data-client.js";
import { updateFilter } from "./filters.js";
import { renameMailbox } from "./folders.js";

const USER = { accountConfigId: "cfg-1", userId: "sub-1" };

const ownedAccount = {
	get: async () => ({ accountId: "acc-1", accountConfigId: "cfg-1" }),
};

describe("folder and filter services answer a refusal as a value", () => {
	it("refuses to rename another account's folder, recording nothing", async () => {
		const renames: string[] = [];
		const client = {
			account: ownedAccount,
			mailbox: {
				get: async () => ({ mailboxId: "mbx-9", accountId: "acc-other" }),
			},
			mailboxQueue: {
				renameMailbox: async (mailboxId: string) => {
					renames.push(mailboxId);
				},
			},
		} as unknown as RemitClient;

		const outcome = await renameMailbox(client, USER, {
			accountId: "acc-1",
			mailboxId: "mbx-9",
			patch: { fullPath: "Archive" },
		});

		assert.deepEqual(outcome, {
			ok: false,
			refusal: { kind: "Forbidden", message: "Mailbox mbx-9 not in account" },
		});
		assert.deepEqual(renames, []);
	});

	it("names the unsettled folder a filter update points at, writing nothing", async () => {
		const updates: string[] = [];
		const client = {
			account: ownedAccount,
			mailbox: {
				get: async () => ({
					mailboxId: "mbx-new",
					accountId: "acc-1",
					fullPath: "Receipts",
					syncStatus: MailboxSyncStatus.pending,
				}),
			},
			filter: {
				update: async (_config: string, filterId: string) => {
					updates.push(filterId);
				},
			},
		} as unknown as RemitClient;

		const outcome = await updateFilter(client, USER, {
			accountId: "acc-1",
			filterId: "flt-1",
			patch: { actionMailboxId: "mbx-new" },
		});

		assert.equal(outcome.ok, false);
		assert.deepEqual(!outcome.ok && outcome.refusal, {
			kind: "NotSettled",
			message:
				"“Receipts” isn’t ready yet — the mail server hasn’t confirmed it.",
			mailboxId: "mbx-new",
			syncStatus: MailboxSyncStatus.pending,
		});
		assert.deepEqual(updates, []);
	});
});
