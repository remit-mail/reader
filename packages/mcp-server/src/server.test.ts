import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { BodySyncService, SyncWarningService } from "@remit/mailbox-service";
import {
	eml,
	FakeImapServer,
} from "@remit/mailbox-service/test-helpers/fake-imap";
import {
	arriveAt,
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
	silentLog,
	storeBody,
} from "@remit/mailbox-service/test-helpers/test-store";
import type { StorageService } from "@remit/storage-service";
import type { McpDeps } from "./deps.js";
import {
	createMcpHandler,
	MCP_READ_SCOPE,
	type McpRequestHandler,
} from "./server.js";

const USER_ID = "mcp-user";
const OTHER_USER_ID = "mcp-other-user";

type Seeded = {
	account: AccountItem;
	inbox: MailboxItem;
	archive: MailboxItem;
	invoiceId: string;
	holidayId: string;
};

let store: Store;
let storage: StorageService;
let deps: McpDeps;
const rearmed: string[] = [];
let mine: Seeded;
let theirs: Seeded;

const deliver = async (
	imap: FakeImapServer,
	account: AccountItem,
	mailbox: MailboxItem,
	headers: Record<string, string>,
	body: string,
): Promise<string> => {
	const raw = eml(headers, body);
	const messageId = await arriveAt(store, imap, account, mailbox, raw);
	await storeBody(store, storage, account, messageId, raw);
	return messageId;
};

const seedUser = async (userId: string, label: string): Promise<Seeded> => {
	const imap = new FakeImapServer();
	const account = await seedAccount(store, {
		accountConfigId: deriveAccountConfigId(userId),
		username: `${label}@example.com`,
		email: `${label}@example.com`,
	});
	const inbox = await seedMailbox(store, account, "INBOX");
	const archive = await seedMailbox(store, account, "Archive", {
		specialUse: "Archive",
	});
	imap.addFolder("INBOX");
	imap.addFolder("Archive");
	const invoiceId = await deliver(
		imap,
		account,
		inbox,
		{
			"Message-ID": `<invoice-${label}@example.com>`,
			From: `Billing <billing@${label}.example>`,
			Subject: `${label} quarterly invoice`,
		},
		`Hello ${label}, your invoice is attached.`,
	);
	const holidayId = await deliver(
		imap,
		account,
		archive,
		{
			"Message-ID": `<holiday-${label}@example.com>`,
			From: `Friend <friend@${label}.example>`,
			Subject: `${label} holiday plans`,
		},
		`See you at the lake, ${label}.`,
	);
	return { account, inbox, archive, invoiceId, holidayId };
};

before(async () => {
	store = await openStore();
	storage = store.storage();
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
		bodySyncQueue: {
			requestBodySync: async ({ messageId }) => {
				rearmed.push(messageId);
			},
		},
		logger: silentLog,
	};
	mine = await seedUser(USER_ID, "mine");
	theirs = await seedUser(OTHER_USER_ID, "theirs");
});

