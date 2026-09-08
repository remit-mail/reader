import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { applyMailboxPatch, type MailboxPatchClient } from "./mailbox.js";

const ACCOUNT_ID = "acc-1";
const CONFIG_ID = "cfg-1";

const mailbox = (over: Partial<MailboxItem> = {}): MailboxItem =>
	({
		mailboxId: "mbx-1",
		accountId: ACCOUNT_ID,
		fullPath: "Work",
		hierarchyDelimiter: "/",
		syncStatus: MailboxSyncStatus.synced,
		...over,
	}) as MailboxItem;

const clientOver = (
	row: MailboxItem,
	others: MailboxItem[] = [],
): {
	client: MailboxPatchClient;
	renames: { mailboxId: string; newPath: string }[];
	dismissals: string[];
	settings: string[];
} => {
	const renames: { mailboxId: string; newPath: string }[] = [];
	const dismissals: string[] = [];
	const settings: string[] = [];
	const client: MailboxPatchClient = {
		mailbox: {
			get: async () => row,
			listAllByAccount: async () => [row, ...others],
		},
		mailboxQueue: {
			renameMailbox: async (mailboxId, newPath) => {
				renames.push({ mailboxId, newPath });
				return mailbox({ pendingPath: newPath });
			},
			dismissMailboxIntent: async (mailboxId) => {
				dismissals.push(mailboxId);
				return mailbox();
			},
		},
		accountSetting: {
			get: async () => null,
			upsert: async (item) => {
				settings.push(item.name);
				return item as never;
			},
			delete: async (_configId, name) => {
				settings.push(name);
			},
		},
	};
	return { client, renames, dismissals, settings };
};

const patch = (
	client: MailboxPatchClient,
	body: Record<string, unknown>,
): Promise<MailboxItem> =>
	applyMailboxPatch(client, CONFIG_ID, "mbx-1", ACCOUNT_ID, body);

const refusedWith = (message: string) => (error: unknown) =>
	(error as { statusCode?: number }).statusCode === 400 &&
	(error as Error).message === message;

describe("applyMailboxPatch — renames that can never succeed (D4, D5)", () => {
	it("refuses to rename the inbox", async () => {
		const { client, renames } = clientOver(mailbox({ fullPath: "INBOX" }));

		await assert.rejects(
			patch(client, { fullPath: "Postvak" }),
			refusedWith("The inbox can't be renamed."),
		);
		assert.equal(renames.length, 0);
	});

	it("refuses a target that canonicalizes to the inbox", async () => {
		const { client, renames } = clientOver(mailbox());

		await assert.rejects(
			patch(client, { fullPath: "inbox" }),
			refusedWith("“INBOX” is reserved for the inbox."),
		);
		assert.equal(renames.length, 0);
	});

	it("refuses an empty target", async () => {
		const { client, renames } = clientOver(mailbox());

		await assert.rejects(
			patch(client, { fullPath: "   " }),
			refusedWith("A folder needs a name."),
		);
		assert.equal(renames.length, 0);
	});

	it("refuses a target another folder already holds", async () => {
		const { client, renames } = clientOver(mailbox(), [
			mailbox({ mailboxId: "mbx-2", fullPath: "Projects" }),
		]);

		await assert.rejects(
			patch(client, { fullPath: "Projects" }),
			refusedWith("A folder named “Projects” is already there."),
		);
		assert.equal(renames.length, 0);
	});

	/**
	 * The sweep reads a folder whose leaf name is a role's conventional name but
	 * which lacks the server's flag as a duplicate, and deletes its row — under
	 * D8, with the folder's mail — as soon as another folder holds the flag. A
	 * rename to one of those settles `synced` and is then reaped.
	 */
	for (const [name, leaf] of [
		["Archive", "Archive"],
		["Trash", "Trash"],
		["Drafts", "Drafts"],
		["Sent", "Sent"],
		["Junk", "Spam"],
	] as const) {
		it(`refuses a rename to the reserved ${name} name`, async () => {
			const { client, renames } = clientOver(mailbox());

			await assert.rejects(
				patch(client, { fullPath: `Work/${leaf}` }),
				refusedWith(
					`“${leaf}” is reserved for a system folder. Pick another name.`,
				),
			);
			assert.equal(renames.length, 0);
		});
	}

	it("refuses a target another rename is already on its way to", async () => {
		// A path a rename is aiming at is as taken as one a folder sits at (D2).
		// Two renames onto one target both settle, both write it, and the sweep
		// then reaps one row — with its mail — and inserts a duplicate.
		const { client, renames } = clientOver(mailbox(), [
			mailbox({
				mailboxId: "mbx-2",
				fullPath: "Admin",
				syncStatus: MailboxSyncStatus.pending,
				pendingPath: "Projects",
			}),
		]);

		await assert.rejects(
			patch(client, { fullPath: "Projects" }),
			refusedWith("“Admin” is already being renamed to “Projects”."),
		);
		assert.equal(renames.length, 0);
	});

	it("lets a retry aim at the target its own failed rename recorded", async () => {
		const { client, renames } = clientOver(
			mailbox({
				syncStatus: MailboxSyncStatus.failed,
				pendingPath: "Projects",
			}),
		);

		await patch(client, { fullPath: "Projects" });

		assert.deepEqual(renames, [{ mailboxId: "mbx-1", newPath: "Projects" }]);
	});

	it("records the intent for an ordinary target", async () => {
		const { client, renames } = clientOver(mailbox());

		const renamed = await patch(client, { fullPath: "Projects" });

		assert.deepEqual(renames, [{ mailboxId: "mbx-1", newPath: "Projects" }]);
		assert.equal(renamed.pendingPath, "Projects");
	});
});

describe("applyMailboxPatch — dismissing a failed intent (T10, T11)", () => {
	it("reads a target equal to the confirmed path as a dismissal, not a rename", async () => {
		const { client, renames, dismissals } = clientOver(
			mailbox({
				syncStatus: MailboxSyncStatus.failed,
				pendingPath: "Projects",
			}),
		);

		const dismissed = await patch(client, { fullPath: "Work" });

		assert.deepEqual(dismissals, ["mbx-1"]);
		assert.equal(renames.length, 0, "nothing is enqueued for a dismissal");
		assert.equal(dismissed.syncStatus, MailboxSyncStatus.synced);
	});

	it("dismisses even where the folder's own name is reserved", async () => {
		// The refusals gate a rename's target. Keeping the name a folder already
		// has is not one, and a folder called `Archive` must still be able to
		// dismiss a rename that failed.
		const { client, dismissals } = clientOver(
			mailbox({ fullPath: "Archive", syncStatus: MailboxSyncStatus.failed }),
		);

		await patch(client, { fullPath: "Archive" });

		assert.deepEqual(dismissals, ["mbx-1"]);
	});
});

describe("applyMailboxPatch — an override-only PATCH", () => {
	it("touches no mutation state", async () => {
		const { client, renames, dismissals, settings } = clientOver(mailbox());

		await patch(client, { muted: true });

		assert.equal(renames.length, 0);
		assert.equal(dismissals.length, 0);
		assert.equal(
			settings.length > 0,
			true,
			"the override row is still written",
		);
	});
});
