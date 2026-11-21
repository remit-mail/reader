import {
	CLASSIFICATION_PRESETS,
	type ClassificationDeploymentDefault,
	DEFAULT_CLASSIFICATION_DAILY_LIMIT,
	isClassificationPresetId,
} from "@remit/data-ports/classification-presets";

const PRESET = "CLASSIFICATION_DEFAULT_PRESET";
const MODEL = "CLASSIFICATION_DEFAULT_MODEL";
const BASE_URL = "CLASSIFICATION_DEFAULT_BASE_URL";
const API_KEY = "CLASSIFICATION_DEFAULT_API_KEY";
const ENABLED = "CLASSIFICATION_DEFAULT_ENABLED";
const DAILY_LIMIT = "CLASSIFICATION_DEFAULT_DAILY_LIMIT";

const DEPENDENT_KEYS = [MODEL, BASE_URL, API_KEY, ENABLED, DAILY_LIMIT];

export interface ClassificationDefaultInput {
	presetId: string;
	model?: string;
	baseUrl?: string;
	apiKey?: string;
	enabled: boolean;
	dailyLimit?: number;
}

export interface ClassificationDefaultLabels {
	presetId: string;
	baseUrl: string;
	apiKey: string;
	dailyLimit: string;
}

const INPUT_LABELS: ClassificationDefaultLabels = {
	presetId: "presetId",
	baseUrl: "baseUrl",
	apiKey: "apiKey",
	dailyLimit: "dailyLimit",
};

const ENV_LABELS: ClassificationDefaultLabels = {
	presetId: PRESET,
	baseUrl: BASE_URL,
	apiKey: API_KEY,
	dailyLimit: DAILY_LIMIT,
};

export type ClassificationDefaultParse =
	| { ok: true; value: ClassificationDeploymentDefault }
	| { ok: false; message: string };

const invalid = (message: string): ClassificationDefaultParse => ({
	ok: false,
	message,
});

const isPositiveInteger = (value: number): boolean =>
	Number.isSafeInteger(value) && value > 0;

export const parseClassificationDefault = (
	input: ClassificationDefaultInput,
	labels: ClassificationDefaultLabels = INPUT_LABELS,
): ClassificationDefaultParse => {
	const { presetId } = input;
	if (!isClassificationPresetId(presetId))
		return invalid(
			`${labels.presetId}=${presetId} is not a known preset. Use one of ${Object.keys(CLASSIFICATION_PRESETS).join(", ")}.`,
		);

	const preset = CLASSIFICATION_PRESETS[presetId];
	const apiKey = input.apiKey ?? "";
	if (preset.needsKey && apiKey === "")
		return invalid(
			`${labels.apiKey} is not set. ${labels.presetId}=${presetId} needs a key.`,
		);
	const baseUrl = input.baseUrl || preset.defaultBaseUrl;
	if (!baseUrl)
		return invalid(
			`${labels.baseUrl} is not set. ${labels.presetId}=${presetId} has no default base URL.`,
		);
	const dailyLimit = input.dailyLimit ?? DEFAULT_CLASSIFICATION_DAILY_LIMIT;
	if (!isPositiveInteger(dailyLimit))
		return invalid(
			`${labels.dailyLimit}=${dailyLimit} must be a positive integer.`,
		);

	return {
		ok: true,
		value: {
			state: "Configured",
			presetId,
			model: input.model || preset.defaultModel,
			baseUrl,
			apiKey,
			enabled: input.enabled,
			dailyLimit,
		},
	};
};

const refuse = (message: string): never => {
	throw new Error(`Refusing to start: ${message}`);
};

const envValue = (env: NodeJS.ProcessEnv, key: string): string =>
	(env[key] ?? "").trim();

const enabledOf = (raw: string): boolean => {
	if (raw === "" || raw === "false") return false;
	if (raw === "true") return true;
	return refuse(`${ENABLED}=${raw} must be true or false.`);
};

const dailyLimitOf = (raw: string): number | undefined => {
	if (raw === "") return undefined;
	const limit = Number(raw);
	if (/^\d+$/.test(raw) && isPositiveInteger(limit)) return limit;
	return refuse(`${DAILY_LIMIT}=${raw} must be a positive integer.`);
};

export const classificationDefaultFromEnv = (
	env: NodeJS.ProcessEnv,
): ClassificationDeploymentDefault => {
	const presetId = envValue(env, PRESET);
	if (presetId === "") {
		const stray = DEPENDENT_KEYS.filter((key) => envValue(env, key) !== "");
		if (stray.length > 0)
			return refuse(`${stray.join(", ")} set without ${PRESET}.`);
		return { state: "None" };
	}

	const parsed = parseClassificationDefault(
		{
			presetId,
			model: envValue(env, MODEL),
			baseUrl: envValue(env, BASE_URL),
			apiKey: envValue(env, API_KEY),
			enabled: enabledOf(envValue(env, ENABLED)),
			dailyLimit: dailyLimitOf(envValue(env, DAILY_LIMIT)),
		},
		ENV_LABELS,
	);
	if (!parsed.ok) return refuse(parsed.message);
	return parsed.value;
};
