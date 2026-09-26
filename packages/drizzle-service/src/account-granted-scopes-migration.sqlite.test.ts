import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { AccountRepo } from "./repos/i4-account.js";
import { accountTable } from "./schema.js";
import {
	applyMigration,
	migrationJournal,
} from "./test-shipped-sqlite-schema.js";

const MIGRATION = "0032_account_granted_scopes";

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

const insertAccount = (
	sqlite: Database.Database,
	accountId: string,
	authType: string,
): void => {
	sqlite
		.prepare(
			`INSERT INTO account (
				account_id, account_config_id, username, email, auth_type,
				imap_host, imap_port, imap_tls, imap_start_tls, smtp_port,
				is_active, connection_state, created_at, updated_at
			) VALUES (?, 'config', 'person', 'person@example.com', ?,
				'outlook.office365.com', 993, 1, 0, 587, 1,
				'not_authenticated', 0, 0)`,
		)
		.run(accountId, authType);
};

describe("an account written before granted scopes were recorded", () => {
	test("a Microsoft account holds the mail grant its consent always asked for", async () => {
		const sqlite = atPredecessor();
		insertAccount(sqlite, "microsoft", "oauthMicrosoft");
		insertAccount(sqlite, "password", "password");

		migrateOnward(sqlite);

		const repo = new AccountRepo(
			drizzle(sqlite, { schema: { accounts: accountTable } }) as never,
		);
		assert.deepEqual((await repo.get("microsoft")).grantedScopes, [
			"https://outlook.office.com/IMAP.AccessAsUser.All",
			"https://outlook.office.com/SMTP.Send",
		]);
		assert.deepEqual((await repo.get("password")).grantedScopes, []);
		sqlite.close();
	});
});
