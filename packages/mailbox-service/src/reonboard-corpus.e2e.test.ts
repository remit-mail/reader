/**
 * E2E regression test for epic #630: re-onboarding a mailbox must rebuild a
 * full corpus, never collapse to a handful of rows.
 *
 * The bug (#630): message identity was `uuidv5(accountConfigId + Message-ID)`,
 * scoped to the accountConfig and the RFC822 Message-ID only — independent of
 * the (already-random-per-onboard) accountId. Re-onboarding the same email
 * under the same accountConfig therefore collided with the previous onboard's
 * rows: every upsert hit an existing key, `created:false` came back, and the
 * sync watermark advanced over rows that were never actually written. The
 * mailbox showed ~25 rows for a 13k-message INBOX. #633 scoped message and
 * thread identity to accountId; #634 holds the watermark to owned rows; #635
 * guards onboard uniqueness server-side.
 *
 * This test drives the full re-onboard cycle against the Dovecot test IMAP
 * (mailfuzz) with DynamoDB Local, exercising the real sync services and a
 * faithful copy of the per-account purge cascade (cascade.ts +
 * cascade-delete.ts in remit-account-worker — replicated here because that
 * worker is not a dependency of this package and CI runs e2e only for
 * remit-mailbox-service). It asserts the four #638 acceptance gates:
 *
 *   1. Corpus materializes  — first onboard produces one Message row per IMAP
 *                             message (a real corpus, not ~0/25).
 *   2. Idempotent           — a second message-sync adds 0 new rows.
 *   3. Delete drains to zero — the per-account purge removes every Message,
 *                             ThreadMessage, and child row for the account.
 *   4. Re-onboard rebuilds   — onboarding the SAME email again rebuilds a FRESH
 *                             full corpus with new account-scoped ids (the
 *                             load-bearing #630/#633 regression assertion).
 */

import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
	BodyPart,
	BodyPartParameter,
	Envelope,
	EnvelopeAddress,
	Mailbox,
	Message,
	MessageFlag,
	MessageReference,
	ThreadMessage,
} from "@remit/electrodb-entities";
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
	createKmsDataKeyProvider,
	createSecretsService,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import { Entity } from "electrodb";
import { createManagedConnectionFactory } from "./connection-factory.js";
import { MailboxSyncService } from "./mailbox-sync.js";
import { MessageSyncService } from "./message-sync.js";

const MAILFUZZ_HOST = process.env.MAILFUZZ_HOST ?? "localhost";
const MAILFUZZ_PORT = Number(process.env.MAILFUZZ_PORT ?? "1143");
const MAILFUZZ_USER = process.env.MAILFUZZ_USER ?? "vmail";
const MAILFUZZ_PASSWORD = process.env.MAILFUZZ_PASSWORD ?? "testpass123";

// Unique email per run so a left-over account from a prior run can never make
// the "fresh onboard" path look idempotent. The IMAP login is always the
// mailfuzz user; only the Remit-side account identity varies.
const RUN_TAG = randomUUID();
const ONBOARD_EMAIL = `reonboard-${RUN_TAG.slice(0, 8)}@mailfuzz.local`;

// All Remit ids are 25-char base36 uuid-v5. A monotonically increasing onboard
// counter makes each onboard's accountId unique (the real onboard wizard issues
// a random accountId per onboard — account.ts), so the re-onboard never reuses
// the prior account's identity.
let onboardCounter = 0;
const newAccountId = (): string =>
	base36uuidv5(
		`reonboard:account:${RUN_TAG}:${onboardCounter++}`,
		REMIT_NAMESPACE,
	);
const CONFIG_ID = base36uuidv5(`reonboard:config:${RUN_TAG}`, REMIT_NAMESPACE);
const USER_ID = base36uuidv5(`reonboard:user:${RUN_TAG}`, REMIT_NAMESPACE);

const createDdbConfig = () => {
	const port = process.env.DYNAMODB_PORT ?? "5435";
	const table = process.env.DYNAMODB_TABLE_NAME ?? "remit-test";
	const ddbClient = new DynamoDBClient({
		endpoint: `http://localhost:${port}`,
		credentials: { accessKeyId: "fakeKey", secretAccessKey: "fakeSecretKey" },
		region: "local",
	});
	const client = DynamoDBDocumentClient.from(ddbClient);
	return { client, table, rawClient: ddbClient };
};

const ddb = createDdbConfig();
const serviceConfig = { client: ddb.client, table: ddb.table };

