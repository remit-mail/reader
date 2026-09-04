import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { noopLogger } from "@remit/logger-lambda/noop-logger";
import type { AppendSentMessageEvent } from "../events.js";
import {
	APPEND_SENT_MAX_ATTEMPTS,
	type AppendSentMessageDeps,
	handleAppendSentMessage,
} from "./append-sent-message.js";

interface Call {
	method: string;
	args: unknown[];
}

interface Harness {
	calls: Call[];
	account: {
		accountId: string;
		accountConfigId: string;
		deletedAt?: number;
	};
	outbox: Record<string, unknown>;
	sentMailbox: { mailboxId: string; fullPath: string } | null;
	append: (
		path: string,
		raw: Buffer,
		flags: string[],
	) => Promise<{ uid: number; uidValidity: number }>;
	/** Stand in for a terminal auth failure: withOAuthLifecycle ACKs the record
	 * without ever running the work. */
	ackWithoutWork: boolean;
	disconnectCount: number;
}

let h: Harness;

const record =
	(method: string) =>
	async (...args: unknown[]) => {
		h.calls.push({ method, args });
	};

const fresh = (): Harness => ({
	calls: [],
	account: { accountId: "acc-1", accountConfigId: "cfg-1" },
	outbox: {
		status: "sent",
		fromName: "Alice",
		fromAddress: "alice@example.com",
		toAddresses: ["bob@example.com"],
		ccAddresses: ["carol@example.com"],
		subject: "Quarterly numbers",
		textBody: "See attached.",
		messageIdValue: "generated-id@example.com",
		references: ["parent@example.com"],
		inReplyTo: "parent@example.com",
		sentAt: 1700000000000,
		appendedUid: 0,
	},
	sentMailbox: { mailboxId: "sent-mbx", fullPath: "INBOX/Sent" },
	append: async (path, raw, flags) => {
		h.calls.push({ method: "connection.append", args: [path, raw, flags] });
		return { uid: 55, uidValidity: 7 };
	},
	ackWithoutWork: false,
	disconnectCount: 0,
});

const deps = (): AppendSentMessageDeps =>
	({
		getClient: async () => ({
			account: {
				get: async (accountId: string) => {
					h.calls.push({ method: "account.get", args: [accountId] });
					return h.account;
				},
			},
			outboxMessage: {
				get: async () => h.outbox,
				update: record("outboxMessage.update"),
				delete: record("outboxMessage.delete"),
			},
			outboxAttachment: {
				discardAll: record("outboxAttachment.discardAll"),
			},
			mailboxSpecialUse: {
				findSentMailbox: async () => h.sentMailbox,
			},
			secrets: {},
		}),
		buildLifecycleDeps: () => ({}),
		withOAuthLifecycle: async (
			_deps: unknown,
			_account: unknown,
			_log: unknown,
			cb: (credentials: unknown) => Promise<void>,
		) => (h.ackWithoutWork ? undefined : cb({})),
		createConnectionScope: () => ({
			getConnection: async () => ({
				append: (path: string, raw: Buffer, flags: string[]) =>
					h.append(path, raw, flags),
			}),
			disconnect: async () => {
				h.disconnectCount += 1;
			},
		}),
	}) as unknown as AppendSentMessageDeps;

const event: AppendSentMessageEvent = {
	type: "APPEND_SENT_MESSAGE",
	accountId: "acc-1",
	outboxMessageId: "out-1",
} as AppendSentMessageEvent;

const called = (method: string): Call[] =>
	h.calls.filter((c) => c.method === method);

const patches = (): unknown[] =>
	called("outboxMessage.update").map((c) => c.args[2]);

type BackendClient = Awaited<ReturnType<AppendSentMessageDeps["getClient"]>>;

const depsWithFailingDelete = (): AppendSentMessageDeps => {
	const base = deps();
	return {
		...base,
		getClient: async (): Promise<BackendClient> => {
			const client = await base.getClient();
			return {
				...client,
				outboxMessage: {
					...client.outboxMessage,
					delete: async (): Promise<void> => {
						throw new Error("storage down");
					},
				},
			};
		},
	};
};

const depsWithFailingUpdate = (): AppendSentMessageDeps => {
	const base = deps();
	return {
		...base,
		getClient: async (): Promise<BackendClient> => {
			const client = await base.getClient();
			return {
				...client,
				outboxMessage: {
					...client.outboxMessage,
					update: async (): Promise<never> => {
						throw new Error("storage down");
					},
				},
			};
		},
	};
};