after(async () => {
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

const reader = () =>
	createMcpHandler({ userId: USER_ID, scopes: [MCP_READ_SCOPE] }, deps);

const callTool = async (
	name: string,
	args: Record<string, unknown> = {},
): Promise<ToolResult> => {
	const body = await rpc(reader(), "tools/call", { name, arguments: args });
	assert.equal(body.error, undefined, JSON.stringify(body.error));
	return body.result as unknown as ToolResult;
};

const callToolJson = async <T>(
	name: string,
	args: Record<string, unknown> = {},
): Promise<T> => {
	const result = await callTool(name, args);
	assert.notEqual(result.isError, true, result.content[0]?.text);
	return JSON.parse(result.content[0].text) as T;
};

type ThreadPage = { items: { threadId: string; messageId: string }[] };

const messageIds = (page: ThreadPage): string[] =>
	page.items.map((item) => item.messageId).sort();

describe("the read tools behind mail:read", () => {
	it("lists the read tools for a token with mail:read", async () => {
		const body = await rpc(reader(), "tools/list");
		const tools = (body.result as { tools: { name: string }[] }).tools;
		assert.deepEqual(tools.map((tool) => tool.name).sort(), [
			"get_message",
			"get_thread",
			"list_mailboxes",
			"list_threads",
			"search_threads",
		]);
	});

	it("refuses a read tool to a token without mail:read", async () => {
		const unscoped = createMcpHandler({ userId: USER_ID, scopes: [] }, deps);
		const body = await rpc(unscoped, "tools/call", {
			name: "list_mailboxes",
			arguments: {},
		});
		assert.equal(body.result, undefined);
		assert.equal(body.error?.code, -32601);
		assert.match(body.error?.message ?? "", /method not found/i);
	});
});

describe("list_mailboxes", () => {
	it("lists only the caller's accounts and their folders", async () => {
		const result = await callToolJson<{
			accounts: { accountId: string; mailboxes: { mailboxId: string }[] }[];
		}>("list_mailboxes");
		assert.deepEqual(
			result.accounts.map((account) => account.accountId),
			[mine.account.accountId],
		);
		assert.deepEqual(
			result.accounts[0].mailboxes.map((mailbox) => mailbox.mailboxId).sort(),
			[mine.inbox.mailboxId, mine.archive.mailboxId].sort(),
		);
	});
});

describe("list_threads", () => {
	it("lists one folder", async () => {
		const page = await callToolJson<ThreadPage>("list_threads", {
			mailboxId: mine.archive.mailboxId,
		});
		assert.deepEqual(messageIds(page), [mine.holidayId]);
	});

	it("lists nothing from another user's folder", async () => {
		const page = await callToolJson<ThreadPage>("list_threads", {
			mailboxId: theirs.inbox.mailboxId,
		});
		assert.deepEqual(page.items, []);
	});
});

describe("search_threads", () => {
	it("finds the caller's mail across folders and never another user's", async () => {
		const page = await callToolJson<ThreadPage>("search_threads", {
			query: "holiday",
		});
		assert.deepEqual(messageIds(page), [mine.holidayId]);
	});

	it("narrows to one folder", async () => {
		const page = await callToolJson<ThreadPage>("search_threads", {
			query: "mine",
			mailboxId: mine.inbox.mailboxId,
		});
		assert.deepEqual(messageIds(page), [mine.invoiceId]);
	});
});

describe("get_thread", () => {
	it("returns the conversation's messages", async () => {
		const listed = await callToolJson<ThreadPage>("list_threads", {
			mailboxId: mine.inbox.mailboxId,
		});
		const page = await callToolJson<ThreadPage>("get_thread", {
			threadId: listed.items[0].threadId,
		});
		assert.deepEqual(messageIds(page), [mine.invoiceId]);
	});

	it("returns nothing for another user's thread", async () => {
		const [row] = await store.threadMessage.findAllByMessageId(
			theirs.account.accountConfigId,
			theirs.invoiceId,
		);
		const page = await callToolJson<ThreadPage>("get_thread", {
			threadId: row.threadId,
		});
		assert.deepEqual(page.items, []);
	});
});

describe("get_message", () => {
	it("returns the envelope and the plain-text body from storage", async () => {
		const message = await callToolJson<{
			messageId: string;
			mailboxId: string;
			subject: string;
			from: { email: string }[];
			bodyAvailable: boolean;
			bodyText: string;
			truncated: boolean;
		}>("get_message", { messageId: mine.invoiceId });
		assert.equal(message.messageId, mine.invoiceId);
		assert.equal(message.mailboxId, mine.inbox.mailboxId);
		assert.equal(message.subject, "mine quarterly invoice");
		assert.deepEqual(
			message.from.map((address) => address.email),
			["billing@mine.example"],
		);
		assert.equal(message.bodyAvailable, true);
		assert.equal(
			message.bodyText.trim(),
			"Hello mine, your invoice is attached.",
		);
		assert.equal(message.truncated, false);
	});

	it("re-arms the body sync when the stored body is missing", async () => {
		const userId = "mcp-missing-body-user";
		const imap = new FakeImapServer();
		const account = await seedAccount(store, {
			accountConfigId: deriveAccountConfigId(userId),
			username: "missing@example.com",
			email: "missing@example.com",
		});
		const inbox = await seedMailbox(store, account, "INBOX");
		imap.addFolder("INBOX");
		const messageId = await arriveAt(
			store,
			imap,
			account,
			inbox,
			eml({ "Message-ID": "<missing@example.com>" }, "never stored"),
		);
		const stored = await store.message.get(mine.invoiceId);
		await store.message.update(messageId, {
			bodyStorageKey: stored.bodyStorageKey?.replace(mine.invoiceId, messageId),
		});

		const handler = createMcpHandler(
			{ userId, scopes: [MCP_READ_SCOPE] },
			deps,
		);
		const body = await rpc(handler, "tools/call", {
			name: "get_message",
			arguments: { messageId },
		});
		const result = body.result as unknown as ToolResult;
		assert.notEqual(result.isError, true, result.content[0]?.text);
		const message = JSON.parse(result.content[0].text) as {
			bodyAvailable: boolean;
			bodyText?: string;
		};
		assert.equal(message.bodyAvailable, false);
		assert.equal(message.bodyText, undefined);
		assert.deepEqual(rearmed, [messageId]);
	});

	it("refuses another user's message as not found", async () => {
		const result = await callTool("get_message", {
			messageId: theirs.invoiceId,
		});
		assert.equal(result.isError, true);
		assert.match(result.content[0].text, /not found/i);
	});
});
