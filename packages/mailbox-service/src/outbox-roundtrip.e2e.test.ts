/**
 * E2E roundtrip test: compose -> SMTP send -> IMAP APPEND to Sent folder.
 *
 * Drives the full outgoing message pipeline against real infrastructure:
 *  - ElasticMQ (SQS): SEND_MESSAGE on smtp queue, APPEND_SENT_MESSAGE on
 *    message-mgmt queue
 *  - mokapi (SMTP, port 2525): receives the outbound message
 *  - mailfuzz / Dovecot (IMAP, port 1143): the user's IMAP server, hosts the
 *    Sent folder where the appended copy must land
 *  - DynamoDB Local: account + outbox storage
 *
 * Regression guard for PR #100 (SMTP worker bug class):
 *  - the SMTP worker module reads SQS_QUEUE_URL_MESSAGE_MGMT — wrong env var
 *    name crashes the worker at import time (`expect-env` throws)
 *  - APPEND_SENT_MESSAGE must arrive on the message-mgmt queue — wrong queue
 *    routing means the IMAP worker never picks it up and the assertion below
 *    that the message appears in Sent times out
 */

import assert from "node:assert";
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	CreateQueueCommand,
	PurgeQueueCommand,
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
	AccountConfigService,
	AccountService,
	base36uuidv5,
	CreateFailedConflictError,
	MailboxService,
	NotFoundError,
	type OutboxMessageItem,
	OutboxMessageService,
	REMIT_NAMESPACE,
} from "@remit/remit-electrodb-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import { OutboxQueueService } from "./outbox-queue.js";
import { withMailfuzzConnection } from "./test-helpers/mailfuzz-connection.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const SQS_ENDPOINT = "http://localhost:9325";

const MAILFUZZ_HOST = process.env.MAILFUZZ_HOST ?? "localhost";
const MAILFUZZ_PORT = Number(process.env.MAILFUZZ_PORT ?? "1143");
const MAILFUZZ_USER = process.env.MAILFUZZ_USER ?? "vmail";
const MAILFUZZ_PASSWORD = process.env.MAILFUZZ_PASSWORD ?? "testpass123";

const MOKAPI_SMTP_HOST = process.env.MOKAPI_SMTP_HOST ?? "localhost";
const MOKAPI_SMTP_PORT = Number(process.env.MOKAPI_SMTP_PORT ?? "2525");
const MOKAPI_SMTP_USER = process.env.MOKAPI_SMTP_USER ?? "alice@mokapi.io";
const MOKAPI_SMTP_PASSWORD = process.env.MOKAPI_SMTP_PASSWORD ?? "alice123";

// Use a mokapi-known mailbox as the From: address — mokapi rejects MAIL FROM
// for unknown mailboxes with a 550. The IMAP side still goes to mailfuzz; the
// account just happens to share its From with the SMTP authentication user.
const ROUNDTRIP_EMAIL = MOKAPI_SMTP_USER;
const USER_ID = base36uuidv5(
	`e2e:roundtrip:user:${ROUNDTRIP_EMAIL}`,
	REMIT_NAMESPACE,
);
const ACCOUNT_CONFIG_ID = base36uuidv5(
	`e2e:roundtrip:config:${ROUNDTRIP_EMAIL}`,
	REMIT_NAMESPACE,
);
const ACCOUNT_ID = base36uuidv5(
	`e2e:roundtrip:account:${ROUNDTRIP_EMAIL}`,
	REMIT_NAMESPACE,
);

const createDdbConfig = () => {
	const port = process.env.DYNAMODB_PORT ?? "5435";
	const table = process.env.DYNAMODB_TABLE_NAME ?? "remit-test";
	const ddbClient = new DynamoDBClient({
		endpoint: `http://localhost:${port}`,
		credentials: { accessKeyId: "fakeKey", secretAccessKey: "fakeSecretKey" },
		region: "local",
	});
	const client = DynamoDBDocumentClient.from(ddbClient);
	return { client, table };
};

