import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import type { IImapConnection } from "@remit/mailbox-service";
import {
	type MessageDeleteTerminalLogger,
	type ResolveExhaustedMessageDeleteDeps,
	resolveExhaustedMessageDeleteFailure,
} from "./message-delete-terminal.js";

interface LogEntry {
	obj: Record<string, unknown>;
	msg: string;
}

const buildLogger = (): {
	log: MessageDeleteTerminalLogger;
	infos: LogEntry[];
	errors: LogEntry[];
} => {
	const infos: LogEntry[] = [];
	const errors: LogEntry[] = [];
	return {
		log: {
			info: (obj, msg) => infos.push({ obj, msg }),
			error: (obj, msg) => errors.push({ obj, msg }),
		},
		infos,
		errors,
	};
};

const buildConnection = (
	present: Set<number>,
	fetchDrops: Set<number> = new Set(),
): IImapConnection =>
	({
		openBox: async () => ({}) as never,
		fetchMessages: async (uids: number[]) =>
			uids
				.filter((uid) => present.has(uid) && !fetchDrops.has(uid))
				.map((uid) => ({ uid }) as unknown as never),
		search: async (criteria: unknown[]) => {
			const [, value] = (criteria as Array<[string, string]>)[0];
			const uid = Number(value);
			return present.has(uid) ? [uid] : [];
		},
	}) as unknown as IImapConnection;

interface MessageRow {
	messageId: string;
	mailboxId: string;
	uid: number;
	status: string;
	syncStatus: string;
	originalMailboxId: string;
	originalUid: number;
}

/**
 * The delete's pending state IS the Message row, so these fakes hold real rows
 * and the assertions read the rows back — a resolver that reverted the
 * optimistic delete (PR #652's defect) would show up here as a changed row,
 * not as an uncalled mock.
 */
const buildRepositories = (row: MessageRow) => {
	const messages = new Map<string, MessageRow>([[row.messageId, row]]);
	const threadMessages = new Map<
		string,
		{ accountConfigId: string; threadMessageId: string }
	>([
		[
			`tm-${row.messageId}`,
			{ accountConfigId: "cfg-1", threadMessageId: `tm-${row.messageId}` },
		],
	]);

	return {
		messages,
		threadMessages,
		messageService: {
			delete: async (messageId: string) => {
				messages.delete(messageId);
			},
			update: async (messageId: string, input: Partial<MessageRow>) => {
				const current = messages.get(messageId);
				if (current) messages.set(messageId, { ...current, ...input });
			},
		} as unknown as Pick<IMessageRepository, "delete">,
		threadMessageService: {
			findAllByMessageId: async () => [...threadMessages.values()],
			deleteMany: async (
				keys: Array<{ accountConfigId: string; threadMessageId: string }>,
			) => {
				for (const key of keys) threadMessages.delete(key.threadMessageId);
			},
		} as unknown as Pick<
			IThreadMessageRepository,
			"findAllByMessageId" | "deleteMany"
		>,
	};
};

/**
 * A move to Trash writes the destination into `mailboxId` while `uid` still
 * names the source folder's uid, and `updateForMove` keeps the source pair on
 * the row. That source uid is what the resolver asks the source folder about.
 */
const pendingDeleteRow = (): MessageRow => ({
	messageId: "msg-1",
	mailboxId: "mbx-trash",
	uid: 101,
	status: "moving",
	syncStatus: "failed",
	originalMailboxId: "mbx-inbox",
	originalUid: 101,
});

const input = {
	accountId: "acc-1",
	accountConfigId: "cfg-1",
	messageId: "msg-1",
	uid: 101,
	sourceMailboxPath: "INBOX",
};

