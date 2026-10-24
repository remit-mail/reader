import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	renameSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as entities from "@remit/drizzle-sqlite-schema";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { applyMigrationSet } from "../../drizzle-service/src/test-shipped-sqlite-schema.js";
import { legacyDatabasePath, splitLegacyDatabase } from "./legacy-split.js";
import { splitSqlite } from "./split-sqlite.js";

const NOW = 1_700_000_000_000;

// A database in the single-file layout the split replaces: every app and mail
// table in one file, holding app rows, local mail rows and a message the IMAP
// server can give back.
const seedSource = (path: string): void => {
	const sqlite = new Database(path);
	applyMigrationSet(sqlite, "app");
	applyMigrationSet(sqlite, "mail");
	const db = drizzle(sqlite);
	const stamps = { createdAt: NOW, updatedAt: NOW };
	db.insert(entities.accountConfigs)
		.values({ accountConfigId: "cfg-1", userId: "user-1", ...stamps })
		.run();
	db.insert(entities.labels)
		.values({
			labelId: "lbl-1",
			accountConfigId: "cfg-1",
			name: "Receipts",
			normalizedName: "receipts",
			...stamps,
		})
		.run();
	db.insert(entities.mailboxes)
		.values({
			mailboxId: "mbx-1",
			accountId: "acc-1",
			namespacePrefix: "",
			hierarchyDelimiter: "/",
			fullPath: "INBOX",
			uidValidity: 7,
			uidNext: 42,
			highestModseq: "9000",
			messageCount: 41,
			unseenCount: 3,
			deletedCount: 0,
			totalSize: 123_456,
			lastSyncUid: 41,
			highWaterMarkUid: 41,
			lastMessageSyncAt: NOW,
			initialSyncCompletedAt: NOW,
			...stamps,
		})
		.run();
	db.insert(entities.messageRecords)
		.values({
			messageId: "msg-1",
			mailboxId: "mbx-1",
			uid: 41,
			sequenceNumber: 41,
			rfc822Size: 100,
			internalDate: NOW,
			envelopeId: "env-1",
			rootBodyPartId: "bp-1",
			...stamps,
		})
		.run();
	db.insert(entities.messageLabels)
		.values({
			messageLabelId: "ml-1",
			messageId: "msg-1",
			labelId: "lbl-1",
			accountConfigId: "cfg-1",
			...stamps,
		})
		.run();
	db.insert(entities.addresses)
		.values({
			addressId: "adr-1",
			accountConfigId: "cfg-1",
			localPart: "spam",
			domain: "example.test",
			normalizedEmail: "spam@example.test",
			normalizedCompound: "spam@example.test",
			flags: { muted: { value: true, setAt: NOW } },
			inboundCount: 12,
			...stamps,
		})
		.run();
	db.insert(entities.outboxMessages)
		.values({
			outboxMessageId: "out-1",
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			fromAddress: "me@example.test",
			toAddresses: ["you@example.test"],
			messageIdValue: "<out-1@example.test>",
			status: "queued",
			...stamps,
		})
		.run();
	sqlite.close();
};

const count = (path: string, table: string): number => {
	const sqlite = new Database(path, { readonly: true });
	try {
		return (
			sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
				n: number;
			}
		).n;
	} finally {
		sqlite.close();
	}
};

const hasTable = (path: string, table: string): boolean => {
	const sqlite = new Database(path, { readonly: true });
	try {
		return (
			sqlite
				.prepare("SELECT 1 FROM sqlite_master WHERE name = ?")
				.get(table) !== undefined
		);
	} finally {
		sqlite.close();
	}
};