describe("handleAppendSentMessage", () => {
	beforeEach(() => {
		h = fresh();
	});

	it("appends a seen RFC822 copy to the Sent folder and drops the outbox row", async () => {
		await handleAppendSentMessage(event, noopLogger, 1, deps());

		const append = called("connection.append")[0];
		assert.equal(append?.args[0], "INBOX/Sent");
		assert.deepEqual(append?.args[2], ["\\Seen"]);
		assert.deepEqual(called("outboxMessage.delete")[0]?.args, [
			"cfg-1",
			"out-1",
		]);
		assert.equal(h.disconnectCount, 1);
	});

	it("takes the draft's stored attachments with the row (#679)", async () => {
		await handleAppendSentMessage(event, noopLogger, 1, deps());

		// The row is the only reference to those objects. Sweeping has to happen
		// here too, not only on a discard, or a sent message leaves its files
		// behind with nothing able to reach them.
		assert.deepEqual(called("outboxAttachment.discardAll")[0]?.args, [
			"cfg-1",
			"acc-1",
			"out-1",
		]);
	});

	it("builds the message from the outbox row's own headers", async () => {
		await handleAppendSentMessage(event, noopLogger, 1, deps());

		const raw = String(called("connection.append")[0]?.args[1] as Buffer);
		assert.match(raw, /^From: Alice <alice@example\.com>$/m);
		assert.match(raw, /^To: bob@example\.com$/m);
		assert.match(raw, /^Cc: carol@example\.com$/m);
		assert.match(raw, /^Subject: Quarterly numbers$/m);
		assert.match(raw, /^Message-ID: <generated-id@example\.com>$/m);
		assert.match(raw, /^In-Reply-To: <parent@example\.com>$/m);
		assert.ok(raw.includes("See attached."));
	});

	it("uses a bare address when the outbox row carries no display name", async () => {
		h.outbox = { ...h.outbox, fromName: undefined };

		await handleAppendSentMessage(event, noopLogger, 1, deps());

		const raw = String(called("connection.append")[0]?.args[1] as Buffer);
		assert.match(raw, /^From: alice@example\.com$/m);
	});

	it("settles the row as unfiled when the account has no Sent folder at all", async () => {
		h.sentMailbox = null;

		await handleAppendSentMessage(event, noopLogger, 1, deps());

		assert.equal(called("connection.append").length, 0);
		assert.equal(called("outboxMessage.delete").length, 0);

		// The message was delivered over SMTP. Leaving the row at `sent` hides it
		// from the Outbox list and it exists in no server folder either, so the
		// user loses it entirely.
		const update = called("outboxMessage.update")[0];
		assert.deepEqual(update?.args.slice(0, 2), ["cfg-1", "out-1"]);
		const patch = update?.args[2] as { status: string; lastError: string };
		assert.equal(patch.status, "unfiled");
		assert.match(patch.lastError, /no folder appointed to the Sent role/);
	});

	it("skips the append while the outbox row is not yet sent", async () => {
		h.outbox = { ...h.outbox, status: "pending" };

		await handleAppendSentMessage(event, noopLogger, 1, deps());

		assert.equal(called("connection.append").length, 0);
		assert.equal(called("outboxMessage.delete").length, 0);
	});

	it("returns early without touching the outbox when the account is soft-deleted", async () => {
		h.account = { ...h.account, deletedAt: Date.now() };

		await handleAppendSentMessage(event, noopLogger, 1, deps());

		assert.equal(called("connection.append").length, 0);
		assert.equal(called("outboxMessage.delete").length, 0);
	});

	it("rethrows a failed APPEND while the queue still has attempts left", async () => {
		h.append = async () => {
			throw new Error("server exploded");
		};

		await assert.rejects(
			handleAppendSentMessage(event, noopLogger, 1, deps()),
			/server exploded/,
		);

		// Nothing settled: the row stays `sent` and the redelivered event tries
		// the APPEND again.
		assert.equal(called("outboxMessage.delete").length, 0);
		assert.equal(called("outboxMessage.update").length, 0);
		assert.equal(h.disconnectCount, 1);
	});

	it("settles the row as unfiled on the last attempt instead of dead-lettering it", async () => {
		h.append = async () => {
			throw new Error("server exploded");
		};

		await handleAppendSentMessage(
			event,
			noopLogger,
			APPEND_SENT_MAX_ATTEMPTS,
			deps(),
		);

		// A DLQ'd APPEND is how the message went missing: the row would keep the
		// `sent` status the Outbox list hides, and no Sent folder holds it.
		assert.equal(called("outboxMessage.delete").length, 0);
		const patch = called("outboxMessage.update")[0]?.args[2] as {
			status: string;
			lastError: string;
		};
		assert.equal(patch.status, "unfiled");
		assert.match(patch.lastError, /server exploded/);
	});

	it("settles the row as unfiled when a terminal auth failure acks the record", async () => {
		h.ackWithoutWork = true;

		await handleAppendSentMessage(event, noopLogger, 1, deps());

		const patch = called("outboxMessage.update")[0]?.args[2] as {
			status: string;
			lastError: string;
		};
		assert.equal(patch.status, "unfiled");
		assert.match(patch.lastError, /signed in again/);
	});

	it("leaves the row alone when the APPEND landed but the delete did not", async () => {
		await assert.rejects(
			handleAppendSentMessage(event, noopLogger, 1, depsWithFailingDelete()),
			/storage down/,
		);

		// The copy is in Sent, so the message is findable — settling it as unfiled
		// would say the opposite.
		assert.deepEqual(patches(), [{ appendedUid: 55 }]);
	});

	it("stops redelivering a landed APPEND at the budget instead of filing another copy", async () => {
		await handleAppendSentMessage(
			event,
			noopLogger,
			APPEND_SENT_MAX_ATTEMPTS,
			depsWithFailingDelete(),
		);

		assert.equal(called("connection.append").length, 1);
		assert.deepEqual(patches(), [{ appendedUid: 55 }]);
	});

	it("records the uid the APPEND produced before it deletes the row", async () => {
		await handleAppendSentMessage(event, noopLogger, 1, deps());

		// Order is the whole of it: a uid written after the delete is a uid a
		// redelivery never sees, and the redelivery is what files the second copy.
		const order = h.calls.map((c) => c.method);
		assert.deepEqual(patches(), [{ appendedUid: 55 }]);
		assert.ok(
			order.indexOf("outboxMessage.update") <
				order.indexOf("outboxMessage.delete"),
		);
	});

	it("records a copy the server filed but named no uid for", async () => {
		// UIDPLUS is an extension. Without it the APPEND succeeds and reports
		// nothing, and "filed" still has to be told apart from "not filed".
		h.append = async () => ({ uid: 0, uidValidity: 0 });

		await handleAppendSentMessage(event, noopLogger, 1, deps());

		assert.deepEqual(patches(), [{ appendedUid: -1 }]);
		assert.equal(called("outboxMessage.delete").length, 1);
	});

	it("files nothing a second time when a redelivery finds a recorded uid (#858)", async () => {
		h.outbox = { ...h.outbox, appendedUid: 55 };

		await handleAppendSentMessage(event, noopLogger, 1, deps());

		// The copy is already in the user's Sent folder. All this redelivery owes
		// is the delete the last attempt could not make.
		assert.equal(called("connection.append").length, 0);
		assert.equal(h.disconnectCount, 0);
		assert.deepEqual(called("outboxMessage.delete")[0]?.args, [
			"cfg-1",
			"out-1",
		]);
		assert.deepEqual(called("outboxAttachment.discardAll")[0]?.args, [
			"cfg-1",
			"acc-1",
			"out-1",
		]);
	});

	it("retries the delete a redelivery owes while the queue has attempts left", async () => {
		h.outbox = { ...h.outbox, appendedUid: 55 };

		await assert.rejects(
			handleAppendSentMessage(event, noopLogger, 1, depsWithFailingDelete()),
			/storage down/,
		);

		assert.equal(called("connection.append").length, 0);
		assert.deepEqual(patches(), []);
	});

	it("keeps the row when the uid cannot be recorded", async () => {
		await assert.rejects(
			handleAppendSentMessage(event, noopLogger, 1, depsWithFailingUpdate()),
			/storage down/,
		);

		// The other half of "written before the delete, never after". A row
		// deleted without its uid is a row a redelivery reads as never filed.
		assert.equal(called("outboxMessage.delete").length, 0);
		assert.equal(called("outboxAttachment.discardAll").length, 0);
	});

	it("acks an event whose outbox row is already gone", async () => {
		// Its own last attempt deleted it, or the boot repair dropped it. Throwing
		// the same NotFoundError on every redelivery only dead-letters the record.
		const notFound = Object.assign(new Error("gone"), {
			name: "NotFoundError",
		});
		const base = deps();
		const failing: AppendSentMessageDeps = {
			...base,
			getClient: async (): Promise<BackendClient> => {
				const client = await base.getClient();
				return {
					...client,
					outboxMessage: {
						...client.outboxMessage,
						get: async () => {
							throw notFound;
						},
					},
				} as BackendClient;
			},
		};

		await handleAppendSentMessage(event, noopLogger, 1, failing);

		assert.equal(called("connection.append").length, 0);
		assert.deepEqual(patches(), []);
	});

	it("gives up on that delete at the budget rather than dead-lettering it", async () => {
		h.outbox = { ...h.outbox, appendedUid: 55 };

		await handleAppendSentMessage(
			event,
			noopLogger,
			APPEND_SENT_MAX_ATTEMPTS,
			depsWithFailingDelete(),
		);

		// The row stays `sent` and hidden, which the boot-time repair drops on the
		// strength of the same recorded uid. Settling it as unfiled would tell the
		// user a message sitting in Sent was never filed.
		assert.deepEqual(patches(), []);
	});
});
