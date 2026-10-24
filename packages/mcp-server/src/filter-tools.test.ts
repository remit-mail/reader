import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, FilterItem, MailboxItem } from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	FilterMatchOperator,
	FilterScope,
	FilterState,
	MailboxSyncStatus,
} from "@remit/domain-enums";
import { BodySyncService, SyncWarningService } from "@remit/mailbox-service";
import {
	captureQueue,
	type QueueCapture,
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
import { ORGANIZE_QUEUE, ruleDeps } from "./test-rule-deps.js";

const USER_ID = "filter-user";
const OTHER_USER_ID = "filter-other-user";

let store: Store;
let capture: QueueCapture;
let deps: McpDeps;
let account: AccountItem;
let receipts: MailboxItem;
let theirAccount: AccountItem;
let theirFilter: FilterItem;

const clauses = [{ field: "From", value: "billing@example.com" }];

beforeEach(async () => {
	capture = captureQueue();
	store = await openStore();
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
	await seedMailbox(store, account, "INBOX");
	receipts = await seedMailbox(store, account, "Receipts");

	theirAccount = await seedAccount(store, {
		accountConfigId: deriveAccountConfigId(OTHER_USER_ID),
		username: "them@example.com",
		email: "them@example.com",
	});
	theirFilter = await store.filter.create({
		accountConfigId: theirAccount.accountConfigId,
		name: "Theirs",
		scope: FilterScope.Standing,
		matchOperator: FilterMatchOperator.And,
		literalClauses: [{ field: "Subject", value: "private" }],
		actionLabelId: "None",
		actionMailboxId: "None",
	});
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

type FilterView = {
	filterId: string;
	name: string;
	state: string;
	actionMailboxId: string;
};

type FilterOutcome = { filter: FilterView; organizeJobId?: string };

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

const callToolJson = async <T>(
	name: string,
	args: Record<string, unknown>,
): Promise<T> => {
	const result = await callTool(name, args);
	assert.notEqual(result.isError, true, result.content[0]?.text);
	return JSON.parse(result.content[0].text) as T;
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

const myFilters = async (): Promise<FilterItem[]> =>
	(await store.filter.listPageByAccountConfig(account.accountConfigId)).items;

const pendingFolder = (fullPath: string): Promise<MailboxItem> =>
	seedMailbox(store, account, fullPath, {
		overrides: { syncStatus: MailboxSyncStatus.pending },
	});

const receiptsRule = (actionMailboxId: string) => ({
	accountId: account.accountId,
	name: "Receipts",
	literalClauses: clauses,
	actionMailboxId,
});

const organizeSends = () =>
	capture.sent.filter(({ queueUrl }) => queueUrl === ORGANIZE_QUEUE);

describe("the filter tools behind mail:rules", () => {
	it("are absent from a token without mail:rules", async () => {
		const names = await toolNames([MCP_READ_SCOPE]);
		for (const name of ["list_filters", "create_filter", "update_filter"]) {
			assert.equal(names.includes(name), false, name);
		}

		const body = await rpc(organizer([MCP_READ_SCOPE]), "tools/call", {
			name: "create_filter",
			arguments: receiptsRule(receipts.mailboxId),
		});
		assert.equal(body.error?.code, -32601);
		assert.deepEqual(await myFilters(), []);
		assert.equal(capture.sent.length, 0);
	});

	it("are listed for a token with mail:rules", async () => {
		const names = await toolNames([MCP_RULES_SCOPE]);
		for (const name of ["list_filters", "create_filter", "update_filter"]) {
			assert.equal(names.includes(name), true, name);
		}
	});
});

describe("create_filter", () => {
	it("stores the filter and returns the job that applies it to existing mail", async () => {
		const created = await callToolJson<FilterOutcome>(
			"create_filter",
			receiptsRule(receipts.mailboxId),
		);

		assert.equal(created.filter.name, "Receipts");
		assert.equal(created.filter.actionMailboxId, receipts.mailboxId);
		assert.equal(created.filter.state, FilterState.Active);
		assert.ok(created.organizeJobId);
		const job = await store.organizeJobRequest.get(created.organizeJobId);
		assert.equal(job.filterId, created.filter.filterId);
		assert.equal(job.userId, USER_ID);
		assert.deepEqual(
			organizeSends().map(({ body }) => body),
			[
				{
					type: "OrganizeJob",
					accountConfigId: account.accountConfigId,
					organizeJobId: created.organizeJobId,
				},
			],
		);
	});

	it("refuses a folder the mail server has not confirmed, with the fix, storing nothing", async () => {
		const fresh = await pendingFolder("Fresh");

		assert.match(
			await refusalOf("create_filter", receiptsRule(fresh.mailboxId)),
			/“Fresh” isn’t ready yet .* Wait for it to settle, then call this tool again\./,
		);
		assert.deepEqual(await myFilters(), []);
		assert.equal(capture.sent.length, 0);
	});

	it("refuses an account the caller does not own", async () => {
		assert.match(
			await refusalOf("create_filter", {
				...receiptsRule("None"),
				accountId: theirAccount.accountId,
			}),
			/not in account config\. Use an accountId and mailboxId from list_mailboxes\./,
		);
		assert.deepEqual(await myFilters(), []);
		assert.equal(capture.sent.length, 0);
	});

	it("passes through the service's refusal of a Temporary filter without an expiry", async () => {
		assert.match(
			await refusalOf("create_filter", {
				...receiptsRule(receipts.mailboxId),
				scope: FilterScope.Temporary,
			}),
			/A Temporary filter needs expiresAt/,
		);
		assert.deepEqual(await myFilters(), []);
	});
});

describe("list_filters", () => {
	it("lists the caller's filters and never another user's", async () => {
		const created = await callToolJson<FilterOutcome>(
			"create_filter",
			receiptsRule(receipts.mailboxId),
		);

		const page = await callToolJson<{ items: FilterView[] }>("list_filters", {
			accountId: account.accountId,
		});
		assert.deepEqual(
			page.items.map((item) => item.filterId),
			[created.filter.filterId],
		);
		assert.notEqual(page.items[0]?.filterId, theirFilter.filterId);
	});

	it("refuses another user's account as not found", async () => {
		assert.match(
			await refusalOf("list_filters", { accountId: theirAccount.accountId }),
			/Account not found/,
		);
	});
});

describe("update_filter", () => {
	const created = () =>
		callToolJson<FilterOutcome>(
			"create_filter",
			receiptsRule(receipts.mailboxId),
		);

	it("changes only the given fields and queues no job unless asked", async () => {
		const { filter } = await created();
		const sentBefore = capture.sent.length;

		const updated = await callToolJson<FilterOutcome>("update_filter", {
			accountId: account.accountId,
			filterId: filter.filterId,
			name: "Bills",
		});

		assert.equal(updated.filter.name, "Bills");
		assert.equal(updated.filter.actionMailboxId, receipts.mailboxId);
		assert.equal(updated.organizeJobId, undefined);
		assert.equal(capture.sent.length, sentBefore);
	});

	it("applies the filter to existing mail when asked and returns the job id", async () => {
		const { filter } = await created();

		const updated = await callToolJson<FilterOutcome>("update_filter", {
			accountId: account.accountId,
			filterId: filter.filterId,
			state: FilterState.Disabled,
			applyToExisting: true,
		});

		assert.equal(updated.filter.state, FilterState.Disabled);
		assert.ok(updated.organizeJobId);
		const job = await store.organizeJobRequest.get(updated.organizeJobId);
		assert.equal(job.filterId, filter.filterId);
		assert.equal(organizeSends().at(-1)?.body.organizeJobId, job.organizeJobId);
	});

	it("refuses a target folder the mail server has not confirmed, leaving the filter alone", async () => {
		const { filter } = await created();
		const fresh = await pendingFolder("Fresh");
		const sentBefore = capture.sent.length;

		assert.match(
			await refusalOf("update_filter", {
				accountId: account.accountId,
				filterId: filter.filterId,
				actionMailboxId: fresh.mailboxId,
				applyToExisting: true,
			}),
			/“Fresh” isn’t ready yet .* Wait for it to settle, then call this tool again\./,
		);
		const stored = await store.filter.get(
			account.accountConfigId,
			filter.filterId,
		);
		assert.equal(stored.actionMailboxId, receipts.mailboxId);
		assert.equal(capture.sent.length, sentBefore);
	});

	it("refuses a filter the caller does not own, pointing at list_filters", async () => {
		assert.match(
			await refusalOf("update_filter", {
				accountId: account.accountId,
				filterId: theirFilter.filterId,
				name: "Hijacked",
			}),
			/Check the filterId against list_filters\./,
		);
		const untouched = await store.filter.get(
			theirAccount.accountConfigId,
			theirFilter.filterId,
		);
		assert.equal(untouched.name, "Theirs");
	});

	it("passes through the service's refusal to set Expired directly", async () => {
		const { filter } = await created();

		assert.match(
			await refusalOf("update_filter", {
				accountId: account.accountId,
				filterId: filter.filterId,
				state: FilterState.Expired,
			}),
			/A filter expires through its date, not its state\./,
		);
	});
});
