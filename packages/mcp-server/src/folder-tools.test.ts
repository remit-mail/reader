import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { MailboxSyncStatus } from "@remit/domain-enums";
import {
	BodySyncService,
	MailboxManagementService,
	SyncWarningService,
} from "@remit/mailbox-service";
import { FakeImapServer } from "@remit/mailbox-service/test-helpers/fake-imap";
import {
	captureQueue,
	type QueueCapture,
	type QueuedEvent,
} from "@remit/mailbox-service/test-helpers/test-queue";
import {
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
	silentLog,
} from "@remit/mailbox-service/test-helpers/test-store";
import { MCP_READ_SCOPE, MCP_RULES_SCOPE } from "./auth/scopes.js";
import type { McpDeps } from "./deps.js";
import { createMcpHandler, type McpRequestHandler } from "./server.js";
import { ruleDeps } from "./test-rule-deps.js";

const USER_ID = "folder-user";
const OTHER_USER_ID = "folder-other-user";

type Worker = "settles" | "stalls";

let store: Store;
let capture: QueueCapture;
let imap: FakeImapServer;
let deps: McpDeps;
let worker: Worker;
let account: AccountItem;
let inbox: MailboxItem;
let receipts: MailboxItem;
let theirAccount: AccountItem;
let theirFolder: MailboxItem;

const runWorker = async (event: QueuedEvent["body"]): Promise<void> => {
	const management = new MailboxManagementService(store.mailbox);
	const connect = async () => imap.connection();
	if (event.type === "MAILBOX_CREATE") {
		await management.syncCreate(
			String(event.accountId),
			String(event.mailboxId),
			String(event.path),
			connect,
			event.subscribe === true,
		);
		return;
	}
	if (event.type === "MAILBOX_RENAME") {
		await management.syncRename(
			String(event.accountId),
			String(event.mailboxId),
			String(event.oldPath),
			String(event.newPath),
			connect,
		);
	}
};

const drainQueue = async (): Promise<void> => {
	for (const { body } of capture.sent) await runWorker(body);
};

beforeEach(async () => {
	capture = captureQueue();
	worker = "settles";
	capture.answer(async () => {
		const event = capture.sent.at(-1);
		if (worker === "settles" && event) await runWorker(event.body);
		return {};
	});
	store = await openStore();
	imap = new FakeImapServer();
	const storage = store.storage();
	deps = {
		...store,
		storage,
		bodySync: new BodySyncService(
			store.message,
			storage,
			store.threadMessage,
			store.address,
			store.envelope,
			new SyncWarningService(store.syncWarning),
			silentLog,
		),
		bodySyncQueue: undefined,
		logger: silentLog,
		...ruleDeps(store),
	};
	account = await seedAccount(store, {
		accountConfigId: deriveAccountConfigId(USER_ID),
	});
	inbox = await seedMailbox(store, account, "INBOX");
	receipts = await seedMailbox(store, account, "Receipts");
	await seedMailbox(store, account, "Archive");
	for (const path of ["INBOX", "Receipts", "Archive"]) imap.addFolder(path);

	theirAccount = await seedAccount(store, {
		accountConfigId: deriveAccountConfigId(OTHER_USER_ID),
		username: "them@example.com",
		email: "them@example.com",
	});
	theirFolder = await seedMailbox(store, theirAccount, "Private");
});

afterEach(async () => {
	capture.restore();
	await store.close();
});

type RpcBody = {
	result?: Record<string, unknown>;
	error?: { code: number; message: string };
};

type ToolResult = {
	isError?: boolean;
	content: { type: string; text: string }[];
};

type FolderState = {
	accountId: string;
	mailboxId: string;
	fullPath: string;
	syncStatus: string;
	pendingPath?: string;
	message?: string;
};

const rpc = async (
	handler: McpRequestHandler,
	method: string,
	params?: unknown,
): Promise<RpcBody> => {
	const response = await handler(
		new Request("http://reader.test/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
		}),
	);
	assert.equal(response.status, 200);
	return (await response.json()) as RpcBody;
};

