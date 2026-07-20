import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import type {
	StorageService,
	StoreBodyPartParams,
} from "@remit/storage-service";
import type { BodySyncLogger } from "./body-sync.js";
import {
	isMessageBodySyncBroken,
	type ResolveExhaustedBodySyncDeps,
	resolveExhaustedBodySyncFailures,
} from "./body-sync-terminal.js";
import type { IImapConnection } from "./types.js";

interface LogEntry {
	obj: Record<string, unknown>;
	msg: string;
}

const buildLogger = (): {
	log: BodySyncLogger;
	infos: LogEntry[];
	errors: LogEntry[];
} => {
	const infos: LogEntry[] = [];
	const errors: LogEntry[] = [];
	return {
		log: {
			info: (obj, msg) => infos.push({ obj, msg: msg ?? "" }),
			error: (obj, msg) => errors.push({ obj, msg: msg ?? "" }),
		},
		infos,
		errors,
	};
};

/** Message rows keyed by messageId; `uid` is the only field the resolver reads. */
const buildMessageService = (
	uidByMessageId: Record<string, number>,
	deleted: string[],
): Pick<IMessageRepository, "get" | "delete"> =>
	({
		get: async (messageId: string) => {
			const uid = uidByMessageId[messageId];
			if (uid === undefined) {
				throw new Error(`no fixture uid for ${messageId}`);
			}
			return { messageId, uid };
		},
		delete: async (messageId: string) => {
			deleted.push(messageId);
		},
	}) as unknown as Pick<IMessageRepository, "get" | "delete">;

const buildThreadMessageService = (
	deletedKeys: Array<{ accountConfigId: string; threadMessageId: string }>,
): Pick<IThreadMessageRepository, "findAllByMessageId" | "deleteMany"> =>
	({
		findAllByMessageId: async (accountConfigId: string, messageId: string) => [
			{
				accountConfigId,
				threadMessageId: `tm-${messageId}`,
				messageId,
			},
		],
		deleteMany: async (
			keys: Array<{ accountConfigId: string; threadMessageId: string }>,
		) => {
			deletedKeys.push(...keys);
		},
	}) as unknown as Pick<
		IThreadMessageRepository,
		"findAllByMessageId" | "deleteMany"
	>;

const buildStorageService = (
	brokenAlready: Set<string> = new Set(),
): {
	storageService: Pick<StorageService, "storeBodyPart" | "bodyPartExists">;
	stored: StoreBodyPartParams[];
} => {
	const stored: StoreBodyPartParams[] = [];
	return {
		stored,
		storageService: {
			storeBodyPart: async (params: StoreBodyPartParams) => {
				stored.push(params);
				brokenAlready.add(params.messageId);
				return {} as never;
			},
			bodyPartExists: async (
				_accountConfigId: string,
				_accountId: string,
				messageId: string,
				partPath: string,
			) => partPath === ".sync-failed" && brokenAlready.has(messageId),
		},
	};
};

/**
 * A connection whose `fetchMessages` returns a hit for every uid in `present`,
 * except those in `fetchDrops` — messages the server still has and SEARCH
 * still lists, whose FETCH row imapflow drops (#408).
 */
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

