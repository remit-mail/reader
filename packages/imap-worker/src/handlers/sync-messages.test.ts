import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AccountItem,
	IMessageFlagPushRepository,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import type { Logger } from "@remit/logger-lambda";
import type { SyncMessagesEvent } from "../events.js";
import {
	drainPendingFlagPushes,
	type SyncMessagesDeps,
	syncMessages,
} from "./sync-messages.js";

const buildLogger = (): {
	log: Logger;
	infos: Array<{ fields: Record<string, unknown>; msg: string }>;
	warns: Array<{ fields: Record<string, unknown>; msg: string }>;
	errors: Array<{ fields: Record<string, unknown>; msg: string }>;
} => {
	const infos: Array<{ fields: Record<string, unknown>; msg: string }> = [];
	const warns: Array<{ fields: Record<string, unknown>; msg: string }> = [];
	const errors: Array<{ fields: Record<string, unknown>; msg: string }> = [];
	const log = {
		info: (fields: Record<string, unknown>, msg: string) => {
			infos.push({ fields, msg });
		},
		warn: (fields: Record<string, unknown>, msg: string) => {
			warns.push({ fields, msg });
		},
		error: (fields: Record<string, unknown>, msg: string) => {
			errors.push({ fields, msg });
		},
		debug: () => {},
		fatal: () => {},
		trace: () => {},
		child: () => log,
	} as unknown as Logger;
	return { log, infos, warns, errors };
};

const account = {
	accountId: "acc-1",
	accountConfigId: "acc-cfg-1",
} as unknown as AccountItem;

