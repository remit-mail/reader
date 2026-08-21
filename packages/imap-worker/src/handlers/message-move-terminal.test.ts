import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import type { IImapConnection } from "@remit/mailbox-service";
import {
	type MessageMoveTerminalLogger,
	type ResolveExhaustedMessageMoveDeps,
	resolveExhaustedMessageMoveFailure,
} from "./message-move-terminal.js";

interface LogEntry {
	obj: Record<string, unknown>;
	msg: string;
}

const buildLogger = (): {
	log: MessageMoveTerminalLogger;
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
 * The move's pending state IS the Message row, so these fakes hold real rows
 * and the assertions read the rows back — a resolver that reverted the
 * optimistic move (PR #652's defect) would show up here as a changed row, not
 * as an uncalled mock.
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

const pendingMoveRow = (): MessageRow => ({
	messageId: "msg-1",
	mailboxId: "mbx-archive",
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

describe("resolveExhaustedMessageMoveFailure — the two terminal outcomes (issue #655)", () => {
	it("RECONCILED: the message is gone from the move's source — stale row reconciled, no alarm", async () => {
		const repos = buildRepositories(pendingMoveRow());
		const { log, infos, errors } = buildLogger();
		const deps: ResolveExhaustedMessageMoveDeps = {
			messageService: repos.messageService,
			threadMessageService: repos.threadMessageService,
			log,
		};

		const result = await resolveExhaustedMessageMoveFailure(deps, {
			...input,
			getConnection: async () => buildConnection(new Set()),
		});

		assert.equal(result.outcome, "reconciled");
		assert.equal(
			repos.messages.get("msg-1"),
			undefined,
			"the stale Message row is deleted so a resync can re-project it",
		);
		assert.equal(repos.threadMessages.size, 0);
		assert.equal(errors.length, 0, "no alarm for the expected/routine outcome");
		assert.ok(
			infos.some((e) => e.obj.metric === "message_move_stale_row_reconciled"),
		);
	});

	it("BROKEN: the message is still at the source — the row is left EXACTLY as it stands, alarm logged, never re-thrown", async () => {
		const repos = buildRepositories(pendingMoveRow());
		const { log, errors } = buildLogger();
		const deps: ResolveExhaustedMessageMoveDeps = {
			messageService: repos.messageService,
			threadMessageService: repos.threadMessageService,
			log,
		};

		const result = await resolveExhaustedMessageMoveFailure(deps, {
			...input,
			getConnection: async () => buildConnection(new Set([101])),
		});

		assert.equal(result.outcome, "broken");
		assert.deepEqual(
			repos.messages.get("msg-1"),
			pendingMoveRow(),
			"a move that never reached the server is never reverted locally (PR #652)",
		);
		assert.equal(repos.threadMessages.size, 1);
		assert.ok(errors.some((e) => e.obj.alert === "message_move_failed"));
	});

	it("BROKEN: an empty FETCH the SEARCH contradicts never counts as gone", async () => {
		const repos = buildRepositories(pendingMoveRow());
		const { log } = buildLogger();
		const deps: ResolveExhaustedMessageMoveDeps = {
			messageService: repos.messageService,
			threadMessageService: repos.threadMessageService,
			log,
		};

		const result = await resolveExhaustedMessageMoveFailure(deps, {
			...input,
			getConnection: async () =>
				buildConnection(new Set([101]), new Set([101])),
		});

		assert.equal(result.outcome, "broken");
		assert.deepEqual(repos.messages.get("msg-1"), pendingMoveRow());
	});

	it("an unreachable server reaches no verdict at all — the probe propagates and the row is untouched", async () => {
		const repos = buildRepositories(pendingMoveRow());
		const { log } = buildLogger();
		const deps: ResolveExhaustedMessageMoveDeps = {
			messageService: repos.messageService,
			threadMessageService: repos.threadMessageService,
			log,
		};

		await assert.rejects(
			() =>
				resolveExhaustedMessageMoveFailure(deps, {
					...input,
					getConnection: async () => {
						throw new Error("ECONNRESET");
					},
				}),
			/ECONNRESET/,
		);

		assert.deepEqual(
			repos.messages.get("msg-1"),
			pendingMoveRow(),
			"absence is only ever concluded from an answer the server gave",
		);
	});
});
