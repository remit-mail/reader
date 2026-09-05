import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import {
	type IImapConnection,
	placementBindingOf,
} from "@remit/mailbox-service";
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

interface ThreadRow {
	accountConfigId: string;
	threadMessageId: string;
	mailboxId: string;
	uid: number;
	isDeleted: boolean;
}

/**
 * The move's pending state IS the Message row, so these fakes hold real rows
 * and the assertions read the rows back — a resolver that settled the row on
 * anything but the server's own answer shows up here as a changed row, not as
 * an uncalled mock. `updateUid` writes what the repository writes: the settled
 * pair AND the `active`/`synced` that clears `moving`.
 */
const buildRepositories = (row: MessageRow) => {
	const messages = new Map<string, MessageRow>([[row.messageId, row]]);
	const threadMessages = new Map<string, ThreadRow>([
		[
			`tm-${row.messageId}`,
			{
				accountConfigId: "cfg-1",
				threadMessageId: `tm-${row.messageId}`,
				mailboxId: row.mailboxId,
				uid: row.uid,
				isDeleted: false,
			},
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
			updateUid: async (
				messageId: string,
				newUid: number,
				newMailboxId: string,
			) => {
				const current = messages.get(messageId);
				if (current)
					messages.set(messageId, {
						...current,
						uid: newUid,
						mailboxId: newMailboxId,
						status: "active",
						syncStatus: "synced",
					});
			},
		} as unknown as Pick<IMessageRepository, "delete" | "updateUid">,
		threadMessageService: {
			findAllByMessageId: async () => [...threadMessages.values()],
			deleteMany: async (
				keys: Array<{ accountConfigId: string; threadMessageId: string }>,
			) => {
				for (const key of keys) threadMessages.delete(key.threadMessageId);
			},
			update: async (
				_accountConfigId: string,
				threadMessageId: string,
				set: Partial<ThreadRow>,
			) => {
				const current = threadMessages.get(threadMessageId);
				if (current)
					threadMessages.set(threadMessageId, { ...current, ...set });
			},
		} as unknown as Pick<
			IThreadMessageRepository,
			"findAllByMessageId" | "deleteMany" | "update"
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
	sourceMailboxId: "mbx-inbox",
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

	it("BROKEN: the message is still at the source — the row is put back on the pair the server confirmed, alarm logged, never re-thrown", async () => {
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
		assert.equal(repos.messages.get("msg-1")?.mailboxId, "mbx-inbox");
		assert.equal(repos.messages.get("msg-1")?.uid, 101);
		assert.equal(
			repos.threadMessages.get("tm-msg-1")?.mailboxId,
			"mbx-inbox",
			"the listing row follows the message back to the folder it never left",
		);
		assert.ok(errors.some((e) => e.obj.alert === "message_move_failed"));
	});

	// Issue #1005: only `updateUid` clears `moving`, so a give-up that returned
	// without calling it left the row naming the destination with the source's
	// uid — a pair `bindsForeignUid` refuses, which made the message
	// undeletable and unmovable for good.
	it("BROKEN: the settled row is no longer refused by the placement guard (#1005)", async () => {
		const repos = buildRepositories(pendingMoveRow());
		const { log } = buildLogger();
		const deps: ResolveExhaustedMessageMoveDeps = {
			messageService: repos.messageService,
			threadMessageService: repos.threadMessageService,
			log,
		};

		assert.equal(
			placementBindingOf(pendingMoveRow() as never),
			"abandoned",
			"the row starts in the state the delete route refuses as unverified",
		);

		await resolveExhaustedMessageMoveFailure(deps, {
			...input,
			getConnection: async () => buildConnection(new Set([101])),
		});

		const settled = repos.messages.get("msg-1");
		assert.ok(settled);
		assert.equal(placementBindingOf(settled as never), "consistent");
		assert.equal(settled.status, "active");
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
		assert.equal(
			repos.messages.get("msg-1")?.mailboxId,
			"mbx-inbox",
			"a message the SEARCH still lists is at the source, and the row says so",
		);
	});

	// The resolver's contract is that it is never re-thrown, so the caller can
	// ack the record and emit its resync. A row another path deleted while the
	// probe was in flight has nothing left to restore, and the same NotFound
	// wraps an ElectroDB composites miss on the listing row.
	it("BROKEN: a row deleted underneath the probe settles instead of throwing", async () => {
		const repos = buildRepositories(pendingMoveRow());
		const notFound = Object.assign(new Error("Message not found: msg-1"), {
			name: "NotFoundError",
		});
		const { log } = buildLogger();
		const deps: ResolveExhaustedMessageMoveDeps = {
			messageService: {
				...repos.messageService,
				updateUid: async () => {
					throw notFound;
				},
			} as unknown as ResolveExhaustedMessageMoveDeps["messageService"],
			threadMessageService: repos.threadMessageService,
			log,
		};

		const result = await resolveExhaustedMessageMoveFailure(deps, {
			...input,
			getConnection: async () => buildConnection(new Set([101])),
		});

		assert.equal(result.outcome, "broken");
	});

	it("BROKEN: a listing row whose composites moved on does not fail the settle", async () => {
		const repos = buildRepositories(pendingMoveRow());
		const { log } = buildLogger();
		const deps: ResolveExhaustedMessageMoveDeps = {
			messageService: repos.messageService,
			threadMessageService: {
				...repos.threadMessageService,
				update: async () => {
					throw Object.assign(new Error("Thread message not found"), {
						name: "NotFoundError",
					});
				},
			} as unknown as ResolveExhaustedMessageMoveDeps["threadMessageService"],
			log,
		};

		const result = await resolveExhaustedMessageMoveFailure(deps, {
			...input,
			getConnection: async () => buildConnection(new Set([101])),
		});

		assert.equal(result.outcome, "broken");
		assert.equal(
			repos.messages.get("msg-1")?.mailboxId,
			"mbx-inbox",
			"the Message row still lands on the pair the server confirmed",
		);
	});

	it("a repository fault that is not a missing row still propagates", async () => {
		const repos = buildRepositories(pendingMoveRow());
		const { log } = buildLogger();
		const deps: ResolveExhaustedMessageMoveDeps = {
			messageService: {
				...repos.messageService,
				updateUid: async () => {
					throw new Error("ProvisionedThroughputExceeded");
				},
			} as unknown as ResolveExhaustedMessageMoveDeps["messageService"],
			threadMessageService: repos.threadMessageService,
			log,
		};

		await assert.rejects(
			() =>
				resolveExhaustedMessageMoveFailure(deps, {
					...input,
					getConnection: async () => buildConnection(new Set([101])),
				}),
			/ProvisionedThroughputExceeded/,
		);
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