const marker = (overrides: Partial<Record<string, unknown>> = {}) => ({
	messageId: "msg-1",
	flagName: "\\Seen",
	accountId: "acc-1",
	accountConfigId: "acc-cfg-1",
	mailboxId: "mbx-1",
	operation: "add",
	state: "pending",
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

describe("drainPendingFlagPushes — periodic per-mailbox re-arm (issue #1273)", () => {
	it("re-emits FLAG_PUSH for every marker stuck in `pending` (crash between local write and enqueue)", async () => {
		const markerService = {
			listByMailboxId: async () => [marker()],
		} as unknown as IMessageFlagPushRepository;

		const emitted: unknown[] = [];
		const { log } = buildLogger();

		await drainPendingFlagPushes(
			markerService,
			account,
			"mbx-1",
			log,
			async (event) => {
				emitted.push(event);
			},
		);

		assert.equal(emitted.length, 1);
		assert.deepEqual(emitted[0], {
			type: "FLAG_PUSH",
			accountId: "acc-1",
			accountConfigId: "acc-cfg-1",
			messageId: "msg-1",
			flagName: "\\Seen",
		});
	});

	it("does NOT re-arm markers already queued or processing — a live driver already owns them", async () => {
		const markerService = {
			listByMailboxId: async () => [
				marker({ messageId: "queued-msg", state: "queued" }),
				marker({ messageId: "processing-msg", state: "processing" }),
			],
		} as unknown as IMessageFlagPushRepository;

		const emitted: unknown[] = [];
		const { log } = buildLogger();

		await drainPendingFlagPushes(
			markerService,
			account,
			"mbx-1",
			log,
			async (event) => {
				emitted.push(event);
			},
		);

		assert.equal(emitted.length, 0);
	});

	it("is a no-op when no markers exist for the mailbox", async () => {
		const markerService = {
			listByMailboxId: async () => [],
		} as unknown as IMessageFlagPushRepository;

		const emitted: unknown[] = [];
		const { log, infos } = buildLogger();

		await drainPendingFlagPushes(
			markerService,
			account,
			"mbx-1",
			log,
			async (event) => {
				emitted.push(event);
			},
		);

		assert.equal(emitted.length, 0);
		assert.equal(infos.length, 0);
	});

	it("re-arms multiple stuck markers for the same mailbox (per-field, independent)", async () => {
		const markerService = {
			listByMailboxId: async () => [
				marker({ flagName: "\\Seen" }),
				marker({ flagName: "\\Flagged" }),
			],
		} as unknown as IMessageFlagPushRepository;

		const emitted: unknown[] = [];
		const { log } = buildLogger();

		await drainPendingFlagPushes(
			markerService,
			account,
			"mbx-1",
			log,
			async (event) => {
				emitted.push(event);
			},
		);

		assert.equal(emitted.length, 2);
	});

	/**
	 * Markers persisted before the system-flag wire-format fix carry the
	 * unprefixed spelling (`Seen`, not `\Seen`) the enum emitter used to
	 * produce. The drain re-arms from the stored `marker.flagName` and never
	 * from the enum, and `handleFlagPush` threads that same value through
	 * `find`/`updateState`/`delete` — so a marker written under the old
	 * spelling still matches itself and drains to completion. No migration,
	 * no orphans.
	 */
	it("re-arms a marker persisted under the pre-fix unprefixed spelling verbatim", async () => {
		const markerService = {
			listByMailboxId: async () => [
				marker({ messageId: "legacy-msg", flagName: "Seen" }),
				marker({ messageId: "legacy-star", flagName: "Flagged" }),
			],
		} as unknown as IMessageFlagPushRepository;

		const emitted: Array<{ messageId: string; flagName: string }> = [];
		const { log } = buildLogger();

		await drainPendingFlagPushes(
			markerService,
			account,
			"mbx-1",
			log,
			async (event) => {
				emitted.push(event as unknown as (typeof emitted)[number]);
			},
		);

		assert.deepEqual(
			emitted.map((e) => [e.messageId, e.flagName]),
			[
				["legacy-msg", "Seen"],
				["legacy-star", "Flagged"],
			],
		);
	});

	it("a re-arm (SQS) failure is caught per-marker and logged loudly — never thrown", async () => {
		const markerService = {
			listByMailboxId: async () => [marker()],
		} as unknown as IMessageFlagPushRepository;

		const { log, errors } = buildLogger();

		await assert.doesNotReject(
			drainPendingFlagPushes(markerService, account, "mbx-1", log, async () => {
				throw Object.assign(new Error("queue down"), { code: "ECONNREFUSED" });
			}),
		);

		const alerted = errors.find(
			(e) => e.fields.alert === "flag_push_drain_rearm_failed",
		);
		assert.ok(
			alerted,
			"expected an alertable flag_push_drain_rearm_failed log",
		);
	});

	it("a re-arm failure for one marker does not stop the others from being re-armed", async () => {
		const markerService = {
			listByMailboxId: async () => [
				marker({ messageId: "will-fail", flagName: "\\Seen" }),
				marker({ messageId: "will-succeed", flagName: "\\Flagged" }),
			],
		} as unknown as IMessageFlagPushRepository;

		const emitted: unknown[] = [];
		const { log } = buildLogger();

		await drainPendingFlagPushes(
			markerService,
			account,
			"mbx-1",
			log,
			async (event) => {
				if (
					(event as unknown as { messageId: string }).messageId === "will-fail"
				) {
					throw new Error("queue down");
				}
				emitted.push(event);
			},
		);

		assert.equal(emitted.length, 1);
		assert.equal(
			(emitted[0] as { messageId: string }).messageId,
			"will-succeed",
		);
	});
});

const liveAccount = {
	accountId: "acc-1",
	accountConfigId: "acc-cfg-1",
	imapHost: "localhost",
	username: "user@localhost",
} as unknown as AccountItem;

const syncEvent = (mailboxId: string): SyncMessagesEvent => ({
	type: "SYNC_MESSAGES",
	accountId: "acc-1",
	mailboxId,
	eventId: `evt-${mailboxId}`,
	timestamp: 1,
});

/**
 * A deps factory whose `withOAuthLifecycle` is a spy that records the call but
 * never invokes the sync callback — the only thing under test here is the
 * terminal gate BEFORE the lifecycle, so reaching (or not reaching) the spy is
 * the observable outcome.
 */
const buildSyncDeps = (opts: {
	mailboxGet: () => Promise<unknown>;
	accountGet?: () => Promise<AccountItem>;
}): { deps: SyncMessagesDeps; lifecycleCalls: number } => {
	const state = { lifecycleCalls: 0 };
	const deps = {
		getClient: async () => ({
			account: {
				get: opts.accountGet ?? (async () => liveAccount),
			},
			mailbox: {
				get: opts.mailboxGet,
			},
			secrets: {},
		}),
		buildLifecycleDeps: () => ({}),
		withOAuthLifecycle: async () => {
			state.lifecycleCalls += 1;
		},
	} as unknown as SyncMessagesDeps;
	return {
		deps,
		get lifecycleCalls() {
			return state.lifecycleCalls;
		},
	};
};

describe("syncMessages — terminal handling of events for a deleted mailbox (issue #287)", () => {
	it("acks a SYNC_MESSAGES event whose mailbox row is gone — resolves without throwing, never connects", async () => {
		const { log, warns } = buildLogger();
		const harness = buildSyncDeps({
			mailboxGet: async () => {
				throw new NotFoundError("Mailbox not found: mbx-gone");
			},
		});

		await assert.doesNotReject(
			syncMessages(syncEvent("mbx-gone"), log, harness.deps),
		);

		assert.equal(
			harness.lifecycleCalls,
			0,
			"a deleted mailbox must short-circuit before the OAuth/connection lifecycle",
		);
		const skip = warns.find((w) =>
			w.msg.includes("the server does not hold this folder"),
		);
		assert.ok(skip, "expected a WARN naming the skipped deleted mailbox");
		assert.equal(skip.fields.accountId, "acc-1");
		assert.equal(skip.fields.mailboxId, "mbx-gone");
		assert.equal(skip.fields.event, "SYNC_MESSAGES");
	});

	it("propagates a non-NotFound failure from the mailbox lookup — a transient read stays loud", async () => {
		const { log } = buildLogger();
		const harness = buildSyncDeps({
			mailboxGet: async () => {
				throw new Error("connection reset by peer");
			},
		});

		await assert.rejects(
			syncMessages(syncEvent("mbx-1"), log, harness.deps),
			/connection reset by peer/,
		);
		assert.equal(harness.lifecycleCalls, 0);
	});

	it("proceeds to the sync lifecycle for a live mailbox", async () => {
		const { log } = buildLogger();
		const harness = buildSyncDeps({
			mailboxGet: async () => ({ mailboxId: "mbx-1", fullPath: "INBOX" }),
		});

		await syncMessages(syncEvent("mbx-1"), log, harness.deps);

		assert.equal(harness.lifecycleCalls, 1);
	});

	for (const syncStatus of ["pending", "deleting"]) {
		it(`acks a SYNC_MESSAGES event for a \`${syncStatus}\` mailbox — the row exists, the server folder does not`, async () => {
			const { log, warns } = buildLogger();
			const harness = buildSyncDeps({
				mailboxGet: async () => ({
					mailboxId: "mbx-unsettled",
					fullPath: "Archive",
					syncStatus,
				}),
			});

			await assert.doesNotReject(
				syncMessages(syncEvent("mbx-unsettled"), log, harness.deps),
			);

			assert.equal(harness.lifecycleCalls, 0);
			assert.ok(
				warns.find((w) =>
					w.msg.includes("the server does not hold this folder"),
				),
			);
		});
	}

	it("a deleted-mailbox event does not stall the group — a following live-mailbox event still processes", async () => {
		const { log } = buildLogger();
		const gone = buildSyncDeps({
			mailboxGet: async () => {
				throw new NotFoundError("Mailbox not found: mbx-gone");
			},
		});
		const live = buildSyncDeps({
			mailboxGet: async () => ({ mailboxId: "mbx-live", fullPath: "INBOX" }),
		});

		await syncMessages(syncEvent("mbx-gone"), log, gone.deps);
		await syncMessages(syncEvent("mbx-live"), log, live.deps);

		assert.equal(gone.lifecycleCalls, 0);
		assert.equal(live.lifecycleCalls, 1);
	});
});

/**
 * A deps factory that runs the lifecycle and the mailbox lock for real, so the
 * sync body — and the failure handling around it — is what gets exercised.
 * `mailboxGet` is called per lookup, which is how a delete landing mid-round is
 * expressed: the guard's read succeeds, a later one does not.
 */
const buildRunningSyncDeps = (
	mailboxGet: (call: number) => Promise<unknown>,
): {
	deps: SyncMessagesDeps;
	accountUpdates: Array<Record<string, unknown>>;
} => {
	const accountUpdates: Array<Record<string, unknown>> = [];
	let calls = 0;
	const deps = {
		getClient: async () => ({
			account: {
				get: async () => liveAccount,
				update: async (_id: string, input: Record<string, unknown>) => {
					accountUpdates.push(input);
				},
			},
			mailbox: {
				get: async () => {
					calls += 1;
					return mailboxGet(calls);
				},
			},
			mailboxLock: {
				withMailboxLock: async (
					_mailboxId: string,
					_operation: string,
					_accountId: string,
					run: () => Promise<void>,
				) => {
					await run();
					return { executed: true };
				},
			},
			flagPush: { listByMailboxId: async () => [] },
			secrets: {},
		}),
		buildLifecycleDeps: () => ({}),
		withOAuthLifecycle: async (
			_lifecycleDeps: unknown,
			_account: AccountItem,
			_log: Logger,
			run: (credentials: unknown) => Promise<void>,
		) => {
			await run({ type: "password", password: "pw" });
		},
	} as unknown as SyncMessagesDeps;
	return { deps, accountUpdates };
};

describe("syncMessages — a delete that lands mid-round (issue #339)", () => {
	it("resolves terminally when the mailbox went away while the sync was in flight, and records no error phase", async () => {
		const { log, warns } = buildLogger();
		const harness = buildRunningSyncDeps(async (call) => {
			if (call === 1) return { mailboxId: "mbx-1", fullPath: "Archive" };
			throw new NotFoundError("Mailbox not found: mbx-1");
		});

		await assert.doesNotReject(
			syncMessages(syncEvent("mbx-1"), log, harness.deps),
		);

		const resolved = warns.find((w) =>
			w.msg.includes("left the server while the sync was in flight"),
		);
		assert.ok(
			resolved,
			"expected a WARN naming the folder that left mid-round",
		);
		assert.equal(resolved.fields.mailboxId, "mbx-1");
		assert.deepEqual(
			harness.accountUpdates,
			[],
			"one folder leaving must not put the account into an error phase",
		);
	});

	it("resolves terminally when the failure is on the server and the row is only marked deleting", async () => {
		const { log, warns } = buildLogger();
		const harness = buildRunningSyncDeps(async (call) => {
			if (call === 1) return { mailboxId: "mbx-1", fullPath: "Archive" };
			if (call === 2) throw new Error("IMAP SEARCH failed in mailbox null");
			return {
				mailboxId: "mbx-1",
				fullPath: "Archive",
				syncStatus: "deleting",
			};
		});

		await assert.doesNotReject(
			syncMessages(syncEvent("mbx-1"), log, harness.deps),
		);

		assert.ok(
			warns.find((w) =>
				w.msg.includes("left the server while the sync was in flight"),
			),
		);
		assert.deepEqual(harness.accountUpdates, []);
	});

	/**
	 * The classifying read must not become the reported failure. A throttled or
	 * unreachable repository during the catch previously propagated in place of
	 * the real IMAP error, and the `syncPhase: error` write below it never ran —
	 * the let-it-crash contract lost both the diagnosis and the state.
	 */
	it("reports the real failure, and still records the error phase, when the classifying read itself fails", async () => {
		const { log } = buildLogger();
		const harness = buildRunningSyncDeps(async (call) => {
			if (call === 1) return { mailboxId: "mbx-1", fullPath: "Archive" };
			if (call === 2) throw new Error("IMAP SEARCH failed in mailbox null");
			throw new Error("dynamodb throttled");
		});

		await assert.rejects(
			syncMessages(syncEvent("mbx-1"), log, harness.deps),
			/IMAP SEARCH failed in mailbox null/,
		);
		assert.equal(harness.accountUpdates.length, 1);
		assert.equal(harness.accountUpdates[0]?.syncPhase, "error");
		assert.match(
			String(harness.accountUpdates[0]?.lastError),
			/IMAP SEARCH failed in mailbox null/,
		);
	});

	it("still fails loudly when the mailbox is live — the failure is the account's, not a deletion", async () => {
		const { log } = buildLogger();
		const harness = buildRunningSyncDeps(async (call) => {
			if (call === 2) throw new Error("connection reset by peer");
			return { mailboxId: "mbx-1", fullPath: "Archive" };
		});

		await assert.rejects(
			syncMessages(syncEvent("mbx-1"), log, harness.deps),
			/connection reset by peer/,
		);
		assert.equal(harness.accountUpdates.length, 1);
		assert.equal(harness.accountUpdates[0]?.syncPhase, "error");
	});
});
