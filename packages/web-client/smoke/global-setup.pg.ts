import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	AccountConfigRepo,
	AccountRepo,
	AddressRepo,
	DrizzleEnvelopeRepository,
	DrizzleMessageRepository,
	DrizzleThreadMessageRepository,
	MailboxRepo,
	MailboxSpecialUseRepo,
	mailboxTable,
	messageDataSchema,
	OutboxMessageRepo,
} from "@remit/drizzle-service";
import { MailboxSpecialUse } from "@remit/domain-enums";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import shortUuid from "short-uuid";
import { v5 as uuidv5 } from "uuid";
import {
	DRAFTS_ID,
	DRAFTS_IMAP_MESSAGE_ID_HEADER,
	E2E_ACCOUNT_CONFIG_ID,
	E2E_ACCOUNT_ID,
	E2E_EMAIL,
	E2E_IMAP_PASSWORD,
	E2E_USER_ID,
	INBOX_ID,
	SENT_ID,
	TRASH_ID,
} from "./seed-constants.js";

export {
	E2E_ACCOUNT_CONFIG_ID,
	E2E_ACCOUNT_ID,
	E2E_USER_ID,
	INBOX_ID,
	SAMPLE_MESSAGE_ID,
	SAMPLE_MESSAGE_ID_HEADER,
} from "./seed-constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, "../../..");

// The same namespace as remit-electrodb-service and remit-drizzle-service
const REMIT_NAMESPACE = "9e89694d-214b-4d9b-99f5-214b4d9b99f5";

// Mirrors base36uuidv5 from remit-electrodb-service/remit-drizzle-service
const base36Translator = shortUuid.createTranslator(
	shortUuid.constants.uuid25Base36,
);
const base36uuidv5 = (name: string): string =>
	base36Translator.fromUUID(uuidv5(name, REMIT_NAMESPACE));

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

// Fixed-clock support: mirrors global-setup.ts
const parseFakeNow = (): number => {
	const raw = process.env.REMIT_FAKE_NOW;
	if (raw === undefined || raw === "") return Date.now();
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
		throw new Error(
			`REMIT_FAKE_NOW must be an integer epoch-ms value, got: ${raw}`,
		);
	}
	return parsed;
};

const NOW = parseFakeNow();

const storeMessageBody = (
	accountConfigId: string,
	accountId: string,
	messageId: string,
	bodyText: string,
): string => {
	const storagePath = process.env.STORAGE_LOCAL_PATH ?? ".remit/e2e-storage";
	const basePath = resolve(REPO_ROOT, storagePath);
	const storageKey = `accounts/${accountConfigId}/${accountId}/messages/${messageId}/body.eml`;
	const fullPath = resolve(basePath, storageKey);

	const emlContent = [
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"Content-Transfer-Encoding: 7bit",
		"",
		bodyText,
	].join("\r\n");

	mkdirSync(dirname(fullPath), { recursive: true });
	writeFileSync(fullPath, emlContent);

	const partKey = `accounts/${accountConfigId}/${accountId}/messages/${messageId}/parts/1`;
	const partPath = resolve(basePath, partKey);
	mkdirSync(dirname(partPath), { recursive: true });
	writeFileSync(partPath, bodyText);

	return `file://${fullPath}`;
};

/**
 * ID generation — mirrors remit-electrodb-service so the same seeds produce
 * the same IDs regardless of which backend is in use.
 *
 * messageId / threadId: 25-char base36 strings (same as DDB), stored in text
 * columns in the PG schema.
 *
 * envelopeId / bodyPartId / addressId: UUID format (uuid column types).
 */
const pgMessageId = (accountId: string, messageIdHeader: string): string =>
	base36uuidv5(`message:${accountId}:${messageIdHeader}`);

const pgEnvelopeId = (messageId: string): string =>
	uuidv5(`envelope:${messageId}`, REMIT_NAMESPACE);