const createSqs = () =>
	new SQSClient({
		endpoint: SQS_ENDPOINT,
		region: "local",
		credentials: { accessKeyId: "local", secretAccessKey: "local" },
	});

const ensureQueuesExist = async () => {
	const sqs = createSqs();
	const standardQueues = [
		"remit-e2e",
		"remit-e2e-body",
		"remit-e2e-mailbox-mgmt",
		"remit-e2e-message-mgmt",
		"remit-e2e-smtp",
	];
	const fifoQueues = [
		"remit-e2e-mailboxes.fifo",
		"remit-e2e-messages.fifo",
		"remit-e2e-flags.fifo",
	];
	for (const QueueName of standardQueues) {
		await sqs.send(new CreateQueueCommand({ QueueName }));
	}
	for (const QueueName of fifoQueues) {
		await sqs.send(
			new CreateQueueCommand({
				QueueName,
				Attributes: { FifoQueue: "true" },
			}),
		);
	}
};

const purgeQueue = async (queueUrl: string) => {
	const sqs = createSqs();
	await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl })).catch(() => {
		// PurgeQueue may be rate-limited; swallow only this expected error
		// and proceed — fresh queues will be empty anyway.
	});
};

const seedAccount = async (config: ReturnType<typeof createDdbConfig>) => {
	const accountConfigService = new AccountConfigService(config);
	const accountService = new AccountService(config);
	const kmsKeyId = process.env.KMS_KEY_ID ?? "FAKE_KMS_KEY_ID";
	const dataKeyProvider = createKmsDataKeyProvider(kmsKeyId);
	const secrets = createSecretsService(dataKeyProvider);

	const imapPasswordHash = JSON.stringify(
		serializeEncryptedPayload(await secrets.encrypt(MAILFUZZ_PASSWORD)),
	);
	const smtpPasswordHash = JSON.stringify(
		serializeEncryptedPayload(await secrets.encrypt(MOKAPI_SMTP_PASSWORD)),
	);

	await accountConfigService
		.create({
			accountConfigId: ACCOUNT_CONFIG_ID,
			userId: USER_ID,
			name: "E2E Roundtrip Account",
		})
		.catch((err: unknown) => {
			if (!(err instanceof CreateFailedConflictError)) throw err;
		});

	await accountService
		.create({
			accountId: ACCOUNT_ID,
			accountConfigId: ACCOUNT_CONFIG_ID,
			username: MAILFUZZ_USER,
			email: ROUNDTRIP_EMAIL,
			passwordHash: imapPasswordHash,
			imapHost: MAILFUZZ_HOST,
			imapPort: MAILFUZZ_PORT,
			imapTls: false,
			imapStartTls: false,
			smtpEnabled: true,
			smtpHost: MOKAPI_SMTP_HOST,
			smtpPort: MOKAPI_SMTP_PORT,
			smtpTls: false,
			smtpStartTls: false,
			smtpUsername: MOKAPI_SMTP_USER,
			smtpPasswordHash,
			isActive: true,
			connectionState: "not_authenticated",
		})
		.catch((err: unknown) => {
			if (!(err instanceof CreateFailedConflictError)) throw err;
		});
};

interface SpawnedWorker {
	process: ChildProcess;
	label: string;
}

const spawnWorker = (
	label: string,
	entry: string,
	extraEnv: Record<string, string> = {},
): SpawnedWorker => {
	const proc = spawn(
		"node",
		["--env-file=localhost-test-e2e.env", "--import", "tsx", entry],
		{
			cwd: PROJECT_ROOT,
			stdio: "pipe",
			env: { ...process.env, ...extraEnv },
		},
	);
	proc.stdout?.on("data", (data: Buffer) => {
		process.stdout.write(`[${label}] ${data.toString()}`);
	});
	proc.stderr?.on("data", (data: Buffer) => {
		process.stderr.write(`[${label}] ${data.toString()}`);
	});
	return { process: proc, label };
};

