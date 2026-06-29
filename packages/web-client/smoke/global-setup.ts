import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { Mailbox } from "@remit/electrodb-entities";
import {
	AccountConfigService,
	AccountService,
	AddressService,
	base36uuid,
	base36uuidv5,
	CreateFailedConflictError,
	EnvelopeService,
	MailboxSpecialUseService,
	MessageService,
	OutboxMessageService,
	REMIT_NAMESPACE,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { MailboxSpecialUse } from "@remit/domain-enums";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import { Entity } from "electrodb";
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
} from "./seed-constants";

export {
	E2E_ACCOUNT_CONFIG_ID,
	E2E_ACCOUNT_ID,
	E2E_USER_ID,
	INBOX_ID,
	SAMPLE_MESSAGE_ID,
	SAMPLE_MESSAGE_ID_HEADER,
} from "./seed-constants";

// Fixed-clock support: when REMIT_FAKE_NOW is set (epoch ms), use it for
// all sentDate / internalDate / lastMessageSyncAt seeds so the visual
// regression suite produces byte-stable timestamps. Falls back to
// Date.now() so other paths (e2e, smoke) stay on wall-clock time.
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

	const encryptedPayload = await secretsService.encrypt(E2E_IMAP_PASSWORD);
	const passwordHash = JSON.stringify(
		serializeEncryptedPayload(encryptedPayload),
	);

	try {
		await accountConfigService.create({
			accountConfigId: E2E_ACCOUNT_CONFIG_ID,
			userId: E2E_USER_ID,
			name: `E2E Test Account`,
		});
	} catch (err) {
		if (!(err instanceof CreateFailedConflictError)) throw err;
	}

	try {
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
	} catch (err) {
		if (!(err instanceof CreateFailedConflictError)) throw err;
		// Update SMTP fields on existing account (may have been created without them)
		await accountService.update(E2E_ACCOUNT_ID, {
			smtpEnabled: true,
			smtpHost: "localhost",
			smtpPort: 2525,
			smtpTls: false,
			smtpStartTls: false,
		});
	}
};

const seedMailboxes = async (config: ReturnType<typeof createConfig>) => {
	const { client, table } = config;
	const mailboxEntity = new Entity(Mailbox, { client, table });
	const specialUseService = new MailboxSpecialUseService(config);

	const mailboxes = [
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
			// IMAP \Drafts mailbox — holds the seeded "On the server" draft for
			// the Drafts-view smoke (#505). One unseen so the section has data.
			mailboxId: DRAFTS_ID,
			fullPath: "Drafts",
			messageCount: 1,
			unseenCount: 0,
			specialUse: MailboxSpecialUse.Drafts,
		},
	];

	for (const mb of mailboxes) {
		await mailboxEntity
			.put({
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
				specialUse: mb.specialUse ? [mb.specialUse] : undefined,
			})
			.go();

		if (mb.specialUse) {
			try {
				await specialUseService.create(mb.mailboxId, mb.specialUse);
			} catch {
				// ignore duplicate
			}
		}
	}
};

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

const storeMessageBody = (
	accountConfigId: string,
	accountId: string,
	messageId: string,
	bodyText: string,
): string => {
	const storagePath = process.env.STORAGE_LOCAL_PATH ?? ".remit/e2e-storage";
	const basePath = resolve(process.cwd(), "../../", storagePath);
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

	// Also write the per-part bytes that the SPA fetches via /content/*
	// (#224 PR 3). The dev-server's local content route reads from this
	// path and the SPA fetches the bytes the same way it would from
	// CloudFront in dev/prod.
	const partKey = `accounts/${accountConfigId}/${accountId}/messages/${messageId}/parts/1`;
	const partPath = resolve(basePath, partKey);
	mkdirSync(dirname(partPath), { recursive: true });
	writeFileSync(partPath, bodyText);

	return `file://${fullPath}`;
};

