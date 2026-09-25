import assert from "node:assert";
import { describe, it } from "node:test";
import type { MailboxItem } from "@remit/data-ports";
import type { CreateMailboxQueueInput } from "@remit/mailbox-service";
import { createImportedFolder } from "./imported-folder.js";

const inbox = {
	mailboxId: "mbx-inbox",
	accountId: "acc-1",
	fullPath: "INBOX",
	namespaceType: "personal",
	namespacePrefix: "INBOX.",
	hierarchyDelimiter: ".",
} as MailboxItem;

describe("createImportedFolder (#1103)", () => {
	it("creates the folder through the pending folder-create path, in the INBOX namespace", async () => {
		const calls: [CreateMailboxQueueInput, string, boolean | undefined][] = [];
		const create = createImportedFolder(
			{ findByPath: async () => inbox },
			{
				createMailbox: async (input, accountId, subscribe) => {
					calls.push([input, accountId, subscribe]);
					return {
						outcome: "Created" as const,
						mailbox: {
							...inbox,
							mailboxId: "mbx-new",
							fullPath: input.fullPath,
						},
					};
				},
			},
		);

		const created = await create("acc-1", "INBOX.Facturen");

		assert.equal(
			created.outcome === "Created" && created.mailbox.mailboxId,
			"mbx-new",
		);
		assert.equal(calls.length, 1);
		const [input, accountId, subscribe] = calls[0];
		assert.equal(accountId, "acc-1");
		assert.equal(subscribe, true);
		assert.equal(input.fullPath, "INBOX.Facturen");
		assert.equal(input.namespacePrefix, "INBOX.");
		assert.equal(input.hierarchyDelimiter, ".");
	});

	it("refuses to guess a namespace for an account with no INBOX", async () => {
		const create = createImportedFolder(
			{ findByPath: async () => null },
			{
				createMailbox: async () => {
					throw new Error("must not be called");
				},
			},
		);

		await assert.rejects(create("acc-1", "Facturen"), /no INBOX/);
	});
});
