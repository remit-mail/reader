import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { MailboxItem } from "@remit/data-ports";
import { isNotFoundError } from "@remit/data-ports/errors";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { MailboxSpecialUse, MailboxSyncStatus } from "@remit/domain-enums";
import { processMailboxManagement } from "@remit/imap-worker/mailbox-management";
import { processEvent, type WorkerEvent } from "@remit/imap-worker/process";
import {
	mail,
	openStore,
	type World,
} from "@remit/imap-worker/test-helpers/test-world";
import { BodySyncService, SyncWarningService } from "@remit/mailbox-service";
import { silentLog } from "@remit/mailbox-service/test-helpers/test-store";
import { MCP_RULES_SCOPE } from "./auth/scopes.js";
import type { McpDeps } from "./deps.js";
import { createMcpHandler } from "./server.js";

type MailboxEvent = Parameters<typeof processMailboxManagement>[0];

type ToolResult = {
	isError?: boolean;
	content: { type: string; text: string }[];
};

let userId: string;
let store: Awaited<ReturnType<typeof openStore>>;
let mine: World;
let deps: McpDeps;
let inbox: MailboxItem;

before(async () => {
	store = await openStore();
});

after(() => store.close());

beforeEach(async () => {
	userId = `delete-user-${randomUUID()}`;
	mine = await store.world(deriveAccountConfigId(userId));
	inbox = await mine.folder("INBOX");
	await mine.folder("Trash", { specialUse: MailboxSpecialUse.Trash });

	mine.queue.answer(async () => {
		const last = mine.queued().at(-1);
		if (last && String(last.type).startsWith("MAILBOX_")) {
			await processMailboxManagement(
				last as unknown as MailboxEvent,
				mine.ctx(),
			);
		}
		if (last?.type === "MESSAGE_MOVE") {
			await processEvent(last as unknown as WorkerEvent, mine.ctx(), 1);
		}
		return {};
	});

	const { client } = mine;
	deps = {
		account: client.account,
		address: client.address,
		label: client.label,
		labelMailbox: client.labelMailbox,
		mailbox: client.mailbox,
		accountSetting: client.accountSetting,
		mailboxSpecialUse: client.mailboxSpecialUse,
		message: client.message,
		messageLabel: client.messageLabel,
		messageMove: client.messageMove,
		threadMessage: client.threadMessage,
		filter: client.filter,
		organizeJobRequest: client.organizeJobRequest,
		storage: client.storage,
		bodySync: new BodySyncService(
			client.message,
			client.storage,
			client.threadMessage,
			client.address,
			client.envelope,
			new SyncWarningService(client.syncWarning),
			client.spam,
			silentLog,
		),
		bodySyncQueue: client.bodySyncQueue,
		rescan: client.rescan,
		logger: silentLog,
		folders: {
			mailboxQueue: client.mailboxQueue,
			settleTimeoutMs: 100,
			pollIntervalMs: 10,
			sleep,
		},
		filters: {
			organizeQueue: client.queues.accountFanout,
			logger: silentLog,
		},
	};
});

const callTool = async (
	name: string,
	args: Record<string, unknown>,
): Promise<ToolResult> => {
	const handler = createMcpHandler({ userId, scopes: [MCP_RULES_SCOPE] }, deps);
	const response = await handler(
		new Request("http://reader.test/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name, arguments: args },
			}),
		}),
	);
	const body = (await response.json()) as { result: ToolResult };
	return body.result;
};

const callToolJson = async (
	name: string,
	args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
	const result = await callTool(name, args);
	assert.notEqual(result.isError, true, result.content[0]?.text);
	return JSON.parse(result.content[0].text) as Record<string, unknown>;
};

const refusalOf = async (
	name: string,
	args: Record<string, unknown>,
): Promise<string> => {
	const result = await callTool(name, args);
	assert.equal(result.isError, true, result.content[0]?.text);
	return result.content[0].text;
};

const createLabel = async (
	name: string,
): Promise<{ labelId: string; folder: MailboxItem }> => {
	const { labelId } = (await callToolJson("create_label", { name })) as {
		labelId: string;
	};
	const mapped = await mine.client.labelMailbox.get(
		labelId,
		mine.account.accountId,
	);
	assert.ok(mapped);
	const folder = await mine.client.mailbox.get(
		mine.account.accountId,
		mapped.mailboxId,
	);
	assert.equal(folder.syncStatus, MailboxSyncStatus.synced);
	return { labelId, folder };
};

