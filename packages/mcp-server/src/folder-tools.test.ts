import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { processMailboxManagement } from "@remit/imap-worker/mailbox-management";
import {
	openStore,
	type World,
} from "@remit/imap-worker/test-helpers/test-world";
import { BodySyncService, SyncWarningService } from "@remit/mailbox-service";
import { silentLog } from "@remit/mailbox-service/test-helpers/test-store";
import type { McpDeps } from "./deps.js";
import { MCP_RULES_SCOPE } from "./folder-tools.js";
import {
	createMcpHandler,
	MCP_READ_SCOPE,
	type McpRequestHandler,
} from "./server.js";

const USER_ID = "folder-user";
const OTHER_USER_ID = "folder-other-user";

type Worker = "settles" | "stalls";
type MailboxEvent = Parameters<typeof processMailboxManagement>[0];

let store: Awaited<ReturnType<typeof openStore>>;
let mine: World;
let deps: McpDeps;
let worker: Worker;
let account: AccountItem;
let inbox: MailboxItem;
let receipts: MailboxItem;
let theirAccount: AccountItem;
let theirFolder: MailboxItem;

const isMailboxEvent = (body: Record<string, unknown>): boolean =>
	String(body.type).startsWith("MAILBOX_");

const mailboxEvents = (): MailboxEvent[] =>
	mine
		.queued()
		.filter(isMailboxEvent)
		.map((body) => body as unknown as MailboxEvent);

const runWorker = (event: MailboxEvent): Promise<void> =>
	processMailboxManagement(event, mine.log, mine.scope);

const drainQueue = async (): Promise<void> => {
	for (const event of mailboxEvents()) await runWorker(event);
};

before(async () => {
	store = await openStore();
});

after(() => store.close());

beforeEach(async () => {
	const theirs = await store.world(deriveAccountConfigId(OTHER_USER_ID));
	theirAccount = theirs.account;
	theirFolder = await theirs.folder("Private");

	mine = await store.world(deriveAccountConfigId(USER_ID));
	account = mine.account;
	inbox = await mine.folder("INBOX");
	receipts = await mine.folder("Receipts");
	await mine.folder("Archive");

	worker = "settles";
	mine.queue.answer(async () => {
		const last = mine.queued().at(-1);
		if (worker === "settles" && last && isMailboxEvent(last)) {
			await runWorker(last as unknown as MailboxEvent);
		}
		return {};
	});

	const { client } = store;
	deps = {
		account: client.account,
		mailbox: client.mailbox,
		message: client.message,
		threadMessage: client.threadMessage,
		storage: client.storage,
		bodySync: new BodySyncService(
			client.message,
			client.storage,
			client.threadMessage,
			client.address,
			client.envelope,
			new SyncWarningService(client.syncWarning),
			silentLog,
		),
		bodySyncQueue: undefined,
		logger: silentLog,
		folders: {
			mailboxQueue: client.mailboxQueue,
			settleTimeoutMs: 100,
			pollIntervalMs: 10,
		},
	};
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
	(await store.client.mailbox.listAllByAccount(account.accountId)).filter(
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
		assert.equal(mailboxEvents().length, 0);
	});

	it("are listed for a token with mail:rules", async () => {
		assert.deepEqual(await toolNames([MCP_RULES_SCOPE]), [
			"create_folder",
			"rename_folder",
		]);
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
		assert.equal(mine.imap.hasFolder("Projects/Acme"), true);
		assert.deepEqual(
			mailboxEvents().map((event) => event.type),
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
		assert.equal(mailboxEvents().length, 0);
		assert.deepEqual(
			(await store.client.mailbox.listAllByAccount(theirAccount.accountId)).map(
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

		assert.equal(mailboxEvents().length, 1);
		assert.equal((await foldersAt("Slow")).length, 1);
		assert.equal(mine.imap.hasFolder("Slow"), true);
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
		assert.equal(mine.imap.hasFolder("Archive/Receipts"), true);
		assert.equal(mine.imap.hasFolder("Receipts"), false);
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
		assert.equal(mailboxEvents().length, 0);
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
		assert.equal(mailboxEvents().length, 0);
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
		assert.equal(mailboxEvents().length, 1);
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
		assert.equal(mailboxEvents().length, 0);
		const untouched = await store.client.mailbox.get(
			theirAccount.accountId,
			theirFolder.mailboxId,
		);
		assert.equal(untouched.fullPath, "Private");
		assert.equal(untouched.syncStatus, theirFolder.syncStatus);
	});

	it("refuses another account's folder named under the caller's own account", async () => {
		assert.equal(
			await refusalOf("rename_folder", {
				accountId: account.accountId,
				mailboxId: theirFolder.mailboxId,
				fullPath: "Taken",
			}),
			`Mailbox ${theirFolder.mailboxId} not in account. Use an accountId and mailboxId from list_mailboxes.`,
		);
		assert.equal(mailboxEvents().length, 0);
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
		assert.equal(mailboxEvents().length, 1);

		await drainQueue();
		const settled = await callToolJson("rename_folder", args);
		assert.equal(settled.fullPath, "Bills");
		assert.equal(settled.syncStatus, MailboxSyncStatus.synced);
		assert.equal(mailboxEvents().length, 1);
		assert.equal(mine.imap.hasFolder("Bills"), true);
	});
});
