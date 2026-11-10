import type {
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
	composeSettingName,
} from "./account-settings.js";

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

export type ClassificationDeploymentDefault =
	| { state: "None" }
	| {
			state: "Configured";
			presetId: ClassificationPresetIdValue;
			model: string;
			baseUrl: string;
			apiKey: string;
			enabled: boolean;
			dailyLimit: number;
	  };

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

export const classificationUsageName = (accountId: string): string =>
	composeSettingName(AccountSettingName.ClassificationUsage, accountId);

export const utcDateOf = (epochMs: number): string =>
	new Date(epochMs).toISOString().slice(0, 10);