const createFilter = async (labelId: string): Promise<string> => {
	const created = (await callToolJson("create_filter", {
		accountId: mine.account.accountId,
		name: "Newsletters in",
		literalClauses: [{ field: "From", value: "news@example.com" }],
		actionLabelId: labelId,
	})) as { filter: { filterId: string } };
	return created.filter.filterId;
};

const labelExists = (labelId: string): Promise<boolean> =>
	mine.client.label
		.get(mine.account.accountConfigId, labelId)
		.then(() => true)
		.catch((error: unknown) => {
			if (isNotFoundError(error)) return false;
			throw error;
		});

const filterExists = (filterId: string): Promise<boolean> =>
	mine.client.filter
		.get(mine.account.accountConfigId, filterId)
		.then(() => true)
		.catch((error: unknown) => {
			if (isNotFoundError(error)) return false;
			throw error;
		});

describe("delete_filter", () => {
	it("deletes the filter and moves no mail", async () => {
		const { labelId } = await createLabel("Newsletters");
		const filterId = await createFilter(labelId);
		const { messageId } = await mine.message(inbox);

		const deleted = await callToolJson("delete_filter", { filterId });

		assert.equal(deleted.deleted, true);
		assert.equal(await filterExists(filterId), false);
		assert.equal(await labelExists(labelId), true);
		assert.equal((await mine.row(messageId))?.mailboxId, inbox.mailboxId);
	});
});

describe("delete_label", () => {
	it("refuses while a filter applies the label, naming the filter", async () => {
		const { labelId, folder } = await createLabel("Newsletters");
		const filterId = await createFilter(labelId);

		assert.match(
			await refusalOf("delete_label", { labelId }),
			/applied by the filter “Newsletters in”/,
		);
		assert.equal(await labelExists(labelId), true);
		assert.equal(await filterExists(filterId), true);
		assert.equal(mine.imap.hasFolder(folder.fullPath), true);
	});

	it("refuses while the mail server holds mail in a label folder, even when Remit has not synced it", async () => {
		const { labelId, folder } = await createLabel("Newsletters");
		mine.imap.deliver(folder.fullPath, mail("<unsynced@example.com>"));

		assert.match(
			await refusalOf("delete_label", { labelId }),
			/still holds 1 message on the mail server/,
		);
		assert.equal(await labelExists(labelId), true);
		assert.equal(mine.imap.hasFolder(folder.fullPath), true);
		const kept = await mine.client.mailbox.get(
			folder.accountId,
			folder.mailboxId,
		);
		assert.equal(kept.syncStatus, MailboxSyncStatus.synced);
	});

	it("deletes no label folder when another account's synced count shows mail", async () => {
		const sibling = await mine.siblingFolder("INBOX");
		const { labelId, folder } = await createLabel("Newsletters");
		const mappings = await mine.client.labelMailbox.listByLabel(labelId);
		const theirs = mappings.find(
			(mapping) => mapping.accountId === sibling.accountId,
		);
		assert.ok(theirs);
		const siblingFolder = await mine.client.mailbox.get(
			theirs.accountId,
			theirs.mailboxId,
		);
		await mine.client.mailbox.update(theirs.accountId, theirs.mailboxId, {
			messageCount: 1,
		});

		assert.match(
			await refusalOf("delete_label", { labelId }),
			/still holds 1 message/,
		);
		assert.equal(await labelExists(labelId), true);
		assert.equal(mine.imap.hasFolder(folder.fullPath), true);
		assert.equal(mine.imap.hasFolder(siblingFolder.fullPath), true);
		assert.deepEqual(
			mine.queued().filter((event) => event.type === "MAILBOX_DELETE"),
			[],
		);
	});

	it("with force moves the mail to Trash, deletes the filters it reports, then the label", async () => {
		const { labelId, folder } = await createLabel("Newsletters");
		const filterId = await createFilter(labelId);
		await mine.message(folder);
		await mine.message(folder);

		const deleted = await callToolJson("delete_label", {
			labelId,
			force: true,
		});

		assert.equal(deleted.deleted, true);
		assert.deepEqual(deleted.deletedFilters, [
			{ filterId, name: "Newsletters in" },
		]);
		assert.equal(mine.imap.messages("Trash").length, 2);
		assert.equal(mine.imap.hasFolder(folder.fullPath), false);
		assert.equal(await labelExists(labelId), false);
		assert.equal(await filterExists(filterId), false);
	});
});
