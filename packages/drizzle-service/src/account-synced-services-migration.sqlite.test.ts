import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AccountService } from "@remit/domain-enums";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { AccountRepo } from "./repos/i4-account.js";
import { accountTable } from "./schema.js";
import {
	applyMigration,
	migrationJournal,
} from "./test-shipped-sqlite-schema.js";

const MIGRATION = "0029_account_synced_services";

const atPredecessor = (): Database.Database => {
	const sqlite = new Database(":memory:");
	for (const entry of migrationJournal()) {
		if (entry.tag === MIGRATION) return sqlite;
		applyMigration(sqlite, entry.tag);
	}
	throw new Error(`${MIGRATION} is not in the journal`);
};

const migrateOnward = (sqlite: Database.Database): void => {
	const tags = migrationJournal().map((entry) => entry.tag);
	for (const tag of tags.slice(tags.indexOf(MIGRATION))) {
		applyMigration(sqlite, tag);
	}
};

describe("an account written before the service selection existed", () => {
	test("comes out of the migration syncing mail only", async () => {
		const sqlite = atPredecessor();
		sqlite
			.prepare(
				`INSERT INTO account (
					account_id, account_config_id, username, email, auth_type,
					imap_host, imap_port, imap_tls, imap_start_tls, smtp_port,
					is_active, connection_state, created_at, updated_at
				) VALUES ('existing', 'config', 'person', 'person@example.com',
					'password', 'imap.example.com', 993, 1, 0, 587, 1,
					'not_authenticated', 0, 0)`,
			)
			.run();

		migrateOnward(sqlite);

		const repo = new AccountRepo(
			drizzle(sqlite, { schema: { accounts: accountTable } }) as never,
		);
		assert.deepEqual((await repo.get("existing")).syncedServices, [
			AccountService.Mail,
		]);
		sqlite.close();
	});
});
