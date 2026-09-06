import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	MessageItem,
	PlacementPredicate,
	PlacementTransitionInput,
} from "@remit/data-ports";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
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

interface Transition {
	messageId: string;
	expected: PlacementPredicate;
	next: PlacementTransitionInput;
}

interface Recorder {
	deps: ResolveExhaustedPlacementMoveDeps;
	infos: LogEntry[];
	errors: LogEntry[];
	markerDeletes: string[];
	deletedMessages: string[];
	deletedThreadMessages: Array<{
		accountConfigId: string;
		threadMessageId: string;
	}>;
	transitions: Transition[];
	threadUpdates: string[];
}

const buildRecorder = (
	threadMessages: Array<{ accountConfigId: string; threadMessageId: string }>,
	transitionWins = true,
): Recorder => {
	const infos: LogEntry[] = [];
	const errors: LogEntry[] = [];
	const markerDeletes: string[] = [];
	const deletedMessages: string[] = [];
	const deletedThreadMessages: Array<{
		accountConfigId: string;
		threadMessageId: string;
	}> = [];
	const transitions: Transition[] = [];
	const threadUpdates: string[] = [];

	const log: PlacementMoveLogger = {
		info: (obj, msg) => infos.push({ obj, msg }),
		error: (obj, msg) => errors.push({ obj, msg }),
	};

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
			transitionPlacement: async (
				messageId: string,
				expected: PlacementPredicate,
				next: PlacementTransitionInput,
			) => {
				transitions.push({ messageId, expected, next });
				return transitionWins ? ({ messageId } as MessageItem) : undefined;
			},
		},
		threadMessageService: {
			findAllByMessageId: async () => threadMessages as never,
			deleteMany: async (
				keys: Array<{ accountConfigId: string; threadMessageId: string }>,
			) => {
				deletedThreadMessages.push(...keys);
			},
			update: async (_accountConfigId: string, threadMessageId: string) => {
				threadUpdates.push(threadMessageId);
				return undefined as never;
			},
		},
		log,
	};

	return {
		deps,
		infos,
		errors,
		markerDeletes,
		deletedMessages,
		deletedThreadMessages,
		transitions,
		threadUpdates,
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

describe("resolveExhaustedPlacementMoveFailure — the two terminal outcomes (mirrors #1270 for placement moves)", () => {
	it("RECONCILED (expected): the message is gone from its pending-move source — marker dropped, stale row reconciled, no alarm", async () => {
		const rec = buildRecorder([
			{ accountConfigId: "cfg-1", threadMessageId: "tm-msg-gone" },
		]);

		const result = await resolveExhaustedPlacementMoveFailure(rec.deps, {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			messageId: "msg-gone",
			uid: 101,
			sourceMailboxId: "mbx-junk",
			sourceMailboxPath: "Junk",
			getConnection: async () => buildConnection(new Set()),
		});

		assert.equal(result.outcome, "reconciled");
		assert.deepEqual(rec.markerDeletes, ["msg-gone"]);
		assert.deepEqual(rec.deletedMessages, ["msg-gone"]);
		assert.deepEqual(rec.deletedThreadMessages, [
			{ accountConfigId: "cfg-1", threadMessageId: "tm-msg-gone" },
		]);
		assert.equal(
			rec.errors.length,
			0,
			"no alarm for the expected/routine outcome",
		);
		assert.ok(
			rec.infos.some(
				(e) => e.obj.metric === "placement_move_stale_row_reconciled",
			),
		);
	});

	it("BROKEN: the message is still at the source — the row goes back to the source pair rather than being left `moving` forever", async () => {
		const rec = buildRecorder([
			{ accountConfigId: "cfg-1", threadMessageId: "tm-msg-broken" },
		]);

		const result = await resolveExhaustedPlacementMoveFailure(rec.deps, {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			messageId: "msg-broken",
			uid: 202,
			sourceMailboxId: "mbx-inbox",
			sourceMailboxPath: "INBOX",
			getConnection: async () => buildConnection(new Set([202])),
		});

		assert.equal(result.outcome, "broken");
		assert.deepEqual(rec.transitions, [
			{
				messageId: "msg-broken",
				expected: {
					status: [MessageStatus.moving, MessageStatus.deleting],
				},
				next: {
					mailboxId: "mbx-inbox",
					uid: 202,
					status: MessageStatus.active,
					syncStatus: MessageSyncStatus.synced,
				},
			},
		]);
		assert.deepEqual(rec.threadUpdates, ["tm-msg-broken"]);
		// The marker predicted a move that has now been given up on; leaving it
		// would keep a folder-count prediction nothing will ever settle.
		assert.deepEqual(rec.markerDeletes, ["msg-broken"]);
		assert.deepEqual(rec.deletedMessages, []);
		assert.ok(
			rec.errors.some((e) => e.obj.alert === "placement_move_failed"),
			"the operator signal is the alert, not a stuck row",
		);
	});

	it("BROKEN with another lane already settled: the restore loses its predicate and writes nothing", async () => {
		const rec = buildRecorder(
			[{ accountConfigId: "cfg-1", threadMessageId: "tm-msg-raced" }],
			false,
		);

		const result = await resolveExhaustedPlacementMoveFailure(rec.deps, {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			messageId: "msg-raced",
			uid: 404,
			sourceMailboxId: "mbx-inbox",
			sourceMailboxPath: "INBOX",
			getConnection: async () => buildConnection(new Set([404])),
		});

		assert.equal(result.outcome, "broken");
		assert.equal(rec.transitions.length, 1);
		assert.deepEqual(
			rec.threadUpdates,
			[],
			"a lost predicate leaves the listing rows to whoever won",
		);
	});

	it("a dropped FETCH row is not absence: the message is still at the source — local rows survive", async () => {
		const rec = buildRecorder([
			{ accountConfigId: "cfg-1", threadMessageId: "tm-msg-live" },
		]);

		const result = await resolveExhaustedPlacementMoveFailure(rec.deps, {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			messageId: "msg-live",
			uid: 303,
			sourceMailboxId: "mbx-inbox",
			sourceMailboxPath: "INBOX",
			getConnection: async () =>
				buildConnection(new Set([303]), new Set([303])),
		});

		assert.equal(result.outcome, "broken");
		assert.deepEqual(rec.deletedMessages, []);
		assert.deepEqual(rec.deletedThreadMessages, []);
		assert.ok(rec.errors.some((e) => e.obj.alert === "placement_move_failed"));
	});

	it("never throws — both outcomes are terminal, the caller always acks", async () => {
		const rec = buildRecorder([]);

		await assert.doesNotReject(() =>
			resolveExhaustedPlacementMoveFailure(rec.deps, {
				accountId: "acc-1",
				accountConfigId: "cfg-1",
				messageId: "msg-x",
				uid: 1,
				sourceMailboxId: "mbx-inbox",
				sourceMailboxPath: "INBOX",
				getConnection: async () => buildConnection(new Set([1])),
			}),
		);
	});
});
