import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

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
	AddressService,
	base36uuidv5,
	CreateFailedConflictError,
	EnvelopeService,
	MailboxService,
	MessageService,
	REMIT_NAMESPACE,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import {
	createConnectionFromAccount,
	createManagedConnectionFactory,
	MailboxSyncService,
	MessageSyncService,
} from "@remit/mailbox-service";
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

const MESSAGE_BATCH_SIZE = 200;

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

const syncMailboxes = async (config: ReturnType<typeof createConfig>) => {
	const mailboxSyncService = new MailboxSyncService(config);

	const connection = createConnectionFromAccount(
		{
			username: MAILFUZZ_USER,
			imapHost: MAILFUZZ_HOST,
			imapPort: MAILFUZZ_PORT,
			imapTls: false,
		},
		MAILFUZZ_PASSWORD,
	);

	await connection.connect();

	const result = await mailboxSyncService
		.syncMailboxes({ accountId: E2E_ACCOUNT_ID }, connection)
		.finally(() => connection.disconnect());

	console.log(
		`  Mailbox sync: created=${result.created}, updated=${result.updated}, deleted=${result.deleted}`,
	);

	return result;
};

const syncMessages = async (config: ReturnType<typeof createConfig>) => {
	const mailboxService = new MailboxService(config);
	const messageService = new MessageService(config);
	const envelopeService = new EnvelopeService(config);
	const addressService = new AddressService(config);
	const threadMessageService = new ThreadMessageService(config);

	const connectionFactory = createManagedConnectionFactory({
		user: MAILFUZZ_USER,
		password: MAILFUZZ_PASSWORD,
		host: MAILFUZZ_HOST,
		port: MAILFUZZ_PORT,
		tls: false,
	});

	const syncService = new MessageSyncService(
		connectionFactory,
		mailboxService,
		messageService,
		envelopeService,
		addressService,
		threadMessageService,
	);

	const conn = connectionFactory.getConnection();
	await conn.connect();

	const mailboxes = await mailboxService.listByAccount(E2E_ACCOUNT_ID);
	const inbox = mailboxes.items.find(
		(m) => m.fullPath.toUpperCase() === "INBOX",
	);

	if (!inbox) {
		await connectionFactory.close();
		console.log("  No INBOX found, skipping message sync");
		return;
	}

	let hasMore = true;
	let totalSynced = 0;

	while (hasMore) {
		const result = await syncService.syncMessages(
			inbox.mailboxId,
			E2E_ACCOUNT_CONFIG_ID,
			MESSAGE_BATCH_SIZE,
		);
		totalSynced += result.syncedCount;
		hasMore = result.hasMore;
	}

	await connectionFactory.close();
	console.log(`  Message sync: synced ${totalSynced} messages from INBOX`);
};

const globalSetup = async () => {
	console.log("E2E Global Setup: creating account and syncing via IMAP...");
	const config = createConfig();

	await seedAccount(config);
	console.log(`  AccountConfigId: ${E2E_ACCOUNT_CONFIG_ID}`);
	console.log(`  AccountId: ${E2E_ACCOUNT_ID}`);

	await syncMailboxes(config);
	await syncMessages(config);

	console.log("E2E Global Setup: done");
};

export default globalSetup;
