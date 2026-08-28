import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
	type ConfigImportRepositories,
	importConfig,
} from "@remit/config-transfer";
import type { Db } from "../db.js";
import {
	type MessageDataSchema,
	messageDataSchema,
} from "../schema/message-data.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { runInTransaction, serializeSqliteWrites } from "../tx.js";
import { FilterRepo } from "./filter.js";
import { FilterAnchorRepo } from "./filter-anchor.js";
import { AccountRepo } from "./i4-account.js";
import { AccountConfigRepo } from "./i4-account-config.js";
import { AccountSettingRepo } from "./i4-account-setting.js";
import { AddressRepo } from "./i4-address.js";
import { ConfigImportRepo } from "./i4-config-import.js";
import { MailboxRepo } from "./i4-mailbox.js";
import { LabelRepo } from "./label.js";

// The import claims to be atomic, and the unit tests prove that claim against a
// fake that rolls back because it was written to. This one puts the claim on the
// real thing: the repos the backend composes, over better-sqlite3, inside the
// real `runInTransaction` savepoint. A filter write is made to fail after the
// account, the label and the configuration row have already been inserted — the
// exact shape of a half-applied import — and nothing may survive it.

const CONFIG_ID = "0d9c8b7a6e5f4d3cb2a10f9e8";
const ACCOUNT_ID = "6f4c2c309a2c4a7f9f9f1f2c3";
const USER_ID = "7c1f0a2e-3b4d-4c5e-8f90-a1b2c3d4e5f6";
const MESSAGE_ID = "c4b3a2918f7e6d5c4b3a29187";

const document = () => ({
	kind: "reader.config",
	schemaVersion: 1,
	generator: {
		app: "reader",
		version: "v0.1.0",
		exportedAt: "2026-08-27T09:15:00+02:00",
	},
	provenance: { accountConfigId: CONFIG_ID, instance: "reader.ischen.nl" },
	accountConfig: { name: "Matthijs" },
	accounts: [
		{
			accountId: ACCOUNT_ID,
			email: "matthijs@ischen.nl",
			username: "matthijs@ischen.nl",
			authType: "password",
			credentials: { required: "password" },
			isActive: true,
			imap: { host: "imap.ischen.nl", port: 993, tls: true, startTls: false },
			smtp: {
				enabled: true,
				host: "smtp.ischen.nl",
				port: 587,
				tls: false,
				startTls: true,
				username: "",
			},
			displayName: "Matthijs",
			muted: null,
			composeLanguages: ["nl"],
			signature: { plainText: "Matthijs", html: "<p>Matthijs</p>" },
			folderRoles: [],
			folderOverrides: [],
			pinnedFolders: ["INBOX"],
		},
	],
	labels: [{ name: "Facturen", color: "Default" }],
	filters: [
		{
			name: "Invoices",
			scope: "Standing",
			expiresAt: null,
			matchOperator: "And",
			literalClauses: [{ field: "From", value: "billing@example.com" }],
			actionLabelName: "Facturen",
			actionFolder: null,
			anchor: {
				sourceText: "the release note this filter was drawn from",
				embeddingId: "amazon.titan-embed-text-v2:0@1024",
				sourceMessageId: MESSAGE_ID,
			},
		},
	],
	addressFlags: [],
});

