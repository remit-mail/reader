import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	AccountSettingName,
	ClassificationPresetId,
} from "@remit/domain-enums";
import {
	type ClassificationDeploymentDefault,
	classificationUsageName,
	utcDateOf,
} from "./classification-presets.js";
import {
	isClassificationBudgetSpent,
	type ResolvedClassification,
	type ResolvedClassificationProvider,
	resolveClassification,
} from "./classification-resolver.js";
import type { IAccountConfigRepository } from "./interfaces/account-config.js";
import type { IAccountSettingRepository } from "./interfaces/account-setting.js";
import type { AccountSettingItem, AccountSettingValue } from "./types.js";

const CREATED_AT = 1_000;
const SAVED_AT = 9_000;
const CIPHERTEXT = {
	encryptedDek: "dek",
	encryptedData: "data",
	iv: "iv",
	authTag: "tag",
};

const DEPLOYMENT: ClassificationDeploymentDefault = {
	state: "Configured",
	presetId: ClassificationPresetId.Mistral,
	model: "mistral-small-latest",
	baseUrl: "https://mistral.example/v1",
	apiKey: "sk-deployment",
	enabled: true,
	dailyLimit: 40,
};

const row = (name: string, value: AccountSettingValue): AccountSettingItem => ({
	accountSettingId: name,
	accountConfigId: "config-1",
	name,
	value,
	createdAt: SAVED_AT,
	updatedAt: SAVED_AT,
});

const preset = (presetId: string) =>
	row(AccountSettingName.ClassificationPresetId, {
		kind: "String",
		value: presetId,
	});

const model = (value: string) =>
	row(AccountSettingName.ClassificationModel, { kind: "String", value });

const baseUrl = (value: string) =>
	row(AccountSettingName.ClassificationBaseUrl, { kind: "String", value });

const apiKey = () =>
	row(AccountSettingName.ClassificationApiKey, {
		kind: "Map",
		value: CIPHERTEXT,
	});

const enabled = (value: boolean) =>
	row(AccountSettingName.ClassificationEnabled, { kind: "Boolean", value });

const dailyLimit = (value: number) =>
	row(AccountSettingName.ClassificationDailyLimit, { kind: "Number", value });

const resolve = (
	rows: AccountSettingItem[],
	deployment: ClassificationDeploymentDefault = DEPLOYMENT,
): ResolvedClassification =>
	resolveClassification({
		rows,
		deployment,
		accountConfigCreatedAt: CREATED_AT,
	});

const configured = (
	rows: AccountSettingItem[],
	deployment: ClassificationDeploymentDefault = DEPLOYMENT,
): ResolvedClassificationProvider => {
	const resolved = resolve(rows, deployment);
	assert.equal(resolved.state, "Configured");
	return resolved as ResolvedClassificationProvider;
};

