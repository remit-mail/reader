import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { after, before, describe, it } from "node:test";
import { MailboxCursorState } from "@remit/domain-enums";
import {
	accountTable,
	BETTER_SQLITE3_LIMITS,
	composeSqliteRepositories,
	mailboxTable,
	messageTable,
	openSqliteDatabases,
	syncStores,
} from "@remit/drizzle-service";
import { createShippedSqliteFiles } from "@remit/drizzle-service/test-sqlite";
import { noopLogger } from "@remit/logger";
import {
	buildExportArchiveKey,
	type StorageService,
} from "@remit/storage-service";
import { createFilesystemStorageService } from "@remit/storage-service/filesystem";
import { cascadeServicesOf } from "../cascade.js";
import { processAccountExport } from "./account-export.js";

const NOW = 1700000000000;
const MESSAGE_COUNT = 3;

const exists = (path: string): Promise<boolean> =>
	stat(path).then(
		() => true,
		() => false,
	);

interface Tracked {
	readonly storage: StorageService;
	readonly maxOpen: () => number;
}

const trackingOpenBodies = (
	storage: StorageService,
	onFirstRead: () => Promise<void>,
): Tracked => {
	let open = 0;
	let max = 0;
	let reads = 0;
	return {
		maxOpen: () => max,
		storage: {
			...storage,
			retrieveMessageBodyStream: async (
				accountConfigId,
				accountId,
				messageId,
			) => {
				reads += 1;
				if (reads === 1) await onFirstRead();
				const body = await storage.retrieveMessageBodyStream(
					accountConfigId,
					accountId,
					messageId,
				);
				if (body === null) return null;
				open += 1;
				max = Math.max(max, open);
				body.once("close", () => {
					open -= 1;
				});
				return body;
			},
		},
	};
};