const killWorker = (worker: SpawnedWorker | null): Promise<void> => {
	if (!worker) return Promise.resolve();
	return new Promise((resolveKill) => {
		const proc = worker.process;
		if (proc.exitCode !== null || proc.signalCode !== null) {
			resolveKill();
			return;
		}
		proc.once("exit", () => resolveKill());
		proc.kill("SIGTERM");
		// Hard-kill if it hangs
		setTimeout(() => {
			if (proc.exitCode === null && proc.signalCode === null) {
				proc.kill("SIGKILL");
			}
		}, 5000);
	});
};

const waitFor = async <T>(
	check: () => Promise<T | null>,
	{
		timeoutMs = 60_000,
		intervalMs = 500,
		label,
	}: {
		timeoutMs?: number;
		intervalMs?: number;
		label: string;
	},
): Promise<T> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const result = await check();
		if (result !== null) return result;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error(`Timeout waiting for: ${label}`);
};

describe(
	"Outbox roundtrip (compose -> SMTP -> IMAP append)",
	{
		skip: !process.env.RUN_E2E_TESTS,
	},
	() => {
		const config = createDdbConfig();
		let imapWorker: SpawnedWorker | null = null;
		let smtpWorker: SpawnedWorker | null = null;

		before(async () => {
			await ensureQueuesExist();

			// Purge queues so leftover messages from previous runs don't pollute
			// this test (workers stay green even when picking up stale events
			// because of `expect-env` validation, but message ordering matters
			// for the deduplication assertions).
			const queueUrls = [
				process.env.SQS_QUEUE_URL_SMTP,
				process.env.SQS_QUEUE_URL_MESSAGE_MGMT,
				process.env.SQS_QUEUE_URL_MAILBOXES,
			];
			for (const url of queueUrls) {
				if (url) await purgeQueue(url);
			}

			await seedAccount(config);

			// Mailfuzz's Dovecot fixture only ships with INBOX. The
			// append-sent-message handler needs a Sent folder to APPEND into,
			// so create it directly via IMAP before we sync. This is a
			// per-test setup concern, not something the production code path
			// would do (real IMAP servers ship with a Sent folder or the user
			// creates one).
			await withMailfuzzConnection(async (conn) => {
				await conn.createMailbox("Sent").catch((err: unknown) => {
					const msg = err instanceof Error ? err.message : String(err);
					if (!msg.toLowerCase().includes("already")) throw err;
				});
			});

			imapWorker = spawnWorker(
				"imap-worker",
				"packages/remit-imap-worker/src/e2e-processor-shim.ts",
			);
			// Mokapi presents a self-signed cert for STARTTLS; the production
			// SmtpConfig has no escape hatch and the handler does not set
			// tls.rejectUnauthorized, so disable cert validation in the
			// child process via the standard Node opt-out for the test env.
			smtpWorker = spawnWorker(
				"smtp-worker",
				"packages/remit-smtp-worker/src/e2e-processor-shim.ts",
				{ NODE_TLS_REJECT_UNAUTHORIZED: "0" },
			);

			// Give both workers time to register with SQS before driving any
			// events through the queues.
			await new Promise((r) => setTimeout(r, 2000));

			// Trigger a one-shot SYNC_MAILBOXES so mailfuzz mailboxes (now
			// including Sent) land in DynamoDB. The append-sent-message handler
			// resolves the Sent folder via MailboxSpecialUseService or by name
			// lookup, so the mailboxes must exist in DDB beforehand.
			const queueUrl = process.env.SQS_QUEUE_URL_MAILBOXES;
			if (!queueUrl) throw new Error("SQS_QUEUE_URL_MAILBOXES is not set");
			const sqs = createSqs();
			const syncEvent = {
				type: "SYNC_MAILBOXES" as const,
				eventId: randomUUID(),
				timestamp: Date.now(),
				accountId: ACCOUNT_ID,
			};
			await sqs.send(
				new SendMessageCommand({
					QueueUrl: queueUrl,
					MessageBody: JSON.stringify(syncEvent),
					MessageGroupId: ACCOUNT_ID,
					MessageDeduplicationId: `SYNC_MAILBOXES:${ACCOUNT_ID}:${syncEvent.eventId}`,
				}),
			);

			const mailboxService = new MailboxService(config);
			await waitFor(
				async () => {
					const result = await mailboxService.listByAccount(ACCOUNT_ID);
					const sent = result.items.find(
						(m) => m.fullPath.toLowerCase() === "sent",
					);
					if (!sent) return null;
					return sent;
				},
				{ timeoutMs: 60_000, label: "Sent mailbox to be synced" },
			);
		});

		after(async () => {
			await killWorker(imapWorker);
			await killWorker(smtpWorker);
		});

		test("send via SMTP queue, APPEND_SENT_MESSAGE lands in Sent folder", async () => {
			const outboxMessageService = new OutboxMessageService(config);
			const accountService = new AccountService(config);

			const smtpQueueUrl = process.env.SQS_QUEUE_URL_SMTP;
			if (!smtpQueueUrl) {
				throw new Error("SQS_QUEUE_URL_SMTP is not set");
			}

			const outboxQueue = new OutboxQueueService({
				outboxMessageService,
				accountService,
				sqsSmtpQueueUrl: smtpQueueUrl,
				sqsEndpoint: SQS_ENDPOINT,
			});

			const subject = `Roundtrip ${Date.now()} ${randomUUID().slice(0, 8)}`;
			const recipient = "bob@mokapi.io";
			const bodyText = "Roundtrip e2e: compose -> SMTP -> IMAP APPEND to Sent.";

			const outbox = await outboxQueue.createAndSend({
				accountId: ACCOUNT_ID,
				accountConfigId: ACCOUNT_CONFIG_ID,
				fromAddress: ROUNDTRIP_EMAIL,
				toAddresses: [recipient],
				subject,
				textBody: bodyText,
			});

			// 1. SMTP worker picks up SEND_MESSAGE, sends via mokapi, marks sent.
			//    Per issue #178 the outbox row is deleted after the IMAP APPEND
			//    completes, so the row may already be gone by the time we poll.
			//    Treat NotFoundError as success (delete implies prior status=sent).
			type SentOutbox = OutboxMessageItem | { status: "deleted" };
			const sentOutbox = await waitFor<SentOutbox>(
				async (): Promise<SentOutbox | null> => {
					const current = await outboxMessageService
						.get(ACCOUNT_CONFIG_ID, outbox.outboxMessageId)
						.catch((err: unknown) => {
							if (err instanceof NotFoundError) return null;
							throw err;
						});
					if (!current) return { status: "deleted" } as const;
					if (current.status === "sent") return current;
					if (current.status === "failed") {
						throw new Error(
							`Outbox transitioned to failed: ${current.lastError ?? "unknown"}`,
						);
					}
					return null;
				},
				{ timeoutMs: 30_000, label: "outbox status to be sent" },
			);
			if (sentOutbox.status === "sent") {
				assert.ok(
					sentOutbox.smtpMessageId,
					"smtpMessageId should be populated",
				);
				assert.ok(sentOutbox.sentAt, "sentAt should be populated");
			}

			// 2. APPEND_SENT_MESSAGE flows to message-mgmt queue, IMAP worker
			//    appends to mailfuzz Sent folder. We assert the message lands
			//    by searching for our unique subject. Times out (not silently
			//    skips) on regression — wrong queue routing or the env-var
			//    rename from PR #100 would both surface as a timeout here.
			await waitFor(
				async () => {
					let found = false;
					await withMailfuzzConnection(async (conn) => {
						await conn.openBox("Sent", true);
						const uids = await conn.search(["ALL"]);
						if (uids.length === 0) return;
						// Search the most recent UIDs first — Sent grows monotonically.
						const recent = uids.slice(-20);
						const messages = await conn.fetchMessages(recent);
						found = messages.some((m) => m.envelope?.subject === subject);
					});
					return found ? true : null;
				},
				{ timeoutMs: 60_000, label: "message to appear in mailfuzz Sent" },
			);
		});
	},
);