describe("resolveClassification", () => {
	it("is not configured with no rows and no deployment default", () => {
		assert.deepEqual(resolve([], { state: "None" }), {
			state: "NotConfigured",
		});
	});

	it("reports an unknown saved preset over the deployment default", () => {
		assert.deepEqual(resolve([preset("RetiredPreset")]), {
			state: "UnknownPreset",
			presetId: "RetiredPreset",
		});
	});

	it("takes every field from the deployment with no rows", () => {
		assert.deepEqual(configured([]), {
			state: "Configured",
			presetId: { value: ClassificationPresetId.Mistral, source: "Deployment" },
			model: { value: "mistral-small-latest", source: "Deployment" },
			baseUrl: { value: "https://mistral.example/v1", source: "Deployment" },
			apiKey: { source: "Deployment", apiKey: "sk-deployment" },
			enabled: { value: true, source: "Deployment" },
			dailyLimit: { value: 40, source: "Deployment" },
			classifiesAfter: CREATED_AT,
		});
	});

	it("takes every field from the saved rows when all are saved", () => {
		assert.deepEqual(
			configured([
				preset(ClassificationPresetId.Jev),
				model("jev-saved"),
				baseUrl("https://jev.example"),
				apiKey(),
				enabled(false),
				dailyLimit(7),
			]),
			{
				state: "Configured",
				presetId: { value: ClassificationPresetId.Jev, source: "Saved" },
				model: { value: "jev-saved", source: "Saved" },
				baseUrl: { value: "https://jev.example", source: "Saved" },
				apiKey: { source: "Saved", ciphertext: CIPHERTEXT },
				enabled: { value: false, source: "Saved" },
				dailyLimit: { value: 7, source: "Saved" },
				classifiesAfter: SAVED_AT,
			},
		);
	});

	it("falls back to the preset defaults, off and 500 with no deployment default", () => {
		const resolved = configured(
			[preset(ClassificationPresetId.Jev), apiKey()],
			{ state: "None" },
		);

		assert.deepEqual(resolved.model, {
			value: "jev-latest",
			source: "Default",
		});
		assert.deepEqual(resolved.baseUrl, {
			value: "https://api.typesafe.ai",
			source: "Default",
		});
		assert.deepEqual(resolved.enabled, { value: false, source: "Default" });
		assert.deepEqual(resolved.dailyLimit, { value: 500, source: "Default" });
	});

	it("takes preset defaults and withholds the key, but keeps the deployment switch and limit, for a saved preset that differs", () => {
		assert.deepEqual(configured([preset(ClassificationPresetId.Local)]), {
			state: "Configured",
			presetId: { value: ClassificationPresetId.Local, source: "Saved" },
			model: { value: "clef-flash", source: "Default" },
			baseUrl: { value: "http://localhost:8080", source: "Default" },
			apiKey: { source: "Default" },
			enabled: { value: true, source: "Deployment" },
			dailyLimit: { value: 40, source: "Deployment" },
			classifiesAfter: SAVED_AT,
		});
	});

	it("uses the deployment model and base URL when the saved preset matches", () => {
		const resolved = configured([preset(ClassificationPresetId.Mistral)]);

		assert.deepEqual(resolved.presetId, {
			value: ClassificationPresetId.Mistral,
			source: "Saved",
		});
		assert.deepEqual(resolved.model, {
			value: "mistral-small-latest",
			source: "Deployment",
		});
		assert.deepEqual(resolved.baseUrl, {
			value: "https://mistral.example/v1",
			source: "Deployment",
		});
		assert.equal(resolved.classifiesAfter, SAVED_AT);
	});

	it("overrides one field at a time over the deployment", () => {
		const resolved = configured([model("mistral-saved"), dailyLimit(3)]);

		assert.deepEqual(resolved.model, {
			value: "mistral-saved",
			source: "Saved",
		});
		assert.deepEqual(resolved.dailyLimit, { value: 3, source: "Saved" });
		assert.deepEqual(resolved.enabled, { value: true, source: "Deployment" });
		assert.equal(resolved.classifiesAfter, CREATED_AT);
	});

	it("prefers a saved key over the deployment key", () => {
		assert.deepEqual(configured([apiKey()]).apiKey, {
			source: "Saved",
			ciphertext: CIPHERTEXT,
		});
	});

	it("cannot run once the base URL is saved elsewhere, as the deployment key is withheld", () => {
		assert.deepEqual(resolve([baseUrl("https://other.example/v1")]), {
			state: "Unrunnable",
			presetId: ClassificationPresetId.Mistral,
			reason: "NoApiKey",
		});
	});

	it("sends the deployment key to a saved base URL equal to the deployment's", () => {
		assert.deepEqual(
			configured([baseUrl("https://mistral.example/v1")]).apiKey,
			{ source: "Deployment", apiKey: "sk-deployment" },
		);
	});

	it("cannot run another preset that needs a key, as the deployment key is withheld", () => {
		assert.deepEqual(resolve([preset(ClassificationPresetId.Jev)]), {
			state: "Unrunnable",
			presetId: ClassificationPresetId.Jev,
			reason: "NoApiKey",
		});
	});

	it("withholds the deployment key from another preset on the same base URL", () => {
		assert.deepEqual(
			resolve([
				preset(ClassificationPresetId.OpenAiCompatible),
				baseUrl("https://mistral.example/v1"),
			]),
			{
				state: "Unrunnable",
				presetId: ClassificationPresetId.OpenAiCompatible,
				reason: "NoApiKey",
			},
		);
	});

	it("cannot run a preset with no base URL from anywhere", () => {
		assert.deepEqual(
			resolve([preset(ClassificationPresetId.OpenAiCompatible), apiKey()], {
				state: "None",
			}),
			{
				state: "Unrunnable",
				presetId: ClassificationPresetId.OpenAiCompatible,
				reason: "NoBaseUrl",
			},
		);
	});
});

describe("the classifier budget for the day", () => {
	const DAY = Date.UTC(2026, 10, 11, 12);
	const NEXT_DAY = Date.UTC(2026, 10, 12, 0, 0, 1);
	const account = { accountId: "account-1", accountConfigId: "config-1" };

	const budgetDeps = () => {
		const rows = new Map<string, AccountSettingItem>();
		const accountSetting: Pick<
			IAccountSettingRepository,
			"getMany" | "claimDailyCount"
		> = {
			getMany: async (_configIds, names) =>
				names.flatMap((name) => rows.get(name) ?? []),
			claimDailyCount: async (input) => {
				const used = rows.get(input.name);
				const calls =
					used?.value.kind === "DailyCount" &&
					used.value.value.date === input.date
						? used.value.value.calls
						: 0;
				if (calls >= input.limit) return { state: "AtLimit" };
				rows.set(
					input.name,
					row(input.name, {
						kind: "DailyCount",
						value: { date: input.date, calls: calls + 1 },
					}),
				);
				return { state: "Claimed", calls: calls + 1 };
			},
		};
		const getAccountConfig = async () => ({ createdAt: CREATED_AT });
		const accountConfig: Pick<IAccountConfigRepository, "get"> = {
			get: getAccountConfig as unknown as IAccountConfigRepository["get"],
		};
		return {
			accountSetting,
			accountConfig,
			classificationDefault: { ...DEPLOYMENT, dailyLimit: 2 },
		};
	};

	it("is spent once the day's calls reach the limit and open again the next UTC day", async () => {
		const deps = budgetDeps();
		const claim = () =>
			deps.accountSetting.claimDailyCount({
				accountConfigId: account.accountConfigId,
				name: classificationUsageName(account.accountId),
				date: utcDateOf(DAY),
				limit: 2,
			});

		assert.equal(await isClassificationBudgetSpent(deps, account, DAY), false);
		await claim();
		assert.equal(await isClassificationBudgetSpent(deps, account, DAY), false);
		await claim();
		assert.equal(await isClassificationBudgetSpent(deps, account, DAY), true);
		assert.equal(
			await isClassificationBudgetSpent(deps, account, NEXT_DAY),
			false,
		);
	});
});
