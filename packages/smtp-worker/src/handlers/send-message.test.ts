import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AccountItem,
	OutboxMessageItem,
	UpdateOutboxMessageInput,
} from "@remit/data-ports";
import { AccountAuthType } from "@remit/domain-enums";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import {
	type EncryptedPayload,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import { type SendResult, SmtpConnectionError } from "@remit/smtp-service";
import type { SendMessageEvent } from "../events.js";
import {
	getSendMessageMaxAttempts,
	SEND_MESSAGE_MAX_ATTEMPTS,
	type SendMessageDeps,
	sendMessage,
} from "./send-message-core.js";

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
		smtpEnabled: true,
		smtpHost: "smtp.example.com",
		smtpPort: 587,
		smtpTls: false,
		smtpStartTls: true,
		smtpUsername: "",
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
	resolveCalls: number;
	connectionStateUpdates: Array<{ accountId: string; state: string }>;
	outboundIncrements: Array<{ addressId: string; now: number }>;
	replyIncrements: Array<{ addressId: string; now: number }>;
}

const buildDeps = (
	options: {
		outbox?: OutboxMessageItem;
		account?: AccountItem;
		sendResult?: SendResult;
		appendThrows?: Error;
		resolveCredentials?: SendMessageDeps["resolveCredentials"];
		send?: SendMessageDeps["send"];
	} = {},
): { deps: SendMessageDeps; recorded: Recorded } => {
	const recorded: Recorded = {
		updates: [],
		statuses: [],
		marked: [],
		appendCalls: [],
		sendCalls: 0,
		resolveCalls: 0,
		connectionStateUpdates: [],
		outboundIncrements: [],
		replyIncrements: [],
	};
	const outbox = options.outbox ?? buildOutbox();
	const account = options.account ?? buildAccount();
	const deps: SendMessageDeps = {
		getOutbox: async (accountConfigId, id) => {
			assert.equal(accountConfigId, account.accountConfigId);
			assert.equal(id, outbox.outboxMessageId);
			return outbox;
		},
		getAccount: async (id) => {
			assert.equal(id, account.accountId);
			return account;
		},
		updateOutbox: async (accountConfigId, id, patch) => {
			assert.equal(accountConfigId, account.accountConfigId);
			recorded.updates.push({ id, patch });
		},
		updateOutboxStatus: async (accountConfigId, id, status) => {
			assert.equal(accountConfigId, account.accountConfigId);
			recorded.statuses.push({ id, status });
		},
		markOutboxSent: async (accountConfigId, id, fields) => {
			assert.equal(accountConfigId, account.accountConfigId);
			recorded.marked.push({ id, ...fields });
		},
		secrets: {
			decrypt: async (payload: EncryptedPayload): Promise<string> =>
				payload.encryptedDek.toString(),
		},
		// Stub credential resolver: returns a password credential from the account's
		// encrypted passwordHash (mirroring what resolveConnectionCredentials does in prod).
		resolveCredentials:
			options.resolveCredentials ??
			(async (_account) => {
				recorded.resolveCalls += 1;
				return {
					status: "resolved" as const,
					credentials: {
						kind: "password" as const,
						password: _account.passwordHash
							? "resolved-password"
							: "no-password-configured",
					},
				};
			}),
		updateConnectionState: async (accountId, state) => {
			recorded.connectionStateUpdates.push({ accountId, state });
		},
		send:
			options.send ??
			(async () => {
				recorded.sendCalls += 1;
				return (
					options.sendResult ?? {
						success: true,
						messageId: "smtp-mid-1",
						isTransient: false,
					}
				);
			}),
		emitAppendSentMessage: async (accountId, outboxMessageId) => {
			recorded.appendCalls.push({ accountId, outboxMessageId });
			if (options.appendThrows) throw options.appendThrows;
		},
		engagement: {
			resolveAddressId: (accountConfigId, email) =>
				`addr-${accountConfigId}-${email}`,
			incrementOutboundCount: async (accountConfigId, addressId, now) => {
				assert.equal(accountConfigId, account.accountConfigId);
				recorded.outboundIncrements.push({ addressId, now });
			},
			incrementReplyCount: async (accountConfigId, addressId, now) => {
				assert.equal(accountConfigId, account.accountConfigId);
				recorded.replyIncrements.push({ addressId, now });
			},
			findMessageByHeader: async () => null,
			getEnvelopeFromEmail: async () => null,
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
	it("marks status `blocked` when SMTP is disabled — never `sent`", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({ smtpEnabled: false }),
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

	it("never re-sends a message that was sent but could not be filed", async () => {
		// The redelivery fence is the only thing between SQS at-least-once and a
		// second copy on the wire. `unfiled` is past the send, so it belongs on
		// the same side of the fence as `sent`.
		const { deps, recorded } = buildDeps({
			outbox: buildOutbox({ status: "unfiled" }),
		});

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.sendCalls, 0);
		assert.equal(recorded.marked.length, 0);
		assert.equal(recorded.updates.length, 0);
	});

	it("drops the event for a row the enqueue settled at `failed`", async () => {
		// The other half of #936. An error from SQS `SendMessage` says the response
		// was lost, not that the broker refused the event, so the row is settled
		// outside this fence and the event that landed anyway dies here. Settling
		// it at `draft` instead would send it — and leave the user a row they can
		// send a second time.
		const { deps, recorded } = buildDeps({
			outbox: buildOutbox({ status: "failed" }),
		});

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.sendCalls, 0, "must not send");
		assert.equal(recorded.marked.length, 0);
		assert.equal(recorded.updates.length, 0);
		assert.equal(recorded.statuses.length, 0);
	});

	it("settles the row as unfiled when the append event cannot be queued", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
			appendThrows: new Error("queue unreachable"),
		});

		await sendMessage(event, silentLogger, deps);

		// The send itself succeeded. Without a settle the row keeps the `sent`
		// status the Outbox list hides, and no APPEND is ever going to delete it.
		assert.equal(recorded.marked.length, 1);
		const patch = recorded.updates.at(-1)?.patch;
		assert.equal(patch?.status, "unfiled");
		assert.match(String(patch?.lastError), /could not be queued/);
	});

	it("drops event when account is deleted (tombstone fence)", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({
				smtpHost: "smtp.example.com",
				smtpPort: 587,
				deletedAt: Date.now(),
			}),
		});

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.sendCalls, 0, "must not send");
		assert.equal(recorded.marked.length, 0, "must not mark as sent");
		assert.equal(recorded.updates.length, 0, "must not update outbox");
		assert.equal(recorded.statuses.length, 0, "must not change status");
		assert.equal(recorded.appendCalls.length, 0, "must not enqueue append");
	});

	it("increments outboundCount once per unique recipient on successful send", async () => {
		const { deps, recorded } = buildDeps({
			outbox: buildOutbox({
				toAddresses: ["bob@example.com", "BOB@example.com"],
				ccAddresses: ["carol@example.com"],
				bccAddresses: ["dave@example.com"],
			}),
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
		});

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.marked.length, 1, "send must succeed");
		const incrementedAddressIds = recorded.outboundIncrements
			.map((i) => i.addressId)
			.sort();
		assert.deepEqual(incrementedAddressIds, [
			"addr-cfg-1-bob@example.com",
			"addr-cfg-1-carol@example.com",
			"addr-cfg-1-dave@example.com",
		]);
		assert.equal(recorded.replyIncrements.length, 0);
	});

	it("does not increment counters when send fails", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
			sendResult: {
				success: false,
				error: new Error("auth failed") as Error & { responseCode?: number },
				smtpCode: 535,
				isTransient: false,
			},
		});

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.outboundIncrements.length, 0);
		assert.equal(recorded.replyIncrements.length, 0);
	});

	it("increments replyCount when In-Reply-To resolves to a recipient", async () => {
		const { deps, recorded } = buildDeps({
			outbox: buildOutbox({
				toAddresses: ["bob@example.com"],
				inReplyTo: "parent-msg@example.com",
			}),
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
		});
		deps.engagement.findMessageByHeader = async () =>
			({ messageId: "msg-parent" }) as unknown as never;
		deps.engagement.getEnvelopeFromEmail = async () => "bob@example.com";

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.replyIncrements.length, 1);
		assert.equal(
			recorded.replyIncrements[0].addressId,
			"addr-cfg-1-bob@example.com",
		);
	});

	it("does NOT increment replyCount when resolved sender is not a recipient", async () => {
		const { deps, recorded } = buildDeps({
			outbox: buildOutbox({
				toAddresses: ["bob@example.com"],
				inReplyTo: "parent-msg@example.com",
			}),
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
		});
		deps.engagement.findMessageByHeader = async () =>
			({ messageId: "msg-parent" }) as unknown as never;
		deps.engagement.getEnvelopeFromEmail = async () => "stranger@example.com";

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.replyIncrements.length, 0);
	});

	it("collapses duplicate replyCount increments via the resolved Address", async () => {
		const { deps, recorded } = buildDeps({
			outbox: buildOutbox({
				toAddresses: ["bob@example.com"],
				inReplyTo: "parent-msg@example.com",
				references: ["root-msg@example.com", "parent-msg@example.com"],
			}),
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
		});
		deps.engagement.findMessageByHeader = async () =>
			({ messageId: "msg-parent" }) as unknown as never;
		deps.engagement.getEnvelopeFromEmail = async () => "bob@example.com";

		await sendMessage(event, silentLogger, deps);

		assert.equal(
			recorded.replyIncrements.length,
			1,
			"replyCount must increment once per resolved Address",
		);
	});

	it("resolves a reply target via accountId (account-scoped message identity)", async () => {
		const { deps, recorded } = buildDeps({
			outbox: buildOutbox({
				toAddresses: ["bob@example.com"],
				inReplyTo: "parent-msg@example.com",
			}),
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
		});

		const headerLookups: string[] = [];
		deps.engagement.findMessageByHeader = async (accountId) => {
			headerLookups.push(accountId);
			return { messageId: "msg-parent" } as unknown as never;
		};
		deps.engagement.getEnvelopeFromEmail = async () => "bob@example.com";

		await sendMessage(event, silentLogger, deps);

		// Inbound messages are keyed by accountId now, so the reply lookup must
		// pass the outbox's accountId ("acc-1"), never its accountConfigId ("cfg-1").
		assert.ok(headerLookups.length > 0);
		for (const id of headerLookups) {
			assert.equal(id, "acc-1");
		}
		assert.equal(recorded.replyIncrements.length, 1);
	});

	it("does not fail the send when engagement counters throw", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
		});
		deps.engagement.incrementOutboundCount = async () => {
			throw new Error("simulated DDB outage");
		};

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.marked.length, 1, "send must still be marked sent");
		assert.equal(recorded.appendCalls.length, 1, "append must still emit");
	});
});