const seedMessages = async (config: ReturnType<typeof createConfig>) => {
	const messageService = new MessageService(config);
	const envelopeService = new EnvelopeService(config);
	const addressService = new AddressService(config);
	const threadMessageService = new ThreadMessageService(config);

	for (const msg of TEST_MESSAGES) {
		const messageId = MessageService.generateId(
			E2E_ACCOUNT_ID,
			msg.messageIdHeader,
		);
		const envelopeId = EnvelopeService.generateId(messageId);
		const threadId = ThreadMessageService.deriveThreadId(
			E2E_ACCOUNT_ID,
			msg.messageIdHeader,
		);
		const envelopeAddressId = base36uuidv5(
			`addr:${messageId}:from:0`,
			REMIT_NAMESPACE,
		);

		const bodyStorageKey = storeMessageBody(
			E2E_ACCOUNT_CONFIG_ID,
			E2E_ACCOUNT_ID,
			messageId,
			msg.bodyText,
		);

		try {
			await messageService.create({
				messageId,
				mailboxId: INBOX_ID,
				uid: msg.uid,
				sequenceNumber: msg.uid,
				rfc822Size: msg.bodyText.length + 200,
				internalDate: msg.sentDate,
				messageIdHeader: msg.messageIdHeader,
				envelopeId,
				rootBodyPartId: base36uuid(),
				bodyStorageKey,
			});
		} catch (err) {
			if (!(err instanceof CreateFailedConflictError)) throw err;
		}

		try {
			await envelopeService.createEnvelope({
				envelopeId,
				messageId,
				dateValue: msg.sentDate,
				dateRaw: new Date(msg.sentDate).toUTCString(),
				subject: msg.subject,
				messageIdValue: msg.messageIdHeader,
			});
		} catch (err) {
			if (!(err instanceof CreateFailedConflictError)) throw err;
		}

		const fromAddressId = base36uuidv5(
			`address:${msg.fromEmail}`,
			REMIT_NAMESPACE,
		);
		const [fromLocal, fromDomain] = msg.fromEmail.split("@");

		try {
			await addressService.createAddress({
				addressId: fromAddressId,
				accountConfigId: E2E_ACCOUNT_CONFIG_ID,
				displayName: msg.fromName,
				localPart: fromLocal,
				domain: fromDomain,
				normalizedEmail: msg.fromEmail.toLowerCase(),
				normalizedCompound: `${msg.fromName.toLowerCase()} ${msg.fromEmail.toLowerCase()}`,
			});
		} catch (err) {
			if (!(err instanceof CreateFailedConflictError)) throw err;
		}

		try {
			await addressService.createEnvelopeAddress({
				envelopeAddressId,
				messageId,
				addressId: fromAddressId,
				normalizedEmail: msg.fromEmail,
				addressRole: "from",
				addressOrder: 0,
				displayName: msg.fromName,
			});
		} catch (err) {
			if (!(err instanceof CreateFailedConflictError)) throw err;
		}

		try {
			await threadMessageService.create({
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
		} catch (err) {
			if (!(err instanceof CreateFailedConflictError)) throw err;
		}

		// describeMessage now returns body content via per-part `contentUrl`
		// (#224 PR 3) — the SPA fetches each part directly from CloudFront.
		// Upsert a single text/plain BodyPart row pointing at the .eml we
		// just wrote so the smoke fixtures render the same body content.
		await envelopeService.upsertBodyParts(messageId, [
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

/**
 * Seed the two Drafts data sources for the segmented Drafts-view smoke (#505):
 *
 *  - One IMAP \Drafts message (thread row) in the DRAFTS_ID mailbox → renders
 *    in the "On the server" section.
 *  - One Remit outbox row with status "draft" for this account → renders in the
 *    "Not yet sent (Remit)" section.
 *
 * Together they prove both labeled sections render with real data.
 */
const seedDrafts = async (config: ReturnType<typeof createConfig>) => {
	const messageService = new MessageService(config);
	const envelopeService = new EnvelopeService(config);
	const threadMessageService = new ThreadMessageService(config);
	const outboxMessageService = new OutboxMessageService(config);

	// --- IMAP \Drafts message (the "On the server" section) ---
	const imapDraft = {
		messageIdHeader: DRAFTS_IMAP_MESSAGE_ID_HEADER,
		uid: 1,
		subject: "Server draft reply",
		fromEmail: E2E_EMAIL,
		fromName: "Me",
		bodyText: "This draft was saved on the IMAP server.",
		sentDate: NOW - 7_200_000,
	};

	const messageId = MessageService.generateId(
		E2E_ACCOUNT_ID,
		imapDraft.messageIdHeader,
	);
	const envelopeId = EnvelopeService.generateId(messageId);
	const threadId = ThreadMessageService.deriveThreadId(
		E2E_ACCOUNT_ID,
		imapDraft.messageIdHeader,
	);

	const bodyStorageKey = storeMessageBody(
		E2E_ACCOUNT_CONFIG_ID,
		E2E_ACCOUNT_ID,
		messageId,
		imapDraft.bodyText,
	);

	try {
		await messageService.create({
			messageId,
			mailboxId: DRAFTS_ID,
			uid: imapDraft.uid,
			sequenceNumber: imapDraft.uid,
			rfc822Size: imapDraft.bodyText.length + 200,
			internalDate: imapDraft.sentDate,
			messageIdHeader: imapDraft.messageIdHeader,
			envelopeId,
			rootBodyPartId: base36uuid(),
			bodyStorageKey,
		});
	} catch (err) {
		if (!(err instanceof CreateFailedConflictError)) throw err;
	}

	try {
		await envelopeService.createEnvelope({
			envelopeId,
			messageId,
			dateValue: imapDraft.sentDate,
			dateRaw: new Date(imapDraft.sentDate).toUTCString(),
			subject: imapDraft.subject,
			messageIdValue: imapDraft.messageIdHeader,
		});
	} catch (err) {
		if (!(err instanceof CreateFailedConflictError)) throw err;
	}

	try {
		await threadMessageService.create({
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
	} catch (err) {
		if (!(err instanceof CreateFailedConflictError)) throw err;
	}

	await envelopeService.upsertBodyParts(messageId, [
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

	// --- Remit outbox draft (the "Not yet sent (Remit)" section) ---
	// The seeder reruns across test runs, so only create the draft if the
	// account has none yet (the outbox row id is random, can't dedup by id).
	const existingDrafts =
		await outboxMessageService.listByAccount(E2E_ACCOUNT_ID);
	const hasDraft = existingDrafts.items.some((m) => m.status === "draft");
	if (!hasDraft) {
		await outboxMessageService.create({
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
	console.log("E2E Global Setup: seeding test data...");
	const config = createConfig();

	await seedAccount(config);
	await seedMailboxes(config);
	await seedMessages(config);
	await seedDrafts(config);

	console.log(`  AccountConfigId: ${E2E_ACCOUNT_CONFIG_ID}`);
	console.log(`  AccountId: ${E2E_ACCOUNT_ID}`);
	console.log(`  INBOX mailboxId: ${INBOX_ID}`);
	console.log(`  Drafts mailboxId: ${DRAFTS_ID}`);
	console.log(`  Seeded ${TEST_MESSAGES.length} messages + 1 IMAP draft`);
	console.log("E2E Global Setup: done");
};

export default globalSetup;
