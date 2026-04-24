import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	CreateQueueCommand,
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const loadEnvFile = (envPath: string) => {
	const content = readFileSync(envPath, "utf-8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx);
		let value = trimmed.slice(eqIdx + 1);
		if (value.startsWith('"') && value.endsWith('"')) {
			value = value.slice(1, -1);
		}
		if (!(key in process.env)) {
			process.env[key] = value;
		}
	}
};

loadEnvFile(resolve(__dirname, "../../../.e2e.env"));

import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
	AccountConfigService,
	AccountService,
	base36uuidv5,
	CreateFailedConflictError,
	MailboxService,
	MessageService,
	REMIT_NAMESPACE,
} from "@remit/remit-electrodb-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	serializeEncryptedPayload,
} from "@remit/secrets-service";

const MAILFUZZ_HOST = process.env.MAILFUZZ_HOST ?? "localhost";
const MAILFUZZ_PORT = Number(process.env.MAILFUZZ_PORT ?? "1143");
const MAILFUZZ_USER = process.env.MAILFUZZ_USER ?? "testuser";
const MAILFUZZ_PASSWORD = process.env.MAILFUZZ_PASSWORD ?? "testpass";

const E2E_EMAIL = `${MAILFUZZ_USER}@mailfuzz.local`;

export const E2E_USER_ID = base36uuidv5(
	`e2e:sync:${E2E_EMAIL}`,
	REMIT_NAMESPACE,
);
export const E2E_ACCOUNT_CONFIG_ID = base36uuidv5(
	`e2e:sync:config:${E2E_EMAIL}`,
	REMIT_NAMESPACE,
);
export const E2E_ACCOUNT_ID = base36uuidv5(
	`e2e:sync:account:${E2E_EMAIL}`,
	REMIT_NAMESPACE,
);

const createConfig = () => {
	const port = process.env.DYNAMODB_PORT ?? "5435";
	const table = process.env.DYNAMODB_TABLE_NAME ?? "remit-test";
	const endpoint = `http://localhost:${port}`;

	const ddbClient = new DynamoDBClient({
		endpoint,
		credentials: { accessKeyId: "fakeKey", secretAccessKey: "fakeSecretKey" },
		region: "local",
	});

	const client = DynamoDBDocumentClient.from(ddbClient);
	return { client, table };
};

const seedAccount = async (config: ReturnType<typeof createConfig>) => {
	const accountConfigService = new AccountConfigService(config);
	const accountService = new AccountService(config);
	const kmsKeyId = process.env.KMS_KEY_ID ?? "FAKE_KMS_KEY_ID";
	const dataKeyProvider = createKmsDataKeyProvider(kmsKeyId);
	const secretsService = createSecretsService(dataKeyProvider);

	const encryptedPayload = await secretsService.encrypt(MAILFUZZ_PASSWORD);
	const passwordHash = JSON.stringify(
		serializeEncryptedPayload(encryptedPayload),
	);

	try {
		await accountConfigService.create({
			accountConfigId: E2E_ACCOUNT_CONFIG_ID,
			userId: E2E_USER_ID,
			name: "E2E Sync Test Account",
		});
	} catch (err) {
		if (!(err instanceof CreateFailedConflictError)) throw err;
	}

	try {
		await accountService.create({
			accountId: E2E_ACCOUNT_ID,
			accountConfigId: E2E_ACCOUNT_CONFIG_ID,
			username: MAILFUZZ_USER,
			email: E2E_EMAIL,
			passwordHash,
			imapHost: MAILFUZZ_HOST,
			imapPort: MAILFUZZ_PORT,
			imapTls: false,
			imapStartTls: false,
			isActive: true,
			connectionState: "not_authenticated",
		});
	} catch (err) {
		if (!(err instanceof CreateFailedConflictError)) throw err;
	}
};

const spawnWorker = (): ChildProcess => {
	const projectRoot = resolve(__dirname, "../../..");
	const workerPath = resolve(
		projectRoot,
		"packages/remit-imap-worker/src/worker.ts",
	);

	const worker = spawn(
		"node",
		["--env-file=.e2e.env", "--import", "tsx", workerPath],
		{
			cwd: projectRoot,
			stdio: "pipe",
			env: {
				...process.env,
				MAILFUZZ_HOST,
				MAILFUZZ_PORT: String(MAILFUZZ_PORT),
				MAILFUZZ_USER,
				MAILFUZZ_PASSWORD,
			},
		},
	);

	worker.stdout?.on("data", (data: Buffer) => {
		process.stdout.write(`[imap-worker] ${data.toString()}`);
	});

	worker.stderr?.on("data", (data: Buffer) => {
		process.stderr.write(`[imap-worker] ${data.toString()}`);
	});

	return worker;
};