describe("processAccountExport over SQLite repositories and filesystem storage", () => {
	let directory: string;
	let close: () => Promise<void>;
	let repositories: ReturnType<typeof composeSqliteRepositories>;
	let databases: Awaited<ReturnType<typeof openSqliteDatabases>>;
	let storage: StorageService;

	const seedTenant = async (): Promise<{
		accountConfigId: string;
		accountExportRequestId: string;
	}> => {
		const accountConfig = await repositories.accountConfig.create({
			userId: "user000000000000000000001",
		});
		const { accountConfigId } = accountConfig;
		const accountId = `${accountConfigId}-acc`;
		const mailboxId = `${accountConfigId}-mbx`;
		await databases.app.insert(accountTable).values({
			accountId,
			accountConfigId,
			username: "u",
			email: "u@example.com",
			authType: "password",
			syncedServices: ["Mail"],
			imapHost: "imap.example.com",
			imapPort: 993,
			imapTls: true,
			imapStartTls: false,
			smtpPort: 587,
			isActive: true,
			connectionState: "authenticated",
			createdAt: NOW,
			updatedAt: NOW,
		});
		await databases.mail.insert(mailboxTable).values({
			mailboxId,
			accountId,
			namespaceType: "personal",
			namespacePrefix: "",
			hierarchyDelimiter: "/",
			fullPath: "INBOX",
			uidValidity: 1,
			uidNext: 1,
			highestModseq: "0",
			messageCount: 0,
			unseenCount: 0,
			deletedCount: 0,
			totalSize: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			lastMessageSyncAt: NOW,
			cursorState: MailboxCursorState.normal,
			createdAt: NOW,
			updatedAt: NOW,
		});
		for (let uid = 1; uid <= MESSAGE_COUNT; uid += 1) {
			const messageId = `${accountConfigId}-msg-${uid}`;
			await databases.mail.insert(messageTable).values({
				messageId,
				mailboxId,
				uid,
				sequenceNumber: uid,
				rfc822Size: 10,
				internalDate: NOW,
				envelopeId: `${messageId}-env`,
				rootBodyPartId: `${messageId}-root`,
				status: "active",
				syncStatus: "synced",
				category: "uncategorized",
				createdAt: NOW,
				updatedAt: NOW,
			});
			await storage.storeMessageBody({
				accountConfigId,
				accountId,
				messageId,
				content: Buffer.from(`Subject: message ${uid}\r\n\r\nbody`),
			});
		}
		const request = await repositories.accountExportRequest.create({
			accountConfigId,
			userId: accountConfig.userId,
			state: "Pending",
		});
		return {
			accountConfigId,
			accountExportRequestId: request.accountExportRequestId,
		};
	};

	before(async () => {
		directory = await mkdtemp(join(tmpdir(), "remit-account-export-"));
		databases = await openSqliteDatabases(createShippedSqliteFiles(directory));
		close = databases.close;
		repositories = composeSqliteRepositories(
			syncStores(databases, BETTER_SQLITE3_LIMITS),
		);
		storage = createFilesystemStorageService(join(directory, "storage"));
	});

	after(async () => {
		await close();
	});

	it("archives every body while holding one open at a time", async () => {
		const event = { type: "AccountExport" as const, ...(await seedTenant()) };
		const tracked = trackingOpenBodies(storage, async () => {});

		await processAccountExport(event, noopLogger, {
			services: cascadeServicesOf(repositories),
			storageService: tracked.storage,
		});

		const request = await repositories.accountExportRequest.get(
			event.accountExportRequestId,
		);
		assert.equal(request.state, "Ready");
		assert.equal(tracked.maxOpen(), 1);
		assert.equal(
			await exists(
				join(
					directory,
					"storage",
					buildExportArchiveKey(
						event.accountConfigId,
						event.accountExportRequestId,
					),
				),
			),
			true,
		);
	});

	it("leaves no archive when the account config is deleted while it runs", async () => {
		const event = { type: "AccountExport" as const, ...(await seedTenant()) };
		const tracked = trackingOpenBodies(storage, async () => {
			await repositories.accountConfig.update(event.accountConfigId, {
				state: "deleting",
				deletedAt: Date.now(),
			});
		});

		await processAccountExport(event, noopLogger, {
			services: cascadeServicesOf(repositories),
			storageService: tracked.storage,
		});

		const request = await repositories.accountExportRequest.get(
			event.accountExportRequestId,
		);
		assert.notEqual(request.state, "Ready");
		assert.equal(
			await exists(
				join(
					directory,
					"storage",
					buildExportArchiveKey(
						event.accountConfigId,
						event.accountExportRequestId,
					),
				),
			),
			false,
		);
	});

	it("skips a message with no stored body and still completes", async () => {
		const event = { type: "AccountExport" as const, ...(await seedTenant()) };
		const consulted: string[] = [];
		const skipped = `${event.accountConfigId}-msg-2`;

		await processAccountExport(event, noopLogger, {
			services: cascadeServicesOf(repositories),
			storageService: {
				...storage,
				retrieveMessageBodyStream: async (
					accountConfigId,
					accountId,
					messageId,
				) => {
					consulted.push(messageId);
					return messageId === skipped
						? null
						: storage.retrieveMessageBodyStream(
								accountConfigId,
								accountId,
								messageId,
							);
				},
			},
		});

		assert.equal(consulted.length, MESSAGE_COUNT);
		const request = await repositories.accountExportRequest.get(
			event.accountExportRequestId,
		);
		assert.equal(request.state, "Ready");
	});

	it("marks the request Failed and rethrows when the upload fails", async () => {
		const event = { type: "AccountExport" as const, ...(await seedTenant()) };

		await assert.rejects(
			processAccountExport(event, noopLogger, {
				services: cascadeServicesOf(repositories),
				storageService: {
					...storage,
					storeExportArchiveStream: async (
						_accountConfigId,
						_exportRequestId,
						body,
					) => {
						body.resume();
						await finished(body);
						throw new Error("storage refused the archive");
					},
				},
			}),
			/storage refused the archive/,
		);

		const request = await repositories.accountExportRequest.get(
			event.accountExportRequestId,
		);
		assert.equal(request.state, "Failed");
		assert.equal(request.errorMessage, "storage refused the archive");
	});
});