describe("sendMessage OAuth reauth/ACK contract", () => {
	it("skips send when account is reauth_required", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({
				smtpHost: "smtp.example.com",
				smtpPort: 587,
				connectionState: "reauth_required",
			}),
		});

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.resolveCalls, 0, "must not resolve credentials");
		assert.equal(recorded.sendCalls, 0, "must not send");
		assert.equal(
			recorded.connectionStateUpdates.length,
			0,
			"must not flip connectionState",
		);
		assert.equal(recorded.updates.length, 0, "must not update outbox");
		assert.equal(recorded.statuses.length, 0, "must not change status");
	});

	it("on RefreshTokenError reauth-required during credential resolution: flips to reauth_required and ACKs", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
			resolveCredentials: async () => {
				throw new RefreshTokenError({
					kind: "reauth-required",
					code: "invalid_grant",
				});
			},
		});

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.sendCalls, 0, "must not send");
		assert.equal(recorded.connectionStateUpdates.length, 1);
		assert.deepEqual(recorded.connectionStateUpdates[0], {
			accountId: "acc-1",
			state: "reauth_required",
		});
	});

	it("account storing no credential: settles `blocked` and never retries (issue #1120)", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({ passwordHash: undefined }),
			resolveCredentials: async () => ({
				status: "missing" as const,
				terminalState: "credentials_missing" as const,
				reason: "authType=password but no passwordHash",
			}),
		});

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.sendCalls, 0, "must not send");
		assert.deepEqual(recorded.connectionStateUpdates, [
			{ accountId: "acc-1", state: "credentials_missing" },
		]);
		assert.equal(recorded.updates[0]?.patch.status, "blocked");
	});

	it("on transient credential error: rethrows", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
			resolveCredentials: async () => {
				throw new RefreshTokenError({ kind: "transient", code: "503" });
			},
		});

		await assert.rejects(
			() => sendMessage(event, silentLogger, deps),
			/transient/,
		);
		assert.equal(
			recorded.connectionStateUpdates.length,
			0,
			"must not flip connectionState",
		);
	});

	it("on SmtpConnectionError auth during credential resolution for OAuth account: flips to reauth_required and ACKs", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({
				smtpHost: "smtp.example.com",
				smtpPort: 587,
				authType: AccountAuthType.OauthMicrosoft,
			}),
			resolveCredentials: async () => {
				throw new SmtpConnectionError("auth", "535 authentication failed");
			},
		});

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.sendCalls, 0, "must not send");
		assert.equal(recorded.connectionStateUpdates.length, 1);
		assert.deepEqual(recorded.connectionStateUpdates[0], {
			accountId: "acc-1",
			state: "reauth_required",
		});
	});

	it("on SmtpConnectionError auth during credential resolution for password account: rethrows (no state flip)", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({
				smtpHost: "smtp.example.com",
				smtpPort: 587,
				authType: AccountAuthType.Password,
			}),
			resolveCredentials: async () => {
				throw new SmtpConnectionError("auth", "535 authentication failed");
			},
		});

		await assert.rejects(
			() => sendMessage(event, silentLogger, deps),
			/535 authentication failed/,
		);
		assert.equal(
			recorded.connectionStateUpdates.length,
			0,
			"must not flip connectionState for password account",
		);
	});

	it("on SmtpConnectionError auth during send for OAuth account: flips to reauth_required and ACKs", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({
				smtpHost: "smtp.example.com",
				smtpPort: 587,
				authType: AccountAuthType.OauthMicrosoft,
			}),
			send: async () => {
				throw new SmtpConnectionError("auth", "535 authentication failed");
			},
		});

		await sendMessage(event, silentLogger, deps);

		assert.equal(recorded.connectionStateUpdates.length, 1);
		assert.deepEqual(recorded.connectionStateUpdates[0], {
			accountId: "acc-1",
			state: "reauth_required",
		});
	});

	it("on SmtpConnectionError auth during send for password account: rethrows (no state flip)", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({
				smtpHost: "smtp.example.com",
				smtpPort: 587,
				authType: AccountAuthType.Password,
			}),
			send: async () => {
				throw new SmtpConnectionError("auth", "535 authentication failed");
			},
		});

		await assert.rejects(
			() => sendMessage(event, silentLogger, deps),
			/535 authentication failed/,
		);
		assert.equal(
			recorded.connectionStateUpdates.length,
			0,
			"must not flip connectionState for password account",
		);
	});
});

