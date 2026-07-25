import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { excludeDeletingMailboxes } from "./mailbox.js";

const mailbox = (
	over: Partial<MailboxItem> & { mailboxId: string },
): MailboxItem =>
	({ fullPath: over.mailboxId, ...over }) as unknown as MailboxItem;

describe("excludeDeletingMailboxes", () => {
	it("drops a folder being deleted so it leaves the list before the worker reaps it", () => {
		const items = [
			mailbox({ mailboxId: "inbox", syncStatus: MailboxSyncStatus.synced }),
			mailbox({ mailboxId: "gone", syncStatus: MailboxSyncStatus.deleting }),
			mailbox({ mailboxId: "new", syncStatus: MailboxSyncStatus.pending }),
		];
		assert.deepEqual(
			excludeDeletingMailboxes(items).map((m) => m.mailboxId),
			["inbox", "new"],
		);
	});

	it("keeps a folder whose delete failed and was restored off `deleting`", () => {
		const items = [
			mailbox({ mailboxId: "restored", syncStatus: MailboxSyncStatus.failed }),
		];
		assert.deepEqual(
			excludeDeletingMailboxes(items).map((m) => m.mailboxId),
			["restored"],
		);
	});
});
