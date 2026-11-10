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

const dailyLimitOf = (raw: string): number => {
	if (raw === "") return DEFAULT_CLASSIFICATION_DAILY_LIMIT;
	const limit = Number(raw);
	if (/^\d+$/.test(raw) && Number.isSafeInteger(limit) && limit > 0)
		return limit;
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
	if (!isClassificationPresetId(presetId))
		return refuse(
			`${PRESET}=${presetId} is not a known preset. Use one of ${Object.keys(CLASSIFICATION_PRESETS).join(", ")}.`,
		);

	const preset = CLASSIFICATION_PRESETS[presetId];
	const apiKey = envValue(env, API_KEY);
	if (preset.needsKey && apiKey === "")
		return refuse(`${API_KEY} is not set. ${PRESET}=${presetId} needs a key.`);
	const baseUrl = envValue(env, BASE_URL) || preset.defaultBaseUrl;
	if (!baseUrl)
		return refuse(
			`${BASE_URL} is not set. ${PRESET}=${presetId} has no default base URL.`,
		);

	return {
		state: "Configured",
		presetId,
		model: envValue(env, MODEL) || preset.defaultModel,
		baseUrl,
		apiKey,
		enabled: enabledOf(envValue(env, ENABLED)),
		dailyLimit: dailyLimitOf(envValue(env, DAILY_LIMIT)),
	};
};