describe("resolveExhaustedMessageDeleteFailure — the two terminal outcomes (issue #980)", () => {
	it("RECONCILED: the message is gone from the delete's source — stale row reconciled, no alarm", async () => {
		const repos = buildRepositories(pendingDeleteRow());
		const { log, infos, errors } = buildLogger();
		const deps: ResolveExhaustedMessageDeleteDeps = {
			messageService: repos.messageService,
			threadMessageService: repos.threadMessageService,
			log,
		};

		const result = await resolveExhaustedMessageDeleteFailure(deps, {
			...input,
			getConnection: async () => buildConnection(new Set()),
		});

		assert.equal(result.outcome, "reconciled");
		assert.equal(
			repos.messages.get("msg-1"),
			undefined,
			"the stale Message row is deleted so a resync can re-project it, and Empty Trash can no longer expunge by its uid",
		);
		assert.equal(repos.threadMessages.size, 0);
		assert.equal(errors.length, 0, "no alarm for the expected/routine outcome");
		assert.ok(
			infos.some((e) => e.obj.metric === "message_delete_stale_row_reconciled"),
		);
	});

	it("BROKEN: the message is still at the source — the row is left EXACTLY as it stands, alarm logged, never re-thrown", async () => {
		const repos = buildRepositories(pendingDeleteRow());
		const { log, errors } = buildLogger();
		const deps: ResolveExhaustedMessageDeleteDeps = {
			messageService: repos.messageService,
			threadMessageService: repos.threadMessageService,
			log,
		};

		const result = await resolveExhaustedMessageDeleteFailure(deps, {
			...input,
			getConnection: async () => buildConnection(new Set([101])),
		});

		assert.equal(result.outcome, "broken");
		assert.deepEqual(
			repos.messages.get("msg-1"),
			pendingDeleteRow(),
			"a delete that never reached the server is never applied or reverted locally (PR #652)",
		);
		assert.equal(repos.threadMessages.size, 1);
		assert.ok(errors.some((e) => e.obj.alert === "message_delete_failed"));
	});

	it("BROKEN: an empty FETCH the SEARCH contradicts never counts as gone", async () => {
		const repos = buildRepositories(pendingDeleteRow());
		const { log } = buildLogger();
		const deps: ResolveExhaustedMessageDeleteDeps = {
			messageService: repos.messageService,
			threadMessageService: repos.threadMessageService,
			log,
		};

		const result = await resolveExhaustedMessageDeleteFailure(deps, {
			...input,
			getConnection: async () =>
				buildConnection(new Set([101]), new Set([101])),
		});

		assert.equal(result.outcome, "broken");
		assert.deepEqual(repos.messages.get("msg-1"), pendingDeleteRow());
	});

	it("opens the source read-only — a verification probe never SELECTs a box writable", async () => {
		const repos = buildRepositories(pendingDeleteRow());
		const { log } = buildLogger();
		const opened: unknown[][] = [];
		const connection = buildConnection(new Set([101]));

		await resolveExhaustedMessageDeleteFailure(
			{
				messageService: repos.messageService,
				threadMessageService: repos.threadMessageService,
				log,
			},
			{
				...input,
				getConnection: async () =>
					({
						...connection,
						openBox: async (...args: unknown[]) => {
							opened.push(args);
							return {} as never;
						},
					}) as unknown as IImapConnection,
			},
		);

		assert.deepEqual(opened, [["INBOX", true]]);
	});

	it("an unreachable server reaches no verdict at all — the probe propagates and the row is untouched", async () => {
		const repos = buildRepositories(pendingDeleteRow());
		const { log } = buildLogger();
		const deps: ResolveExhaustedMessageDeleteDeps = {
			messageService: repos.messageService,
			threadMessageService: repos.threadMessageService,
			log,
		};

		await assert.rejects(
			() =>
				resolveExhaustedMessageDeleteFailure(deps, {
					...input,
					getConnection: async () => {
						throw new Error("ECONNRESET");
					},
				}),
			/ECONNRESET/,
		);

		assert.deepEqual(
			repos.messages.get("msg-1"),
			pendingDeleteRow(),
			"absence is only ever concluded from an answer the server gave",
		);
	});
});