describe("splitting the single database file", () => {
	const dir = mkdtempSync(join(tmpdir(), "remit-split-"));
	const source = join(dir, "remit.db");
	const targets = { app: join(dir, "app.db"), mail: join(dir, "mail.db") };

	const split = async (): Promise<void> => {
		const from = new Database(source, { readonly: true });
		const app = new Database(targets.app);
		const mail = new Database(targets.mail);
		try {
			await splitSqlite(drizzle(from), {
				app: drizzle(app),
				mail: drizzle(mail),
			});
		} finally {
			from.close();
			app.close();
			mail.close();
		}
	};

	before(async () => {
		seedSource(source);
		for (const set of ["app", "mail"] as const) {
			const sqlite = new Database(targets[set]);
			applyMigrationSet(sqlite, set);
			sqlite.close();
		}
		await split();
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("keeps the app rows in the app database", () => {
		assert.equal(count(targets.app, "account_config"), 1);
		assert.equal(count(targets.app, "label"), 1);
		assert.equal(hasTable(targets.app, "message"), false);
	});

	test("keeps the local-only mail rows in the mail database", () => {
		assert.equal(count(targets.mail, "message_label"), 1);
		assert.equal(count(targets.mail, "outbox_message"), 1);
		assert.equal(hasTable(targets.mail, "account_config"), false);
	});

	test("leaves the mail the server can give back to resync", () => {
		assert.equal(count(targets.mail, "message"), 0);
		assert.equal(count(source, "message"), 1);
	});

	test("keeps each mailbox's id and starts its message sync over", () => {
		const sqlite = new Database(targets.mail, { readonly: true });
		const mailbox = sqlite
			.prepare(
				"SELECT mailbox_id, full_path, highest_modseq, last_sync_uid, high_water_mark_uid, initial_sync_completed_at FROM mailbox",
			)
			.get();
		sqlite.close();
		assert.deepEqual(mailbox, {
			mailbox_id: "mbx-1",
			full_path: "INBOX",
			highest_modseq: "0",
			last_sync_uid: 0,
			high_water_mark_uid: 0,
			initial_sync_completed_at: null,
		});
	});

	test("keeps the user's flags on an address and counts its mail again", () => {
		const sqlite = new Database(targets.mail, { readonly: true });
		const address = sqlite
			.prepare("SELECT flags, inbound_count FROM address")
			.get() as { flags: string; inbound_count: number };
		sqlite.close();
		assert.equal(JSON.parse(address.flags).muted.value, true);
		assert.equal(address.inbound_count, 0);
	});

	test("fails rather than merge into a database that already holds the rows", async () => {
		await assert.rejects(split(), /UNIQUE constraint failed/);
		assert.equal(count(targets.app, "label"), 1);
	});
});

const seedPendingFlagPush = (path: string): void => {
	const sqlite = new Database(path);
	drizzle(sqlite)
		.insert(entities.messageFlagPushes)
		.values({
			messageId: "msg-1",
			flagName: "\\Seen",
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			mailboxId: "mbx-1",
			operation: "add",
			createdAt: NOW,
			updatedAt: NOW,
		})
		.run();
	sqlite.close();
};

describe("the migrate one-shot on a single-file install", () => {
	const dir = mkdtempSync(join(tmpdir(), "remit-auto-split-"));
	const paths = {
		app: join(dir, "app.db"),
		mail: join(dir, "mail.db"),
		search: join(dir, "search.db"),
	};
	const source = legacyDatabasePath(paths);
	const migrationsRoot = fileURLToPath(
		new URL("../../../deploy/vps", import.meta.url),
	);
	const migrate = () =>
		splitLegacyDatabase(
			source,
			paths,
			{ Database, drizzle },
			migrationsRoot,
			() => {},
		);

	let first: Awaited<ReturnType<typeof migrate>>;
	let second: Awaited<ReturnType<typeof migrate>>;

	before(async () => {
		seedSource(source);
		seedPendingFlagPush(source);
		first = await migrate();
		second = await migrate();
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("splits into the three databases, dropping the unpushed changes", () => {
		assert.equal(first.kind, "split");
		assert.deepEqual(first.kind === "split" && first.dropped, {
			message_flag_push: 1,
		});
		assert.equal(count(paths.app, "account_config"), 1);
		assert.equal(count(paths.mail, "outbox_message"), 1);
		assert.equal(count(paths.mail, "message_flag_push"), 0);
		assert.equal(hasTable(paths.search, "__drizzle_migrations_search"), true);
	});

	test("keeps the original as remit.db.pre-split and leaves no staging file", () => {
		assert.equal(existsSync(source), false);
		assert.equal(count(`${source}.pre-split`, "account_config"), 1);
		assert.deepEqual(readdirSync(dir).sort(), [
			"app.db",
			"mail.db",
			"remit.db.pre-split",
			"search.db",
		]);
	});

	test("does nothing on the next run", () => {
		assert.equal(second.kind, "absent");
		assert.equal(count(paths.app, "account_config"), 1);
	});

	test("splits again after dying before app.db was moved into place", async () => {
		renameSync(paths.app, `${paths.app}.splitting`);
		renameSync(`${source}.pre-split`, source);

		const redo = await migrate();

		assert.equal(redo.kind, "split");
		assert.equal(count(paths.app, "account_config"), 1);
		assert.equal(count(paths.mail, "outbox_message"), 1);
		assert.deepEqual(readdirSync(dir).sort(), [
			"app.db",
			"mail.db",
			"remit.db.pre-split",
			"search.db",
		]);
	});

	test("fails at once while an old backend holds the source", async () => {
		rmSync(paths.app);
		renameSync(`${source}.pre-split`, source);
		const oldBackend = new Database(source);
		oldBackend.exec("BEGIN IMMEDIATE");
		try {
			await assert.rejects(migrate(), /locked|busy/i);
		} finally {
			oldBackend.exec("ROLLBACK");
			oldBackend.close();
		}
		assert.equal(existsSync(source), true);
		assert.equal(existsSync(paths.app), false);
	});
});
