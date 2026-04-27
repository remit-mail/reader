import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AccountItem,
	OutboxMessageItem,
	UpdateOutboxMessageInput,
} from "@remit/remit-electrodb-service";
import {
	type EncryptedPayload,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import type { SendResult } from "@remit/smtp-service";
import type { SendMessageEvent } from "../events.js";
import { type SendMessageDeps, sendMessage } from "./send-message-core.js";

const silentLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	trace: () => {},
	fatal: () => {},
	child: () => silentLogger,
} as never;

const buildOutbox = (
	overrides: Partial<OutboxMessageItem> = {},
): OutboxMessageItem =>
	({
		outboxMessageId: "obx-1",
		accountId: "acc-1",
		accountConfigId: "cfg-1",
		fromAddress: "alice@example.com",
		toAddresses: ["bob@example.com"],
		messageIdValue: "msg-1@example.com",
		status: "queued",
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}) as unknown as OutboxMessageItem;

const buildAccount = (overrides: Partial<AccountItem> = {}): AccountItem =>
	({
		accountId: "acc-1",
		accountConfigId: "cfg-1",
		username: "alice@example.com",
		email: "alice@example.com",
		passwordHash: JSON.stringify(
			serializeEncryptedPayload({
				encryptedDek: Buffer.from("dek"),
				encryptedData: Buffer.from("data"),
				iv: Buffer.from("iv"),
				authTag: Buffer.from("tag"),
			}),
		),
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: "not_authenticated",
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}) as unknown as AccountItem;

interface Recorded {
	updates: Array<{ id: string; patch: UpdateOutboxMessageInput }>;
	statuses: Array<{ id: string; status: OutboxMessageItem["status"] }>;
	marked: Array<{ id: string; sentAt: number; smtpMessageId?: string }>;
	appendCalls: Array<{ accountId: string; outboxMessageId: string }>;
	sendCalls: number;
}

const buildDeps = (
	options: {
		outbox?: OutboxMessageItem;
		account?: AccountItem;
		sendResult?: SendResult;
		appendThrows?: Error;
	} = {},
): { deps: SendMessageDeps; recorded: Recorded } => {
	const recorded: Recorded = {
		updates: [],
		statuses: [],
		marked: [],
		appendCalls: [],
		sendCalls: 0,
	};
	const outbox = options.outbox ?? buildOutbox();
	const account = options.account ?? buildAccount();
	const deps: SendMessageDeps = {
		getOutbox: async (id) => {
			assert.equal(id, outbox.outboxMessageId);
			return outbox;
		},
		getAccount: async (id) => {
			assert.equal(id, account.accountId);
			return account;
		},
		updateOutbox: async (id, patch) => {
			recorded.updates.push({ id, patch });
		},
		updateOutboxStatus: async (id, status) => {
			recorded.statuses.push({ id, status });
		},
		markOutboxSent: async (id, fields) => {
			recorded.marked.push({ id, ...fields });
		},
		secrets: {
			decrypt: async (payload: EncryptedPayload): Promise<string> =>
				payload.encryptedDek.toString(),
		},
		send: async () => {
			recorded.sendCalls += 1;
			return (
				options.sendResult ?? {
					success: true,
					messageId: "smtp-mid-1",
					isTransient: false,
				}
			);
		},
		emitAppendSentMessage: async (accountId, outboxMessageId) => {
			recorded.appendCalls.push({ accountId, outboxMessageId });
			if (options.appendThrows) throw options.appendThrows;
		},
	};
	return { deps, recorded };
};

const event: SendMessageEvent = {
	type: "SEND_MESSAGE",
	eventId: "evt-1",
	timestamp: 0,
	accountId: "acc-1",
	outboxMessageId: "obx-1",
};

describe("sendMessage handler", () => {
	it("marks status `blocked` when SMTP host/port missing — never `sent`", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({ smtpHost: undefined, smtpPort: undefined }),
		});

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.sendCalls, 0, "send must not be invoked");
		assert.equal(recorded.marked.length, 0, "must not mark as sent");
		assert.equal(recorded.updates.length, 1);
		assert.equal(recorded.updates[0].patch.status, "blocked");
		assert.match(
			String(recorded.updates[0].patch.lastError),
			/SMTP not configured/,
		);
		assert.equal(
			recorded.statuses.length,
			0,
			"must not flicker through `sending`",
		);
		assert.equal(
			recorded.appendCalls.length,
			0,
			"must not enqueue APPEND_SENT_MESSAGE",
		);
	});

	it("marks status `failed` (not `sent`) on permanent SMTP error", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({
				smtpHost: "smtp.example.com",
				smtpPort: 587,
			}),
			sendResult: {
				success: false,
				error: new Error("auth failed") as Error & { responseCode?: number },
				smtpCode: 535,
				isTransient: false,
			},
		});

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.sendCalls, 1);
		assert.equal(recorded.marked.length, 0);
		const failedUpdate = recorded.updates.find(
			(u) => u.patch.status === "failed",
		);
		assert.ok(failedUpdate, "should write a failed update");
		assert.equal(failedUpdate.patch.lastSmtpCode, 535);
		assert.equal(failedUpdate.patch.lastError, "auth failed");
		assert.equal(
			recorded.appendCalls.length,
			0,
			"must not enqueue APPEND_SENT_MESSAGE",
		);
	});

	it("marks `sent` and clears prior error fields on success", async () => {
		const { deps, recorded } = buildDeps({
			outbox: buildOutbox({
				lastError: "stale error from prior attempt",
				lastSmtpCode: 421,
			}),
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
		});

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.sendCalls, 1);
		assert.equal(recorded.marked.length, 1);
		assert.equal(recorded.marked[0].id, "obx-1");
		assert.equal(recorded.marked[0].smtpMessageId, "smtp-mid-1");
		assert.equal(
			recorded.appendCalls.length,
			1,
			"must enqueue APPEND_SENT_MESSAGE",
		);
		// `markOutboxSent` is the seam that clears lastError/lastSmtpCode.
		// We do not assert on `update` calls writing those fields — only that
		// `markOutboxSent` was used (not the legacy generic update).
	});

	it("reverts to `queued` and rethrows on transient SMTP error", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
			sendResult: {
				success: false,
				error: new Error("temporarily unavailable"),
				smtpCode: 421,
				isTransient: true,
			},
		});

		await assert.rejects(
			() => sendMessage(event, silentLogger, deps),
			/SMTP transient error/,
		);

		const requeued = recorded.statuses.find((s) => s.status === "queued");
		assert.ok(requeued, "should revert to queued for SQS retry");
		assert.equal(recorded.marked.length, 0, "must not mark as sent");
	});

	it("skips processing if message is already `sent` (idempotent)", async () => {
		const { deps, recorded } = buildDeps({
			outbox: buildOutbox({ status: "sent" }),
		});

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.sendCalls, 0);
		assert.equal(recorded.marked.length, 0);
		assert.equal(recorded.updates.length, 0);
		assert.equal(recorded.statuses.length, 0);
	});
});
