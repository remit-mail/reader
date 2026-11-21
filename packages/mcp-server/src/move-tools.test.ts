import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { processOrganizeJob } from "@remit/account-worker/organize-job";
import { filterRuleFromClauses, type MailboxItem } from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { MailboxSpecialUse, MessageStatus } from "@remit/domain-enums";
import { processMailboxManagement } from "@remit/imap-worker/mailbox-management";
import {
	openStore,
	type World,
} from "@remit/imap-worker/test-helpers/test-world";
import { noopLogger } from "@remit/logger";
import { silentLog } from "@remit/mailbox-service/test-helpers/test-store";
import { MCP_RULES_SCOPE } from "./auth/scopes.js";
import type { McpDeps } from "./deps.js";
import { encodeMoveCursor } from "./move-cursor.js";
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
		apiConfig: undefined as never,
		calendarClient: () => undefined as never,
		client,
		logger: silentLog,
		folders: {
			settleTimeoutMs: 100,
			pollIntervalMs: 10,
			sleep,
		},
		moves: { budgetMs: 100, pollIntervalMs: 10, sleep, now: Date.now },
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

describe("rescan_messages", () => {
	it("answers a stored message and a missing one on their own", async () => {
		const { messageId } = await mine.message(inbox);
		await mine.client.bodySync.syncBodies(
			[messageId],
			mine.account.accountId,
			mine.account.accountConfigId,
			{
				mailboxId: inbox.mailboxId,
				fullPath: inbox.fullPath,
				placement: "inbox",
				uidValidity: inbox.uidValidity,
				createdAt: inbox.createdAt,
				initialSyncCompletedAt: 1,
			},
			async () => mine.imap.connection(),
			{ force: false, concurrency: 1, bytesInFlight: 64 * 1024 * 1024 },
		);
		const missing = "m".repeat(25);

		const result = await callToolJson("rescan_messages", {
			accountId: mine.account.accountId,
			messageIds: [messageId, missing],
		});

		assert.deepEqual(
			(result.successful as { messageId: string }[]).map(
				(success) => success.messageId,
			),
			[messageId],
		);
		assert.deepEqual(result.failed, [
			{ messageId: missing, code: "NotFound", retryable: false },
		]);
	});
});