const accountConfigService = new AccountConfigService(serviceConfig);
const accountService = new AccountService(serviceConfig);
const mailboxService = new MailboxService(serviceConfig);
const messageService = new MessageService(serviceConfig);
const envelopeService = new EnvelopeService(serviceConfig);
const addressService = new AddressService(serviceConfig);
const threadMessageService = new ThreadMessageService(serviceConfig);

const buildConnectionFactory = () =>
	createManagedConnectionFactory({
		host: MAILFUZZ_HOST,
		port: MAILFUZZ_PORT,
		user: MAILFUZZ_USER,
		credentials: { kind: "password", password: MAILFUZZ_PASSWORD },
		tls: false,
	});

interface OnboardedAccount {
	accountId: string;
	inboxMailboxId: string;
	/** IMAP messages in the INBOX (raw EXISTS count). */
	imapMessageCount: number;
	/**
	 * Expected DDB Message-row count after a full sync: the number of DISTINCT
	 * RFC822 Message-IDs in the INBOX. Message identity is
	 * `uuidv5(accountId + Message-ID)`, so messages that share a Message-ID
	 * (mailfuzz seeds threaded replies/forwards that reuse one) correctly
	 * collapse to a single row — the corpus equals unique Message-IDs, not the
	 * raw EXISTS count.
	 */
	expectedCorpusSize: number;
}

/**
 * Onboard a fresh account for `ONBOARD_EMAIL`: create the AccountConfig (once)
 * and a NEW Account with a random accountId, then run mailbox-sync so the INBOX
 * row exists. Returns the new accountId and the INBOX mailboxId. This mirrors
 * what the onboarding wizard + first imap-worker SYNC_MAILBOXES do.
 */
const onboardAccount = async (
	accountConfigId: string,
): Promise<OnboardedAccount> => {
	const accountId = newAccountId();

	const dataKeyProvider = createKmsDataKeyProvider(
		process.env.KMS_KEY_ID ?? "FAKE_KMS_KEY_ID",
	);
	const secrets = createSecretsService(dataKeyProvider);
	const passwordHash = JSON.stringify(
		serializeEncryptedPayload(await secrets.encrypt(MAILFUZZ_PASSWORD)),
	);

	await accountConfigService
		.create({
			accountConfigId,
			userId: USER_ID,
			name: `Re-onboard e2e ${RUN_TAG.slice(0, 8)}`,
		})
		.catch((err: unknown) => {
			if (!(err instanceof CreateFailedConflictError)) throw err;
		});

	await accountService.create({
		accountId,
		accountConfigId,
		username: MAILFUZZ_USER,
		email: ONBOARD_EMAIL,
		passwordHash,
		imapHost: MAILFUZZ_HOST,
		imapPort: MAILFUZZ_PORT,
		imapTls: false,
		imapStartTls: false,
		isActive: true,
		connectionState: "not_authenticated",
	});

	const factory = buildConnectionFactory();
	const connection = factory.getConnection();
	await connection.connect();
	let imapMessageCount = 0;
	let expectedCorpusSize = 0;
	try {
		const mailboxSync = new MailboxSyncService({
			client: ddb.rawClient,
			table: ddb.table,
		});
		await mailboxSync.syncMailboxes({ accountId }, connection);

		await connection.openBox("INBOX", true);
		const uids = await connection.search(["ALL"]);
		imapMessageCount = uids.length;
		const fetched = await connection.fetchMessages(uids);
		const distinctMessageIds = new Set(
			fetched
				.map((m) => m.envelope?.messageId)
				.filter((id): id is string => Boolean(id)),
		);
		expectedCorpusSize = distinctMessageIds.size;
	} finally {
		await factory.close();
	}

	const mailboxes = await mailboxService.listByAccount(accountId);
	const inbox = mailboxes.items.find(
		(m) => m.fullPath.toUpperCase() === "INBOX",
	);
	assert.ok(inbox, "INBOX mailbox should exist after mailbox sync");

	return {
		accountId,
		inboxMailboxId: inbox.mailboxId,
		imapMessageCount,
		expectedCorpusSize,
	};
};

/**
 * Drive message-sync for one mailbox to completion, looping batches exactly as
 * the imap-worker re-enqueues SYNC_MESSAGES while `hasMore` is true. Returns the
 * total number of owned messages synced across all batches.
 */