// addressId is text in the address table and must be 25 chars (base36) to
// pass API validation when used in PATCH /addresses/{addressId}
const pgAddressId = (email: string): string => base36uuidv5(`address:${email}`);

// envelopeAddressId is uuid type (primary key, not in API path) — UUID format OK
const pgEnvelopeAddressId = (
	messageId: string,
	role: string,
	order: number,
): string => uuidv5(`addr:${messageId}:${role}:${order}`, REMIT_NAMESPACE);

const pgThreadId = (accountId: string, rootMessageIdHeader: string): string =>
	base36uuidv5(`thread:${accountId}:${rootMessageIdHeader.toLowerCase()}`);

interface TestMessage {
	messageIdHeader: string;
	uid: number;
	subject: string;
	fromEmail: string;
	fromName: string;
	bodyText: string;
	sentDate: number;
	isRead: boolean;
}

const TEST_MESSAGES: TestMessage[] = [
	{
		messageIdHeader: "<e2e-msg-1@test.local>",
		uid: 1,
		subject: "Welcome to Remit",
		fromEmail: "onboarding@remit.dev",
		fromName: "Remit Onboarding",
		bodyText:
			"Welcome to Remit! This is your first email in the test account. We hope you enjoy using our email client.",
		sentDate: NOW - 5 * 86_400_000,
		isRead: true,
	},
	{
		messageIdHeader: "<e2e-msg-2@test.local>",
		uid: 2,
		subject: "Meeting tomorrow at 10am",
		fromEmail: "alice@example.com",
		fromName: "Alice Johnson",
		bodyText:
			"Hi, just a reminder that we have a meeting scheduled for tomorrow at 10am. Please make sure to prepare the agenda items.",
		sentDate: NOW - 3 * 86_400_000,
		isRead: true,
	},
	{
		messageIdHeader: "<e2e-msg-3@test.local>",
		uid: 3,
		subject: "Project update: Q1 results",
		fromEmail: "bob@example.com",
		fromName: "Bob Smith",
		bodyText:
			"Here are the Q1 results for the project. Overall performance has been strong with a 15% increase in key metrics.",
		sentDate: NOW - 2 * 86_400_000,
		isRead: true,
	},
	{
		messageIdHeader: "<e2e-msg-4@test.local>",
		uid: 4,
		subject: "Invoice #1234 attached",
		fromEmail: "billing@acme.com",
		fromName: "ACME Billing",
		bodyText:
			"Please find attached your invoice #1234 for the services rendered in February. Payment is due within 30 days.",
		sentDate: NOW - 86_400_000,
		isRead: false,
	},
	{
		messageIdHeader: "<e2e-msg-5@test.local>",
		uid: 5,
		subject: "Weekend plans?",
		fromEmail: "charlie@example.com",
		fromName: "Charlie Brown",
		bodyText:
			"Hey! Do you have any plans for this weekend? I was thinking we could go hiking or catch a movie.",
		sentDate: NOW - 3_600_000,
		isRead: false,
	},
	{
		messageIdHeader: "<e2e-msg-6@test.local>",
		uid: 6,
		subject: "Re: hi",
		fromEmail: "vincent@example.com",
		fromName: "Vincent Regter",
		bodyText: "Sure, sounds good!",
		sentDate: NOW - 1_800_000,
		isRead: true,
	},
];

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

	const encryptedPayload = await secretsService.encrypt(E2E_IMAP_PASSWORD);
	const passwordHash = JSON.stringify(
		serializeEncryptedPayload(encryptedPayload),
	);

	await accountConfigService.create({
		accountConfigId: E2E_ACCOUNT_CONFIG_ID,
		userId: E2E_USER_ID,
		name: "E2E Test Account",
	});

	await accountService.create({
		accountId: E2E_ACCOUNT_ID,
		accountConfigId: E2E_ACCOUNT_CONFIG_ID,
		username: "vmail",
		email: E2E_EMAIL,
		passwordHash,
		imapHost: "localhost",
		imapPort: 1143,
		imapTls: false,
		imapStartTls: false,
		smtpEnabled: true,
		smtpHost: "localhost",
		smtpPort: 2525,
		smtpTls: false,
		smtpStartTls: false,
		isActive: true,
		connectionState: "not_authenticated",
	});
};