describe("resolveExhaustedBodySyncFailures — the two terminal outcomes", () => {
	it("outcome 1 (EXPECTED): a uid missing from IMAP reconciles the stale row, no alarm", async () => {
		const deletedMessages: string[] = [];
		const deletedThreadMessages: Array<{
			accountConfigId: string;
			threadMessageId: string;
		}> = [];
		const { storageService, stored } = buildStorageService();
		const { log, infos, errors } = buildLogger();

		const deps: ResolveExhaustedBodySyncDeps = {
			messageService: buildMessageService({ "msg-gone": 101 }, deletedMessages),
			threadMessageService: buildThreadMessageService(deletedThreadMessages),
			storageService,
			log,
		};

		const result = await resolveExhaustedBodySyncFailures(deps, {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			mailboxId: "mbx-1",
			mailboxPath: "INBOX",
			failedMessageIds: ["msg-gone"],
			getConnection: async () => buildConnection(new Set()),
		});

		assert.deepEqual(result.reconciledMessageIds, ["msg-gone"]);
		assert.deepEqual(result.brokenMessageIds, []);
		assert.deepEqual(deletedMessages, ["msg-gone"]);
		assert.deepEqual(deletedThreadMessages, [
			{ accountConfigId: "cfg-1", threadMessageId: "tm-msg-gone" },
		]);
		// No sentinel written, no alert-shaped log for the expected case.
		assert.equal(stored.length, 0);
		assert.equal(errors.length, 0);
		assert.ok(
			infos.some((e) => e.obj.metric === "body_sync_stale_row_reconciled"),
			"expects an info-level metric log, not an alert",
		);
	});

	it("outcome 2 (BROKEN): a uid IMAP still has persists the failed-forever sentinel and alerts", async () => {
		const deletedMessages: string[] = [];
		const { storageService, stored } = buildStorageService();
		const { log, errors } = buildLogger();

		const deps: ResolveExhaustedBodySyncDeps = {
			messageService: buildMessageService(
				{ "msg-broken": 202 },
				deletedMessages,
			),
			threadMessageService: buildThreadMessageService([]),
			storageService,
			log,
		};

		const result = await resolveExhaustedBodySyncFailures(deps, {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			mailboxId: "mbx-1",
			mailboxPath: "INBOX",
			failedMessageIds: ["msg-broken"],
			getConnection: async () => buildConnection(new Set([202])),
		});

		assert.deepEqual(result.brokenMessageIds, ["msg-broken"]);
		assert.deepEqual(result.reconciledMessageIds, []);
		// The row is never deleted for a broken (still-real) message.
		assert.deepEqual(deletedMessages, []);
		assert.equal(stored.length, 1);
		assert.equal(stored[0]?.partPath, ".sync-failed");
		assert.ok(
			errors.some((e) => e.obj.alert === "body_sync_message_broken"),
			"expects an alert-shaped error log for the broken case",
		);
	});

	it("a dropped FETCH row mid-batch is not absence: the live message keeps its rows", async () => {
		const deletedMessages: string[] = [];
		const deletedThreadMessages: Array<{
			accountConfigId: string;
			threadMessageId: string;
		}> = [];
		const { storageService } = buildStorageService();
		const { log } = buildLogger();

		const deps: ResolveExhaustedBodySyncDeps = {
			messageService: buildMessageService({ m1: 1, m2: 2 }, deletedMessages),
			threadMessageService: buildThreadMessageService(deletedThreadMessages),
			storageService,
			log,
		};

		// Both messages are live. The FETCH for m1 returns its row; the
		// immediately following FETCH for m2 drops its row (#408).
		const result = await resolveExhaustedBodySyncFailures(deps, {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			mailboxId: "mbx-1",
			mailboxPath: "INBOX",
			failedMessageIds: ["m1", "m2"],
			getConnection: async () => buildConnection(new Set([1, 2]), new Set([2])),
		});

		assert.deepEqual(result.reconciledMessageIds, []);
		assert.deepEqual(result.brokenMessageIds, ["m1", "m2"]);
		assert.deepEqual(deletedMessages, []);
		assert.deepEqual(deletedThreadMessages, []);
	});

	it("resolves a mixed batch into both outcomes independently", async () => {
		const deletedMessages: string[] = [];
		const { storageService } = buildStorageService();
		const { log } = buildLogger();

		const deps: ResolveExhaustedBodySyncDeps = {
			messageService: buildMessageService(
				{ "msg-gone": 1, "msg-broken": 2 },
				deletedMessages,
			),
			threadMessageService: buildThreadMessageService([]),
			storageService,
			log,
		};

		const result = await resolveExhaustedBodySyncFailures(deps, {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			mailboxId: "mbx-1",
			mailboxPath: "INBOX",
			failedMessageIds: ["msg-gone", "msg-broken"],
			getConnection: async () => buildConnection(new Set([2])),
		});

		assert.deepEqual(result.reconciledMessageIds, ["msg-gone"]);
		assert.deepEqual(result.brokenMessageIds, ["msg-broken"]);
	});

	it("no failed ids is a no-op — never opens a connection", async () => {
		const { storageService } = buildStorageService();
		const { log } = buildLogger();
		let connectionRequested = false;

		const deps: ResolveExhaustedBodySyncDeps = {
			messageService: buildMessageService({}, []),
			threadMessageService: buildThreadMessageService([]),
			storageService,
			log,
		};

		const result = await resolveExhaustedBodySyncFailures(deps, {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			mailboxId: "mbx-1",
			mailboxPath: "INBOX",
			failedMessageIds: [],
			getConnection: async () => {
				connectionRequested = true;
				return buildConnection(new Set());
			},
		});

		assert.deepEqual(result, {
			reconciledMessageIds: [],
			brokenMessageIds: [],
		});
		assert.equal(connectionRequested, false);
	});
});

describe("isMessageBodySyncBroken", () => {
	it("delegates to bodyPartExists with the sentinel path", async () => {
		const { storageService } = buildStorageService(new Set(["msg-1"]));

		assert.equal(
			await isMessageBodySyncBroken(storageService, "cfg-1", "acc-1", "msg-1"),
			true,
		);
		assert.equal(
			await isMessageBodySyncBroken(storageService, "cfg-1", "acc-1", "msg-2"),
			false,
		);
	});
});
