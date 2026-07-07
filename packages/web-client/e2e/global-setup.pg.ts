import { type ChildProcess, execSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CreateQueueCommand,
	PurgeQueueCommand,
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import {
	AccountConfigRepo,
	AccountRepo,
	DrizzleThreadMessageRepository,
	MailboxRepo,
	messageDataSchema,
} from "@remit/drizzle-service";
import { base36uuidv5, REMIT_NAMESPACE } from "@remit/remit-electrodb-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import nodemailer from "nodemailer";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, "../../..");

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

loadEnvFile(resolve(REPO_ROOT, ".e2e.env"));

const MAILFUZZ_HOST = process.env.MAILFUZZ_HOST ?? "localhost";
const MAILFUZZ_PORT = Number(process.env.MAILFUZZ_PORT ?? "1143");
const MAILFUZZ_USER = process.env.MAILFUZZ_USER ?? "vmail";
const MAILFUZZ_PASSWORD = process.env.MAILFUZZ_PASSWORD ?? "testpass123";

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

const PG_CONNECTION_URL =
	process.env.PG_CONNECTION_URL ??
	"postgresql://remit:remit@localhost:5432/remit_test";

const SQS_ENDPOINT = process.env.SQS_ENDPOINT ?? "http://localhost:9324";

const createSqsClient = () =>
	new SQSClient({
		endpoint: SQS_ENDPOINT,
		region: "local",
		credentials: { accessKeyId: "local", secretAccessKey: "local" },
	});

const cleanDatabase = async (pool: pg.Pool) => {
	await pool.query(`
		TRUNCATE
			account_config, account, account_setting, account_export_request,
			mailbox, mailbox_special_use_entry, mailbox_lock,
			address,
			thread_message,
			message, envelope, message_reference, envelope_address,
			body_part, body_part_parameter, raw_message_storage,
			body_part_storage, body_part_content, message_flag, outbox,
			outbox_message
	`);
};

const seedAccount = async (db: NodePgDatabase<Record<string, unknown>>) => {
	const accountConfigService = new AccountConfigRepo(db);
	const accountService = new AccountRepo(db);
	const kmsKeyId = process.env.KMS_KEY_ID ?? "FAKE_KMS_KEY_ID";
	const dataKeyProvider = createKmsDataKeyProvider(kmsKeyId);
	const secretsService = createSecretsService(dataKeyProvider);

	const encryptedPayload = await secretsService.encrypt(MAILFUZZ_PASSWORD);
	const passwordHash = JSON.stringify(
		serializeEncryptedPayload(encryptedPayload),
	);

	await accountConfigService.create({
		accountConfigId: E2E_ACCOUNT_CONFIG_ID,
		userId: E2E_USER_ID,
		name: "E2E PG Sync Test Account",
	});

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
};

const ensureQueuesExist = async () => {
	const sqs = createSqsClient();

	const standardQueues = [
		"remit-e2e",
		"remit-e2e-body",
		"remit-e2e-mailbox-mgmt",
		"remit-e2e-message-mgmt",
	];
	const fifoQueues = [
		"remit-e2e-mailboxes.fifo",
		"remit-e2e-messages.fifo",
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

const purgeQueues = async () => {
	const sqs = createSqsClient();
	const allQueues = [
		"remit-e2e",
		"remit-e2e-body",
		"remit-e2e-mailbox-mgmt",
		"remit-e2e-message-mgmt",
		"remit-e2e-mailboxes.fifo",
		"remit-e2e-messages.fifo",
		"remit-e2e-flags.fifo",
	];

	for (const queueName of allQueues) {
		const url = `${SQS_ENDPOINT}/000000000000/${queueName}`;
		await sqs.send(new PurgeQueueCommand({ QueueUrl: url })).catch(() => {
			// Queue may not exist yet; ensureQueuesExist runs next
		});
	}

	console.log("  Purged all e2e SQS queues (clean slate for PG run)");
};

const injectTestMessages = async () => {
	const smtpHost = process.env.MOKAPI_SMTP_HOST ?? "localhost";
	const smtpPort = Number(process.env.MOKAPI_SMTP_PORT ?? "2525");
	const smtpUser = process.env.MOKAPI_SMTP_USER ?? "alice@mokapi.io";
	const smtpPass = process.env.MOKAPI_SMTP_PASSWORD ?? "alice123";

	const transport = nodemailer.createTransport({
		host: smtpHost,
		port: smtpPort,
		secure: false,
		ignoreTLS: true,
		auth: { user: smtpUser, pass: smtpPass },
	});

	try {
		await transport.sendMail({
			from: smtpUser,
			to: E2E_EMAIL,
			subject: "E2E PG test message 1",
			text: "First test message for pg e2e sync.",
		});
		await transport.sendMail({
			from: smtpUser,
			to: E2E_EMAIL,
			subject: "E2E PG test message 2",
			text: "Second test message for pg e2e sync.",
		});
		console.log(`  Injected 2 test messages to ${E2E_EMAIL} via SMTP`);
	} finally {
		transport.close();
	}
};

const spawnWorker = (): ChildProcess => {
	const workerPath = resolve(
		REPO_ROOT,
		"packages/imap-worker/src/e2e-processor-shim.ts",
	);

	// Strip real AWS credentials so the worker uses the fake local ones from .e2e.env
	const {
		AWS_PROFILE,
		AWS_SDK_LOAD_CONFIG,
		AWS_ACCESS_KEY_ID: _ak,
		AWS_SECRET_ACCESS_KEY: _sk,
		AWS_SESSION_TOKEN,
		...spawnEnv
	} = process.env;

	const worker = spawn(
		"node",
		["--env-file=.e2e.env", "--import", "tsx", workerPath],
		{
			cwd: REPO_ROOT,
			stdio: "pipe",
			env: {
				...spawnEnv,
				AWS_ACCESS_KEY_ID: "local",
				AWS_SECRET_ACCESS_KEY: "local",
				AWS_REGION: "not-a-region",
				DATA_BACKEND: "postgres",
				PG_CONNECTION_URL,
				MAILFUZZ_HOST,
				MAILFUZZ_PORT: String(MAILFUZZ_PORT),
				MAILFUZZ_USER,
				MAILFUZZ_PASSWORD,
			},
		},
	);

	worker.stdout?.on("data", (data: Buffer) => {
		process.stdout.write(`[imap-worker-pg] ${data.toString()}`);
	});

	worker.stderr?.on("data", (data: Buffer) => {
		process.stderr.write(`[imap-worker-pg] ${data.toString()}`);
	});

	return worker;
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
	db: NodePgDatabase<Record<string, unknown>>,
	accountId: string,
	timeout = 60000,
) => {
	const mailboxRepo = new MailboxRepo(db);
	const start = Date.now();
	while (Date.now() - start < timeout) {
		const result = await mailboxRepo.listByAccount(accountId);
		if (result.items.length > 0) return result.items;
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error("Timeout waiting for mailbox sync in Postgres");
};

const waitForMessages = async (
	pgConnectionUrl: string,
	accountConfigId: string,
	mailboxId: string,
	timeout = 60000,
) => {
	const threadMessageRepo = new DrizzleThreadMessageRepository(pgConnectionUrl);
	const start = Date.now();
	try {
		while (Date.now() - start < timeout) {
			const result = await threadMessageRepo.listByMailbox(
				accountConfigId,
				mailboxId,
				{ limit: 1 },
			);
			if (result.items.length > 0) return result.items;
			await new Promise((r) => setTimeout(r, 1000));
		}
		throw new Error("Timeout waiting for message sync in Postgres");
	} finally {
		await threadMessageRepo.close();
	}
};

declare global {
	var __e2eWorkerProcess: ChildProcess | undefined;
}

const globalSetup = async () => {
	console.log("E2E PG Global Setup: starting...");

	const openapiPath = resolve(REPO_ROOT, "build/remit-openapi3/openapi.json");
	if (!existsSync(openapiPath)) {
		console.log("E2E PG Global Setup: running codegen...");
		execSync("npm run codegen", { stdio: "inherit", cwd: REPO_ROOT });
	}

	console.log("E2E PG Global Setup: pushing schema to remit_test...");
	execSync("npm run pg:schema:push:test", { stdio: "inherit", cwd: REPO_ROOT });

	const pool = new pg.Pool({ connectionString: PG_CONNECTION_URL });
	const db = drizzle(pool, { schema: messageDataSchema });
	const genericDb = db as unknown as NodePgDatabase<Record<string, unknown>>;

	await cleanDatabase(pool);
	await seedAccount(genericDb);

	console.log(`  AccountConfigId: ${E2E_ACCOUNT_CONFIG_ID}`);
	console.log(`  AccountId: ${E2E_ACCOUNT_ID}`);
	console.log(
		`  IMAP: ${MAILFUZZ_HOST}:${MAILFUZZ_PORT} (user=${MAILFUZZ_USER})`,
	);

	await purgeQueues();
	await ensureQueuesExist();
	await injectTestMessages();

	const worker = spawnWorker();
	globalThis.__e2eWorkerProcess = worker;

	await new Promise((r) => setTimeout(r, 2000));

	await triggerSync(E2E_ACCOUNT_ID);

	const mailboxes = await waitForMailboxes(genericDb, E2E_ACCOUNT_ID);
	console.log(`  Mailbox sync complete: ${mailboxes.length} mailboxes`);

	const inbox = mailboxes.find((m) => m.fullPath.toUpperCase() === "INBOX");
	if (inbox) {
		const messages = await waitForMessages(
			PG_CONNECTION_URL,
			E2E_ACCOUNT_CONFIG_ID,
			inbox.mailboxId,
		);
		console.log(
			`  Message sync complete: ${messages.length} messages in INBOX`,
		);
	} else {
		console.log("  No INBOX found, skipping message wait");
	}

	await pool.end();

	console.log("E2E PG Global Setup: done");
};

export default globalSetup;