const seedMailboxes = async (db: NodePgDatabase<Record<string, unknown>>) => {
	const specialUseService = new MailboxSpecialUseRepo(db);

	const mailboxes: Array<{
		mailboxId: string;
		fullPath: string;
		messageCount: number;
		unseenCount: number;
		specialUse?: MailboxSpecialUse;
	}> = [
		{
			mailboxId: INBOX_ID,
			fullPath: "INBOX",
			messageCount: 5,
			unseenCount: 2,
		},
		{
			mailboxId: SENT_ID,
			fullPath: "Sent",
			messageCount: 0,
			unseenCount: 0,
			specialUse: MailboxSpecialUse.Sent,
		},
		{
			mailboxId: TRASH_ID,
			fullPath: "Trash",
			messageCount: 0,
			unseenCount: 0,
			specialUse: MailboxSpecialUse.Trash,
		},
		{
			mailboxId: DRAFTS_ID,
			fullPath: "Drafts",
			messageCount: 1,
			unseenCount: 0,
			specialUse: MailboxSpecialUse.Drafts,
		},
	];

	for (const mb of mailboxes) {
		// Direct insert to supply the deterministic mailboxId from seed-constants.
		// CreateMailboxInput omits mailboxId (auto-generated), so we bypass the repo.
		await db
			.insert(mailboxTable)
			.values({
				mailboxId: mb.mailboxId,
				accountId: E2E_ACCOUNT_ID,
				namespaceType: "personal",
				namespacePrefix: "",
				hierarchyDelimiter: "/",
				fullPath: mb.fullPath,
				uidValidity: 1,
				uidNext: mb.messageCount + 1,
				highestModseq: 1,
				messageCount: mb.messageCount,
				unseenCount: mb.unseenCount,
				deletedCount: 0,
				totalSize: 0,
				lastSyncUid: mb.messageCount,
				highWaterMarkUid: mb.messageCount,
				lastMessageSyncAt: NOW,
				specialUse: mb.specialUse ? [mb.specialUse] : null,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.onConflictDoNothing();

		if (mb.specialUse) {
			await specialUseService.create(mb.mailboxId, mb.specialUse);
		}
	}
};

const seedMessages = async (
	messageRepo: DrizzleMessageRepository,
	envelopeRepo: DrizzleEnvelopeRepository,
	addressRepo: AddressRepo,
	threadMessageRepo: DrizzleThreadMessageRepository,
) => {
	for (const msg of TEST_MESSAGES) {
		// uuid-format IDs for uuid columns (message, envelope, envelope_address, address)
		const messageId = pgMessageId(E2E_ACCOUNT_ID, msg.messageIdHeader);
		const envelopeId = pgEnvelopeId(messageId);
		const threadId = pgThreadId(E2E_ACCOUNT_ID, msg.messageIdHeader);
		const fromAddressId = pgAddressId(msg.fromEmail);
		const envAddressId = pgEnvelopeAddressId(messageId, "from", 0);

		const bodyStorageKey = storeMessageBody(
			E2E_ACCOUNT_CONFIG_ID,
			E2E_ACCOUNT_ID,
			messageId,
			msg.bodyText,
		);

		await messageRepo.create({
			messageId,
			mailboxId: INBOX_ID,
			uid: msg.uid,
			sequenceNumber: msg.uid,
			rfc822Size: msg.bodyText.length + 200,
			internalDate: msg.sentDate,
			messageIdHeader: msg.messageIdHeader,
			envelopeId,
			rootBodyPartId: randomUUID(),
			bodyStorageKey,
		});

		await envelopeRepo.createEnvelope({
			envelopeId,
			messageId,
			dateValue: msg.sentDate,
			dateRaw: new Date(msg.sentDate).toUTCString(),
			subject: msg.subject,
			messageIdValue: msg.messageIdHeader,
		});

		const [fromLocal, fromDomain] = msg.fromEmail.split("@");
		await addressRepo.upsertAddress({
			addressId: fromAddressId,
			accountConfigId: E2E_ACCOUNT_CONFIG_ID,
			displayName: msg.fromName,
			localPart: fromLocal,
			domain: fromDomain ?? "",
			normalizedEmail: msg.fromEmail.toLowerCase(),
			normalizedCompound: `${msg.fromName.toLowerCase()} ${msg.fromEmail.toLowerCase()}`,
		});

		await addressRepo.upsertEnvelopeAddress({
			envelopeAddressId: envAddressId,
			messageId,
			addressId: fromAddressId,
			normalizedEmail: msg.fromEmail,
			addressRole: "from",
			addressOrder: 0,
			displayName: msg.fromName,
		});

		// thread_message stores messageId as text — uuid-format strings are valid text
		await threadMessageRepo.create({
			threadId,
			messageId,
			accountConfigId: E2E_ACCOUNT_CONFIG_ID,
			mailboxId: INBOX_ID,
			uid: msg.uid,
			referenceOrder: 0,
			fromEmail: msg.fromEmail,
			fromName: msg.fromName,
			subject: msg.subject,
			internalDate: msg.sentDate,
			sentDate: msg.sentDate,
			isRead: msg.isRead,
			hasAttachment: false,
			hasStars: false,
			isDeleted: false,
			snippet: msg.bodyText.slice(0, 100),
		});

		await envelopeRepo.upsertBodyParts(messageId, [
			{
				partPath: "1",
				parentPartPath: null,
				mediaType: "TEXT",
				mediaSubtype: "PLAIN",
				transferEncoding: "7BIT",
				sizeOctets: msg.bodyText.length,
				isMultipart: false,
				parameters: [{ parameterName: "CHARSET", parameterValue: "utf-8" }],
			},
		]);
	}
};

const seedDrafts = async (
	messageRepo: DrizzleMessageRepository,
	envelopeRepo: DrizzleEnvelopeRepository,
	threadMessageRepo: DrizzleThreadMessageRepository,
	outboxRepo: OutboxMessageRepo,
) => {
	const imapDraft = {
		messageIdHeader: DRAFTS_IMAP_MESSAGE_ID_HEADER,
		uid: 1,
		subject: "Server draft reply",
		fromEmail: E2E_EMAIL,
		fromName: "Me",
		bodyText: "This draft was saved on the IMAP server.",
		sentDate: NOW - 7_200_000,
	};

	const messageId = pgMessageId(E2E_ACCOUNT_ID, imapDraft.messageIdHeader);
	const envelopeId = pgEnvelopeId(messageId);
	const threadId = pgThreadId(E2E_ACCOUNT_ID, imapDraft.messageIdHeader);

	const bodyStorageKey = storeMessageBody(
		E2E_ACCOUNT_CONFIG_ID,
		E2E_ACCOUNT_ID,
		messageId,
		imapDraft.bodyText,
	);

	await messageRepo.create({
		messageId,
		mailboxId: DRAFTS_ID,
		uid: imapDraft.uid,
		sequenceNumber: imapDraft.uid,
		rfc822Size: imapDraft.bodyText.length + 200,
		internalDate: imapDraft.sentDate,
		messageIdHeader: imapDraft.messageIdHeader,
		envelopeId,
		rootBodyPartId: randomUUID(),
		bodyStorageKey,
	});

	await envelopeRepo.createEnvelope({
		envelopeId,
		messageId,
		dateValue: imapDraft.sentDate,
		dateRaw: new Date(imapDraft.sentDate).toUTCString(),
		subject: imapDraft.subject,
		messageIdValue: imapDraft.messageIdHeader,
	});

	await threadMessageRepo.create({
		threadId,
		messageId,
		accountConfigId: E2E_ACCOUNT_CONFIG_ID,
		mailboxId: DRAFTS_ID,
		uid: imapDraft.uid,
		referenceOrder: 0,
		fromEmail: imapDraft.fromEmail,
		fromName: imapDraft.fromName,
		subject: imapDraft.subject,
		internalDate: imapDraft.sentDate,
		sentDate: imapDraft.sentDate,
		isRead: true,
		hasAttachment: false,
		hasStars: false,
		isDeleted: false,
		snippet: imapDraft.bodyText.slice(0, 100),
	});

	await envelopeRepo.upsertBodyParts(messageId, [
		{
			partPath: "1",
			parentPartPath: null,
			mediaType: "TEXT",
			mediaSubtype: "PLAIN",
			transferEncoding: "7BIT",
			sizeOctets: imapDraft.bodyText.length,
			isMultipart: false,
			parameters: [{ parameterName: "CHARSET", parameterValue: "utf-8" }],
		},
	]);

	const existingDrafts = await outboxRepo.listByAccount(E2E_ACCOUNT_ID);
	const hasDraft = existingDrafts.items.some((m) => m.status === "draft");
	if (!hasDraft) {
		await outboxRepo.create({
			accountId: E2E_ACCOUNT_ID,
			accountConfigId: E2E_ACCOUNT_CONFIG_ID,
			fromAddress: E2E_EMAIL,
			toAddresses: ["alice@example.com"],
			subject: "Unsent Remit draft",
			textBody: "This draft lives only in Remit's outbox, not yet on IMAP.",
			messageIdValue: `${Date.now()}@remit.local`,
			status: "draft",
		});
	}
};

const globalSetup = async () => {
	console.log("PG Smoke Setup: starting...");

	// Ensure the OpenAPI spec is generated; the backend crashes without it
	const openapiPath = resolve(REPO_ROOT, "build/remit-openapi3/openapi.json");
	if (!existsSync(openapiPath)) {
		console.log("PG Smoke Setup: running codegen...");
		execSync("npm run codegen", { stdio: "inherit", cwd: REPO_ROOT });
	}

	// Push the schema to the test database
	console.log("PG Smoke Setup: pushing schema to remit_test...");
	execSync("npm run pg:schema:push:test", {
		stdio: "inherit",
		cwd: REPO_ROOT,
	});

	const pgConnectionUrl =
		process.env.PG_CONNECTION_URL ??
		"postgresql://remit:remit@localhost:5432/remit_test";

	const pool = new pg.Pool({ connectionString: pgConnectionUrl });

	const messageDb = drizzle(pool, { schema: messageDataSchema });
	const genericDb = messageDb as unknown as NodePgDatabase<
		Record<string, unknown>
	>;

	const envelopeRepo = new DrizzleEnvelopeRepository(messageDb);
	const messageRepo = new DrizzleMessageRepository(messageDb);
	const addressRepo = new AddressRepo(genericDb);
	const outboxRepo = new OutboxMessageRepo(genericDb);
	const threadMessageRepo = new DrizzleThreadMessageRepository(pgConnectionUrl);

	try {
		await cleanDatabase(pool);
		await seedAccount(genericDb);
		await seedMailboxes(genericDb);
		await seedMessages(
			messageRepo,
			envelopeRepo,
			addressRepo,
			threadMessageRepo,
		);
		await seedDrafts(messageRepo, envelopeRepo, threadMessageRepo, outboxRepo);
	} finally {
		await threadMessageRepo.close();
		await pool.end();
	}

	console.log(`  AccountConfigId: ${E2E_ACCOUNT_CONFIG_ID}`);
	console.log(`  AccountId: ${E2E_ACCOUNT_ID}`);
	console.log(`  INBOX mailboxId: ${INBOX_ID}`);
	console.log(`  DRAFTS mailboxId: ${DRAFTS_ID}`);
	console.log(`  Seeded ${TEST_MESSAGES.length} messages + 1 IMAP draft`);
	console.log("PG Smoke Setup: done");
};

export default globalSetup;
