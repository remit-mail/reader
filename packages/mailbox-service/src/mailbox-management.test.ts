import assert from "node:assert";
import { describe, it } from "node:test";
import type { IMailboxRepository } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import {
	MailboxManagementService,
	parseMailboxPath,
	validateMailboxOperation,
	validateMailboxPath,
} from "./mailbox-management.js";
import type {
	FlatMailboxInfo,
	IImapConnection,
	ImapBoxStatus,
} from "./types.js";

describe("parseMailboxPath", () => {
	it("parses simple path", () => {
		const result = parseMailboxPath("INBOX");
		assert.strictEqual(result.name, "INBOX");
		assert.strictEqual(result.parent, null);
		assert.strictEqual(result.depth, 1);
	});

	it("parses nested path with default delimiter", () => {
		const result = parseMailboxPath("Work/Projects/ClientA");
		assert.strictEqual(result.name, "ClientA");
		assert.strictEqual(result.parent, "Work/Projects");
		assert.strictEqual(result.depth, 3);
	});

	it("parses nested path with custom delimiter", () => {
		const result = parseMailboxPath("Work.Projects.ClientA", ".");
		assert.strictEqual(result.name, "ClientA");
		assert.strictEqual(result.parent, "Work.Projects");
		assert.strictEqual(result.depth, 3);
	});

	it("handles two-level path", () => {
		const result = parseMailboxPath("Personal/Archive");
		assert.strictEqual(result.name, "Archive");
		assert.strictEqual(result.parent, "Personal");
		assert.strictEqual(result.depth, 2);
	});
});

describe("validateMailboxPath", () => {
	it("throws on empty path", () => {
		assert.throws(() => validateMailboxPath(""), {
			message: "Mailbox path cannot be empty",
		});
	});

	it("throws on whitespace-only path", () => {
		assert.throws(() => validateMailboxPath("   "), {
			message: "Mailbox path cannot be empty",
		});
	});

	it("throws on double delimiters", () => {
		assert.throws(() => validateMailboxPath("Work//Projects"), {
			message: "Mailbox path cannot contain empty hierarchy levels",
		});
	});

	it("throws on leading delimiter", () => {
		assert.throws(() => validateMailboxPath("/Work/Projects"), {
			message: "Mailbox path cannot start or end with hierarchy delimiter",
		});
	});

	it("throws on trailing delimiter", () => {
		assert.throws(() => validateMailboxPath("Work/Projects/"), {
			message: "Mailbox path cannot start or end with hierarchy delimiter",
		});
	});

	it("accepts valid simple path", () => {
		assert.doesNotThrow(() => validateMailboxPath("INBOX"));
	});

	it("accepts valid nested path", () => {
		assert.doesNotThrow(() => validateMailboxPath("Work/Projects/ClientA"));
	});
});

const boxStatus = (path: string): ImapBoxStatus => ({
	name: path,
	readOnly: true,
	uidvalidity: 42,
	uidnext: 7,
	flags: [],
	permFlags: [],
	persistentUIDs: true,
	messages: { total: 0, new: 0 },
	newKeywords: false,
});

const recordingRepo = () => {
	const updates: Array<{ mailboxId: string; patch: Record<string, unknown> }> =
		[];
	const repo = {
		update: async (
			_accountId: string,
			mailboxId: string,
			patch: Record<string, unknown>,
		) => {
			updates.push({ mailboxId, patch });
			return {} as never;
		},
	} as unknown as IMailboxRepository;
	return { repo, updates };
};

const stubConnection = (
	createdPath: string,
	listed: string[],
): { connection: IImapConnection; opened: string[] } => {
	const opened: string[] = [];
	const connection = {
		createMailbox: async (_path: string) => ({
			path: createdPath,
			created: true,
		}),
		subscribeMailbox: async () => undefined,
		listMailboxes: async (): Promise<FlatMailboxInfo[]> =>
			listed.map((fullPath) => ({
				fullPath,
				name: fullPath.split("/").pop() ?? fullPath,
				delimiter: "/",
				attributes: [],
				parentPath: null,
			})),
		openBox: async (path: string) => {
			opened.push(path);
			return boxStatus(path);
		},
		closeBox: async () => undefined,
	} as unknown as IImapConnection;
	return { connection, opened };
};

describe("MailboxManagementService.syncCreate — server path normalization", () => {
	it("adopts the server-materialized path as the row's identity when it is prefixed", async () => {
		const { repo, updates } = recordingRepo();
		const { connection, opened } = stubConnection("INBOX/Notifications", [
			"INBOX/Notifications",
		]);
		const service = new MailboxManagementService(repo);

		const result = await service.syncCreate(
			"acc-1",
			"mbx-1",
			"Notifications",
			async () => connection,
		);

		assert.strictEqual(result.success, true);
		// The mailbox is opened at the server's path, not the requested leaf.
		assert.deepStrictEqual(opened, ["INBOX/Notifications"]);
		assert.strictEqual(updates.length, 1);
		// The row keeps its id and takes on the prefixed path, so the next reconcile
		// updates it in place instead of insert+delete — every reference survives.
		assert.strictEqual(updates[0].mailboxId, "mbx-1");
		assert.strictEqual(updates[0].patch.fullPath, "INBOX/Notifications");
		assert.strictEqual(updates[0].patch.syncStatus, MailboxSyncStatus.synced);
	});

	it("leaves the path untouched when the server keeps it as requested", async () => {
		const { repo, updates } = recordingRepo();
		const { connection } = stubConnection("Work", ["Work"]);
		const service = new MailboxManagementService(repo);

		await service.syncCreate("acc-1", "mbx-2", "Work", async () => connection);

		assert.strictEqual(updates.length, 1);
		assert.ok(!("fullPath" in updates[0].patch));
		assert.strictEqual(updates[0].patch.syncStatus, MailboxSyncStatus.synced);
	});

	it("still adopts the server path when the fresh list cannot resolve it", async () => {
		const { repo, updates } = recordingRepo();
		const { connection, opened } = stubConnection("INBOX/Notifications", []);
		const service = new MailboxManagementService(repo);

		await service.syncCreate(
			"acc-1",
			"mbx-3",
			"Notifications",
			async () => connection,
		);

		assert.deepStrictEqual(opened, []);
		assert.strictEqual(updates.length, 1);
		assert.strictEqual(updates[0].patch.fullPath, "INBOX/Notifications");
		assert.strictEqual(updates[0].patch.syncStatus, MailboxSyncStatus.synced);
	});
});

describe("validateMailboxOperation", () => {
	it("throws when deleting INBOX", () => {
		assert.throws(() => validateMailboxOperation("delete", "INBOX"), {
			message: "Cannot delete INBOX",
		});
	});

	it("throws when deleting INBOX (case insensitive)", () => {
		assert.throws(() => validateMailboxOperation("delete", "inbox"), {
			message: "Cannot delete INBOX",
		});
	});

	it("allows deleting other mailboxes", () => {
		assert.doesNotThrow(() => validateMailboxOperation("delete", "Archive"));
	});

	it("allows renaming INBOX", () => {
		assert.doesNotThrow(() => validateMailboxOperation("rename", "INBOX"));
	});

	it("allows renaming other mailboxes", () => {
		assert.doesNotThrow(() => validateMailboxOperation("rename", "Archive"));
	});
});
