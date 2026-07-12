import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import type { FlagPushLogger } from "./flag-push.js";
import {
	type ResolveExhaustedFlagPushDeps,
	resolveExhaustedFlagPushFailure,
} from "./flag-push-terminal.js";
import type { IImapConnection } from "./types.js";

interface LogEntry {
	obj: Record<string, unknown>;
	msg: string;
}

const buildLogger = (): {
	log: FlagPushLogger;
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

describe("resolveExhaustedFlagPushFailure — the two terminal outcomes (mirrors #1289/#1270 for flag pushes)", () => {
	it("RECONCILED (expected): the message is gone from its mailbox — marker dropped, stale row reconciled, no alarm", async () => {
		const deletedMessages: string[] = [];
		const deletedThreadMessages: Array<{
			accountConfigId: string;
			threadMessageId: string;
		}> = [];
		const markerDeletes: Array<{ messageId: string; flagName: string }> = [];
		const { log, infos, errors } = buildLogger();

		const deps: ResolveExhaustedFlagPushDeps = {
			markerService: {
				delete: async (messageId: string, flagName: string) => {
					markerDeletes.push({ messageId, flagName });
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

		const result = await resolveExhaustedFlagPushFailure(deps, {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			messageId: "msg-gone",
			flagName: "\\Seen",
			uid: 101,
			mailboxPath: "INBOX",
			getConnection: async () => buildConnection(new Set()),
		});

		assert.equal(result.outcome, "reconciled");
		assert.deepEqual(markerDeletes, [
			{ messageId: "msg-gone", flagName: "\\Seen" },
		]);
		assert.deepEqual(deletedMessages, ["msg-gone"]);
		assert.equal(deletedThreadMessages.length, 1);

		assert.equal(errors.length, 0, "reconciled outcome must not log an alert");
		const metricLog = infos.find(
			(entry) => entry.obj.metric === "flag_push_stale_row_reconciled",
		);
		assert.ok(metricLog, "expected a routine reconciliation metric log");
	});

	it("BROKEN (should never happen): the message still exists — marker left in place, alert logged", async () => {
		const markerDeletes: Array<{ messageId: string; flagName: string }> = [];
		const { log, errors } = buildLogger();

		const deps: ResolveExhaustedFlagPushDeps = {
			markerService: {
				delete: async (messageId: string, flagName: string) => {
					markerDeletes.push({ messageId, flagName });
				},
			},
			messageService: {
				delete: async () => {
					throw new Error("must not be called — message still exists");
				},
			} as unknown as Pick<IMessageRepository, "delete">,
			threadMessageService: {
				findAllByMessageId: async () => {
					throw new Error("must not be called — message still exists");
				},
				deleteMany: async () => {
					throw new Error("must not be called — message still exists");
				},
			} as unknown as Pick<
				IThreadMessageRepository,
				"findAllByMessageId" | "deleteMany"
			>,
			log,
		};

		const result = await resolveExhaustedFlagPushFailure(deps, {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			messageId: "msg-still-here",
			flagName: "\\Flagged",
			uid: 202,
			mailboxPath: "INBOX",
			getConnection: async () => buildConnection(new Set([202])),
		});

		assert.equal(result.outcome, "broken");
		assert.deepEqual(
			markerDeletes,
			[],
			"marker must be left in place — resync never reverts a pending flag while it is",
		);

		const alerted = errors.find((e) => e.obj.alert === "flag_push_failed");
		assert.ok(alerted, "expected an alertable flag_push_failed log");
	});
});
