import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { MailboxSyncStatus } from "@remit/domain-enums";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mailboxTable } from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import {
	applyMigration,
	shippedTableDdl,
} from "../test-shipped-sqlite-schema.js";
import { MailboxRepo } from "./i4-mailbox.js";

function makeMailboxInput(accountId: string, fullPath = "INBOX") {
	return {
		accountId,
		namespaceType: "personal" as const,
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
		lastMessageSyncAt: Date.now(),
	};
}

describe("MailboxRepo (sqlite)", () => {
	let close: () => Promise<void>;
	let repo: MailboxRepo;

	before(async () => {
		const testDb = await createSqliteTestDb({ mailbox: mailboxTable });
		close = testDb.close;
		repo = new MailboxRepo(testDb.db as never);
	});

	after(async () => {
		await close();
	});

	test("highestModseq round-trips a value above 2^53 without loss (reader#9)", async () => {
		const accountId = randomUUID();
		const modseq = "18446744073709551615";

		const created = await repo.create({
			...makeMailboxInput(accountId),
			highestModseq: modseq,
		});
		assert.equal(created.highestModseq, modseq);

		const fetched = await repo.get(accountId, created.mailboxId);
		assert.equal(fetched.highestModseq, modseq);
		assert.equal(BigInt(fetched.highestModseq) > 2n ** 53n, true);

		const updated = await repo.update(accountId, created.mailboxId, {
			highestModseq: "9007199254740993",
		});
		assert.equal(updated.highestModseq, "9007199254740993");
		const reread = await repo.get(accountId, created.mailboxId);
		assert.equal(reread.highestModseq, "9007199254740993");
	});

	test("renameChildPaths marks each child pending along with its new path (#290)", async () => {
		// A renamed parent is set pending by the caller; its children's new paths
		// are equally absent from the server until MAILBOX_RENAME lands, so they
		// must be pending too — otherwise a reconcile in that window reaps the
		// child as server-deleted.
		const accountId = randomUUID();
		const parent = await repo.create({
			...makeMailboxInput(accountId, "Work"),
			syncStatus: MailboxSyncStatus.pending,
		});
		const child = await repo.create({
			...makeMailboxInput(accountId, "Work/sub"),
			syncStatus: MailboxSyncStatus.synced,
		});

		await repo.renameChildPaths(accountId, "Work", "Projects", "/");

		const renamedChild = await repo.get(accountId, child.mailboxId);
		assert.equal(renamedChild.fullPath, "Projects/sub");
		assert.equal(renamedChild.syncStatus, MailboxSyncStatus.pending);

		// The parent row is untouched by this call (its own path/status is the
		// caller's job).
		const parentRow = await repo.get(accountId, parent.mailboxId);
		assert.equal(parentRow.fullPath, "Work");
	});
});

/**
 * The same repository against the shape a deployment actually runs: the
 * committed migrations applied in order, rather than the schema pushed from the
 * drizzle table objects.
 *
 * The two used to disagree — `highest_modseq` shipped as `integer` while the
 * table object said `text` (reader#73) — and SQLite hands a column with numeric
 * affinity back as a number whatever the declared type, so the repo returned a
 * number where its own type said string. Reading the committed files keeps this
 * honest as the migration set changes.
 */
describe("MailboxRepo (sqlite, shipped migrations)", () => {
	let close: () => Promise<void>;
	let repo: MailboxRepo;

	before(() => {
		const sqlite = new Database(":memory:");
		sqlite.exec(shippedTableDdl("0000_happy_roland_deschain", "mailbox"));
		applyMigration(sqlite, "0002_highest_modseq_text");
		const db = drizzle(sqlite, { schema: { mailbox: mailboxTable } });
		repo = new MailboxRepo(db as never);
		close = async () => {
			sqlite.close();
		};
	});

	after(async () => {
		await close();
	});

	test("declares highest_modseq as text", () => {
		assert.match(
			shippedTableDdl("0002_highest_modseq_text", "__new_mailbox"),
			/`highest_modseq` text NOT NULL/,
		);
	});

	test("reads a plain-digit cursor back as a string", async () => {
		const accountId = randomUUID();
		const created = await repo.create({
			...makeMailboxInput(accountId),
			highestModseq: "900",
		});

		assert.strictEqual(created.highestModseq, "900");

		const fetched = await repo.get(accountId, created.mailboxId);
		assert.strictEqual(fetched.highestModseq, "900");
	});

	test("keeps a resumable cursor intact", async () => {
		const accountId = randomUUID();
		const created = await repo.create({
			...makeMailboxInput(accountId, "Archive"),
			highestModseq: "900:149",
		});

		const fetched = await repo.get(accountId, created.mailboxId);
		assert.strictEqual(fetched.highestModseq, "900:149");
	});

	test("round-trips a cursor above 2^53 with its exact digits", async () => {
		const accountId = randomUUID();
		const modseq = "18446744073709551615";
		const created = await repo.create({
			...makeMailboxInput(accountId, "Sent"),
			highestModseq: modseq,
		});

		assert.strictEqual(created.highestModseq, modseq);
		const fetched = await repo.get(accountId, created.mailboxId);
		assert.strictEqual(fetched.highestModseq, modseq);
	});
});
