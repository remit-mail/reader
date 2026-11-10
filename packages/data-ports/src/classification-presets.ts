import {
	ClassificationAdapterShape,
	ClassificationPresetGroup,
	ClassificationPresetId,
} from "@remit/domain-enums";

export type ClassificationPresetIdValue =
	(typeof ClassificationPresetId)[keyof typeof ClassificationPresetId];
export type ClassificationAdapterShapeValue =
	(typeof ClassificationAdapterShape)[keyof typeof ClassificationAdapterShape];
export type ClassificationPresetGroupValue =
	(typeof ClassificationPresetGroup)[keyof typeof ClassificationPresetGroup];

export type ClassificationPrice =
	| { state: "Priced"; currency: "USD"; perMillionInputTokens: number }
	| { state: "NoPrice" };

interface PresetCommon {
	presetId: ClassificationPresetIdValue;
	label: string;
	group: ClassificationPresetGroupValue;
	adapterShape: ClassificationAdapterShapeValue;
	defaultModel: string;
	needsKey: boolean;
	price: ClassificationPrice;
}

export type ClassificationPreset =
	| (PresetCommon & { needsBaseUrl: false; defaultBaseUrl: string })
	| (PresetCommon & { needsBaseUrl: true; defaultBaseUrl?: string });

const NO_PRICE: ClassificationPrice = { state: "NoPrice" };

export const CLASSIFICATION_PRESETS: readonly ClassificationPreset[] = [
	{
		presetId: ClassificationPresetId.Jev,
		label: "TypeSafe Jev",
		group: ClassificationPresetGroup.Hosted,
		adapterShape: ClassificationAdapterShape.DecisionApi,
		defaultBaseUrl: "https://api.typesafe.ai",
		defaultModel: "jev-latest",
		needsKey: true,
		needsBaseUrl: false,
		price: { state: "Priced", currency: "USD", perMillionInputTokens: 0.042 },
	},
	{
		presetId: ClassificationPresetId.Jina,
		label: "Jina",
		group: ClassificationPresetGroup.Hosted,
		adapterShape: ClassificationAdapterShape.JinaClassify,
		defaultBaseUrl: "https://api.jina.ai",
		defaultModel: "jina-embeddings-v3",
		needsKey: true,
		needsBaseUrl: false,
		price: NO_PRICE,
	},
	{
		presetId: ClassificationPresetId.Mistral,
		label: "Mistral",
		group: ClassificationPresetGroup.Hosted,
		adapterShape: ClassificationAdapterShape.ChatJsonSchema,
		defaultBaseUrl: "https://api.eu.mistral.ai",
		defaultModel: "ministral-8b-latest",
		needsKey: true,
		needsBaseUrl: false,
		price: NO_PRICE,
	},
	{
		presetId: ClassificationPresetId.Gemini,
		label: "Google Gemini",
		group: ClassificationPresetGroup.Hosted,
		adapterShape: ClassificationAdapterShape.ChatJsonSchema,
		defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
		defaultModel: "gemini-flash-lite-latest",
		needsKey: true,
		needsBaseUrl: false,
		price: NO_PRICE,
	},
	{
		presetId: ClassificationPresetId.OpenAiCompatible,
		label: "OpenAI-compatible endpoint",
		group: ClassificationPresetGroup.Custom,
		adapterShape: ClassificationAdapterShape.ChatJsonSchema,
		defaultModel: "gpt-5-nano",
		needsKey: true,
		needsBaseUrl: true,
		price: NO_PRICE,
	},
	{
		presetId: ClassificationPresetId.Local,
		label: "Local",
		group: ClassificationPresetGroup.Local,
		adapterShape: ClassificationAdapterShape.DecisionApi,
		defaultBaseUrl: "http://localhost:8080",
		defaultModel: "clef-flash",
		needsKey: false,
		needsBaseUrl: true,
		price: NO_PRICE,
	},
];

export const DEFAULT_CLASSIFICATION_DAILY_LIMIT = 500;

export const findClassificationPreset = (
	presetId: string,
): ClassificationPreset | undefined =>
	CLASSIFICATION_PRESETS.find((preset) => preset.presetId === presetId);