const SQS_ENDPOINT = "http://localhost:9325";

const createSqsClient = () => {
	return new SQSClient({
		endpoint: SQS_ENDPOINT,
		region: "local",
		credentials: { accessKeyId: "local", secretAccessKey: "local" },
	});
};

const triggerSync = async (accountId: string) => {
	const queueUrl = process.env.SQS_QUEUE_URL_MAILBOXES;
	if (!queueUrl) throw new Error("SQS_QUEUE_URL_MAILBOXES is not set");

	const sqs = createSqsClient();

	const event = {
		type: "SYNC_MAILBOXES",
		eventId: randomUUID(),
		timestamp: Date.now(),
		accountId,
	};

	await sqs.send(
		new SendMessageCommand({
			QueueUrl: queueUrl,
			MessageBody: JSON.stringify(event),
			MessageGroupId: accountId,
			MessageDeduplicationId: `SYNC_MAILBOXES:${accountId}:${event.eventId}`,
		}),
	);

	console.log(
		`  Sync triggered via SQS: eventId=${event.eventId} queue=${queueUrl}`,
	);
};

const waitForMailboxes = async (
	config: ReturnType<typeof createConfig>,
	accountId: string,
	timeout = 60000,
) => {
	const mailboxService = new MailboxService(config);
	const start = Date.now();
	while (Date.now() - start < timeout) {
		const result = await mailboxService.listByAccount(accountId);
		if (result.items.length > 0) return result.items;
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error("Timeout waiting for mailbox sync");
};

const waitForMessages = async (
	config: ReturnType<typeof createConfig>,
	mailboxId: string,
	timeout = 60000,
) => {
	const messageService = new MessageService(config);
	const start = Date.now();
	while (Date.now() - start < timeout) {
		const result = await messageService.listByMailbox(mailboxId);
		if (result.items.length > 0) return result.items;
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error("Timeout waiting for message sync");
};

// Store worker process for teardown
declare global {
	var __e2eWorkerProcess: ChildProcess | undefined;
}

const ensureQueuesExist = async () => {
	const sqs = createSqsClient();

	const standardQueues = [
		"remit-e2e",
		"remit-e2e-mailbox-mgmt",
		"remit-e2e-message-mgmt",
	];
	const fifoQueues = [
		"remit-e2e-mailboxes.fifo",
		"remit-e2e-messages.fifo",
		"remit-e2e-body.fifo",
		"remit-e2e-flags.fifo",
	];

	for (const queueName of standardQueues) {
		await sqs.send(new CreateQueueCommand({ QueueName: queueName }));
	}

	for (const queueName of fifoQueues) {
		await sqs.send(
			new CreateQueueCommand({
				QueueName: queueName,
				Attributes: { FifoQueue: "true" },
			}),
		);
	}

	console.log(
		`  Ensured ${standardQueues.length + fifoQueues.length} SQS queues exist`,
	);
};

const globalSetup = async () => {
	console.log("E2E Global Setup: creating account and syncing via SQS...");
	const config = createConfig();

	await seedAccount(config);
	console.log(`  AccountConfigId: ${E2E_ACCOUNT_CONFIG_ID}`);
	console.log(`  AccountId: ${E2E_ACCOUNT_ID}`);

	await ensureQueuesExist();

	const worker = spawnWorker();
	globalThis.__e2eWorkerProcess = worker;

	// Give the worker a moment to start polling
	await new Promise((r) => setTimeout(r, 2000));

	await triggerSync(E2E_ACCOUNT_ID);

	const mailboxes = await waitForMailboxes(config, E2E_ACCOUNT_ID);
	console.log(`  Mailbox sync complete: ${mailboxes.length} mailboxes`);

	const inbox = mailboxes.find((m) => m.fullPath.toUpperCase() === "INBOX");
	if (inbox) {
		const messages = await waitForMessages(config, inbox.mailboxId);
		console.log(
			`  Message sync complete: ${messages.length} messages in INBOX`,
		);
	} else {
		console.log("  No INBOX found, skipping message wait");
	}

	console.log("E2E Global Setup: done");
};

export default globalSetup;
