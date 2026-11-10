import type {
	ClassificationConfigured,
	ClassificationNotConfigured,
	ClassificationPreset,
	ClassificationPresetId as ClassificationPresetIdValue,
} from "@remit/api-openapi-types";
import {
	AccountSettingName,
	ClassificationAdapterShape,
	ClassificationPresetGroup,
	ClassificationPresetId,
} from "@remit/domain-enums";
import {
	type AccountSettingValueFor,
	parseAccountSettingValue,
} from "./account-settings.js";
import type { IAccountSettingRepository } from "./interfaces/account-setting.js";
import type { AccountSettingItem } from "./types.js";

const NO_PRICE: ClassificationPreset["price"] = { state: "NoPrice" };

export const CLASSIFICATION_PRESETS: Record<
	ClassificationPresetIdValue,
	ClassificationPreset
> = {
	[ClassificationPresetId.Jev]: {
		presetId: ClassificationPresetId.Jev,
		label: "TypeSafe Jev",
		group: ClassificationPresetGroup.Hosted,
		adapterShape: ClassificationAdapterShape.DecisionApi,
		defaultBaseUrl: "https://api.typesafe.ai",
		defaultModel: "jev-latest",
		needsKey: true,
		price: { state: "Priced", currency: "USD", perMillionInputTokens: 0.042 },
	},
	[ClassificationPresetId.Jina]: {
		presetId: ClassificationPresetId.Jina,
		label: "Jina",
		group: ClassificationPresetGroup.Hosted,
		adapterShape: ClassificationAdapterShape.JinaClassify,
		defaultBaseUrl: "https://api.jina.ai",
		defaultModel: "jina-embeddings-v3",
		needsKey: true,
		price: NO_PRICE,
	},
	[ClassificationPresetId.Mistral]: {
		presetId: ClassificationPresetId.Mistral,
		label: "Mistral",
		group: ClassificationPresetGroup.Hosted,
		adapterShape: ClassificationAdapterShape.ChatJsonSchema,
		defaultBaseUrl: "https://api.eu.mistral.ai/v1",
		defaultModel: "ministral-8b-latest",
		needsKey: true,
		price: NO_PRICE,
	},
	[ClassificationPresetId.Gemini]: {
		presetId: ClassificationPresetId.Gemini,
		label: "Google Gemini",
		group: ClassificationPresetGroup.Hosted,
		adapterShape: ClassificationAdapterShape.ChatJsonSchema,
		defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
		defaultModel: "gemini-flash-lite-latest",
		needsKey: true,
		price: NO_PRICE,
	},
	[ClassificationPresetId.OpenAiCompatible]: {
		presetId: ClassificationPresetId.OpenAiCompatible,
		label: "OpenAI-compatible endpoint",
		group: ClassificationPresetGroup.Custom,
		adapterShape: ClassificationAdapterShape.ChatJsonSchema,
		defaultModel: "gpt-5-nano",
		needsKey: true,
		price: NO_PRICE,
	},
	[ClassificationPresetId.Local]: {
		presetId: ClassificationPresetId.Local,
		label: "Local",
		group: ClassificationPresetGroup.Local,
		adapterShape: ClassificationAdapterShape.DecisionApi,
		defaultBaseUrl: "http://localhost:8080",
		defaultModel: "clef-flash",
		needsKey: false,
		price: NO_PRICE,
	},
};

export const DEFAULT_CLASSIFICATION_DAILY_LIMIT = 500;

export const isClassificationPresetId = (
	value: string,
): value is ClassificationPresetIdValue =>
	Object.hasOwn(CLASSIFICATION_PRESETS, value);

export const CLASSIFICATION_SETTING_NAMES = [
	AccountSettingName.ClassificationPresetId,
	AccountSettingName.ClassificationModel,
	AccountSettingName.ClassificationBaseUrl,
	AccountSettingName.ClassificationApiKey,
	AccountSettingName.ClassificationEnabled,
	AccountSettingName.ClassificationDailyLimit,
] as const;

export type ClassificationApiKeyCiphertext = AccountSettingValueFor<
	typeof AccountSettingName.ClassificationApiKey
>["value"];

export type StoredClassification =
	| ClassificationNotConfigured
	| (ClassificationConfigured & {
			apiKeyCiphertext: ClassificationApiKeyCiphertext | undefined;
	  });

export type SavedClassification =
	| StoredClassification
	| { state: "UnknownPreset"; presetId: string };

const settingOf = (
	rows: AccountSettingItem[],
	name: string,
): AccountSettingItem | undefined => rows.find((row) => row.name === name);

export const readSavedClassification = async (
	accountSetting: Pick<IAccountSettingRepository, "getMany">,
	accountConfigId: string,
): Promise<SavedClassification> => {
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
		return { state: "UnknownPreset", presetId };
	}

	const stringOf = (
		name:
			| typeof AccountSettingName.ClassificationModel
			| typeof AccountSettingName.ClassificationBaseUrl,
	): string => {
		const row = settingOf(rows, name);
		return row ? parseAccountSettingValue(name, row.value).value : "";
	};
	const keyRow = settingOf(rows, AccountSettingName.ClassificationApiKey);
	const enabledRow = settingOf(rows, AccountSettingName.ClassificationEnabled);
	const limitRow = settingOf(rows, AccountSettingName.ClassificationDailyLimit);
	return {
		state: "Configured",
		presetId,
		model: stringOf(AccountSettingName.ClassificationModel),
		baseUrl: stringOf(AccountSettingName.ClassificationBaseUrl),
		apiKeySaved: keyRow !== undefined,
		apiKeyCiphertext: keyRow
			? parseAccountSettingValue(
					AccountSettingName.ClassificationApiKey,
					keyRow.value,
				).value
			: undefined,
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

export const readStoredClassification = async (
	accountSetting: Pick<IAccountSettingRepository, "getMany">,
	accountConfigId: string,
): Promise<StoredClassification> => {
	const saved = await readSavedClassification(accountSetting, accountConfigId);
	if (saved.state === "UnknownPreset") {
		throw new Error(
			`Stored classification preset is unknown: ${saved.presetId}`,
		);
	}
	return saved;
};
