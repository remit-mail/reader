import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { ClassificationPresetId } from "@remit/domain-enums";
import {
	BETTER_SQLITE3_LIMITS,
	createSqliteRepositories,
	messageObjectsInMemory,
	type SqliteRepositories,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import {
	createSecretsService,
	type SecretsService,
} from "@remit/secrets-service";
import { updateUserSettingsFor } from "./user-settings.js";

const ACCOUNT_CONFIG_ID = deriveAccountConfigId("classification-sub-1534");

const dataKey = randomBytes(32);
const secrets: SecretsService = createSecretsService({
	generateDataKey: async () => ({ plaintext: dataKey, encrypted: dataKey }),
	decryptDataKey: async () => dataKey,
});

let repos: SqliteRepositories;
let close: () => void;

const enable = async (): Promise<void> => {
	const updated = await updateUserSettingsFor(
		{
			accountSetting: repos.accountSetting,
			accountConfig: repos.accountConfig,
			classificationDefault: { state: "None" },
			accounts: repos.account,
			secrets,
			label: repos.label,
		},
		ACCOUNT_CONFIG_ID,
		{
			classificationPresetId: ClassificationPresetId.Local,
			classificationEnabled: true,
		},
	);
	assert.equal(updated.ok, true);
};

const labelNames = async (): Promise<string[]> =>
	(await repos.label.listByAccountConfig(ACCOUNT_CONFIG_ID))
		.map((label) => label.name)
		.sort();

beforeEach(async () => {
	const store = createShippedSqliteDb();
	close = store.close;
	repos = createSqliteRepositories(
		{ app: store.db, mail: store.db, search: store.db },
		BETTER_SQLITE3_LIMITS,
		messageObjectsInMemory(),
	);
	await repos.accountConfig.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		userId: "classification-sub-1534",
	});
});

afterEach(() => close());

describe("switching classification on", () => {
	it("creates the Priority and Personal labels", async () => {
		await enable();

		assert.deepEqual(await labelNames(), ["Personal", "Priority"]);
	});

	it("creates no duplicate when switched on twice", async () => {
		await enable();
		await enable();

		assert.deepEqual(await labelNames(), ["Personal", "Priority"]);
	});

	it("reuses a label the user already named Priority", async () => {
		const own = await repos.label.create({
			accountConfigId: ACCOUNT_CONFIG_ID,
			name: "priority",
		});

		await enable();

		const labels = await repos.label.listByAccountConfig(ACCOUNT_CONFIG_ID);
		assert.equal(labels.length, 2);
		assert.ok(labels.some((label) => label.labelId === own.labelId));
		assert.ok(labels.some((label) => label.name === "Personal"));
	});
});
