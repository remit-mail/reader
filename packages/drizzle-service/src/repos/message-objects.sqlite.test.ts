import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { StorageService } from "@remit/storage-service";
import { createFilesystemStorageService } from "@remit/storage-service/filesystem";
import { BETTER_SQLITE3_LIMITS } from "../bound-parameters.js";
import {
	envelopeId as deriveEnvelopeId,
	rootBodyPartId as deriveRootBodyPartId,
} from "../id.js";
import {
	createSqliteRepositories,
	type SqliteRepositories,
} from "../sqlite-repositories.js";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { mailboxCreated } from "./test-helpers.js";

const ACCOUNT_CONFIG_ID = "cfg-objects";

describe("message objects follow the last row that references them", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let directory: string;
	let storage: StorageService;
	let failDeletesAfter = Number.POSITIVE_INFINITY;
	let repos: SqliteRepositories;

	before(async () => {
		({ db, close } = await createTestDb());
		directory = mkdtempSync(join(tmpdir(), "message-objects-"));
		storage = createFilesystemStorageService(directory);
		repos = createSqliteRepositories(
			{ app: db, mail: db, search: db },
			BETTER_SQLITE3_LIMITS,
			{
				storage: {
					deletePrefix: (prefix) => {
						if (failDeletesAfter <= 0) {
							return Promise.reject(new Error("storage went away"));
						}
						failDeletesAfter -= 1;
						return storage.deletePrefix(prefix);
					},
				},
				messageObjectDeleteConcurrency: 1,
			},
		);
	});

	after(async () => {
		await close();
		rmSync(directory, { recursive: true, force: true });
	});

	const folder = async (accountId: string, fullPath: string) =>
		mailboxCreated(
			await repos.mailbox.create({
				accountId,
				namespaceType: "personal",
				namespacePrefix: "",
				hierarchyDelimiter: "/",
				fullPath,
				uidValidity: 1,
				uidNext: 1,
				highestModseq: "0",
				messageCount: 0,
				unseenCount: 0,
				deletedCount: 0,
				totalSize: 0,
				lastSyncUid: 0,
				highWaterMarkUid: 0,
				lastMessageSyncAt: 0,
			}),
		);

	const message = async (
		accountId: string,
		mailboxId: string,
		uid: number,
		body: { from?: string } = {},
	) => {
		const messageId = randomId();
		const owner = body.from ?? messageId;
		const stored = await storage.storeMessageBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId,
			messageId: owner,
			content: Buffer.from(`body of ${owner}`),
		});
		await storage.storeBodyPart({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId,
			messageId,
			partPath: "1",
			content: Buffer.from("part"),
		});
		await repos.message.create({
			messageId,
			mailboxId,
			uid,
			sequenceNumber: uid,
			rfc822Size: 10,
			internalDate: 1700000000000,
			bodyStorageKey: stored.uri,
		});
		return { messageId, accountId, bodyStorageKey: stored.uri };
	};

	const part = (row: { accountId: string; messageId: string }) =>
		storage.retrieveBodyPart(
			ACCOUNT_CONFIG_ID,
			row.accountId,
			row.messageId,
			"1",
		);

	test("a copy sharing the source's body keeps it until the copy goes too", async () => {
		const accountId = randomId();
		const inbox = await folder(accountId, "INBOX");
		const source = await message(accountId, inbox.mailboxId, 1);
		const copy = await message(accountId, inbox.mailboxId, 2, {
			from: source.messageId,
		});
		assert.equal(copy.bodyStorageKey, source.bodyStorageKey);

		await repos.message.delete(source.messageId);

		assert.ok(await storage.retrieve(copy.bodyStorageKey));
		assert.ok(await part(copy));

		await repos.message.delete(copy.messageId);

		assert.equal(await storage.exists(copy.bodyStorageKey), false);
		assert.equal(await part(copy), null);
		assert.equal(await part(source), null);
	});

	test("a placement that no longer matches keeps the row and its objects", async () => {
		const accountId = randomId();
		const inbox = await folder(accountId, "INBOX");
		const kept = await message(accountId, inbox.mailboxId, 1);

		assert.equal(
			await repos.message.deleteIfPlacement(kept.messageId, { uid: 2 }),
			false,
		);
		assert.ok(await storage.retrieve(kept.bodyStorageKey));

		assert.equal(
			await repos.message.deleteIfPlacement(kept.messageId, { uid: 1 }),
			true,
		);
		assert.equal(await storage.exists(kept.bodyStorageKey), false);
	});

	test("a body stored under the key shape without an account config removes its message prefix", async () => {
		const accountId = randomId();
		const inbox = await folder(accountId, "INBOX");
		const messageId = randomId();
		const legacy = join(
			directory,
			"accounts",
			accountId,
			"messages",
			messageId,
		);
		mkdirSync(join(legacy, "parts"), { recursive: true });
		writeFileSync(join(legacy, "body.eml"), "legacy");
		writeFileSync(join(legacy, "parts", "1"), "part");
		await repos.message.create({
			messageId,
			mailboxId: inbox.mailboxId,
			uid: 1,
			sequenceNumber: 1,
			rfc822Size: 10,
			internalDate: 1700000000000,
			bodyStorageKey: `file://${join(legacy, "body.eml")}`,
		});

		await repos.message.delete(messageId);

		assert.equal(existsSync(legacy), false);
	});

	test("a folder delete that fails part way has already removed the batches it finished", async () => {
		const accountId = randomId();
		const doomed = await folder(accountId, "Doomed");
		const rows = [];
		for (let uid = 1; uid <= 101; uid += 1) {
			rows.push(await message(accountId, doomed.mailboxId, uid));
		}
		failDeletesAfter = 100;

		await assert.rejects(
			repos.mailbox.deleteMailboxWithMail(accountId, doomed.mailboxId),
			/storage went away/,
		);
		failDeletesAfter = Number.POSITIVE_INFINITY;

		const gone = await Promise.all(
			rows.map((row) => storage.exists(row.bodyStorageKey)),
		);
		assert.equal(gone.filter((exists) => !exists).length, 100);
	});
});
