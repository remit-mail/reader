import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { Logger } from "@remit/logger-lambda";
import type { AppendSentMessageEvent } from "../events.js";
import {
	type AppendSentMessageDeps,
	handleAppendSentMessage,
} from "./append-sent-message.js";

const noopLog = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	fatal: () => {},
	trace: () => {},
	child: () => noopLog,
} as unknown as Logger;

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
	specialUseSent: { mailboxId: string; fullPath: string } | null;
	mailboxes: { mailboxId: string; fullPath: string }[];
	append: (
		path: string,
		raw: Buffer,
		flags: string[],
	) => Promise<{ uid: number; uidValidity: number }>;
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
	},
	specialUseSent: { mailboxId: "sent-mbx", fullPath: "Sent" },
	mailboxes: [
		{ mailboxId: "inbox-mbx", fullPath: "INBOX" },
		{ mailboxId: "sent-items-mbx", fullPath: "Sent Items" },
	],
	append: async (path, raw, flags) => {
		h.calls.push({ method: "connection.append", args: [path, raw, flags] });
		return { uid: 55, uidValidity: 7 };
	},
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
				delete: record("outboxMessage.delete"),
			},
			mailboxSpecialUse: {
				findBySpecialUse: async () => h.specialUseSent,
			},
			mailbox: {
				listByAccount: async () => ({ items: h.mailboxes }),
			},
			secrets: {},
		}),
		buildLifecycleDeps: () => ({}),
		withOAuthLifecycle: async (
			_deps: unknown,
			_account: unknown,
			_log: unknown,
			cb: (credentials: unknown) => Promise<void>,
		) => cb({}),
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

describe("handleAppendSentMessage", () => {
	beforeEach(() => {
		h = fresh();
	});

	it("appends a seen RFC822 copy to the Sent folder and drops the outbox row", async () => {
		await handleAppendSentMessage(event, noopLog, deps());

		const append = called("connection.append")[0];
		assert.equal(append?.args[0], "Sent");
		assert.deepEqual(append?.args[2], ["\\Seen"]);
		assert.deepEqual(called("outboxMessage.delete")[0]?.args, [
			"cfg-1",
			"out-1",
		]);
		assert.equal(h.disconnectCount, 1);
	});

	it("builds the message from the outbox row's own headers", async () => {
		await handleAppendSentMessage(event, noopLog, deps());

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

		await handleAppendSentMessage(event, noopLog, deps());

		const raw = String(called("connection.append")[0]?.args[1] as Buffer);
		assert.match(raw, /^From: alice@example\.com$/m);
	});

	it("falls back to a conventionally-named Sent folder when no special-use flag is set", async () => {
		h.specialUseSent = null;

		await handleAppendSentMessage(event, noopLog, deps());

		assert.equal(called("connection.append")[0]?.args[0], "Sent Items");
	});

	it("skips the append when the account has no Sent folder at all", async () => {
		h.specialUseSent = null;
		h.mailboxes = [{ mailboxId: "inbox-mbx", fullPath: "INBOX" }];

		await handleAppendSentMessage(event, noopLog, deps());

		assert.equal(called("connection.append").length, 0);
		assert.equal(called("outboxMessage.delete").length, 0);
	});

	it("skips the append while the outbox row is not yet sent", async () => {
		h.outbox = { ...h.outbox, status: "pending" };

		await handleAppendSentMessage(event, noopLog, deps());

		assert.equal(called("connection.append").length, 0);
		assert.equal(called("outboxMessage.delete").length, 0);
	});

	it("returns early without touching the outbox when the account is soft-deleted", async () => {
		h.account = { ...h.account, deletedAt: Date.now() };

		await handleAppendSentMessage(event, noopLog, deps());

		assert.equal(called("connection.append").length, 0);
		assert.equal(called("outboxMessage.delete").length, 0);
	});

	it("keeps the outbox row when the APPEND fails so the send can be retried", async () => {
		h.append = async () => {
			throw new Error("server exploded");
		};

		await assert.rejects(
			handleAppendSentMessage(event, noopLog, deps()),
			/server exploded/,
		);

		assert.equal(called("outboxMessage.delete").length, 0);
		assert.equal(h.disconnectCount, 1);
	});
});
