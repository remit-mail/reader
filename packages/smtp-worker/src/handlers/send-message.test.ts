import assert from "node:assert/strict";
import net from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
	CreateAccountInput,
	CreateOutboxMessageInput,
} from "@remit/data-ports";
import { deriveAddressId } from "@remit/data-ports/id";
import {
	type RecordingQueue,
	recordingQueue,
} from "@remit/data-ports/recording-queue";
import {
	AccountAuthType,
	ConnectionState,
	OutboxMessageStatus,
} from "@remit/domain-enums";
import {
	BETTER_SQLITE3_LIMITS,
	createSqliteRepositories,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import type { MailFailureKind } from "@remit/logger";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import { serializeEncryptedPayload } from "@remit/secrets-service";
import { SmtpConnectionError } from "@remit/smtp-service";
import {
	type FakeSmtp,
	type FakeSmtpOptions,
	startFakeSmtp,
} from "@remit/smtp-service/test-fake-smtp";
import { createMockStorageService } from "@remit/storage-service";
import type { SendMessageEvent } from "../events.js";
import { handleSendMessage, type SendMessageContext } from "./send-message.js";

const MAX_ATTEMPTS = 3;

const storedSecret = (plaintext: string): string =>
	JSON.stringify(
		serializeEncryptedPayload({
			encryptedDek: Buffer.from("dek"),
			encryptedData: Buffer.from(plaintext),
			iv: Buffer.from("iv"),
			authTag: Buffer.from("tag"),
		}),
	);

interface SocketRequest {
	host: string | undefined;
	port: string | number | undefined;
}

interface World {
	repos: ReturnType<typeof createSqliteRepositories>;
	smtp: FakeSmtp;
	queue: RecordingQueue;
	storage: ReturnType<typeof createMockStorageService>;
	requests: SocketRequest[];
	failures: MailFailureKind[];
	tokenRequests: string[];
	ctx: SendMessageContext;
	close: () => void;
}

const openWorld = async (smtpOptions: FakeSmtpOptions = {}): Promise<World> => {
	const store = createShippedSqliteDb();
	const repos = createSqliteRepositories(
		{
			app: store.db,
			mail: store.db,
			search: store.db,
		},
		BETTER_SQLITE3_LIMITS,
	);
	const smtp = await startFakeSmtp(smtpOptions);
	const queue = recordingQueue();
	const storage = createMockStorageService();
	const requests: SocketRequest[] = [];
	const failures: MailFailureKind[] = [];
	const tokenRequests: string[] = [];
	const ctx: SendMessageContext = {
		ports: repos,
		secrets: {
			encrypt: async (plaintext) => ({
				encryptedDek: Buffer.from("dek"),
				encryptedData: Buffer.from(plaintext),
				iv: Buffer.from("iv"),
				authTag: Buffer.from("tag"),
			}),
			decrypt: async (payload) => payload.encryptedData.toString(),
		},
		storage,
		messageManagement: queue,
		tokenService: {
			getAccessToken: async (accountId) => {
				tokenRequests.push(accountId);
				return { accessToken: "access-token", expiresAt: 0, grantedScopes: [] };
			},
		},
		getSocket: (request, callback) => {
			requests.push({ host: request.host, port: request.port });
			const connection = net.connect(smtp.port, "127.0.0.1", () =>
				callback(null, { connection }),
			);
		},
		maxAttempts: MAX_ATTEMPTS,
		recordSmtpFailure: (kind) => failures.push(kind),
	};
	return {
		repos,
		smtp,
		queue,
		storage,
		requests,
		failures,
		tokenRequests,
		ctx,
		close: () => {
			smtp.close();
			store.close();
		},
	};
};

interface Arranged {
	accountId: string;
	accountConfigId: string;
	outboxMessageId: string;
	event: SendMessageEvent;
}

const arrange = async (
	w: World,
	options: {
		account?: Partial<CreateAccountInput>;
		outbox?: Partial<CreateOutboxMessageInput>;
	} = {},
): Promise<Arranged> => {
	const account = await w.repos.account.create({
		accountConfigId: "cfg-1",
		username: "alice@example.com",
		email: "alice@example.com",
		passwordHash: storedSecret("smtp-password"),
		imapHost: "imap.example.invalid",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		smtpEnabled: true,
		smtpHost: "smtp.example.invalid",
		smtpPort: 587,
		smtpTls: false,
		smtpStartTls: true,
		isActive: true,
		connectionState: ConnectionState.Authenticated,
		...options.account,
	});
	const outbox = await w.repos.outboxMessage.create({
		accountId: account.accountId,
		accountConfigId: account.accountConfigId,
		fromAddress: "alice@example.com",
		toAddresses: ["bob@example.com"],
		subject: "Quarterly numbers",
		textBody: "Hello Bob",
		messageIdValue: "<send-1@example.com>",
		status: OutboxMessageStatus.queued,
		...options.outbox,
	});
	return {
		accountId: account.accountId,
		accountConfigId: account.accountConfigId,
		outboxMessageId: outbox.outboxMessageId,
		event: {
			type: "SEND_MESSAGE",
			eventId: "evt-1",
			timestamp: 0,
			accountId: account.accountId,
			outboxMessageId: outbox.outboxMessageId,
		},
	};
};

const outboxRow = (w: World, a: Arranged) =>
	w.repos.outboxMessage.get(a.accountConfigId, a.outboxMessageId);

const accountRow = (w: World, a: Arranged) => w.repos.account.get(a.accountId);

const attach = async (
	w: World,
	a: Arranged,
	file: { filename: string; content: Buffer | null },
): Promise<void> => {
	const outboxAttachmentId = `att-${file.filename}`;
	const reserved = await w.repos.outboxAttachment.reserve(
		{
			outboxAttachmentId,
			outboxMessageId: a.outboxMessageId,
			accountId: a.accountId,
			accountConfigId: a.accountConfigId,
			filename: file.filename,
			contentType: "application/pdf",
			sizeBytes: file.content?.length ?? 4,
			storageKey: `key/${file.filename}`,
			reservationExpiresAt: Math.floor(Date.now() / 1000) + 3600,
		},
		{
			maxTotalBytes: 1_000_000,
			maxCount: 10,
			nowSeconds: Math.floor(Date.now() / 1000),
		},
	);
	assert.equal(reserved.outcome, "Reserved");
	await w.repos.outboxAttachment.markStored(
		a.accountConfigId,
		outboxAttachmentId,
		file.content?.length ?? 4,
	);
	if (file.content === null) return;
	await w.storage.storeOutboxAttachment({
		accountConfigId: a.accountConfigId,
		accountId: a.accountId,
		outboxMessageId: a.outboxMessageId,
		outboxAttachmentId,
		content: file.content,
	});
};

const refusingSocket =
	(code: string): SendMessageContext["getSocket"] =>
	(_request, callback) => {
		callback(Object.assign(new Error(`connect ${code}`), { code }), false);
	};

const seedAddress = async (w: World, email: string): Promise<string> => {
	const addressId = deriveAddressId("cfg-1", email);
	const [localPart = "", domain = ""] = email.split("@");
	await w.repos.address.upsertAddress({
		addressId,
		accountConfigId: "cfg-1",
		localPart,
		domain,
		normalizedEmail: email,
		normalizedCompound: email,
	});
	return addressId;
};

const assertBlockedOnReauth = async (w: World, a: Arranged): Promise<void> => {
	const row = await outboxRow(w, a);
	assert.equal(row.status, OutboxMessageStatus.blocked);
	assert.match(String(row.lastError), /reconnected/i);
	assert.match(String(row.lastError), /Reconnect/);
};

let w: World;

beforeEach(async () => {
	w = await openWorld();
});

afterEach(() => w.close());

describe("handleSendMessage", () => {
	it("sends over the context's socket, marks the row sent and queues the Sent copy", async () => {
		const a = await arrange(w, {
			outbox: { lastError: "stale error from a prior attempt" },
		});

		await handleSendMessage(a.event, w.ctx, 1);

		assert.deepEqual(w.requests, [{ host: "smtp.example.invalid", port: 587 }]);
		assert.match(w.smtp.received.join(""), /Subject: Quarterly numbers/);
		const row = await outboxRow(w, a);
		assert.equal(row.status, OutboxMessageStatus.sent);
		assert.equal(row.lastError, undefined);
		assert.deepEqual(
			w.queue.sent.map(({ body }) => [
				body.type,
				body.accountId,
				body.outboxMessageId,
			]),
			[["APPEND_SENT_MESSAGE", a.accountId, a.outboxMessageId]],
		);
	});

	it("sends every file the draft carries as a part of the message", async () => {
		const a = await arrange(w);
		await attach(w, a, {
			filename: "report.pdf",
			content: Buffer.from("%PDF-1.4"),
		});

		await handleSendMessage(a.event, w.ctx, 1);

		assert.match(w.smtp.received.join(""), /filename=report\.pdf/);
		assert.equal((await outboxRow(w, a)).status, OutboxMessageStatus.sent);
	});

	it("retries a message whose files could not be read, below the budget", async () => {
		const a = await arrange(w);
		await attach(w, a, { filename: "payroll.xlsx", content: null });

		await assert.rejects(() => handleSendMessage(a.event, w.ctx, 1));

		assert.deepEqual(w.requests, [], "never dialled the server");
		assert.equal((await outboxRow(w, a)).status, OutboxMessageStatus.queued);
	});

	it("settles a message whose files cannot be read as failed, naming the file, at the budget", async () => {
		const a = await arrange(w);
		await attach(w, a, { filename: "payroll.xlsx", content: null });

		await handleSendMessage(a.event, w.ctx, MAX_ATTEMPTS);

		assert.deepEqual(w.requests, []);
		const row = await outboxRow(w, a);
		assert.equal(row.status, OutboxMessageStatus.failed);
		assert.match(
			String(row.lastError),
			/^"payroll\.xlsx" could not be read: .*, so this message was not sent\. Remove "payroll\.xlsx", attach it again, and send\.$/,
		);
	});

	it("marks status `blocked` when SMTP is disabled — never `sent`", async () => {
		const a = await arrange(w, { account: { smtpEnabled: false } });

		await handleSendMessage(a.event, w.ctx, 1);

		assert.deepEqual(w.requests, [], "send must not be attempted");
		const row = await outboxRow(w, a);
		assert.equal(row.status, OutboxMessageStatus.blocked);
		assert.match(String(row.lastError), /SMTP not configured/);
		assert.deepEqual(w.queue.sent, [], "must not enqueue APPEND_SENT_MESSAGE");
	});

	it("marks status `failed` (not `sent`) on a permanent SMTP refusal, counting no engagement", async () => {
		w.close();
		w = await openWorld({ dataFinalResponse: "554 5.7.1 Rejected\r\n" });
		const a = await arrange(w);
		const bob = await seedAddress(w, "bob@example.com");

		await handleSendMessage(a.event, w.ctx, 1);

		const row = await outboxRow(w, a);
		assert.equal(row.status, OutboxMessageStatus.failed);
		assert.equal(row.lastSmtpCode, 554);
		assert.deepEqual(w.queue.sent, []);
		const address = await w.repos.address.getAddress("cfg-1", bob);
		assert.equal(address.outboundCount ?? 0, 0);
	});

	it("reverts to `queued` and rethrows on a transient SMTP refusal", async () => {
		w.close();
		w = await openWorld({ dataFinalResponse: "451 4.3.0 Try later\r\n" });
		const a = await arrange(w);

		await assert.rejects(
			() => handleSendMessage(a.event, w.ctx, 1),
			/SMTP transient error/,
		);

		assert.equal((await outboxRow(w, a)).status, OutboxMessageStatus.queued);
	});

	for (const status of [
		OutboxMessageStatus.sent,
		OutboxMessageStatus.unfiled,
		OutboxMessageStatus.failed,
	]) {
		it(`never re-sends a row already at \`${status}\``, async () => {
			const a = await arrange(w, { outbox: { status } });

			await handleSendMessage(a.event, w.ctx, 1);

			assert.deepEqual(w.requests, []);
			assert.equal((await outboxRow(w, a)).status, status);
		});
	}

	it("settles the row as unfiled when the append event cannot be queued", async () => {
		const a = await arrange(w);
		w.queue.answer(() => Promise.reject(new Error("queue unreachable")));

		await handleSendMessage(a.event, w.ctx, 1);

		const row = await outboxRow(w, a);
		assert.equal(row.status, OutboxMessageStatus.unfiled);
		assert.match(String(row.lastError), /could not be queued/);
	});

	it("drops the event when the account is deleted (tombstone fence)", async () => {
		const a = await arrange(w, { account: { deletedAt: Date.now() } });

		await handleSendMessage(a.event, w.ctx, 1);

		assert.deepEqual(w.requests, []);
		assert.equal((await outboxRow(w, a)).status, OutboxMessageStatus.queued);
		assert.deepEqual(w.queue.sent, []);
	});

	it("increments outboundCount once per unique recipient on a successful send", async () => {
		const a = await arrange(w, {
			outbox: {
				toAddresses: ["bob@example.com", "BOB@example.com"],
				ccAddresses: ["carol@example.com"],
				bccAddresses: ["dave@example.com"],
			},
		});
		const ids = await Promise.all(
			["bob@example.com", "carol@example.com", "dave@example.com"].map(
				(email) => seedAddress(w, email),
			),
		);

		await handleSendMessage(a.event, w.ctx, 1);

		const counts = await Promise.all(
			ids.map(
				async (id) =>
					(await w.repos.address.getAddress("cfg-1", id)).outboundCount,
			),
		);
		assert.deepEqual(counts, [1, 1, 1]);
	});

	it("does not fail the send when the engagement counters throw", async () => {
		const a = await arrange(w);
		const address = Object.create(w.repos.address);
		address.incrementOutboundCount = async () => {
			throw new Error("simulated outage");
		};

		await handleSendMessage(
			a.event,
			{ ...w.ctx, ports: { ...w.repos, address } },
			1,
		);

		assert.equal((await outboxRow(w, a)).status, OutboxMessageStatus.sent);
		assert.equal(w.queue.sent.length, 1, "append must still emit");
	});
});

describe("handleSendMessage OAuth reauth/ACK contract", () => {
	const oauthAccount = {
		authType: AccountAuthType.OauthMicrosoft,
		passwordHash: undefined,
		oauthRefreshTokenHash: storedSecret("refresh-token"),
	};

	it("blocks the message when the account already needs reauth (issue #1152)", async () => {
		const a = await arrange(w, {
			account: { ...oauthAccount, connectionState: "reauth_required" },
		});

		await handleSendMessage(a.event, w.ctx, 1);

		assert.deepEqual(w.tokenRequests, [], "must not resolve credentials");
		assert.deepEqual(w.requests, [], "must not send");
		assert.equal((await accountRow(w, a)).connectionState, "reauth_required");
		await assertBlockedOnReauth(w, a);
	});

	it("flips to reauth_required and ACKs when the refresh token is revoked", async () => {
		const a = await arrange(w, { account: oauthAccount });

		await handleSendMessage(
			a.event,
			{
				...w.ctx,
				tokenService: {
					getAccessToken: async () => {
						throw new RefreshTokenError({
							kind: "reauth-required",
							code: "invalid_grant",
						});
					},
				},
			},
			1,
		);

		assert.deepEqual(w.requests, [], "must not send");
		assert.equal((await accountRow(w, a)).connectionState, "reauth_required");
		await assertBlockedOnReauth(w, a);
	});

	it("settles `blocked` and never retries for an account storing no credential (issue #1120)", async () => {
		const a = await arrange(w, { account: { passwordHash: undefined } });

		await handleSendMessage(a.event, w.ctx, 1);

		assert.deepEqual(w.requests, [], "must not send");
		assert.equal(
			(await accountRow(w, a)).connectionState,
			"credentials_missing",
		);
		assert.equal((await outboxRow(w, a)).status, OutboxMessageStatus.blocked);
	});

	it("rethrows a transient refresh failure without flipping the account", async () => {
		const a = await arrange(w, { account: oauthAccount });

		await assert.rejects(
			() =>
				handleSendMessage(
					a.event,
					{
						...w.ctx,
						tokenService: {
							getAccessToken: async () => {
								throw new RefreshTokenError({ kind: "transient", code: "503" });
							},
						},
					},
					1,
				),
			/transient/,
		);
		assert.equal(
			(await accountRow(w, a)).connectionState,
			ConnectionState.Authenticated,
		);
	});

	it("flips an OAuth account to reauth_required on an SMTP auth refusal while resolving", async () => {
		const a = await arrange(w, { account: oauthAccount });

		await handleSendMessage(
			a.event,
			{
				...w.ctx,
				tokenService: {
					getAccessToken: async () => {
						throw new SmtpConnectionError("auth", "535 authentication failed");
					},
				},
			},
			1,
		);

		assert.deepEqual(w.requests, []);
		assert.equal((await accountRow(w, a)).connectionState, "reauth_required");
		await assertBlockedOnReauth(w, a);
	});

	it("rethrows a password account's SMTP auth refusal while resolving, leaving the account alone", async () => {
		const a = await arrange(w);

		await assert.rejects(
			() =>
				handleSendMessage(
					a.event,
					{
						...w.ctx,
						secrets: {
							...w.ctx.secrets,
							decrypt: async () => {
								throw new SmtpConnectionError(
									"auth",
									"535 authentication failed",
								);
							},
						},
					},
					1,
				),
			/535 authentication failed/,
		);
		assert.equal(
			(await accountRow(w, a)).connectionState,
			ConnectionState.Authenticated,
		);
	});

	it("flips an OAuth account to reauth_required when the server refuses its token, settling the row from `sending`", async () => {
		w.close();
		w = await openWorld({ authResponse: "535 5.7.8 Token rejected\r\n" });
		const a = await arrange(w, { account: oauthAccount });

		await handleSendMessage(a.event, w.ctx, 1);

		const account = await accountRow(w, a);
		assert.equal(account.connectionState, "reauth_required");
		assert.match(String(account.lastError), /Token rejected/);
		await assertBlockedOnReauth(w, a);
	});

	it("flips the connection state before it settles the row", async () => {
		const a = await arrange(w, { account: oauthAccount });
		const writes: string[] = [];
		const account = Object.create(w.repos.account);
		account.update = (...args: Parameters<typeof w.repos.account.update>) => {
			writes.push("connectionState");
			return w.repos.account.update(...args);
		};
		const outboxMessage = Object.create(w.repos.outboxMessage);
		outboxMessage.updateIfStatus = (
			...args: Parameters<typeof w.repos.outboxMessage.updateIfStatus>
		) => {
			writes.push("outbox");
			return w.repos.outboxMessage.updateIfStatus(...args);
		};

		await handleSendMessage(
			a.event,
			{
				...w.ctx,
				ports: { ...w.repos, account, outboxMessage },
				tokenService: {
					getAccessToken: async () => {
						throw new RefreshTokenError({
							kind: "reauth-required",
							code: "invalid_grant",
						});
					},
				},
			},
			1,
		);

		// A settle that throws after the flip is redelivered into the fence, which
		// settles the row. The other order leaves the account unfenced, and the
		// settled row is outside the send fence so no redelivery gets back here.
		assert.deepEqual(writes, ["connectionState", "outbox"]);
	});

	it("leaves a row the user pulled back into the composer alone", async () => {
		const a = await arrange(w, {
			account: { connectionState: "reauth_required" },
			outbox: { status: OutboxMessageStatus.draft },
		});

		await handleSendMessage(a.event, w.ctx, 1);

		const row = await outboxRow(w, a);
		assert.equal(row.status, OutboxMessageStatus.draft);
		assert.equal(row.lastError, undefined);
	});
});

describe("handleSendMessage retry-budget exhaustion (issue #951)", () => {
	it("rethrows a password account's auth refusal below the budget, leaving the row `sending`", async () => {
		w.close();
		w = await openWorld({ authResponse: "535 5.7.8 Bad credentials\r\n" });
		const a = await arrange(w);

		await assert.rejects(
			() => handleSendMessage(a.event, w.ctx, MAX_ATTEMPTS - 1),
			/authentication failed/,
		);
		assert.equal((await outboxRow(w, a)).status, OutboxMessageStatus.sending);
	});

	it("settles a password account's exhausted auth refusal at `failed`", async () => {
		w.close();
		w = await openWorld({ authResponse: "535 5.7.8 Bad credentials\r\n" });
		const a = await arrange(w);

		await handleSendMessage(a.event, w.ctx, MAX_ATTEMPTS);

		assert.equal(
			(await accountRow(w, a)).connectionState,
			ConnectionState.Authenticated,
		);
		const row = await outboxRow(w, a);
		assert.equal(row.status, OutboxMessageStatus.failed);
		assert.match(String(row.lastError), /authentication failed/);
		assert.deepEqual(w.failures, ["auth"]);
	});

	it("settles a refused connection at `failed` on the context's budget", async () => {
		const a = await arrange(w);

		await handleSendMessage(
			a.event,
			{ ...w.ctx, getSocket: refusingSocket("ECONNREFUSED"), maxAttempts: 1 },
			1,
		);

		const row = await outboxRow(w, a);
		assert.equal(row.status, OutboxMessageStatus.failed);
		assert.match(String(row.lastError), /ECONNREFUSED/);
		assert.deepEqual(w.failures, ["network"]);
	});

	for (const code of ["ECONNRESET", "ETIMEDOUT"]) {
		it(`settles an exhausted ${code} at \`unfiled\` — the server may hold the message`, async () => {
			// Both classify as `network` and both can land after DATA, so a
			// `failed` row here would offer a Retry that delivers a second copy.
			const a = await arrange(w);

			await handleSendMessage(
				a.event,
				{ ...w.ctx, getSocket: refusingSocket(code) },
				MAX_ATTEMPTS,
			);

			const row = await outboxRow(w, a);
			assert.equal(row.status, OutboxMessageStatus.unfiled);
			assert.match(String(row.lastError), /may already have been delivered/);
			assert.match(String(row.lastError), new RegExp(code));
		});
	}

	it("settles an exhausted transient SMTP refusal at `failed` instead of leaving it `queued` forever", async () => {
		w.close();
		w = await openWorld({ dataFinalResponse: "451 4.3.0 Try later\r\n" });
		const a = await arrange(w);

		await handleSendMessage(a.event, w.ctx, MAX_ATTEMPTS);

		const row = await outboxRow(w, a);
		assert.equal(row.status, OutboxMessageStatus.failed);
		assert.equal(row.lastSmtpCode, 451);
		assert.deepEqual(w.failures, ["other"]);
	});
});