const organizer = (scopes: string[] = [MCP_RULES_SCOPE]) =>
	createMcpHandler({ userId: USER_ID, scopes }, deps);

const callTool = async (
	name: string,
	args: Record<string, unknown>,
): Promise<ToolResult> => {
	const body = await rpc(organizer(), "tools/call", { name, arguments: args });
	assert.equal(body.error, undefined, JSON.stringify(body.error));
	return body.result as unknown as ToolResult;
};

const callToolJson = async (
	name: string,
	args: Record<string, unknown>,
): Promise<FolderState> => {
	const result = await callTool(name, args);
	assert.notEqual(result.isError, true, result.content[0]?.text);
	return JSON.parse(result.content[0].text) as FolderState;
};

const refusalOf = async (
	name: string,
	args: Record<string, unknown>,
): Promise<string> => {
	const result = await callTool(name, args);
	assert.equal(result.isError, true, result.content[0]?.text);
	return result.content[0].text;
};

const toolNames = async (scopes: string[]): Promise<string[]> => {
	const body = await rpc(organizer(scopes), "tools/list");
	return (body.result as { tools: { name: string }[] }).tools
		.map((tool) => tool.name)
		.sort();
};

const foldersAt = async (fullPath: string): Promise<MailboxItem[]> =>
	(await store.mailbox.listAllByAccount(account.accountId)).filter(
		(folder) => folder.fullPath === fullPath,
	);

describe("the folder tools behind mail:rules", () => {
	it("are absent from a token without mail:rules", async () => {
		const names = await toolNames([MCP_READ_SCOPE]);
		assert.equal(names.includes("create_folder"), false);
		assert.equal(names.includes("rename_folder"), false);

		const body = await rpc(organizer([MCP_READ_SCOPE]), "tools/call", {
			name: "create_folder",
			arguments: { accountId: account.accountId, fullPath: "Projects" },
		});
		assert.equal(body.error?.code, -32601);
		assert.equal(capture.sent.length, 0);
	});

	it("are listed for a token with mail:rules", async () => {
		const names = await toolNames([MCP_RULES_SCOPE]);
		assert.equal(names.includes("create_folder"), true);
		assert.equal(names.includes("rename_folder"), true);
	});
});

describe("create_folder", () => {
	it("returns the path the mail server confirmed", async () => {
		const created = await callToolJson("create_folder", {
			accountId: account.accountId,
			fullPath: "Projects/Acme",
		});

		assert.equal(created.fullPath, "Projects/Acme");
		assert.equal(created.syncStatus, MailboxSyncStatus.synced);
		assert.equal(imap.hasFolder("Projects/Acme"), true);
		assert.deepEqual(
			capture.sent.map(({ body }) => body.type),
			["MAILBOX_CREATE"],
		);
	});

	it("refuses an account the caller does not own", async () => {
		assert.match(
			await refusalOf("create_folder", {
				accountId: theirAccount.accountId,
				fullPath: "Planted",
			}),
			/not in account config\. Use an accountId and mailboxId from list_mailboxes\./,
		);
		assert.equal(capture.sent.length, 0);
		assert.deepEqual(
			(await store.mailbox.listAllByAccount(theirAccount.accountId)).map(
				(folder) => folder.fullPath,
			),
			["Private"],
		);
	});

	it("returns the pending state on timeout and resumes on retry without a second folder", async () => {
		worker = "stalls";
		const args = { accountId: account.accountId, fullPath: "Slow" };

		const first = await callToolJson("create_folder", args);
		assert.equal(first.syncStatus, MailboxSyncStatus.pending);
		assert.match(first.message ?? "", /Call create_folder again/);

		const second = await callToolJson("create_folder", args);
		assert.equal(second.mailboxId, first.mailboxId);
		assert.equal(second.syncStatus, MailboxSyncStatus.pending);

		await drainQueue();
		const settled = await callToolJson("create_folder", args);
		assert.equal(settled.mailboxId, first.mailboxId);
		assert.equal(settled.syncStatus, MailboxSyncStatus.synced);

		assert.equal(capture.sent.length, 1);
		assert.equal((await foldersAt("Slow")).length, 1);
		assert.equal(imap.hasFolder("Slow"), true);
	});
});

