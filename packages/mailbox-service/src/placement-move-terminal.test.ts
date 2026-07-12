import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import type { PlacementMoveLogger } from "./placement-move.js";
import {
	type ResolveExhaustedPlacementMoveDeps,
	resolveExhaustedPlacementMoveFailure,
} from "./placement-move-terminal.js";
import type { IImapConnection } from "./types.js";

interface LogEntry {
	obj: Record<string, unknown>;
	msg: string;
}

const buildLogger = (): {
	log: PlacementMoveLogger;
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

const buildConnection = (present: Set<number>): IImapConnection =>
	({
		openBox: async () => ({}) as never,
		fetchMessages: async (uids: number[]) =>
			uids
				.filter((uid) => present.has(uid))
				.map((uid) => ({ uid }) as unknown as never),
	}) as unknown as IImapConnection;

describe("resolveExhaustedPlacementMoveFailure — the two terminal outcomes (mirrors #1270 for placement moves)", () => {
	it("RECONCILED (expected): the message is gone from its pending-move source — marker dropped, stale row reconciled, no alarm", async () => {
		const deletedMessages: string[] = [];
		const deletedThreadMessages: Array<{
			accountConfigId: string;
			threadMessageId: string;
		}> = [];
		const markerDeletes: string[] = [];
		const { log, infos, errors } = buildLogger();

		const deps: ResolveExhaustedPlacementMoveDeps = {
			markerService: {
				delete: async (id: string) => {
					markerDeletes.push(id);
				},
			},
			messageService: {
				delete: async (id: string) => {
					deletedMessages.push(id);
				},
			} as unknown as Pick<IMessageRepository, "delete">,
			threadMessageService: {
				findAllByMessageId: async (
					accountConfigId: string,
					messageId: string,
				) => [{ accountConfigId, threadMessageId: `tm-${messageId}` }],
				deleteMany: async (
					keys: Array<{ accountConfigId: string; threadMessageId: string }>,
				) => {
					deletedThreadMessages.push(...keys);
				},
			} as unknown as Pick<
				IThreadMessageRepository,
				"findAllByMessageId" | "deleteMany"
			>,
			log,
		};

		const result = await resolveExhaustedPlacementMoveFailure(deps, {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			messageId: "msg-gone",
			uid: 101,
			sourceMailboxPath: "Junk",
			getConnection: async () => buildConnection(new Set()),
		});

		assert.equal(result.outcome, "reconciled");
		assert.deepEqual(markerDeletes, ["msg-gone"]);
		assert.deepEqual(deletedMessages, ["msg-gone"]);
		assert.deepEqual(deletedThreadMessages, [
			{ accountConfigId: "cfg-1", threadMessageId: "tm-msg-gone" },
		]);
		assert.equal(errors.length, 0, "no alarm for the expected/routine outcome");
		assert.ok(
			infos.some((e) => e.obj.metric === "placement_move_stale_row_reconciled"),
		);
	});

	it("BROKEN: the message still exists at the source — marker LEFT PENDING (never dropped), alarm logged, never re-thrown", async () => {
		const deletedMessages: string[] = [];
		const markerDeletes: string[] = [];
		const { log, errors } = buildLogger();

		const deps: ResolveExhaustedPlacementMoveDeps = {
			markerService: {
				delete: async (id: string) => {
					markerDeletes.push(id);
				},
			},
			messageService: {
				delete: async (id: string) => {
					deletedMessages.push(id);
				},
			} as unknown as Pick<IMessageRepository, "delete">,
			threadMessageService: {
				findAllByMessageId: async () => [],
				deleteMany: async () => {},
			} as unknown as Pick<
				IThreadMessageRepository,
				"findAllByMessageId" | "deleteMany"
			>,
			log,
		};

		const result = await resolveExhaustedPlacementMoveFailure(deps, {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			messageId: "msg-broken",
			uid: 202,
			sourceMailboxPath: "INBOX",
			getConnection: async () => buildConnection(new Set([202])),
		});

		assert.equal(result.outcome, "broken");
		// The marker is the lock that stops a resync from correcting the message
		// back to its server location (rule 3) — dropping it here would remove
		// that protection while the move is still unresolved.
		assert.deepEqual(markerDeletes, []);
		assert.deepEqual(deletedMessages, []);
		assert.ok(
			errors.some((e) => e.obj.alert === "placement_move_failed"),
			"expected an alert-shaped log for the broken case",
		);
	});

	it("never throws — both outcomes are terminal, the caller always acks", async () => {
		const { log } = buildLogger();
		const deps: ResolveExhaustedPlacementMoveDeps = {
			markerService: { delete: async () => {} },
			messageService: {
				delete: async () => {},
			} as unknown as Pick<IMessageRepository, "delete">,
			threadMessageService: {
				findAllByMessageId: async () => [],
				deleteMany: async () => {},
			} as unknown as Pick<
				IThreadMessageRepository,
				"findAllByMessageId" | "deleteMany"
			>,
			log,
		};

		await assert.doesNotReject(() =>
			resolveExhaustedPlacementMoveFailure(deps, {
				accountId: "acc-1",
				accountConfigId: "cfg-1",
				messageId: "msg-x",
				uid: 1,
				sourceMailboxPath: "INBOX",
				getConnection: async () => buildConnection(new Set([1])),
			}),
		);
	});
});
