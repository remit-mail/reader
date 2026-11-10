import type {
	ClassificationConfigured,
	ClassificationNotConfigured,
	ClassificationPreset,
	UpdateUserSettingsInput,
} from "@remit/api-openapi-types";
import type {
	AccountSettingItem,
	IAccountSettingRepository,
} from "@remit/data-ports";
import { parseAccountSettingValue } from "@remit/data-ports/account-settings";
import {
	CLASSIFICATION_PRESETS,
	DEFAULT_CLASSIFICATION_DAILY_LIMIT,
	isClassificationPresetId,
} from "@remit/data-ports/classification-presets";
import { AccountSettingName } from "@remit/domain-enums";
import {
	type SecretsService,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import type { UserSettingsOutcome } from "./user-settings.js";

export const CLASSIFICATION_SETTING_NAMES = [
	AccountSettingName.ClassificationPresetId,
	AccountSettingName.ClassificationModel,
	AccountSettingName.ClassificationBaseUrl,
	AccountSettingName.ClassificationApiKey,
	AccountSettingName.ClassificationEnabled,
	AccountSettingName.ClassificationDailyLimit,
] as const;

export type ClassificationSettingsDeps = {
	accountSetting: Pick<
		IAccountSettingRepository,
		"getMany" | "upsert" | "delete"
	>;
	secrets: Pick<SecretsService, "encrypt">;
};

export type StoredClassification =
	| ClassificationNotConfigured
	| ClassificationConfigured;

type Refusal = Extract<UserSettingsOutcome, { ok: false }>;
type Decision<T> = { ok: true; value: T } | Refusal;

type ApiKeyChange =
	| { action: "Keep" }
	| { action: "Replace"; apiKey: string }
	| { action: "Delete" };

export interface ClassificationProviderSave {
	preset: ClassificationPreset;
	model: string;
	baseUrl: string;
	apiKey: ApiKeyChange;
}

type ClassificationInput = Pick<
	UpdateUserSettingsInput,
	| "classificationPresetId"
	| "classificationModel"
	| "classificationBaseUrl"
	| "classificationApiKey"
	| "classificationEnabled"
	| "classificationDailyLimit"
>;

const refuse = (code: string, message: string): Refusal => ({
	ok: false,
	error: { code, message },
});

const isHttpUrl = (value: string): boolean => {
	if (!URL.canParse(value)) return false;
	const { protocol } = new URL(value);
	return protocol === "http:" || protocol === "https:";
};

const savesClassificationProvider = (input: ClassificationInput): boolean =>
	input.classificationPresetId !== undefined ||
	input.classificationModel !== undefined ||
	input.classificationBaseUrl !== undefined ||
	input.classificationApiKey !== undefined;

const baseUrlFor = (
	preset: ClassificationPreset,
	requested: string,
): Decision<string> => {
	if (requested === "") {
		if (preset.defaultBaseUrl === undefined) {
			return refuse(
				"InvalidClassificationBaseUrl",
				`classificationBaseUrl is required for ${preset.label}`,
			);
		}
		return { ok: true, value: preset.defaultBaseUrl };
	}
	if (!isHttpUrl(requested)) {
		return refuse(
			"InvalidClassificationBaseUrl",
			"classificationBaseUrl must be an http or https URL",
		);
	}
	return { ok: true, value: requested };
};

const apiKeyFor = (
	preset: ClassificationPreset,
	requested: string,
	keptKey: boolean,
): Decision<ApiKeyChange> => {
	if (!preset.needsKey) return { ok: true, value: { action: "Delete" } };
	if (requested !== "") {
		return { ok: true, value: { action: "Replace", apiKey: requested } };
	}
	if (keptKey) return { ok: true, value: { action: "Keep" } };
	return refuse(
		"ClassificationApiKeyRequired",
		`classificationApiKey is required for ${preset.label}`,
	);
};

export const decideClassificationProvider = (
	input: ClassificationInput,
	stored: StoredClassification,
): Decision<ClassificationProviderSave> => {
	const saved = stored.state === "Configured" ? stored : undefined;
	const presetId = input.classificationPresetId ?? saved?.presetId;
	if (presetId === undefined) {
		return refuse(
			"ClassificationNotConfigured",
			"classificationPresetId is required: no classification provider is saved",
		);
	}
	const preset = CLASSIFICATION_PRESETS[presetId];
	const kept = saved?.presetId === presetId ? saved : undefined;

	const baseUrl = baseUrlFor(
		preset,
		(input.classificationBaseUrl ?? kept?.baseUrl ?? "").trim(),
	);
	if (!baseUrl.ok) return baseUrl;

	const apiKey = apiKeyFor(
		preset,
		(input.classificationApiKey ?? "").trim(),
		kept?.apiKeySaved ?? false,
	);
	if (!apiKey.ok) return apiKey;

	const model = (input.classificationModel ?? kept?.model ?? "").trim();
	return {
		ok: true,
		value: {
			preset,
			model: model === "" ? preset.defaultModel : model,
			baseUrl: baseUrl.value,
			apiKey: apiKey.value,
		},
	};
};

const settingOf = (
	rows: AccountSettingItem[],
	name: string,
): AccountSettingItem | undefined => rows.find((row) => row.name === name);

export const readStoredClassification = async (
	accountSetting: Pick<IAccountSettingRepository, "getMany">,
	accountConfigId: string,
): Promise<StoredClassification> => {
	const rows = await accountSetting.getMany(
		[accountConfigId],
		CLASSIFICATION_SETTING_NAMES,
	);
	const presetRow = settingOf(rows, AccountSettingName.ClassificationPresetId);
	if (!presetRow) return { state: "NotConfigured" };
	const presetId = parseAccountSettingValue(
		AccountSettingName.ClassificationPresetId,
		presetRow.value,
	).value;
	if (!isClassificationPresetId(presetId)) {
		throw new Error(`Stored classification preset is unknown: ${presetId}`);
	}

	const stringOf = (
		name:
			| typeof AccountSettingName.ClassificationModel
			| typeof AccountSettingName.ClassificationBaseUrl,
	): string => {
		const row = settingOf(rows, name);
		return row ? parseAccountSettingValue(name, row.value).value : "";
	};
	const enabledRow = settingOf(rows, AccountSettingName.ClassificationEnabled);
	const limitRow = settingOf(rows, AccountSettingName.ClassificationDailyLimit);
	return {
		state: "Configured",
		presetId,
		model: stringOf(AccountSettingName.ClassificationModel),
		baseUrl: stringOf(AccountSettingName.ClassificationBaseUrl),
		apiKeySaved:
			settingOf(rows, AccountSettingName.ClassificationApiKey) !== undefined,
		enabled: enabledRow
			? parseAccountSettingValue(
					AccountSettingName.ClassificationEnabled,
					enabledRow.value,
				).value
			: false,
		dailyLimit: limitRow
			? parseAccountSettingValue(
					AccountSettingName.ClassificationDailyLimit,
					limitRow.value,
				).value
			: DEFAULT_CLASSIFICATION_DAILY_LIMIT,
		savedAt: presetRow.updatedAt,
	};
};

export const classificationPresetsResponse = (): ClassificationPreset[] =>
	Object.values(CLASSIFICATION_PRESETS);

interface ClassificationChange {
	provider: ClassificationProviderSave | undefined;
	enabled: boolean | undefined;
	dailyLimit: number | undefined;
}

export const decideClassificationChange = (
	input: ClassificationInput,
	stored: StoredClassification,
): Decision<ClassificationChange> => {
	let provider: ClassificationProviderSave | undefined;
	if (savesClassificationProvider(input)) {
		const decided = decideClassificationProvider(input, stored);
		if (!decided.ok) return decided;
		provider = decided.value;
	}
	const configured = provider !== undefined || stored.state === "Configured";
	if (input.classificationEnabled === true && !configured) {
		return refuse(
			"ClassificationNotConfigured",
			"classificationEnabled needs a saved classification provider",
		);
	}
	if (input.classificationDailyLimit !== undefined && !configured) {
		return refuse(
			"ClassificationNotConfigured",
			"classificationDailyLimit needs a saved classification provider",
		);
	}
	return {
		ok: true,
		value: {
			provider,
			enabled: configured ? input.classificationEnabled : undefined,
			dailyLimit: input.classificationDailyLimit,
		},
	};
};

const writeProvider = async (
	deps: ClassificationSettingsDeps,
	accountConfigId: string,
	save: ClassificationProviderSave,
): Promise<void> => {
	const { accountSetting } = deps;
	if (save.apiKey.action === "Delete") {
		await accountSetting.delete(
			accountConfigId,
			AccountSettingName.ClassificationApiKey,
		);
	}
	if (save.apiKey.action === "Replace") {
		const ciphertext = serializeEncryptedPayload(
			await deps.secrets.encrypt(save.apiKey.apiKey),
		);
		await accountSetting.upsert({
			accountConfigId,
			name: AccountSettingName.ClassificationApiKey,
			value: { kind: "Map", value: { ...ciphertext } },
		});
	}
	await accountSetting.upsert({
		accountConfigId,
		name: AccountSettingName.ClassificationModel,
		value: { kind: "String", value: save.model },
	});
	await accountSetting.upsert({
		accountConfigId,
		name: AccountSettingName.ClassificationBaseUrl,
		value: { kind: "String", value: save.baseUrl },
	});
	await accountSetting.upsert({
		accountConfigId,
		name: AccountSettingName.ClassificationPresetId,
		value: { kind: "String", value: save.preset.presetId },
	});
};

export const writeClassificationChange = async (
	deps: ClassificationSettingsDeps,
	accountConfigId: string,
	change: ClassificationChange,
): Promise<void> => {
	if (change.provider) {
		await writeProvider(deps, accountConfigId, change.provider);
	}
	if (change.enabled !== undefined) {
		await deps.accountSetting.upsert({
			accountConfigId,
			name: AccountSettingName.ClassificationEnabled,
			value: { kind: "Boolean", value: change.enabled },
		});
	}
	if (change.dailyLimit !== undefined) {
		await deps.accountSetting.upsert({
			accountConfigId,
			name: AccountSettingName.ClassificationDailyLimit,
			value: { kind: "Number", value: change.dailyLimit },
		});
	}
};

export const clearClassification = async (
	accountSetting: Pick<IAccountSettingRepository, "delete">,
	accountConfigId: string,
): Promise<void> => {
	for (const name of CLASSIFICATION_SETTING_NAMES) {
		await accountSetting.delete(accountConfigId, name);
	}
};