/**
 * A connection failure as `smtp-client.ts` raises one: the code nodemailer put
 * on the underlying error is what says how far the submission got, and it
 * survives only on the cause.
 */
const connectionError = (code: string): SmtpConnectionError =>
	new SmtpConnectionError(
		"network",
		`SMTP connection failed: ${code}`,
		Object.assign(new Error(code), { code }),
	);

describe("sendMessage retry-budget exhaustion (issue #951)", () => {
	it("rethrows a password account's auth failure below the retry budget, leaving the row `sending`", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({
				smtpHost: "smtp.example.com",
				smtpPort: 587,
				authType: AccountAuthType.Password,
			}),
			send: async () => {
				throw new SmtpConnectionError("auth", "535 authentication failed");
			},
		});

		await assert.rejects(
			() =>
				sendMessage(event, silentLogger, deps, SEND_MESSAGE_MAX_ATTEMPTS - 1),
			/535 authentication failed/,
		);
		assert.equal(
			recorded.updates.length,
			0,
			"must not settle the row before the retry budget is spent",
		);
	});

	it("settles a password account's exhausted auth failure at `failed`, not stranded at `sending`", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({
				smtpHost: "smtp.example.com",
				smtpPort: 587,
				authType: AccountAuthType.Password,
			}),
			send: async () => {
				throw new SmtpConnectionError("auth", "535 authentication failed");
			},
		});

		await sendMessage(event, silentLogger, deps, SEND_MESSAGE_MAX_ATTEMPTS);

		assert.equal(recorded.connectionStateUpdates.length, 0);
		const failedUpdate = recorded.updates.find(
			(u) => u.patch.status === "failed",
		);
		assert.ok(failedUpdate, "should settle the row as failed");
		assert.match(String(failedUpdate.patch.lastError), /authentication failed/);
	});

	it("settles an exhausted refused connection at `failed`, not stranded at `sending`", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
			send: async () => {
				throw connectionError("ECONNREFUSED");
			},
		});

		await sendMessage(event, silentLogger, deps, SEND_MESSAGE_MAX_ATTEMPTS);

		const failedUpdate = recorded.updates.find(
			(u) => u.patch.status === "failed",
		);
		assert.ok(failedUpdate, "should settle the row as failed");
		assert.match(String(failedUpdate.patch.lastError), /ECONNREFUSED/);
	});

	for (const code of ["ECONNRESET", "ETIMEDOUT"]) {
		it(`settles an exhausted ${code} at \`unfiled\` — the server may hold the message`, async () => {
			// Both classify as `network` and both can land after DATA, so a
			// `failed` row here would offer a Retry that delivers a second copy.
			const { deps, recorded } = buildDeps({
				account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
				send: async () => {
					throw connectionError(code);
				},
			});

			await sendMessage(event, silentLogger, deps, SEND_MESSAGE_MAX_ATTEMPTS);

			assert.equal(
				recorded.updates.find((u) => u.patch.status === "failed"),
				undefined,
				"a row that may have been delivered must not be re-sendable",
			);
			const settled = recorded.updates.at(-1)?.patch;
			assert.equal(settled?.status, "unfiled");
			assert.match(
				String(settled?.lastError),
				/may already have been delivered/,
			);
			assert.match(String(settled?.lastError), new RegExp(code));
		});
	}

	it("settles an exhausted connection failure that names no code at `unfiled`", async () => {
		// Nothing says the message did not reach the server, and the answer that
		// cannot produce a second copy is the one to settle on.
		const { deps, recorded } = buildDeps({
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
			send: async () => {
				throw new SmtpConnectionError("network", "SMTP connection failed");
			},
		});

		await sendMessage(event, silentLogger, deps, SEND_MESSAGE_MAX_ATTEMPTS);

		assert.equal(recorded.updates.at(-1)?.patch.status, "unfiled");
	});

	it("settles an exhausted transient SMTP failure at `failed` instead of leaving it `queued` forever", async () => {
		const { deps, recorded } = buildDeps({
			account: buildAccount({ smtpHost: "smtp.example.com", smtpPort: 587 }),
			sendResult: {
				success: false,
				error: new Error("temporarily unavailable"),
				smtpCode: 421,
				isTransient: true,
			},
		});

		await sendMessage(event, silentLogger, deps, SEND_MESSAGE_MAX_ATTEMPTS);

		const failedUpdate = recorded.updates.find(
			(u) => u.patch.status === "failed",
		);
		assert.ok(failedUpdate, "should settle the row as failed");
		assert.equal(failedUpdate.patch.lastSmtpCode, 421);
		assert.equal(
			recorded.statuses.find((s) => s.status === "queued"),
			undefined,
			"must not leave the row requeued once the budget is spent",
		);
	});
});

describe("the retry budget is the queue's, read from the environment", () => {
	it("takes the deployment's own maxReceiveCount when it is set", () => {
		// The e2e stack sets 1 (`deploy/vps/e2e.env`): its pollers hold a record
		// for 300s, so a spec cannot wait out three deliveries.
		assert.equal(
			getSendMessageMaxAttempts({ SEND_MESSAGE_MAX_ATTEMPTS: "1" }),
			1,
		);
		assert.equal(
			getSendMessageMaxAttempts({ SEND_MESSAGE_MAX_ATTEMPTS: "5" }),
			5,
		);
	});

	it("falls back to remit-smtp's maxReceiveCount when it is unset or unusable", () => {
		assert.equal(getSendMessageMaxAttempts({}), 3);
		assert.equal(
			getSendMessageMaxAttempts({ SEND_MESSAGE_MAX_ATTEMPTS: "" }),
			3,
		);
		assert.equal(
			getSendMessageMaxAttempts({ SEND_MESSAGE_MAX_ATTEMPTS: "not-a-number" }),
			3,
		);
		assert.equal(
			getSendMessageMaxAttempts({ SEND_MESSAGE_MAX_ATTEMPTS: "0" }),
			3,
		);
	});
});