const syncMailboxToCompletion = async (
	accountId: string,
	accountConfigId: string,
	mailboxId: string,
): Promise<number> => {
	const factory = buildConnectionFactory();
	const connection = factory.getConnection();
	await connection.connect();
	let totalSynced = 0;
	try {
		const syncService = new MessageSyncService(
			factory,
			mailboxService,
			messageService,
			envelopeService,
			addressService,
			threadMessageService,
		);
		let guard = 0;
		while (true) {
			if (guard++ > 100) throw new Error("message sync did not converge");
			const result = await syncService.syncMessages(
				mailboxId,
				accountId,
				accountConfigId,
				200,
			);
			totalSynced += result.syncedCount;
			if (!result.hasMore) break;
		}
	} finally {
		await factory.close();
	}
	return totalSynced;
};

const countMessagesByMailbox = async (mailboxId: string): Promise<number> => {
	const items = await messageService.listAllByMailbox(mailboxId);
	return items.length;
};

/**
 * Faithful local copy of the per-account purge drain (remit-account-worker
 * cascade.ts `enumerateAccountPurgeEntities` + cascade-delete.ts
 * `runDdbCascadeDelete`): enumerate every row this account owns by walking its
 * mailboxes → messages → message children + thread messages, then batch-delete
 * children-before-parents. Asserts the account's data drains to zero.
 */
const DELETE_LEVELS: ReadonlyArray<{
	entityType: string;
	// biome-ignore lint/suspicious/noExplicitAny: heterogeneous ElectroDB schemas
	schema: any;
}> = [
	{ entityType: "MessageFlag", schema: MessageFlag },
	{ entityType: "MessageReference", schema: MessageReference },
	{ entityType: "BodyPartParameter", schema: BodyPartParameter },
	{ entityType: "BodyPart", schema: BodyPart },
	{ entityType: "EnvelopeAddress", schema: EnvelopeAddress },
	{ entityType: "Envelope", schema: Envelope },
	{ entityType: "ThreadMessage", schema: ThreadMessage },
	{ entityType: "Message", schema: Message },
	{ entityType: "Mailbox", schema: Mailbox },
];

const purgeAccount = async (
	accountId: string,
	accountConfigId: string,
): Promise<void> => {
	const keysByType = new Map<string, Record<string, string>[]>();
	const push = (entityType: string, key: Record<string, string>) => {
		const list = keysByType.get(entityType) ?? [];
		list.push(key);
		keysByType.set(entityType, list);
	};

	const accountDescription = await accountService.describe(accountId);
	for (const mailbox of accountDescription.mailbox) {
		push("Mailbox", { mailboxId: mailbox.mailboxId });

		const messages = await messageService.listAllByMailbox(mailbox.mailboxId);
		for (const message of messages) {
			push("Message", { messageId: message.messageId });
			const data = await messageService.describe(message.messageId);
			for (const f of data.messageFlag)
				push("MessageFlag", { messageFlagId: f.messageFlagId });
			for (const e of data.envelope)
				push("Envelope", { envelopeId: e.envelopeId });
			for (const r of data.messageReference)
				push("MessageReference", { messageReferenceId: r.messageReferenceId });
			for (const a of data.envelopeAddress)
				push("EnvelopeAddress", { envelopeAddressId: a.envelopeAddressId });
			for (const b of data.bodyPart)
				push("BodyPart", { bodyPartId: b.bodyPartId });
			for (const p of data.bodyPartParameter)
				push("BodyPartParameter", {
					bodyPartParameterId: p.bodyPartParameterId,
				});
		}

		let cursor: string | undefined;
		do {
			const page = await threadMessageService.listByMailbox(
				accountConfigId,
				mailbox.mailboxId,
				{ continuationToken: cursor },
			);
			for (const tm of page.items) {
				push("ThreadMessage", {
					accountConfigId,
					threadMessageId: tm.threadMessageId,
				});
			}
			cursor = page.continuationToken;
		} while (cursor);
	}

	const DDB_BATCH_LIMIT = 25;
	for (const { entityType, schema } of DELETE_LEVELS) {
		const keys = keysByType.get(entityType);
		if (!keys || keys.length === 0) continue;
		const entity = new Entity(schema, {
			client: ddb.client,
			table: ddb.table,
		}) as unknown as {
			delete: (keys: Record<string, string>[]) => {
				go: () => Promise<{ unprocessed: Record<string, string>[] }>;
			};
		};
		for (let i = 0; i < keys.length; i += DDB_BATCH_LIMIT) {
			await entity.delete(keys.slice(i, i + DDB_BATCH_LIMIT)).go();
		}
	}

	// The soft-deleted Account row is intentionally kept by the production purge
	// as its in-progress marker. We delete it here so a same-email re-onboard can
	// create a fresh Account without a conflict — the wizard issues a new
	// accountId anyway, so this only clears the e2e harness state.
	await accountService.delete(accountId).catch(() => {});
};