describe("rename_folder", () => {
	it("moves a folder under another parent and returns the confirmed path", async () => {
		const moved = await callToolJson("rename_folder", {
			accountId: account.accountId,
			mailboxId: receipts.mailboxId,
			fullPath: "Archive/Receipts",
		});

		assert.equal(moved.mailboxId, receipts.mailboxId);
		assert.equal(moved.fullPath, "Archive/Receipts");
		assert.equal(moved.syncStatus, MailboxSyncStatus.synced);
		assert.equal(imap.hasFolder("Archive/Receipts"), true);
		assert.equal(imap.hasFolder("Receipts"), false);
	});

	it("refuses to rename INBOX", async () => {
		assert.match(
			await refusalOf("rename_folder", {
				accountId: account.accountId,
				mailboxId: inbox.mailboxId,
				fullPath: "Old inbox",
			}),
			/The inbox can't be renamed\./,
		);
		assert.equal(capture.sent.length, 0);
	});

	it("refuses a system folder's name", async () => {
		assert.match(
			await refusalOf("rename_folder", {
				accountId: account.accountId,
				mailboxId: receipts.mailboxId,
				fullPath: "Junk",
			}),
			/“Junk” is reserved for a system folder\. Pick another name\./,
		);
		assert.equal(capture.sent.length, 0);
	});

	it("refuses a folder the mail server has not confirmed yet", async () => {
		worker = "stalls";
		const pending = await callToolJson("create_folder", {
			accountId: account.accountId,
			fullPath: "Fresh",
		});

		assert.match(
			await refusalOf("rename_folder", {
				accountId: account.accountId,
				mailboxId: pending.mailboxId,
				fullPath: "Renamed",
			}),
			/isn’t ready yet .* Wait for it to settle, then call this tool again\./,
		);
		assert.equal(capture.sent.length, 1);
	});

	it("refuses a folder the caller does not own", async () => {
		assert.match(
			await refusalOf("rename_folder", {
				accountId: theirAccount.accountId,
				mailboxId: theirFolder.mailboxId,
				fullPath: "Taken",
			}),
			/not in account config\. Use an accountId and mailboxId from list_mailboxes\./,
		);
		assert.equal(capture.sent.length, 0);
		const untouched = await store.mailbox.get(
			theirAccount.accountId,
			theirFolder.mailboxId,
		);
		assert.equal(untouched.fullPath, "Private");
		assert.equal(untouched.syncStatus, theirFolder.syncStatus);
	});

	it("refuses another account's folder named under the caller's own account", async () => {
		const result = await callTool("rename_folder", {
			accountId: account.accountId,
			mailboxId: theirFolder.mailboxId,
			fullPath: "Taken",
		});
		assert.equal(result.isError, true);
		assert.equal(capture.sent.length, 0);
	});

	it("returns the pending state on timeout and resumes on retry without renaming twice", async () => {
		worker = "stalls";
		const args = {
			accountId: account.accountId,
			mailboxId: receipts.mailboxId,
			fullPath: "Bills",
		};

		const first = await callToolJson("rename_folder", args);
		assert.equal(first.syncStatus, MailboxSyncStatus.pending);
		assert.equal(first.fullPath, "Receipts");
		assert.equal(first.pendingPath, "Bills");

		await callToolJson("rename_folder", args);
		assert.equal(capture.sent.length, 1);

		await drainQueue();
		const settled = await callToolJson("rename_folder", args);
		assert.equal(settled.fullPath, "Bills");
		assert.equal(settled.syncStatus, MailboxSyncStatus.synced);
		assert.equal(capture.sent.length, 1);
		assert.equal(imap.hasFolder("Bills"), true);
	});
});