describe("a config import is atomic over the real sqlite savepoint", () => {
	let db: Db<MessageDataSchema>;
	let close: () => Promise<void>;
	let repositories: ConfigImportRepositories;

	before(async () => {
		const created =
			await createSqliteTestDb<MessageDataSchema>(messageDataSchema);
		close = created.close;
		db = serializeSqliteWrites(created.db);

		repositories = {
			accountConfig: new AccountConfigRepo(db),
			account: new AccountRepo(db),
			accountSetting: new AccountSettingRepo(db),
			mailbox: new MailboxRepo(db),
			label: new LabelRepo(db),
			filter: new FilterRepo(db),
			filterAnchor: new FilterAnchorRepo(db),
			address: new AddressRepo(db),
			configImport: new ConfigImportRepo(db),
		};
	});

	after(async () => {
		await close();
	});

	test("a filter write that fails rolls back the account, the label and the configuration row", async () => {
		// Delegating rather than spreading: the repos are class instances, and a
		// spread would copy no prototype method at all.
		const refusingFilters: ConfigImportRepositories["filter"] = {
			listByAccountConfig: (...args) =>
				repositories.filter.listByAccountConfig(...args),
			update: (...args) => repositories.filter.update(...args),
			create: () => Promise.reject(new Error("filter write refused")),
		};

		const outcome = await importConfig(
			{
				repositories: { ...repositories, filter: refusingFilters },
				appointFolderRole: () => {
					throw new Error("this document names no folder roles");
				},
				transaction: (run) => runInTransaction(db, () => run()),
				embedAnchor: async () => ({
					embedding: [0.11, 0.22, 0.33],
					embeddingId: "amazon.titan-embed-text-v2:0@1024",
				}),
			},
			{
				accountConfigId: CONFIG_ID,
				userId: USER_ID,
				document: document(),
				mode: "apply",
				onExisting: "abort",
			},
		);

		assert.equal(outcome.outcome, "report");
		if (outcome.outcome !== "report") throw new Error("unreachable");
		assert.equal(outcome.report.applied, false);
		assert.equal(outcome.report.errors[0]?.code, "import_write_failed");
		assert.match(
			outcome.report.errors[0]?.message ?? "",
			/Nothing was written/,
		);

		// The store itself, read back through the same repos. Accounts and labels
		// are written before filters, so a savepoint that did not roll back would
		// leave both here.
		assert.deepEqual(
			await repositories.account.listAllByAccountConfig(CONFIG_ID),
			[],
		);
		assert.deepEqual(
			await repositories.label.listByAccountConfig(CONFIG_ID),
			[],
		);
		assert.deepEqual(
			await repositories.filter.listByAccountConfig(CONFIG_ID),
			[],
		);
		assert.deepEqual(
			await repositories.configImport.listByAccountConfig(CONFIG_ID),
			[],
		);
		await assert.rejects(() => repositories.accountConfig.get(CONFIG_ID));
	});

	test("the same document applies whole once the write succeeds", async () => {
		const outcome = await importConfig(
			{
				repositories,
				appointFolderRole: () => {
					throw new Error("this document names no folder roles");
				},
				transaction: (run) => runInTransaction(db, () => run()),
				embedAnchor: async () => ({
					embedding: [0.11, 0.22, 0.33],
					embeddingId: "amazon.titan-embed-text-v2:0@1024",
				}),
			},
			{
				accountConfigId: CONFIG_ID,
				userId: USER_ID,
				document: document(),
				mode: "apply",
				onExisting: "abort",
			},
		);

		assert.equal(outcome.outcome, "report");
		if (outcome.outcome !== "report") throw new Error("unreachable");
		assert.equal(outcome.report.applied, true);
		assert.equal(outcome.report.errors.length, 0);

		const accounts =
			await repositories.account.listAllByAccountConfig(CONFIG_ID);
		assert.equal(accounts.length, 1);
		assert.equal(accounts[0]?.accountId, ACCOUNT_ID);
		assert.equal(accounts[0]?.isActive, false);
		assert.equal(
			(await repositories.label.listByAccountConfig(CONFIG_ID)).length,
			1,
		);
		assert.equal(
			(await repositories.filter.listByAccountConfig(CONFIG_ID)).length,
			1,
		);
		assert.equal(
			(await repositories.configImport.listByAccountConfig(CONFIG_ID)).length,
			1,
		);
		assert.equal(
			(await repositories.accountConfig.get(CONFIG_ID)).name,
			"Matthijs",
		);
	});
});