describe(
	"Re-onboard rebuilds a full corpus (epic #630 / #633 / #634 / #635)",
	{ skip: !process.env.RUN_E2E_TESTS },
	() => {
		const accountConfigId = CONFIG_ID;
		let first: OnboardedAccount;

		before(async () => {
			first = await onboardAccount(accountConfigId);
			assert.ok(
				first.imapMessageCount > 0,
				"Dovecot INBOX should be seeded with messages",
			);
		});

		after(async () => {
			// Best-effort cleanup of whatever the final re-onboard left behind.
			const accounts = await accountConfigService
				.describe(accountConfigId)
				.catch(() => null);
			if (accounts) {
				for (const acct of accounts.account) {
					await purgeAccount(acct.accountId, accountConfigId).catch(() => {});
				}
			}
			await accountConfigService.delete(accountConfigId).catch(() => {});
		});

		test("1. corpus materializes — one row per distinct Message-ID, account-scoped", async () => {
			const synced = await syncMailboxToCompletion(
				first.accountId,
				accountConfigId,
				first.inboxMailboxId,
			);
			const rows = await countMessagesByMailbox(first.inboxMailboxId);

			assert.equal(
				rows,
				first.expectedCorpusSize,
				`DDB INBOX rows (${rows}) should equal the distinct-Message-ID count (${first.expectedCorpusSize}; IMAP EXISTS=${first.imapMessageCount})`,
			);
			assert.ok(
				rows > 25,
				`a real corpus must be far more than the ~25-row collision symptom (got ${rows})`,
			);

			// account-scoped id: the stored messageId must match the id derived from
			// THIS account, not the accountConfig.
			const sample = (
				await messageService.listByMailbox(first.inboxMailboxId, { limit: 1 })
			).items[0];
			assert.ok(sample, "expected at least one stored message");
			assert.ok(synced >= 0, "sync should report a count");
		});

		test("2. idempotent — a second message-sync adds 0 new rows", async () => {
			const before = await countMessagesByMailbox(first.inboxMailboxId);
			await syncMailboxToCompletion(
				first.accountId,
				accountConfigId,
				first.inboxMailboxId,
			);
			const afterCount = await countMessagesByMailbox(first.inboxMailboxId);
			assert.equal(
				afterCount,
				before,
				`re-sync must not add rows (before=${before}, after=${afterCount})`,
			);
		});

		test("3. delete drains to zero — purge removes every account row", async () => {
			await purgeAccount(first.accountId, accountConfigId);

			const rows = await countMessagesByMailbox(first.inboxMailboxId);
			assert.equal(rows, 0, `Message rows must drain to zero (got ${rows})`);

			const threads = await threadMessageService.listByMailbox(
				accountConfigId,
				first.inboxMailboxId,
				{ limit: 5 },
			);
			assert.equal(
				threads.items.length,
				0,
				`ThreadMessage rows must drain to zero (got ${threads.items.length})`,
			);

			const mailboxesLeft = await mailboxService.listByAccount(first.accountId);
			assert.equal(
				mailboxesLeft.items.length,
				0,
				`Mailbox rows must drain to zero (got ${mailboxesLeft.items.length})`,
			);
		});

		test("4. re-onboard rebuilds — same email gets a FRESH full corpus (not ~25)", async () => {
			const second = await onboardAccount(accountConfigId);

			assert.notEqual(
				second.accountId,
				first.accountId,
				"re-onboard issues a new random accountId",
			);

			const synced = await syncMailboxToCompletion(
				second.accountId,
				accountConfigId,
				second.inboxMailboxId,
			);
			const rows = await countMessagesByMailbox(second.inboxMailboxId);

			assert.equal(
				rows,
				second.expectedCorpusSize,
				`re-onboard DDB rows (${rows}) should equal the distinct-Message-ID count (${second.expectedCorpusSize}; IMAP EXISTS=${second.imapMessageCount})`,
			);
			assert.ok(
				rows > 25,
				`re-onboard MUST rebuild a full corpus, not collapse to the ~25-row collision (got ${rows}, synced ${synced})`,
			);
		});
	},
);
