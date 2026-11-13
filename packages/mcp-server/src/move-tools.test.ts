import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { MailboxItem } from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { MailboxSpecialUse, MessageStatus } from "@remit/domain-enums";
import { processMailboxManagement } from "@remit/imap-worker/mailbox-management";
import {
	openStore,
	type World,
} from "@remit/imap-worker/test-helpers/test-world";
import { BodySyncService, SyncWarningService } from "@remit/mailbox-service";
import { silentLog } from "@remit/mailbox-service/test-helpers/test-store";
import { MCP_RULES_SCOPE } from "./auth/scopes.js";
import type { McpDeps } from "./deps.js";
import { createMcpHandler } from "./server.js";

const USER_ID = "move-user";

type MailboxEvent = Parameters<typeof processMailboxManagement>[0];

type ToolResult = {
	isError?: boolean;
	content: { type: string; text: string }[];
};

let store: Awaited<ReturnType<typeof openStore>>;
let mine: World;
let deps: McpDeps;
let inbox: MailboxItem;
let receipts: MailboxItem;

before(async () => {
	store = await openStore();
});

after(() => store.close());

beforeEach(async () => {
	mine = await store.world(deriveAccountConfigId(USER_ID));
	inbox = await mine.folder("INBOX");
	receipts = await mine.folder("Receipts");
	mine.queue.answer(async () => {
		const last = mine.queued().at(-1);
		if (last && String(last.type).startsWith("MAILBOX_")) {
			await processMailboxManagement(
				last as unknown as MailboxEvent,
				mine.ctx(),
			);
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
	const response = await createMcpHandler(
		{ userId: USER_ID, scopes: [MCP_RULES_SCOPE] },
		deps,
	)(
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

const labelFolder = async (name: string): Promise<{ labelId: string }> =>
	(await callToolJson("create_label", { name })) as { labelId: string };

describe("move_messages", () => {
	it("moves messages into a folder through the mail app's move", async () => {
		const { messageId } = await mine.message(inbox);

		const moved = await callToolJson("move_messages", {
			messageIds: [messageId],
			mailboxId: receipts.mailboxId,
		});

		assert.equal(moved.moved, 1);
		const row = await mine.row(messageId);
		assert.equal(row?.mailboxId, receipts.mailboxId);
		assert.equal(row?.status, MessageStatus.moving);
	});

	it("moves messages into a label's folder and tags them", async () => {
		const { messageId } = await mine.message(inbox);
		const { labelId } = await labelFolder("Newsletters");
		const mapped = await mine.client.labelMailbox.get(
			labelId,
			mine.account.accountId,
		);
		assert.ok(mapped);

		await callToolJson("move_messages", { messageIds: [messageId], labelId });

		assert.equal((await mine.row(messageId))?.mailboxId, mapped.mailboxId);
		const labels = await mine.client.messageLabel.listByMessageId(messageId);
		assert.deepEqual(
			labels.map((row) => row.labelId),
			[labelId],
		);
	});

	it("refuses a call that names both a folder and a label", async () => {
		const { messageId } = await mine.message(inbox);
		const result = await callTool("move_messages", {
			messageIds: [messageId],
			mailboxId: receipts.mailboxId,
			labelId: "some-label",
		});

		assert.equal(result.isError, true);
		assert.match(result.content[0].text, /not both/);
		assert.equal((await mine.row(messageId))?.mailboxId, inbox.mailboxId);
	});
});

describe("trash_messages", () => {
	it("leaves a message already in Trash untouched", async () => {
		const trash = await mine.folder("Trash", {
			specialUse: MailboxSpecialUse.Trash,
		});
		const fresh = await mine.message(inbox);
		const trashed = await mine.message(trash);

		const result = await callToolJson("trash_messages", {
			messageIds: [fresh.messageId, trashed.messageId],
		});

		assert.deepEqual(result, {
			trashed: 1,
			alreadyInTrash: [trashed.messageId],
		});
		const kept = await mine.row(trashed.messageId);
		assert.equal(kept?.mailboxId, trash.mailboxId);
		assert.equal(kept?.uid, trashed.uid);
		assert.equal(kept?.status, MessageStatus.active);
		assert.equal((await mine.row(fresh.messageId))?.mailboxId, trash.mailboxId);
	});
});
