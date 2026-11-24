import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import { OutboxMessageStatus } from "@remit/domain-enums";
import {
	BodySyncService,
	OutboxAttachmentService,
	SyncWarningService,
} from "@remit/mailbox-service";
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
	spamConfigFor,
	storeBody,
} from "@remit/mailbox-service/test-helpers/test-store";
import type { StorageService } from "@remit/storage-service";
import {
	MCP_ACCOUNT_SCOPE,
	MCP_OPERATOR_SCOPE,
	MCP_READ_SCOPE,
	MCP_SEND_SCOPE,
} from "./auth/scopes.js";
import type { McpDeps } from "./deps.js";
import { createMcpHandler, type McpRequestHandler } from "./server.js";
import { ruleDeps, testClient } from "./test-rule-deps.js";

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
	const client = testClient(
		store,
		recordingQueue(),
		storage,
		new BodySyncService(
			store.message,
			storage,
			store.threadMessage,
			store.address,
			store.mailboxSpecialUse,
			store.envelope,
			new SyncWarningService(store.syncWarning),
			spamConfigFor(store),
			silentLog,
		),
		{
			requestBodySync: async ({ messageId }) => {
				rearmed.push(messageId);
			},
		},
	);
	deps = {
		apiConfig: undefined as never,
		logger: silentLog,
		operatorClient: () => undefined as never,
		...ruleDeps(client),
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
	createMcpHandler({ userId: USER_ID, scopes: [MCP_READ_SCOPE] }, deps, false);

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
			"classifier_stats",
			"get_message",
			"get_raw_message",
			"get_thread",
			"list_labels",
			"list_mailboxes",
			"list_quarantine",
			"list_threads",
			"list_vip_suggestions",
			"preview_organize",
			"search_addresses",
			"search_threads",
		]);
	});

	it("refuses a read tool to an account-only token", async () => {
		const accountOnly = createMcpHandler(
			{ userId: USER_ID, scopes: [MCP_ACCOUNT_SCOPE] },
			deps,
			false,
		);
		const body = await rpc(accountOnly, "tools/call", {
			name: "list_quarantine",
			arguments: {},
		});
		const result = body.result as ToolResult;
		assert.equal(result.isError, true);
		assert.match(
			result.content[0]?.text ?? "",
			/tool list_quarantine not found/i,
		);
	});
});

describe("the operator tools", () => {
	it("registers them only when the scope and current operator check both hold", async () => {
		const names = async (scopes: string[], operator: boolean) => {
			const body = await rpc(
				createMcpHandler({ userId: USER_ID, scopes }, deps, operator),
				"tools/list",
			);
			return (
				(body.result as { tools: { name: string }[] } | undefined)?.tools ?? []
			)
				.map((tool) => tool.name)
				.sort();
		};
		assert.deepEqual(await names([MCP_OPERATOR_SCOPE], false), []);
		assert.deepEqual(await names([], true), []);
		assert.deepEqual(await names([MCP_OPERATOR_SCOPE], true), [
			"clear_classification_default",
			"clear_tenant_classification",
			"disable_person",
			"enable_person",
			"get_classification_default",
			"get_tenant_settings",
			"invite_person",
			"list_audit",
			"list_people",
			"reset_person_factors",
			"revoke_invite",
			"set_classification_default",
			"sign_out_person",
			"update_tenant_settings",
		]);
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
			false,
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

describe("oversized MCP requests", () => {
	for (const declared of [true, false]) {
		it(`names the byte limit for a ${declared ? "declared" : "streamed"} oversized body`, async () => {
			const handler = createMcpHandler(
				{ userId: USER_ID, scopes: [] },
				deps,
				false,
			);
			const response = await handler(
				new Request("https://mcp.remit.test/mcp", {
					method: "POST",
					headers: declared ? { "content-length": "7056045" } : {},
					body: declared ? "{}" : new Uint8Array(7056045),
				}),
			);
			assert.equal(response.status, 413);
			assert.deepEqual(await response.json(), {
				error: "payload_too_large",
				message: "Request body exceeds the maximum of 7056044 bytes",
			});
		});
	}
});

describe("mint_outbox_attachment upload refusals", () => {
	const cases = [
		{
			name: "names the self-hosted server's reason",
			body: "size-mismatch",
			status: 400,
			expected: "The attachment size does not match its reservation",
		},
		{
			name: "names storage's reason without echoing signed request details",
			body: "<Error><Code>SignatureDoesNotMatch</Code><Message>Rejected credential: secret</Message><SignatureProvided>secret</SignatureProvided></Error>",
			status: 403,
			expected: "The upload URL signature is invalid",
		},
		{
			name: "does not echo unrecognized response text or a reason header",
			body: '{"message":"Rejected password: secret"}',
			status: 403,
			expected: "The storage server refused the upload",
			headers: new Headers({ "x-remit-upload-reason": "rejected secret" }),
		},
	];
	for (const { name, body, status, expected, headers } of cases) {
		it(name, async (t) => {
			const draft = await store.outboxMessage.create({
				accountId: mine.account.accountId,
				accountConfigId: mine.account.accountConfigId,
				fromAddress: "mine@example.com",
				toAddresses: ["recipient@example.com"],
				messageIdValue: "<draft@example.com>",
				status: OutboxMessageStatus.draft,
			});
			const client = {
				...deps.client,
				outboxAttachment: new OutboxAttachmentService({
					outboxMessageService: store.outboxMessage,
					outboxAttachmentService: store.outboxAttachment,
					storage,
				}),
			};
			t.mock.method(globalThis, "fetch", async (url: string) => {
				assert.ok(new URL(url).searchParams.has("sig"));
				return new Response(body, { status, headers });
			});
			const handler = createMcpHandler(
				{ userId: USER_ID, scopes: [MCP_SEND_SCOPE] },
				{ ...deps, client },
				false,
			);
			const result = (
				await rpc(handler, "tools/call", {
					name: "mint_outbox_attachment",
					arguments: {
						outboxMessageId: draft.outboxMessageId,
						filename: "attachment.txt",
						contentType: "text/plain",
						contentBase64: "YQ==",
					},
				})
			).result as ToolResult;
			assert.equal(result.isError, true);
			assert.equal(
				result.content[0].text,
				`Attachment upload failed with status ${status}: ${expected}`,
			);
			assert.ok(!JSON.stringify(result).includes("secret"));
		});
	}
});