describe("move_folder_messages", () => {
	const BATCH = 2;
	const MESSAGES = 7;
	const BATCH_DELAY_MS = 100;

	interface SelectionReport {
		organizeJobId: string;
		state: string;
		batches: number;
		appliedCount: number;
		remainingCount?: number;
		cursor?: string;
	}

	interface MoveReport {
		jobs: SelectionReport[];
		continue?: string;
	}

	let archive: MailboxItem;
	let time: number;
	let due: Array<{ at: number; run: () => Promise<void> }>;

	const runDue = async (): Promise<void> => {
		for (;;) {
			const next = due.find(({ at }) => at <= time);
			if (!next) return;
			due.splice(due.indexOf(next), 1);
			await next.run();
		}
	};

	const clock = {
		now: () => time,
		sleep: async (ms: number) => {
			time += ms;
			await runDue();
		},
		finishAll: async () => {
			time = Math.max(time, ...due.map(({ at }) => at));
			await runDue();
		},
	};

	const runOrganizeJobs = (delayMs: number): void => {
		mine.queue.answer(async () => {
			const last = mine.queued().at(-1);
			if (last?.type !== "OrganizeJob") return {};
			const run = async () => {
				await processOrganizeJob(
					last as unknown as Parameters<typeof processOrganizeJob>[0],
					noopLogger,
					{ client: mine.client, matchLimit: BATCH },
				);
			};
			if (delayMs === 0) await run();
			else due.push({ at: time + delayMs, run });
			return {};
		});
	};

	const inFolder = async (mailbox: MailboxItem): Promise<number> =>
		(
			await mine.client.threadMessage.listByMailbox(
				deriveAccountConfigId(USER_ID),
				mailbox.mailboxId,
				{ excludeDeleted: true },
			)
		).items.length;

	beforeEach(async () => {
		time = 0;
		due = [];
		deps.moves = {
			budgetMs: 250,
			pollIntervalMs: 10,
			sleep: clock.sleep,
			now: clock.now,
		};
		archive = await mine.folder("Archive");
		for (let seeded = 0; seeded < MESSAGES; seeded += 1) {
			await mine.message(receipts);
		}
	});

	const moveReceipts = async (): Promise<MoveReport> =>
		(await callToolJson("move_folder_messages", {
			accountId: mine.account.accountId,
			sourceMailboxId: receipts.mailboxId,
			mailboxId: archive.mailboxId,
		})) as unknown as MoveReport;

	const job = (report: MoveReport): Omit<SelectionReport, "organizeJobId"> => {
		const { organizeJobId: _, ...rest } = report.jobs[0];
		return rest;
	};

	it("runs capped batches back to back until nothing is left", async () => {
		runOrganizeJobs(0);

		const report = await moveReceipts();

		assert.deepEqual(job(report), {
			accountId: mine.account.accountId,
			sourceMailboxId: receipts.mailboxId,
			state: "Complete",
			batches: 4,
			appliedCount: MESSAGES,
			failedCount: 0,
			remainingCount: 0,
			cursor: "",
		});
		assert.equal(report.continue, undefined);
		assert.equal(await inFolder(receipts), 0);
		assert.equal(await inFolder(archive), MESSAGES);
	});

	it("returns at its budget and continues from the cursor", async () => {
		runOrganizeJobs(BATCH_DELAY_MS);

		const first = await moveReceipts();

		assert.equal(time, 250, "returns when the budget is spent");
		assert.deepEqual(job(first), {
			accountId: mine.account.accountId,
			sourceMailboxId: receipts.mailboxId,
			state: "Pending",
			batches: 3,
			appliedCount: 4,
			failedCount: 0,
		});
		assert.ok(first.continue);

		await clock.finishAll();
		const third = (await callToolJson("get_organize_job", {
			organizeJobId: first.jobs[0].organizeJobId,
		})) as unknown as SelectionReport;
		assert.equal(third.appliedCount, 2);
		assert.equal(third.remainingCount, 1);
		assert.equal(await inFolder(receipts), 1);
		assert.ok(third.cursor);

		const last = (await callToolJson("move_folder_messages", {
			cursor: third.cursor,
		})) as unknown as MoveReport;

		assert.deepEqual(job(last), {
			accountId: mine.account.accountId,
			sourceMailboxId: receipts.mailboxId,
			state: "Complete",
			batches: 1,
			appliedCount: 1,
			failedCount: 0,
			remainingCount: 0,
			cursor: "",
		});
		assert.equal(await inFolder(receipts), 0);
		assert.equal(await inFolder(archive), MESSAGES);
	});

	it("refuses a cursor sent with a selection", async () => {
		const result = await callTool("move_folder_messages", {
			cursor: "anything",
			trash: true,
		});

		assert.equal(result.isError, true);
		assert.match(result.content[0].text, /Send cursor alone/);
	});

	it("refuses a cursor it never handed out", async () => {
		const result = await callTool("move_folder_messages", {
			cursor: "not-a-cursor",
		});

		assert.equal(result.isError, true);
		assert.match(result.content[0].text, /not one move_folder_messages/);
	});

	it("refuses a cursor naming another user's folders and moves nothing", async () => {
		const theirs = await store.world(deriveAccountConfigId("someone-else"));
		const theirInbox = await theirs.folder("INBOX");
		const theirArchive = await theirs.folder("Archive");
		const forged = encodeMoveCursor({
			accountId: theirs.account.accountId,
			sourceMailboxId: theirInbox.mailboxId,
			actionMailboxId: theirArchive.mailboxId,
			actionLabelId: "None",
			rule: filterRuleFromClauses({
				matchOperator: "And",
				literalClauses: [],
			}),
			sentAfter: "None",
			sentBefore: "None",
			startPosition: "position",
		});

		const result = await callTool("move_folder_messages", { cursor: forged });

		assert.equal(result.isError, true);
		assert.deepEqual(
			mine.queued().filter((event) => event.type === "OrganizeJob"),
			[],
		);
	});
});
